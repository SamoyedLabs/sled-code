public func LKRTCInitializeSSL() -> Bool { true }
public final class LKRTCPeerConnectionFactoryOptions {
    public init() {}
    public var ignoreWiFiNetworkAdapter = false
    public var ignoreEthernetNetworkAdapter = false
    public var ignoreVPNNetworkAdapter = false
    public var ignoreLoopbackNetworkAdapter = false
}
public final class LKRTCPeerConnectionFactory {
    public init() {}
    public func setOptions(_ options: LKRTCPeerConnectionFactoryOptions) {}
}
public struct LKRTCIceServer {}
