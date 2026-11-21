import * as Schema from "effect/Schema";
export const CATEGORY_LABELS = {
  coding: "Coding",
  design: "Design",
  "data-analytics": "Data & Analytics",
  documents: "Documents",
  productivity: "Productivity",
  research: "Research",
  automation: "Automation",
  other: "Other",
} as const;
export type Category = keyof typeof CATEGORY_LABELS;
export type MarketplaceTab = "apps" | "agents" | "skills";
export type Source = "all" | "verified" | "public";
const category = Schema.Literals([
  "coding",
  "design",
  "data-analytics",
  "documents",
  "productivity",
  "research",
  "automation",
  "other",
]);
const summary = {
  id: Schema.String,
  name: Schema.String,
  description: Schema.String,
  creatorName: Schema.String,
  version: Schema.Number,
  installs: Schema.Number,
  featured: Schema.Boolean,
  updatedAt: Schema.String,
  verified: Schema.optional(Schema.Boolean),
  creatorAvatarUrl: Schema.optional(Schema.NullOr(Schema.String)),
};
export const SkillSummary = Schema.Struct({
  ...summary,
  slug: Schema.String,
  category,
  iconUrl: Schema.optional(Schema.NullOr(Schema.String)),
});
export const AgentSummary = Schema.Struct({
  ...summary,
  title: Schema.String,
  category: Schema.optional(category),
  avatarSeed: Schema.optional(Schema.String),
  avatarHue: Schema.optional(Schema.NullOr(Schema.Number)),
  avatarUrl: Schema.optional(Schema.NullOr(Schema.String)),
  skillCount: Schema.Number,
  routineCount: Schema.Number,
  activeRoutineCount: Schema.Number,
});
export const SkillDetail = Schema.Struct({
  ...SkillSummary.fields,
  versionId: Schema.String,
  instructions: Schema.String,
  files: Schema.Array(Schema.String),
  bundleSha256: Schema.String,
  examplePrompt: Schema.optional(Schema.String),
  cardUrl: Schema.optional(Schema.NullOr(Schema.String)),
});
export const InstalledSkill = Schema.Struct({
  skillId: Schema.String,
  slug: Schema.String,
  name: Schema.String,
  installedVersion: Schema.Number,
  availableVersion: Schema.Number,
  state: Schema.Literals(["installed", "update-available", "modified", "needs-repair"]),
  enabled: Schema.optional(Schema.Boolean),
  origin: Schema.optional(Schema.Literals(["marketplace", "managed", "local", "workspace"])),
  description: Schema.optional(Schema.String),
  problem: Schema.optional(Schema.String),
});
export type SkillSummary = typeof SkillSummary.Type;
export type AgentSummary = typeof AgentSummary.Type;
export type SkillDetail = typeof SkillDetail.Type;
export type InstalledSkill = typeof InstalledSkill.Type;
export type Listing =
  | { kind: "skill"; value: SkillSummary; local?: boolean }
  | { kind: "agent"; value: AgentSummary };
export const decodeSkillPage = Schema.decodeUnknownSync(
  Schema.Struct({ skills: Schema.Array(SkillSummary), nextCursor: Schema.NullOr(Schema.String) }),
);
export const decodeAgentPage = Schema.decodeUnknownSync(
  Schema.Struct({ agents: Schema.Array(AgentSummary), nextCursor: Schema.NullOr(Schema.String) }),
);
export const decodeSkill = Schema.decodeUnknownSync(SkillDetail);
export const decodeInstalled = Schema.decodeUnknownSync(Schema.Array(InstalledSkill));
