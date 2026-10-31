import AppKit

/// Lives in the streaming helper, so controls remain available after Electron quits.
@MainActor
final class RemoteDesktopStatusItem: NSObject {
    private let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
    private var sharing: [String: Bool] = [:]
    private var lifecycle = "with-t3"
    private var guiActive = true
    private var online = false

    override init() {
        super.init()
        item.button?.image = NSImage(systemSymbolName: "desktopcomputer", accessibilityDescription: "T3 Remote Desktop")
        item.button?.image?.isTemplate = true
        item.button?.toolTip = "T3 Code Remote Desktop"
        rebuild()
    }
    func update(setting: String, enabled: Bool) { sharing[setting] = enabled; rebuild() }
    func update(lifecycle: String) { self.lifecycle = lifecycle; rebuild() }
    func update(guiActive: Bool) { self.guiActive = guiActive; rebuild() }
    func update(online: Bool) { self.online = online; rebuild() }
    private func action(_ title: String, _ command: String, key: String? = nil, checked: Bool? = nil) -> NSMenuItem {
        let row = NSMenuItem(title: title, action: #selector(invoke(_:)), keyEquivalent: "")
        row.target = self
        row.representedObject = ["action": command, "key": key ?? ""]
        if let checked { row.state = checked ? .on : .off }
        return row
    }
    private func group(_ title: String, rows: [NSMenuItem]) -> NSMenuItem {
        let row = NSMenuItem(title: title, action: nil, keyEquivalent: "")
        let submenu = NSMenu(); rows.forEach { submenu.addItem($0) }; row.submenu = submenu
        return row
    }
    private func rebuild() {
        let menu = NSMenu()
        let title = NSMenuItem(title: "T3 Code · Remote Desktop", action: nil, keyEquivalent: "")
        title.isEnabled = false; menu.addItem(title)
        let status = NSMenuItem(title: online ? "● Ready to connect" : "Starting…", action: nil, keyEquivalent: "")
        status.isEnabled = false; menu.addItem(status)
        let mode = NSMenuItem(title: lifecycle == "persistent" ? "Persistent · available after T3 quits" : "Available while T3 Code is running", action: nil, keyEquivalent: "")
        mode.isEnabled = false; menu.addItem(mode)
        menu.addItem(.separator())
        menu.addItem(action("Open T3 Code", "open"))
        let pair = action("Pair iPhone or iPad…", "pair"); pair.isEnabled = online; menu.addItem(pair)
        menu.addItem(action("Cancel pairing", "cancel-pairing"))
        menu.addItem(.separator())
        menu.addItem(group("Sharing", rows: [
            action("Clipboard sharing", "setting", key: "clipboard", checked: sharing["clipboard"] ?? true),
            action("Mac audio", "setting", key: "audio", checked: sharing["audio"] ?? true),
            action("Virtual displays", "setting", key: "virtual-display", checked: sharing["virtual-display"] ?? true)
        ]))
        menu.addItem(group("Connections", rows: [
            action("Remote connections", "setting", key: "remote", checked: sharing["remote"] ?? true),
            action("Internet access", "setting", key: "internet", checked: sharing["internet"] ?? true),
            action("Peer-to-peer wireless", "setting", key: "direct-wireless", checked: sharing["direct-wireless"] ?? false)
        ]))
        menu.addItem(action("Settings & permissions…", "settings"))
        menu.addItem(.separator())
        menu.addItem(action("Stop Remote Desktop", "disable"))
        if guiActive { menu.addItem(action("Quit T3 Code", "quit-ui")) }
        item.menu = menu
    }
    @objc private func invoke(_ sender: NSMenuItem) {
        guard let values = sender.representedObject as? [String: String], let action = values["action"] else { return }
        var message: [String: Any] = ["type": "agent-action", "action": action]
        if action == "setting", let key = values["key"] {
            message["key"] = key; message["value"] = !(sharing[key] ?? false)
        }
        event(message)
    }
    func showPairing(code: String) {
        let alert = NSAlert()
        alert.messageText = "Pair iPhone or iPad"
        alert.informativeText = "Pairing code: \(code)\n\nEnter this temporary code in T3 Code on your device."
        alert.addButton(withTitle: "Done")
        NSApp.activate(ignoringOtherApps: true)
        alert.runModal()
    }
}
