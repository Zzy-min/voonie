// pages/profile/index.ts
import { diaryDraftKey, getCurrentUser, getPreferences, logoutUser, listDiaries, updatePreferences } from "../../utils/api";
import { getNavInfo } from "../../utils/nav";

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    navRightPadding: 96,
    nickname: "小主人",
    companionDays: 0,
    diaryCount: 0,
    comicCount: 0,
    voiceDays: 0,
    memoryOptIn: true,
  },

  onLoad() {
    const nav = getNavInfo();
    this.setData({
      statusBarHeight: nav.statusBarHeight,
      navBarHeight: nav.navBarHeight,
      navRightPadding: nav.navRightPadding,
    });
    this.loadUserData();
  },

  onShow() {
    const app = getApp();
    if (app && app.globalData) {
      app.globalData.activeTab = 4;
    }
    const tab = typeof this.getTabBar === "function" ? this.getTabBar() : null;
    if (tab && typeof tab.setSelected === "function") {
      tab.setSelected(4);
    }
    this.loadUserData();
  },

  async loadUserData() {
    try {
      const user = await getCurrentUser();
      if (user) {
        // 用后端 companion_days（真实同伴天数）；缺省回退到 created_at 本地计算，绝不写死 28
        let companion = user.companion_days;
        if (!companion && user.created_at) {
          const t = new Date(user.created_at);
          if (!Number.isNaN(t.getTime())) {
            const delta = (Date.now() - t.getTime()) / 86400000;
            companion = Math.max(1, Math.floor(delta) + 1);
          }
        }
        this.setData({
          nickname: user.nickname || "小主人",
          companionDays: companion || 0,
        });
      }
    } catch (e) {
      console.warn("Load user profile failed:", e);
    }

    try {
      const diaries = await listDiaries();
      const safeDiaries = Array.isArray(diaries) ? diaries : [];
      const dateSet = new Set<string>();
      let comic = 0;
      for (const d of safeDiaries) {
        if (!d) continue;
        if (d.panels && Array.isArray(d.panels) && d.panels.length > 0) comic++;
        const dateKey = this.diaryDateKey(d.entry_date || d.created_at || "", d.timezone || "Asia/Shanghai");
        if (dateKey) dateSet.add(dateKey);
      }
      this.setData({
        diaryCount: safeDiaries.length,
        comicCount: comic,
        // 真实“哪天写过或录过日记”的业务日期数；无则 0。
        voiceDays: dateSet.size,
      });
    } catch (e) {
      console.warn("Load diary statistics failed:", e);
    }

    try {
      const preferences = await getPreferences();
      this.setData({ memoryOptIn: preferences.memory_opt_in });
    } catch (e) {
      console.warn("Load memory preference failed:", e);
    }
  },

  diaryDateKey(iso: string, timezone: string): string {
    if (!iso) return "";
    const dateOnly = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dateOnly) return `${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]}`;
    const value = new Date(iso);
    if (Number.isNaN(value.getTime())) return "";
    try {
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).formatToParts(value);
      const values: Record<string, string> = {};
      for (const part of parts) values[part.type] = part.value;
      return values.year && values.month && values.day
        ? `${values.year}-${values.month}-${values.day}`
        : "";
    } catch {
      // Some WeChat JS runtimes expose Intl but not formatToParts. Keep the
      // business date deterministic for the app's default Shanghai timezone.
      if (timezone !== "Asia/Shanghai") return "";
      const fallback = new Date(value.getTime() + 8 * 60 * 60 * 1000);
      const year = fallback.getUTCFullYear();
      const month = fallback.getUTCMonth() + 1;
      const day = fallback.getUTCDate();
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  },

  onEditProfile() {
    wx.showModal({
      title: "修改昵称",
      editable: true,
      placeholderText: "1～12 个字符",
      content: this.data.nickname,
      success: async (res) => {
        if (!res.confirm) return;
        const nickname = (res.content || "").trim();
        if (!nickname || nickname.length > 12) {
          wx.showToast({ title: "昵称需为 1～12 个字符", icon: "none" });
          return;
        }
        try {
          const saved = await updatePreferences({ nickname });
          this.setData({ nickname: saved.nickname });
          wx.showToast({ title: "已保存", icon: "success" });
        } catch { wx.showToast({ title: "保存失败，请重试", icon: "none" }); }
      },
    });
  },

  onOpenSettings() {
    const enabled = this.data.memoryOptIn;
    wx.showActionSheet({
      itemList: [enabled ? "关闭 AI 记忆" : "开启 AI 记忆"],
      success: () => {
        const apply = async () => {
          try {
            const saved = await updatePreferences({ memory_opt_in: !enabled });
            this.setData({ memoryOptIn: saved.memory_opt_in });
            wx.showToast({ title: saved.memory_opt_in ? "已开启" : "已关闭并清除记忆", icon: "none" });
          } catch { wx.showToast({ title: "设置失败，请重试", icon: "none" }); }
        };
        if (!enabled) { apply(); return; }
        wx.showModal({
          title: "关闭 AI 记忆？",
          content: "关闭后会清除已提取的记忆和陪伴对话，私人日记仍保留。",
          confirmText: "关闭并清除",
          confirmColor: "#C4513A",
          success: (res) => { if (res.confirm) apply(); },
        });
      },
    });
  },

  onNavDiaries() {
    wx.switchTab({ url: "/pages/diary-home/index" });
  },

  onNavComics() {
    wx.navigateTo({ url: "/pages/bookshelf/index" });
  },

  onNavCalendar() {
    wx.navigateTo({ url: "/pages/calendar/index" });
  },

  onNavSquare() {
    wx.removeStorageSync("voling_square_mine_only");
    wx.switchTab({ url: "/pages/square/index" });
  },

  onNavMyShares() {
    wx.setStorageSync("voling_square_mine_only", true);
    wx.switchTab({ url: "/pages/square/index" });
  },

  onNavCharacters() {
    wx.navigateTo({ url: "/pages/characters/index" });
  },

  onNavAccountSecurity() {
    wx.navigateTo({ url: "/pages/account-security/index" });
  },

  onNavFeedback() {
    wx.navigateTo({ url: "/pages/feedback/index" });
  },

  onNavPrivacy() {
    wx.navigateTo({ url: "/pages/legal/index?type=privacy" });
  },

  onNavTerms() {
    wx.navigateTo({ url: "/pages/legal/index?type=terms" });
  },

  onLogout() {
    wx.showModal({
      title: "退出账号",
      content: "确定要退出当前账号吗？",
      confirmColor: "#C26741",
      success: async (res) => {
        if (res.confirm) {
          const app = getApp();
          const currentUserId = app && app.globalData && app.globalData.currentUser
            ? app.globalData.currentUser.id
            : "";
          const accountDraftKey = diaryDraftKey();
          await logoutUser();
          wx.removeStorageSync(accountDraftKey);
          wx.removeStorageSync("voonie_diary_draft");
          if (currentUserId) {
            const editDraftPrefix = `voonie_diary_edit_draft:${currentUserId}:`;
            const storageInfo = wx.getStorageInfoSync();
            for (const key of storageInfo.keys || []) {
              if (key.indexOf(editDraftPrefix) === 0) wx.removeStorageSync(key);
            }
          }
          if (app && app.globalData) {
            app.globalData.currentUser = null;
            app.globalData.token = null;
            app.globalData.hasDraft = false;
          }
          wx.showToast({ title: "已退出", icon: "success" });
          setTimeout(() => {
            // 重置整个页面栈，防止退出后通过返回手势看到账号缓存页面。
            wx.reLaunch({ url: "/pages/auth/index" });
          }, 500);
        }
      },
    });
  },
});
