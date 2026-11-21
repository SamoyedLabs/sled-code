# New Agent source port

OpenBot 0.60.0, commit `0c7753fa622c38419939cd230657f40e5883d098`; [license](../OPENBOT-LICENSE).

The shipped root creation UI is `packages/ui/src/features/agents/FirstAgentSetup.tsx`, mounted by renderer `features/web-client/WebAgentSettings.tsx`; there is no CreateAgentDialog in this source version. The port preserves its identity header, live avatar, twelve source face seeds, automatic plus ten color choices, name/instructions fields, model picker, and six exact English suggestions. `first-agent-setup.css` is copied and scoped; the sole layout adapter supplies the existing conversation-panel flex behavior. Suggestion scrolling keeps the source 8px drag threshold, 0.88 friction, 1.75 velocity cap, edge fading, finite momentum, reduced-motion behavior, pointer capture, and Escape cleanup. Avatar rendering uses the existing shared OpenBot avatar engine.

`agent-draft.ts` preserves the source suggestion matching, role-message construction, and the joined-host branch of `agent-creation-model.ts`. The existing shared Provider context supplies actual models, provider state, custom endpoints, and custom agents. The provider/model/reasoning pair travels only when the host advertises agent-create-model and the model exists in the current catalog. No provider is launched or installed by selecting a model.

`SourceCreateAgent` accepts environmentId, hostId, first?, initialDraft?, onDraftChange?, onCancel?, onCreated(agentId), and onManageProviders?. Its full source main panel replaces the former creation form. It creates only on explicit submission. It checks original retained session and permission before sending; dropped/ambiguous responses retain the submitted draft on that exact session and block repeat creation. An accepted agent ID survives a failed navigation, so Open created agent retries navigation only. No generated IDs are sent as real agents.

The original create route accepts name, description, avatarSeed, avatarHue, initialMessage, and optional provider/model/reasoningEffort. It does not accept title. The separate released profile-generation/profile-save APIs are unused by this root UI and are intentionally not presented as invented UI actions.

Validation: four focused tests cover source suggestion edits/model preservation, initial role messages and avatar metadata, provider availability/reasoning compatibility, and session-scoped uncertain/accepted creation receipts. Scoped lint and web typecheck pass. Runtime QA belongs to the parent integration task.
