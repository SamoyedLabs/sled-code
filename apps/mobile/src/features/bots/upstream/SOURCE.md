Static artwork and idle geometry ported from OpenBot maintained source, using @norbert_bodziony/bloub 0.6.3 (MIT). Body tint ramps, plushRestFrame, and seed mapping match apps/mobile/src/features/agents/model/plush and packages/brand/src/bloub-avatar.ts. Native images and SVG only; no Solid runtime. See BLOUB-LICENSE.

`chat-day-markers.ts` ports OpenBot mobile's `src/features/chat/model/chat-day-markers.ts`. It retains the one-pass date grouping and adapts OpenBot's translation and date formatter calls to Sled's UI.

`GroupAvatar.tsx` uses the four-member layout from OpenBot mobile's `src/features/channels/components/channel-avatar.tsx` with Sled's existing Bloub renderer and theme.

`openbot-mobile/` contains sources from the retained OpenBot mobile 1.4.6 tree. The iOS search mounts the original `GlassCapsule`. Its only source edits change local import paths. Typography metrics, Reduce Transparency handling, and the composer send gate are used directly from the imported source. Inter faces come from the same mobile tree. Sled keeps its own route and host adapters.

The native loader and update notice use OpenBot's original `bloub-eyes.tsx` animation and `splash-motion.ts` easing. The eye component uses a relative easing import and declares its upstream mood type locally. The lint annotations document its existing UI-thread effects. Sled supplies environment and update state through its existing runtime.

The iOS Usage view adapts OpenBot's `features/agents/components/usage-chart.tsx`, custom range controls, and native plan-limit row and header layouts. The shared report decoders preserve the workspace and per-agent response shapes. Sled supplies the actual usage readings through the paired host.

The Routines page adapts OpenBot's `features/servers/screens/server-routines-screen.tsx` day strip, Week and Day lists, and Upcoming section. It uses the shared calendar projection with Sled's existing owner and run queries and opens the selected routine in Sled's permission-aware editor.

The message-actions sheet uses the common reactions and order from `features/chat/screens/message-actions-screen.tsx`. Chat and group commands continue to use the per-host Sled API. The scoped Server settings entry follows the in-scope categories in `features/servers/screens/server-settings-screen.tsx` and routes to the existing Sled controls.

The iOS speech module and Supertonic 3 model pins come from the retained OpenBot mobile source. The reply reader uses the same voice indices, markdown normalization, language detection, and text splitting. Sled owns the per-chat playback lifecycle and persists its local voice selection separately.

`chat-colors.ts` comes from `packages/brand/src/chat-colors.ts` at OpenBot iOS 1.4.11 commit `a09baff9b760ed761a4e3eb0dc9d441db5b009cf`. Bot chat uses its message and background presets and contrast adjustment. Sled stores those preferences in its existing mobile storage.

The reply animation uses the word delays from OpenBot's `features/chat/model/reply-reveal.ts` with Sled's native selectable Markdown renderer. The typing dots run on the UI thread and stop when text arrives. The subagent and memory rows adapt the bounded message fields defined in the same 1.4.11 source.

The iOS chat gestures use the thresholds and direction from `features/chat/components/chat-end-pull.tsx` and `chat-message-gesture.tsx`. They open the scoped Sled bot, thread, browser, and group screens. `smaller-photo.ts` uses the same 2048-pixel, 80-percent JPEG resize for supported photos as the 1.4.11 source.

`workflow-flow-tree.ts` uses the 1.4.11 phone flow tree and its shared depth-first loop detection. `workflow-flow-edit.ts` uses the source insertion rules and desktop-grid coordinates with Sled's graph contracts. Each insertion remains in Sled's revision-aware draft until it is saved.

The native listening models and download hashes use the OpenBot iOS 1.4.11 voice pins. The Sled microphone integration runs the selected local recognizer on an app-owned recording and retains the same output-only playback path.

Sled uses the 1.4.11 picked-file limit of 100 MiB for Bots. The iOS upload and the Sled host stream bytes from disk into the linked engine. The general Code attachment limit remains 50 MiB.

The live reply reader follows OpenBot 1.4.11's `reply-voice.ts` timing. It holds the last unfinished speech part and starts native playback as each earlier part stabilizes. The voice server uses that release's OpenAI-compatible route names, model discovery and WAV rules. The Sled implementation keeps the endpoint and API key together in its own device Keychain record.

`openbot-mobile/features/servers/model/library-bento.ts` is the unchanged OpenBot 1.4.11 phone Library grid from commit `a09baff9b760ed761a4e3eb0dc9d441db5b009cf`. Sled supplies the scoped inventory, folder actions and attachment previews through its paired host.

The roster adopts the 1.4.11 sidebar ordering and folder tree, the wait priority from `features/workspace/model/agent-activity.ts`, and the unread and wait badges from `features/agents/components`. Sled supplies the roster and pending requests from the selected paired host. Its labels and navigation use the existing native controls.

`openbot-mobile/chat-preview/reply-playback.ts` ports the 1.4.11 word schedule and backlog handling from `reply-reveal.ts` and `use-reply-playback.ts`. One playback timer consumes the current host text across updates. Direct chats acknowledge the latest visible reply through Sled's scoped conversation API, following `features/chat/components/chat-view.tsx`.
