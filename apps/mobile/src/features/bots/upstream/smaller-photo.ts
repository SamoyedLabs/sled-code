import { File } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";

// OpenBot iOS 1.4.11 smaller-photo.ts. The preference lives in Sled's local chat settings.
const photoLongEdge = 2048;
const photoQuality = 0.8;
const smallPhotoBytes = 1024 * 1024;

export async function smallerBotPhoto(uri: string, name: string) {
  const original = { uri, name };
  if (!/\.(jpe?g|heic|heif)$/iu.test(name)) return original;
  const natives = new Set<{ release(): void }>();
  try {
    const file = new File(uri);
    const size = file.exists ? file.size : null;
    if (size !== null && size <= smallPhotoBytes) return original;
    const decode = ImageManipulator.manipulate(uri);
    natives.add(decode);
    const source = await decode.renderAsync();
    natives.add(source);
    let image = source;
    if (Math.max(source.width, source.height) > photoLongEdge) {
      const base = ImageManipulator.manipulate(source);
      natives.add(base);
      const context = base.resize(
        source.width >= source.height ? { width: photoLongEdge } : { height: photoLongEdge },
      );
      natives.add(context);
      image = await context.renderAsync();
      natives.add(image);
    }
    const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: photoQuality });
    const copy = new File(saved.uri);
    if (size !== null && copy.size >= size) {
      copy.delete();
      return original;
    }
    return { uri: saved.uri, name: `${name.replace(/\.(jpe?g|heic|heif)$/iu, "")}.jpg` };
  } catch {
    return original;
  } finally {
    for (const native of natives) native.release();
  }
}
