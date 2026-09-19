// app.ts - Voling 微信小程序全局入口与会话管理
import { ensureSession, getCurrentUser, getApiBase, setApiBase, UserProfile } from "./utils/api";

export interface IAppOption {
  globalData: {
    currentUser: UserProfile | null;
    token: string | null;
    deviceId: string;
    petState: "idle" | "listening" | "thinking" | "talking" | "happy";
    activeTab: number;
    apiBase: string;
    hasDraft: boolean;
    networkReady: boolean;
  };
  initSession(): Promise<void>;
  userInfoReadyCallback?: (user: UserProfile) => void;
}

let sessionInitPromise: Promise<void> | null = null;

App<IAppOption>({
  globalData: {
    currentUser: null,
    token: null,
    deviceId: "",
    petState: "idle",
    activeTab: 0,
    apiBase: getApiBase(),
    hasDraft: false,
    networkReady: true,
  },

  onLaunch() {
    // 支持开发者工具覆盖 API_BASE（本地存储键 voonie_api_base）
    this.globalData.apiBase = getApiBase();
    setApiBase(this.globalData.apiBase);

    // 检查本地草稿
    const draft = wx.getStorageSync("voonie_diary_draft");
    if (draft && draft.text) {
      this.globalData.hasDraft = true;
    }

    // 初始化会话与用户身份
    this.initSession();
    const app = this;
    wx.onNetworkStatusChange((status) => {
      app.globalData.networkReady = status.isConnected;
      if (status.isConnected && !app.globalData.currentUser) {
        app.initSession();
      }
    });
  },

  onShow() {
  },

  onHide() {
  },

  async initSession() {
    if (sessionInitPromise) return sessionInitPromise;
    sessionInitPromise = (async () => {
      try {
        const sessionReady = await ensureSession();
        if (!sessionReady) {
          wx.reLaunch({ url: "/pages/auth/index" });
          return;
        }
        const user = await getCurrentUser();
        if (user) {
          this.globalData.networkReady = true;
          this.globalData.currentUser = user;
          if (this.userInfoReadyCallback) {
            this.userInfoReadyCallback(user);
          }
          if (!user.wechat_bound) {
            wx.reLaunch({ url: "/pages/account-security/index?required=1" });
            return;
          }
        } else {
          this.globalData.currentUser = null;
          wx.reLaunch({ url: "/pages/auth/index" });
        }
      } catch (err) {
        this.globalData.networkReady = false;
        console.warn("[Voling App] Session init failed:", err);
        wx.showToast({ title: "网络连接失败，请检查网络后重试", icon: "none", duration: 3000 });
      } finally {
        sessionInitPromise = null;
      }
    })();
    return sessionInitPromise;
  },
});
