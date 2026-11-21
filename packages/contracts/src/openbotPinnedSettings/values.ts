// Adapted from nightly-labs/openbot 0.60.0, 0c7753fa622c38419939cd230657f40e5883d098.
// Copyright upstream authors; see LICENSE.upstream. Only import paths/types adapted.
export type PinnedJson =
  | null
  | boolean
  | number
  | string
  | PinnedJson[]
  | { [key: string]: PinnedJson };
export const OPEN_PROVIDER_ID = /^[a-z][a-z0-9-]{0,63}$/u;
