import { useAtomValue } from "@effect/atom-react";
import { useState } from "react";
import { View } from "react-native";
import type {
  EnvironmentId,
  OpenbotAdminRequest,
  OpenbotAttentionRequest,
} from "@t3tools/contracts";
import { promptAnswerRequest } from "@t3tools/client-runtime/openbot/presentation";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { AppText as Text, AppTextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { ThemedSwitch } from "../../components/ui/ThemedSwitch";
import { openbot } from "../../state/openbot";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";

export function BotAttention({
  environmentId,
  agentId,
}: {
  environmentId: EnvironmentId;
  agentId?: string;
}) {
  const query = useEnvironmentQuery(openbot.attention({ environmentId, input: {} }));
  const changes = useEnvironmentQuery(openbot.changes({ environmentId, input: {} }));
  const agents = useEnvironmentQuery(openbot.agents({ environmentId, input: {} }));
  const canRespond = useAtomValue(openbot.attentionRespond.permissionAtom(environmentId));
  const snapshot = query.data;
  const requests =
    snapshot?.requests.filter((request) => !agentId || request.agentId === agentId) ?? [];
  const ready = snapshot?.state === "ready" && !query.error && !changes.error && !query.isPending;
  return (
    <View className="gap-3">
      <Text textRole="headline">Needs your input</Text>
      {(query.error || changes.error) && (
        <Text accessibilityRole="alert" className="text-danger">
          {query.error ?? changes.error}
        </Text>
      )}
      {(!snapshot || snapshot.state !== "ready") && (
        <Text accessibilityLiveRegion="polite" className="text-foreground-muted">
          {snapshot?.state === "disconnected"
            ? "Bot requests are unavailable while the engine is offline."
            : "Connecting to live bot requests…"}
        </Text>
      )}
      {snapshot?.state === "ready" && !snapshot.complete && (
        <Text
          accessibilityLiveRegion="polite"
          textRole="footnote"
          className="text-foreground-muted"
        >
          Showing a partial set of requests. More may be waiting; this list updates as you respond.
        </Text>
      )}
      {ready && snapshot.complete && requests.length === 0 && (
        <Text className="text-foreground-muted">No bot requests are waiting.</Text>
      )}
      {!canRespond && (
        <Text textRole="footnote" className="text-foreground-muted">
          Settings permission is required to respond to bot requests.
        </Text>
      )}
      {requests.map((request) => (
        <AttentionRequest
          key={`${snapshot?.hostId}:${request.kind}:${request.requestId}`}
          environmentId={environmentId}
          hostId={snapshot?.hostId ?? null}
          request={request}
          agentName={
            agents.data?.find((agent) => agent.id === request.agentId)?.name ?? request.agentId
          }
          disabled={!ready || !canRespond}
        />
      ))}
    </View>
  );
}

function AttentionRequest({
  environmentId,
  request,
  hostId,
  agentName,
  disabled,
}: {
  environmentId: EnvironmentId;
  request: OpenbotAttentionRequest;
  hostId: string | null;
  agentName: string;
  disabled: boolean;
}) {
  const admin = useAtomCommand(openbot.admin, { reportFailure: false });
  const answerRequest = useAtomCommand(openbot.attentionRespond, { reportFailure: false });
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [inputRevision, setInputRevision] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const respond = async (input: OpenbotAdminRequest) => {
    if (busy || disabled || submitted || hostId === null) return;
    setBusy(true);
    setError(null);
    const isResponse =
      input.operation === "approval.respond" ||
      input.operation === "prompt.respond" ||
      input.operation === "takeover.respond";
    const result = isResponse
      ? await answerRequest({ environmentId, input: { hostId, request: input } })
      : await admin({ environmentId, input });
    if (result._tag === "Failure") setError(String(squashAtomCommandFailure(result)));
    else {
      setAnswers({});
      setInputRevision((revision) => revision + 1);
      if (isResponse) setSubmitted(true);
    }
    setBusy(false);
  };
  const answer = promptAnswerRequest(request, answers);
  const unavailable = disabled || busy || submitted || hostId === null;
  const approval = request.approval;
  const tabId = request.tabId;
  return (
    <View className="gap-3 rounded-xl bg-grouped-card p-4">
      <Text textRole="headline">
        {agentName} ·{" "}
        {request.kind === "approval"
          ? `${request.approvalKind ?? "Action"} approval`
          : request.kind === "prompt"
            ? "Question"
            : "Browser help"}
      </Text>
      {(busy || submitted) && (
        <Text accessibilityLiveRegion="polite" textRole="footnote">
          {busy ? "Sending response…" : "Response sent. Waiting for the bot…"}
        </Text>
      )}
      {error && (
        <Text accessibilityRole="alert" className="text-danger">
          {error}
        </Text>
      )}
      {request.kind === "approval" && (
        <>
          {approval ? (
            <View className="gap-2">
              {approval.command && <Text selectable>Command: {approval.command}</Text>}
              {approval.cwd && <Text selectable>Working directory: {approval.cwd}</Text>}
              {approval.reason && <Text selectable>Reason: {approval.reason}</Text>}
              {approval.grantRoot && <Text selectable>Access root: {approval.grantRoot}</Text>}
              {approval.permissions && (
                <Text selectable>
                  Read: {approval.permissions.fileSystem.read.join(", ") || "None"}
                  {"\n"}Write: {approval.permissions.fileSystem.write.join(", ") || "None"}
                  {"\n"}Network: {approval.permissions.network ? "Allowed" : "Not requested"}
                </Text>
              )}
            </View>
          ) : (
            <Text className="text-foreground-muted">
              Approval details are unavailable. Review this request on the host.
            </Text>
          )}
          {approval?.truncated && (
            <Text textRole="footnote" className="text-foreground-muted">
              These details were shortened by the engine. Review the complete request on the host
              before approving.
            </Text>
          )}
          <View className="flex-row flex-wrap gap-2">
            <Button
              label="Approve once"
              disabled={unavailable || !approval || approval.truncated}
              onPress={() =>
                void respond({
                  operation: "approval.respond",
                  requestId: request.requestId,
                  decision: "accept",
                })
              }
            />
            <Button
              label="Decline"
              disabled={unavailable}
              onPress={() =>
                void respond({
                  operation: "approval.respond",
                  requestId: request.requestId,
                  decision: "decline",
                })
              }
            />
          </View>
        </>
      )}
      {request.kind === "prompt" && (
        <View className="gap-3">
          {request.questions?.map((question) => (
            <View key={question.id} className="gap-2">
              <Text textRole="headline">{question.header || "Question"}</Text>
              <Text selectable>{question.question}</Text>
              {!question.isSecret && question.options?.length ? (
                <View className="gap-2">
                  {question.options.map((option) => (
                    <View key={option.label} className="gap-1">
                      <Button
                        label={option.label}
                        accessibilityLabel={`${option.label}${answers[question.id]?.includes(option.label) ? ", selected" : ""}`}
                        tone={
                          answers[question.id]?.includes(option.label) ? "primary" : "secondary"
                        }
                        disabled={unavailable}
                        onPress={() =>
                          setAnswers({
                            ...answers,
                            [question.id]: question.multiSelect
                              ? answers[question.id]?.includes(option.label)
                                ? (answers[question.id] ?? []).filter(
                                    (value) => value !== option.label,
                                  )
                                : [...(answers[question.id] ?? []), option.label]
                              : [option.label],
                          })
                        }
                      />
                      {option.description && (
                        <Text textRole="footnote" className="text-foreground-muted">
                          {option.description}
                        </Text>
                      )}
                    </View>
                  ))}
                </View>
              ) : (
                <AppTextInput
                  key={inputRevision}
                  accessibilityLabel={question.header || question.question}
                  defaultValue=""
                  editable={!unavailable}
                  secureTextEntry={question.isSecret}
                  autoCapitalize="none"
                  autoCorrect={!question.isSecret}
                  textContentType={question.isSecret ? "none" : undefined}
                  maxLength={100_000}
                  onChangeText={(value) => setAnswers({ ...answers, [question.id]: [value] })}
                  className="min-h-12 rounded-xl bg-screen p-3"
                />
              )}
            </View>
          ))}
          <View className="flex-row flex-wrap gap-2">
            <Button
              label="Send answer"
              disabled={unavailable || !answer}
              onPress={() => {
                if (answer) void respond(answer);
              }}
            />
            <Button
              label="Cancel request"
              disabled={unavailable}
              onPress={() =>
                void respond({
                  operation: "prompt.respond",
                  requestId: request.requestId,
                  answers: {},
                })
              }
            />
          </View>
        </View>
      )}
      {request.kind === "takeover" && (
        <>
          <Text>
            {request.takeoverReason === "sign-in-blocked"
              ? "The website blocked sign-in. Finish signing in using the bot’s browser on its host."
              : "This bot needs you to finish a step in its browser on the host."}
          </Text>
          {request.browserSecret && (
            <Text textRole="footnote" className="text-foreground-muted">
              {request.browserSecret.origin} ·{" "}
              {request.browserSecret.method === "password"
                ? "Password required"
                : "Verification code required"}
            </Text>
          )}
          {tabId && (
            <Button
              label="Show tab on host"
              disabled={unavailable}
              onPress={() => void respond({ operation: "browser.activate", tabId })}
            />
          )}
          <View className="flex-row items-center gap-3">
            <ThemedSwitch
              accessibilityLabel="I finished the browser step on the host"
              value={reviewed}
              disabled={unavailable}
              onValueChange={setReviewed}
            />
            <View className="flex-1">
              <Text>I finished the browser step on the host</Text>
            </View>
          </View>
          <View className="flex-row flex-wrap gap-2">
            <Button
              label="Resume bot"
              disabled={unavailable || !reviewed}
              onPress={() =>
                void respond({
                  operation: "takeover.respond",
                  requestId: request.requestId,
                  decision: "complete",
                })
              }
            />
            <Button
              label="Cancel request"
              disabled={unavailable}
              onPress={() =>
                void respond({
                  operation: "takeover.respond",
                  requestId: request.requestId,
                  decision: "cancel",
                })
              }
            />
          </View>
        </>
      )}
    </View>
  );
}
