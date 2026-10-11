import assert from "node:assert/strict";
import test from "node:test";
import { loadMiniProgram } from "./helpers/loadMiniProgram.mjs";

const diary = { id: "diary-a", title: "一天的生活", full_content: "早上散步。\n\n下午读书。\n\n晚上做饭。", panels: [{ image_url: "/slow.png", anchor_text: "下午读书" }], reference_images: [{ image_url: "/reference.png", include_in_content: true }] };
const flush = () => new Promise((resolve) => setImmediate(resolve));

test("diary text appears before images; one failing image does not hide other content", async () => {
  const pending = new Map();
  const api = { diarySyncLabel: () => "", isDiaryOfflineSaved: () => false, getSessionScope: () => "a", authenticatedMediaUrl: (url) => new Promise((resolve, reject) => pending.set(url, { resolve, reject })) };
  const page = loadMiniProgram("pages/diary/index.ts", { api });
  await page.renderDiary(diary);
  assert.equal(page.data.loading, false); assert.equal(page.data.diary.title, diary.title);
  assert.equal(page.data.contentBlocks.filter((block) => block.type === "text").length, 3);
  pending.get("/slow.png").reject(new Error("slow network"));
  pending.get("/reference.png").resolve("/saved/reference.png"); await flush();
  const images = page.data.contentBlocks.filter((block) => block.type === "image");
  assert.equal(images.filter((block) => block.imageStatus === "failed").length, 1);
  assert.equal(images.filter((block) => block.imageStatus === "ready").length, 1);
  const failed = images.find((block) => block.imageStatus === "failed");
  const retry = page.loadDiaryImage(failed.key);
  pending.get("/slow.png").resolve("/saved/slow.png"); await retry;
  assert.equal(page.data.contentBlocks.find((block) => block.key === failed.key).imageStatus, "ready");
});
test("an older render or account cannot replace current images", async () => {
  let scope = "a", release;
  const page = loadMiniProgram("pages/diary/index.ts", { api: { diarySyncLabel: () => "", isDiaryOfflineSaved: () => false, getSessionScope: () => scope, authenticatedMediaUrl: () => new Promise((resolve) => release = resolve) } });
  await page.renderDiary({ ...diary, reference_images: [] }); scope = "b";
  release("/saved/private-a.png"); await flush();
  assert.equal(page.data.illustrationUrls.length, 0);
});
test("home metadata is visible while both covers are pending", async () => {
  const page = loadMiniProgram("pages/index/index.ts", { wx: {}, api: {
    getSessionScope: () => "a", getAccessToken: () => "token", listDiaries: async () => [diary], thumbnailUrl: (url) => url,
    localTimezone: () => "Asia/Shanghai", diarySyncLabel: () => "",
    authenticatedMediaUrl: () => new Promise(() => {}),
  } });
  await page.loadHomeDiaries();
  assert.equal(page.data.diaryLoading, false); assert.equal(page.data.recentDiary.title, diary.title);
});
test("bookshelf renders titles immediately, independent of covers", async () => {
  const page = loadMiniProgram("pages/bookshelf/index.ts", { api: { getSessionScope: () => "a", thumbnailUrl: (url) => url, authenticatedMediaUrl: () => new Promise(() => {}) } });
  await page.renderBooks([diary]);
  assert.equal(page.data.loading, false); assert.equal(page.data.books[0].title, diary.title);
});
