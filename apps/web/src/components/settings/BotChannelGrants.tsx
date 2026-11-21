import { useBotChannelGrants, type ChannelGrantsProps } from "./useBotChannelGrants";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { T, Var, useGT } from "gt-react";
export function BotChannelGrants(props: ChannelGrantsProps) {
  const gt = useGT();
  const vm = useBotChannelGrants(props);
  const disabled = vm.busy || !vm.canManage;
  return (
    <section
      className="space-y-3 rounded-md border p-3"
      aria-label={gt("Background coding permission")}
      aria-busy={vm.busy}
    >
      <p className="text-sm font-medium">
        <T>Background coding permission</T>
      </p>
      <p className="text-sm text-muted-foreground">
        <T>
          Allow this bot to delegate a specific channel routine or bot request to Sled while you are
          away. It uses this bot's current coding destination, model and permission limits.
        </T>
      </p>
      {!vm.defaults && (
        <p className="text-sm">
          <T>Configure this bot's coding delegation before approving background work.</T>
        </p>
      )}
      <label className="block space-y-1 text-sm">
        <span>
          <T>Request source</T>
        </span>
        <Select
          value={vm.kind}
          disabled={disabled}
          onValueChange={(value) => {
            if (value === "routine" || value === "agent") vm.setKind(value);
          }}
        >
          <SelectTrigger aria-label={gt("Request source")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="routine">
              <T>Channel routine</T>
            </SelectItem>
            <SelectItem value="agent">
              <T>Another bot</T>
            </SelectItem>
          </SelectContent>
        </Select>
      </label>
      <label className="block space-y-1 text-sm">
        <span>{vm.kind === "routine" ? gt("Channel routine") : gt("Requesting bot")}</span>
        <Select
          value={vm.requester || "__none"}
          disabled={disabled}
          onValueChange={(value) => vm.setRequester(value === "__none" ? "" : (value ?? ""))}
        >
          <SelectTrigger
            aria-label={vm.kind === "routine" ? gt("Channel routine") : gt("Requesting bot")}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none">
              <T>Choose a source</T>
            </SelectItem>
            {vm.choices.map((choice) => (
              <SelectItem key={choice.id} value={choice.id}>
                {choice.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      <label className="block space-y-1 text-sm">
        <span>
          <T>Expires after hours (up to 720)</T>
        </span>
        <Input
          type="number"
          min={1}
          max={720}
          value={vm.hours}
          disabled={disabled}
          onChange={(event) => vm.setHours(event.target.value)}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={disabled || !vm.valid || !vm.defaults} onClick={vm.approve}>
          <T>Approve background coding</T>
        </Button>
        <Button size="sm" variant="outline" disabled={disabled} onClick={() => void vm.refresh()}>
          <T>Refresh permissions</T>
        </Button>
      </div>
      {vm.error && (
        <p role="alert" className="text-sm text-destructive">
          {vm.error}
        </p>
      )}
      {vm.grants.map((grant) => (
        <div key={grant.id} className="space-y-1 text-sm">
          <p>
            {grant.requesterKind}: {grant.requesterId} ·{" "}
            {grant.revoked
              ? gt("Revoked")
              : gt("Expires {value}", { value: new Date(grant.expiresAt).toLocaleString() })}
          </p>
          <p className="text-muted-foreground">
            <T>
              Project <Var>{grant.defaults.projectId}</Var> ·{" "}
              <Var>{grant.defaults.modelSelection.model}</Var> ·<Var> </Var>
              <Var>{grant.defaults.runtimeMode}</Var>
            </T>
          </p>
          <Button
            size="sm"
            variant="outline"
            disabled={disabled || grant.revoked}
            onClick={() => void vm.revoke(grant.id)}
          >
            <T>Revoke permission</T>
          </Button>
        </div>
      ))}
    </section>
  );
}
