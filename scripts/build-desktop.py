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
args = parser.parse_args()
lock = json.loads((root / 'sources.lock.json').read_text())
checkout = root / lock['t3code']['checkout']
env = dict(os.environ)
env.pop('ELECTRON_RUN_AS_NODE', None)
env['T3CODE_DESKTOP_PRIVATE_BUILD'] = 'true'
env['T3CODE_DESKTOP_UPDATE_REPOSITORY'] = 'SamoyedLabs/sled-code'
env['T3CODE_DESKTOP_PRIVATE_HOME'] = str(root / '.tools/desktop-review/home')
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
version = lock['t3code']['tag'].removeprefix('v')
output = root / '.tools/desktop-artifacts'

def run(command, cwd=root):
    subprocess.run(command, cwd=cwd, env=env, check=True)

run([sys.executable, 'scripts/sled/prepare-native.py'])
run([sys.executable, 'scripts/build-host.py'])
run(['pnpm', 'exec', 'vp', 'run', 'build:desktop'], checkout)
run(['pnpm', 'exec', 'vp', 'run', 'dist:desktop:artifact', '--platform', 'mac',
     '--target', 'zip', '--arch', 'arm64', '--build-version', version,
     '--skip-build', '--output-dir', str(output)], checkout)
if env.get('T3_REMOTE_SIGNING_IDENTITY', '-') != '-':
    run(['node', 'scripts/sign-private-desktop.cjs',
         str(output / f'T3-Code-{version}-arm64.zip')])
run(['node', 'scripts/verify-desktop-package.cjs',
     str(output / f'T3-Code-{version}-arm64.zip')])
print('Private desktop ZIP:', output / f'T3-Code-{version}-arm64.zip')
print('For stable local Keychain identity, supply T3_REMOTE_SIGNING_IDENTITY. Public distribution also needs outer-app signing and notarization.')
