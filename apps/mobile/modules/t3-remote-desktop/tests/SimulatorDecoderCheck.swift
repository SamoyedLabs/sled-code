import Foundation
import AVFoundation

@main struct SimulatorDecoderCheck {
    static func main() throws {
        // VPS/SPS/PPS from one synthetic blue 5120x1440 Main-profile x265 frame.
        let bytes = Data(base64Encoded: "BAMAGEABDAH//wFgAAADAJAAAAMAAAMAlpWUCQAsQgEBAWAAAAMAkAAAAwAAAwCWoACgCAFoWWVlSkwvAWgIAAADAAgAAAMACEAABkQBwHPBiQ==")!
        guard let sets = ParameterSets(encoded: bytes) else { fatalError("invalid fixture") }
        let geometry = try JSONDecoder().decode(WindowsGeometry.self, from: Data("""
        {"version":1,"outputId":"synthetic","generation":"1","requestId":"1","sourceRect":{"x":0,"y":0,"width":5120,"height":1440},"encodedWidth":5120,"encodedHeight":1440,"orientation":"upright","status":"awaiting-frame"}
        """.utf8))
        let decoder = WindowsVideoDecoder(queue: DispatchQueue(label: "decoder-test"))
        let configured = decoder.configure(sets, geometry: geometry)
        print("actual_WindowsVideoDecoder_configured=\(configured)")
        if !configured { exit(1) }
    }
}
