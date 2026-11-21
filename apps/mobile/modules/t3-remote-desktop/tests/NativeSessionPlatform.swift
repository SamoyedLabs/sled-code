import Foundation
import Network
import LiveKitWebRTC

// Platform substitutes isolate admission and answer binding in the real T3NativeSession.
struct RemoteIdentity { let fingerprint = Data(repeating: 7, count: 32) }
enum DeviceIdentity {
    static var identity: RemoteIdentity?
    static func existing() -> RemoteIdentity? { identity }
    static func loadOrCreate() throws -> RemoteIdentity {
        if let identity { return identity }
        let created = RemoteIdentity()
        identity = created
        return created
    }
}
enum Base64URL {
    static func encode(_ value: Data) -> String {
        value.base64EncodedString().replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }
    static func decode(_ value: String) -> Data? {
        let padded = value.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
            + String(repeating: "=", count: (4 - value.count % 4) % 4)
        guard let data = Data(base64Encoded: padded), encode(data) == value else { return nil }
        return data
    }
}
struct T3IceConfiguration {
    var relayOnly = false
    func validatedServers() throws -> [LKRTCIceServer] { [] }
}
final class NativeDialer {
    init(queue: DispatchQueue, factory: LKRTCPeerConnectionFactory, servers: [LKRTCIceServer], relayOnly: Bool) throws {}
    var onClose: (() -> Void)?
    var onConnectionLost: (() -> Void)?
    var onConnectionRestored: (() -> Void)?
    func offer(_ completion: (String) -> Void) { completion("offer") }
    func answer(_ answer: String, completion: (UInt16) -> Void) {}
    func acceptRestart(_ answer: String, completion: () -> Void) {}
    func restart(servers: [LKRTCIceServer], relayOnly: Bool, completion: (String) -> Void) {}
    func selectedPath(_ completion: ([String: String]?) -> Void) { completion(nil) }
    func authenticated() {}
    func close() {}
}
final class StreamClient {
    struct SavedMac { let fingerprintData: Data; let revoked: Bool?; let newKey: Bool?; let name: String }
    var savedMacs: [SavedMac] = []
    var t3ManagedSession = false
    var t3ReceiptConnection: NWConnection?
    var hostName = ""
    let queue = DispatchQueue(label: "test")
    enum RemoteRoute { case internet }
    enum Route { case remote(RemoteRoute) }
    struct Session { let route: Route; let macID: String; let bonjourName: String? }
    func t3Disconnect() { t3ManagedSession = false }
    func adopt(_ connection: NWConnection, session: Session) {}
}
enum DeviceTLS {
    static func home(identity: RemoteIdentity, alpn: String, pin: Data, peerToPeer: Bool,
                     queue: DispatchQueue, onPinRefused: () -> Void) -> NWParameters { .tcp }
}
enum RemoteTLS { static let sessionALPN = "sill/1" }
enum MacID { static func make(fingerprint: Data) -> String { "test" } }
