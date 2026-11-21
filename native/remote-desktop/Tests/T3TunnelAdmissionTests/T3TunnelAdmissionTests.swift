import Foundation
import StreamProtocol
import XCTest
@testable import SillHostCore

final class T3TunnelAdmissionTests: XCTestCase {
    func testLeaseAdmitsOnlyItsTLSKeyWhilePolicyAndDeadlineAllowIt() {
        let key = Data(repeating: 1, count: 32)
        let wrongKey = Data(repeating: 2, count: 32)
        let now = Date(timeIntervalSince1970: 100)
        let expiry = now.addingTimeInterval(30)
        var policy = TrustSnapshot(remoteAccess: true, internetAccess: true)
        let lease = T3TunnelAdmission.authenticatedLease(key)
        let paired = T3TunnelAdmission.paired(key)

        func accepts(_ admission: T3TunnelAdmission, key: Data?, alpn: String? = RemoteTLS.sessionALPN,
                     at time: Date? = nil) -> Bool {
            admission.accepts(key, alpn: alpn, in: policy, expiresAt: expiry, now: time ?? now)
        }

        XCTAssertTrue(accepts(lease, key: key))
        XCTAssertFalse(accepts(lease, key: wrongKey))
        XCTAssertFalse(accepts(lease, key: nil))
        XCTAssertFalse(accepts(lease, key: key, alpn: "wrong-protocol"))
        XCTAssertFalse(accepts(lease, key: key, at: expiry))
        XCTAssertFalse(accepts(paired, key: key))
        policy.paired[key] = "Paired iPad"
        XCTAssertTrue(accepts(paired, key: key))
        policy.paired.removeValue(forKey: key)
        XCTAssertFalse(accepts(paired, key: key))
        policy.internetAccess = false
        XCTAssertFalse(accepts(lease, key: key))
        policy.internetAccess = true
        policy.remoteAccess = false
        XCTAssertFalse(accepts(lease, key: key))
    }
}
