#!/usr/bin/env python3
"""Check native fingerprint portability without publishing an update."""
import importlib.util
import json
import os
import time
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

if os.environ.get('RUNNER_OS') == 'Linux':
    os.environ['SLED_METRO_CACHE_DIR'] = str(output / 'metro-cache')
    timings = []
    for label in ('cold', 'warm'):
        started = time.monotonic()
        release.run(['pnpm', 'exec', 'expo', 'export', '--platform', 'ios',
                     '--output-dir', str(output / ('ota-' + label))], cwd=release.ROOT / 'apps/mobile')
        elapsed = time.monotonic() - started
        if release.runtime() != base:
            raise SystemExit('Runtime changed during Linux OTA export')
        timings.append(dict(label=label, elapsed_seconds=round(elapsed, 3)))
        print(f'Linux OTA export ({label} Metro cache): {elapsed:.1f}s', flush=True)
    (output / 'export-timings.json').write_text(json.dumps(timings, indent=2) + '\n')
    with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as summary:
        summary.write('### Linux OTA export benchmark\n\n')
        for row in timings:
            summary.write(f'{row["label"]}: {row["elapsed_seconds"]:.1f}s\n\n')
        summary.write('Real iOS production bundles; same hosted VM. No update published.\n')
