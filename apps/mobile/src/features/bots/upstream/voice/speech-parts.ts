import { speechTextFromMarkdown } from "./speech-text";

const PART_LENGTH = 160;
const SENTENCE = /[^.!?…。！？]+(?:[.!?…。！？]+|$)/gu;

export function liveSpeechParts(markdown: string, maximumLength: number): string[] {
  const text = speechTextFromMarkdown(markdown);
  const parts: string[] = [];
  let current = "";
  for (const sentence of text.match(SENTENCE) ?? []) {
    const piece = sentence.trim();
    if (!piece) continue;
    current = current ? `${current} ${piece}` : piece;
    if (parts.length === 0 || current.length >= PART_LENGTH) {
      parts.push(current);
      current = "";
    }
  }
  if (current) parts.push(current);
  return parts.flatMap((part) => splitAt(part, maximumLength));
}

function splitAt(text: string, limit: number): string[] {
  const pieces: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    const space = rest.lastIndexOf(" ", limit);
    const cut = space > limit / 2 ? space : limit;
    pieces.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) pieces.push(rest);
  return pieces;
}
