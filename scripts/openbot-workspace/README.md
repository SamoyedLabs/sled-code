# Building the embedded Bots workspace

From the Sled repository root, use a maintained OpenBot checkout with its locked dependencies already installed:

```sh
OPENBOT_SOURCE_DIRECTORY=/absolute/path/to/openbot node scripts/openbot-workspace/prepare-renderer.mjs
OPENBOT_SOURCE_DIRECTORY=/absolute/path/to/openbot node scripts/openbot-workspace/prepare-renderer.mjs --apply
OPENBOT_SOURCE_DIRECTORY=/absolute/path/to/openbot node scripts/openbot-workspace/build.mjs
```

The renderer patch and manifest live here in `upstream-renderer.patch` and `upstream-renderer.json`. They cover the upstream UI joins, independently of the engine/backend integration patch. Preparation checks every original hash before applying and every final hash afterward. An already prepared checkout is a no-op; changed files, mixed old/new states and linked source directories are refused without overwriting edits. Apply the existing backend integration to the maintained upstream checkout separately. The build verifies the renderer finals before invoking Vite and records this manifest in `build.json`.

This compiles the genuine upstream `WebWorkspace` using that checkout's pinned Solid 2 toolchain. React does not compile the upstream TSX. Generated assets go into the ignored `apps/web/public/openbot-workspace`; the ordinary web build copies them into the client also used by desktop. Set the same variable on a web/desktop build to regenerate them, or build first; cached assets must match the entry and payload hashes in `build.json`. Reload an already open workspace after rebuilding its assets.

`build.json` records the entry files, upstream source inputs, package/lock hashes, and full output payload. It identifies the frontend, independently of the engine candidate and backend source. Rebuild when the maintained upstream source or dependencies change.

For desktop, use the repository `build:desktop` workflow before packaging. `--skip-build` packages `apps/server/dist/client`, not `apps/web/dist`; a web-only rebuild must pass through `apps/server/scripts/cli.ts build` to stage the new client before `--skip-build`. Check the packaged client payload against that staged output. A new app version alone does not prove a new workspace bundle.

The parent React root transfers a MessagePort only to its same-origin iframe. The adapter translates allowed upstream routes into existing typed, host-bound Sled RPCs, which retain their server authorization. It does not forward arbitrary owner HTTP requests. The iframe isolates CSS and the Solid runtime; it is trusted application code, not an untrusted-content sandbox.

The current adapter connects roster, conversations, task lifecycle, thread read/rename/delete/branch controls and task replies, group/channel navigation and controls, agent/memory/routine controls, the existing pinned settings routes, and bounded host/agent analytics reads. Original conversation attachment preview/download and workspace file/directory reads use Sled materialization and asset services; no asset credential reaches the iframe. The preview bridge is capped at10MB and refuses ambiguous original-message identities. Guarded Files upload/send, queue attachment edits and protected forms open the existing Sled controllers, preserving original identities, consent and receipt-only recovery. Browser and computer viewers use their scoped Sled session services. Group and selected memory/routine views refresh from canonical events, including coalesced invalidations. Cloud account operations and other unmapped routes remain explicitly unsupported; do not route them through generic prompt or owner calls. Legacy workspace remains available during completion. Shared web output is not evidence of packaged desktop acceptance.
