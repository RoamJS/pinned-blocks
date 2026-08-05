import { expect, test } from "@playwright/test";
import { createAsyncLifecycle } from "../src/utils/asyncLifecycle";

test("cleans up initialization that finishes after unload", async () => {
  const lifecycle = createAsyncLifecycle();
  let finishInitialization: ((cleanup: () => void) => void) | undefined;
  let cleanupCount = 0;

  const loadPromise = lifecycle.load({
    initialize: () =>
      new Promise((resolve) => {
        finishInitialization = resolve;
      }),
  });

  lifecycle.unload();
  finishInitialization?.(() => {
    cleanupCount += 1;
  });

  await expect(loadPromise).resolves.toBe(false);
  expect(cleanupCount).toBe(1);
});

test("unload cleans up a completed initialization once", async () => {
  const lifecycle = createAsyncLifecycle();
  let cleanupCount = 0;

  await expect(
    lifecycle.load({
      initialize: async () => () => {
        cleanupCount += 1;
      },
    }),
  ).resolves.toBe(true);

  lifecycle.unload();
  lifecycle.unload();

  expect(cleanupCount).toBe(1);
});

test("replaces the cleanup from an earlier completed load", async () => {
  const lifecycle = createAsyncLifecycle();
  const cleanedLoads: string[] = [];

  await lifecycle.load({
    initialize: async () => () => cleanedLoads.push("first"),
  });
  await lifecycle.load({
    initialize: async () => () => cleanedLoads.push("second"),
  });

  expect(cleanedLoads).toEqual(["first"]);
  lifecycle.unload();
  expect(cleanedLoads).toEqual(["first", "second"]);
});

test("suppresses errors from initialization cancelled by unload", async () => {
  const lifecycle = createAsyncLifecycle();
  let rejectInitialization: ((error: Error) => void) | undefined;

  const loadPromise = lifecycle.load({
    initialize: () =>
      new Promise((_, reject) => {
        rejectInitialization = reject;
      }),
  });

  lifecycle.unload();
  rejectInitialization?.(new Error("late failure"));

  await expect(loadPromise).resolves.toBe(false);
});
