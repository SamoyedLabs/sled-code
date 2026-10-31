# Sled maintenance and releases

## Repository and update policy

`origin` is SamoyedLabs/sled-code; `upstream` is pingdotgg/t3code. Preserve merge ancestry when integrating upstream. Application sources are tracked directly; never run the old prototype materialization scripts over this checkout.

Sled Upstream checks nightlies every six hours and supports manual preparation. `config/sled-upstream.json` controls candidate policy. Routine candidates can merge only after the exact candidate passes the required Check gate and main has strict up-to-date protection. Review-sensitive changes, explicit holds and unresolved conflicts remain staged. Later updates depending on a held change remain held too; do not bypass dependencies to claim current upstream compatibility.

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
