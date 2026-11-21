from pathlib import Path
import subprocess
import tempfile

root = Path(__file__).resolve().parents[5]
protocol = root / "apps/mobile/modules/t3-remote-desktop/Vendor/Protocol/Audio.swift"
assert protocol.read_bytes() == (root / "native/remote-desktop/Sources/StreamProtocol/Audio.swift").read_bytes()
with tempfile.TemporaryDirectory(prefix="sled-audio-test-") as temp:
    package = Path(temp)
    sources = package / "Sources/ViewerAudio"
    tests = package / "Tests/ViewerAudioTests"
    sources.mkdir(parents=True)
    tests.mkdir(parents=True)
    (package / "Package.swift").write_text('// swift-tools-version:6.0\nimport PackageDescription\nlet package = Package(name: "ViewerAudio", targets: [.target(name: "ViewerAudio", swiftSettings: [.swiftLanguageMode(.v5)]), .testTarget(name: "ViewerAudioTests", dependencies: ["ViewerAudio"])])')
    (sources / "Audio.swift").symlink_to(protocol)
    (sources / "StreamMessage.swift").symlink_to(protocol.with_name("StreamMessage.swift"))
    (sources / "Switcher.swift").symlink_to(protocol.with_name("Switcher.swift"))
    (sources / "AudioDecoder.swift").symlink_to(root / "apps/mobile/modules/t3-remote-desktop/Vendor/Client/AudioDecoder.swift")
    (sources / "AudioEncoder.swift").symlink_to(root / "native/remote-desktop/Sources/SillHost/AudioEncoder.swift")
    (tests / "AudioDecoderTests.swift").symlink_to(Path(__file__).with_name("AudioDecoderTests.swift"))
    subprocess.run(["swift", "test", "--package-path", temp, "--jobs", "2"], check=True)
