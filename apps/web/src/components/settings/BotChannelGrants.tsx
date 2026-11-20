import { useBotChannelGrants, type ChannelGrantsProps } from "./useBotChannelGrants";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
export function BotChannelGrants(props: ChannelGrantsProps) {
  const vm = useBotChannelGrants(props);
  const disabled = vm.busy || !vm.canManage;
  return (
    <section
      className="space-y-3 rounded-md border p-3"
      aria-label="Background coding permission"
      aria-busy={vm.busy}
    >
      <p className="text-sm font-medium">Background coding permission</p>
      <p className="text-sm text-muted-foreground">
        Allow this bot to delegate a specific channel routine or bot request to Sled while you are
        away. It uses this bot's current coding destination, model and permission limits.
      </p>
      {!vm.defaults && (
        <p className="text-sm">
          Configure this bot's coding delegation before approving background work.
        </p>
      )}
      <label className="block space-y-1 text-sm">
        <span>Request source</span>
        <Select
          value={vm.kind}
          disabled={disabled}
          onValueChange={(value) => {
            if (value === "routine" || value === "agent") vm.setKind(value);
          }}
        >
          <SelectTrigger aria-label="Request source">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="routine">Channel routine</SelectItem>
            <SelectItem value="agent">Another bot</SelectItem>
          </SelectContent>
        </Select>
      </label>
      <label className="block space-y-1 text-sm">
        <span>{vm.kind === "routine" ? "Channel routine" : "Requesting bot"}</span>
        <Select
          value={vm.requester || "__none"}
          disabled={disabled}
          onValueChange={(value) => vm.setRequester(value === "__none" ? "" : (value ?? ""))}
        >
          <SelectTrigger aria-label={vm.kind === "routine" ? "Channel routine" : "Requesting bot"}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none">Choose a source</SelectItem>
            {vm.choices.map((choice) => (
              <SelectItem key={choice.id} value={choice.id}>
                {choice.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      <label className="block space-y-1 text-sm">
        <span>Expires after hours (up to 720)</span>
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
          Approve background coding
        </Button>
        <Button size="sm" variant="outline" disabled={disabled} onClick={() => void vm.refresh()}>
          Refresh permissions
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
            {grant.revoked ? "Revoked" : `Expires ${new Date(grant.expiresAt).toLocaleString()}`}
          </p>
          <p className="text-muted-foreground">
            Project {grant.defaults.projectId} · {grant.defaults.modelSelection.model} ·{" "}
            {grant.defaults.runtimeMode}
          </p>
          <Button
            size="sm"
            variant="outline"
            disabled={disabled || grant.revoked}
            onClick={() => void vm.revoke(grant.id)}
          >
            Revoke permission
          </Button>
        </div>
      ))}
    </section>
  );
}
