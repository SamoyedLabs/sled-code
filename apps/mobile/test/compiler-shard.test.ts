import { describe, expect, it } from "vite-plus/test";
import { compilerShardFiles } from "./compiler-shard";

describe("compiler source partitioning", () => {
  const files = ["src/z.tsx", "src/a.ts", "src/new.tsx", "src/b.ts", "src/c.tsx"];
  it("covers every source exactly once, independent of discovery order", () => {
    const partitions = ["1/2", "2/2"].map((shard) => compilerShardFiles(files, shard));
    expect(partitions.flat().sort()).toEqual([...files].sort());
    expect(new Set(partitions.flat()).size).toBe(files.length);
    expect(compilerShardFiles([...files].reverse(), "1/2")).toEqual(partitions[0]);
    expect(compilerShardFiles(files)).toBe(files);
  });
  it.each(["", "0/2", "3/2", "1/0", "1", "1/2/3", "1.5/2", "1/9007199254740992"])(
    "rejects invalid partition %s",
    (shard) => expect(() => compilerShardFiles(files, shard)).toThrow("Compiler shard must"),
  );
  it("fails if a configured partition would cover no source files", () => {
    expect(() => compilerShardFiles(["src/only.tsx"], "2/2")).toThrow("no source files");
  });
});
