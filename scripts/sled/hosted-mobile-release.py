#!/usr/bin/env python3
"""Hosted iOS releases. Disabled until SLED_MOBILE_RELEASE_ENABLED=true.

Secrets: SLED_IOS_CSC_LINK (base64 p12), SLED_IOS_CSC_KEY_PASSWORD,
SLED_IOS_PROVISIONING_PROFILE (base64), SLED_APPLE_API_KEY (PEM),
SLED_APPLE_API_KEY_ID, SLED_APPLE_API_ISSUER, SLED_EXPO_TOKEN.
Use an Expo organization robot with Developer access only to samoyed-labs;
never export a local OAuth session. GitHub token needs contents:write/checks:read.

Bootstrap only after independently confirming Apple's upload: `seed --artifact-dir
DIR --source-sha SHA`. This re-verifies retained archive/IPA and upload status,
but cannot prove Apple processing or installation. The seed is an explicit operator
attestation of upload acceptance. Publish the generated baseline.json using
`gh release create sled-ios-native-2 baseline.json --target SHA --prerelease`.
Never delete an interrupted sled-mobile-SHA draft to retry without reconciling
Expo/Apple first: the draft reserves an external operation whose result may be
unknown. Published native baselines and artifacts are retained indefinitely.
"""
import argparse
import base64
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import secrets
import shlex
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
REPO = 'SamoyedLabs/sled-code'
PROJECT = '707658f3-e37c-410c-b0fd-74aadb09e855'
CHANNEL = 'sled-private'
TEAM = 'WYW7983W9W'
BUNDLE = 'com.samoyedlabs.sled'
PUBLIC = ('T3CODE_RELAY_URL', 'T3CODE_CLERK_PUBLISHABLE_KEY',
          'T3CODE_CLERK_CLI_OAUTH_CLIENT_ID', 'T3CODE_CLERK_JWT_TEMPLATE')
SECRETS = ('SLED_IOS_CSC_LINK', 'SLED_IOS_CSC_KEY_PASSWORD',
           'SLED_IOS_PROVISIONING_PROFILE', 'SLED_APPLE_API_KEY',
           'SLED_APPLE_API_KEY_ID', 'SLED_APPLE_API_ISSUER', 'SLED_EXPO_TOKEN')


def run(command, cwd=ROOT, capture=False, private=False):
    result = subprocess.run(command, cwd=cwd, check=False, text=True,
                            capture_output=capture or private)
    if result.returncode:
        if private:
            raise RuntimeError('Private signing operation failed (output suppressed)')
        raise RuntimeError(f'Command failed: {command[0]} (exit {result.returncode})')
    return result.stdout if capture else None


def gh(*args):
    return run(['gh', *args], capture=True)


def api(path):
    return json.loads(gh('api', f'repos/{REPO}/{path}'))


def write(path, value):
    path.write_text(json.dumps(value, indent=2) + '\n')


def validate_baseline(value):
    expected = dict(bundleIdentifier=BUNDLE, team=TEAM, projectId=PROJECT, channel=CHANNEL,
                    signatureVerified=True, appStoreProfile=True, embeddedJS=True,
                    webRTC=True, uploaded=True)
    if any(value.get(k) != v for k, v in expected.items()):
        raise ValueError('Baseline lacks verified private native identity/upload evidence')
    for key in ('runtimeVersion', 'sourceSha', 'ipaSha256'):
        if not re.fullmatch('[0-9a-f]{' + ('64' if key == 'ipaSha256' else '40') + '}', value.get(key, '')):
            raise ValueError(f'Invalid baseline {key}')
    if not re.fullmatch('[1-9][0-9]*', str(value.get('build', ''))):
        raise ValueError('Invalid baseline build')
    return value


def decide(runtime, baseline):
    validate_baseline(baseline)
    if not re.fullmatch('[0-9a-f]{40}', runtime):
        raise ValueError('Expected calculated fingerprint runtime')
    return 'ota' if runtime == baseline['runtimeVersion'] else 'native'


def releases():
    pages = json.loads(gh('api', '--paginate', '--slurp', f'repos/{REPO}/releases?per_page=100'))
    return [item for page in pages for item in page]


def baseline_from_releases(items, output):
    candidates = [r for r in items if not r['draft'] and re.fullmatch(r'sled-ios-native-[1-9][0-9]*', r['tag_name'])]
    if not candidates:
        raise ValueError('Missing verified native baseline: seed the retained uploaded release first')
    latest = max(candidates, key=lambda r: int(r['tag_name'].rsplit('-', 1)[1]))
    gh('release', 'download', latest['tag_name'], '--repo', REPO, '--pattern', 'baseline.json', '--dir', str(output))
    baseline = validate_baseline(json.loads((output / 'baseline.json').read_text()))
    if latest['tag_name'] != 'sled-ios-native-' + str(baseline['build']):
        raise ValueError('Baseline tag/build mismatch')
    return baseline


def checked_main():
    if (os.environ.get('GITHUB_REPOSITORY') != REPO
            or os.environ.get('GITHUB_REF') != 'refs/heads/main'):
        raise ValueError('Release execution requires trusted main in the Sled repository')
    sha = api('commits/main')['sha']
    if run(['git', 'rev-parse', 'HEAD'], capture=True).strip() != sha:
        raise ValueError('Checkout is no longer current main; rerun')
    checks = json.loads(gh('api', '--paginate', '--slurp',
                          f'repos/{REPO}/commits/{sha}/check-runs?per_page=100'))
    gates = [c for p in checks for c in p['check_runs'] if c['name'] == 'Check'
             and c['app']['slug'] == 'github-actions']
    if not gates or max(gates, key=lambda c: c['id'])['conclusion'] != 'success':
        raise ValueError('Current main lacks a successful GitHub Actions Check gate')
    return sha


def configure():
    missing = [k for k in (*PUBLIC, *SECRETS[:-1]) if not os.environ.get(k)]
    if missing:
        raise ValueError('Missing release settings: ' + ', '.join(missing))
    if os.environ.get('SLED_APPLE_TEAM_ID') != TEAM:
        raise ValueError('Unexpected Apple team variable')
    for key in ('EXPO_UPDATES_FINGERPRINT_OVERRIDE', 'EXPO_UPDATES_WORKFLOW_OVERRIDE'):
        os.environ.pop(key, None)
    os.environ.update(APP_VARIANT='development', MOBILE_VERSION_POLICY='fingerprint',
                      T3CODE_MOBILE_UPDATES_ENABLED='1', T3CODE_IOS_TEAM_ID=TEAM,
                      T3CODE_IOS_PERSONAL_TEAM='1', T3CODE_IOS_PERSONAL_TEAM_BUNDLE_ID=BUNDLE,
                      SLED_EXPO_PROJECT_ID=PROJECT, SLED_EXPO_OWNER='samoyed-labs',
                      SLED_EXPO_CHANNEL=CHANNEL, CI='1', EXPO_NO_GIT_STATUS='1',
                      EXPO_NO_DOTENV='1')
    if os.environ.get('SLED_EXPO_TOKEN'):
        os.environ['EXPO_TOKEN'] = os.environ['SLED_EXPO_TOKEN']


def check_environment(manifest):
    value = json.loads(manifest.read_text())
    if any(os.environ.get(key) != expected for key, expected in value['environment'].items()):
        raise ValueError('EAS environment changes the validated local release configuration')
    if runtime() != value['runtimeVersion']:
        raise ValueError('EAS environment changes native runtime; refusing OTA publication')


def runtime():
    return json.loads(run(['pnpm', 'exec', 'expo-updates', 'runtimeversion:resolve',
                           '--platform', 'ios'], cwd=ROOT / 'apps/mobile', capture=True))['runtimeVersion']


def verify(path):
    return json.loads(run([sys.executable, 'scripts/sled/verify-ios-artifact.py', str(path)], capture=True))


def evidence(directory, sha):
    archive = verify(directory / 'T3CodeRemote.xcarchive')
    ipas = list((directory / 'export').glob('*.ipa'))
    if len(ipas) != 1:
        raise ValueError('Expected one retained IPA')
    ipa = verify(ipas[0])
    if any(archive[k] != ipa[k] for k in ('build', 'version', 'runtimeVersion', 'bundleIdentifier', 'team')):
        raise ValueError('Archive/IPA identity or runtime mismatch')
    status = json.loads((directory / 'status.json').read_text())
    if (not all(status.get(k) is True for k in ('archiveSucceeded', 'appStoreExportSucceeded', 'uploaded'))
            or status.get('build') != ipa['build'] or status.get('bundleIdentifier') != BUNDLE
            or status.get('team') != TEAM):
        raise ValueError('Missing successful upload evidence for validated IPA')
    value = dict(ipa, projectId=PROJECT, sourceSha=sha, uploaded=True,
                 ipaSha256=hashlib.sha256(ipas[0].read_bytes()).hexdigest(),
                 verifiedAt=datetime.now(timezone.utc).isoformat())
    return validate_baseline(value)


def signing(directory):
    directory.mkdir(mode=0o700)
    p12 = directory / 'distribution.p12'
    p12.write_bytes(base64.b64decode(os.environ['SLED_IOS_CSC_LINK'], validate=True))
    profile_path = directory / 'distribution.mobileprovision'
    profile_path.write_bytes(base64.b64decode(os.environ['SLED_IOS_PROVISIONING_PROFILE'], validate=True))
    profile = plistlib.loads(run(['security', 'cms', '-D', '-i', str(profile_path)], capture=True, private=True).encode())
    if (profile['TeamIdentifier'] != [TEAM]
            or profile['Entitlements']['application-identifier'] != TEAM + '.' + BUNDLE
            or profile['Entitlements'].get('get-task-allow')
            or 'ProvisionedDevices' in profile or profile.get('ProvisionsAllDevices')):
        raise ValueError('Expected Sled App Store distribution profile')
    if profile['ExpirationDate'].replace(tzinfo=timezone.utc) <= datetime.now(timezone.utc):
        raise ValueError('Distribution profile expired')
    for location in ('Library/MobileDevice/Provisioning Profiles',
                     'Library/Developer/Xcode/UserData/Provisioning Profiles'):
        profiles = Path.home() / location
        profiles.mkdir(parents=True, exist_ok=True)
        shutil.copy2(profile_path, profiles / (profile['UUID'] + '.mobileprovision'))
    keychain = directory / 'release.keychain-db'
    password = secrets.token_urlsafe(32)
    for command in [
        ['security', 'create-keychain', '-p', password, str(keychain)],
        ['security', 'set-keychain-settings', '-lut', '21600', str(keychain)],
        ['security', 'unlock-keychain', '-p', password, str(keychain)],
        ['security', 'import', str(p12), '-k', str(keychain), '-P', os.environ['SLED_IOS_CSC_KEY_PASSWORD'], '-T', '/usr/bin/codesign'],
        ['security', 'set-key-partition-list', '-S', 'apple-tool:,apple:', '-k', password, str(keychain)],
    ]:
        run(command, private=True)
    identities = run(['security', 'find-identity', '-v', '-p', 'codesigning', str(keychain)], capture=True, private=True)
    hashes = re.findall(r'\b[0-9A-F]{40}\b', identities)
    if len(hashes) != 1:
        raise ValueError('Expected one imported distribution signing identity')
    key = directory / 'AuthKey.p8'
    key.write_text(os.environ['SLED_APPLE_API_KEY'])
    password_file = directory / 'keychain-password'
    password_file.write_text(password)
    write(directory / 'distribution-signing.json', dict(bundleIdentifier=BUNDLE,
          certificateSha1=hashes[0], profileUuid=profile['UUID'], keychainPath=str(keychain), passwordFile=str(password_file)))
    write(directory / 'app-store-connect.json', dict(privateKeyPath=str(key),
          keyId=os.environ['SLED_APPLE_API_KEY_ID'], issuerId=os.environ['SLED_APPLE_API_ISSUER']))
    return keychain


def release():
    sha = checked_main()
    configure()
    output = ROOT / 'release-mobile'
    output.mkdir(exist_ok=False)
    items = releases()
    tag = 'sled-mobile-' + sha
    existing = next((r for r in items if r['tag_name'] == tag), None)
    if existing:
        if existing['draft']:
            raise ValueError('Interrupted release draft: reconcile Apple/Expo before retrying')
        print('This commit was already released')
        return
    baseline = baseline_from_releases(items, output)
    unresolved = [r for r in items if r['draft'] and r['tag_name'].startswith('sled-mobile-')]
    if unresolved:
        raise ValueError('An earlier mobile release is unresolved; reconcile it before continuing')
    run([sys.executable, 'scripts/sled/prepare-native.py'])
    mobile = ROOT / 'apps/mobile'
    # Reconstruct managed native config on every run; never copy a runtime override.
    run(['pnpm', 'exec', 'expo', 'prebuild', '--platform', 'ios', '--no-install'], cwd=mobile)
    source_runtime = runtime()
    mode = decide(source_runtime, baseline)
    if mode == 'ota' and not os.environ.get('SLED_EXPO_TOKEN'):
        raise ValueError('OTA requires dedicated SLED_EXPO_TOKEN; local OAuth sessions are forbidden')
    write(output / 'plan.json', dict(sourceSha=sha, runtimeVersion=source_runtime, mode=mode,
                                    baselineBuild=baseline['build']))
    gh('release', 'create', tag, '--repo', REPO, '--target', sha, '--draft',
       '--title', 'Sled mobile ' + sha[:12], '--notes', 'Reserved release; reconcile interrupted uploads before retrying.')
    if mode == 'ota':
        manifest = output / 'ota-environment.json'
        keys = (*PUBLIC, 'APP_VARIANT', 'MOBILE_VERSION_POLICY', 'T3CODE_MOBILE_UPDATES_ENABLED',
                'T3CODE_IOS_TEAM_ID', 'T3CODE_IOS_PERSONAL_TEAM', 'T3CODE_IOS_PERSONAL_TEAM_BUNDLE_ID',
                'SLED_EXPO_PROJECT_ID', 'SLED_EXPO_OWNER', 'SLED_EXPO_CHANNEL', 'EXPO_NO_DOTENV')
        write(manifest, dict(runtimeVersion=source_runtime,
                             environment={key: os.environ[key] for key in keys}))
        check_command = shlex.join([sys.executable, str(Path(__file__).resolve()),
                                    'check-environment', '--manifest', str(manifest)])
        run(['npx', '--yes', 'eas-cli@27.4.1', 'env:exec', 'production', check_command,
             '--non-interactive'], cwd=mobile)
        exported = output / 'ota'
        run(['pnpm', 'exec', 'expo', 'export', '--platform', 'ios', '--output-dir', str(exported)], cwd=mobile)
        if runtime() != source_runtime:
            raise ValueError('Runtime changed during OTA export')
        receipt = run(['npx', '--yes', 'eas-cli@27.4.1', 'update', '--auto', '--platform', 'ios',
                       '--channel', CHANNEL, '--environment', 'production', '--input-dir', str(exported),
                       '--skip-bundler', '--message', 'Sled ' + sha, '--non-interactive', '--json'], cwd=mobile, capture=True)
        receipt = json.loads(receipt)
        write(output / 'ota-receipt.json', receipt)
        if (not isinstance(receipt, list) or not receipt
                or any(update.get('platform') != 'ios' or update.get('runtimeVersion') != source_runtime
                       for update in receipt)):
            raise ValueError('Unexpected Expo publication receipt; reconcile reserved draft before retrying')
        gh('release', 'upload', tag, str(output / 'ota-receipt.json'), '--repo', REPO)
    else:
        build = str(int(baseline['build']) + 1)
        native = output / 'native'
        public = output / 'public-config.json'
        write(public, {key: os.environ[key] for key in PUBLIC})
        with tempfile.TemporaryDirectory(prefix='sled-signing-') as temporary:
            credentials = Path(temporary) / 'credentials'
            keychain = None
            try:
                keychain = signing(credentials)
                common = ['--team', TEAM, '--build-number', build, '--public-config', str(public),
                          '--credentials-dir', str(credentials), '--output-dir', str(native)]
                run([sys.executable, 'scripts/testflight-ios.py', 'archive', *common,
                     '--prepare', '--enable-ota', '--ota-channel', CHANNEL, '--manual-signing'])
                run([sys.executable, 'scripts/testflight-ios.py', 'export', *common])
                archive_evidence = verify(native / 'T3CodeRemote.xcarchive')
                ipa = next((native / 'export').glob('*.ipa'))
                ipa_evidence = verify(ipa)
                if (archive_evidence['runtimeVersion'] != source_runtime
                        or ipa_evidence['runtimeVersion'] != source_runtime or runtime() != source_runtime):
                    raise ValueError('Generated source/archive/IPA runtime mismatch; refusing upload')
                write(output / 'archive-validation.json', archive_evidence)
                write(output / 'ipa-validation.json', ipa_evidence)
                # Retain signed native artifacts before making an external upload.
                packed = output / ('Sled-' + build + '.xcarchive.zip')
                run(['ditto', '-c', '-k', '--sequesterRsrc', '--keepParent', str(native / 'T3CodeRemote.xcarchive'), str(packed)])
                gh('release', 'upload', tag, str(packed), str(ipa), '--repo', REPO)
                run([sys.executable, 'scripts/testflight-ios.py', 'upload', *common])
                new_baseline = evidence(native, sha)
                write(output / 'baseline.json', new_baseline)
                native_tag = 'sled-ios-native-' + build
                gh('release', 'create', native_tag, str(output / 'baseline.json'),
                   str(output / 'archive-validation.json'), str(output / 'ipa-validation.json'),
                   '--repo', REPO, '--target', sha, '--prerelease', '--title', 'Sled iOS native ' + build,
                   '--notes', 'Signed archive and IPA verified; TestFlight upload accepted. Native artifacts in ' + tag)
            finally:
                if keychain:
                    run(['security', 'delete-keychain', str(keychain)], private=True)
    gh('release', 'upload', tag, str(output / 'plan.json'), '--repo', REPO)
    gh('release', 'edit', tag, '--repo', REPO, '--draft=false', '--prerelease',
       '--notes', 'Completed ' + mode + ' release from checked main ' + sha + '. TestFlight installation remains user controlled.')


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest='command', required=True)
    commands.add_parser('release')
    check = commands.add_parser('check-environment')
    check.add_argument('--manifest', type=Path, required=True)
    seed = commands.add_parser('seed')
    seed.add_argument('--artifact-dir', type=Path, required=True)
    seed.add_argument('--source-sha', required=True)
    seed.add_argument('--output', type=Path, default=Path('baseline.json'))
    args = parser.parse_args()
    if args.command == 'seed':
        if args.output.exists():
            parser.error('Refusing to replace baseline output')
        value = evidence(args.artifact_dir.resolve(), args.source_sha)
        value['provenance'] = 'operator-attested-retained-upload'
        write(args.output, value)
    elif args.command == 'check-environment':
        check_environment(args.manifest)
    else:
        release()


if __name__ == '__main__':
    main()
