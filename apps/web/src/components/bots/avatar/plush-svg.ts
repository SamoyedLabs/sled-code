import type { BotFrame } from "./vendor/bloub-engine";
import {
  ballBox,
  CLOSED_EYE_BEND,
  CLOSED_EYE_COLOR,
  CLOSED_EYE_STROKE,
  decorLevel,
  eyeSample,
  plushEye,
  sleepZs,
  thinkingDots,
  tintRamp,
  NOTIFY_COLOR,
  type DecorTrack,
  type PlushBall,
  type PlushEye,
} from "./vendor/plush-felt";
import type { AvatarProfile } from "./avatar-profile";
import { COLOR_BY_ID } from "./vendor/bloub-engine";

const assets = import.meta.glob<string>("./assets/*.{png,webp}", {
  eager: true,
  query: "?url",
  import: "default",
});
const ns = "http://www.w3.org/2000/svg";
function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  parent: SVGElement,
  attrs: Record<string, string | number> = {},
) {
  const element = document.createElementNS(ns, tag);
  set(element, attrs);
  parent.append(element);
  return element;
}
function set(element: SVGElement, attrs: Record<string, string | number>) {
  for (const [key, value] of Object.entries(attrs)) {
    const text = String(value);
    if (element.getAttribute(key) !== text) element.setAttribute(key, text);
  }
}
function matrix(values: readonly number[] | null) {
  return values ? `matrix(${values.join(" ")})` : "";
}
function makeEye(parent: SVGElement, defs: SVGElement, id: string) {
  const root = svg("g", parent);
  const mask = svg("mask", defs, {
    id,
    maskUnits: "userSpaceOnUse",
    x: -200,
    y: -200,
    width: 400,
    height: 400,
  });
  const lidScale = svg("g", mask);
  const lidOuter = svg("g", lidScale);
  const lidInner = svg("g", lidOuter);
  const bands = Array.from({ length: 4 }, () => svg("rect", lidInner, { fill: "white" }));
  const masked = svg("g", root);
  const outer = svg("g", masked);
  const inner = svg("g", outer);
  inner.style.isolation = "isolate";
  const closed = svg("path", root, {
    fill: "none",
    stroke: CLOSED_EYE_COLOR,
    "stroke-linecap": "round",
  });
  const pieces: { viewport: SVGSVGElement; image: SVGImageElement }[] = [];
  return (eye: PlushEye) => {
    set(outer, { transform: matrix(eye.matrix), opacity: eye.alpha * eye.pad });
    set(inner, { transform: matrix(eye.inner) });
    set(masked, { mask: eye.lid ? `url(#${id})` : "" });
    if (eye.lid) {
      const { cx, cy, s } = eye.lid;
      set(lidScale, { transform: `translate(${cx} ${cy}) scale(1 ${s}) translate(${-cx} ${-cy})` });
      set(lidOuter, { transform: matrix(eye.matrix) });
      set(lidInner, { transform: matrix(eye.inner) });
      for (const [i, band] of eye.lid.bands.entries()) {
        set(bands[i]!, {
          x: -band.w,
          y: -band.h,
          width: 2 * band.w,
          height: 2 * band.h,
          rx: band.r,
          "fill-opacity": band.alpha,
        });
      }
    }
    for (const [i, p] of eye.pieces.entries()) {
      let part = pieces[i];
      if (!part) {
        const viewport = svg("svg", inner, { overflow: "hidden", preserveAspectRatio: "none" });
        viewport.style.mixBlendMode = "plus-lighter";
        part = {
          viewport,
          image: svg("image", viewport, { width: 1, height: 1, preserveAspectRatio: "none" }),
        };
        pieces.push(part);
      }
      set(part.viewport, {
        x: p.x,
        y: p.y,
        width: p.w,
        height: p.h,
        viewBox: `${p.sx} ${p.sy} ${p.sw} ${p.sh}`,
        display: "inline",
      });
      set(part.image, { href: assets[`./assets/fred-oeil0-${p.src === 0 ? "x" : "y"}.png`]! });
    }
    for (let i = eye.pieces.length; i < pieces.length; i++)
      set(pieces[i]!.viewport, { display: "none" });
    const w = eye.closed?.w ?? 0;
    set(closed, {
      transform: matrix(eye.matrix),
      d: `M${-w / 2},0Q0,${w * CLOSED_EYE_BEND} ${w / 2},0`,
      "stroke-width": w * CLOSED_EYE_STROKE,
      opacity: eye.alpha * (eye.closed?.opacity ?? 0),
    });
  };
}
function tint(defs: SVGElement, id: string, hex: string) {
  const filter = svg("filter", defs, {
    id,
    "color-interpolation-filters": "sRGB",
    x: 0,
    y: 0,
    width: 1,
    height: 1,
  });
  svg("feColorMatrix", filter, {
    type: "matrix",
    values: "1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 0 0 0 1 0",
  });
  const transfer = svg("feComponentTransfer", filter);
  const channels = [svg("feFuncR", transfer), svg("feFuncG", transfer), svg("feFuncB", transfer)];
  const update = (color: string) => {
    const ramp = tintRamp(color);
    for (const [channel, element] of channels.entries()) {
      set(element, {
        type: "table",
        tableValues: Array.from(
          { length: 256 },
          (_, index) => ramp[index * 4 + channel]! / 255,
        ).join(" "),
      });
    }
  };
  update(hex);
  return update;
}
function setBall(element: SVGImageElement, ball: PlushBall | null) {
  set(
    element,
    ball
      ? { x: ball.x, y: ball.y, width: ball.size, height: ball.size, opacity: ball.opacity }
      : { opacity: 0 },
  );
}

export function createPlushSvg(element: SVGSVGElement, id: string, initial: AvatarProfile) {
  const defs = svg("defs", element);
  const root = svg("g", element, { transform: "scale(1.15)" });
  const moving = svg("g", root);
  const body = svg("image", moving, { x: -158, y: -158, width: 316, height: 316 });
  const eyes = [makeEye(moving, defs, `${id}-eye0`), makeEye(moving, defs, `${id}-eye1`)];
  const ink = () => COLOR_BY_ID.get(profile.color)?.hex ?? "#0a0a0c";
  let profile = initial;
  const updateTint = tint(defs, `${id}-dot`, ink());
  tint(defs, `${id}-notify`, NOTIFY_COLOR);
  const ball = (filter: string) =>
    svg("image", root, {
      href: assets["./assets/boule.webp"]!,
      filter: `url(#${id}-${filter})`,
      opacity: 0,
    });
  const dots = Array.from({ length: 3 }, () => ball("dot"));
  const zs = Array.from({ length: 3 }, () =>
    svg("path", root, {
      fill: "none",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      opacity: 0,
    }),
  );
  const notify = ball("notify");
  const appearance = (next: AvatarProfile) => {
    if (next.color !== profile.color) updateTint(COLOR_BY_ID.get(next.color)?.hex ?? "#0a0a0c");
    profile = next;
    set(body, { href: assets[`./assets/${next.shape}-${next.color}.png`]! });
  };
  appearance(initial);
  return {
    appearance,
    draw(frame: BotFrame, time: number, thinking: DecorTrack, asleep: DecorTrack, scale: number) {
      set(moving, { opacity: frame.bodyAlpha, transform: `scale(${scale})` });
      const closed = decorLevel(asleep, time);
      frame.eyes.forEach((eye, index) => eyes[index]?.(plushEye(eyeSample(eye), closed)));
      const dotFrames = thinkingDots(thinking, time);
      dots.forEach((dot, index) => setBall(dot, dotFrames[index] ?? null));
      const zFrames = sleepZs(asleep, time);
      zs.forEach((path, index) => {
        const z = zFrames[index];
        set(
          path,
          z
            ? {
                d: `M${z.x - z.half},${z.y - z.half}H${z.x + z.half}L${z.x - z.half},${z.y + z.half}H${z.x + z.half}`,
                stroke: ink(),
                "stroke-width": z.width,
                opacity: z.opacity,
              }
            : { opacity: 0 },
        );
      });
      setBall(
        notify,
        frame.notif ? ballBox(frame.notif.x, frame.notif.y, frame.notif.r, 1, 1) : null,
      );
    },
    dispose() {
      element.replaceChildren();
    },
  };
}
