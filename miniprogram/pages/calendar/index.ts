// pages/calendar/index.ts - 回忆日历（日记子页）
// Q&A-FIX(P1)：真实年月网格 + hasDiary/当日卡片全部来自 listDiaries 聚合，禁止硬编码日期。
// 顶部返回回到手帐根页；点日期进该日对应日记。
import { authenticatedMediaUrl, listDiaries, DiaryItem } from "../../utils/api";

interface CalendarDay {
  id: string;
  day: number;
  lunar: string;
  isCurrentMonth: boolean;
  isSelected: boolean;
  hasDiary: boolean;
}

interface DayMemory {
  id: string;
  title: string;
  mood: string;
  time: string;
  image_url: string;
  summary: string;
  imageCount: number;
}

// 本地日历 YYYY-MM-DD
function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

import { getNavInfo } from "../../utils/nav";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    navRightPadding: 96,
    year: 2026,
    month: 9,
    selectedDate: 5,
    todayKey: "",
    calendarDays: [] as CalendarDay[],
    currentMonthDiaries: 0 as number,
    dayMemories: [] as DayMemory[],
    loading: true,
    failed: false,
    scrollTop: 0,
  },

  // 后端按业务 entry_date 聚合：key -> DiaryItem[]
  diariesByDate: {} as Record<string, DiaryItem[]>,
  allDiaries: [] as DiaryItem[],
  _initedOnce: false as boolean,
  stateKey: "voling_calendar_state",

  onLoad() {
    const nav = getNavInfo();
    const now = new Date();
    const saved = wx.getStorageSync(this.stateKey) || {};
    this.setData({
      statusBarHeight: nav.statusBarHeight,
      navBarHeight: nav.navBarHeight,
      navRightPadding: nav.navRightPadding,
      year: Number(saved.year) || now.getFullYear(),
      month: Number(saved.month) || now.getMonth() + 1,
      selectedDate: Number(saved.selectedDate) || now.getDate(),
      scrollTop: Number(saved.scrollTop) || 0,
      todayKey: toDateKey(now),
    });
    this.generateCalendar();
    this.fetchDiaries();
  },

  onShow() {
    // 回忆日历属于日记模块的子页，不占用根 Tab。
    // 首次 onLoad 已请求数据，后续回到页面时刷新。
    if (this._initedOnce) {
      this.fetchDiaries();
    }
    this._initedOnce = true;
  },

  // 拉取用户日记并按本地日期聚合（禁止硬编码日期标记）
  async fetchDiaries() {
    this.setData({ loading: true, failed: false });
    try {
      const list = await listDiaries();
      this.allDiaries = Array.isArray(list) ? list : [];
      const map: Record<string, DiaryItem[]> = {};
      for (const d of this.allDiaries) {
        if (!d) continue;
        const key = this.diaryDateKey(d);
        if (!key) continue;
        if (!map[key]) map[key] = [];
        map[key].push(d);
      }
      this.diariesByDate = map;
      this.generateCalendar();
      this.renderTodayMemories();
    } catch (e) {
      console.warn("Fetch diaries error:", e);
      this.setData({ loading: false, failed: true, dayMemories: [] });
    }
  },

  // 优先使用用户记录时提交的业务日期和时区；旧数据才回退 created_at。
  diaryDateKey(d: DiaryItem): string {
    const iso = d.entry_date || d.created_at || "";
    if (!iso) return "";
    const dateOnly = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dateOnly) return `${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]}`;
    const t = new Date(iso);
    if (Number.isNaN(t.getTime())) return "";
    const tz = d.timezone || "Asia/Shanghai";
    try {
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: tz,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).formatToParts(t);
      const year = parts.find((part) => part.type === "year")?.value;
      const month = parts.find((part) => part.type === "month")?.value;
      const day = parts.find((part) => part.type === "day")?.value;
      if (year && month && day) return `${year}-${month}-${day}`;
    } catch (_) {}
    if (tz !== "Asia/Shanghai") return "";
    const shanghai = new Date(t.getTime() + 8 * 60 * 60 * 1000);
    return `${shanghai.getUTCFullYear()}-${pad(shanghai.getUTCMonth() + 1)}-${pad(shanghai.getUTCDate())}`;
  },

  // 依据当前 year/month 生成完整月历网格（含上月/下月占位）
  generateCalendar() {
    const { year, month } = this.data;
    const first = new Date(year, month - 1, 1);
    const startWeekday = first.getDay(); // 0-6
    const daysInMonth = new Date(year, month, 0).getDate();

    const cells: CalendarDay[] = [];

    // 上月占位
    const prevDaysInMonth = new Date(year, month - 1, 0).getDate();
    for (let i = startWeekday - 1; i >= 0; i--) {
      const day = prevDaysInMonth - i;
      cells.push({
        id: `prev-${this.data.year}-${day}`,
        day,
        lunar: "",
        isCurrentMonth: false,
        isSelected: false,
        hasDiary: false,
      });
    }

    // 当月
    for (let d = 1; d <= daysInMonth; d++) {
      const key = `${year}-${pad(month)}-${pad(d)}`;
      const diaries = this.diariesByDate[key] || [];
      cells.push({
        id: `cur-${key}`,
        day: d,
        lunar: "",
        isCurrentMonth: true,
        isSelected: d === this.data.selectedDate,
        hasDiary: diaries.length > 0,
      });
    }

    // 下月补齐 7 列（至多 6 行）
    let nextDay = 1;
    while (cells.length % 7 !== 0) {
      cells.push({
        id: `next-${year}-${month}-${nextDay}`,
        day: nextDay,
        lunar: "",
        isCurrentMonth: false,
        isSelected: false,
        hasDiary: false,
      });
      nextDay++;
    }

    const monthPrefix = `${year}-${pad(month)}-`;
    const currentMonthDiaries = Object.keys(this.diariesByDate).filter((key) => key.startsWith(monthPrefix)).length;
    this.setData({ calendarDays: cells, loading: false, currentMonthDiaries });
  },

  // 渲染当前选中日期对应的回忆卡
  async renderTodayMemories() {
    const { year, month, selectedDate } = this.data;
    const key = `${year}-${pad(month)}-${pad(selectedDate)}`;
    const diaries = [...(this.diariesByDate[key] || [])].sort((a, b) =>
      new Date(b.entry_date || b.created_at || 0).getTime() - new Date(a.entry_date || a.created_at || 0).getTime()
    );

    const mem: DayMemory[] = await Promise.all(diaries.map(async (d) => ({
      id: d.id,
      title: d.title || "未命名手帐",
      mood: d.mood || "平静",
      time: this.formatTime(d.created_at),
      image_url:
        d.panels && d.panels[0]?.image_url
          ? await authenticatedMediaUrl(d.panels[0].image_url)
          : "/assets/images/ui/card-sleep-cushion.png",
      summary: (d.full_content || d.summary || "").replace(/\s+/g, " ").slice(0, 68),
      imageCount: Array.isArray(d.panels) ? d.panels.filter((panel) => panel.image_url).length : 0,
    })));

    this.setData({
      dayMemories: mem,
      failed: false,
    });
  },

  formatTime(iso: string): string {
    if (!iso) return "";
    const t = new Date(iso);
    if (Number.isNaN(t.getTime())) return "";
    return `${pad(t.getHours())}:${pad(t.getMinutes())}`;
  },

  onSelectDay(e: WechatMiniprogram.BaseEvent) {
    const { day, isCur } = e.currentTarget.dataset;
    if (isCur === false || isCur === "false") return; // 其它月份占位不可选
    const dayNum = Number(day);
    if (!dayNum || dayNum < 1) return;
    const { year, month } = this.data;
    // 更新选中态
    const updated = this.data.calendarDays.map((d) => ({
      ...d,
      isSelected: d.isCurrentMonth && d.day === dayNum,
    }));
    this.setData({ selectedDate: dayNum, calendarDays: updated });
    this.persistState({ selectedDate: dayNum });
    // 日期只负责筛选。即使只有一篇，也先展示当天列表，不自动进入详情。
    this.renderTodayMemories();
  },

  onPrevMonth() {
    let { year, month } = this.data;
    month -= 1;
    if (month < 1) {
      month = 12;
      year -= 1;
    }
    this.switchMonth(year, month);
  },

  onNextMonth() {
    let { year, month } = this.data;
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
    this.switchMonth(year, month);
  },

  switchMonth(year: number, month: number) {
    // 保持选中到 1 号附近合理范围
    const daysInMonth = new Date(year, month, 0).getDate();
    const selectedDate = Math.min(this.data.selectedDate, daysInMonth);
    this.setData({ year, month, selectedDate });
    this.persistState({ year, month, selectedDate });
    this.generateCalendar();
    this.renderTodayMemories();
  },

  onPickYear() {
    const cur = this.data.year;
    const years = [cur - 2, cur - 1, cur, cur + 1].map((y, i) => `${y}年`);
    wx.showActionSheet({
      itemList: years,
      success: (res) => {
        const target = cur - 2 + res.tapIndex;
        this.setData({ year: target });
        this.persistState({ year: target });
        this.generateCalendar();
        this.renderTodayMemories();
      },
    });
  },

  onPickMonth() {
    const list = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];
    wx.showActionSheet({
      itemList: list,
      success: (res) => {
        this.switchMonth(this.data.year, res.tapIndex + 1);
      },
    });
  },

  onOpenDiary(e: WechatMiniprogram.BaseEvent) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/diary/index?id=${id}` });
  },

  onRetryMemories() {
    this.fetchDiaries();
  },

  onWriteSelectedDay() {
    const { year, month, selectedDate } = this.data;
    wx.setStorageSync("voling_record_date", `${year}-${pad(month)}-${pad(selectedDate)}`);
    wx.navigateTo({ url: "/pages/record/index" });
  },

  onCalendarScroll(e: WechatMiniprogram.CustomEvent) {
    const scrollTop = Number((e.detail as any).scrollTop) || 0;
    this.setData({ scrollTop });
    this.persistState({ scrollTop });
  },

  persistState(patch: Record<string, number>) {
    wx.setStorageSync(this.stateKey, Object.assign({
      year: this.data.year,
      month: this.data.month,
      selectedDate: this.data.selectedDate,
      scrollTop: this.data.scrollTop,
    }, patch));
  },

  onSearchClick() {
    wx.showModal({
      title: "搜索回忆",
      editable: true,
      placeholderText: "输入标题或心情",
      success: (res) => {
        if (!res.confirm) return;
        const query = (res.content || "").trim().toLowerCase();
        if (!query) {
          this.renderTodayMemories();
          return;
        }
        const matched = this.allDiaries.filter((diary) =>
          `${diary.title || ""} ${diary.mood || ""} ${diary.full_content || ""}`.toLowerCase().includes(query)
        );
        if (!matched.length) {
          wx.showToast({ title: "没有找到相关回忆", icon: "none" });
          return;
        }
        wx.navigateTo({ url: `/pages/diary/index?id=${matched[0].id}` });
      },
    });
  },

  // 顶部返回：回到日记 Tab 根页（手帐/日记本）
  onBack() {
    wx.navigateBack({
      fail: () => {
        wx.switchTab({ url: "/pages/diary-home/index" });
      },
    });
  },

  // 引导条：回到手帐体系
  onBackToJournal() {
    wx.navigateBack({
      fail: () => {
        wx.switchTab({ url: "/pages/diary-home/index" });
      },
    });
  },
});
