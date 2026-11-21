#!/usr/bin/env python3
"""Build the integrated private desktop ZIP through T3's supported artifact task."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--reuse-resource-monitor', action='store_true',
                    help='Use an already prepared resource-monitor binary instead of Cargo.')
parser.add_argument('--profile-home', type=Path,
                    help='Absolute per-device Sled profile baked into the private Mac app.')
parser.add_argument('--build-version', help='Unique Electron semver for this Sled artifact.')
parser.add_argument('--stage-release', action='store_true',
                    help='Require signing and stage a verified manual private release; never launch or publish.')
parser.add_argument('--enable-updates', action='store_true', help='Build a portable ~/.sled app with the Sled GitHub updater enabled; requires signing.')
parser.add_argument('--update-baseline-app', type=Path, help='Prior verified private app whose native signature requirement updates must satisfy.')
args = parser.parse_args()
if args.enable_updates and not args.update_baseline_app:
    parser.error('--enable-updates requires --update-baseline-app')
if args.enable_updates and (args.stage_release or args.profile_home):
    parser.error('--enable-updates uses portable ~/.sled and a separate update release, not manual staging')
if args.enable_updates and os.environ.get('T3_REMOTE_SIGNING_IDENTITY', '-') == '-':
    parser.error('--enable-updates requires a real signing identity')
if args.stage_release and os.environ.get('T3_REMOTE_SIGNING_IDENTITY', '-') == '-':
    parser.error('--stage-release requires T3_REMOTE_SIGNING_IDENTITY (local Apple identity)')
if args.stage_release and not args.profile_home:
    parser.error('--stage-release requires an explicit --profile-home for this device')
if args.profile_home:
    if not args.profile_home.is_absolute():
        parser.error('--profile-home must be absolute')
    profile = args.profile_home.resolve()
    live = (Path.home() / '.t3/userdata').resolve()
    if profile == live.parent or profile == live or live in profile.parents or profile in live.parents:
        parser.error('--profile-home overlaps the official live home')
lock = json.loads((root / 'sources.lock.json').read_text())
checkout = root / lock['t3code']['checkout']
env = dict(os.environ)
env.pop('ELECTRON_RUN_AS_NODE', None)
env['T3CODE_DESKTOP_PRIVATE_BUILD'] = 'true'
if args.enable_updates:
    env['SLED_DESKTOP_AUTO_UPDATE'] = 'true'
    env['SLED_DESKTOP_PORTABLE'] = 'true'
env['T3CODE_DESKTOP_UPDATE_REPOSITORY'] = 'SamoyedLabs/sled-code'
env['T3CODE_DESKTOP_PRIVATE_HOME'] = str(args.profile_home.resolve() if args.profile_home else root / '.tools/desktop-review/home')
public_config = root / '.tools/desktop-review/connect-public-config.json'
if public_config.exists():
    settings = json.loads(public_config.read_text())
    allowed = {'T3CODE_RELAY_URL', 'T3CODE_CLERK_PUBLISHABLE_KEY',
               'T3CODE_CLERK_CLI_OAUTH_CLIENT_ID', 'T3CODE_CLERK_JWT_TEMPLATE'}
    if set(settings) != allowed or not all(isinstance(value, str) for value in settings.values()):
        raise SystemExit('Expected only the four public T3 Connect settings.')
    env.update(settings)
if args.reuse_resource_monitor:
    env['T3CODE_DESKTOP_REUSE_RESOURCE_MONITOR'] = 'true'
version = args.build_version or lock['t3code']['tag'].removeprefix('v')
output = root / '.tools/desktop-artifacts'

def run(command, cwd=root):
    subprocess.run(command, cwd=cwd, env=env, check=True)

run([sys.executable, 'scripts/sled/prepare-native.py'])
run([sys.executable, 'scripts/build-host.py'])
run(['pnpm', 'exec', 'vp', 'run', 'dist:desktop:artifact', '--platform', 'mac',
     '--target', 'zip', '--arch', 'arm64', '--build-version', version,
     '--output-dir', str(output)], checkout)
if env.get('T3_REMOTE_SIGNING_IDENTITY', '-') != '-':
    run(['node', 'scripts/sign-private-desktop.cjs',
         str(output / f'T3-Code-{version}-arm64.zip')])
run(['node', 'scripts/verify-desktop-package.cjs',
     str(output / f'T3-Code-{version}-arm64.zip')])
print('Private desktop ZIP:', output / f'T3-Code-{version}-arm64.zip')
print('For stable local Keychain identity, supply T3_REMOTE_SIGNING_IDENTITY. Public distribution also needs outer-app signing and notarization.')

if args.stage_release:
    run([sys.executable, 'scripts/sled/private-release.py', 'stage', '--archive',
         str(output / f'T3-Code-{version}-arm64.zip')])

if args.enable_updates:
    run(['node', 'scripts/sled/desktop-update-release.cjs', 'prepare',
         str(output / f'T3-Code-{version}-arm64.zip'), str(args.update_baseline_app.resolve()),
         str(root / '.tools/sled-update-releases' / version)])
