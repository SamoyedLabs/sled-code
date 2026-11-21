// oxlint-disable -- Vendored declaration from Bloub 0.6.3; retained with its upstream documentation.
import { type HeadGaze } from "./face.js";
import type { EyeCfg } from "./states.js";
/**
 * Expression de repos du bot.
 *
 * Le visage ne tient qu'à deux gélules, donc tout se joue sur quatre leviers :
 * l'orientation de la tête, l'écart des yeux, leurs proportions, et
 * l'inclinaison propre de chaque œil. C'est ce dernier qui permet la colère et
 * la tristesse : elles demandent des inclinaisons EN MIROIR (les hauts qui
 * convergent ou divergent), impossible avec le seul roulis de tête qui incline
 * les deux yeux du même côté.
 *
 * Seul l'état de repos porte cette expression. Les états expressifs de la vidéo
 * (clin d'œil, yeux écarquillés, notification) gardent la leur : c'est elle
 * qu'on est venu reproduire.
 *
 * Les amplitudes s'appuient sur bible-strong-avatar-lab, qui expose le même
 * modèle (tête X/Y/Z, largeur et hauteur par œil, écart, angle par œil) : chez
 * eux la largeur va de 0,8 à 2,7 fois le neutre, la hauteur de 0,3 à 1,5, et
 * les angles jusqu'à ±80°. On reste dans cette enveloppe.
 */
/** Enumeres pour que la couche i18n verifie leurs traductions a la compilation. */
export type ExpressionId =
  | "neutre"
  | "attentif"
  | "surpris"
  | "excite"
  | "heureux"
  | "hilare"
  | "colere"
  | "triste"
  | "effraye"
  | "mefiant"
  | "confus"
  | "curieux"
  | "fier"
  | "timide"
  | "blase"
  | "somnolent";
export interface BotExpression {
  id: ExpressionId;
  gaze: HeadGaze;
  split: number;
  eyes: [EyeCfg, EyeCfg];
}
export declare const EXPRESSIONS: BotExpression[];
export declare const EXPRESSION_BY_ID: Map<string, BotExpression>;
export declare const DEFAULT_EXPRESSION = "neutre";
/** Interpolation de deux expressions : le changement se fait en glissant. */
export declare function blendExpression(
  a: BotExpression,
  b: BotExpression,
  t: number,
): BotExpression;
