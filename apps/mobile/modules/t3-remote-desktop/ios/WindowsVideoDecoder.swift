import AVFoundation
import VideoToolbox

/// Owned by StreamClient.queue. Synchronous decoding plus one pending presentation picture bounds retained output.
final class WindowsVideoDecoder {
    let layer = AVSampleBufferDisplayLayer()
    private let presentation = WindowsFramePresentation<CMSampleBuffer>()
    private var format: CMVideoFormatDescription?
    private var decoder: VTDecompressionSession?
    private var configuration: Data?
    private let queue: DispatchQueue
    private var epoch = UUID()
    private var flushing = false
    private var requesting = false
    private var displayCheckPending = false
    private var displayObserver: NSObjectProtocol?
    private(set) var hasReference = false

    init(queue: DispatchQueue) {
        self.queue = queue
        displayObserver = NotificationCenter.default.addObserver(
            forName: .AVSampleBufferDisplayLayerReadyForDisplayDidChange,
            object: layer, queue: .main
        ) { [weak self] _ in
            guard let self else { return }
            self.queue.async { self.checkDisplay() }
        }
    }

    deinit {
        if let displayObserver { NotificationCenter.default.removeObserver(displayObserver) }
        layer.sampleBufferRenderer.stopRequestingMediaData()
        if let decoder { VTDecompressionSessionInvalidate(decoder) }
    }

    func reset() {
        if let decoder { VTDecompressionSessionInvalidate(decoder) }
        decoder = nil; format = nil; configuration = nil
        hasReference = false
        epoch = UUID()
        let resetEpoch = epoch
        presentation.reset()
        displayCheckPending = false
        layer.sampleBufferRenderer.stopRequestingMediaData()
        requesting = false; flushing = true
        layer.sampleBufferRenderer.flush(removingDisplayedImage: true) { [weak self] in
            guard let self else { return }
            self.queue.async {
                guard self.epoch == resetEpoch else { return }
                self.flushing = false
                self.pump()
            }
        }
    }

    func configure(_ sets: ParameterSets, geometry: WindowsGeometry) -> Bool {
        if configuration == sets.encoded(), decoder != nil { return true }
        reset()
        let buffers = sets.sets.map { data -> UnsafeMutablePointer<UInt8> in
            let p = UnsafeMutablePointer<UInt8>.allocate(capacity: data.count)
            data.copyBytes(to: p, count: data.count)
            return p
        }
        defer { buffers.forEach { $0.deallocate() } }
        var desc: CMVideoFormatDescription?
        guard CMVideoFormatDescriptionCreateFromHEVCParameterSets(allocator: nil,
            parameterSetCount: buffers.count, parameterSetPointers: buffers.map { UnsafePointer($0) },
            parameterSetSizes: sets.sets.map(\.count), nalUnitHeaderLength: Int32(sets.nalUnitHeaderLength),
            extensions: nil, formatDescriptionOut: &desc) == noErr, let desc else { return false }
        let size = CMVideoFormatDescriptionGetDimensions(desc)
        guard size.width == geometry.encodedWidth, size.height == geometry.encodedHeight else { return false }
        #if targetEnvironment(simulator)
        // Simulator has no HEVC hardware decoder; physical devices remain hardware-only.
        let specification: CFDictionary? = nil
        #else
        let specification = [kVTVideoDecoderSpecification_RequireHardwareAcceleratedVideoDecoder: true] as CFDictionary
        #endif
        guard VTDecompressionSessionCreate(allocator: nil, formatDescription: desc,
            decoderSpecification: specification,
            imageBufferAttributes: nil, outputCallback: nil, decompressionSessionOut: &decoder) == noErr else { return false }
        format = desc; configuration = sets.encoded()
        return true
    }

    private final class Picture {
        let lock = NSLock()
        private var image: CVImageBuffer?
        func set(_ value: CVImageBuffer) { lock.lock(); image = value; lock.unlock() }
        func get() -> CVImageBuffer? { lock.lock(); defer { lock.unlock() }; return image }
    }

    func decode(_ data: Data, firstDisplayed: (() -> Void)? = nil) -> Bool {
        guard let decoder, let format, !data.isEmpty else { return false }
        var block: CMBlockBuffer?
        guard CMBlockBufferCreateWithMemoryBlock(allocator: nil, memoryBlock: nil, blockLength: data.count,
            blockAllocator: nil, customBlockSource: nil, offsetToData: 0, dataLength: data.count,
            flags: 0, blockBufferOut: &block) == noErr, let block else { return false }
        let copied = data.withUnsafeBytes {
            CMBlockBufferReplaceDataBytes(with: $0.baseAddress!, blockBuffer: block, offsetIntoDestination: 0, dataLength: data.count)
        }
        guard copied == noErr else { return false }
        var timing = CMSampleTimingInfo(duration: .invalid, presentationTimeStamp: .zero, decodeTimeStamp: .invalid)
        var size = data.count
        var sample: CMSampleBuffer?
        guard CMSampleBufferCreateReady(allocator: nil, dataBuffer: block, formatDescription: format,
            sampleCount: 1, sampleTimingEntryCount: 1, sampleTimingArray: &timing,
            sampleSizeEntryCount: 1, sampleSizeArray: &size, sampleBufferOut: &sample) == noErr, let sample else { return false }
        let picture = Picture()
        let result = VTDecompressionSessionDecodeFrame(decoder, sampleBuffer: sample, flags: [], infoFlagsOut: nil) {
            status, _, image, _, _ in
            if status == noErr, let image { picture.set(image) }
        }
        guard result == noErr, VTDecompressionSessionWaitForAsynchronousFrames(decoder) == noErr,
              let image = picture.get() else { return false }
        var imageFormat: CMVideoFormatDescription?
        var decoded: CMSampleBuffer?
        guard CMVideoFormatDescriptionCreateForImageBuffer(allocator: nil, imageBuffer: image,
            formatDescriptionOut: &imageFormat) == noErr, let imageFormat,
            CMSampleBufferCreateReadyWithImageBuffer(allocator: nil, imageBuffer: image,
                formatDescription: imageFormat, sampleTiming: &timing, sampleBufferOut: &decoded) == noErr,
            let decoded else { return false }
        if let attachments = CMSampleBufferGetSampleAttachmentsArray(decoded, createIfNecessary: true) as NSArray?,
           let first = attachments.firstObject as? NSMutableDictionary {
            first[kCMSampleAttachmentKey_DisplayImmediately as String] = true
        }
        hasReference = true
        guard layer.sampleBufferRenderer.status != .failed else { return false }
        presentation.offer(decoded, firstDisplayed: firstDisplayed)
        pump()
        return true
    }

    private func pump() {
        guard !flushing else { return }
        let renderer = layer.sampleBufferRenderer
        presentation.drain(ready: renderer.isReadyForMoreMediaData) { renderer.enqueue($0) }
        if presentation.hasPending {
            if !requesting {
                requesting = true
                let requestedEpoch = epoch
                renderer.requestMediaDataWhenReady(on: queue) { [weak self] in
                    guard let self, self.epoch == requestedEpoch else { return }
                    self.pump()
                }
            }
        } else if requesting {
            renderer.stopRequestingMediaData()
            requesting = false
        }
        checkDisplay()
    }

    private func checkDisplay() {
        guard !flushing, presentation.awaitingDisplay, !displayCheckPending else { return }
        displayCheckPending = true
        let observedEpoch = epoch
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            let displayable = self.layer.isReadyForDisplay
            self.queue.async {
                guard self.epoch == observedEpoch else { return }
                self.displayCheckPending = false
                guard !self.flushing, self.layer.sampleBufferRenderer.status != .failed else { return }
                self.presentation.displayChanged(ready: displayable)
            }
        }
    }
}
