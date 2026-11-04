import { StrictMode } from "react";
import { expect, it, vi } from "vite-plus/test";

import { act, render } from "../../test/render";
import { StartupSplash } from "./StartupSplash";
import styles from "./StartupSplash.module.css";

it("finishes every visible character beat before fading, pauses offscreen, and never replays on remount", async () => {
  let visibility: DocumentVisibilityState = "hidden";
  using _visibility = vi
    .spyOn(document, "visibilityState", "get")
    .mockImplementation(() => visibility);
  using _decode = vi.spyOn(HTMLImageElement.prototype, "decode").mockResolvedValue();
  await using screen = await render(
    <StrictMode>
      <StartupSplash />
    </StrictMode>,
    { router: false /* the startup lifecycle has no routes */ },
  );

  const splash = screen.container.querySelector<HTMLElement>(`.${styles.splash}`)!;
  await vi.waitFor(() => expect(splash.dataset.playing).toBe("true"));
  const animations = splash.getAnimations({ subtree: true });
  expect(animations.length).toBeGreaterThan(1);
  expect(animations.every((animation) => animation.playState === "paused")).toBe(true);
  for (const animation of animations) {
    expect(animation.currentTime).toBe(0);
    animation.playbackRate = 0;
  }

  const setVisibility = async (next: DocumentVisibilityState) => {
    await act(() => {
      visibility = next;
      document.dispatchEvent(new Event("visibilitychange"));
    });
  };
  await setVisibility("visible");
  await vi.waitFor(() =>
    expect(animations.every((animation) => animation.playState === "running")).toBe(true),
  );
  for (const animation of animations) animation.currentTime = 470;
  await setVisibility("hidden");
  await vi.waitFor(() =>
    expect(animations.every((animation) => animation.playState === "paused")).toBe(true),
  );
  await setVisibility("visible");
  await vi.waitFor(() =>
    expect(animations.every((animation) => animation.playState === "running")).toBe(true),
  );

  const tongue = splash.querySelector<HTMLElement>(`.${styles.tongue}`)!;
  for (const animation of animations) {
    animation.pause();
    animation.currentTime = 780;
  }
  expect(getComputedStyle(splash).opacity).toBe("1");
  expect(getComputedStyle(tongue).opacity).toBe("1");
  for (const animation of animations) animation.currentTime = 890;
  expect(getComputedStyle(tongue).opacity).toBe("0");
  expect(Number(getComputedStyle(splash).opacity)).toBeLessThan(1);
  expect(Number(getComputedStyle(splash).opacity)).toBeGreaterThan(0);

  const exit = splash.getAnimations()[0]!;
  await act(() => {
    exit.playbackRate = 1;
    exit.finish();
  });
  await vi.waitFor(() => expect(screen.container.querySelector(`.${styles.splash}`)).toBeNull());

  await screen.rerender(
    <StrictMode>
      <StartupSplash key="new-root" />
    </StrictMode>,
  );
  expect(screen.container.querySelector(`.${styles.splash}`)).toBeNull();
});
