/* oxlint-disable shadcn/no-unknown-classes, shadcn/no-raw-colors -- Source VaultPanel inline card marks and local-only site initials. */
import { CreditCard, Globe2, KeyRound, KeySquare, UserRound } from "lucide-react";
import type { Draft, VaultCardBrand, VaultItemSummary } from "./vault-model";
import { cardBrand, digitsOf } from "./vault-model";
function CardLogo({ brand }: { brand: VaultCardBrand }) {
  return (
    <span className="vault-logo vault-card-logo" aria-hidden="true">
      {brand === "visa" ? (
        <svg viewBox="0 0 40 14">
          <text
            x="20"
            y="11.5"
            fill="#1a1f71"
            fontFamily="Arial, Helvetica, sans-serif"
            fontSize="13"
            fontStyle="italic"
            fontWeight="800"
            textAnchor="middle"
          >
            VISA
          </text>
        </svg>
      ) : brand === "mastercard" ? (
        <svg viewBox="0 0 24 16">
          <circle cx="9" cy="8" r="6" fill="#eb001b" />
          <circle cx="15" cy="8" r="6" fill="#f79e1b" />
          <path d="M12 2.8A6 6 0 0 1 12 13.2 6 6 0 0 1 12 2.8Z" fill="#ff5f00" />
        </svg>
      ) : brand === "amex" ? (
        <svg viewBox="0 0 40 14">
          <rect width="40" height="14" rx="2" fill="#2e77bc" />
          <text
            x="20"
            y="10.5"
            fill="#ffffff"
            fontFamily="Arial, Helvetica, sans-serif"
            fontSize="9"
            fontWeight="800"
            textAnchor="middle"
          >
            AMEX
          </text>
        </svg>
      ) : (
        <CreditCard />
      )}
    </span>
  );
}
export function VaultArtwork({
  item,
  saved,
}: {
  item: VaultItemSummary | Draft;
  saved?: VaultItemSummary | null;
}) {
  if (item.kind === "card")
    return (
      <CardLogo
        brand={
          "brand" in item
            ? item.brand
            : item.number
              ? cardBrand(digitsOf(item.number))
              : saved?.kind === "card"
                ? saved.brand
                : null
        }
      />
    );
  if (item.kind === "apiKey")
    return (
      <span className="vault-logo integration-logo-tile" aria-hidden="true">
        <KeySquare />
      </span>
    );
  if (item.kind === "contact") {
    const name = (item.fullName || item.label).trim();
    const words = name.split(/\s+/);
    const initials =
      words.length > 1
        ? `${words[0]?.charAt(0) ?? ""}${words.at(-1)?.charAt(0) ?? ""}`.toUpperCase()
        : name.slice(0, 2).toUpperCase();
    return (
      <span className="vault-logo vault-avatar" aria-hidden="true">
        {initials || <UserRound />}
      </span>
    );
  }
  const letter = item.website
    .trim()
    .replace(/^[a-z]+:\/\//iu, "")
    .replace(/^www\./iu, "")
    .charAt(0)
    .toUpperCase();
  return (
    <span className="vault-logo integration-logo-tile" aria-hidden="true">
      {letter ? (
        /\d/u.test(letter) ? (
          <Globe2 />
        ) : (
          <span className="vault-letter">{letter}</span>
        )
      ) : (
        <KeyRound />
      )}
    </span>
  );
}
