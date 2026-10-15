import { expect, test } from "@playwright/test";
import {
  matchesReferenceFilters,
  readReferenceDetails,
} from "../src/utils/referenceDetails";

test("reference filters require included tags and exclude removed source pages", () => {
  const titles = ["Source page", "Tag"];
  expect(
    matchesReferenceFilters({ titles, filters: [{ includes: ["Tag"] }] }),
  ).toBe(true);
  expect(
    matchesReferenceFilters({ titles, filters: [{ includes: ["Missing"] }] }),
  ).toBe(false);
  expect(
    matchesReferenceFilters({
      titles,
      filters: [{ removes: ["Source page"] }],
    }),
  ).toBe(false);
  expect(
    matchesReferenceFilters({
      titles,
      filters: [{ includes: ["Tag"] }, { removes: ["Tag"] }],
    }),
  ).toBe(false);
});

test("reference details reject stale pins and retain source and ancestor filter context", () => {
  const targetUid = "target123";
  const blockUid = "block1234";
  const entity = {
    ":block/uid": blockUid,
    ":block/refs": [{ ":block/uid": targetUid, ":node/title": "Target" }],
    ":block/page": { ":node/title": "Source page" },
    ":block/parents": [{ ":block/refs": [{ ":node/title": "Ancestor tag" }] }],
  };
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { roamAlphaAPI: { data: { pull: () => entity } } },
  });
  try {
    expect(readReferenceDetails({ targetUid, blockUid })).toEqual({
      sourceTitle: "Source page",
      titles: ["Target", "Ancestor tag", "Source page"],
    });
    entity[":block/refs"] = [];
    // A reference on an ancestor must not keep an unrelated saved child pin alive.
    entity[":block/parents"] = [
      { ":block/refs": [{ ":block/uid": targetUid, ":node/title": "Target" }] },
    ] as (typeof entity)[":block/parents"];
    expect(readReferenceDetails({ targetUid, blockUid })).toBeNull();
  } finally {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("page-title pins require a direct title reference and expose source identity", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  const entity = {
    ":block/uid": "title1234",
    ":node/title": "Topic [[Target]]",
    ":block/refs": [{ ":block/uid": "target123", ":node/title": "Target" }],
    ":block/children": [{ ":block/refs": [{ ":block/uid": "other1234" }] }],
  };
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { roamAlphaAPI: { data: { pull: () => entity } } },
  });
  try {
    expect(
      readReferenceDetails({ targetUid: "target123", blockUid: "title1234" }),
    ).toEqual({
      sourceTitle: "Topic [[Target]]",
      sourceUid: "title1234",
      isPage: true,
      titles: ["Topic [[Target]]", "Target"],
    });
    expect(
      readReferenceDetails({ targetUid: "other1234", blockUid: "title1234" }),
    ).toBeNull();
    entity[":block/refs"] = [];
    expect(
      readReferenceDetails({ targetUid: "target123", blockUid: "title1234" }),
    ).toBeNull();
  } finally {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("title references use one shallow pull without requesting the page outline", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  const patterns: string[] = [];
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      roamAlphaAPI: {
        data: {
          pull: (pattern: string) => {
            patterns.push(pattern);
            if (pattern.includes(":block/children"))
              throw new Error("Page outline must not be requested");
            return {
              ":block/uid": "title1234",
              ":node/title": "Topic [[Target]]",
              ":block/refs": [
                { ":block/uid": "target123", ":node/title": "Target" },
              ],
            };
          },
        },
      },
    },
  });
  try {
    expect(
      readReferenceDetails({ targetUid: "target123", blockUid: "title1234" })
        ?.isPage,
    ).toBe(true);
    expect(patterns).toHaveLength(1);
    expect(patterns[0]).not.toContain(":block/parents");
  } finally {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("block references retain recursive descendant membership after the shallow identity probe", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  const patterns: string[] = [];
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      roamAlphaAPI: {
        data: {
          pull: (pattern: string) => {
            patterns.push(pattern);
            return pattern.includes(":block/children")
              ? {
                  ":block/uid": "block1234",
                  ":block/page": {
                    ":block/uid": "source123",
                    ":node/title": "Source",
                  },
                  ":block/children": [
                    {
                      ":block/refs": [
                        { ":block/uid": "target123", ":node/title": "Target" },
                      ],
                    },
                  ],
                }
              : { ":block/uid": "block1234" };
          },
        },
      },
    },
  });
  try {
    expect(
      readReferenceDetails({ targetUid: "target123", blockUid: "block1234" }),
    ).toEqual({
      sourceTitle: "Source",
      sourceUid: "source123",
      titles: ["Target", "Source"],
    });
    expect(patterns).toHaveLength(2);
    expect(patterns[0]).not.toContain(":block/children");
    expect(patterns[1]).toContain("{:block/children ...}");
  } finally {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
