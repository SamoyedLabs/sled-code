import { useEffect, useState, useSyncExternalStore } from "react";

import productionFur from "../../../../assets/branding/startup/fur.png";
import productionLeftEar from "../../../../assets/branding/startup/ear-left.png";
import productionRightEar from "../../../../assets/branding/startup/ear-right.png";
import productionLeftEye from "../../../../assets/branding/startup/eye-left.png";
import productionRightEye from "../../../../assets/branding/startup/eye-right.png";
import productionNose from "../../../../assets/branding/startup/nose.png";
import productionMouth from "../../../../assets/branding/startup/mouth.png";
import productionTongue from "../../../../assets/branding/startup/tongue.png";
import developmentFur from "../../../../assets/branding/startup-dev/fur.png";
import developmentLeftEar from "../../../../assets/branding/startup-dev/ear-left.png";
import developmentRightEar from "../../../../assets/branding/startup-dev/ear-right.png";
import developmentLeftEye from "../../../../assets/branding/startup-dev/eye-left.png";
import developmentRightEye from "../../../../assets/branding/startup-dev/eye-right.png";
import developmentNose from "../../../../assets/branding/startup-dev/nose.png";
import developmentMouth from "../../../../assets/branding/startup-dev/mouth.png";
import developmentTongue from "../../../../assets/branding/startup-dev/tongue.png";
import { APP_MASCOT_VARIANT } from "../branding";
import { getDocumentActivity, subscribeDocumentActivity } from "../lib/documentActivity";
import geometry from "../../../../assets/branding/startup/geometry.json";
import styles from "./StartupSplash.module.css";

const fur = APP_MASCOT_VARIANT === "development" ? developmentFur : productionFur;
const leftEar = APP_MASCOT_VARIANT === "development" ? developmentLeftEar : productionLeftEar;
const rightEar = APP_MASCOT_VARIANT === "development" ? developmentRightEar : productionRightEar;
const leftEye = APP_MASCOT_VARIANT === "development" ? developmentLeftEye : productionLeftEye;
const rightEye = APP_MASCOT_VARIANT === "development" ? developmentRightEye : productionRightEye;
const nose = APP_MASCOT_VARIANT === "development" ? developmentNose : productionNose;
const mouth = APP_MASCOT_VARIANT === "development" ? developmentMouth : productionMouth;
const tongue = APP_MASCOT_VARIANT === "development" ? developmentTongue : productionTongue;
const rest = APP_MASCOT_VARIANT === "development" ? "/sled-startup-dev.png" : "/sled-startup.png";

const layers = [
  { src: leftEar, className: styles.leftEar, pivot: geometry["ear-left"] },
  { src: rightEar, className: styles.rightEar, pivot: geometry["ear-right"] },
  { src: fur },
  { src: tongue, className: styles.tongue, pivot: geometry.tongue },
  { src: mouth },
  { src: nose, className: styles.nose, pivot: geometry.nose },
  { src: leftEye, className: styles.eye, pivot: geometry["eye-left"] },
  { src: rightEye, className: styles.eye, pivot: geometry["eye-right"] },
];

let startupFinished = false;
const isDocumentVisible = () => getDocumentActivity().visible;
const hiddenBeforeHydration = () => false;

export function StartupSplash() {
  const visible = useSyncExternalStore(
    subscribeDocumentActivity,
    isDocumentVisible,
    hiddenBeforeHydration,
  );
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  const [finished, setFinished] = useState(() => startupFinished);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- decode the raster layers before replacing the already painted boot pose
  useEffect(() => {
    if (finished) return;
    let active = true;
    void Promise.all(
      layers.map(({ src }) => {
        const image = new Image();
        image.src = src;
        return image.decode();
      }),
    ).then(
      () => {
        if (active) setPlaying(true);
      },
      () => {
        if (active) {
          setFailed(true);
          setPlaying(true);
        }
      },
    );
    return () => {
      active = false;
    };
  }, [finished]);

  if (finished) return null;

  return (
    <div
      className={styles.splash}
      data-playing={playing}
      data-failed={failed}
      data-hidden={!visible}
      aria-hidden="true"
      onAnimationEnd={(event) => {
        if (event.target === event.currentTarget) {
          startupFinished = true;
          setFinished(true);
        }
      }}
    >
      <div className={styles.dog}>
        {!playing || failed ? (
          <img className={styles.layer} src={rest} alt="" draggable={false} />
        ) : (
          layers.map(({ src, className, pivot }) => (
            <img
              key={src}
              className={`${styles.layer} ${className ?? ""}`}
              style={
                pivot
                  ? { transformOrigin: `${pivot.pivotX * 100}% ${pivot.pivotY * 100}%` }
                  : undefined
              }
              src={src}
              alt=""
              draggable={false}
            />
          ))
        )}
      </div>
    </div>
  );
}
