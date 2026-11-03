// @effect-diagnostics nodeBuiltinImport:off -- Own the native helper's pipes and temporary audio at the platform boundary.
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeReadline from "node:readline";
import * as NodeUtil from "node:util";
import type { DesktopVoiceInputPhase } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

const NativeMessage = Schema.Struct({
  phase: Schema.String,
  text: Schema.optional(Schema.String),
  locale: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
  level: Schema.optional(Schema.String),
});
const decodeMessage = Schema.decodeUnknownSync(Schema.fromJsonString(NativeMessage));

export class MacVoiceInput {
  private active: {
    id: string;
    cancelled: boolean;
    child?: NodeChildProcess.ChildProcessWithoutNullStreams;
  } | null = null;

  private readonly helper: string;
  constructor(helper: string) {
    this.helper = helper;
  }

  async available(locale: string): Promise<boolean> {
    try {
      const { stdout } = await NodeUtil.promisify(NodeChildProcess.execFile)(
        this.helper,
        ["--available", locale],
        {
          timeout: 15_000,
        },
      );
      return decodeMessage(stdout.trim()).phase === "available";
    } catch {
      return false;
    }
  }

  async record(
    id: string,
    locale: string,
    requestPermission: () => Promise<boolean>,
    onPhase: (phase: DesktopVoiceInputPhase) => void,
  ): Promise<{ text: string; locale: string }> {
    if (this.active) throw new Error("Another voice recording is already active.");
    const session: NonNullable<MacVoiceInput["active"]> = { id, cancelled: false };
    this.active = session;
    let directory: string | undefined;
    try {
      const granted = await requestPermission();
      if (session.cancelled) throw new Error("Voice input cancelled.");
      if (!granted)
        throw new Error(
          "Allow microphone access in System Settings → Privacy & Security → Microphone.",
        );
      directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "sled-voice-"));
      if (session.cancelled) throw new Error("Voice input cancelled.");
      const child = NodeChildProcess.spawn(this.helper, [
        "--record",
        locale,
        NodePath.join(directory, "recording.wav"),
      ]);
      session.child = child;
      let result: { text: string; locale: string } | undefined;
      let failure = "Voice transcription did not finish.";
      child.stdin.on("error", () => {
        failure = "The microphone recording stopped unexpectedly.";
        child.kill("SIGKILL");
      });
      const lines = NodeReadline.createInterface({ input: child.stdout });
      lines.on("line", (line) => {
        try {
          const message = decodeMessage(line);
          if (message.phase === "complete" && message.text !== undefined && message.locale) {
            result = { text: message.text, locale: message.locale };
          } else if (message.phase === "error") {
            failure = message.error ?? failure;
          } else if (
            message.phase === "preparing" ||
            message.phase === "recording" ||
            message.phase === "transcribing"
          ) {
            const level = message.level === undefined ? undefined : Number(message.level);
            onPhase({
              id,
              phase: message.phase,
              ...(level !== undefined && Number.isFinite(level)
                ? { level: Math.max(0, Math.min(1, level)) }
                : {}),
            });
          }
        } catch {
          failure = "The voice helper returned an invalid response.";
          child.kill("SIGKILL");
        }
      });
      // Drain native diagnostics without retaining audio paths or speech in application logs.
      child.stderr.resume();
      await new Promise<void>((resolve, reject) => {
        child.once("error", reject);
        child.once("close", (code) => {
          lines.close();
          if (session.cancelled) reject(new Error("Voice input cancelled."));
          else if (code !== 0 || !result) reject(new Error(failure));
          else resolve();
        });
      });
      if (!result) throw new Error(failure);
      return result;
    } finally {
      try {
        if (directory) await NodeFSP.rm(directory, { recursive: true, force: true });
      } finally {
        if (this.active === session) this.active = null;
      }
    }
  }

  stop(id: string): void {
    const session = this.active;
    if (session?.id === id && session.child && !session.cancelled)
      session.child.stdin.end("stop\n");
  }

  cancel(id?: string): void {
    const session = this.active;
    if (!session || (id !== undefined && session.id !== id)) return;
    session.cancelled = true;
    session.child?.kill("SIGKILL");
  }
}
