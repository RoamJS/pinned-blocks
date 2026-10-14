import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";

const probe = String.raw`
const [kind, failure] = process.argv.slice(1);
const blockUid = kind === "lazy-loading" ? "fixture04" : "fixture03";
const record = (uid, pin, prefix = "") => [{
  ":block/uid": uid,
  ":block/props": pin ? {
    [prefix + "roamjs-pinned-blocks"]: Object.fromEntries(
      Object.entries(pin).map(([key, value]) => [prefix + key, value]),
    ),
  } : { "user-note": "Preserve this" },
}];
const pin = {type:"reference-pin",version:1,"target-uid":"fixture01","block-uid":blockUid};
const records = [
  record("oldpin001", {type:"pin",version:1,"block-uid":"saved1234"}),
  record("notice123", {type:"notice",version:1}),
  record("usernote1", null),
  record("ownref001", pin, "::"),
  record("ownref002", pin, ":"),
  record("otherref1", {...pin,"block-uid":"saved1234"}),
  record("otherref2", {...pin,"target-uid":"another01"}),
  record("invalid01", {...pin,type:"pin"}),
  record("invalid02", {...pin,version:2}),
];
let sequence = 0, createdPages = 0, configQueries = 0;
const deletedRecords = [], deletedPages = [];
globalThis.window = {
  roamAlphaAPI: {
    graph: {name: failure === "wrong-graph" ? "different-graph" : "jarvis-sandbox"},
    util: {generateUID: () => "fixture" + String(++sequence).padStart(2,"0")},
    ui: {mainWindow: {getOpenPageOrBlockUid: () => null, openPage: async () => {}}},
    data: {
      fast: {q: () => {configQueries++; return records;}},
      page: {
        create: async () => {
          createdPages++;
          if (failure === "partial" && createdPages === 2)
            throw new Error("Injected setup failure");
        },
        delete: async ({page}) => deletedPages.push(page.uid),
      },
      block: {
        create: async () => {},
        delete: async ({block}) => deletedRecords.push(block.uid),
      },
    },
  },
};
const page = {
  keyboard: {press: async () => {}},
  exposeFunction: async (name, fn) => window[name] = fn,
  evaluate: async (fn, args) => fn(args),
  locator: () => {throw new Error("Injected UI failure after fixture setup");},
};
const {default: scenario} = await import("./e2e/linked-references-" +
  (kind === "lazy-loading" ? "lazy-loading" : "render-failure") + ".mjs");
let error;
try {await scenario.run({page});} catch (caught) {error = caught.message;}
await scenario.cleanup({page});
console.log(JSON.stringify({error,deletedRecords,deletedPages,configQueries}));
`;

type ProbeResult = {
  error: string;
  deletedRecords: string[];
  deletedPages: string[];
  configQueries: number;
};
const runProbe = (kind: string, failure: string): ProbeResult =>
  JSON.parse(
    execFileSync(
      process.execPath,
      ["--input-type=module", "--eval", probe, kind, failure],
      { cwd: process.cwd(), encoding: "utf8" },
    ),
  ) as ProbeResult;

for (const kind of ["lazy-loading", "renderer-failure"]) {
  test(`${kind} cleanup preserves config when the graph is rejected`, () => {
    const result = runProbe(kind, "wrong-graph");
    expect(result.error).toBe("Restricted to test graph");
    expect(result.deletedRecords).toEqual([]);
    expect(result.deletedPages).toEqual([]);
    expect(result.configQueries).toBe(0);
  });

  test(`${kind} partial setup removes only its owned page`, () => {
    const result = runProbe(kind, "partial");
    expect(result.error).toBe("Injected setup failure");
    expect(result.deletedRecords).toEqual([]);
    expect(result.deletedPages).toEqual(["fixture01"]);
    expect(result.configQueries).toBe(0);
  });

  test(`${kind} completed setup removes only valid owned reference pins`, () => {
    const result = runProbe(kind, "complete");
    expect(result.error).toBe("Injected UI failure after fixture setup");
    expect(result.deletedRecords).toEqual(["ownref001", "ownref002"]);
    expect(result.deletedPages).toHaveLength(kind === "lazy-loading" ? 26 : 2);
    expect(result.configQueries).toBe(1);
  });
}
