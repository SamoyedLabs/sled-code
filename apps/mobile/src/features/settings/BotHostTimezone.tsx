import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { settingsCapabilities } from "@t3tools/client-runtime/openbot/settings";
import * as Schema from "effect/Schema";
import { useMemo, useRef, useState } from "react";
import { Pressable } from "react-native";
import { AppText as Text, AppTextInput } from "../../components/ui/AppText";
import { ListRowLayout } from "../../components/ui/ListRowLayout";
import { ScreenScrollView } from "../../components/ui/ScreenScrollView";
import { Sheet } from "../../components/ui/Sheet";
import { SymbolView } from "../../components/ui/AppSymbol";
import { openbot } from "../../state/openbot";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { selectionAsync } from "../bots/botFeedback";
import {
  knownTimeZones,
  matchTimeZones,
  timeZoneLabel,
} from "../bots/upstream/openbot-mobile/servers/time-zones";
import { SettingsSection } from "./components/SettingsSection";
import { T, useGT } from "gt-react-native";

type Host = { environmentId: EnvironmentId; hostId: string };
const readRequest = { operation: "settings.host-timezone.settings", parameters: {} } as const;
const TimezoneSettings = Schema.Struct({
  timezone: Schema.NullOr(Schema.String),
  systemTimezone: Schema.String,
});
const readTimezone = Schema.decodeUnknownOption(TimezoneSettings);
const matchLimit = 50;

export function BotHostTimezone(host: Host) {
  const gt = useGT();
  const { environmentId, hostId } = host;
  const [open, setOpen] = useState(false);
  const canRead = useAtomValue(
    openbot.settingsRead.permissionAtom(environmentId, { hostId, request: readRequest }),
  );
  const compatibility = useEnvironmentQuery(
    openbot.readFromHost({
      environmentId,
      input: { hostId, request: { operation: "compatibility.read" } },
    }),
  );
  const enabled = canRead && settingsCapabilities(compatibility.data).includes("host-timezone-v1");
  const query = useEnvironmentQuery(
    enabled
      ? openbot.readFromHost({ environmentId, input: { hostId, request: readRequest } })
      : null,
  );
  const decoded = readTimezone(query.data);
  if (!enabled) return null;
  const settings = decoded._tag === "Some" ? decoded.value : null;
  return (
    <SettingsSection>
      <Pressable accessibilityRole="button" onPress={() => setOpen(true)}>
        <ListRowLayout
          label={gt("Time zone")}
          detail={
            settings?.timezone
              ? timeZoneLabel(settings.timezone)
              : settings
                ? gt("Automatic")
                : undefined
          }
        />
      </Pressable>
      {open && (
        <Sheet title={gt("Time zone")} onClose={() => setOpen(false)}>
          <TimezonePicker
            {...host}
            settings={settings}
            loadError={query.error}
            loading={query.isPending}
            refresh={query.refresh}
          />
        </Sheet>
      )}
    </SettingsSection>
  );
}

function TimezonePicker({
  environmentId,
  hostId,
  settings,
  loadError,
  loading,
  refresh,
}: Host & {
  settings: typeof TimezoneSettings.Type | null;
  loadError: string | null;
  loading: boolean;
  refresh: () => void;
}) {
  const gt = useGT();
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saving = useRef(false);
  const zones = useMemo(() => knownTimeZones(), []);
  const canWrite = useAtomValue(
    openbot.adminToHost.permissionAtom(environmentId, {
      hostId,
      request: { operation: "settings.host-timezone.update", parameters: { timezone: null } },
    }),
  );
  const update = useAtomCommand(openbot.adminToHost, { reportFailure: false });
  const choose = async (timezone: string | null) => {
    if (saving.current || loading || !settings || !canWrite || timezone === settings.timezone)
      return;
    saving.current = true;
    setBusy(true);
    setError(null);
    void selectionAsync();
    await (async () => {
      const result = await update({
        environmentId,
        input: {
          hostId,
          request: { operation: "settings.host-timezone.update", parameters: { timezone } },
        },
      });
      if (result._tag === "Failure") setError(gt("The bot computer did not save the time zone."));
      refresh();
    })().finally(() => {
      saving.current = false;
      setBusy(false);
    });
  };
  const phoneZone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
  const suggestions = [
    ...new Set([settings?.timezone, phoneZone, "UTC"].filter((zone): zone is string => !!zone)),
  ];
  const matches = search.trim() ? matchTimeZones(zones, search, matchLimit) : null;
  const row = (zone: string | null, label: string, description?: string) => {
    const selected = settings?.timezone === zone;
    const disabled = !canWrite || busy || loading;
    return (
      <Pressable
        key={zone ?? "automatic"}
        accessibilityRole="button"
        accessibilityState={{ selected, disabled }}
        disabled={disabled}
        onPress={() => void choose(zone)}
      >
        <ListRowLayout
          label={label}
          description={description}
          accessory={selected ? <SymbolView name="checkmark" size={16} /> : undefined}
        />
      </Pressable>
    );
  };
  return (
    <ScreenScrollView
      keyboardShouldPersistTaps="handled"
      contentInsetAdjustmentBehavior="automatic"
      contentContainerClassName="gap-3 px-5 py-4"
    >
      {settings && (
        <AppTextInput
          accessibilityLabel={gt("Search time zones")}
          placeholder={gt("Search time zones")}
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          className="min-h-11 rounded-xl bg-grouped-card px-4"
        />
      )}
      {(error || loadError) && <Text accessibilityRole="alert">{error || loadError}</Text>}
      {!settings && !loadError && (
        <Text accessibilityRole="status">
          <T>Loading time zone…</T>
        </Text>
      )}
      {settings && (
        <SettingsSection>
          {matches === null &&
            row(null, "Automatic", `Computer time zone: ${timeZoneLabel(settings.systemTimezone)}`)}
          {(matches ?? suggestions).map((zone) =>
            row(
              zone,
              timeZoneLabel(zone),
              matches === null && zone === phoneZone ? "This iPhone" : undefined,
            ),
          )}
        </SettingsSection>
      )}
      {matches?.length === 0 && (
        <Text className="text-foreground-muted">
          <T>No matching time zones.</T>
        </Text>
      )}
      {matches?.length === matchLimit && (
        <Text className="text-foreground-muted">
          <T>Narrow your search to see more.</T>
        </Text>
      )}
      {settings && matches === null && (
        <Text className="text-foreground-muted">
          <T>Used when a bot creates a routine without specifying a time zone.</T>
        </Text>
      )}
    </ScreenScrollView>
  );
}
