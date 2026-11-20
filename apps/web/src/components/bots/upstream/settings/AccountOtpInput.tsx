/* oxlint-disable shadcn/no-unknown-classes -- Pinned OtpInput DOM and stylesheet. */
import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { useStableCallback } from "../../../../hooks/useStableCallback";
import { flushSync } from "react-dom";
import { ONE_TIME_CODE_ALPHABET } from "./account-model";
import { accountText as t } from "./account-text";
import "./account-otp.css";
const sanitize = (raw: string) =>
  [...raw.toUpperCase()]
    .filter((c) => ONE_TIME_CODE_ALPHABET.includes(c))
    .join("")
    .slice(0, 8);
const toSlots = (raw: string) => Array.from({ length: 8 }, (_, i) => sanitize(raw)[i] ?? "");
const firstEmpty = (parts: string[]) => {
  const i = parts.findIndex((c) => !c);
  return i < 0 ? 7 : i;
};

export type AccountOtpStatus = "idle" | "verifying" | "error" | "success";
export function AccountOtpInput(props: {
  value: string;
  status?: AccountOtpStatus;
  hint?: string;
  errorMessage?: string | null;
  disabled?: boolean;
  onChange: (value: string) => void;
  onComplete: (value: string) => void;
}) {
  const length = 8,
    groupAt = 4,
    status = props.status ?? "idle",
    disabled = Boolean(props.disabled || status === "verifying" || status === "success");
  const [slots, setSlots] = useState(() => toSlots(props.value)),
    [active, setActive] = useState(() => firstEmpty(toSlots(props.value))),
    [focused, setFocused] = useState(false);
  const input = useRef<HTMLInputElement>(null),
    slotElements = useRef<HTMLDivElement>(null),
    composing = useRef(false),
    completeAfterComposition = useRef(false),
    currentSlots = useRef(slots);
  const id = useId(),
    messageId = `${id}-message`;
  const message =
    status === "success"
      ? t("account.login.verified")
      : status === "error"
        ? (props.errorMessage ?? t("account.otp.incorrect"))
        : status === "verifying"
          ? t("account.otp.verifying")
          : props.hint;
  const syncNative = useStableCallback(() => {
    const value = currentSlots.current.join("");
    if (input.current && !composing.current && input.current.value !== value) {
      input.current.value = value;
      input.current.setSelectionRange(value.length, value.length);
    }
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Source OTP receives code reset when the host issues a new challenge; preserve slot holes for local editing.
  useEffect(() => {
    const incoming = sanitize(props.value);
    if (incoming === currentSlots.current.join("")) return;
    const next = toSlots(incoming);
    currentSlots.current = next;
    setSlots(next);
    setActive(firstEmpty(next));
    syncNative();
  }, [props.value, syncNative]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Return keyboard focus to the native OTP input after verification finishes.
  useEffect(() => {
    if (!disabled) input.current?.focus({ preventScroll: true });
  }, [disabled]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Play and dispose the source error shake on the OTP DOM element.
  useEffect(() => {
    if (status !== "error" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const animation = slotElements.current?.animate?.(
      [
        { transform: "translateX(0)" },
        { transform: "translateX(-5px)" },
        { transform: "translateX(5px)" },
        { transform: "translateX(-3px)" },
        { transform: "translateX(3px)" },
        { transform: "translateX(-1px)" },
        { transform: "translateX(0)" },
      ],
      { duration: 200, easing: "cubic-bezier(0.23, 1, 0.32, 1)" },
    );
    return () => animation?.cancel();
  }, [status]);
  const commit = (next: string[]) => {
    const previous = currentSlots.current.join("");
    currentSlots.current = next;
    setSlots(next);
    const value = next.join("");
    props.onChange(value);
    if (value === previous) return;
    const complete = next.every(Boolean);
    if (composing.current) {
      completeAfterComposition.current = complete;
      return;
    }
    if (complete) {
      props.onComplete(value);
      input.current?.focus({ preventScroll: true });
    }
  };
  const applyCode = (value: string) => {
    const next = toSlots(value);
    commit(next);
    setActive(firstEmpty(next));
  };
  const clearSlot = (index: number) => {
    const next = [...currentSlots.current];
    next[index] = "";
    commit(next);
  };
  const insert = (raw: string, from = active) => {
    const chars = sanitize(raw);
    if (!chars) return;
    const next = [...currentSlots.current];
    let index = from;
    for (const char of chars) {
      if (index >= length) break;
      next[index++] = char;
    }
    commit(next);
    setActive(Math.min(index, length - 1));
    syncNative();
  };
  const backspace = () => {
    if (currentSlots.current[active]) clearSlot(active);
    else if (active > 0) {
      clearSlot(active - 1);
      setActive(active - 1);
    }
  };
  const applyFieldValue = (raw: string) => {
    const value = sanitize(raw);
    if (value !== currentSlots.current.join("")) applyCode(value);
  };
  const handleInput = (event: FormEvent<HTMLInputElement>) => {
    if (disabled) {
      syncNative();
      return;
    }
    const native = event.nativeEvent as InputEvent,
      typed =
        native.inputType === "insertText" && !native.isComposing ? sanitize(native.data ?? "") : "";
    flushSync(() => {
      if (typed.length === 1) insert(typed);
      else if (native.inputType === "deleteContentBackward") backspace();
      else {
        const inserted = sanitize(native.data ?? "");
        if (inserted.length === length) applyCode(inserted);
        else applyFieldValue(event.currentTarget.value);
      }
    });
    syncNative();
  };
  const keyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (disabled) {
      event.preventDefault();
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey || event.nativeEvent.isComposing) return;
    const key = event.key.toUpperCase();
    if (key.length === 1 && ONE_TIME_CODE_ALPHABET.includes(key)) {
      event.preventDefault();
      insert(key);
      return;
    }
    if (!["Backspace", "Delete", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
      return;
    event.preventDefault();
    if (event.key === "Backspace") backspace();
    else if (event.key === "Delete") clearSlot(active);
    else if (event.key === "ArrowLeft") setActive((i) => Math.max(i - 1, 0));
    else if (event.key === "ArrowRight") setActive((i) => Math.min(i + 1, length - 1));
    else setActive(event.key === "Home" ? 0 : length - 1);
    syncNative();
  };
  const pointerDown = (event: PointerEvent<HTMLFieldSetElement>) => {
    if (disabled) return;
    event.preventDefault();
    const slot =
      event.target instanceof HTMLElement
        ? event.target.closest<HTMLElement>("[data-otp-index]")
        : null;
    let requested = slot ? Number.parseInt(slot.dataset.otpIndex ?? "0", 10) : 0;
    if (!slot) {
      let distance = Infinity;
      slotElements.current
        ?.querySelectorAll<HTMLElement>(".otp-input-slot")
        .forEach((element, i) => {
          const bounds = element.getBoundingClientRect(),
            delta = Math.abs(event.clientX - (bounds.left + bounds.width / 2));
          if (delta < distance) {
            distance = delta;
            requested = i;
          }
        });
    }
    setActive(Math.max(0, Math.min(length - 1, requested)));
    input.current?.focus();
  };
  return (
    <div className="otp-input" data-status={status} data-size="default">
      <fieldset
        className="otp-input-fieldset"
        aria-label={t("account.otp.entry")}
        aria-disabled={disabled || undefined}
        onPointerDown={pointerDown}
      >
        <input
          ref={input}
          id={id}
          className="ui-input otp-input-native"
          type="text"
          inputMode="text"
          autoComplete="one-time-code"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          readOnly={Boolean(props.disabled || status === "success")}
          aria-label={t("account.otp.label")}
          aria-invalid={status === "error" || undefined}
          aria-describedby={message ? messageId : undefined}
          defaultValue={slots.join("")}
          onBlur={() => setFocused(false)}
          onFocus={() => setFocused(true)}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={(event) => {
            composing.current = false;
            const pending = completeAfterComposition.current;
            completeAfterComposition.current = false;
            if (!disabled) {
              const value = sanitize(event.currentTarget.value);
              flushSync(() => {
                if (value !== currentSlots.current.join("")) applyFieldValue(value);
                else if (pending && value.length === length) props.onComplete(value);
              });
            }
            syncNative();
          }}
          onInput={handleInput}
          onKeyDown={keyDown}
          onPaste={(event) => {
            event.preventDefault();
            if (disabled) return;
            const value = sanitize(event.clipboardData.getData("text"));
            insert(value, value.length === length ? 0 : active);
          }}
        />
        <div
          ref={slotElements}
          className="otp-input-slots"
          style={
            {
              "--otp-active-index": String(active),
              "--otp-length": String(length),
              "--otp-group-offset": active >= groupAt ? "var(--otp-group-gap)" : "0px",
            } as CSSProperties
          }
        >
          <span
            className="otp-input-focus-ring"
            data-visible={focused && status !== "success" ? "true" : undefined}
          />
          {slots.map((char, index) => (
            <span
              key={`otp-${["a", "b", "c", "d", "e", "f", "g", "h"][index]}`}
              className="otp-input-slot"
              data-active={focused && index === active ? "true" : undefined}
              data-filled={char ? "true" : undefined}
              data-otp-index={index}
              data-group-start={index === groupAt ? "true" : undefined}
            >
              {focused && index === active && status !== "success" && (
                <span
                  className="otp-input-caret"
                  data-trailing={char ? "true" : undefined}
                  aria-hidden="true"
                />
              )}
              {char && <span className="otp-input-character">{char}</span>}
            </span>
          ))}
        </div>
      </fieldset>
      {message && (
        <p
          id={messageId}
          className="otp-input-message"
          role={status === "error" ? "alert" : "status"}
          aria-live={status === "error" ? "assertive" : "polite"}
        >
          {status === "success" && (
            <svg className="otp-input-success" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 13l4 4L19 7" />
            </svg>
          )}
          {message}
        </p>
      )}
    </div>
  );
}
