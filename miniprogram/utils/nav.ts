// utils/nav.ts - 微信小程序展示层状态栏、导航条与胶囊安全区适配
export interface NavInfo {
  statusBarHeight: number;
  navBarHeight: number;
  navRightPadding: number;
}

export function getNavInfo(): NavInfo {
  try {
    const sys = wx.getSystemInfoSync();
    const statusBarHeight = sys.statusBarHeight || 20;
    let navBarHeight = 44;
    let navRightPadding = 96;

    const menu = typeof wx.getMenuButtonBoundingClientRect === "function"
      ? wx.getMenuButtonBoundingClientRect()
      : null;

    if (menu && menu.top && menu.height && menu.left) {
      // 导航条高度 = (胶囊顶部 - 状态栏高度) * 2 + 胶囊高度
      navBarHeight = (menu.top - statusBarHeight) * 2 + menu.height;
      // 胶囊占据的右侧留白（避免内容与微信原生胶囊重叠）
      if (sys.windowWidth && menu.left < sys.windowWidth) {
        navRightPadding = sys.windowWidth - menu.left + 10;
      }
    }

    return {
      statusBarHeight,
      navBarHeight,
      navRightPadding,
    };
  } catch (e) {
    return {
      statusBarHeight: 20,
      navBarHeight: 44,
      navRightPadding: 96,
    };
  }
}
