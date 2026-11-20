import * as Schema from "effect/Schema";
export const MemoryEntry = Schema.Struct({
  id: Schema.String,
  text: Schema.String,
  origin: Schema.Literals(["automatic", "manual"]),
  updatedAt: Schema.String,
  createdAt: Schema.String,
});
export type MemoryEntry = typeof MemoryEntry.Type;
export const readMemories = Schema.decodeUnknownSync(Schema.Array(MemoryEntry));
export const SelectionPage = Schema.Struct({
  agentId: Schema.String,
  selections: Schema.Array(
    Schema.Struct({
      memoryId: Schema.String,
      inclusion: Schema.Literals(["essential", "searchable"]),
      userControlled: Schema.Boolean,
      revision: Schema.Number,
    }),
  ),
  usedBytes: Schema.Number,
  budgetBytes: Schema.Number,
  nextCursor: Schema.NullOr(Schema.String),
});
export const readSelectionPage = Schema.decodeUnknownSync(SelectionPage);
export type MemorySelection = typeof SelectionPage.Type;
export function splitMemory(text: string): { title: string; body: string } {
  const label = /^([^:.!?\n]{2,40}?):\s+(.+)$/s.exec(text);
  if (label?.[1] && label[2]) return { title: label[1], body: label[2] };
  const sentence = /^([^\n]{8,100}?[.!?])\s+(.+)$/s.exec(text);
  if (sentence?.[1] && sentence[2]) return { title: sentence[1], body: sentence[2] };
  return { title: text, body: "" };
}
export function memoryMatches(memories: readonly MemoryEntry[], query: string) {
  const words = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return words.length
    ? memories.filter((memory) =>
        words.every((word) => memory.text.toLocaleLowerCase().includes(word)),
      )
    : memories;
}
