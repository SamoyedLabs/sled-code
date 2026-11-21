import { RegistryContext, useAtomValue } from "@effect/atom-react";
import {
  useContext,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
import { type EnvironmentId, OpenbotAdminRequest } from "@t3tools/contracts";
import { settingsCapabilities } from "@t3tools/client-runtime/openbot/settings";
import { settlePromise, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { openbot } from "../../state/openbot";
import { useAtomCommand } from "../../state/use-atom-command";
import { useEnvironmentQuery } from "../../state/query";
import { readPreparedConnection, usePreparedConnection } from "../../state/session";
import { useSourceProviderData } from "./SourceProviderEnvironment";
import { FirstAgentSetup } from "./upstream/create-agent/FirstAgentSetup";
import {
  createFirstAgentDraft,
  creationInput,
  resolveCreationModel,
  type FirstAgentDraft,
} from "./upstream/create-agent/agent-draft";
import {
  clearCreateAttempt,
  retainedCreateAttempt,
  retainCreateAttempt,
} from "./upstream/create-agent/create-attempt";
import { useGT } from "gt-react";
const decodeCreate = Schema.decodeUnknownSync(OpenbotAdminRequest),
  decodeCreated = Schema.decodeUnknownSync(
    Schema.Struct({ id: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)) }),
  );
export type { FirstAgentDraft } from "./upstream/create-agent/agent-draft";
export type SourceCreateAgentProps = {
  environmentId: EnvironmentId;
  hostId: string;
  first?: boolean;
  initialDraft?: FirstAgentDraft;
  onDraftChange?: ((draft: FirstAgentDraft) => void) | undefined;
  onCancel?: (() => void) | undefined;
  onCreated: (agentId: string) => void | Promise<void>;
  onManageProviders?: (() => void) | undefined;
  render?: ((form: ComponentProps<typeof FirstAgentSetup>) => ReactNode) | undefined;
};
export function SourceCreateAgent(props: SourceCreateAgentProps) {
  const connection = Option.getOrNull(usePreparedConnection(props.environmentId));
  const [session, setSession] = useState({ connection, epoch: 0 });
  if (session.connection !== connection) setSession({ connection, epoch: session.epoch + 1 });
  return <CreateHost key={`${props.environmentId}:${props.hostId}:${session.epoch}`} {...props} />;
}
function CreateHost(props: SourceCreateAgentProps) {
  const gt = useGT();
  const data = useSourceProviderData(),
    registry = useContext(RegistryContext),
    admin = useAtomCommand(openbot.adminToHost, { reportFailure: false }),
    connection = readPreparedConnection(props.environmentId),
    scope = JSON.stringify([props.environmentId, props.hostId]);
  const previous = connection ? retainedCreateAttempt(connection, scope) : null;
  const [draft, setDraft] = useState(
      () => previous?.draft ?? props.initialDraft ?? createFirstAgentDraft(),
    ),
    [busy, setBusy] = useState(false),
    [blocked, setBlocked] = useState(Boolean(previous)),
    [error, setError] = useState<string | null>(
      previous
        ? "The previous creation has not been confirmed. Check the host’s agents before creating another."
        : null,
    ),
    [modelTouched, setModelTouched] = useState(Boolean(props.initialDraft)),
    [seenCatalog, setSeenCatalog] = useState<{
      models: NonNullable<typeof data>["modelOptions"] | undefined;
      status: NonNullable<typeof data>["status"] | undefined;
      supported: boolean;
    }>({ models: undefined, status: undefined, supported: false });
  const lock = useRef(false),
    alive = useRef(true);
  const compatibility = useEnvironmentQuery(
    openbot.readFromHost({
      environmentId: props.environmentId,
      input: { hostId: props.hostId, request: { operation: "compatibility.read" } },
    }),
  );
  const supportsModel = settingsCapabilities(compatibility.data).includes("agent-create-model");
  if (
    data?.modelOptions !== seenCatalog.models ||
    data?.status !== seenCatalog.status ||
    supportsModel !== seenCatalog.supported
  ) {
    setSeenCatalog({ models: data?.modelOptions, status: data?.status, supported: supportsModel });
    if (!modelTouched && !blocked && supportsModel) {
      const next = resolveCreationModel(data?.modelOptions ?? [], data?.status ?? null);
      if (next) setDraft((current) => ({ ...current, ...next, reasoningEffort: undefined }));
    }
  }
  const permissionRequest = {
    operation: "agent.create" as const,
    input: {
      name: "permission check",
      description: "",
      initialMessage: gt("permission check"),
      avatarSeed: "first-bot",
      avatarHue: null,
    },
  };
  const allowed = useAtomValue(
    openbot.adminToHost.permissionAtom(props.environmentId, {
      hostId: props.hostId,
      request: permissionRequest,
    }),
  );
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Late creation replies must not navigate a closed or replaced host form.
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const change = (next: FirstAgentDraft) => {
    if (busy || blocked) return;
    if (next.provider !== draft.provider || next.model !== draft.model) setModelTouched(true);
    setDraft(next);
    props.onDraftChange?.(next);
  };
  const create = async () => {
    if (lock.current || blocked || !allowed || !draft.name.trim() || draft.purpose.length > 2000)
      return;
    setError(null);
    if (!connection || readPreparedConnection(props.environmentId) !== connection) {
      setError(gt("Reconnect the original host session before creating an agent."));
      return;
    }
    let request: OpenbotAdminRequest;
    try {
      const selected = data?.modelOptions.find(
        (row) => row.provider === draft.provider && row.id === draft.model,
      );
      request = decodeCreate({
        operation: "agent.create",
        input: creationInput(draft, supportsModel && Boolean(selected)),
      });
    } catch {
      setError(gt("Check the agent name, instructions, and model before creating."));
      return;
    }
    if (
      !registry.get(
        openbot.adminToHost.permissionAtom(props.environmentId, { hostId: props.hostId, request }),
      )
    ) {
      setError(gt("You do not have permission to create an agent."));
      return;
    }
    lock.current = true;
    setBusy(true);
    retainCreateAttempt(connection, scope, { draft, agentId: null });
    const settled = await settlePromise(async () => {
      const result = await admin({
        environmentId: props.environmentId,
        input: { hostId: props.hostId, request },
      });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      const created = decodeCreated(result.value);
      retainCreateAttempt(connection, scope, { draft, agentId: created.id });
      if (!alive.current || readPreparedConnection(props.environmentId) !== connection) return;
      setBlocked(true);
      await props.onCreated(created.id);
      clearCreateAttempt(connection, scope);
    });
    if (settled._tag === "Failure" && alive.current) {
      const cause = squashAtomCommandFailure(settled);
      setBlocked(true);
      setError(
        gt(
          "The creation could not be confirmed. Check the host’s agents before creating another. {value}",
          { value: cause instanceof Error ? cause.message : "" },
        ),
      );
    }
    lock.current = false;
    if (alive.current) setBusy(false);
  };
  const openCreated = previous?.agentId
    ? async () => {
        if (!connection || readPreparedConnection(props.environmentId) !== connection) return;
        setBusy(true);
        const settled = await settlePromise(async () => {
          await props.onCreated(previous.agentId!);
          clearCreateAttempt(connection, scope);
        });
        if (settled._tag === "Failure") {
          const cause = squashAtomCommandFailure(settled);
          setError(
            cause instanceof Error ? cause.message : gt("Could not open the created agent."),
          );
        }
        if (alive.current) setBusy(false);
      }
    : undefined;
  const form: ComponentProps<typeof FirstAgentSetup> = {
    value: draft,
    first: props.first ?? false,
    busy,
    blocked,
    error:
      previous?.agentId && blocked
        ? gt(
            "The agent was created, but the workspace could not open it. Open the created agent to continue.",
          )
        : (error ?? data?.error ?? null),
    canCreate: allowed,
    modelSupported: supportsModel,
    providerData: data,
    onChange: change,
    onSubmit: create,
    onOpenCreated: openCreated,
    onCancel: props.onCancel,
    onManageProviders: props.onManageProviders,
  };
  return props.render ? (
    <CreateFormSlot render={props.render} form={form} />
  ) : (
    <FirstAgentSetup {...form} />
  );
}

function CreateFormSlot({
  render,
  form,
}: {
  render: (form: ComponentProps<typeof FirstAgentSetup>) => ReactNode;
  form: ComponentProps<typeof FirstAgentSetup>;
}) {
  return render(form);
}
