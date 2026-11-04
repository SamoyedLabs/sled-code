import * as DateTime from "effect/DateTime";

// @effect-diagnostics-next-line globalDate:off - Cloudflare Worker clock boundary.
export const workerNow = () => Date.now();
// @effect-diagnostics-next-line cryptoRandomUUID:off - Cloudflare Worker entropy boundary.
export const workerUuid = () => crypto.randomUUID();
export const workerIsoDate = (milliseconds?: number) =>
  DateTime.formatIso(DateTime.makeUnsafe(milliseconds ?? workerNow()));
// @effect-diagnostics-next-line globalFetch:off - Cloudflare Worker HTTP boundary.
export const workerFetch = (input: string | Request, init?: RequestInit) => fetch(input, init);
