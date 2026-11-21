import SwiftUI
import UIKit
import AVFoundation

final class WindowsPointer {
    private(set) var position = CGPoint(x: 0.5, y: 0.5)
    private(set) var feed = PointerFeedState()
    private var gate = WindowsCursorGate()
    private(set) var reports = false
    private var hostVisible = false
    private var embedded = false
    var reseeds: Int { feed.reseeds }
    var visible: Bool { !reports || !embedded && hostVisible }
    var changed: (() -> Void)?
    weak var surface: WindowsSurfaceView?

    func update(_ value: CGPoint) {
        position = PadCursor.clamped(value)
        _ = feed.sent(.pointer(position), now: ProcessInfo.processInfo.systemUptime)
        changed?()
    }
    func queuedInput() -> UInt64 { gate.queuedInput() }
    func sent(sequence: UInt64, revision: UInt64, geometry: WindowsGeometry) {
        gate.sent(sequence: sequence, revision: revision, geometry: geometry)
    }
    func bind(_ geometry: WindowsGeometry?, sequence: UInt64 = 0, reports: Bool) {
        gate.bind(geometry, sequence: sequence)
        self.reports = reports; hostVisible = false; embedded = false
        feed.reset(); position = CGPoint(x: 0.5, y: 0.5); changed?()
    }
    func reset() { bind(nil, reports: false) }
    func accept(_ report: WindowsCursorReport) -> Bool {
        guard gate.accepts(report) else { return false }
        embedded = report.embedded; hostVisible = report.visible
        let point = CGPoint(x: report.x, y: report.y)
        let restatement = feed.control == .here && gate.restates(report, x: Double(position.x), y: Double(position.y))
        if !restatement {
            // WindowsCursorGate supplies freshness; the shared feed handles ownership and reseeding.
            _ = feed.report(at: report.inside ? point : nil, seen: 0, sentOnSession: 0,
                            movePending: false, now: ProcessInfo.processInfo.systemUptime)
            if report.inside { position = point }
        }
        changed?()
        return true
    }
}

struct WindowsStreamSurface: UIViewRepresentable {
    let client: StreamClient
    let geometry: WindowsGeometry?
    let fitToken: Int
    let followCursor: Bool
    let keyboard: InputOverlayProxy
    @Binding var keyboardShown: Bool
    let pointer: WindowsPointer
    let latched: KeyModifiers
    let consumed: () -> Void

    static func dismantleUIView(_ view: WindowsSurfaceView, coordinator: ()) {
        view.input.prepareForSourceChange()
        _ = view.input.resignFirstResponder()
        view.detach()
    }

    func makeUIView(context: Context) -> WindowsSurfaceView {
        WindowsSurfaceView(client: client, keyboard: keyboard, pointer: pointer)
    }
    func updateUIView(_ view: WindowsSurfaceView, context: Context) {
        view.input.videoSize = geometry.map { CGSize(width: $0.encodedWidth, height: $0.encodedHeight) } ?? .zero
        view.setFollowing(followCursor)
        if view.geometry != geometry {
            view.input.prepareForSourceChange()
            view.geometry = geometry
            view.fit()
        }
        let session = client.viewerInputSession
        view.input.send = { [weak view] event in
            view?.sendPictureInput(event, captured: session)
        }
        view.input.isUserInteractionEnabled = client.windowsInputReady
        view.setCursorVisible(session.inputReady)
        view.input.latchedModifiers = latched
        view.input.onModifiersConsumed = consumed
        keyboard.onOwnChange = { shown in DispatchQueue.main.async { keyboardShown = shown } }
        if view.fitToken != fitToken { view.fitToken = fitToken; view.fit() }
        view.setNeedsLayout()
    }
}

final class WindowsSurfaceView: UIView, UIGestureRecognizerDelegate {
    let input = InputOverlayView(frame: .zero)
    var fitToken = 0
    var geometry: WindowsGeometry?
    private let client: StreamClient
    private let pointer: WindowsPointer
    private var transformState = WindowsLocalTransform()
    private var start = WindowsLocalTransform()
    private let picture = UIView()
    private let cursor = CAShapeLayer()
    private var cursorEnabled = false
    private var following = false
    private var needsFill = false
    private var exploring = false
    private var handlingPictureInput = false
    private var lastPointer = CGPoint(x: 0.5, y: 0.5)
    private var lastSize = CGSize.zero
    private let overview = CAShapeLayer()
    private let overviewViewport = CAShapeLayer()
    private let overviewCursor = CAShapeLayer()

    init(client: StreamClient, keyboard: InputOverlayProxy, pointer: WindowsPointer) {
        self.client = client; self.pointer = pointer
        super.init(frame: .zero)
        clipsToBounds = true
        addSubview(picture)
        picture.layer.addSublayer(client.windowsVideo.layer)
        cursor.path = UIBezierPath(ovalIn: CGRect(x: -4, y: -4, width: 8, height: 8)).cgPath
        cursor.fillColor = UIColor.white.cgColor; cursor.strokeColor = UIColor.black.cgColor; cursor.lineWidth = 1.5
        picture.layer.addSublayer(cursor)
        picture.addSubview(input)
        input.keyboardProxy = keyboard; keyboard.view = input
        input.setOwnPointer = { [weak pointer] point, _ in if let point { pointer?.update(point) } }
        pointer.surface = self
        pointer.changed = { [weak self] in self?.pointerChanged() }
        client.onCursorShapeChange = { [weak self] _ in self?.placeCursor() }
        overview.fillColor = UIColor.black.withAlphaComponent(0.7).cgColor
        overview.strokeColor = UIColor.white.withAlphaComponent(0.5).cgColor
        overview.lineWidth = 1
        overviewViewport.fillColor = UIColor.white.withAlphaComponent(0.2).cgColor
        overviewViewport.strokeColor = UIColor.white.cgColor
        overviewViewport.lineWidth = 1
        overviewCursor.fillColor = UIColor.white.cgColor
        overviewCursor.strokeColor = UIColor.black.cgColor
        overviewCursor.lineWidth = 1
        overview.addSublayer(overviewViewport); overview.addSublayer(overviewCursor)
        layer.addSublayer(overview)
        let pinch = UIPinchGestureRecognizer(target: self, action: #selector(pinch(_:)))
        let pan = UIPanGestureRecognizer(target: self, action: #selector(pan(_:)))
        pan.minimumNumberOfTouches = 2; pan.maximumNumberOfTouches = 2; pan.delegate = self
        for child in input.gestureRecognizers ?? [] where child is UIPanGestureRecognizer { child.require(toFail: pan) }
        addGestureRecognizer(pinch); addGestureRecognizer(pan)
        accessibilityLabel = "Remote monitor. Tap to click, hold for right click. Pinch to zoom, two fingers to pan when zoomed."
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    override func layoutSubviews() {
        super.layoutSubviews()
        if lastSize != bounds.size { lastSize = bounds.size; needsFill = following }
        place()
    }
    func setCursorVisible(_ visible: Bool) { cursorEnabled = visible; placeCursor() }
    func setFollowing(_ enabled: Bool) {
        guard following != enabled else { return }
        following = enabled; needsFill = enabled
        accessibilityValue = enabled ? "Following cursor" : "Manual view"
    }
    func sendPictureInput(_ event: InputEvent, captured: ViewerSession) {
        guard geometry != nil else { return }
        // Direct touches must keep the same inverse transform through move, down and up.
        handlingPictureInput = true
        defer { handlingPictureInput = false }
        client.sendViewerInput(event, captured: captured)
    }
    func detach() {
        if pointer.surface === self { pointer.changed = nil; pointer.surface = nil }
        if client.windowsVideo.layer.superlayer === picture.layer { client.windowsVideo.layer.removeFromSuperlayer() }
    }
    func fit() { transformState = WindowsLocalTransform(); needsFill = following; place() }
    private func pointerChanged() {
        let moved = pointer.position != lastPointer
        lastPointer = pointer.position
        if moved, following, cursorEnabled, !exploring, !handlingPictureInput {
            transformState.follow(x: pointer.position.x, y: pointer.position.y, width: bounds.width, height: bounds.height,
                                  imageWidth: input.videoSize.width, imageHeight: input.videoSize.height)
            place()
        } else { placeCursor() }
    }
    private func place() {
        let size = input.videoSize
        guard size.width > 0, size.height > 0, bounds.width > 0, bounds.height > 0 else { return }
        if needsFill {
            transformState.fill(width: bounds.width, height: bounds.height, imageWidth: size.width, imageHeight: size.height,
                                x: pointer.position.x, y: pointer.position.y)
            needsFill = false
        }
        transformState.constrain(width: bounds.width, height: bounds.height, imageWidth: size.width, imageHeight: size.height)
        guard let frame = transformState.frame(width: bounds.width, height: bounds.height, imageWidth: size.width, imageHeight: size.height) else { return }
        CATransaction.begin(); CATransaction.setDisableActions(true)
        picture.frame = CGRect(x: bounds.minX + frame.x, y: bounds.minY + frame.y, width: frame.width, height: frame.height)
        if client.windowsVideo.layer.superlayer === picture.layer { client.windowsVideo.layer.frame = picture.bounds }
        input.frame = picture.bounds
        CATransaction.commit(); placeCursor()
    }
    private func placeCursor() {
        CATransaction.begin(); CATransaction.setDisableActions(true)
        if pointer.reports {
            let scale = geometry.map { CGSize(width: picture.bounds.width / $0.sourceRect.width,
                                               height: picture.bounds.height / $0.sourceRect.height) } ?? CGSize(width: 1, height: 1)
            HEVCDisplayView.configureCursor(cursor, shape: client.cursorShape, scale: scale)
        } else {
            cursor.contents = nil
            cursor.path = UIBezierPath(ovalIn: CGRect(x: -4, y: -4, width: 8, height: 8)).cgPath
            cursor.bounds = .zero; cursor.anchorPoint = .zero
        }
        cursor.position = CGPoint(x: pointer.position.x * picture.bounds.width, y: pointer.position.y * picture.bounds.height)
        cursor.isHidden = !cursorEnabled || !pointer.visible
        placeOverview()
        CATransaction.commit()
    }
    private func placeOverview() {
        overview.isHidden = transformState.zoom <= 1.001 || !cursorEnabled
        guard !overview.isHidden, let visible = transformState.visibleRect(width: bounds.width, height: bounds.height,
            imageWidth: input.videoSize.width, imageHeight: input.videoSize.height) else { return }
        let width = min(100, bounds.width * 0.28), height = width * input.videoSize.height / input.videoSize.width
        overview.frame = CGRect(x: bounds.maxX - width - 12, y: bounds.maxY - height - 12, width: width, height: height)
        overview.path = UIBezierPath(rect: overview.bounds).cgPath
        overviewViewport.path = UIBezierPath(rect: CGRect(x: visible.x * width, y: visible.y * height,
            width: visible.width * width, height: visible.height * height)).cgPath
        overviewCursor.path = UIBezierPath(ovalIn: CGRect(x: pointer.position.x * width - 2,
            y: pointer.position.y * height - 2, width: 4, height: 4)).cgPath
        overviewCursor.isHidden = !pointer.visible
    }
    override func gestureRecognizerShouldBegin(_ gesture: UIGestureRecognizer) -> Bool {
        !(gesture is UIPanGestureRecognizer) || transformState.zoom > 1
    }
    @objc private func pinch(_ gesture: UIPinchGestureRecognizer) {
        exploring = gesture.state == .began || gesture.state == .changed
        if gesture.state == .began { start = transformState }
        transformState.zoom = min(8, max(1, start.zoom * gesture.scale)); place()
        if !exploring, !following { client.windowsViewMode = transformState.zoom > 1.001 ? .manual : .fit }
    }
    @objc private func pan(_ gesture: UIPanGestureRecognizer) {
        exploring = gesture.state == .began || gesture.state == .changed
        if gesture.state == .began { start = transformState }
        let delta = gesture.translation(in: self)
        transformState.panX = start.panX + delta.x; transformState.panY = start.panY + delta.y; place()
        if !exploring, !following { client.windowsViewMode = transformState.zoom > 1.001 ? .manual : .fit }
    }
}
