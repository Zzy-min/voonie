// pages/index/index.ts
import { getNavInfo } from "../../utils/nav";
import { getSessionScope, thumbnailUrl, authenticatedMediaUrl, diaryDraftKey, DiaryItem, getAccessToken, listDiaries, localTimezone } from "../../utils/api";
import { diaryDateKey } from "../../utils/diaryDate";
import { readDiaryDraft, writeDiaryDraft } from "../../utils/draftStorage";
import { enableHomeShareMenu, homeShareHandlers } from "../../utils/homeShare";
import { subscribeDiaryUpdates, diarySyncLabel } from "../../utils/api";

Page({
  ...homeShareHandlers,
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    navRightPadding: 96,
    currentDateStr: "",
    chatVisible: false,
    showHeart: false,
    hasDraft: false,
    inputText: "",
    diaryLoading: true,
    diaryFailed: false,
    todayDiary: null as (DiaryItem & { cover?: string }) | null,
    recentDiary: null as (DiaryItem & { cover?: string }) | null,
    syncNote: "",
  },

  onLoad() {
    this.stopDiaryUpdates = subscribeDiaryUpdates(() => { this.setData({ syncNote: diarySyncLabel() }); this.loadHomeDiaries(); });
    enableHomeShareMenu();
    // 隐藏可能残留的全局/前置页遮挡 Toast，保持场景纯净
    if (typeof wx.hideToast === "function") {
      try { wx.hideToast(); } catch (_) {}
    }
    const nav = getNavInfo();
    this.setData({
      statusBarHeight: nav.statusBarHeight,
      navBarHeight: nav.navBarHeight,
      navRightPadding: nav.navRightPadding,
    });
    this.updateDateDisplay();
  },

  onShow() {
    this.updateDateDisplay();
    // 静默清除前置页面或调试工具偶发的遮罩 Toast
    if (typeof wx.hideToast === "function") {
      try { wx.hideToast(); } catch (_) {}
    }
    // 每次进入首页更新全局 activeTab 与 TabBar 选中状态（首页 = 0）
    const app = getApp();
    if (app && app.globalData) {
      app.globalData.activeTab = 0;
    }
    const tab = typeof this.getTabBar === "function" ? this.getTabBar() : null;
    if (tab && typeof tab.setSelected === "function") {
      tab.setSelected(0);
    }
    // 检查本地是否有草稿
    const draft = wx.getStorageSync(diaryDraftKey());
    this.setData({
      hasDraft: Boolean(draft && (draft.text || draft.audioPath)),
    });
    this.loadHomeDiaries();
  },

  homeLoading: false,
  homeScope: "",
  homeRevision: 0,
  onHide() { this.closeChat(); },
  stopDiaryUpdates: null as null | (() => void),
  onUnload() { this.homeRevision += 1; this.stopDiaryUpdates?.(); },

  async loadHomeDiaries() {
    const scope = getSessionScope();
    if (this.homeLoading && this.homeScope === scope) return;
    const version = ++this.homeRevision;
    if (this.homeScope !== scope) this.setData({ todayDiary: null, recentDiary: null });
    this.homeScope = scope;
    this.homeLoading = true;
    const started = Date.now();
    if (!getAccessToken()) {
      this.setData({
        diaryLoading: false,
        diaryFailed: false,
        todayDiary: null,
        recentDiary: null,
      });
      this.homeLoading = false;
      return;
    }
    this.setData({ diaryLoading: true, diaryFailed: false });
    try {
      const diaries = await listDiaries();
      const safe = Array.isArray(diaries) ? diaries : [];
      const now = new Date();
      const timeZone = localTimezone();
      const todayKey = diaryDateKey(now.toISOString(), timeZone);
      const dateKey = (item: DiaryItem) => diaryDateKey(item.entry_date || item.created_at || "", timeZone);
      const today = safe.find((item) => dateKey(item) === todayKey) || null;
      const recent = safe.find((item) => !today || item.id !== today.id) || null;
      if (version !== this.homeRevision || scope !== getSessionScope()) return;
      this.setData({ todayDiary: today ? { ...today, cover: "" } : null, recentDiary: recent ? { ...recent, cover: "" } : null, diaryLoading: false, syncNote: diarySyncLabel() });
      console.info("voling.performance", { stage: "home_text", ms: Date.now() - started });
      [ { field: "todayDiary", item: today }, { field: "recentDiary", item: recent } ].forEach(async ({ field, item }) => {
        if (!item?.panels?.[0]?.image_url) return;
        try {
          const cover = await authenticatedMediaUrl(thumbnailUrl(item.panels[0].image_url));
          if (version === this.homeRevision && scope === getSessionScope()) this.setData({ [`${field}.cover`]: cover });
        } catch { /* Text remains usable if a cover fails. */ }
      });
    } catch (error) {
      console.warn("Load home diaries failed:", error);
      if (version === this.homeRevision && scope === getSessionScope()) this.setData({ diaryLoading: false, diaryFailed: true });
    } finally {
      if (version === this.homeRevision) this.homeLoading = false;
    }
  },

  updateDateDisplay() {
    const now = new Date();
    const month = now.getMonth() + 1;
    const date = now.getDate();
    const days = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
    const dayStr = days[now.getDay()];
    this.setData({
      currentDateStr: `${month}月${date}日 · ${dayStr}`,
    });
  },

  onDogTap() {
    this.openChat();
    this.setData({ showHeart: true });
    setTimeout(() => {
      this.setData({ showHeart: false });
    }, 1200);
  },

  openChat() {
    const tab = typeof this.getTabBar === "function" ? this.getTabBar() : null;
    if (tab && typeof tab.setHidden === "function") tab.setHidden(true);
    this.setData({ chatVisible: true });
  },

  closeChat() {
    const tab = typeof this.getTabBar === "function" ? this.getTabBar() : null;
    if (tab && typeof tab.setHidden === "function") tab.setHidden(false);
    this.setData({ chatVisible: false });
  },

  onNotifyClick() {
    wx.showToast({
      title: "暂无新消息",
      icon: "none",
    });
  },

  onStartRecord() {
    wx.navigateTo({
      url: "/pages/record/index",
    });
  },

  onGoPet() {
    wx.switchTab({
      url: "/pages/pet/index",
    });
  },

  onGoBookshelf() {
    wx.navigateTo({
      url: "/pages/bookshelf/index",
    });
  },

  onInput(e: WechatMiniprogram.Input) {
    this.inputText = e.detail.value;
  },

  onMicTap() {
    this.onStartRecord();
  },

  onInputSend() {
    const text = (this.inputText || "").trim();
    if (!text) {
      this.onStartRecord();
      return;
    }
    const key = diaryDraftKey();
    const draft = readDiaryDraft(key);
    if (!writeDiaryDraft(key, { ...draft, text, status: "text-draft", updatedAt: Date.now() })) {
      wx.showToast({ title: "草稿保存失败，请重试", icon: "none" });
      return;
    }
    wx.navigateTo({ url: "/pages/record/index" });
    this.inputText = "";
  },

  onResumeDraft() {
    wx.navigateTo({
      url: "/pages/record/index",
    });
  },

  onOpenDiary(e: WechatMiniprogram.BaseEvent) {
    const id = e.currentTarget.dataset.id;
    if (id) wx.navigateTo({ url: `/pages/diary/index?id=${id}` });
  },

  onOpenMemories() {
    wx.navigateTo({ url: "/pages/calendar/index" });
  },
});
