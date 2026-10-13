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
