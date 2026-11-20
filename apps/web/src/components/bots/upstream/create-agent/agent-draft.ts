import {
  avatarSeedForFace,
  type AvatarHue,
  type SupportedAvatarSilhouetteId,
} from "../settings/avatar-editor-model";
import type { ExpressionId } from "../../avatar/vendor/bloub-engine";
import { defaultProviderModel, PICKER_PROVIDERS, type AgentProviderId } from "../provider/identity";
import type { AgentReasoningEffort, AgentStatus, ClientAgentModelOption } from "../provider/types";
import { t } from "./text";
export interface FirstAgentDraft {
  name: string;
  purpose: string;
  avatarSeed: string;
  avatarHue: AvatarHue | null;
  suggestionId: string | null;
  provider: AgentProviderId;
  model: string;
  reasoningEffort?: AgentReasoningEffort | undefined;
}
export interface FirstAgentSuggestion {
  id: string;
  nameKey: string;
  descriptionKey: string;
  purposeKey: string;
  avatarSeed: string;
  avatarHue: AvatarHue;
  animationOffset: number;
}
const FIRST_AGENT_FACES: ReadonlyArray<{
  shape: SupportedAvatarSilhouetteId;
  expression: ExpressionId;
}> = [
  { shape: "cercle", expression: "attentif" },
  { shape: "squircle", expression: "curieux" },
  { shape: "triangle", expression: "neutre" },
  { shape: "hexagone", expression: "surpris" },
  { shape: "carre", expression: "attentif" },
  { shape: "galet", expression: "curieux" },
  { shape: "pentagone", expression: "neutre" },
  { shape: "capsule", expression: "attentif" },
  { shape: "losange", expression: "curieux" },
  { shape: "nuage", expression: "surpris" },
  { shape: "squircle", expression: "neutre" },
  { shape: "cercle", expression: "curieux" },
];

export const FIRST_AGENT_AVATAR_SEEDS = FIRST_AGENT_FACES.map((face) =>
  avatarSeedForFace("first-bot", face),
);

export const FIRST_AGENT_SUGGESTIONS: FirstAgentSuggestion[] = [
  {
    id: "inbox-helper",
    nameKey: "agent.setup.suggestion.inboxHelper.name",
    descriptionKey: "agent.setup.suggestion.inboxHelper.description",
    purposeKey: "agent.setup.suggestion.inboxHelper.purpose",
    avatarSeed: FIRST_AGENT_AVATAR_SEEDS[1] ?? "first-bot:inbox",
    avatarHue: 320,
    animationOffset: 0.15,
  },
  {
    id: "trip-planner",
    nameKey: "agent.setup.suggestion.tripPlanner.name",
    descriptionKey: "agent.setup.suggestion.tripPlanner.description",
    purposeKey: "agent.setup.suggestion.tripPlanner.purpose",
    avatarSeed: FIRST_AGENT_AVATAR_SEEDS[2] ?? "first-bot:travel",
    avatarHue: 215,
    animationOffset: 0.65,
  },
  {
    id: "personal-organizer",
    nameKey: "agent.setup.suggestion.personalOrganizer.name",
    descriptionKey: "agent.setup.suggestion.personalOrganizer.description",
    purposeKey: "agent.setup.suggestion.personalOrganizer.purpose",
    avatarSeed: FIRST_AGENT_AVATAR_SEEDS[3] ?? "first-bot:organizer",
    avatarHue: 55,
    animationOffset: 1.2,
  },
  {
    id: "shopping-scout",
    nameKey: "agent.setup.suggestion.shoppingScout.name",
    descriptionKey: "agent.setup.suggestion.shoppingScout.description",
    purposeKey: "agent.setup.suggestion.shoppingScout.purpose",
    avatarSeed: FIRST_AGENT_AVATAR_SEEDS[4] ?? "first-bot:shopping",
    avatarHue: 150,
    animationOffset: 1.8,
  },
  {
    id: "writing-partner",
    nameKey: "agent.setup.suggestion.writingPartner.name",
    descriptionKey: "agent.setup.suggestion.writingPartner.description",
    purposeKey: "agent.setup.suggestion.writingPartner.purpose",
    avatarSeed: FIRST_AGENT_AVATAR_SEEDS[5] ?? "first-bot:writing",
    avatarHue: 30,
    animationOffset: 2.45,
  },
  {
    id: "learning-coach",
    nameKey: "agent.setup.suggestion.learningCoach.name",
    descriptionKey: "agent.setup.suggestion.learningCoach.description",
    purposeKey: "agent.setup.suggestion.learningCoach.purpose",
    avatarSeed: FIRST_AGENT_AVATAR_SEEDS[6] ?? "first-bot:learning",
    avatarHue: 245,
    animationOffset: 3.15,
  },
];

export function createFirstAgentDraft(random: () => number = Math.random): FirstAgentDraft {
  const index = Math.min(
    FIRST_AGENT_AVATAR_SEEDS.length - 1,
    Math.floor(random() * FIRST_AGENT_AVATAR_SEEDS.length),
  );
  return {
    name: t("agent.setup.nameFallback"),
    purpose: "",
    avatarSeed: FIRST_AGENT_AVATAR_SEEDS[index] ?? "first-bot",
    avatarHue: null,
    suggestionId: null,
    provider: "codex",
    model: defaultProviderModel("codex"),
  };
}
export function updateAgentDraft(
  draft: FirstAgentDraft,
  updates: Partial<FirstAgentDraft>,
): FirstAgentDraft {
  const next = { ...draft, ...updates };
  const selected = FIRST_AGENT_SUGGESTIONS.find((row) => row.id === next.suggestionId);
  return {
    ...next,
    suggestionId:
      selected &&
      next.name === t(selected.nameKey) &&
      next.purpose === t(selected.purposeKey) &&
      next.avatarSeed === selected.avatarSeed &&
      next.avatarHue === selected.avatarHue
        ? selected.id
        : null,
  };
}
export function applySuggestion(
  draft: FirstAgentDraft,
  suggestion: FirstAgentSuggestion,
): FirstAgentDraft {
  return {
    ...draft,
    name: t(suggestion.nameKey),
    purpose: t(suggestion.purposeKey),
    avatarSeed: suggestion.avatarSeed,
    avatarHue: suggestion.avatarHue,
    suggestionId: suggestion.id,
  };
}
export function createAgentInitialMessage(draft: Pick<FirstAgentDraft, "purpose">) {
  const purpose = draft.purpose.trim();
  return purpose ? `Your ongoing role is: ${purpose}` : "Greet me briefly.";
}
export function creationInput(draft: FirstAgentDraft, supportsModel: boolean) {
  return {
    name: draft.name.trim(),
    description: draft.purpose,
    avatarSeed: draft.avatarSeed,
    avatarHue: draft.avatarHue,
    initialMessage: createAgentInitialMessage(draft),
    ...(supportsModel && draft.model
      ? {
          provider: draft.provider,
          model: draft.model,
          ...(draft.reasoningEffort ? { reasoningEffort: draft.reasoningEffort } : {}),
        }
      : {}),
  };
}
// Joined-host branch of renderer/agents/agent-creation-model.ts; no local development default.
export function resolveCreationModel(
  models: readonly ClientAgentModelOption[],
  status: AgentStatus | null,
) {
  for (const provider of PICKER_PROVIDERS) {
    const row = status?.providers?.find((row) => row.id === provider);
    if (row && row.state !== "available" && row.state !== "checking") continue;
    const options = models.filter((model) => model.provider === provider);
    const choice =
      options.find((model) => model.id === defaultProviderModel(provider)) ?? options[0];
    if (choice) return { provider, model: choice.id };
  }
  return null;
}
export function selectCreationModel(
  draft: FirstAgentDraft,
  model: string,
  provider: AgentProviderId,
  models: readonly ClientAgentModelOption[],
  effort?: AgentReasoningEffort,
) {
  const kept = effort ?? draft.reasoningEffort;
  return updateAgentDraft(draft, {
    model,
    provider,
    reasoningEffort:
      kept &&
      models
        .find((row) => row.provider === provider && row.id === model)
        ?.supportedReasoningEfforts.includes(kept)
        ? kept
        : undefined,
  });
}
