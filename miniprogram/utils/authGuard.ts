import { getAccessToken } from "./api";

export function requireLogin(reason = "登录后即可保存并同步你的记录"): boolean {
  if (getAccessToken()) return true;
  wx.showModal({
    title: "登录后继续",
    content: reason,
    confirmText: "去登录",
    cancelText: "先看看",
    confirmColor: "#E8A74C",
    success: (result) => {
      if (result.confirm) wx.navigateTo({ url: "/pages/auth/index" });
    },
  });
  return false;
}
