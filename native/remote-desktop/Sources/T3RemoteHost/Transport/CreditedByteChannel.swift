import Foundation
import LiveKitWebRTC

/// Native byte transport. This class provides flow control, not session authorization.
/// Call its methods and callbacks on `queue`; WebRTC delegates enter through a bounded handoff.
final class CreditedByteChannel: NSObject, LKRTCDataChannelDelegate {
    static let label = "t3rd-byte-stream-v1"
    static let chunkLimit = 16 * 1024
    static let windowBytes = 256 * 1024
    static let windowMessages = 32
    static let sendHighWater = 256 * 1024
    private static let controlReserve = 4 * 1024

    let queue: DispatchQueue
    private let channel: LKRTCDataChannel
    private let ingress = CallbackBudget()
    private var stopped = false
    private var started = false
    private var opened = false
    private var earlyPackets: [(Data, Bool)] = []
    private var earlyBytes = 0
    private var localEOF = false
    private var localFINSent = false
    private var localFINAcknowledged = false
    private var remoteFIN = false
    private var remoteEOFDelivered = false
    private var remoteFINAckPending = false
    private var remoteFINAckSent = false
    private var sendCredit = windowBytes
    private var sendSlots = windowMessages
    private var receiveCredit = windowBytes
    private var receiveSlots = windowMessages
    private var pendingCredit = 0
    private var pendingSlots = 0
    private var deliveries: [UInt64: Int] = [:]
    private var nextDelivery: UInt64 = 0
    private var lastSendProgress = DispatchTime.now().uptimeNanoseconds
    private var lastReceiveProgress = DispatchTime.now().uptimeNanoseconds
    private var timer: DispatchSourceTimer?
    private let progressTimeout: Double

    private(set) var peakBufferedAmount: UInt64 = 0
    private(set) var peakUnconsumedBytes = 0
    private(set) var peakUnconsumedMessages = 0
    var onOpen: (() -> Void)?
    var onWritable: (() -> Void)?
    var onBytes: ((Data, @escaping () -> Void) -> Void)?
    var onEOF: ((@escaping () -> Void) -> Void)?
    var onClose: ((String) -> Void)?

    init(channel: LKRTCDataChannel, queue: DispatchQueue, progressTimeout: Double = 10) {
        self.channel = channel
        self.queue = queue
        self.progressTimeout = progressTimeout
        super.init()
        channel.delegate = self
    }

    func start() {
        dispatchPrecondition(condition: .onQueue(queue))
        guard !started, !stopped else { return }
        started = true
        // The reliability getter distinguishes unset limits from an explicit limit of 65535.
        guard channel.label == Self.label, channel.protocol == Self.label,
              channel.isOrdered, channel.isReliable else { fail("channel-contract"); return }
        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now() + progressTimeout, repeating: min(progressTimeout, 1))
        timer.setEventHandler { [weak self] in self?.checkProgress() }
        self.timer = timer
        timer.resume()
        stateChanged()
        let early = earlyPackets
        earlyPackets.removeAll()
        earlyBytes = 0
        for (packet, binary) in early { receive(packet, binary: binary) }
    }

    /// Acceptance means queued for transport. Far-consumer progress arrives separately as credit.
    @discardableResult
    func send(_ bytes: Data) -> Bool {
        dispatchPrecondition(condition: .onQueue(queue))
        guard opened, !stopped, !localEOF, !bytes.isEmpty, bytes.count <= Self.chunkLimit,
              sendCredit >= bytes.count, sendSlots > 0,
              channel.bufferedAmount + UInt64(bytes.count + 1) <= Self.sendHighWater - Self.controlReserve else { return false }
        var packet = Data([1])
        packet.append(bytes)
        if sendSlots == Self.windowMessages { lastSendProgress = DispatchTime.now().uptimeNanoseconds }
        guard channel.sendData(LKRTCDataBuffer(data: packet, isBinary: true)) else {
            fail("send-rejected")
            return false
        }
        sendCredit -= bytes.count
        sendSlots -= 1
        recordBufferedAmount()
        return true
    }

    var canReadChunk: Bool {
        dispatchPrecondition(condition: .onQueue(queue))
        return opened && !stopped && !localEOF && sendCredit >= Self.chunkLimit && sendSlots > 0
            && channel.bufferedAmount + UInt64(Self.chunkLimit + 1) <= Self.sendHighWater - Self.controlReserve
    }

    func close() {
        dispatchPrecondition(condition: .onQueue(queue))
        fail("closed")
    }

    func finish() {
        dispatchPrecondition(condition: .onQueue(queue))
        guard !stopped, !localEOF else { return }
        localEOF = true
        lastSendProgress = DispatchTime.now().uptimeNanoseconds
        flushControl()
    }

    private func stateChanged() {
        guard started, !stopped else { return }
        switch channel.readyState {
        case .open where !opened:
            opened = true
            onOpen?()
            flushControl()
        case .closing, .closed: fail("peer-closed")
        default: break
        }
    }

    private func receive(_ packet: Data, binary: Bool) {
        guard !stopped else { return }
        if !started {
            guard earlyPackets.count < Self.windowMessages,
                  earlyBytes + packet.count <= Self.windowBytes + Self.windowMessages else {
                fail("startup-window"); return
            }
            earlyBytes += packet.count
            earlyPackets.append((packet, binary))
            return
        }
        guard opened, binary, let kind = packet.first else { fail("invalid-packet"); return }
        switch kind {
        case 1:
            let count = packet.count - 1
            guard !remoteFIN, count > 0, count <= Self.chunkLimit, count <= receiveCredit,
                  receiveSlots > 0, let sink = onBytes else { fail("receive-window"); return }
            if deliveries.isEmpty { lastReceiveProgress = DispatchTime.now().uptimeNanoseconds }
            receiveCredit -= count
            receiveSlots -= 1
            nextDelivery += 1
            let id = nextDelivery
            deliveries[id] = count
            peakUnconsumedBytes = max(peakUnconsumedBytes, deliveries.values.reduce(0, +))
            peakUnconsumedMessages = max(peakUnconsumedMessages, deliveries.count)
            sink(Data(packet.dropFirst())) { [weak self] in
                guard let self else { return }
                self.queue.async { [weak self] in self?.consumed(id) }
            }
        case 2:
            guard packet.count == 9 else { fail("invalid-credit"); return }
            let bytes = Self.number(packet, at: 1)
            let slots = Self.number(packet, at: 5)
            guard bytes > 0, slots > 0, bytes <= Self.windowBytes - sendCredit,
                  slots <= Self.windowMessages - sendSlots else { fail("excess-credit"); return }
            sendCredit += bytes
            sendSlots += slots
            lastSendProgress = DispatchTime.now().uptimeNanoseconds
            flushControl()
            onWritable?()
        case 3:
            guard packet.count == 1, !remoteFIN else { fail("invalid-eof"); return }
            remoteFIN = true
            lastReceiveProgress = DispatchTime.now().uptimeNanoseconds
            deliverEOF()
        case 4:
            guard packet.count == 1, localFINSent, !localFINAcknowledged else { fail("invalid-eof-ack"); return }
            localFINAcknowledged = true
            checkFinished()
        default: fail("packet-version")
        }
    }

    private func consumed(_ id: UInt64) {
        guard !stopped else { return }
        guard let count = deliveries.removeValue(forKey: id) else { fail("duplicate-consumption"); return }
        pendingCredit += count
        pendingSlots += 1
        lastReceiveProgress = DispatchTime.now().uptimeNanoseconds
        flushControl()
        deliverEOF()
    }

    private func flushControl() {
        guard !stopped, opened else { return }
        if pendingSlots > 0 {
            guard channel.bufferedAmount + 9 <= Self.sendHighWater else { return }
            var packet = Data([2])
            Self.append(pendingCredit, to: &packet)
            Self.append(pendingSlots, to: &packet)
            guard channel.sendData(LKRTCDataBuffer(data: packet, isBinary: true)) else {
                fail("credit-rejected"); return
            }
            receiveCredit += pendingCredit
            receiveSlots += pendingSlots
            pendingCredit = 0
            pendingSlots = 0
            recordBufferedAmount()
        }
        if remoteFINAckPending, channel.bufferedAmount + 1 <= Self.sendHighWater {
            guard sendControl(4) else { return }
            remoteFINAckPending = false
            remoteFINAckSent = true
        }
        if localEOF, !localFINSent, sendCredit == Self.windowBytes, sendSlots == Self.windowMessages,
           channel.bufferedAmount + 1 <= Self.sendHighWater {
            guard sendControl(3) else { return }
            localFINSent = true
        }
        checkFinished()
    }

    private func sendControl(_ kind: UInt8) -> Bool {
        guard channel.sendData(LKRTCDataBuffer(data: Data([kind]), isBinary: true)) else {
            fail("control-rejected"); return false
        }
        recordBufferedAmount()
        return true
    }

    private func deliverEOF() {
        guard !stopped, remoteFIN, deliveries.isEmpty, !remoteEOFDelivered else { return }
        guard let sink = onEOF else { fail("unexpected-eof"); return }
        remoteEOFDelivered = true
        sink { [weak self] in
            guard let self else { return }
            self.queue.async { [weak self] in
                guard let self, !self.stopped else { return }
                guard !self.remoteFINAckPending, !self.remoteFINAckSent else { self.fail("duplicate-eof-consumption"); return }
                self.remoteFINAckPending = true
                self.flushControl()
            }
        }
    }

    private func checkFinished() {
        if localFINAcknowledged, remoteFINAckSent, channel.bufferedAmount == 0 { fail("eof") }
    }

    private func checkProgress() {
        guard !stopped, opened else { return }
        let now = DispatchTime.now().uptimeNanoseconds
        if (sendSlots < Self.windowMessages && Double(now - lastSendProgress) / 1e9 >= progressTimeout)
            || (localEOF && !localFINAcknowledged && Double(now - lastSendProgress) / 1e9 >= progressTimeout)
            || (remoteEOFDelivered && !remoteFINAckSent && Double(now - lastReceiveProgress) / 1e9 >= progressTimeout)
            || (!deliveries.isEmpty && Double(now - lastReceiveProgress) / 1e9 >= progressTimeout) {
            fail("consumer-stalled")
        }
    }

    private func recordBufferedAmount() {
        peakBufferedAmount = max(peakBufferedAmount, channel.bufferedAmount)
    }

    private func fail(_ reason: String) {
        guard !stopped else { return }
        stopped = true
        timer?.cancel()
        timer = nil
        channel.delegate = nil
        channel.close()
        deliveries.removeAll()
        earlyPackets.removeAll()
        onOpen = nil
        onWritable = nil
        onBytes = nil
        onEOF = nil
        let callback = onClose
        onClose = nil
        callback?(reason)
    }

    private static func number(_ data: Data, at offset: Int) -> Int {
        data[offset..<(offset + 4)].reduce(0) { ($0 << 8) | Int($1) }
    }

    private static func append(_ value: Int, to data: inout Data) {
        for shift in stride(from: 24, through: 0, by: -8) { data.append(UInt8((value >> shift) & 255)) }
    }

    func dataChannelDidChangeState(_ dataChannel: LKRTCDataChannel) {
        queue.async { [weak self] in self?.stateChanged() }
    }

    func dataChannel(_ dataChannel: LKRTCDataChannel, didChangeBufferedAmount amount: UInt64) {
        // `amount` is the previous occupancy, not the current value.
        guard ingress.claimWritable() else { return }
        queue.async { [weak self] in
            guard let self else { return }
            self.ingress.releaseWritable()
            guard !self.stopped else { return }
            self.flushControl()
            self.onWritable?()
        }
    }

    func dataChannel(_ dataChannel: LKRTCDataChannel, didReceiveMessageWith buffer: LKRTCDataBuffer) {
        guard buffer.data.count <= Self.chunkLimit + 1,
              ingress.claim(bytes: buffer.data.count) else {
            if ingress.claimFailure() { queue.async { [weak self] in self?.fail("callback-limit") } }
            return
        }
        let packet = buffer.data
        let binary = buffer.isBinary
        queue.async { [weak self] in
            guard let self else { return }
            self.ingress.release(bytes: packet.count)
            self.receive(packet, binary: binary)
        }
    }
}

/// Bounds the work queued by WebRTC before the serial owner can validate it.
private final class CallbackBudget {
    private let lock = NSLock()
    private var bytes = 0
    private var messages = 0
    private var writablePending = false
    private var failed = false

    func claim(bytes count: Int) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard !failed, messages < 128, bytes + count <= 1024 * 1024 else { return false }
        bytes += count
        messages += 1
        return true
    }

    func release(bytes count: Int) {
        lock.lock()
        bytes -= count
        messages -= 1
        lock.unlock()
    }

    func claimFailure() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard !failed else { return false }
        failed = true
        return true
    }

    func claimWritable() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard !writablePending, !failed else { return false }
        writablePending = true
        return true
    }

    func releaseWritable() {
        lock.lock()
        writablePending = false
        lock.unlock()
    }
}
