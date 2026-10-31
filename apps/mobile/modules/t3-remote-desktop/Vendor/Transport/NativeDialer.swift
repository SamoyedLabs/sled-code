import Foundation
import LiveKitWebRTC
import Network

/// Client-side native owner. Its only TCP endpoint is a single-use loopback hop
/// for the app's pinned TLS client; the actual remote path is WebRTC.
final class NativeDialer {
    enum Failure: Error { case channel }
    private let queue: DispatchQueue
    private let peer: NativePeer
    private let listener: NWListener
    private let channel: CreditedByteChannel
    private var bridge: ByteSocketBridge?
    private var stopped = false
    private var answered = false
    private var started = false
    private var offered = false
    private var restarting = false
    private var offerReply: ((String) -> Void)?
    private var deadline: DispatchWorkItem?
    var onClose: (() -> Void)?
    var onConnectionLost: (() -> Void)?
    var onConnectionRestored: (() -> Void)?
    var localPort: UInt16? { listener.port?.rawValue } // native queue only

    init(queue: DispatchQueue, factory: LKRTCPeerConnectionFactory,
         servers: [LKRTCIceServer] = [], relayOnly: Bool = false) throws {
        self.queue = queue
        peer = NativePeer(factory: factory, queue: queue, servers: servers, relayOnly: relayOnly)
        guard let outgoing = peer.makeChannel() else { throw Failure.channel }
        channel = CreditedByteChannel(channel: outgoing, queue: queue)
        let parameters = NWParameters.tcp
        parameters.requiredLocalEndpoint = .hostPort(host: .ipv4(.loopback), port: .any)
        listener = try NWListener(using: parameters)
    }

    func offer(_ ready: @escaping (String) -> Void) {
        dispatchPrecondition(condition: .onQueue(queue))
        guard !stopped, !started else { close(); return }
        started = true
        offerReply = ready
        let deadline = DispatchWorkItem { [weak self] in self?.close() }
        self.deadline = deadline
        queue.asyncAfter(deadline: .now() + 30, execute: deadline)
        peer.onFailure = { [weak self] _ in self?.close() }
        peer.onConnectionLost = { [weak self] in self?.onConnectionLost?() }
        peer.onConnectionRestored = { [weak self] in self?.onConnectionRestored?() }
        listener.newConnectionHandler = { [weak self] socket in
            guard let self, !self.stopped, self.answered, self.bridge == nil else { socket.cancel(); return }
            let bridge = ByteSocketBridge(socket: socket, tunnel: self.channel, queue: self.queue)
            self.bridge = bridge
            bridge.onClose = { [weak self] in self?.close() }
            bridge.start()
        }
        listener.stateUpdateHandler = { [weak self] state in
            guard let self, !self.stopped else { return }
            switch state {
            case .ready:
                self.peer.offer { [weak self] description in
                    guard let self, !self.stopped else { return }
                    let reply = self.offerReply
                    self.offerReply = nil
                    self.offered = true
                    reply?(description.sdp)
                }
            case .failed, .cancelled: self.close()
            default: break
            }
        }
        listener.start(queue: queue)
    }

    func answer(_ description: String, ready: @escaping (UInt16) -> Void) {
        dispatchPrecondition(condition: .onQueue(queue))
        guard !stopped, offered, !answered, let port = listener.port?.rawValue else { close(); return }
        answered = true
        peer.accept(LKRTCSessionDescription(type: .answer, sdp: description)) { [weak self] in
            guard let self, !self.stopped else { return }
            ready(port)
        }
    }

    /// Called only once the app's pinned TLS connection is ready.
    func authenticated() {
        dispatchPrecondition(condition: .onQueue(queue))
        deadline?.cancel()
        deadline = nil
    }

    func selectedPath(_ complete: @escaping ([String:String]?) -> Void) { peer.selectedPath(complete) }

    func restart(servers: [LKRTCIceServer], relayOnly: Bool, ready: @escaping (String) -> Void) {
        dispatchPrecondition(condition: .onQueue(queue))
        guard !stopped, answered, !restarting else { close(); return }
        restarting = true
        peer.restart(servers: servers, relayOnly: relayOnly) { ready($0.sdp) }
    }

    func acceptRestart(_ description: String, ready: @escaping () -> Void) {
        dispatchPrecondition(condition: .onQueue(queue))
        guard !stopped, restarting else { close(); return }
        peer.accept(LKRTCSessionDescription(type: .answer, sdp: description)) { [weak self] in
            guard let self, !self.stopped else { return }
            self.restarting = false
            ready()
        }
    }

    func close() {
        dispatchPrecondition(condition: .onQueue(queue))
        guard !stopped else { return }
        stopped = true
        deadline?.cancel()
        deadline = nil
        offerReply = nil
        listener.newConnectionHandler = nil
        listener.stateUpdateHandler = nil
        listener.cancel()
        bridge?.onClose = nil
        bridge?.close()
        bridge = nil
        peer.close()
        let ended = onClose
        onClose = nil
        onConnectionLost = nil
        onConnectionRestored = nil
        ended?()
    }
}
