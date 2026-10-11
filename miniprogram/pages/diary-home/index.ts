// pages/diary-home/index.ts - 日记 Tab 根页（方案 A：手帐/日记本主页）
// 案例：Tab「日记」对应翻页手帐/日记本，而不是月历。日历降级为子页入口。
import { getSessionScope, thumbnailUrl, authenticatedMediaUrl, getAccessToken, listDiaries, DiaryItem } from "../../utils/api";
import { getNavInfo } from "../../utils/nav";
import { enableHomeShareMenu, homeShareHandlers } from "../../utils/homeShare";
import { subscribeDiaryUpdates, diarySyncLabel } from "../../utils/api";

Page({
  ...homeShareHandlers,
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    navRightPadding: 96,
    loading: true,
    failed: false,
    latest: null as (DiaryItem & { cover?: string }) | null,
    syncNote: "",
  },

  onLoad() {
    this.stopDiaryUpdates = subscribeDiaryUpdates(() => { this.setData({ syncNote: diarySyncLabel() }); this.loadLatest(); });
    enableHomeShareMenu();
    const nav = getNavInfo();
    this.setData({
      statusBarHeight: nav.statusBarHeight,
      navBarHeight: nav.navBarHeight,
      navRightPadding: nav.navRightPadding,
    });
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

  latestLoading: false,
  latestScope: "",
  latestRevision: 0,
  stopDiaryUpdates: null as null | (() => void),
  onUnload() { this.latestRevision += 1; this.stopDiaryUpdates?.(); },

  async loadLatest() {
    const scope = getSessionScope();
    if (this.latestLoading && this.latestScope === scope) return;
    if (this.latestScope !== scope) this.setData({ latest: null });
    this.latestScope = scope; this.latestLoading = true;
    const version = ++this.latestRevision;
    if (!getAccessToken()) { this.setData({ latest: null, loading: false, failed: false }); this.latestLoading = false; return; }
    try {
      const list = await listDiaries();
      if (version !== this.latestRevision || scope !== getSessionScope()) return;
      const latest = Array.isArray(list) ? list[0] : null;
      this.setData({ latest: latest ? { ...latest, cover: "" } : null, loading: false, failed: false, syncNote: diarySyncLabel() });
      if (latest?.panels?.[0]?.image_url) {
        authenticatedMediaUrl(thumbnailUrl(latest.panels[0].image_url)).then((cover) => {
          if (version === this.latestRevision && scope === getSessionScope()) this.setData({ "latest.cover": cover });
        }).catch(() => {});
      }
    } catch {
      if (version === this.latestRevision && scope === getSessionScope()) this.setData({ loading: false, failed: true });
    } finally { if (version === this.latestRevision) this.latestLoading = false; }
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

  onOpenBookshelf() {
    wx.navigateTo({ url: "/pages/bookshelf/index" });
  },

  onOpenEmotion() {
    wx.navigateTo({ url: "/pages/bookshelf/index?mode=emotion" });
  },

  onRetry() {
    this.setData({ loading: true });
    this.loadLatest();
  },
});
