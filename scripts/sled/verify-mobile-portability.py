#!/usr/bin/env python3
"""Check native fingerprint portability without publishing an update."""
import importlib.util
import json
import os
from pathlib import Path

spec = importlib.util.spec_from_file_location('release', Path(__file__).with_name('hosted-mobile-release.py'))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)
release.configure(require_signing=False)
output = Path(os.environ['RUNNER_TEMP']) / 'mobile-portability'
output.mkdir(exist_ok=True)
base = release.prepare_runtime(os.environ['GITHUB_SHA'], output)
source = release.ROOT / 'apps/mobile/modules/t3-remote-desktop/ios/T3RemoteDesktopModule.swift'
original = source.read_bytes()
try:
    source.write_bytes(original + b'\n// CI fingerprint portability probe.\n')
    changed = release.runtime()
finally:
    source.write_bytes(original)
if changed == base:
    raise SystemExit('Native Swift source changes must invalidate the OTA runtime')
restored = release.runtime()
if restored != base:
    raise SystemExit('Fingerprint changed after restoring identical source')
(output / 'fingerprints.json').write_text(json.dumps(dict(
    sourceSha=os.environ['GITHUB_SHA'], base=base, nativeChange=changed, restored=restored), indent=2) + '\n')
print(f'Fingerprint baseline: {base}; native-source change: {changed}; restoration verified')
