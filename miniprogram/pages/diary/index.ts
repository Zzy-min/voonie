// pages/diary/index.ts
import { authenticatedMediaUrl, deleteDiary, getDiaryDetail, getPublicShareDetail, listDiaries, mediaUrl, DiaryItem } from "../../utils/api";
import { buildContentBlocks } from "../../utils/contentBlocks";
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
    contentBlocks: [] as Array<{ type: "text" | "image"; text?: string; url?: string; key: string }>,
    currentPage: 1,
    totalPages: 1,
    turnKey: 0,
    failed: false,
    loading: true,
    readOnly: false,
    shareId: "",
    shareAuthor: "",
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
    const shareId = options.shareId || "";
    if (shareId) {
      // 请求发出前就锁定公开只读模式，失败重试不得退回“我的最新日记”。
      this.setData({ shareId, readOnly: true });
      wx.showShareMenu({ menus: ["shareAppMessage", "shareTimeline"] });
    } else {
      wx.hideShareMenu();
    }
    try {
      if (shareId) {
        await this.loadPublicShare(shareId, true);
        return;
      }
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

  async loadPublicShare(shareId: string, retryOnce = false) {
    this.setData({ loading: true, failed: false, shareId, readOnly: true });
    let share;
    try {
      share = await getPublicShareDetail(shareId);
    } catch (error) {
      if (!retryOnce) throw error;
      await new Promise((resolve) => setTimeout(resolve, 350));
      share = await getPublicShareDetail(shareId);
    }
    const illustrationUrls = (share.image_urls || []).map((url) => mediaUrl(url));
    const contentBlocks = buildContentBlocks(share.content || "", illustrationUrls);
    const contentParts = contentBlocks.filter((item) => item.type === "text").map((item) => item.text || "");
    this.setData({
      shareAuthor: share.author,
      diary: {
        id: share.artifact_id,
        entry_id: "",
        title: share.title,
        summary: "",
        mood: share.mood,
        full_content: share.content,
        created_at: share.created_at,
        date_label: "广场分享",
        panels: [],
      },
      firstParagraph: contentParts[0] || "",
      secondParagraph: contentParts.slice(1).join("\n\n"),
      illustrationUrls,
      contentBlocks,
      illustrationUrl: illustrationUrls[0] || "",
      totalPages: Math.max(illustrationUrls.length, 1),
      currentPage: 1,
      loading: false,
      failed: false,
    });
  },

  async renderDiary(item: DiaryItem) {
    if (!item) {
      this.setData({ loading: false, failed: false, diary: null });
      return;
    }
    const panels = Array.isArray(item.panels) ? item.panels : [];
    const inlineReferences = (item.reference_images || []).filter((reference) => reference.include_in_content);
    const referenceUrls = await Promise.all(inlineReferences.map((reference) => authenticatedMediaUrl(reference.image_url)));
    const panelUrls = await Promise.all(panels.map((panel) => authenticatedMediaUrl(panel.image_url)));
    const illustrationUrls = [...referenceUrls, ...panelUrls];
    const contentBlocks = buildContentBlocks(
      item.full_content || "",
      illustrationUrls,
      [
        ...inlineReferences.map((reference) => reference.paragraph_anchor || ""),
        ...panels.map((panel) => panel.anchor_text || panel.source_excerpt || ""),
      ]
    );
    const textParts = contentBlocks.filter((block) => block.type === "text").map((block) => block.text || "");

    this.setData({
      diary: item,
      firstParagraph: textParts[0] || "",
      secondParagraph: textParts.slice(1).join("\n\n"),
      illustrationUrl: illustrationUrls[0] || "",
      illustrationUrls,
      contentBlocks,
      totalPages: Math.max(panels.length || 1, 1),
      currentPage: 1,
      loading: false,
      failed: false,
    });
  },

  async onRetry() {
    if (this.data.shareId) {
      try {
        await this.loadPublicShare(this.data.shareId, true);
      } catch (error) {
        console.warn("Retry public share failed:", error);
        this.setData({ loading: false, failed: true });
      }
      return;
    }
    wx.redirectTo({ url: "/pages/diary/index?id=latest" });
  },

  onPreviewImage(e?: WechatMiniprogram.BaseEvent) {
    const selected = e?.currentTarget?.dataset?.url || this.data.illustrationUrl;
    if (!selected) return;
    wx.previewImage({
      current: selected,
      urls: this.data.illustrationUrls.length ? this.data.illustrationUrls : [selected],
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
    if (this.data.readOnly) return;
    const diary = this.data.diary;
    if (!diary || !diary.id) return;
    wx.navigateTo({ url: `/pages/diary-edit/index?id=${encodeURIComponent(diary.id)}` });
  },

  async onShow() {
    if (this.data.readOnly) return;
    const diary = this.data.diary;
    if (!diary || !diary.id || this.data.loading) return;
    try {
      await this.renderDiary(await getDiaryDetail(diary.id));
    } catch (error) {
      console.warn("Refresh edited diary failed:", error);
    }
  },

  onShare() {
    if (this.data.readOnly) {
      wx.showToast({ title: "请使用右上角菜单分享", icon: "none" });
      return;
    }
    const diary = this.data.diary;
    if (!diary || !diary.id) return;
    wx.navigateTo({
      url: `/pages/share/index?id=${encodeURIComponent(diary.id)}`,
    });
  },

  onDelete() {
    if (this.data.readOnly || !this.data.diary?.id) return;
    wx.showModal({
      title: "删除这篇日记？",
      content: "将同时删除这篇日记关联的插图、生成记录和原始录音，且无法恢复。",
      confirmText: "删除",
      confirmColor: "#C4513A",
      success: async (res) => {
        if (!res.confirm || !this.data.diary?.id) return;
        wx.showLoading({ title: "正在删除…", mask: true });
        try {
          await deleteDiary(this.data.diary.id);
          wx.hideLoading();
          wx.showToast({ title: "已删除", icon: "success" });
          setTimeout(() => wx.switchTab({ url: "/pages/diary-home/index" }), 400);
        } catch (error: any) {
          wx.hideLoading();
          wx.showToast({ title: error?.message || "删除失败，请重试", icon: "none" });
        }
      },
    });
  },

  onShareAppMessage() {
    if (!this.data.readOnly || !this.data.shareId) {
      return { title: "Voling 日记 · 记录你的每一天", path: "/pages/index/index" };
    }
    const diary = this.data.diary;
    return {
      title: diary?.title ? `我在 Voling 记录了：${diary.title}` : "我在 Voling 记录了一段今天的故事",
      path: `/pages/diary/index?shareId=${encodeURIComponent(this.data.shareId)}`,
      imageUrl: this.data.illustrationUrls[0] || undefined,
    };
  },

  onShareTimeline() {
    if (!this.data.readOnly || !this.data.shareId) return { title: "Voling 日记" };
    return {
      title: this.data.diary?.title || "我在 Voling 记录了一段今天的故事",
      query: `shareId=${encodeURIComponent(this.data.shareId)}`,
      imageUrl: this.data.illustrationUrls[0] || undefined,
    };
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
