// pages/diary/index.ts
import { getSessionScope, authenticatedMediaUrl, deleteDiary, getDiaryDetail, getPublicShareDetail, listDiaries, mediaUrl, DiaryItem } from "../../utils/api";
import { buildContentBlocks } from "../../utils/contentBlocks";
import { getNavInfo } from "../../utils/nav";
import { COMMUNITY_ENABLED } from "../../utils/featureFlags";
import { subscribeDiaryUpdates, localDiaryStore } from "../../utils/api";

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
    contentBlocks: [] as Array<{ type: "text" | "image"; text?: string; url?: string; sourceUrl?: string; imageStatus?: string; key: string }>,
    currentPage: 1,
    totalPages: 1,
    turnKey: 0,
    failed: false,
    loading: true,
    readOnly: false,
    shareId: "",
    shareAuthor: "",
  },

  renderScope: "",
  renderRevision: 0,
  stopDiaryUpdates: null as null | (() => void),
  onUnload() { this.renderRevision += 1; this.stopDiaryUpdates?.(); },

  async onLoad(options: Record<string, string | undefined>) {
    this.stopDiaryUpdates = subscribeDiaryUpdates((id) => {
      if (this.data.readOnly) return;
      if (this.renderScope && this.renderScope !== getSessionScope()) {
        this.renderRevision += 1; this.setData({ diary: null, contentBlocks: [], illustrationUrls: [], loading: false }); return;
      }
      const current = this.data.diary;
      if (!current || (id && id !== current.id)) return;
      const next = localDiaryStore.get(getSessionScope(), current.id);
      if (!next) { this.renderRevision += 1; this.setData({ diary: null, contentBlocks: [], illustrationUrls: [], loading: false }); }
      else if (JSON.stringify(next) !== JSON.stringify(current)) this.renderDiary(next);
    });
    const nav = getNavInfo();
    this.setData({
      statusBarHeight: nav.statusBarHeight,
      navBarHeight: nav.navBarHeight,
      navRightPadding: nav.navRightPadding,
      loading: true,
    });

    const diaryId = options.id;
    const shareId = options.shareId || "";
    if (shareId && !COMMUNITY_ENABLED) {
      wx.reLaunch({ url: "/pages/index/index" });
      return;
    }
    if (shareId) {
      // 请求发出前就锁定公开只读模式，失败重试不得退回“我的最新日记”。
      this.setData({ shareId, readOnly: true });
      wx.showShareMenu({ menus: ["shareAppMessage", "shareTimeline"] });
    } else {
      wx.showShareMenu({ menus: ["shareAppMessage"] });
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
    const version = ++this.renderRevision;
    this.renderScope = getSessionScope();
    const started = Date.now();
    if (!item) { this.setData({ loading: false, failed: false, diary: null }); return; }
    const panels = Array.isArray(item.panels) ? item.panels : [];
    const references = (item.reference_images || []).filter((ref) => ref.include_in_content);
    const urls = [...references.map((ref) => ref.image_url), ...panels.map((panel) => panel.image_url)];
    const contentBlocks = buildContentBlocks(item.full_content || "", urls, [
      ...references.map((ref) => ref.paragraph_anchor || ""), ...panels.map((panel) => panel.anchor_text || panel.source_excerpt || ""),
    ]).map((block) => block.type === "image" ? { ...block, sourceUrl: block.url, url: "", imageStatus: "loading" } : block);
    this.setData({ diary: item, contentBlocks, illustrationUrls: [], illustrationUrl: "", totalPages: Math.max(panels.length, 1), currentPage: 1, loading: false, failed: false });
    console.info("voling.performance", { stage: "diary_text", ms: Date.now() - started });
    contentBlocks.filter((block) => block.type === "image").forEach((block) => this.loadDiaryImage(block.key, version));
  },

  async loadDiaryImage(key: string, version = this.renderRevision, force = false) {
    const scope = getSessionScope();
    const index = this.data.contentBlocks.findIndex((block) => block.key === key);
    const block = this.data.contentBlocks[index];
    if (!block?.sourceUrl) return;
    this.setData({ [`contentBlocks[${index}].imageStatus`]: "loading" });
    try {
      const url = await authenticatedMediaUrl(block.sourceUrl, force);
      if (version !== this.renderRevision || scope !== getSessionScope()) return;
      this.setData({ [`contentBlocks[${index}].url`]: url, [`contentBlocks[${index}].imageStatus`]: "ready" });
      const urls = this.data.contentBlocks.filter((item) => item.type === "image" && item.url).map((item) => item.url!);
      this.setData({ illustrationUrls: urls, illustrationUrl: urls[0] || "" });
    } catch {
      if (version === this.renderRevision && scope === getSessionScope()) this.setData({ [`contentBlocks[${index}].imageStatus`]: "failed" });
    }
  },

  onRetryImage(e: WechatMiniprogram.BaseEvent) { this.loadDiaryImage(e.currentTarget.dataset.key, this.renderRevision, true); },
  onImageError(e: WechatMiniprogram.BaseEvent) {
    const index = this.data.contentBlocks.findIndex((block) => block.key === e.currentTarget.dataset.key);
    if (index >= 0) this.setData({ [`contentBlocks[${index}].imageStatus`]: "failed" });
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
    if (this.renderScope && this.renderScope !== getSessionScope()) { this.renderRevision += 1; this.setData({ diary: null, contentBlocks: [], illustrationUrls: [], loading: false }); return; }
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
    wx.showToast({ title: "请使用右上角菜单分享小程序", icon: "none" });
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
    return { title: "Voling 日记 · 制作自己的 AI 绘本", path: "/pages/index/index" };
  },

  onShareTimeline() {
    return { title: "Voling 日记 · 制作自己的 AI 绘本" };
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
