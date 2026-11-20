import { EXPRESSIONS, SHAPES } from "./vendor/bloub-engine";

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
export function avatarHash(value: string) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
export function botAvatarProfile(seed: string, hue: number | null = null) {
  const supported = SHAPES.filter((shape) => shape.id !== "goutte");
  let shape = SHAPES[avatarHash(`${seed}:shape`) % SHAPES.length]!;
  if (shape.id === "goutte")
    shape = supported[avatarHash(`${seed}:shape:replacement`) % supported.length]!;
  return {
    shape: shape.id,
    expression: EXPRESSIONS[avatarHash(`${seed}:expression`) % EXPRESSIONS.length]!.id,
    color:
      (hue === null ? undefined : hueColors[hue]) ??
      automaticColors[avatarHash(`${seed}:color`) % automaticColors.length]!,
  };
}
export type AvatarProfile = ReturnType<typeof botAvatarProfile>;
