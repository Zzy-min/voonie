// components/pet-chat-drawer/index.ts
import { petSession } from "../../utils/petSession";

Component({
  properties: {
    visible: {
      type: Boolean,
      value: false,
    },
  },

  data: {
    inputValue: "",
    messages: [] as Array<{ id: string; role: "user" | "pet"; content: string }>,
    loading: false,
    scrollTop: 0,
  },

  lifetimes: {
    attached() { this.unsubscribeChat = petSession.subscribe((state: any) => this.setData({ ...state, scrollTop: state.messages.length * 200 })); },
    detached() { this.unsubscribeChat?.(); },
  },
  observers: { visible(value: boolean) { if (value) petSession.sync(); } },
  pageLifetimes: { show() { petSession.sync(); } },
  methods: {
    onClose() {
      this.triggerEvent("close");
    },

    onInput(e: WechatMiniprogram.Input) {
      this.setData({ inputValue: e.detail.value });
    },

    onSelectTag(e: WechatMiniprogram.BaseEvent) {
      const text = e.currentTarget.dataset.text;
      this.sendMessage(text);
    },

    onVoiceClick() {
      // 触发跳转至录音界面
      this.onClose();
      wx.navigateTo({
        url: "/pages/record/index",
      });
    },

    onWriteDiary() {
      this.onClose();
      wx.navigateTo({
        url: "/pages/record/index",
      });
    },

    onWish() {
      this.onClose();
      wx.navigateTo({
        url: "/pages/record/index",
      });
    },

    onOpenBookshelf() {
      this.onClose();
      wx.navigateTo({
        url: "/pages/bookshelf/index",
      });
    },

    async onSend() {
      const text = this.data.inputValue.trim();
      if (!text || this.data.loading) return;
      this.setData({ inputValue: "" });
      await this.sendMessage(text);
    },

    async sendMessage(text: string) {
      try { await petSession.send(text); }
      catch (error: any) { wx.showToast({ title: error.message || "发送失败", icon: "none" }); }
    },
    onRetryMessage(e: WechatMiniprogram.BaseEvent) { petSession.send("", {}, e.currentTarget.dataset.id).catch((error: any) => wx.showToast({ title: error.message, icon: "none" })); },
    onClearChat() { wx.showModal({ title: "清空聊天记录", content: "清空本机当前账号的聊天记录？", success: (res) => { if (res.confirm) petSession.clear(); } }); },
  },
});
