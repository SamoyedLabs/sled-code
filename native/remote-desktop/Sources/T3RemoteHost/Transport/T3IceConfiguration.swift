import Foundation
import LiveKitWebRTC

/// Short-lived connectivity material issued by the authenticated T3 server.
/// Provider API keys never enter this type or the mobile application.
struct T3IceConfiguration: Codable {
    struct Server: Codable {
        let urls: [String]
        let username: String?
        let credential: String?
    }
    let iceServers: [Server]
    let expiresAt: Int64
    let relayOnly: Bool

    enum Failure: Error { case invalid }
    func validatedServers(now: Date = Date()) throws -> [LKRTCIceServer] {
        let remaining = Double(expiresAt) / 1000 - now.timeIntervalSince1970
        guard remaining > 10, remaining <= 86_410, iceServers.count <= 8 else { throw Failure.invalid }
        var hasRelay = false
        let result = try iceServers.map { server in
            guard !server.urls.isEmpty, server.urls.count <= 8 else { throw Failure.invalid }
            for url in server.urls {
                guard url.utf8.count <= 512,
                      url.range(of: #"^(stun|turn|turns):(\[[0-9A-Fa-f:]+\]|[A-Za-z0-9.-]+)(:[0-9]{1,5})?(\?transport=(udp|tcp))?$"#,
                                options: .regularExpression) != nil,
                      let colon = url.firstIndex(of: ":"),
                      let parts = URLComponents(string: "http://" + url[url.index(after: colon)...].replacingOccurrences(of: "?", with: "/?")),
                      parts.port.map({ (1...65_535).contains($0) }) ?? true else { throw Failure.invalid }
                if !url.hasPrefix("stun:") {
                    hasRelay = true
                    guard let user = server.username, let password = server.credential,
                          !user.isEmpty, !password.isEmpty else { throw Failure.invalid }
                }
                if url.hasPrefix("turns:"), url.hasSuffix("transport=udp") { throw Failure.invalid }
            }
            for value in [server.username, server.credential].compactMap({ $0 }) {
                guard value.utf8.count <= 1024,
                      value.unicodeScalars.allSatisfy({ (32...126).contains($0.value) }) else { throw Failure.invalid }
            }
            return LKRTCIceServer(urlStrings: server.urls, username: server.username ?? "", credential: server.credential ?? "")
        }
        guard !relayOnly || hasRelay else { throw Failure.invalid }
        return result
    }
}
