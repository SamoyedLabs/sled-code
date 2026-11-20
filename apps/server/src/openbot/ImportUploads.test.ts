// @effect-diagnostics nodeBuiltinImport:off -- owned archive files exercise durable upload identity.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { expect, it } from "@effect/vitest";
import { ImportUploadStore } from "./ImportUploads.ts";
const chunks = async function* (text: string) {
  yield Buffer.from(text);
};
it("keeps a completed archive receipt across restart and refuses other principals, hosts and changed retry bytes", async () => {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "owned-import-upload-"));
  try {
    const store = new ImportUploadStore(root, "owned-test-key");
    const upload = await store.issue(
      { principal: "a", hostId: "h", name: "fixture.zip", size: 3 },
      1000,
    );
    await store.store(upload.token, chunks("zip"), 1001);
    const restarted = new ImportUploadStore(root, "owned-test-key");
    expect((await restarted.read("a", "h", upload.uploadId, 1002)).bytes.toString()).toBe("zip");
    await expect(restarted.read("b", "h", upload.uploadId, 1002)).rejects.toThrow();
    await expect(restarted.read("a", "other", upload.uploadId, 1002)).rejects.toThrow();
    await expect(restarted.store(upload.token, chunks("bad"), 1002)).rejects.toThrow();
    expect((await restarted.read("a", "h", upload.uploadId, 1003)).bytes.toString()).toBe("zip");
    await expect(
      restarted.issue({ principal: "a", hostId: "h", name: "large.zip", size: 104857601 }, 1000),
    ).rejects.toThrow();
    await expect(restarted.read("a", "h", "../fixture", 1003)).rejects.toThrow();
    const afterThreeDays = 1000 + 3 * 24 * 60 * 60 * 1000;
    await restarted.issue(
      { principal: "a", hostId: "h", name: "next.zip", size: 3 },
      afterThreeDays,
    );
    expect(
      (await NodeFSP.readdir(root)).filter((name) => name.startsWith(upload.uploadId)),
    ).toEqual([]);
    await expect(restarted.store(upload.token, chunks("zip"), afterThreeDays)).rejects.toThrow();
  } finally {
    await NodeFSP.rm(root, { recursive: true, force: true });
  }
});
it("releases only an owned completed allocation, frees quota, and fences its signed URL after restart", async () => {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "released-import-upload-"));
  try {
    const store = new ImportUploadStore(root, "owned-test-key");
    const input = { principal: "s", hostId: "h", name: "owned.zip", size: 3 };
    const first = await store.issue(input, 1000);
    await store.store(first.token, chunks("zip"), 1001);
    for (let index = 0; index < 3; index++) await store.issue(input, 1001);
    await expect(store.issue(input, 1002)).rejects.toThrow();
    await expect(store.release("other", "h", first.uploadId, 1002)).rejects.toThrow();
    await expect(store.release("s", "other", first.uploadId, 1002)).rejects.toThrow();
    expect((await store.read("s", "h", first.uploadId, 1002)).bytes.toString()).toBe("zip");
    await store.release("s", "h", first.uploadId, 1002);
    const reopened = new ImportUploadStore(root, "owned-test-key");
    await reopened.release("s", "h", first.uploadId, 1003);
    await expect(reopened.read("s", "h", first.uploadId, 1003)).rejects.toThrow();
    // A crash after the durable release marker but before token deletion must never reopen PUT.
    await NodeFSP.writeFile(NodePath.join(root, first.uploadId + ".token"), first.token);
    await expect(reopened.store(first.token, chunks("zip"), 1003)).rejects.toThrow();
    for (let index = 0; index < 6; index++) {
      const next = await reopened.issue(input, 1003);
      await reopened.store(next.token, chunks("zip"), 1003);
      await reopened.release("s", "h", next.uploadId, 1003);
    }
    expect((await NodeFSP.readdir(root)).some((name) => name.endsWith(".zip"))).toBe(false);
  } finally {
    await NodeFSP.rm(root, { recursive: true, force: true });
  }
});
