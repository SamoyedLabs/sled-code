import { useAuth } from "@clerk/react";
import { useState } from "react";
import { validatePersonalRelay } from "@t3tools/shared/sledConnect";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import { environmentCatalog } from "../../connection/catalog";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { resolveCloudPublicConfig } from "../../cloud/publicConfig";
import { savePersonalRelayUrl } from "../../cloud/personalRelay";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

export function PersonalRelaySettings() {
  const { userId } = useAuth();
  const config = resolveCloudPublicConfig();
  const [address, setAddress] = useState(config.relayUrl ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const save = async () => {
    setPending(true);
    setError(null);
    if (!config.clerkPublishableKey) {
      setError("Sled sign-in is not configured in this build.");
      setPending(false);
      return;
    }
    try {
      const url = await validatePersonalRelay(address, config.clerkPublishableKey);
      if (url !== config.relayUrl) {
        const result = await runAtomCommand(
          appAtomRegistry,
          environmentCatalog.removeRelayEnvironments,
          undefined,
          { reportFailure: false },
        );
        if (result._tag !== "Success") {
          setError("Could not disconnect the previous relay. Try again.");
          setPending(false);
          return;
        }
      }
      savePersonalRelayUrl(url);
      window.location.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the relay.");
      setPending(false);
    }
  };
  return (
    <section className="space-y-3 border-b pb-5 mb-4" aria-label="Personal relay">
      <label className="text-sm font-medium" htmlFor="sled-relay-url">
        Your Sled Connect relay
      </label>
      <Input
        id="sled-relay-url"
        type="url"
        autoComplete="off"
        spellCheck={false}
        value={address}
        onChange={(event) => setAddress(event.target.value)}
        placeholder="https://connect.example.com"
        aria-invalid={Boolean(error)}
        aria-describedby="sled-relay-help sled-relay-error"
      />
      <p id="sled-relay-help" className="text-xs text-muted-foreground">
        Changing relays reconnects this app. Re-add machines from the previous relay if needed.
      </p>
      {userId ? (
        <p className="text-xs text-muted-foreground">
          Your Sled user ID: <code>{userId}</code>
        </p>
      ) : null}
      <p id="sled-relay-error" role="alert" className="text-xs text-destructive">
        {error}
      </p>
      <Button size="sm" disabled={pending || !address.trim()} onClick={() => void save()}>
        {pending ? "Checking relay…" : "Save and reconnect"}
      </Button>
      <p className="text-xs text-muted-foreground">
        Background push notifications are not available with personal relays yet.
      </p>
    </section>
  );
}
