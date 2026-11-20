const NodeFS = require("node:fs");
const NodePath = require("node:path");

/** Restore the accepted bundle's local framework links after electron-builder copies extraResources. */
module.exports = function restoreBundledRuntime(source, destination) {
  const sourceRoot = NodeFS.realpathSync(source);
  const destinationRoot = NodeFS.realpathSync(destination);
  if (sourceRoot === destinationRoot)
    throw new Error("Bundled runtime source and output must differ");
  function walk(from, to) {
    for (const entry of NodeFS.readdirSync(from, { withFileTypes: true })) {
      const original = NodePath.join(from, entry.name);
      const output = NodePath.join(to, entry.name);
      if (entry.isSymbolicLink()) {
        const target = NodeFS.readlinkSync(original);
        const resolved = NodeFS.realpathSync(original);
        const relative = NodePath.relative(sourceRoot, resolved);
        if (
          NodePath.isAbsolute(target) ||
          relative === ".." ||
          relative.startsWith(`..${NodePath.sep}`) ||
          NodePath.isAbsolute(relative)
        )
          throw new Error(
            "Bundled runtime links must be relative and stay inside the accepted app",
          );
        if (!NodeFS.lstatSync(output).isSymbolicLink())
          throw new Error("Bundled runtime symlink was replaced with a regular entry");
        if (NodeFS.readlinkSync(output) !== target) {
          NodeFS.unlinkSync(output);
          NodeFS.symlinkSync(target, output);
        }
      } else if (entry.isDirectory()) walk(original, output);
    }
  }
  walk(sourceRoot, destinationRoot);
};
