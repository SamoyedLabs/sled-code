// Modified for T3 Code remote desktop; based on Sill 6c5b5d249602ad60ebda79d384698909f2c5e7d7 (Apache-2.0). See MODIFICATIONS.md.
import SwiftUI
import UIKit

/// The clipboard's chip over the stream (docs/clipboard-plan.md): "Paste on ‹Mac›", then press ⌘V
/// there, with the system's Paste button and Dismiss; for a moment after a Paste, its note in the same
/// place. Offered by StreamClient (`clipboardChip`, ClipboardPolicy.offersChip); placed and hidden by
/// StreamScreen. Takes no touch outside itself.
struct ClipboardChip: View {
    @ObservedObject var client: StreamClient

    private var mac: String { client.clipboardHostName }

    var body: some View {
        ZStack(alignment: .trailing) {
            if let note = client.clipboardNote {
                noteView(note)
                    .transition(.opacity)
            } else if client.clipboardChip {
                chip
                    .transition(.opacity)
            }
        }
        .dynamicTypeSize(...DynamicTypeSize.xxLarge)
        .animation(.easeOut(duration: 0.2), value: client.clipboardChip)
        .animation(.easeOut(duration: 0.2), value: client.clipboardNote)
    }

    private var chip: some View {
        HStack(spacing: 10) {
            Image(systemName: "doc.on.clipboard")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(Palette.muted)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 1) {
                Text(ClipboardPolicy.Copy.chipTitle(mac: mac))
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(Palette.text)
                    .lineLimit(1)
                    .truncationMode(.middle)
                Text(ClipboardPolicy.Copy.chipSubtitle(pasteKey: client.clipboardPasteKey))
                    .font(.caption)
                    .foregroundStyle(Palette.muted)
                    .lineLimit(1)
            }
            .layoutPriority(-1)
            // One element for the words; the Paste button and Dismiss are their own.
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(ClipboardPolicy.Copy.chipSpoken(mac: mac, device: StreamClient.deviceWord, pasteKey: client.clipboardPasteKey))
            .accessibilityAddTraits(.isStaticText)
            ClipboardPasteButton(client: client)
            Button(action: { client.dismissClipboardChip() }) {
                Image(systemName: "xmark")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(Palette.muted)
                    .frame(width: 32, height: 32)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(ClipboardPolicy.Copy.dismiss)
        }
        .padding(.leading, 14)
        .padding(.trailing, 6)
        .padding(.vertical, 6)
        .background(Capsule(style: .continuous).fill(Palette.bar))
        .overlay(Capsule(style: .continuous).strokeBorder(Palette.edge.opacity(0.10), lineWidth: 1))
        .shadow(color: .black.opacity(0.45), radius: 16, x: 0, y: 8)
        .accessibilityElement(children: .contain)
    }

    private func noteView(_ note: ClipboardNote) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Image(systemName: note.warning ? "exclamationmark.triangle.fill" : "checkmark.circle.fill")
                .foregroundStyle(note.warning ? Color.orange : Palette.accent)
                .accessibilityHidden(true)
            Text(note.text)
                .foregroundStyle(Palette.text)
                .fixedSize(horizontal: false, vertical: true)
        }
        .font(.footnote)
        .padding(.horizontal, 14)
        .padding(.vertical, 9)
        .background(Capsule(style: .continuous).fill(Palette.bar))
        .overlay(Capsule(style: .continuous).strokeBorder(Palette.edge.opacity(0.10), lineWidth: 1))
        .shadow(color: .black.opacity(0.45), radius: 16, x: 0, y: 8)
        .allowsHitTesting(false)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(note.spoken)
        .accessibilityAddTraits(.isStaticText)
    }
}

/// The system's Paste button (SwiftUI's PasteButton, UIPasteControl): the person's tap reads this
/// device's clipboard without iOS asking, and what it read goes to the Mac (`sendClipboard`). Disabled
/// by the system while the clipboard has no text. Its label is the system's ("Paste").
struct ClipboardPasteButton: View {
    @ObservedObject var client: StreamClient

    var body: some View {
        ClipboardPasteControl { client.sendClipboard($0) }
            .fixedSize()
            .accessibilityHint(ClipboardPolicy.Copy.pasteHint(mac: client.clipboardHostName,
                                                              device: StreamClient.deviceWord))
    }
}

private struct ClipboardPasteControl: UIViewRepresentable {
    let onPaste: ([String]) -> Void

    func makeUIView(context: Context) -> ClipboardPasteTarget { ClipboardPasteTarget(onPaste: onPaste) }
    func updateUIView(_ view: ClipboardPasteTarget, context: Context) { view.onPaste = onPaste }
}

private final class ClipboardPasteTarget: UIView {
    var onPaste: ([String]) -> Void
    private let control: UIPasteControl

    init(onPaste: @escaping ([String]) -> Void) {
        self.onPaste = onPaste
        let configuration = UIPasteControl.Configuration()
        configuration.displayMode = .iconAndLabel
        configuration.cornerStyle = .capsule
        configuration.baseBackgroundColor = UIColor(Palette.accent)
        configuration.baseForegroundColor = .white
        control = UIPasteControl(configuration: configuration)
        super.init(frame: .zero)
        pasteConfiguration = UIPasteConfiguration(forAccepting: NSString.self)
        control.target = self
        control.translatesAutoresizingMaskIntoConstraints = false
        addSubview(control)
        NSLayoutConstraint.activate([
            control.leadingAnchor.constraint(equalTo: leadingAnchor),
            control.trailingAnchor.constraint(equalTo: trailingAnchor),
            control.topAnchor.constraint(equalTo: topAnchor),
            control.bottomAnchor.constraint(equalTo: bottomAnchor),
        ])
    }

    required init?(coder: NSCoder) { nil }

    override var intrinsicContentSize: CGSize {
        let size = control.intrinsicContentSize
        return CGSize(width: max(88, size.width), height: max(44, size.height))
    }

    override func paste(itemProviders: [NSItemProvider]) {
        guard let provider = itemProviders.first(where: { $0.canLoadObject(ofClass: NSString.self) }) else { return }
        provider.loadObject(ofClass: NSString.self) { [weak self] object, error in
            guard error == nil, let text = object as? String else { return }
            DispatchQueue.main.async { self?.onPaste([text]) }
        }
    }
}
