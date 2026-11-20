// oxlint-disable -- Vendored declaration from Bloub 0.6.3; retained with its upstream documentation.
import { type ProfileName } from "./profiles.js";
export interface Point {
  x: number;
  y: number;
}
/**
 * Une silhouette = un profil radial r(theta) plus une pose.
 *
 * Tout passe par des profils echantillonnes au MEME nombre d'angles : deux
 * formes quelconques ont donc des points qui se correspondent un a un, et le
 * morphing se reduit a une interpolation lineaire des rayons. C'est ce qui
 * rend les transitions propres sans librairie de morphing de path.
 */
export interface Silhouette {
  radii: number[];
  /** rotation du profil, en radians */
  rot: number;
  /** decalage du centre, en unites de rayon de boule */
  cx: number;
  cy: number;
  /** squash & stretch, applique en repere ecran (apres rotation) */
  sx: number;
  sy: number;
}
export declare function silhouette(name: ProfileName, pose?: Partial<Silhouette>): Silhouette;
/** Cercle parfait : sert de base neutre (point, bulle, cible de fondu). */
export declare function circle(radius: number, pose?: Partial<Silhouette>): Silhouette;
/** Interpolation de deux silhouettes. `out` est reutilise pour eviter d'allouer a 60 fps. */
export declare function blend(
  a: Silhouette,
  b: Silhouette,
  t: number,
  out?: Silhouette,
): Silhouette;
/** Projette la silhouette en points ecran. `scale` = rayon de la boule en unites de viewBox. */
export declare function toPoints(s: Silhouette, scale: number, out?: Point[]): Point[];
/**
 * Polyligne fermee -> cubiques Catmull-Rom.
 *
 * Avec 64 points les tangentes centrees suffisent largement : le contour est
 * lisse au pixel pres meme affiche en 600 px, et la chaine reste courte.
 */
export declare function closedPath(pts: Point[], tension?: number): string;
/**
 * Polygone quelconque -> profil radial, par lancer de rayon depuis `center`.
 *
 * Sert a fabriquer les formes qui ne s'expriment pas naturellement en r(theta)
 * (la barre tronconique du "!"). Calcule une seule fois au chargement, jamais
 * dans la boucle de rendu.
 */
export declare function profileFromPolygon(poly: Point[], cx: number, cy: number): number[];
/** Enveloppe convexe de deux cercles : la barre tronconique du "!" vertical. */
export declare function hullOfCircles(
  x1: number,
  y1: number,
  r1: number,
  x2: number,
  y2: number,
  r2v: number,
  steps?: number,
): Point[];
/**
 * Rayon du profil dans une direction quelconque, par interpolation entre les
 * deux echantillons voisins.
 *
 * Sert a recaler ce qui est pose "sur" le corps (les yeux, la pastille de
 * notification) quand la silhouette n'est plus un cercle : sans ca, un oeil
 * place a 0.62 rayon sort d'une forme dont le bord est a 0.55 dans cette
 * direction, et le masque le rogne.
 */
export declare function radiusAtAngle(radii: number[], angle: number): number;
/**
 * Superellipse : |x/sx|^n + |y/sy|^n = 1.
 * n = 2 donne une ellipse, n ~ 4 le squircle du personnalisateur.
 */
export declare function superellipseProfile(n: number, sx?: number, sy?: number): number[];
/**
 * Profil radial de l'UNION de disques : r(theta) = la plus lointaine des
 * intersections rayon/cercle. Exact tant que l'origine est dans l'union — c'est
 * ce qui donne les bosses du nuage sans booleen de path.
 */
export declare function unionOfCirclesProfile(
  circles: Array<{
    x: number;
    y: number;
    r: number;
  }>,
): number[];
/** Polygone regulier a coins arrondis, inscrit dans `radius`. */
export declare function regularPolygonProfile(
  sides: number,
  radius: number,
  rc: number,
  rotationDeg?: number,
): number[];
/** Polyligne fermee exacte : garde les segments droits (contrairement a closedPath). */
export declare function polyPath(pts: Point[], scale?: number): string;
/** Capsule (stade) centree sur l'origine : la forme exacte des yeux du bot. */
export declare function capsulePath(w: number, h: number): string;
