// Queue-owned presentation state; the first picture must survive renderer backpressure.
final class WindowsFramePresentation<Sample> {
    private var pending: Sample?
    private var firstDisplayed: (() -> Void)?
    private var enqueued = false

    func reset() { pending = nil; firstDisplayed = nil; enqueued = false }

    func offer(_ sample: Sample, firstDisplayed: (() -> Void)?) {
        if self.firstDisplayed != nil { return }
        pending = sample
        self.firstDisplayed = firstDisplayed
    }

    var awaitingDisplay: Bool { enqueued && firstDisplayed != nil }

    var hasPending: Bool { pending != nil }

    func drain(ready: Bool, enqueue: (Sample) -> Void) {
        guard ready, let sample = pending else { return }
        pending = nil
        enqueue(sample)
        enqueued = true
    }

    func displayChanged(ready: Bool) {
        guard ready, enqueued, let completed = firstDisplayed else { return }
        firstDisplayed = nil
        completed()
    }
}
