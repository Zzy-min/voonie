// pages/generation/index.ts
import { diaryDraftKey, waitForJob, listDiaries, getDiaryDetail, retryJob, JobCanceledError } from "../../utils/api";
import { getNavInfo } from "../../utils/nav";

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    navRightPadding: 96,
    jobId: "",
    entryId: "",
    step: 1,
    percent: 0,
    failed: false,
    errorMsg: "",
  },

  onLoad(options: Record<string, string | undefined>) {
    const nav = getNavInfo();
    this.setData({
      statusBarHeight: nav.statusBarHeight,
      navBarHeight: nav.navBarHeight,
      navRightPadding: nav.navRightPadding,
      jobId: options.jobId || "",
      entryId: options.entryId || "",
    });

    if (!this.data.jobId) {
      // 无 jobId（异常直达页面）时也不伪造成功，展示可重试错误态
      this.showFailure("缺少生成任务，请重新录制或稍后重试");
      return;
    }
    this.startJobPolling();
  },

  // 页面被销毁（navigateBack / reLaunch / redirectTo 离开）时置位：终止后台轮询，禁止再 setData / redirectTo。
  onUnload() {
    this._destroyed = true;
    this._pollGen++; // 令所有在途轮询代数失效，静默退出
  },

  _destroyed: false as boolean,
  // 单调递增“轮询代数”：新轮 startJobPolling 自增并用局部 gen 捕获；
  // 旧轮若发现 this._pollGen 已变化（被新轮取代或页面销毁）即停止，从而天然防双轮询。
  _pollGen: 0 as number,

  async startJobPolling() {
    const jobId = this.data.jobId;
    // 本轮代数：每次开启新轮都 +1。重试时会 `++_pollGen`，旧轮的 shouldContinue 因代数不匹配而返回 false，静默退出。
    const gen = ++this._pollGen;
    try {
      // 真实轮询 Job 状态（stage: planning -> rendering -> finalizing -> done）
      await waitForJob(
        jobId,
        (status) => {
          // 页面已销毁，或本轮已被更新的轮次取代 → 不再更新视图
          if (!this._destroyed && this._pollGen === gen) {
            const map: Record<string, number> = {
              planning: 3,
              rendering: 4,
              finalizing: 4,
            };
            const step = map[status.stage] || ((status.status === "running" || status.status === "queued") ? 2 : 3);
            this.setData({
              step,
              percent: Math.round((status.progress || 0) * 100),
            });
          }
        },
        // 页面销毁或本轮已被其它轮取代（代数不匹配）时终止轮询，避免双轮询后台重复请求
        () => !this._destroyed && this._pollGen === gen
      );

      // 完成后：仅当仍是当前代且页面存活才推进（不留于已过期的旧轮）
      if (this._destroyed || this._pollGen !== gen) return;
      this.setData({ step: 5, percent: 100, failed: false });
      findAndDeleteDraft(this);

      setTimeout(() => {
        if (this._destroyed || this._pollGen !== gen) return; // 延期间页面可能已销毁/被取代：禁止再跳转
        this.navigateToDiaryDetail();
      }, 600);
    } catch (err: any) {
      if (this._destroyed || this._pollGen !== gen || (err && err instanceof JobCanceledError)) {
        return; // 页面已销毁 / 本轮已被取代 / 主动取消：静默退出，不 toast「失败」
      }
      console.warn("Job waiting failed:", err);
      this.showFailure(err && err.message ? err.message : "日记生成失败，请稍后重试。");
    }
  },

  showFailure(msg: string) {
    // 失败时保留草稿，用户可继续重试，不把一次网络/生成失败变成内容丢失。
    this.setData({ failed: true, errorMsg: msg, step: 2, percent: 0 });
  },

  async onRetry() {
    if (!this.data.failed || !this.data.jobId) return;
    this.setData({ failed: false, errorMsg: "" });
    try {
      await retryJob(this.data.jobId);
      this.startJobPolling();
    } catch (err: any) {
      this.showFailure(err && err.message ? err.message : "重试失败，请稍后再试");
    }
  },

  async navigateToDiaryDetail() {
    // 优先跳转「本次任务」对应的日记：日记 id == job_id（/diaries/{job_id}）
    const jobId = this.data.jobId;
    if (jobId) {
      try {
        await getDiaryDetail(jobId);
        wx.redirectTo({ url: `/pages/diary/index?id=${jobId}` });
        return;
      } catch (e) {
        console.warn("本轮日记尚未就绪，回退到最近一篇:", e);
      }
    }
    try {
      const diaries = await listDiaries();
      const target = diaries && diaries.length > 0 ? diaries[0] : null;
      const diaryId = target ? target.id : (this.data.entryId || this.data.jobId);
      wx.redirectTo({
        url: `/pages/diary/index?id=${diaryId}`,
      });
    } catch {
      wx.redirectTo({
        url: `/pages/diary/index?id=${this.data.entryId || this.data.jobId || "latest"}`,
      });
    }
  },

  onSkip() {
    if (this.data.failed) return;
    this.navigateToDiaryDetail();
  },

  onBack() {
    wx.reLaunch({ url: "/pages/index/index" });
  },
});

// 仅在生成完成后清理本地草稿；失败态必须保留，以便恢复。
function findAndDeleteDraft(page: any) {
  try {
    wx.removeStorageSync(diaryDraftKey());
  } catch (e) {
    /* ignore */
  }
  void page;
}
