/* oxlint-disable shadcn/no-unknown-classes -- Original RoutineResultDestinationField source selectors and saved unavailable choice behavior. */
import * as Schema from "effect/Schema";
import { SourceSelect } from "../provider/SourceSelect";
import { rt } from "./routine-text";
const Place = Schema.Struct({ id: Schema.String, name: Schema.String });
const Connection = Schema.Struct({
  connectionId: Schema.String,
  platform: Schema.Literals(["slack", "discord", "telegram"]),
  connectionName: Schema.String,
  places: Schema.Array(Place),
  placesFailed: Schema.Boolean,
});
const Destination = Schema.Struct({
  connectionId: Schema.String,
  platform: Schema.Literals(["slack", "discord", "telegram"]),
  connectionName: Schema.String,
  placeId: Schema.String,
  placeName: Schema.String,
});
export const decodeResultOptions = Schema.decodeUnknownSync(
  Schema.Struct({ connections: Schema.Array(Connection) }),
);
export const decodeResultDestination = Schema.decodeUnknownSync(
  Schema.Struct({ destination: Schema.NullOr(Destination) }),
);
export interface RoutineResultChoice {
  connectionId: string;
  placeId: string;
  placeName: string;
}
const placeKey = (choice: { connectionId: string; placeId: string }) =>
  `${encodeURIComponent(choice.connectionId)}/${encodeURIComponent(choice.placeId)}`;
export function RoutineResultDestinationField({
  options,
  saved,
  value,
  onChange,
  disabled,
}: {
  options: (typeof Connection.Type)[] | ReadonlyArray<typeof Connection.Type>;
  saved: typeof Destination.Type | null;
  value: RoutineResultChoice | null;
  onChange: (choice: RoutineResultChoice | null) => void;
  disabled: boolean;
}) {
  const offered = options.flatMap((connection) =>
    connection.places.map((place) => ({
      key: placeKey({ connectionId: connection.connectionId, placeId: place.id }),
      choice: { connectionId: connection.connectionId, placeId: place.id, placeName: place.name },
      connectionName: connection.connectionName,
      available: true,
    })),
  );
  const entries =
    saved && !offered.some((entry) => entry.key === placeKey(saved))
      ? [
          ...offered,
          {
            key: placeKey(saved),
            choice: {
              connectionId: saved.connectionId,
              placeId: saved.placeId,
              placeName: saved.placeName,
            },
            connectionName: saved.connectionName,
            available: false,
          },
        ]
      : offered;
  const selected = value ? placeKey(value) : "none";
  return (
    <div className="settings-field">
      <span>{rt("routine.settings.resultDestination")}</span>
      <SourceSelect
        label={rt("routine.settings.resultDestination")}
        disabled={disabled}
        value={selected}
        onChange={(key) => {
          if (key !== selected)
            onChange(entries.find((entry) => entry.key === key)?.choice ?? null);
        }}
        options={[
          { id: "none", name: rt("routine.settings.resultDestination.none") },
          ...entries.map((entry) => {
            const place = rt("routine.settings.resultDestination.place", {
              connection: entry.connectionName,
              place: entry.choice.placeName,
            });
            return {
              id: entry.key,
              name: entry.available
                ? place
                : rt("routine.settings.resultDestination.unavailable", { place }),
            };
          }),
        ]}
      />
      {options
        .filter((connection) => connection.placesFailed)
        .map((connection) => (
          <p
            key={connection.connectionId}
            className="ui-text"
            data-variant="caption"
            data-tone="muted"
          >
            {rt("routine.settings.resultDestination.placesFailed", {
              connection: connection.connectionName,
            })}
          </p>
        ))}
    </div>
  );
}
