// custom-tab-bar/index.ts
Component({
  data: {
    selected: 0,
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
     * 1. 索引映射：0=首页, 1=日记, 2=萌宠, 3=书架, 4=我的
     * 2. 状态双向写回：必须同步更新 this.data.selected 与 app.globalData.activeTab
     * 3. 萌宠按键视觉规则：
     *    - 未选中萌宠 (selected !== 2)：中心圆必须为案例深咖 #432E1E，无任何橙色渐变及光晕
     *    - 选中萌宠 (selected === 2)：中心圆切换为暖橙渐变，且激活 pulseGlow 外发光
     * 4. 其余 Tab 选中规则：激活时 label 与 icon 为激活色 #D9845B，未激活为常态灰褐 #7A6F64
     */
    setSelected(index: number | string) {
      const idx = Number(index);
      const app = getApp();
      if (app && app.globalData) {
        app.globalData.activeTab = idx;
      }
      this.setData({ selected: idx });
    },
  },
});
