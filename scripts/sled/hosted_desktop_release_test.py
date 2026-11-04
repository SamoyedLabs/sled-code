import base64
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('hosted', Path(__file__).with_name('hosted-desktop-release.py'))
hosted = importlib.util.module_from_spec(spec)
spec.loader.exec_module(hosted)

class HostedReleaseTest(unittest.TestCase):
    def test_resolve_requires_exact_main_check_and_deduplicates_drafts(self):
        sha = 'a' * 40
        def check(head=sha, conclusion='success'):
            return {'name': 'Check', 'head_sha': head, 'app': {'slug': 'github-actions'}, 'conclusion': conclusion}
        cases = [([], [], False), ([check(conclusion='failure')], [], False),
                 ([check(head='b' * 40)], [], False),
                 ([check()], [{'draft': True, 'body': 'Sled source: ' + sha}], False),
                 ([check()], [], True)]
        for checks, releases, expected in cases:
            with self.subTest(checks=checks, releases=releases), tempfile.TemporaryDirectory() as temp:
                target = Path(temp) / 'output'
                target.touch()
                with patch.dict(os.environ, {'GITHUB_RUN_NUMBER': '42', 'GITHUB_OUTPUT': str(target)}), patch.object(
                    hosted, 'api', side_effect=[{'object': {'sha': sha}}, {'check_runs': checks}, releases]):
                    hosted.resolve()
                self.assertEqual(target.read_text(), f'sha={sha}\nversion=0.2.42\n' if expected else '')

    def test_missing_cloud_credentials_fail_before_import_or_build(self):
        for platform in ['mac', 'win']:
            with self.subTest(platform=platform), patch.dict(os.environ, {}, clear=True), patch.object(hosted.subprocess, 'run') as run:
                with self.assertRaisesRegex(ValueError, 'Cloud signing/configuration not provisioned'):
                    hosted.credentials(platform)
                run.assert_not_called()

    def test_windows_trust_import_is_noninteractive_pinned_and_fail_closed(self):
        with tempfile.TemporaryDirectory() as temp:
            settings = {
                'WIN_CSC_LINK': 'fixture', 'WIN_CSC_KEY_PASSWORD': 'fixture',
                'SLED_WINDOWS_PUBLISHER_NAME': 'Sled Private Updates',
                'GITHUB_ACTIONS': 'true', 'RUNNER_ENVIRONMENT': 'github-hosted',
                'SLED_WINDOWS_TRUST_CERT': base64.b64encode(b'public certificate').decode(),
                'SLED_WINDOWS_SIGNER_THUMBPRINT': 'A' * 40, 'RUNNER_TEMP': temp,
                **{key: 'public' for key in ('T3CODE_RELAY_URL', 'T3CODE_CLERK_PUBLISHABLE_KEY',
                    'T3CODE_CLERK_CLI_OAUTH_CLIENT_ID', 'T3CODE_CLERK_JWT_TEMPLATE')},
            }
            with patch.dict(os.environ, settings, clear=True), patch.object(hosted.subprocess, 'run') as run:
                hosted.credentials('win')
            for runner in ('self-hosted', ''):
                with patch.dict(os.environ, {**settings, 'RUNNER_ENVIRONMENT': runner}, clear=True), patch.object(hosted.subprocess, 'run') as blocked:
                    with self.assertRaisesRegex(ValueError, 'disposable GitHub-hosted'):
                        hosted.credentials('win')
                    blocked.assert_not_called()
            command = run.call_args.args[0][-1]
            self.assertIn("$ErrorActionPreference='Stop'", command)
            self.assertNotIn('CurrentUser', command)
            self.assertIn('Cert:\\LocalMachine\\Root', command)
            self.assertIn('Cert:\\LocalMachine\\TrustedPublisher', command)
            self.assertLess(command.index('fingerprint mismatch'), command.index('Import-Certificate'))
            self.assertIn('ChainPolicy.VerificationFlags', command)
            self.assertIn('NoFlag', command)
            self.assertIn('Build($c)', command)
            self.assertTrue(run.call_args.kwargs['check'])
            with patch.dict(os.environ, settings, clear=True), patch.object(
                    hosted.subprocess, 'run', side_effect=hosted.subprocess.CalledProcessError(1, 'powershell')):
                with self.assertRaises(hosted.subprocess.CalledProcessError):
                    hosted.credentials('win')

    def test_private_mac_credentials_need_only_existing_identity_and_password(self):
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp) / 'env'
            settings = {
                'SLED_MAC_DISTRIBUTION': 'private-development', 'SLED_APPLE_TEAM_ID': 'WYW7983W9W',
                'SLED_MAC_SIGNING_REQUIREMENT': 'identifier "com.t3tools.t3code.remote-dev"',
                'CSC_LINK': base64.b64encode(b'test certificate').decode(), 'CSC_KEY_PASSWORD': 'test-password',
                'RUNNER_TEMP': temp, 'GITHUB_ENV': str(output),
                'T3CODE_RELAY_URL': 'public', 'T3CODE_CLERK_PUBLISHABLE_KEY': 'public',
                'T3CODE_CLERK_CLI_OAUTH_CLIENT_ID': 'public', 'T3CODE_CLERK_JWT_TEMPLATE': 'public',
            }
            with patch.dict(os.environ, settings, clear=True), patch.object(hosted.subprocess, 'run'), patch.object(
                hosted, 'run', side_effect=['', '1) HASH "Apple Development: Existing Owner (ID)"']):
                hosted.credentials('mac')
            self.assertIn('CSC_NAME=Apple Development:', output.read_text())
            self.assertNotIn('APPLE_API_KEY', output.read_text())
            self.assertFalse((Path(temp) / 'sled-notary.p8').exists())
            self.assertFalse((Path(temp) / 'sled-signing.p12').exists())

    def test_publish_refuses_changed_artifacts_before_creating_draft(self):
        for changed in ['mac', 'win']:
            with self.subTest(changed=changed), tempfile.TemporaryDirectory() as temp:
                folder = Path(temp) / 'release-desktop'
                folder.mkdir()
                for platform in ['mac', 'win']:
                    artifact = folder / f'{platform}.zip'
                    artifact.write_bytes(b'certified')
                    (folder / f'verified-{platform}.json').write_text(json.dumps({
                        'platform': platform, 'version': '0.2.42',
                        'hashes': {artifact.name: hosted.sha256(artifact)},
                    }))
                (folder / f'{changed}.zip').write_bytes(b'changed')
                old = os.getcwd()
                try:
                    os.chdir(temp)
                    with patch.dict(os.environ, {'SLED_RELEASE_VERSION': '0.2.42', 'SLED_RELEASE_SHA': 'a' * 40}), patch.object(hosted, 'run') as run:
                        with self.assertRaisesRegex(ValueError, 'modified certified artifact'):
                            hosted.publish()
                        run.assert_not_called()
                finally:
                    os.chdir(old)

    def test_publish_uses_draft_id_and_requires_every_certified_digest(self):
        cases = [(None, 0), ('missing', 0), ('extra', 0)] + [
            (corruption, index) for corruption in ['digest', 'no-digest'] for index in range(4)]
        for corruption, index in cases:
            with self.subTest(corruption=corruption, index=index), tempfile.TemporaryDirectory() as temp:
                folder = Path(temp) / 'release-desktop'
                folder.mkdir()
                assets = {}
                for platform, name in [('mac', 'test.zip'), ('win', 'test.exe')]:
                    artifact = folder / name
                    artifact.write_bytes(platform.encode())
                    manifest = folder / f'verified-{platform}.json'
                    manifest.write_text(json.dumps({'platform': platform, 'version': '0.2.42',
                                                    'hashes': {name: hosted.sha256(artifact)}}))
                    for path in [artifact, manifest]:
                        assets[path.name] = hosted.sha256(path)
                remote = [{'name': name, 'digest': 'sha256:' + digest} for name, digest in assets.items()]
                if corruption == 'missing':
                    remote.pop()
                elif corruption == 'extra':
                    remote.append({'name': 'uncertified.exe', 'digest': 'sha256:extra'})
                elif corruption == 'digest':
                    remote[index]['digest'] = 'sha256:changed'
                elif corruption == 'no-digest':
                    remote[index].pop('digest')
                commands = []
                def command(*args):
                    commands.append(args)
                    if args[:3] == ('gh', 'release', 'view'):
                        self.assertIn('databaseId', args)
                        return '{"databaseId": 123}'
                    return ''
                def api(endpoint):
                    # GitHub cannot resolve an untagged draft via releases/tags/v*.
                    self.assertEqual(endpoint, 'releases/123')
                    return {'assets': remote}
                old = os.getcwd()
                try:
                    os.chdir(temp)
                    with patch.dict(os.environ, {'SLED_RELEASE_VERSION': '0.2.42', 'SLED_RELEASE_SHA': 'a' * 40}), patch.object(
                        hosted, 'run', side_effect=command), patch.object(hosted, 'api', side_effect=api):
                        if corruption:
                            with self.assertRaisesRegex(ValueError, 'Remote asset digest mismatch'):
                                hosted.publish()
                        else:
                            hosted.publish()
                    create = commands[0]
                    self.assertEqual(create[:4], ('gh', 'release', 'create', 'v0.2.42'))
                    self.assertEqual(create[create.index('--target') + 1], 'a' * 40)
                    self.assertEqual(create[create.index('--notes') + 1], 'Sled source: ' + 'a' * 40)
                    self.assertIn('--draft', create)
                    uploads = [c for c in commands if c[:3] == ('gh', 'release', 'upload')]
                    self.assertEqual(len(uploads), 1)
                    self.assertEqual(set(uploads[0][6:]), {str(Path('release-desktop') / name) for name in assets})
                    finalizes = [c for c in commands if c[:2] == ('gh', 'api')]
                    self.assertEqual(len(finalizes), 0 if corruption else 1)
                    if finalizes:
                        self.assertIn('repos/' + hosted.REPO + '/releases/123', finalizes[0])
                        for field in ['draft=false', 'prerelease=false', 'make_latest=true']:
                            self.assertIn(field, finalizes[0])
                finally:
                    os.chdir(old)

    def test_publish_never_reuses_existing_release_or_draft(self):
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp) / 'release-desktop'
            folder.mkdir()
            for platform in ['mac', 'win']:
                (folder / f'verified-{platform}.json').write_text(json.dumps({
                    'platform': platform, 'version': '0.2.42', 'hashes': {},
                }))
            old = os.getcwd()
            try:
                os.chdir(temp)
                with patch.dict(os.environ, {'SLED_RELEASE_VERSION': '0.2.42', 'SLED_RELEASE_SHA': 'a' * 40}), patch.object(
                    hosted, 'run', side_effect=hosted.subprocess.CalledProcessError(1, 'gh')) as run, patch.object(hosted, 'api') as api:
                    with self.assertRaises(hosted.subprocess.CalledProcessError):
                        hosted.publish()
                    self.assertEqual(run.call_count, 1)
                    self.assertEqual(run.call_args.args[:3], ('gh', 'release', 'create'))
                    api.assert_not_called()
            finally:
                os.chdir(old)

if __name__ == '__main__':
    unittest.main()
