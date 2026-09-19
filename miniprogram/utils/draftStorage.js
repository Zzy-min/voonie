function backupPath(key) {
  const safeKey = encodeURIComponent(key).replace(/%/g, "_");
  return `${wx.env.USER_DATA_PATH}/draft-${safeKey}.json`;
}

function parseDraft(raw) {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function readDiaryDraft(key) {
  try {
    const primary = wx.getStorageSync(key);
    if (primary && typeof primary === "object" && !Array.isArray(primary)) return primary;
  } catch (error) {
    console.warn("Read diary draft from Storage failed", error);
  }

  try {
    const raw = wx.getFileSystemManager().readFileSync(backupPath(key), "utf8");
    const backup = parseDraft(raw);
    if (backup) {
      try { wx.setStorageSync(key, backup); } catch { /* backup remains authoritative */ }
      return backup;
    }
  } catch {
    /* No valid backup exists. */
  }
  return {};
}

function writeDiaryDraft(key, draft) {
  let fileSaved = false;
  let storageSaved = false;
  try {
    wx.getFileSystemManager().writeFileSync(backupPath(key), JSON.stringify(draft), "utf8");
    fileSaved = true;
  } catch (error) {
    console.warn("Write diary draft backup failed", error);
  }
  try {
    wx.setStorageSync(key, draft);
    storageSaved = true;
  } catch (error) {
    console.warn("Write diary draft to Storage failed", error);
  }
  return fileSaved || storageSaved;
}

function removeDiaryDraft(key) {
  try { wx.removeStorageSync(key); } catch { /* best effort */ }
  try { wx.getFileSystemManager().unlinkSync(backupPath(key)); } catch { /* best effort */ }
}

module.exports = { readDiaryDraft, writeDiaryDraft, removeDiaryDraft };
