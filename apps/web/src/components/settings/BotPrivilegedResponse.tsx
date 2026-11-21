import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ShieldCheckIcon } from "lucide-react";
import {
  isSecretFormField,
  validateUiBlockResponse,
  type UiBlockSpec,
} from "@t3tools/contracts/openbot-ui-blocks";
import {
  createPrivilegedResponseController,
  type PrivilegedResponseScope,
} from "@t3tools/client-runtime/openbot/privileged-response";
import type {
  PrivilegedResponseRequest,
  PrivilegedResponseResult,
} from "@t3tools/contracts/openbot-privileged-response";
import { settlePromise } from "@t3tools/client-runtime/state/runtime";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { T, useGT } from "gt-react";

type Props = {
  scope: PrivilegedResponseScope;
  spec: UiBlockSpec;
  available: boolean;
  current: () => PrivilegedResponseScope | null;
  execute: (request: PrivilegedResponseRequest) => Promise<PrivilegedResponseResult>;
};
export function BotPrivilegedResponse(props: Props) {
  return <ResponseForm key={JSON.stringify(props.scope)} {...props} />;
}
function ResponseForm({ scope, spec, available, current, execute }: Props) {
  const gt = useGT();
  const [binding] = useState(() => ({ scope, current, execute }));
  const controller = useRef<ReturnType<typeof createPrivilegedResponseController> | null>(null);
  const inFlight = useRef(false);
  const inputId = useId();
  const [values, setValues] = useState<Record<string, string>>(() =>
    spec.type === "form"
      ? Object.fromEntries(
          spec.fields.flatMap((field) =>
            !isSecretFormField(field) && field.value !== undefined ? [[field.id, field.value]] : [],
          ),
        )
      : {},
  );
  const [phase, setPhase] = useState<"editing" | "submitting" | "submitted">("editing");
  const [status, setStatus] = useState("");
  const [action, setAction] = useState<string | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Clear private fields and invalidate pending context acquisition when the page hides or the original request unmounts.
  useEffect(() => {
    const active = createPrivilegedResponseController(binding.scope, binding);
    controller.current = active;
    const clear = () => {
      if (document.hidden) {
        setValues({});
        setAction(null);
        active.clearForm();
      }
    };
    document.addEventListener("visibilitychange", clear);
    return () => {
      document.removeEventListener("visibilitychange", clear);
      active.close();
      if (controller.current === active) controller.current = null;
    };
  }, [binding]);
  if (!available)
    return (
      <p>
        <T>Secure response is unavailable for this connection.</T>
      </p>
    );
  const disabled = phase !== "editing";
  const send = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const active = controller.current;
    if (!active || inFlight.current || phase !== "editing") return;
    const response = validateUiBlockResponse(spec, {
      actionId: spec.type === "form" ? "submit" : action,
      values,
    });
    if (!response) {
      setStatus(gt("Check the required fields."));
      return;
    }
    inFlight.current = true;
    setPhase("submitting");
    setValues({});
    setAction(null);
    setStatus("");
    let attempted = false;
    const settled = await settlePromise(async () => {
      if (!(await active.prepare())) {
        setStatus(gt("This request is no longer available. Reopen the current request."));
        return;
      }
      attempted = true;
      const result = await active.submit(response);
      setStatus(
        result?.status === "answered"
          ? gt("Response delivered.")
          : gt("Delivery is not confirmed. Check the result before taking further action."),
      );
    });
    if (settled._tag === "Failure") {
      setStatus(
        attempted
          ? gt("Delivery is not confirmed. Check the result before taking further action.")
          : gt("This request is unavailable. Your fields were cleared."),
      );
    }
    inFlight.current = false;
    setPhase(attempted ? "submitted" : "editing");
  };
  const options = (id: string, label: string, entries: readonly string[]) => (
    <Select
      value={values[id] ?? ""}
      disabled={disabled}
      onValueChange={(value) => setValues((old) => ({ ...old, [id]: value ?? "" }))}
    >
      <SelectTrigger id={`${inputId}-${id}`} aria-label={label}>
        <SelectValue placeholder={gt("Choose…")} />
      </SelectTrigger>
      <SelectContent>
        {entries.map((option) => (
          <SelectItem key={option} value={option}>
            {option}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
  return (
    <form
      aria-label={gt("Secure response")}
      className="flex min-w-0 max-w-lg flex-col gap-3 rounded-xl border border-border/60 bg-card p-4"
      onSubmit={send}
      autoComplete="off"
    >
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-sm font-medium text-foreground">{spec.title}</p>
        <p className="text-sm text-muted-foreground">
          <T>Fill in each field below.</T>
        </p>
      </div>
      {spec.type === "form" &&
        spec.fields.map((field) => {
          const label = field.label ?? field.id;
          return (
            <label
              key={field.id}
              htmlFor={`${inputId}-${field.id}`}
              className="flex min-w-0 flex-col gap-1.5 text-sm"
            >
              <span>{label}</span>
              {field.kind === "select" || field.kind === "segmented" ? (
                options(field.id, label, field.options)
              ) : field.kind === "textarea" && !isSecretFormField(field) ? (
                <Textarea
                  id={`${inputId}-${field.id}`}
                  value={values[field.id] ?? ""}
                  required={field.required}
                  disabled={disabled}
                  onChange={(event) =>
                    setValues((old) => ({ ...old, [field.id]: event.target.value }))
                  }
                />
              ) : (
                <Input
                  id={`${inputId}-${field.id}`}
                  type={field.kind === "date" ? "date" : "text"}
                  className={isSecretFormField(field) ? "[-webkit-text-security:disc]" : undefined}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  data-1p-ignore
                  data-lpignore="true"
                  data-bwignore
                  required={field.required}
                  placeholder={"placeholder" in field ? field.placeholder : undefined}
                  value={values[field.id] ?? ""}
                  disabled={disabled}
                  onChange={(event) =>
                    setValues((old) => ({ ...old, [field.id]: event.target.value }))
                  }
                />
              )}
            </label>
          );
        })}
      {spec.type === "confirm" && (
        <>
          {spec.preview && <p className="whitespace-pre-wrap text-sm">{spec.preview}</p>}
          {spec.fields?.map((field) => (
            <div
              key={"select" in field ? field.select : field.label}
              className="flex flex-col gap-1.5 text-sm"
            >
              <span>{field.label}</span>
              {"value" in field ? (
                <span className="text-muted-foreground">{field.value}</span>
              ) : (
                options(field.select, field.label, field.options)
              )}
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            {spec.actions.map((item) => (
              <Button
                key={item.id}
                type="button"
                variant={action === item.id ? "default" : "outline"}
                disabled={disabled}
                onClick={() => setAction(item.id)}
              >
                {item.label}
              </Button>
            ))}
          </div>
        </>
      )}
      <div className="flex items-center justify-end gap-2">
        {phase === "editing" && (
          <Button
            type="button"
            variant="ghost-muted"
            size="xs"
            onClick={() => {
              setValues({});
              setAction(null);
              setStatus("");
              controller.current?.clearForm();
            }}
          >
            <T>Clear</T>
          </Button>
        )}
        <Button type="submit" disabled={disabled || (spec.type === "confirm" && !action)}>
          {phase === "submitting"
            ? gt("Sending…")
            : spec.type === "form"
              ? (spec.submit ?? gt("Save securely"))
              : gt("Confirm and submit")}
        </Button>
      </div>
      <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
        <ShieldCheckIcon className="size-3.5 shrink-0" aria-hidden />
        <T>Private response · not posted as a chat message.</T>
      </p>
      <p role="status" className="text-xs text-muted-foreground">
        {status}
      </p>
      {phase === "submitted" && (
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            void controller.current
              ?.result()
              .then((result) =>
                setStatus(
                  result?.status === "answered"
                    ? gt("Response delivered.")
                    : gt("Delivery is not confirmed."),
                ),
              )
              .catch(() => setStatus(gt("Result unavailable.")))
          }
        >
          <T>Check result</T>
        </Button>
      )}
    </form>
  );
}
