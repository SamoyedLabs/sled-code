import AppKit
import Foundation
import SillHostCore
import ApplicationServices
import StreamProtocol
import LiveKitWebRTC
import Darwin

setvbuf(stdout, nil, _IOLBF, 0)
signal(SIGPIPE, SIG_IGN)
let eventDescriptor = ProcessInfo.processInfo.environment["T3_REMOTE_EVENTS_FD"].flatMap(Int32.init)
let eventOutput = eventDescriptor.map { FileHandle(fileDescriptor: $0, closeOnDealloc: false) }
var eventPipeClosed = false

// Private IPC is inherited stdin/stdout. Never expose a configuration listener.
// Pairing secrets go only to Electron, which displays them locally without logging.
func event(_ value: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: value),
          let line = String(data: data, encoding: .utf8) else { return }
    if let eventOutput {
        guard !eventPipeClosed else { return }
        do { try eventOutput.write(contentsOf: Data(("T3RD " + line + "\n").utf8)) }
        catch {
            eventPipeClosed = true
            DispatchQueue.main.async {
                nativeSessions?.closeAll()
                coordinator?.shutdownForExit()
                exit(0)
            }
        }
    } else {
        // Standalone synthetic fixtures use stdout. Electron always supplies a
        // dedicated event pipe so arbitrary Sill log text cannot forge replies.
        print("T3RD " + line)
        fflush(stdout)
    }
}

let synthetic = CommandLine.arguments.contains("--synthetic")
if CommandLine.arguments.contains("--permission-status") || CommandLine.arguments.contains("--request-screen-recording") || CommandLine.arguments.contains("--request-accessibility") {
    if CommandLine.arguments.contains("--request-screen-recording") { _ = CGRequestScreenCaptureAccess() }
    if CommandLine.arguments.contains("--request-accessibility") {
        _ = AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue(): true] as CFDictionary)
    }
    event(["type": "permissions", "screenRecording": CGPreflightScreenCaptureAccess(),
           "accessibility": AXIsProcessTrusted()])
    exit(0)
}
_ = CGMainDisplayID()
let application = NSApplication.shared
application.setActivationPolicy(.accessory)
var statusItem: RemoteDesktopStatusItem?
var coordinator: StreamCoordinator?
var remote: RemoteAccess?
var nativeSessions: T3NativeSessions?
precondition(LKRTCInitializeSSL())
HostShutdown.install(coordinator: { coordinator })

Task { @MainActor in
    if ProcessInfo.processInfo.environment["T3_REMOTE_STATUS_ITEM"] == "1" { statusItem = RemoteDesktopStatusItem() }
    var config = HostConfig.app
    config.requirePairing = true
    config.directWireless = false
    config.remoteAccess = false
    config.internetAccess = false
    // T3 owns a distinct service. Advertise the actual bound port in signed
    // MacInfo instead of competing with a separate Sill install's fixed port.
    config.remotePort = 0
    // Explicit probe mode avoids touching a user's persistent Keychain while
    // exercising real capture. It still requires code-proof pairing and mTLS.
    let ephemeralIdentity = synthetic || CommandLine.arguments.contains("--ephemeral-identity")
    let store: IdentityStore = ephemeralIdentity ? MemoryIdentityStore() : KeychainIdentityStore()
    let access = RemoteAccess(store: store)
    guard access.identityProblem == nil else {
        event(["type": "error", "message": access.identityProblem ?? "Identity unavailable"])
        exit(1)
    }
    access.reopensPairing = false
    access.logsPairingWindows = false
    access.onPairingOffer = { offer in
        event(["type": "pairing", "code": offer.code,
               "expiresAt": offer.expiresAt.timeIntervalSince1970])
        DispatchQueue.main.async { statusItem?.showPairing(code: offer.code) }
    }
    remote = access
    do {
        let host = try StreamCoordinator(config: config, synthetic: synthetic,
                                         appKitLoop: true, remote: access, homePairing: true)
        coordinator = host
        nativeSessions = T3NativeSessions(host: host, remote: access)
        var announced = false
        host.t3ObserveNetwork { [weak host] network in
            switch network {
            case .advertising where !announced:
                announced = true
                statusItem?.update(online: true)
                event(["type": "ready", "synthetic": synthetic, "transport": "tls-tcp-lan",
                       "port": Int(host?.t3HomePort ?? 0),
                       "hostFingerprint": access.identity.map { Base64URL.encode($0.fingerprint) } ?? "",
                       "nativeTransportReady": true, "permissions":["screenRecording":CGPreflightScreenCaptureAccess(),"accessibility":AXIsProcessTrusted()]])
            case .notAdvertised(let port) where !announced:
                announced = true
                statusItem?.update(online: true)
                event(["type": "ready", "synthetic": synthetic, "transport": "tls-tcp-lan", "port": port,
                       "hostFingerprint": access.identity.map { Base64URL.encode($0.fingerprint) } ?? "",
                       "nativeTransportReady": true, "permissions":["screenRecording":CGPreflightScreenCaptureAccess(),"accessibility":AXIsProcessTrusted()]])
            case .failed(let problem):
                event(["type": "error", "message": problem])
            default: break
            }
        }
        await host.start(preselect: nil)
    } catch {
        event(["type": "error", "message": String(describing: error)])
        exit(1)
    }
}

// EOF ends the helper even if Electron crashes. Work is dispatched onto the
// AppKit thread; no network callback or IPC thread mutates the coordinator.
DispatchQueue.global(qos: .utility).async {
    while let command = readLine() {
        DispatchQueue.main.async {
            if command.hasPrefix("{") {
                nativeSessions?.receive(Data(command.utf8))
                return
            }
            if command.hasPrefix("agent-lifecycle ") { statusItem?.update(lifecycle: String(command.dropFirst(16))); return }
            if command.hasPrefix("agent-gui ") { statusItem?.update(guiActive: command.hasSuffix("1")); return }
            switch command {
            case "permission-status", "request-permissions":
                if command == "request-permissions" {
                    _ = CGRequestScreenCaptureAccess()
                    _ = AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue(): true] as CFDictionary)
                }
                event(["type": "permissions", "screenRecording": CGPreflightScreenCaptureAccess(), "accessibility": AXIsProcessTrusted()])
            case "pair": remote?.openPairing(requestedBy: nil)
            case "cancel-pairing": remote?.cancelPairing()
            case "forget-devices":
                if let error = remote?.t3ForgetDevices() {
                    event(["type": "error", "message": error])
                }
            case "quit":
                nativeSessions?.closeAll()
                coordinator?.shutdownForExit()
                exit(0)
            default:
                let parts = command.split(separator: " ")
                guard parts.count == 3, parts[0] == "setting",
                      parts[2] == "1" || parts[2] == "0" else { return }
                let enabled = parts[2] == "1"
                // Start with the latest target so a desktop change preserves
                // quality/resolution changes made by the phone meanwhile.
                guard let host = coordinator else { return }
                var next = host.t3Target
                switch parts[1] {
                case "clipboard": next.shareClipboard = enabled
                case "virtual-display": next.virtualDisplay = enabled
                case "audio": next.sendAudio = enabled
                case "direct-wireless": next.directWireless = enabled
                case "remote": next.remoteAccess = enabled
                case "internet": next.internetAccess = enabled
                default: return
                }
                host.setTarget(next)
                statusItem?.update(setting: String(parts[1]), enabled: enabled)
            }
        }
    }
    DispatchQueue.main.async {
        nativeSessions?.closeAll()
        coordinator?.shutdownForExit()
        exit(0)
    }
}
application.run()
