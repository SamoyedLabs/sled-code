#!/usr/bin/env python3
"""Verify this private Sled iOS archive or exported IPA without disclosing signing secrets."""
import argparse
import json
from pathlib import Path
import plistlib
import re
import subprocess
import tempfile
import zipfile


def verify(app, distribution):
    info = plistlib.loads((app / 'Info.plist').read_bytes())
    updates = plistlib.loads((app / 'Expo.plist').read_bytes())
    if updates.get('EXUpdatesRuntimeVersion') == 'file:fingerprint':
        updates['EXUpdatesRuntimeVersion'] = (app / 'EXUpdates.bundle/fingerprint').read_text().strip()
    subprocess.run(['codesign', '--verify', '--deep', '--strict', str(app)], check=True, capture_output=True)
    entitlements = plistlib.loads(subprocess.check_output(
        ['codesign', '-d', '--entitlements', ':-', str(app)], stderr=subprocess.DEVNULL))
    profile = plistlib.loads(subprocess.check_output(
        ['security', 'cms', '-D', '-i', str(app / 'embedded.mobileprovision')], stderr=subprocess.DEVNULL))
    assert info['CFBundleIdentifier'] == 'com.samoyedlabs.sled', 'Wrong app identity'
    assert entitlements['application-identifier'] == 'WYW7983W9W.com.samoyedlabs.sled', 'Wrong signing identity'
    assert entitlements['com.apple.developer.team-identifier'] == 'WYW7983W9W', 'Wrong team'
    assert profile['TeamIdentifier'] == ['WYW7983W9W'], 'Wrong profile team'
    if distribution:
        assert not entitlements.get('get-task-allow', False), 'Distribution permits debugging'
        assert 'ProvisionedDevices' not in profile and not profile.get('ProvisionsAllDevices'), 'Not an App Store profile'
    assert updates['EXUpdatesEnabled'] is True, 'OTA disabled'
    assert updates['EXUpdatesURL'] == 'https://u.expo.dev/707658f3-e37c-410c-b0fd-74aadb09e855', 'Wrong OTA destination'
    assert updates['EXUpdatesRequestHeaders']['expo-channel-name'] == 'sled-private', 'Wrong channel'
    runtime = updates['EXUpdatesRuntimeVersion']
    assert re.fullmatch('[0-9a-f]{40}', runtime), 'Expected fingerprint runtime'
    assert (app / 'main.jsbundle').is_file(), 'Missing embedded JS'
    assert (app / 'Frameworks/LiveKitWebRTC.framework/LiveKitWebRTC').is_file(), 'Missing WebRTC binary'
    print(json.dumps({'bundleIdentifier': info['CFBundleIdentifier'], 'version': info['CFBundleShortVersionString'],
                      'build': info['CFBundleVersion'], 'team': profile['TeamIdentifier'][0],
                      'runtimeVersion': runtime, 'channel': 'sled-private', 'signatureVerified': True,
                      'appStoreProfile': distribution, 'embeddedJS': True, 'webRTC': True}, indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('artifact', type=Path)
    args = parser.parse_args()
    if args.artifact.suffix == '.ipa':
        with tempfile.TemporaryDirectory(prefix='sled-ipa-') as directory:
            with zipfile.ZipFile(args.artifact) as archive:
                archive.extractall(directory)
            apps = list(Path(directory).glob('Payload/*.app'))
            if len(apps) != 1:
                parser.error('Expected one app in IPA')
            verify(apps[0], True)
    else:
        apps = list((args.artifact / 'Products/Applications').glob('*.app'))
        if len(apps) != 1:
            parser.error('Expected one app in archive')
        verify(apps[0], False)


if __name__ == '__main__':
    main()
