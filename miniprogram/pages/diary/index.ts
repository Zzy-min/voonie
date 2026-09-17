// pages/diary/index.ts
import { authenticatedMediaUrl, getDiaryDetail, listDiaries, DiaryItem } from "../../utils/api";
import { getNavInfo } from "../../utils/nav";

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    navRightPadding: 96,
    diary: null as DiaryItem | null,
    firstParagraph: "",
    secondParagraph: "",
    illustrationUrl: "",
    illustrationUrls: [] as string[],
    currentPage: 1,
    totalPages: 1,
    turnKey: 0,
    failed: false,
    loading: true,
  },

  async onLoad(options: Record<string, string | undefined>) {
    const nav = getNavInfo();
    this.setData({
      statusBarHeight: nav.statusBarHeight,
      navBarHeight: nav.navBarHeight,
      navRightPadding: nav.navRightPadding,
      loading: true,
    });

    const diaryId = options.id;
    try {
      if (diaryId && diaryId !== "latest") {
        const detail = await getDiaryDetail(diaryId);
        await this.renderDiary(detail);
        return;
      }
      // 获取最新日记
      const list = await listDiaries();
      const safeList = Array.isArray(list) ? list : [];
      if (safeList.length > 0) {
        await this.renderDiary(safeList[0]);
      } else {
        this.setData({ loading: false, failed: false, diary: null });
      }
    } catch (e) {
      console.warn("Fetch diary failed:", e);
      // 不再用假数据兜底：展示加载失败可重试
      this.setData({ loading: false, failed: true, diary: null });
    }
  },

  async renderDiary(item: DiaryItem) {
    if (!item) {
      this.setData({ loading: false, failed: false, diary: null });
      return;
    }
    const parts = (item.full_content || "").split("\n\n");
    const p1 = parts[0] || "";
    const p2 = parts[1] || parts.slice(1).join("\n") || "";

    const panels = Array.isArray(item.panels) ? item.panels : [];
    const illustrationUrls = await Promise.all(
      panels.map((panel) => authenticatedMediaUrl(panel.image_url))
    );

    this.setData({
      diary: item,
      firstParagraph: p1,
      secondParagraph: p2,
      illustrationUrl: illustrationUrls[0] || "",
      illustrationUrls,
      totalPages: Math.max(panels.length || 1, 1),
      currentPage: 1,
      loading: false,
      failed: false,
    });
  },

  onRetry() {
    wx.redirectTo({ url: `/pages/diary/index?id=latest` });
  },

  onPreviewImage() {
    if (!this.data.illustrationUrl) return;
    wx.previewImage({
      urls: [this.data.illustrationUrl],
    });
  },

  onPrevPage() {
    if (this.data.currentPage > 1) {
      const currentPage = this.data.currentPage - 1;
      this.setData({
        currentPage,
        illustrationUrl: this.data.illustrationUrls[currentPage - 1] || "",
        turnKey: this.data.turnKey + 1,
      });
      wx.showToast({ title: `翻至第 ${this.data.currentPage} 页`, icon: "none" });
    } else {
      wx.showToast({ title: "已是第一页啦", icon: "none" });
    }
  },

  onNextPage() {
    if (this.data.currentPage < this.data.totalPages) {
      const currentPage = this.data.currentPage + 1;
      this.setData({
        currentPage,
        illustrationUrl: this.data.illustrationUrls[currentPage - 1] || "",
        turnKey: this.data.turnKey + 1,
      });
      wx.showToast({ title: `翻至第 ${this.data.currentPage} 页`, icon: "none" });
    } else {
      wx.showToast({ title: "这一篇日记读完啦", icon: "none" });
    }
  },

  onEdit() {
    const diary = this.data.diary;
    if (!diary || !diary.id) return;
    wx.navigateTo({ url: `/pages/diary-edit/index?id=${encodeURIComponent(diary.id)}` });
  },

  async onShow() {
    const diary = this.data.diary;
    if (!diary || !diary.id || this.data.loading) return;
    try {
      await this.renderDiary(await getDiaryDetail(diary.id));
    } catch (error) {
      console.warn("Refresh edited diary failed:", error);
    }
  },

  onShare() {
    const diary = this.data.diary;
    if (!diary || !diary.id) return;
    wx.navigateTo({
      url: `/pages/share/index?id=${encodeURIComponent(diary.id)}`,
    });
  },

  onBack() {
    wx.navigateBack({
      fail: () => {
        wx.switchTab({ url: "/pages/diary-home/index" });
      },
    });
  },

  onGoRecord() {
    wx.navigateTo({ url: "/pages/record/index" });
  },
});
