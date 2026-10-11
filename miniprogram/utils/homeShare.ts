const HOME_PATH = "/pages/index/index";
const SHARE_TITLE = "Voling 日记 · 制作自己的 AI 绘本";

export const homeShareHandlers = {
  onShareAppMessage() {
    return { title: SHARE_TITLE, path: HOME_PATH };
  },
  onShareTimeline() {
    return { title: SHARE_TITLE, query: "" };
  },
};

export function enableHomeShareMenu(): void {
  wx.showShareMenu({ menus: ["shareAppMessage", "shareTimeline"] });
}
