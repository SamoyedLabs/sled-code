/* oxlint-disable shadcn/no-unknown-classes -- Pinned OpenBot select styling on Base UI. */
import { Select } from "@base-ui/react/select";
import { CheckIcon, ChevronDownIcon } from "lucide-react";
import { menuMotionRef } from "../openbotMenuMotion";
import { renderClosingPositioner } from "~/components/ui/closing-positioner";
export function SourceSelect({
  value,
  onChange,
  options,
  label,
  disabled,
  className,
}: {
  value: string | null | undefined;
  onChange: (value: string) => void;
  options: readonly { id: string; name: string }[];
  label: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div className={`ui-select ${className ?? ""}`}>
      <Select.Root
        value={value ?? null}
        onValueChange={(next) => {
          if (next !== null) onChange(next);
        }}
        disabled={disabled}
        items={options.map((option) => ({ value: option.id, label: option.name }))}
      >
        <Select.Trigger className="ui-select-trigger" data-size="sm" aria-label={label}>
          <Select.Value className="ui-select-value" />
          <Select.Icon className="ui-select-trigger-icon">
            <ChevronDownIcon aria-hidden="true" />
          </Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Positioner
            sideOffset={4}
            alignItemWithTrigger={false}
            className="openbot-react openbot-popup-positioner"
            data-openbot-positioner=""
            render={renderClosingPositioner}
          >
            <Select.Popup
              className="ui-select-content provider-model-effort-content"
              ref={menuMotionRef(undefined)}
            >
              <Select.List className="ui-select-listbox">
                {options.map((option) => (
                  <Select.Item className="ui-select-item" key={option.id} value={option.id}>
                    <Select.ItemText className="ui-select-item-label">
                      {option.name}
                    </Select.ItemText>
                    <Select.ItemIndicator className="ui-select-item-indicator">
                      <CheckIcon aria-hidden="true" />
                    </Select.ItemIndicator>
                  </Select.Item>
                ))}
              </Select.List>
            </Select.Popup>
          </Select.Positioner>
        </Select.Portal>
      </Select.Root>
    </div>
  );
}
