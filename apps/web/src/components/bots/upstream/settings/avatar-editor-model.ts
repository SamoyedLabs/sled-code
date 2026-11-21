import {
  COLOR_BY_ID,
  EXPRESSIONS,
  type ExpressionId,
  SHAPES,
  type ShapeId,
} from "../../avatar/vendor/bloub-engine";
import type { ColorId } from "../../avatar/vendor/types/skins";
import { m } from "../../../../i18n/messages";
import { msg } from "gt-react";
export type AvatarHue = 0 | 30 | 55 | 100 | 150 | 185 | 215 | 245 | 280 | 320;

export type SupportedAvatarSilhouetteId = Exclude<ShapeId, "goutte">;

export interface BloubAvatarProfile {
  shape: SupportedAvatarSilhouetteId;
  color: ColorId;
  expression: ExpressionId;
}

const AUTOMATIC_COLORS = [
  "rouge",
  "orange",
  "ambre",
  "vert",
  "turquoise",
  "bleu",
  "violet",
  "rose",
] as const;
const UNSUPPORTED_AVATAR_SILHOUETTE = "goutte" as const satisfies ShapeId;
export const SUPPORTED_AVATAR_SILHOUETTES = SHAPES.map((option) => option.id).filter(
  (silhouette): silhouette is SupportedAvatarSilhouetteId =>
    silhouette !== UNSUPPORTED_AVATAR_SILHOUETTE,
);

const HUE_COLORS: Readonly<Record<AvatarHue, ColorId>> = {
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

/** The eyes a person can pick, in the order Bloub lists them. */
export const AVATAR_EXPRESSIONS: readonly ExpressionId[] = EXPRESSIONS.map((option) => option.id);

export const AVATAR_HUE_OPTIONS: ReadonlyArray<{
  hue: AvatarHue;
  label: string;
}> = [
  { hue: 0, label: m(msg("Red")) },
  { hue: 30, label: m(msg("Orange")) },
  { hue: 55, label: m(msg("Yellow")) },
  { hue: 100, label: m(msg("Lime")) },
  { hue: 150, label: m(msg("Green")) },
  { hue: 185, label: m(msg("Cyan")) },
  { hue: 215, label: m(msg("Blue")) },
  { hue: 245, label: m(msg("Indigo")) },
  { hue: 280, label: m(msg("Violet")) },
  { hue: 320, label: m(msg("Magenta")) },
];

// Hues 100 and 280 stay valid for stored agents, but draw the same color as 150 and 245.
export const AVATAR_HUE_CHOICES = AVATAR_HUE_OPTIONS.filter(
  (option) => option.hue !== 100 && option.hue !== 280,
);

export function bloubAvatarProfile(seed: string, hue: AvatarHue | null): BloubAvatarProfile {
  const storedSilhouette = requiredItem(SHAPES, stableIndex(`${seed}:shape`, SHAPES.length)).id;
  const silhouette =
    storedSilhouette === UNSUPPORTED_AVATAR_SILHOUETTE
      ? requiredItem(
          SUPPORTED_AVATAR_SILHOUETTES,
          stableIndex(`${seed}:shape:replacement`, SUPPORTED_AVATAR_SILHOUETTES.length),
        )
      : storedSilhouette;
  const expression = requiredItem(
    EXPRESSIONS,
    stableIndex(`${seed}:expression`, EXPRESSIONS.length),
  ).id;

  return {
    shape: silhouette,
    expression,
    color:
      hue === null
        ? requiredItem(AUTOMATIC_COLORS, stableIndex(`${seed}:color`, AUTOMATIC_COLORS.length))
        : HUE_COLORS[hue],
  };
}

export function avatarHueSwatch(hue: AvatarHue): string {
  return colorHex(HUE_COLORS[hue]);
}

export function avatarHeadColor(seed: string, hue: AvatarHue | null): string {
  return colorHex(bloubAvatarProfile(seed, hue).color);
}

export function avatarCandidateSeeds(
  agentId: string,
  currentSeed: string,
  batch: number,
): string[] {
  const candidates = [currentSeed];
  const firstProfile = bloubAvatarProfile(currentSeed, null);
  const unseenSilhouetteIds = new Set<SupportedAvatarSilhouetteId>(SUPPORTED_AVATAR_SILHOUETTES);
  const usedExpressions = new Set<ExpressionId>([firstProfile.expression]);
  unseenSilhouetteIds.delete(firstProfile.shape);
  let index = 1;

  while (unseenSilhouetteIds.size > 0) {
    const candidate = `${agentId}:avatar:${batch}:${index}`;
    index += 1;
    if (candidates.includes(candidate)) continue;
    const profile = bloubAvatarProfile(candidate, null);
    if (!unseenSilhouetteIds.delete(profile.shape)) continue;
    candidates.push(candidate);
    usedExpressions.add(profile.expression);
  }

  while (candidates.length < 12) {
    const candidate = `${agentId}:avatar:${batch}:${index}`;
    index += 1;
    if (candidates.includes(candidate)) continue;
    const profile = bloubAvatarProfile(candidate, null);
    if (usedExpressions.has(profile.expression)) continue;
    candidates.push(candidate);
    usedExpressions.add(profile.expression);
  }

  return candidates;
}

/** About 50 times the tries that one shape and eyes pair needs on average. */
const FACE_SEED_TRIES = 10_000;

/**
 * A seed that draws the given shape and eyes. Only the seed is saved, so a face that a person
 * builds must come from a seed: every app then draws it, with no new saved field. The same agent
 * and choice always give the same seed. The automatic colour also comes from the seed, and the
 * hash ties it to the eyes, so new eyes can change it: keep the colour with `avatarHueForColor`.
 */
export function avatarSeedForFace(
  agentId: string,
  face: { shape: SupportedAvatarSilhouetteId; expression: ExpressionId },
): string {
  for (let index = 0; index < FACE_SEED_TRIES; index += 1) {
    const candidate = `${agentId}:face:${index}`;
    const profile = bloubAvatarProfile(candidate, null);
    if (profile.shape === face.shape && profile.expression === face.expression) return candidate;
  }
  throw new Error("No avatar seed draws this face.");
}

/** The hue that draws an automatic colour, so the colour can stay when the seed changes. */
export function avatarHueForColor(color: ColorId): AvatarHue | null {
  return AVATAR_HUE_CHOICES.find((option) => HUE_COLORS[option.hue] === color)?.hue ?? null;
}

function stableIndex(value: string, length: number): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % length;
}

function colorHex(color: ColorId): string {
  const value = COLOR_BY_ID.get(color)?.hex;
  if (!value) throw new Error(`Bloub did not return a color for ${color}.`);
  return value;
}

function requiredItem<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error("Bloub avatar options are empty.");
  return item;
}
