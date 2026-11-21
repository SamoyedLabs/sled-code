import { describe, expect, it } from "vite-plus/test";
import {
  createFirstAgentDraft,
  applySuggestion,
  updateAgentDraft,
  FIRST_AGENT_SUGGESTIONS,
  creationInput,
  selectCreationModel,
  resolveCreationModel,
} from "./agent-draft";
import { retainCreateAttempt, retainedCreateAttempt, clearCreateAttempt } from "./create-attempt";
import type { ClientAgentModelOption } from "../provider/types";
describe("source agent creation draft", () => {
  it("keeps the selected model and effort through a suggestion, and clears only the suggestion when its profile changes", () => {
    const initial = { ...createFirstAgentDraft(() => 0), reasoningEffort: "high" as const };
    const suggestion = FIRST_AGENT_SUGGESTIONS[0]!;
    const selected = applySuggestion(initial, suggestion);
    expect(selected.provider).toBe(initial.provider);
    expect(selected.model).toBe(initial.model);
    expect(selected.reasoningEffort).toBe("high");
    expect(updateAgentDraft(selected, { name: "Edited" }).suggestionId).toBeNull();
    expect(updateAgentDraft(selected, { model: "another" }).suggestionId).toBe(suggestion.id);
  });
  it("uses source role instructions or the greeting, carrying face identity even when model selection is unavailable", () => {
    const draft = {
      ...createFirstAgentDraft(() => 0),
      name: " My agent ",
      purpose: " Plan trips ",
      reasoningEffort: "high" as const,
    };
    expect(creationInput(draft, false)).toEqual({
      name: "My agent",
      description: " Plan trips ",
      initialMessage: "Your ongoing role is: Plan trips",
      avatarSeed: draft.avatarSeed,
      avatarHue: null,
    });
    expect(creationInput({ ...draft, purpose: "  " }, true)).toMatchObject({
      initialMessage: "Greet me briefly.",
      provider: draft.provider,
      model: draft.model,
      reasoningEffort: "high",
    });
  });
  it("drops unsupported reasoning levels when changing models and avoids unavailable provider defaults", () => {
    const models: ClientAgentModelOption[] = [
      {
        provider: "codex",
        id: "model-a",
        name: "A",
        description: "",
        defaultReasoningEffort: "low",
        supportedReasoningEfforts: ["low"],
      },
      {
        provider: "claude",
        id: "model-b",
        name: "B",
        description: "",
        defaultReasoningEffort: "high",
        supportedReasoningEfforts: ["high"],
      },
    ];
    const draft = { ...createFirstAgentDraft(() => 0), reasoningEffort: "high" as const };
    expect(selectCreationModel(draft, "model-a", "codex", models).reasoningEffort).toBeUndefined();
    expect(
      resolveCreationModel(models, {
        phase: "ready",
        providers: [
          { id: "claude", state: "signed-out", version: null, message: null },
          { id: "codex", state: "available", version: null, message: null },
        ],
      }),
    ).toEqual({ provider: "codex", model: "model-a" });
  });
  it("retains uncertain and accepted creation outcomes only for their original host session", () => {
    const session = {},
      replacement = {},
      scope = "env:host",
      draft = createFirstAgentDraft(() => 0);
    retainCreateAttempt(session, scope, { draft, agentId: null });
    expect(retainedCreateAttempt(session, scope)?.draft).toBe(draft);
    expect(retainedCreateAttempt(replacement, scope)).toBeNull();
    expect(retainedCreateAttempt(session, "env:other")).toBeNull();
    retainCreateAttempt(session, scope, { draft, agentId: "accepted-agent" });
    expect(retainedCreateAttempt(session, scope)?.agentId).toBe("accepted-agent");
    clearCreateAttempt(session, scope);
    expect(retainedCreateAttempt(session, scope)).toBeNull();
  });
});
