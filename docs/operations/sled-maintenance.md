# Sled maintenance and releases

## Repository and update policy

`origin` is SamoyedLabs/sled-code; `upstream` is pingdotgg/t3code. Preserve merge ancestry when integrating upstream. Application sources are tracked directly; never run the old prototype materialization scripts over this checkout.

Sled Upstream checks nightlies every five minutes and supports manual preparation. GitHub may delay scheduled runs; this is near-real-time polling, not an instant upstream push trigger. `config/sled-upstream.json` controls candidate policy. Routine candidates can merge only after the exact candidate passes the required Check gate and main has strict up-to-date protection. Review-sensitive changes, explicit holds and unresolved conflicts remain staged. Later updates depending on a held change remain held too; do not bypass dependencies to claim current upstream compatibility.

Use the `sled:hold` label for review holds and `sled:physical-required` only when a concrete concern cannot be resolved by automated tests, simulator testing or a Mac-host check. Record that concern and evidence in the PR. A native file change alone does not justify physical testing. Batch exceptional phone checks; report blockers promptly and say whether owner action is actually needed.

The automation does not currently have a configured paid coding-agent backend. Conflicts and failures are reported as held work; no autonomous AI repair is claimed. A coding agent can repair the held branch, then rerun CI. Do not remove features or weaken checks merely to merge an update.

The default GitHub token uses explicit CI dispatch for bot-created PRs. Enable repository Actions permissions to create pull requests. A repository-scoped GitHub App can instead be configured with SLED_UPSTREAM_APP_ID and SLED_UPSTREAM_APP_PRIVATE_KEY. Build jobs do not receive signing secrets.

## Local validation and native dependencies

Install frozen JavaScript dependencies, then run the focused tests for the changed components. CI runs the affected upstream checks and the native host build. Simulator/native syntax checks complement the server authorization and protocol tests. They are not evidence of real-device hardware or cellular behavior.

Run `python3 scripts/sled/prepare-native.py` before CocoaPods or the host build. The pinned WebRTC archive is verified before extraction; binary frameworks and build outputs are ignored. Update the source pin, checksum and corresponding notice provenance together when changing WebRTC. Sill is vendored at the revision recorded in sources.lock.json; update it independently from T3.

## Releases and services

Source integration and deployment are separate. No inherited upstream deployment workflow is active: originals are retained as disabled reference fixtures under docs/operations/upstream-workflows. Run release actions explicitly and batch routine changes.

The existing private TestFlight identity is com.samoyedlabs.sled, app record 6829299377. scripts/testflight-ios.py supports archive, export and upload. API metadata and isolated local signing configuration are read from .tools/apple-credentials. Existing credentials remain on their original machine; a clean clone requires its own authorized signing setup. Never commit keychains, private keys, signing passwords or relay credentials.

Desktop release builds explicitly target SamoyedLabs/sled-code as the update repository. The current private distribution script still uses local Apple Development signing; public macOS distribution needs Developer ID signing and notarization. Creating a public source repository does not make the private app publicly signed.

Mobile OTA defaults off. Enabling it requires an explicitly configured Sled Expo project and owner; upstream's project is rejected. The existing working Google sign-in still relies on T3's hosted authentication configuration and callback. Moving to Sled-owned authentication requires a separate tested migration. Relay and authentication settings are supplied through environment variables or ignored public-configuration files; a fresh clone does not inherit the current machine's service access.

Preserve known-good artifacts for rollback. Database migrations may require restoration of a backup as well as the old application binary. Never test migrations against the live T3 home or replace an installed application during development.

## Private cutover on this Mac, copethyself, and the phone

Rollout is explicit and per device. Keep the official installed app and its updater intact. Its `app-update.yml` still belongs to pingdotgg/t3code; changing Sled source does not redirect that installation. No inherited release workflow publishes Sled artifacts. Private Mac releases default to local signing and manual activation. The explicit portable update build below enables the Sled-owned Electron feed; neither mode is a notarized public release. Do not publish the generated electron-builder update YAML after re-signing a ZIP: its hashes describe the pre-signing artifact. The private release manifest hashes the final signed ZIP instead.

First inventory each desktop locally (Python 3.9+), while the host can remain running:

```sh
python3 scripts/sled/migrate-profile.py inventory
python3 scripts/sled/migrate-profile.py dry-run --home "$HOME/.sled"
```

Inventory reports sizes and file presence without reading out settings, database rows or credentials. It writes nothing. On Windows, use `py -3` and an absolute `--home` if needed. Transfer source/tooling through an authorized channel to copethyself and run inventory there; no remote access is implied. Do not copy this Mac's database onto the PC: projects refer to machine-local paths. Windows apply/activation is deliberately refused until offline host detection and a Sled Windows artifact have been validated on that PC.

Prepare a signed Mac arm64 build with a unique Sled semver and an absolute profile path for the destination Mac. `T3_REMOTE_SIGNING_IDENTITY` must refer to the owner's existing authorized Apple signing identity; no credentials are copied from upstream or printed. Set it locally before running:

```sh
python3 scripts/build-desktop.py --build-version <unique-semver> \
  --profile-home "$HOME/.sled" --stage-release
```

This prepares native dependencies, builds the helper and desktop, signs and verifies the final ZIP, verifies the Sled update repository and isolated app identity, and stages an immutable release under `~/.sled-releases/<sha256>/`. It never launches, replaces `/Applications`, or publishes. The profile path is embedded for Finder launches: this artifact is per-device, not portable between accounts. Existing connection configuration is only included when supplied through the existing ignored public configuration file. Auth remains unchanged. No signing identity or service credential is invented by these tools.

The live cutover must happen after the controlling session has moved elsewhere and both hosts are quit. Stop provider turns and scheduled work before quitting; never run the full profile copy in a development server. The offline copy preserves thread records, settings, secrets and project-path strings without rewriting their schemas. It also preserves schedules, sessions and environment links, which can produce effects on first launch. Preserving bytes does not establish compatibility with every historical customization or encrypted store. The new private Electron namespace may require sign-in and macOS privacy permissions again. Validate pairing and a stopped thread before enabling ongoing work.

```sh
python3 scripts/sled/migrate-profile.py apply --source-stopped \
  --home "$HOME/.sled" --backup-root "$HOME/.sled-backups"
python3 scripts/sled/private-release.py activate --hosts-stopped \
  --release "$HOME/.sled-releases/<sha256>"
```

`apply` requires a new destination, rejects symlinks and overlap with official userdata, checks for open files with `lsof`, takes SQLite online-backup snapshots through read-only connections, checks database integrity and hashes the copied snapshot. Backup data stays local with private permissions. Reserve space for at least two copies of userdata plus the application. This copies userdata only: it does not copy working directories, provider credentials outside userdata, Keychain entries, or arbitrary Electron app data. Project directories must stay available at their original paths.

Every `activate` verifies the staged ZIP hash and app signature/team, refuses an open official or Sled profile, and creates another userdata backup before starting the exact private executable. Keep the preceding release directory and its backup. Automatic updating stays disabled for this manual staging path. For a later manual update, stage the new version, quit Sled, then activate it with the same home. No app or process is killed automatically.

For initial-cutover rollback, quit Sled and use the backup printed by `apply`:

```sh
python3 scripts/sled/migrate-profile.py rollback --source-stopped --backup <backup-directory>
```

This verifies the backup and renames the Sled home aside without deleting it. Restart the unchanged official app with its unchanged original profile. Work created only after cutover remains in the archived Sled home; it is not merged back. For an update rollback, use the backup printed by `activate`; the same command archives the newer Sled home and restores the previous userdata snapshot. Then activate the retained previous binary. Never run an older binary directly against a newer database.

| Surface                         | Prepared path                                                                                   | Remaining validation/access                                                                                                                                                                          |
| ------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| This Mac, Apple Silicon         | Signed private ZIP staging, offline copy, manual activation and rollback                        | Build and verify a real signed artifact; explicit offline cutover and native permission/pairing check                                                                                                |
| copethyself, Windows            | Read-only Python inventory; inherited `dist:desktop:win:x64` / `win:arm64` artifact tasks exist | Authorized PC access, actual architecture, Sled installer/signing/update checks, and tested Windows offline backup/cutover. The Swift host is macOS-only; Windows host feature parity is not claimed |
| Phone, existing Sled TestFlight | Keep `com.samoyedlabs.sled`, app record `6829299377`, and authorized Apple team                 | New native archive/upload on original credential machine, install over existing Sled app, check stored connections/sign-in and native permissions                                                    |
| Android / Linux                 | Inherited app/build source exists                                                               | Outside confirmed device scope; no private Sled release or migration certification claimed                                                                                                           |

### TestFlight continuity and first OTA-capable native build

The Sled Expo project is `@samoyed-labs/sled-code` (`707658f3-e37c-410c-b0fd-74aadb09e855`). Its `sled-private` channel and matching branch were created and verified in the dashboard. This Mac's ignored `.env.local` holds `SLED_EXPO_PROJECT_ID`, `SLED_EXPO_OWNER` and `SLED_EXPO_CHANNEL`; the app slug matches `sled-code`. Account login, native build, upload and on-device installation are separate steps; the project and channel alone do not enable OTA on an installed binary. OTA still requires explicit build opt-in.

Use `scripts/testflight-ios.py archive --team <existing-team> --build-number <unused-build> --prepare`, then its separate `export` and `upload` actions. Existing credentials remain under the ignored `.tools/apple-credentials` directory on their original machine. Keep bundle ID/team and existing sign-in configuration; do not uninstall the phone app as a migration step. The script's default remains OTA off and keeps the current private identity override. TestFlight upload/access and an increasing App Store build number are still required; export is not upload.

Local archives retain toolchain-scoped compiler and package caches under `~/Library/Caches/Sled/ios-native`; DerivedData is separate per checkout. `--prepare` reuses installed Pods only when native inputs, installed lockfiles and the calculated runtime still match. Use `--force-prepare` to regenerate, or `--disable-compiler-cache` for an uncached comparison. Manual signing checks the private key before compilation and temporarily extends only the dedicated distribution keychain's timeout, then restores its settings and locks it on success or failure.

Before choosing a native build, run `scripts/sled/ota-ios.py --archive <existing-archive> --public-config <public-config> --plan`. Its JSON selects `ota` only when the calculated runtime matches that archive; `native` requires a new binary. Planning does not publish. Patched dependencies remain source-built unless an exactly compatible precompiled artifact is available.

The currently installed OTA-disabled binary cannot receive the change that enables OTA. Obtain a Sled-owned Expo project and owner first. Export `SLED_EXPO_PROJECT_ID` and `SLED_EXPO_OWNER` in the local build environment, then prepare a new native archive:

```sh
python3 scripts/testflight-ios.py archive --team <existing-team> \
  --build-number <unused-build> --prepare --enable-ota --ota-channel sled-private
```

This opt-in rejects the upstream Expo project, requires regeneration of native configuration, retains fingerprint runtime compatibility and embeds an explicit update channel for local Xcode builds. The same independent project, channel, variant, identity override and public configuration must be used when exporting an OTA bundle. Create/verify that EAS channel and its branch mapping in the Sled project before any OTA publish. Install and verify the new TestFlight binary first. The archive script does not publish OTA updates. The separate local OTA helper below checks the current fingerprint against the actual archived runtime before exporting or publishing. [Expo documents the native update URL/channel configuration](https://docs.expo.dev/bare/installing-updates/) and [fingerprint runtime compatibility](https://docs.expo.dev/versions/latest/sdk/updates/).

JavaScript, React Native logic and assets can then ship through matching-runtime OTA updates. Swift, native modules/dependencies, SDK upgrades, entitlements, permissions and native configuration changes require a new native/TestFlight build whenever the fingerprint changes. Keep a known-good matching-runtime update and native build available; an OTA rollback cannot undo a native or database compatibility change. Verify cold launch, reconnect and the remote desktop flow on the actual phone before rollout.

For a fresh checkout on the original credential Mac, pass `--credentials-dir <original-repo>/.tools/apple-credentials` and `--tools-bin <original-repo>/.tools/bin` to each archive/export/upload action. `--public-config` defaults to the ignored `.tools/desktop-review/connect-public-config.json`; it must contain exactly the four public connection settings. `--derived-data-path` selects a build cache. Use a unique `--output-dir` for each later native release and pass it to all three actions, retaining the prior archive and IPA. Credentials stay in place. Preparation resolves Swift packages before the archive; export preserves the chosen build number and remains internal TestFlight only.

After validating the exported binary and installing that native build through TestFlight, check compatibility locally:

```sh
python3 scripts/sled/ota-ios.py --archive .tools/testflight/com.samoyedlabs.sled/T3CodeRemote.xcarchive
```

To export without publishing, add `--export --output .tools/ota-ios-<unique-name>`. To export and publish a compatible JS/assets update through the saved EAS login, use `--publish --message "<release description>" --output .tools/ota-ios-<unique-name>`. The helper fixes the project, channel, preview (Nightly) variant, existing private identity override, team and fingerprint policy to match this private native release. It loads the same four public connection settings and rejects a differing runtime before any upload. It never forces a runtime override; a mismatch requires a new native build. Keep the generated iOS project and matching dependency installation available for fingerprint calculation on this Mac. Do not publish from a different checkout unless its independently computed runtime matches. Expo receives the exported JS/assets only. No OTA update is published as part of the initial binary preparation.

Verify an archive and its separately exported IPA with `python3 scripts/sled/verify-ios-artifact.py <artifact>`. Both checks verify the signed app identity, OTA endpoint/channel, fingerprint runtime, embedded JS and WebRTC. IPA verification additionally requires an App Store profile with debugging disabled. Run both before the explicit upload action. Artifact verification does not prove installation, sign-in, stored-connection continuity or native permissions on the phone.

### Portable desktop update channel

The portable private build resolves the current account's home to `~/.sled` before Electron storage or the server starts. It embeds only the four permitted public connection settings. It preserves Sled's private application identity and uses `SamoyedLabs/sled-code` for normal in-app update checks, download and explicit restart/install. It does not force a restart during an agent session. Manual builds remain updater-disabled.

On the authorized signing Mac, build a unique **stable** Sled semver (for example, the next unused `0.1.8`), using the preceding verified private application as the signature baseline:

```sh
python3 scripts/build-desktop.py --enable-updates --reuse-resource-monitor \
  --build-version <unused-stable-semver> --update-baseline-app '<prior-private.app>'
```

Do not use `-sled` prerelease versions with the stable channel: electron-updater excludes them. The build produces an immutable `.tools/sled-update-releases/<version>/` directory. Its ZIP, blockmap, `latest-mac.yml` and checksum manifest describe the **final signed** bytes. Preparation checks both package and bundle versions, portable profile metadata, Sled feed, architecture and the prior app's complete designated signature requirement. Same-team checking alone is insufficient. The pinned electron-builder blockmap implementation runs after signing. Do not upload YAML or blockmaps from `.tools/desktop-artifacts`; those were generated before private re-signing.

Verify native Squirrel download/signature acceptance without starting the Sled server or installing:

```sh
node scripts/sled/verify-mac-updater.cjs .tools/sled-update-releases/<version>
node scripts/sled/desktop-update-release.cjs verify .tools/sled-update-releases/<version>
```

The disposable harness is development-signed with the authorized identity and uses an isolated profile and local HTTP feed. Evidence is written to `.tools/sled-native-update-evidence.json`. macOS's native updater verifies the current application's designated requirement against the candidate ([Squirrel source](https://github.com/Squirrel/Squirrel.Mac/blob/master/Squirrel/SQRLCodeSignature.m)). This supports same-owner development-signed updates on this Mac; Gatekeeper/notarization and public distribution remain separate. No signature check is bypassed. Native installation/relaunch and user permissions are checked during root's offline cutover, not by this harness.

After committing and pushing the exact release source, publish explicitly:

```sh
node scripts/sled/desktop-update-release.cjs publish .tools/sled-update-releases/<version> --confirm-sled-release
```

The publisher refuses dirty source, an existing tag or mutated local assets, creates a fresh draft release, uploads without replacement, checks GitHub's uploaded SHA-256 digests, then exposes the coherent release as stable/latest. A failed upload stays draft. Do not dispatch inherited release workflows. The repository must remain public for this credential-free GitHub feed; do not embed a GitHub token in the application.

Initial cutover uses `migrate-profile.py apply` offline, then extracts the verified portable ZIP to a stable owner-writable application path such as `~/Applications/Sled Code.app`. Keep the immutable release bundle elsewhere for rollback. Do not use `private-release.py activate` for the portable build: that intentionally forces manual mode. Launch the portable app from its stable path with inherited `T3CODE_HOME` and `T3CODE_DISABLE_AUTO_UPDATE` unset. Never replace the official installed app. An automatic binary update does not supply a database rollback: take an offline profile backup before accepting an update that changes schema.

For Windows x64, use the existing `dist:desktop:artifact --platform win --target nsis --arch x64` task with `T3CODE_DESKTOP_PRIVATE_BUILD=true`, `T3CODE_DESKTOP_UPDATE_REPOSITORY=SamoyedLabs/sled-code`, `SLED_DESKTOP_PORTABLE=true`, `SLED_DESKTOP_AUTO_UPDATE=true`, and `SLED_WINDOWS_PUBLISHER_NAME` set to the actual authorized Authenticode publisher. This forces code signing and update signature verification; provide the owner's existing supported electron-builder signing credentials locally. No certificate is created or invented. Final signed NSIS artifacts and their matching `latest.yml` are Windows-specific: the Mac ZIP release helper does not certify or publish them. Do not re-sign the EXE after builder generates update metadata, or append a blockmap after signing. The Windows delegate must verify the actual installer, embedded publisher configuration, Authenticode trust and native updater before claiming support. For a coordinated release, use the Mac publisher’s `draft` action instead of `publish`, then upload the Windows delegate’s verified final assets and compare their remote SHA-256 digests before marking the combined draft stable/latest. Publish Windows and Mac assets together when both are certified; a Mac-only release cannot update Windows.

### Unattended GitHub-hosted desktop releases

Desktop publication reconciles a retained draft and uploads only missing, digest-matching certified assets. Transient GitHub failures get bounded retries; rerunning the failed publication job reuses the original artifacts and version. Conflicting source provenance or remote bytes stop publication. Private Mac builds sign the app inside Electron packaging before the final ZIP is created.

Mobile release planning runs on Linux and selects Linux for compatible OTA updates, macOS for native archives. The selected worker recomputes the plan and refuses a changed mode before publishing. Dispatch `sled-mobile-release.yml` with `verify_portability=true` to compare Linux/Mac runtime fingerprints and verify that native source changes invalidate them.

To measure native compiler reuse without publishing, dispatch `sled-mobile-release.yml` with `benchmark=true`. It builds two unsigned Release archives on one Mac runner, round-trips the compiler cache through GitHub, and removes DerivedData between builds. The job summary reports archive time and compiler hits/misses; `native-cache-benchmark` retains the evidence. This measures compiler reuse with warm OS/dependency state, not a fresh-runner signed release or TestFlight availability. Native release evidence also includes `phase-timings.jsonl` for Pods, package resolution, archive, export, and upload.

`sled-desktop-release.yml` runs on GitHub-hosted Ubuntu, macOS arm64 and Windows x64 VMs. No personal computer, self-hosted runner, local cron or persistent server is required. Its five-minute cloud schedule covers bot merges even without a push event. It selects main only after successful `Check` for that exact SHA and avoids duplicate source releases/drafts. Both platforms must verify before the draft is published. Devices receive releases when next online. Mobile OTA/native cloud automation is separate and is not implemented by this desktop workflow.

To verify a branch's desktop build tooling without signing or publishing, dispatch
`sled-desktop-release.yml` on that branch with `verify_only=true`. This runs the desktop
build on standard Linux, Windows and Mac runners, compiles the native Mac host, and packages unsigned Mac/Windows installers.
It does not validate installer signatures, TestFlight upload or Apple processing.

CI and release logs emit `[progress]` phase start, elapsed-time heartbeats and completion
records. Job summaries and `phase-timings-*` artifacts retain durations and the historical
samples used for estimates. To inspect a running or completed workflow, including runner
allocation and the active step, run:

```sh
python3 scripts/sled/ci_progress.py status --repo SamoyedLabs/sled-code --run RUN_ID --output timings.json
```

Ranges use up to five successful main runs from the last 30 days and require three
observations. Release history prefers runs with phase-timing artifacts so scheduled no-op
runs do not crowd out real builds. They are historical ranges, not deadlines or calibrated confidence intervals.
Overruns and missing history explicitly have no ETA. Whole-run estimates require the same
enabled jobs; mobile whole-run estimates remain unavailable because native and OTA paths
differ. Native and OTA phase histories are separate. Queueing, cache misses and changed
workloads can exceed the observed range. The JSON export preserves run attempts and step
timings for comparing forecasts with actual completion.

The release gate is `SLED_DESKTOP_RELEASE_ENABLED=true`. The default **private same-owner Mac** path is `SLED_MAC_DISTRIBUTION=private-development`. Securely provision `SLED_MAC_CSC_LINK` (base64 encrypted PKCS#12 containing only the existing authorized Apple Development certificate and private key) and `SLED_MAC_CSC_KEY_PASSWORD` (its export password). No Developer ID certificate, notarization key or purchase is required for this private route. Root owns credential provisioning; implementation did not transfer keys. Export only the selected identity, never all identities in the login keychain.

The nonsecret `SLED_APPLE_TEAM_ID=WYW7983W9W`, `SLED_MAC_DISTRIBUTION=private-development`, exact prior app `SLED_MAC_SIGNING_REQUIREMENT`, and four public Connect variables have been configured in repository Actions variables. The workflow imports the supplied identity into an ephemeral runner keychain. Because the pinned builder does not select Apple Development for non-MAS signing, private mode uses the already verified packaging-then-`sign-private-desktop.cjs` path, explicitly omits notarization and regenerates the final ZIP blockmap and hashes after signing. Verification requires the prior app's exact designated requirement plus the expected team, deep/strict signature validation, helper verification and final archive hashes. This preserves the established same-owner signature trust instead of weakening it to a team-only check. Gatekeeper/public notarization is not claimed. Existing private native Squirrel download acceptance was verified on this Mac; root has provisioned the existing identity, and hosted validation now awaits committed source and a real hosted run.

Public Mac distribution is an optional separate mode: `SLED_MAC_DISTRIBUTION=public-distribution` requires a Developer ID Application PKCS#12 plus `SLED_APPLE_API_KEY` (authorized notarization `.p8` text), `SLED_APPLE_API_KEY_ID` and `SLED_APPLE_API_ISSUER`. That mode verifies notarization, stapling and Gatekeeper. Changing from Development to Developer ID changes the designated requirement and requires an explicit verified bootstrap replacement; later same-identity releases use the normal updater.

Windows uses `SLED_WIN_CSC_LINK` (base64 signing PKCS#12), `SLED_WIN_CSC_KEY_PASSWORD` and nonsecret `SLED_WINDOWS_PUBLISHER_NAME` (actual certificate simple name). This may be an explicitly authorized dedicated **private** code-signing identity: a purchased public certificate is not mandatory. For that route set `SLED_WINDOWS_TRUST_CERT` to the base64 public DER certificate and `SLED_WINDOWS_SIGNER_THUMBPRINT` to its owner-approved SHA-1 certificate fingerprint. The hosted credential step verifies that fingerprint before installing only that public certificate into its ephemeral CurrentUser Root/TrustedPublisher stores. Root must provision equivalent explicit trust on copethyself before installing/updating; no private key needs to reach the PC. Both the installer and extracted Sled executable must have valid Authenticode signatures and the configured publisher. This implementation does not generate a key or invent a publisher, import an unapproved root, or disable signature checks. An unsigned private Electron updater is an upstream option when no publisher is configured, but this workflow deliberately requires a signing decision rather than silently selecting unsigned updates. A public CA or new paid signing service is not imposed.

The hosted Windows job installs official `Microsoft.VisualStudio.Component.VC.Runtimes.x86.x64.Spectre` libraries via Visual Studio Installer `modify --add`, waiting through PowerShell `Start-Process -Wait`. It validates that the latest selected MSVC toolset has the x64 Spectre directory. No UAC interaction on copethyself or disabled mitigations are involved. The cloud native jobs remain unverified until credentials are provisioned and the coherent source is committed/pushed.

Versions are Sled-owned stable `0.<2 + run-number // 60000>.<run-number % 60000>` (each Windows version component stays below 65536), separate from upstream's prereleases. The publisher uploads only the native jobs' frozen certified assets, checks GitHub's remote SHA-256 digests and exposes Mac+Windows together. Failed uploads remain draft for inspection; remove an abandoned draft/tag explicitly before retrying that source. An in-app restart/install remains an explicit user action so active agent sessions are not forcibly interrupted. No workflow is claimed operational until a successful hosted build/sign/publish run exists.
