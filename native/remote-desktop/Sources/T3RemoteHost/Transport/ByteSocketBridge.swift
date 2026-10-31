import Foundation
import Network

/// Opaque byte forwarding between the native transport and a private TLS hop.
/// Consumption here means accepted by the far socket, not decoded or displayed.
final class ByteSocketBridge {
    private let socket: NWConnection
    private let tunnel: CreditedByteChannel
    private let queue: DispatchQueue
    private var ready = false
    private var reading = false
    private var readEOF = false
    private var stopped = false
    private var pending: Data?
    var onClose: (() -> Void)?

    init(socket: NWConnection, tunnel: CreditedByteChannel, queue: DispatchQueue) {
        self.socket = socket
        self.tunnel = tunnel
        self.queue = queue
    }

    func start() {
        tunnel.onOpen = { [weak self] in self?.pump() }
        tunnel.onWritable = { [weak self] in self?.pump() }
        tunnel.onClose = { [weak self] _ in self?.close() }
        tunnel.onEOF = { [weak self] consumed in
            guard let self, !self.stopped else { return }
            self.socket.send(content: nil, contentContext: .finalMessage, isComplete: true,
                completion: .contentProcessed { [weak self] error in
                    guard let self, !self.stopped else { return }
                    if error != nil { self.close() } else { consumed() }
                })
        }
        tunnel.onBytes = { [weak self] bytes, consumed in
            guard let self, !self.stopped else { return }
            self.socket.send(content: bytes, completion: .contentProcessed { [weak self] error in
                guard let self, !self.stopped else { return }
                if error != nil { self.close() } else { consumed() }
            })
        }
        socket.stateUpdateHandler = { [weak self] state in
            guard let self, !self.stopped else { return }
            switch state {
            case .ready: self.ready = true; self.pump()
            case .failed, .cancelled: self.close()
            default: break
            }
        }
        socket.start(queue: queue)
        tunnel.start()
    }

    private func pump() {
        guard ready, !stopped else { return }
        if let bytes = pending {
            guard tunnel.send(bytes) else { return }
            pending = nil
        }
        if readEOF { tunnel.finish(); return }
        guard !reading, tunnel.canReadChunk else { return }
        reading = true
        socket.receive(minimumIncompleteLength: 1, maximumLength: CreditedByteChannel.chunkLimit) { [weak self] data, _, complete, error in
            guard let self, !self.stopped else { return }
            self.reading = false
            if error != nil { self.close(); return }
            self.readEOF = complete
            if let data, !data.isEmpty {
                self.pending = data
            }
            self.pump()
        }
    }

    func close() {
        guard !stopped else { return }
        stopped = true
        socket.stateUpdateHandler = nil
        socket.cancel()
        tunnel.close()
        pending = nil
        let callback = onClose
        onClose = nil
        callback?()
    }
}
