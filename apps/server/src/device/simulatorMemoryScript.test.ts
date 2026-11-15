// @effect-diagnostics nodeBuiltinImport:off - exercises the host script in subprocess and HTTP fixtures.
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeOS from "node:os";
import * as NodeChildProcess from "node:child_process";
import * as NodeUtil from "node:util";
import * as NodeCrypto from "node:crypto";
import * as NodeHttp from "node:http";
import { simulatorMemoryScript } from "./simulatorMemoryScript.ts";

const exec = NodeUtil.promisify(NodeChildProcess.execFile);
const DEVICE = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const setup = async (cached = true) => {
  const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "sled-simulator-memory-"));
  const baseDir = NodePath.join(directory, "data");
  const tool = NodePath.join(baseDir, "tools/simslim/0.14.0");
  const bin = NodePath.join(directory, "bin");
  const calls = NodePath.join(directory, "calls.ndjson");
  const warning = NodePath.join(directory, "restart");
  const failure = NodePath.join(directory, "fail-on");
  const boot = NodePath.join(directory, "boot");
  await NodeFSP.mkdir(bin, { recursive: true });
  await NodeFSP.writeFile(boot, "first-boot");
  const fake = `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args[0] === '--version') { console.log('simslim 0.14.0'); process.exit(0); }
fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify(args) + '\\n');
if (args[0] === 'on' && fs.existsSync(${JSON.stringify(failure)})) { console.error('fixture failure'); process.exit(1); }
const stateFile = ${JSON.stringify(NodePath.join(directory, "cli-state-"))} + args[1];
if (args[0] === 'on') { fs.writeFileSync(stateFile, 'disabled'); console.log('{}'); }
else if (args[0] === 'status') console.log(JSON.stringify({dropped: fs.existsSync(stateFile) && fs.readFileSync(stateFile, 'utf8') === 'disabled' ? [{id:'health',labels:['com.apple.healthd']}] : []}));
else if (args[0] === 'enable') { fs.writeFileSync(stateFile, 'enabled'); console.log(JSON.stringify(fs.existsSync(${JSON.stringify(warning)}) ? {notStarted:['com.apple.test']} : {})); }
else console.log('{}');
`;
  await NodeFSP.writeFile(
    NodePath.join(bin, "xcrun"),
    "#!/usr/bin/env node\nconsole.log('711');\n",
    {
      mode: 0o755,
    },
  );
  await NodeFSP.writeFile(
    NodePath.join(bin, "ps"),
    `#!/usr/bin/env node\nprocess.stdout.write(require('node:fs').readFileSync(${JSON.stringify(boot)}));\n`,
    { mode: 0o755 },
  );
  if (cached) {
    await NodeFSP.mkdir(tool, { recursive: true });
    await NodeFSP.writeFile(NodePath.join(tool, "simslim"), fake, { mode: 0o755 });
    await NodeFSP.writeFile(NodePath.join(tool, ".install-complete"), "0.14.0");
  }
  return {
    directory,
    baseDir,
    tool,
    fake,
    warning,
    failure,
    boot,
    calls: async () =>
      (await NodeFSP.readFile(calls, "utf8").catch(() => ""))
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line)),
    run: async (
      input: { enabled: boolean; fullServices?: boolean; deviceId?: string },
      release?: Parameters<typeof simulatorMemoryScript>[1],
    ) => {
      const script =
        "Object.defineProperty(process, 'platform', {value:'darwin'}); Object.defineProperty(process, 'arch', {value:'arm64'});\n" +
        simulatorMemoryScript(
          {
            baseDir,
            deviceId: input.deviceId ?? DEVICE,
            enabled: input.enabled,
            ...(input.fullServices === undefined ? {} : { fullServices: input.fullServices }),
          },
          release,
        );
      try {
        const result = await exec(process.execPath, ["-e", script], {
          env: {
            ...process.env,
            PATH: [bin, NodePath.dirname(process.execPath), process.env.PATH].join(
              NodePath.delimiter,
            ),
          },
        });
        return { code: 0, output: JSON.parse(result.stdout) };
      } catch (cause) {
        if (typeof cause !== "object" || cause === null || !("stdout" in cause)) throw cause;
        return { code: 1, output: JSON.parse(String(cause.stdout)) };
      }
    },
    [Symbol.asyncDispose]: () => NodeFSP.rm(directory, { recursive: true, force: true }),
  };
};

it.live("preserves live service changes on reopen and reapplies the profile at the next boot", () =>
  Effect.promise(async () => {
    await using fixture = await setup();
    expect((await fixture.run({ enabled: true })).code).toBe(0);
    expect((await fixture.calls()).map((args) => args[0])).toEqual(["status", "on"]);
    await Promise.all([fixture.run({ enabled: true }), fixture.run({ enabled: true })]);
    expect(await fixture.calls()).toHaveLength(2);
    await NodeFSP.writeFile(fixture.boot, "next-boot");
    await fixture.run({ enabled: true });
    expect((await fixture.calls()).map((args) => args[0])).toEqual([
      "status",
      "on",
      "status",
      "on",
    ]);
  }),
);

it.live(
  "keeps full services until explicitly reset and restores services when the setting is off",
  () =>
    Effect.promise(async () => {
      await using fixture = await setup();
      await fixture.run({ enabled: true });
      await fixture.run({ enabled: true, fullServices: true });
      const fullCalls = await fixture.calls();
      expect(fullCalls.at(-1)).toEqual(["enable", DEVICE, "com.apple.healthd", "--json"]);
      await NodeFSP.writeFile(fixture.boot, "next-boot");
      await fixture.run({ enabled: true });
      expect((await fixture.calls()).at(-1)?.[0]).toBe("status");
      await fixture.run({ enabled: true, fullServices: false });
      expect((await fixture.calls()).at(-1)?.[0]).toBe("on");
      await fixture.run({ enabled: false });
      expect((await fixture.calls()).at(-1)).toEqual([
        "enable",
        DEVICE,
        "com.apple.healthd",
        "--json",
      ]);
      const restoredCount = (await fixture.calls()).length;
      await fixture.run({ enabled: false });
      expect(await fixture.calls()).toHaveLength(restoredCount);
    }),
);

it.live(
  "does not cache a failed preparation or report enabled-but-unstarted services as ready",
  () =>
    Effect.promise(async () => {
      await using fixture = await setup();
      await NodeFSP.writeFile(fixture.failure, "fail");
      expect(await fixture.run({ enabled: true })).toMatchObject({
        code: 1,
        output: { ok: false, reason: "command_failed" },
      });
      await NodeFSP.rm(fixture.failure);
      expect((await fixture.run({ enabled: true })).code).toBe(0);
      await NodeFSP.writeFile(fixture.warning, "restart");
      expect(await fixture.run({ enabled: true, fullServices: true })).toMatchObject({
        code: 1,
        output: { ok: false, reason: "reboot_required" },
      });
      await NodeFSP.rm(fixture.warning);
      expect(await fixture.run({ enabled: true })).toMatchObject({
        code: 1,
        output: { reason: "reboot_required" },
      });
      await NodeFSP.writeFile(fixture.boot, "after-restart");
      expect((await fixture.run({ enabled: true })).code).toBe(0);
      expect((await fixture.calls()).at(-1)?.[0]).toBe("status");
    }),
);

it.live("leaves unmanaged devices alone when memory reduction is disabled", () =>
  Effect.promise(async () => {
    await using fixture = await setup(false);
    expect((await fixture.run({ enabled: false })).code).toBe(0);
    expect(await fixture.calls()).toEqual([]);
    expect(
      await NodeFSP.stat(fixture.tool).then(
        () => true,
        () => false,
      ),
    ).toBe(false);
  }),
);

it.live.each([false, true])(
  "publishes only a verified archive and serializes concurrent installs (tampered: %s)",
  (tampered) =>
    Effect.promise(async () => {
      await using fixture = await setup(false);
      const archiveRoot = NodePath.join(fixture.directory, "archive");
      await NodeFSP.mkdir(archiveRoot);
      await NodeFSP.writeFile(NodePath.join(archiveRoot, "simslim"), fixture.fake, { mode: 0o755 });
      const archive = NodePath.join(fixture.directory, "tool.tar.gz");
      await exec("tar", ["-czf", archive, "-C", archiveRoot, "simslim"]);
      const bytes = await NodeFSP.readFile(archive);
      let downloads = 0;
      const server = NodeHttp.createServer((_req, response) => {
        downloads++;
        response.end(bytes);
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      try {
        const address = server.address();
        if (!address || typeof address === "string") throw new Error("Missing fixture port");
        const release = {
          version: "0.14.0",
          url: `http://127.0.0.1:${address.port}`,
          sha256: tampered
            ? "0".repeat(64)
            : NodeCrypto.createHash("sha256").update(bytes).digest("hex"),
        };
        const results = await Promise.all([
          fixture.run({ enabled: true }, release),
          fixture.run({ enabled: true, deviceId: OTHER }, release),
        ]);
        expect(results.map((r) => r.code)).toEqual(tampered ? [1, 1] : [0, 0]);
        if (tampered) {
          expect(results[0]?.output.reason).toBe("install_failed");
          expect(await NodeFSP.readdir(NodePath.dirname(fixture.tool))).toEqual([]);
        } else {
          expect(downloads).toBe(1);
          expect(
            await NodeFSP.readFile(NodePath.join(fixture.tool, ".install-complete"), "utf8"),
          ).toBe("0.14.0");
        }
      } finally {
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      }
    }),
);

it.live(
  "does not force already-enabled on-demand services to start while slimming a stock device",
  () =>
    Effect.promise(async () => {
      await using fixture = await setup();
      await NodeFSP.writeFile(fixture.warning, "enabled service cannot start mid-boot");
      expect(await fixture.run({ enabled: true })).toMatchObject({ code: 0, output: { ok: true } });
    }),
);
