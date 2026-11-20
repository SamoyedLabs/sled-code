import type { ChatTransport, UIMessage, UIMessageChunk } from "ai";

export type PreviewTraceMetadata = {
  sampleAttachment?: boolean;
  startedAt?: number;
  endedAt?: number;
  toolTimings?: Record<string, { start: number; end?: number }>;
};
export type PreviewChatMessage = UIMessage<PreviewTraceMetadata>;

/** A bounded local SDK stream for visual review; it never dispatches a provider request. */
export function createPreviewStreamingTransport(): ChatTransport<PreviewChatMessage> {
  let sequence = 0;
  return {
    reconnectToStream: async () => null,
    sendMessages: async ({ abortSignal, messages }) => {
      const id = `sample-reply-${++sequence}`;
      const failure =
        messages
          .at(-1)
          ?.parts.some(
            (part) => part.type === "text" && part.text === "Show a failed tool demo.",
          ) ?? false;
      const searchId = `${id}-search`;
      const readId = `${id}-read`;
      const toolEvents: { delay: number; chunk: UIMessageChunk }[] = [
        {
          delay: 350,
          chunk: {
            type: "tool-input-start",
            toolCallId: searchId,
            toolName: "search_product_notes",
            title: "Search product notes",
          },
        },
        {
          delay: 450,
          chunk: {
            type: "tool-input-available",
            toolCallId: searchId,
            toolName: "search_product_notes",
            title: "Search product notes",
            input: { query: "launch positioning" },
          },
        },
        {
          delay: 900,
          chunk: {
            type: "tool-output-available",
            toolCallId: searchId,
            output: { files: ["launch-brief.md", "product-notes.md"] },
          },
        },
        {
          delay: 200,
          chunk: {
            type: "tool-input-start",
            toolCallId: readId,
            toolName: "read_launch_brief",
            title: "Read launch brief",
          },
        },
        {
          delay: 450,
          chunk: {
            type: "tool-input-available",
            toolCallId: readId,
            toolName: "read_launch_brief",
            title: "Read launch brief",
            input: { file: "launch-brief.md" },
          },
        },
        {
          delay: 900,
          chunk: failure
            ? {
                type: "tool-output-error",
                toolCallId: readId,
                errorText: "Sample failure: the launch brief could not be read.",
              }
            : {
                type: "tool-output-available",
                toolCallId: readId,
                output: {
                  tone: "Clear, confident, warm",
                  constraint: "Verify product claims before publishing.",
                },
              },
        },
      ];
      const words =
        (failure
          ? "I found the product notes, but couldn’t read the launch brief. Please check the file and try again. This is a local failure demo."
          : "A little more you. A little more wow.\n\nTwo ways to find your next favourite thing, one simple place to start.\n\nThat keeps the line playful without making product claims we haven’t verified."
        ).match(/\S+\s*/g) ?? [];
      let timer: ReturnType<typeof setTimeout> | undefined;
      let cleanup = () => {};
      return new ReadableStream<UIMessageChunk>({
        start(controller) {
          let index = 0;
          let closed = false;
          const finish = () => {
            if (closed) return;
            closed = true;
            clearTimeout(timer);
            abortSignal?.removeEventListener("abort", abort);
            controller.close();
          };
          const abort = () => {
            if (closed) return;
            controller.enqueue({
              type: "message-metadata",
              messageMetadata: { endedAt: performance.now() },
            });
            controller.enqueue({ type: "abort" });
            finish();
          };
          cleanup = () => {
            if (closed) return;
            closed = true;
            clearTimeout(timer);
            abortSignal?.removeEventListener("abort", abort);
          };
          if (abortSignal?.aborted) {
            abort();
            return;
          }
          abortSignal?.addEventListener("abort", abort, { once: true });
          controller.enqueue({
            type: "start",
            messageId: id,
            messageMetadata: { startedAt: performance.now() },
          });
          const toolTimings: NonNullable<PreviewTraceMetadata["toolTimings"]> = {};
          controller.enqueue({ type: "text-start", id });
          const next = () => {
            if (closed) return;
            const word = words[index++];
            if (word !== undefined) {
              controller.enqueue({ type: "text-delta", id, delta: word });
              timer = setTimeout(next, 90);
            } else {
              controller.enqueue({ type: "text-end", id });
              controller.enqueue({
                type: "finish",
                finishReason: "stop",
                messageMetadata: { endedAt: performance.now() },
              });
              finish();
            }
          };
          let eventIndex = 0;
          const emitTool = () => {
            if (closed) return;
            const event = toolEvents[eventIndex++];
            if (!event) {
              next();
              return;
            }
            const chunk = event.chunk;
            if (chunk.type === "tool-input-start")
              toolTimings[chunk.toolCallId] = { start: performance.now() };
            if (chunk.type === "tool-output-available" || chunk.type === "tool-output-error") {
              const previous = toolTimings[chunk.toolCallId];
              if (previous) toolTimings[chunk.toolCallId] = { ...previous, end: performance.now() };
            }
            controller.enqueue(chunk);
            controller.enqueue({
              type: "message-metadata",
              messageMetadata: { toolTimings: { ...toolTimings } },
            });
            const upcoming = toolEvents[eventIndex];
            timer = setTimeout(emitTool, upcoming?.delay ?? 250);
          };
          timer = setTimeout(emitTool, toolEvents[0]!.delay);
        },
        cancel() {
          cleanup();
        },
      });
    },
  };
}
