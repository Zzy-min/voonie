import { getNavInfo } from "../../utils/nav";
import { enableHomeShareMenu, homeShareHandlers } from "../../utils/homeShare";

Page({
  ...homeShareHandlers,
  data: { statusBarHeight: 20, navBarHeight: 44, navRightPadding: 96 },
  onLoad() {
    enableHomeShareMenu();
    const nav = getNavInfo();
    this.setData({ statusBarHeight: nav.statusBarHeight, navBarHeight: nav.navBarHeight, navRightPadding: nav.navRightPadding });
  },
  onBack() { wx.navigateBack(); },
});