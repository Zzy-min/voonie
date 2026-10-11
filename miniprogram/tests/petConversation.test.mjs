import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { createConversationStore } = require("../utils/petConversation.js");
const { normalizeReferences, paragraphAnchor } = require("../utils/referenceDraft.js");
const { createPool } = require("../utils/asyncPool.js");

function fakeStorage() {
  const data = new Map();
  return { getStorageSync: (key) => data.get(key), setStorageSync: (key, value) => data.set(key, structuredClone(value)) };
}
test("two views share recent turns, saved across reopening and isolated by account", async () => {
  const wx = fakeStorage(); let scope = "a", history;
  const sender = async (_text, opts) => { history = opts.history; return { reply: "我记住了" }; };
  const store = createConversationStore(wx, () => scope, sender);
  const views = [];
  store.subscribe((state) => views[0] = state); store.subscribe((state) => views[1] = state);
  await store.send("我今天去公园了"); await store.send("那里有好多花");
  assert.equal(history.length, 2); assert.deepEqual(views[0], views[1]);
  const reopened = createConversationStore(wx, () => scope, sender);
  assert.equal(reopened.sync().messages.length, 4);
  scope = "b"; assert.equal(store.sync().messages.length, 0);
  scope = "a"; assert.equal(store.sync().messages.length, 4);
  store.clear(); assert.equal(store.sync().messages.length, 0);
});
test("failed and interrupted messages are excluded; retry reuses the user message", async () => {
  const wx = fakeStorage(); let fail = true, history;
  const store = createConversationStore(wx, () => "a", async (_text, opts) => {
    history = opts.history; if (fail) throw new Error("moderation unavailable"); return { reply: "听到了" };
  });
  await store.send("一条消息");
  const message = store.sync().messages[0]; assert.equal(message.status, "failed");
  fail = false; await store.send("", {}, message.id);
  assert.equal(history.length, 0); assert.equal(store.sync().messages.length, 2);
});
test("logout or clearing while in flight discards delayed responses", async () => {
  const wx = fakeStorage(); let scope = "a", release;
  const store = createConversationStore(wx, () => scope, () => new Promise((resolve) => release = resolve));
  const pending = store.send("私密消息"); scope = ""; store.sync();
  release({ reply: "旧账号内容" }); await pending;
  assert.equal(store.sync().messages.length, 0);
});
test("conversation saves only 40 messages and sends 20 successful messages", async () => {
  let maxHistory = 0;
  const store = createConversationStore(fakeStorage(), () => "a", async (_text, opts) => { maxHistory = Math.max(maxHistory, opts.history.length); return { reply: "回复" }; });
  for (let i = 0; i < 30; i++) await store.send(`消息${i}`);
  assert.equal(store.sync().messages.length, 40); assert.equal(maxHistory, 20);
});
test("legacy image drafts and per-photo options survive normalization", () => {
  const refs = normalizeReferences({ referencePath: "/saved/a.jpg", referenceId: "a", referenceIncludeInContent: false });
  assert.equal(refs.length, 1); assert.equal(refs[0].includeInContent, false); assert.equal(refs[0].id, "a");
  assert.deepEqual([0,1,2].map((index) => paragraphAnchor("第一段\n\n第二段\n\n第三段", index, 3)), ["第一段", "第二段", "第三段"]);
});
test("bounded image/upload pools enforce concurrency without swallowing failures", async () => {
  const pool = createPool(2); let active = 0, max = 0;
  const tasks = Array.from({ length: 6 }, (_, index) => pool(async () => {
    active++; max = Math.max(max, active); await new Promise((resolve) => setTimeout(resolve, 2)); active--;
    if (index === 2) throw new Error("failed image"); return index;
  }));
  const results = await Promise.allSettled(tasks);
  assert.equal(max, 2); assert.equal(results.filter((result) => result.status === "fulfilled").length, 5);
});

test("retrying an older failure uses earlier history and inserts its reply next to the user", async () => {
 let failed=true, sentHistory; const store=createConversationStore(fakeStorage(),()=>"a",async(text,options)=>{sentHistory=options.history;if(text==="first"&&failed)throw Error("offline");return {reply:text+" reply"};});
 await store.send("first");const id=store.sync().messages[0].id;await store.send("later");failed=false;await store.send("",{},id);
 assert.equal(sentHistory.length,0); assert.deepEqual(store.sync().messages.map(x=>x.content),["first","first reply","later","later reply"]);
});
