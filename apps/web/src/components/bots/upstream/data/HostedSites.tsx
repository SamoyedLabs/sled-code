/* oxlint-disable shadcn/no-unknown-classes, t3code/no-native-title-tooltip -- Exact source SettingsHostedSitesTab markup and hostname title. */
import { ExternalLink, Trash2 } from "lucide-react";
import type { OpenbotHostedSites } from "@t3tools/contracts";
import { hostedSiteLink } from "@t3tools/client-runtime/openbot/presentation";
import { SettingsSection, SourceButton } from "../settings/SettingsParts";
import { SourceConfirmDialog } from "./SourceConfirmDialog";
import { t } from "./source-text";
import "./HostedSites.css";
export function HostedSites(props: {
  sites: OpenbotHostedSites | null;
  available: boolean;
  busy: boolean;
  error: string | null;
  pendingId: string | null;
  canDelete: (id: string) => boolean;
  onDelete: (id: string | null) => void;
  onConfirmDelete: () => void;
  onSeePlans?: () => void;
}) {
  const pending = props.sites?.sites.find((site) => site.id === props.pendingId);
  return (
    <SettingsSection title={t("settings.hostedSites.title")}>
      {!props.available ? (
        <p className="ui-text" data-tone="muted">
          {t("settings.hostedSites.unavailable")}
        </p>
      ) : (
        <>
          <div className="hosted-sites-overview">
            {Boolean(props.sites?.limit) && (
              <div className="hosted-sites-usage">
                <span className="settings-modal-row-title">
                  {t("settings.hostedSites.usage", {
                    used: props.sites!.used,
                    count: props.sites!.limit,
                  })}
                </span>
                {props.onSeePlans && props.sites!.used >= props.sites!.limit && (
                  <SourceButton onClick={props.onSeePlans}>See plans</SourceButton>
                )}
              </div>
            )}
            <p className="ui-text" data-tone="muted" data-variant="caption">
              {t("settings.hostedSites.expiryNote")}
            </p>
          </div>
          {props.error && (
            <p className="settings-modal-error" role="alert">
              {props.error}
            </p>
          )}
          {props.sites && props.sites.sites.length === 0 && (
            <p className="ui-text" data-tone="muted">
              {t("settings.hostedSites.empty")}
            </p>
          )}
          {Boolean(props.sites?.sites.length) && (
            <div
              className="ui-item-group settings-modal-card hosted-sites-list"
              data-surface="subtle"
            >
              {props.sites!.sites.map((site) => {
                const url = hostedSiteLink(site);
                return (
                  <div className="ui-item hosted-sites-row" key={site.id}>
                    <div className="ui-item-content">
                      <div className="ui-item-title">{site.title}</div>
                      <button
                        type="button"
                        className="ui-button ui-button-variant-link hosted-sites-link"
                        title={site.hostname}
                        disabled={!url}
                        onClick={() => {
                          if (url) window.open(url, "_blank", "noopener,noreferrer");
                        }}
                      >
                        <span className="hosted-sites-link-label">{site.hostname}</span>
                      </button>
                      {site.status === "blocked" ? (
                        <span
                          className="z-badge z-badge-variant-secondary"
                          data-variant="secondary"
                        >
                          {t("settings.hostedSites.blocked")}
                        </span>
                      ) : (
                        <p className="ui-text" data-tone="muted" data-variant="caption">
                          {site.expiresAt
                            ? t("settings.hostedSites.expires", {
                                date: new Intl.DateTimeFormat(undefined, {
                                  dateStyle: "medium",
                                }).format(new Date(site.expiresAt)),
                              })
                            : t("settings.hostedSites.expiryUnavailable")}
                        </p>
                      )}
                      {site.serverId === null && (
                        <span
                          className="z-badge z-badge-variant-secondary"
                          data-variant="secondary"
                        >
                          {t("settings.hostedSites.unlinked")}
                        </span>
                      )}
                    </div>
                    <div className="ui-item-actions hosted-sites-actions">
                      <SourceButton
                        aria-label={t("settings.hostedSites.openLabel", {
                          hostname: site.hostname,
                        })}
                        disabled={!url}
                        onClick={() => {
                          if (url) window.open(url, "_blank", "noopener,noreferrer");
                        }}
                      >
                        <ExternalLink size={14} aria-hidden="true" />
                        {t("common.open")}
                      </SourceButton>
                      {props.canDelete(site.id) && (
                        <SourceButton
                          variant="destructive-ghost"
                          aria-label={t("settings.hostedSites.deleteLabel", {
                            hostname: site.hostname,
                          })}
                          disabled={props.busy}
                          onClick={() => props.onDelete(site.id)}
                        >
                          <Trash2 size={14} aria-hidden="true" />
                          {t("common.delete")}
                        </SourceButton>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <SourceConfirmDialog
            open={Boolean(pending)}
            title={t("settings.hostedSites.deleteTitle", { hostname: pending?.hostname ?? "" })}
            description={t("settings.hostedSites.deleteDescription")}
            confirmLabel={t("common.delete")}
            pendingLabel={t("settings.hostedSites.deleting")}
            pending={props.busy}
            error={props.error}
            onCancel={() => props.onDelete(null)}
            onConfirm={props.onConfirmDelete}
          />
        </>
      )}
    </SettingsSection>
  );
}
