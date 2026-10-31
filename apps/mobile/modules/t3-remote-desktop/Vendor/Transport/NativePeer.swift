import Foundation
import LiveKitWebRTC

/// Native WebRTC owner. The caller authenticates signaling and owns its lease.
/// This type exposes no network signaling API.
final class NativePeer: NSObject, LKRTCPeerConnectionDelegate {
    let queue: DispatchQueue
    private let factory: LKRTCPeerConnectionFactory
    private(set) var connection: LKRTCPeerConnection!
    private var descriptionReady: ((LKRTCSessionDescription) -> Void)?
    private var localDescriptionSet = false
    private var gatheringDeadline: DispatchWorkItem?
    private var closed = false
    var onChannel: ((CreditedByteChannel) -> Void)?
    var onFailure: ((String) -> Void)?
    var onStage: ((String) -> Void)?
    var onConnectionLost: (() -> Void)?
    var onConnectionRestored: (() -> Void)?

    init(factory: LKRTCPeerConnectionFactory, queue: DispatchQueue,
         servers: [LKRTCIceServer] = [], relayOnly: Bool = false,
         certificateVerifier: LKRTCSSLCertificateVerifier? = nil) {
        self.factory = factory
        self.queue = queue
        super.init()
        let config = LKRTCConfiguration()
        config.iceServers = servers
        config.iceTransportPolicy = relayOnly ? .relay : .all
        config.sdpSemantics = .unifiedPlan
        let constraints = LKRTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)
        if let certificateVerifier {
            connection = factory.peerConnection(with: config, constraints: constraints,
                certificateVerifier: certificateVerifier, delegate: self)
        } else {
            connection = factory.peerConnection(with: config, constraints: constraints, delegate: self)
        }
    }

    func makeChannel() -> LKRTCDataChannel? {
        let config = LKRTCDataChannelConfiguration()
        config.isOrdered = true
        config.protocol = CreditedByteChannel.label
        // Leave lifetime/retransmit limits unset: the inner TLS stream requires every byte.
        return connection.dataChannel(forLabel: CreditedByteChannel.label, configuration: config)
    }

    func offer(_ ready: @escaping (LKRTCSessionDescription) -> Void) {
        guard !closed, descriptionReady == nil else { onFailure?("negotiation-busy"); return }
        onStage?("create-offer")
        descriptionReady = ready
        localDescriptionSet = false
        connection.offer(for: LKRTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)) { [weak self] sdp, error in
            guard let self else { return }
            self.queue.async { [weak self] in self?.setLocal(sdp, error: error) }
        }
    }

    func answer(to offer: LKRTCSessionDescription, ready: @escaping (LKRTCSessionDescription) -> Void) {
        guard !closed, descriptionReady == nil else { onFailure?("negotiation-busy"); return }
        descriptionReady = ready
        localDescriptionSet = false
        accept(offer) { [weak self] in
            guard let self else { return }
            self.connection.answer(for: LKRTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)) { [weak self] sdp, error in
                guard let self else { return }
                self.queue.async { [weak self] in self?.setLocal(sdp, error: error) }
            }
        }
    }

    /// Updating TURN credentials affects the next gathering phase, leaving the
    /// existing SCTP/TLS stream alive while its replacement path is checked.
    func configure(servers: [LKRTCIceServer], relayOnly: Bool) -> Bool {
        guard !closed, descriptionReady == nil else { return false }
        let config = connection.configuration
        config.iceServers = servers
        config.iceTransportPolicy = relayOnly ? .relay : .all
        return connection.setConfiguration(config)
    }

    func restart(servers: [LKRTCIceServer], relayOnly: Bool,
                 ready: @escaping (LKRTCSessionDescription) -> Void) {
        guard configure(servers: servers, relayOnly: relayOnly) else {
            onFailure?("ice-configuration"); return
        }
        connection.restartIce()
        offer(ready)
    }

    func accept(_ sdp: LKRTCSessionDescription, completion: @escaping () -> Void = {}) {
        guard !closed, sdp.sdp.utf8.count <= 64 * 1024 else { onFailure?("description-limit"); return }
        // These fixed-size chunks require a peer that permits at least 16 KiB plus framing.
        let limits = sdp.sdp.components(separatedBy: "\n").compactMap { line -> Int? in
            guard line.hasPrefix("a=max-message-size:") else { return nil }
            return Int(line.dropFirst("a=max-message-size:".count).trimmingCharacters(in: .whitespacesAndNewlines))
        }
        guard limits.allSatisfy({ $0 == 0 || $0 >= CreditedByteChannel.chunkLimit + 1 }) else {
            onFailure?("message-limit"); return
        }
        connection.setRemoteDescription(sdp) { [weak self] error in
            guard let self else { return }
            self.queue.async { [weak self] in
                guard let self, !self.closed else { return }
                if error != nil { self.onFailure?("remote-description") } else {
                    completion()
                    self.publishConnectionRestored()
                }
            }
        }
    }

    private func setLocal(_ sdp: LKRTCSessionDescription?, error: Error?) {
        guard !closed else { return }
        guard error == nil, let sdp else { onFailure?("create-description"); return }
        onStage?("set-local")
        connection.setLocalDescription(sdp) { [weak self] error in
            guard let self else { return }
            self.queue.async { [weak self] in
                guard let self, !self.closed else { return }
                if error != nil { self.onFailure?("local-description") }
                else {
                    guard self.descriptionReady != nil else { return }
                    self.localDescriptionSet = true
                    // A silent UDP endpoint must not hold an already gathered
                    // TCP/TLS relay hostage until WebRTC's longer STUN timeout.
                    // Keep all candidates available at this bounded deadline.
                    let deadline = DispatchWorkItem { [weak self] in self?.publishDescription(atDeadline: true) }
                    self.gatheringDeadline = deadline
                    self.queue.asyncAfter(deadline: .now() + 8, execute: deadline)
                    self.publishDescription()
                }
            }
        }
    }

    private func publishDescription(atDeadline: Bool = false) {
        onStage?("gathering-\(connection.iceGatheringState.rawValue)")
        guard !closed, localDescriptionSet, connection.iceGatheringState == .complete || atDeadline,
              let sdp = connection.localDescription, let ready = descriptionReady else { return }
        let count = sdp.sdp.components(separatedBy: "\n").filter { $0.hasPrefix("a=candidate:") }.count
        // During an ICE restart, the previous generation's complete callback
        // can precede candidate gathering for the replacement description.
        // Only the bounded deadline may reject an empty new generation.
        guard count > 0 else {
            if atDeadline { onFailure?("no-ice-candidates") }
            return
        }
        gatheringDeadline?.cancel()
        gatheringDeadline = nil
        descriptionReady = nil
        onStage?("description-ready-candidates-\(count)")
        ready(sdp)
    }

    func selectedPath(_ complete: @escaping ([String: String]?) -> Void) {
        connection.statistics { [weak self] report in
            guard let self else { return }
            self.queue.async { [weak self] in
                guard let self, !self.closed else { return }
                guard let transport = report.statistics.values.first(where: {
                    $0.type == "transport" && $0.values["selectedCandidatePairId"] != nil
                }), let pairID = transport.values["selectedCandidatePairId"] as? String,
                    let pair = report.statistics[pairID],
                    let localID = pair.values["localCandidateId"] as? String,
                    let remoteID = pair.values["remoteCandidateId"] as? String,
                    let local = report.statistics[localID], let remote = report.statistics[remoteID] else {
                    complete(nil); return
                }
                var result: [String: String] = [:]
                for key in ["bytesReceived", "bytesSent"] {
                    if let value = transport.values[key] { result[key] = "\(value)" }
                }
                for (prefix, candidate) in [("local", local), ("remote", remote)] {
                    // Deliberately omit candidate addresses, ports and credentials from diagnostics.
                    for (key, suffix) in [("candidateType", "CandidateType"), ("protocol", "Protocol"), ("relayProtocol", "RelayProtocol"), ("networkType", "NetworkType")] {
                        if let value = candidate.values[key] { result[prefix + suffix] = "\(value)" }
                    }
                }
                complete(result)
            }
        }
    }

    func close() {
        guard !closed else { return }
        closed = true
        gatheringDeadline?.cancel()
        gatheringDeadline = nil
        descriptionReady = nil
        onChannel = nil
        onFailure = nil
        onConnectionLost = nil
        onConnectionRestored = nil
        connection.delegate = nil
        connection.close()
    }

    private func publishConnectionRestored() {
        guard localDescriptionSet, connection.signalingState == .stable,
              connection.iceConnectionState == .connected || connection.iceConnectionState == .completed else { return }
        onConnectionRestored?()
    }

    func peerConnection(_ peerConnection: LKRTCPeerConnection, didChange stateChanged: LKRTCSignalingState) {}
    func peerConnection(_ peerConnection: LKRTCPeerConnection, didAdd stream: LKRTCMediaStream) {}
    func peerConnection(_ peerConnection: LKRTCPeerConnection, didRemove stream: LKRTCMediaStream) {}
    func peerConnectionShouldNegotiate(_ peerConnection: LKRTCPeerConnection) {}
    func peerConnection(_ peerConnection: LKRTCPeerConnection, didChange newState: LKRTCIceConnectionState) {
        queue.async { [weak self] in
            guard let self, !self.closed else { return }
            self.onStage?("ice-\(newState.rawValue)")
            if newState == .disconnected { self.onConnectionLost?() }
            self.publishConnectionRestored()
        }
        guard newState == .failed else { return }
        queue.async { [weak self] in
            guard let self, !self.closed else { return }
            self.onFailure?("ice-failed")
        }
    }
    func peerConnection(_ peerConnection: LKRTCPeerConnection, didChange newState: LKRTCIceGatheringState) {
        queue.async { [weak self] in self?.publishDescription() }
    }
    func peerConnection(_ peerConnection: LKRTCPeerConnection, didGenerate candidate: LKRTCIceCandidate) {
        queue.async { [weak self] in self?.publishDescription() }
    }
    func peerConnection(_ peerConnection: LKRTCPeerConnection, didRemove candidates: [LKRTCIceCandidate]) {}
    func peerConnection(_ peerConnection: LKRTCPeerConnection, didOpen dataChannel: LKRTCDataChannel) {
        // Install the receive delegate before returning to WebRTC: a peer may send immediately.
        let incoming = CreditedByteChannel(channel: dataChannel, queue: queue)
        queue.async { [weak self] in
            guard let self, !self.closed else { incoming.close(); return }
            self.onStage?("data-channel")
            if let receive = self.onChannel { receive(incoming) } else { incoming.close() }
        }
    }
}
