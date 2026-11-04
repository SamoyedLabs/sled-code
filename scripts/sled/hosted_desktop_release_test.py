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

    def test_publish_resumes_after_each_ambiguous_network_failure(self):
        for interrupted in ('create', 'upload', 'finalize', None):
            with self.subTest(interrupted=interrupted), tempfile.TemporaryDirectory() as temp:
                folder = Path(temp) / 'release-desktop'
                folder.mkdir()
                digests = {}
                for platform in ('mac', 'win'):
                    artifact = folder / (platform + '.zip')
                    artifact.write_bytes(platform.encode())
                    manifest = folder / f'verified-{platform}.json'
                    manifest.write_text(json.dumps(dict(platform=platform, version='0.2.42',
                        hashes={artifact.name: hosted.sha256(artifact)})))
                    for file in (artifact, manifest):
                        digests[file.name] = 'sha256:' + hosted.sha256(file)
                state = {'release': None, 'failed': False, 'uploads': []}
                def fail(stage):
                    if stage == interrupted and not state['failed']:
                        state['failed'] = True
                        raise hosted.subprocess.CalledProcessError(1, 'gh')
                def api(endpoint):
                    if endpoint == 'releases?per_page=100':
                        return [state['release']] if state['release'] else []
                    self.assertEqual(endpoint, 'releases/123')
                    return state['release']
                def command(*args):
                    if args[:3] == ('gh', 'release', 'create'):
                        self.assertIsNone(state['release'])
                        state['release'] = dict(id=123, tag_name='v0.2.42', draft=True,
                            target_commitish='a' * 40, body='Sled source: ' + 'a' * 40, assets=[])
                        fail('create')
                    elif args[:3] == ('gh', 'release', 'view'):
                        return '{"databaseId":123}'
                    elif args[:3] == ('gh', 'release', 'upload'):
                        for name in args[6:]:
                            name = Path(name).name
                            self.assertNotIn(name, state['uploads'])
                            state['uploads'].append(name)
                            state['release']['assets'].append(dict(name=name, digest=digests[name]))
                            fail('upload')
                    elif args[:2] == ('gh', 'api'):
                        self.assertEqual(len(state['uploads']), 4)
                        state['release']['draft'] = False
                        fail('finalize')
                    else:
                        self.fail(str(args))
                    return ''
                old = os.getcwd()
                try:
                    os.chdir(temp)
                    with patch.dict(os.environ, SLED_RELEASE_VERSION='0.2.42', SLED_RELEASE_SHA='a' * 40), \
                            patch.object(hosted, 'api', side_effect=api), patch.object(hosted, 'run', side_effect=command), \
                            patch('time.sleep'):
                        hosted.publish()
                        hosted.publish()
                    self.assertFalse(state['release']['draft'])
                    self.assertEqual(set(state['uploads']), set(digests))
                finally:
                    os.chdir(old)

    def test_resume_refuses_foreign_or_modified_remote_artifacts(self):
        for corruption in ('source', 'target', 'digest', 'extra', 'published-missing'):
            with self.subTest(corruption=corruption), tempfile.TemporaryDirectory() as temp:
                folder = Path(temp) / 'release-desktop'
                folder.mkdir()
                for platform in ('mac', 'win'):
                    (folder / f'verified-{platform}.json').write_text(json.dumps(dict(
                        platform=platform, version='0.2.42', hashes={})))
                release = dict(id=123, tag_name='v0.2.42', draft=corruption != 'published-missing',
                    body='Sled source: ' + 'a' * 40, target_commitish='a' * 40, assets=[])
                if corruption == 'source': release['body'] = 'unrelated release'
                if corruption == 'target': release['target_commitish'] = 'b' * 40
                if corruption == 'digest': release['assets'] = [dict(name='verified-mac.json', digest='sha256:wrong')]
                if corruption == 'extra': release['assets'] = [dict(name='extra.exe', digest='sha256:wrong')]
                old = os.getcwd()
                try:
                    os.chdir(temp)
                    with patch.dict(os.environ, SLED_RELEASE_VERSION='0.2.42', SLED_RELEASE_SHA='a' * 40), \
                            patch.object(hosted, 'api', side_effect=lambda endpoint: [release] if '?' in endpoint else release), \
                            patch.object(hosted, 'run') as run:
                        with self.assertRaises(ValueError): hosted.publish()
                    run.assert_not_called()
                finally:
                    os.chdir(old)

if __name__ == '__main__':
    unittest.main()
