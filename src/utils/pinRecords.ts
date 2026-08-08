import { isValidPinnedBlockUid, type PinnedBlocksByParent } from "~/utils/pins";

export const CONFIG_PAGE_TITLE = "roam/js/pinned-blocks";
export const PINNED_BLOCKS_PROP = "roamjs-pinned-blocks";
export const PIN_RECORD_VERSION = 1;
export const NOTICE_TEXT =
  "This page is used by the Pinned Blocks extension to store shared pin information. Pin order follows the order of blocks in their parent outline. ^^Do not delete or edit the blocks on this page.^^";

export type BlockProps = Record<string, unknown>;

export type ConfigChild = {
  uid: string;
  text: string;
  order: number;
  props: BlockProps;
  propsRequireRewrite?: boolean;
};

export type NoticeRecordProps = {
  type: "notice";
  version: typeof PIN_RECORD_VERSION;
};

export type PinRecordProps = {
  type: "pin";
  version: typeof PIN_RECORD_VERSION;
  "block-uid": string;
};

export type PinnedBlocksRecordProps = NoticeRecordProps | PinRecordProps;

export type ConfigRecordSummary = {
  canonicalNoticeUid: string | null;
  duplicateRecordUids: string[];
  pinRecordUidsByPinnedUid: Map<string, string[]>;
  pinnedUids: string[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const normalizeBlockProps = (value: unknown): BlockProps =>
  isRecord(value)
    ? Object.fromEntries(
        Object.entries(value).map(([key, nestedValue]) => [
          key.replace(/^:+/, ""),
          isRecord(nestedValue)
            ? normalizeBlockProps(nestedValue)
            : nestedValue,
        ]),
      )
    : {};

export const blockPropsRequireRewrite = (value: unknown): boolean =>
  isRecord(value) &&
  Object.entries(value).some(
    ([key, nestedValue]) =>
      key.startsWith("::") || blockPropsRequireRewrite(nestedValue),
  );

export const getPinnedBlocksRecordProps = (
  props: BlockProps,
): PinnedBlocksRecordProps | null => {
  const value = props[PINNED_BLOCKS_PROP];
  if (!isRecord(value) || value.version !== PIN_RECORD_VERSION) {
    return null;
  }

  if (value.type === "notice") {
    return {
      type: "notice",
      version: PIN_RECORD_VERSION,
    };
  }

  const blockUid = value["block-uid"];
  if (
    value.type !== "pin" ||
    typeof blockUid !== "string" ||
    !isValidPinnedBlockUid(blockUid)
  ) {
    return null;
  }

  return {
    type: "pin",
    version: PIN_RECORD_VERSION,
    "block-uid": blockUid,
  };
};

export const mergePinnedBlocksRecordProps = ({
  props,
  record,
}: {
  props: BlockProps;
  record: PinnedBlocksRecordProps;
}): BlockProps => ({
  ...props,
  [PINNED_BLOCKS_PROP]: record,
});

const getCanonicalUid = (uids: string[]): string | null =>
  [...uids].sort()[0] || null;

export const summarizeConfigRecords = (
  children: ConfigChild[],
): ConfigRecordSummary => {
  const noticeUids: string[] = [];
  const pinRecordUidsByPinnedUid = new Map<string, string[]>();

  children.forEach((child) => {
    const record = getPinnedBlocksRecordProps(child.props);
    if (!record) return;

    if (record.type === "notice") {
      noticeUids.push(child.uid);
      return;
    }

    const pinnedUid = record["block-uid"];
    pinRecordUidsByPinnedUid.set(pinnedUid, [
      ...(pinRecordUidsByPinnedUid.get(pinnedUid) || []),
      child.uid,
    ]);
  });

  const canonicalNoticeUid = getCanonicalUid(noticeUids);
  const duplicateRecordUids = noticeUids.filter(
    (uid) => uid !== canonicalNoticeUid,
  );

  pinRecordUidsByPinnedUid.forEach((recordUids) => {
    const canonicalUid = getCanonicalUid(recordUids);
    duplicateRecordUids.push(
      ...recordUids.filter((uid) => uid !== canonicalUid),
    );
  });

  return {
    canonicalNoticeUid,
    duplicateRecordUids: Array.from(new Set(duplicateRecordUids)).sort(),
    pinRecordUidsByPinnedUid,
    pinnedUids: Array.from(pinRecordUidsByPinnedUid.keys()),
  };
};

export const buildPinnedBlocksByParent = ({
  pinnedUids,
  getParentUidByBlockUid,
  getDirectChildUids,
}: {
  pinnedUids: string[];
  getParentUidByBlockUid: (uid: string) => string;
  getDirectChildUids: (parentUid: string) => string[];
}): {
  settings: PinnedBlocksByParent;
  staleUids: string[];
} => {
  const pinnedUidsByParent = new Map<string, string[]>();
  const staleUids: string[] = [];

  pinnedUids.forEach((uid) => {
    const parentUid = getParentUidByBlockUid(uid);
    if (!parentUid) {
      staleUids.push(uid);
      return;
    }

    pinnedUidsByParent.set(parentUid, [
      ...(pinnedUidsByParent.get(parentUid) || []),
      uid,
    ]);
  });

  const settings = Object.fromEntries(
    Array.from(pinnedUidsByParent.entries()).map(
      ([parentUid, parentPinnedUids]) => {
        const pinnedSet = new Set(parentPinnedUids);
        const orderedPinnedUids = getDirectChildUids(parentUid).filter((uid) =>
          pinnedSet.has(uid),
        );
        const orderedSet = new Set(orderedPinnedUids);
        return [
          parentUid,
          [
            ...orderedPinnedUids,
            ...parentPinnedUids.filter((uid) => !orderedSet.has(uid)).sort(),
          ],
        ];
      },
    ),
  );

  return { settings, staleUids };
};

export const createNoticeRecordProps = (): BlockProps =>
  mergePinnedBlocksRecordProps({
    props: {},
    record: { type: "notice", version: PIN_RECORD_VERSION },
  });

export const createPinRecordProps = (uid: string): BlockProps =>
  mergePinnedBlocksRecordProps({
    props: {},
    record: {
      type: "pin",
      version: PIN_RECORD_VERSION,
      "block-uid": uid,
    },
  });
