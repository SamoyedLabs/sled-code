import { createMascotActivityAtom } from "@t3tools/client-runtime/state/mascot-activity";

import { environmentCatalog } from "../connection/catalog";
import { environmentThreadShells } from "./threads";

export const mascotActivityAtom = createMascotActivityAtom({
  catalogValueAtom: environmentCatalog.catalogValueAtom,
  connectionStateAtom: environmentCatalog.stateAtom,
  threadShellsAtom: environmentThreadShells.visibleThreadShellsAtom,
});
