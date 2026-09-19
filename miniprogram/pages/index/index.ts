// pages/index/index.ts
import { getNavInfo } from "../../utils/nav";
import { authenticatedMediaUrl, diaryDraftKey, DiaryItem, listDiaries } from "../../utils/api";

Page({
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
  },

  onLoad() {
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

  async loadHomeDiaries() {
    this.setData({ diaryLoading: true, diaryFailed: false });
    try {
      const diaries = await listDiaries();
      const safe = Array.isArray(diaries) ? diaries : [];
      const now = new Date();
      const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      const dateKey = (item: DiaryItem) => {
        const value = item.entry_date || item.created_at || "";
        const direct = value.match(/^(\d{4}-\d{2}-\d{2})/);
        return direct ? direct[1] : "";
      };
      const today = safe.find((item) => dateKey(item) === todayKey) || null;
      const recent = safe.find((item) => !today || item.id !== today.id) || null;
      const withCover = async (item: DiaryItem | null) => {
        if (!item) return null;
        const first = Array.isArray(item.panels) ? item.panels[0] : null;
        const cover = first && first.image_url ? await authenticatedMediaUrl(first.image_url) : "";
        return { ...item, cover };
      };
      this.setData({
        todayDiary: await withCover(today),
        recentDiary: await withCover(recent),
        diaryLoading: false,
      });
    } catch (error) {
      console.warn("Load home diaries failed:", error);
      this.setData({ diaryLoading: false, diaryFailed: true });
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
    this.setData({ showHeart: true });
    setTimeout(() => {
      this.setData({ showHeart: false });
    }, 1200);
  },

  openChat() {
    this.setData({ chatVisible: true });
  },

  closeChat() {
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
    // 把想说的话投递到发布页，快速写下今日心情/愿望
    wx.navigateTo({
      url: `/pages/share/index?text=${encodeURIComponent(text)}`,
    });
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
