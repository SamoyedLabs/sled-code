import { useState } from "react";
import {
  templateInstall,
  templateSchedule,
  templateHistoryRequest,
  type TemplateActions,
} from "@t3tools/client-runtime/openbot/templates";
import type { TemplateRequest } from "@t3tools/contracts/openbot-templates";
import { useBotTemplates } from "./useBotTemplates";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "../ui/select";
import { confirmed } from "./BotConnectionControls";
import { randomUUID } from "../../lib/utils";
export function BotTemplates({
  actions,
  scopeKey,
  hostLabel,
  agents,
  reviewAvailable = false,
  adoptionAvailable = false,
}: {
  actions: TemplateActions;
  scopeKey: string;
  hostLabel: string;
  agents: readonly { readonly id: string; readonly name: string; readonly listingId?: string }[];
  reviewAvailable?: boolean;
  adoptionAvailable?: boolean;
}) {
  const c = useBotTemplates(scopeKey, actions, adoptionAvailable);
  const [source, setSource] = useState("template");
  const [sourceId, setSourceId] = useState("");
  const [agentId, setAgentId] = useState("");
  const [timezone, setTimezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [receipt, setReceipt] = useState(() => randomUUID());
  const selected = agents.find((agent) => agent.id === agentId);
  const detail = c.state.review?.detail;
  const preview = c.state.preview?.agentId === agentId ? c.state.preview : null;
  const install = adoptionAvailable ? templateInstall(c.state, timezone, receipt, undefined, true) : null;
  const update = adoptionAvailable && selected?.listingId
    ? templateInstall(c.state, timezone, receipt, {
        agentId: selected.id,
        listingId: selected.listingId,
      }, adoptionAvailable)
    : null;
  const disabled = (request: TemplateRequest) =>
    c.busy || c.state.uncertain || !actions.can(request);
  const mutate = async (request: TemplateRequest) => {
    if (
      await confirmed(
        `Confirm ${request.operation} on ${hostLabel}? Publication uploads current instructions, skills and routines using the host account.`,
      )
    )
      if (await c.run(request)) {
        if (request.operation === "templates.adopt") setReceipt(randomUUID());
      }
  };
  const readRequest: TemplateRequest =
    source === "template"
      ? { operation: "templates.detail", templateId: sourceId }
      : { operation: "templates.listing", listingId: sourceId };
  return (
    <section aria-label="Agent templates" aria-busy={c.busy} className="space-y-3">
      <h3>Agent templates</h3>
      <p>
        Destination: {hostLabel}. Downloads and publication use the account signed in on this host.
        Sled never copies account credentials. Host provider, coding and approval settings remain
        authoritative.
      </p>
      <p>
        A template copies instructions, skills and routines. Choose provider/model settings in this
        host’s Bots settings after adding. Publication shares this content through a link; it does
        not share workspace files or memories.
      </p>
      <label>
        Source
        <Select
          value={source}
          onValueChange={(value) => {
            if (value) setSource(value);
          }}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="template">Shared template</SelectItem>
            <SelectItem value="marketplace">Marketplace listing</SelectItem>
          </SelectContent>
        </Select>
      </label>
      <label>
        Template or listing ID
        <Input
          value={sourceId}
          maxLength={128}
          onChange={(event) => setSourceId(event.target.value)}
        />
      </label>
      <label>
        Routine timezone
        <Input
          value={timezone}
          maxLength={255}
          onChange={(event) => setTimezone(event.target.value)}
        />
      </label>
      {!reviewAvailable && (
        <p>
          Source review is unavailable on this host. Update its bot engine to review shared agents.
        </p>
      )}
      <Button
        variant="outline"
        disabled={c.busy || !reviewAvailable || !sourceId || !actions.can(readRequest)}
        onClick={() => {
          void c.run(readRequest);
        }}
      >
        {"Review source"}
      </Button>
      {detail && (
        <div className="space-y-2">
          <h3>
            {detail.name} · {detail.title}
          </h3>
          <p>
            {c.state.review?.kind} · {detail.id} · by {detail.creatorName} · revision{" "}
            {detail.updatedAt} · version {detail.version ?? "shared template"} ·{" "}
            {detail.versionId ?? ""}
          </p>
          {detail.pending && <p>This listing is pending review. Adding is disabled.</p>}
          <p>{detail.description}</p>
          {detail.skills.map((skill) => (
            <p key={skill.slug}>
              {skill.name} · {skill.kind} ·{" "}
              {skill.kind === "embedded"
                ? skill.markdown
                : `version ${skill.version} (${skill.versionId})`}
            </p>
          ))}
          {detail.routines.map((routine) => (
            <p key={routine.name}>
              {routine.name} · {routine.active ? "active" : "inactive"} ·{" "}
              {templateSchedule(routine.schedule)}: {routine.instruction}
            </p>
          ))}
          <p>
            Name on destination: {detail.name}. Routine timezone: {timezone}. Adding refuses a
            changed source version and saves the original result for recovery.
          </p>
          <Button
            variant="outline"
            disabled={!install || disabled(install)}
            onClick={() => {
              if (install) void mutate(install);
            }}
          >
            {"Add agent"}
          </Button>
          <Button
            variant="outline"
            disabled={!update || disabled(update)}
            onClick={() => {
              if (update) void mutate(update);
            }}
          >
            {"Update selected agent from this listing"}
          </Button>
        </div>
      )}
      <label>
        Destination agent for publication or update
        <Select
          value={agentId}
          onValueChange={(value) => {
            if (value) setAgentId(value);
          }}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {agents.map((agent) => (
              <SelectItem key={agent.id} value={agent.id}>
                {agent.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      <Button
        variant="outline"
        disabled={c.busy || !selected || !actions.can({ operation: "templates.preview", agentId })}
        onClick={() => {
          void c.run({ operation: "templates.preview", agentId });
        }}
      >
        {"Preview publication"}
      </Button>
      {preview && (
        <div className="space-y-2">
          <h3>Publication review: {preview.name}</h3>
          <p>{preview.title}</p>
          <p>{preview.description}</p>
          {preview.skills.map((skill) => (
            <p key={skill.slug}>
              {skill.name} · {skill.kind} ·{" "}
              {skill.kind === "embedded"
                ? skill.markdown
                : `version ${skill.version} (${skill.versionId})`}
            </p>
          ))}
          {preview.routines.map((routine) => (
            <p key={routine.name}>
              {routine.name} · {routine.active ? "active" : "inactive"} ·{" "}
              {templateSchedule(routine.schedule)}: {routine.instruction}
            </p>
          ))}
          {preview.skillsError && <p>{preview.skillsError}</p>}
          <p>
            {preview.publication
              ? `Host reports published at ${preview.publication.publishedAt}: ${preview.publication.shareUrl}`
              : "Publication unknown or absent. A signed-out or offline host also returns no publication."}
          </p>
          <p>
            Publishing rereads current host content and checks secrets. The released API cannot pin
            publication to this preview revision. No share card is uploaded.
          </p>
          <Button
            variant="outline"
            disabled={
              Boolean(preview.skillsError) || disabled({ operation: "templates.publish", agentId })
            }
            onClick={() => {
              void mutate({ operation: "templates.publish", agentId });
            }}
          >
            {preview.publication ? "Update publication" : "Publish link-only template"}
          </Button>
          <Button
            variant="outline"
            disabled={disabled({ operation: "templates.unpublish", agentId })}
            onClick={() => {
              void mutate({ operation: "templates.unpublish", agentId });
            }}
          >
            {"Unpublish template"}
          </Button>
        </div>
      )}
      {reviewAvailable && <Button variant="outline" disabled={c.busy || !selected || !actions.can({ operation: "templates.publication", agentId })} onClick={() => { void c.run({ operation: "templates.publication", agentId }); }}>Check publication status</Button>}
      {c.state.publication?.agentId === agentId && <p role="status">{c.state.publication.value ? `Published: ${c.state.publication.value.shareUrl}` : "Not published"}</p>}
      {adoptionAvailable && <Button variant="outline" disabled={c.busy || !actions.can(templateHistoryRequest(c.state))} onClick={() => { void c.run(templateHistoryRequest(c.state)); }}>Refresh installation history</Button>}
      {c.state.adoptions.map(item => <div key={item.operationId} className="space-y-2"><p>{item.name ?? item.sourceId} · {item.state}{item.agentId ? ` · ${item.agentId}` : ""}</p>{(item.state === "interrupted" || item.state === "failed") && item.agentId && !c.state.acknowledged.includes(item.operationId) && <Button variant="outline" disabled={c.busy} onClick={() => { void confirmed(`Have you inspected retained agent ${item.agentId} on ${hostLabel}? It and its work will remain on the host. This does not retry the original change.`).then(ok => { if (ok) c.acknowledge(item.operationId); }); }}>I inspected this retained agent</Button>}</div>)}
      {c.error && <p role="alert">{c.error}</p>}
      {c.state.notice && <p role="status">{c.state.notice}</p>}
      {c.state.uncertain && (
        <p>
          Refresh installation history to recover the original outcome. An interrupted agent and
          its work remain on the destination host for inspection.
        </p>
      )}
    </section>
  );
}
