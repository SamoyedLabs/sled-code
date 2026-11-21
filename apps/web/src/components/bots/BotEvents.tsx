import { useId, useState, type ReactNode } from "react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { T, Var, useGT } from "gt-react";

export function RoutineGroup({ children }: { children: ReactNode }) {
  return <div className="space-y-3">{children}</div>;
}
export function RoutineText({ children, alert = false }: { children: ReactNode; alert?: boolean }) {
  return (
    <p role={alert ? "alert" : undefined} className="whitespace-pre-wrap break-words text-sm">
      {children}
    </p>
  );
}
export function RoutineHeading({ children }: { children: ReactNode }) {
  return <h3 className="text-sm font-medium">{children}</h3>;
}
export function RoutineAction({
  label,
  onClick,
  disabled = false,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <Button variant="outline" size="sm" onClick={onClick} disabled={disabled}>
      {label}
    </Button>
  );
}
export function RoutineDisclosure({ label, children }: { label: string; children: ReactNode }) {
  const gt = useGT();
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  return (
    <section className="space-y-3" aria-label={label}>
      <Button
        variant="outline"
        size="sm"
        aria-expanded={expanded}
        aria-controls={id}
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? gt("Close {value}", { value: label.toLowerCase() }) : label}
      </Button>
      {expanded && <div id={id}>{children}</div>}
    </section>
  );
}
export function RoutineField({
  label,
  value,
  onChange,
  multiline = false,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  disabled?: boolean;
}) {
  return (
    <label className="block space-y-1 text-sm">
      <span>{label}</span>
      {multiline ? (
        <Textarea
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          rows={5}
        />
      ) : (
        <Input
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </label>
  );
}
export function RoutineChoice({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly { id: string; name: string }[];
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const gt = useGT();
  return (
    <label className="block space-y-1 text-sm">
      <span>{label}</span>
      <Select
        value={value || "__none"}
        disabled={disabled}
        onValueChange={(next) => {
          if (next) onChange(next === "__none" ? "" : next);
        }}
      >
        <SelectTrigger aria-label={label}>
          <SelectValue>
            {options.find((option) => option.id === value)?.name ??
              gt("Choose {value}", { value: label.toLowerCase() })}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {!options.some((option) => option.id === "") && (
            <SelectItem value="__none">
              <T>
                Choose <Var>{label.toLowerCase()}</Var>
              </T>
            </SelectItem>
          )}
          {options.map((option) => (
            <SelectItem key={option.id || "__none"} value={option.id || "__none"}>
              {option.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}
