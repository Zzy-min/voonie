// components/pet-chat-drawer/index.ts
import { chatWithPet } from "../../utils/api";

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
        url: "/pages/share/index",
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
      const userMsg = {
        id: "user-" + Date.now(),
        role: "user" as const,
        content: text,
      };

      const curMsgs = Array.isArray(this.data.messages) ? this.data.messages : [];
      const newMsgs = [...curMsgs, userMsg];
      this.setData({
        messages: newMsgs,
        loading: true,
        scrollTop: newMsgs.length * 200,
      });

      try {
        const res = await chatWithPet(text);
        const petMsg = {
          id: "pet-" + Date.now(),
          role: "pet" as const,
          content: res.reply || "我在这里，慢慢说。",
        };
        const currentList = Array.isArray(this.data.messages) ? this.data.messages : [];
        const updated = [...currentList, petMsg];
        this.setData({
          messages: updated,
          loading: false,
          scrollTop: updated.length * 200,
        });
      } catch (err: any) {
        const fallbackMsg = {
          id: "pet-" + Date.now(),
          role: "pet" as const,
          content: "消息没有发送成功。检查网络后再试一次，刚才这条内容还没有交给 Vonnie。",
        };
        const currentList = Array.isArray(this.data.messages) ? this.data.messages : [];
        const updated = [...currentList, fallbackMsg];
        this.setData({
          messages: updated,
          loading: false,
          scrollTop: updated.length * 200,
        });
      }
    },
  },
});
