/** Brand marks for integrations. The file imports only plain paths, so the public site can use it without the shared UI root. */

import {
  DISCORD_MARK_PATH,
  GITHUB_MARK_PATH,
  SLACK_MARK_PATH,
  TELEGRAM_MARK_PATH,
  WHATSAPP_MARK_PATH,
} from "./connector-mark-shape";

/** GitHub's mark. Lucide has no brand icons, so the path is GitHub's own. */
export function GitHubMark(props: { className?: string | undefined }) {
  return (
    <svg className={props.className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d={GITHUB_MARK_PATH} />
    </svg>
  );
}

/** Slack's mark, for the same reason. */
export function SlackMark(props: { className?: string | undefined }) {
  return (
    <svg className={props.className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d={SLACK_MARK_PATH} />
    </svg>
  );
}

/** Discord's mark, for the same reason. */
export function DiscordMark(props: { className?: string | undefined }) {
  return (
    <svg className={props.className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d={DISCORD_MARK_PATH} />
    </svg>
  );
}

/** Telegram's mark, for the same reason. */
export function TelegramMark(props: { className?: string | undefined }) {
  return (
    <svg className={props.className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d={TELEGRAM_MARK_PATH} />
    </svg>
  );
}

/** WhatsApp's mark, for the same reason. */
export function WhatsAppMark(props: { className?: string | undefined }) {
  return (
    <svg className={props.className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d={WHATSAPP_MARK_PATH} />
    </svg>
  );
}
