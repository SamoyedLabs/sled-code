import AVFoundation
import ExpoModulesCore
import SherpaOnnxC
import UIKit

/// The files of the Supertonic 3 export, as `@openbot/contracts/speech-models` downloads them.
private let supertonicFiles = (
  durationPredictor: "duration_predictor.int8.onnx",
  textEncoder: "text_encoder.int8.onnx",
  vectorEstimator: "vector_estimator.int8.onnx",
  vocoder: "vocoder.int8.onnx",
  ttsJson: "tts.json",
  unicodeIndexer: "unicode_indexer.bin",
  voiceStyle: "voice.bin"
)

/// One part of a reply that waits to play: its id for the events, and its mono samples.
private struct SpeechPart {
  let id: String
  let samples: [Float]
  let sampleRate: Double
}

/// The Supertonic 3 model in sherpa-onnx. Only the synthesis queue uses it.
private final class SupertonicVoice {
  let directory: String
  let tts: OpaquePointer

  init(directory: String, threads: Int) throws {
    let file = { (name: String) in strdup((directory as NSString).appendingPathComponent(name)) }
    let paths = [
      file(supertonicFiles.durationPredictor), file(supertonicFiles.textEncoder), file(supertonicFiles.vectorEstimator),
      file(supertonicFiles.vocoder), file(supertonicFiles.ttsJson), file(supertonicFiles.unicodeIndexer),
      file(supertonicFiles.voiceStyle), strdup("cpu"),
    ]
    defer { paths.forEach { free($0) } }
    var config = SherpaOnnxOfflineTtsConfig()
    config.model.supertonic.duration_predictor = UnsafePointer(paths[0])
    config.model.supertonic.text_encoder = UnsafePointer(paths[1])
    config.model.supertonic.vector_estimator = UnsafePointer(paths[2])
    config.model.supertonic.vocoder = UnsafePointer(paths[3])
    config.model.supertonic.tts_json = UnsafePointer(paths[4])
    config.model.supertonic.unicode_indexer = UnsafePointer(paths[5])
    config.model.supertonic.voice_style = UnsafePointer(paths[6])
    config.model.provider = UnsafePointer(paths[7])
    config.model.num_threads = Int32(threads)
    config.model.debug = 0
    config.max_num_sentences = 1
    guard let tts = SherpaOnnxCreateOfflineTts(&config) else { throw SpeechError.modelLoadFailed }
    self.directory = directory
    self.tts = tts
  }

  deinit {
    SherpaOnnxDestroyOfflineTts(tts)
  }

  func generate(text: String, language: String, speaker: Int, steps: Int) -> (samples: [Float], sampleRate: Double)? {
    var generation = SherpaOnnxGenerationConfig()
    generation.sid = Int32(speaker)
    generation.speed = 1
    generation.silence_scale = 0.2
    generation.num_steps = Int32(steps)
    // The language is the one value of the reply that the JSON carries; it is one of the codes
    // that `SPEECH_LANGUAGES` lists, so it needs no escaping.
    let extra = "{\"lang\":\"\(language)\"}"
    let audio = text.withCString { textPointer in
      extra.withCString { extraPointer -> UnsafePointer<SherpaOnnxGeneratedAudio>? in
        generation.extra = extraPointer
        return SherpaOnnxOfflineTtsGenerateWithConfig(tts, textPointer, &generation, nil, nil)
      }
    }
    guard let audio else { return nil }
    defer { SherpaOnnxDestroyOfflineTtsGeneratedAudio(audio) }
    let count = Int(audio.pointee.n)
    guard count > 0, let samples = audio.pointee.samples else { return nil }
    return (Array(UnsafeBufferPointer(start: samples, count: count)), Double(audio.pointee.sample_rate))
  }
}

private enum SpeechError: Error {
  case modelLoadFailed
}

/// The files of the Parakeet TDT 0.6B v3 export, as `@openbot/contracts/speech-models` downloads them.
private let parakeetFiles = (
  encoder: "encoder.int8.onnx",
  decoder: "decoder.int8.onnx",
  joiner: "joiner.int8.onnx",
  tokens: "tokens.txt"
)

/// The files of the Qwen3-ASR 0.6B export, as `@openbot/contracts/speech-models` downloads them. The
/// tokenizer files are in the model directory itself.
private let qwen3AsrFiles = (
  convFrontend: "conv_frontend.onnx",
  encoder: "encoder.int8.onnx",
  decoder: "decoder.int8.onnx"
)

/// A speech model of the phone in sherpa-onnx. Parakeet TDT 0.6B v3 is the speech recognizer of
/// desktop; Qwen3-ASR 0.6B also hears Chinese mixed with English. Both find the spoken language
/// themselves. Only the recognition queue uses it.
private final class OfflineSpeechRecognizer {
  enum Model {
    case parakeet
    case qwen3Asr
  }

  let directory: String
  let model: Model
  let recognizer: OpaquePointer

  init(directory: String, model: Model, threads: Int) throws {
    let file = { (name: String) in strdup((directory as NSString).appendingPathComponent(name)) }
    var config = SherpaOnnxOfflineRecognizerConfig()
    config.feat_config.sample_rate = Int32(captureSampleRate)
    config.feat_config.feature_dim = 80
    config.model_config.num_threads = Int32(threads)
    config.model_config.debug = 0
    let strings: [UnsafeMutablePointer<CChar>?]
    switch model {
    case .parakeet:
      strings = [
        file(parakeetFiles.encoder), file(parakeetFiles.decoder), file(parakeetFiles.joiner), file(parakeetFiles.tokens),
        strdup("cpu"), strdup("nemo_transducer"), strdup("greedy_search"),
      ]
      config.model_config.transducer.encoder = UnsafePointer(strings[0])
      config.model_config.transducer.decoder = UnsafePointer(strings[1])
      config.model_config.transducer.joiner = UnsafePointer(strings[2])
      config.model_config.tokens = UnsafePointer(strings[3])
      config.model_config.provider = UnsafePointer(strings[4])
      config.model_config.model_type = UnsafePointer(strings[5])
      config.decoding_method = UnsafePointer(strings[6])
      config.max_active_paths = 4
    case .qwen3Asr:
      strings = [
        file(qwen3AsrFiles.convFrontend), file(qwen3AsrFiles.encoder), file(qwen3AsrFiles.decoder), strdup(directory),
        strdup("cpu"), strdup(""), strdup("greedy_search"),
      ]
      config.model_config.qwen3_asr.conv_frontend = UnsafePointer(strings[0])
      config.model_config.qwen3_asr.encoder = UnsafePointer(strings[1])
      config.model_config.qwen3_asr.decoder = UnsafePointer(strings[2])
      config.model_config.qwen3_asr.tokenizer = UnsafePointer(strings[3])
      // The export holds 512 positions: a segment of 25 s takes about 330 of them, and its words fit
      // in the rest.
      config.model_config.qwen3_asr.max_total_len = 512
      config.model_config.qwen3_asr.max_new_tokens = 256
      config.model_config.qwen3_asr.temperature = 1e-6
      config.model_config.qwen3_asr.top_p = 0.8
      config.model_config.qwen3_asr.seed = 42
      config.model_config.qwen3_asr.hotwords = UnsafePointer(strings[5])
      config.model_config.provider = UnsafePointer(strings[4])
      config.decoding_method = UnsafePointer(strings[6])
    }
    defer { strings.forEach { free($0) } }
    guard let recognizer = SherpaOnnxCreateOfflineRecognizer(&config) else { throw SpeechError.modelLoadFailed }
    self.directory = directory
    self.model = model
    self.recognizer = recognizer
  }

  deinit {
    SherpaOnnxDestroyOfflineRecognizer(recognizer)
  }

  func decode(_ samples: [Float]) -> String {
    guard !samples.isEmpty, let stream = SherpaOnnxCreateOfflineStream(recognizer) else { return "" }
    defer { SherpaOnnxDestroyOfflineStream(stream) }
    samples.withUnsafeBufferPointer { buffer in
      SherpaOnnxAcceptWaveformOffline(stream, Int32(captureSampleRate), buffer.baseAddress, Int32(buffer.count))
    }
    SherpaOnnxDecodeOfflineStream(recognizer, stream)
    guard let result = SherpaOnnxGetOfflineStreamResult(stream) else { return "" }
    defer { SherpaOnnxDestroyOfflineRecognizerResult(result) }
    guard let text = result.pointee.text else { return "" }
    return String(cString: text).trimmingCharacters(in: .whitespacesAndNewlines)
  }
}

/// The sample rate of the microphone audio for Parakeet and ElevenLabs.
private let captureSampleRate = 16_000.0

private func transcribeRecording(_ url: URL, recognizer: OfflineSpeechRecognizer) throws -> String {
  let recording = try AVAudioFile(forReading: url)
  let format = recording.processingFormat
  guard format.sampleRate.isFinite, format.sampleRate > 0, recording.length > 0,
        Double(recording.length) / format.sampleRate <= 301,
        let target = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: captureSampleRate, channels: 1, interleaved: false),
        let converter = AVAudioConverter(from: format, to: target),
        let input = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 16_384),
        let output = AVAudioPCMBuffer(
          pcmFormat: target,
          frameCapacity: AVAudioFrameCount(16_384.0 * captureSampleRate / format.sampleRate) + 256
        ) else { throw SpeechError.modelLoadFailed }

  let segmentSize = Int(captureSampleRate * 24)
  var samples: [Float] = []
  var transcripts: [String] = []
  while recording.framePosition < recording.length {
    try recording.read(into: input, frameCount: input.frameCapacity)
    if input.frameLength == 0 { break }
    var consumed = false
    var error: NSError?
    output.frameLength = 0
    converter.convert(to: output, error: &error) { _, status in
      if consumed {
        status.pointee = .noDataNow
        return nil
      }
      consumed = true
      status.pointee = .haveData
      return input
    }
    if let error { throw error }
    guard let channel = output.floatChannelData?[0] else { continue }
    samples.append(contentsOf: UnsafeBufferPointer(start: channel, count: Int(output.frameLength)))
    while samples.count >= segmentSize {
      let text = recognizer.decode(Array(samples.prefix(segmentSize)))
      if !text.isEmpty { transcripts.append(text) }
      samples.removeFirst(segmentSize)
    }
  }
  let text = recognizer.decode(samples)
  if !text.isEmpty { transcripts.append(text) }
  return transcripts.joined(separator: " ")
}
/// One frame of the level meter and of the audio sent to JavaScript: 100 ms.
private let frameSamples = 1_600

/// The loudness above the room noise, as the desktop voice conversation measures it, in dB.
private struct LoudnessMeter {
  private var noise = Double.infinity
  private var peak = -Double.infinity

  /// From 0 (the room noise) to 1 (the loudest speech so far).
  mutating func loudness(_ frame: ArraySlice<Float>) -> Double {
    var sum = 0.0
    for sample in frame { sum += Double(sample) * Double(sample) }
    let db = 20 * log10(max((sum / Double(max(frame.count, 1))).squareRoot(), 1e-5))
    if db > -90 {
      noise = db < noise ? db : min(db, noise + 0.125)
      peak = max(db, peak - 0.06)
    }
    let range = max(12, peak - noise - 6)
    return min(1, max(0, (db - noise - 6) / range))
  }
}

/// The loudness that counts as speech, as on desktop.
private let speechLoudness = 0.3
/// Speech for this long starts a segment; silence for this long after it ends the segment.
private let speechStartFrames = 3
private let segmentEndFrames = 7
/// A segment this long ends even while the user speaks, so one decode stays short.
private let maximumSegmentSamples = 25 * 16_000
/// Silence before speech is kept for this long, so the first word is not cut.
private let leadingSilenceSamples = 4_800
/// How often the words of the current segment are recognized again while the user speaks.
private let interimFrames = 10

/// The microphone, converted to 16 kHz mono. In `transcribe` mode it cuts the speech into segments
/// at the user's pauses and recognizes each one with Parakeet; in `stream` mode it sends the audio.
private final class SpeechCapture {
  let queue = DispatchQueue(label: "run.openbot.speech.capture", qos: .userInitiated)
  /// Its own engine: the playback engine changes its configuration when a reply starts. Each capture
  /// makes a new one. An engine keeps the microphone format of the route it first saw, and a reply
  /// or a new route between two captures changes that format: the old engine then cannot start.
  /// Only `queue` reads and writes it.
  private(set) var engine = AVAudioEngine()
  private let target = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: captureSampleRate, channels: 1, interleaved: false)!
  private var meter = LoudnessMeter()
  private var pending: [Float] = []
  private var segment: [Float] = []
  private var loudFrames = 0
  private var quietFrames = 0
  private var spoke = false
  private var framesSinceInterim = 0
  private var interimRunning = false
  /// Each start, finish and cancel makes the work of the session before it stale.
  private(set) var session = 0
  private(set) var mode: String?

  private let recognition: DispatchQueue
  private let recognizer: () -> OfflineSpeechRecognizer?
  private let send: (String, [String: Any]) -> Void

  init(recognition: DispatchQueue, recognizer: @escaping () -> OfflineSpeechRecognizer?, send: @escaping (String, [String: Any]) -> Void) {
    self.recognition = recognition
    self.recognizer = recognizer
    self.send = send
  }

  /// Runs on `queue`.
  func start(mode: String) throws {
    stopEngine()
    session += 1
    self.mode = mode
    reset()
    meter = LoudnessMeter()
    let audio = AVAudioSession.sharedInstance()
    guard audio.recordPermission == .granted else { throw CaptureError.permission }
    try audio.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .allowBluetoothHFP, .allowBluetoothA2DP])
    try audio.setActive(true)
    allowHapticsWhileRecording()
    engine = AVAudioEngine()
    let input = engine.inputNode
    let hardware = input.inputFormat(forBus: 0)
    guard hardware.sampleRate > 0, hardware.channelCount > 0 else { throw CaptureError.noMicrophone }
    let own = session
    // A reply that plays, or a new route, changes the session between two captures, and the input
    // node can still report the format of the route before. A tap with a format that differs from
    // the hardware raises an Objective-C exception, which Swift cannot catch, and the app stops. So
    // the tap takes the format of the node itself, and the converter follows the buffers it gets.
    var converter: AVAudioConverter?
    input.installTap(onBus: 0, bufferSize: 4_096, format: nil) { [weak self] buffer, _ in
      guard let self else { return }
      if converter?.inputFormat != buffer.format { converter = AVAudioConverter(from: buffer.format, to: self.target) }
      guard let converter, let samples = self.convert(buffer, with: converter) else { return }
      self.queue.async {
        guard own == self.session else { return }
        self.receive(samples)
      }
    }
    engine.prepare()
    do {
      try engine.start()
    } catch {
      input.removeTap(onBus: 0)
      throw error
    }
  }

  /// Runs on `queue`. Recognizes the speech that is left, then sends the end after it.
  func finish() {
    guard mode != nil else { return }
    stopEngine()
    let own = session
    if mode == "transcribe" {
      if spoke { commit() }
      recognition.async { [weak self] in
        guard let self else { return }
        self.queue.async {
          guard own == self.session else { return }
          self.end(error: nil)
        }
      }
    } else {
      if !pending.isEmpty { sendAudio(pending[...]) }
      end(error: nil)
    }
  }

  /// Runs on `queue`. No event follows.
  func cancel() {
    stopEngine()
    session += 1
    mode = nil
    reset()
  }

  /// Runs on `queue`. The microphone stopped without a finish, such as for a phone call.
  func fail(_ code: String) {
    guard mode != nil else { return }
    stopEngine()
    end(error: code)
  }

  private func end(error: String?) {
    session += 1
    mode = nil
    reset()
    send("onCaptureEnd", error.map { ["error": $0] } ?? [:])
  }

  private func reset() {
    pending.removeAll()
    segment.removeAll()
    loudFrames = 0
    quietFrames = 0
    spoke = false
    framesSinceInterim = 0
  }

  private func stopEngine() {
    if engine.isRunning { engine.stop() }
    engine.inputNode.removeTap(onBus: 0)
  }

  /// Runs on the tap's thread, one buffer after another, so the converter keeps its state.
  private func convert(_ buffer: AVAudioPCMBuffer, with converter: AVAudioConverter) -> [Float]? {
    let capacity = AVAudioFrameCount(Double(buffer.frameLength) * captureSampleRate / buffer.format.sampleRate) + 1
    guard let output = AVAudioPCMBuffer(pcmFormat: target, frameCapacity: capacity) else { return nil }
    var consumed = false
    var error: NSError?
    converter.convert(to: output, error: &error) { _, status in
      if consumed {
        status.pointee = .noDataNow
        return nil
      }
      consumed = true
      status.pointee = .haveData
      return buffer
    }
    guard error == nil, let channel = output.floatChannelData?[0] else { return nil }
    return Array(UnsafeBufferPointer(start: channel, count: Int(output.frameLength)))
  }

  private func receive(_ samples: [Float]) {
    pending.append(contentsOf: samples)
    while pending.count >= frameSamples {
      let frame = pending[0..<frameSamples]
      handle(frame)
      pending.removeFirst(frameSamples)
    }
  }

  private func handle(_ frame: ArraySlice<Float>) {
    let loudness = meter.loudness(frame)
    let speaking = loudness >= speechLoudness
    send("onCaptureLevel", ["level": loudness * loudness, "speaking": speaking])
    if mode == "stream" {
      sendAudio(frame)
      return
    }
    segment.append(contentsOf: frame)
    if speaking {
      loudFrames += 1
      quietFrames = 0
      if loudFrames >= speechStartFrames { spoke = true }
    } else {
      loudFrames = 0
      quietFrames += 1
    }
    if !spoke {
      if segment.count > 2 * leadingSilenceSamples { segment.removeFirst(segment.count - leadingSilenceSamples) }
      return
    }
    framesSinceInterim += 1
    if quietFrames >= segmentEndFrames || segment.count >= maximumSegmentSamples {
      commit()
    } else if framesSinceInterim >= interimFrames && !interimRunning {
      interim()
    }
  }

  /// Recognizes the segment once more and sends it as final; the next words start a new segment.
  private func commit() {
    let samples = segment
    let own = session
    segment.removeAll()
    loudFrames = 0
    quietFrames = 0
    spoke = false
    framesSinceInterim = 0
    recognition.async { [weak self] in
      guard let self, let recognizer = self.recognizer() else { return }
      let text = recognizer.decode(samples)
      self.queue.async {
        guard own == self.session else { return }
        self.send("onCaptureText", ["text": text, "final": true])
      }
    }
  }

  /// Shows the words of the segment so far. One runs at a time, so a slow phone skips some.
  private func interim() {
    let samples = segment
    let own = session
    framesSinceInterim = 0
    interimRunning = true
    recognition.async { [weak self] in
      guard let self else { return }
      let text = self.recognizer()?.decode(samples) ?? ""
      self.queue.async {
        self.interimRunning = false
        // A final text of this segment can be on its way already; it is sent after this one.
        guard own == self.session, self.mode == "transcribe" else { return }
        self.send("onCaptureText", ["text": text, "final": false])
      }
    }
  }

  private func sendAudio(_ frame: ArraySlice<Float>) {
    var data = Data(capacity: frame.count * 2)
    for sample in frame {
      let value = Int16(max(-1, min(1, sample)) * 32_767).littleEndian
      withUnsafeBytes(of: value) { data.append(contentsOf: $0) }
    }
    send("onCaptureAudio", ["pcm": data.base64EncodedString()])
  }
}

private enum CaptureError: Error {
  case permission
  case noMicrophone
}

/// Encode the synthesized reply before it reaches the main-queue player.
private func speechWave(_ part: SpeechPart) -> Data? {
  guard !part.samples.isEmpty,
        part.samples.count <= (Int(UInt32.max) - 36) / 2,
        part.sampleRate.isFinite,
        part.sampleRate >= 1,
        part.sampleRate <= Double(UInt32.max / 2)
  else { return nil }

  let rate = UInt32(part.sampleRate)
  let bytes = UInt32(part.samples.count * 2)
  var wave = Data(capacity: Int(bytes) + 44)
  func append<T: FixedWidthInteger>(_ value: T) {
    withUnsafeBytes(of: value.littleEndian) { wave.append(contentsOf: $0) }
  }
  wave.append(contentsOf: "RIFF".utf8)
  append(bytes + 36)
  wave.append(contentsOf: "WAVEfmt ".utf8)
  append(UInt32(16))
  append(UInt16(1)) // Linear PCM.
  append(UInt16(1)) // Mono.
  append(rate)
  append(rate * 2)
  append(UInt16(2))
  append(UInt16(16))
  wave.append(contentsOf: "data".utf8)
  append(bytes)
  for sample in part.samples {
    append(Int16((sample.isFinite ? max(-1, min(1, sample)) : 0) * 32_767))
  }
  return wave
}

/// Reply synthesis uses OpenBot's model. Playback uses the output-only session used by Sled media,
/// so starting a reply does not initialize the microphone's Remote I/O on iOS.
private final class SpeechPlayer: NSObject, AVAudioPlayerDelegate {
  private struct ReplyPart {
    let id: String
    let wave: Data
    let isCurrent: () -> Bool
  }

  private var speed: Float = 1
  private var pending: [ReplyPart] = []
  private var current: (part: ReplyPart, audio: AVAudioPlayer)?
  private var originalSession: (
    AVAudioSession.Category, AVAudioSession.Mode, AVAudioSession.CategoryOptions
  )?
  private let onStart: (String) -> Void
  private let onDone: (String) -> Void
  private let onError: (String) -> Void
  let queue = DispatchQueue.main

  init(
    onStart: @escaping (String) -> Void,
    onDone: @escaping (String) -> Void,
    onError: @escaping (String) -> Void
  ) {
    self.onStart = onStart
    self.onDone = onDone
    self.onError = onError
    super.init()
  }

  func play(id: String, wave: Data, isCurrent: @escaping () -> Bool) {
    pending.append(ReplyPart(id: id, wave: wave, isCurrent: isCurrent))
    playNext()
  }

  func setSpeed(_ value: Double) {
    guard value.isFinite else { return }
    speed = Float(min(2, max(0.75, value)))
    current?.audio.rate = speed
  }

  func stop() {
    pending.removeAll()
    let audio = current?.audio
    current = nil
    audio?.delegate = nil
    audio?.stop()
    releaseSession()
  }

  private func playNext() {
    guard current == nil else { return }
    while !pending.isEmpty {
      let part = pending.removeFirst()
      guard part.isCurrent() else { continue }
      do {
        let session = AVAudioSession.sharedInstance()
        if originalSession == nil {
          originalSession = (session.category, session.mode, session.categoryOptions)
          try session.setCategory(.playback, mode: .spokenAudio)
          try session.setActive(true)
        }
        let audio = try AVAudioPlayer(data: part.wave, fileTypeHint: AVFileType.wav.rawValue)
        audio.enableRate = true
        audio.rate = speed
        audio.delegate = self
        current = (part, audio)
        if audio.play() {
          onStart(part.id)
          return
        }
        current = nil
        audio.delegate = nil
      } catch {
        releaseSession()
      }
      onError(part.id)
    }
    releaseSession()
  }

  private func releaseSession() {
    guard let (category, mode, options) = originalSession else { return }
    originalSession = nil
    let session = AVAudioSession.sharedInstance()
    guard session.category == .playback, session.mode == .spokenAudio else { return }
    try? session.setActive(false, options: .notifyOthersOnDeactivation)
    try? session.setCategory(category, mode: mode, options: options)
  }

  func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
    queue.async { [weak self, weak player] in
      guard let self, let player, let completed = self.current, completed.audio === player else { return }
      self.current = nil
      player.delegate = nil
      if completed.part.isCurrent() {
        if flag { self.onDone(completed.part.id) }
        else { self.onError(completed.part.id) }
      }
      self.playNext()
    }
  }

  func audioPlayerDecodeErrorDidOccur(_ player: AVAudioPlayer, error: Error?) {
    audioPlayerDidFinishPlaying(player, successfully: false)
  }
}

public class SpeechModule: Module {
  private let synthesis = DispatchQueue(label: "run.openbot.speech.synthesis", qos: .userInitiated)
  private var voice: SupertonicVoice?
  /// Only `recognitionQueue` reads and writes it.
  private var recognizer: OfflineSpeechRecognizer?
  private let recognitionQueue = DispatchQueue(label: "run.openbot.speech.recognition", qos: .userInitiated)
  private var observers: [NSObjectProtocol] = []
  private lazy var capture = SpeechCapture(
    recognition: recognitionQueue,
    recognizer: { [weak self] in self?.recognizer },
    send: { [weak self] name, body in self?.sendEvent(name, body) }
  )
  private let lock = NSLock()
  /// Each stop makes the parts that wait or play stale.
  private var generation = 0
  private lazy var player = SpeechPlayer(
    onStart: { [weak self] id in self?.sendEvent("onSpeechStart", ["id": id]) },
    onDone: { [weak self] id in self?.sendEvent("onSpeechDone", ["id": id]) },
    onError: { [weak self] id in self?.sendEvent("onSpeechError", ["id": id, "code": "playback-failed"]) }
  )

  private func currentGeneration() -> Int {
    lock.lock()
    defer { lock.unlock() }
    return generation
  }

  private func enqueue(_ part: SpeechPart, generation own: Int) {
    guard let wave = speechWave(part) else {
      sendEvent("onSpeechError", ["id": part.id, "code": "playback-failed"])
      return
    }
    DispatchQueue.main.async { [weak self] in
      guard let self, own == self.currentGeneration() else { return }
      self.player.play(id: part.id, wave: wave) { [weak self] in own == self?.currentGeneration() }
    }
  }

  /// Loads a recognizer on the recognition queue. The same directory and model keep the loaded one.
  private func loadRecognizer(_ directory: URL, model: OfflineSpeechRecognizer.Model, threads: Int, promise: Promise) {
    recognitionQueue.async {
      if self.recognizer?.directory == directory.path && self.recognizer?.model == model {
        promise.resolve(nil)
        return
      }
      self.recognizer = nil
      do {
        self.recognizer = try OfflineSpeechRecognizer(directory: directory.path, model: model, threads: threads)
        promise.resolve(nil)
      } catch {
        promise.reject("ERR_SPEECH_MODEL", "The speech recognition model could not load.")
      }
    }
  }

  public func definition() -> ModuleDefinition {
    Name("OpenBotSpeech")

    Events("onSpeechStart", "onSpeechDone", "onSpeechError", "onCaptureLevel", "onCaptureAudio", "onCaptureText", "onCaptureEnd")

    OnCreate {
      let center = NotificationCenter.default
      // A phone call or another app takes the microphone, or the route changes, such as headphones
      // that connect: the engine stops, and the session ends with what it heard.
      let capture = self.capture
      let stopped = { (_: Notification) in
        capture.queue.async { capture.fail("interrupted") }
      }
      observers = [
        center.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: nil) { notification in
          let type = (notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt).flatMap(AVAudioSession.InterruptionType.init)
          if type == .began { stopped(notification) }
        },
        // The notice can also come for the change that the start itself made; only a stopped engine
        // ends it. Each capture has a new engine, so the notice names the engine of the capture.
        center.addObserver(forName: .AVAudioEngineConfigurationChange, object: nil, queue: nil) { notification in
          let changed = notification.object as AnyObject?
          capture.queue.async {
            if changed === capture.engine && !capture.engine.isRunning { capture.fail("interrupted") }
          }
        },
        // About 1 GB that the next session can load again.
        center.addObserver(forName: UIApplication.didReceiveMemoryWarningNotification, object: nil, queue: nil) { [weak self] _ in
          guard let self else { return }
          capture.queue.async {
            guard capture.mode == nil else { return }
            self.recognitionQueue.async { self.recognizer = nil }
          }
        },
      ]
    }

    /// Loads Parakeet from a downloaded model directory. A second call with the same directory keeps
    /// the loaded model.
    AsyncFunction("loadRecognizer") { (directory: URL, threads: Int, promise: Promise) in
      self.loadRecognizer(directory, model: .parakeet, threads: threads, promise: promise)
    }

    /// Loads Qwen3-ASR from a downloaded model directory. A second call with the same directory keeps
    /// the loaded model.
    AsyncFunction("loadQwenRecognizer") { (directory: URL, threads: Int, promise: Promise) in
      self.loadRecognizer(directory, model: .qwen3Asr, threads: threads, promise: promise)
    }

    /// Reuses the Sled recorder's file and the selected local speech model.
    AsyncFunction("transcribeFile") { (recording: URL, directory: URL, promise: Promise) in
      self.recognitionQueue.async {
        guard recording.isFileURL, let recognizer = self.recognizer, recognizer.directory == directory.path else {
          promise.reject("ERR_SPEECH_MODEL", "The selected recognizer is no longer loaded.")
          return
        }
        do {
          promise.resolve(try transcribeRecording(recording, recognizer: recognizer))
        } catch {
          promise.reject("ERR_TRANSCRIPTION", "Could not transcribe this recording.")
        }
      }
    }

    /// Frees the recognizer, such as before its files are deleted.
    AsyncFunction("unloadRecognizer") { (promise: Promise) in
      self.recognitionQueue.async {
        self.recognizer = nil
        promise.resolve(nil)
      }
    }

    /// Opens the microphone: `transcribe` recognizes speech with Parakeet, `stream` sends the audio.
    AsyncFunction("startCapture") { (mode: String, promise: Promise) in
      let capture = self.capture
      capture.queue.async {
        do {
          try capture.start(mode: mode == "stream" ? "stream" : "transcribe")
          promise.resolve(nil)
        } catch CaptureError.permission {
          capture.cancel()
          promise.reject("ERR_CAPTURE_PERMISSION", "Microphone access is off.")
        } catch {
          capture.cancel()
          promise.reject("ERR_CAPTURE", "The microphone could not start.")
        }
      }
    }

    /// Lets haptics play while the microphone records. The phone recognizer opens its own session,
    /// which iOS starts with haptics silenced, so JavaScript calls this when that recognizer listens.
    Function("allowHapticsWhileRecording") {
      allowHapticsWhileRecording()
    }

    /// Closes the microphone, sends the text of the speech that is left, then `onCaptureEnd`.
    Function("finishCapture") {
      let capture = self.capture
      capture.queue.async { capture.finish() }
    }

    /// Closes the microphone and drops the speech that was not sent.
    Function("cancelCapture") {
      let capture = self.capture
      capture.queue.async { capture.cancel() }
    }

    /// Loads Supertonic 3 from a downloaded model directory. A second call with the same directory
    /// keeps the loaded model.
    AsyncFunction("load") { (directory: URL, threads: Int, promise: Promise) in
      self.synthesis.async {
        if self.voice?.directory == directory.path {
          promise.resolve(nil)
          return
        }
        self.voice = nil
        do {
          self.voice = try SupertonicVoice(directory: directory.path, threads: threads)
          promise.resolve(nil)
        } catch {
          promise.reject("ERR_SPEECH_MODEL", "The speech model could not load.")
        }
      }
    }

    /// The directory for downloaded voice models: Application Support, out of the backup. The phone
    /// can download the files again, so they must not fill the user's iCloud backup.
    Function("modelRoot") { () throws -> String in
      var root = try FileManager.default
        .url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        .appendingPathComponent("voice", isDirectory: true)
      try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
      var values = URLResourceValues()
      values.isExcludedFromBackup = true
      try root.setResourceValues(values)
      return root.absoluteString
    }

    /// Frees the model, such as before its files are deleted.
    AsyncFunction("unload") { (promise: Promise) in
      self.synthesis.async {
        self.voice = nil
        promise.resolve(nil)
      }
    }

    /// Reads one part of a reply with Supertonic 3 and plays it after the parts before it. The next
    /// part is synthesized while this one plays.
    Function("speak") { (id: String, text: String, language: String, speaker: Int, steps: Int) in
      let own = self.currentGeneration()
      self.synthesis.async {
        guard own == self.currentGeneration() else { return }
        guard let voice = self.voice else {
          self.sendEvent("onSpeechError", ["id": id, "code": "model-not-loaded"])
          return
        }
        guard let audio = voice.generate(text: text, language: language, speaker: speaker, steps: steps) else {
          self.sendEvent("onSpeechError", ["id": id, "code": "inference-failed"])
          return
        }
        self.enqueue(SpeechPart(id: id, samples: audio.samples, sampleRate: audio.sampleRate), generation: own)
      }
    }

    /// Plays little-endian 16-bit mono PCM, such as a reply part from ElevenLabs, after the parts before it.
    Function("playPcm") { (id: String, pcm: Uint8Array, sampleRate: Int) in
      let own = self.currentGeneration()
      // The typed array belongs to JavaScript: copy it before this call returns.
      let data = Data(bytes: pcm.rawPointer, count: pcm.byteLength)
      var samples = [Float](repeating: 0, count: data.count / 2)
      data.withUnsafeBytes { raw in
        for index in samples.indices {
          samples[index] = Float(Int16(littleEndian: raw.loadUnaligned(fromByteOffset: index * 2, as: Int16.self))) / 32_768
        }
      }
      self.enqueue(SpeechPart(id: id, samples: samples, sampleRate: Double(sampleRate)), generation: own)
    }

    /// Updates the current reply and subsequent parts without restarting playback.
    Function("setSpeed") { (speed: Double) in
      DispatchQueue.main.async { [weak self] in self?.player.setSpeed(speed) }
    }

    /// Stops the part that plays and drops the parts that wait.
    Function("stop") {
      self.lock.lock()
      self.generation += 1
      self.lock.unlock()
      DispatchQueue.main.async { [weak self] in self?.player.stop() }
    }

    OnDestroy {
      self.lock.lock()
      self.generation += 1
      self.lock.unlock()
      if Thread.isMainThread { self.player.stop() }
      else { DispatchQueue.main.sync { self.player.stop() } }
      self.synthesis.sync { self.voice = nil }
      self.observers.forEach { NotificationCenter.default.removeObserver($0) }
      let capture = self.capture
      capture.queue.sync { capture.cancel() }
      self.recognitionQueue.sync { self.recognizer = nil }
    }
  }
}

/// iOS silences haptics while an audio session records, so the detents of a hold on the mic and the
/// tick of the lock would not play while the user speaks. A failure keeps the silence; nothing else
/// depends on it.
func allowHapticsWhileRecording() {
  try? AVAudioSession.sharedInstance().setAllowHapticsAndSystemSoundsDuringRecording(true)
}
