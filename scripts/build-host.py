#!/usr/bin/env python3
"""Build a development helper bundle without modifying the installed T3 app."""
import json
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import sys

root = Path(__file__).resolve().parents[1]
subprocess.run([sys.executable, str(root / 'scripts/prepare-webrtc-notices.py')], check=True)
lock = json.loads((root / 'sources.lock.json').read_text())
sill = root / lock['sill']['checkout']
t3 = root / lock['t3code']['checkout']
subprocess.run(['swift', 'build', '--package-path', str(sill), '-c', 'release', '--product', 'T3RemoteHost'], check=True)
bin_dir = subprocess.check_output(['swift', 'build', '--package-path', str(sill), '-c', 'release', '--show-bin-path'], text=True).strip()
contents = t3 / 'apps/desktop/prod-resources/remote-desktop/T3RemoteHost.app/Contents'
(contents / 'MacOS').mkdir(parents=True, exist_ok=True)
(contents / 'Resources').mkdir(exist_ok=True)
shutil.copy2(Path(bin_dir) / 'T3RemoteHost', contents / 'MacOS/T3RemoteHost')
shutil.copy2(sill / 'LICENSE', contents / 'Resources/Sill-LICENSE.txt')
shutil.copy2(t3 / 'apps/mobile/modules/t3-remote-desktop/Vendor/MODIFICATIONS.md', contents / 'Resources/Sill-MODIFICATIONS.md')
framework_source = root / '.tools/webrtc/LiveKitWebRTC.xcframework/macos-arm64_x86_64/LiveKitWebRTC.framework'
framework_destination = contents / 'Frameworks/LiveKitWebRTC.framework'
if framework_destination.exists():
    shutil.rmtree(framework_destination)
framework_destination.parent.mkdir(exist_ok=True)
shutil.copytree(framework_source, framework_destination, symlinks=True)
shutil.copy2(root / '.tools/webrtc/LiveKitWebRTC.xcframework/LICENSE', contents / 'Resources/LiveKitWebRTC-LICENSE.txt')
for name in ['LiveKitWebRTC-THIRD-PARTY-NOTICES.txt', 'LiveKitWebRTC-PROVENANCE.json']:
    shutil.copy2(t3 / 'apps/mobile/modules/t3-remote-desktop/Vendor' / name, contents / 'Resources' / name)
subprocess.run(['install_name_tool', '-add_rpath', '@executable_path/../Frameworks', str(contents / 'MacOS/T3RemoteHost')], check=True)
with (contents / 'Info.plist').open('wb') as output:
    plistlib.dump({
        'CFBundleIdentifier': 'com.t3tools.remote-desktop.host',
        'CFBundleName': 'T3 Remote Desktop',
        'CFBundleExecutable': 'T3RemoteHost',
        'CFBundlePackageType': 'APPL',
        'CFBundleShortVersionString': '0.0.1',
        'CFBundleVersion': '1',
        'LSMinimumSystemVersion': '14.0',
        'LSUIElement': True,
        'NSScreenCaptureUsageDescription': 'Share this Mac with your paired T3 Code devices.',
    }, output)
identity = os.environ.get('T3_REMOTE_SIGNING_IDENTITY', '-')
# Ad-hoc signatures have no Team ID, so hardened library validation cannot bind
# two ad-hoc images to the same team. Distribution keeps hardened runtime and
# signs the executable/framework with the same supplied identity. An Apple
# Development identity can stabilize local Keychain trust across rebuilds;
# external distribution still requires Developer ID signing and notarization.
options = '0' if identity == '-' else 'runtime'
subprocess.run(['codesign', '--force', '--options', options, '--sign', identity, str(framework_destination)], check=True)
subprocess.run(['codesign', '--force', '--options', options, '--sign', identity, str(contents.parent)], check=True)
print(contents.parent)
if identity == '-':
    print('Development ad-hoc signature. Distribution still requires Developer ID signing and notarization.')
