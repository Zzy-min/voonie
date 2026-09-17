// pages/diary-home/index.ts - 日记 Tab 根页（方案 A：手帐/日记本主页）
// 案例：Tab「日记」对应翻页手帐/日记本，而不是月历。日历降级为子页入口。
import { authenticatedMediaUrl, listDiaries, DiaryItem } from "../../utils/api";
import { getNavInfo } from "../../utils/nav";

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    navRightPadding: 96,
    loading: true,
    failed: false,
    latest: null as (DiaryItem & { cover?: string }) | null,
  },

  onLoad() {
    const nav = getNavInfo();
    this.setData({
      statusBarHeight: nav.statusBarHeight,
      navBarHeight: nav.navBarHeight,
      navRightPadding: nav.navRightPadding,
    });
    this.loadLatest();
  },

  onShow() {
    // 同步全局 activeTab 与 TabBar 选中态（日记 Tab = index 1）
    const app = getApp();
    if (app && app.globalData) {
      app.globalData.activeTab = 1;
    }
    const tab = typeof this.getTabBar === "function" ? this.getTabBar() : null;
    if (tab && typeof tab.setSelected === "function") {
      tab.setSelected(1);
    }
    // 每次回到根页刷新最近一篇，保证「打开手帐」落到最新
    this.loadLatest();
  },

  async loadLatest() {
    try {
      const list = await listDiaries();
      const safeList = Array.isArray(list) ? list : [];
      const latest = safeList.length > 0 ? safeList[0] : null;
      if (latest) {
        let cover = "";
        const panels = Array.isArray(latest.panels) ? latest.panels : [];
        if (panels.length > 0 && panels[0].image_url) {
          cover = await authenticatedMediaUrl(panels[0].image_url);
        }
        this.setData({
          latest: { ...latest, cover },
          loading: false,
          failed: false,
        });
      } else {
        this.setData({ latest: null, loading: false, failed: false });
      }
    } catch (e) {
      console.warn("Load latest diary failed:", e);
      this.setData({ loading: false, failed: true, latest: null });
    }
  },

  onOpenDiary() {
    // 无论是否有最近一篇，均可打开手帐（详情页会自行处理空态）
    wx.navigateTo({ url: "/pages/diary/index?id=latest" });
  },

  onOpenRecord() {
    wx.navigateTo({ url: "/pages/record/index" });
  },

  onOpenCalendar() {
    wx.navigateTo({ url: "/pages/calendar/index" });
  },

  onRetry() {
    this.setData({ loading: true });
    this.loadLatest();
  },
});
