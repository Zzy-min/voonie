// pages/pet/index.ts - 萌宠独立页（案例屏 3：快捷聊天）
// 聊天、写日记（录音）、写下愿望
import { chatWithPet, getPetMemories, getPetStatus, listDiaries } from "../../utils/api";
import { getNavInfo } from "../../utils/nav";

interface ChatMsg {
  id: string;
  role: "user" | "pet";
  content: string;
}

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    navRightPadding: 96,
    inputValue: "",
    messages: [] as ChatMsg[],
    loading: false,
    petName: "Voonie",
    greeting: "小主人，今天过得怎么样呀？想和我说话，或唠叨心底的愿望？🐾",
    petStatus: "",
    petStatusLabel: "",
    memStories: [] as string[],
    recentDiaries: [] as Array<{ id: string; title: string; mood: string; date: string }>,
    scrollTop: 0,
    dateLabel: "",
  },

  onLoad() {
    const nav = getNavInfo();
    const now = new Date();
    const weekdays = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
    this.setData({
      statusBarHeight: nav.statusBarHeight,
      navBarHeight: nav.navBarHeight,
      navRightPadding: nav.navRightPadding,
      dateLabel: `${now.getMonth() + 1}月${now.getDate()}日 · ${weekdays[now.getDay()]}`,
    });
    this.loadPetStatus();
    this.loadPetMemories();
    this.loadRecentDiaries();
  },

  onShow() {
    const app = getApp();
    if (app && app.globalData) {
      app.globalData.activeTab = 2;
    }
    const tab = typeof this.getTabBar === "function" ? this.getTabBar() : null;
    if (tab && typeof tab.setSelected === "function") {
      tab.setSelected(2);
    }
    this.loadPetStatus();
    // P3-3: 萌宠 Tab 常驻，跨账号切换到本页时若回忆为空则补拉一次，避免展示旧/空数据
    if (!Array.isArray(this.data.memStories) || this.data.memStories.length === 0) {
      this.loadPetMemories();
    }
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
      const res = await getPetStatus(this.data.petName || "Voonie");
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

  // 消费 /pet/memories，展示 1~3 条“记得的小事”（失败不阻断聊天）
  async loadPetMemories() {
    try {
      const list = await getPetMemories();
      const safeList = Array.isArray(list) ? list : [];
      const rows = safeList.slice(0, 3);
      const stories = rows
        .map((m) => (m && (m.text || m.summary || m.content || "")) || "")
        .filter((t: string) => Boolean(t));
      this.setData({
        memStories: Array.isArray(stories) ? stories : [],
      });
    } catch (e) {
      console.warn("Load pet memories failed:", e);
      this.setData({ memStories: [] });
    }
  },

  // 最近回忆（备用于聊天上下文提示）
  async loadRecentDiaries() {
    try {
      const list = await listDiaries();
      const safeList = Array.isArray(list) ? list : [];
      const recents = safeList.slice(0, 3).map((d) => ({
        id: (d && d.id) || "",
        title: (d && d.title) || "未命名日记",
        mood: (d && d.mood) || "开心",
        date: (d && d.date_label) || ((d && d.created_at) || "").slice(0, 10),
      }));
      this.setData({ recentDiaries: Array.isArray(recents) ? recents : [] });
    } catch (e) {
      console.warn("Load recent diaries failed:", e);
      this.setData({ recentDiaries: [] });
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
    wx.switchTab({ url: "/pages/bookshelf/index" });
  },

  async onSend() {
    const text = this.data.inputValue.trim();
    if (!text || this.data.loading) return;
    this.setData({ inputValue: "" });
    await this.sendMessage(text);
  },

  async sendMessage(text: string) {
    const userMsg: ChatMsg = { id: "user-" + Date.now(), role: "user", content: text };
    const newMsgs = [...this.data.messages, userMsg];
    this.setData({ messages: newMsgs, loading: true, scrollTop: newMsgs.length * 500 });

    try {
      const res = await chatWithPet(text);
      const petMsg: ChatMsg = {
        id: "pet-" + Date.now(),
        role: "pet",
        content: res.reply || "汪！我一直在小主人身边哦🐾",
      };
      const updated = [...this.data.messages, petMsg];
      this.setData({ messages: updated, loading: false, scrollTop: updated.length * 500 });
    } catch (err) {
      const fallbackMsg: ChatMsg = {
        id: "pet-" + Date.now(),
        role: "pet",
        content: "消息没有发送成功，请检查网络后再试一次。刚才这条内容尚未交给 Voonie。",
      };
      const updated = [...this.data.messages, fallbackMsg];
      this.setData({ messages: updated, loading: false, scrollTop: updated.length * 500 });
    }
  },
});
