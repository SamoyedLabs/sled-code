import ExpoModulesCore
import Foundation
import LiveKitWebRTC
import Network

/// View-owned native session; only SDP, identity pins and status cross the bridge.
final class T3NativeSession {
    private static let factory: LKRTCPeerConnectionFactory = {
        precondition(LKRTCInitializeSSL())
        let factory = LKRTCPeerConnectionFactory()
        if ProcessInfo.processInfo.arguments.contains("--t3-cellular-only") {
            // Keep the system Wi-Fi connection available to wireless device automation.
            let options = LKRTCPeerConnectionFactoryOptions()
            options.ignoreWiFiNetworkAdapter = true
            options.ignoreEthernetNetworkAdapter = true
            options.ignoreVPNNetworkAdapter = true
            options.ignoreLoopbackNetworkAdapter = true
            factory.setOptions(options)
        }
        return factory
    }()
    private let client: StreamClient
    private let queue = DispatchQueue(label: "com.t3tools.remote-desktop.client")
    private let dialer: NativeDialer
    private let hostPin: Data
    private let name: String
    private let nonce = UUID().uuidString.lowercased()
    private var offerPromise: Promise?
    private var restartPromise: Promise?
    private var answerPromise: Promise?
    private var restarting = false
    private var sessionID: String?
    private var tlsConnection: NWConnection?
    private var stopped = false
    var hasConnected = false // main thread; the enclosing view observes StreamClient
    var onClose: (() -> Void)?
    var onPath: (([String:String]) -> Void)?
    var onConnectionLost: (() -> Void)?
    var onConnectionRestored: (() -> Void)?

    static func failure(_ message: String) -> NSError {
        NSError(domain: "T3RemoteDesktop", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
    }

    init(client: StreamClient, fingerprint: String, connectivity: T3IceConfiguration? = nil) throws {
        guard let pin = Base64URL.decode(fingerprint), pin.count == 32,
              let saved = client.savedMacs.first(where: { $0.fingerprintData == pin && $0.revoked != true && $0.newKey != true }),
              DeviceIdentity.existing() != nil else {
            throw Self.failure("Pair this Mac in Remote Desktop before connecting through T3 Code.")
        }
        self.client = client
        hostPin = pin
        name = saved.name
        dialer = try NativeDialer(queue: queue, factory: Self.factory,
            servers: connectivity?.validatedServers() ?? [], relayOnly: connectivity?.relayOnly ?? false)
        client.t3ManagedSession = true
    }

    func offer(_ promise: Promise) {
        offerPromise = promise
        dialer.onClose = { [weak self] in DispatchQueue.main.async { self?.close() } }
        dialer.onConnectionLost = { [weak self] in
            DispatchQueue.main.async {
                guard let self, self.hasConnected, !self.stopped else { return }
                self.onConnectionLost?()
            }
        }
        dialer.onConnectionRestored = { [weak self] in
            DispatchQueue.main.async {
                guard let self, self.hasConnected, !self.stopped else { return }
                self.onConnectionRestored?()
                self.queue.async { [weak self] in self?.publishPath() }
            }
        }
        queue.async { [weak self] in
            guard let self else { return }
            self.dialer.offer { [weak self] sdp in
                DispatchQueue.main.async {
                    guard let self, !self.stopped, let identity = DeviceIdentity.existing() else { return }
                    let promise = self.offerPromise
                    self.offerPromise = nil
                    promise?.resolve(["clientNonce":self.nonce, "clientFingerprint":Base64URL.encode(identity.fingerprint),
                        "hostFingerprint":Base64URL.encode(self.hostPin), "offer":sdp])
                }
            }
        }
    }

    struct Answer: Decodable {
        let clientNonce: String
        let hostFingerprint: String
        let sessionId: String
        let answer: String
    }
    func accept(_ json: String, promise: Promise) throws {
        guard !stopped, answerPromise == nil, json.utf8.count <= 128 * 1024,
              let answer = try? JSONDecoder().decode(Answer.self, from: Data(json.utf8)),
              answer.clientNonce == nonce, Base64URL.decode(answer.hostFingerprint) == hostPin,
              UUID(uuidString: answer.sessionId) != nil, answer.answer.utf8.count <= 65_536 else {
            throw Self.failure("The remote session answer did not match this device's request.")
        }
        if let sessionID {
            guard answer.sessionId == sessionID, restarting else {
                throw Self.failure("The remote restart did not match the active session.")
            }
            answerPromise = promise
            queue.async { [weak self] in
                guard let self else { return }
                self.dialer.acceptRestart(answer.answer) { [weak self] in
                    DispatchQueue.main.async {
                        guard let self, !self.stopped else { return }
                        self.restarting = false
                        self.answerPromise?.resolve(nil)
                        self.answerPromise = nil
                    }
                }
            }
            return
        }
        sessionID = answer.sessionId
        answerPromise = promise
        queue.async { [weak self] in
            guard let self else { return }
            self.dialer.answer(answer.answer) { [weak self] port in
                DispatchQueue.main.async {
                    guard let self, !self.stopped else { return }
                    self.connectTLS(port: port)
                    self.answerPromise?.resolve(nil)
                    self.answerPromise = nil
                }
            }
        }
    }

    func restart(_ config: T3IceConfiguration, promise: Promise) {
        guard !stopped, hasConnected, let sessionID, !restarting else {
            promise.reject(Self.failure("The remote session is not ready to restart.")); return
        }
        let servers: [LKRTCIceServer]
        do { servers = try config.validatedServers() }
        catch { promise.reject(error); return }
        restarting = true
        restartPromise = promise
        queue.async { [weak self] in
            guard let self else { return }
            self.dialer.restart(servers: servers, relayOnly: config.relayOnly) { [weak self] offer in
                DispatchQueue.main.async {
                    guard let self, !self.stopped else { return }
                    let promise = self.restartPromise
                    self.restartPromise = nil
                    promise?.resolve(["sessionId":sessionID, "offer":offer])
                }
            }
        }
    }

    private func publishPath() {
        dialer.selectedPath { [weak self] path in
            guard let path else { return }
            DispatchQueue.main.async { [weak self] in
                guard let self, !self.stopped else { return }
                self.onPath?(path)
            }
        }
    }

    func inspectTransport(_ complete: @escaping ([String: String]?) -> Void) {
        queue.async { [weak self] in
            guard let self, !self.stopped else { complete(nil); return }
            self.dialer.selectedPath(complete)
        }
    }

    private func connectTLS(port: UInt16) {
        guard !stopped, let identity = DeviceIdentity.existing() else { close(); return }
        let parameters = DeviceTLS.home(identity: identity, alpn: RemoteTLS.sessionALPN,
            pin: hostPin, peerToPeer: false, queue: client.queue,
            onPinRefused: { [weak self] in DispatchQueue.main.async { self?.close() } })
        let connection = NWConnection(host: .ipv4(.loopback), port: NWEndpoint.Port(rawValue: port)!, using: parameters)
        tlsConnection = connection
        connection.stateUpdateHandler = { [weak self] state in
            guard let self else { return }
            switch state {
            case .ready:
                DispatchQueue.main.async { [weak self] in
                    guard let self, !self.stopped, self.tlsConnection === connection else { connection.cancel(); return }
                    self.client.t3ReceiptConnection = connection
                    self.client.hostName = self.name
                    self.client.adopt(connection, session: StreamClient.Session(route: .remote(.internet),
                        macID: MacID.make(fingerprint: self.hostPin), bonjourName: nil))
                    self.queue.async { [weak self] in
                        guard let self else { return }
                        self.dialer.authenticated()
                        self.dialer.selectedPath { [weak self] path in
                            guard let path else { return }
                            DispatchQueue.main.async {
                                guard let self, !self.stopped else { return }
                                self.onPath?(path)
                            }
                        }
                    }
                }
            case .failed, .cancelled:
                DispatchQueue.main.async { [weak self] in self?.close() }
            default: break
            }
        }
        connection.start(queue: client.queue)
    }

    func close() {
        guard !stopped else { return }
        stopped = true
        tlsConnection?.cancel()
        tlsConnection = nil
        client.t3Disconnect()
        offerPromise?.reject(Self.failure("The remote connection ended before negotiation completed."))
        offerPromise = nil
        restartPromise?.reject(Self.failure("The remote connection ended during renewal."))
        restartPromise = nil
        answerPromise?.reject(Self.failure("The remote connection ended while applying its answer."))
        answerPromise = nil
        queue.async { [dialer] in dialer.close() }
        let ended = onClose
        onClose = nil
        onPath = nil
        onConnectionLost = nil
        onConnectionRestored = nil
        ended?()
    }
}
