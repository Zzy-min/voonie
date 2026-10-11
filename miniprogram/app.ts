// app.ts - Voling 微信小程序全局入口与会话管理
import { ensureSession, getCurrentUser, getSavedUser, getSessionScope, trimLocalImageCache, getApiBase, setApiBase, startGuestSession, UserProfile } from "./utils/api";

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
    // Only evict recoverable image copies before any page is rendered.
    try { if (getSessionScope()) trimLocalImageCache(); } catch {}

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
        const user = (sessionReady ? await getCurrentUser() : null) || await startGuestSession();
        if (user) {
          const legacyDraft = wx.getStorageSync("voonie_diary_draft");
          const draftKey = `voonie_diary_draft:${user.id}`;
          if (legacyDraft && !wx.getStorageSync(draftKey)) wx.setStorageSync(draftKey, legacyDraft);
          this.globalData.networkReady = true;
          this.globalData.currentUser = user;
          if (this.userInfoReadyCallback) {
            this.userInfoReadyCallback(user);
          }
        } else {
          this.globalData.currentUser = null;
        }
      } catch (err) {
        this.globalData.networkReady = false;
        if (getSessionScope()) this.globalData.currentUser = getSavedUser();
        console.warn("[Voling App] Session init failed:", err);
        wx.showToast({ title: "网络连接失败，请检查网络后重试", icon: "none", duration: 3000 });
      } finally {
        sessionInitPromise = null;
      }
    })();
    return sessionInitPromise;
  },
});
