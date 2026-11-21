import { IMPORT_INSTRUCTIONS } from "@t3tools/client-runtime/openbot/agent-import";
import { randomUUID } from "../../lib/utils";
import { useSyncExternalStore } from "react";
import type { AgentImportController } from "@t3tools/client-runtime/openbot/agent-import";
import { Button } from "../ui/button";
export function BotAgentImport({
  controller: c,
  destination,
}: {
  controller: AgentImportController;
  destination: string;
}) {
  const s = useSyncExternalStore(c.subscribe, c.snapshot, c.snapshot);
  const locked = s.busy || s.uncertain || s.receipt?.state !== "staged";
  return (
    <section aria-label="Import agents" aria-busy={s.busy} className="space-y-3 rounded border p-3">
      <h3>Import agents</h3>
      <p>
        Use these upstream instructions to prepare an export. Sled uploads the selected ZIP to the
        destination host; keep it within 100 MiB.
      </p>
      {IMPORT_INSTRUCTIONS.map((instruction) => (
        <details key={instruction.id}>
          <summary>{instruction.label} export instructions</summary>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap">{instruction.text}</pre>
          <a
            download={instruction.name}
            href={`data:text/markdown;charset=utf-8,${encodeURIComponent(instruction.text)}`}
          >
            Save {instruction.label} export instructions
          </a>
        </details>
      ))}
      <p>
        Destination: {destination}. Creates new agents; accounts and provider credentials are not
        imported.
      </p>
      <Button disabled={s.busy} onClick={() => void c.refresh()}>
        Recover / refresh import
      </Button>
      <label className="block">
        Agent export ZIP (up to 100 MiB)
        <input
          type="file"
          accept=".zip,application/zip"
          disabled={s.busy || s.uncertain || (!!s.receipt && s.receipt.state !== "discarded")}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            if (file)
              void c.stage({ name: file.name, size: file.size, source: file }, randomUUID());
            event.currentTarget.value = "";
          }}
        />
      </label>
      {s.receipt && (
        <>
          <p>
            Status: {s.receipt.state} · Source: {s.receipt.preview.sourceApp}
          </p>
          <fieldset disabled={locked}>
            <legend>Choose agents</legend>
            {s.receipt.preview.agents.map((agent) => (
              <label className="block py-2" key={agent.key}>
                <input
                  type="checkbox"
                  checked={s.keys.includes(agent.key)}
                  onChange={() => c.select("keys", agent.key)}
                />{" "}
                {agent.name}
                {agent.nameExists ? " (name already exists)" : ""}: {agent.skillCount} skills,{" "}
                {agent.routineCount} routines, {agent.memoryCount} memories, {agent.fileCount} files
                <p>{agent.description}</p>
              </label>
            ))}
          </fieldset>
          <fieldset disabled={locked}>
            <legend>Choose group chats</legend>
            {s.receipt.preview.channels.map((channel) => (
              <label className="block py-2" key={channel.key}>
                <input
                  type="checkbox"
                  checked={s.channelKeys.includes(channel.key)}
                  onChange={() => c.select("channelKeys", channel.key)}
                />{" "}
                {channel.name}: members {channel.memberKeys.join(", ")}
              </label>
            ))}
          </fieldset>
          <ul>
            {s.receipt.preview.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
          <p>Choose at least one agent. Selected chats use only agents that successfully import.</p>
          <Button
            disabled={locked || !s.keys.length}
            onClick={() => void c.apply(Intl.DateTimeFormat().resolvedOptions().timeZone)}
          >
            Import selected into {destination}
          </Button>
          <Button
            variant="outline"
            disabled={s.busy || s.uncertain || !["staged", "complete"].includes(s.receipt.state)}
            onClick={() => void c.discard()}
          >
            {s.receipt.state === "complete" ? "Dismiss result" : "Discard archive"}
          </Button>
          {s.receipt.result && (
            <>
              <p>
                Imported: {s.receipt.result.agents.map((a) => a.name).join(", ")}; channels:{" "}
                {s.receipt.result.channels.map((a) => a.name).join(", ")}
              </p>
              <ul>
                {[...s.receipt.result.skipped, ...s.receipt.result.skippedChannels].map((item) => (
                  <li key={item.key}>
                    {item.name}: {item.reason}
                  </li>
                ))}
                {s.receipt.result.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
      <p role="status">{s.notice}</p>
    </section>
  );
}
