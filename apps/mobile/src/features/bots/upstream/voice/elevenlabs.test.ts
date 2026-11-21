import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { elevenLabsSpeech, scribeToken } from "./elevenlabs";
import { ScribeRealtimeSession } from "./scribe-realtime";

afterEach(() => vi.unstubAllGlobals());

describe("ElevenLabs wire", () => {
  it("uses official HTTPS routes and sends the account key only in headers", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2])))
      .mockResolvedValueOnce(Response.json({ token: "single-use-fixture" }));
    vi.stubGlobal("fetch", fetch);
    const { signal } = new AbortController();

    await expect(
      elevenLabsSpeech("synthetic-key", "voice/id", "elevenlabs-flash-v2.5", "Hello", signal),
    ).resolves.toEqual(new Uint8Array([1, 2]));
    await expect(scribeToken("synthetic-key", signal)).resolves.toBe("single-use-fixture");

    const [speech, token] = fetch.mock.calls;
    expect(speech?.[0]).toBe(
      "https://api.elevenlabs.io/v1/text-to-speech/voice%2Fid?output_format=pcm_24000",
    );
    expect(token?.[0]).toBe("https://api.elevenlabs.io/v1/single-use-token/realtime_scribe");
    for (const call of [speech, token]) {
      expect(call?.[1].headers.get("xi-api-key")).toBe("synthetic-key");
      expect(call?.[1].redirect).toBe("error");
    }
    expect(JSON.parse(speech?.[1].body)).toEqual({ text: "Hello", model_id: "eleven_flash_v2_5" });
  });

  it("uses the single-use token, flushes buffered audio and combines finalized text", async () => {
    const send = vi.fn();
    const close = vi.fn();
    const socket = {
      send,
      close,
      onmessage: undefined as ((event: { data: string }) => void) | undefined,
    };
    const createSocket = vi.fn(function (_url: string) {
      return socket;
    });
    vi.stubGlobal("WebSocket", createSocket);
    const onText = vi.fn();
    const onFailure = vi.fn();
    const session = new ScribeRealtimeSession({ token: "single-use-fixture", onText, onFailure });
    const message = (message_type: string, text?: string) => {
      socket.onmessage?.({ data: JSON.stringify({ message_type, text }) });
    };
    try {
      session.append("AAAB");
      expect(send).not.toHaveBeenCalled();
      message("session_started");
      message("partial_transcript", "first");
      message("committed_transcript", "first words");
      message("partial_transcript", "second");
      expect(onText).toHaveBeenLastCalledWith("first words second");
      const done = session.finish();
      message("committed_transcript", "second words");
      await done;

      const url = new URL(String(createSocket.mock.calls[0]?.[0]));
      expect(url.hostname).toBe("api.elevenlabs.io");
      expect(url.searchParams.get("token")).toBe("single-use-fixture");
      expect(url.searchParams.get("model_id")).toBe("scribe_v2_realtime");
      expect(send.mock.calls.map(([frame]) => JSON.parse(frame))).toEqual([
        {
          message_type: "input_audio_chunk",
          audio_base_64: "AAAB",
          commit: false,
          sample_rate: 16000,
        },
        { message_type: "input_audio_chunk", audio_base_64: "", commit: true, sample_rate: 16000 },
      ]);
      expect(onFailure).not.toHaveBeenCalled();
      expect(close).toHaveBeenCalledOnce();
      expect(session.text).toBe("first words second words");
    } finally {
      session.cancel();
    }
  });
});
