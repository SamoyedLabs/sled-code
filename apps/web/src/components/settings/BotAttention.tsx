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

export function BotAttention({ environmentId }: { environmentId: EnvironmentId }) {
  const query = useEnvironmentQuery(openbot.attention({ environmentId, input: {} }));
  const changes = useEnvironmentQuery(openbot.changes({ environmentId, input: {} }));
  const agents = useEnvironmentQuery(openbot.agents({ environmentId, input: {} }));
  const canRespond = useAtomValue(openbot.attentionRespond.permissionAtom(environmentId));
  const snapshot = query.data;
  const ready = snapshot?.state === "ready" && !query.error && !changes.error && !query.isPending;
  return (
    <section aria-label="Bot requests" className="space-y-3">
      <h3 className="text-sm font-medium">Needs your input</h3>
      {(query.error || changes.error) && (
        <p role="alert" className="text-sm text-destructive">
          {query.error ?? changes.error}
        </p>
      )}
      {(!snapshot || snapshot.state !== "ready") && (
        <p role="status" className="text-sm text-muted-foreground">
          {snapshot?.state === "disconnected"
            ? "Bot requests are unavailable while the engine is offline."
            : "Connecting to live bot requests…"}
        </p>
      )}
      {snapshot?.state === "ready" && !snapshot.complete && (
        <p role="status" className="text-sm text-muted-foreground">
          Showing a partial set of requests. More may be waiting; this list updates as you respond.
        </p>
      )}
      {ready && snapshot.complete && snapshot.requests.length === 0 && (
        <p className="text-sm text-muted-foreground">No bot requests are waiting.</p>
      )}
      {!canRespond && (
        <p className="text-sm text-muted-foreground">
          Settings permission is required to respond to bot requests.
        </p>
      )}
      {snapshot?.requests.map((request) => (
        <AttentionRequest
          key={`${snapshot.hostId}:${request.kind}:${request.requestId}`}
          environmentId={environmentId}
          hostId={snapshot?.hostId ?? null}
          request={request}
          agentName={
            agents.data?.find((agent) => agent.id === request.agentId)?.name ?? request.agentId
          }
          disabled={!ready || !canRespond}
        />
      ))}
    </section>
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
  const answer = promptAnswerRequest(request, answers);
  const unavailable = disabled || busy || submitted || hostId === null;
  const approval = request.approval;
  const tabId = request.tabId;
  return (
    <div className="space-y-3 rounded-lg border p-4">
      <p className="break-words text-sm font-medium">
        {agentName} ·{" "}
        {request.kind === "approval"
          ? `${request.approvalKind ?? "Action"} approval`
          : request.kind === "prompt"
            ? "Question"
            : "Browser help"}
      </p>
      {(busy || submitted) && (
        <p role="status" className="text-sm text-muted-foreground">
          {busy ? "Sending response…" : "Response sent. Waiting for the bot…"}
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
                  <dt className="text-muted-foreground">Command</dt>
                  <dd>
                    <pre className="whitespace-pre-wrap break-all font-mono">
                      {approval.command}
                    </pre>
                  </dd>
                </div>
              )}
              {approval.cwd && (
                <div>
                  <dt className="text-muted-foreground">Working directory</dt>
                  <dd>{approval.cwd}</dd>
                </div>
              )}
              {approval.reason && (
                <div>
                  <dt className="text-muted-foreground">Reason</dt>
                  <dd>{approval.reason}</dd>
                </div>
              )}
              {approval.grantRoot && (
                <div>
                  <dt className="text-muted-foreground">Access root</dt>
                  <dd>{approval.grantRoot}</dd>
                </div>
              )}
              {approval.permissions && (
                <div>
                  <dt className="text-muted-foreground">Requested permissions</dt>
                  <dd>
                    Read: {approval.permissions.fileSystem.read.join(", ") || "None"}
                    <br />
                    Write: {approval.permissions.fileSystem.write.join(", ") || "None"}
                    <br />
                    Network: {approval.permissions.network ? "Allowed" : "Not requested"}
                  </dd>
                </div>
              )}
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">
              Approval details are unavailable. Review this request on the host.
            </p>
          )}
          {approval?.truncated && (
            <p className="text-sm text-muted-foreground">
              These details were shortened by the engine. Review the complete request on the host
              before approving.
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
              Approve once
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
              Decline
            </Button>
          </div>
        </>
      )}
      {request.kind === "prompt" && (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (answer) void respond(answer);
          }}
        >
          {request.questions?.map((question) => (
            <fieldset key={question.id} disabled={unavailable} className="space-y-2">
              <legend className="text-sm font-medium">{question.header || "Question"}</legend>
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
              Send answer
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
              Cancel request
            </Button>
          </div>
        </form>
      )}
      {request.kind === "takeover" && (
        <>
          <p className="text-sm">
            {request.takeoverReason === "sign-in-blocked"
              ? "The website blocked sign-in. Finish signing in using the bot’s browser on its host."
              : "This bot needs you to finish a step in its browser on the host."}
          </p>
          {request.browserSecret && (
            <p className="break-words text-sm text-muted-foreground">
              {request.browserSecret.origin} ·{" "}
              {request.browserSecret.method === "password"
                ? "Password required"
                : "Verification code required"}
            </p>
          )}
          {tabId && (
            <Button
              variant="outline"
              size="sm"
              disabled={unavailable}
              onClick={() => void respond({ operation: "browser.activate", tabId })}
            >
              Show tab on host
            </Button>
          )}
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={reviewed}
              disabled={unavailable}
              onCheckedChange={(value) => setReviewed(value === true)}
            />
            I finished the browser step on the host
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
              Resume bot
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
              Cancel request
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
