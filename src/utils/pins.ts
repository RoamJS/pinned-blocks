export type PinnedBlocksByParent = Record<string, string[]>;

export const STORAGE_KEY = "pinned-blocks-by-parent";
export const UID_REGEX = /^[A-Za-z0-9_-]{9}$/;
export const DAILY_NOTE_UID_REGEX = /^\d{2}-\d{2}-\d{4}$/;

export const isValidPinnedBlockUid = (uid: string): boolean =>
  UID_REGEX.test(uid);

export const isValidPinnedParentUid = (uid: string): boolean =>
  isValidPinnedBlockUid(uid) || DAILY_NOTE_UID_REGEX.test(uid);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const normalizePinnedBlocksSettings = (
  value: unknown,
): PinnedBlocksByParent => {
  const parsed = typeof value === "string" ? JSON.parse(value || "{}") : value;
  if (!isRecord(parsed)) return {};

  return Object.fromEntries(
    Object.entries(parsed)
      .map(([parentUid, uids]): [string, string[]] => [
        parentUid,
        Array.isArray(uids)
          ? Array.from(
              new Set(
                uids.filter(
                  (uid): uid is string =>
                    typeof uid === "string" && isValidPinnedBlockUid(uid),
                ),
              ),
            )
          : [],
      ])
      .filter(
        ([parentUid, uids]) => isValidPinnedParentUid(parentUid) && uids.length,
      ),
  );
};

export const getPinnedParentUid = ({
  uid,
  settings,
}: {
  uid: string;
  settings: PinnedBlocksByParent;
}): string | null =>
  Object.entries(settings).find(([, uids]) => uids.includes(uid))?.[0] || null;

export const addPinnedUid = ({
  settings,
  parentUid,
  uid,
}: {
  settings: PinnedBlocksByParent;
  parentUid: string;
  uid: string;
}): PinnedBlocksByParent => {
  const existingParentUid = getPinnedParentUid({ uid, settings });
  const nextSettings = existingParentUid
    ? removePinnedUid({ settings, uid })
    : settings;

  const parentPins = nextSettings[parentUid] || [];
  return {
    ...nextSettings,
    [parentUid]: parentPins.includes(uid) ? parentPins : [...parentPins, uid],
  };
};

export const removePinnedUid = ({
  settings,
  uid,
}: {
  settings: PinnedBlocksByParent;
  uid: string;
}): PinnedBlocksByParent => {
  const nextSettings: PinnedBlocksByParent = {};
  Object.entries(settings).forEach(([parentUid, uids]) => {
    const remainingUids = uids.filter((p) => p !== uid);
    if (remainingUids.length) nextSettings[parentUid] = remainingUids;
  });
  return nextSettings;
};

export const getDesiredChildOrder = ({
  childUids,
  pinnedUids,
}: {
  childUids: string[];
  pinnedUids: string[];
}): string[] => {
  const childSet = new Set(childUids);
  const pinnedSet = new Set(pinnedUids);
  const visiblePinnedUids = pinnedUids.filter((uid) => childSet.has(uid));
  return [
    ...visiblePinnedUids,
    ...childUids.filter((uid) => !pinnedSet.has(uid)),
  ];
};

export const ordersMatch = (first: string[], second: string[]): boolean =>
  first.length === second.length &&
  first.every((uid, index) => uid === second[index]);

export const shouldRemovePinnedIndicator = ({
  pinnedUids,
  renderedUid,
  storedUid,
}: {
  pinnedUids: Set<string>;
  renderedUid: string | null;
  storedUid?: string;
}): boolean =>
  !renderedUid || storedUid !== renderedUid || !pinnedUids.has(renderedUid);

export const prunePinsForParent = ({
  settings,
  parentUid,
  directChildUids,
}: {
  settings: PinnedBlocksByParent;
  parentUid: string;
  directChildUids: string[];
}): {
  settings: PinnedBlocksByParent;
  changed: boolean;
  removedUids: string[];
} => {
  const pinnedUids = settings[parentUid] || [];
  const directChildSet = new Set(directChildUids);
  const remainingUids = pinnedUids.filter((uid) => directChildSet.has(uid));
  const removedUids = pinnedUids.filter((uid) => !directChildSet.has(uid));

  if (!removedUids.length) {
    return { settings, changed: false, removedUids: [] };
  }

  const nextSettings = { ...settings };
  if (remainingUids.length) {
    nextSettings[parentUid] = remainingUids;
  } else {
    delete nextSettings[parentUid];
  }

  return { settings: nextSettings, changed: true, removedUids };
};
