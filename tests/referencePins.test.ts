import { expect, test } from "@playwright/test";
import {
  getReferencePinKey,
  getReferenceTargetUid,
} from "../src/utils/referencePins";

test("linked references resolve their own target rather than the source block", () => {
  expect(
    getReferenceTargetUid("block-input-user-mentions-page-target123-block1234"),
  ).toBe("target123");
  expect(
    getReferenceTargetUid(
      "block-input-user-mentions-block-target456-block1234",
    ),
  ).toBe("target456");
  expect(
    getReferenceTargetUid("block-input-user-target123-block1234"),
  ).toBeNull();
});

test("the same reference has independent pins on different target pages", () => {
  expect(
    getReferencePinKey({ targetUid: "target123", blockUid: "block1234" }),
  ).not.toBe(
    getReferencePinKey({ targetUid: "target456", blockUid: "block1234" }),
  );
});

test("daily note target uids are parsed in full", () => {
  expect(
    getReferenceTargetUid(
      "block-input-user-mentions-page-10-12-2026-block1234",
    ),
  ).toBe("10-12-2026");
});
