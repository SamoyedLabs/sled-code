import Foundation

/// Cumulative plaintext bytes read from this TLS session, including message headers.
/// This is network-consumer progress, not proof that a frame has been displayed.
public struct T3StreamReceipt: Codable, Sendable {
    public let bytes: UInt64
    public init(bytes: UInt64) { self.bytes = bytes }
}

/// Holds send completions until both the socket and the far TLS reader have consumed them.
/// A loopback socket accepting bytes alone must not release the host's WAN pacing budget.
public struct T3StreamDrain: Sendable {
    public enum Failure: Error, Equatable {
        case capacity
        case invalidReceipt
    }

    public struct Progress: Sendable {
        public let bytes: UInt64
        public let completed: [UInt64]
    }

    private struct Pending: Sendable {
        let end: UInt64
        let size: Int
        var socketProcessed = false
    }

    private let messageLimit: Int
    private let byteLimit: Int
    private var nextToken: UInt64 = 0
    private var sent: UInt64 = 0
    private var received: UInt64 = 0
    private var socketBytes = 0
    private var messages: [UInt64: Pending] = [:]
    private var order: [UInt64] = []
    private var head = 0

    public init(messageLimit: Int = 4096, byteLimit: Int = 40 * 1024 * 1024) {
        precondition(messageLimit > 0 && byteLimit > 0)
        self.messageLimit = messageLimit
        self.byteLimit = byteLimit
    }

    public var pendingBytes: Int { max(Int(sent - received), socketBytes) }
    public var pendingMessages: Int { messages.count }
    public var sentBytes: UInt64 { sent }
    public var receivedBytes: UInt64 { received }

    public mutating func register(bytes: Int) throws -> UInt64 {
        guard bytes > 0, messages.count < messageLimit, bytes <= byteLimit,
              pendingBytes <= byteLimit - bytes, nextToken < UInt64.max,
              sent <= UInt64.max - UInt64(bytes) else { throw Failure.capacity }
        nextToken += 1
        sent += UInt64(bytes)
        socketBytes += bytes
        messages[nextToken] = Pending(end: sent, size: bytes)
        order.append(nextToken)
        return nextToken
    }

    public mutating func socketProcessed(_ token: UInt64) -> [UInt64] {
        guard var message = messages[token], !message.socketProcessed else { return [] }
        message.socketProcessed = true
        socketBytes -= message.size
        messages[token] = message
        return complete()
    }

    public mutating func acknowledge(bytes: UInt64) throws -> Progress {
        guard bytes >= received, bytes <= sent else { throw Failure.invalidReceipt }
        let delta = bytes - received
        received = bytes
        return Progress(bytes: delta, completed: complete())
    }

    private mutating func complete() -> [UInt64] {
        var completed: [UInt64] = []
        while head < order.count, let message = messages[order[head]],
              message.socketProcessed, message.end <= received {
            let token = order[head]
            messages.removeValue(forKey: token)
            completed.append(token)
            head += 1
        }
        if head == order.count {
            order.removeAll(keepingCapacity: true)
            head = 0
        } else if head >= 256 {
            order.removeFirst(head)
            head = 0
        }
        return completed
    }
}
