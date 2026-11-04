import { useAtomValue } from "@effect/atom-react";
import { MASCOT_ACTIVITY_LABELS } from "@t3tools/client-runtime/state/mascot-activity";
import { useEffect, useRef, useSyncExternalStore, type CSSProperties } from "react";

import speechBubble from "../../../../assets/branding/mascot/speech-bubble.png";
import productionFur from "../../../../assets/branding/mascot/fur.png";
import productionLeftEye from "../../../../assets/branding/mascot/eye-left.png";
import productionRightEye from "../../../../assets/branding/mascot/eye-right.png";
import productionClosed from "../../../../assets/branding/mascot/closed.png";
import productionTongue from "../../../../assets/branding/mascot/tongue.png";
import productionLeftEar from "../../../../assets/branding/mascot/ear-left.png";
import productionRightEar from "../../../../assets/branding/mascot/ear-right.png";
import productionClosedMouth from "../../../../assets/branding/mascot/closed-mouth.png";
import productionPantMouth from "../../../../assets/branding/mascot/pant-mouth.png";
import developmentFur from "../../../../assets/branding/mascot-dev/fur.png";
import developmentLeftEye from "../../../../assets/branding/mascot-dev/eye-left.png";
import developmentRightEye from "../../../../assets/branding/mascot-dev/eye-right.png";
import developmentClosed from "../../../../assets/branding/mascot-dev/closed.png";
import developmentTongue from "../../../../assets/branding/mascot-dev/tongue.png";
import developmentLeftEar from "../../../../assets/branding/mascot-dev/ear-left.png";
import developmentRightEar from "../../../../assets/branding/mascot-dev/ear-right.png";
import developmentClosedMouth from "../../../../assets/branding/mascot-dev/closed-mouth.png";
import developmentPantMouth from "../../../../assets/branding/mascot-dev/pant-mouth.png";
import { APP_MASCOT_VARIANT } from "../branding";
import geometry from "../../../../assets/branding/mascot/geometry.json";
import { mascotActivityAtom } from "../state/mascot";
import { useMediaQuery } from "../hooks/useMediaQuery";
import styles from "./MascotMark.module.css";

const fur = APP_MASCOT_VARIANT === "development" ? developmentFur : productionFur;
const leftEye = APP_MASCOT_VARIANT === "development" ? developmentLeftEye : productionLeftEye;
const rightEye = APP_MASCOT_VARIANT === "development" ? developmentRightEye : productionRightEye;
const closed = APP_MASCOT_VARIANT === "development" ? developmentClosed : productionClosed;
const tongue = APP_MASCOT_VARIANT === "development" ? developmentTongue : productionTongue;
const leftEar = APP_MASCOT_VARIANT === "development" ? developmentLeftEar : productionLeftEar;
const rightEar = APP_MASCOT_VARIANT === "development" ? developmentRightEar : productionRightEar;
const closedMouth =
  APP_MASCOT_VARIANT === "development" ? developmentClosedMouth : productionClosedMouth;
const pantMouth = APP_MASCOT_VARIANT === "development" ? developmentPantMouth : productionPantMouth;

function subscribeVisibility(notify: () => void) {
  document.addEventListener("visibilitychange", notify);
  return () => document.removeEventListener("visibilitychange", notify);
}
const isVisible = () => document.visibilityState === "visible";
const serverVisible = () => false;

export function MascotMark() {
  const activity = useAtomValue(mascotActivityAtom);
  const visible = useSyncExternalStore(subscribeVisibility, isVisible, serverVisible);
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
  const dog = useRef<HTMLSpanElement>(null);
  const previousCompletion = useRef(activity.completionKey);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- synchronize a one-shot compositor animation with a newly observed completion
  useEffect(() => {
    const changed = previousCompletion.current !== activity.completionKey;
    previousCompletion.current = activity.completionKey;
    if (
      !changed ||
      activity.completionKey === null ||
      !visible ||
      reduced ||
      activity.state !== "sleeping" ||
      !dog.current
    )
      return;
    const animations = [
      dog.current.animate(
        [
          { transform: "translateY(0) rotate(0deg)" },
          { transform: "translateY(1px) rotate(0deg)", offset: 0.15 },
          { transform: "translateY(-2.3px) rotate(0deg)", offset: 0.45 },
          { transform: "translateY(0) rotate(0deg)", offset: 0.8 },
          { transform: "translateY(0) rotate(3deg)" },
        ],
        { duration: 850, easing: "cubic-bezier(.23,1,.32,1)" },
      ),
    ];
    for (const el of dog.current.querySelectorAll(`.${styles["mascot-eye"]}`)) {
      animations.push(el.animate([{ opacity: 1 }, { opacity: 1 }], { duration: 850 }));
    }
    const closedEyes = dog.current.querySelector(`.${styles["mascot-closed"]}`);
    if (closedEyes)
      animations.push(closedEyes.animate([{ opacity: 0 }, { opacity: 0 }], { duration: 850 }));
    const blep = dog.current.querySelector(`.${styles["mascot-tongue"]}`);
    if (blep)
      animations.push(
        blep.animate(
          [
            { opacity: 0 },
            { opacity: 0, offset: 0.5 },
            { opacity: 1, offset: 0.6 },
            { opacity: 1, offset: 0.85 },
            { opacity: 0 },
          ],
          { duration: 850 },
        ),
      );
    return () => animations.forEach((animation) => animation.cancel());
  }, [activity.completionKey, activity.state, reduced, visible]);

  return (
    <span
      className={styles["sled-mascot"]}
      data-state={activity.state}
      data-paused={!visible || reduced}
      role="img"
      aria-label={`Sled: ${MASCOT_ACTIVITY_LABELS[activity.state]}`}
    >
      <span className={styles["mascot-dog"]} ref={dog}>
        <img
          src={leftEar}
          alt=""
          className={`${styles["mascot-layer"]} ${styles["mascot-ear-left"]}`}
          style={{
            transformOrigin: `${geometry["ear-left"].pivotX * 100}% ${geometry["ear-left"].pivotY * 100}%`,
          }}
          draggable={false}
        />
        <img
          src={rightEar}
          alt=""
          className={`${styles["mascot-layer"]} ${styles["mascot-ear-right"]}`}
          style={{
            transformOrigin: `${geometry["ear-right"].pivotX * 100}% ${geometry["ear-right"].pivotY * 100}%`,
          }}
          draggable={false}
        />
        <img src={fur} alt="" className={styles["mascot-layer"]} draggable={false} />
        <img
          src={closedMouth}
          alt=""
          className={`${styles["mascot-layer"]} ${styles["mascot-mouth"]}`}
          draggable={false}
        />
        {(
          [
            ["eye-left", leftEye],
            ["eye-right", rightEye],
          ] as const
        ).map(([key, src]) => {
          const bounds = geometry[key];
          const style: CSSProperties = {
            left: `${bounds.left * 100}%`,
            top: `${bounds.top * 100}%`,
            width: `${bounds.width * 100}%`,
            height: `${bounds.height * 100}%`,
          };
          return (
            <span key={key} className={styles["mascot-eye"]} style={style}>
              <img src={src} alt="" draggable={false} />
            </span>
          );
        })}
        <img
          src={closed}
          alt=""
          className={`${styles["mascot-layer"]} ${styles["mascot-closed"]}`}
          draggable={false}
        />
        <img
          src={tongue}
          alt=""
          className={`${styles["mascot-layer"]} ${styles["mascot-tongue"]}`}
          draggable={false}
        />
        <img
          src={pantMouth}
          alt=""
          className={`${styles["mascot-layer"]} ${styles["mascot-pant"]}`}
          draggable={false}
        />
      </span>
      <span className={styles["mascot-zzz"]} aria-hidden="true">
        <span>z</span>
        <span>z</span>
        <span>Z</span>
      </span>
      <span className={styles["mascot-attention"]} aria-hidden="true">
        <span>!</span>
        <span>!</span>
      </span>
      <span className={styles["mascot-bubbles"]} aria-hidden="true">
        <span className={styles["mascot-bubble"]}>
          <img
            src={speechBubble}
            alt=""
            className={styles["mascot-bubble-shape"]}
            draggable={false}
          />
          <span className={styles["mascot-bubble-dots"]}>
            <i />
            <i />
            <i />
          </span>
        </span>
      </span>
    </span>
  );
}
