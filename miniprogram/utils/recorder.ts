// utils/recorder.ts - 微信原生录音管理器与中断保护
export interface RecorderCallbacks {
  onStart?: () => void;
  onPause?: () => void;
  onResume?: () => void;
  onStop?: (res: { tempFilePath: string; duration: number; fileSize: number }) => void;
  onError?: (err: any) => void;
  onFrameRecord?: (res: { isLastFrame: boolean; frameBuffer: ArrayBuffer }) => void;
}

export class VoonieRecorder {
  private recorderManager: WechatMiniprogram.RecorderManager;
  private isRecording = false;
  private isPaused = false;
  private duration = 0; // 秒数
  private timer: any = null;
  private callbacks: RecorderCallbacks = {};
  private pendingCallbacks: RecorderCallbacks | null = null;
  private activeCallbacks: RecorderCallbacks | null = null;
  private isStarting = false;
  private isStopping = false;
  private cancelPendingStart = false;

  constructor() {
    this.recorderManager = wx.getRecorderManager();
    this.initEvents();
  }

  private initEvents() {
    this.recorderManager.onStart(() => {
      this.isStarting = false;
      this.isStopping = false;
      this.isRecording = true;
      this.isPaused = false;
      this.activeCallbacks = this.pendingCallbacks;
      this.pendingCallbacks = null;
      if (this.cancelPendingStart) {
        this.cancelPendingStart = false;
        this.isStopping = true;
        this.recorderManager.stop();
        return;
      }
      this.startTimer();
      if (this.activeCallbacks?.onStart) this.activeCallbacks.onStart();
    });

    this.recorderManager.onPause(() => {
      this.isPaused = true;
      this.stopTimer();
      if (this.activeCallbacks?.onPause) this.activeCallbacks.onPause();
    });

    this.recorderManager.onResume(() => {
      this.isPaused = false;
      this.startTimer();
      if (this.activeCallbacks?.onResume) this.activeCallbacks.onResume();
    });

    this.recorderManager.onStop((res) => {
      this.isRecording = false;
      this.isPaused = false;
      this.isStopping = false;
      this.stopTimer();
      const callbacks = this.activeCallbacks;
      this.activeCallbacks = null;
      if (callbacks?.onStop) callbacks.onStop(res);
    });

    this.recorderManager.onError((err) => {
      this.isRecording = false;
      this.isPaused = false;
      this.isStarting = false;
      this.isStopping = false;
      this.cancelPendingStart = false;
      this.stopTimer();
      const callbacks = this.activeCallbacks || this.pendingCallbacks;
      this.activeCallbacks = null;
      this.pendingCallbacks = null;
      if (callbacks?.onError) callbacks.onError(err);
    });

    // 仅当开启 frameSize 时才会触发；用于驱动“真波形”音量
    this.recorderManager.onFrameRecorded((res) => {
      if (!this.isPaused && this.activeCallbacks?.onFrameRecord) {
        this.activeCallbacks.onFrameRecord(res);
      }
    });
  }

  private startTimer() {
    this.stopTimer();
    this.timer = setInterval(() => {
      this.duration += 1;
    }, 1000);
  }

  private stopTimer() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  public setCallbacks(cbs: RecorderCallbacks) {
    this.callbacks = cbs;
  }

  public async start(): Promise<void> {
    if (this.isRecording || this.isStarting || this.isStopping) {
      throw new Error("recorder_busy");
    }
    this.isStarting = true;
    this.cancelPendingStart = false;
    this.pendingCallbacks = this.callbacks;
    // 检查麦克风权限
    return new Promise((resolve, reject) => {
      wx.authorize({
        scope: "scope.record",
        success: () => {
          this.duration = 0;
          this.recorderManager.start({
            duration: 600000, // 最长 10 分钟
            sampleRate: 16000,
            numberOfChannels: 1,
            encodeBitRate: 48000,
            // RecorderManager 不接受 m4a 作为输入格式；aac 在 Android/iOS
            // 均受支持。AAC 不提供可直接按 PCM 解析的实时帧，因此不传 frameSize。
            format: "aac",
          });
          resolve();
        },
        fail: () => {
          this.isStarting = false;
          this.pendingCallbacks = null;
          reject(new Error("permission_denied"));
        },
      });
    });
  }

  public pause() {
    if (this.isRecording && !this.isPaused && !this.isStopping && !this.isStarting) {
      this.recorderManager.pause();
    }
  }

  public resume() {
    if (this.isRecording && this.isPaused && !this.isStopping && !this.isStarting) {
      this.recorderManager.resume();
    }
  }

  public stop() {
    if (this.isStopping) return;
    if (this.isStarting) {
      this.cancelPendingStart = true;
    }
    if (this.isRecording) {
      this.isStopping = true;
      this.recorderManager.stop();
    }
  }

  public getDuration(): number {
    return this.duration;
  }

  public getFormatDuration(): string {
    const min = Math.floor(this.duration / 60);
    const sec = this.duration % 60;
    return `${min.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
  }
}

export const recorderInstance = new VoonieRecorder();
