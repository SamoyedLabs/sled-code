# OpenBot 0.60.0 provider and usage translation

Pinned source: `.openbot-build/source` of the maintenance bundle, version 0.60.0. The parent directory's `OPENBOT-LICENSE` applies to the copied code and geometry.

React translations retain source DOM classes and styles from:

- `packages/ui/src/components/ProviderModelPicker.tsx`, `provider-model-options.ts`, `provider-accounts.ts`, `SwapLabel.tsx`, and `createScrollFades.ts`.
- `packages/ui/src/features/conversation/styles/header-controls.css` (provider picker rules).
- `packages/ui/src/features/window/PageRail.tsx` and `page-rail.css` (usage rings and custom-agent usage buttons).
- `packages/ui/src/features/account/AccountUsageDetails.tsx`, `account-usage-view.ts`, and account usage rules in `src/renderer/src/styles/app-shell.css`.
- `src/renderer/src/features/usage/AgentUsagePanel.tsx`, `usage.css`, `packages/ui/src/features/usage/AgentUsageReport.tsx`, `UsageChart.tsx`, `usage-format.ts`, and `agent-usage-report.css`.
- `packages/ui/src/chart.tsx`, `styles/chart.css`, `styles/sliding-tabs.css`, select/switch rules from `styles/primitives.css`, and `switch.tsx` spring/drag integration.
- `packages/contracts/src/agent-providers.ts` (identity descriptor projection and quota rules), `ipc-agent-status.ts`, `ipc-agent-identity.ts`, `ipc-agent-analytics.ts`, and `ipc-host-analytics.ts` (read shapes).
- `packages/team-client/src/plan-limits.ts` (pure quota helpers), `usage-series.ts`, `packages/brand/src/provider-logo-shape.ts`, and `packages/i18n/src/messages/en/{provider,account,usage,app,common}.ts`.

Base UI supplies React focus, dismissal, selection and portal lifecycles; the existing `openbotMenuMotion` supplies mounted exit motion. `SourceSwitch` keeps the source 520/32 spring, velocity stretch, drag threshold and reduced-motion path. Recharts replaces solid-recharts with the same area-chart composition and formatting. Display reads stay on T3's environment/host guarded query and command ports.

Released Team API differences remain explicit: `/v1/agents/usage` does not carry local-only tertiary windows, quota groups or `sharedQuotaWith`; local model flags absent from `/v1/agents/models` are merged from `/v1/model-visibility/listing`. Extra-account names and usage are read only with the precise admin permissions. No quota is invented for an absent reading. Custom-agent usage text is local IPC `custom-agents:usage`, absent from the released remote API; `CustomAgentUsageRail` accepts the native host's typed rows when available. The English catalog is used because this T3 client has no corresponding locale context.

Host provider settings additionally translate `packages/ui/src/features/settings/ProviderSettingsPage.tsx`, `OpenCodeKeyDialog.tsx`, `components/{ProviderCodeLoginDialog,ProviderUseAppDialog}.tsx`, `features/custom-providers/{CustomProviderDialog,RepeatableRows}.tsx`, `features/custom-providers/custom-provider-form.ts`, `features/settings/McpSignInPage.tsx`, `progress.tsx`, and their rules in `styles/primitives.css`, renderer `styles/app-shell.css`, and `features/custom-providers/custom-providers.css`. Routing and flow lifetimes follow renderer `features/provider-updates/{provider-connect-route,provider-connection}.ts` and `components/provider-connection-api.ts`. The shared account loader and host settings controller validate and gate each operation against T3's original environment connection and exact permission atom.

The renderer has no native OAuth callback listener: host sign-in follows the source web-server route (code first, optional host page, then the page-ending relay). Callback relays remain available through the source Paste address alternative. A callback-only provider without a host page shows the source app handoff dialog. `renderHostSignInPage(tabId)` is a typed slot for the host-owned browser surface. Native runtime-store removal, local default provider settings and local detection/edit harness options are not offered by the joined-host source view. The remote endpoint list/add/remove and runtime update/version controls use actual host results. Unknown runtime, key, account and quota states remain unknown.

`provider.usageResets.list` and `.consume` use the exact released `provider-usage-reset-v1` POST codecs; no credits or successful reset outcome are inferred. API-key dialogs only accept replacements; saved secrets are never read into an input.
