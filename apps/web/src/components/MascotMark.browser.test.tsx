import { RegistryContext } from "@effect/atom-react";
import type { MascotActivity } from "@t3tools/client-runtime/state/mascot-activity";
import { Atom, AtomRegistry } from "effect/reactivity";
import { StrictMode } from "react";
import { expect, it, vi } from "vite-plus/test";

import { act, render } from "../../test/render";
import { mascotActivityAtom } from "../state/mascot";
import { MascotMark } from "./MascotMark";
import styles from "./MascotMark.module.css";

vi.mock(import("../state/mascot"), async () => {
  const { Atom } = await import("effect/reactivity");
  return {
    mascotActivityAtom: Atom.make<MascotActivity>({ state: "sleeping", completionKey: null }),
  };
});

function setup() {
  const disposables = new DisposableStack();
  const registry = AtomRegistry.make();
  disposables.defer(() => registry.dispose());
  if (!Atom.isWritable<MascotActivity, MascotActivity>(mascotActivityAtom)) {
    throw new Error("The activity fixture must be writable.");
  }
  const activityAtom = mascotActivityAtom;
  let visibility: DocumentVisibilityState = "visible";
  let reduced = false;
  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  disposables.use(
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility),
  );
  disposables.use(vi.spyOn(media, "matches", "get").mockImplementation(() => reduced));
  disposables.use(vi.spyOn(window, "matchMedia").mockReturnValue(media));
  return {
    registry,
    async setActivity(activity: MascotActivity) {
      await act(() => registry.set(activityAtom, activity));
    },
    async setVisible(visible: boolean) {
      await act(() => {
        visibility = visible ? "visible" : "hidden";
        document.dispatchEvent(new Event("visibilitychange"));
      });
    },
    async setReduced(next: boolean) {
      await act(() => {
        reduced = next;
        media.dispatchEvent(new MediaQueryListEvent("change", { matches: reduced }));
      });
    },
    [Symbol.dispose]() {
      disposables.dispose();
    },
  };
}

function animations(root: HTMLElement) {
  return root.getAnimations({ subtree: true });
}

function celebrations(root: HTMLElement) {
  return animations(root).filter((animation) => !(animation instanceof CSSAnimation));
}

it("animates the active status and stops every loop when hidden, reduced, offline, or failed", async () => {
  using context = setup();
  await using screen = await render(
    <RegistryContext.Provider value={context.registry}>
      <MascotMark />
    </RegistryContext.Provider>,
    { router: false /* mascot activity is supplied by the isolated registry */ },
  );
  const root = screen.container.querySelector<HTMLElement>(`.${styles["sled-mascot"]}`)!;
  const target = (name: string) => root.querySelector<HTMLElement>(`.${styles[name]}`)!;

  expect(target("mascot-dog").getAnimations()).not.toHaveLength(0);
  for (const letter of target("mascot-zzz").children) {
    expect(letter.getAnimations()).not.toHaveLength(0);
  }

  await context.setActivity({ state: "working", completionKey: null });
  await vi.waitFor(() => expect(target("mascot-ear-right").getAnimations()).not.toHaveLength(0));
  for (const dot of target("mascot-bubble-dots").children) {
    expect(dot.getAnimations()).not.toHaveLength(0);
  }
  await context.setActivity({ state: "attention", completionKey: null });
  await vi.waitFor(() => expect(target("mascot-ear-left").getAnimations()).not.toHaveLength(0));
  expect(target("mascot-ear-right").getAnimations()).not.toHaveLength(0);
  expect(target("mascot-pant").getAnimations()).not.toHaveLength(0);
  expect(target("mascot-attention").getAnimations()).not.toHaveLength(0);

  await context.setVisible(false);
  await vi.waitFor(() => expect(animations(root)).toHaveLength(0));
  await context.setVisible(true);
  await vi.waitFor(() => expect(animations(root).length).toBeGreaterThan(0));
  expect(celebrations(root)).toHaveLength(0);

  await context.setReduced(true);
  await vi.waitFor(() => expect(animations(root)).toHaveLength(0));
  await context.setReduced(false);
  await vi.waitFor(() => expect(animations(root).length).toBeGreaterThan(0));
  expect(celebrations(root)).toHaveLength(0);

  for (const state of ["offline", "error"] as const) {
    await context.setActivity({ state, completionKey: null });
    await vi.waitFor(() => expect(animations(root)).toHaveLength(0));
  }
});

it("celebrates a new visible completion once without replaying snapshots or suppressed completions", async () => {
  using context = setup();
  await context.setActivity({ state: "sleeping", completionKey: "already-completed" });
  await using screen = await render(
    <StrictMode>
      <RegistryContext.Provider value={context.registry}>
        <MascotMark />
      </RegistryContext.Provider>
    </StrictMode>,
    { router: false /* mascot activity is supplied by the isolated registry */ },
  );
  const root = screen.container.querySelector<HTMLElement>(`.${styles["sled-mascot"]}`)!;
  expect(celebrations(root)).toHaveLength(0);

  await context.setActivity({ state: "working", completionKey: "already-completed" });
  await context.setActivity({ state: "sleeping", completionKey: "completed-now" });
  await vi.waitFor(() => expect(celebrations(root).length).toBeGreaterThan(0));
  const firstCelebration = celebrations(root);
  const dog = root.querySelector(`.${styles["mascot-dog"]}`);
  expect(
    firstCelebration.filter(
      (animation) => animation.effect instanceof KeyframeEffect && animation.effect.target === dog,
    ),
  ).toHaveLength(1);
  for (const animation of firstCelebration) animation.pause();

  await context.setActivity({ state: "sleeping", completionKey: "completed-now" });
  expect(celebrations(root)).toEqual(firstCelebration);
  await screen.rerender(
    <StrictMode>
      <RegistryContext.Provider value={context.registry}>
        <MascotMark />
      </RegistryContext.Provider>
    </StrictMode>,
  );
  expect(celebrations(root)).toEqual(firstCelebration);

  for (const animation of firstCelebration) animation.finish();
  expect(celebrations(root)).toHaveLength(0);
  await context.setVisible(false);
  await context.setVisible(true);
  expect(celebrations(root)).toHaveLength(0);

  await context.setVisible(false);
  await context.setActivity({ state: "sleeping", completionKey: "completed-offscreen" });
  await context.setVisible(true);
  expect(celebrations(root)).toHaveLength(0);
  await context.setReduced(true);
  await context.setActivity({ state: "sleeping", completionKey: "completed-with-reduced-motion" });
  await context.setReduced(false);
  expect(celebrations(root)).toHaveLength(0);

  await context.setActivity({ state: "sleeping", completionKey: "another-completion" });
  await vi.waitFor(() => expect(celebrations(root).length).toBeGreaterThan(0));
  await context.setActivity({ state: "working", completionKey: "another-completion" });
  await vi.waitFor(() => expect(celebrations(root)).toHaveLength(0));
});
