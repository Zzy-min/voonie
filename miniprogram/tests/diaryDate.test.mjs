import assert from "node:assert/strict";
import test from "node:test";
import { loadMiniProgram } from "./helpers/loadMiniProgram.mjs";

test("UTC backend timestamps classify into the phone's local calendar day", () => {
  const { diaryDateKey } = loadMiniProgram("utils/diaryDate.ts");
  assert.equal(diaryDateKey("2026-10-01 18:05:24.814000", "Asia/Shanghai"), "2026-10-02");
  assert.equal(diaryDateKey("2026-12-31T18:05:00Z", "Asia/Shanghai"), "2027-01-01");
  assert.equal(diaryDateKey("2026-10-02T02:05:00+08:00", "Asia/Shanghai"), "2026-10-02");
  assert.equal(diaryDateKey("2026-10-02", "Asia/Shanghai"), "2026-10-02");
  assert.equal(diaryDateKey("invalid", "Asia/Shanghai"), "");
});

test("IANA timezone handles a western day boundary and legacy Intl fallback", () => {
  const { diaryDateKey } = loadMiniProgram("utils/diaryDate.ts");
  assert.equal(diaryDateKey("2026-10-02T02:05:00Z", "America/New_York"), "2026-10-01");
  const legacy = loadMiniProgram("utils/diaryDate.ts", { globals: { Intl: undefined } });
  assert.equal(legacy.diaryDateKey("2026-10-01 18:05:24.814000", "Asia/Shanghai"), "2026-10-02");
});

test("home selects a newly generated diary across the UTC/local midnight boundary", async () => {
  class FixedDate extends Date { constructor(value = "2026-10-01T18:10:00Z") { super(value); } }
  const page = loadMiniProgram("pages/index/index.ts", { globals: { Date: FixedDate }, api: {
    getSessionScope: () => "a", getAccessToken: () => "token", localTimezone: () => "Asia/Shanghai", diarySyncLabel: () => "",
    listDiaries: async () => [{ id: "today", title: "今天", entry_date: "2026-10-01 18:05:24.814000", panels: [] }],
  } });
  await page.loadHomeDiaries();
  assert.equal(page.data.todayDiary.id, "today");
  assert.equal(page.data.diaryLoading, false);
  const hidden = [];
  page.getTabBar = () => ({ setHidden: (value) => hidden.push(value) });
  page.onDogTap(); assert.equal(page.data.chatVisible, true);
  page.onHide(); assert.equal(page.data.chatVisible, false);
  assert.deepEqual(hidden, [true, false]);
});
