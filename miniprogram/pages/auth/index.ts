// pages/auth/index.ts
import { loginUser, registerUser, loginWithWeChatCode } from "../../utils/api";

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
    agreed: true,
    loading: false,
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
    });
  },

  switchMode(e: WechatMiniprogram.BaseEvent) {
    const mode = e.currentTarget.dataset.mode;
    this.setData({
      isLogin: mode === "login",
    });
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

    wx.showLoading({ title: "快捷登录中..." });
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
      wx.showToast({ title: "登录成功", icon: "success" });
      setTimeout(() => {
        wx.switchTab({ url: "/pages/index/index" });
      }, 500);
    } catch (err: any) {
      wx.hideLoading();
      wx.showToast({
        title: err?.message || "登录失败，请重试",
        icon: "none",
      });
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

    this.setData({ loading: true });

    try {
      if (isLogin) {
        await loginUser(email.trim(), password);
        wx.showToast({ title: "登录成功", icon: "success" });
      } else {
        const name = nickname.trim() || "小主人";
        await registerUser(email.trim(), password, name);
        wx.showToast({ title: "注册成功", icon: "success" });
      }

      setTimeout(() => {
        wx.switchTab({ url: "/pages/index/index" });
      }, 800);
    } catch (err: any) {
      wx.showToast({
        title: err.message || "操作失败，请重试",
        icon: "none",
      });
    } finally {
      this.setData({ loading: false });
    }
  },
});
