import { useEffect, useId, useRef } from "react";
import type { AvatarMood } from "./avatar-types";
import { createPlushController } from "./plush-controller";

export type { AvatarMood } from "./avatar-types";

export function BotAvatar({
  seed,
  hue = null,
  size = 42,
  mood = "idle",
  workingFaces = false,
}: {
  seed: string;
  hue?: number | null;
  size?: number;
  mood?: AvatarMood;
  workingFaces?: boolean;
}) {
  const id = useId().replaceAll(":", "");
  const element = useRef<SVGSVGElement>(null);
  const controller = useRef<ReturnType<typeof createPlushController> | null>(null);
  const initial = useRef({ seed, hue, mood, workingFaces });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Own the external SVG animation engine and release its browser subscriptions.
  useEffect(() => {
    if (!element.current) return;
    const avatar = createPlushController(element.current, id, initial.current);
    controller.current = avatar;
    return () => {
      avatar.dispose();
      controller.current = null;
    };
  }, [id]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Send React prop changes to the external animation engine without rendering each frame.
  useEffect(() => {
    initial.current = { seed, hue, mood, workingFaces };
    controller.current?.update(initial.current);
  }, [seed, hue, mood, workingFaces]);
  return (
    <svg
      ref={element}
      className="pointer-events-none"
      width={size}
      height={size}
      viewBox="-158 -158 316 316"
      aria-hidden="true"
      data-avatar="generated"
      data-mood={mood}
      style={{ overflow: "visible", flexShrink: 0 }}
    />
  );
}
