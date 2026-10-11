// Server-backed diary copies only. Drafts and unique recordings use their own stores.
function createLocalDiaryStore(storage) {
  const key = (scope) => `voling_local_diaries_v1:${encodeURIComponent(scope)}`;
  const file = (scope) => `${storage.env.USER_DATA_PATH}/diaries-${encodeURIComponent(scope)}.json`;
  const empty = () => ({ schema: 1, savedAt: 0, listed: false, ids: [], items: {}, pins: {} });
  const overrides = new Map();
  function read(scope) {
    if (!scope) return empty();
    if (overrides.has(scope)) return JSON.parse(JSON.stringify(overrides.get(scope)));
    const valid = (value) => value && value.schema === 1 && Array.isArray(value.ids) && value.items && value.pins;
    let disk;
    try {
      const value = JSON.parse(storage.getFileSystemManager().readFileSync(file(scope), "utf8"));
      if (valid(value)) disk = value;
    } catch { /* Storage fallback also allows older clients to retain copies. */ }
    try {
      const value = storage.getStorageSync(key(scope));
      if (valid(value) && (!disk || value.savedAt > disk.savedAt)) return JSON.parse(JSON.stringify(value));
    } catch {}
    return disk || empty();
  }
  function write(scope, value) {
    if (!scope) return false;
    value.savedAt = Math.max(Date.now(), (value.savedAt || 0) + 1);
    try {
      const fs = storage.getFileSystemManager(), target = file(scope);
      fs.writeFileSync(`${target}.tmp`, JSON.stringify(value), "utf8");
      fs.renameSync(`${target}.tmp`, target);
      // A stale fallback must not resurrect removed diaries if the file is later lost.
      try { storage.removeStorageSync(key(scope)); } catch {}
      overrides.delete(scope);
      return true;
    } catch {
      // Readers choose the newest channel, so an older file cannot resurrect a deletion.
      try { storage.setStorageSync(key(scope), value); overrides.delete(scope); return true; }
      catch { overrides.set(scope, JSON.parse(JSON.stringify(value))); return false; }
    }
  }
  return {
    list(scope) { const state = read(scope); return state.listed ? state.ids.map((id) => state.items[id]).filter(Boolean) : null; },
    get(scope, id) { return read(scope).items[id] || null; },
    saveList(scope, diaries) {
      const state = read(scope), items = {};
      for (const diary of diaries) if (diary && diary.id) {
        const previous = state.items[diary.id];
        items[diary.id] = previous && (previous.edit_version || 0) > (diary.edit_version || 0) ? previous : diary;
      }
      state.ids = diaries.filter((item) => item && item.id).map((item) => item.id);
      state.items = items; state.listed = true;
      state.pins = Object.fromEntries(Object.entries(state.pins).filter(([id]) => items[id]));
      return write(scope, state);
    },
    save(scope, diary) {
      if (!diary || !diary.id) return false;
      const state = read(scope), previous = state.items[diary.id];
      if (previous && (previous.edit_version || 0) > (diary.edit_version || 0)) return true;
      state.items[diary.id] = diary;
      return write(scope, state);
    },
    remove(scope, id) {
      const state = read(scope); delete state.items[id]; delete state.pins[id];
      state.ids = state.ids.filter((value) => value !== id); return write(scope, state);
    },
    pin(scope, id, enabled) {
      const state = read(scope);
      if (enabled) state.pins[id] = true; else delete state.pins[id];
      return write(scope, state);
    },
    isPinned(scope, id) { return Boolean(read(scope).pins[id]); },
    snapshot: read,
    clear(scope) {
      if (!scope) return true;
      // Persist an empty snapshot first, including when a full disk prevents replacement.
      const saved = write(scope, { ...empty(), savedAt: read(scope).savedAt });
      if (!saved) return false;
      for (const path of [file(scope), `${file(scope)}.tmp`]) {
        try { storage.getFileSystemManager().unlinkSync(path); } catch {}
      }
      return true;
    },
  };
}
module.exports = { createLocalDiaryStore };
