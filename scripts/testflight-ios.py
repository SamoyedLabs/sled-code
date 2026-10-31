#!/usr/bin/env python3
"""Archive the tested native iPhone app; export/upload only when explicitly selected."""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import plistlib
import shlex
import subprocess

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('action', choices=['archive', 'export', 'upload'])
parser.add_argument('--team', required=True)
parser.add_argument('--build-number', default='1')
parser.add_argument('--bundle-id', default='com.samoyedlabs.sled')
parser.add_argument('--prepare', action='store_true', help='Apply source integration and regenerate iOS configuration.')
args = parser.parse_args()
mobile = root / 'apps/mobile'
output = root / '.tools/testflight' / args.bundle_id
output.mkdir(parents=True, exist_ok=True)
archive = output / 'T3CodeRemote.xcarchive'
env = dict(os.environ)
env.pop('ELECTRON_RUN_AS_NODE', None)
env.update(APP_VARIANT='development', MOBILE_VERSION_POLICY='fingerprint',
           T3CODE_MOBILE_UPDATES_ENABLED='0', T3CODE_IOS_TEAM_ID=args.team,
           T3CODE_IOS_PERSONAL_TEAM='1', T3CODE_IOS_PERSONAL_TEAM_BUNDLE_ID=args.bundle_id,
           EXPO_NO_GIT_STATUS='1', CI='1',
           PATH=str(root / '.tools/bin') + os.pathsep + env.get('PATH', ''))
api_auth_path = root / '.tools/apple-credentials/app-store-connect.json'
api_auth = json.loads(api_auth_path.read_text()) if api_auth_path.exists() else None
api_auth_flags = []
if api_auth:
    api_auth_flags = ['-authenticationKeyPath', api_auth['privateKeyPath'],
                      '-authenticationKeyID', api_auth['keyId'],
                      '-authenticationKeyIssuerID', api_auth['issuerId']]
signing_path = root / '.tools/apple-credentials/distribution-signing.json'
signing = json.loads(signing_path.read_text()) if signing_path.exists() else None
if signing and signing['bundleIdentifier'] != args.bundle_id:
    raise SystemExit('Local distribution profile does not match the requested bundle ID')
public_config = root / '.tools/physical-device-control/connect-public-config.json'
if public_config.exists():
    public = json.loads(public_config.read_text())
    allowed = {'T3CODE_RELAY_URL', 'T3CODE_CLERK_PUBLISHABLE_KEY', 'T3CODE_CLERK_CLI_OAUTH_CLIENT_ID', 'T3CODE_CLERK_JWT_TEMPLATE'}
    if set(public) != allowed or not all(isinstance(v, str) for v in public.values()):
        raise SystemExit('Expected only the four public connection settings')
    env.update(public)
if args.action == 'archive':
    if args.prepare:
        import sys
        subprocess.run([sys.executable, 'scripts/sled/prepare-native.py'], cwd=root, env=env, check=True)
        with (output / 'prebuild.log').open('w') as stream:
            subprocess.run(['pnpm', 'exec', 'expo', 'prebuild', '--platform', 'ios', '--no-install'],
                           cwd=mobile, env=env, stdout=stream, stderr=subprocess.STDOUT, check=True)
    projects = list((mobile / 'ios').glob('*.xcodeproj'))
    if len(projects) != 1:
        raise SystemExit('Expected one generated iOS application project')
    project_name = projects[0].stem
    workspace = mobile / 'ios' / (project_name + '.xcworkspace')
    if not workspace.exists():
        with (output / 'pods.log').open('w') as stream:
            subprocess.run(['pod', 'install', '--no-repo-update'], cwd=mobile / 'ios', env=env,
                           stdout=stream, stderr=subprocess.STDOUT, check=True)
    command = ['xcodebuild', 'archive', '-workspace', str(workspace),
               '-scheme', project_name, '-configuration', 'Release', '-sdk', 'iphoneos',
               '-destination', 'generic/platform=iOS', '-jobs', '4',
               '-disableAutomaticPackageResolution', '-skipPackageUpdates',
               '-derivedDataPath', str(root / '.tools/ios-device-build'),
               '-archivePath', str(archive), '-allowProvisioningUpdates',
               'DEVELOPMENT_TEAM=' + args.team, 'CODE_SIGN_STYLE=Automatic',
               'CURRENT_PROJECT_VERSION=' + args.build_number]
else:
    if not archive.exists():
        raise SystemExit('Create the native archive first')
    with (archive / 'Info.plist').open('rb') as stream:
        metadata = plistlib.load(stream)['ApplicationProperties']
    if metadata.get('CFBundleIdentifier') != args.bundle_id or metadata.get('Team') != args.team:
        raise SystemExit('Archive identity does not match this private TestFlight target')
    options = output / ('UploadOptions.plist' if args.action == 'upload' else 'ExportOptions.plist')
    export_options = {'method': 'app-store-connect', 'destination': 'upload' if args.action == 'upload' else 'export',
                      'teamID': args.team, 'signingStyle': 'automatic', 'uploadSymbols': True,
                      'manageAppVersionAndBuildNumber': True, 'testFlightInternalTestingOnly': True}
    if signing:
        export_options.update(signingStyle='manual', signingCertificate=signing['certificateSha1'],
                              provisioningProfiles={args.bundle_id: signing['profileUuid']})
    with options.open('wb') as stream:
        plistlib.dump(export_options, stream)
    command = ['xcodebuild', '-exportArchive', '-archivePath', str(archive),
               '-exportPath', str(output / 'export'), '-exportOptionsPlist', str(options),
               '-allowProvisioningUpdates']
log = output / (args.action + '.log')
command += api_auth_flags
previous_keychains = None
try:
    if signing and args.action != 'archive':
        previous_keychains = shlex.split(subprocess.check_output(['security', 'list-keychains', '-d', 'user'], text=True))
        password = Path(signing['passwordFile']).read_text()
        for keychain_command in [
            ['security', 'unlock-keychain', '-p', password, signing['keychainPath']],
            ['security', 'list-keychains', '-d', 'user', '-s', signing['keychainPath'], *previous_keychains],
        ]:
            private_result = subprocess.run(keychain_command, capture_output=True)
            if private_result.returncode:
                raise SystemExit('Could not prepare the private distribution keychain')
    with log.open('w') as stream:
        result = subprocess.run(command, cwd=mobile, env=env, stdout=stream, stderr=subprocess.STDOUT)
finally:
    if previous_keychains is not None:
        subprocess.run(['security', 'list-keychains', '-d', 'user', '-s', *previous_keychains], capture_output=True)
        subprocess.run(['security', 'lock-keychain', signing['keychainPath']], capture_output=True)
print(args.action, 'exit:', result.returncode, 'log:', log)
if result.returncode == 0:
    with (archive / 'Info.plist').open('rb') as stream:
        metadata = plistlib.load(stream)['ApplicationProperties']
    if metadata.get('CFBundleIdentifier') != args.bundle_id or metadata.get('Team') != args.team:
        raise SystemExit('Built archive identity does not match the requested TestFlight target')
    status_path = output / 'status.json'
    status = json.loads(status_path.read_text()) if status_path.exists() else {}
    status.update(updatedAt=datetime.now(timezone.utc).isoformat(), team=args.team,
                  bundleIdentifier=args.bundle_id, version=metadata['CFBundleShortVersionString'],
                  build=metadata['CFBundleVersion'], internalTestFlightOnly=True)
    status[{'archive': 'archiveSucceeded', 'export': 'appStoreExportSucceeded', 'upload': 'uploaded'}[args.action]] = True
    status_path.write_text(json.dumps(status, indent=2) + '\n')
raise SystemExit(result.returncode)
