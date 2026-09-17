import { ApiError, getDiaryDetail, updateDiary } from "../../utils/api";
import { getNavInfo } from "../../utils/nav";

let draftTimer: number | null = null;

Page({
  saveCommitted: false,

  data: {
    statusBarHeight: 20, navBarHeight: 44, navRightPadding: 96,
    diaryId: "", title: "", content: "", editVersion: 0,
    initialTitle: "", initialContent: "", loading: true, saving: false, draftSaved: false,
  },

  async onLoad(options: Record<string, string | undefined>) {
    const nav = getNavInfo();
    const diaryId = options.id || "";
    this.setData({ ...nav, diaryId });
    if (!diaryId) { wx.showToast({ title: "日记不存在", icon: "none" }); return; }
    try {
      const diary = await getDiaryDetail(diaryId);
      const server = { title: diary.title || "", content: diary.full_content || "", editVersion: diary.edit_version || 0 };
      const draft = wx.getStorageSync(this.draftKey()) || null;
      const useDraft = draft && draft.version === server.editVersion;
      this.setData({ ...server, title: useDraft ? draft.title : server.title,
        content: useDraft ? draft.content : server.content, initialTitle: server.title,
        initialContent: server.content, loading: false, draftSaved: Boolean(useDraft) });
    } catch (error) {
      this.setData({ loading: false });
      wx.showToast({ title: "日记加载失败，请返回重试", icon: "none" });
    }
  },

  draftKey() {
    const app = getApp();
    const userId = app?.globalData?.currentUser?.id || "current-session";
    return `voonie_diary_edit_draft:${userId}:${this.data.diaryId}`;
  },

  onTitleInput(e: WechatMiniprogram.Input) { this.setData({ title: e.detail.value }); this.queueDraft(); },
  onContentInput(e: WechatMiniprogram.Input) { this.setData({ content: e.detail.value }); this.queueDraft(); },
  queueDraft() {
    if (draftTimer !== null) clearTimeout(draftTimer);
    draftTimer = setTimeout(() => { this.persistDraft(); draftTimer = null; }, 300) as unknown as number;
  },
  persistDraft() {
    if (this.saveCommitted || !this.data.diaryId || this.data.loading) return;
    wx.setStorageSync(this.draftKey(), { title: this.data.title, content: this.data.content,
      version: this.data.editVersion, savedAt: Date.now() });
    this.setData({ draftSaved: true });
  },
  onHide() { this.persistDraft(); },
  onUnload() { if (!this.data.saving) this.persistDraft(); },

  onCancel() {
    const changed = this.data.title !== this.data.initialTitle || this.data.content !== this.data.initialContent;
    if (!changed) { wx.navigateBack(); return; }
    wx.showModal({ title: "保留这次修改？", content: "未保存内容已暂存在本机，下次打开可以继续。",
      confirmText: "保留草稿", cancelText: "放弃修改", success: (res) => {
        if (!res.confirm) {
          this.saveCommitted = true;
          if (draftTimer !== null) {
            clearTimeout(draftTimer);
            draftTimer = null;
          }
          wx.removeStorageSync(this.draftKey());
        }
        wx.navigateBack();
      } });
  },

  async onSave() {
    if (this.data.saving) return;
    const title = this.data.title.trim(); const content = this.data.content.trim();
    if (!title) { wx.showToast({ title: "标题不能为空", icon: "none" }); return; }
    if (!content) { wx.showToast({ title: "正文不能为空", icon: "none" }); return; }
    this.persistDraft(); this.setData({ saving: true });
    try {
      const saved = await updateDiary(this.data.diaryId, { title, content, expected_version: this.data.editVersion });
      this.saveCommitted = true;
      if (draftTimer !== null) {
        clearTimeout(draftTimer);
        draftTimer = null;
      }
      wx.removeStorageSync(this.draftKey());
      this.setData({ saving: false, draftSaved: false, editVersion: saved.edit_version || this.data.editVersion + 1 });
      wx.showToast({ title: "日记已保存", icon: "success" });
      setTimeout(() => wx.navigateBack(), 500);
    } catch (error) {
      this.setData({ saving: false });
      if (error instanceof ApiError && error.status === 409) {
        wx.showModal({ title: "发现更新冲突", content: "这篇日记已在其他设备修改。你的草稿仍保存在本机，请返回重新打开后再合并。", showCancel: false });
      } else {
        wx.showToast({ title: "保存失败，草稿仍在本机", icon: "none" });
      }
    }
  },
});
