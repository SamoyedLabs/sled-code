from pathlib import Path
import tempfile, subprocess
root=Path(__file__).resolve().parents[5]
client=(root/'apps/mobile/modules/t3-remote-desktop/Vendor/Client/StreamClient.swift').read_text()
def client_method(signature):
 assert client.count(signature)==1
 return signature+client.split(signature,1)[1].split('\n    }',1)[0]+'\n    }'
sender=client_method('    func send(_ kind: StreamMessageKind, payload: Data) {')
admission=client_method('    static func windowsAllows(')
for source in ['native/remote-desktop/Sources/StreamProtocol','apps/mobile/modules/t3-remote-desktop/Vendor/Protocol']:
 with tempfile.TemporaryDirectory(prefix='sled-viewer-test-') as temp:
  p=Path(temp); (p/'Sources/WindowsProtocol').mkdir(parents=True);(p/'Tests/WindowsProtocolTests').mkdir(parents=True)
  (p/'Package.swift').write_text('// swift-tools-version:6.0\nimport PackageDescription\nlet package = Package(name: "WindowsProtocol", targets: [.target(name: "WindowsProtocol", swiftSettings: [.swiftLanguageMode(.v5)]), .testTarget(name: "WindowsProtocolTests", dependencies: ["WindowsProtocol"])])')
  for name in ['WindowsDesktop.swift','WindowsInputAdapter.swift','Input.swift','Compatibility.swift','StreamMessage.swift','Switcher.swift','Viewport.swift','HostSettings.swift']:
   (p/'Sources/WindowsProtocol'/name).symlink_to(root/source/name)
  (p/'Sources/WindowsProtocol/HostSettingsLedger.swift').symlink_to(root/'apps/mobile/modules/t3-remote-desktop/Vendor/Client/HostSettingsLedger.swift')
  (p/'Sources/WindowsProtocol/ViewerSession.swift').symlink_to(root/'apps/mobile/modules/t3-remote-desktop/Vendor/Client/ViewerSession.swift')
  (p/'Sources/WindowsProtocol/ViewerDisplayNames.swift').symlink_to(root/'apps/mobile/modules/t3-remote-desktop/Vendor/Client/ViewerDisplayNames.swift')
  (p/'Sources/WindowsProtocol/KeyChords.swift').symlink_to(root/'apps/mobile/modules/t3-remote-desktop/Vendor/Client/KeyChords.swift')
  (p/'Sources/WindowsProtocol/ClientSendProbe.swift').write_text('import Foundation\nfinal class ClientSendLink { var packets: [Data] = []; func send(_ packet: Data) { packets.append(packet) } }\nfinal class ClientSendProbe { var windowsCapabilities: WindowsCapabilities?; let link = ClientSendLink()\n'+sender+'\n'+admission+'\n}')
  (p/'Sources/WindowsProtocol/WindowsFramePresentation.swift').symlink_to(root/'apps/mobile/modules/t3-remote-desktop/ios/WindowsFramePresentation.swift')
  (p/'Sources/WindowsProtocol/PointerPresence.swift').symlink_to(root/'apps/mobile/modules/t3-remote-desktop/Vendor/Client/PointerPresence.swift')
  surface=(root/'apps/mobile/modules/t3-remote-desktop/ios/WindowsStreamSurface.swift').read_text()
  pointer=surface.split('final class WindowsPointer {',1)[1].split('\nstruct WindowsStreamSurface:',1)[0]
  (p/'Sources/WindowsProtocol/WindowsPointer.swift').write_text('import Foundation\nfinal class WindowsSurfaceView {}\nfinal class WindowsPointer {'+pointer)
  (p/'Tests/WindowsProtocolTests/WindowsPresentationTests.swift').symlink_to(root/'apps/mobile/modules/t3-remote-desktop/tests/WindowsPresentationTests.swift')
  (p/'Tests/WindowsProtocolTests/WindowsDesktopTests.swift').symlink_to(root/'apps/mobile/modules/t3-remote-desktop/tests/WindowsDesktopTests.swift')
  subprocess.run(['swift','test','--package-path',temp],check=True)
