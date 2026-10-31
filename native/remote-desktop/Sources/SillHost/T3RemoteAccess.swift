import Foundation

// Small package-only adapter; trust storage and live revocation stay in Sill.
extension RemoteAccess {
    package func t3ForgetDevices() -> String? {
        for device in paired {
            if let error = remove(fingerprint: device.fingerprint) { return error }
        }
        return nil
    }
}
