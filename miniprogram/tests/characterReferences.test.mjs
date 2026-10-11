import assert from "node:assert/strict";
import test from "node:test";
import { loadMiniProgram } from "./helpers/loadMiniProgram.mjs";

function setup({ confirm = true, fail = false } = {}) {
  let modal;
  const calls = [];
  const page = loadMiniProgram("pages/characters/index.ts", {
    wx: { showModal: (value) => { modal = value; }, showToast() {} },
    api: {
      deleteCharacterReference: async (...args) => {
        calls.push(args);
        if (fail) throw new Error("network failure");
      },
      deleteCharacter: () => assert.fail("Must not delete the character"),
      setActiveCharacterId: () => assert.fail("Must not change the active character"),
    },
  });
  page.setData({ activeId: "character-1", characters: [{
    id: "character-1", name: "小夏", appearance_prompt: "黄色连帽衫", version: 2,
    cover: "first.png", references: [{ id: "ref-1", url: "first.png" }, { id: "ref-2", url: "second.png" }],
  }] });
  return { page, calls, remove: async (referenceId) => {
    page.onDeleteReference({ currentTarget: { dataset: { id: "character-1", referenceId } } });
    await modal.success({ confirm });
  } };
}

test("removing references updates cover and preserves character even after last image", async () => {
  const { page, calls, remove } = setup();
  await remove("ref-1");
  assert.equal(page.data.characters[0].cover, "second.png");
  assert.equal(page.data.characters[0].references.length, 1);
  await remove("ref-2");
  assert.equal(page.data.characters.length, 1);
  assert.equal(page.data.characters[0].cover, "");
  assert.equal(page.data.characters[0].references.length, 0);
  assert.equal(page.data.characters[0].name, "小夏");
  assert.equal(page.data.characters[0].appearance_prompt, "黄色连帽衫");
  assert.equal(page.data.activeId, "character-1");
  assert.deepEqual(calls, [["character-1", "ref-1"], ["character-1", "ref-2"]]);
});

test("cancel leaves references intact without issuing deletion", async () => {
  const { page, calls, remove } = setup({ confirm: false });
  await remove("ref-1");
  assert.equal(calls.length, 0);
  assert.equal(page.data.characters[0].references.length, 2);
});

test("failed deletion keeps images and releases pending state", async () => {
  const { page, remove } = setup({ fail: true });
  await remove("ref-1");
  assert.equal(page.data.characters[0].references.length, 2);
  assert.equal(page.data.characters[0].cover, "first.png");
  assert.equal(page.data.deletingReferenceId, "");
});

test("private reference media loads through authentication and provides avatar and preview paths", async () => {
  const calls = [];
  const page = loadMiniProgram("pages/characters/index.ts", {
    api: {
      getSessionScope: () => "owner",
      listCharacters: async () => [{ id: "one", name: "角色", references: [{id: "a", media_key: "/media/private.png"}] }],
      authenticatedMediaUrl: async (key) => { calls.push(key); return "wxfile://private.png"; },
    },
  });
  await page.loadCharacters();
  assert.deepEqual(calls, ["/media/private.png"]);
  assert.equal(page.data.characters[0].cover, "wxfile://private.png");
  assert.equal(page.data.characters[0].references[0].url, "wxfile://private.png");
  assert.equal(page.data.characters[0].references[0].imageFailed, false);
});

test("image download failure retains the role and supports forced authenticated retry", async () => {
  let retry = false;
  const page = loadMiniProgram("pages/characters/index.ts", {
    wx: { showToast() {} },
    api: {
      getSessionScope: () => "owner",
      listCharacters: async () => [{ id: "one", name: "角色", references: [{id: "a", media_key: "/media/private.png"}] }],
      authenticatedMediaUrl: async (key, force) => {
        if (!force) throw new Error("network");
        retry = true;
        return "wxfile://retried.png";
      },
    },
  });
  await page.loadCharacters();
  assert.equal(page.data.loadError, false);
  assert.equal(page.data.characters[0].references[0].imageFailed, true);
  assert.equal(page.data.characters[0].cover, "");
  await page.onRetryReference({ currentTarget: { dataset: {id: "one", referenceId: "a"} } });
  assert.equal(retry, true);
  assert.equal(page.data.characters[0].cover, "wxfile://retried.png");
  assert.equal(page.data.characters[0].references[0].imageFailed, false);
});
