import { type ArcSpec, type DotRender } from "./decor.js";
import { type HeadGaze } from "./face.js";
import { type Silhouette } from "./shape.js";
export interface EyeCfg {
  /** largeur locale (axe court de la gelule), en unites de rayon de boule */
  w: number;
  /** hauteur locale (axe long) */
  h: number;
  /** 1 = ouvert, 0 = ferme */
  open: number;
  /**
   * Inclinaison propre de la gelule, en degres, positif = le haut part a
   * droite. Appliquee APRES le repere tangent de la sphere. Sans elle, les deux
   * yeux penchent forcement du meme cote (le roulis de tete) et la colere comme
   * la tristesse, qui demandent des inclinaisons en miroir, sont hors de portee.
   */
  tilt?: number;
}
export interface Pose {
  /** silhouette du corps, en unites de rayon de boule */
  sil: Silhouette;
  /** decalage global du corps ET des yeux */
  offX: number;
  offY: number;
  gaze: HeadGaze;
  /** demi-ecart des yeux sur la sphere, en degres */
  split: number;
  /** [oeil interieur, oeil exterieur] */
  eyes: [EyeCfg, EyeCfg];
  /** opacite des yeux : sert aux etats sans visage */
  eyeAlpha: number;
  bodyAlpha: number;
  dots: DotRender[];
  arcs: ArcSpec[];
  notif: {
    x: number;
    y: number;
    r: number;
    notch: number;
  } | null;
  /** true = le decor passe derriere le corps (particules de l'eclatement) */
  dotsBehind: boolean;
}
export type StateId =
  | "idle"
  | "thinking"
  | "wink"
  | "wide"
  | "alert"
  | "notify"
  | "exclaim"
  | "sleep"
  | "egg"
  | "hexagon"
  | "play"
  | "orbit"
  | "burst"
  | "comet"
  /** transition d'interface, pas une animation du catalogue : hors `SEQUENCE` */
  | "swirl";
export interface StateDef {
  id: StateId;
  /** duree de maintien quand la sequence complete est jouee */
  duration: number;
  /**
   * duree en dessous de laquelle l'animation est coupee avant d'aboutir : le
   * "!" ne revient pas, le corps reste eclate. Elle se lit dans les constantes
   * de `pose` ci-dessous, elle ne se choisit pas. Absente = l'etat ignore le
   * temps ou boucle, n'importe quelle duree lui va (voir `MIN_BLOCK`).
   */
  minDuration?: number;
  /** duree du morph d'entree */
  morph: number;
  /** true = l'entree est masquee par un clignement, comme dans la video */
  blinkIn: boolean;
  /**
   * true = le corps est la silhouette "au repos", donc remplacable par la forme
   * choisie dans le personnalisateur. Les etats qui dessinent leur propre forme
   * (le "!", les points, l'oeuf, le triangle...) valent false : c'est cette forme
   * la qui EST l'animation.
   */
  baseBody: boolean;
  /**
   * true = l'etat porte le visage "au repos", donc remplacable par l'expression
   * choisie. Seul `idle` : les autres etats a visage ont une expression relevee
   * sur la video, c'est precisement ce qu'on reproduit.
   */
  baseFace: boolean;
  pose(local: number): Pose;
}
/** Onde de pulsation qui parcourt les trois points de gauche a droite. */
export declare function dotPulse(t: number, index: number): number;
export declare const STATES: StateDef[];
export declare const STATE_BY_ID: Map<StateId, StateDef>;
/** Ordre de lecture de la sequence complete, calque sur la video de reference. */
/**
 * Date, en temps local, ou chaque etat est le plus lisible : c'est la pose que
 * montrent les vignettes et la planche. Rendu deterministe, donc comparable
 * d'une execution a l'autre. Le type force a couvrir tout nouvel etat.
 */
export declare const POSES: Record<StateId, number>;
export declare const SEQUENCE: StateId[];
