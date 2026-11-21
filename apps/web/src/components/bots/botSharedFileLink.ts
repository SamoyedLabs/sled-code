export function botSharedFilePath(href: string): string | null {
  let path: string;
  try {
    path = decodeURIComponent(href);
  } catch {
    return null;
  }
  if (
    /^[a-z][a-z\d+.-]*:/i.test(path) ||
    path.startsWith("//") ||
    /[\u0000-\u001f\u007f]/.test(path) ||
    path.split("/").includes("..")
  )
    return null;
  return path.startsWith("~/OpenBot/Shared/") ||
    path.startsWith("OpenBot/Shared/") ||
    path.startsWith("Shared/") ||
    (path.startsWith("/") && path.includes("/OpenBot/Shared/"))
    ? path
    : null;
}
