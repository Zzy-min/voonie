// custom-tab-bar/index.ts
Component({
  data: {
    selected: 0,
    hidden: false,
  },

  attached() {
    const app = getApp();
    const t = app && app.globalData ? (app.globalData.activeTab != null ? app.globalData.activeTab : 0) : 0;
    this.setData({ selected: t });
  },

  methods: {
    switchTab(e: WechatMiniprogram.BaseEvent) {
      const { index, path } = e.currentTarget.dataset;
      const idx = Number(index);
      const app = getApp();
      if (app && app.globalData) {
        app.globalData.activeTab = idx;
      }
      this.setData({ selected: idx });
      wx.switchTab({
        url: path,
      });
    },

    /**
     * 各 Tab 页面在 onShow 时显式同步选中状态
     * 验收标准（P0）：
     * 索引映射：0=首页, 1=日记, 2=萌宠聊天, 3=广场, 4=我的。
     * 状态双向写回 this.data.selected 与 app.globalData.activeTab。
     */
    setSelected(index: number | string) {
      const idx = Number(index);
      const app = getApp();
      if (app && app.globalData) {
        app.globalData.activeTab = idx;
      }
      this.setData({ selected: idx });
    },

    setHidden(hidden: boolean) {
      this.setData({ hidden: Boolean(hidden) });
    },
  },
});
