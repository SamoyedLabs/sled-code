// Leave the rest of the row available for its own swipe actions.
export const BOTS_SCREEN_EDGE_WIDTH = 56;

export function isBotsEdgeRoot(routeName: string) {
  return routeName === "Home" || routeName === "Thread";
}

export function shouldOpenBots(
  routeName: string,
  translationX: number,
  translationY: number,
  velocityX = 0,
) {
  return isBotsEdgeRoot(routeName) && isCommittedRightSwipe(translationX, translationY, velocityX);
}

export function isCommittedRightSwipe(
  translationX: number,
  translationY: number,
  velocityX: number,
) {
  "worklet";
  return (
    translationX > Math.abs(translationY) * 1.25 &&
    (translationX >= 64 || (translationX >= 28 && velocityX >= 650))
  );
}
