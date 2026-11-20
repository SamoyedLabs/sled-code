import { OpenbotChannelGrant } from "@t3tools/contracts/openbotChannelGrants";
import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
const decode = Schema.decodeUnknownOption(Schema.Array(OpenbotChannelGrant));
export function channelGrantList(value: unknown) {
  return Option.getOrElse(decode(value), () => []);
}
