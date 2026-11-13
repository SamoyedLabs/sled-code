"""Native preparation reuse must follow native inputs, not unrelated JS edits."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from native_build_cache import NativePreparation, configure_cache


class CacheTest(unittest.TestCase):
    def test_preparation_reuses_only_intact_matching_native_inputs(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name, contents in (
                ('apps/mobile/ios/Podfile.lock', 'pods'),
                ('apps/mobile/ios/Pods/Manifest.lock', 'pods'),
                ('apps/mobile/ios/App.xcworkspace/contents.xcworkspacedata', 'workspace'),
                ('apps/mobile/ios/App.xcodeproj/project.pbxproj', 'project'),
                ('apps/mobile/modules/remote/Host.swift', 'native'),
                ('apps/mobile/app.config.ts', 'config'),
                ('apps/mobile/src/App.tsx', 'javascript'),
            ):
                p = root / name
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_text(contents)
            runtime = 'a' * 40
            env = {'SLED_EXPO_CHANNEL': 'private'}
            state = NativePreparation(root, env, 'toolchain', lambda: runtime)
            self.assertFalse(state.matches())
            state.record()
            self.assertTrue(state.matches())
            (root / 'apps/mobile/src/App.tsx').write_text('changed javascript')
            self.assertTrue(state.matches())
            for changed in ('native', 'configuration', 'pods', 'runtime', 'toolchain', 'channel'):
                with self.subTest(changed=changed):
                    if changed == 'native':
                        (root / 'apps/mobile/modules/remote/Host.swift').write_text('changed native')
                    elif changed == 'configuration':
                        (root / 'apps/mobile/app.config.ts').write_text('changed config')
                    elif changed == 'pods':
                        (root / 'apps/mobile/ios/Pods/Manifest.lock').write_text('missing installed pod')
                    elif changed == 'runtime':
                        runtime = 'b' * 40
                    elif changed == 'toolchain':
                        state.toolchain = 'new-toolchain'
                    else:
                        env['SLED_EXPO_CHANNEL'] = 'another-channel'
                    self.assertFalse(state.matches())
                    if changed == 'pods':
                        (root / 'apps/mobile/ios/Pods/Manifest.lock').write_text('pods')
                    state.record()
                    self.assertTrue(state.matches())

    def test_toolchains_and_checkout_databases_are_isolated_but_compiler_results_are_shared(self):
        with tempfile.TemporaryDirectory() as directory:
            env = {'SLED_IOS_CACHE_ROOT': directory}
            with patch('subprocess.check_output', return_value='toolchain-one'):
                first = configure_cache(dict(env), '/checkout/first')
                second = configure_cache(dict(env), '/checkout/second')
            self.assertEqual(first['compiler'], second['compiler'])
            self.assertNotEqual(first['derivedData'], second['derivedData'])
            with patch('subprocess.check_output', return_value='toolchain-two'):
                other = configure_cache(dict(env), '/checkout/first')
            self.assertNotEqual(first['compiler'], other['compiler'])


if __name__ == '__main__':
    unittest.main()
