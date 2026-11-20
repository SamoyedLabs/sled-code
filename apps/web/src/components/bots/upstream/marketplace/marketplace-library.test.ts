import { expect, it } from "vite-plus/test";
import { removableSkill, userSkills } from "./marketplace-library";
import type { InstalledSkill } from "./marketplace-model";
const skill: InstalledSkill = {
  skillId: "review",
  slug: "review",
  name: "Review",
  installedVersion: 1,
  availableVersion: 2,
  state: "update-available",
  origin: "marketplace",
};
it("keeps only user-managed skills, including an old host's built-in and home identities, and deduplicates across agents", () => {
  const protectedSkills: readonly InstalledSkill[] = [
    { ...skill, origin: "managed" },
    { ...skill, origin: "workspace" },
    { ...skill, origin: undefined, skillId: "home:review" },
    { ...skill, origin: undefined, skillId: "openbot-site-hosting" },
    { ...skill, origin: undefined, slug: "openbot-site-hosting" },
  ];
  for (const protectedSkill of protectedSkills) expect(removableSkill(protectedSkill)).toBe(false);
  const local: InstalledSkill = {
    ...skill,
    skillId: "local-skill-one",
    name: "A local skill",
    origin: "local",
  };
  expect(
    userSkills({
      first: [skill, ...protectedSkills],
      second: [{ ...skill, installedVersion: 2 }, local],
    }),
  ).toEqual([local, skill]);
});
