// oxlint-disable -- Vendored declaration from Bloub 0.6.3; retained with its upstream documentation.
export interface DotRender {
  x: number;
  y: number;
  r: number;
  opacity: number;
  /** couleur explicite ; par defaut le rendu prend celle du corps */
  color?: string;
  /**
   * Brume de profondeur : 0 = fondu dans le fond, 1 = couleur du corps pleine.
   * Le melange se fait au rendu, qui seul connait la couleur choisie.
   */
  depth?: number;
  /**
   * Forme non circulaire, en unites de rayon de boule et centree sur l'origine
   * (le point du "!" penche est une goutte, pas un disque). Quand elle est
   * fournie, `r` n'est plus utilise pour le trace.
   */
  d?: string;
  /** rotation appliquee a `d`, en degres */
  rot?: number;
}
/**
 * Ce qu'un etat declare : la geometrie de l'arc reste en unites de rayon de
 * boule, c'est le moteur (seul a connaitre l'echelle du viewBox) qui la
 * rasterise. Sans ca les etats devraient connaitre le viewBox.
 */
export interface ArcSpec {
  id: string;
  seed: ArcSeed;
  t: number;
  opacity: number;
}
export interface ArcRender {
  id: string;
  /** portion devant le corps */
  front: string;
  /** portion derriere le corps (dessinee avant, donc masquee par la silhouette) */
  back: string;
  width: number;
  opacity: number;
  /** degrade de teinte le long du trace */
  grad: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    stops: string[];
  };
}
export interface ArcSeed {
  /** demi-grand axe, en unites de rayon de boule */
  a: number;
  /** aplatissement b/a : mesure <= 0.45, les plans d'orbite sont vus par la tranche */
  k: number;
  /** inclinaison du grand axe a l'ecran, radians */
  tilt: number;
  /** tours par seconde */
  speed: number;
  phase: number;
  /** fraction du tour reellement tracee */
  sweep: number;
  hue: number;
  hueSpan: number;
  width: number;
  cx: number;
  cy: number;
}
/**
 * Projette un cercle 3D incline en orthographique.
 *
 * Le cercle vit dans le plan engendre par u (dans l'ecran) et v (qui plonge
 * dans la profondeur). La composante z sert a couper l'arc en deux : la moitie
 * arriere est dessinee avant le corps, donc occultee par lui. C'est ce vrai tri
 * en profondeur qui fait lire les anneaux comme des orbites et pas comme un
 * dessin plat.
 */
export declare function arcRender(
  seed: ArcSeed,
  t: number,
  scale: number,
  id: string,
  opacity?: number,
): ArcRender;
/**
 * 6 anneaux, demi-grand axe 1.30-1.40 (donc nettement plus grands que la
 * boule), aplatissement toujours <= 0.45, epaisseur 0.055, ~3.3 tours/s.
 */
export declare const RINGS: ArcSeed[];
/**
 * Bouquet d'arcs emboites qui balaie le triangle juste avant les orbites.
 * Vus quasiment par la tranche (d'ou la forme en epingle a cheveux), rmax 1.37.
 */
export declare const SWOOSH: ArcSeed[];
/** x mesures : -0.557 / -0.013 / +0.532, y = 0. */
export declare const DOT_X: readonly [-0.557, -0.013, 0.532];
export declare const DOT_R = 0.165;
export declare const DOT_PEAK = 1.25;
/**
 * Les particules ne partent pas en ligne droite : elles spiralent vers le
 * centre (rayon x0.75 par frame, angle +100 deg/s) en grossissant, et passent
 * derriere le noyau ou elles sont avalees.
 */
export declare function particles(t: number, scale: number): DotRender[];
export declare const COMET_RIBBONS: ArcSeed[];
/** Rayon du point de la comete, mesure a 0.129. */
export declare const COMET_DOT = 0.129;
/** Bleu releve au pixel. */
export declare const NOTIF_BLUE = "#2496e8";
/** La pastille est posee exactement sur la circonference, a -42deg. */
export declare const NOTIF_ANGLE = -42;
export declare const NOTIF_DIST = 1.003;
/** Rayon au repos ; le pop culmine 14 % au-dessus. */
export declare const NOTIF_R = 0.15;
export declare const NOTIF_POP = 1.14;
/**
 * L'encoche est un disque concentrique a la pastille, soustrait du corps.
 * La marge est constante (0.054 R) et suit l'echelle du corps.
 */
export declare const NOTIF_MARGIN = 0.054;
