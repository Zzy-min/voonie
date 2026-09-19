import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const modulePath = require.resolve("../utils/draftStorage.js");

async function loadWithWx(mockWx) {
  globalThis.wx = mockWx;
  delete require.cache[modulePath];
  return require(modulePath);
}

function fakeWx({ storageRead, storageWriteError, fileRead, fileWriteError } = {}) {
  const files = new Map();
  if (fileRead !== undefined) files.set("seed", fileRead);
  const state = { storage: storageRead, files };
  return {
    state,
    env: { USER_DATA_PATH: "/user" },
    getStorageSync: () => state.storage,
    setStorageSync: (_key, value) => {
      if (storageWriteError) throw storageWriteError;
      state.storage = value;
    },
    removeStorageSync: () => { state.storage = undefined; },
    getFileSystemManager: () => ({
      writeFileSync: (path, value) => {
        if (fileWriteError) throw fileWriteError;
        files.set(path, value);
      },
      readFileSync: (path) => {
        if (files.has(path)) return files.get(path);
        if (files.has("seed")) return files.get("seed");
        throw new Error("ENOENT");
      },
      unlinkSync: (path) => files.delete(path),
    }),
  };
}

test("keeps a file backup when WeChat Storage is full", async () => {
  const wx = fakeWx({ storageWriteError: new Error("storage full") });
  const storage = await loadWithWx(wx);
  assert.equal(storage.writeDiaryDraft("draft:user-a", { text: "3000字原文" }), true);
  wx.state.storage = "{broken";
  assert.deepEqual(storage.readDiaryDraft("draft:user-a"), { text: "3000字原文" });
});

test("uses primary Storage when the backup file cannot be written", async () => {
  const wx = fakeWx({ fileWriteError: new Error("disk full") });
  const storage = await loadWithWx(wx);
  assert.equal(storage.writeDiaryDraft("draft:user-b", { text: "still safe" }), true);
  assert.deepEqual(storage.readDiaryDraft("draft:user-b"), { text: "still safe" });
});

test("reports failure only when both persistence channels fail", async () => {
  const wx = fakeWx({
    storageWriteError: new Error("storage full"),
    fileWriteError: new Error("disk full"),
  });
  const storage = await loadWithWx(wx);
  assert.equal(storage.writeDiaryDraft("draft:user-c", { text: "unsafe" }), false);
});
