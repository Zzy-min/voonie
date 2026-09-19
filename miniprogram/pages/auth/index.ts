// pages/auth/index.ts
import { bindPhoneIdentity, loginUser, registerUser, loginWithWeChatCode } from "../../utils/api";

Page({
  data: {
    statusBarHeight: 20,
    isLogin: true,
    accountType: "email",
    account: "",
    email: "",
    password: "",
    nickname: "",
    rememberMe: true,
    agreed: false,
    loading: false,
    authAction: "",
    showEmailForm: false,
    showPassword: false,
  },

  onLoad() {
    const sys = wx.getSystemInfoSync();
    this.setData({
      statusBarHeight: sys.statusBarHeight || 20,
    });
  },

  onToggleShowPassword() {
    this.setData({
      showPassword: !this.data.showPassword,
    });
  },

  onToggleMode() {
    this.setData({
      isLogin: !this.data.isLogin,
      showEmailForm: true,
    });
  },

  switchMode(e: WechatMiniprogram.BaseEvent) {
    const mode = e.currentTarget.dataset.mode;
    this.setData({
      isLogin: mode === "login",
      showEmailForm: true,
    });
  },

  onToggleEmailForm() {
    this.setData({ showEmailForm: !this.data.showEmailForm });
  },

  onSwitchAccountType(e: WechatMiniprogram.BaseEvent) {
    const type = e.currentTarget.dataset.type;
    this.setData({ accountType: type, account: "" });
  },

  onAccountInput(e: WechatMiniprogram.Input) {
    const account = e.detail.value;
    this.setData({ account: account, email: account });
  },

  onEmailInput(e: WechatMiniprogram.Input) {
    this.setData({ email: e.detail.value });
  },

  onPasswordInput(e: WechatMiniprogram.Input) {
    this.setData({ password: e.detail.value });
  },

  onNicknameInput(e: WechatMiniprogram.Input) {
    this.setData({ nickname: e.detail.value });
  },

  toggleRemember() {
    this.setData({ rememberMe: !this.data.rememberMe });
  },

  toggleAgree() {
    this.setData({ agreed: !this.data.agreed });
  },

  onOpenTerms() {
    wx.navigateTo({ url: "/pages/legal/index?type=terms" });
  },

  onOpenPrivacy() {
    wx.navigateTo({ url: "/pages/legal/index?type=privacy" });
  },

  onForgetPassword() {
    wx.showModal({
      title: "找回密码",
      content: "如需重置密码，请联系 Voonie 客服邮箱 support@vonnie.xyz 或在 Web 端找回。",
      showCancel: false,
      confirmColor: "#D9845B",
    });
  },

  async onWeChatFastLogin() {
    if (!this.data.agreed) {
      wx.showToast({ title: "请先勾选同意协议", icon: "none" });
      return;
    }

    if (this.data.authAction) return;
    this.setData({ authAction: "wechat" });
    wx.showLoading({ title: "快捷登录中...", mask: true });
    try {
      // 1) wx.login 取一次性 code（约 5 分钟有效，用一次即废）
      const loginRes: any = await new Promise((resolve, reject) => {
        wx.login({
          success: (res) =>
            res.code ? resolve(res) : reject(new Error("微信登录凭证获取失败")),
          fail: () => reject(new Error("无法获取微信登录权限")),
        });
      });

      // 2) 交后端换 openid 并签 JWT（微信官方登录，不再是 device 冒充）
      await loginWithWeChatCode(loginRes.code);
      wx.hideLoading();
      this.setData({ authAction: "" });
      wx.showToast({ title: "登录成功", icon: "success" });
      setTimeout(() => {
        wx.switchTab({ url: "/pages/index/index" });
      }, 500);
    } catch (err: any) {
      wx.hideLoading();
      this.setData({ authAction: "" });
      if (err?.code === "wechat_login_not_configured") {
        wx.showModal({
          title: "微信登录暂未开通",
          content: "服务端还没有配置当前小程序的微信登录密钥。请先使用邮箱登录，配置完成后这里会直接恢复。",
          showCancel: false,
          confirmText: "知道了",
          confirmColor: "#E8A74C",
        });
        return;
      }
      wx.showToast({
        title: err?.message || "登录失败，请重试",
        icon: "none",
      });
    }
  },

  async onPhoneLogin(e: WechatMiniprogram.CustomEvent) {
    if (!this.data.agreed) {
      wx.showToast({ title: "请先勾选同意协议", icon: "none" });
      return;
    }
    const detail: any = e.detail || {};
    if (!detail.code) {
      if (!/deny|cancel/i.test(detail.errMsg || "")) {
        wx.showToast({ title: "未能获取手机号，请重试", icon: "none" });
      }
      return;
    }

    if (this.data.authAction) return;
    this.setData({ authAction: "phone" });
    wx.showLoading({ title: "手机号登录中...", mask: true });
    try {
      const loginRes: any = await new Promise((resolve, reject) => {
        wx.login({
          success: (res) => res.code ? resolve(res) : reject(new Error("微信登录凭证获取失败")),
          fail: reject,
        });
      });
      await loginWithWeChatCode(loginRes.code);
      await bindPhoneIdentity(detail.code);
      wx.hideLoading();
      this.setData({ authAction: "" });
      wx.showToast({ title: "登录成功", icon: "success" });
      setTimeout(() => wx.switchTab({ url: "/pages/index/index" }), 500);
    } catch (err: any) {
      wx.hideLoading();
      this.setData({ authAction: "" });
      wx.showToast({ title: err?.message || "手机号登录失败", icon: "none" });
    }
  },

  async onSubmit() {
    if (!this.data.agreed) {
      wx.showToast({ title: "请先勾选同意协议", icon: "none" });
      return;
    }

    const { email, password, nickname, isLogin } = this.data;
    if (!email || !password) {
      wx.showToast({ title: "请填写完整信息", icon: "none" });
      return;
    }
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      wx.showToast({ title: "请输入有效邮箱", icon: "none" });
      return;
    }

    if (this.data.authAction) return;
    this.setData({ loading: true, authAction: "email" });

    try {
      if (isLogin) {
        await loginUser(email.trim(), password);
        wx.showToast({ title: "请绑定微信", icon: "none" });
      } else {
        const name = nickname.trim() || "小主人";
        await registerUser(email.trim(), password, name);
        wx.showToast({ title: "请绑定微信", icon: "none" });
      }

      setTimeout(() => {
        wx.redirectTo({ url: "/pages/account-security/index?required=1" });
      }, 800);
    } catch (err: any) {
      wx.showToast({
        title: err.message || "操作失败，请重试",
        icon: "none",
      });
    } finally {
      this.setData({ loading: false, authAction: "" });
    }
  },
});
