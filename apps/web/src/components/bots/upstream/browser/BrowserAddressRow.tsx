/* oxlint-disable shadcn/no-unknown-classes, t3code/no-native-title-tooltip -- Pinned BrowserAddressRow source classes and profile/diagnostic titles. */
import { useId, useRef, useState, useImperativeHandle, type Ref } from "react";
import {
  ArrowLeft,
  ArrowRight,
  RotateCw,
  X,
  Globe2,
  Clock3,
  Search,
  CircleDot,
  TriangleAlert,
  UserRound,
} from "lucide-react";
import {
  browserAddressUrl,
  browserCompletion,
  browserDisplayUrl,
  browserSuggestions,
  type BrowserSuggestion,
} from "./browser-suggestions";
import { browserTabStoppable, type BrowserViewProps } from "./types";
import { t } from "./text";
import { BrowserPageMenu } from "./BrowserMenus";
export function BrowserAddressRow({
  view,
  narrow,
  onNewTab,
  addressRef,
}: {
  view: BrowserViewProps;
  narrow: boolean;
  onNewTab: () => void;
  addressRef: Ref<HTMLInputElement>;
}) {
  const id = useId();
  const [address, setAddress] = useState<{
    open: boolean;
    typed: string;
    text: string | undefined;
    active: number;
    completed: boolean;
  }>({ open: false, typed: "", text: undefined, active: -1, completed: false });
  const selectOnPointerUp = useRef(false);
  const input = useRef<HTMLInputElement | null>(null);
  useImperativeHandle(addressRef, () => input.current!, []);
  const closed = () =>
    setAddress({ open: false, typed: "", text: undefined, active: -1, completed: false });
  const tab = view.activeTab,
    profile = tab ? view.profileForTab?.(tab) : undefined;
  const rows = address.open
    ? browserSuggestions({
        typed: address.typed,
        completion: address.completed ? browserCompletion(address.typed, view.history) : undefined,
        tabs: view.tabs,
        activeTabId: tab?.id,
        history: view.history,
      })
    : [];
  const listOpen = address.open && rows.length > 0;
  const finish = () => {
    closed();
    input.current?.blur();
  };
  const choose = (row: BrowserSuggestion) => {
    if (row.tabId) view.onActivateTab(row.tabId);
    else view.onOpenAddress(row.url, tab?.id);
    finish();
  };
  return (
    <div className="browser-full-address-row">
      <button
        className="ui-button ui-button-variant-ghost ui-button-size-icon-sm"
        aria-label={t("browser.goBack")}
        disabled={!view.canControl || !tab || tab.canGoBack === false}
        onClick={() => tab && view.onNavigate(tab.id, "back")}
      >
        <ArrowLeft />
      </button>
      {!narrow && (
        <>
          <button
            className="ui-button ui-button-variant-ghost ui-button-size-icon-sm"
            aria-label={t("browser.goForward")}
            disabled={!view.canControl || !tab || tab.canGoForward === false}
            onClick={() => tab && view.onNavigate(tab.id, "forward")}
          >
            <ArrowRight />
          </button>
          <button
            className="ui-button ui-button-variant-ghost ui-button-size-icon-sm"
            aria-label={t(browserTabStoppable(tab) ? "browser.stopLoading" : "browser.reload")}
            disabled={!view.canControl || !tab?.url}
            onClick={() =>
              tab && (browserTabStoppable(tab) ? view.onStop(tab.id) : view.onReload(tab.id))
            }
          >
            {browserTabStoppable(tab) ? <X /> : <RotateCw />}
          </button>
        </>
      )}
      <form className="browser-full-capsule" onSubmit={(e) => e.preventDefault()}>
        <input
          ref={input}
          className="browser-full-capsule-input"
          type="text"
          role="combobox"
          autoComplete="off"
          spellCheck={false}
          maxLength={2048}
          aria-label={t("browser.address.label")}
          aria-autocomplete="both"
          aria-expanded={listOpen}
          aria-controls={listOpen ? id : undefined}
          aria-activedescendant={
            listOpen && address.active >= 0 ? `${id}-${address.active}` : undefined
          }
          placeholder={t("browser.address.placeholder")}
          value={address.text ?? tab?.url ?? ""}
          disabled={!view.canControl}
          onChange={(event) => {
            const typed = event.currentTarget.value;
            const native = event.nativeEvent;
            const complete =
              native instanceof InputEvent &&
              !native.isComposing &&
              native.inputType.startsWith("insert");
            const completion = complete ? browserCompletion(typed, view.history) : undefined;
            const text = completion
              ? typed + browserDisplayUrl(completion.url).slice(typed.length)
              : typed;
            setAddress({
              open: true,
              typed,
              text,
              active: typed.trim() ? 0 : -1,
              completed: !!completion,
            });
            if (text !== typed)
              requestAnimationFrame(() =>
                input.current?.setSelectionRange(typed.length, text.length),
              );
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.keyCode === 229) return;
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              if (!address.open) {
                setAddress((a) => ({ ...a, open: true }));
                return;
              }
              if (!rows.length) return;
              const step = event.key === "ArrowDown" ? 1 : -1;
              const next =
                address.active < 0
                  ? step > 0
                    ? 0
                    : rows.length - 1
                  : (address.active + step + rows.length) % rows.length;
              const row = rows[next];
              if (row) setAddress((a) => ({ ...a, active: next, text: row.text }));
            } else if (event.key === "Enter") {
              event.preventDefault();
              const row = rows[address.active];
              const value = event.currentTarget.value.trim();
              if (row) choose(row);
              else if (value) {
                view.onOpenAddress(browserAddressUrl(value), tab?.id);
                finish();
              }
            } else if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              if (address.open || address.text !== undefined) {
                closed();
                requestAnimationFrame(() => input.current?.select());
              } else event.currentTarget.blur();
            }
          }}
          onFocus={(event) => {
            setAddress({ open: true, typed: "", text: undefined, active: -1, completed: false });
            event.currentTarget.select();
          }}
          onPointerDown={(event) => {
            selectOnPointerUp.current = document.activeElement !== event.currentTarget;
          }}
          onMouseUp={(event) => {
            if (selectOnPointerUp.current) event.preventDefault();
            selectOnPointerUp.current = false;
          }}
          onBlur={closed}
        />
        {listOpen && (
          <div
            id={id}
            role="listbox"
            aria-label={t("browser.address.suggestions")}
            className="ui-popover-menu-surface browser-full-suggest"
          >
            {rows.map((row, index) => (
              <div
                key={row.id}
                id={`${id}-${index}`}
                role="option"
                aria-selected={address.active === index}
                data-highlighted={address.active === index ? "" : undefined}
                className="browser-full-suggest-row"
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => choose(row)}
              >
                <span className="browser-full-suggest-icon">
                  {row.kind === "history" ? (
                    <Clock3 />
                  ) : row.kind === "search" ? (
                    <Search />
                  ) : row.kind === "tab" ? (
                    (view.ownerForTab?.(view.tabs.find((tab) => tab.id === row.tabId)!) ?? (
                      <Globe2 />
                    ))
                  ) : (
                    <Globe2 />
                  )}
                </span>
                <span className="browser-full-suggest-title">{row.title}</span>
                <span className="browser-full-suggest-detail">
                  {row.detail ?? (row.kind === "url" ? "" : t("browser.address.search"))}
                </span>
                {row.kind === "tab" && (
                  <span className="browser-full-suggest-switch">
                    {t("browser.address.switchToTab")}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </form>
      {profile && (
        <span
          className="browser-profile-status"
          title={t(
            profile.name === null ? "browser.profiles.agentTabLabel" : "browser.profiles.tabLabel",
            { name: profile.name ?? "" },
          )}
        >
          {profile.hue !== null ? (
            <span
              className="browser-profile-dot"
              style={{ background: `oklch(0.66 0.14 ${profile.hue})` }}
            />
          ) : (
            <UserRound />
          )}
          <span className="browser-profile-status-name">
            {profile.name ?? t("browser.profiles.agentTabLabel")}
          </span>
        </span>
      )}
      {tab?.recording && (
        <span
          className="browser-recording-status"
          role="status"
          aria-label={t("browser.recording.label")}
        >
          <CircleDot />
          {t("browser.recording.badge")}
        </span>
      )}
      {!!tab?.diagnosticErrorCount && (
        <span
          className="browser-diagnostic-status"
          role="status"
          title={t("browser.diagnosticErrors", { count: tab.diagnosticErrorCount })}
        >
          <TriangleAlert />
          {tab.diagnosticErrorCount}
        </span>
      )}
      <BrowserPageMenu view={view} narrow={narrow} onNewTab={onNewTab} />
    </div>
  );
}
