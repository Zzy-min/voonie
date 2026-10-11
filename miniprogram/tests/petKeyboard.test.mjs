import assert from "node:assert/strict";
import test from "node:test";
import { loadMiniProgram } from "./helpers/loadMiniProgram.mjs";

test("keyboard resizes the chat viewport and scrolls after layout, including repeated changes", () => {
  const ticks = [];
  const hidden = [];
  const page = loadMiniProgram("pages/pet/index.ts", {
    wx: { nextTick: (callback) => ticks.push(callback) },
    api: { getSessionScope: () => "test", chatWithPet: async () => ({}) },
  });
  const setData = page.setData.bind(page);
  page.setData = (values, callback) => { setData(values); callback?.(); };
  page.getTabBar = () => ({ setHidden: (value) => hidden.push(value) });
  page.applyKeyboardHeight(320);
  assert.equal(page.data.viewportStyle, "height:calc(100vh - 320px);padding-bottom:0;");
  assert.equal(page.data.composerStyle, "bottom:320px;");
  assert.equal(page.data.scrollEndId, "");
  ticks.shift()();
  assert.equal(page.data.scrollEndId, "chat-bottom");
  page.applyKeyboardHeight(360);
  assert.equal(page.data.scrollEndId, "");
  ticks.shift()();
  assert.equal(page.data.scrollEndId, "chat-bottom");
  page.applyKeyboardHeight(0);
  ticks.shift()();
  assert.equal(page.data.viewportStyle, "");
  assert.equal(page.data.composerStyle, "");
  assert.deepEqual(hidden, [true, true, false]);
  page.applyKeyboardHeight(320);
  ticks.shift()();
  page.onHide();
  assert.equal(page.data.viewportStyle, "");
  assert.equal(page.data.keyboardHeight, 0);
});
