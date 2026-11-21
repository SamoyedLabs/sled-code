import {
  botNotificationDeepLink,
  parseBotNotificationDeepLink,
} from "@t3tools/shared/agentAwareness";

function dataFromNotificationResponse(response: unknown): Record<string, unknown> | null {
  if (typeof response !== "object" || response === null) {
    return null;
  }
  const notification = (response as { readonly notification?: unknown }).notification;
  if (typeof notification !== "object" || notification === null) {
    return null;
  }
  const request = (notification as { readonly request?: unknown }).request;
  if (typeof request !== "object" || request === null) {
    return null;
  }
  const content = (request as { readonly content?: unknown }).content;
  if (typeof content !== "object" || content === null) {
    return null;
  }
  const data = (content as { readonly data?: unknown }).data;
  return typeof data === "object" && data !== null ? (data as Record<string, unknown>) : null;
}

function identifierFromNotificationResponse(response: unknown): string | null {
  if (typeof response !== "object" || response === null) {
    return null;
  }
  const notification = (response as { readonly notification?: unknown }).notification;
  if (typeof notification !== "object" || notification === null) {
    return null;
  }
  const request = (notification as { readonly request?: unknown }).request;
  if (typeof request !== "object" || request === null) {
    return null;
  }
  const identifier = (request as { readonly identifier?: unknown }).identifier;
  return typeof identifier === "string" ? identifier : null;
}

function encodeThreadDeepLink(input: {
  readonly environmentId: string;
  readonly threadId: string;
}): string | null {
  if (input.environmentId.length === 0 || input.threadId.length === 0) {
    return null;
  }
  try {
    return `/threads/${encodeURIComponent(input.environmentId)}/${encodeURIComponent(input.threadId)}`;
  } catch {
    return null;
  }
}

function normalizeThreadDeepLink(value: string): string | null {
  if (
    value.trim() !== value ||
    value.startsWith("//") ||
    value.includes("?") ||
    value.includes("#")
  ) {
    return null;
  }

  const parts = value.split("/");
  if (parts.length !== 4 || parts[0] !== "" || parts[1] !== "threads") {
    return null;
  }

  try {
    return encodeThreadDeepLink({
      environmentId: decodeURIComponent(parts[2] ?? ""),
      threadId: decodeURIComponent(parts[3] ?? ""),
    });
  } catch {
    return null;
  }
}

export function threadDeepLinkOnScreen(pathname: string): string | null {
  const botTarget = parseBotNotificationDeepLink(pathname);
  if (botTarget) return botNotificationDeepLink(botTarget);
  const match = /^\/threads\/([^/]+)\/([^/]+)(?:\/|$)/.exec(pathname);
  if (!match?.[1] || !match[2]) {
    return null;
  }
  return `/threads/${match[1]}/${match[2]}`;
}

export function extractAgentNotificationDeepLink(response: unknown): string | null {
  const data = dataFromNotificationResponse(response);
  const deepLink = data?.deepLink;
  if (typeof deepLink === "string") {
    const botTarget = parseBotNotificationDeepLink(deepLink);
    const normalizedDeepLink = botTarget
      ? botNotificationDeepLink(botTarget)
      : normalizeThreadDeepLink(deepLink);
    if (normalizedDeepLink) {
      return normalizedDeepLink;
    }
  }

  if (
    data?.kind === "bot" &&
    typeof data.environmentId === "string" &&
    typeof data.hostId === "string" &&
    typeof data.agentId === "string"
  ) {
    return botNotificationDeepLink({
      kind: "bot",
      environmentId: data.environmentId,
      hostId: data.hostId,
      agentId: data.agentId,
      ...(typeof data.taskId === "string" ? { taskId: data.taskId } : {}),
      ...(typeof data.channelId === "string" ? { channelId: data.channelId } : {}),
      ...(typeof data.routineId === "string" ? { routineId: data.routineId } : {}),
      ...(typeof data.routineRunId === "string" ? { routineRunId: data.routineRunId } : {}),
    });
  }
  const environmentId = data?.environmentId;
  const threadId = data?.threadId;
  if (typeof environmentId === "string" && typeof threadId === "string") {
    return encodeThreadDeepLink({ environmentId, threadId });
  }
  return null;
}

export function routeAgentNotificationResponseOnce(input: {
  readonly handledResponseIds: Set<string>;
  readonly response: unknown;
  readonly navigate: (deepLink: string) => void;
}): void {
  const responseId = identifierFromNotificationResponse(input.response);
  if (responseId && input.handledResponseIds.has(responseId)) {
    return;
  }
  const deepLink = extractAgentNotificationDeepLink(input.response);
  if (deepLink) {
    input.navigate(deepLink);
  }
  if (responseId) {
    input.handledResponseIds.add(responseId);
  }
}
