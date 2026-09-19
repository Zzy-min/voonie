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
} from "../../utils/api";
import { getNavInfo } from "../../utils/nav";
import { readDiaryDraft, writeDiaryDraft } from "../../utils/draftStorage";

const INSPIRATIONS = [
  "今天发生了一些让我高兴的事……",
  "下班路上的晚霞特别温柔……",
  "今天和朋友吃了好吃的晚餐……",
  "虽然有点累，但坚持完成了一项挑战……",
];

Page({
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
    referencePath: "",
    referenceType: "combined" as "subject" | "style" | "scene" | "tone" | "combined",
    referenceTypeLabel: "综合参考",
    referenceId: "",
    referenceEntryId: "",
    referenceIncludeInContent: true,
    targetEntryDate: "",
    waveAmps: [18, 30, 22, 40, 26, 34, 20],
  },

  waveTimer: 0 as any,
  discardNextStop: false,
  pageActive: false,
  deferUpload: false,

  onLoad() {
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
    const text = (this.data.draftText || "").trim();
    if (text.length < 2 || this.data.textSubmitting || this.data.isUploading) {
      wx.showToast({ title: text ? "再多写一点吧" : "先说或写下今天发生的事", icon: "none" });
      return;
    }
    this.setData({ textSubmitting: true });
    try {
      const savedDraft = readDiaryDraft(diaryDraftKey());
      const localId = savedDraft.localId || ensureIdempotencyKey();
      let entryId = this.data.transcribedEntryId;
      if (!entryId || text !== (savedDraft.text || "").trim()) {
        const metadata = this.getEntryMetadata();
        const entry = await createTextEntry(text, metadata.entryDate, metadata.timezone, localId);
        entryId = entry.id;
      }
      let referenceId = this.data.referenceEntryId === entryId ? this.data.referenceId : "";
      if (this.data.referencePath && !referenceId) {
        const paragraphAnchor = this.referenceParagraphAnchor(text);
        const uploaded = await uploadDiaryReference(entryId, this.data.referencePath, {
          type: this.data.referenceType,
          includeInContent: this.data.referenceIncludeInContent,
          paragraphAnchor,
        });
        referenceId = uploaded.id;
        this.setData({ referenceId, referenceEntryId: entryId });
      }
      const reference = referenceId
        ? { id: referenceId, type: this.data.referenceType }
        : undefined;
      const job = await createComicJob(entryId, `${localId}-comic`, undefined, reference);
      const currentDraft = readDiaryDraft(diaryDraftKey());
      writeDiaryDraft(diaryDraftKey(), Object.assign({}, currentDraft, {
        entryId,
        text,
        localId,
        jobId: job.job_id,
        referenceId,
        referenceEntryId: referenceId ? entryId : "",
        referencePath: this.data.referencePath,
        referenceType: this.data.referenceType,
        referenceIncludeInContent: this.data.referenceIncludeInContent,
        status: "generating",
        updatedAt: Date.now(),
      }));
      this.setData({ textSubmitting: false });
      wx.navigateTo({ url: `/pages/generation/index?jobId=${job.job_id}&entryId=${entryId}` });
    } catch (err: any) {
      this.setData({ textSubmitting: false });
      wx.showToast({ title: err?.message || "整理失败，请重试", icon: "none" });
    }
  },

  onVoiceTouchStart() {
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

  onPrimaryRecordTap() {
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
    if (draft && (draft.status === "text-draft" || draft.status === "transcribed") && draft.text) {
      this.setData({
        draftText: draft.text,
        transcribedEntryId: draft.status === "transcribed" ? (draft.entryId || "") : "",
        referencePath: draft.referencePath || "",
        referenceId: draft.referenceId || "",
        referenceEntryId: draft.referenceEntryId || "",
        referenceType: draft.referenceType || "combined",
        referenceTypeLabel: this.referenceTypeLabel(draft.referenceType || "combined"),
        referenceIncludeInContent: draft.referenceIncludeInContent !== false,
      });
      return;
    }
    if (!draft || !draft.audioPath || !draft.localId || draft.status === "generating") return;
    this.setData({ tempAudioPath: draft.audioPath, draftLocalId: draft.localId, uploadFailed: true });
  },

  persistAudioDraft(tempFilePath: string, localId: string, durationMs: number): Promise<string> {
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

  onChooseReference() {
    wx.chooseMedia({
      count: 1,
      mediaType: ["image"],
      sourceType: ["album", "camera"],
      sizeType: ["compressed"],
      success: (res) => {
        const filePath = res.tempFiles?.[0]?.tempFilePath || "";
        if (filePath) {
          this.setData({ referencePath: filePath, referenceId: "", referenceEntryId: "" });
          const draft = readDiaryDraft(diaryDraftKey());
          writeDiaryDraft(diaryDraftKey(), Object.assign({}, draft, { referencePath: filePath, referenceId: "", referenceEntryId: "" }));
        }
      },
    });
  },

  onChooseReferenceType() {
    const types = ["subject", "style", "scene", "tone", "combined"] as const;
    const labels = ["主体参考", "画风参考", "场景参考", "色调参考", "综合参考"];
    wx.showActionSheet({
      itemList: labels,
      success: (res) => {
        const referenceType = types[res.tapIndex];
        this.setData({ referenceType, referenceTypeLabel: labels[res.tapIndex], referenceId: "", referenceEntryId: "" });
        const draft = readDiaryDraft(diaryDraftKey());
        writeDiaryDraft(diaryDraftKey(), Object.assign({}, draft, { referenceType, referenceId: "", referenceEntryId: "" }));
      },
    });
  },

  onReferenceContentChange(e: WechatMiniprogram.SwitchChange) {
    const referenceIncludeInContent = Boolean(e.detail.value);
    this.setData({ referenceIncludeInContent, referenceId: "", referenceEntryId: "" });
    const draft = readDiaryDraft(diaryDraftKey());
    writeDiaryDraft(diaryDraftKey(), Object.assign({}, draft, { referenceIncludeInContent, referenceId: "", referenceEntryId: "" }));
  },

  onRemoveReference() {
    this.setData({ referencePath: "", referenceId: "", referenceEntryId: "" });
    const draft = readDiaryDraft(diaryDraftKey());
    delete draft.referencePath;
    delete draft.referenceId;
    delete draft.referenceEntryId;
    writeDiaryDraft(diaryDraftKey(), draft);
  },

  referenceParagraphAnchor(text: string): string {
    const paragraphs = text.replace(/\r\n/g, "\n").split(/\n\s*\n/).map((item) => item.trim()).filter(Boolean);
    return (paragraphs[Math.floor(Math.max(0, paragraphs.length - 1) / 2)] || text).slice(0, 120);
  },

  referenceTypeLabel(type: string): string {
    const labels: Record<string, string> = { subject: "主体参考", style: "画风参考", scene: "场景参考", tone: "色调参考", combined: "综合参考" };
    return labels[type] || labels.combined;
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
