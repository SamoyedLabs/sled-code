/* oxlint-disable shadcn/no-unknown-classes -- Pinned progress.tsx track/fill structure and source indeterminate motion. */
import { Progress } from "@base-ui/react/progress";
import "./SourceProgress.css";
export function SourceProgress({
  value,
  label,
  className,
}: {
  value?: number | null | undefined;
  label: string;
  className?: string;
}) {
  return (
    <Progress.Root
      value={value ?? null}
      aria-label={label}
      className={`ui-progress ${className ?? ""}`}
      data-slot="progress"
    >
      <Progress.Track className="ui-progress-track" data-slot="progress-track">
        <Progress.Indicator
          className="ui-progress-fill"
          data-slot="progress-fill"
          data-indeterminate={value == null ? "" : undefined}
        />
      </Progress.Track>
    </Progress.Root>
  );
}
