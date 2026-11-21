import Foundation
import CoreGraphics

extension StreamClient {
    var viewerHost: ViewerHost { windowsCapabilities == nil ? .mac : .windows }
    var viewerCapabilities: ViewerCapabilities { viewerInputSession.capabilities }
    var viewerName: String { macName.isEmpty ? (viewerHost == .mac ? "Mac" : "Windows PC") : macName }
    var windowsViewAction: String { windowsViewMode == .fit ? "Follow" : "Fit" }
    var windowsViewActionSymbol: String { windowsViewMode == .fit ? "viewfinder" : "arrow.down.right.and.arrow.up.left" }
    var windowsViewActionLabel: String { windowsViewMode == .fit ? "Follow the cursor" : "Fit the monitor locally" }

    func toggleWindowsView() {
        if windowsViewMode == .fit { windowsViewMode = .follow }
        else { performViewerCommand(.fit) }
    }

    var viewerInputSession: ViewerSession {
        if viewerHost == .windows {
            return ViewerSession(host: .windows, name: viewerName,
                                 selected: windowsSelectedOutputID.map(ViewerSourceID.monitor),
                                 inputReady: windowsInputReady, geometry: windowsGeometry, connectionID: connectedAt,
                                 cursorReports: windowsCapabilities?.cursor == 1,
                                 streamSettings: windowsCapabilities?.streamSettings?.valid == true,
                                 textClipboard: windowsCapabilities?.clipboard == 1,
                                 audioStream: windowsCapabilities?.audio == 1,
                                 standaloneWinTap: windowsCapabilities?.standaloneWinTap == 1)
        }
        let selected: ViewerSourceID?
        switch active {
        case .none: selected = nil
        case .desktop: selected = .desktop
        case .window(let id): selected = .window(id)
        }
        return ViewerSession(host: .mac, name: viewerName, selected: selected,
                             inputReady: connected, connectionID: connectedAt)
    }

    var viewerSession: ViewerSession {
        var session = viewerInputSession
        if let capabilities = windowsCapabilities {
            session.sources = capabilities.outputs.enumerated().map { index, output in
                ViewerSource(id: .monitor(output.id), title: "\(index + 1) \u{00B7} \(displayNames[output.id] ?? output.name)" + (output.primary == true ? " (Primary)" : ""), originalTitle: output.name)
            }
        } else {
            session.sources = [ViewerSource(id: .desktop, title: "Desktop")] + orderedWindows.map {
                ViewerSource(id: .window($0.id), title: $0.title)
            }
        }
        return session
    }

    var viewerDiagnostics: String {
        let size = videoSize == .zero ? "Waiting for picture" : "\(Int(videoSize.width)) \u{00D7} \(Int(videoSize.height))"
        let rate = linkStats.map { " \u{00B7} \($0.fps) received fps" } ?? ""
        return size + rate + (route.map { " \u{00B7} " + $0.word } ?? "")
    }

    func renameDisplay(_ id: String, on computer: String, to name: String) {
        guard self.session?.macID == computer, windowsCapabilities?.outputs.contains(where: { $0.id == id }) == true,
              displayNameStore.rename(id, on: computer, to: name) else { return }
        displayNames = displayNameStore.names(for: computer)
    }

    func performViewerCommand(_ command: ViewerCommand, captured: ViewerSession? = nil) {
        let current: ViewerSession
        switch command {
        case .select: current = viewerSession
        case .input, .windowsWinTap, .fit: current = viewerInputSession
        }
        guard let route = (captured ?? current).route(command, current: current) else { return }
        switch route {
        case .macSource(let source): select(source)
        case .macInput(let event): sendInput(event)
        case .windowsOutput(let id): selectWindowsOutput(id)
        case .windowsInput(let event, let geometry): sendWindowsInput(event, geometry: geometry)
        case .windowsWinTap(let geometry): sendWindowsWinTap(geometry: geometry)
        case .localFit: windowsViewMode = .fit; windowsFitToken += 1
        }
    }

    func sendViewerInput(_ event: InputEvent, captured: ViewerSession) {
        performViewerCommand(.input(event), captured: captured)
    }

    func sendViewerKey(_ event: InputEvent, captured: ViewerSession) {
        if captured.host == .mac {
            guard let route = captured.route(.input(event), current: viewerInputSession), case .macInput = route else { return }
            sendFromKeyRow(event)
        } else { sendViewerInput(event, captured: captured) }
    }

    func setViewerPointer(_ point: CGPoint?, from origin: PointerPresence.Origin) {
        if viewerHost == .windows {
            if let point { windowsPointer.update(point) }
        } else { setOwnPointer(point, from: origin) }
    }

    var viewerPointerFeed: (CGPoint?, Int) {
        if viewerHost == .windows { return (windowsPointer.position, windowsPointer.reseeds) }
        let feed = pointerFeedState
        return (feed.anchor, feed.reseeds)
    }
}
