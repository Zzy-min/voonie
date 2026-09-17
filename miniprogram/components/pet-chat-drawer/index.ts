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
      wx.switchTab({
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
          content: res.reply || "汪！我一直在小主人身边哦🐾",
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
          content: "虽然网络有点小波动，但我一直在听你说。小主人辛苦啦🐾",
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
