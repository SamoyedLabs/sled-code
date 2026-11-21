import Foundation
import Network
import StreamProtocol

package enum T3TunnelAdmission {
    case paired(Data)
    case authenticatedLease(Data)

    var fingerprint: Data {
        switch self {
        case .paired(let key), .authenticatedLease(let key): return key
        }
    }

    func name(in snapshot: TrustSnapshot, expiresAt: Date, now: Date) -> String? {
        guard fingerprint.count == 32, now < expiresAt,
              snapshot.remoteAccess, snapshot.internetAccess else { return nil }
        switch self {
        case .paired(let key): return snapshot.paired[key]
        case .authenticatedLease: return "Sled Connect"
        }
    }

    func accepts(_ fingerprint: Data?, alpn: String?, in snapshot: TrustSnapshot,
                 expiresAt: Date, now: Date) -> Bool {
        fingerprint == self.fingerprint && alpn == RemoteTLS.sessionALPN &&
            name(in: snapshot, expiresAt: expiresAt, now: now) != nil
    }
}

/// A single, already-authorized T3 session's private TLS entry point. The socket
/// stays on loopback; its transport owner forwards encrypted bytes to this port.
/// It never advertises, pairs a device, or classifies the loopback hop as home.
package final class T3TunnelIngress {
    private let server: StreamServer
    private let trust: TrustBox
    private let admission: T3TunnelAdmission
    private let queue: DispatchQueue
    private var listener: NWListener?
    private var connection: NWConnection?
    private var deadline: DispatchWorkItem?
    private var leaseEndsAt = Date.distantPast
    private var stopped = false
    private var portReply: ((UInt16?) -> Void)?
    private let ended: () -> Void

    init(server: StreamServer, identity: HostIdentity, trust: TrustBox, admission: T3TunnelAdmission,
         expiresAt: Date, ready: @escaping (UInt16?) -> Void, ended: @escaping () -> Void) {
        self.server = server
        self.trust = trust
        self.admission = admission
        queue = server.queue
        portReply = ready
        self.ended = ended
        queue.async { [self] in start(identity: identity, expiresAt: expiresAt) }
    }

    private func admittedName() -> String? {
        admission.name(in: trust.snapshot, expiresAt: leaseEndsAt, now: Date())
    }

    private func accepts(_ fingerprint: Data?, alpn: String?) -> Bool {
        !stopped && admission.accepts(fingerprint, alpn: alpn, in: trust.snapshot,
                          expiresAt: leaseEndsAt, now: Date())
    }

    private func diagnostic(_ stage: String) {
        if ProcessInfo.processInfo.environment["T3_REMOTE_DIAGNOSTICS"] == "1" {
            print("T3RD_DIAGNOSTIC ingress-" + stage)
        }
    }

    private func start(identity: HostIdentity, expiresAt: Date) {
        guard !stopped, setDeadline(expiresAt), admittedName() != nil else { diagnostic("authorization"); finish(); return }
        let tls = RemoteTLS.options(identity: identity.remote.tls, role: .server, queue: queue) { [weak self] fp, alpn in
            guard let self else { return false }
            let allowed = self.accepts(fp, alpn: alpn)
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
        guard !stopped, connection == nil, admittedName() != nil else { c.cancel(); return }
        connection = c
        // A second connection cannot race the identity check or borrow this lease.
        listener?.newConnectionHandler = { $0.cancel() }
        c.stateUpdateHandler = { [weak self] state in
            guard let self, !self.stopped else { return }
            switch state {
            case .ready:
                self.diagnostic("tls-ready")
                guard self.accepts(RemoteTLS.peerFingerprint(c), alpn: RemoteTLS.negotiatedALPN(c)),
                      self.server.remoteSessionCount < 8 else { self.finish(); return }
                self.server.gate(c) { [weak self] hello in
                    guard let self, !self.stopped,
                          self.server.remoteSessionCount < 8,
                          let name = self.admittedName() else { c.cancel(); return }
                    self.server.serve(c, route: .remote(origin: .internet, label: "through Sled Code",
                        fingerprint: self.admission.fingerprint, name: name), hello: hello, t3Receipts: true,
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
            guard !stopped, admittedName() != nil, setDeadline(expiresAt) else { finish(); completion(false); return }
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
    package func t3OpenTunnel(remote: RemoteAccess, admission: T3TunnelAdmission, expiresAt: Date,
                              ready: @escaping (UInt16?) -> Void, ended: @escaping () -> Void) -> T3TunnelIngress? {
        guard let identity = remote.identity else { ready(nil); return nil }
        return T3TunnelIngress(server: server, identity: identity, trust: remote.trust,
            admission: admission, expiresAt: expiresAt, ready: ready, ended: ended)
    }
}
