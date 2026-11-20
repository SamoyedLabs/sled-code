import { settingRequest, settingResult } from "@t3tools/client-runtime/openbot/settings";
import { userSkills } from "./marketplace-library";
import { decodeSkill, type InstalledSkill } from "./marketplace-model";
import { SkillMark } from "./MarketplaceParts";
import { observeResize } from "../../../../lib/observeResize";
/* oxlint-disable shadcn/no-unknown-classes -- Pinned OpenBot selectors are supplied by source CSS. */
import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Blocks, BookOpen, Bot, ChevronRight, Plus, Search, ShieldCheck } from "lucide-react";
import { OpenbotSlidingTabs } from "../OpenbotSlidingTabs";
import { SourceButton } from "../settings/SettingsParts";
import { MarketplaceDetail } from "./MarketplaceDetail";
import { Done, FeaturedCard, ListingRow } from "./MarketplaceParts";
import {
  CATEGORY_LABELS,
  type Category,
  type Listing,
  type MarketplaceProps,
  type MarketplaceTab,
  type Source,
} from "./marketplace-model";
import { useMarketplace } from "./useMarketplace";
import "./marketplace.css";
import "./marketplace-adapter.css";
const TABS = [
  { id: "apps", title: "Apps", icon: Blocks },
  { id: "agents", title: "Agents", icon: Bot },
  { id: "skills", title: "Skills", icon: BookOpen },
] as const;
const DESCRIPTION = {
  apps: "Connect the tools and services that your agents work with.",
  agents: "Ready-made agents with their own instructions and skills.",
  skills: "Instructions that teach an agent a task or a tool.",
};
const SOURCES = [
  { value: "all", label: "All" },
  {
    value: "verified",
    label: (
      <>
        <ShieldCheck aria-hidden="true" />
        Verified
      </>
    ),
  },
  { value: "public", label: "Public" },
] as const;
type View =
  | { kind: "browse" }
  | { kind: "group"; category: Category | "yours" }
  | { kind: "listing"; listing: Listing }
  | { kind: "app"; id: string };
function move(motion: "forward" | "back" | "tab" | "swap", update: () => void) {
  if (
    !document.startViewTransition ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    update();
    return;
  }
  document.startViewTransition({
    types: [`marketplace-${motion}`],
    update: () => flushSync(update),
  });
}
export function Marketplace(model: MarketplaceProps) {
  const publicCatalog = model.capabilities.includes("sled-public-catalog-v1");
  const [tab, setTab] = useState<MarketplaceTab>("apps");
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<Source>("all");
  const [sort, setSort] = useState<"installs" | "updated" | "name">("installs");
  const [stack, setStack] = useState<readonly View[]>([{ kind: "browse" }]);
  const top = stack.at(-1)!;
  const category = top.kind === "group" && top.category !== "yours" ? top.category : undefined;
  const c = useMarketplace(
    model,
    tab,
    query,
    publicCatalog ? "all" : source,
    category,
    publicCatalog ? "name" : sort,
  );
  const body = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLElement>(null);
  const places = useRef<{ top: number; opener: HTMLElement | null }[]>([]);
  const focusBack = useRef<HTMLElement | null>(null);
  const title = (view: View) =>
    view.kind === "listing"
      ? view.listing.value.name
      : view.kind === "group"
        ? view.category === "yours"
          ? `Your ${tab}`
          : CATEGORY_LABELS[view.category]
        : view.kind === "app"
          ? (model.apps?.find((app) => app.id === view.id)?.name ?? "Apps")
          : TABS.find((item) => item.id === tab)!.title;
  const go = (view: View) => {
    places.current[stack.length - 1] = {
      top: body.current?.scrollTop ?? 0,
      opener: document.activeElement instanceof HTMLElement ? document.activeElement : null,
    };
    move("forward", () => setStack((current) => [...current, view]));
  };
  const backTo = (index: number) => {
    focusBack.current = places.current[index]?.opener ?? null;
    move("back", () => setStack((current) => current.slice(0, index + 1)));
  };
  const show = (next: MarketplaceTab) =>
    move("tab", () => {
      places.current = [];
      setTab(next);
      setSource("all");
      setStack([{ kind: "browse" }]);
    });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Source page navigation restores the scroll position and DOM focus of the originating listing.
  useLayoutEffect(() => {
    const element = body.current;
    if (!element) return;
    element.scrollTop = places.current[stack.length - 1]?.top ?? 0;
    const target =
      focusBack.current ?? (stack.length > 1 ? element.querySelector<HTMLElement>("h3") : null);
    target?.focus({ preventScroll: true });
    focusBack.current = null;
    const measure = () => {
      element.classList.toggle("scroll-fade-top", element.scrollTop > 2);
      element.classList.toggle(
        "scroll-fade-bottom",
        element.scrollTop + element.clientHeight < element.scrollHeight - 2,
      );
    };
    const stop = observeResize([element, ...(frame.current ? [frame.current] : [])], measure);
    element.addEventListener("scroll", measure);
    measure();
    return () => {
      stop();
      element.removeEventListener("scroll", measure);
    };
  }, [stack, places, focusBack, body, frame]);
  const escape = useEffectEvent((event: KeyboardEvent) => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]'))
      return;
    if (
      target &&
      !root.current?.contains(target) &&
      target.closest("input,textarea,select,[contenteditable]")
    )
      return;
    event.preventDefault();
    if (stack.length > 1) backTo(stack.length - 2);
    else if (query) setQuery("");
    else model.onClose?.();
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- The source page owns Escape and restores focus to its opener on unmount.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    root.current
      ?.querySelector<HTMLElement>(".marketplace-nav-title")
      ?.focus({ preventScroll: true });
    const listener = (event: KeyboardEvent) => escape(event);
    document.addEventListener("keydown", listener);
    return () => {
      document.removeEventListener("keydown", listener);
      queueMicrotask(() => {
        if (document.activeElement === document.body && opener?.isConnected)
          opener.focus({ preventScroll: true });
      });
    };
  }, [root]);
  const library = userSkills(c.installed).filter((skill) =>
    `${skill.name} ${skill.description ?? ""}`.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const openInstalled = async (skill: InstalledSkill) => {
    setLibraryError(null);
    const operation =
      skill.origin === "local" ? "settings.local-catalog.localGet" : "settings.local-catalog.skill";
    const request = settingRequest(operation, { skillId: skill.skillId });
    if (!request || !model.actions.can(request)) {
      setLibraryError("You need permission to read this skill on the host.");
      return;
    }
    try {
      const value = decodeSkill(settingResult(operation, await model.actions.execute(request)));
      go({
        kind: "listing",
        listing: { kind: "skill", value, ...(skill.origin === "local" ? { local: true } : {}) },
      });
    } catch (cause) {
      setLibraryError(cause instanceof Error ? cause.message : "The skill could not be read.");
    }
  };
  const all: Listing[] =
    tab === "agents"
      ? c.agents.map((value) => ({ kind: "agent", value }))
      : c.skills.map((value) => ({ kind: "skill", value }));
  const filtered = all.filter(
    (item) => source === "all" || (item.value.verified === true) === (source === "verified"),
  );
  const owned = (item: Listing) =>
    item.kind === "agent"
      ? model.agents.some((agent) => agent.listingId === item.value.id)
      : Object.values(c.installed).some((skills) =>
          skills.some((skill) => skill.skillId === item.value.id),
        );
  const own = filtered.filter(owned);
  const available = filtered.filter((item) => !owned(item));
  const action = (item: Listing) =>
    owned(item) ? (
      <Done>Added</Done>
    ) : (
      <SourceButton
        variant="secondary"
        aria-label={`Add ${item.value.name}`}
        onClick={() => go({ kind: "listing", listing: item })}
      >
        <Plus aria-hidden="true" />
        Add
      </SourceButton>
    );
  const rows = (items: readonly Listing[]) => (
    <ul className="marketplace-app-list">
      {items.map((item) => (
        <ListingRow
          key={item.value.id}
          listing={item}
          onOpen={() => go({ kind: "listing", listing: item })}
          action={action(item)}
        />
      ))}
    </ul>
  );
  const group = (name: string, key: Category | "yours", items: readonly Listing[]) => (
    <section key={key} className="marketplace-app-group">
      <div className="marketplace-skill-group-head">
        <h4 className="marketplace-app-group-title">
          {name}
          {key === "yours" && <span className="marketplace-app-group-count">{items.length}</span>}
        </h4>
        {top.kind !== "group" && (items.length > 6 || c.cursor !== null) && (
          <SourceButton
            variant="ghost"
            aria-label={`See all ${name}`}
            onClick={() => go({ kind: "group", category: key })}
          >
            See all
            <ChevronRight aria-hidden="true" />
          </SourceButton>
        )}
      </div>
      {rows(top.kind === "group" ? items : items.slice(0, 6))}
    </section>
  );
  const apps = (model.apps ?? []).filter((app) =>
    `${app.name} ${app.tagline}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  return (
    <section
      ref={root}
      className="skills-marketplace skills-marketplace-page"
      aria-label="Marketplace"
    >
      <header className="skills-marketplace-topbar">
        <nav
          className="marketplace-heading"
          aria-label="Marketplace path"
          hidden={stack.length < 2}
        >
          {stack.slice(0, -1).map((view, index) => (
            <span key={`${view.kind}:${title(view)}`}>
              <SourceButton
                variant="ghost"
                size="xs"
                className="marketplace-crumb-parent"
                onClick={() => backTo(index)}
              >
                {title(view)}
              </SourceButton>
              <ChevronRight className="marketplace-crumb-separator" aria-hidden="true" />
            </span>
          ))}
          {stack.length > 1 && (
            <h2 className="marketplace-title" tabIndex={-1}>
              {title(top)}
            </h2>
          )}
        </nav>
      </header>
      <aside className="marketplace-nav" aria-labelledby="marketplace-nav-title">
        <h2 id="marketplace-nav-title" className="marketplace-nav-title" tabIndex={-1}>
          Marketplace
        </h2>
        <nav aria-label="Marketplace kinds">
          <ul className="settings-modal-nav marketplace-nav-list">
            {TABS.map((item) => (
              <li key={item.id}>
                <SourceButton
                  variant="ghost"
                  className="settings-modal-nav-item marketplace-nav-item"
                  aria-current={tab === item.id ? "page" : undefined}
                  onClick={() => show(item.id)}
                >
                  <item.icon aria-hidden="true" />
                  <span>{item.title}</span>
                </SourceButton>
              </li>
            ))}
          </ul>
        </nav>
        {model.apps?.some((app) => app.status === "connected" || app.status === "attention") && (
          <section className="marketplace-nav-group">
            <h3 className="marketplace-nav-heading">Your apps</h3>
            <ul className="settings-modal-nav marketplace-nav-list">
              {model.apps
                .filter((app) => app.status === "connected" || app.status === "attention")
                .map((app) => (
                  <li key={app.id}>
                    <SourceButton
                      variant="ghost"
                      className="settings-modal-nav-item marketplace-nav-item"
                      onClick={() => {
                        setTab("apps");
                        go({ kind: "app", id: app.id });
                      }}
                    >
                      {app.iconUrl ? (
                        <img src={app.iconUrl} alt="" />
                      ) : (
                        <Blocks aria-hidden="true" />
                      )}
                      <span>{app.name}</span>
                    </SourceButton>
                  </li>
                ))}
            </ul>
          </section>
        )}
      </aside>
      <div ref={body} className="skills-marketplace-body">
        <div ref={frame} className="marketplace-frame">
          {top.kind === "listing" ? (
            <MarketplaceDetail
              key={`${top.listing.kind}:${top.listing.value.id}`}
              listing={top.listing}
              model={model}
              installed={c.installed}
              refreshSkills={c.refreshSkills}
            />
          ) : top.kind === "app" ? (
            model.apps?.find((app) => app.id === top.id)?.detail
          ) : (
            <div className="marketplace-view marketplace-browse">
              <header className="marketplace-browse-head">
                {tab === "skills" && model.onDraftRequest && (
                  <SourceButton
                    disabled={model.agents.length === 0}
                    onClick={() =>
                      model.onDraftRequest?.({
                        title: "Create a local skill",
                        text: "Help me create a new local skill. Use the skill-creation guide. Ask me what workflow it should support before you create it.",
                      })
                    }
                  >
                    Create skill
                  </SourceButton>
                )}

                <div className="marketplace-skill-head-row">
                  <div className="marketplace-browse-copy">
                    <h3
                      className="ui-heading marketplace-browse-title"
                      data-size="lg"
                      tabIndex={-1}
                    >
                      {title(top)}
                    </h3>
                    <p className="ui-text" data-variant="body" data-tone="muted">
                      {DESCRIPTION[tab]}
                      {publicCatalog &&
                        tab !== "apps" &&
                        " From the bundled public catalog. No OpenBot account required."}
                    </p>
                  </div>
                  {tab !== "apps" && publicCatalog && model.onSignIn && (
                    <SourceButton variant="secondary" onClick={model.onSignIn}>
                      OpenBot community marketplace
                    </SourceButton>
                  )}
                  {tab !== "apps" && !publicCatalog && (
                    <OpenbotSlidingTabs
                      value={source}
                      onChange={(value) => move("swap", () => setSource(value))}
                      label="Source"
                      items={SOURCES}
                    />
                  )}
                </div>
                <div className="marketplace-toolbar">
                  <label className="search-field marketplace-search">
                    <Search aria-hidden="true" />
                    <input
                      className="ui-input"
                      data-size="md"
                      type="search"
                      value={query}
                      maxLength={256}
                      placeholder="Search Marketplace"
                      aria-label="Search Marketplace"
                      onChange={(event) => setQuery(event.target.value)}
                    />
                  </label>
                  {tab === "skills" && top.kind === "group" && !publicCatalog && (
                    <select
                      className="ui-native-select"
                      data-size="sm"
                      aria-label="Sort skills"
                      value={sort}
                      onChange={(event) => {
                        const value = event.target.value;
                        if (value === "installs" || value === "updated" || value === "name")
                          setSort(value);
                      }}
                    >
                      <option value="installs">Most installed</option>
                      <option value="updated">Recently updated</option>
                      <option value="name">Name</option>
                    </select>
                  )}
                  {tab === "apps" && model.onAddApp && (
                    <SourceButton onClick={model.onAddApp}>
                      <Plus aria-hidden="true" />
                      Add custom
                    </SourceButton>
                  )}
                </div>
              </header>
              <div className="marketplace-stack" aria-busy={c.busy}>
                {tab === "apps" ? (
                  <>
                    {model.appsError && <p role="alert">{model.appsError}</p>}
                    {Object.entries(CATEGORY_LABELS).map(([key, name]) => {
                      const items = apps.filter((app) => app.category === key);
                      return items.length ? (
                        <section key={key} className="marketplace-app-group">
                          <h4 className="marketplace-app-group-title">
                            {name}
                            <span className="marketplace-app-group-count">{items.length}</span>
                          </h4>
                          <ul className="marketplace-app-list">
                            {items.map((app) => (
                              <li key={app.id} className="marketplace-app-row">
                                <SourceButton
                                  variant="ghost"
                                  className="marketplace-app-row-hit"
                                  aria-label={`Open ${app.name}`}
                                  onClick={() => go({ kind: "app", id: app.id })}
                                />
                                <span className="marketplace-app-logo">
                                  {app.icon ??
                                    (app.iconUrl ? (
                                      <img src={app.iconUrl} alt="" loading="lazy" />
                                    ) : (
                                      <Blocks aria-hidden="true" />
                                    ))}
                                </span>
                                <span className="marketplace-app-row-copy">
                                  <span className="marketplace-app-row-name">{app.name}</span>
                                  <span className="marketplace-app-row-tagline">{app.tagline}</span>
                                </span>
                                <span className="marketplace-app-row-status">
                                  {app.status === "connected" ? (
                                    <Done>Connected</Done>
                                  ) : (
                                    <SourceButton
                                      variant="secondary"
                                      onClick={() => go({ kind: "app", id: app.id })}
                                    >
                                      <Plus aria-hidden="true" />
                                      Connect
                                    </SourceButton>
                                  )}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </section>
                      ) : null;
                    })}
                    {apps.length === 0 && (
                      <div className="marketplace-empty">
                        <p className="ui-text" data-variant="body-sm" data-tone="muted">
                          {model.apps === undefined
                            ? "App connections are not available on this host."
                            : query
                              ? "No apps match your search."
                              : "No apps are available."}
                        </p>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    {c.error && (
                      <div role="alert" className="marketplace-empty">
                        <p>{c.error}</p>
                        {c.error.includes("Sign in to OpenBot on this host") && model.onSignIn && (
                          <SourceButton onClick={model.onSignIn}>Sign in to OpenBot</SourceButton>
                        )}
                        <SourceButton onClick={c.reload}>Retry</SourceButton>
                      </div>
                    )}
                    {c.skillError && (
                      <div role="alert">
                        <p>{c.skillError}</p>
                        <SourceButton onClick={() => void c.refreshSkills()}>Retry</SourceButton>
                      </div>
                    )}
                    {c.busy && filtered.length === 0 && <p role="status">Loading {tab}…</p>}
                    {!c.busy && !c.error && (
                      <>
                        {tab === "agents" && own.length > 0 && group("Your agents", "yours", own)}
                        {tab === "skills" &&
                          source === "all" &&
                          (top.kind !== "group" || top.category === "yours") && (
                            <section className="marketplace-app-group">
                              <div className="marketplace-skill-group-head">
                                <h4 className="marketplace-app-group-title">
                                  Your skills
                                  <span className="marketplace-app-group-count">
                                    {library.length}
                                  </span>
                                </h4>
                                {library.length > 6 && top.kind !== "group" && (
                                  <SourceButton
                                    variant="ghost"
                                    onClick={() => go({ kind: "group", category: "yours" })}
                                  >
                                    See all
                                    <ChevronRight aria-hidden="true" />
                                  </SourceButton>
                                )}
                              </div>
                              {library.length ? (
                                <ul className="marketplace-app-list marketplace-skill-list">
                                  {(top.kind === "group" ? library : library.slice(0, 6)).map(
                                    (skill) => (
                                      <li
                                        key={skill.skillId}
                                        className="marketplace-app-row marketplace-skill-row"
                                      >
                                        <SourceButton
                                          variant="ghost"
                                          className="marketplace-app-row-hit"
                                          aria-label={`Open ${skill.name}`}
                                          onClick={() => void openInstalled(skill)}
                                        />
                                        <SkillMark />
                                        <span className="marketplace-app-row-copy">
                                          <span className="marketplace-app-row-name">
                                            {skill.name}
                                          </span>
                                          <span className="marketplace-app-row-tagline">
                                            {skill.state === "modified"
                                              ? "Changed by you"
                                              : skill.state === "needs-repair"
                                                ? "Needs repair"
                                                : skill.state === "update-available"
                                                  ? "Update available"
                                                  : skill.origin === "local"
                                                    ? "Made on this computer"
                                                    : (skill.description ??
                                                      `Version ${skill.installedVersion}`)}
                                          </span>
                                        </span>
                                        <span className="marketplace-app-row-status">
                                          <SourceButton
                                            variant="outline"
                                            onClick={() => void openInstalled(skill)}
                                          >
                                            Agents
                                          </SourceButton>
                                        </span>
                                      </li>
                                    ),
                                  )}
                                </ul>
                              ) : (
                                !c.skillError &&
                                model.agents.every(
                                  (agent) => c.installed[agent.id] !== undefined,
                                ) && (
                                  <div className="marketplace-skill-empty">
                                    <SkillMark />
                                    <div>
                                      <p className="ui-text" data-variant="body">
                                        No agent has a skill yet.
                                      </p>
                                      <p
                                        className="ui-text"
                                        data-variant="body-sm"
                                        data-tone="muted"
                                      >
                                        A skill teaches an agent one task. Add one below, or create
                                        your own.
                                      </p>
                                    </div>
                                  </div>
                                )
                              )}
                            </section>
                          )}
                        {libraryError && <p role="alert">{libraryError}</p>}
                        {(tab === "agents" || top.kind === "group") &&
                          !query &&
                          available.length > 0 && (
                            <section className="marketplace-skill-featured marketplace-app-group">
                              <h4 className="marketplace-app-group-title">Featured</h4>
                              <div className="marketplace-skill-featured-grid">
                                {[...available]
                                  .sort(
                                    (a, b) =>
                                      Number(b.value.featured) - Number(a.value.featured) ||
                                      b.value.installs - a.value.installs,
                                  )
                                  .slice(0, 3)
                                  .map((item) => (
                                    <FeaturedCard
                                      showInstalls={!publicCatalog}
                                      key={item.value.id}
                                      listing={item}
                                      onOpen={() => go({ kind: "listing", listing: item })}
                                      action={action(item)}
                                    />
                                  ))}
                              </div>
                            </section>
                          )}
                        {!(top.kind === "group" && top.category === "yours") &&
                          Object.entries(CATEGORY_LABELS).map(([key, name]) => {
                            const items = available.filter(
                              (item) => (item.value.category ?? "other") === key,
                            );
                            return items.length ? group(name, key as Category, items) : null;
                          })}
                        {filtered.length === 0 &&
                          !(
                            tab === "skills" &&
                            source === "all" &&
                            library.length > 0 &&
                            !query
                          ) && (
                            <div className="marketplace-empty">
                              <p className="ui-text" data-variant="body-sm" data-tone="muted">
                                {query
                                  ? `No ${tab} match your search.`
                                  : source !== "all"
                                    ? "No items match these filters."
                                    : `No ${tab} are available.`}
                              </p>
                              {source !== "all" && (
                                <SourceButton onClick={() => setSource("all")}>
                                  Clear filters
                                </SourceButton>
                              )}
                            </div>
                          )}
                      </>
                    )}
                    {c.cursor && (
                      <div className="marketplace-load-more">
                        <SourceButton disabled={c.busy} onClick={c.more}>
                          {c.busy ? "Loading…" : "Load more"}
                        </SourceButton>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
      {model.appsOverlay}
    </section>
  );
}
