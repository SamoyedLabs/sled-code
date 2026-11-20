import type { UIMessageChunk } from "ai";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { createPreviewStreamingTransport } from "./previewStreamingTransport";

async function collect(stream: ReadableStream<UIMessageChunk>) {
  const reader = stream.getReader();
  const chunks: UIMessageChunk[] = [];
  for (;;) {
    const next = await reader.read();
    if (next.done) return chunks;
    chunks.push(next.value);
  }
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

it("emits incremental SDK text chunks and finishes with no remaining timers", async () => {
  const transport = createPreviewStreamingTransport();
  const stream = await transport.sendMessages({
    trigger: "submit-message",
    chatId: "preview",
    messageId: undefined,
    messages: [],
    abortSignal: undefined,
  });
  await vi.runAllTimersAsync();
  const chunks = await collect(stream);
  expect(chunks[0]?.type).toBe("start");
  expect(chunks[1]?.type).toBe("text-start");
  expect(chunks.filter((chunk) => chunk.type === "text-delta").length).toBeGreaterThan(1);
  const inputs = chunks.filter((chunk) => chunk.type === "tool-input-available");
  const outputs = chunks.filter((chunk) => chunk.type === "tool-output-available");
  expect(inputs.map((chunk) => chunk.toolName)).toEqual([
    "search_product_notes",
    "read_launch_brief",
  ]);
  expect(outputs.map((chunk) => chunk.toolCallId)).toEqual(inputs.map((chunk) => chunk.toolCallId));
  expect(chunks.findIndex((chunk) => chunk.type === "text-delta")).toBeGreaterThan(
    chunks.findLastIndex((chunk) => chunk.type === "tool-output-available"),
  );
  expect(chunks.at(-2)?.type).toBe("text-end");
  expect(chunks.at(-1)).toMatchObject({ type: "finish", finishReason: "stop" });
  const timings = chunks
    .filter((chunk) => chunk.type === "message-metadata")
    .at(-1)?.messageMetadata;
  expect(timings).toHaveProperty("toolTimings");
  expect(vi.getTimerCount()).toBe(0);
});

it("stops a cancelled preview stream without emitting later tokens or a success finish", async () => {
  const abort = new AbortController();
  const stream = await createPreviewStreamingTransport().sendMessages({
    trigger: "submit-message",
    chatId: "preview",
    messageId: undefined,
    messages: [],
    abortSignal: abort.signal,
  });
  abort.abort();
  await vi.runAllTimersAsync();
  const chunks = await collect(stream);
  expect(chunks.map((chunk) => chunk.type)).toEqual([
    "start",
    "text-start",
    "message-metadata",
    "abort",
  ]);
  expect(vi.getTimerCount()).toBe(0);
});

it("preserves a failed tool result separately from successful completion", async () => {
  const stream = await createPreviewStreamingTransport().sendMessages({
    trigger: "submit-message",
    chatId: "preview",
    messageId: undefined,
    messages: [
      {
        id: "failure-request",
        role: "user",
        parts: [{ type: "text", text: "Show a failed tool demo." }],
      },
    ],
    abortSignal: undefined,
  });
  await vi.runAllTimersAsync();
  const chunks = await collect(stream);
  expect(chunks.filter((chunk) => chunk.type === "tool-output-available")).toHaveLength(1);
  const failure = chunks.find((chunk) => chunk.type === "tool-output-error");
  expect(failure?.errorText).toBe("Sample failure: the launch brief could not be read.");
  expect(
    chunks
      .filter((chunk) => chunk.type === "tool-output-available")
      .some((chunk) => chunk.toolCallId === failure?.toolCallId),
  ).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
});
