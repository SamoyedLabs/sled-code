import { useAtomValue } from "@effect/atom-react";
import { useState } from "react";
import type {
  EnvironmentId,
  OpenbotAdminRequest,
  OpenbotAttentionRequest,
} from "@t3tools/contracts";
import { promptAnswerRequest } from "@t3tools/client-runtime/openbot/presentation";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { openbot } from "../../state/openbot";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Checkbox } from "../ui/checkbox";
import { CheckCheckIcon, InboxIcon } from "lucide-react";
import { WorkspacePageContainer } from "../WorkspacePageContainer";
import { Skeleton } from "../ui/skeleton";
import { T, Var, useGT } from "gt-react";

type RequestConversation = { label: string; onOpen: () => void };
export function BotAttention({
  environmentId,
  conversationForRequest,
}: {
  environmentId: EnvironmentId;
  conversationForRequest?: (request: OpenbotAttentionRequest) => RequestConversation | null;
}) {
  const gt = useGT();
  const query = useEnvironmentQuery(openbot.attention({ environmentId, input: {} }));
  const changes = useEnvironmentQuery(openbot.changes({ environmentId, input: {} }));
  const agents = useEnvironmentQuery(openbot.agents({ environmentId, input: {} }));
  const canRespond = useAtomValue(openbot.attentionRespond.permissionAtom(environmentId));
  const snapshot = query.data;
  const ready = snapshot?.state === "ready" && !query.error && !changes.error && !query.isPending;
  return (
    <WorkspacePageContainer>
      <section aria-label={gt("Bot requests")} className="space-y-5">
        <header className="space-y-2">
          <h2 className="text-balance text-xl font-semibold">
            <T>Needs your input</T>
          </h2>
          <p className="text-pretty text-sm text-muted-foreground">
            <T>Review questions, permissions and requests that are holding up your bots.</T>
          </p>
        </header>
        {(query.error || changes.error) && (
          <p role="alert" className="text-sm text-destructive">
            {query.error ?? changes.error}
          </p>
        )}
        {(!snapshot || snapshot.state !== "ready") && (
          <div role="status" className="space-y-3 rounded-xl border border-border/60 p-5">
            <p className="text-sm text-muted-foreground">
              {snapshot?.state === "disconnected"
                ? gt("Bot requests are unavailable while the engine is offline.")
                : gt("Connecting to live bot requests…")}
            </p>
            {query.isPending && (
              <>
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-4 w-2/3" />
              </>
            )}
          </div>
        )}
        {snapshot?.state === "ready" && !snapshot.complete && (
          <p role="status" className="text-sm text-muted-foreground">
            <T>
              Showing a partial set of requests. More may be waiting; this list updates as you
              respond.
            </T>
          </p>
        )}
        {ready && snapshot.complete && snapshot.requests.length === 0 && (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-border/60 px-6 py-12 text-center">
            <CheckCheckIcon aria-hidden className="size-7 text-muted-foreground" />
            <h3 className="text-base font-medium">
              <T>You’re all caught up</T>
            </h3>
            <p className="text-pretty text-sm text-muted-foreground">
              <T>Questions and approvals will appear here when a bot needs you.</T>
            </p>
          </div>
        )}
        {!canRespond && (
          <p className="text-sm text-muted-foreground">
            <T>Settings permission is required to respond to bot requests.</T>
          </p>
        )}
        {snapshot?.requests.map((request) => (
          <BotAttentionRequest
            key={`${snapshot.hostId}:${request.kind}:${request.requestId}`}
            environmentId={environmentId}
            hostId={snapshot?.hostId ?? null}
            request={request}
            agentName={
              agents.data?.find((agent) => agent.id === request.agentId)?.name ?? request.agentId
            }
            disabled={!ready || !canRespond}
            conversation={conversationForRequest?.(request) ?? null}
          />
        ))}
      </section>
    </WorkspacePageContainer>
  );
}

export function BotAttentionRequest({
  environmentId,
  request,
  hostId,
  agentName,
  disabled,
  conversation = null,
}: {
  environmentId: EnvironmentId;
  request: OpenbotAttentionRequest;
  hostId: string | null;
  agentName: string;
  disabled: boolean;
  conversation?: RequestConversation | null;
}) {
  const gt = useGT();
  const admin = useAtomCommand(openbot.admin, { reportFailure: false });
  const answerRequest = useAtomCommand(openbot.attentionRespond, { reportFailure: false });
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
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
      if (isResponse) setSubmitted(true);
    }
    setBusy(false);
  };
  const secure =
    request.kind === "prompt" && request.questions?.some((question) => question.isSecret);
  const answer = secure ? null : promptAnswerRequest(request, answers);
  const unavailable = disabled || busy || submitted || hostId === null;
  const approval = request.approval;
  const tabId = request.tabId;
  return (
    <div className="min-w-0 space-y-4 rounded-xl border border-border/60 bg-card/40 p-5">
      <p className="flex items-center gap-2 break-words text-sm font-medium">
        <InboxIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        {agentName} ·{" "}
        {request.kind === "approval"
          ? `${request.approvalKind ?? "Action"} approval`
          : request.kind === "prompt"
            ? gt("Question")
            : gt("Browser help")}
      </p>
      {(busy || submitted) && (
        <p role="status" className="text-sm text-muted-foreground">
          {busy ? gt("Sending response…") : gt("Response sent. Waiting for the bot…")}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {request.kind === "approval" && (
        <>
          {approval ? (
            <dl className="space-y-2 break-words text-sm">
              {approval.command && (
                <div>
                  <dt className="text-muted-foreground">
                    <T>Command</T>
                  </dt>
                  <dd>
                    <pre className="whitespace-pre-wrap break-all font-mono">
                      {approval.command}
                    </pre>
                  </dd>
                </div>
              )}
              {approval.cwd && (
                <div>
                  <dt className="text-muted-foreground">
                    <T>Working directory</T>
                  </dt>
                  <dd>{approval.cwd}</dd>
                </div>
              )}
              {approval.reason && (
                <div>
                  <dt className="text-muted-foreground">
                    <T>Reason</T>
                  </dt>
                  <dd>{approval.reason}</dd>
                </div>
              )}
              {approval.grantRoot && (
                <div>
                  <dt className="text-muted-foreground">
                    <T>Access root</T>
                  </dt>
                  <dd>{approval.grantRoot}</dd>
                </div>
              )}
              {approval.permissions && (
                <div>
                  <dt className="text-muted-foreground">
                    <T>Requested permissions</T>
                  </dt>
                  <dd>
                    <T>Read:</T> {approval.permissions.fileSystem.read.join(", ") || gt("None")}
                    <br />
                    <T>Write:</T> {approval.permissions.fileSystem.write.join(", ") || gt("None")}
                    <br />
                    <T>Network:</T>{" "}
                    {approval.permissions.network ? gt("Allowed") : gt("Not requested")}
                  </dd>
                </div>
              )}
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">
              <T>Approval details are unavailable. Review this request on the host.</T>
            </p>
          )}
          {approval?.truncated && (
            <p className="text-sm text-muted-foreground">
              <T>
                These details were shortened by the engine. Review the complete request on the host
                before approving.
              </T>
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={unavailable || !approval || approval.truncated}
              onClick={() =>
                void respond({
                  operation: "approval.respond",
                  requestId: request.requestId,
                  decision: "accept",
                })
              }
            >
              <T>Approve once</T>
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={unavailable}
              onClick={() =>
                void respond({
                  operation: "approval.respond",
                  requestId: request.requestId,
                  decision: "decline",
                })
              }
            >
              <T>Decline</T>
            </Button>
          </div>
        </>
      )}
      {request.kind === "prompt" && secure && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            <T>
              This bot is waiting for a private response. Open its conversation to review the secure
              form.
            </T>
          </p>
          {conversation ? (
            <Button size="sm" variant="outline" onClick={conversation.onOpen}>
              <T>
                Open <Var>{conversation.label}</Var>
              </T>
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground">
              <T>Open the original conversation to respond.</T>
            </p>
          )}
        </div>
      )}
      {request.kind === "prompt" && !secure && (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (answer) void respond(answer);
          }}
        >
          {request.questions?.map((question) => (
            <fieldset key={question.id} disabled={unavailable} className="space-y-2">
              <legend className="text-sm font-medium">{question.header || gt("Question")}</legend>
              <p className="text-sm">{question.question}</p>
              {!question.isSecret && question.options?.length ? (
                <div className="space-y-2">
                  {question.options.map((option) => (
                    <div key={option.label} className="space-y-1">
                      <Button
                        type="button"
                        variant={
                          answers[question.id]?.includes(option.label) ? "secondary" : "outline"
                        }
                        size="sm"
                        aria-pressed={answers[question.id]?.includes(option.label) ?? false}
                        onClick={() =>
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
                      >
                        {option.label}
                      </Button>
                      {option.description && (
                        <p className="text-xs text-muted-foreground">{option.description}</p>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <Input
                  type={question.isSecret ? "password" : "text"}
                  aria-label={question.header || question.question}
                  autoComplete="off"
                  maxLength={100_000}
                  value={answers[question.id]?.[0] ?? ""}
                  onChange={(event) =>
                    setAnswers({ ...answers, [question.id]: [event.target.value] })
                  }
                />
              )}
            </fieldset>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" type="submit" disabled={unavailable || !answer}>
              <T>Send answer</T>
            </Button>
            <Button
              size="sm"
              type="button"
              variant="outline"
              disabled={unavailable}
              onClick={() =>
                void respond({
                  operation: "prompt.respond",
                  requestId: request.requestId,
                  answers: {},
                })
              }
            >
              <T>Cancel request</T>
            </Button>
          </div>
        </form>
      )}
      {request.kind === "takeover" && (
        <>
          <p className="text-sm">
            {request.takeoverReason === "sign-in-blocked"
              ? gt(
                  "The website blocked sign-in. Finish signing in using the bot’s browser on its host.",
                )
              : gt("This bot needs you to finish a step in its browser on the host.")}
          </p>
          {request.browserSecret && (
            <p className="break-words text-sm text-muted-foreground">
              {request.browserSecret.origin} ·{" "}
              {request.browserSecret.method === "password"
                ? gt("Password required")
                : gt("Verification code required")}
            </p>
          )}
          {tabId && (
            <Button
              variant="outline"
              size="sm"
              disabled={unavailable}
              onClick={() => void respond({ operation: "browser.activate", tabId })}
            >
              <T>Show tab on host</T>
            </Button>
          )}
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={reviewed}
              disabled={unavailable}
              onCheckedChange={(value) => setReviewed(value === true)}
            />
            <T>I finished the browser step on the host</T>
          </label>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={unavailable || !reviewed}
              onClick={() =>
                void respond({
                  operation: "takeover.respond",
                  requestId: request.requestId,
                  decision: "complete",
                })
              }
            >
              <T>Resume bot</T>
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={unavailable}
              onClick={() =>
                void respond({
                  operation: "takeover.respond",
                  requestId: request.requestId,
                  decision: "cancel",
                })
              }
            >
              <T>Cancel request</T>
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
