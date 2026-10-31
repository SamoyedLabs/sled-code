import Foundation

extension StreamCoordinator {
    package var t3HomePort: UInt16? { server.port }

    // Preserve Sill's own status observer; it publishes native client settings.
    package func t3ObserveNetwork(_ callback: @escaping @MainActor (HostStatusSnapshot.Network) -> Void) {
        let previous = status.onChange
        status.onChange = { [weak self] in
            previous?()
            guard let self else { return }
            callback(self.status.snapshot.network)
        }
        callback(status.snapshot.network)
    }
}
