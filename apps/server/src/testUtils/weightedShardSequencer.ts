import { weightedShardSequencer } from "../../../../scripts/lib/weighted-shard-sequencer.ts";
import shardWeights from "./shardWeights.json" with { type: "json" };

export const WeightedShardSequencer = weightedShardSequencer(shardWeights);
