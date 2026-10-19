import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

// Exercise the committed package through pnpm's Git fetcher, never a workspace link.
const { values } = parseArgs({ options: {
  ref: { type: 'string', default: 'HEAD' },
  spec: { type: 'string' },
  pnpm: { type: 'string', default: process.env.DSH_INSTALL_PNPM || 'pnpm' },
} });
const repository = fileURLToPath(new URL('../', import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), 'dsh-install-check-'));
const emptyConfig = join(temporary, 'npmrc');
writeFileSync(emptyConfig, '');
const environment = { ...process.env, CI: '1', NO_COLOR: '1', FORCE_COLOR: '0',
  npm_config_userconfig: emptyConfig, NPM_CONFIG_USERCONFIG: emptyConfig,
  npm_config_cache: join(temporary, 'npm-cache'),
  XDG_CACHE_HOME: join(temporary, 'cache'), XDG_STATE_HOME: join(temporary, 'state'),
};
// A caller's preload or module search path must not supply missing package files.
delete environment.NODE_OPTIONS;
delete environment.NODE_PATH;
const pnpmCommand = /\.[cm]?js$/.test(values.pnpm) ? process.execPath : values.pnpm;
const pnpmPrefix = pnpmCommand === process.execPath ? [values.pnpm] : [];

function run(command, args, cwd, allowFailure = false, input) {
  const result = spawnSync(command, args, { cwd, env: environment, input, encoding: 'utf8',
    timeout: 120_000, maxBuffer: 8 * 1024 * 1024 });
  if (result.error) throw result.error;
  const output = (result.stdout || '') + (result.stderr || '');
  if (!allowFailure && result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed:\n${output}`);
  return { status: result.status, output };
}
function pnpm(args, cwd, allowFailure = false) {
  return run(pnpmCommand, [...pnpmPrefix, ...args, '--store-dir', join(temporary, 'store'),
    '--reporter', 'append-only'], cwd, allowFailure);
}
function consumer(name) {
  const directory = join(temporary, name);
  mkdirSync(directory);
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ name: 'install-check', private: true, type: 'module' }));
  writeFileSync(join(directory, 'pnpm-workspace.yaml'),
    'enableGlobalVirtualStore: false\ndangerouslyAllowAllBuilds: false\nignoreScripts: false\nallowBuilds: {}\n');
  return directory;
}
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

try {
  const commit = run('git', ['rev-parse', `${values.ref}^{commit}`], repository).output.trim();
  const manifest = JSON.parse(run('git', ['show', `${commit}:package.json`], repository).output);
  const spec = values.spec || `git+${pathToFileURL(repository).href.replace(/\/$/, '')}#${commit}`;
  assert.ok(spec.endsWith(`#${commit}`), '--spec must pin the same full commit as --ref');
  const pnpmVersion = run(pnpmCommand, [...pnpmPrefix, '--version'], temporary).output.trim();
  assert.match(pnpmVersion, /^11\./, 'This check exercises the pnpm 11 Git build-approval flow used by DSH');
  console.log(`Checking ${manifest.name}@${manifest.version} at ${commit} with pnpm ${pnpmVersion}`);

  const source = join(temporary, 'source');
  mkdirSync(source);
  const archive = spawnSync('git', ['archive', commit], { cwd: repository, maxBuffer: 128 * 1024 * 1024 });
  assert.equal(archive.status, 0, archive.stderr?.toString());
  run('tar', ['-xf', '-', '-C', source], temporary, false, archive.stdout);
  assert.equal(existsSync(join(source, 'lib')), false, 'The test must start with unbuilt Git sources');
  run(process.execPath, ['scripts/build.mjs'], source);

  const gitConsumer = consumer('git');
  const installArgs = ['add', spec, ...(spec.startsWith('git+file:') ? ['--offline'] : [])];
  const blocked = pnpm(installArgs, gitConsumer, true);
  writeFileSync(join(temporary, 'git-first-install.log'), blocked.output);
  assert.notEqual(blocked.status, 0, 'An unapproved Git build must not silently install');
  assert.match(blocked.output, /ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED/);
  const approval = blocked.output.match(/^  (.+): true\s*$/m)?.[1];
  assert.ok(approval?.startsWith(`${manifest.name}@`) && approval.includes(commit),
    `Expected pnpm to print the exact commit-specific approval key:\n${blocked.output}`);
  writeFileSync(join(gitConsumer, 'pnpm-workspace.yaml'),
    `enableGlobalVirtualStore: false\ndangerouslyAllowAllBuilds: false\nallowBuilds:\n  ${JSON.stringify(approval)}: true\n`);
  const approved = pnpm(installArgs, gitConsumer);
  writeFileSync(join(temporary, 'git-approved-install.log'), approved.output);

  function verifyInstalled(directory) {
    const installed = join(directory, 'node_modules', manifest.name);
    const installedManifest = JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8'));
    assert.equal(installedManifest.version, manifest.version);
    for (const entry of ['lib/index.js', 'lib/client.js', 'cordis.patch.yml']) {
      assert.deepEqual(readFileSync(join(installed, entry)), readFileSync(join(source, entry)), `${entry} differs from a clean build`);
    }
    assert.equal(existsSync(join(installed, 'src')), false, 'Install payload must not include development sources');
    assert.equal(existsSync(join(installed, 'scripts')), false, 'Install payload must not include build tooling');
    const probe = `
      import assert from 'node:assert/strict';
      import { readFileSync } from 'node:fs';
      import { runInNewContext } from 'node:vm';
      const name = ${JSON.stringify(manifest.name)};
      assert.equal(typeof (await import(name)).apply, 'function');
      const client = readFileSync(new URL(import.meta.resolve(name + '/client')), 'utf8');
      assert.doesNotMatch(client, /\\/\\* BUILD_[A-Z_]+ \\*\\//);
      let registration;
      runInNewContext(client, { window: { __ModuleLoader__: { load(value) { registration = value; } } } });
      assert.equal(registration.id, name);
      assert.equal(typeof registration.factory, 'function');
    `;
    run(process.execPath, ['--input-type=module', '-e', probe], directory);
    return hash(readFileSync(join(installed, 'lib/client.js')));
  }
  const clientHash = verifyInstalled(gitConsumer);
  console.log('PASS: unapproved Git build is blocked; exact-key approval builds and installs both entrypoints');

  const packed = JSON.parse(run('npm', ['pack', '--ignore-scripts', '--json', '--offline',
    '--pack-destination', temporary], source).output);
  const tarConsumer = consumer('tarball');
  pnpm(['add', join(temporary, packed[0].filename), '--offline', '--ignore-scripts'], tarConsumer);
  assert.equal(verifyInstalled(tarConsumer), clientHash);
  console.log('PASS: prebuilt tarball installs with scripts disabled and has identical runtime files');
  console.log(JSON.stringify({ package: manifest.name, version: manifest.version, commit, spec, pnpm: pnpmVersion,
    approvedBuild: approval, clientSha256: clientHash, gitInstall: 'passed', tarballInstall: 'passed' }, null, 2));
  rmSync(temporary, { recursive: true, force: true });
} catch (error) {
  console.error(`Installation evidence retained at ${temporary}`);
  throw error;
}
