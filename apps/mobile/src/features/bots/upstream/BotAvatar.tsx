import { useEffect, useId, type ReactNode } from "react";
import Svg, { G, Image, Defs, ClipPath, Rect } from "react-native-svg";
import Animated, {
  cancelAnimation,
  useAnimatedProps,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import data from "./avatar-data.json";
import { avatarBodies } from "./avatar-assets";
import type { AvatarColor } from "./chat-colors";
import { useBotMotion } from "../botFeedback";

const automaticColors = ["rouge", "orange", "ambre", "vert", "turquoise", "bleu", "violet", "rose"];
const hueColors: Record<number, string> = {
  0: "rouge",
  30: "orange",
  55: "ambre",
  100: "vert",
  150: "vert",
  185: "turquoise",
  215: "bleu",
  245: "violet",
  280: "violet",
  320: "rose",
};
const bodyColors: Record<string, AvatarColor> = {
  rouge: "#e8483f",
  orange: "#f08a24",
  ambre: "#f0b429",
  vert: "#3ecf8e",
  turquoise: "#2fbfa0",
  bleu: "#3b93f0",
  violet: "#8b5cf6",
  rose: "#e152b0",
};

export function botAvatarHeadColor(seed: string, hue: number | null = null): AvatarColor {
  if (hue === 100) return "#8ece34";
  if (hue === 245) return "#5d67ee";
  return bodyColors[botAvatarProfile(seed, hue).color] ?? "#3b93f0";
}
function index(value: string, length: number) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % length;
}
export function botAvatarProfile(seed: string, hue: number | null = null) {
  const supported = data.shapes.filter((shape) => shape !== "goutte");
  let shape = data.shapes[index(seed + ":shape", data.shapes.length)]!;
  if (shape === "goutte") shape = supported[index(seed + ":shape:replacement", supported.length)]!;
  return {
    shape,
    expression: data.expressions[index(seed + ":expression", data.expressions.length)]!,
    color:
      (hue === null ? undefined : hueColors[hue]) ??
      automaticColors[index(seed + ":color", automaticColors.length)]!,
  };
}
type Eye = {
  matrix: number[];
  alpha: number;
  pad: number;
  inner: number[] | null;
  pieces: {
    src: number;
    x: number;
    y: number;
    w: number;
    h: number;
    sx: number;
    sy: number;
    sw: number;
    sh: number;
  }[];
};
const frames: Record<string, Eye[]> = data.frames;
const AnimatedEyes = Animated.createAnimatedComponent(G);

function BlinkingEyes({ children }: { children: ReactNode }) {
  const enabled = useBotMotion("agentFaces");
  const height = useSharedValue(1);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Blinks on the UI thread while the selected chat's avatar is mounted.
  useEffect(() => {
    if (enabled)
      height.set(
        withRepeat(
          withDelay(
            4_700,
            withSequence(withTiming(0.15, { duration: 72 }), withTiming(1, { duration: 114 })),
          ),
          -1,
        ),
      );
    return () => {
      cancelAnimation(height);
      height.set(1);
    };
  }, [enabled, height]);
  const animated = useAnimatedProps(() => ({ scaleY: height.get() }));
  return <AnimatedEyes animatedProps={animated}>{children}</AnimatedEyes>;
}

export function BotAvatar({
  seed,
  hue = null,
  size = 54,
  animateFace = false,
}: {
  seed: string;
  hue?: number | null;
  size?: number;
  animateFace?: boolean;
}) {
  const id = useId().replaceAll(":", "");
  const profile = botAvatarProfile(seed, hue);
  const eyes = frames[profile.shape + ":" + profile.expression] ?? [];
  const Eyes = animateFace ? BlinkingEyes : G;
  return (
    <Svg width={size} height={size} viewBox="-158 -158 316 316" accessible={false}>
      <G scale={1.15}>
        <Image
          href={avatarBodies[profile.shape + ":" + profile.color]}
          x={-158}
          y={-158}
          width={316}
          height={316}
        />
        <Eyes>
          {eyes.map((eye, i) => (
            <G
              key={eye.matrix.join(",")}
              transform={`matrix(${eye.matrix.join(" ")})`}
              opacity={eye.alpha * eye.pad}
            >
              <G transform={eye.inner ? `matrix(${eye.inner.join(" ")})` : undefined}>
                {eye.pieces.map((p, j) => {
                  const clip = id + i + "p" + j;
                  return (
                    <G key={[p.src, p.x, p.y, p.w, p.h].join(",")}>
                      <Defs>
                        <ClipPath id={clip}>
                          <Rect x={p.x} y={p.y} width={p.w} height={p.h} />
                        </ClipPath>
                      </Defs>
                      <G clipPath={`url(#${clip})`}>
                        <Image
                          href={
                            p.src === 0
                              ? require("./assets/fred-oeil0-x.png")
                              : require("./assets/fred-oeil0-y.png")
                          }
                          x={p.x - (p.sx * p.w) / p.sw}
                          y={p.y - (p.sy * p.h) / p.sh}
                          width={p.w / p.sw}
                          height={p.h / p.sh}
                          preserveAspectRatio="none"
                        />
                      </G>
                    </G>
                  );
                })}
              </G>
            </G>
          ))}
        </Eyes>
      </G>
    </Svg>
  );
}
