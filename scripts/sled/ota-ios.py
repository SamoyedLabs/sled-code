#!/usr/bin/env python3
"""Check/export a matching iOS OTA bundle; publishing requires --publish."""
import argparse
import json
import os
from pathlib import Path
import plistlib
import re
import subprocess

ROOT = Path(__file__).resolve().parents[2]
PROJECT = '707658f3-e37c-410c-b0fd-74aadb09e855'
CHANNEL = 'sled-private'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', type=Path, required=True, help='Verified OTA-enabled .xcarchive')
    parser.add_argument('--public-config', type=Path, default=ROOT / '.tools/desktop-review/connect-public-config.json')
    parser.add_argument('--output', type=Path, default=ROOT / '.tools/ota-ios')
    parser.add_argument('--export', action='store_true')
    parser.add_argument('--publish', action='store_true')
    parser.add_argument('--message')
    parser.add_argument('--plan', action='store_true', help='Report ota/native as JSON without exporting or publishing.')
    args = parser.parse_args()
    if args.plan and (args.export or args.publish):
        parser.error('--plan cannot export or publish')
    if args.publish and not args.message:
        parser.error('--publish requires --message')
    apps = list((args.archive / 'Products/Applications').glob('*.app'))
    if len(apps) != 1:
        parser.error('Expected exactly one archived app')
    app = apps[0]
    info = plistlib.loads((app / 'Info.plist').read_bytes())
    updates = plistlib.loads((app / 'Expo.plist').read_bytes())
    if updates.get('EXUpdatesRuntimeVersion') == 'file:fingerprint':
        updates['EXUpdatesRuntimeVersion'] = (app / 'EXUpdates.bundle/fingerprint').read_text().strip()
    if (info['CFBundleIdentifier'] != 'com.samoyedlabs.sled'
            or updates.get('EXUpdatesEnabled') is not True
            or updates.get('EXUpdatesURL') != f'https://u.expo.dev/{PROJECT}'
            or updates.get('EXUpdatesRequestHeaders', {}).get('expo-channel-name') != CHANNEL):
        parser.error('Archive is not the expected OTA-enabled private Sled app')
    public = json.loads(args.public_config.read_text())
    allowed = {'T3CODE_RELAY_URL', 'T3CODE_CLERK_PUBLISHABLE_KEY',
               'T3CODE_CLERK_CLI_OAUTH_CLIENT_ID', 'T3CODE_CLERK_JWT_TEMPLATE'}
    if set(public) != allowed or not all(isinstance(v, str) and v for v in public.values()):
        parser.error('Expected exactly the four nonempty public connection settings')
    env = dict(os.environ, **public)
    env.pop('ELECTRON_RUN_AS_NODE', None)
    # Overrides could hide native changes from the compatibility check.
    for key in ('EXPO_UPDATES_FINGERPRINT_OVERRIDE', 'EXPO_UPDATES_WORKFLOW_OVERRIDE'):
        env.pop(key, None)
    env.update(APP_VARIANT='preview', MOBILE_VERSION_POLICY='fingerprint',
               T3CODE_MOBILE_UPDATES_ENABLED='1', T3CODE_IOS_TEAM_ID='WYW7983W9W',
               T3CODE_IOS_PERSONAL_TEAM='1', T3CODE_IOS_PERSONAL_TEAM_BUNDLE_ID='com.samoyedlabs.sled',
               SLED_EXPO_PROJECT_ID=PROJECT, SLED_EXPO_OWNER='samoyed-labs',
               SLED_EXPO_CHANNEL=CHANNEL, CI='1', EXPO_NO_GIT_STATUS='1')
    mobile = ROOT / 'apps/mobile'

    def run(command, capture=False):
        return subprocess.run(command, cwd=mobile, env=env, check=True, text=True,
                              stdout=subprocess.PIPE if capture else None)

    def calculate_runtime():
        resolved = json.loads(run(['pnpm', 'exec', 'expo-updates', 'runtimeversion:resolve',
                                   '--platform', 'ios'], True).stdout)
        runtime = resolved['runtimeVersion']
        if not isinstance(runtime, str) or not re.fullmatch('[0-9a-f]{40}', runtime):
            raise SystemExit('Expected a calculated native runtime fingerprint')
        return runtime

    runtime = calculate_runtime()
    mode = 'ota' if runtime == updates['EXUpdatesRuntimeVersion'] else 'native'
    if args.plan:
        print(json.dumps(dict(mode=mode, runtimeVersion=runtime,
                              archiveRuntimeVersion=updates['EXUpdatesRuntimeVersion'],
                              nativeBuild=info['CFBundleVersion'], projectId=PROJECT, channel=CHANNEL)))
        return
    if mode == 'native':
        raise SystemExit(f'Native build needed: source fingerprint {runtime} differs from archive '
                         f'{updates["EXUpdatesRuntimeVersion"]}. Do not override runtime.')
    print('Matching iOS runtime:', runtime, flush=True)
    if not (args.export or args.publish):
        return
    output = args.output.resolve()
    if output.exists():
        parser.error('Choose a new --output directory; retain earlier update artifacts')
    run(['pnpm', 'exec', 'expo', 'export', '--platform', 'ios', '--output-dir', str(output)])
    if calculate_runtime() != runtime:
        raise SystemExit('Native runtime changed during export; refusing publication')
    (output / 'sled-compatibility.json').write_text(json.dumps({
        'runtimeVersion': runtime, 'projectId': PROJECT, 'channel': CHANNEL,
        'bundleIdentifier': info['CFBundleIdentifier'], 'nativeBuild': info['CFBundleVersion'],
    }, indent=2) + '\n')
    if args.publish:
        # --auto keeps the verified local environment; explicit channel/message take precedence.
        # Only the exported JS/assets go to EAS; no native source or signing files.
        run(['npx', '--yes', 'eas-cli@27.4.1', 'update', '--auto', '--platform', 'ios', '--channel', CHANNEL,
             '--input-dir', str(output), '--skip-bundler', '--message', args.message, '--non-interactive'])


if __name__ == '__main__':
    main()
