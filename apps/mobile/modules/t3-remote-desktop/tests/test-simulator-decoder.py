from pathlib import Path
import subprocess
import sys
import tempfile

root = Path(__file__).resolve().parent.parent
if len(sys.argv) != 2:
    raise SystemExit("usage: test-simulator-decoder.py <already-booted-simulator-id>")
sdk = subprocess.check_output(
    ["xcrun", "--sdk", "iphonesimulator", "--show-sdk-path"], text=True
).strip()
with tempfile.TemporaryDirectory(prefix="sled-simulator-decoder-") as directory:
    executable = str(Path(directory) / "decoder-check")
    files = ["Vendor/Protocol/HostSettings.swift", "Vendor/Protocol/StreamMessage.swift",
             "Vendor/Protocol/WindowsDesktop.swift",
             "ios/WindowsFramePresentation.swift", "ios/WindowsVideoDecoder.swift",
             "tests/SimulatorDecoderCheck.swift"]
    subprocess.run(["xcrun", "swiftc", "-target", "arm64-apple-ios18.0-simulator", "-sdk", sdk,
                    *[str(root / file) for file in files], "-o", executable], check=True)
    subprocess.run(["xcrun", "simctl", "spawn", sys.argv[1], executable], check=True)
