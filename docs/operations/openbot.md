# Openbot engine development

The Openbot integration is under development. It provides an opt-in managed host, bot controls in web and mobile Settings, and a bridge from bot assignments to actual Sled coding threads on configured local or linked environments. Full upstream feature coverage and packaged cross-platform verification remain incomplete.

## Enable a development host

Use an isolated Sled development home, following [development setup](development.md). Set `T3CODE_OPENBOT_EXECUTABLE` in the backend environment to the absolute path of an Openbot executable. On macOS this is the executable inside the app bundle, rather than the `.app` directory. No executable is downloaded automatically.

The launch and local Team API contracts target Openbot v0.60.0, commit `0c7753fa622c38419939cd230657f40e5883d098`. The packaged macOS arm64 release has been exercised with an isolated development profile. Other runtime platforms still require verification; Linux hosting retains upstream's Electron/display requirements.

Sled places the engine profile and agent workspace beneath its own state directory at `openbot/profile` and `openbot/agents`. The owner credential is generated once in Sled's server secret store. Keep the profile and that credential together when moving or backing up development state. Do not point the engine at an existing Openbot profile.

## Connect bots to Sled

Open Settings → Bots in the connected environment and start its engine. Start and stop require settings write access. Starting saves the opt-in: Sled restores that engine after a server restart and retries unexpected engine exits with bounded backoff. Stop clears the opt-in and cancels pending retries. Removing the executable setting disables it after a Sled restart.

Use **Connect Sled tools** to grant the engine access to this environment. This requires access administration, settings write access and every scope being delegated. The selected authority is a ceiling; bots retain their own permissions. Read-only access permits inspection; actions such as launching coding work require the appropriate writable grant.

Sled installs its MCP endpoint into the managed Openbot profile using a private, expiring credential. Reconnect to rotate or renew it. Disconnect revokes access and removes its stored MCP configuration. If revocation is pending, access has not yet been confirmed revoked; retry disconnect. If only upstream cleanup remains, that cleanup resumes when the engine becomes available. Keep development Sled listener ports stable while a connection is configured, or reconnect after changing them.

Bots reach the `openbot` and `openbot_coding` MCP tools through that connection. Use each tool's `describe` action for its request schema. A coding assignment needs a stable origin and operation ID; repeat those identifiers after an uncertain response to recover the existing thread. Result delivery reports uncertainty separately from coding completion when upstream acceptance cannot be established.

The bot screens use live updates and expose pending questions and approvals. Approval responses are bound to the engine that issued the request. An incomplete attention snapshot is a partial list, not confirmation that no other requests exist. Browser help can still require interaction on the host; push notifications are not integrated yet.

Open a bot's Browser panel to manage profiles and tabs. Take control before interacting with its page and return control when finished so the bot can continue. Browser management and viewing require settings write and preview operate access. The live viewer uses Sled's authenticated media connection; no upstream endpoint or credential is sent to the client. OS consent and host-level browser permission prompts must still be handled on the host.

## Stage upstream releases

The authenticated RPC methods `openbot.upstream.status`, `openbot.upstream.check` and `openbot.upstream.stage` require settings write access. Check accepts an optional version such as `v0.60.0`; stage takes a version and platform, for example `{ "version": "v0.60.0", "platform": "darwin-arm64" }`. The `openbot` MCP tool exposes corresponding `upstream.status`, `upstream.check` and `upstream.stage` actions; mutations require full-access/default authority.

Staging resolves the official release and immutable commit, verifies archive size and SHA-256, and records an audit beneath the Sled state directory at `openbot/upstream`. It does not extract, activate or execute the archive, migrate a profile, or change the configured executable. A version other than the pinned baseline remains marked as requiring validation.

## Review future upstream releases

Upstream maintenance in Settings → Bots is disabled until configured. Choose the integration project, review provider/model, base branch, platform, interval and allowed work. Check-only authority never launches a model. Review authority creates a real Sled thread in a separate worktree with plan mode and approval-required execution. Reviews can return source comparisons, evidence and a decision request to the maintenance panel. Reported evidence still requires independent verification.

Accepting a review records a decision; it does not activate an engine. With stage authority, a separate Stage action verifies the reviewed release identity before downloading. Future releases retain the compatibility gate after review and staging. Source patching, compatibility promotion and profile migration remain separate work. Disabling maintenance stops future checks and launches; stop an already running review through its normal Sled thread controls. Maintenance decisions currently appear in this panel without push notifications.

The Team API stays on loopback. Sled performs login and logout server-side; owner credentials and upstream session tokens are never returned to its clients. Shutting down the owning Sled server also disposes its engine process. Persistent execution therefore requires that host and Sled server to remain running.
