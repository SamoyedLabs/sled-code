import Foundation

enum ViewerHost: Equatable { case mac, windows }
enum ViewerRenderer: Equatable { case macHEVC, windowsHEVC }
enum WindowsViewMode { case fit, manual, follow }
enum ViewerCursor: Equatable { case hostReports, localFeedback }
enum ViewerSetting { case reverseScrolling, streaming }
enum ViewerSettingScope { case device, host }

struct ViewerInputEpoch: Hashable {
    let connectionID: Date?
    let outputID: String?
    let generation: String?
    let ready: Bool
}

enum ViewerSourceID: Hashable {
    case desktop
    case window(UInt32)
    case monitor(String)
}

struct ViewerSource: Identifiable, Equatable {
    let id: ViewerSourceID
    let title: String
    var originalTitle: String? = nil
}

struct ViewerCapabilities: Sendable {
    let apps: Bool
    let menus: Bool
    var hostSettings: Bool
    let windowTextScale: Bool
    var clipboard: Bool
    var audio: Bool
    let gestures: Bool
    let tour: Bool

    static let mac = Self(apps: true, menus: true, hostSettings: true, windowTextScale: true,
                          clipboard: true, audio: true, gestures: true, tour: true)
    static let windows = Self(apps: false, menus: false, hostSettings: false, windowTextScale: false,
                              clipboard: false, audio: false, gestures: false, tour: false)
}

enum ViewerCommand {
    case select(ViewerSourceID)
    case input(InputEvent)
    case windowsWinTap
    case fit
}

enum ViewerRoute: Equatable {
    case macSource(StreamSource)
    case macInput(InputEvent)
    case windowsOutput(String)
    case windowsInput(InputEvent, WindowsGeometry)
    case windowsWinTap(WindowsGeometry)
    case localFit
}

/// A value captured by an input surface cannot acquire authority for a later monitor generation.
struct ViewerSession {
    let host: ViewerHost
    let name: String
    var sources: [ViewerSource] = []
    var selected: ViewerSourceID?
    var inputReady: Bool
    var geometry: WindowsGeometry? = nil
    var connectionID: Date? = nil
    var renderer: ViewerRenderer { host == .mac ? .macHEVC : .windowsHEVC }
    var cursorReports = false
    var streamSettings = false
    var textClipboard = false
    var audioStream = false
    var standaloneWinTap = false
    var cursor: ViewerCursor { host == .mac || cursorReports ? .hostReports : .localFeedback }
    var capabilities: ViewerCapabilities {
        var result: ViewerCapabilities = host == .mac ? .mac : .windows
        if host == .windows { result.hostSettings = streamSettings; result.clipboard = textClipboard; result.audio = audioStream }
        return result
    }

    var inputEpoch: ViewerInputEpoch? {
        host == .windows ? ViewerInputEpoch(connectionID: connectionID, outputID: geometry?.outputId,
                                           generation: geometry?.generation, ready: inputReady) : nil
    }

    func settingScope(_ setting: ViewerSetting) -> ViewerSettingScope? {
        switch setting {
        case .reverseScrolling: return .device
        case .streaming: return capabilities.hostSettings ? .host : nil
        }
    }

    func route(_ command: ViewerCommand, current: ViewerSession? = nil) -> ViewerRoute? {
        switch command {
        case .select(let source):
            guard sources.contains(where: { $0.id == source }) else { return nil }
            switch (host, source) {
            case (.mac, .desktop): return .macSource(.desktop)
            case (.mac, .window(let id)): return .macSource(.window(id))
            case (.windows, .monitor(let id)): return .windowsOutput(id)
            default: return nil
            }
        case .input(let event):
            guard admitsInput(current) else { return nil }
            switch host {
            case .mac: return .macInput(event)
            case .windows:
                guard let geometry else { return nil }
                return .windowsInput(event, geometry)
            }
        case .windowsWinTap:
            guard host == .windows, standaloneWinTap, current?.standaloneWinTap == true,
                  admitsInput(current), let geometry else { return nil }
            return .windowsWinTap(geometry)
        case .fit: return host == .windows ? .localFit : nil
        }
    }

    private func admitsInput(_ current: ViewerSession?) -> Bool {
        guard let current, inputReady, current.inputReady, host == current.host,
              connectionID == current.connectionID else { return false }
        if host == .windows {
            guard let geometry, selected == .monitor(geometry.outputId),
                  selected == current.selected, geometry == current.geometry else { return false }
        }
        return true
    }
}
