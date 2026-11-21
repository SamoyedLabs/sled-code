import Foundation
import Testing
@testable import WindowsProtocol

private func geometry(_ generation: String = "8") throws -> WindowsGeometry {
    try JSONDecoder().decode(WindowsGeometry.self, from: Data("""
    {"version":1,"outputId":"upper","generation":"\(generation)","requestId":"17","sourceRect":{"x":-3440,"y":-1440,"width":3440,"height":1440},"encodedWidth":1720,"encodedHeight":720,"orientation":"upright","status":"awaiting-frame"}
    """.utf8))
}
@Test func generationGate() throws {
    var gate = WindowsViewerGate()
    let old = WindowsFrameContext(outputId: "upper", generation: "8", frameSequence: "190")
    let result12 = gate.replace(try geometry())
    #expect(result12)
    let result13 = !gate.ready
    #expect(result13)
    let result14 = gate.context(old)
    #expect(result14)
    let result15 = !gate.context(old)
    #expect(result15)
    let result16 = gate.takeFrame() == old
    #expect(result16)
    let result17 = gate.takeFrame() == nil
    #expect(result17)
    let result18 = !gate.decoded(old, keyframe: false)
    #expect(result18)
    let result19 = gate.decoded(old, keyframe: true)
    #expect(result19)
    let result20 = !gate.decoded(old, keyframe: true)
    #expect(result20)
    let inFlight = WindowsFrameContext(outputId: "upper", generation: "8", frameSequence: "191")
    let acceptedInFlight = gate.context(inFlight)
    #expect(acceptedInFlight)
    gate.invalidate()
    let retainedInFlight = gate.takeFrame()
    #expect(retainedInFlight == inFlight)
    #expect(!gate.matches(inFlight))
    let result22 = !gate.decoded(old, keyframe: true)
    #expect(result22)
    let result23 = gate.replace(try geometry("9"))
    #expect(result23)
    let result24 = !gate.decoded(old, keyframe: true)
    #expect(result24)
    let result25 = !gate.replace(try geometry())
    #expect(result25)
    let fresh = WindowsFrameContext(outputId: "upper", generation: "9", frameSequence: "191")
    let result27 = gate.context(fresh)
    #expect(result27)
    let result28 = gate.takeFrame() == fresh
    #expect(result28)
    let result29 = gate.decoded(fresh, keyframe: true)
    #expect(result29)
}
@Test func localInverseAndDPI() throws {
    var transform = WindowsLocalTransform()
    #expect(transform.point(x: 500, y: 400, width: 1000, height: 800, imageWidth: 5120, imageHeight: 1440)?.0 == 0.5)
    #expect(transform.point(x: 500, y: 0, width: 1000, height: 800, imageWidth: 5120, imageHeight: 1440) == nil)
    transform.zoom = 2; transform.panX = -200; transform.panY = 50
    let point = try #require(transform.point(x: 300, y: 450, width: 1000, height: 800, imageWidth: 3440, imageHeight: 1440))
    #expect(point.0 == 0.5 && point.1 == 0.5)
    #expect(try geometry().sourceRect.y == -1440)
}
@Test func cursorFollowViewport() throws {
    for imageWidth in [5120.0, 3440.0] {
        var transform = WindowsLocalTransform()
        transform.fill(width: 400, height: 250, imageWidth: imageWidth, imageHeight: 1440, x: 0.5, y: 0.5)
        let centered = try #require(transform.frame(width: 400, height: 250, imageWidth: imageWidth, imageHeight: 1440))
        #expect(abs(centered.height - 250) < 0.0001)
        #expect(centered.width > 400)
        #expect(abs(centered.width / centered.height - imageWidth / 1440) < 0.0001)
        let pan = transform.panX
        transform.follow(x: 0.51, y: 0.5, width: 400, height: 250, imageWidth: imageWidth, imageHeight: 1440)
        #expect(transform.panX == pan)
        for x in [0.0, 0.25, 0.8, 1.0] {
            transform.follow(x: x, y: 0.5, width: 400, height: 250, imageWidth: imageWidth, imageHeight: 1440)
            let frame = try #require(transform.frame(width: 400, height: 250, imageWidth: imageWidth, imageHeight: 1440))
            let screenX = frame.x + x * frame.width
            #expect(screenX >= -0.0001 && screenX <= 400.0001)
            #expect(frame.x <= 0.0001 && frame.x + frame.width >= 399.9999)
            let inverse = try #require(transform.point(x: screenX, y: 125, width: 400, height: 250, imageWidth: imageWidth, imageHeight: 1440))
            #expect(abs(inverse.0 - x) < 0.0001)
        }
        let visible = try #require(transform.visibleRect(width: 400, height: 250, imageWidth: imageWidth, imageHeight: 1440))
        #expect(abs(visible.x + visible.width - 1) < 0.0001)
        #expect(visible.y == 0 && visible.height == 1)
        transform.panX = 1_000_000; transform.panY = -1_000_000
        transform.constrain(width: 250, height: 400, imageWidth: imageWidth, imageHeight: 1440)
        let resized = try #require(transform.frame(width: 250, height: 400, imageWidth: imageWidth, imageHeight: 1440))
        #expect(abs(resized.x) < 0.0001)
        #expect(resized.y == (400 - resized.height) / 2)
    }
    var fit = WindowsLocalTransform()
    fit.follow(x: 1, y: 1, width: 400, height: 250, imageWidth: 5120, imageHeight: 1440)
    #expect(fit.zoom == 1 && fit.panX == 0 && fit.panY == 0)
    #expect(fit.frame(width: 0, height: 250, imageWidth: 5120, imageHeight: 1440) == nil)
    fit.fill(width: .infinity, height: 250, imageWidth: 5120, imageHeight: 1440, x: 0.5, y: 0.5)
    #expect(fit.zoom == 1 && fit.panX == 0 && fit.panY == 0)
    fit.fill(width: 250, height: 400, imageWidth: 5120, imageHeight: 1440, x: 0.5, y: 0.5)
    fit.follow(x: 0, y: 0, width: 250, height: 400, imageWidth: 5120, imageHeight: 1440)
    let corner = try #require(fit.visibleRect(width: 250, height: 400, imageWidth: 5120, imageHeight: 1440))
    #expect(abs(corner.x) < 0.0001 && abs(corner.y) < 0.0001)
    #expect(corner.width < 1 && abs(corner.height - 1) < 0.0001)
}
@Test func wireShapesAndBounds() throws {
    #expect(try JSONDecoder().decode(Hello.self, from: Data("{}".utf8)).capabilities == nil)
    let hello = Hello(capabilities: ["windows-desktop-v1"])
    #expect(try JSONDecoder().decode(Hello.self, from: JSONEncoder().encode(hello)) == hello)
    #expect(StreamMessageKind.windowsCapabilities.rawValue == 46)
    #expect(StreamMessageKind.windowsFrameReady.rawValue == 51)
    #expect(windowsCounter("18446744073709551615") == UInt64.max)
    #expect(windowsCounter("18446744073709551616") == nil)
    #expect(windowsCounter("+1") == nil)
    var event = WindowsInput(outputId: "upper", generation: "8", sequence: "102", type: "key")
    event.hidUsage = 224; event.down = true
    let object = try #require(JSONSerialization.jsonObject(with: JSONEncoder().encode(event)) as? [String: Any])
    #expect(object["type"] as? String == "key")
    #expect(object["hidUsage"] as? Int == 224)
    #expect(object["modifiers"] == nil)
    var invalid = try geometry(); invalid.encodedWidth = 100_000
    #expect(!invalid.valid)
    #expect(StreamMessageKind.windowsCursor.rawValue == 52)
}

@Test func clipboardMessagesLeaveThePublicSender() throws {
    let legacy = try JSONDecoder().decode(WindowsCapabilities.self, from: Data("""
    {"version":1,"backend":"windows-native","codecs":["hevc-main-8"],"secureDesktop":"unverified","virtualDisplay":"unavailable","outputs":[{"id":"upper","name":"Upper","bounds":{"x":-3440,"y":-3,"width":3440,"height":1440},"rotation":0,"dpiX":120,"dpiY":120,"physical":true}]}
    """.utf8))
    var negotiated = legacy
    negotiated.clipboard = 1
    let payloads = [Data("{}".utf8), Data("{\"text\":\"owned clipboard ✓\"}".utf8), Data("{\"stop\":true}".utf8)]
    for (caps, permitted) in zip([nil, legacy, negotiated], [true, false, true]) {
        let client = ClientSendProbe()
        client.windowsCapabilities = caps
        for payload in payloads { client.send(.clipboard, payload: payload) }
        #expect(client.link.packets.count == (permitted ? payloads.count : 0))
        if permitted {
            for (packet, payload) in zip(client.link.packets, payloads) {
                let header = try #require(StreamMessage.parseHeader(packet))
                #expect(header.kind == .clipboard)
                #expect(header.payloadLength == payload.count)
                #expect(packet.dropFirst(StreamMessage.headerLength) == payload)
            }
        }
        client.send(.ping, payload: Data(repeating: 7, count: 8))
        let ping = try #require(client.link.packets.last)
        #expect(StreamMessage.parseHeader(ping)?.kind == .ping)
    }
}

@Test func cursorBindingAndQueuedLocalInput() throws {
    let g = try geometry()
    var gate = WindowsCursorGate()
    gate.bind(g)
    var report = WindowsCursorReport(outputId: g.outputId, request: 17, generation: 8, inputSequence: 0,
                                     inside: true, visible: true, embedded: false, x: 0.25, y: 0.75, shape: nil)
    #expect(gate.accepts(report))
    #expect(gate.restates(report, x: 0.25, y: 0.75))
    report.x += 1 / g.sourceRect.width
    #expect(!gate.restates(report, x: 0.25, y: 0.75))
    report.x = 0.25
    let revision = gate.queuedInput()
    #expect(!gate.accepts(report))
    gate.sent(sequence: 900, revision: revision, geometry: g)
    #expect(!gate.accepts(report))
    report.inputSequence = 900
    #expect(gate.accepts(report))
    report.inputSequence = 901
    #expect(!gate.accepts(report))
    report.inputSequence = 900; report.outputId = "other"
    #expect(!gate.accepts(report))
    report.outputId = g.outputId; report.request = 16
    #expect(!gate.accepts(report))
    report.request = 17; report.generation = 7
    #expect(!gate.accepts(report))
    gate.bind(try geometry("9"))
    gate.sent(sequence: 901, revision: revision, geometry: g)
    #expect(!gate.accepts(report))
    report.generation = 9; report.inputSequence = 0
    #expect(gate.accepts(report))
    gate.bind(nil)
    #expect(!gate.accepts(report))
    gate.bind(g, sequence: UInt64.max)
    report.generation = 8; report.inputSequence = UInt64.max
    #expect(gate.accepts(report))

    let pointer = WindowsPointer()
    pointer.bind(g, sequence: UInt64.max, reports: true)
    report.visible = false
    #expect(pointer.accept(report))
    pointer.update(CGPoint(x: 0.3, y: 0.6))
    #expect(!pointer.visible)
    report.visible = true
    #expect(pointer.accept(report))
    #expect(pointer.visible)
    report.visible = false; report.embedded = true
    #expect(pointer.accept(report))
    pointer.update(CGPoint(x: 0.4, y: 0.5))
    #expect(!pointer.visible)
    pointer.bind(g, reports: false)
    pointer.update(CGPoint(x: 0.4, y: 0.5))
    #expect(pointer.visible)
}

@Test func cursorWireIsBoundedAndReusesShapeBlob() throws {
    var data = Data([1, 11, 0, 5])
    for value in [UInt64(17), 8, UInt64.max] { data.appendBigEndian(value) }
    data.appendBigEndian(Float(0.25).bitPattern); data.appendBigEndian(Float(0.75).bitPattern)
    data.append(Data("upper".utf8))
    let png = Data([137,80,78,71,13,10,26,10, 0,0,0,13,73,72,68,82, 0,0,0,32, 0,0,0,48])
    let shape = CursorShapeBlob.encode(hotspot: CGPoint(x: 2, y: 3), size: CGSize(width: 32, height: 48), png: png)
    data.append(shape)
    let report = try #require(WindowsCursorReport.decode(data))
    #expect(report.inputSequence == UInt64.max && report.x == 0.25 && report.y == 0.75)
    #expect(report.shape == shape && report.visible && report.inside && !report.embedded)
    var position = Data(data.prefix(41)); position[1] = 1
    #expect(WindowsCursorReport.decode(position)?.visible == false)
    position[1] = 5
    #expect(WindowsCursorReport.decode(position)?.embedded == true)
    for flags in [UInt8(2), 4, 0x10] {
        position[1] = flags
        #expect(WindowsCursorReport.decode(position) == nil)
    }
    for count in 0..<41 { #expect(WindowsCursorReport.decode(data.prefix(count)) == nil) }
    var invalid = data; invalid[1] = 15
    #expect(WindowsCursorReport.decode(invalid) == nil)
    invalid = data; invalid[28] = 0x7f; invalid[29] = 0x80
    #expect(WindowsCursorReport.decode(invalid) == nil)
    invalid = data; invalid[41] = 0x7f; invalid[42] = 0xc0
    #expect(WindowsCursorReport.decode(invalid) == nil)
    invalid = data; invalid[41+16+16] = 1
    #expect(WindowsCursorReport.decode(invalid) == nil)
    invalid = data; invalid.append(Data(repeating: 0, count: 1 << 20))
    #expect(WindowsCursorReport.decode(invalid) == nil)
    let legacy = try JSONDecoder().decode(WindowsCapabilities.self, from: Data("""
    {"version":1,"backend":"windows-native","codecs":["hevc-main-8"],"secureDesktop":"unverified","virtualDisplay":"unavailable","outputs":[{"id":"upper","name":"Upper","bounds":{"x":-3440,"y":-3,"width":3440,"height":1440},"rotation":0,"dpiX":120,"dpiY":120,"physical":true}]}
    """.utf8))
    #expect(legacy.valid && legacy.cursor == nil && legacy.streamSettings == nil && legacy.clipboard == nil && legacy.standaloneWinTap == nil)
}

@Test func physicalInventoryAndUnsupportedInput() throws {
    let json = """
    {"version":1,"backend":"windows-native","codecs":["hevc-main-8"],"secureDesktop":"unverified","virtualDisplay":"unavailable","outputs":[{"id":"upper","name":"Upper","bounds":{"x":-3440,"y":-1440,"width":3440,"height":1440},"rotation":0,"dpiX":120,"dpiY":120,"physical":true},{"id":"main","name":"Primary","bounds":{"x":0,"y":0,"width":5120,"height":1440},"rotation":0,"dpiX":120,"dpiY":120,"physical":true,"primary":true}]}
    """
    var caps = try JSONDecoder().decode(WindowsCapabilities.self, from: Data(json.utf8))
    #expect(caps.valid && caps.clipboard == nil)
    caps.clipboard = 1
    let roundTrip = try JSONDecoder().decode(WindowsCapabilities.self, from: JSONEncoder().encode(caps))
    #expect(roundTrip.clipboard == 1)
    #expect(caps.defaultOutput?.id == "main")
    caps.outputs.append(caps.outputs[0])
    #expect(!caps.valid)
    var tap = WindowsInput(outputId: "main", generation: "8", sequence: "1", type: "keyTap", hidUsage: 227)
    #expect(tap.valid)
    let encodedTap = try JSONSerialization.jsonObject(with: JSONEncoder().encode(tap)) as? [String: Any]
    #expect(Set(encodedTap?.keys.map { $0 } ?? []) == Set(["version", "outputId", "generation", "sequence", "type", "hidUsage"]))
    tap.hidUsage = 224
    #expect(!tap.valid)
    tap.hidUsage = 227; tap.down = true
    #expect(!tap.valid)
    tap.down = nil; tap.text = "raycast://"
    #expect(!tap.valid)
    tap.text = nil; tap.x = 0.5
    #expect(!tap.valid)
    var input = WindowsInput(outputId: "main", generation: "8", sequence: "1", type: "key")
    input.down = true; input.hidUsage = 224
    #expect(input.valid)
    input.hidUsage = 50
    #expect(!input.valid)
    input.hidUsage = 72
    #expect(!input.valid)
    input.type = "text"; input.text = "Hello 👋 café\n"
    #expect(input.valid)
    for value in ["", "bad\0text", "bad\u{1B}text", "a\u{85}b", "a\u{9F}b", String(repeating: "é", count: 2049)] {
        input.text = value
        #expect(!input.valid)
    }
    input.type = "wheel"; input.x = 0.25; input.y = 0.75
    input.deltaX = -120; input.deltaY = 120
    #expect(input.valid)
    input.deltaX = 1201
    #expect(!input.valid)
    input.type = "pointer"; input.action = "leftDown"; input.x = .infinity; input.y = 0.5
    #expect(!input.valid)
    input.x = 0.5
    #expect(input.valid)
}

@Test func sharedInputControls() throws {
    let current = try geometry()
    for (flag, usage) in [(KeyModifiers.control, 224), (.shift, 225), (.option, 226), (.command, 227)] {
        var latched: KeyModifiers = []
        let events = KeyChord.tapModifier(flag, latched: &latched)
        #expect(events == [.key(hidUsage: UInt16(usage), down: true, modifiers: flag.rawValue),
                           .key(hidUsage: UInt16(usage), down: false, modifiers: 0)])
        var isolated = WindowsInputAdapter()
        let native = events.flatMap { isolated.events($0, geometry: current) }
        #expect(native.map(\.hidUsage) == [usage, usage])
        #expect(native.map(\.down) == [true, false])
        #expect(isolated.releaseAll(geometry: try geometry()).isEmpty && latched.isEmpty)
        latched = [flag]
        #expect(KeyChord.tapModifier(flag, latched: &latched).isEmpty && latched.isEmpty)
    }
    for usage: UInt16 in [0x29, 0x2B] {
        #expect(KeyChord.press(usage, with: []) == [.key(hidUsage: usage, down: true, modifiers: 0),
                                                .key(hidUsage: usage, down: false, modifiers: 0)])
    }
    var held: KeyModifiers = .shift
    let chord = KeyChord.tapModifier(.command, latched: &held)
    #expect(chord == KeyChord.modifiersDown([.shift, .command]) + KeyChord.modifiersUp([.shift, .command]))
    #expect(held.isEmpty)
    var adapter = WindowsInputAdapter()
    let pointer = adapter.events(.pointer(.leftDown, x: 0.25, y: 0.75), geometry: current)
    #expect(pointer.count == 1 && pointer[0].valid)
    #expect(pointer[0].outputId == "upper" && pointer[0].generation == "8")
    #expect(pointer[0].x == 0.25 && pointer[0].y == 0.75 && pointer[0].action == "leftDown")
    let moved = adapter.events(.pointer(.move, x: 0.5, y: 0.75), geometry: current)
    let released = adapter.events(.pointer(.leftUp, x: 0.5, y: 0.75), geometry: current)
    #expect(moved.first?.action == "move" && released.first?.action == "leftUp")
    let wheel = adapter.events(.scroll(x: 0.25, y: 0.75, dx: 120.0 / 3440, dy: -120.0 / 1440), geometry: current)
    #expect(wheel.first?.deltaX == -120 && wheel.first?.deltaY == -120)
    #expect(adapter.events(.scroll(x: 0, y: 0, dx: .infinity, dy: 0), geometry: current).isEmpty)
    let control = adapter.events(.key(hidUsage: 4, down: true, modifiers: 1 << 18), geometry: current)
    #expect(control.map(\.hidUsage) == [224, 4] && control.allSatisfy { $0.down == true })
    let up = adapter.events(.key(hidUsage: 4, down: false, modifiers: 0), geometry: current)
    #expect(up.map(\.hidUsage) == [224, 4] && up.allSatisfy { $0.down == false })
    let rightShift = adapter.events(.key(hidUsage: 229, down: true, modifiers: 1 << 17), geometry: current)
    #expect(rightShift.first?.hidUsage == 229)
    let shifted = adapter.events(.key(hidUsage: 5, down: true, modifiers: 1 << 17), geometry: current)
    #expect(shifted.count == 1 && shifted.first?.hidUsage == 5)
    let original = String(repeating: "👋é", count: 900)
    let text = adapter.events(.text(original), geometry: current)
    #expect(text.count == 2 && text.allSatisfy(\.valid))
    #expect(text.compactMap(\.text).joined() == original)
    #expect(adapter.events(.text("bad\0text"), geometry: current).isEmpty)
}

@Test func sharedHostActionsKeepNativeSourceIdentity() throws {
    let opaque = "\\\\.\\DISPLAY3:18446744073709551615"
    var g = try geometry()
    g.outputId = opaque
    let windows = ViewerSession(host: .windows, name: "PC", sources: [.init(id: .monitor(opaque), title: "Display 3")],
                                selected: .monitor(opaque), inputReady: true, geometry: g)
    #expect(windows.route(.select(.monitor(opaque))) == .windowsOutput(opaque))
    #expect(windows.route(.select(.desktop)) == nil)
    #expect(windows.route(.select(.window(3))) == nil)
    #expect(windows.route(.fit) == .localFit)
    #expect(!windows.capabilities.apps && !windows.capabilities.hostSettings && !windows.capabilities.windowTextScale)
    #expect(!windows.capabilities.clipboard && !windows.capabilities.audio && !windows.capabilities.menus)
    let mac = ViewerSession(host: .mac, name: "Mac", sources: [.init(id: .desktop, title: "Desktop"), .init(id: .window(3), title: "Editor")],
                            selected: .window(3), inputReady: true)
    #expect(mac.route(.select(.window(3))) == .macSource(.window(3)))
    #expect(mac.route(.select(.desktop)) == .macSource(.desktop))
    #expect(mac.route(.select(.monitor(opaque))) == nil)
    #expect(mac.route(.fit) == nil)
    #expect(mac.capabilities.hostSettings && mac.capabilities.windowTextScale && mac.capabilities.apps)
    #expect(windows.settingScope(.reverseScrolling) == .device)
    #expect(mac.settingScope(.reverseScrolling) == .device)
    #expect(windows.settingScope(.streaming) == nil)
    var settingsWindows = windows
    settingsWindows.streamSettings = true
    #expect(!settingsWindows.capabilities.clipboard)
    settingsWindows.textClipboard = true
    #expect(settingsWindows.capabilities.clipboard)
    #expect(settingsWindows.settingScope(.streaming) == .host)
    #expect(!settingsWindows.capabilities.audio && !settingsWindows.capabilities.windowTextScale && !settingsWindows.capabilities.apps)
    settingsWindows.audioStream = true
    #expect(settingsWindows.capabilities.audio)
    #expect(mac.settingScope(.streaming) == .host)
    let key = InputEvent.key(hidUsage: 4, down: true, modifiers: 0)
    #expect(mac.route(.input(key), current: mac) == .macInput(key))
    #expect(windows.route(.input(key), current: windows) == .windowsInput(key, g))
    #expect(windows.route(.windowsWinTap, current: windows) == nil)
    #expect(mac.route(.windowsWinTap, current: mac) == nil)
    var launcher = windows
    launcher.standaloneWinTap = true
    #expect(launcher.route(.windowsWinTap, current: launcher) == .windowsWinTap(g))
    #expect(launcher.route(.windowsWinTap, current: windows) == nil)
    #expect(windows.route(.windowsWinTap, current: launcher) == nil)
    #expect(launcher.route(.input(key), current: launcher) == .windowsInput(key, g))
    var stale = launcher
    stale.geometry?.generation = "9"
    #expect(launcher.route(.windowsWinTap, current: stale) == nil)
    stale = launcher; stale.inputReady = false
    #expect(launcher.route(.windowsWinTap, current: stale) == nil)
    #expect(stale.route(.windowsWinTap, current: launcher) == nil)
    stale = launcher; stale.selected = .monitor("other")
    #expect(launcher.route(.windowsWinTap, current: stale) == nil)
    stale = launcher; stale.connectionID = Date(timeIntervalSince1970: 1)
    #expect(launcher.route(.windowsWinTap, current: stale) == nil)
    var next = windows
    next.geometry?.generation = "9"
    #expect(windows.route(.input(key), current: next) == nil)
    next = windows; next.inputReady = false
    #expect(windows.route(.input(key), current: next) == nil)
    #expect(windows.inputEpoch != next.inputEpoch)
    #expect(windows.route(.input(key), current: mac) == nil)
    next = windows; next.connectionID = Date(timeIntervalSince1970: 1)
    #expect(windows.route(.input(key), current: next) == nil)
    let supported = WindowsSettingsCapabilities(version: 1, maxFPS: [30, 60], bitrate: [4_000_000, 15_000_000], captureScale: [2, 1])
    #expect(supported.valid)
    var invalid = supported
    invalid.maxFPS = [120]
    #expect(!invalid.valid)
    invalid = supported; invalid.bitrate = [16_000_000]
    #expect(!invalid.valid)
    invalid = supported; invalid.captureScale = [1.5]
    #expect(!invalid.valid)
    var state = HostSettingsState(settings: StreamSettings(maxFPS: 60, bitrate: 15_000_000, captureScale: 2,
                                prioritizeSpeed: false, virtualDisplay: false, directWireless: nil, sendAudio: nil),
                                  persistent: false, virtualDisplayAvailable: false, softwareEncoder: false)
    state.changeable = ["maxFPS", "bitrate", "captureScale"]
    var ledger = SettingsLedger()
    _ = ledger.receive(state)
    #expect(ledger.pick(HostSettingsChange(prioritizeSpeed: true, virtualDisplay: true, directWireless: true, sendAudio: true), token: 1, now: 0) == nil)
    let change = ledger.pick(HostSettingsChange(bitrate: 8_000_000, captureScale: 1), token: 2, now: 0)
    #expect(change?.token == 2 && change?.bitrate == 8_000_000 && ledger.host?.settings.bitrate == 15_000_000)
    #expect(ledger.displayed?.bitrate == 8_000_000)
    state.answering = 2
    #expect(ledger.receive(state) == [.bitrate, .captureScale])
    #expect(ledger.displayed?.bitrate == 15_000_000 && ledger.pending.isEmpty)
    _ = ledger.pick(HostSettingsChange(maxFPS: 30), token: 3, now: 1)
    state.settings.maxFPS = 30; state.answering = 3
    #expect(ledger.receive(state).isEmpty && ledger.displayed?.maxFPS == 30)
    ledger.reset()
    #expect(ledger.host == nil && ledger.pending.isEmpty)
}

@Test func displayNamesPersistPerComputerAndKeepOutputIdentity() throws {
    let suite = "SledDisplayNamesTests." + UUID().uuidString
    let defaults = try #require(UserDefaults(suiteName: suite))
    defer { defaults.removePersistentDomain(forName: suite) }
    let names = ViewerDisplayNames(defaults: defaults)
    let output = "opaque:display-identity"
    #expect(names.rename(output, on: "computer-a", to: "  Main ultrawide  "))
    #expect(names.rename(output, on: "computer-b", to: "Top left"))
    let reopened = ViewerDisplayNames(defaults: defaults)
    #expect(reopened.names(for: "computer-a") == [output: "Main ultrawide"])
    #expect(reopened.names(for: "computer-b") == [output: "Top left"])
    #expect(reopened.names(for: "computer-c").isEmpty && reopened.names(for: nil).isEmpty)
    for invalid in ["line\nbreak", "bad\0name", String(repeating: "x", count: 81)] {
        #expect(!reopened.rename(output, on: "computer-a", to: invalid))
        #expect(reopened.names(for: "computer-a")[output] == "Main ultrawide")
    }
    #expect(!names.rename(output, on: "", to: "Shared by accident"))
    #expect(reopened.rename(output, on: "computer-a", to: "  "))
    #expect(reopened.names(for: "computer-a").isEmpty)
    #expect(reopened.names(for: "computer-b")[output] == "Top left")
}

@Test func heldWindowsInputIsReleasedAtSourceAndSessionBoundaries() throws {
    let g = try geometry()
    var adapter = WindowsInputAdapter()
    _ = adapter.events(.key(hidUsage: 4, down: true, modifiers: 1 << 20), geometry: g)
    _ = adapter.events(.pointer(.leftDown, x: 0.2, y: 0.3), geometry: g)
    let releases = adapter.releaseAll(geometry: g)
    #expect(releases.contains { $0.type == "key" && $0.hidUsage == 4 && $0.down == false })
    #expect(releases.contains { $0.type == "key" && $0.hidUsage == 227 && $0.down == false })
    #expect(releases.contains { $0.type == "pointer" && $0.action == "leftUp" && $0.x == 0.2 && $0.y == 0.3 })
    #expect(releases.allSatisfy { $0.valid && $0.outputId == g.outputId && $0.generation == g.generation })
    #expect(adapter.releaseAll(geometry: g).isEmpty)
    let next = adapter.events(.key(hidUsage: 5, down: true, modifiers: 0), geometry: try geometry("9"))
    #expect(next.count == 1 && next[0].hidUsage == 5 && next[0].generation == "9")
}
