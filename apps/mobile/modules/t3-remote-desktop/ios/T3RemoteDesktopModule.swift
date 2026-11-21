import AVFoundation
import ExpoModulesCore
import LiveKitWebRTC
import SwiftUI
import UIKit
import Combine

private enum T3Acceptance {
    static let enabled = ProcessInfo.processInfo.arguments.contains("--t3-acceptance") || ProcessInfo.processInfo.arguments.contains("--t3-cellular-only")
}

public final class T3RemoteDesktopModule: Module {
    private var botVoice: T3BotVoicePeer?

    private func closeBotVoice() {
        let previous = botVoice
        botVoice = nil
        previous?.close()
    }

    public func definition() -> ModuleDefinition {
        Name("T3RemoteDesktop")
        Constants(["acceptanceEnabled": T3Acceptance.enabled])
        Events("onBotVoiceState")
        AsyncFunction("createBotVoiceOffer") { (id: String, promise: Promise) in
            guard self.botVoice == nil, UUID(uuidString: id) != nil else {
                promise.reject(T3BotVoicePeer.failure("Another voice call is active."))
                return
            }
            do {
                let voice = try T3BotVoicePeer(identifier: id) { [weak self] state in
                    self?.sendEvent("onBotVoiceState", ["id": id, "state": state])
                }
                self.botVoice = voice
                voice.offer(promise)
            } catch { promise.reject(error) }
        }.runOnQueue(.main)
        AsyncFunction("acceptBotVoiceAnswer") { (id: String, answer: String, promise: Promise) in
            guard let voice = self.botVoice, voice.identifier == id else {
                promise.reject(T3BotVoicePeer.failure("The voice call has closed."))
                return
            }
            voice.accept(answer, promise: promise)
        }.runOnQueue(.main)
        AsyncFunction("setBotVoiceMuted") { (id: String, muted: Bool) in
            guard let voice = self.botVoice, voice.identifier == id else { return }
            voice.setMuted(muted)
        }.runOnQueue(.main)
        AsyncFunction("interruptBotVoice") { (id: String) in
            if let voice = self.botVoice, voice.identifier == id { voice.interrupt() }
        }.runOnQueue(.main)
        AsyncFunction("closeBotVoice") { (id: String) in
            if self.botVoice?.identifier == id { self.closeBotVoice() }
        }.runOnQueue(.main)
        OnDestroy { self.closeBotVoice() }

        AsyncFunction("getPickerPreview") { (fingerprint: String) -> String? in
            T3DesktopPickerPreviews.get(fingerprint)
        }
        View(T3RemoteDesktopView.self) {
            Events("onNativeState")
            Prop("appearance") { (view: T3RemoteDesktopView, value: String) in
                view.setAppearance(value)
            }
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
            AsyncFunction("refreshPickerPreview") { (view: T3RemoteDesktopView, promise: Promise) in
                view.refreshPickerPreview(promise)
            }
            AsyncFunction("recordAcceptanceEvent") { (view: T3RemoteDesktopView, json: String) in view.recordAcceptanceEvent(json) }
        }
    }
}

private enum T3DesktopPickerPreviews {
    private static let pictures: NSCache<NSString, NSString> = {
        let cache = NSCache<NSString, NSString>()
        cache.countLimit = 12
        cache.totalCostLimit = 1_048_576
        return cache
    }()

    static func get(_ fingerprint: String) -> String? {
        guard let pin = Base64URL.decode(fingerprint), pin.count == 32 else { return nil }
        return pictures.object(forKey: Base64URL.encode(pin) as NSString) as String?
    }

    static func capture(_ client: StreamClient, fingerprint: String, done: @escaping () -> Void) {
        guard UIApplication.shared.applicationState == .active, client.connected,
              let pin = Base64URL.decode(fingerprint), pin.count == 32 else { done(); return }
        client.t3PickerPicture { image in
            defer { done() }
            guard let image, let jpeg = UIImage(cgImage: image).jpegData(compressionQuality: 0.65),
                  jpeg.count <= 128 * 1024 else { return }
            let uri = "data:image/jpeg;base64," + jpeg.base64EncodedString()
            pictures.setObject(uri as NSString, forKey: Base64URL.encode(pin) as NSString, cost: uri.utf8.count * 2)
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

    func setAppearance(_ value: String) {
        guard value == "light" || value == "dark" else { return }
        overrideUserInterfaceStyle = value == "dark" ? .dark : .light
        controller?.overrideUserInterfaceStyle = overrideUserInterfaceStyle
    }

    func createNativeOffer(_ fingerprint: String, connectivity: T3IceConfiguration? = nil, promise: Promise) {
        closeNativeSession()
        client.t3Disconnect()
        do {
            let session = try T3NativeSession(client: client, fingerprint: fingerprint, connectivity: connectivity)
            self.session = session
            session.onPickerPreview = { [weak self] done in
                guard let self else { done(); return }
                T3DesktopPickerPreviews.capture(self.client, fingerprint: fingerprint, done: done)
            }
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
        guard let session else { promise.reject(T3NativeSession.failure("Connect to the computer first.")); return }
        session.restart(config, promise: promise)
    }
    func closeNativeSession() {
        let previous = session
        session = nil
        previous?.close()
    }

    func refreshPickerPreview(_ promise: Promise) {
        guard let session else { promise.resolve(nil); return }
        session.capturePickerPreview { promise.resolve(nil) }
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
        client.t3StopRequested = { [weak self] in
            guard let self else { return }
            self.closeNativeSession()
            self.onNativeState(["state":"stopRequested"])
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
        child.overrideUserInterfaceStyle = overrideUserInterfaceStyle
        child.view.backgroundColor = .clear
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
        ContentView(client: client, usesEnvironmentConnections: true).readsDuoPosture()
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

/// An audio-only peer for the OpenBot Codex live-voice offer. It shares the shipped WebRTC binary.
private final class T3BotVoicePeer: NSObject, LKRTCDataChannelDelegate {
    private static let factory: LKRTCPeerConnectionFactory = {
        _ = LKRTCInitializeSSL()
        return LKRTCPeerConnectionFactory()
    }()

    let identifier: String
    private let peer: NativePeer
    private var microphone: LKRTCAudioTrack?
    private var events: LKRTCDataChannel?
    private var offering: Promise?
    private var answering: Promise?
    private let onState: (String) -> Void
    private let previousAudio: (AVAudioSession.Category, AVAudioSession.Mode, AVAudioSession.CategoryOptions)
    private var closed = false
    private var currentReply: String?
    private var silencedReply: String?
    private var silenceNextReply = false

    init(identifier: String, onState: @escaping (String) -> Void) throws {
        self.identifier = identifier
        self.onState = onState
        let session = AVAudioSession.sharedInstance()
        previousAudio = (session.category, session.mode, session.categoryOptions)
        peer = NativePeer(factory: Self.factory, queue: .main)
        super.init()
        guard let connection = peer.connection else { throw Self.failure("Could not create the audio connection.") }

        let constraints = LKRTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)
        let audio = Self.factory.audioSource(with: constraints)
        let track = Self.factory.audioTrack(with: audio, trackId: "sled-live-voice")
        let config = LKRTCDataChannelConfiguration()
        config.isOrdered = true
        guard connection.add(track, streamIds: ["sled-live-voice"]) != nil,
              let channel = connection.dataChannel(forLabel: "oai-events", configuration: config) else {
            peer.close()
            throw Self.failure("Could not add the microphone to the call.")
        }
        microphone = track
        events = channel
        channel.delegate = self

        do {
            try session.setCategory(.playAndRecord, mode: .voiceChat, options: [.defaultToSpeaker, .allowBluetoothHFP])
            try session.setActive(true)
        } catch {
            close()
            throw Self.failure("Could not start a phone audio session.")
        }

        peer.onFailure = { [weak self] _ in self?.fail() }
        peer.onConnectionLost = { [weak self] in self?.onState("reconnecting") }
        peer.onConnectionRestored = { [weak self] in self?.onState("connected") }
    }

    func offer(_ promise: Promise) {
        guard !closed, offering == nil else {
            promise.reject(Self.failure("The audio connection is busy."))
            return
        }
        offering = promise
        peer.offer { [weak self] description in
            guard let self, let promise = self.offering else { return }
            self.offering = nil
            promise.resolve(description.sdp)
        }
    }

    func accept(_ answer: String, promise: Promise) {
        guard !closed, answering == nil, !answer.isEmpty, answer.utf8.count <= 65_536 else {
            promise.reject(Self.failure("The voice answer is invalid."))
            return
        }
        answering = promise
        peer.accept(LKRTCSessionDescription(type: .answer, sdp: answer)) { [weak self] in
            guard let self, let promise = self.answering else { return }
            self.answering = nil
            promise.resolve(nil)
        }
    }

    func setMuted(_ muted: Bool) {
        microphone?.isEnabled = !muted
    }

    func close() {
        guard !closed else { return }
        closed = true
        microphone?.isEnabled = false
        events?.delegate = nil
        events?.close()
        events = nil
        microphone = nil
        if peer.connection != nil { peer.close() }
        let error = Self.failure("The audio connection closed.")
        offering?.reject(error)
        answering?.reject(error)
        offering = nil
        answering = nil
        let session = AVAudioSession.sharedInstance()
        if session.category == .playAndRecord && session.mode == .voiceChat {
            try? session.setActive(false, options: .notifyOthersOnDeactivation)
            try? session.setCategory(previousAudio.0, mode: previousAudio.1, options: previousAudio.2)
        }
    }

    func interrupt() {
        if let currentReply { silencedReply = currentReply }
        else { silenceNextReply = true }
        setReplyAudible(false)
    }

    private func setReplyAudible(_ audible: Bool) {
        for receiver in peer.connection.receivers {
            (receiver.track as? LKRTCAudioTrack)?.isEnabled = audible
        }
    }

    func dataChannelDidChangeState(_ dataChannel: LKRTCDataChannel) {}

    func dataChannel(_ dataChannel: LKRTCDataChannel, didReceiveMessageWith buffer: LKRTCDataBuffer) {
        guard !buffer.isBinary, buffer.data.count <= 262_144,
              let event = try? JSONSerialization.jsonObject(with: buffer.data) as? [String: Any],
              let type = event["type"] as? String, type == "turn.created" || type == "turn.done",
              let turn = event["turn"] as? [String: Any], let id = turn["id"] as? String, id.count <= 512,
              let role = turn["role"] as? String else { return }
        DispatchQueue.main.async { [weak self] in
            self?.turnEvent(role: role, id: id, done: type == "turn.done")
        }
    }

    private func turnEvent(role: String, id: String, done: Bool) {
        guard !closed else { return }
        if role == "user" {
            if !done {
                silenceNextReply = false
                if silencedReply == nil { setReplyAudible(true) }
            }
            onState(done ? "thinking" : "listening")
        } else if role == "assistant" {
            if done {
                if currentReply == id { currentReply = nil }
                if silencedReply == id {
                    silencedReply = nil
                    setReplyAudible(true)
                }
                onState("listening")
            } else {
                currentReply = id
                if silenceNextReply {
                    silenceNextReply = false
                    silencedReply = id
                    setReplyAudible(false)
                } else { onState("speaking") }
            }
        }
    }

    private func fail() {
        guard !closed else { return }
        close()
        onState("failed")
    }

    static func failure(_ message: String) -> NSError {
        NSError(domain: "SledBotLiveVoice", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
    }

    deinit { close() }
}
