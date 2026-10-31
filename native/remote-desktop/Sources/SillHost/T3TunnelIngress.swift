import Foundation
import Network
import StreamProtocol

/// A single, already-authorized T3 session's private TLS entry point. The socket
/// stays on loopback; its transport owner forwards encrypted bytes to this port.
/// It never advertises, pairs a device, or classifies the loopback hop as home.
package final class T3TunnelIngress {
    private let server: StreamServer
    private let trust: TrustBox
    private let expected: Data
    private let queue: DispatchQueue
    private var listener: NWListener?
    private var connection: NWConnection?
    private var deadline: DispatchWorkItem?
    private var leaseEndsAt = Date.distantPast
    private var stopped = false
    private var portReply: ((UInt16?) -> Void)?
    private let ended: () -> Void

    init(server: StreamServer, identity: HostIdentity, trust: TrustBox, expected: Data,
         expiresAt: Date, ready: @escaping (UInt16?) -> Void, ended: @escaping () -> Void) {
        self.server = server
        self.trust = trust
        self.expected = expected
        queue = server.queue
        portReply = ready
        self.ended = ended
        queue.async { [self] in start(identity: identity, expiresAt: expiresAt) }
    }

    private func permitted() -> Bool {
        let snapshot = trust.snapshot
        return snapshot.remoteAccess && snapshot.internetAccess && snapshot.paired[expected] != nil
    }

    private func diagnostic(_ stage: String) {
        if ProcessInfo.processInfo.environment["T3_REMOTE_DIAGNOSTICS"] == "1" {
            print("T3RD_DIAGNOSTIC ingress-" + stage)
        }
    }

    private func start(identity: HostIdentity, expiresAt: Date) {
        guard !stopped, expected.count == 32, permitted(), setDeadline(expiresAt) else { diagnostic("authorization"); finish(); return }
        let tls = RemoteTLS.options(identity: identity.remote.tls, role: .server, queue: queue) { [weak self] fp, alpn in
            guard let self else { return false }
            let allowed = fp == self.expected && alpn == RemoteTLS.sessionALPN && self.permitted()
            if !allowed { self.diagnostic("tls-refused") }
            return allowed
        }
        let parameters = RemoteTLS.parameters(tls: tls, dialing: false)
        StreamServer.bindToLoopback(parameters, port: nil)
        do {
            let listener = try NWListener(using: parameters)
            self.listener = listener
            listener.newConnectionHandler = { [weak self] in self?.accept($0) ?? $0.cancel() }
            listener.stateUpdateHandler = { [weak self] state in
                guard let self, !self.stopped else { return }
                switch state {
                case .ready:
                    guard let port = self.listener?.port?.rawValue else { self.finish(); return }
                    let reply = self.portReply
                    self.portReply = nil
                    reply?(port)
                case .failed, .cancelled: self.finish()
                default: break
                }
            }
            listener.start(queue: queue)
        } catch { finish() }
    }

    private func accept(_ c: NWConnection) {
        guard !stopped, connection == nil, permitted() else { c.cancel(); return }
        connection = c
        // A second connection cannot race the identity check or borrow this lease.
        listener?.newConnectionHandler = { $0.cancel() }
        c.stateUpdateHandler = { [weak self] state in
            guard let self, !self.stopped else { return }
            switch state {
            case .ready:
                self.diagnostic("tls-ready")
                guard self.permitted(), RemoteTLS.peerFingerprint(c) == self.expected,
                      RemoteTLS.negotiatedALPN(c) == RemoteTLS.sessionALPN,
                      self.server.remoteSessionCount < 8 else { self.finish(); return }
                self.server.gate(c) { [weak self] hello in
                    guard let self, !self.stopped, self.permitted(),
                          self.server.remoteSessionCount < 8,
                          let name = self.trust.snapshot.paired[self.expected] else { c.cancel(); return }
                    self.server.serve(c, route: .remote(origin: .internet, label: "through T3 Code",
                        fingerprint: self.expected, name: name), hello: hello, t3Receipts: true,
                        t3Closed: { [weak self] in self?.diagnostic("stream-closed"); self?.finish() })
                }
            case .failed, .cancelled: self.diagnostic("socket-closed"); self.finish()
            default: break
            }
        }
        c.start(queue: queue)
    }

    private func setDeadline(_ expiresAt: Date) -> Bool {
        let remaining = expiresAt.timeIntervalSinceNow
        // The server owns short leases. Reject accidentally forwarded client deadlines.
        guard remaining > 0, remaining <= 31 else { return false }
        leaseEndsAt = expiresAt
        deadline?.cancel()
        let item = DispatchWorkItem { [weak self] in self?.finish() }
        deadline = item
        queue.asyncAfter(deadline: .now() + remaining, execute: item)
        return true
    }

    package func renew(expiresAt: Date, completion: @escaping (Bool) -> Void) {
        queue.async { [self] in
            guard !stopped, Date() < leaseEndsAt, permitted(), setDeadline(expiresAt) else { finish(); completion(false); return }
            completion(true)
        }
    }

    package func close() { queue.async { [self] in finish() } }

    private func finish() {
        guard !stopped else { return }
        stopped = true
        deadline?.cancel()
        deadline = nil
        listener?.newConnectionHandler = nil
        listener?.stateUpdateHandler = nil
        listener?.cancel()
        listener = nil
        connection?.viabilityUpdateHandler = nil
        connection?.cancel()
        connection = nil
        let reply = portReply
        portReply = nil
        reply?(nil)
        ended()
    }
}

extension StreamCoordinator {
    package func t3OpenTunnel(remote: RemoteAccess, fingerprint: Data, expiresAt: Date,
                              ready: @escaping (UInt16?) -> Void, ended: @escaping () -> Void) -> T3TunnelIngress? {
        guard let identity = remote.identity else { ready(nil); return nil }
        return T3TunnelIngress(server: server, identity: identity, trust: remote.trust,
            expected: fingerprint, expiresAt: expiresAt, ready: ready, ended: ended)
    }
}
