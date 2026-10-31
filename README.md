# Sled Code

Remote development with native Mac desktop streaming inside the mobile app, built on [T3 Code](https://github.com/pingdotgg/t3code).

Sled Code preserves T3's coding agents, development sessions, web, Electron desktop and Expo mobile clients. The initial custom integration targets macOS hosts and iOS clients, with Sill capture, hardware video, remote input, clipboard, audio, virtual displays, direct WebRTC and relay fallback. The Mac host can follow the desktop app lifetime or remain available in persistent mode.

## Development

Use the Node and pnpm versions in `package.json`. Install dependencies with `pnpm install --frozen-lockfile`, then run `pnpm dev`. Upstream development guidance remains in [AGENTS.md](AGENTS.md) and [the original README](README.upstream.md).

Native streaming builds require Xcode 26 or newer, its command-line tools and CocoaPods. CI selects Xcode 26.3 for the Security framework declarations; the host deployment target remains macOS 14:

```sh
python3 scripts/sled/prepare-native.py
swift build --package-path native/remote-desktop --product T3RemoteHost
python3 scripts/build-desktop.py
```

The native setup verifies the pinned WebRTC archive checksum and installs ignored frameworks; it does not patch application source. Sill's modified host is tracked under `native/remote-desktop`; mobile native sources are tracked under `apps/mobile/modules/t3-remote-desktop`. Dependency versions and provenance are in `sources.lock.json`.

The iPhone app is Sled, bundle `com.samoyedlabs.sled`. Expo updates are disabled by default. TestFlight archives use `python3 scripts/testflight-ios.py archive --team <YOUR_TEAM_ID> --prepare`; export and upload are separate explicit actions. Signing material belongs in ignored `.tools/apple-credentials/`, never in the repository. See [maintenance and releases](docs/operations/sled-maintenance.md).

## Upstream updates

This is an independent repository retaining T3's history. Configure its source remote with:

```sh
git remote add upstream https://github.com/pingdotgg/t3code.git
```

The Sled Upstream workflow checks published nightlies every six hours. A candidate must pass CI on its exact commit before automatic promotion. Unresolved conflicts and changes requiring review remain staged. Physical phone testing is exceptional; native changes alone do not require it. See [maintenance policy](docs/operations/sled-maintenance.md).

## Attribution

T3 Code is MIT licensed; its original copyright and license are retained in `LICENSE`. Sill is Apache-2.0 licensed; its license and modification notice are in `native/remote-desktop/` and the mobile module's `Vendor/`. WebRTC dependency notices and provenance accompany the native components.
