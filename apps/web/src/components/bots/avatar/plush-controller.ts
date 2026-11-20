import { avatarHash, botAvatarProfile, type AvatarProfile } from "./avatar-profile";
import type { AvatarMood } from "./avatar-types";
import {
  BotEngine,
  EXPRESSIONS,
  POSES,
  SHAPE_BY_ID,
  type ExpressionId,
  type Look,
} from "./vendor/bloub-engine";
import {
  engineState,
  enterLook,
  lookOf,
  morphOf,
  NO_DECOR,
  plushFace,
  plushMood,
  SHAKE,
  SHOWN_DECOR,
  toggleDecor,
  type PlushState,
} from "./vendor/plush-felt";
import { createPlushSvg } from "./plush-svg";
import { plushPop, POP_DURATION } from "./plush-transition";

export interface AvatarOptions {
  seed: string;
  hue: number | null;
  mood: AvatarMood;
  workingFaces: boolean;
}
const FPS = 30;
const STEP = 1 / 60;
const HOVER_GROUP =
  "[data-avatar-hover], button, a, [role='button'], [role='link'], [role='menuitem']";
interface HoverFace {
  state: PlushState;
  expression: ExpressionId | null;
}
const WINK: HoverFace = { state: "wink", expression: null };
const HOVER_FACES: readonly HoverFace[] = [
  WINK,
  { state: "idle", expression: "surpris" },
  { state: "idle", expression: "excite" },
  { state: "idle", expression: "attentif" },
  { state: "idle", expression: "curieux" },
];
function workingFace(previous: ExpressionId | null): ExpressionId {
  const choices = EXPRESSIONS.filter((face) => face.id !== previous);
  return choices[Math.floor(Math.random() * choices.length)]?.id ?? "attentif";
}

export function createPlushController(element: SVGSVGElement, id: string, initial: AvatarOptions) {
  let options = initial;
  let profile = botAvatarProfile(options.seed, options.hue);
  let shown = profile;
  let pendingBody: AvatarProfile | null = null;
  let bodyStarted = Number.NEGATIVE_INFINITY;
  let bodySwitched = true;
  let queuedBody: AvatarProfile | null = null;
  let interacting = false;
  let hover: HoverFace | null = null;
  let cycleFace = workingFace(null);
  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  let reduced = media.matches;
  let visible = typeof IntersectionObserver === "undefined";
  let pageVisible = document.visibilityState !== "hidden";
  let raf = 0;
  let faceTimer = 0;
  let lastTick: number | null = null;
  let lastFrame = Number.NEGATIVE_INFINITY;
  let time = (avatarHash(options.seed) / 0x100000000) * 1.4;
  let holdUntil = time;
  let disposed = false;
  let settling = false;
  const appearance = () => {
    const mood = plushMood(options.mood);
    const face = options.mood === "idle" && interacting && !reduced ? hover : null;
    return {
      state:
        face?.state ?? (options.workingFaces && options.mood === "working" ? "idle" : mood.state),
      expression:
        options.workingFaces && options.mood === "working"
          ? reduced
            ? ("attentif" as const)
            : cycleFace
          : (mood.expression ?? face?.expression ?? profile.expression),
    };
  };
  let current = appearance();
  let gaze = lookOf(current.state);
  let gazeFrom: Look = gaze;
  let gazeAt = time;
  const makeEngine = () => {
    const next = new BotEngine(
      100,
      engineState(current.state),
      SHAPE_BY_ID.get(shown.shape)?.radii ?? null,
      plushFace(current.state, current.expression),
    );
    next.setLook(lookOf(current.state), time - STEP, STEP);
    return next;
  };
  let engine = makeEngine();
  let dots = current.state === "thinking" ? SHOWN_DECOR : NO_DECOR;
  let zs = current.state === "asleep" ? SHOWN_DECOR : NO_DECOR;
  const view = createPlushSvg(element, id, shown);
  const busy = () => options.mood === "working" || options.mood === "connecting";
  const allowed = () => !disposed && !reduced && visible && pageVisible;
  const cycling = () => options.workingFaces && options.mood === "working";
  function cancelFrame() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    lastTick = null;
  }
  function syncFaceTimer() {
    if (!allowed() || !cycling()) {
      window.clearTimeout(faceTimer);
      faceTimer = 0;
    } else if (!faceTimer) {
      faceTimer = window.setTimeout(
        () => {
          faceTimer = 0;
          cycleFace = workingFace(cycleFace);
          syncAppearance();
          syncFaceTimer();
        },
        700 + Math.random() * 2500,
      );
    }
  }
  function start() {
    syncFaceTimer();
    if (!allowed()) return cancelFrame();
    if (!raf && (busy() || interacting || settling)) {
      lastTick = null;
      raf = requestAnimationFrame(tick);
    }
  }
  function beginBody(next: AvatarProfile) {
    if (pendingBody) {
      queuedBody = next;
      return;
    }
    if (shown.shape === next.shape && shown.color === next.color) return;
    pendingBody = next;
    settling = true;
    bodyStarted = time;
    bodySwitched = false;
    holdUntil = Math.max(holdUntil, time + POP_DURATION);
  }
  function draw() {
    let scale = 1;
    if (pendingBody) {
      const pop = plushPop(time - bodyStarted);
      scale = pop.scale;
      if (pop.switched && !bodySwitched) {
        shown = pendingBody;
        view.appearance(shown);
        engine.setShape(SHAPE_BY_ID.get(shown.shape)?.radii ?? null, time);
        bodySwitched = true;
      }
      if (pop.finished) {
        pendingBody = null;
        if (queuedBody) {
          const next = queuedBody;
          queuedBody = null;
          beginBody(next);
        }
      }
    }
    view.draw(engine.sample(time), time, dots, zs, scale);
  }
  function tick(timestamp: number) {
    raf = 0;
    if (!allowed()) return;
    const delta = lastTick === null ? 0 : Math.min((timestamp - lastTick) / 1000, 0.064);
    lastTick = timestamp;
    time += delta;
    if (time - lastFrame >= 1 / FPS) {
      lastFrame = time;
      gaze = enterLook(gazeFrom, current.state, time - gazeAt);
      engine.setLook(gaze, time, STEP);
      draw();
    }
    settling = time < holdUntil || !engine.quiet(time);
    if (busy() || interacting || settling) {
      raf = requestAnimationFrame(tick);
    } else lastTick = null;
  }
  function frozen() {
    cancelFrame();
    shown = profile;
    pendingBody = queuedBody = null;
    bodySwitched = true;
    time = POSES[engineState(current.state)];
    engine = makeEngine();
    gaze = gazeFrom = lookOf(current.state);
    gazeAt = time;
    dots = current.state === "thinking" ? SHOWN_DECOR : NO_DECOR;
    zs = current.state === "asleep" ? SHOWN_DECOR : NO_DECOR;
    holdUntil = time;
    settling = false;
    view.appearance(shown);
    draw();
  }
  function syncAppearance() {
    const next = appearance();
    const stateChanged = next.state !== current.state;
    const faceChanged = next.expression !== current.expression;
    current = next;
    if (reduced) {
      frozen();
      syncFaceTimer();
      return;
    }
    if (stateChanged) {
      gazeFrom = gaze;
      gazeAt = time;
      engine.setState(engineState(current.state), time);
      dots = toggleDecor(dots, current.state === "thinking", time, current.state);
      zs = toggleDecor(zs, current.state === "asleep", time, current.state);
      holdUntil = Math.max(
        holdUntil,
        time +
          Math.max(
            morphOf(current.state),
            current.state === "failed" ? SHAKE : 0,
            0.3,
            BotEngine.SHAPE_MORPH,
          ),
      );
    }
    if (stateChanged || faceChanged) {
      settling = true;
      engine.setExpression(plushFace(current.state, current.expression), time);
      holdUntil = Math.max(holdUntil, time + BotEngine.SHAPE_MORPH);
    }
    start();
  }
  const group = element.closest(`${HOVER_GROUP}, [tabindex]`);
  const target = group?.matches(HOVER_GROUP) ? group : (element.parentElement ?? element);
  function enter() {
    if (!interacting) {
      const choices = HOVER_FACES.filter(
        (face) => face !== hover && face.expression !== profile.expression,
      );
      hover = choices[Math.floor(Math.random() * choices.length)] ?? WINK;
    }
    interacting = true;
    syncAppearance();
  }
  function leave() {
    interacting = false;
    syncAppearance();
  }
  function focus(event: Event) {
    if (event.target instanceof Element && event.target.matches(":focus-visible")) enter();
  }
  function blur(event: Event) {
    if (
      event instanceof FocusEvent &&
      (!(event.relatedTarget instanceof Node) || !target.contains(event.relatedTarget))
    )
      leave();
  }
  function visibility() {
    pageVisible = document.visibilityState !== "hidden";
    start();
  }
  function reduce() {
    reduced = media.matches;
    syncAppearance();
  }
  target.addEventListener("pointerenter", enter);
  target.addEventListener("pointerleave", leave);
  target.addEventListener("focusin", focus);
  target.addEventListener("focusout", blur);
  document.addEventListener("visibilitychange", visibility);
  media.addEventListener("change", reduce);
  const observer =
    typeof IntersectionObserver === "undefined"
      ? null
      : new IntersectionObserver((entries) => {
          visible = entries[entries.length - 1]?.isIntersecting ?? false;
          // An untouched resting avatar never starts a background clock on intersection.
          if (!visible || busy() || interacting || settling) start();
        });
  observer?.observe(element);
  if (reduced) frozen();
  else draw();
  if (busy()) start();
  return {
    update(next: AvatarOptions) {
      const same =
        next.seed === options.seed &&
        next.hue === options.hue &&
        next.mood === options.mood &&
        next.workingFaces === options.workingFaces;
      if (same) return;
      options = next;
      profile = botAvatarProfile(options.seed, options.hue);
      if (!reduced) beginBody(profile);
      syncAppearance();
    },
    dispose() {
      disposed = true;
      cancelFrame();
      window.clearTimeout(faceTimer);
      observer?.disconnect();
      document.removeEventListener("visibilitychange", visibility);
      media.removeEventListener("change", reduce);
      target.removeEventListener("pointerenter", enter);
      target.removeEventListener("pointerleave", leave);
      target.removeEventListener("focusin", focus);
      target.removeEventListener("focusout", blur);
      view.dispose();
    },
  };
}
