import Foundation

public struct WindowsRect: Codable, Equatable, Sendable {
    public var x, y, width, height: Double
    public var valid: Bool {
        [x, y, width, height].allSatisfy { $0.isFinite && abs($0) <= 1_000_000 } && width > 0 && height > 0
    }
}
public struct WindowsOutput: Codable, Equatable, Sendable, Identifiable {
    public var id, name: String
    public var bounds: WindowsRect
    public var rotation: Int
    public var dpiX, dpiY: Double
    public var physical: Bool
    public var primary: Bool?
}
public struct WindowsSettingsCapabilities: Codable, Equatable, Sendable {
    public var version: Int
    public var maxFPS: [Int]
    public var bitrate: [Int]
    public var captureScale: [Double]
    public var valid: Bool {
        version == 1 && !maxFPS.isEmpty && !bitrate.isEmpty && !captureScale.isEmpty &&
        Set(maxFPS).count == maxFPS.count && Set(bitrate).count == bitrate.count &&
        Set(captureScale).count == captureScale.count && maxFPS.allSatisfy { [30, 60].contains($0) } &&
        bitrate.allSatisfy { SettingsChoices.bitrate.contains($0) } && captureScale.allSatisfy { [1.0, 2.0].contains($0) }
    }
}

public struct WindowsCapabilities: Codable, Equatable, Sendable {
    public var version: Int
    public var backend: String
    public var codecs: [String]
    public var secureDesktop, virtualDisplay: String
    public var outputs: [WindowsOutput]
    public var cursor: Int? = nil
    public var streamSettings: WindowsSettingsCapabilities? = nil
    public var clipboard: Int? = nil
    public var audio: Int? = nil
    public var standaloneWinTap: Int? = nil
    public var valid: Bool {
        version == 1 && backend == "windows-native" && codecs.contains("hevc-main-8") &&
        (1...32).contains(outputs.count) && Set(outputs.map(\.id)).count == outputs.count &&
        outputs.allSatisfy { !$0.id.isEmpty && $0.id.utf8.count <= 2048 && $0.name.utf8.count <= 256 &&
            $0.physical && $0.bounds.valid && [0, 90, 180, 270].contains($0.rotation) &&
            $0.dpiX.isFinite && $0.dpiY.isFinite && $0.dpiX > 0 && $0.dpiY > 0 }
    }
    public var defaultOutput: WindowsOutput? { outputs.first { $0.primary == true } ?? outputs.first }
}

public struct WindowsCursorReport: Equatable, Sendable {
    public var outputId: String
    public var request, generation, inputSequence: UInt64
    public var inside, visible, embedded: Bool
    public var x, y: Double
    public var shape: Data?

    public static func decode(_ data: Data) -> Self? {
        guard (36...((1 << 20) + 2084)).contains(data.count) else { return nil }
        let bytes = Data(data)
        let flags = bytes[1]
        let length = Int(bytes.readBigEndian(UInt16.self, at: 2))
        guard bytes[0] == 1, flags & 0xf0 == 0, (1...2048).contains(length), bytes.count >= 36 + length,
              let output = String(data: bytes.subdata(in: 36..<(36 + length)), encoding: .utf8) else { return nil }
        let inside = flags & 1 != 0, visible = flags & 2 != 0, embedded = flags & 4 != 0
        let x = Double(Float(bitPattern: bytes.readBigEndian(UInt32.self, at: 28)))
        let y = Double(Float(bitPattern: bytes.readBigEndian(UInt32.self, at: 32)))
        guard x.isFinite, y.isFinite, (0...1).contains(x), (0...1).contains(y),
              !visible || inside && !embedded, !embedded || inside else { return nil }
        let payload = bytes.subdata(in: (36 + length)..<bytes.count)
        var shape: Data?
        if flags & 8 != 0 {
            guard (40...(1 << 20)).contains(payload.count) else { return nil }
            let values = stride(from: 0, to: 16, by: 4).map { Float(bitPattern: payload.readBigEndian(UInt32.self, at: $0)) }
            guard values.allSatisfy(\.isFinite), (1...256).contains(values[2]), (1...256).contains(values[3]),
                  values[2].rounded() == values[2], values[3].rounded() == values[3],
                  values[0] >= 0, values[0] < values[2], values[1] >= 0, values[1] < values[3],
                  payload.subdata(in: 16..<24) == Data([137,80,78,71,13,10,26,10]),
                  payload.readBigEndian(UInt32.self, at: 24) == 13,
                  payload.subdata(in: 28..<32) == Data("IHDR".utf8),
                  payload.readBigEndian(UInt32.self, at: 32) == UInt32(values[2]),
                  payload.readBigEndian(UInt32.self, at: 36) == UInt32(values[3]) else { return nil }
            shape = payload
        } else if !payload.isEmpty { return nil }
        let generation = bytes.readBigEndian(UInt64.self, at: 12)
        guard generation > 0 else { return nil }
        return Self(outputId: output, request: bytes.readBigEndian(UInt64.self, at: 4), generation: generation,
                    inputSequence: bytes.readBigEndian(UInt64.self, at: 20), inside: inside, visible: visible,
                    embedded: embedded, x: x, y: y, shape: shape)
    }
}

/// Windows sequences are monotonic kind 49 IDs; they are never Mac kind 8 counts.
public struct WindowsCursorGate {
    private var geometry: WindowsGeometry?
    private var revision: UInt64 = 0
    private var sentRevision: UInt64 = 0
    private var sequence: UInt64 = 0
    public init() {}
    public mutating func bind(_ geometry: WindowsGeometry?, sequence: UInt64 = 0) {
        self.geometry = geometry
        revision &+= 1; sentRevision = revision; self.sequence = sequence
    }
    public mutating func queuedInput() -> UInt64 { revision &+= 1; return revision }
    public mutating func sent(sequence: UInt64, revision: UInt64, geometry: WindowsGeometry) {
        guard self.geometry == geometry, revision > sentRevision, revision <= self.revision else { return }
        self.sequence = max(self.sequence, sequence); sentRevision = revision
    }
    public func accepts(_ report: WindowsCursorReport) -> Bool {
        guard let geometry, geometry.valid, geometry.status == "awaiting-frame", revision == sentRevision else { return false }
        return report.outputId == geometry.outputId && report.generation == windowsCounter(geometry.generation) &&
               report.request == windowsCounter(geometry.requestId) && report.inputSequence == sequence
    }
    public func restates(_ report: WindowsCursorReport, x: Double, y: Double) -> Bool {
        guard let geometry, report.inside, x.isFinite, y.isFinite else { return false }
        let width = geometry.sourceRect.width, height = geometry.sourceRect.height
        return (report.x * width).rounded() == min(width - 1, floor(x * width)) &&
               (report.y * height).rounded() == min(height - 1, floor(y * height))
    }
}
public struct SelectWindowsOutput: Codable, Equatable, Sendable {
    public var version = 1
    public var outputId, requestId: String
}
public struct WindowsGeometry: Codable, Equatable, Sendable {
    public var version: Int
    public var outputId, generation, requestId: String
    public var sourceRect: WindowsRect
    public var encodedWidth, encodedHeight: Int
    public var orientation, status: String
    public var valid: Bool {
        version == 1 && windowsCounter(generation) != nil && windowsCounter(requestId) != nil &&
        sourceRect.valid && (1...8192).contains(encodedWidth) && (1...8192).contains(encodedHeight) &&
        encodedWidth * encodedHeight <= 16_777_216 && orientation == "upright"
    }
}
public struct WindowsFrameContext: Codable, Equatable, Sendable {
    public var version = 1
    public var outputId, generation, frameSequence: String
    public var valid: Bool { version == 1 && windowsCounter(generation) != nil && windowsCounter(frameSequence) != nil }
}
public typealias WindowsFrameReady = WindowsFrameContext
public struct WindowsInput: Codable, Equatable, Sendable {
    public var version = 1
    public var outputId, generation, sequence, type: String
    public var action: String? = nil
    public var x: Double? = nil
    public var y: Double? = nil
    public var hidUsage: Int? = nil
    public var down: Bool? = nil
    public var text: String? = nil
    public var deltaX: Int? = nil
    public var deltaY: Int? = nil
    public static func supportsHIDUsage(_ usage: Int) -> Bool {
        ((4...69).contains(usage) && usage != 50) || (73...82).contains(usage) || (224...231).contains(usage)
    }
    public var valid: Bool {
        guard version == 1, !outputId.isEmpty, windowsCounter(generation) != nil,
              windowsCounter(sequence) != nil else { return false }
        if type == "keyTap" {
            return hidUsage == 227 && action == nil && down == nil && text == nil &&
                   x == nil && y == nil && deltaX == nil && deltaY == nil
        }
        if type == "key" { return hidUsage.map(Self.supportsHIDUsage) == true && down != nil }
        if type == "text" {
            guard let text, !text.isEmpty, text.utf8.count <= 4096 else { return false }
            return text.unicodeScalars.allSatisfy { $0.value >= 32 && !(127...159).contains($0.value) || [8, 9, 10, 13].contains($0.value) }
        }
        guard let x, let y, x.isFinite, y.isFinite, (0...1).contains(x), (0...1).contains(y) else { return false }
        if type == "pointer" { return ["move", "leftDown", "leftUp", "rightDown", "rightUp", "middleDown", "middleUp"].contains(action ?? "") }
        if type == "wheel" { return deltaX.map { (-1200...1200).contains($0) } == true && deltaY.map { (-1200...1200).contains($0) } == true }
        return false
    }
}
public func windowsCounter(_ value: String) -> UInt64? {
    guard !value.isEmpty, value.utf8.count <= 20, value.utf8.allSatisfy({ (48...57).contains($0) }) else { return nil }
    return UInt64(value)
}

/// Serial-owner gate; retains only current geometry and one frame's context.
public struct WindowsViewerGate {
    public private(set) var geometry: WindowsGeometry?
    public private(set) var ready = false
    public private(set) var pending: WindowsFrameContext?
    private var lastFrame: UInt64 = 0
    private var accepting = false
    public init() {}
    // Output selection must preserve the context of an in-flight wire frame.
    public mutating func invalidate() { ready = false; accepting = false }
    public mutating func suspend() { ready = false; pending = nil }
    public mutating func replace(_ next: WindowsGeometry) -> Bool {
        guard next.valid, let generation = windowsCounter(next.generation),
              generation > (geometry.flatMap { windowsCounter($0.generation) } ?? 0) else { return false }
        geometry = next; suspend(); accepting = true; lastFrame = 0
        return true
    }
    public mutating func context(_ next: WindowsFrameContext) -> Bool {
        guard pending == nil, next.valid, let frame = windowsCounter(next.frameSequence), frame > lastFrame else { return false }
        pending = next; lastFrame = frame
        return true
    }
    public mutating func takeFrame() -> WindowsFrameContext? {
        defer { pending = nil }
        return pending
    }
    public func matches(_ frame: WindowsFrameContext) -> Bool {
        accepting && geometry?.generation == frame.generation && geometry?.outputId == frame.outputId && geometry?.status == "awaiting-frame"
    }
    public mutating func decoded(_ frame: WindowsFrameContext, keyframe: Bool) -> Bool {
        guard !ready, keyframe, matches(frame) else { return false }
        ready = true
        return true
    }
}

/// Inverts a centered aspect-fit image, then local zoom and translation. DPI is not involved.
public struct WindowsLocalTransform {
    public var zoom: Double = 1
    public var panX: Double = 0
    public var panY: Double = 0
    public init() {}
    public func frame(width: Double, height: Double, imageWidth: Double, imageHeight: Double) -> WindowsRect? {
        guard [width, height, imageWidth, imageHeight, zoom, panX, panY].allSatisfy(\.isFinite),
              width > 0, height > 0, imageWidth > 0, imageHeight > 0, (1...8).contains(zoom) else { return nil }
        let fit = min(width / imageWidth, height / imageHeight)
        let w = imageWidth * fit * zoom, h = imageHeight * fit * zoom
        return WindowsRect(x: (width - w) / 2 + panX, y: (height - h) / 2 + panY, width: w, height: h)
    }
    public mutating func constrain(width: Double, height: Double, imageWidth: Double, imageHeight: Double) {
        guard let frame = frame(width: width, height: height, imageWidth: imageWidth, imageHeight: imageHeight) else { return }
        let limitX = max(0, (frame.width - width) / 2), limitY = max(0, (frame.height - height) / 2)
        panX = min(limitX, max(-limitX, panX)); panY = min(limitY, max(-limitY, panY))
    }
    public mutating func fill(width: Double, height: Double, imageWidth: Double, imageHeight: Double, x: Double, y: Double) {
        guard [width, height, imageWidth, imageHeight, x, y].allSatisfy(\.isFinite),
              width > 0, height > 0, imageWidth > 0, imageHeight > 0, (0...1).contains(x), (0...1).contains(y) else { return }
        let fit = min(width / imageWidth, height / imageHeight)
        zoom = min(8, max(1, max(width / imageWidth, height / imageHeight) / fit))
        panX = (0.5 - x) * imageWidth * fit * zoom; panY = (0.5 - y) * imageHeight * fit * zoom
        constrain(width: width, height: height, imageWidth: imageWidth, imageHeight: imageHeight)
    }
    public mutating func follow(x: Double, y: Double, width: Double, height: Double, imageWidth: Double, imageHeight: Double) {
        guard zoom > 1, (0...1).contains(x), (0...1).contains(y),
              let frame = frame(width: width, height: height, imageWidth: imageWidth, imageHeight: imageHeight) else { return }
        let px = frame.x + x * frame.width, py = frame.y + y * frame.height
        panX += min(width * 0.8, max(width * 0.2, px)) - px
        panY += min(height * 0.8, max(height * 0.2, py)) - py
        constrain(width: width, height: height, imageWidth: imageWidth, imageHeight: imageHeight)
    }
    public func visibleRect(width: Double, height: Double, imageWidth: Double, imageHeight: Double) -> WindowsRect? {
        guard let frame = frame(width: width, height: height, imageWidth: imageWidth, imageHeight: imageHeight) else { return nil }
        let x = max(0, -frame.x / frame.width), y = max(0, -frame.y / frame.height)
        return WindowsRect(x: x, y: y, width: min(1, (width - frame.x) / frame.width) - x,
                           height: min(1, (height - frame.y) / frame.height) - y)
    }
    public func point(x: Double, y: Double, width: Double, height: Double, imageWidth: Double, imageHeight: Double) -> (Double, Double)? {
        guard width > 0, height > 0, imageWidth > 0, imageHeight > 0, zoom.isFinite, zoom >= 1 else { return nil }
        let fit = min(width / imageWidth, height / imageHeight)
        let u = (x - width / 2 - panX) / (imageWidth * fit * zoom) + 0.5
        let v = (y - height / 2 - panY) / (imageHeight * fit * zoom) + 0.5
        guard u.isFinite, v.isFinite, (0...1).contains(u), (0...1).contains(v) else { return nil }
        return (u, v)
    }
}
