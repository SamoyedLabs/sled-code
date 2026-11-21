import SwiftUI

/// Both layouts own this pane; only the renderer and generation-bound input differ by host.
struct StreamPicture: View {
    @ObservedObject var client: StreamClient
    let overlay: InputOverlayProxy
    @Binding var keyboardShown: Bool
    let latched: KeyModifiers
    let consumed: () -> Void

    var body: some View {
        let session = client.viewerInputSession
        if session.renderer == .windowsHEVC {
            WindowsStreamSurface(client: client, geometry: session.geometry, fitToken: client.windowsFitToken,
                                 followCursor: client.windowsFollowCursor,
                                 keyboard: overlay, keyboardShown: $keyboardShown, pointer: client.windowsPointer,
                                 latched: latched, consumed: consumed)
                .overlay {
                    if !session.inputReady {
                        Label("Waiting for the monitor...", systemImage: "display")
                            .font(.footnote)
                            .foregroundStyle(Palette.muted)
                            .padding(12)
                            .allowsHitTesting(false)
                    }
                }
        } else {
            ZStack {
                StreamView(client: client)
                InputOverlay(videoSize: client.videoSize,
                             send: { client.sendViewerInput($0, captured: session) },
                             setOwnPointer: { client.setViewerPointer($0, from: $1) },
                             proxy: overlay, isKeyboardShown: $keyboardShown,
                             latchedModifiers: latched, onModifiersConsumed: consumed,
                             sendGesture: { client.sendGesture($0, fingers: $1) })
            }
        }
    }
}
