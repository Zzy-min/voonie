// pages/bookshelf/index.ts - 书架 / 绘本架（案例屏：书架入口，分享广场为子入口）
import { getSessionScope, thumbnailUrl, authenticatedMediaUrl, getAccessToken, listDiaries, DiaryItem } from "../../utils/api";
import { getNavInfo } from "../../utils/nav";
import { COMMUNITY_ENABLED } from "../../utils/featureFlags";
import { enableHomeShareMenu, homeShareHandlers } from "../../utils/homeShare";
import { subscribeDiaryUpdates, diarySyncLabel } from "../../utils/api";

Page({
  ...homeShareHandlers,
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    navRightPadding: 96,
    books: [] as Array<{
      id: string;
      title: string;
      mood: string;
      image: string;
      date: string;
    }>,
    empty: false,
    failed: false,
    loading: true,
    emotionMode: false,
    emotionFilters: [] as string[],
    selectedEmotion: "全部",
    syncNote: "",
  },

  allDiaries: [] as DiaryItem[],
  displayedDiaries: [] as DiaryItem[],
  visibleCount: 0,
  searchQuery: "",

  onLoad(options: Record<string, string | undefined>) {
    this.stopDiaryUpdates = subscribeDiaryUpdates(() => { this.setData({ syncNote: diarySyncLabel() }); this.loadBookshelf(); });
    enableHomeShareMenu();
    const nav = getNavInfo();
    this.setData({
      statusBarHeight: nav.statusBarHeight,
      navBarHeight: nav.navBarHeight,
      navRightPadding: nav.navRightPadding,
      emotionMode: options.mode === "emotion",
    });
  },

  onShow() {
    this.loadBookshelf();
  },

  async loadBookshelf() {
    const scope = getSessionScope();
    if (this.bookScope !== scope) { this.allDiaries = []; this.displayedDiaries = []; this.searchQuery = ""; this.setData({ books: [], selectedEmotion: "全部" }); }
    this.bookScope = scope;
    const loadVersion = ++this.bookRevision;
    if (!getAccessToken()) {
      this.allDiaries = [];
      this.displayedDiaries = [];
      this.setData({ books: [], emotionFilters: ["全部"], empty: true, failed: false, loading: false });
      return;
    }
    this.setData({ loading: true, failed: false });
    try {
      const list = await listDiaries();
      if (scope !== getSessionScope() || loadVersion !== this.bookRevision) return;
      const safeList = Array.isArray(list) ? list : [];
      this.allDiaries = safeList;
      this.displayedDiaries = safeList.filter((item) => (this.data.selectedEmotion === "全部" || item.mood === this.data.selectedEmotion || item.secondary_mood === this.data.selectedEmotion)
        && (!this.searchQuery || `${item.title || ""} ${item.mood || ""}`.toLowerCase().includes(this.searchQuery)));
      const emotionFilters = ["全部", ...Array.from(new Set(safeList.map((item) => item.mood).filter(Boolean)))];
      this.visibleCount = Math.min(Math.max(20, this.visibleCount), this.displayedDiaries.length);
      this.setData({ emotionFilters, syncNote: diarySyncLabel() });
      await this.renderBooks(this.displayedDiaries.slice(0, this.visibleCount));
    } catch (e) {
      if (scope !== getSessionScope() || loadVersion !== this.bookRevision) return;
      console.warn("Load bookshelf failed:", e);
      // 不再伪造数据：展示空态 + 可重试
      this.setData({ books: [], empty: true, failed: true, loading: false });
    }
  },

  bookScope: "",
  bookRevision: 0,
  stopDiaryUpdates: null as null | (() => void),
  onUnload() { this.bookRevision += 1; this.stopDiaryUpdates?.(); },
  async renderBooks(diaries: DiaryItem[]) {
    const version = ++this.bookRevision, scope = getSessionScope();
    const books = diaries.map((d) => ({ id: d.id, title: d.title || "未命名手帐", mood: d.mood || "开心", image: "", date: d.date_label || (d.created_at || "").slice(0, 10) }));
    this.setData({ books, empty: books.length === 0, failed: false, loading: false });
    diaries.forEach(async (diary, index) => {
      if (!diary.panels?.[0]?.image_url) return;
      try {
        const image = await authenticatedMediaUrl(thumbnailUrl(diary.panels[0].image_url));
        if (version === this.bookRevision && scope === getSessionScope()) this.setData({ [`books[${index}].image`]: image });
      } catch { /* Keep the title and date visible. */ }
    });
  },

  async onLoadMore() {
    if (this.visibleCount >= this.displayedDiaries.length) return;
    this.visibleCount = Math.min(this.visibleCount + 20, this.displayedDiaries.length);
    await this.renderBooks(this.displayedDiaries.slice(0, this.visibleCount));
  },

  onRetry() {
    this.setData({ failed: false });
    this.loadBookshelf();
  },

  async onSelectEmotion(e: WechatMiniprogram.BaseEvent) {
    const emotion = String(e.currentTarget.dataset.emotion || "全部");
    this.searchQuery = "";
    const matches = emotion === "全部"
      ? this.allDiaries
      : this.allDiaries.filter((item) => item.mood === emotion || item.secondary_mood === emotion);
    this.displayedDiaries = matches;
    this.visibleCount = Math.min(20, matches.length);
    this.setData({ selectedEmotion: emotion });
    await this.renderBooks(matches.slice(0, this.visibleCount));
  },

  onOpenBook(e: WechatMiniprogram.BaseEvent) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/diary/index?id=${id}` });
  },

  // 分享广场（子入口）
  onOpenSquare() {
    if (!COMMUNITY_ENABLED) return;
    wx.switchTab({ url: "/pages/square/index" });
  },

  // 回忆日历（子入口，视觉丰富书架）
  onOpenCalendar() {
    wx.navigateTo({ url: "/pages/calendar/index" });
  },

  onSearch() {
    wx.showModal({
      title: "搜索书架",
      editable: true,
      placeholderText: "输入标题或心情",
      success: async (res) => {
        if (!res.confirm) return;
        const query = (res.content || "").trim().toLowerCase();
        this.searchQuery = query;
        this.setData({ selectedEmotion: "全部" });
        const matches = query ? this.allDiaries.filter((d) => `${d.title} ${d.mood}`.toLowerCase().includes(query)) : this.allDiaries;
        this.displayedDiaries = matches;
        this.visibleCount = Math.min(20, matches.length);
        await this.renderBooks(matches.slice(0, this.visibleCount));
      },
    });
  },
});
