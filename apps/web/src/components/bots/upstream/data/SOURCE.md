# OpenBot 0.60.0 files, memory, vault and data translation

The maintenance bundle's pinned `.openbot-build/source` is the source, version 0.60.0. `../OPENBOT-LICENSE` applies to copied presentation, text and helper code. These React leaves retain the source class names, information order, empty/error states, menus and confirmation flow. Base UI supplies focus and dismissal; the shared source motion wrapper supplies menu exit behavior. CSS keyframes remain at the stylesheet top level for Lightning CSS.

Translated source files:

- `packages/ui/src/features/files/{FileList,AgentFilesView,ConversationFilesPanel,StorageOverview,StorageUsageBar}.tsx`, `files-view.ts`, `files.css`; renderer `features/files/{AgentFilesSettings,ChatFilesPanel,ServerStoragePanel}.tsx`, `storage-usage.ts` and `files-port.ts` inform the connected wrappers.
- `packages/ui/src/features/conversation/{AgentMemoriesView,AgentMemoriesEmpty}.tsx`, renderer `features/conversation/AgentMemoriesSettings.tsx`, and memory rules from renderer `styles/app-shell.css`. Source memory title/body splitting, paging, selection revision, editing, keyboard completion, draft retention and delayed delete/undo semantics are retained.
- `packages/ui/src/features/vault/VaultPanel.tsx`, `vault.css`, `features/settings/{OnePasswordConnectorPanel,BitwardenConnectorPanel}.tsx`, renderer `features/vault/ServerVaultPanel.tsx` and vault store/port. Country lists, card brands, field validation, masks, tabs, secret reveal, import and reset forms use source structure. Secret reads are explicit and fenced to their original session.
- Renderer `features/conversation/SharedTablesModal.tsx`, the shared-table rules in `styles/app-shell.css`, `packages/ui/src/features/settings/SettingsHostedSitesTab.tsx` and `settings-hosted-sites.css`. Their React wrappers retain the existing guarded table/site controllers.
- `packages/i18n/src/messages/en/{common,memory,sharedTable,files,attachment,settings,vault,connector}.ts` supply the source copy; `packages/i18n/src/format.ts` supplies file-size formatting.

Connection and API boundaries:

- `FilesEnvironment` reads the exact agent/conversation inventory; `SourceHostStorage` reads `settings.storage.usage` with host scope. Responses must match the requested scope. All server-file preview URLs are discarded in favor of the guarded T3 asset gateway. Uploaded workspace transfers keep the existing `useWorkspaceFiles` controller and its principal, session, tombstone and transfer identities.
- Stored-file materialization supplies `{kind:"stored",fileId,conversationId?}` plus the actual file's agent owner. The server verifies authoritative inventory ownership before reading released `GET /v1/attachments/:fileId`. Host inventory rows without an agent owner cannot currently be materialized by that agent-owned bridge; the UI reports that limit rather than inventing an owner.
- Storage cleanup only accepts the host-reported removable `caches` or `logs` category through the frozen `POST /v1/storage/clear` codec. Native removable runtime store operations are intentionally absent on joined hosts, matching source `ServerStoragePanel`.
- The source MachineResources slot is retained, but pinned renderer `features/files/machine-resources.ts` sets `MACHINE_RESOURCES_SHOWN = false` and skips its reads. The React host storage panel likewise does not enable metric polling or display. Its released admin routes are `POST /v1/admin/host/machine/{metrics,alerts,alerts/update}` under `machine-resources-v1` if that source gate changes in a later version.
- Memory clear uses released `DELETE /v1/agents/:id/memories`; deletion undo preserves source timing without restoring after a session change. Vault v1 omits v2 API-key kinds; CSV import is gated by `vault-import-v1`. Password-manager connection panels use actual remote connector status and credential operations; local CLI install controls require native IPC and are not shown for a joined host.

Meaningful checks cover source file grouping/deletion flags, memory editing and revision retention, vault validation, unknown host storage readings and exact cleanup categories. Parent composition owns live desktop visual verification.
