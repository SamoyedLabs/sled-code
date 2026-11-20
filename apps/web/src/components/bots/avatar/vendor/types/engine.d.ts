// oxlint-disable -- Vendored declaration from Bloub 0.6.3; retained with its upstream documentation.
import { type ArcRender, type DotRender } from "./decor.js";
import { type BotExpression } from "./expressions.js";
import { type StateId } from "./states.js";
export interface RenderedEye {
  d: string;
  matrix: string;
  alpha: number;
  /** taille de la gelule dans son repere (avant `matrix`), en px : ce que `d` dessine */
  w: number;
  h: number;
  /**
   * l'ecrasement vertical du clignement deja compose dans `matrix` (`blinkScale`), 1 oeil
   * ouvert : un rendu qui dessine l'oeil autrement qu'un trou peut le retirer de la matrice
   */
  open: number;
  /**
   * le meme ecrasement hors clignement : celui de l'expression au repos (`EyeCfg.open`,
   * `somnolent`). `open` lui est egal sauf pendant un clignement, ou il descend en dessous
   */
  rest: number;
}
export interface BotFrame {
  bodyPath: string;
  bodyAlpha: number;
  eyes: RenderedEye[];
  dots: DotRender[];
  /** true = les points passent derriere le corps (particules de l'eclatement) */
  dotsBehind: boolean;
  arcs: ArcRender[];
  notif: {
    x: number;
    y: number;
    r: number;
  } | null;
  notch: {
    x: number;
    y: number;
    r: number;
  } | null;
}
/**
 * Ou le bot porte son regard quand quelque chose d'exterieur le pilote — le
 * pointeur de la souris, aujourd'hui.
 *
 * `yaw` et `pitch` sont des directions ABSOLUES, qui remplacent celles de la pose
 * a mesure que `mix` monte. Deux raisons, chacune un piege deja tombe :
 *
 * - c'est le MOTEUR qui doit faire ce melange, pas l'appelant, parce que lui seul
 *   connait la pose A CET INSTANT. Un appelant qui compenserait l'orientation de
 *   l'expression lirait sa valeur d'arrivee pendant que le morph est encore en
 *   cours, et les yeux sautaient a chaque changement d'humeur ;
 * - et il faut que ce soit absolu sur les DEUX axes. En relatif, la hauteur des
 *   yeux suivait celle de chaque expression — « neutre » regarde a +28,6deg quand
 *   les autres sont entre -9 et +9 — donc les yeux tombaient d'un coup au premier
 *   changement d'humeur. Ce qui fait le caractere d'une expression pendant le
 *   suivi, c'est la FORME de ses yeux (plisses, ronds, dissymetriques), pas
 *   l'endroit ou elle regarde : celui-la, c'est le curseur qui le decide.
 *
 * `mix` dit a quel point l'exterieur commande la DIRECTION (0 = pas du tout).
 *
 * `wander` dit, separement, ce qui reste de derive automatique. Les deux ne se
 * confondent pas : quand le pointeur bouge, la derive doit s'eteindre — cumulees,
 * le bot aurait l'air de chercher le curseur sans jamais le tenir. Mais quand il
 * n'y a PAS de pointeur (arrivee au clavier, au tactile, ou souris sortie de la
 * fenetre), la tete doit rester tournee ET continuer de vivre. Les confondre
 * figeait le regard des que la vue s'ouvrait.
 *
 * `spin` est un tour a parcourir EN CHEMIN, en degres, qu'on fait fondre vers 0
 * avec l'arrivee. Comme les yeux vivent sur une sphere, un tour les fait passer
 * derriere la boule et revenir de l'autre cote — et `-360deg` etant le meme
 * angle que `0`, il ne change rien a l'endroit ou ils se posent.
 *
 * `blink` dit ce qui reste des clignements (1 par defaut, 0 = aucun). Comme `wander`,
 * c'est de la vie automatique qu'on module : un oeil deja ferme en tiret (la peluche
 * endormie) qui clignerait encore s'amincirait d'un coup, a chaque clignement.
 */
export interface Look {
  yaw: number;
  pitch: number;
  mix: number;
  spin: number;
  wander: number;
  blink?: number;
}
/**
 * Moteur sans horloge : `sample(t)` est une fonction pure du temps.
 *
 * Consequence pratique : pause, reprise, ralenti et saut a une date arbitraire
 * donnent exactement la meme image, et le rendu est testable sans DOM.
 */
export declare class BotEngine {
  /** rayon de la boule au repos, en unites de viewBox */
  readonly scale: number;
  private cur;
  private prev;
  /**
   * Pose de depart FIGEE, posee seulement quand un changement d'etat arrive alors qu'un
   * fondu est deja en cours. Cf. `setState`.
   */
  private departFige;
  /**
   * Meme chose pour le decalage des yeux (`eyefit.ts`), qui se fond a cote de la pose et
   * avait le meme defaut : en plein fondu, il repartait du decalage PLEIN de l'etat quitte.
   * Mesure sur capsule, `notify -> idle -> notify` a 50 ms : 7,3 px de saut sur les deux
   * yeux, contre 5,3 px pour le plus raide des changements espaces.
   */
  private decalageFige;
  private tCur;
  private tPrev;
  /**
   * Avance de la POSE de l'etat courant (et de l'etat quitte) sur son horloge : la pose se
   * lit a `now - tCur + posePhase`, le fondu reste date sur `tCur`. Cf. `setState`.
   */
  private posePhase;
  private previousPosePhase;
  private blinkAt;
  private pts;
  private shape;
  private shapePrev;
  private shapeAt;
  private expr;
  private exprPrev;
  private exprAt;
  /**
   * Depart du decalage des yeux quand une expression arrive en plein morph : les ids lus
   * dans la table et leur poids a l'instant du changement. `null` hors de ce cas, et le
   * depart est alors simplement `exprPrev`. Cf. `setExpression`.
   */
  private exprDepart;
  private look;
  private lookPrev;
  private lookAt;
  /** duree de rattrapage en cours ; voir `LOOK_MORPH`, sa valeur par defaut */
  private lookMorph;
  /** duree du morph quand on change la forme du corps */
  static readonly SHAPE_MORPH = 0.45;
  /**
   * Duree de rattrapage du regard vers la cible. Plus court que `SHAPE_MORPH` :
   * un regard qui suit doit paraitre attentif, pas visqueux. Comme la cible est
   * reposee a chaque mouvement de souris, c'est cette duree qui donne au suivi
   * son inertie — le regard n'atteint jamais tout a fait un curseur qui bouge.
   */
  static readonly LOOK_MORPH = 0.24;
  constructor(
    scale?: number,
    initial?: StateId,
    shape?: number[] | null,
    expression?: BotExpression | null,
  );
  /**
   * Expression de repos choisie dans le personnalisateur. Comme la forme, elle
   * glisse vers la nouvelle valeur au lieu de sauter.
   */
  setExpression(expression: BotExpression | null, now?: number): void;
  /** Expression effective a l'instant `now`, morph en cours compris. */
  private exprAtTime;
  /**
   * Forme choisie dans le personnalisateur. Elle ne remplace le corps que sur
   * les etats au repos (`baseBody`) : sur les autres, la silhouette EST
   * l'animation et ne doit pas etre ecrasee.
   *
   * Le changement se fait en morph, pas d'un coup : comme toutes les formes sont
   * echantillonnees aux memes angles, il suffit d'interpoler les rayons.
   */
  setShape(radii: number[] | null, now?: number): void;
  /**
   * Forme effective a l'instant `now`, morph en cours compris.
   *
   * Ne remet PAS `shapePrev` a null en fin de morph : `sample` doit rester une
   * fonction pure du temps, donc relire une date passee doit redonner l'image
   * intermediaire. On garde juste une reference de plus.
   */
  private shapeAtTime;
  /**
   * Nouvelle cible de regard, `null` pour revenir a celui de l'etat.
   *
   * Elle repart de la valeur COURANTE, et non de la cible precedente comme
   * `setShape` : cette methode est appelee a chaque mouvement de pointeur, et
   * repartir de l'ancienne cible ferait reculer le regard d'un cran avant
   * chaque rattrapage — le suivi tremblerait au lieu de glisser.
   *
   * Meme contrat que `setShape` par ailleurs : l'etat externe entre par un
   * setter horodate, jamais par une variable lue pendant `sample`, sinon le
   * moteur cesse d'etre une fonction pure du temps.
   */
  setLook(look: Look | null, now: number, morph?: number): void;
  /** Regard effectif a l'instant `now`, rattrapage en cours compris. */
  private lookAtTime;
  private posed;
  /**
   * Decalage des yeux a l'instant `now` pour un etat donne, en unites de rayon de boule.
   *
   * Il est LU dans une table et interpole, jamais recalcule : `eyefit.ts` explique
   * pourquoi cette distinction est tout le correctif. Ici il ne reste qu'a l'interpoler
   * sur l'axe de la forme, avec exactement la courbe et la duree du morph de silhouette
   * — c'est la meme cause, donc ce doit etre le meme mouvement.
   *
   * On interroge la table sur les BORNES du morph (`shapePrev` et `shape`) et non sur le
   * profil que rend `shapeAtTime` : celui-la est un tableau neuf alloue a chaque image,
   * donc sans identite, et il n'existe dans aucune table.
   */
  private decalageAtTime;
  get state(): StateId;
  /**
   * Rien n'est en cours a `now` hors de la vie au repos : ni fondu d'etat, ni morph de forme
   * ou de visage, ni clignement. C'est l'instant ou un bot en pause (`paused` du composant)
   * peut s'arreter sans figer un oeil a moitie ferme ni une pose a mi-chemin. Le regard n'y
   * est pas : c'est le composant qui le pose, et il sait quand il a fini. Lecture pure,
   * comme `sample`.
   */
  quiet(now: number): boolean;
  /**
   * Repart sur `id` SANS etat precedent, comme un moteur neuf pose sur cet etat.
   *
   * C'est ce que veut dire « rembobiner » pour ce moteur. `setState` seul ne peut pas le
   * faire : il garde l'etat quitte pour le fondre, ce qui est exactement son role en
   * lecture, et exactement ce qu'il ne faut pas quand on revient au debut d'une sequence.
   * Rejouer l'image 0 apres une passe complete melangeait le premier etat avec le DERNIER,
   * et l'export GIF s'ouvrait sur une boule sans yeux — la comete a un `eyeAlpha` nul.
   *
   * `sample` reste une fonction pure du temps : comme `setState`, ceci est un setter DATE,
   * appele par le pilote de la sequence, jamais pendant un echantillonnage.
   */
  reset(id: StateId, now: number): void;
  /**
   * Origine du fondu en cours : la pose figee s'il y en a une, sinon l'etat quitte evalue
   * a son propre temps ecoule — donc encore en train de s'animer, ce qui est voulu.
   */
  private origine;
  /**
   * Pose composite a l'instant `now`, fondu en cours compris : exactement ce que `sample`
   * melange, avant la couche de vie au repos et de regard. Extraite pour que `setState`
   * puisse la figer.
   */
  private poseComposee;
  /**
   * Decalage des yeux a l'instant `now`, fondu d'etat compris : il suit la MEME courbe que
   * la silhouette qui le motive, depuis le decalage fige s'il y en a un, sinon depuis celui
   * de l'etat quitte.
   */
  private decalageCompose;
  /**
   * Changement d'etat, date.
   *
   * Le moteur ne garde qu'UNE case d'historique, donc un changement qui arrive pendant un
   * fondu remplacait l'origine du melange par la pose PLEINE de l'etat qu'on quittait, au
   * lieu de l'image partiellement melangee qui etait a l'ecran. Mesure sur
   * `idle -> wide -> idle` a 100 ms : 35,9 px de saut contre 8,0 px de mouvement normal.
   *
   * On fige donc la pose composite courante et on melange depuis elle. Continu par
   * construction, quel que soit le nombre de changements enchaines.
   *
   * Et SEULEMENT dans ce cas. Figer a chaque changement arreterait net l'animation de
   * l'etat qu'on quitte pendant tout le fondu — le « ! » d'`alert` se figerait en pleine
   * course — alors qu'il n'y a rien a corriger hors morph : l'etat quitte y est deja
   * exactement l'image affichee. La lecture d'un montage, dont les blocs durent au moins
   * le plus long fondu (`MIN_BLOCK`), ne fige donc jamais rien et rend au bit ce qu'elle
   * rendait.
   *
   * `posePhase` avance la pose du nouvel etat sans toucher au fondu : un bot qui entre dans
   * un etat au milieu de son animation (cf. `initialPhase` du composant) morphe depuis
   * l'image a l'ecran, sur la duree normale, vers une pose deja en cours. A 0 — la valeur
   * par defaut — le rendu est celui d'avant, au bit pres.
   */
  setState(id: StateId, now: number, posePhase?: number): void;
  sample(now: number): BotFrame;
}
