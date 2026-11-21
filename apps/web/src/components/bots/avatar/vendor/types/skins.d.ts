// oxlint-disable -- Vendored declaration from Bloub 0.6.3; retained with its upstream documentation.
/**
 * Formes et couleurs proposees par le personnalisateur du bot.
 *
 * A la difference des silhouettes d'animation (`profiles.ts`), celles-ci ne sont
 * PAS relevees sur la video : elles sont construites analytiquement d'apres la
 * grille du personnalisateur d'origine. Deux sources distinctes, donc, et c'est
 * volontaire — les etats animes doivent rester fideles a la video, les formes de
 * base sont un choix d'utilisateur.
 */
/**
 * Les identifiants sont enumeres plutot que deduits du tableau : c'est ce qui
 * permet a la couche i18n de verifier A LA COMPILATION que chaque forme a bien
 * sa traduction dans les trois langues (`t(\`shapes.${id}\`)` ne compile que si
 * la cle existe). Un `as const` sur le tableau aurait le meme effet mais
 * rendrait `radii` en lecture seule, alors que le moteur le passe tel quel.
 */
export type ShapeId =
  | "cercle"
  | "galet"
  | "squircle"
  | "capsule"
  | "triangle"
  | "hexagone"
  | "nuage"
  | "goutte"
  | "carre"
  | "losange"
  | "pentagone";
export interface BotShape {
  id: ShapeId;
  radii: number[];
}
export declare const SHAPES: BotShape[];
export declare const SHAPE_BY_ID: Map<string, BotShape>;
export declare const DEFAULT_SHAPE = "cercle";
export type ColorId =
  | "encre"
  | "creme"
  | "brun"
  | "rouge"
  | "orange"
  | "ambre"
  | "vert"
  | "turquoise"
  | "bleu"
  | "violet"
  | "rose"
  | "gris";
export interface BotColor {
  id: ColorId;
  hex: string;
}
/** Palette du personnalisateur d'origine. */
export declare const COLORS: BotColor[];
export declare const COLOR_BY_ID: Map<string, BotColor>;
export declare const DEFAULT_COLOR = "encre";
/** Melange deux couleurs hex. Sert a la brume de profondeur des particules. */
export declare function mixHex(from: string, to: string, t: number): string;
