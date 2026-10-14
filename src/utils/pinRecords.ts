import {
  isValidPinnedBlockUid,
  isValidPinnedParentUid,
  type PinnedBlocksByParent,
} from "~/utils/pins";

import { getReferencePinKey, type ReferencePin } from "~/utils/referencePins";

export const CONFIG_PAGE_TITLE = "roam/js/pinned-blocks";
export const PINNED_BLOCKS_PROP = "roamjs-pinned-blocks";
export const PIN_RECORD_VERSION = 1;
export const NOTICE_TEXT =
  "This page is used by the Pinned Blocks extension to store shared pin information. Outline pin order follows the order of blocks in their parent outline. Linked reference pins apply only to their target page or block. ^^Do not delete or edit the blocks on this page.^^";

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

export type ReferencePinRecordProps = {
  type: "reference-pin";
  version: typeof PIN_RECORD_VERSION;
  "target-uid": string;
  "block-uid": string;
};

export type PinnedBlocksRecordProps =
  | NoticeRecordProps
  | PinRecordProps
  | ReferencePinRecordProps;

export type ConfigRecordSummary = {
  canonicalNoticeUid: string | null;
  duplicateRecordUids: string[];
  pinRecordUidsByPinnedUid: Map<string, string[]>;
  pinnedUids: string[];
  referencePins: ReferencePin[];
  referenceRecordUidsByKey: Map<string, string[]>;
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
    (value.type !== "pin" && value.type !== "reference-pin") ||
    typeof blockUid !== "string" ||
    !isValidPinnedBlockUid(blockUid)
  ) {
    return null;
  }

  if (value.type === "reference-pin") {
    const targetUid = value["target-uid"];
    if (typeof targetUid !== "string" || !isValidPinnedParentUid(targetUid))
      return null;
    return {
      type: "reference-pin",
      version: PIN_RECORD_VERSION,
      "target-uid": targetUid,
      "block-uid": blockUid,
    };
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
  const referencePinsByKey = new Map<string, ReferencePin>();
  const referenceRecordUidsByKey = new Map<string, string[]>();
  const pinRecordUidsByPinnedUid = new Map<string, string[]>();

  children.forEach((child) => {
    const record = getPinnedBlocksRecordProps(child.props);
    if (!record) return;

    if (record.type === "notice") {
      noticeUids.push(child.uid);
      return;
    }

    if (record.type === "reference-pin") {
      const pin = {
        targetUid: record["target-uid"],
        blockUid: record["block-uid"],
      };
      const key = getReferencePinKey(pin);
      referencePinsByKey.set(key, pin);
      referenceRecordUidsByKey.set(key, [
        ...(referenceRecordUidsByKey.get(key) || []),
        child.uid,
      ]);
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

  [
    ...pinRecordUidsByPinnedUid.values(),
    ...referenceRecordUidsByKey.values(),
  ].forEach((recordUids) => {
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
    referencePins: Array.from(referencePinsByKey.values()),
    referenceRecordUidsByKey,
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

export const createReferencePinRecordProps = ({
  targetUid,
  blockUid,
}: ReferencePin): BlockProps =>
  mergePinnedBlocksRecordProps({
    props: {},
    record: {
      type: "reference-pin",
      version: PIN_RECORD_VERSION,
      "target-uid": targetUid,
      "block-uid": blockUid,
    },
  });
