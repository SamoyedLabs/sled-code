import { useEffect, useState } from "react";
import { useStableCallback } from "../../../hooks/useStableCallback";
import {
  readThreadTabLayout,
  writeThreadTabLayout,
  THREAD_LAYOUT_STORAGE,
  type OpenbotThreadTabLayout,
} from "./openbotThreadTabLayout";
export function useOpenbotThreadTabLayout(scopeKey: string, initialIds: readonly string[] = []) {
  const initial = () => {
    try {
      return (
        readThreadTabLayout(scopeKey, window.localStorage) ?? {
          open: [...initialIds],
          active: null,
          side: [],
        }
      );
    } catch {
      return { open: [...initialIds], active: null, side: [] };
    }
  };
  const [stored, setStored] = useState(() => ({ scopeKey, layout: initial() }));
  if (stored.scopeKey !== scopeKey) setStored({ scopeKey, layout: initial() });
  const setLayout = useStableCallback(
    (layout: OpenbotThreadTabLayout, destinationScope: string = scopeKey) => {
      try {
        writeThreadTabLayout(destinationScope, layout, window.localStorage);
      } catch {
        /* Storage can be disabled for this origin. */
      }
      setStored({ scopeKey: destinationScope, layout });
    },
  );
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- This device preference follows other windows without changing host task state.
  useEffect(() => {
    const update = (event: StorageEvent) => {
      if (event.key !== THREAD_LAYOUT_STORAGE) return;
      try {
        const layout = readThreadTabLayout(scopeKey, window.localStorage);
        if (layout) setStored({ scopeKey, layout });
      } catch {
        /* Keep the mounted layout if the origin disables storage. */
      }
    };
    window.addEventListener("storage", update);
    return () => window.removeEventListener("storage", update);
  }, [scopeKey]);
  return [stored.layout, setLayout] as const;
}
