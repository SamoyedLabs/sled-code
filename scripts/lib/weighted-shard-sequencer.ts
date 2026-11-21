// @effect-diagnostics nodeBuiltinImport:off - Vitest loads this helper outside the application runtime.
import * as NodePath from "node:path";

import { BaseSequencer, type TestSpecification } from "vite-plus/test/node";

export function weightedShardSequencer(
  recordedSeconds: Readonly<Record<string, number>>,
  unrecordedFileSeconds = 0.6,
): typeof BaseSequencer {
  return class extends BaseSequencer {
    override async shard(files: TestSpecification[]) {
      const { index, count } = this.ctx.config.shard ?? { index: 1, count: 1 };
      const weighted = files
        .map((spec) => {
          const key = NodePath.relative(this.ctx.config.root, spec.moduleId).replaceAll("\\", "/");
          return { spec, key, seconds: recordedSeconds[key] ?? unrecordedFileSeconds };
        })
        .toSorted((a, b) => b.seconds - a.seconds || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

      const loads = Array.from({ length: count }, () => 0);
      const picked: TestSpecification[] = [];
      for (const file of weighted) {
        const least = Math.min(...loads);
        const lightest = loads.indexOf(least);
        loads[lightest] = least + file.seconds;
        if (lightest === index - 1) picked.push(file.spec);
      }
      return picked;
    }
  };
}
