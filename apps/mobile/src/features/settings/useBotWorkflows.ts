import { useRef, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, OpenbotWorkflowAdminRequest } from "@t3tools/contracts";
import {
  workflowAgents,
  workflowList,
  workflowDetail,
  workflowVersions,
  workflowRuns,
  workflowRun,
  workflowVersionGraph,
  workflowDraft,
  workflowSaveRequest,
  workflowSaveOutcome,
  type WorkflowDraft,
} from "@t3tools/client-runtime/openbot/presentation";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { openbot } from "../../state/openbot";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";

export function useBotWorkflows(environmentId: EnvironmentId, hostId: string, newId: () => string) {
  const [selected, setSelected] = useState<string | null>(null);
  const agentsQuery = useEnvironmentQuery(
    openbot.readFromHost({
      environmentId,
      input: { hostId, request: { operation: "agent.list" } },
    }),
  );
  const [versionId, setVersionId] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [before, setBefore] = useState<string | undefined>();
  const [draft, setDraft] = useState<WorkflowDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const lock = useRef(false);
  const receipts = useRef(new Map<string, string>());
  const listQuery = useEnvironmentQuery(
    openbot.readFromHost({
      environmentId,
      input: { hostId, request: { operation: "workflow.list" } },
    }),
  );
  const detailQuery = useEnvironmentQuery(
    selected
      ? openbot.readFromHost({
          environmentId,
          input: { hostId, request: { operation: "workflow.get", workflowId: selected } },
        })
      : null,
  );
  const versionsQuery = useEnvironmentQuery(
    selected
      ? openbot.readFromHost({
          environmentId,
          input: { hostId, request: { operation: "workflow.versions", workflowId: selected } },
        })
      : null,
  );
  const runsQuery = useEnvironmentQuery(
    selected
      ? openbot.readFromHost({
          environmentId,
          input: {
            hostId,
            request: {
              operation: "workflow.runs",
              workflowId: selected,
              limit: 10,
              ...(before ? { before } : {}),
            },
          },
        })
      : null,
  );
  const runQuery = useEnvironmentQuery(
    runId
      ? openbot.readFromHost({
          environmentId,
          input: { hostId, request: { operation: "workflow.run", runId } },
        })
      : null,
  );
  const versionQuery = useEnvironmentQuery(
    selected && versionId
      ? openbot.readFromHost({
          environmentId,
          input: {
            hostId,
            request: { operation: "workflow.versionGraph", workflowId: selected, versionId },
          },
        })
      : null,
  );
  const canManage = useAtomValue(
    openbot.adminToHost.permissionAtom(environmentId, {
      hostId,
      request: { operation: "workflow.create", title: "Workflow" },
    }),
  );
  const canRun = useAtomValue(
    openbot.adminToHost.permissionAtom(environmentId, {
      hostId,
      request: {
        operation: "workflow.startRun",
        workflowId: selected ?? "permission",
        requestId: "permission",
      },
    }),
  );
  const admin = useAtomCommand(openbot.adminToHost, { reportFailure: false });
  const refresh = () => {
    listQuery.refresh();
    detailQuery.refresh();
    versionsQuery.refresh();
    runsQuery.refresh();
    runQuery.refresh();
    versionQuery.refresh();
  };
  const act = async (request: OpenbotWorkflowAdminRequest) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    const result = await admin({ environmentId, input: { hostId, request } }).catch(() => null);
    if (!result) setError("The workflow request could not complete. Retry the same action.");
    else if (result._tag === "Failure") setError(String(squashAtomCommandFailure(result)));
    else {
      if ("requestId" in request)
        receipts.current.delete(
          JSON.stringify([
            request.operation,
            "workflowId" in request ? request.workflowId : null,
            "nodeId" in request ? request.nodeId : null,
            "stepId" in request ? request.stepId : null,
          ]),
        );
      if (request.operation === "workflow.create") {
        const created = workflowDetail(result.value);
        if (created) {
          setSelected(created.summary.id);
          setRunId(null);
          setVersionId(null);
          setBefore(undefined);
          setDraft(workflowDraft(created));
        } else setError("The engine returned an unsupported workflow.");
      } else if (request.operation === "workflow.saveGraph" && draft) {
        const outcome = workflowSaveOutcome(draft, result.value);
        if (outcome?.state === "saved") {
          setDraft(null);
          setNotice("Workflow saved.");
        } else if (outcome?.state === "conflict") {
          setDraft(outcome.draft);
          setError(
            "Another device changed this workflow. Your draft is retained; review the server version before saving.",
          );
        } else
          setError("The engine returned an unsupported save result. Reload before saving again.");
      } else if (request.operation === "workflow.delete") {
        setSelected(null);
        setDraft(null);
        setRunId(null);
      } else if (request.operation === "workflow.restoreVersion") {
        setDraft(null);
        setNotice("Version restored.");
      } else if (request.operation === "workflow.startRun") {
        const started = workflowRun(result.value);
        if (started) {
          setRunId(started.run.id);
          setBefore(undefined);
        }
      }
      refresh();
    }
    setBusy(false);
    lock.current = false;
  };
  const start = (
    operation: "workflow.startRun" | "workflow.runStep" | "workflow.retryStep",
    nodeOrStepId?: string,
  ) => {
    if (!selected) return;
    const key = JSON.stringify([
      operation,
      operation === "workflow.retryStep" ? null : selected,
      operation === "workflow.runStep" ? nodeOrStepId : null,
      operation === "workflow.retryStep" ? nodeOrStepId : null,
    ]);
    const requestId = receipts.current.get(key) ?? newId();
    receipts.current.set(key, requestId);
    if (operation === "workflow.startRun") void act({ operation, workflowId: selected, requestId });
    else if (operation === "workflow.runStep" && nodeOrStepId)
      void act({ operation, workflowId: selected, nodeId: nodeOrStepId, requestId });
    else if (operation === "workflow.retryStep" && nodeOrStepId)
      void act({ operation, stepId: nodeOrStepId, requestId });
  };
  const selectedDetail = workflowDetail(detailQuery.data);
  const runs = workflowRuns(runsQuery.data);
  return {
    agents: workflowAgents(agentsQuery.data),
    selected,
    detail: selectedDetail,
    workflows: workflowList(listQuery.data),
    versions: workflowVersions(versionsQuery.data),
    runs,
    versionGraph: workflowVersionGraph(versionQuery.data),
    inspectVersion: setVersionId,
    activeRun: workflowRun(runQuery.data) ?? runs?.runs[0] ?? null,
    graph: draft?.graph ?? selectedDetail?.graph ?? null,
    busy,
    error:
      error ??
      listQuery.error ??
      detailQuery.error ??
      versionsQuery.error ??
      runsQuery.error ??
      runQuery.error ??
      versionQuery.error,
    notice,
    reportError: setError,
    canManage,
    canRun,
    draft,
    setDraft,
    act,
    start,
    refresh,
    loading: listQuery.isPending || detailQuery.isPending || runsQuery.isPending,
    select: (id: string) => {
      setSelected(id);
      setVersionId(null);
      setDraft(null);
      setRunId(null);
      setBefore(undefined);
      setError(null);
      setNotice(null);
    },
    inspectRun: setRunId,
    older: () => {
      if (runs?.nextBefore) {
        setBefore(runs.nextBefore);
        setRunId(null);
      }
    },
    newest: () => {
      setBefore(undefined);
      setRunId(null);
    },
    save: () => {
      if (draft) {
        const request = workflowSaveRequest(draft);
        if (request) void act(request);
      }
    },
  };
}
