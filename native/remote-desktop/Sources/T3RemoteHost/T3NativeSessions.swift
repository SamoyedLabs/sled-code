import Foundation
import LiveKitWebRTC
import Network
import ApplicationServices
import SillHostCore
import StreamProtocol

/// Only inherited, parent-owned IPC reaches this supervisor. T3's server issues
/// leases; the TLS ingress independently requires the exact paired device key.
@MainActor
final class T3NativeSessions {
    struct Request: Decodable {
        let requestId: String
        let command: Command
    }
    struct Command: Decodable {
        let type: String
        let sessionId: String?
        let clientNonce: String?
        let clientFingerprint: String?
        let hostFingerprint: String?
        let offer: String?
        let expiresAt: Int64?
        let connectivity: T3IceConfiguration?
    }
    private let host: StreamCoordinator
    private let remote: RemoteAccess
    private let queue = DispatchQueue(label: "com.t3tools.remote-desktop.native")
    private let factory = LKRTCPeerConnectionFactory()
    private var sessions: [String: Session] = [:]
    private static let uuid = try! NSRegularExpression(pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")

    private final class Session {
        let nonce: String
        let transport: Transport
        var ingress: T3TunnelIngress?
        var answerRequest: String?
        var expiresAt: Int64
        init(nonce: String, transport: Transport, requestId: String, expiresAt: Int64) {
            self.nonce = nonce
            self.transport = transport
            self.answerRequest = requestId
            self.expiresAt = expiresAt
        }
        func close() { ingress?.close(); transport.close() }
    }

    /// Peer/channel/socket state belongs exclusively to the native serial queue.
    // Immutable queue/factory may cross actors; all mutable state is confined to
    // queue, including initialization of the peer and destruction of its socket.
    private final class Transport: @unchecked Sendable {
        let queue: DispatchQueue
        private let factory: LKRTCPeerConnectionFactory
        private var peer: NativePeer?
        private var bridge: ByteSocketBridge?
        private var stopped = false
        init(queue: DispatchQueue, factory: LKRTCPeerConnectionFactory) {
            self.queue = queue
            self.factory = factory
        }
        func start(port: UInt16, offer: String, servers: [LKRTCIceServer], relayOnly: Bool,
                   answer: @escaping (String) -> Void, failed: @escaping () -> Void) {
            queue.async { [self] in
                guard !stopped else { return }
                let peer = NativePeer(factory: factory, queue: queue, servers: servers, relayOnly: relayOnly)
                self.peer = peer
                peer.onFailure = { _ in failed() }
                peer.onChannel = { [weak self] channel in
                    guard let self, !self.stopped, self.bridge == nil else { channel.close(); failed(); return }
                    let socket = NWConnection(host: .ipv4(.loopback), port: NWEndpoint.Port(rawValue: port)!, using: .tcp)
                    let bridge = ByteSocketBridge(socket: socket, tunnel: channel, queue: self.queue)
                    self.bridge = bridge
                    bridge.onClose = failed
                    bridge.start()
                }
                peer.answer(to: LKRTCSessionDescription(type: .offer, sdp: offer)) { answer($0.sdp) }
            }
        }
        func close() {
            queue.async { [self] in
                guard !stopped else { return }
                stopped = true
                bridge?.onClose = nil
                bridge?.close()
                bridge = nil
                peer?.close()
                peer = nil
            }
        }
        func restart(offer: String, servers: [LKRTCIceServer], relayOnly: Bool,
                     answer: @escaping (String) -> Void, failed: @escaping () -> Void) {
            queue.async { [self] in
                guard !stopped, let peer, bridge != nil,
                      peer.configure(servers: servers, relayOnly: relayOnly) else { failed(); return }
                peer.answer(to: LKRTCSessionDescription(type: .offer, sdp: offer)) { answer($0.sdp) }
            }
        }
    }

    init(host: StreamCoordinator, remote: RemoteAccess) {
        self.host = host
        self.remote = remote
    }

    private func emit(_ value: [String: Any]) { event(["type": "native", "event": value]) }
    private func reply(_ id: String, _ result: [String: Any]) {
        emit(["type": "reply", "requestId": id, "result": result])
    }
    private func error(_ id: String, _ reason: String) { reply(id, ["type": "error", "reason": reason]) }
    private func validID(_ value: String?) -> Bool {
        guard let value else { return false }
        return Self.uuid.firstMatch(in: value, range: NSRange(value.startIndex..., in: value)) != nil
    }

    func receive(_ data: Data) {
        guard data.count <= 256 * 1024,
              let request = try? JSONDecoder().decode(Request.self, from: data), validID(request.requestId) else { return }
        let command = request.command
        switch command.type {
        case "status":
            var status: [String:Any] = [
                "available":true, "enabled":true,
                "remoteEnabled":host.t3Target.remoteAccess, "internetEnabled":host.t3Target.internetAccess,
                "hostFingerprint":remote.identity.map { Base64URL.encode($0.fingerprint) } ?? NSNull(),
            ]
            if !synthetic { status["permissions"] = ["screenRecording":CGPreflightScreenCaptureAccess(),"accessibility":AXIsProcessTrusted()] }
            reply(request.requestId,["type":"status","status":status])
        case "start": start(request)
        case "restart": restart(request)
        case "renew":
            guard let id = command.sessionId, validID(id), let session = sessions[id],
                  let expiry = command.expiresAt, let ingress = session.ingress else { error(request.requestId, "not_found"); return }
            ingress.renew(expiresAt: Date(timeIntervalSince1970: Double(expiry) / 1000)) { [weak self, weak session] okay in
                Task { @MainActor in
                    guard let self, let session else { return }
                    guard okay, self.sessions[id] === session else { self.error(request.requestId, "expired"); return }
                    session.expiresAt = expiry
                    self.reply(request.requestId, ["type": "renewed", "sessionId": id, "expiresAt": expiry])
                }
            }
        case "stop":
            guard let id = command.sessionId, validID(id) else { error(request.requestId, "not_found"); return }
            close(id)
            reply(request.requestId, ["type": "stopped", "sessionId": id])
        default: error(request.requestId, "transport")
        }
    }

    private func start(_ request: Request) {
        let command = request.command
        guard host.t3Target.remoteAccess, host.t3Target.internetAccess else { error(request.requestId, "disabled"); return }
        guard let identity = remote.identity, command.hostFingerprint == Base64URL.encode(identity.fingerprint),
              let expectedText = command.clientFingerprint, let expected = Base64URL.decode(expectedText), expected.count == 32 else {
            error(request.requestId, "identity_mismatch"); return
        }
        guard let id = command.sessionId, validID(id), let nonce = command.clientNonce, validID(nonce),
              let offer = command.offer, offer.hasPrefix("v=0\n") || offer.hasPrefix("v=0\r\n"),
              offer.utf8.count <= 65_536,
              offer.unicodeScalars.allSatisfy({ $0.value == 9 || $0.value == 10 || $0.value == 13 || (32...126).contains($0.value) }),
              offer.components(separatedBy: "\n").filter({ $0.hasPrefix("a=candidate:") }).count <= 64,
              let expiry = command.expiresAt else { error(request.requestId, "transport"); return }
        guard sessions.count < 8, sessions[id] == nil,
              !sessions.values.contains(where: { $0.nonce == nonce }) else { error(request.requestId, "limit"); return }
        let servers: [LKRTCIceServer]
        do { servers = try command.connectivity?.validatedServers() ?? [] }
        catch { self.error(request.requestId, "transport"); return }
        let transport = Transport(queue: queue, factory: factory)
        let session = Session(nonce: nonce, transport: transport, requestId: request.requestId, expiresAt: expiry)
        sessions[id] = session
        let failed: () -> Void = { [weak self, weak session] in
            Task { @MainActor in
                guard let self, let session, self.sessions[id] === session else { return }
                self.close(id)
            }
        }
        session.ingress = host.t3OpenTunnel(remote: remote, fingerprint: expected,
            expiresAt: Date(timeIntervalSince1970: Double(expiry) / 1000), ready: { [weak self, weak session] port in
                guard let session, let port else { failed(); return }
                transport.start(port: port, offer: offer, servers: servers, relayOnly: command.connectivity?.relayOnly ?? false,
                    answer: { [weak self, weak session] answer in
                    Task { @MainActor in
                        guard let self, let session, self.sessions[id] === session,
                              let requestId = session.answerRequest else { return }
                        session.answerRequest = nil
                        self.reply(requestId, ["type": "answer", "sessionId": id, "expiresAt": session.expiresAt,
                            "clientNonce": nonce, "hostFingerprint": command.hostFingerprint!, "answer": answer])
                    }
                }, failed: failed)
            }, ended: failed)
    }

    private func close(_ id: String) {
        guard let session = sessions.removeValue(forKey: id) else { return }
        session.close()
        if let requestId = session.answerRequest { error(requestId, "transport") }
        emit(["type": "closed", "sessionId": id])
    }

    private func restart(_ request: Request) {
        let command = request.command
        guard let id = command.sessionId, let session = sessions[id],
              session.answerRequest == nil, let ingress = session.ingress else {
            error(request.requestId, "not_found"); return
        }
        guard command.clientNonce == session.nonce,
              command.hostFingerprint == remote.identity.map({ Base64URL.encode($0.fingerprint) }) else {
            error(request.requestId, "identity_mismatch"); return
        }
        guard let offer = command.offer, offer.hasPrefix("v=0\n") || offer.hasPrefix("v=0\r\n"),
              offer.utf8.count <= 65_536,
              offer.unicodeScalars.allSatisfy({ $0.value == 9 || $0.value == 10 || $0.value == 13 || (32...126).contains($0.value) }),
              offer.components(separatedBy: "\n").filter({ $0.hasPrefix("a=candidate:") }).count <= 64,
              let expiry = command.expiresAt, let config = command.connectivity,
              let servers = try? config.validatedServers() else { error(request.requestId, "transport"); return }
        session.answerRequest = request.requestId
        ingress.renew(expiresAt: Date(timeIntervalSince1970: Double(expiry) / 1000)) { [weak self, weak session] okay in
            Task { @MainActor in
                guard let self, let session, self.sessions[id] === session else { return }
                guard okay else { self.close(id); return }
                session.expiresAt = expiry
                session.transport.restart(offer: offer, servers: servers, relayOnly: config.relayOnly,
                    answer: { [weak self, weak session] answer in
                        Task { @MainActor in
                            guard let self, let session, self.sessions[id] === session,
                                  session.answerRequest == request.requestId else { return }
                            session.answerRequest = nil
                            self.reply(request.requestId, ["type":"answer", "sessionId":id,
                                "clientNonce":session.nonce, "hostFingerprint":command.hostFingerprint!,
                                "expiresAt":expiry, "answer":answer])
                        }
                    }, failed: { [weak self] in Task { @MainActor in self?.close(id) } })
            }
        }
    }

    func closeAll() { for id in Array(sessions.keys) { close(id) } }
}
