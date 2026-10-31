import ExpoModulesCore
import SwiftUI
import UIKit
import Combine

private enum T3Acceptance {
    static let enabled = ProcessInfo.processInfo.arguments.contains("--t3-acceptance") || ProcessInfo.processInfo.arguments.contains("--t3-cellular-only")
}

public final class T3RemoteDesktopModule: Module {
    public func definition() -> ModuleDefinition {
        Name("T3RemoteDesktop")
        Constants(["acceptanceEnabled": T3Acceptance.enabled])
        View(T3RemoteDesktopView.self) {
            Events("onNativeState")
            AsyncFunction("createNativeOffer") { (view: T3RemoteDesktopView, fingerprint: String, promise: Promise) in
                view.createNativeOffer(fingerprint, promise: promise)
            }
            AsyncFunction("createConfiguredNativeOffer") { (view: T3RemoteDesktopView, fingerprint: String, json: String, promise: Promise) in
                guard json.utf8.count <= 16 * 1024,
                      let config = try? JSONDecoder().decode(T3IceConfiguration.self, from: Data(json.utf8)) else {
                    promise.reject(T3NativeSession.failure("The remote connection configuration was invalid.")); return
                }
                view.createNativeOffer(fingerprint, connectivity: config, promise: promise)
            }
            AsyncFunction("acceptNativeAnswer") { (view: T3RemoteDesktopView, json: String, promise: Promise) in
                do { try view.acceptNativeAnswer(json, promise: promise) }
                catch { promise.reject(error) }
            }
            AsyncFunction("createNativeRestartOffer") { (view: T3RemoteDesktopView, json: String, promise: Promise) in
                guard json.utf8.count <= 16 * 1024,
                      let config = try? JSONDecoder().decode(T3IceConfiguration.self, from: Data(json.utf8)) else {
                    promise.reject(T3NativeSession.failure("The remote renewal configuration was invalid.")); return
                }
                view.createNativeRestartOffer(config, promise: promise)
            }
            AsyncFunction("closeNativeSession") { (view: T3RemoteDesktopView) in view.closeNativeSession() }
            AsyncFunction("recordAcceptanceEvent") { (view: T3RemoteDesktopView, json: String) in view.recordAcceptanceEvent(json) }
        }
    }
}

final class T3RemoteDesktopView: ExpoView {
    private var controller: T3RemoteHostingController?
    private let client = StreamClient()
    private var session: T3NativeSession?
    private var connectionObservation: AnyCancellable?
    private var backgroundObservation: AnyCancellable?
    private var measurementObservation: AnyCancellable?
    private var observedPath: [String: String] = [:]
    private var unhealthySeconds = 0
    private var requestedRelayRecovery = false
    private var relayRecoveryRequests = 0
    private var measurementHistory: [[String: Any]] = [] // measurementQueue only; bounded opt-in history
    private var measurementCount = 0
    private var acceptanceEvents: [[String: Any]] = [] // measurementQueue only
    private let measurementQueue = DispatchQueue(label: "com.t3tools.remote-desktop.acceptance")
    let onNativeState = EventDispatcher()

    func createNativeOffer(_ fingerprint: String, connectivity: T3IceConfiguration? = nil, promise: Promise) {
        closeNativeSession()
        client.t3Disconnect()
        do {
            let session = try T3NativeSession(client: client, fingerprint: fingerprint, connectivity: connectivity)
            self.session = session
            observedPath.removeAll()
            unhealthySeconds = 0
            requestedRelayRecovery = false
            session.onClose = { [weak self, weak session] in
                guard let self, self.session === session else { return }
                self.session = nil
                self.onNativeState(["state":"closed"])
            }
            session.onPath = { [weak self, weak session] path in
                guard let self, self.session === session else { return }
                self.observedPath = path
                self.unhealthySeconds = 0
                self.requestedRelayRecovery = false
                let relayed = path["localCandidateType"] == "relay" || path["remoteCandidateType"] == "relay"
                self.onNativeState(["state":"path", "path":relayed ? "relayed" : "direct",
                    "relayProtocol":path["localRelayProtocol"] ?? path["remoteRelayProtocol"] ?? ""])
            }
            session.onConnectionLost = { [weak self, weak session] in
                guard let self, self.session === session else { return }
                self.onNativeState(["state":"needsRestart"])
            }
            session.onConnectionRestored = { [weak self, weak session] in
                guard let self, self.session === session else { return }
                self.onNativeState(["state":"recovered"])
            }
            session.offer(promise)
        } catch { promise.reject(error) }
    }
    func acceptNativeAnswer(_ json: String, promise: Promise) throws {
        guard let session else { throw T3NativeSession.failure("Start a remote desktop connection first.") }
        try session.accept(json, promise: promise)
    }
    func createNativeRestartOffer(_ config: T3IceConfiguration, promise: Promise) {
        guard let session else { promise.reject(T3NativeSession.failure("Connect to the Mac first.")); return }
        session.restart(config, promise: promise)
    }
    func closeNativeSession() {
        let previous = session
        session = nil
        previous?.close()
    }

    required init(appContext: AppContext? = nil) {
        super.init(appContext: appContext)
        clipsToBounds = true
        let recordsMeasurements = T3Acceptance.enabled
        if recordsMeasurements { UIDevice.current.isBatteryMonitoringEnabled = true }
        measurementObservation = client.$linkStats.sink { [weak self] stats in
            guard let self else { return }
            self.checkPathHealth(stats)
            if recordsMeasurements { self.recordMeasurement(stats) }
        }
        client.t3PathChanged = { [weak self] available in
            self?.onNativeState(["state":"network", "available":available])
        }
        connectionObservation = client.$connected.removeDuplicates().sink { [weak self] connected in
            guard let self else { return }
            if recordsMeasurements {
                DispatchQueue.main.async { [weak self] in self?.recordMeasurement(nil) }
            }
            guard let session = self.session else { return }
            if connected { session.hasConnected = true }
            self.onNativeState(["state":connected ? "connected" : "connecting"])
            if !connected, session.hasConnected {
                // StreamClient publishes during its own teardown. End the
                // leased transport after that mutation finishes, not reentrantly.
                DispatchQueue.main.async { [weak self, weak session] in
                    guard let self, self.session === session, !self.client.connected else { return }
                    self.closeNativeSession()
                    self.onNativeState(["state":"closed"])
                }
            }
        }
        backgroundObservation = NotificationCenter.default.publisher(for: UIApplication.didEnterBackgroundNotification)
            .sink { [weak self] _ in self?.closeNativeSession() }
    }

    private func checkPathHealth(_ stats: StreamClient.LinkStats?) {
        guard let stats, client.connected, session?.hasConnected == true,
              !observedPath.isEmpty,
              observedPath["localCandidateType"] != "relay",
              observedPath["remoteCandidateType"] != "relay",
              !requestedRelayRecovery else { unhealthySeconds = 0; return }
        // A still desktop may send no frames. Judge the quarter-second heartbeat instead.
        unhealthySeconds = stats.rtt.map { $0.median <= 1_500 } == true ? 0 : unhealthySeconds + 1
        if unhealthySeconds >= 5 {
            requestedRelayRecovery = true
            relayRecoveryRequests += 1
            onNativeState(["state":"degraded"])
        }
    }

    func recordAcceptanceEvent(_ json: String) {
        guard T3Acceptance.enabled, json.utf8.count <= 2_048,
              let data = json.data(using: .utf8),
              let input = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
        var event: [String: Any] = ["recordedAt": ISO8601DateFormatter().string(from: Date()),
                                  "applicationState": UIApplication.shared.applicationState.rawValue]
        for key in ["kind", "phase", "tag", "reason", "requiredScope", "connectionState"] {
            if let value = input[key] as? String, value.count <= 100 { event[key] = value }
        }
        let snapshot = event
        measurementQueue.async { [weak self] in
            guard let self else { return }
            self.acceptanceEvents.append(snapshot)
            if self.acceptanceEvents.count > 200 { self.acceptanceEvents.removeFirst() }
            guard let directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first,
                  let data = try? JSONSerialization.data(withJSONObject: self.acceptanceEvents, options: [.sortedKeys]) else { return }
            try? data.write(to: directory.appendingPathComponent("T3RemoteAcceptanceEvents.json"), options: .atomic)
        }
    }

    // Opt-in device acceptance records contain no clipboard contents, addresses, SDP or credentials.
    private func recordMeasurement(_ stats: StreamClient.LinkStats?) {
        var report: [String: Any] = [
            "recordedAt": ISO8601DateFormatter().string(from: Date()),
            "processID": ProcessInfo.processInfo.processIdentifier,
            "cellularOnlyRequested": ProcessInfo.processInfo.arguments.contains("--t3-cellular-only"),
            "connected": client.connected,
            "relayRecoveryRequests": relayRecoveryRequests,
            "path": observedPath,
            "videoWidth": Int(client.videoSize.width),
            "videoHeight": Int(client.videoSize.height),
            "audioAvailable": client.macHasSound,
            "audioMuted": client.soundMuted,
            "hostClipboardAvailable": ClipboardPolicy.hostTakes(client.hostClipboard),
            "appForeground": UIApplication.shared.applicationState != .background,
            "applicationState": UIApplication.shared.applicationState.rawValue,
            "idleTimerDisabled": UIApplication.shared.isIdleTimerDisabled,
            "thermalState": ProcessInfo.processInfo.thermalState.rawValue,
            "lowPowerMode": ProcessInfo.processInfo.isLowPowerModeEnabled,
            "batteryLevel": UIDevice.current.batteryLevel,
            "batteryState": UIDevice.current.batteryState.rawValue,
        ]
        if let stats {
            report["receivedFPS"] = stats.fps
            report["roundTripMs"] = stats.rtt?.median
            report["encodeOutputToReceiveAgeMs"] = stats.frameAge?.median
            report["audioBehindMs"] = stats.soundBehindMs
            report["audioLatePackets"] = stats.soundLate
        }
        let snapshot = report
        let queue = measurementQueue
        let session = self.session
        client.sound.t3InspectAudio { audio in
            let save: ([String: String]?) -> Void = { [weak self] transport in
                queue.async { [weak self] in
                guard let self else { return }
                var report = snapshot
                for (key, value) in audio { report[key] = value }
                if let transport { report["transport"] = transport }
                guard let data = try? JSONSerialization.data(withJSONObject: report, options: [.sortedKeys]),
                      let directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else { return }
                do {
                    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
                    try data.write(to: directory.appendingPathComponent("T3RemoteAcceptance.json"), options: .atomic)
                    self.measurementCount += 1
                    self.measurementHistory.append(report)
                    if self.measurementHistory.count > 120 { self.measurementHistory.removeFirst() }
                    if self.measurementCount % 5 == 0 || !(report["connected"] as? Bool ?? false) {
                        let history = try JSONSerialization.data(withJSONObject: self.measurementHistory, options: [.sortedKeys])
                        try history.write(to: directory.appendingPathComponent("T3RemoteAcceptanceHistory.json"), options: .atomic)
                    }
                } catch { /* A failed diagnostic write must not interrupt the user's session. */ }
                }
            }
            if let session { session.inspectTransport(save) } else { save(nil) }
        }
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        guard window != nil else {
            closeNativeSession()
            controller?.willMove(toParent: nil)
            controller?.view.removeFromSuperview()
            controller?.removeFromParent()
            controller = nil
            return
        }
        guard controller == nil else { return }
        var ancestor: UIResponder? = self
        while let responder = ancestor, !(responder is UIViewController) {
            ancestor = responder.next
        }
        guard let parent = ancestor as? UIViewController else { return }
        let child = T3RemoteHostingController(rootView: T3RemoteRootView(client: client))
        parent.addChild(child)
        addSubview(child.view)
        child.view.frame = bounds
        child.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        child.didMove(toParent: parent)
        controller = child
    }
}

private struct T3RemoteRootView: View {
    let client: StreamClient
    @State private var scenePhase: ScenePhase = .active
    var body: some View {
        // Expo owns the scene; its nested hosting controller has no SwiftUI App lifecycle.
        ContentView(client: client).readsDuoPosture()
            .environment(\.scenePhase, scenePhase)
            .onAppear {
                scenePhase = UIApplication.shared.applicationState == .background ? .background : .active
            }
            .onReceive(NotificationCenter.default.publisher(for: UIApplication.didEnterBackgroundNotification)) { _ in
                scenePhase = .background
            }
            .onReceive(NotificationCenter.default.publisher(for: UIApplication.willEnterForegroundNotification)) { _ in
                scenePhase = .active
            }
    }
}

private final class T3RemoteHostingController: UIHostingController<T3RemoteRootView> {
    override func buildMenu(with builder: UIMenuBuilder) {
        super.buildMenu(with: builder)
        // Keep the native Mac app menus in the iPad responder chain without
        // replacing T3's application delegate or intercepting its other screens.
        guard builder.system == .main, MacMenuHub.hasMenuBar else { return }
        if #available(iOS 26.0, *) { MacMenuBar.build(builder) }
    }
}
