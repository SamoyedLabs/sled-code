#!/usr/bin/env python3
"""Install checksum-pinned native binaries; application source is tracked directly."""
from pathlib import Path
import os
import plistlib
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
subprocess.run([sys.executable, str(ROOT / 'scripts/prepare-webrtc.py')], check=True)
framework = ROOT / '.tools/webrtc/LiveKitWebRTC.xcframework'
host_framework = ROOT / 'native/remote-desktop/Frameworks/LiveKitWebRTC.xcframework'
host_framework.parent.mkdir(parents=True, exist_ok=True)
if not host_framework.exists():
    host_framework.symlink_to(os.path.relpath(framework, host_framework.parent), target_is_directory=True)
module = ROOT / 'apps/mobile/modules/t3-remote-desktop'
mobile_framework = module / 'Frameworks/LiveKitWebRTC.xcframework'
mobile_framework.mkdir(parents=True, exist_ok=True)
manifest = plistlib.loads((framework / 'Info.plist').read_bytes())
manifest['AvailableLibraries'] = [item for item in manifest['AvailableLibraries']
    if item['LibraryIdentifier'] in ('ios-arm64', 'ios-arm64_x86_64-simulator')]
for item in manifest['AvailableLibraries']:
    item.pop('DebugSymbolsPath', None)
(mobile_framework / 'Info.plist').write_bytes(plistlib.dumps(manifest))
shutil.copy2(framework / 'LICENSE', mobile_framework / 'LICENSE')
for name in ('ios-arm64', 'ios-arm64_x86_64-simulator'):
    destination = mobile_framework / name
    if not destination.exists():
        shutil.copytree(framework / name, destination, symlinks=True)
subprocess.run([sys.executable, str(ROOT / 'scripts/prepare-webrtc-notices.py')], check=True)
print('Sled native dependencies ready; tracked application sources unchanged.')
