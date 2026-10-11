// pages/record/index.ts
import { recorderInstance } from "../../utils/recorder";
import {
  uploadVoiceFile,
  createTextEntry,
  createComicJob,
  uploadDiaryReference,
  diaryDraftKey,
  ensureIdempotencyKey,
  localTimezone,
  nowIsoDate,
  getCurrentUser,
  getActiveCharacterId,
  findJobByKey,
  registerLocalRecording,
} from "../../utils/api";
import { getNavInfo } from "../../utils/nav";
import { readDiaryDraft, writeDiaryDraft } from "../../utils/draftStorage";
import { createPool } from "../../utils/asyncPool";
import { normalizeReferences, paragraphAnchor } from "../../utils/referenceDraft";
import { enableHomeShareMenu, homeShareHandlers } from "../../utils/homeShare";

const INSPIRATIONS = [
  "今天发生了一些让我高兴的事……",
  "下班路上的晚霞特别温柔……",
  "今天和朋友吃了好吃的晚餐……",
  "虽然有点累，但坚持完成了一项挑战……",
];

Page({
  ...homeShareHandlers,
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    navRightPadding: 96,
    isRecording: false,
    isPaused: false,
    isStarting: false,
    durationText: "00:00",
    currentInspiration: INSPIRATIONS[0],
    inspirationIdx: 0,
    tempAudioPath: "",
    draftLocalId: "",
    isUploading: false,
    uploadFailed: false,
    draftText: "",
    transcribedEntryId: "",
    textSubmitting: false,
    draftStorageFailed: false,
    trialLimitReached: false,
    references: [] as Array<{ key: string; path: string; id: string; entryId: string; type: "subject" | "style" | "scene" | "tone" | "combined"; typeLabel: string; includeInContent: boolean; progress: number; status: string; missing: boolean }>,
    choosingReference: false,
    stylePreset: "warm_watercolor" as "chibi_manga" | "warm_watercolor" | "anime_cel" | "retro_comic",
    styleLabel: "治愈水彩",
    aspectRatio: "4:3" as "1:1" | "4:3" | "3:4",
    targetEntryDate: "",
    waveAmps: [18, 30, 22, 40, 26, 34, 20],
  },

  waveTimer: 0 as any,
  discardNextStop: false,
  pageActive: false,
  deferUpload: false,
  pendingDraftPrompted: false,
  missingReferencePrompted: false,

  onLoad() {
    enableHomeShareMenu();
    this.pageActive = true;
    const nav = getNavInfo();
    const targetEntryDate = wx.getStorageSync("voling_record_date") || "";
    wx.removeStorageSync("voling_record_date");
    this.setData({
      statusBarHeight: nav.statusBarHeight,
      navBarHeight: nav.navBarHeight,
      navRightPadding: nav.navRightPadding,
      targetEntryDate,
    });

    this.setupRecorder();
    this.restoreAudioDraft();
  },

  onHide() {
    if (this.data.isRecording && !this.data.isPaused) {
      recorderInstance.pause();
    }
  },

  onShow() {
    this.pageActive = true;
    this.restoreAudioDraft();
    this.refreshTrialState();
    this.offerPendingGuestDraft();
  },

  offerPendingGuestDraft() {
    const userId = getApp<any>()?.globalData?.currentUser?.id;
    if (!userId || this.pendingDraftPrompted) return;
    const pendingKey = `voonie_pending_guest_draft:${userId}`;
    const pending = wx.getStorageSync(pendingKey);
    if (!pending) return;
    this.pendingDraftPrompted = true;
    wx.showModal({
      title: "恢复游客草稿",
      content: "当前账号也有未完成草稿。是否改为继续编辑游客草稿？原账号草稿会保留在本机。",
      confirmText: "恢复游客草稿",
      cancelText: "保留当前草稿",
      confirmColor: "#E8A74C",
      success: (result) => {
        if (!result.confirm) return;
        const currentKey = diaryDraftKey();
        const currentDraft = wx.getStorageSync(currentKey);
        if (currentDraft) wx.setStorageSync(`voonie_saved_account_draft:${userId}`, currentDraft);
        wx.setStorageSync(currentKey, pending);
        wx.removeStorageSync(pendingKey);
        this.restoreAudioDraft();
      },
    });
  },

  async refreshTrialState() {
    try {
      const user = await getCurrentUser();
      this.setData({ trialLimitReached: Boolean(user && !user.wechat_bound && user.guest_generations_remaining === 0) });
    } catch (_) {
      // The server checks the limit again when a generation job is submitted.
    }
  },

  onUnload() {
    this.pageActive = false;
    this.stopWave();
    if (this.data.isRecording || this.data.isStarting) {
      this.deferUpload = true;
      recorderInstance.stop();
    }
  },

  setupRecorder() {
    recorderInstance.setCallbacks({
      onStart: () => {
        if (!this.pageActive) {
          this.discardNextStop = true;
          recorderInstance.stop();
          return;
        }
        this.setData({ isRecording: true, isPaused: false, isStarting: false });
        this.startTimerDisplay();
        this.startWave();
      },
      onPause: () => {
        if (!this.pageActive) return;
        this.setData({ isPaused: true });
        this.stopWave();
      },
      onResume: () => {
        if (!this.pageActive) return;
        this.setData({ isPaused: false });
        this.startWave();
      },
      onStop: (res) => {
        const shouldDiscard = this.discardNextStop;
        this.discardNextStop = false;
        this.stopWave();
        if (shouldDiscard) {
          if (this.pageActive) {
            this.setData({ isRecording: false, isPaused: false, isStarting: false, tempAudioPath: "", durationText: "00:00" });
          }
          return;
        }
        const localId = this.data.draftLocalId || ensureIdempotencyKey();
        const deferUpload = this.deferUpload;
        this.deferUpload = false;
        this.persistAudioDraft(res.tempFilePath, localId, res.duration).then((savedPath) => {
          if (!this.pageActive) return;
          this.setData({
            isRecording: false,
            isPaused: false,
            isStarting: false,
            tempAudioPath: savedPath,
            draftLocalId: localId,
            uploadFailed: deferUpload,
          });
          if (deferUpload) return;
          this.handleRecordFinished(savedPath, localId);
        }).catch((error) => {
          console.error("Save audio draft failed:", error);
          if (!this.pageActive) return;
          this.setData({ isRecording: false, isPaused: false, isStarting: false, uploadFailed: true });
          wx.showToast({ title: "录音保存失败，请重新录制", icon: "none" });
        });
      },
      onError: (err) => {
        console.error("Record error:", err);
        this.discardNextStop = false;
        this.stopWave();
        if (!this.pageActive) return;
        wx.showToast({
          title: "录音发生中断，请稍后重试",
          icon: "none",
        });
        this.setData({ isRecording: false, isPaused: false, isStarting: false });
      },
      onFrameRecord: (res) => {
        if (!this.pageActive) return;
        // 收到真实音频帧 → 以 PCM 音量驱动波形（不再纯随机）
        this.applyVolume(res.frameBuffer);
      },
    });
  },

  // 从 frameBuffer（PCM Int16，16KHz mono）粗算 RMS 音量并映射到柱高
  applyVolume(frameBuffer: ArrayBuffer) {
    if (!this.data.isRecording || this.data.isPaused) return;
    const now = Date.now();
    this.lastRealFrameAt = now;
    // P3-4: 节流——至少 110ms 才 setData 一次，降低 ~30 帧/秒的渲染压力
    if (now - (this._lastWaveSetDataAt || 0) < 110) return;
    this._lastWaveSetDataAt = now;
    let sum = 0;
    const samples = new Int16Array(frameBuffer);
    const len = samples.length;
    if (!len) return;
    for (let i = 0; i < len; i++) {
      sum += samples[i] * samples[i];
    }
    const rms = Math.sqrt(sum / len);
    const pct = Math.min(1, rms / 16000); // 16bit 满量程下轻微噪声即数百，动态压缩到柱高
    const amp = 8 + Math.round(pct * 62);
    const jitter = Math.round((Math.random() - 0.5) * 8);
    const next = this.data.waveAmps.map(() =>
      Math.max(6, Math.min(70, amp + jitter))
    );
    this.setData({ waveAmps: next });
  },

  async startRecording() {
    if (!this.pageActive || this.data.isRecording || this.data.isStarting) return;
    this.discardNextStop = false;
    this.setData({ isStarting: true, uploadFailed: false, draftLocalId: ensureIdempotencyKey() });
    try {
      await recorderInstance.start();
    } catch (err: any) {
      if (!this.pageActive) return;
      this.setData({ isStarting: false });
      if (err.message === "permission_denied") {
        wx.showModal({
          title: "需要麦克风权限",
          content: "Voonie 需要使用您的麦克风来记录温馨语音，请在设置中开启麦克风权限。",
          confirmText: "去开启",
          confirmColor: "#D9845B",
          success: (res) => {
            if (res.confirm) {
              wx.openSetting();
            } else {
              wx.navigateBack();
            }
          },
        });
      } else {
        wx.showToast({ title: "暂时无法开始录音，请重试", icon: "none" });
      }
    }
  },

  // AAC 不提供 PCM 帧时仅显示稳定的“正在录音”活动节奏，不宣称代表真实音量。
  lastRealFrameAt: 0 as any,
  _lastWaveSetDataAt: 0 as any,
  startWave() {
    this.stopWave();
    this.lastRealFrameAt = Date.now();
    this.waveTimer = setInterval(() => {
      if (!this.pageActive || !this.data.isRecording || this.data.isPaused) return;
      // 若没有真实帧，使用固定循环活动指示，避免随机动画被误解为声音强弱。
      if (Date.now() - this.lastRealFrameAt > 400) {
        const patterns = [[18, 30, 22, 40, 26, 34, 20], [26, 18, 34, 24, 42, 22, 30], [20, 38, 24, 30, 18, 40, 26]];
        const next = patterns[Math.floor(Date.now() / 480) % patterns.length];
        this.setData({ waveAmps: next });
      }
    }, 160);
  },

  stopWave() {
    if (this.waveTimer) {
      clearInterval(this.waveTimer);
      this.waveTimer = 0;
    }
    this.lastRealFrameAt = 0;
  },

  startTimerDisplay() {
    const timer = setInterval(() => {
      if (!this.pageActive || !this.data.isRecording) {
        clearInterval(timer);
        return;
      }
      this.setData({
        durationText: recorderInstance.getFormatDuration(),
      });
    }, 1000);
  },

  onSwitchInspiration() {
    const nextIdx = (this.data.inspirationIdx + 1) % INSPIRATIONS.length;
    this.setData({
      inspirationIdx: nextIdx,
      currentInspiration: INSPIRATIONS[nextIdx],
    });
  },

  onDraftTextInput(e: WechatMiniprogram.Input) {
    const draftText = e.detail.value;
    this.setData({ draftText });
    const key = diaryDraftKey();
    const current = readDiaryDraft(key);
    const saved = writeDiaryDraft(key, Object.assign({}, current, {
      text: draftText,
      status: "text-draft",
      updatedAt: Date.now(),
    }));
    if (!saved && !this.data.draftStorageFailed) {
      this.setData({ draftStorageFailed: true });
      wx.showToast({ title: "草稿保存失败，请勿退出并检查存储空间", icon: "none" });
    } else if (saved && this.data.draftStorageFailed) {
      this.setData({ draftStorageFailed: false });
    }
  },

  async onSubmitText() {
    if (this.data.textSubmitting || this.data.isUploading || this.data.choosingReference) return;
    const text = (this.data.draftText || "").trim();
    if (text.length < 2 || this.data.textSubmitting || this.data.isUploading) {
      wx.showToast({ title: text ? "再多写一点吧" : "先说或写下今天发生的事", icon: "none" });
      return;
    }
    this.setData({ textSubmitting: true });
    try {
      const original = readDiaryDraft(diaryDraftKey());
      const currentSnapshot = JSON.stringify({ text, ids: this.data.references.map((ref) => ref.id), style: this.data.stylePreset, aspect: this.data.aspectRatio, character: getActiveCharacterId() });
      if (original.comicIdempotencyKey && original.comicRequestSnapshot === currentSnapshot) {
        const recovered = await findJobByKey(original.comicIdempotencyKey);
        if (recovered && ["queued", "running", "done"].includes(recovered.status)) {
          wx.navigateTo({ url: `/pages/generation/index?jobId=${recovered.job_id}&entryId=${original.entryId}` });
          this.setData({ textSubmitting: false }); return;
        }
      }
      if (!await this.canGenerateDiary()) { this.setData({ textSubmitting: false }); return; }
      const savedDraft = readDiaryDraft(diaryDraftKey());
      const scopeKey = diaryDraftKey();
      const knownText = savedDraft.confirmedText || (savedDraft.entryId ? savedDraft.text : "");
      const localId = savedDraft.localId && (text === knownText || text === savedDraft.pendingText) ? savedDraft.localId : ensureIdempotencyKey();
      if (!writeDiaryDraft(scopeKey, { ...savedDraft, localId, pendingText: text })) throw new Error("草稿保存失败，请检查存储空间");
      let entryId = text === knownText ? (savedDraft.entryId || this.data.transcribedEntryId) : "";
      if (!entryId) {
        const metadata = this.getEntryMetadata();
        const entry = await createTextEntry(text, metadata.entryDate, metadata.timezone, localId);
        entryId = entry.id;
      }
      if (scopeKey !== diaryDraftKey()) throw new Error("账号已切换，请重新打开草稿");
      const references = this.data.references.map((item) => ({ ...item }));
      const persist = () => {
        if (scopeKey !== diaryDraftKey()) return;
        this.setData({ references });
        const draft = readDiaryDraft(scopeKey);
        if (!writeDiaryDraft(scopeKey, { ...draft, entryId, text, confirmedText: text, localId, references, status: "text-draft", updatedAt: Date.now() })) {
          throw new Error("草稿保存失败，请检查存储空间后重试");
        }
      };
      persist();
      const pool = createPool(2);
      const results = await Promise.all(references.map((item, index) => pool(async () => {
        if (item.id && item.entryId === entryId) return;
        item.status = "uploading"; item.progress = 0; persist();
        try {
          if (item.missing || !item.path) throw new Error("参考图已失效，请更换后重试");
          const uploaded = await uploadDiaryReference(entryId, item.path, {
            type: item.type, includeInContent: item.includeInContent,
            paragraphAnchor: paragraphAnchor(text, index, references.length),
            onProgress: (percent) => { item.progress = percent; if (scopeKey === diaryDraftKey()) this.setData({ references }); },
          });
          item.id = uploaded.id; item.entryId = entryId; item.status = "uploaded"; item.progress = 100;
          persist(); return null;
        } catch (error: any) {
          item.status = "failed"; persist(); return error;
        }
      })));
      if (results.some(Boolean)) throw new Error("有参考图未上传成功，点按该图重试，已上传图片会保留");
      if (scopeKey !== diaryDraftKey()) throw new Error("账号已切换");
      const ids = references.map((item) => item.id);
      const characterId = getActiveCharacterId();
      const jobKey = `${localId}-comic-${ids.join("-")}-${this.data.stylePreset}-${this.data.aspectRatio}-${characterId}`;
      const pendingDraft = readDiaryDraft(scopeKey);
      const snapshot = JSON.stringify({ text, ids, style: this.data.stylePreset, aspect: this.data.aspectRatio, character: characterId });
      if (!writeDiaryDraft(scopeKey, { ...pendingDraft, comicIdempotencyKey: jobKey, comicRequestSnapshot: snapshot, stylePreset: this.data.stylePreset, aspectRatio: this.data.aspectRatio })) throw new Error("草稿保存失败，请重试");
      // Replaying this exact key recovers a queued job after an ambiguous network timeout.
      const job = await createComicJob(entryId, jobKey, characterId, ids.length ? { ids, type: "combined" } : undefined, {
        stylePreset: this.data.stylePreset, aspectRatio: this.data.aspectRatio,
      });
      if (scopeKey !== diaryDraftKey()) throw new Error("账号已切换");
      const currentDraft = readDiaryDraft(scopeKey);
      writeDiaryDraft(scopeKey, { ...currentDraft, entryId, text, confirmedText: text, localId, jobId: job.job_id, references, status: "generating", updatedAt: Date.now() });
      this.setData({ textSubmitting: false });
      wx.navigateTo({ url: `/pages/generation/index?jobId=${job.job_id}&entryId=${entryId}` });
    } catch (err: any) {
      this.setData({ textSubmitting: false });
      if (err?.code === "wechat_login_required_after_trial") {
        this.showTrialLimit();
        return;
      }
      wx.showToast({ title: err?.message || "整理失败，请重试", icon: "none" });
    }
  },

  showTrialLimit() {
    wx.showModal({
      title: "登录后继续创作",
      content: "两篇游客日记已生成。登录微信后可以继续生成，当前草稿会保留。",
      confirmText: "去登录",
      cancelText: "稍后再说",
      confirmColor: "#E8A74C",
      success: (result) => {
        if (result.confirm) wx.navigateTo({ url: "/pages/auth/index?trial=done" });
      },
    });
  },

  async canGenerateDiary(): Promise<boolean> {
    try {
      await getApp<any>().initSession();
      const user = await getCurrentUser();
      if (!user) {
        wx.showToast({ title: "暂时无法连接，请稍后重试", icon: "none" });
        return false;
      }
      const legacyDraft = wx.getStorageSync("voonie_diary_draft");
      const scopedDraftKey = `voonie_diary_draft:${user.id}`;
      if (legacyDraft && !wx.getStorageSync(scopedDraftKey)) wx.setStorageSync(scopedDraftKey, legacyDraft);
      if (!user.wechat_bound && user.guest_generations_remaining === 0) {
        this.setData({ trialLimitReached: true });
        this.showTrialLimit();
        return false;
      }
      this.setData({ trialLimitReached: false });
      return true;
    } catch (err: any) {
      wx.showToast({ title: err?.message || "暂时无法检查生成额度", icon: "none" });
      return false;
    }
  },

  onVoiceTouchStart() {
    if (this.data.trialLimitReached) {
      this.showTrialLimit();
      return;
    }
    if (this.data.isUploading || this.data.textSubmitting || this.data.isRecording || this.data.isStarting) return;
    this.startRecording();
  },

  onVoiceTouchEnd() {
    if (!this.data.isRecording) return;
    if (recorderInstance.getDuration() < 1) {
      this.discardNextStop = true;
      recorderInstance.stop();
      wx.showToast({ title: "按住久一点再说", icon: "none" });
      return;
    }
    recorderInstance.stop();
  },

  onTogglePause() {
    if (!this.data.isRecording) return;
    if (this.data.isPaused) {
      recorderInstance.resume();
    } else {
      recorderInstance.pause();
    }
  },

  onResetRecord() {
    wx.showModal({
      title: "重新录制",
      content: "确定要重新开始说吗？当前的录音内容将不会保留。",
      confirmColor: "#D9845B",
        success: (res) => {
          if (res.confirm) {
            if (this.data.isRecording || this.data.isStarting) {
              this.discardNextStop = true;
              recorderInstance.stop();
            } else {
              this.startRecording();
            }
          }
        },
      });
  },

  async onPrimaryRecordTap() {
    if (!await this.canGenerateDiary()) return;
    if (this.data.isUploading || this.data.textSubmitting) return;
    if (!this.data.isRecording) {
      this.startRecording();
    }
  },

  onFinishRecord() {
    if (!this.data.isRecording || this.data.isUploading) return;
    if (recorderInstance.getDuration() < 2) {
      wx.showToast({
        title: "说得太短啦，再多和 Voonie 聊聊吧🐾",
        icon: "none",
      });
      return;
    }
    recorderInstance.stop();
  },

  async handleRecordFinished(filePath: string, localId: string) {
    if (this.data.isUploading) return;
    if (!await this.canGenerateDiary()) return;
    this.setData({ isUploading: true, uploadFailed: false });

    try {
      const savedDraft = readDiaryDraft(diaryDraftKey());
      const uploadMetadata = {
        entryDate: savedDraft.entryDate || nowIsoDate(),
        timezone: savedDraft.timezone || localTimezone(),
      };
      // Older retained drafts did not store these fields. Persist the chosen
      // fallback before uploading so every later retry keeps the same source
      // fingerprint even if this attempt times out.
      writeDiaryDraft(diaryDraftKey(), Object.assign({}, savedDraft, {
        audioPath: filePath,
        localId,
        entryDate: uploadMetadata.entryDate,
        timezone: uploadMetadata.timezone,
      }));
      // 1. 上传音频并转写（POST /entries/voice）
      const transcribeRes = await uploadVoiceFile(filePath, localId, uploadMetadata);
      const entryId = transcribeRes.entry_id;
      const transcript = transcribeRes.transcript || "";

      const completedDraft = readDiaryDraft(diaryDraftKey());
      writeDiaryDraft(diaryDraftKey(), Object.assign({}, completedDraft, {
        entryId,
        text: transcript,
        confirmedText: transcript,
        audioPath: filePath,
        localId,
        entryDate: uploadMetadata.entryDate,
        timezone: uploadMetadata.timezone,
        status: "transcribed",
        updatedAt: Date.now(),
      }));
      this.setData({
        isUploading: false,
        draftText: transcript,
        transcribedEntryId: entryId,
        uploadFailed: false,
      });
      wx.showToast({ title: "文字已经写在上面了", icon: "none" });
    } catch (err: any) {
      this.setData({ isUploading: false, uploadFailed: true });
      const draft = readDiaryDraft(diaryDraftKey());
      writeDiaryDraft(diaryDraftKey(), Object.assign({}, draft, {
        audioPath: filePath,
        localId,
        status: "upload_failed",
        updatedAt: Date.now(),
      }));
      wx.showModal({
        title: "录音处理提示",
        content: err && err.code === "network_timeout"
          ? "上传等待时间较长，录音已保存在本机。请稍后点击“重新上传”。"
          : err && err.code === "network_error"
            ? "当前网络不可用，录音已保存在本机。恢复网络后可点击“重新上传”。"
            : "上传遇到一点小阻碍，录音已保存在本机，请稍后重试。",
        confirmText: "知道了",
        confirmColor: "#D9845B",
        showCancel: false,
      });
    }
  },

  onRetryUpload() {
    const draft = readDiaryDraft(diaryDraftKey());
    const filePath = this.data.tempAudioPath || (draft && draft.audioPath);
    const localId = this.data.draftLocalId || (draft && draft.localId);
    if (!filePath || !localId) {
      wx.showToast({ title: "未找到可重试的录音", icon: "none" });
      return;
    }
    this.handleRecordFinished(filePath, localId);
  },

  restoreAudioDraft() {
    const draft = readDiaryDraft(diaryDraftKey());
    const references = normalizeReferences(draft || {});
    references.forEach((item) => {
      try { wx.getFileSystemManager().accessSync(item.path); } catch { item.missing = true; }
    });
    this.setData({ references });
    if (references.some((item) => item.missing) && !this.missingReferencePrompted) {
      this.missingReferencePrompted = true;
      wx.showToast({ title: "部分参考图已失效，请更换；文字仍保留", icon: "none" });
    }
    if (draft && ["text-draft", "transcribed", "generating"].includes(draft.status) && draft.text) {
      this.setData({
        draftText: draft.text,
        transcribedEntryId: draft.status === "transcribed" ? (draft.entryId || "") : "",
        references,
        stylePreset: draft.stylePreset || this.data.stylePreset,
        styleLabel: ({ chibi_manga: "经典手绘", warm_watercolor: "治愈水彩", anime_cel: "暖光插画", retro_comic: "复古手帐" } as Record<string, string>)[draft.stylePreset] || "治愈水彩",
        aspectRatio: draft.aspectRatio || "4:3",
      });
      return;
    }
    if (!draft || !draft.audioPath || !draft.localId || draft.status === "generating") return;
    this.setData({ tempAudioPath: draft.audioPath, draftLocalId: draft.localId, uploadFailed: true });
  },

  persistAudioDraft(tempFilePath: string, localId: string, durationMs: number): Promise<string> {
    const ownerDraftKey = diaryDraftKey();
    const safeId = localId.replace(/[^a-zA-Z0-9_-]/g, "");
    const { entryDate, timezone } = this.getEntryMetadata();
    const fs = wx.getFileSystemManager();
    return new Promise((resolve, reject) => {
      fs.readFile({
        filePath: tempFilePath,
        position: 0,
        length: 16,
        success: (headerRes) => {
          const header = new Uint8Array(headerRes.data as ArrayBuffer);
          const isMp4 = header.length >= 8 && header[4] === 0x66 && header[5] === 0x74 && header[6] === 0x79 && header[7] === 0x70;
          const savedPath = `${wx.env.USER_DATA_PATH}/voice-${safeId}.${isMp4 ? "m4a" : "aac"}`;
          fs.saveFile({
            tempFilePath,
            filePath: savedPath,
            success: () => {
              if (ownerDraftKey !== diaryDraftKey()) { reject(new Error("账号已切换，录音未写入当前账号")); return; }
              registerLocalRecording(savedPath, localId, entryDate);
              const current = readDiaryDraft(diaryDraftKey());
              writeDiaryDraft(diaryDraftKey(), Object.assign({}, current, {
                audioPath: savedPath,
                localId,
                entryDate,
                timezone,
                durationMs,
                status: "recorded",
                updatedAt: Date.now(),
              }));
              resolve(savedPath);
            },
            fail: reject,
          });
        },
        fail: () => {
          const savedPath = `${wx.env.USER_DATA_PATH}/voice-${safeId}.aac`;
          fs.saveFile({
            tempFilePath,
            filePath: savedPath,
            success: () => {
              if (ownerDraftKey !== diaryDraftKey()) { reject(new Error("账号已切换，录音未写入当前账号")); return; }
              registerLocalRecording(savedPath, localId, entryDate);
              const current = readDiaryDraft(diaryDraftKey());
              writeDiaryDraft(diaryDraftKey(), Object.assign({}, current, {
                audioPath: savedPath,
                localId,
                entryDate,
                timezone,
                durationMs,
                status: "recorded",
                updatedAt: Date.now(),
              }));
              resolve(savedPath);
            },
            fail: reject,
          });
        },
      });
    });
  },

  saveReferences(references: Array<any>) {
    this.setData({ references });
    const key = diaryDraftKey(), draft = readDiaryDraft(key);
    if (!writeDiaryDraft(key, { ...draft, references, status: "text-draft", updatedAt: Date.now() })) {
      this.setData({ draftStorageFailed: true });
      wx.showToast({ title: "图片草稿保存失败，请检查存储空间", icon: "none" });
    }
  },

  onChooseReference(e?: WechatMiniprogram.BaseEvent) {
    if (this.data.textSubmitting || this.data.choosingReference) return;
    const key = e?.currentTarget?.dataset?.key;
    const index = key ? this.data.references.findIndex((item) => item.key === key) : -1;
    const count = index >= 0 ? 1 : 3 - this.data.references.length;
    if (count <= 0) return;
    const scope = diaryDraftKey();
    this.setData({ choosingReference: true });
    wx.chooseMedia({
      count, mediaType: ["image"], sourceType: ["album", "camera"], sizeType: ["compressed"],
      success: async (res) => {
        try {
          const prepared = [];
          for (const file of res.tempFiles.slice(0, count)) {
            const refKey = ensureIdempotencyKey();
            const path = await this.persistReference(file.tempFilePath, refKey);
            prepared.push({ key: refKey, path, id: "", entryId: "", type: "combined" as const, typeLabel: "综合参考", includeInContent: true, progress: 0, status: "ready", missing: false });
          }
          if (scope !== diaryDraftKey() || !this.pageActive) return;
          const next = this.data.references.slice();
          if (index >= 0) next.splice(index, 1, prepared[0]); else next.push(...prepared);
          this.saveReferences(next);
        } catch (error: any) { wx.showToast({ title: error.message || "图片保存失败，请重试", icon: "none" }); }
        finally { this.setData({ choosingReference: false }); }
      },
      fail: () => this.setData({ choosingReference: false }),
    });
  },

  async persistReference(path: string, key: string): Promise<string> {
    const infoImage = await new Promise<{ width: number; height: number }>((resolve, reject) => wx.getImageInfo({ src: path, success: resolve, fail: reject }));
    const scale = Math.min(1, 1920 / Math.max(infoImage.width, infoImage.height));
    const compressed = await new Promise<string>((resolve, reject) => wx.compressImage({ src: path, quality: 80, compressedWidth: Math.round(infoImage.width * scale), compressedHeight: Math.round(infoImage.height * scale), success: (result) => resolve(result.tempFilePath), fail: reject }));
    const fs = wx.getFileSystemManager();
    const info = fs.statSync(compressed) as any;
    if (Number(info.size ?? info.stats?.size ?? 0) > 5 * 1024 * 1024) throw new Error("参考图压缩后仍超过 5MB，请选择较小图片");
    const target = `${wx.env.USER_DATA_PATH}/reference-${key}.jpg`;
    await new Promise<void>((resolve, reject) => fs.saveFile({ tempFilePath: compressed, filePath: target, success: () => resolve(), fail: reject }));
    return target;
  },

  onPreviewReference(e: WechatMiniprogram.BaseEvent) {
    const item = this.data.references.find((item) => item.key === e.currentTarget.dataset.key);
    if (item && !item.missing) wx.previewImage({ current: item.path, urls: this.data.references.filter((ref) => !ref.missing).map((ref) => ref.path) });
  },

  onChooseReferenceType(e: WechatMiniprogram.BaseEvent) {
    if (this.data.textSubmitting) return;
    const types = ["subject", "style", "scene", "tone", "combined"] as const;
    const labels = ["主体参考", "画风参考", "场景参考", "色调参考", "综合参考"];
    wx.showActionSheet({ itemList: labels, success: ({ tapIndex }) => {
      this.saveReferences(this.data.references.map((item) => item.key === e.currentTarget.dataset.key ? { ...item, type: types[tapIndex], typeLabel: labels[tapIndex], id: "", entryId: "", status: "ready", progress: 0 } : item));
    } });
  },

  onRetryReference(e: WechatMiniprogram.BaseEvent) {
    const item = this.data.references.find((item) => item.key === e.currentTarget.dataset.key);
    if (item?.missing) this.onChooseReference(e);
    else this.onSubmitText();
  },

  onChooseStyle() {
    const values = ["chibi_manga", "warm_watercolor", "anime_cel", "retro_comic"] as const;
    const labels = ["经典手绘", "治愈水彩", "暖光插画", "复古手帐"];
    wx.showActionSheet({
      itemList: labels,
      success: ({ tapIndex }) => this.setData({ stylePreset: values[tapIndex], styleLabel: labels[tapIndex] }),
    });
  },

  onChooseAspectRatio() {
    const values = ["4:3", "1:1", "3:4"] as const;
    const labels = ["横向 4:3（推荐）", "方形 1:1", "竖向 3:4"];
    wx.showActionSheet({
      itemList: labels,
      success: ({ tapIndex }) => this.setData({ aspectRatio: values[tapIndex] }),
    });
  },

  onReferenceContentChange(e: WechatMiniprogram.SwitchChange) {
    if (this.data.textSubmitting) return;
    this.saveReferences(this.data.references.map((item) => item.key === e.currentTarget.dataset.key ? { ...item, includeInContent: Boolean(e.detail.value), id: "", entryId: "", status: "ready", progress: 0 } : item));
  },

  onRemoveReference(e: WechatMiniprogram.BaseEvent) {
    if (this.data.textSubmitting) return;
    this.saveReferences(this.data.references.filter((item) => item.key !== e.currentTarget.dataset.key));
  },

  getEntryMetadata(): { entryDate: string; timezone: string } {
    const selectedDate = this.data.targetEntryDate;
    if (typeof selectedDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(selectedDate)) {
      return { entryDate: `${selectedDate}T12:00:00+08:00`, timezone: "Asia/Shanghai" };
    }
    return { entryDate: nowIsoDate(), timezone: localTimezone() };
  },

  onBack() {
    if (this.data.isRecording || this.data.isStarting) {
      wx.showModal({
        title: "退出录音？",
        content: "退出后会结束录音并保存在本机，下次可继续上传。确定返回吗？",
        confirmColor: "#D9845B",
        success: (res) => {
          if (res.confirm) {
            if (this.data.isRecording || this.data.isStarting) {
              this.deferUpload = true;
              recorderInstance.stop();
            }
            wx.navigateBack();
          }
        },
      });
    } else {
      wx.navigateBack();
    }
  },
});
