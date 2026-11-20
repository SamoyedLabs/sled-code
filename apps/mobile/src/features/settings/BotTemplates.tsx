import { useState } from "react";
import {
  templateInstall,
  templateSchedule,
  templateHistoryRequest,
  type TemplateActions,
} from "@t3tools/client-runtime/openbot/templates";
import type { TemplateRequest } from "@t3tools/contracts/openbot-templates";
import { useBotTemplates } from "./useBotTemplates";
import { Alert, View } from "react-native";
import { randomUUID } from "expo-crypto";
import { Button } from "../../components/ui/Button";
import { AppText as Text, AppTextInput } from "../../components/ui/AppText";
import { Picker } from "./BotConnectionControls";
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
  const mutate = (request: TemplateRequest) =>
    Alert.alert(
      "Change on selected host",
      `Confirm ${request.operation} on ${hostLabel}? Publication uploads current instructions, skills and routines using the host account.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Confirm",
          onPress: () => {
            void c.run(request).then((accepted) => {
              if (accepted && request.operation === "templates.adopt")
                setReceipt(randomUUID());
            });
          },
        },
      ],
    );
  const readRequest: TemplateRequest =
    source === "template"
      ? { operation: "templates.detail", templateId: sourceId }
      : { operation: "templates.listing", listingId: sourceId };
  return (
    <View className="gap-3">
      <Text accessibilityRole="header">Agent templates</Text>
      <Text>
        Destination: {hostLabel}. Downloads and publication use the account signed in on this host.
        Sled never copies account credentials. Host provider, coding and approval settings remain
        authoritative.
      </Text>
      <Text>
        A template copies instructions, skills and routines. Choose provider/model settings in this
        host’s Bots settings after adding. Publication shares this content through a link; it does
        not share workspace files or memories.
      </Text>
      <Picker
        disabled={c.busy}
        label="Source"
        value={source}
        options={[
          { id: "template", name: "Shared template" },
          { id: "marketplace", name: "Marketplace listing" },
        ]}
        onChange={setSource}
      />
      <Text>Template or listing ID</Text>
      <AppTextInput
        accessibilityLabel="Template or listing ID"
        value={sourceId}
        maxLength={128}
        onChangeText={setSourceId}
      />
      <Text>Routine timezone</Text>
      <AppTextInput
        accessibilityLabel="Routine timezone"
        value={timezone}
        onChangeText={setTimezone}
        maxLength={255}
      />
      {!reviewAvailable && (
        <Text>
          Source review is unavailable on this host. Update its bot engine to review shared agents.
        </Text>
      )}
      <Button
        label="Review source"
        disabled={c.busy || !reviewAvailable || !sourceId || !actions.can(readRequest)}
        onPress={() => {
          void c.run(readRequest);
        }}
      />
      {detail && (
        <View className="gap-2">
          <Text accessibilityRole="header">
            {detail.name} · {detail.title}
          </Text>
          <Text>
            {c.state.review?.kind} · {detail.id} · by {detail.creatorName} · revision{" "}
            {detail.updatedAt} · version {detail.version ?? "shared template"} ·{" "}
            {detail.versionId ?? ""}
          </Text>
          {detail.pending && <Text>This listing is pending review. Adding is disabled.</Text>}
          <Text>{detail.description}</Text>
          {detail.skills.map((skill) => (
            <Text key={skill.slug}>
              {skill.name} · {skill.kind} ·{" "}
              {skill.kind === "embedded"
                ? skill.markdown
                : `version ${skill.version} (${skill.versionId})`}
            </Text>
          ))}
          {detail.routines.map((routine) => (
            <Text key={routine.name}>
              {routine.name} · {routine.active ? "active" : "inactive"} ·{" "}
              {templateSchedule(routine.schedule)}: {routine.instruction}
            </Text>
          ))}
          <Text>
            Name on destination: {detail.name}. Routine timezone: {timezone}. Adding refuses a
            changed source version and saves the original result for recovery.
          </Text>
          <Button
            label="Add agent"
            disabled={!install || disabled(install)}
            onPress={() => {
              if (install) void mutate(install);
            }}
          />
          <Button
            label="Update selected agent from this listing"
            disabled={!update || disabled(update)}
            onPress={() => {
              if (update) void mutate(update);
            }}
          />
        </View>
      )}
      <Picker
        disabled={c.busy}
        label="Destination agent for publication or update"
        value={agentId}
        options={agents.map((agent) => ({ id: agent.id, name: agent.name }))}
        onChange={setAgentId}
      />
      <Button
        label="Preview publication"
        disabled={c.busy || !selected || !actions.can({ operation: "templates.preview", agentId })}
        onPress={() => {
          void c.run({ operation: "templates.preview", agentId });
        }}
      />
      {preview && (
        <View className="gap-2">
          <Text accessibilityRole="header">Publication review: {preview.name}</Text>
          <Text>{preview.title}</Text>
          <Text>{preview.description}</Text>
          {preview.skills.map((skill) => (
            <Text key={skill.slug}>
              {skill.name} · {skill.kind} ·{" "}
              {skill.kind === "embedded"
                ? skill.markdown
                : `version ${skill.version} (${skill.versionId})`}
            </Text>
          ))}
          {preview.routines.map((routine) => (
            <Text key={routine.name}>
              {routine.name} · {routine.active ? "active" : "inactive"} ·{" "}
              {templateSchedule(routine.schedule)}: {routine.instruction}
            </Text>
          ))}
          {preview.skillsError && <Text>{preview.skillsError}</Text>}
          <Text>
            {preview.publication
              ? `Host reports published at ${preview.publication.publishedAt}: ${preview.publication.shareUrl}`
              : "Publication unknown or absent. A signed-out or offline host also returns no publication."}
          </Text>
          <Text>
            Publishing rereads current host content and checks secrets. The released API cannot pin
            publication to this preview revision. No share card is uploaded.
          </Text>
          <Button
            label={preview.publication ? "Update publication" : "Publish link-only template"}
            disabled={
              Boolean(preview.skillsError) || disabled({ operation: "templates.publish", agentId })
            }
            onPress={() => {
              void mutate({ operation: "templates.publish", agentId });
            }}
          />
          <Button
            label="Unpublish template"
            disabled={disabled({ operation: "templates.unpublish", agentId })}
            onPress={() => {
              void mutate({ operation: "templates.unpublish", agentId });
            }}
          />
        </View>
      )}
      {reviewAvailable && <Button label="Check publication status" disabled={c.busy || !selected || !actions.can({ operation: "templates.publication", agentId })} onPress={() => { void c.run({ operation: "templates.publication", agentId }); }} />}
      {c.state.publication?.agentId === agentId && <Text>{c.state.publication.value ? `Published: ${c.state.publication.value.shareUrl}` : "Not published"}</Text>}
      {adoptionAvailable && <Button label="Refresh installation history" disabled={c.busy || !actions.can(templateHistoryRequest(c.state))} onPress={() => { void c.run(templateHistoryRequest(c.state)); }} />}
      {c.state.adoptions.map(item => <View key={item.operationId} className="gap-2"><Text>{item.name ?? item.sourceId} · {item.state}{item.agentId ? ` · ${item.agentId}` : ""}</Text>{(item.state === "interrupted" || item.state === "failed") && item.agentId && !c.state.acknowledged.includes(item.operationId) && <Button label="I inspected this retained agent" disabled={c.busy} onPress={() => Alert.alert("Retained agent", `Have you inspected ${item.agentId} on ${hostLabel}? It and its work will remain. This does not retry the original change.`, [{ text: "Cancel", style: "cancel" }, { text: "I inspected it", onPress: () => c.acknowledge(item.operationId) }])} />}</View>)}
      {c.error && <Text accessibilityRole="alert">{c.error}</Text>}
      {c.state.notice && <Text accessibilityLiveRegion="polite">{c.state.notice}</Text>}
      {c.state.uncertain && (
        <Text>
          Refresh installation history to recover the original outcome. An interrupted agent and
          its work remain on the destination host for inspection.
        </Text>
      )}
    </View>
  );
}
