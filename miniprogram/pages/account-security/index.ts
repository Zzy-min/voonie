import { bindPhoneIdentity, bindWeChatIdentity, deleteAccountData, getIdentityStatus, IdentityStatus } from "../../utils/api";
import { getNavInfo } from "../../utils/nav";

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    navRightPadding: 96,
    loading: true,
    failed: false,
    action: "",
    identities: null as IdentityStatus | null,
    required: false,
  },

  onLoad(options: Record<string, string>) {
    const nav = getNavInfo();
    this.setData({
      statusBarHeight: nav.statusBarHeight,
      navBarHeight: nav.navBarHeight,
      navRightPadding: nav.navRightPadding,
      required: options.required === "1",
    });
    this.loadStatus();
  },

  async loadStatus() {
    this.setData({ loading: true, failed: false });
    try {
      this.setData({ identities: await getIdentityStatus(), loading: false });
    } catch (_) {
      this.setData({ loading: false, failed: true });
    }
  },

  async onBindWeChat() {
    if (this.data.action || this.data.identities?.wechat_bound) return;
    this.setData({ action: "wechat" });
    try {
      const result: any = await new Promise((resolve, reject) => {
        wx.login({
          success: (res) => res.code ? resolve(res) : reject(new Error("微信凭证获取失败")),
          fail: reject,
        });
      });
      const identities = await bindWeChatIdentity(result.code);
      this.setData({ identities, action: "" });
      wx.showToast({ title: "微信已绑定", icon: "success" });
      if (this.data.required) {
        setTimeout(() => wx.switchTab({ url: "/pages/index/index" }), 500);
      }
    } catch (error: any) {
      this.setData({ action: "" });
      wx.showToast({ title: error?.message || "绑定失败，请重试", icon: "none" });
    }
  },

  async onBindPhone(e: WechatMiniprogram.CustomEvent) {
    if (this.data.action || this.data.identities?.phone_bound) return;
    if (!this.data.identities?.wechat_bound) {
      wx.showToast({ title: "请先绑定微信", icon: "none" });
      return;
    }
    const detail: any = e.detail || {};
    if (!detail.code) {
      if (!/deny|cancel/i.test(detail.errMsg || "")) wx.showToast({ title: "未能获取手机号", icon: "none" });
      return;
    }
    this.setData({ action: "phone" });
    try {
      const identities = await bindPhoneIdentity(detail.code);
      this.setData({ identities, action: "" });
      wx.showToast({ title: "手机号已绑定", icon: "success" });
    } catch (error: any) {
      this.setData({ action: "" });
      wx.showToast({ title: error?.message || "绑定失败，请重试", icon: "none" });
    }
  },

  onBack() {
    if (this.data.required) wx.reLaunch({ url: "/pages/auth/index" });
    else wx.navigateBack();
  },
  onRetry() { this.loadStatus(); },
  onDeleteAccount() {
    if (this.data.action) return;
    wx.showModal({
      title: "永久注销账号？",
      content: "将删除全部日记、图片、录音、AI 生成记录、角色与账号设置，且无法恢复。",
      confirmText: "永久注销",
      confirmColor: "#C4513A",
      success: async (res) => {
        if (!res.confirm) return;
        this.setData({ action: "delete" });
        try {
          await deleteAccountData();
          wx.clearStorageSync();
          const app = getApp<any>();
          if (app?.globalData) {
            app.globalData.currentUser = null;
            app.globalData.token = null;
            app.globalData.hasDraft = false;
          }
          wx.showToast({ title: "账号已注销", icon: "success" });
          setTimeout(() => wx.reLaunch({ url: "/pages/auth/index" }), 500);
        } catch (error: any) {
          this.setData({ action: "" });
          wx.showToast({ title: error?.message || "注销失败，请重试", icon: "none" });
        }
      },
    });
  },
});
