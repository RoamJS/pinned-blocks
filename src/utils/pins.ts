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

const addUnique = (values: string[], value: string): string[] =>
  values.includes(value) ? values : [...values, value];

const removeUidFromParent = ({
  settings,
  parentUid,
  uid,
}: {
  settings: PinnedBlocksByParent;
  parentUid: string;
  uid: string;
}): void => {
  const remainingUids = (settings[parentUid] || []).filter(
    (pinnedUid) => pinnedUid !== uid,
  );
  if (remainingUids.length) {
    settings[parentUid] = remainingUids;
  } else {
    delete settings[parentUid];
  }
};

const getPinnedParentByUid = (
  settings: PinnedBlocksByParent,
): Map<string, string> => {
  const pinnedParentByUid = new Map<string, string>();
  Object.entries(settings).forEach(([parentUid, pinnedUids]) => {
    pinnedUids.forEach((uid) => {
      if (!pinnedParentByUid.has(uid)) pinnedParentByUid.set(uid, parentUid);
    });
  });
  return pinnedParentByUid;
};

const settingsMatch = (
  first: PinnedBlocksByParent,
  second: PinnedBlocksByParent,
): boolean => {
  const firstParentUids = Object.keys(first);
  const secondParentUids = Object.keys(second);
  return (
    firstParentUids.length === secondParentUids.length &&
    firstParentUids.every((parentUid) =>
      ordersMatch(first[parentUid] || [], second[parentUid] || []),
    )
  );
};

export const reconcilePinsForParent = ({
  settings,
  parentUid,
  directChildUids,
  getParentUidByBlockUid,
}: {
  settings: PinnedBlocksByParent;
  parentUid: string;
  directChildUids: string[];
  getParentUidByBlockUid: (uid: string) => string;
}): {
  settings: PinnedBlocksByParent;
  changed: boolean;
  affectedParentUids: string[];
  removedUids: string[];
} => {
  const pinnedParentByUid = getPinnedParentByUid(settings);
  if (!pinnedParentByUid.size) {
    return {
      settings,
      changed: false,
      affectedParentUids: [],
      removedUids: [],
    };
  }

  const directChildSet = new Set(directChildUids);
  const directPinnedUids = directChildUids.filter((uid) =>
    pinnedParentByUid.has(uid),
  );
  const nextSettings: PinnedBlocksByParent = Object.fromEntries(
    Object.entries(settings).map(([storedParentUid, pinnedUids]) => [
      storedParentUid,
      [...pinnedUids],
    ]),
  );
  const affectedParentUids: string[] = [];
  const movedAwayUids: string[] = [];
  const removedUids: string[] = [];

  directPinnedUids.forEach((uid) => {
    const storedParentUid = pinnedParentByUid.get(uid);
    if (storedParentUid && storedParentUid !== parentUid) {
      removeUidFromParent({
        settings: nextSettings,
        parentUid: storedParentUid,
        uid,
      });
      affectedParentUids.push(storedParentUid);
    }
  });

  const transientPinnedUids: string[] = [];
  (settings[parentUid] || []).forEach((uid) => {
    if (directChildSet.has(uid)) return;

    const liveParentUid = getParentUidByBlockUid(uid);
    if (liveParentUid === parentUid) {
      transientPinnedUids.push(uid);
      return;
    }

    if (!liveParentUid) {
      removedUids.push(uid);
      return;
    }

    const targetPinnedUids = nextSettings[liveParentUid] || [];
    nextSettings[liveParentUid] = addUnique(targetPinnedUids, uid);
    removeUidFromParent({ settings: nextSettings, parentUid, uid });

    movedAwayUids.push(uid);
    affectedParentUids.push(liveParentUid);
  });

  const migratedDirectPinnedUids = directPinnedUids.filter(
    (uid) => pinnedParentByUid.get(uid) !== parentUid,
  );
  const nextParentPinnedUids = transientPinnedUids.length
    ? [
        ...(settings[parentUid] || []).filter(
          (uid) => !removedUids.includes(uid) && !movedAwayUids.includes(uid),
        ),
        ...migratedDirectPinnedUids.filter(
          (uid) => !(settings[parentUid] || []).includes(uid),
        ),
      ]
    : directPinnedUids;
  if (nextParentPinnedUids.length) {
    nextSettings[parentUid] = nextParentPinnedUids;
  } else {
    delete nextSettings[parentUid];
  }

  if (settingsMatch(settings, nextSettings)) {
    return {
      settings,
      changed: false,
      affectedParentUids: [],
      removedUids: [],
    };
  }

  return {
    settings: nextSettings,
    changed: true,
    affectedParentUids: Array.from(new Set(affectedParentUids)).filter(
      (affectedParentUid) => affectedParentUid !== parentUid,
    ),
    removedUids,
  };
};
