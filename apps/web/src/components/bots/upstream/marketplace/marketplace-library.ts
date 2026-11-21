import type { InstalledSkill } from "./marketplace-model";
export function removableSkill(skill: InstalledSkill) {
  return (
    skill.origin !== "managed" &&
    skill.origin !== "workspace" &&
    !skill.skillId.startsWith("home:") &&
    skill.slug !== "openbot-site-hosting" &&
    skill.skillId !== "openbot-site-hosting"
  );
}
export function userSkills(installed: Readonly<Record<string, readonly InstalledSkill[]>>) {
  const seen = new Map<string, InstalledSkill>();
  for (const skills of Object.values(installed))
    for (const skill of skills)
      if (removableSkill(skill) && !seen.has(skill.skillId)) seen.set(skill.skillId, skill);
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}
