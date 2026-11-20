/** Demi-ecart des yeux sur la sphere, en degres (separation totale ~31deg). */
export declare const EYE_SPLIT = 15.46;
/** Taille de l'oeil au repos, en unites de rayon de boule. */
export declare const EYE_W = 0.186;
export declare const EYE_H = 0.412;
/** Orientation de tete au repos, ajustee sur les frames de reference. */
export declare const REST_GAZE: HeadGaze;
export interface EyePose {
  x: number;
  y: number;
  /** matrice tangente 2x2 : [a b c d] au sens SVG matrix(a,b,c,d,e,f) */
  a: number;
  b: number;
  c: number;
  d: number;
  /** composante z de la normale : > 0 = face visible */
  depth: number;
}
export interface HeadGaze {
  /** lacet, degres, positif = regarde a droite */
  yaw: number;
  /** tangage, degres, positif = regarde en haut */
  pitch: number;
  /** roulis, degres, inclinaison de la tete */
  roll: number;
}
/**
 * Repere de la tete puis des deux yeux.
 * Repere ecran : x a droite, y vers le bas, z vers le spectateur.
 * L'indice 0 est l'oeil interieur, l'indice 1 l'oeil exterieur.
 */
export declare function eyePoses(gaze: HeadGaze, scale: number, split?: number): [EyePose, EyePose];
/**
 * Vie au repos : derive lente du regard, saccades, clignements.
 *
 * Fonction pure du temps (aucun etat interne), donc pause, reprise et saut a
 * une date arbitraire donnent toujours la meme image. Les valeurs sont des
 * ECARTS a ajouter a la pose de l'etat courant.
 */
export interface Liveliness {
  dYaw: number;
  dPitch: number;
  dRoll: number;
  /** 1 = oeil ouvert, 0 = ferme (ecrasement vertical en repere ecran) */
  lid: number;
  driftX: number;
  driftY: number;
  breath: number;
}
export interface LivelinessOptions {
  wander?: number;
  blink?: boolean;
  float?: boolean;
}
export declare function liveliness(t: number, opt?: LivelinessOptions): Liveliness;
/**
 * Le clignement est un ecrasement VERTICAL en repere ecran autour du centre de
 * l'oeil (mesure : la largeur de bbox est conservee, la hauteur tombe a ~0.35),
 * pas un retrecissement le long de l'axe incline de la gelule. On le compose
 * donc apres la matrice tangente, en n'affectant que les sorties en y.
 */
export declare function blinkScale(lid: number): number;
