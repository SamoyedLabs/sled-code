import { OPENBOT_MAX_FILE_BYTES } from "@t3tools/contracts";
import * as Crypto from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";
import { chooseBotFile, type BotFilePicker } from "../settings/useBotFileUpload";
import { decodeBotOutboxFile, type BotOutboxFile } from "./botOutboxStore";

type PickedFile = { id: string; uri: string; name: string; mimeType: string; size: number };
export type BotOutboxFilePick = PickedFile;

async function directory(scope: string) {
  const binding = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, scope);
  return new Directory(Paths.document, "BotOutbox", binding);
}

export async function chooseBotOutboxFile(source: BotFilePicker) {
  const picked = await chooseBotFile(source);
  if (!picked) return null;
  const file = new File(picked.uri);
  const size = file.size;
  if (!file.exists || size === null || size <= 0 || size > OPENBOT_MAX_FILE_BYTES)
    throw new Error("Choose a nonempty file up to 100 MiB.");
  return {
    id: Crypto.randomUUID(),
    uri: picked.uri,
    name: picked.name ?? "attachment",
    mimeType: picked.mimeType ?? "application/octet-stream",
    size,
  } satisfies PickedFile;
}

export async function openBotOutboxFile(scope: string, stored: BotOutboxFile) {
  const file = new File(await directory(scope), stored.id);
  if (!file.exists || file.size !== stored.size || (await file.digest("SHA-256")) !== stored.sha256)
    throw new Error("A saved attachment is unavailable or changed.");
  return file;
}

export async function saveBotOutboxFiles(scope: string, selected: readonly PickedFile[]) {
  if (!selected.length) return [];
  const target = await directory(scope);
  target.create({ intermediates: true, idempotent: true });
  const copies: File[] = [];
  try {
    const stored: BotOutboxFile[] = [];
    for (const picked of selected) {
      const copy = new File(target, picked.id);
      if (copy.exists) throw new Error("An attachment with this identifier already exists.");
      copies.push(copy);
      await new File(picked.uri).copy(copy);
      const decoded = decodeBotOutboxFile({
        ...picked,
        size: copy.size,
        sha256: await copy.digest("SHA-256"),
      });
      if (decoded._tag !== "Some" || decoded.value.size !== picked.size)
        throw new Error("The picked attachment changed. Select it again.");
      stored.push(decoded.value);
    }
    return stored;
  } catch (error) {
    for (const copy of copies) if (copy.exists) copy.delete();
    throw error;
  }
}

export async function releaseBotOutboxFiles(scope: string, files: readonly BotOutboxFile[]) {
  const dir = await directory(scope);
  for (const source of files) {
    const file = new File(dir, source.id);
    if (file.exists) file.delete();
  }
}
