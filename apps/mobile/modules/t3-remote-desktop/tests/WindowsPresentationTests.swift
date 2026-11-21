import Foundation
import Testing
@testable import WindowsProtocol

@Test func firstPictureSurvivesBackpressureUntilDisplayable() throws {
    var gate = WindowsViewerGate()
    let geometry = try JSONDecoder().decode(WindowsGeometry.self, from: Data("""
    {"version":1,"outputId":"main","requestId":"1","generation":"8","sourceRect":{"x":0,"y":0,"width":1920,"height":1080},"encodedWidth":1920,"encodedHeight":1080,"rotation":0,"orientation":"upright","status":"awaiting-frame"}
    """.utf8))
    let replaced = gate.replace(geometry)
    #expect(replaced)
    let frame = WindowsFrameContext(outputId: "main", generation: "8", frameSequence: "1")
    let presentation = WindowsFramePresentation<Int>()
    var acknowledgements = 0
    var displayedSamples: [Int] = []
    presentation.offer(1, firstDisplayed: {
        if gate.decoded(frame, keyframe: true) { acknowledgements += 1 }
    })
    presentation.drain(ready: false) { displayedSamples.append($0) }
    #expect(!gate.ready && acknowledgements == 0)
    #expect(presentation.hasPending)
    // Subsequent reference frames must not evict the sole readiness keyframe.
    for value in 2...100 { presentation.offer(value, firstDisplayed: nil) }
    presentation.displayChanged(ready: true)
    #expect(!gate.ready)
    presentation.drain(ready: true) { displayedSamples.append($0) }
    #expect(displayedSamples == [1])
    #expect(!gate.ready)
    presentation.displayChanged(ready: false)
    #expect(!gate.ready)
    presentation.displayChanged(ready: true)
    presentation.displayChanged(ready: true)
    #expect(gate.ready && acknowledgements == 1)
    presentation.offer(101, firstDisplayed: nil)
    presentation.drain(ready: true) { displayedSamples.append($0) }
    #expect(displayedSamples == [1, 101])
    gate.invalidate()
    presentation.offer(102, firstDisplayed: { _ = gate.decoded(frame, keyframe: true) })
    presentation.reset()
    presentation.drain(ready: true) { displayedSamples.append($0) }
    presentation.displayChanged(ready: true)
    #expect(!gate.ready && displayedSamples == [1, 101])
}
