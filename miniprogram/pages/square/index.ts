// pages/square/index.ts
import { deleteShare, listShares, mediaUrl, reportShare, toggleShareReaction, updateShareVisibility } from "../../utils/api";
import { getNavInfo } from "../../utils/nav";

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    navRightPadding: 96,
    currentTab: "recommend",
    posts: [] as any[],
    loading: true,
    failed: false,
    mineOnly: false,
  },

  onLoad(options: Record<string, string | undefined>) {
    const nav = getNavInfo();
    this.setData({
      statusBarHeight: nav.statusBarHeight,
      navBarHeight: nav.navBarHeight,
      navRightPadding: nav.navRightPadding,
      mineOnly: options.mine === "1",
    });
  },

  onShow() {
    this.loadPosts();
  },

  async loadPosts() {
    this.setData({ loading: true, failed: false });
    try {
      const data = await listShares(this.data.currentTab);
      const visible = this.data.mineOnly ? data.filter((p) => p.is_owner) : data;
      this.setData({ posts: visible.map((p) => ({ ...p, avatar: "/assets/images/voonie/voonie-avatar.png",
        image: mediaUrl(p.image_url), isLiked: p.is_liked, isCollected: p.is_collected })), loading: false });
    } catch (error) {
      console.warn("Load square failed:", error);
      this.setData({ posts: [], loading: false, failed: true });
    }
  },

  onSwitchTab(e: WechatMiniprogram.BaseEvent) {
    const tab = e.currentTarget.dataset.tab;
    this.setData({ currentTab: tab });
    this.loadPosts();
  },

  onBack() {
    wx.navigateBack({
      fail: () => wx.switchTab({ url: "/pages/bookshelf/index" }),
    });
  },

  onChooseDiary() {
    wx.switchTab({ url: "/pages/bookshelf/index" });
  },

  async onLike(e: WechatMiniprogram.BaseEvent) {
    const id = e.currentTarget.dataset.id;
    try {
      const result = await toggleShareReaction(id, "like");
      this.setData({ posts: this.data.posts.map((p) => p.id === id ? { ...p, isLiked: result.active, likes: result.count } : p) });
    } catch { wx.showToast({ title: "操作失败，请重试", icon: "none" }); }
  },

  async onCollect(e: WechatMiniprogram.BaseEvent) {
    const id = e.currentTarget.dataset.id;
    try {
      const result = await toggleShareReaction(id, "collect");
      this.setData({ posts: this.data.posts.map((p) => p.id === id ? { ...p, isCollected: result.active, collects: result.count } : p) });
      wx.showToast({ title: result.active ? "已收藏" : "已取消收藏", icon: "none" });
    } catch { wx.showToast({ title: "操作失败，请重试", icon: "none" }); }
  },

  onSharePost() {
    wx.showToast({ title: "请使用右上角菜单分享", icon: "none" });
  },

  onPreview(e: WechatMiniprogram.BaseEvent) {
    const img = e.currentTarget.dataset.img;
    wx.previewImage({ urls: [img] });
  },

  onMoreAction(e: WechatMiniprogram.BaseEvent) {
    const id = e.currentTarget.dataset.id;
    const post = this.data.posts.find((item) => item.id === id);
    if (!post) return;
    const itemList = post.is_owner ? ["设为私密", "删除公开内容"] : ["不感兴趣", "举报内容"];
    wx.showActionSheet({
      itemList,
      success: (res) => {
        if (post.is_owner) {
          if (res.tapIndex === 0) this.makePrivate(id);
          if (res.tapIndex === 1) this.confirmDelete(id);
          return;
        }
        if (res.tapIndex === 0) {
          this.setData({ posts: this.data.posts.filter((item) => item.id !== id) });
          wx.showToast({ title: "已减少此类内容", icon: "none" });
        }
        if (res.tapIndex === 1) this.chooseReportReason(id);
      },
    });
  },

  async makePrivate(id: string) {
    try {
      await updateShareVisibility(id, false);
      this.setData({ posts: this.data.posts.filter((item) => item.id !== id) });
      wx.showToast({ title: "已设为私密", icon: "success" });
    } catch { wx.showToast({ title: "设置失败，请重试", icon: "none" }); }
  },

  confirmDelete(id: string) {
    wx.showModal({
      title: "删除公开内容？",
      content: "只会删除广场投稿，私人日记仍会保留。",
      confirmText: "删除",
      confirmColor: "#C4513A",
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await deleteShare(id);
          this.setData({ posts: this.data.posts.filter((item) => item.id !== id) });
          wx.showToast({ title: "已删除", icon: "success" });
        } catch { wx.showToast({ title: "删除失败，请重试", icon: "none" }); }
      },
    });
  },

  chooseReportReason(id: string) {
    const reasons = ["令人不适", "疑似侵权", "垃圾或广告"];
    wx.showActionSheet({
      itemList: reasons,
      success: async (res) => {
        try {
          await reportShare(id, reasons[res.tapIndex]);
          wx.showToast({ title: "已提交举报", icon: "success" });
        } catch { wx.showToast({ title: "举报未提交，请重试", icon: "none" }); }
      },
    });
  },

  onSearch() {
    wx.showModal({
      title: "搜索广场",
      editable: true,
      placeholderText: "输入作者、心情或内容",
      success: (res) => {
        if (!res.confirm) return;
        const query = (res.content || "").trim().toLowerCase();
        if (!query) { this.loadPosts(); return; }
        this.setData({ posts: this.data.posts.filter((post) =>
          `${post.author} ${post.mood} ${post.caption} ${(post.tags || []).join(" ")}`.toLowerCase().includes(query)) });
      },
    });
  },
});
