import type { ReferencePin } from "./referencePins";

type Entity = {
  ":block/uid"?: string;
  ":node/title"?: string;
  ":block/string"?: string;
  ":block/refs"?: Entity[];
  ":block/parents"?: Entity[];
  ":block/children"?: Entity[];
  ":block/page"?: Entity;
};
export type ReferenceDetails = {
  sourceTitle: string;
  sourceUid?: string;
  isPage?: boolean;
  titles: string[];
};
export type ReferenceFilters = { includes?: string[]; removes?: string[] };

export const matchesReferenceFilters = ({
  titles,
  filters,
}: {
  titles: string[];
  filters: ReferenceFilters[];
}): boolean =>
  filters.every(
    ({ includes = [], removes = [] }) =>
      includes.every((title) => titles.includes(title)) &&
      !removes.some((title) => titles.includes(title)),
  );

export const readReferenceDetails = ({
  targetUid,
  blockUid,
}: ReferencePin): ReferenceDetails | null => {
  // A page title references only its own tags; pulling its outline is unnecessary.
  const entity = window.roamAlphaAPI.data.pull(
    "[:block/uid :node/title {:block/refs [:block/uid :node/title]}]",
    [":block/uid", blockUid],
  ) as Entity | null;
  if (!entity?.[":block/uid"]) return null;
  const isPage = typeof entity[":node/title"] === "string";
  const block = isPage
    ? entity
    : (window.roamAlphaAPI.data.pull(
        "[:block/uid :block/string {:block/refs [:block/uid :node/title]} {:block/page [:block/uid :node/title]} {:block/parents [:block/uid :node/title {:block/refs [:block/uid :node/title]}]} {:block/children ...}]",
        [":block/uid", blockUid],
      ) as Entity | null);
  if (!block?.[":block/uid"]) return null;
  const refs = new Set<string>();
  const titles = new Set<string>();
  const visit = (entity: Entity): void => {
    if (entity[":node/title"]) titles.add(entity[":node/title"]);
    entity[":block/refs"]?.forEach((ref) => {
      if (ref[":block/uid"]) refs.add(ref[":block/uid"]);
      if (ref[":node/title"]) titles.add(ref[":node/title"]);
    });
    if (!isPage) entity[":block/children"]?.forEach(visit);
  };
  visit(block);
  if (!refs.has(targetUid)) return null;
  // Native linked-reference filters include the source page and ancestor context.
  block[":block/parents"]?.forEach(visit);
  const sourceTitle =
    block[":node/title"] || block[":block/page"]?.[":node/title"] || "";
  const sourceUid = isPage ? blockUid : block[":block/page"]?.[":block/uid"];
  if (sourceTitle) titles.add(sourceTitle);
  return {
    sourceTitle,
    ...(sourceUid ? { sourceUid } : {}),
    ...(isPage ? { isPage: true } : {}),
    titles: [...titles],
  };
};
