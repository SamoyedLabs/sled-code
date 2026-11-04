import { useRef, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { botModelVisibility } from "@t3tools/client-runtime/openbot/presentation";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { openbot } from "../../state/openbot";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Input } from "../ui/input";

export function BotModelVisibility({
  environmentId,
  hostId,
  provider,
  onChange,
}: {
  environmentId: EnvironmentId;
  hostId: string;
  provider: string;
  onChange: () => void;
}) {
  const allowed = useAtomValue(
    openbot.adminToHost.permissionAtom(environmentId, {
      hostId,
      request: { operation: "provider.modelVisibility.read", provider },
    }),
  );
  const admin = useAtomCommand(openbot.adminToHost, { reportFailure: false });
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<ReturnType<typeof botModelVisibility>>(null);
  const [draft, setDraft] = useState<readonly string[] | null>(null);
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(50);
  const selected = draft ?? settings?.shown ?? [];
  const filtered =
    settings?.models.filter((model) =>
      `${model.id} ${model.name}`.toLowerCase().includes(search.trim().toLowerCase()),
    ) ?? [];
  const run = async (shown?: readonly string[] | null) => {
    if (lock.current || !allowed) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    const result = await admin({
      environmentId,
      input: {
        hostId,
        request:
          shown === undefined
            ? { operation: "provider.modelVisibility.read", provider }
            : { operation: "provider.modelVisibility.update", provider, shown },
      },
    });
    if (result._tag === "Failure") setError(String(squashAtomCommandFailure(result)));
    else {
      const value = botModelVisibility(result.value, provider);
      if (!value) setError("This engine returned unsupported model visibility settings.");
      else {
        setSettings(value);
        setDraft(null);
        if (shown !== undefined) onChange();
      }
    }
    setBusy(false);
    lock.current = false;
  };
  return (
    <section className="space-y-3" aria-label="Models shown in bot pickers" aria-busy={busy}>
      <h5 className="text-sm font-medium">Models shown in pickers</h5>
      <Button variant="outline" size="sm" disabled={!allowed || busy} onClick={() => void run()}>
        Load model visibility
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {settings && (
        <>
          <p className="text-sm text-muted-foreground">
            {selected.length} selected · {settings.models.length} available. This changes this bot
            host's model pickers.
          </p>
          <Input
            aria-label="Filter bot models"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setLimit(50);
            }}
            placeholder="Filter by name or model ID"
          />
          {filtered.slice(0, limit).map((model) => (
            <label key={model.id} className="flex items-start gap-2 text-sm">
              <Checkbox
                checked={selected.includes(model.id)}
                disabled={!allowed || busy}
                onCheckedChange={(checked) =>
                  setDraft(
                    checked === true
                      ? [...selected, model.id]
                      : selected.filter((id) => id !== model.id),
                  )
                }
              />
              <span className="min-w-0 break-all">
                {model.name}
                <span className="block text-xs text-muted-foreground">{model.id}</span>
              </span>
            </label>
          ))}
          {filtered.length === 0 && (
            <p className="text-sm text-muted-foreground">No models match.</p>
          )}
          {filtered.length > limit && (
            <Button variant="ghost" size="sm" onClick={() => setLimit(limit + 50)}>
              Show more models
            </Button>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={!allowed || busy || draft === null}
              onClick={() => void run(selected)}
            >
              Save model visibility
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!allowed || busy || !settings.changed}
              onClick={() => void run(null)}
            >
              Restore host defaults
            </Button>
            {draft !== null && (
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => setDraft(null)}>
                Discard selection
              </Button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
