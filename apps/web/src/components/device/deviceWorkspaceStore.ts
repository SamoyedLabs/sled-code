import type { ScopedThreadRef } from "@t3tools/contracts";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { create } from "zustand";

interface Workspace {
  mode: "grid" | "focus";
  selected: string | null;
  hidden: readonly string[];
  picker: boolean;
}

export const deviceWorkspaceKey = (hostId: string, deviceId: string) =>
  `${hostId}\u0000${deviceId}`;

export const useDeviceWorkspaceStore = create<{
  byThreadKey: Record<string, Workspace>;
  update: (ref: ScopedThreadRef, patch: Partial<Workspace>) => void;
  leave: (ref: ScopedThreadRef) => void;
}>((set) => ({
  byThreadKey: {},
  update: (ref, patch) =>
    set((state) => ({
      byThreadKey: {
        ...state.byThreadKey,
        [scopedThreadKey(ref)]: {
          mode: "grid",
          selected: null,
          hidden: [],
          picker: false,
          ...state.byThreadKey[scopedThreadKey(ref)],
          ...patch,
        },
      },
    })),
  leave: (ref) =>
    set((state) => {
      const { [scopedThreadKey(ref)]: _removed, ...byThreadKey } = state.byThreadKey;
      return { byThreadKey };
    }),
}));
