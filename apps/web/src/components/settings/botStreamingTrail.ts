import type { Parent, Root, RootContent } from "mdast";
import type { Plugin } from "unified";

export type BotStreamingChunk = { length: number; revealedAt: number };

/** OpenBot streamingReveal.splitStreamingTrail, preserving complete words across source markup. */
export function splitBotStreamingTrail(
  text: string,
  trail: readonly BotStreamingChunk[],
  after = 0,
) {
  const chunks: { text: string; revealedAt: number }[] = [];
  let end = text.length;
  let skip = after;
  for (let index = trail.length - 1; index >= 0 && end > 0; index -= 1) {
    const step = trail[index];
    if (!step) continue;
    if (skip >= step.length) {
      skip -= step.length;
      continue;
    }
    let start = Math.max(0, end - step.length + skip);
    skip = 0;
    while (start < end && /\S/u.test(text.charAt(start - 1)) && /\S/u.test(text.charAt(start)))
      start += 1;
    if (start >= end) continue;
    chunks.unshift({ text: text.slice(start, end), revealedAt: step.revealedAt });
    end = start;
  }
  return { prefix: text.slice(0, end), chunks };
}

/** React-owned spans through the existing Markdown AST extension point; never mutate rendered DOM. */
export function botStreamingTrailPlugin(
  body: string,
  trail: readonly BotStreamingChunk[],
  now: number,
  fadeMs = 300,
): Plugin<[], Root> {
  return () => (tree) => {
    const visit = (parent: Parent) => {
      const children: RootContent[] = [];
      for (const node of parent.children) {
        if ("children" in node) visit(node);
        const offset = node.position?.end.offset;
        if (node.type !== "text" || offset === undefined) {
          children.push(node);
          continue;
        }
        const split = splitBotStreamingTrail(node.value, trail, Math.max(0, body.length - offset));
        if (split.prefix) children.push({ type: "text", value: split.prefix });
        for (const chunk of split.chunks) {
          const elapsed = Math.max(0, now - chunk.revealedAt);
          if (elapsed >= fadeMs) {
            children.push({ type: "text", value: chunk.text });
            continue;
          }
          children.push({
            type: "emphasis",
            children: [{ type: "text", value: chunk.text }],
            data: {
              hName: "span",
              hProperties: {
                className: ["ob-chat-stream-word"],
                style: `animation-delay: -${elapsed}ms`,
              },
            },
          });
        }
      }
      parent.children = children;
    };
    visit(tree);
  };
}
