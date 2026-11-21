"""Native preparation receipts and persistent compiler caches; no signing material."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess


def configure_cache(env, project, derived_data=None, disabled=False):
    toolchain = '\n'.join(subprocess.check_output(command, env=env, text=True).strip() for command in (
        ['xcodebuild', '-version'], ['xcrun', '--sdk', 'iphoneos', '--show-sdk-build-version']))
    if not toolchain.strip():
        raise RuntimeError('Cannot identify the native toolchain for cache reuse')
    identity = hashlib.sha256(toolchain.encode()).hexdigest()[:20]
    base = Path(env.get('SLED_IOS_CACHE_ROOT', str(Path.home() / 'Library/Caches/Sled/ios-native')))
    cache = base.resolve() / identity
    flags = []
    for variable, directory, option in (
            ('SLED_IOS_SWIFT_PACKAGE_DIR', 'source-packages', '-clonedSourcePackagesDirPath'),
            ('SLED_IOS_SWIFT_PACKAGE_CACHE_DIR', 'package-cache', '-packageCachePath')):
        path = Path(env.get(variable, str(cache / directory))).resolve()
        path.mkdir(parents=True, exist_ok=True)
        env[variable] = str(path)
        flags.extend([option, str(path)])
    compiler = Path(env.get('SLED_IOS_COMPILER_CACHE_DIR', str(cache / 'compiler'))).resolve()
    compiler.mkdir(parents=True, exist_ok=True)
    env['SLED_IOS_COMPILER_CACHE_DIR'] = str(compiler)
    compilation = ['COMPILATION_CACHE_ENABLE_CACHING=NO'] if disabled else [
        'COMPILATION_CACHE_ENABLE_CACHING=YES',
        'COMPILATION_CACHE_ENABLE_DIAGNOSTIC_REMARKS=YES',
        'COMPILATION_CACHE_CAS_PATH=' + str(compiler),
        'COMPILATION_CACHE_KEEP_CAS_DIRECTORY=YES',
        'COMPILATION_CACHE_ENABLE_PLUGIN=NO',
        'COMPILATION_CACHE_LIMIT_SIZE=2G',
    ]
    # DerivedData contains checkout-specific project paths and a writable build DB;
    # compiler results and dependency downloads can be shared across checkouts.
    project_id = hashlib.sha256(str(Path(project).resolve()).encode()).hexdigest()[:12]
    data = Path(derived_data).resolve() if derived_data else cache / 'derived-data' / project_id
    return dict(toolchain=identity, derivedData=data, packages=flags, compiler=compilation)


class NativePreparation:
    def __init__(self, root, env, toolchain, runtime):
        self.root, self.env, self.toolchain, self.runtime = Path(root), env, toolchain, runtime
        self.receipt = self.root / '.tools/ios-preparation.json'

    def signature(self):
        root = self.root
        mobile = root / 'apps/mobile'
        selected = set()
        # Include native/config inputs, not application JS. Expo's runtime fingerprint
        # below additionally tracks the actual dependency graph and config plugins.
        for directory in ('modules', 'plugins', 'expo-plugins'):
            start = mobile / directory
            for parent, dirs, files in os.walk(start):
                dirs[:] = [d for d in dirs if d not in ('node_modules', '.build', 'build', 'Frameworks', 'Pods')]
                selected.update(Path(parent) / name for name in files)
        selected.update(mobile / name for name in ('package.json', 'app.config.ts', 'app.json',
                        'expo-module.config.json', 'babel.config.js', 'metro.config.js'))
        selected.update(root / name for name in ('package.json', 'pnpm-lock.yaml',
                        'pnpm-workspace.yaml', 'sources.lock.json'))
        ios = mobile / 'ios'
        selected.update(ios / name for name in ('Podfile', 'Podfile.properties.json', 'Podfile.lock', 'Pods/Manifest.lock'))
        selected.update(ios.glob('*.xcodeproj/project.pbxproj'))
        selected.update(ios.glob('*/Info.plist'))
        selected.update(ios.glob('*/Supporting/Expo.plist'))
        selected.update(root / 'scripts' / name for name in ('testflight-ios.py', 'sled/native_build_cache.py',
                        'sled/prepare-native.py', 'prepare-webrtc.py', 'prepare-webrtc-notices.py'))
        values = {str(path.relative_to(root)): hashlib.sha256(path.read_bytes()).hexdigest()
                  for path in sorted(selected) if path.is_file() and not path.is_symlink()}
        environment = {key: self.env.get(key, '') for key in (
            'APP_VARIANT', 'MOBILE_VERSION_POLICY', 'T3CODE_MOBILE_UPDATES_ENABLED',
            'T3CODE_IOS_TEAM_ID', 'T3CODE_IOS_PERSONAL_TEAM', 'T3CODE_IOS_PERSONAL_TEAM_BUNDLE_ID',
            'SLED_EXPO_PROJECT_ID', 'SLED_EXPO_OWNER', 'SLED_EXPO_CHANNEL',
            'T3CODE_RELAY_URL', 'T3CODE_CLERK_PUBLISHABLE_KEY', 'T3CODE_CLERK_CLI_OAUTH_CLIENT_ID',
            'T3CODE_CLERK_JWT_TEMPLATE', 'USE_FRAMEWORKS', 'USE_CCACHE',
            'EXPO_USE_PRECOMPILED_MODULES', 'EXPO_PRECOMPILED_MODULES_PATH',
            'RCT_USE_RN_DEP', 'RCT_USE_PREBUILT_RNCORE')}
        return hashlib.sha256(json.dumps(dict(version=1, files=values, environment=environment,
                            toolchain=self.toolchain), sort_keys=True).encode()).hexdigest()

    def intact(self):
        ios = self.root / 'apps/mobile/ios'
        locks = [ios / 'Podfile.lock', ios / 'Pods/Manifest.lock']
        return (all(path.is_file() for path in locks) and locks[0].read_bytes() == locks[1].read_bytes()
                and len(list(ios.glob('*.xcworkspace/contents.xcworkspacedata'))) == 1)

    def matches(self):
        try:
            previous = json.loads(self.receipt.read_text())
            if not self.intact() or previous['signature'] != self.signature():
                return False
            return previous['runtime'] == self.runtime()
        except (OSError, ValueError, KeyError):
            return False

    def record(self):
        if not self.intact():
            return
        runtime = self.runtime()
        if not re.fullmatch('[0-9a-f]{40}', runtime):
            raise RuntimeError('Native preparation requires a calculated runtime fingerprint')
        self.receipt.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.receipt.with_suffix('.tmp')
        temporary.write_text(json.dumps(dict(signature=self.signature(), runtime=runtime)) + '\n')
        temporary.replace(self.receipt)
