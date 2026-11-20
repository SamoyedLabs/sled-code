import { topLevelMarkdownCodeBlocks } from "../../lib/markdownDocument";
import {
  chatPreviewKind,
  type ChatPreviewKind,
} from "./upstream/openbot-mobile/chat-preview/chat-preview";

export type BotPreview = { type: "preview"; kind: ChatPreviewKind; body: string; start: number };
type ReplyPart = BotPreview | { type: "markdown"; body: string; start: number };
const MAX_PREVIEW_SOURCE = 50_000;

export function botReplyParts(body: string, canPreview: boolean): readonly ReplyPart[] {
  if (!canPreview || (!body.includes("```") && !body.includes("~~~")))
    return [{ type: "markdown", body, start: 0 }];
  const result: ReplyPart[] = [];
  let offset = 0;
  for (const node of topLevelMarkdownCodeBlocks(body)) {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    const kind = chatPreviewKind(node.lang ?? undefined);
    if (!kind || start === undefined || end === undefined || node.value.length > MAX_PREVIEW_SOURCE)
      continue;
    const raw = body.slice(start, end);
    if (!raw.startsWith("```") && !raw.startsWith("~~~")) continue;
    const prose = body.slice(offset, start).trim();
    if (prose !== "") result.push({ type: "markdown", body: prose, start: offset });
    result.push({ type: "preview", kind, body: node.value, start });
    offset = end;
  }
  const tail = body.slice(offset);
  if (tail.trim() !== "" || !result.length)
    result.push({ type: "markdown", body: offset === 0 ? tail : tail.trim(), start: offset });
  return result;
}
