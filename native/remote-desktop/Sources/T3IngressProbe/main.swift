// Isolated admission/pacing probe. This executable is never bundled with T3.
import AppKit
import Foundation
import SillHostCore
import StreamProtocol

setvbuf(stdout, nil, _IOLBF, 0)
func event(_ value: [String: Any]) {
    let data = try! JSONSerialization.data(withJSONObject: value)
    print("T3ING " + String(decoding: data, as: UTF8.self))
}
let app = NSApplication.shared
app.setActivationPolicy(.accessory)
var host: StreamCoordinator?
var access: RemoteAccess?
var tunnels: [String: T3TunnelIngress] = [:]
let configURL = URL(fileURLWithPath: CommandLine.arguments[1])
let fixture = try JSONDecoder().decode([String].self, from: Data(contentsOf: configURL))
Task { @MainActor in
    let store = MemoryIdentityStore()
    try! store.savePaired(fixture.map {
        PairedDevice(fingerprint: $0, name: "Isolated native fixture", model: nil,
                     pairedAt: Date().timeIntervalSince1970, method: "code")
    })
    let remote = RemoteAccess(store: store)
    access = remote
    var config = HostConfig.app
    config.requirePairing = true
    config.remotePort = 0
    config.remoteAccess = true
    config.internetAccess = true
    let coordinator = try! StreamCoordinator(config: config, synthetic: true,
        appKitLoop: true, remote: remote, homePairing: true)
    host = coordinator
    await coordinator.start(preselect: nil)
    event(["type": "ready", "fingerprint": Base64URL.encode(remote.identity!.fingerprint)])
}
DispatchQueue.global().async {
    while let line = readLine() {
        DispatchQueue.main.async {
            guard let host, let access else { return }
            let parts = line.split(separator: " ").map(String.init)
            guard let command = parts.first else { return }
            switch command {
            case "open" where parts.count == 4:
                let id = parts[1]
                let expiry = Date().addingTimeInterval(Double(parts[2])!)
                tunnels[id] = host.t3OpenTunnel(remote: access, fingerprint: Base64URL.decode(parts[3])!,
                    expiresAt: expiry, ready: { port in
                        event(["type": "port", "id": id, "port": port.map(Int.init) ?? 0])
                    }, ended: { event(["type": "closed", "id": id]) })
            case "renew" where parts.count == 3:
                tunnels[parts[1]]?.renew(expiresAt: Date().addingTimeInterval(Double(parts[2])!)) {
                    event(["type": "renewed", "id": parts[1], "ok": $0])
                }
            case "stop" where parts.count == 2:
                tunnels.removeValue(forKey: parts[1])?.close()
            case "snapshot":
                host.t3TunnelProgress {
                    let snapshots = try! JSONSerialization.jsonObject(with: JSONEncoder().encode($0))
                    event(["type": "snapshot", "clients": snapshots])
                }
            case "remove":
                _ = access.t3ForgetDevices()
                event(["type": "removed"])
            case "internet", "remote":
                var config = host.t3Target
                if command == "internet" { config.internetAccess = parts[1] == "1" }
                else { config.remoteAccess = parts[1] == "1" }
                host.setTarget(config)
                // Queue a barrier through the server after RemoteAccess's close work.
                host.t3TunnelProgress { _ in event(["type": "setting", "name": command]) }
            default: break
            }
        }
    }
    DispatchQueue.main.async {
        for tunnel in tunnels.values { tunnel.close() }
        host?.shutdownForExit()
        exit(0)
    }
}
app.run()
