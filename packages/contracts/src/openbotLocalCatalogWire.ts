// Sled's closed local-skill-catalog-v1 extension for pinned Openbot 0.60.0 services.
import {
  adminRoute,
  fields,
  string,
  identifier,
  count,
  boolean,
  nullable,
  list,
  oneOf,
  empty,
  type OptionalRouteCodec,
  type AdminDecoder,
} from "./openbotPinnedSettings/admin-wire.ts";
export const LOCAL_CATALOG_CAPABILITY = "local-skill-catalog-v1";
export const LOCAL_CATALOG_ROUTES = {
  searchSkills: "/v1/admin/catalog/skills/search",
  skill: "/v1/admin/catalog/skills/detail",
  skillBySlug: "/v1/admin/catalog/skills/slug",
  mySkills: "/v1/admin/catalog/skills/mine",
  localList: "/v1/admin/catalog/local/list",
  localGet: "/v1/admin/catalog/local/detail",
  localCreate: "/v1/admin/catalog/local/create",
  localRevise: "/v1/admin/catalog/local/revise",
  localInstall: "/v1/admin/catalog/local/install",
  searchAgents: "/v1/admin/catalog/agents/search",
  myAgents: "/v1/admin/catalog/agents/mine",
} as const;
export const LOCAL_CATALOG_BUNDLE_PATH = "/v1/admin/catalog/local/bundle";
const category = oneOf(
  "coding",
  "design",
  "data-analytics",
  "documents",
  "productivity",
  "research",
  "automation",
  "other",
);
const query = fields(
  {},
  {
    query: string(256),
    category,
    featured: boolean,
    verified: boolean,
    sort: oneOf("installs", "updated", "name"),
    cursor: string(2048),
    limit: count,
  },
);
const skillFields = {
  id: identifier,
  slug: string(128),
  name: string(256),
  description: string(4096),
  category,
  creatorName: string(256),
  version: count,
  installs: count,
  featured: boolean,
  updatedAt: string(64),
};
const hue: AdminDecoder = (value) => {
  if (typeof value !== "number" || ![0, 30, 55, 100, 150, 185, 215, 245, 280, 320].includes(value))
    throw new Error("Invalid avatar hue.");
  return value;
};
const publicImage = nullable(string(2048));
const skillPresentation = {
  creatorAvatarUrl: publicImage,
  verified: boolean,
  iconUrl: publicImage,
};
const agentPresentation = {
  category,
  creatorAvatarUrl: publicImage,
  verified: boolean,
  avatarSeed: string(256),
  avatarHue: nullable(hue),
  avatarUrl: publicImage,
  cardUrl: publicImage,
};
const skill = fields(skillFields, skillPresentation);
const detail = fields(
  {
    ...skillFields,
    versionId: identifier,
    bundleSha256: string(64),
    files: list(string(4096), 4096),
    instructions: string(500000),
  },
  { ...skillPresentation, examplePrompt: string(100000) },
);
const agent = fields(
  {
    id: identifier,
    name: string(256),
    title: string(256),
    description: string(100000),
    creatorName: string(256),
    version: count,
    installs: count,
    featured: boolean,
    skillCount: count,
    routineCount: count,
    activeRoutineCount: count,
    updatedAt: string(64),
  },
  agentPresentation,
);
const skillSubmission = fields({
  id: identifier,
  skillId: identifier,
  slug: string(128),
  name: string(256),
  description: string(4096),
  category,
  version: count,
  status: oneOf("pending", "approved", "rejected"),
  rejectionNote: nullable(string(4096)),
  createdAt: string(64),
});
const agentSubmission = fields({
  id: identifier,
  listingId: identifier,
  name: string(256),
  title: string(256),
  description: string(100000),
  version: count,
  status: oneOf("pending", "approved", "rejected"),
  rejectionNote: nullable(string(4096)),
  createdAt: string(64),
});
export const LOCAL_CATALOG_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [
    LOCAL_CATALOG_ROUTES.searchSkills,
    adminRoute(query, fields({ skills: list(skill, 100), nextCursor: nullable(string(2048)) })),
  ],
  [LOCAL_CATALOG_ROUTES.skill, adminRoute(fields({ skillId: identifier }), detail)],
  [LOCAL_CATALOG_ROUTES.skillBySlug, adminRoute(fields({ slug: string(128) }), detail)],
  [LOCAL_CATALOG_ROUTES.mySkills, adminRoute(empty, list(skillSubmission, 4096))],
  [
    LOCAL_CATALOG_ROUTES.localList,
    adminRoute(
      fields({}, { after: identifier, limit: count }),
      fields({ skills: list(skill, 50), nextCursor: nullable(identifier) }),
    ),
  ],
  [
    LOCAL_CATALOG_ROUTES.localGet,
    adminRoute(fields({ skillId: identifier }, { revision: count }), detail),
  ],
  [
    LOCAL_CATALOG_ROUTES.localCreate,
    adminRoute(fields({ agentId: identifier, sourcePath: string(4096) }), detail),
  ],
  [
    LOCAL_CATALOG_ROUTES.localRevise,
    adminRoute(
      fields({
        agentId: identifier,
        skillId: identifier,
        expectedRevision: count,
        sourcePath: string(4096),
      }),
      detail,
    ),
  ],
  [
    LOCAL_CATALOG_ROUTES.localInstall,
    adminRoute(fields({ agentId: identifier, skillId: identifier, revision: count }), empty),
  ],
  [
    LOCAL_CATALOG_ROUTES.searchAgents,
    adminRoute(query, fields({ agents: list(agent, 100), nextCursor: nullable(string(2048)) })),
  ],
  [LOCAL_CATALOG_ROUTES.myAgents, adminRoute(empty, list(agentSubmission, 4096))],
]);
export const LOCAL_CATALOG_OPERATIONS = [
  { operation: "settings.local-catalog.searchSkills", action: "searchSkills", kind: "read" },
  { operation: "settings.local-catalog.skill", action: "skill", kind: "read" },
  { operation: "settings.local-catalog.skillBySlug", action: "skillBySlug", kind: "read" },
  { operation: "settings.local-catalog.mySkills", action: "mySkills", kind: "read" },
  { operation: "settings.local-catalog.localList", action: "localList", kind: "read" },
  { operation: "settings.local-catalog.localGet", action: "localGet", kind: "read" },
  { operation: "settings.local-catalog.localCreate", action: "localCreate", kind: "admin" },
  { operation: "settings.local-catalog.localRevise", action: "localRevise", kind: "admin" },
  { operation: "settings.local-catalog.localInstall", action: "localInstall", kind: "admin" },
  { operation: "settings.local-catalog.searchAgents", action: "searchAgents", kind: "read" },
  { operation: "settings.local-catalog.myAgents", action: "myAgents", kind: "read" },
] as const;
export const LOCAL_CATALOG_SETTINGS = LOCAL_CATALOG_OPERATIONS.map((entry) => ({
  ...entry,
  label: entry.action,
  path: LOCAL_CATALOG_ROUTES[entry.action],
  capability: LOCAL_CATALOG_CAPABILITY,
  codec: LOCAL_CATALOG_CODECS.get(LOCAL_CATALOG_ROUTES[entry.action])!,
}));
