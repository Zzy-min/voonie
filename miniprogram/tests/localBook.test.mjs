import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

let pageDefinition;
let callbacks;
let stored = {};
let savedFile;
let playedPath;
const wx = {
  getStorageSync: (key) => stored[key],
  setStorageSync: (key, value) => { stored[key] = value; },
  saveFile: ({ tempFilePath, success }) => {
    assert.equal(tempFilePath, "temp.aac");
    savedFile = "saved.aac";
    success({ savedFilePath: savedFile });
  },
  createInnerAudioContext: () => ({
    set src(value) { playedPath = value; },
    play() {},
    destroy() {},
    onEnded() {},
    onError() {},
  }),
};
const recorderInstance = {
  setCallbacks: (value) => { callbacks = value; },
  start: async () => callbacks.onStart(),
  stop: () => callbacks.onStop({ tempFilePath: "temp.aac", duration: 4200 }),
};
vm.runInNewContext(readFileSync(new URL("../pages/local-book/index.js", import.meta.url), "utf8"), {
  Page: (value) => { pageDefinition = value; },
  require: () => ({ recorderInstance }),
  wx,
  console,
  Date,
});
const page = {
  ...pageDefinition,
  data: { ...pageDefinition.data },
  setData(value) { Object.assign(this.data, value); },
};
page.onLoad();
await page.toggleRecording();
assert.equal(page.data.recording, true);
await page.toggleRecording();
assert.equal(page.data.recording, false);
assert.equal(page.data.books.length, 1);
assert.equal(page.data.books[0].audioPath, savedFile);
assert.equal(page.data.books[0].duration, 4);
page.playBook({ currentTarget: { dataset: { id: page.data.books[0].id } } });
assert.equal(playedPath, savedFile);
assert.equal(page.data.playingId, page.data.books[0].id);
console.log("local book save and playback passed");
