import Foundation
import Network

/// One connection, on its native network queue. Coalesce partial-payload progress
/// so a large keyframe can drain without producing one ACK per network read.
final class T3ReadReceipts {
    private let connection: NWConnection
    private let queue: DispatchQueue
    private var bytes: UInt64 = 0
    private var lastSent: UInt64 = 0
    private var writing = false
    private var stopped = false
    private var scheduled: DispatchWorkItem?

    init(connection: NWConnection, queue: DispatchQueue) {
        self.connection = connection
        self.queue = queue
    }

    func received(_ count: Int) {
        guard !stopped, count > 0, bytes <= UInt64.max - UInt64(count) else { return }
        bytes += UInt64(count)
        guard !writing else { return }
        if bytes - lastSent >= 65_536 { flush() }
        else if scheduled == nil {
            let item = DispatchWorkItem { [weak self] in self?.flush() }
            scheduled = item
            queue.asyncAfter(deadline: .now() + .milliseconds(16), execute: item)
        }
    }

    private func flush() {
        scheduled?.cancel()
        scheduled = nil
        guard !stopped, !writing, bytes > lastSent else { return }
        writing = true
        lastSent = bytes
        let message = StreamMessage(kind: .t3StreamReceipt, timestamp: Date().timeIntervalSince1970,
            isKeyframe: false, payload: Wire.encode(T3StreamReceipt(bytes: bytes)))
        connection.send(content: message.serialized(), completion: .contentProcessed { [weak self] error in
            guard let self, !self.stopped else { return }
            self.writing = false
            if error != nil { self.close(); return }
            if self.bytes > self.lastSent { self.scheduleRemaining() }
        })
    }

    private func scheduleRemaining() {
        if bytes - lastSent >= 65_536 { flush() }
        else {
            let item = DispatchWorkItem { [weak self] in self?.flush() }
            scheduled = item
            queue.asyncAfter(deadline: .now() + .milliseconds(16), execute: item)
        }
    }

    func close() { stopped = true; scheduled?.cancel(); scheduled = nil }
}
