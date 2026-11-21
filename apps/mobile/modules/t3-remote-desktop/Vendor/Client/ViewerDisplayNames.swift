import Foundation

final class ViewerDisplayNames {
    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) { self.defaults = defaults }

    static func normalized(_ name: String) -> String? {
        let value = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard value.count <= 80, value.utf8.count <= 320,
              value.unicodeScalars.allSatisfy({ !CharacterSet.controlCharacters.contains($0) &&
                  !CharacterSet.newlines.contains($0) }) else { return nil }
        return value
    }

    func names(for computer: String?) -> [String: String] {
        guard let key = key(for: computer), let stored = defaults.dictionary(forKey: key) else { return [:] }
        return Dictionary(uniqueKeysWithValues: stored.compactMap { output, raw in
            guard !output.isEmpty, output.utf8.count <= 2048, let name = raw as? String,
                  let normalized = Self.normalized(name), !normalized.isEmpty else { return nil }
            return (output, normalized)
        }.prefix(128))
    }

    @discardableResult
    func rename(_ output: String, on computer: String, to name: String) -> Bool {
        guard let key = key(for: computer), !output.isEmpty, output.utf8.count <= 2048,
              let value = Self.normalized(name) else { return false }
        var saved = names(for: computer)
        if value.isEmpty { saved.removeValue(forKey: output) }
        else {
            guard saved[output] != nil || saved.count < 128 else { return false }
            saved[output] = value
        }
        if saved.isEmpty { defaults.removeObject(forKey: key) }
        else { defaults.set(saved, forKey: key) }
        return true
    }

    private func key(for computer: String?) -> String? {
        guard let computer, !computer.isEmpty, computer.utf8.count <= 256 else { return nil }
        return "Sled.displayNames." + computer
    }
}
