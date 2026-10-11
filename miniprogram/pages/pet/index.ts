import { petSession } from "../../utils/petSession";
// pages/pet/index.ts - 萌宠独立页（案例屏 3：快捷聊天）
// 聊天、写日记（录音）、写下愿望
import { chatWithPet, getPetStatus } from "../../utils/api";
import { getNavInfo } from "../../utils/nav";
import { enableHomeShareMenu, homeShareHandlers } from "../../utils/homeShare";

interface ChatMsg {
  id: string;
  role: "user" | "pet";
  content: string;
}

Page({
  ...homeShareHandlers,
  keyboardHeightListener: null as null | ((res: { height: number }) => void),

  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    navRightPadding: 96,
    inputValue: "",
    messages: [] as ChatMsg[],
    loading: false,
    petName: "Vonnie",
    greeting: "今天过得怎么样？慢慢说，我在听。",
    petStatus: "",
    petStatusLabel: "",
    scrollTop: 0,
    dateLabel: "",
    keyboardHeight: 0,
    composerStyle: "",
    viewportStyle: "",
    scrollEndId: "",
  },

  unsubscribeChat: null as null | (() => void),

  onLoad() {
    enableHomeShareMenu();
    const nav = getNavInfo();
    const now = new Date();
    const weekdays = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
    this.setData({
      statusBarHeight: nav.statusBarHeight,
      navBarHeight: nav.navBarHeight,
      navRightPadding: nav.navRightPadding,
      dateLabel: `${now.getMonth() + 1}月${now.getDate()}日 · ${weekdays[now.getDay()]}`,
      messages: [],
    });
    this.keyboardHeightListener = (res: { height: number }) => {
      this.applyKeyboardHeight(res && res.height);
    };
    if (typeof wx.onKeyboardHeightChange === "function") {
      wx.onKeyboardHeightChange(this.keyboardHeightListener);
    }
    this.unsubscribeChat = petSession.subscribe((state: any) => this.setData({ ...state }, () => this.scrollToLatest()));
  },

  onShow() {
    petSession.sync();
    const app = getApp();
    if (app && app.globalData) {
      app.globalData.activeTab = 2;
    }
    const tab = typeof this.getTabBar === "function" ? this.getTabBar() : null;
    if (tab && typeof tab.setSelected === "function") {
      tab.setSelected(2);
    }
    if (tab && typeof tab.setHidden === "function") {
      tab.setHidden(false);
    }
    this.loadPetStatus();
  },

  onHide() {
    this.restoreTabBar();
  },

  onUnload() {
    this.unsubscribeChat?.();
    this.restoreTabBar();
    if (this.keyboardHeightListener && typeof wx.offKeyboardHeightChange === "function") {
      wx.offKeyboardHeightChange(this.keyboardHeightListener);
    }
    this.keyboardHeightListener = null;
  },

  restoreTabBar() {
    const tab = typeof this.getTabBar === "function" ? this.getTabBar() : null;
    if (tab && typeof tab.setHidden === "function") tab.setHidden(false);
    if (this.data.keyboardHeight) this.setData({ keyboardHeight: 0, composerStyle: "", viewportStyle: "" });
  },

  onKeyboardHeightChange(e: any) {
    this.applyKeyboardHeight(e.detail && e.detail.height);
  },

  applyKeyboardHeight(rawHeight: number) {
    const height = Math.max(0, Number(rawHeight) || 0);
    const tab = typeof this.getTabBar === "function" ? this.getTabBar() : null;
    if (tab && typeof tab.setHidden === "function") tab.setHidden(height > 0);
    this.setData({
      keyboardHeight: height,
      composerStyle: height > 0 ? `bottom:${height}px;` : "",
      viewportStyle: height > 0 ? `height:calc(100vh - ${height}px);padding-bottom:0;` : "",
    }, () => this.scrollToLatest());
  },

  scrollToLatest() {
    // Reset the anchor so repeated keyboard changes and replies trigger a new scroll.
    this.setData({ scrollEndId: "" }, () => {
      wx.nextTick(() => this.setData({ scrollEndId: "chat-bottom" }));
    });
  },

  onInputBlur() {
    // 部分 Android 输入法收起时不回传高度 0；失焦后强制清理旧位移。
    setTimeout(() => {
      const tab = typeof this.getTabBar === "function" ? this.getTabBar() : null;
      if (tab && typeof tab.setHidden === "function") tab.setHidden(false);
      this.applyKeyboardHeight(0);
    }, 160);
  },

  // 展示层：把技术态文案柔化为陪伴语气（不改业务语义）
  softStatusLabel(raw: string): string {
    const s = (raw || "").trim();
    if (!s) return "";
    const key = s.toLowerCase();
    const map: Record<string, string> = {
      ready: "在这儿陪你",
      idle: "在这儿陪你",
      online: "在这儿陪你",
      ok: "在这儿陪你",
      available: "在这儿陪你",
      busy: "正在想你说的话",
      thinking: "正在想你说的话",
      typing: "正在想你说的话",
      offline: "稍稍打个盹",
    };
    if (map[key]) return map[key];
    // 已是中文则原样展示
    if (/[一-鿿]/.test(s)) return s;
    return "在这儿陪你";
  },

  // 消费 /pet/status：更新问候与状态文案（失败不阻断聊天）
  async loadPetStatus() {
    try {
      const res = await getPetStatus(this.data.petName || "Vonnie");
      const status = res.status || "";
      this.setData({
        petStatus: status,
        petStatusLabel: this.softStatusLabel(status),
        greeting: res.greeting || this.data.greeting,
      });
    } catch (e) {
      console.warn("Load pet status failed:", e);
    }
  },

  onInput(e: WechatMiniprogram.Input) {
    this.setData({ inputValue: e.detail.value });
  },

  // 快捷 chip：「陪陪我」真正发消息给小狗
  onSelectTag(e: WechatMiniprogram.BaseEvent) {
    const text = e.currentTarget.dataset.text;
    this.sendMessage(text);
  },

  // 「写日记」芯片 → 录音倾诉
  onChipWriteDiary() {
    wx.navigateTo({ url: "/pages/record/index" });
  },

  // 「我有点想说」与日记记录使用同一条真实录音链路。
  onChipWish() {
    wx.navigateTo({ url: "/pages/record/index" });
  },

  // 书架入口
  onOpenBookshelf() {
    wx.navigateTo({ url: "/pages/bookshelf/index" });
  },

  async onSend() {
    await getApp<any>().initSession();
    if (!getApp<any>().globalData.currentUser) {
      wx.showToast({ title: "暂时无法连接，请稍后重试", icon: "none" });
      return;
    }
    const text = this.data.inputValue.trim();
    if (!text || this.data.loading) return;
    this.setData({ inputValue: "" });
    await this.sendMessage(text);
  },

  async sendMessage(text: string) {
    try { await petSession.send(text, { pet_name: this.data.petName }); }
    catch (error: any) { wx.showToast({ title: error.message || "发送失败", icon: "none" }); }
  },

  onRetryMessage(e: WechatMiniprogram.BaseEvent) {
    petSession.send("", { pet_name: this.data.petName }, e.currentTarget.dataset.id).catch((error: any) => wx.showToast({ title: error.message, icon: "none" }));
  },

  onClearChat() {
    wx.showModal({ title: "清空聊天记录", content: "将清空本机当前账号的萌宠聊天记录。日记不受影响。", success: (res) => { if (res.confirm) petSession.clear(); } });
  },

});
