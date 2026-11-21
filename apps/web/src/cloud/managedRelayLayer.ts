import { DpopProof, ManagedRelay } from "@t3tools/client-runtime/relay";
import { savedPersonalRelayUrl } from "./personalRelay";
import { RelayWebClientId } from "@t3tools/contracts/relay";
import * as Layer from "effect/Layer";

import { loadOrCreateProofKey } from "./dpop";

const layerRelayDpopSigner = DpopProof.layerSigner({
  keyStore: "indexed-db",
  loadOrCreateKey: loadOrCreateProofKey(),
});

export const layer = (relayUrl: string) =>
  ManagedRelay.layer({
    relayUrl,
    clientId: RelayWebClientId,
    // Personal relays may not opt into cross-origin diagnostic headers.
    propagateTraceContext: savedPersonalRelayUrl() === null,
  }).pipe(Layer.provideMerge(layerRelayDpopSigner));
