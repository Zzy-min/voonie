// pages/bookshelf/index.ts - 书架 / 绘本架（案例屏：书架入口，分享广场为子入口）
import { authenticatedMediaUrl, listDiaries, DiaryItem } from "../../utils/api";
import { getNavInfo } from "../../utils/nav";

Page({
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
  },

  allDiaries: [] as DiaryItem[],
  displayedDiaries: [] as DiaryItem[],
  visibleCount: 0,

  onLoad() {
    const nav = getNavInfo();
    this.setData({
      statusBarHeight: nav.statusBarHeight,
      navBarHeight: nav.navBarHeight,
      navRightPadding: nav.navRightPadding,
    });
  },

  onShow() {
    this.loadBookshelf();
  },

  async loadBookshelf() {
    this.setData({ loading: true, failed: false });
    try {
      const list = await listDiaries();
      const safeList = Array.isArray(list) ? list : [];
      this.allDiaries = safeList;
      this.displayedDiaries = safeList;
      this.visibleCount = Math.min(20, safeList.length);
      await this.renderBooks(safeList.slice(0, this.visibleCount));
    } catch (e) {
      console.warn("Load bookshelf failed:", e);
      // 不再伪造数据：展示空态 + 可重试
      this.setData({ books: [], empty: true, failed: true, loading: false });
    }
  },

  async renderBooks(diaries: DiaryItem[]) {
      const books = await Promise.all(diaries.map(async (d, idx) => ({
        id: (d && d.id) || "",
        title: (d && d.title) || "未命名手帐",
        mood: (d && d.mood) || "开心",
        image:
          d && d.panels && Array.isArray(d.panels) && d.panels[0]?.image_url
            ? await authenticatedMediaUrl(d.panels[0].image_url)
            : idx % 2 === 0
        ? "/assets/images/ui/illust-meadow.png"
        : "/assets/images/ui/illust-garden-walk.png",
        date: (d && d.date_label) || ((d && d.created_at) || "").slice(0, 10),
      })));
      this.setData({
        books: Array.isArray(books) ? books : [],
        empty: books.length === 0,
        failed: false,
        loading: false,
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

  onOpenBook(e: WechatMiniprogram.BaseEvent) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/diary/index?id=${id}` });
  },

  // 分享广场（子入口）
  onOpenSquare() {
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
        const matches = query ? this.allDiaries.filter((d) => `${d.title} ${d.mood}`.toLowerCase().includes(query)) : this.allDiaries;
        this.displayedDiaries = matches;
        this.visibleCount = Math.min(20, matches.length);
        await this.renderBooks(matches.slice(0, this.visibleCount));
      },
    });
  },
});
