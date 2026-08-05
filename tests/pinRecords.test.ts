import { expect, test } from "@playwright/test";
import {
  PINNED_BLOCKS_PROP,
  blockPropsRequireRewrite,
  buildPinnedBlocksByParent,
  createNoticeRecordProps,
  createPinRecordProps,
  getPinnedBlocksRecordProps,
  mergePinnedBlocksRecordProps,
  normalizeBlockProps,
  summarizeConfigRecords,
  type ConfigChild,
} from "../src/utils/pinRecords";

const child = ({
  uid,
  props,
  order = 0,
  text = "",
}: {
  uid: string;
  props: Record<string, unknown>;
  order?: number;
  text?: string;
}): ConfigChild => ({ uid, props, order, text });

test("record props parse valid notice and pin records", () => {
  expect(getPinnedBlocksRecordProps(createNoticeRecordProps())).toEqual({
    type: "notice",
    version: 1,
  });
  expect(getPinnedBlocksRecordProps(createPinRecordProps("block1234"))).toEqual(
    {
      type: "pin",
      version: 1,
      "block-uid": "block1234",
    },
  );
});

test("record props reject malformed versions, types, and block uids", () => {
  expect(
    getPinnedBlocksRecordProps({
      [PINNED_BLOCKS_PROP]: { type: "notice", version: 2 },
    }),
  ).toBeNull();
  expect(
    getPinnedBlocksRecordProps({
      [PINNED_BLOCKS_PROP]: { type: "other", version: 1 },
    }),
  ).toBeNull();
  expect(
    getPinnedBlocksRecordProps({
      [PINNED_BLOCKS_PROP]: {
        type: "pin",
        version: 1,
        "block-uid": "bad",
      },
    }),
  ).toBeNull();
});

test("merging record props preserves every unrelated top-level prop", () => {
  const existingProps = {
    "image-size": { image: { height: 100, width: 200 } },
    "roamjs-other-extension": { value: true },
  };

  expect(
    mergePinnedBlocksRecordProps({
      props: existingProps,
      record: { type: "notice", version: 1 },
    }),
  ).toEqual({
    ...existingProps,
    [PINNED_BLOCKS_PROP]: { type: "notice", version: 1 },
  });
  expect(existingProps).not.toHaveProperty(PINNED_BLOCKS_PROP);
});

test("raw Roam props normalize one or more namespace prefixes", () => {
  expect(
    normalizeBlockProps({
      ":roamjs-pinned-blocks": {
        ":type": "pin",
        "::version": 1,
        ":::block-uid": "block1234",
      },
    }),
  ).toEqual({
    "roamjs-pinned-blocks": {
      type: "pin",
      version: 1,
      "block-uid": "block1234",
    },
  });
});

test("only over-prefixed raw Roam props require a repair write", () => {
  expect(
    blockPropsRequireRewrite({
      ":roamjs-pinned-blocks": { ":type": "notice", ":version": 1 },
    }),
  ).toBe(false);
  expect(
    blockPropsRequireRewrite({
      "::roamjs-pinned-blocks": { "::type": "notice", "::version": 1 },
    }),
  ).toBe(true);
});

test("config summaries select canonical records and deterministic duplicates", () => {
  const summary = summarizeConfigRecords([
    child({ uid: "notice02", props: createNoticeRecordProps() }),
    child({ uid: "notice01", props: createNoticeRecordProps() }),
    child({ uid: "record002", props: createPinRecordProps("block1234") }),
    child({ uid: "record001", props: createPinRecordProps("block1234") }),
    child({ uid: "record003", props: createPinRecordProps("block5678") }),
    child({ uid: "unrelated", props: { ":other": true } }),
  ]);

  expect(summary.canonicalNoticeUid).toBe("notice01");
  expect(summary.pinnedUids).toEqual(["block1234", "block5678"]);
  expect(summary.pinRecordUidsByPinnedUid.get("block1234")).toEqual([
    "record002",
    "record001",
  ]);
  expect(summary.duplicateRecordUids).toEqual(["notice02", "record002"]);
});

test("config summaries ignore malformed and unrelated child props", () => {
  expect(
    summarizeConfigRecords([
      child({ uid: "malformed", props: { [PINNED_BLOCKS_PROP]: null } }),
      child({ uid: "unrelated", props: { ":other": true } }),
    ]),
  ).toEqual({
    canonicalNoticeUid: null,
    duplicateRecordUids: [],
    pinRecordUidsByPinnedUid: new Map(),
    pinnedUids: [],
  });
});

test("derived settings group live pins and follow shared child order", () => {
  expect(
    buildPinnedBlocksByParent({
      pinnedUids: ["block1234", "block5678", "block9999"],
      getParentUidByBlockUid: (uid) =>
        uid === "block9999" ? "parent456" : "parent123",
      getDirectChildUids: (parentUid) =>
        parentUid === "parent123"
          ? ["regular01", "block5678", "block1234"]
          : ["block9999"],
    }),
  ).toEqual({
    settings: {
      parent123: ["block5678", "block1234"],
      parent456: ["block9999"],
    },
    staleUids: [],
  });
});

test("derived settings report deleted pins and retain transient live pins", () => {
  expect(
    buildPinnedBlocksByParent({
      pinnedUids: ["block1234", "block5678"],
      getParentUidByBlockUid: (uid) => (uid === "block1234" ? "parent123" : ""),
      getDirectChildUids: () => [],
    }),
  ).toEqual({
    settings: { parent123: ["block1234"] },
    staleUids: ["block5678"],
  });
});
