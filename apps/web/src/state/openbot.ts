import { createOpenbotAtoms } from "@t3tools/client-runtime/openbot";
import { connectionAtomRuntime } from "../connection/runtime";

export const openbot = createOpenbotAtoms(connectionAtomRuntime);
