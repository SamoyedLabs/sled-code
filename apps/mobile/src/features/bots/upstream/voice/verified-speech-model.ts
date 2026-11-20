import { Directory, File } from "expo-file-system";
import type { SpeechModelFile } from "./speech-models";

export function hasVerifiedSpeechModel(directory: Directory, files: readonly SpeechModelFile[]) {
  return (
    new File(directory, ".verified").exists &&
    files.every((item) => new File(directory, item.name).size === item.bytes)
  );
}

export async function verifySpeechFiles(
  directory: Directory,
  files: readonly SpeechModelFile[],
  signal: AbortSignal,
  reportProgress: (progress: number) => void,
) {
  directory.create({ intermediates: true, idempotent: true });
  const marker = new File(directory, ".verified");
  if (hasVerifiedSpeechModel(directory, files)) return;
  if (marker.exists) marker.delete();
  const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0);
  let verifiedBytes = 0;
  for (const item of files) {
    if (signal.aborted) return;
    const file = new File(directory, item.name);
    if (file.exists && file.size === item.bytes && (await file.digest("SHA-256")) === item.sha256) {
      verifiedBytes += item.bytes;
      reportProgress(verifiedBytes / totalBytes);
      continue;
    }
    const partial = new File(directory, item.name + ".download");
    if (partial.exists) partial.delete();
    const completedBytes = verifiedBytes;
    await File.downloadFileAsync(item.url, partial, {
      signal,
      idempotent: true,
      onProgress: ({ bytesWritten }) =>
        reportProgress((completedBytes + Math.min(item.bytes, bytesWritten)) / totalBytes),
    });
    if (signal.aborted) return;
    if (partial.size !== item.bytes || (await partial.digest("SHA-256")) !== item.sha256)
      throw new Error("A downloaded speech file did not match the verified version.");
    if (signal.aborted) return;
    if (file.exists) file.delete();
    await partial.move(file);
    verifiedBytes += item.bytes;
    reportProgress(verifiedBytes / totalBytes);
  }
  if (!signal.aborted) marker.create();
}
