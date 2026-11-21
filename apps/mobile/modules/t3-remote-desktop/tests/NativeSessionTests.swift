import Foundation
import Testing
import ExpoModulesCore
@testable import NativeSession

@Test func authenticatedSledSessionDoesNotRequireLegacyPairing() throws {
    DeviceIdentity.identity = nil
    defer { DeviceIdentity.identity = nil }
    let client = StreamClient()
    let hostPin = Base64URL.encode(Data(repeating: 3, count: 32))
    let session = try T3NativeSession(client: client, fingerprint: hostPin)
    defer { session.close() }
    #expect(client.savedMacs.isEmpty)
    #expect(client.t3ManagedSession)
    #expect(DeviceIdentity.existing() != nil)
    let malformed = ["", hostPin + "=", Base64URL.encode(Data(repeating: 1, count: 31))]
    for pin in malformed {
        #expect(throws: (any Error).self) { try T3NativeSession(client: client, fingerprint: pin) }
    }
    let answer = "{\"clientNonce\":\"wrong-request\",\"hostFingerprint\":\"\(hostPin)\",\"sessionId\":\"\(UUID())\",\"answer\":\"sdp\"}"
    #expect(throws: (any Error).self) { try session.accept(answer, promise: Promise()) }
}
