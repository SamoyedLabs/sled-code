#!/usr/bin/env python3
"""GitHub-hosted release coordination. Never reads this machine's credential files."""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys
import time

REPO = 'SamoyedLabs/sled-code'

def run(*args):
    return subprocess.check_output(args, text=True).strip()

def api(endpoint):
    return json.loads(run('gh', 'api', f'repos/{REPO}/{endpoint}'))

def output(**values):
    with open(os.environ['GITHUB_OUTPUT'], 'a') as stream:
        for key, value in values.items():
            stream.write(f'{key}={value}\n')

def resolve():
    sha = api('git/ref/heads/main')['object']['sha']
    checks = api(f'commits/{sha}/check-runs?per_page=100')['check_runs']
    # Never publish a candidate branch or use an unrelated main/PR check.
    gate = next((c for c in checks if c['name'] == 'Check' and c['head_sha'] == sha
                 and c['app']['slug'] == 'github-actions'), None)
    if not gate or gate['conclusion'] != 'success':
        print('Main is not yet certified by Check; no release started.')
        return
    releases = api('releases?per_page=100')
    if any(f'Sled source: {sha}' in (r.get('body') or '') for r in releases):
        print('This source already has a release or retained draft; no duplicate.')
        return
    run_number = int(os.environ['GITHUB_RUN_NUMBER'])
    version = f"0.{2 + run_number // 60000}.{run_number % 60000}"
    output(sha=sha, version=version)

def credentials(platform):
    private_mac = os.environ.get('SLED_MAC_DISTRIBUTION', 'private-development') == 'private-development'
    required = (['SLED_APPLE_TEAM_ID', 'CSC_LINK', 'CSC_KEY_PASSWORD'] +
                (['SLED_MAC_SIGNING_REQUIREMENT'] if private_mac else
                 ['APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER'])) if platform == 'mac' else [
                    'SLED_WINDOWS_PUBLISHER_NAME', 'WIN_CSC_LINK', 'WIN_CSC_KEY_PASSWORD']
    required += ['T3CODE_RELAY_URL', 'T3CODE_CLERK_PUBLISHABLE_KEY',
                 'T3CODE_CLERK_CLI_OAUTH_CLIENT_ID', 'T3CODE_CLERK_JWT_TEMPLATE']
    missing = [key for key in required if not os.environ.get(key)]
    if missing:
        raise ValueError('Cloud signing/configuration not provisioned: ' + ', '.join(missing))
    if platform != 'mac':
        trust = os.environ.get('SLED_WINDOWS_TRUST_CERT')
        if trust:
            if os.environ.get('GITHUB_ACTIONS') != 'true' or os.environ.get('RUNNER_ENVIRONMENT') != 'github-hosted':
                raise ValueError('Machine certificate trust is restricted to disposable GitHub-hosted runners')
            if not re.fullmatch(r'[A-Fa-f0-9]{40}', os.environ.get('SLED_WINDOWS_SIGNER_THUMBPRINT', '')):
                raise ValueError('Dedicated private Windows trust requires the owner-approved certificate thumbprint')
            certificate = Path(os.environ['RUNNER_TEMP']) / 'sled-private-signing.cer'
            certificate.write_bytes(base64.b64decode(''.join(trust.split()), validate=True))
            subprocess.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command',
                "$ErrorActionPreference='Stop'; "
                '$c=New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($env:SLED_TRUST_FILE); '
                # CurrentUser Root import requires an interactive trust dialog on hosted Windows.
                'if($c.Thumbprint -ine $env:SLED_WINDOWS_SIGNER_THUMBPRINT){throw "Private certificate fingerprint mismatch"}; '
                'Import-Certificate -FilePath $env:SLED_TRUST_FILE -CertStoreLocation Cert:\LocalMachine\Root | Out-Null; '
                'Import-Certificate -FilePath $env:SLED_TRUST_FILE -CertStoreLocation Cert:\LocalMachine\TrustedPublisher | Out-Null; '
                '$chain=New-Object System.Security.Cryptography.X509Certificates.X509Chain; '
                'try { '
                '$chain.ChainPolicy.VerificationFlags=[System.Security.Cryptography.X509Certificates.X509VerificationFlags]::NoFlag; '
                '$chain.ChainPolicy.ApplicationPolicy.Add([System.Security.Cryptography.Oid]::new("1.3.6.1.5.5.7.3.3")); '
                'if(!$chain.Build($c)){throw ("Private code-signing chain is not trusted: " + ($chain.ChainStatus.Status -join ", "))} '
                '} finally {$chain.Dispose()}'],
                env={**os.environ, 'SLED_TRUST_FILE': str(certificate)}, check=True)
        return
    temporary = Path(os.environ['RUNNER_TEMP'])
    cert = temporary / 'sled-signing.p12'
    cert.write_bytes(base64.b64decode(''.join(os.environ['CSC_LINK'].split()), validate=True))
    cert.chmod(0o600)
    keychain = str(temporary / 'sled-signing.keychain-db')
    password = secrets.token_hex(32)
    print('::add-mask::' + password)
    for command in [
        ['security', 'create-keychain', '-p', password, keychain],
        ['security', 'set-keychain-settings', '-lut', '21600', keychain],
        ['security', 'unlock-keychain', '-p', password, keychain],
        ['security', 'import', str(cert), '-k', keychain, '-P', os.environ['CSC_KEY_PASSWORD'], '-T', '/usr/bin/codesign'],
        ['security', 'set-key-partition-list', '-S', 'apple-tool:,apple:', '-s', '-k', password, keychain],
    ]:
        subprocess.run(command, check=True, stdout=subprocess.DEVNULL)
    current = run('security', 'list-keychains', '-d', 'user').replace('"', '').split()
    subprocess.run(['security', 'list-keychains', '-d', 'user', '-s', keychain, *current], check=True)
    identities = run('security', 'find-identity', '-v', '-p', 'codesigning', keychain)
    prefix = 'Apple Development' if private_mac else 'Developer ID Application'
    pattern = r'"(' + re.escape(prefix) + r': [^"\n]+)"'
    matches = re.findall(pattern, identities)
    if len(matches) != 1:
        raise ValueError('Require exactly one authorized ' + prefix + ' signing identity')
    exports = {'T3_REMOTE_SIGNING_IDENTITY': matches[0], 'CSC_NAME': matches[0]}
    if not private_mac:
        key = temporary / 'sled-notary.p8'
        key.write_text(os.environ['APPLE_API_KEY'])
        key.chmod(0o600)
        exports.update(APPLE_API_KEY=str(key), APPLE_API_KEY_ID=os.environ['APPLE_API_KEY_ID'],
                       APPLE_API_ISSUER=os.environ['APPLE_API_ISSUER'])
    with open(os.environ['GITHUB_ENV'], 'a') as stream:
        for name, value in exports.items():
            stream.write(f'{name}={value}\n')
    cert.unlink()

def sha256(path):
    with path.open('rb') as stream:
        result = hashlib.sha256()
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(block)
        return result.hexdigest()

def publish_once():
    version = os.environ['SLED_RELEASE_VERSION']
    sha = os.environ['SLED_RELEASE_SHA']
    if not re.fullmatch(r'0\.[0-9]+\.[0-9]+', version) or not re.fullmatch(r'[0-9a-f]{40}', sha):
        raise ValueError('Invalid release provenance')
    folder = Path('release-desktop')
    # Each native job freezes exactly the files it certified; unlisted files never publish.
    assets = {}
    for platform in ['mac', 'win']:
        manifest_path = folder / f'verified-{platform}.json'
        manifest = json.loads(manifest_path.read_text())
        if manifest['version'] != version or manifest['platform'] != platform:
            raise ValueError('Cross-platform version mismatch')
        for name, checksum in manifest['hashes'].items():
            if Path(name).name != name or name in assets or sha256(folder / name) != checksum:
                raise ValueError('Invalid, duplicate, or modified certified artifact')
            assets[name] = checksum
        assets[manifest_path.name] = sha256(manifest_path)
    tag = 'v' + version
    marker = 'Sled source: ' + sha
    existing = next((r for r in api('releases?per_page=100') if r['tag_name'] == tag), None)
    if existing:
        if existing.get('body') != marker or existing.get('target_commitish') != sha:
            raise ValueError('Existing release has different source provenance')
        release_id = existing['id']
    else:
        run('gh', 'release', 'create', tag, '--repo', REPO, '--target', sha, '--draft',
            '--title', 'Sled Code ' + version, '--notes', marker)
        release_id = json.loads(run('gh', 'release', 'view', tag, '--repo', REPO, '--json', 'databaseId'))['databaseId']
    release = api(f'releases/{release_id}')
    remote = {a['name']: a for a in release['assets']}
    if any(name not in assets or asset.get('digest') != 'sha256:' + assets[name]
           for name, asset in remote.items()):
        raise ValueError('Remote asset digest mismatch; release retained without changes')
    missing = sorted(set(assets) - set(remote))
    if not release['draft']:
        if missing:
            raise ValueError('Published release is missing certified assets')
        print('Certified release already published; no build or upload repeated.')
        return
    if missing:
        print(f'[publish] Uploading {len(missing)} remaining certified assets', flush=True)
        run('gh', 'release', 'upload', tag, '--repo', REPO, *[str(folder / name) for name in missing])
    remote = {a['name']: a for a in api(f'releases/{release_id}')['assets']}
    if set(remote) != set(assets) or any(remote[n].get('digest') != 'sha256:' + digest for n, digest in assets.items()):
        raise ValueError('Remote asset digest mismatch; release retained as draft')
    run('gh', 'api', '--method', 'PATCH', f'repos/{REPO}/releases/{release_id}',
        '-F', 'draft=false', '-F', 'prerelease=false', '-f', 'make_latest=true')


def publish():
    for attempt in range(3):
        try:
            return publish_once()
        except subprocess.CalledProcessError:
            if attempt == 2:
                raise
            print('[publish] GitHub operation failed; reconciling retained assets before retry', flush=True)
            time.sleep(2 ** (attempt + 1))

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['resolve', 'credentials', 'publish'])
    parser.add_argument('--platform', choices=['mac', 'win'])
    args = parser.parse_args()
    try:
        if args.action == 'credentials':
            if not args.platform:
                parser.error('credentials requires --platform')
            credentials(args.platform)
        else:
            globals()[args.action]()
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        # CalledProcessError string contains credential-bearing argv; never print it.
        print('Hosted release stopped: ' + (str(error) if isinstance(error, ValueError) else type(error).__name__), file=sys.stderr)
        sys.exit(1)
