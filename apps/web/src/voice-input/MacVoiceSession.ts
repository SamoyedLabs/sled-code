import { randomUUID } from "../lib/utils";
import type { DesktopVoiceInputBridge, DesktopVoiceInputPhase } from "@t3tools/contracts";
import {
  resolveTranscriptCommit,
  type VoiceDraftSnapshot,
} from "@t3tools/client-runtime/voice-input";

export type VoiceAudioSource = {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => ReadonlyArray<number>;
};
const EMPTY_LEVELS: ReadonlyArray<number> = Array<number>(64).fill(0);

type Snapshot = {
  available: boolean;
  phase: "idle" | "preparing" | "recording" | "transcribing" | "error";
  error: string | null;
};

export class MacVoiceSession {
  private snapshot: Snapshot = { available: false, phase: "idle", error: null };
  private listeners = new Set<() => void>();
  private audioLevels = EMPTY_LEVELS;
  private audioListeners = new Set<() => void>();
  readonly audio: VoiceAudioSource = {
    subscribe: (listener) => {
      this.audioListeners.add(listener);
      return () => {
        this.audioListeners.delete(listener);
      };
    },
    getSnapshot: () => this.audioLevels,
  };
  private id: string | null = null;
  private revision = 0;
  private ownerKey: string | null = null;
  private previousDraft: { ownerKey: string; text: string } | null = null;

  private readonly bridge: DesktopVoiceInputBridge | undefined;
  private readonly readDraft: () => VoiceDraftSnapshot | null;
  private readonly commit: (text: string, cursor: number) => void;
  constructor(
    bridge: DesktopVoiceInputBridge | undefined,
    readDraft: () => VoiceDraftSnapshot | null,
    commit: (text: string, cursor: number) => void,
  ) {
    this.bridge = bridge;
    this.readDraft = readDraft;
    this.commit = commit;
  }

  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  connect(ownerKey: string): () => void {
    this.ownerKey = ownerKey;
    const unsubscribe = this.bridge?.onPhase((event) => this.onPhase(event));
    let disposed = false;
    void this.bridge
      ?.available()
      .then((available) => {
        if (!disposed) this.publish({ ...this.snapshot, available });
      })
      .catch(() => {});
    return () => {
      disposed = true;
      unsubscribe?.();
      this.cancel();
    };
  }

  observeDraft = () => {
    const current = this.readDraft();
    const draft = current?.ownerKey === this.ownerKey ? current : null;
    if (
      draft?.ownerKey !== this.previousDraft?.ownerKey ||
      draft?.text !== this.previousDraft?.text
    ) {
      this.revision += 1;
      this.previousDraft = draft;
    }
    return draft ? { ...draft, revision: this.revision } : null;
  };

  async start(): Promise<void> {
    if (!this.bridge || !this.snapshot.available || this.id) return;
    const captured = this.observeDraft();
    if (!captured) return;
    const id = randomUUID();
    this.id = id;
    this.publish({ ...this.snapshot, phase: "preparing", error: null });
    const locale =
      window.desktopBridge?.getSystemLocale() ?? Intl.DateTimeFormat().resolvedOptions().locale;
    try {
      const result = await this.bridge.record({ id, locale });
      if (this.id !== id) return;
      const commit = resolveTranscriptCommit(
        captured,
        this.observeDraft(),
        result.text,
        result.locale,
      );
      if (commit.kind === "stale")
        throw new Error("The draft changed. Your recording was not inserted.");
      if (commit.kind === "empty") throw new Error("No speech was detected. Try again.");
      this.commit(commit.text, commit.selection.end);
      this.publish({ ...this.snapshot, phase: "idle", error: null });
    } catch (error) {
      if (this.id === id)
        this.publish({
          ...this.snapshot,
          phase: "error",
          error: error instanceof Error ? error.message : "Voice input failed.",
        });
    } finally {
      if (this.id === id) this.id = null;
    }
  }

  stop = () => {
    if (!this.id || this.snapshot.phase !== "recording") return;
    const id = this.id;
    this.publish({ ...this.snapshot, phase: "transcribing" });
    void this.bridge?.stop({ id }).catch((error: unknown) => {
      if (this.id === id) {
        this.cancel();
        this.publish({
          ...this.snapshot,
          phase: "error",
          error: error instanceof Error ? error.message : "Could not stop recording.",
        });
      }
    });
  };

  cancel = () => {
    const id = this.id;
    this.id = null;
    if (id) void this.bridge?.cancel({ id }).catch(() => {});
    this.publish({ ...this.snapshot, phase: "idle", error: null });
  };

  private onPhase(event: DesktopVoiceInputPhase): void {
    if (event.id !== this.id) return;
    if (this.snapshot.phase === "transcribing" && event.phase === "recording") return;
    if (event.phase !== this.snapshot.phase) this.publish({ ...this.snapshot, phase: event.phase });
    if (event.phase === "recording" && event.level !== undefined) {
      this.audioLevels = [...this.audioLevels.slice(1), event.level];
      for (const listener of this.audioListeners) listener();
    }
  }

  private publish(snapshot: Snapshot): void {
    this.snapshot = snapshot;
    if (snapshot.phase !== "recording" && this.audioLevels !== EMPTY_LEVELS) {
      this.audioLevels = EMPTY_LEVELS;
      for (const listener of this.audioListeners) listener();
    }
    for (const listener of this.listeners) listener();
  }
}
