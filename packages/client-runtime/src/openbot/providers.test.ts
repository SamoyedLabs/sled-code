import { expect, it } from "@effect/vitest";
import {
  providerModels,
  providerStatus,
  providerOptions,
  validProviderChoice,
  botCreateRequest,
  botProviderUpdateRequest,
  providerAccounts,
  providerCodeSignIn,
  providerRelayCallbackQuery,
  providerSetupResult,
  EMPTY_PROVIDER_SETUP,
} from "./providers.ts";

it("preserves host model identities and requires a matching explicit provider selection", () => {
  const models = providerModels([
    {
      provider: "future-provider",
      id: "variant/model[context=272k,reasoning=medium]",
      name: "Future model",
      description: "Listed by the host",
      defaultReasoningEffort: "medium",
      supportedReasoningEfforts: ["low", "medium", "high"],
    },
  ])!;
  const providers = providerStatus({
    providers: [
      { id: "future-provider", displayName: "Future provider", state: "available", message: null },
    ],
  })!;
  const choice = { provider: "future-provider", model: models[0]!.id, reasoningEffort: null };
  expect(providerOptions(models, providers)).toEqual([
    { id: "future-provider", name: "Future provider" },
  ]);
  expect(validProviderChoice(models, providers, { ...choice, model: "" })).toBe(false);
  expect(validProviderChoice(models, providers, { ...choice, provider: "other" })).toBe(false);
  expect(validProviderChoice(models, providers, { ...choice, reasoningEffort: "ultra" })).toBe(
    false,
  );
  expect(validProviderChoice(models, providers, choice)).toBe(true);
  expect(botCreateRequest(" School ", " Check assignments ", choice)).toEqual({
    operation: "agent.create",
    input: {
      name: "School",
      description: "Check assignments",
      initialMessage: "Check assignments",
      provider: "future-provider",
      model: "variant/model[context=272k,reasoning=medium]",
    },
  });
  expect(botProviderUpdateRequest("agent1", choice, models)).toEqual({
    operation: "agent.update",
    agentId: "agent1",
    input: {
      provider: "future-provider",
      model: "variant/model[context=272k,reasoning=medium]",
      reasoningEffort: "medium",
    },
  });
  expect(botCreateRequest("School", "Check", { ...choice, model: "" })).toBeNull();
  expect(providerModels([{ provider: "x", id: "x", supportedReasoningEfforts: null }])).toBeNull();
});

it("keeps a relayed sign-in bound to its flow and callback without forwarding grant addresses", () => {
  const started = providerSetupResult(
    EMPTY_PROVIDER_SETUP,
    { operation: "provider.signInRelay.start", provider: "codex" },
    { flowId: "flow1", expiresAt: 1000, token: "private-value" },
  );
  expect(started.relay).toEqual({ flowId: "flow1", expiresAt: 1000, status: null });
  const callback = { port: 1455, path: "/auth/callback", state: "state1" };
  const status = {
    authorizeUrl: "https://auth.example.test/authorize",
    callback,
    result: null,
    token: "private-value",
  };
  const pending = providerSetupResult(
    started,
    { operation: "provider.signInRelay.status", flowId: "flow1" },
    status,
  );
  expect(pending.relay?.status).toEqual({
    authorizeUrl: "https://auth.example.test/authorize",
    callback,
    result: null,
  });
  expect(
    providerSetupResult(
      pending,
      { operation: "provider.signInRelay.status", flowId: "other" },
      { ...status, result: { error: null } },
    ).relay,
  ).toEqual(pending.relay);
  expect(
    providerRelayCallbackQuery(
      "http://localhost:1455/auth/callback?code=A%2BB&state=state1",
      callback,
    ),
  ).toBe("code=A%2BB&state=state1");
  for (const address of [
    "https://evil.example.test:1455/auth/callback?code=x&state=state1",
    "http://localhost:9999/auth/callback?code=x&state=state1",
    "http://localhost:1455/other?code=x&state=state1",
    "http://localhost:1455/auth/callback?code=x&state=wrong",
  ])
    expect(providerRelayCallbackQuery(address, callback)).toBeNull();
  expect(
    providerSetupResult(pending, { operation: "provider.signInRelay.cancel", flowId: "flow1" }, {})
      .relay,
  ).toBeNull();
  expect(
    providerSetupResult(
      started,
      { operation: "provider.signInRelay.status", flowId: "flow1" },
      { ...status, authorizeUrl: "javascript:alert(1)" },
    ).error,
  ).toBe("This engine returned an unsupported sign-in page.");
});

it("projects account identity without credentials and accepts only web sign-in pages", () => {
  expect(
    providerAccounts({
      providers: [
        {
          provider: "codex",
          accounts: [
            {
              id: "default",
              label: null,
              email: "user@example.test",
              state: "connected",
              message: null,
              token: "private-value",
            },
          ],
        },
      ],
      agents: [],
    }),
  ).toEqual({
    providers: [
      {
        provider: "codex",
        accounts: [
          {
            id: "default",
            label: null,
            email: "user@example.test",
            state: "connected",
            message: null,
          },
        ],
      },
    ],
    agents: [],
  });
  expect(providerAccounts({ providers: [], agents: null })).toBeNull();
  expect(
    providerCodeSignIn({ kind: "paste", verificationUrl: "javascript:alert(1)", expiresAt: 1000 }),
  ).toBeNull();
  expect(
    providerCodeSignIn({
      kind: "code",
      userCode: "ABCD",
      verificationUrl: "https://auth.example.test/device",
      expiresAt: 1000,
      token: "private-value",
    }),
  ).toEqual({
    kind: "code",
    userCode: "ABCD",
    verificationUrl: "https://auth.example.test/device",
    expiresAt: 1000,
  });
});
