import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const fake = vi.hoisted(() => ({
  records: new Map<string, string>(),
  fetch: vi.fn<typeof fetch>(),
}));
vi.mock("expo/fetch", () => ({ fetch: fake.fetch }));
vi.mock("expo-secure-store", () => ({
  getItemAsync: async (key: string) => fake.records.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => void fake.records.set(key, value),
  deleteItemAsync: async (key: string) => void fake.records.delete(key),
}));
vi.mock("expo-file-system", () => ({}));
vi.mock("expo-crypto", () => ({}));

import {
  botVoiceServerSynthesizer,
  getBotVoiceServer,
  probeBotVoiceServer,
  removeBotVoiceServer,
  saveBotVoiceServer,
} from "./botVoiceServer";
import { encodeVoiceServerWav } from "./botVoiceServerWire";

const routes = {
  dictation: true,
  transcriptionModel: "test-asr",
  speech: true,
  speechModel: "test-tts",
  voice: "test-voice",
};
const address = "https://voice.example.test/v1";
const key = "fixture-key";
const pcm = new Uint8Array([0, 0, 255, 127]);

describe("bot voice server", () => {
  beforeEach(async () => {
    await removeBotVoiceServer();
    fake.fetch.mockReset();
  });

  it("retains a configured key on the same origin and drops it on a different origin", async () => {
    fake.fetch.mockImplementation(async () =>
      Response.json({ data: [{ id: "test-asr", task: "automatic-speech-recognition" }] }),
    );
    await saveBotVoiceServer(address, key, routes);
    expect(getBotVoiceServer()).toEqual({ address, hasKey: true, routes });
    expect(await probeBotVoiceServer("https://voice.example.test/api", "")).toEqual({
      transcription: ["test-asr"],
      speech: [],
      voices: [],
    });
    expect(fake.fetch.mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: "Bearer fixture-key",
    });
    await probeBotVoiceServer("https://other.example.test/v1", "");
    expect(fake.fetch.mock.calls[1]?.[1]?.headers).not.toHaveProperty("Authorization");
    await saveBotVoiceServer("https://other.example.test/v1", "", routes);
    expect(getBotVoiceServer()?.hasKey).toBe(false);
  });

  it("refuses redirects and embedded URL credentials", async () => {
    fake.fetch.mockResolvedValueOnce(Response.redirect("https://other.example.test"));
    await expect(probeBotVoiceServer(address, key)).rejects.toThrow(/redirect/);
    expect(fake.fetch).toHaveBeenCalledOnce();
    expect(fake.fetch.mock.calls[0]?.[1]?.redirect).toBe("manual");
    await expect(
      probeBotVoiceServer("https://user:credential@voice.example.test", key),
    ).rejects.toThrow(/address/);
    expect(fake.fetch).toHaveBeenCalledOnce();
  });

  it("decodes bounded native-ready WAV speech using the selected model and voice", async () => {
    await saveBotVoiceServer(address, key, routes);
    const wav = Uint8Array.from(encodeVoiceServerWav(pcm, 16000));
    fake.fetch.mockResolvedValueOnce(new Response(wav.buffer));
    const speak = botVoiceServerSynthesizer()!;
    expect(await speak("Synthetic text.", new AbortController().signal)).toMatchObject({
      sampleRate: 16000,
      pcm: expect.any(Uint8Array),
    });
    expect(fake.fetch.mock.calls[0]?.[0]).toBe(`${address}/audio/speech`);
    expect(fake.fetch.mock.calls[0]?.[1]?.body).toBe(
      JSON.stringify({
        model: "test-tts",
        input: "Synthetic text.",
        voice: "test-voice",
        response_format: "wav",
      }),
    );
  });
});
