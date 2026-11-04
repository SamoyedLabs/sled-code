# Openbot engine development

The Openbot integration currently provides an opt-in managed host and bot roster through Sled's authenticated RPC connection. Bot screens, coding delegation, automatic installation and upstream updates are still being implemented.

## Enable a development host

Use an isolated Sled development home, following [development setup](development.md). Set `T3CODE_OPENBOT_EXECUTABLE` in the backend environment to the absolute path of an Openbot executable. On macOS this is the executable inside the app bundle, rather than the `.app` directory. No executable is downloaded automatically.

The launch and local Team API contracts target Openbot v0.60.0, commit `0c7753fa622c38419939cd230657f40e5883d098`. Fixture tests exercise these contracts; launching a packaged upstream release and its platform prerequisites still requires validation. Linux hosting retains upstream's Electron/display requirements.

Sled places the engine profile and agent workspace beneath its own state directory at `openbot/profile` and `openbot/agents`. The owner credential is generated once in Sled's server secret store. Keep the profile and that credential together when moving or backing up development state. Do not point the engine at an existing Openbot profile.

## Operate through RPC

The existing authenticated Sled RPC client exposes these methods, each with an empty `{}` input:

- `openbot.status`: inspect disabled, stopped, starting, ready or failed state. Failed state includes a bounded reason category.
- `openbot.start`: start the configured engine and wait for its readiness signal.
- `openbot.listAgents`: list bot IDs, names and providers from a ready engine.
- `openbot.stop`: stop the child owned by this Sled server.

Status and listing require orchestration read access; start and stop require settings write access. These methods are developer integration interfaces; there is no built-in settings control yet. The engine does not start automatically on Sled launch. Removing the executable setting disables it after a Sled restart.

The Team API stays on loopback. Sled performs login and logout server-side; upstream passwords and session tokens are never returned to its clients. Shutting down the owning Sled server also disposes its engine process. This foundation does not provide always-on execution after that host shuts down.
