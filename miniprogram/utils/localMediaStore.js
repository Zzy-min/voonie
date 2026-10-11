// Only registered, server-backed image copies may be evicted automatically.
const DEFAULT_BUDGET = 60 * 1024 * 1024;
function createLocalMediaStore(storage) {
  const key = (scope) => `voling_media_index_v1:${encodeURIComponent(scope)}`;
  const safePath = (path) => typeof path === "string" && path.startsWith(`${storage.env.USER_DATA_PATH}/media-`) && !path.includes("/../");
  function read(scope) {
    try {
      const value = storage.getStorageSync(key(scope));
      if (!value || typeof value !== "object" || Array.isArray(value)) return {};
      return Object.fromEntries(Object.entries(JSON.parse(JSON.stringify(value))).filter(([url, item]) =>
        item && item.url === url && safePath(item.path) && Number.isFinite(item.bytes) && item.bytes > 0));
    } catch { return {}; }
  }
  function write(scope, index) { try { storage.setStorageSync(key(scope), index); return true; } catch { return false; } }
  function bytes(path) {
    try { return Number(storage.getFileSystemManager().statSync(path).size) || 0; } catch { return 0; }
  }
  return {
    entries(scope) { return Object.values(read(scope)); },
    has(scope, url) {
      const item = read(scope)[url];
      return Boolean(item && item.verified && safePath(item.path) && bytes(item.path) === item.bytes && item.bytes > 0);
    },
    register(scope, url, path, size, pinned = false) {
      if (!scope || !safePath(path)) return false;
      const measured = bytes(path) || size;
      if (!Number.isFinite(measured) || measured <= 0) return false;
      const index = read(scope), previous = index[url];
      index[url] = { url, path, bytes: measured, lastUsed: Date.now(), pinned: pinned || Boolean(previous && previous.pinned), verified: true };
      return write(scope, index);
    },
    touch(scope, url) {
      const index = read(scope); if (index[url]) { index[url].lastUsed = Date.now(); write(scope, index); }
    },
    pin(scope, urls, enabled) {
      const index = read(scope); for (const url of urls) if (index[url]) index[url].pinned = enabled;
      return write(scope, index);
    },
    trim(scope, budget = DEFAULT_BUDGET, keep = []) {
      const index = read(scope), protectedPaths = new Set(keep);
      const fixed = Object.values(index).filter((item) => item.pinned).reduce((sum, item) => sum + item.bytes, 0);
      let total = Object.values(index).filter((item) => !item.pinned).reduce((sum, item) => sum + item.bytes, 0), removed = 0;
      const candidates = Object.entries(index).filter(([, item]) => item.verified && !item.pinned && !protectedPaths.has(item.path)).sort((a, b) => a[1].lastUsed - b[1].lastUsed);
      for (const [url, item] of candidates) {
        if (total <= budget) break;
        if (!safePath(item.path)) continue;
        try {
          storage.getFileSystemManager().unlinkSync(item.path);
          total -= item.bytes; removed += item.bytes; delete index[url];
        } catch { /* Do not claim space was released if deletion failed. */ }
      }
      write(scope, index); return { removed, remaining: total + fixed };
    },
    scan() {
      const result = { total: 0, images: 0, recordings: 0, references: 0, metadata: 0, other: 0 };
      try {
        const fs = storage.getFileSystemManager();
        for (const name of fs.readdirSync(storage.env.USER_DATA_PATH)) {
          const size = bytes(`${storage.env.USER_DATA_PATH}/${name}`);
          result.total += size;
          if (name.startsWith("media-")) result.images += size;
          else if (/^(voice-|local-book)/.test(name)) result.recordings += size;
          else if (name.startsWith("reference-")) result.references += size;
          else if (/^(diaries-|draft-)/.test(name)) result.metadata += size;
          else result.other += size;
        }
      } catch {}
      return result;
    },
  };
}
module.exports = { createLocalMediaStore, DEFAULT_BUDGET };
