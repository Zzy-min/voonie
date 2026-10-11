import assert from "node:assert/strict";
import test from "node:test";
import { loadMiniProgram } from "./helpers/loadMiniProgram.mjs";

function setup() {
  const storage = new Map([["voonie_access_token", "token"], ["voling_session_user", "a"]]);
  const files = new Map(), calls = [];
  const wx = {
    env: { USER_DATA_PATH: "/user" },
    getStorageSync: (key) => storage.get(key), setStorageSync: (key, value) => storage.set(key, value), removeStorageSync: (key) => storage.delete(key),
    getSystemInfoSync: () => ({ platform: "devtools" }),
    request: (options) => { calls.push(options); },
    getFileSystemManager: () => ({
      access({ path, success, fail }) { files.has(path) ? success() : fail(new Error("missing")); },
      writeFile({ filePath, data, success }) { files.set(filePath, data); success(); },
    }),
  };
  const api = loadMiniProgram("utils/api.ts", { wx, app: { globalData: {} } });
  return { api, wx, storage, files, calls };
}
const flush = () => new Promise((resolve) => setImmediate(resolve));

test("diary requests coalesce and invalidate after updates", async () => {
  const { api, calls } = setup();
  const first = api.listDiaries(), second = api.listDiaries();
  assert.equal(calls.length, 1);
  calls[0].success({ statusCode: 200, data: [] }); await Promise.all([first, second]);
  await api.listDiaries(); assert.equal(calls.length, 1);
  api.invalidateDiaryCache(); const third = api.listDiaries(); assert.equal(calls.length, 2);
  calls[1].success({ statusCode: 200, data: [] }); await third;
});
test("logout rejects in-flight private responses and account caches are isolated", async () => {
  const { api, calls, storage } = setup();
  const old = api.listDiaries(); api.clearTokens();
  calls[0].success({ statusCode: 200, data: [] });
  await assert.rejects(old, /账号已切换/);
  storage.set("voonie_access_token", "other"); storage.set("voling_session_user", "b");
  const current = api.listDiaries(); assert.equal(calls.length, 2);
  calls[1].success({ statusCode: 200, data: [] }); await current;
});
test("private media is limited to 3 concurrent downloads and reuses saved files", async () => {
  const { api, calls } = setup();
  const pending = Array.from({ length: 5 }, (_, index) => api.authenticatedMediaUrl(`/image-${index}.png`));
  await flush(); assert.equal(calls.length, 3);
  calls.slice(0, 3).forEach((call) => call.success({ statusCode: 200, data: new ArrayBuffer(8) }));
  await flush(); assert.equal(calls.length, 5);
  calls.slice(3).forEach((call) => call.success({ statusCode: 200, data: new ArrayBuffer(8) }));
  await Promise.all(pending); await api.authenticatedMediaUrl("/image-0.png");
  assert.equal(calls.length, 5);
});

test("a delayed retry never replays the previous account request", async () => {
 const {api,calls,storage}=setup(); const promise=api.listDiaries(); const checked=assert.rejects(promise,/账号已切换/);
 calls[0].fail({errMsg:"request:fail timeout"}); api.clearTokens(); storage.set("voling_session_user","b");
 await checked; assert.equal(calls.length,1);
});
