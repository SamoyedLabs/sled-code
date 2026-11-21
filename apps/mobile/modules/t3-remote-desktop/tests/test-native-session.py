from pathlib import Path
import subprocess
import tempfile

root = Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix="sled-native-session-") as directory:
    package = Path(directory)
    (package / "Package.swift").write_text('''// swift-tools-version: 6.0
import PackageDescription
let package = Package(name: "NativeSession", targets: [
    .target(name: "ExpoModulesCore"), .target(name: "LiveKitWebRTC"),
    .target(name: "NativeSession", dependencies: ["ExpoModulesCore", "LiveKitWebRTC"]),
    .testTarget(name: "NativeSessionTests", dependencies: ["NativeSession", "ExpoModulesCore"])
], swiftLanguageModes: [.v5])
''')
    for name in ["ExpoModulesCore", "LiveKitWebRTC", "NativeSession"]:
        (package / "Sources" / name).mkdir(parents=True)
    (package / "Tests/NativeSessionTests").mkdir(parents=True)
    for name in ["ExpoModulesCore", "LiveKitWebRTC"]:
        (package / "Sources" / name / "Platform.swift").symlink_to(root / "tests" / f"NativeSession{name}.swift")
    (package / "Sources/NativeSession/T3NativeSession.swift").symlink_to(root / "ios/T3NativeSession.swift")
    (package / "Sources/NativeSession/Platform.swift").symlink_to(root / "tests/NativeSessionPlatform.swift")
    (package / "Tests/NativeSessionTests/NativeSessionTests.swift").symlink_to(root / "tests/NativeSessionTests.swift")
    subprocess.run(["swift", "test", "--jobs", "2", "--package-path", directory], check=True)
