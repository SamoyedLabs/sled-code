/* oxlint-disable shadcn/no-unknown-classes -- Pinned OpenBot selectors are supplied by source CSS. */
import { Sparkles, ShieldCheck, Check } from "lucide-react";
import { useState, type ReactNode } from "react";
import { BotAvatar } from "../../avatar/BotAvatar";
import { SourceButton, SettingsCard, SettingsSection } from "../settings/SettingsParts";
import type { Listing, MarketplaceAgent } from "./marketplace-model";
import { SkillGradient } from "./SkillGradient";
export function VerifiedMark({ on }: { on?: boolean | undefined }) {
  return on ? (
    <>
      <ShieldCheck className="marketplace-skill-verified" aria-hidden="true" />
      <span className="marketplace-visually-hidden">Verified</span>
    </>
  ) : null;
}
export function SkillMark({
  url,
  size = "md",
}: {
  url?: string | null | undefined;
  size?: "md" | "lg";
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const source = url && url !== failed ? url : null;
  return (
    <span
      className="marketplace-skill-mark"
      data-size={size === "lg" ? "md" : "row"}
      data-kind={source ? "icon" : "none"}
    >
      {source ? (
        <img src={source} alt="" loading="lazy" onError={() => setFailed(source)} />
      ) : (
        <Sparkles aria-hidden="true" />
      )}
    </span>
  );
}
export function Avatar({
  agent,
  size = "md",
}: {
  agent: Pick<MarketplaceAgent, "id" | "avatarSeed" | "avatarHue" | "avatarUrl">;
  size?: "md" | "lg";
}) {
  return (
    <span className="marketplace-avatar" data-size={size}>
      {agent.avatarUrl ? (
        <img src={agent.avatarUrl} alt="" loading="lazy" />
      ) : (
        <span className="agent-avatar">
          <BotAvatar
            seed={agent.avatarSeed ?? agent.id}
            hue={agent.avatarHue ?? null}
            size={size === "lg" ? 48 : 32}
          />
        </span>
      )}
    </span>
  );
}
export function Done({ children }: { children: ReactNode }) {
  return (
    <span className="marketplace-done">
      <Check aria-hidden="true" />
      {children}
    </span>
  );
}
export function ListingRow({
  listing,
  onOpen,
  action,
}: {
  listing: Listing;
  onOpen: () => void;
  action?: ReactNode;
}) {
  const item = listing.value;
  return (
    <li className={`marketplace-app-row marketplace-${listing.kind}-row`}>
      <SourceButton
        variant="ghost"
        className="marketplace-app-row-hit"
        aria-label={`Open ${item.name}`}
        onClick={onOpen}
      />
      {listing.kind === "agent" ? (
        <Avatar agent={listing.value} />
      ) : (
        <SkillMark url={listing.value.iconUrl} />
      )}
      <span className="marketplace-app-row-copy">
        <span className="marketplace-skill-name">
          <span className="marketplace-app-row-name">{item.name}</span>
          <VerifiedMark on={item.verified} />
          {listing.kind === "agent" && (
            <span className="marketplace-agent-by">by {item.creatorName}</span>
          )}
        </span>
        <span className="marketplace-app-row-tagline">
          {listing.kind === "agent" ? listing.value.title : item.description}
        </span>
      </span>
      <span className="marketplace-app-row-status">{action}</span>
    </li>
  );
}
export function FeaturedCard({
  listing,
  onOpen,
  action,
  showInstalls = true,
}: {
  listing: Listing;
  onOpen: () => void;
  action?: ReactNode;
  showInstalls?: boolean;
}) {
  const item = listing.value;
  return (
    <article
      className={`marketplace-card marketplace-${listing.kind}-feature`}
      aria-label={item.name}
    >
      <SourceButton
        variant="ghost"
        className="marketplace-hitarea"
        aria-label={`Open ${item.name}`}
        onClick={onOpen}
      />
      {listing.kind === "skill" ? (
        <>
          <div className="marketplace-skill-feature-art">
            <SkillGradient name={item.name} />
            <SkillMark url={listing.value.iconUrl} size="lg" />
          </div>
          <div className="marketplace-card-head">
            <h5 className="ui-heading marketplace-card-name" data-size="sm">
              {item.name}
              <VerifiedMark on={item.verified} />
            </h5>
            <div className="marketplace-card-action">{action}</div>
          </div>
        </>
      ) : (
        <>
          <div className="marketplace-card-head">
            <Avatar agent={listing.value} size="lg" />
            <div className="marketplace-card-action">{action}</div>
          </div>
          <div className="marketplace-agent-feature-copy">
            <h5 className="ui-heading marketplace-card-name" data-size="sm">
              {item.name}
              <VerifiedMark on={item.verified} />
            </h5>
            <span className="ui-text" data-variant="caption" data-tone="muted">
              by {item.creatorName}
            </span>
          </div>
        </>
      )}
      <p className="ui-text marketplace-card-body" data-variant="body-sm">
        {item.description}
      </p>
      <div className="marketplace-card-foot">
        <span className="ui-text" data-variant="caption" data-tone="muted">
          {listing.kind === "agent"
            ? `${listing.value.skillCount} skills${listing.value.routineCount ? ` · ${listing.value.routineCount} routines` : ""}`
            : showInstalls
              ? `${item.creatorName} · ${item.installs.toLocaleString()} installs`
              : item.creatorName}
        </span>
      </div>
    </article>
  );
}
export function Information({
  description,
  facts,
}: {
  description: string;
  facts: readonly { label: string; value: ReactNode }[];
}) {
  return (
    <SettingsSection title="Information">
      <SettingsCard>
        <div className="integration-card-body">
          <p className="ui-text" data-variant="body-sm">
            {description}
          </p>
          <dl className="marketplace-props marketplace-info">
            {facts.map((fact) => (
              <Fact key={fact.label} {...fact} />
            ))}
          </dl>
        </div>
      </SettingsCard>
    </SettingsSection>
  );
}
function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <>
      <dt>
        <span className="ui-text" data-variant="caption" data-tone="muted">
          {label}
        </span>
      </dt>
      <dd>
        <span className="ui-text" data-variant="body-sm">
          {value}
        </span>
      </dd>
    </>
  );
}
export function DetailHeader({
  name,
  logo,
  subtitle,
  actions,
  status,
  statusLabel,
  verified,
}: {
  name: string;
  logo: ReactNode;
  subtitle: string;
  actions?: ReactNode;
  status: "connected" | "attention" | "connecting" | "idle" | "unavailable";
  statusLabel: string;
  verified?: boolean | undefined;
}) {
  return (
    <div className="integration-detail-header">
      <span className="integration-logo-tile" data-size="lg">
        {logo}
      </span>
      <div className="integration-detail-copy">
        <div className="integration-detail-title">
          <h3 tabIndex={-1} className="ui-heading integration-detail-name" data-size="md">
            {name}
            <VerifiedMark on={verified} />
          </h3>
          <span
            className={`z-badge z-badge-variant-${{ connected: "success-light", attention: "warning-light", connecting: "secondary", idle: "secondary", unavailable: "outline" }[status]} integration-status`}
            data-status={status}
          >
            <span className="integration-status-dot" aria-hidden="true" />
            {statusLabel}
          </span>
        </div>
        <span className="ui-text" data-variant="caption" data-tone="muted">
          {subtitle}
        </span>
      </div>
      {actions && <div className="integration-detail-actions">{actions}</div>}
    </div>
  );
}
