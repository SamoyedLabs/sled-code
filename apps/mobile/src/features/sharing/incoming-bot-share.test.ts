import { expect, it, vi } from "vite-plus/test";
import { incomingBotShareFile } from "./incoming-bot-share";
const files = vi.hoisted(() => ({ reads: [] as string[] }));
vi.mock("expo-file-system", () => ({
  Paths: {
    document: {
      uri: "file:///var/mobile/Containers/Data/Application/22222222-2222-4222-8222-222222222222/Documents",
    },
    cache: { uri: "file:///cache" },
  },
  File: class {
    exists = true;
    size = 3;
    constructor(readonly uri: string) {
      files.reads.push(uri);
    }
    async bytes() {
      return new Uint8Array([1, 2, 3]);
    }
  },
}));
it("reads the exact retained composer copy after container relocation without changing the share", async () => {
  files.reads.length = 0;
  const name = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa-proof.txt";
  const oldUri = `file:///var/mobile/Containers/Data/Application/11111111-1111-4111-8111-111111111111/Documents/t3-composer-attachments/${name}`;
  const share = {
    schemaVersion: 1 as const,
    id: "share",
    createdAt: "2026-11-04",
    text: "",
    warnings: [],
    attachments: [
      {
        id: "source",
        type: "file" as const,
        name: "proof.txt",
        mimeType: "text/plain",
        sizeBytes: 3,
        fileUri: oldUri,
      },
    ],
  };
  const original = structuredClone(share);
  expect((await incomingBotShareFile(share, "source")).bytes).toEqual(new Uint8Array([1, 2, 3]));
  expect(files.reads).toEqual([
    `file:///var/mobile/Containers/Data/Application/22222222-2222-4222-8222-222222222222/Documents/t3-composer-attachments/${name}`,
  ]);
  expect(share).toEqual(original);
  await expect(
    incomingBotShareFile(
      {
        ...share,
        attachments: [
          {
            ...share.attachments[0]!,
            fileUri: "file:///other-app/Documents/t3-composer-attachments/" + name,
          },
        ],
      },
      "source",
    ),
  ).rejects.toThrow("app-owned");
  expect(files.reads).toHaveLength(1);
});
