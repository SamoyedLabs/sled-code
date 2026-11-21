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
import { T, Var, useGT } from "gt-react-native";

export function BotAttention({
  environmentId,
  agentId,
}: {
  environmentId: EnvironmentId;
  agentId?: string;
}) {
  const gt = useGT();
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
      <Text textRole="headline">
        <T>Needs your input</T>
      </Text>
      {(query.error || changes.error) && (
        <Text accessibilityRole="alert" className="text-danger">
          {query.error ?? changes.error}
        </Text>
      )}
      {(!snapshot || snapshot.state !== "ready") && (
        <Text accessibilityLiveRegion="polite" className="text-foreground-muted">
          {snapshot?.state === "disconnected"
            ? gt("Bot requests are unavailable while the engine is offline.")
            : gt("Connecting to live bot requests…")}
        </Text>
      )}
      {snapshot?.state === "ready" && !snapshot.complete && (
        <Text
          accessibilityLiveRegion="polite"
          textRole="footnote"
          className="text-foreground-muted"
        >
          <T>
            Showing a partial set of requests. More may be waiting; this list updates as you
            respond.
          </T>
        </Text>
      )}
      {ready && snapshot.complete && requests.length === 0 && (
        <Text className="text-foreground-muted">
          <T>No bot requests are waiting.</T>
        </Text>
      )}
      {!canRespond && (
        <Text textRole="footnote" className="text-foreground-muted">
          <T>Settings permission is required to respond to bot requests.</T>
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
  const gt = useGT();
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
            ? gt("Question")
            : gt("Browser help")}
      </Text>
      {(busy || submitted) && (
        <Text accessibilityLiveRegion="polite" textRole="footnote">
          {busy ? gt("Sending response…") : gt("Response sent. Waiting for the bot…")}
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
              {approval.command && (
                <Text selectable>
                  <T>
                    Command: <Var>{approval.command}</Var>
                  </T>
                </Text>
              )}
              {approval.cwd && (
                <Text selectable>
                  <T>
                    Working directory: <Var>{approval.cwd}</Var>
                  </T>
                </Text>
              )}
              {approval.reason && (
                <Text selectable>
                  <T>
                    Reason: <Var>{approval.reason}</Var>
                  </T>
                </Text>
              )}
              {approval.grantRoot && (
                <Text selectable>
                  <T>
                    Access root: <Var>{approval.grantRoot}</Var>
                  </T>
                </Text>
              )}
              {approval.permissions && (
                <Text selectable>
                  <T>
                    Read: <Var>{approval.permissions.fileSystem.read.join(", ") || gt("None")}</Var>
                    <Var>{"\n"}</Var>Write:{" "}
                    <Var>{approval.permissions.fileSystem.write.join(", ") || gt("None")}</Var>
                    <Var>{"\n"}</Var>Network:{" "}
                    <Var>{approval.permissions.network ? gt("Allowed") : gt("Not requested")}</Var>
                  </T>
                </Text>
              )}
            </View>
          ) : (
            <Text className="text-foreground-muted">
              <T>Approval details are unavailable. Review this request on the host.</T>
            </Text>
          )}
          {approval?.truncated && (
            <Text textRole="footnote" className="text-foreground-muted">
              <T>
                These details were shortened by the engine. Review the complete request on the host
                before approving.
              </T>
            </Text>
          )}
          <View className="flex-row flex-wrap gap-2">
            <Button
              label={gt("Approve once")}
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
              label={gt("Decline")}
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
              <Text textRole="headline">{question.header || gt("Question")}</Text>
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
              label={gt("Send answer")}
              disabled={unavailable || !answer}
              onPress={() => {
                if (answer) void respond(answer);
              }}
            />
            <Button
              label={gt("Cancel request")}
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
              ? gt(
                  "The website blocked sign-in. Finish signing in using the bot’s browser on its host.",
                )
              : gt("This bot needs you to finish a step in its browser on the host.")}
          </Text>
          {request.browserSecret && (
            <Text textRole="footnote" className="text-foreground-muted">
              {request.browserSecret.origin} ·{" "}
              {request.browserSecret.method === "password"
                ? gt("Password required")
                : gt("Verification code required")}
            </Text>
          )}
          {tabId && (
            <Button
              label={gt("Show tab on host")}
              disabled={unavailable}
              onPress={() => void respond({ operation: "browser.activate", tabId })}
            />
          )}
          <View className="flex-row items-center gap-3">
            <ThemedSwitch
              accessibilityLabel={gt("I finished the browser step on the host")}
              value={reviewed}
              disabled={unavailable}
              onValueChange={setReviewed}
            />
            <View className="flex-1">
              <Text>
                <T>I finished the browser step on the host</T>
              </Text>
            </View>
          </View>
          <View className="flex-row flex-wrap gap-2">
            <Button
              label={gt("Resume bot")}
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
              label={gt("Cancel request")}
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
