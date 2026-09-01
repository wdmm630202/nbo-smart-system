import assert from "node:assert/strict";
import test from "node:test";

import { fixtureStyleCatalog } from "./helpers/portfolio-style-fixtures.mjs";

const explorerModelUrl = new URL("../apps/portfolio-v2/style-explorer-model.js", import.meta.url).href;

async function loadExplorerModel(loadModule = () => import(explorerModelUrl)) {
  try {
    return await loadModule();
  } catch (error) {
    if (error?.code !== "ERR_MODULE_NOT_FOUND" || error.url !== explorerModelUrl) throw error;
    // Keep the first RED run a contract assertion, not an uncaught module-load error.
    return {
      createExplorerState: () => ({}),
      reduceExplorer: () => ({}),
      serializeExplorerLocation: () => new URLSearchParams(),
    };
  }
}

const explorer = await loadExplorerModel();

function libraryFixture() {
  return fixtureStyleCatalog();
}

test("explorer bootstrap classifies only its own missing model as a fallback", async (t) => {
  const cases = [
    {
      name: "uses fallback for its own missing model",
      error: Object.assign(new Error("missing explorer model"), {
        code: "ERR_MODULE_NOT_FOUND",
        url: explorerModelUrl,
      }),
      fallback: true,
    },
    {
      name: "rethrows a missing dependency with the same error object",
      error: Object.assign(new Error("missing dependency"), {
        code: "ERR_MODULE_NOT_FOUND",
        url: new URL("./missing-style-explorer-dependency.js", import.meta.url).href,
      }),
    },
    { name: "rethrows a syntax error with the same error object", error: new SyntaxError("invalid module syntax") },
    { name: "rethrows a top-level runtime error with the same error object", error: new Error("module initialization failed") },
  ];

  for (const entry of cases) {
    await t.test(entry.name, async () => {
      if (entry.fallback) {
        const fallback = await loadExplorerModel(async () => { throw entry.error; });
        assert.deepEqual(fallback.createExplorerState(), {});
        assert.deepEqual(fallback.reduceExplorer(), {});
        assert.equal(fallback.serializeExplorerLocation().toString(), "");
        return;
      }
      await assert.rejects(
        () => loadExplorerModel(async () => { throw entry.error; }),
        (error) => error === entry.error,
      );
    });
  }
});

test("explorer narrows 132 styles to one eleven-style family and restores return state", () => {
  const library = libraryFixture();
  const state = explorer.createExplorerState(library, {});
  const outdoor = explorer.reduceExplorer(state, { type: "scene", scene: "outdoor" }, library);
  const family = explorer.reduceExplorer(outdoor, { type: "family", familyId: "OUT-02" }, library);
  const album = explorer.reduceExplorer(family, { type: "open-style", styleId: "ST-OUT-02-03", scrollY: 812 }, library);
  const viewer = explorer.reduceExplorer(album, { type: "open-pose", poseIndex: 4 }, library);
  const back = explorer.reduceExplorer(viewer, { type: "back" }, library);

  assert.deepEqual([family.scene, family.familyId, family.view], ["outdoor", "OUT-02", "styles"]);
  assert.deepEqual([album.view, album.returnScrollY], ["album", 812]);
  assert.deepEqual([viewer.view, viewer.poseIndex], ["viewer", 4]);
  assert.equal(back.view, "album");
});

test("explorer restores a coherent style URL and rejects invalid URL values to the indoor default", () => {
  const library = libraryFixture();
  const restored = explorer.createExplorerState(library, new URLSearchParams(
    "scene=outdoor&family=OUT-02&style=ST-OUT-02-03&pose=8",
  ));
  const fallback = explorer.createExplorerState(library, {
    scene: "outdoor",
    family: "OUT-02",
    style: "ST-IN-01-01",
  });

  assert.deepEqual(restored, {
    scene: "outdoor",
    familyId: "OUT-02",
    styleId: "ST-OUT-02-03",
    poseIndex: 0,
    view: "album",
    returnScrollY: 0,
  });
  assert.deepEqual(fallback, {
    scene: "indoor",
    familyId: "IN-01",
    styleId: "",
    poseIndex: 0,
    view: "styles",
    returnScrollY: 0,
  });
});

test("explorer derives missing URL parents from a valid scene, family, or style", () => {
  const library = libraryFixture();

  assert.deepEqual(explorer.createExplorerState(library, { scene: "outdoor" }), {
    scene: "outdoor",
    familyId: "OUT-01",
    styleId: "",
    poseIndex: 0,
    view: "styles",
    returnScrollY: 0,
  });
  assert.deepEqual(explorer.createExplorerState(library, { family: "OUT-02" }), {
    scene: "outdoor",
    familyId: "OUT-02",
    styleId: "",
    poseIndex: 0,
    view: "styles",
    returnScrollY: 0,
  });
  assert.deepEqual(explorer.createExplorerState(library, { style: "ST-OUT-02-03" }), {
    scene: "outdoor",
    familyId: "OUT-02",
    styleId: "ST-OUT-02-03",
    poseIndex: 0,
    view: "album",
    returnScrollY: 0,
  });
});

test("explorer serializes only stable URL fields and keeps pose index session-local", () => {
  const library = libraryFixture();
  const album = explorer.reduceExplorer(
    explorer.createExplorerState(library, {}),
    { type: "open-style", styleId: "ST-IN-01-05", scrollY: 420 },
    library,
  );
  const viewer = explorer.reduceExplorer(album, { type: "open-pose", poseIndex: 7 }, library);
  const location = explorer.serializeExplorerLocation(viewer);

  assert.ok(location instanceof URLSearchParams);
  assert.deepEqual(Object.fromEntries(location), {
    scene: "indoor",
    family: "IN-01",
    style: "ST-IN-01-05",
  });
});

test("explorer bounds pose movement and backs through viewer, album, then styles", () => {
  const library = libraryFixture();
  const state = explorer.reduceExplorer(
    explorer.createExplorerState(library, {}),
    { type: "open-style", styleId: "ST-IN-01-01", scrollY: 260 },
    library,
  );
  const viewer = explorer.reduceExplorer(state, { type: "open-pose", poseIndex: 0 }, library);
  const lastPose = explorer.reduceExplorer(viewer, { type: "move-pose", direction: 20 }, library);
  const firstPose = explorer.reduceExplorer(lastPose, { type: "move-pose", direction: -20 }, library);
  const album = explorer.reduceExplorer(firstPose, { type: "back" }, library);
  const styles = explorer.reduceExplorer(album, { type: "back" }, library);

  assert.deepEqual([lastPose.view, lastPose.poseIndex], ["viewer", 8]);
  assert.deepEqual([firstPose.view, firstPose.poseIndex], ["viewer", 0]);
  assert.deepEqual([album.view, album.poseIndex, album.returnScrollY], ["album", 0, 260]);
  assert.deepEqual([styles.view, styles.styleId, styles.poseIndex, styles.returnScrollY], ["styles", "", 0, 260]);
});
