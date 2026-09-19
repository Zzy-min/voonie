// pages/share/index.ts
import { authenticatedMediaUrl, getDiaryDetail, publishShare } from "../../utils/api";
import { getNavInfo } from "../../utils/nav";

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    navRightPadding: 96,
    diaryId: "",
    content: "",
    illustrationUrl: "/assets/images/ui/illust-play-flowers.png",
    isPublic: false, // 核心安全原则：默认私密！
    hideDate: false,
    tags: ["和谁在一起", "今日开心吗", "身边狗狗大片"],
    publishing: false,
  },

  async onLoad(options: Record<string, string | undefined>) {
    const nav = getNavInfo();
    this.setData({
      statusBarHeight: nav.statusBarHeight,
      navBarHeight: nav.navBarHeight,
      navRightPadding: nav.navRightPadding,
      diaryId: options.id || "",
      content: options.text || "",
    });

    if (options.id) {
      try {
        const diary = await getDiaryDetail(options.id);
        if (diary) {
          const img =
            diary.panels && diary.panels.length > 0 && diary.panels[0].image_url
              ? await authenticatedMediaUrl(diary.panels[0].image_url)
        : "/assets/images/ui/illust-play-flowers.png";
          this.setData({
            // 发布的是用户的日记正文，不是 Vonnie 的陪伴摘要。
            content: (diary.full_content || "").slice(0, 500),
            illustrationUrl: img,
          });
        }
      } catch (e) {
        console.warn("Fetch diary for share fallback:", e);
      }
    }
  },

  onTextInput(e: WechatMiniprogram.Input) {
    this.setData({ content: e.detail.value });
  },

  onAddTag() {
    wx.showModal({
      title: "添加标签",
      editable: true,
      placeholderText: "输入自定义心情标签",
      confirmColor: "#D9845B",
      success: (res) => {
        if (res.confirm && res.content) {
          const tag = res.content.trim();
          if (!tag) return;
          this.setData({ tags: [...this.data.tags, tag].slice(0, 10) });
          wx.showToast({ title: "标签已添加", icon: "success" });
        }
      },
    });
  },

  onSelectVisibility() {
    wx.showActionSheet({
      itemList: ["仅自己可见 (私密 · 推荐)", "公开在分享广场"],
      success: (res) => {
        const isPublic = res.tapIndex === 1;
        if (isPublic) {
          wx.showModal({
            title: "确认公开？",
            content: "公开后其他小主人将在分享广场浏览到此绘本与文字，日记属于您的私密记忆，请谨慎选择。",
            confirmText: "确认公开",
            confirmColor: "#D9845B",
            success: (confirmRes) => {
              if (confirmRes.confirm) {
                this.setData({ isPublic: true });
              }
            },
          });
        } else {
          this.setData({ isPublic: false });
        }
      },
    });
  },

  onToggleHideDate(e: WechatMiniprogram.SwitchChange) {
    this.setData({ hideDate: e.detail.value });
  },

  onCancel() {
    wx.navigateBack();
  },

  async onPublish() {
    if (this.data.publishing) return;
    if (!this.data.diaryId) {
      wx.showToast({ title: "请先选择一本已生成的日记", icon: "none" });
      return;
    }
    const caption = this.data.content.trim();
    if (!caption) {
      wx.showToast({ title: "请写下发布内容", icon: "none" });
      return;
    }
    this.setData({ publishing: true });
    wx.showLoading({ title: "正在保存..." });
    try {
      await publishShare({ artifact_id: this.data.diaryId, caption, tags: this.data.tags,
        is_public: this.data.isPublic, show_location: false, hide_date: this.data.hideDate });
      wx.hideLoading();
      wx.showToast({
        title: this.data.isPublic ? "已发布到分享广场" : "已保存为私密内容",
        icon: "success",
      });
      setTimeout(() => {
        wx.switchTab({ url: "/pages/diary-home/index" });
      }, 900);
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: "保存失败，请稍后重试", icon: "none" });
    } finally {
      this.setData({ publishing: false });
    }
  },
});
