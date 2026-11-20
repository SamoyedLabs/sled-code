// Adapted from OpenBot iOS 1.4.11's diagram renderer.
import { CHAT_MERMAID_FONT_FAMILY, mermaidImageUrl, sizedMermaidSvg } from "./chat-preview";
import type { MermaidJob, MermaidResult } from "./mermaid-diagrams";

declare const mermaid: typeof import("mermaid").default;
const RASTER_WIDTH = 1080;
const RASTER_MAX_SCALE = 3;
const RASTER_MAX_PIXELS = 4_000_000;
declare global {
  interface Window {
    ReactNativeWebView: { postMessage(message: string): void };
    sledMermaidDraw(job: MermaidJob): void;
  }
}

let queue: Promise<void> = Promise.resolve();
window.sledMermaidDraw = (job) => {
  queue = queue.then(async () => {
    const result = await draw(job);
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- A native WKWebView channel accepts a single JSON argument.
    window.ReactNativeWebView.postMessage(JSON.stringify(result));
  });
};

async function draw(job: MermaidJob): Promise<MermaidResult> {
  try {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      maxTextSize: 50_000,
      maxEdges: 500,
      theme: job.dark ? "dark" : "default",
      fontFamily: CHAT_MERMAID_FONT_FAMILY,
      htmlLabels: false,
      suppressErrorRendering: true,
    });
    const { svg } = await mermaid.render(`openbot-mermaid-${job.id}`, job.source);
    const sized = sizedMermaidSvg(svg);
    const width = Number(/<svg\b[^>]*\bwidth="([\d.]+)"/u.exec(sized)?.[1] ?? 0);
    const height = Number(/<svg\b[^>]*\bheight="([\d.]+)"/u.exec(sized)?.[1] ?? 0);
    const svgUrl = mermaidImageUrl(svg);
    return { id: job.id, svgUrl, pngUrl: await raster(svgUrl, width, height), width, height };
  } catch {
    return { id: job.id, svgUrl: null, pngUrl: null, width: 0, height: 0 };
  }
}

async function raster(url: string, width: number, height: number): Promise<string | null> {
  if (!width || !height) return null;
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    let scale = Math.min(RASTER_MAX_SCALE, RASTER_WIDTH / width);
    if (width * height * scale * scale > RASTER_MAX_PIXELS)
      scale = Math.sqrt(RASTER_MAX_PIXELS / (width * height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
  } catch {
    // A browser can refuse to read back an SVG drawing; the card then shows the code instead.
    return null;
  }
}
