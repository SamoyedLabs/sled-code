import { OpenbotError } from "@t3tools/contracts";
import type { OpenbotSettingsRequest } from "@t3tools/contracts/openbot-settings";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type * as SqlClient from "effect/sql/SqlClient";
import type { AuthenticatedSession } from "../auth/EnvironmentAuth.ts";

export const READ_ROSTER_PINS = "settings.sled-roster-pins.read";
export const SET_ROSTER_PINS = "settings.sled-roster-pins.set";

const Pins = Schema.Array(
  Schema.Struct({
    kind: Schema.Literals(["agent", "channel"]),
    id: Schema.String,
  }),
).check(Schema.isMaxLength(1000));
const PersistedPins = Schema.fromJsonString(Pins);
const decodeStoredPins = Schema.decodeUnknownEffect(PersistedPins);
const encodeStoredPins = Schema.encodeEffect(PersistedPins);
const decodePinsRequest = Schema.decodeUnknownEffect(Schema.Struct({ items: Pins }));

export const rosterPins = Effect.fn("Openbot.rosterPins")(function* (
  sql: SqlClient.SqlClient,
  session: Pick<AuthenticatedSession, "sessionId" | "proofKeyThumbprint">,
  hostId: string,
  request: OpenbotSettingsRequest,
) {
  // The upstream bridge signs in as the host owner. Keep Sled pairings' pins independent.
  const principal = session.proofKeyThumbprint
    ? `proof:${session.proofKeyThumbprint}`
    : `session:${session.sessionId}`;
  if (request.operation === READ_ROSTER_PINS) {
    const rows = yield* sql<{ readonly items: string; readonly updated_at: string }>`
      SELECT items, updated_at FROM openbot_roster_pins
      WHERE host_id = ${hostId} AND principal = ${principal}
    `;
    const row = rows[0];
    if (!row) return { items: [], updatedAt: null };
    return { items: yield* decodeStoredPins(row.items), updatedAt: row.updated_at };
  }
  if (request.operation !== SET_ROSTER_PINS)
    return yield* new OpenbotError({ message: "Unsupported roster pins operation." });
  const { items } = yield* decodePinsRequest(request.parameters);
  if (new Set(items.map((pin) => `${pin.kind}:${pin.id}`)).size !== items.length)
    return yield* new OpenbotError({ message: "Duplicate roster pin." });
  const updatedAt = DateTime.formatIso(yield* DateTime.now);
  const stored = yield* encodeStoredPins(items);
  yield* sql`
    INSERT INTO openbot_roster_pins (host_id, principal, items, updated_at)
    VALUES (${hostId}, ${principal}, ${stored}, ${updatedAt})
    ON CONFLICT(host_id, principal)
    DO UPDATE SET items = excluded.items, updated_at = excluded.updated_at
  `;
  return { items, updatedAt };
});
