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
import { T, Var, useGT } from "gt-react-native";
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
  const gt = useGT();
  const c = useBotTemplates(scopeKey, actions, adoptionAvailable);
  const [source, setSource] = useState("template");
  const [sourceId, setSourceId] = useState("");
  const [agentId, setAgentId] = useState("");
  const [timezone, setTimezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [receipt, setReceipt] = useState(() => randomUUID());
  const selected = agents.find((agent) => agent.id === agentId);
  const detail = c.state.review?.detail;
  const preview = c.state.preview?.agentId === agentId ? c.state.preview : null;
  const install = adoptionAvailable
    ? templateInstall(c.state, timezone, receipt, undefined, true)
    : null;
  const update =
    adoptionAvailable && selected?.listingId
      ? templateInstall(
          c.state,
          timezone,
          receipt,
          {
            agentId: selected.id,
            listingId: selected.listingId,
          },
          adoptionAvailable,
        )
      : null;
  const disabled = (request: TemplateRequest) =>
    c.busy || c.state.uncertain || !actions.can(request);
  const mutate = (request: TemplateRequest) =>
    Alert.alert(
      gt("Change on selected host"),
      gt(
        "Confirm {operation} on {hostLabel}? Publication uploads current instructions, skills and routines using the host account.",
        { operation: request.operation, hostLabel },
      ),
      [
        { text: gt("Cancel"), style: "cancel" },
        {
          text: gt("Confirm"),
          onPress: () => {
            void c.run(request).then((accepted) => {
              if (accepted && request.operation === "templates.adopt") setReceipt(randomUUID());
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
      <Text accessibilityRole="header">
        <T>Agent templates</T>
      </Text>
      <Text>
        <T>
          Destination: <Var>{hostLabel}</Var>. Downloads and publication use the account signed in
          on this host. Sled never copies account credentials. Host provider, coding and approval
          settings remain authoritative.
        </T>
      </Text>
      <Text>
        <T>
          A template copies instructions, skills and routines. Choose provider/model settings in
          this host’s Bots settings after adding. Publication shares this content through a link; it
          does not share workspace files or memories.
        </T>
      </Text>
      <Picker
        disabled={c.busy}
        label={gt("Source")}
        value={source}
        options={[
          { id: "template", name: "Shared template" },
          { id: "marketplace", name: "Marketplace listing" },
        ]}
        onChange={setSource}
      />
      <Text>
        <T>Template or listing ID</T>
      </Text>
      <AppTextInput
        accessibilityLabel={gt("Template or listing ID")}
        value={sourceId}
        maxLength={128}
        onChangeText={setSourceId}
      />
      <Text>
        <T>Routine timezone</T>
      </Text>
      <AppTextInput
        accessibilityLabel={gt("Routine timezone")}
        value={timezone}
        onChangeText={setTimezone}
        maxLength={255}
      />
      {!reviewAvailable && (
        <Text>
          <T>
            Source review is unavailable on this host. Update its bot engine to review shared
            agents.
          </T>
        </Text>
      )}
      <Button
        label={gt("Review source")}
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
            <T>
              <Var>{c.state.review?.kind}</Var> · <Var>{detail.id}</Var> · by{" "}
              <Var>{detail.creatorName}</Var> · revision<Var> </Var>
              <Var>{detail.updatedAt}</Var> · version{" "}
              <Var>{detail.version ?? gt("shared template")}</Var> ·<Var> </Var>
              <Var>{detail.versionId ?? ""}</Var>
            </T>
          </Text>
          {detail.pending && (
            <Text>
              <T>This listing is pending review. Adding is disabled.</T>
            </Text>
          )}
          <Text>{detail.description}</Text>
          {detail.skills.map((skill) => (
            <Text key={skill.slug}>
              {skill.name} · {skill.kind} ·{" "}
              {skill.kind === "embedded"
                ? skill.markdown
                : gt("version {version} ({versionId})", {
                    version: skill.version,
                    versionId: skill.versionId,
                  })}
            </Text>
          ))}
          {detail.routines.map((routine) => (
            <Text key={routine.name}>
              {routine.name} · {routine.active ? "active" : "inactive"} ·{" "}
              {templateSchedule(routine.schedule)}: {routine.instruction}
            </Text>
          ))}
          <Text>
            <T>
              Name on destination: <Var>{detail.name}</Var>. Routine timezone: <Var>{timezone}</Var>
              . Adding refuses a changed source version and saves the original result for recovery.
            </T>
          </Text>
          <Button
            label={gt("Add agent")}
            disabled={!install || disabled(install)}
            onPress={() => {
              if (install) void mutate(install);
            }}
          />
          <Button
            label={gt("Update selected agent from this listing")}
            disabled={!update || disabled(update)}
            onPress={() => {
              if (update) void mutate(update);
            }}
          />
        </View>
      )}
      <Picker
        disabled={c.busy}
        label={gt("Destination agent for publication or update")}
        value={agentId}
        options={agents.map((agent) => ({ id: agent.id, name: agent.name }))}
        onChange={setAgentId}
      />
      <Button
        label={gt("Preview publication")}
        disabled={c.busy || !selected || !actions.can({ operation: "templates.preview", agentId })}
        onPress={() => {
          void c.run({ operation: "templates.preview", agentId });
        }}
      />
      {preview && (
        <View className="gap-2">
          <Text accessibilityRole="header">
            <T>
              Publication review: <Var>{preview.name}</Var>
            </T>
          </Text>
          <Text>{preview.title}</Text>
          <Text>{preview.description}</Text>
          {preview.skills.map((skill) => (
            <Text key={skill.slug}>
              {skill.name} · {skill.kind} ·{" "}
              {skill.kind === "embedded"
                ? skill.markdown
                : gt("version {version} ({versionId})", {
                    version: skill.version,
                    versionId: skill.versionId,
                  })}
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
              ? gt("Host reports published at {publishedAt}: {shareUrl}", {
                  publishedAt: preview.publication.publishedAt,
                  shareUrl: preview.publication.shareUrl,
                })
              : gt(
                  "Publication unknown or absent. A signed-out or offline host also returns no publication.",
                )}
          </Text>
          <Text>
            <T>
              Publishing rereads current host content and checks secrets. The released API cannot
              pin publication to this preview revision. No share card is uploaded.
            </T>
          </Text>
          <Button
            label={
              preview.publication ? gt("Update publication") : gt("Publish link-only template")
            }
            disabled={
              Boolean(preview.skillsError) || disabled({ operation: "templates.publish", agentId })
            }
            onPress={() => {
              void mutate({ operation: "templates.publish", agentId });
            }}
          />
          <Button
            label={gt("Unpublish template")}
            disabled={disabled({ operation: "templates.unpublish", agentId })}
            onPress={() => {
              void mutate({ operation: "templates.unpublish", agentId });
            }}
          />
        </View>
      )}
      {reviewAvailable && (
        <Button
          label={gt("Check publication status")}
          disabled={
            c.busy || !selected || !actions.can({ operation: "templates.publication", agentId })
          }
          onPress={() => {
            void c.run({ operation: "templates.publication", agentId });
          }}
        />
      )}
      {c.state.publication?.agentId === agentId && (
        <Text>
          {c.state.publication.value
            ? gt("Published: {shareUrl}", { shareUrl: c.state.publication.value.shareUrl })
            : gt("Not published")}
        </Text>
      )}
      {adoptionAvailable && (
        <Button
          label={gt("Refresh installation history")}
          disabled={c.busy || !actions.can(templateHistoryRequest(c.state))}
          onPress={() => {
            void c.run(templateHistoryRequest(c.state));
          }}
        />
      )}
      {c.state.adoptions.map((item) => (
        <View key={item.operationId} className="gap-2">
          <Text>
            {item.name ?? item.sourceId} · {item.state}
            {item.agentId ? ` · ${item.agentId}` : ""}
          </Text>
          {(item.state === "interrupted" || item.state === "failed") &&
            item.agentId &&
            !c.state.acknowledged.includes(item.operationId) && (
              <Button
                label={gt("I inspected this retained agent")}
                disabled={c.busy}
                onPress={() =>
                  Alert.alert(
                    gt("Retained agent"),
                    gt(
                      "Have you inspected {agentId} on {hostLabel}? It and its work will remain. This does not retry the original change.",
                      { agentId: item.agentId, hostLabel },
                    ),
                    [
                      { text: gt("Cancel"), style: "cancel" },
                      {
                        text: gt("I inspected it"),
                        onPress: () => c.acknowledge(item.operationId),
                      },
                    ],
                  )
                }
              />
            )}
        </View>
      ))}
      {c.error && <Text accessibilityRole="alert">{c.error}</Text>}
      {c.state.notice && <Text accessibilityLiveRegion="polite">{c.state.notice}</Text>}
      {c.state.uncertain && (
        <Text>
          <T>
            Refresh installation history to recover the original outcome. An interrupted agent and
            its work remain on the destination host for inspection.
          </T>
        </Text>
      )}
    </View>
  );
}
