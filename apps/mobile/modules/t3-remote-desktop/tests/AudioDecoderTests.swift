import Foundation
import Testing
@testable import ViewerAudio

@Test func windowsAACLCDecodesNegotiatedPackets() throws {
    #expect(AudioCodec.choose(offered: AudioCodec.devicePlays, makes: [AudioCodec.aacLC]) == AudioCodec.aacLC)
    #expect(AudioCodec.choose(offered: [AudioCodec.aacELD]) == AudioCodec.aacELD)
    let decoder = try AudioDecoder(framesPerPacket: 1024, cookie: Data([0x11, 0x90]), codec: AudioCodec.aacLC)
    let packets = [
        "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",
        "IUDaRgjBwA==",

    ].compactMap { Data(base64Encoded: $0) }
    let message = AudioMessage.packets(AudioPackets(epoch: 4, seq: 0, segmentStart: true, packets: packets))
    guard case .packets(let received) = try #require(AudioMessage.parse(message.serialized())) else {
        Issue.record("AAC-LC packet framing was lost")
        return
    }
    let samples = received.packets.compactMap { decoder.decode($0) }
    #expect(samples.count >= 5)
    #expect(samples.allSatisfy { $0.left.count == 1024 && $0.right.count == 1024 })
    #expect(samples.contains { $0.left.contains { abs($0) > 0.001 } })
    decoder.reset()
    #expect(packets.compactMap { decoder.decode($0) }.count >= 5)
    #expect(throws: AudioDecoder.Failure.self) {
        try AudioDecoder(framesPerPacket: 1024, cookie: Data([0x12, 0x10]), codec: AudioCodec.aacLC)
    }
    #expect(throws: AudioDecoder.Failure.self) {
        try AudioDecoder(framesPerPacket: 512, cookie: Data([0x11, 0x90]), codec: AudioCodec.aacLC)
    }
    #expect(throws: AudioDecoder.Failure.self) {
        try AudioDecoder(framesPerPacket: 1024, cookie: Data(), codec: "unknown")
    }
}

@Test func macAACELDStillDecodes() throws {
    let encoder = try AudioEncoder(framesPerPacket: 512)
    let decoder = try AudioDecoder(framesPerPacket: encoder.framesPerPacket, cookie: encoder.cookie)
    var audible = false
    for block in 0..<8 {
        let pcm = (0..<encoder.framesPerPacket * 2).map { i in
            Float(sin(Double(block * encoder.framesPerPacket + i / 2) * 2 * .pi * 440 / 48_000)) * 0.1
        }
        let packet = try #require(encoder.encode(pcm))
        let samples = try #require(decoder.decode(packet))
        audible = audible || samples.left.contains { abs($0) > 0.001 }
    }
    #expect(audible)
}
