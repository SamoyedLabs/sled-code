import AVFoundation
import Foundation
import Speech

func emit(_ value: [String: String]) {
    let data = try! JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    FileHandle.standardOutput.write(data + Data([10]))
}

enum VoiceError: LocalizedError {
    case unavailable, unsupportedLanguage, recordingFailed
    var errorDescription: String? {
        switch self {
        case .unavailable: "Voice input requires a supported Mac with macOS 26 or later."
        case .unsupportedLanguage: "Apple transcription does not support this language."
        case .recordingFailed: "Could not record from the microphone."
        }
    }
}

@MainActor
final class Recording: NSObject, AVAudioRecorderDelegate {
    private var recorder: AVAudioRecorder?
    private var meteringTask: Task<Void, Never>?
    private var completion: CheckedContinuation<Void, any Error>?

    func capture(to url: URL) async throws {
        let recorder = try AVAudioRecorder(url: url, settings: [
            AVFormatIDKey: kAudioFormatLinearPCM,
            AVSampleRateKey: 24000,
            AVNumberOfChannelsKey: 1,
            AVLinearPCMBitDepthKey: 16,
            AVLinearPCMIsFloatKey: false,
            AVLinearPCMIsBigEndianKey: false,
        ])
        self.recorder = recorder
        recorder.delegate = self
        recorder.isMeteringEnabled = true
        defer { meteringTask?.cancel(); meteringTask = nil; recorder.stop(); self.recorder = nil }
        try await withCheckedThrowingContinuation { continuation in
            completion = continuation
            guard recorder.record(forDuration: 300) else {
                finish(.failure(VoiceError.recordingFailed))
                return
            }
            emit(["phase": "recording"])
            meteringTask = Task {
                while !Task.isCancelled && recorder.isRecording {
                    recorder.updateMeters()
                    let decibels = max(-60, min(0, recorder.averagePower(forChannel: 0)))
                    // Desktop microphones need speech-range gain; linear amplitude barely moves the bars.
                    let level = max(0, min(1, (Double(decibels) + 50) / 30))
                    emit(["phase": "recording", "level": String(level)])
                    try? await Task.sleep(for: .milliseconds(80))
                }
            }
            // stdin is blocking; keep it off the actor that delivers recorder callbacks.
            Task.detached { [weak self] in
                _ = readLine()
                await self?.stop()
            }
        }
    }

    func stop() {
        recorder?.stop()
        finish(.success(()))
    }

    private func finish(_ result: Result<Void, any Error>) {
        completion?.resume(with: result)
        completion = nil
    }

    nonisolated func audioRecorderDidFinishRecording(_ recorder: AVAudioRecorder, successfully flag: Bool) {
        Task { @MainActor in
            finish(flag ? .success(()) : .failure(VoiceError.recordingFailed))
        }
    }

    nonisolated func audioRecorderEncodeErrorDidOccur(_ recorder: AVAudioRecorder, error: (any Error)?) {
        Task { @MainActor in finish(.failure(VoiceError.recordingFailed)) }
    }
}

@available(macOS 26.0, *)
func transcribe(_ url: URL, with transcriber: SpeechTranscriber) async throws -> String {
    let file = try AVAudioFile(forReading: url)
    let analyzer = SpeechAnalyzer(modules: [transcriber])
    async let text = transcriber.results.reduce(into: "") { result, segment in
        result += String(segment.text.characters)
    }
    do {
        _ = try await analyzer.analyzeSequence(from: file)
        try await analyzer.finalizeAndFinishThroughEndOfInput()
        return try await text.trimmingCharacters(in: .whitespacesAndNewlines)
    } catch {
        await analyzer.cancelAndFinishNow()
        throw error
    }
}

@main
struct VoiceInput {
    @MainActor static func main() async {
        do {
            guard #available(macOS 26.0, *), SpeechTranscriber.isAvailable else {
                throw VoiceError.unavailable
            }
            let arguments = Array(CommandLine.arguments.dropFirst())
            let localeName = arguments.count > 1 ? arguments[1] : Locale.current.identifier
            guard let locale = await SpeechTranscriber.supportedLocale(equivalentTo: Locale(identifier: localeName)) else {
                throw VoiceError.unsupportedLanguage
            }
            if arguments.first == "--available" {
                emit(["phase": "available", "locale": locale.identifier])
                return
            }
            let transcriber = SpeechTranscriber(locale: locale, preset: .transcription)
            emit(["phase": "preparing"])
            if let request = try await AssetInventory.assetInstallationRequest(supporting: [transcriber]) {
                try await request.downloadAndInstall()
            }
            let url: URL
            if arguments.first == "--transcribe", arguments.count == 3 {
                url = URL(fileURLWithPath: arguments[2])
            } else if arguments.first == "--record", arguments.count == 3 {
                url = URL(fileURLWithPath: arguments[2])
                try await Recording().capture(to: url)
            } else {
                throw VoiceError.recordingFailed
            }
            emit(["phase": "transcribing"])
            let text = try await transcribe(url, with: transcriber)
            emit(["phase": "complete", "text": text, "locale": locale.identifier])
        } catch {
            emit(["phase": "error", "error": error.localizedDescription])
            exit(1)
        }
    }
}
