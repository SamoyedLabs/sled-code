/* oxlint-disable shadcn/no-unknown-classes -- Reuses the source usage selectors in PreviewAccountUsage.css. */
import { AccountUsageRings } from "./upstream/provider/OpenbotAccountUsageRail";
import { AccountUsageDetails } from "./upstream/provider/AccountUsageDetails";
import { accountUsageProviderRows } from "./upstream/provider/account-usage-view";
import "./PreviewAccountUsage.css";

const now = Math.floor(Date.now() / 1000);
const rows = accountUsageProviderRows({
  limits: [
    {
      id: "codex",
      primary: { usedPercent: 24, windowDurationMins: 300, resetsAt: now + 7200 },
      secondary: { usedPercent: 38, windowDurationMins: 10080, resetsAt: now + 345600 },
    },
  ],
}).map((row) => ({ ...row, name: `${row.name} · Sample` }));

export function PreviewAccountUsageRail({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="openbot-react flex items-center gap-2" aria-label="Sample provider limits">
      <AccountUsageRings rows={rows} onOpen={onOpen} />
      <span className="text-2xs text-muted-foreground max-sm:hidden">Sample limits</span>
    </div>
  );
}
export function PreviewAccountUsageDetails() {
  return (
    <section className="openbot-react" aria-label="Sample provider limit details">
      <p className="mb-4 text-xs text-muted-foreground">
        Sample provider limits for this frontend preview.
      </p>
      <div className="account-usage-popover">
        <AccountUsageDetails
          rows={rows}
          loading={false}
          error={null}
          refreshActive={false}
          refreshDisabled
          onRefresh={() => undefined}
          title={<h2 className="account-usage-popover-title">Usage</h2>}
        />
      </div>
    </section>
  );
}
