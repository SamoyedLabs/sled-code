export function compilerShardFiles(files: readonly string[], shard?: string): readonly string[] {
  if (shard === undefined) return files;
  const match = /^(\d+)\/(\d+)$/.exec(shard);
  const index = Number(match?.[1]);
  const count = Number(match?.[2]);
  if (!Number.isSafeInteger(index) || !Number.isSafeInteger(count) || index < 1 || index > count) {
    throw new Error("Compiler shard must be index/count with 1 <= index <= count");
  }
  const selected = [...files].sort().filter((_, position) => position % count === index - 1);
  if (selected.length === 0) throw new Error("Compiler shard selected no source files");
  return selected;
}
