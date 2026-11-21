import Foundation

/// Translates the shared viewer controls; Windows receives explicit modifier keys and wheel ticks.
public struct WindowsInputAdapter {
    private var modifiers: Set<Int> = []
    private var keys: Set<Int> = []
    private var buttons: Set<PointerAction> = []
    private var pointer = (x: 0.5, y: 0.5)
    private var remainderX = 0.0
    private var remainderY = 0.0
    public init() {}

    public mutating func events(_ input: InputEvent, geometry: WindowsGeometry) -> [WindowsInput] {
        func event(_ type: String) -> WindowsInput {
            WindowsInput(outputId: geometry.outputId, generation: geometry.generation, sequence: "0", type: type)
        }
        func key(_ usage: Int, _ down: Bool) -> WindowsInput {
            var value = event("key"); value.hidUsage = usage; value.down = down; return value
        }
        switch input {
        case let .pointer(action, x, y):
            var value = event("pointer"); value.action = action.rawValue; value.x = x; value.y = y
            guard value.valid else { return [] }
            pointer = (x, y)
            switch action {
            case .leftDown: buttons.insert(.leftDown)
            case .rightDown: buttons.insert(.rightDown)
            case .leftUp: buttons.remove(.leftDown)
            case .rightUp: buttons.remove(.rightDown)
            case .move: break
            }
            return [value]
        case let .scroll(x, y, dx, dy):
            guard dx.isFinite, dy.isFinite, abs(dx) <= 8, abs(dy) <= 8 else { return [] }
            let horizontal = -dx * geometry.sourceRect.width + remainderX
            let vertical = dy * geometry.sourceRect.height + remainderY
            let ticksX = Int(horizontal.rounded(.towardZero)), ticksY = Int(vertical.rounded(.towardZero))
            remainderX = horizontal - Double(ticksX); remainderY = vertical - Double(ticksY)
            guard ticksX != 0 || ticksY != 0 else { return [] }
            var value = event("wheel"); value.x = x; value.y = y
            value.deltaX = min(1200, max(-1200, ticksX)); value.deltaY = min(1200, max(-1200, ticksY))
            return value.valid ? [value] : []
        case let .scrollGesture(phase, _, _):
            if phase == .began { remainderX = 0; remainderY = 0 }
            return []
        case let .text(text):
            var values: [WindowsInput] = []
            var chunk = ""
            for scalar in text.unicodeScalars {
                let next = String(scalar)
                if chunk.utf8.count + next.utf8.count > 4096 {
                    var value = event("text"); value.text = chunk; values.append(value); chunk = ""
                }
                chunk += next
            }
            if !chunk.isEmpty { var value = event("text"); value.text = chunk; values.append(value) }
            return values.allSatisfy(\.valid) ? values : []
        case let .key(usage, down, flags):
            let usage = Int(usage)
            guard WindowsInput.supportsHIDUsage(usage) else { return [] }
            if (224...231).contains(usage) {
                if down { modifiers.insert(usage) } else { modifiers.remove(usage) }
                return [key(usage, down)]
            }
            var values: [WindowsInput] = []
            let mapping: [(Int, UInt64)] = [(224, 1 << 18), (225, 1 << 17), (226, 1 << 19), (227, 1 << 20)]
            for (left, mask) in mapping {
                let held = modifiers.filter { $0 == left || $0 == left + 4 }
                if flags & mask != 0, held.isEmpty { modifiers.insert(left); values.append(key(left, true)) }
                if flags & mask == 0 {
                    for old in held.sorted() { modifiers.remove(old); values.append(key(old, false)) }
                }
            }
            if down { keys.insert(usage) } else { keys.remove(usage) }
            values.append(key(usage, down))
            return values
        }
    }

    public mutating func releaseAll(geometry: WindowsGeometry) -> [WindowsInput] {
        var values: [WindowsInput] = []
        for usage in keys.sorted() + modifiers.sorted() {
            var value = WindowsInput(outputId: geometry.outputId, generation: geometry.generation, sequence: "0", type: "key")
            value.hidUsage = usage; value.down = false; values.append(value)
        }
        for down in [PointerAction.leftDown, .rightDown] where buttons.contains(down) {
            var value = WindowsInput(outputId: geometry.outputId, generation: geometry.generation, sequence: "0", type: "pointer")
            value.action = down == .leftDown ? "leftUp" : "rightUp"
            value.x = pointer.x; value.y = pointer.y; values.append(value)
        }
        self = Self()
        return values
    }

}
