// Ported from OpenBot packages/contracts/src/ipc-sidebar-layout.ts.
import { SIDEBAR_FOLDER_LEVELS, type SidebarLayout } from "./openbotSidebarModel";
type SidebarLayoutSnapshot = SidebarLayout;
export function sidebarFolderParents(
  layout: Pick<SidebarLayoutSnapshot, "sections" | "order">,
): Map<string, string> {
  const known = new Map(layout.sections.map((section) => [section.id, section]));
  const rank = new Map(layout.order.map((sectionId, index) => [sectionId, index]));
  const ordered = [...layout.sections].sort(
    (left, right) =>
      (rank.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
      (rank.get(right.id) ?? Number.MAX_SAFE_INTEGER),
  );
  const parents = new Map<string, string>();
  for (const section of ordered) {
    const parentId = section.parentId;
    if (parentId === undefined || parentId === section.id || !known.has(parentId)) continue;
    let ancestor: string | undefined = parentId;
    while (ancestor !== undefined && ancestor !== section.id) ancestor = parents.get(ancestor);
    if (ancestor === undefined) parents.set(section.id, parentId);
  }
  for (const sectionId of sidebarFolderTreeOrder(layout.order, parents)) {
    const chain = sidebarFolderAncestors(parents, sectionId);
    if (chain.length >= SIDEBAR_FOLDER_LEVELS) {
      const parentId = chain[SIDEBAR_FOLDER_LEVELS - 2];
      if (parentId !== undefined) parents.set(sectionId, parentId);
    }
  }
  return parents;
}

export function sidebarFolderAncestors(
  parents: ReadonlyMap<string, string>,
  sectionId: string,
): string[] {
  const chain: string[] = [];
  for (
    let parentId = parents.get(sectionId);
    parentId !== undefined;
    parentId = parents.get(parentId)
  ) {
    if (chain.includes(parentId)) break;
    chain.unshift(parentId);
  }
  return chain;
}

export function sidebarFolderHeight(
  parents: ReadonlyMap<string, string>,
  sectionId: string,
): number {
  let height = 0;
  for (const [childId, parentId] of parents) {
    if (parentId === sectionId)
      height = Math.max(height, 1 + sidebarFolderHeight(parents, childId));
  }
  return height;
}

export function sidebarFolderTreeOrder(
  order: readonly string[],
  parents: ReadonlyMap<string, string>,
): string[] {
  const present = new Set(order);
  const children = new Map<string | null, string[]>();
  for (const sectionId of order) {
    const parentId = parents.get(sectionId);
    const key = parentId !== undefined && present.has(parentId) ? parentId : null;
    children.set(key, [...(children.get(key) ?? []), sectionId]);
  }
  const result: string[] = [];
  const visit = (sectionId: string) => {
    if (result.includes(sectionId)) return;
    result.push(sectionId);
    for (const childId of children.get(sectionId) ?? []) visit(childId);
  };
  for (const sectionId of children.get(null) ?? []) visit(sectionId);
  for (const sectionId of order) visit(sectionId);
  return result;
}

export function sidebarFolderPath(
  layout: Pick<SidebarLayoutSnapshot, "sections">,
  parents: ReadonlyMap<string, string>,
  sectionId: string,
): string[] {
  const names = new Map(layout.sections.map((section) => [section.id, section.name]));
  return [...sidebarFolderAncestors(parents, sectionId), sectionId].flatMap((id) => {
    const name = names.get(id);
    return name === undefined ? [] : [name];
  });
}
