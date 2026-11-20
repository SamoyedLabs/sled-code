import { useEffect, useRef, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { OpenbotFileSummary, type EnvironmentId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { openbot } from "../../state/openbot";
import { randomUUID } from "../../lib/utils";
import { useStableCallback } from "../../hooks/useStableCallback";
import { useWorkspaceFiles, WorkspaceUploadRecord } from "../bots/upstream/useWorkspaceFiles";

export type ComposerUpload = {
  key: string;
  name: string;
  size: number;
  error: string | null;
  removing: boolean;
};
type Job = {
  key: string;
  file?: File;
  operationId?: string;
  abort: AbortController;
  removing: boolean;
  done?: Promise<void>;
};
const decodeFile = Schema.decodeUnknownSync(OpenbotFileSummary);
const decodePending = Schema.decodeUnknownSync(Schema.Array(WorkspaceUploadRecord));
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "The file upload did not complete.";

/** Source composer import UI, backed by the existing durable original-upload workflow. */
export function useBotComposerUploads(props: {
  environmentId: EnvironmentId;
  hostId: string;
  agentId: string;
  taskId: string | null;
  threadId: string | undefined;
  disabled: boolean;
  selectedCount: number;
  onReady: (id: string, beforeId?: string) => void;
}) {
  const permission = useAtomValue(openbot.fileOriginalUpload.permissionAtom(props.environmentId));
  const action = useWorkspaceFiles(props.environmentId, props.hostId);
  const perform = useStableCallback(action);
  const [uploads, setUploads] = useState<ComposerUpload[]>([]);
  const [error, setError] = useState<string | null>(null);
  const jobs = useRef(new Map<string, Job>());
  const importOrder = useRef<{ key: string; attachmentId?: string }[]>([]);
  const alive = useRef(false);
  const target = { agentId: props.agentId, taskId: props.taskId, threadId: props.threadId };
  const current = useStableCallback(
    (threadId: string | undefined) =>
      alive.current &&
      permission &&
      !props.disabled &&
      Boolean(threadId) &&
      props.threadId === threadId,
  );
  const ready = useStableCallback(props.onReady);
  const available = Boolean(permission && props.threadId && !props.disabled);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Recover only the durable upload reservations for this exact mounted conversation; cleanup aborts temporary transport and retains original identities for recovery.
  useEffect(() => {
    alive.current = true;
    let attached = true;
    if (props.threadId && permission) {
      void perform(
        "original-pending",
        {
          hostId: props.hostId,
          target: { agentId: props.agentId, taskId: props.taskId, threadId: props.threadId },
        },
        { current: () => attached },
      )
        .then((value) => {
          if (!attached) return;
          for (const record of decodePending(value)) {
            if (
              [...jobs.current.values()].some(
                (job) => job.operationId === record.identity.operationId,
              )
            )
              continue;
            const key = record.identity.operationId;
            importOrder.current.push({ key });
            jobs.current.set(key, {
              key,
              operationId: key,
              abort: new AbortController(),
              removing: false,
            });
            setUploads((items) => [
              ...items,
              {
                key,
                name: record.identity.name,
                size: record.identity.size,
                error: "Upload interrupted. Retry to recover the original file.",
                removing: false,
              },
            ]);
          }
        })
        .catch((failure: unknown) => {
          if (attached) setError(errorText(failure));
        });
    }
    const activeJobs = jobs.current;
    return () => {
      attached = false;
      alive.current = false;
      for (const job of activeJobs.values()) job.abort.abort();
    };
  }, [permission, perform, props.agentId, props.hostId, props.taskId, props.threadId]);

  const run = (job: Job) => {
    const threadId = props.threadId;
    job.abort = new AbortController();
    setUploads((items) =>
      items.map((item) => (item.key === job.key ? { ...item, error: null } : item)),
    );
    job.done = (async () => {
      try {
        const value = await perform(
          job.file ? "original-upload" : "original-recover",
          { hostId: props.hostId, target, file: job.file, operationId: job.operationId },
          {
            signal: job.abort.signal,
            current: () => current(threadId),
            onIdentity: (identity) => {
              job.operationId = identity.operationId;
            },
          },
        );
        if (!current(threadId) || job.removing) return;
        const file = decodeFile(value);
        const index = importOrder.current.findIndex((item) => item.key === job.key);
        const imported = importOrder.current[index];
        if (imported) imported.attachmentId = file.id;
        const beforeId = importOrder.current
          .slice(index + 1)
          .find((item) => item.attachmentId)?.attachmentId;
        ready(file.id, beforeId);
        jobs.current.delete(job.key);
        if (jobs.current.size === 0) importOrder.current = [];
        setUploads((items) => items.filter((item) => item.key !== job.key));
      } catch (failure) {
        if (alive.current && !job.removing)
          setUploads((items) =>
            items.map((item) =>
              item.key === job.key ? { ...item, error: errorText(failure) } : item,
            ),
          );
      }
    })();
  };

  return {
    available,
    uploads,
    error,
    add: (files: File[]) => {
      if (!available || !files.length) return;
      if (props.selectedCount + jobs.current.size + files.length > 10) {
        setError("Choose up to 10 files per message.");
        return;
      }
      setError(null);
      for (const file of files) {
        const key = randomUUID();
        const job: Job = { key, file, abort: new AbortController(), removing: false };
        jobs.current.set(key, job);
        importOrder.current.push({ key });
        setUploads((items) => [
          ...items,
          { key, name: file.name, size: file.size, error: null, removing: false },
        ]);
        run(job);
      }
    },
    retry: (key: string) => {
      const job = jobs.current.get(key);
      if (job && available && !job.removing) run(job);
    },
    remove: async (key: string) => {
      const job = jobs.current.get(key);
      if (!job || job.removing) return;
      job.removing = true;
      job.abort.abort();
      setUploads((items) =>
        items.map((item) => (item.key === key ? { ...item, removing: true } : item)),
      );
      try {
        // Wait for an in-flight original RPC before releasing it; a late ready receipt must not win a cancellation race.
        await job.done;
        if (job.operationId)
          await perform(
            "original-release",
            { hostId: props.hostId, target, operationId: job.operationId },
            { current: () => current(props.threadId) },
          );
        jobs.current.delete(key);
        importOrder.current =
          jobs.current.size === 0 ? [] : importOrder.current.filter((item) => item.key !== key);
        if (alive.current) setUploads((items) => items.filter((item) => item.key !== key));
      } catch (failure) {
        job.removing = false;
        if (alive.current)
          setUploads((items) =>
            items.map((item) =>
              item.key === key ? { ...item, removing: false, error: errorText(failure) } : item,
            ),
          );
      }
    },
  };
}
