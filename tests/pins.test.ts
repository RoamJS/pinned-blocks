import { expect, test } from "@playwright/test";
import {
  getDesiredChildOrder,
  getPinnedParentUid,
  ordersMatch,
  reconcilePinsForParent,
  shouldRemovePinnedIndicator,
} from "../src/utils/pins";

test("pin lookups return parent ownership", () => {
  const settings = {
    parent123: ["block1234"],
    parent456: ["block5678"],
  };

  expect(getPinnedParentUid({ uid: "block5678", settings })).toBe("parent456");
  expect(getPinnedParentUid({ uid: "notpinned", settings })).toBeNull();
});

test("getDesiredChildOrder keeps pinned direct children first in pin order", () => {
  expect(
    getDesiredChildOrder({
      childUids: ["regular1", "pinned2", "regular2", "pinned1"],
      pinnedUids: ["pinned1", "pinned2", "missing"],
    }),
  ).toEqual(["pinned1", "pinned2", "regular1", "regular2"]);
});

test("ordersMatch compares ordered uid arrays", () => {
  expect(ordersMatch(["a", "b"], ["a", "b"])).toBe(true);
  expect(ordersMatch(["a", "b"], ["b", "a"])).toBe(false);
  expect(ordersMatch(["a"], ["a", "b"])).toBe(false);
});

test("shouldRemovePinnedIndicator removes stale or unpinned markers", () => {
  const pinnedUids = new Set(["pinned123", "pinned456"]);

  expect(
    shouldRemovePinnedIndicator({
      pinnedUids,
      renderedUid: "pinned123",
      storedUid: "pinned123",
    }),
  ).toBe(false);
  expect(
    shouldRemovePinnedIndicator({
      pinnedUids,
      renderedUid: "pinned456",
      storedUid: "pinned123",
    }),
  ).toBe(true);
  expect(
    shouldRemovePinnedIndicator({
      pinnedUids,
      renderedUid: "regular01",
      storedUid: "regular01",
    }),
  ).toBe(true);
  expect(
    shouldRemovePinnedIndicator({
      pinnedUids,
      renderedUid: null,
      storedUid: "pinned123",
    }),
  ).toBe(true);
});

test("reconcilePinsForParent keeps direct child pins unchanged", () => {
  const settings = {
    parent123: ["block1234", "block5678"],
    parent456: ["block9999"],
  };
  const result = reconcilePinsForParent({
    settings,
    parentUid: "parent123",
    directChildUids: ["block1234", "block5678", "regular01"],
    getParentUidByBlockUid: () => {
      throw new Error("Direct child pins should not need parent lookups");
    },
  });

  expect(result).toEqual({
    settings,
    changed: false,
    affectedParentUids: [],
    removedUids: [],
  });
});

test("reconcilePinsForParent follows same-parent visual pin order", () => {
  expect(
    reconcilePinsForParent({
      settings: {
        parent123: ["block1234", "block5678"],
      },
      parentUid: "parent123",
      directChildUids: ["block5678", "block1234", "regular01"],
      getParentUidByBlockUid: () => {
        throw new Error("Direct child pins should not need parent lookups");
      },
    }),
  ).toEqual({
    settings: {
      parent123: ["block5678", "block1234"],
    },
    changed: true,
    affectedParentUids: [],
    removedUids: [],
  });
});

test("regular blocks dragged between pins stay unpinned", () => {
  const settings = {
    parent123: ["block1234", "block5678"],
  };
  const result = reconcilePinsForParent({
    settings,
    parentUid: "parent123",
    directChildUids: ["block1234", "regular01", "block5678"],
    getParentUidByBlockUid: () => {
      throw new Error("Direct child pins should not need parent lookups");
    },
  });

  expect(result).toEqual({
    settings,
    changed: false,
    affectedParentUids: [],
    removedUids: [],
  });
  expect(
    getDesiredChildOrder({
      childUids: ["block1234", "regular01", "block5678"],
      pinnedUids: result.settings.parent123,
    }),
  ).toEqual(["block1234", "block5678", "regular01"]);
});

test("reconcilePinsForParent moves pins to their live parent", () => {
  expect(
    reconcilePinsForParent({
      settings: {
        parent123: ["block1234", "block5678"],
        parent456: ["block9999"],
      },
      parentUid: "parent123",
      directChildUids: ["block5678", "regular01"],
      getParentUidByBlockUid: (uid) =>
        uid === "block1234" ? "parent456" : "parent123",
    }),
  ).toEqual({
    settings: {
      parent123: ["block5678"],
      parent456: ["block9999", "block1234"],
    },
    changed: true,
    affectedParentUids: ["parent456"],
    removedUids: [],
  });
});

test("reconcilePinsForParent migrates incoming pinned children at their visual position", () => {
  expect(
    reconcilePinsForParent({
      settings: {
        parent123: ["block1234"],
        parent456: ["block5678", "block9999"],
      },
      parentUid: "parent456",
      directChildUids: ["block5678", "block1234", "regular01", "block9999"],
      getParentUidByBlockUid: () => {
        throw new Error("Direct child pins should not need parent lookups");
      },
    }),
  ).toEqual({
    settings: {
      parent456: ["block5678", "block1234", "block9999"],
    },
    changed: true,
    affectedParentUids: ["parent123"],
    removedUids: [],
  });
});

test("reconcilePinsForParent appends moved pins once per target parent", () => {
  expect(
    reconcilePinsForParent({
      settings: {
        parent123: ["block1234", "block5678"],
        parent456: ["block9999"],
      },
      parentUid: "parent123",
      directChildUids: [],
      getParentUidByBlockUid: () => "parent456",
    }),
  ).toEqual({
    settings: {
      parent456: ["block9999", "block1234", "block5678"],
    },
    changed: true,
    affectedParentUids: ["parent456"],
    removedUids: [],
  });
});

test("reconcilePinsForParent removes stale pins with no live parent", () => {
  expect(
    reconcilePinsForParent({
      settings: {
        parent123: ["block1234", "block5678"],
        parent456: ["block9999"],
      },
      parentUid: "parent123",
      directChildUids: ["block5678", "regular01"],
      getParentUidByBlockUid: () => "",
    }),
  ).toEqual({
    settings: {
      parent123: ["block5678"],
      parent456: ["block9999"],
    },
    changed: true,
    affectedParentUids: [],
    removedUids: ["block1234"],
  });
});

test("reconcilePinsForParent preserves pins still owned by the same parent", () => {
  const settings = {
    parent123: ["block1234", "block5678"],
  };
  expect(
    reconcilePinsForParent({
      settings,
      parentUid: "parent123",
      directChildUids: ["block5678"],
      getParentUidByBlockUid: () => "parent123",
    }),
  ).toEqual({
    settings,
    changed: false,
    affectedParentUids: [],
    removedUids: [],
  });
});
