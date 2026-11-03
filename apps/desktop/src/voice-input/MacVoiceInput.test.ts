// @effect-diagnostics nodeBuiltinImport:off -- Exercise actual child processes and audio-file cleanup at the native boundary.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { MacVoiceInput } from "./MacVoiceInput.ts";

// oxlint-disable-next-line t3code/no-global-process-runtime -- The executable fixture needs a real POSIX host, irrespective of injected application platforms.
const nativeTest = it.skipIf(process.platform === "win32");
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => NodeFSP.rm(directory, { recursive: true, force: true })),
  );
});

async function setup() {
  const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "sled-voice-test-"));
  directories.push(directory);
  const helper = NodePath.join(directory, "helper");
  const recordingPathFile = NodePath.join(directory, "recording-path");
  const interpreter = process.execPath;
  await NodeFSP.writeFile(
    helper,
    `#!${interpreter}
const fs = require('node:fs');
if (process.argv[2] === '--available') { console.log(JSON.stringify({ phase: 'available', locale: 'en-US' })); }
else {
  fs.writeFileSync(process.argv[4], 'temporary audio');
  fs.writeFileSync(${JSON.stringify(recordingPathFile)}, process.argv[4]);
  console.log(JSON.stringify({ phase: 'recording', level: '0.8' }));
  process.stdin.once('data', () => {
    console.log(JSON.stringify({ phase: 'transcribing' }));
    console.log(JSON.stringify({ phase: 'complete', text: 'spoken text', locale: 'en-US' }));
    process.exit(0);
  });
}
`,
  );
  await NodeFSP.chmod(helper, 0o755);
  return { voice: new MacVoiceInput(helper), recordingPathFile };
}

nativeTest(
  "captures native phases, stops the owned helper, and removes temporary audio",
  async () => {
    const { voice, recordingPathFile } = await setup();
    expect(await voice.available("en-US")).toBe(true);
    const phases: string[] = [];
    const result = await voice.record(
      "one",
      "en-US",
      async () => true,
      ({ phase }) => {
        phases.push(phase);
        if (phase === "recording") voice.stop("one");
      },
    );
    expect(result).toEqual({ text: "spoken text", locale: "en-US" });
    expect(phases).toEqual(["recording", "transcribing"]);
    const recordingPath = await NodeFSP.readFile(recordingPathFile, "utf8");
    await expect(NodeFSP.stat(recordingPath)).rejects.toMatchObject({ code: "ENOENT" });
  },
);

nativeTest(
  "cancels before a pending permission prompt completes and does not launch capture",
  async () => {
    const { voice } = await setup();
    const permission = Promise.withResolvers<boolean>();
    const phase = vi.fn();
    const operation = voice.record("one", "en-US", () => permission.promise, phase);
    voice.cancel("one");
    permission.resolve(true);
    await expect(operation).rejects.toThrow("cancelled");
    expect(phase).not.toHaveBeenCalled();
    await expect(voice.record("two", "en-US", async () => false, phase)).rejects.toThrow(
      "Allow microphone access",
    );
  },
);

nativeTest(
  "rejects concurrent recordings, ignores another session's stop, and can cancel and restart",
  async () => {
    const { voice } = await setup();
    const recording = Promise.withResolvers<void>();
    const first = voice.record(
      "one",
      "en-US",
      async () => true,
      () => recording.resolve(),
    );
    const rejected = expect(first).rejects.toThrow("cancelled");
    await recording.promise;
    await expect(
      voice.record(
        "two",
        "en-US",
        async () => true,
        () => {},
      ),
    ).rejects.toThrow("already active");
    voice.stop("two");
    voice.cancel("two");
    voice.cancel("one");
    await rejected;
    await expect(
      voice.record(
        "two",
        "en-US",
        async () => true,
        () => voice.stop("two"),
      ),
    ).resolves.toMatchObject({ text: "spoken text" });
  },
);
