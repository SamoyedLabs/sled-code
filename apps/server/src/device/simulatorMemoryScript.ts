import DEVICE_TOOL_VERSIONS from "./deviceToolVersions.json" with { type: "json" };

const version = DEVICE_TOOL_VERSIONS.simslim;
const RELEASE = {
  version,
  url: `https://github.com/MobAI-App/simslim/releases/download/v${version}/simslim-v${version}-macos-arm64.tar.gz`,
  sha256: "a3db0de6f428f9f8fd5dff256b122f98791c138521dc1330d99643719d8fe9ff",
};

/** Runs unchanged on the local Mac and SSH device hosts. */
export const simulatorMemoryScript = (
  input: {
    readonly baseDir: string | null;
    readonly deviceId: string;
    readonly enabled: boolean;
    readonly fullServices?: boolean;
  },
  release = RELEASE,
) =>
  `const input = ${JSON.stringify(input)};\nconst release = ${JSON.stringify(release)};\n` +
  String.raw`
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const exec = promisify(require('node:child_process').execFile);
const root = input.baseDir || path.join(os.homedir(), '.t3', 'device');
const tool = path.join(root, 'tools', 'simslim', release.version);
const binary = path.join(tool, 'simslim');
const sentinel = path.join(tool, '.install-complete');
const stateDir = path.join(root, 'device', 'simulator-memory');
const stateFile = path.join(stateDir, input.deviceId + '.json');
const profile = 'photos,store,web,icloud';
const reply = value => process.stdout.write(JSON.stringify(value));
const read = async file => { try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } };
const installed = async () => { try { await fs.access(binary); return (await fs.readFile(sentinel, 'utf8')).trim() === release.version; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } };
const command = (file, args) => exec(file, args, { timeout: 600000, maxBuffer: 8 * 1024 * 1024 });
const call = async args => JSON.parse((await command(binary, args)).stdout);
async function lock(file) {
  const token = process.pid + ':' + crypto.randomUUID();
  const deadline = Date.now() + 660000;
  for (;;) {
    try { await fs.symlink(token, file); return async () => { if (await fs.readlink(file).catch(() => null) === token) await fs.unlink(file); }; }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const previous = await fs.readlink(file).catch(() => null);
      if (!previous) continue;
      const pid = Number(previous.split(':')[0]);
      if (!Number.isSafeInteger(pid) || pid <= 0) throw Error('Invalid simulator memory lock');
      try { process.kill(pid, 0); } catch (e) {
        if (e.code === 'ESRCH' && await fs.readlink(file).catch(() => null) === previous) { await fs.unlink(file).catch(e => { if (e.code !== 'ENOENT') throw e; }); continue; }
      }
      if (Date.now() >= deadline) throw Error('Simulator memory operation is locked');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
}
async function install() {
  if (await installed()) return;
  const parent = path.dirname(tool);
  await fs.mkdir(parent, { recursive: true });
  const unlock = await lock(tool + '.lock');
  let staging;
  try {
    if (await installed()) return;
    staging = await fs.mkdtemp(path.join(parent, '.install-'));
    const response = await fetch(release.url, { signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw Error('SimSlim download failed');
    const bytes = Buffer.from(await response.arrayBuffer());
    if (crypto.createHash('sha256').update(bytes).digest('hex') !== release.sha256) throw Error('SimSlim checksum mismatch');
    const archive = path.join(staging, 'archive.tar.gz');
    await fs.writeFile(archive, bytes);
    await command('tar', ['-xzf', archive, '-C', staging]);
    await fs.unlink(archive);
    await fs.chmod(path.join(staging, 'simslim'), 0o755);
    const check = await command(path.join(staging, 'simslim'), ['--version']);
    if (check.stdout.trim() !== 'simslim ' + release.version) throw Error('Unexpected SimSlim version');
    await fs.writeFile(path.join(staging, '.install-complete'), release.version);
    await fs.rm(tool, { recursive: true, force: true });
    await fs.rename(staging, tool);
  } finally { if (staging) await fs.rm(staging, { recursive: true, force: true }); await unlock(); }
}
(async () => {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') { reply({ ok: true, supported: false }); return; }
  if (!/^[0-9a-fA-F-]{36}$/.test(input.deviceId)) throw Error('Invalid simulator id');
  await fs.mkdir(stateDir, { recursive: true });
  const unlock = await lock(stateFile + '.lock');
  try {
    const previous = await read(stateFile);
    if (!input.enabled && !previous && input.fullServices !== true) { reply({ ok: true, supported: true }); return; }
    const fullServices = input.fullServices ?? previous?.fullServices ?? false;
    const slim = input.enabled && !fullServices;
    const managerPid = (await command('xcrun', ['simctl', 'spawn', input.deviceId, 'launchctl', 'managerpid'])).stdout.trim();
    if (!/^[1-9][0-9]*$/.test(managerPid)) throw Error('Simulator boot could not be identified');
    const started = (await command('ps', ['-o', 'lstart=', '-p', managerPid])).stdout.trim();
    if (!started) throw Error('Simulator boot could not be identified');
    const bootPid = managerPid + ':' + started;
    if (previous?.restartRequired && previous.bootPid === bootPid && previous.enabled === input.enabled && previous.fullServices === fullServices) { reply({ ok: false, reason: 'reboot_required' }); process.exitCode = 1; return; }
    if (input.fullServices === undefined && previous?.version === release.version && previous.profile === profile && previous.bootPid === bootPid && previous.enabled === input.enabled && previous.fullServices === fullServices && previous.applied && await installed()) {
      reply({ ok: true, supported: true, slim }); return;
    }
    try { await install(); } catch (e) { process.stderr.write(String(e)); reply({ ok: false, reason: 'install_failed' }); process.exitCode = 1; return; }
    const record = { version: release.version, profile, bootPid, enabled: input.enabled, fullServices, restartRequired: false, applied: false };
    const write = async () => { const tmp = stateFile + '.' + process.pid; await fs.writeFile(tmp, JSON.stringify(record), { mode: 0o600 }); await fs.rename(tmp, stateFile); };
    await write();
    const status = await call(['status', input.deviceId, '--json', '--dropped']);
    const kept = new Set(profile.split(','));
    const labels = [...new Set((status.dropped || []).filter(category => !slim || kept.has(category.id)).flatMap(category => category.labels))];
    if (labels.length) {
      const restored = await call(['enable', input.deviceId, labels.join(','), '--json']);
      if (restored.notStarted?.length) {
        record.restartRequired = true;
        await write();
        reply({ ok: false, reason: 'reboot_required' }); process.exitCode = 1; return;
      }
    }
    if (slim) await command(binary, ['on', input.deviceId, '--no-reboot', '--except', profile]);
    record.applied = true;
    await write();
    reply({ ok: true, supported: true, slim });
  } finally { await unlock(); }
})().catch(e => { process.stderr.write(String(e)); reply({ ok: false, reason: 'command_failed' }); process.exitCode = 1; });
`;
