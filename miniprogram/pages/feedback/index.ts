import { submitFeedback } from "../../utils/api";
import { getNavInfo } from "../../utils/nav";

const TYPES = [
  ["功能建议", "feature"], ["Bug 反馈", "bug"], ["体验问题", "experience"],
  ["AI 内容问题", "ai"], ["图片生成问题", "image"], ["语音识别问题", "voice"],
  ["账号问题", "account"], ["其他", "other"],
];

Page({
  data: {
    statusBarHeight: 20, navBarHeight: 44, navRightPadding: 96,
    types: TYPES, typeIndex: 0, description: "", contact: "", screenshotPath: "",
    includeRelatedContent: false, submitting: false,
  },
  onLoad() {
    const nav = getNavInfo();
    this.setData({ statusBarHeight: nav.statusBarHeight, navBarHeight: nav.navBarHeight, navRightPadding: nav.navRightPadding });
  },
  onTypeChange(e: WechatMiniprogram.CustomEvent) { this.setData({ typeIndex: Number(e.detail.value) }); },
  onDescriptionInput(e: WechatMiniprogram.Input) { this.setData({ description: e.detail.value }); },
  onContactInput(e: WechatMiniprogram.Input) { this.setData({ contact: e.detail.value }); },
  onToggleContext() { this.setData({ includeRelatedContent: !this.data.includeRelatedContent }); },
  onChooseScreenshot() {
    wx.chooseMedia({ count: 1, mediaType: ["image"], sourceType: ["album", "camera"], sizeType: ["compressed"], success: (res) => {
      const path = res.tempFiles?.[0]?.tempFilePath || "";
      if (path) this.setData({ screenshotPath: path });
    }});
  },
  onRemoveScreenshot() { this.setData({ screenshotPath: "" }); },
  async onSubmit() {
    const description = this.data.description.trim();
    if (description.length < 5 || this.data.submitting) { wx.showToast({ title: "请再具体描述一下问题", icon: "none" }); return; }
    this.setData({ submitting: true });
    try {
      let screenshot_base64 = "";
      if (this.data.screenshotPath) {
        screenshot_base64 = wx.getFileSystemManager().readFileSync(this.data.screenshotPath, "base64") as string;
      }
      const sys = wx.getSystemInfoSync();
      const pages = getCurrentPages();
      await submitFeedback({
        category: TYPES[this.data.typeIndex][1], description, contact: this.data.contact.trim(), screenshot_base64,
        include_related_content: this.data.includeRelatedContent,
        device: { version: "1.0.0", SDKVersion: sys.SDKVersion, system: sys.system, model: sys.model, platform: sys.platform, wechatVersion: sys.version },
        diagnostics: { currentPage: pages.length ? pages[pages.length - 1].route : "pages/feedback/index", occurredAt: new Date().toISOString() },
      });
      wx.showModal({ title: "感谢你的反馈", content: "我们已经收到，会认真查看。", showCancel: false, success: () => wx.navigateBack() });
    } catch (error: any) {
      wx.showToast({ title: error?.message || "提交失败，请稍后重试", icon: "none" });
    } finally { this.setData({ submitting: false }); }
  },
  onBack() { wx.navigateBack(); },
});
