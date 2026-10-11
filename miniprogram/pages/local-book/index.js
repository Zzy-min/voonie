const { recorderInstance } = require("../../utils/recorder");

const STORAGE_KEY = "voling_local_books_v1";
const SCENES = [
  { name: "草地", image: "/assets/images/ui/illust-meadow.png" },
  { name: "散步", image: "/assets/images/ui/illust-garden-walk.png" },
  { name: "花间", image: "/assets/images/ui/illust-play-flowers.png" },
  { name: "晚霞", image: "/assets/images/ui/illust-sunset.png" },
];

function readBooks() {
  try {
    const value = wx.getStorageSync(STORAGE_KEY);
    return Array.isArray(value) ? value.filter((item) => item && item.id && item.audioPath) : [];
  } catch (error) {
    console.warn("Read local books failed", error);
    return [];
  }
}

Page({
  data: {
    scenes: SCENES,
    selectedScene: 0,
    books: [],
    recording: false,
    saving: false,
    playingId: "",
    status: "选择插画，录一段声音，做一本只留在这台设备上的小绘本。",
  },

  onLoad() {
    this.unloaded = false;
    this.setData({ books: readBooks() });
    recorderInstance.setCallbacks({
      onStart: () => this.setData({ recording: true, status: "正在录音，完成后点停止。" }),
      onStop: (result) => this.saveRecording(result),
      onError: () => this.setData({ recording: false, saving: false, status: "录音失败，请重试。" }),
    });
  },

  onUnload() {
    this.unloaded = true;
    if (this.data.recording) recorderInstance.stop();
    if (this.player) {
      this.player.destroy();
      this.player = null;
    }
  },

  chooseScene(event) {
    if (this.data.recording || this.data.saving) return;
    this.setData({ selectedScene: Number(event.currentTarget.dataset.index) });
  },

  async toggleRecording() {
    if (this.data.saving) return;
    if (this.data.recording) {
      this.setData({ saving: true });
      recorderInstance.stop();
      return;
    }
    try {
      await recorderInstance.start();
    } catch (error) {
      this.setData({ recording: false, saving: false, status: "未能开始录音，请检查麦克风权限。" });
    }
  },

  saveRecording(result) {
    if (!result || !result.tempFilePath) {
      this.setData({ recording: false, saving: false, status: "录音未生成文件，请重试。" });
      return;
    }
    wx.saveFile({
      tempFilePath: result.tempFilePath,
      success: ({ savedFilePath }) => {
        const now = Date.now();
        const book = {
          id: String(now),
          title: `我的绘本 · ${new Date(now).toLocaleDateString()}`,
          image: SCENES[this.data.selectedScene].image,
          audioPath: savedFilePath,
          duration: Math.round((result.duration || 0) / 1000),
        };
        const books = [book, ...readBooks()];
        try {
          wx.setStorageSync(STORAGE_KEY, books);
          if (!this.unloaded) this.setData({ books, recording: false, saving: false, status: "已保存在本机，可在下方翻看和播放。" });
        } catch (error) {
          console.error("Save local book index failed", error);
          // 音频仍在本机文件目录；不删除它，避免丢失用户录音。
          if (!this.unloaded) this.setData({ recording: false, saving: false, status: "音频已保存，但绘本索引保存失败；请检查设备空间。" });
        }
      },
      fail: () => {
        if (!this.unloaded) this.setData({ recording: false, saving: false, status: "本机空间不足或保存失败，请重试。" });
      },
    });
  },

  playBook(event) {
    const book = this.data.books.find((item) => item.id === event.currentTarget.dataset.id);
    if (!book) return;
    if (this.player) {
      this.player.destroy();
      this.player = null;
    }
    if (this.data.playingId === book.id) {
      this.setData({ playingId: "" });
      return;
    }
    const player = wx.createInnerAudioContext();
    this.player = player;
    player.src = book.audioPath;
    player.onEnded(() => this.setData({ playingId: "" }));
    player.onError(() => this.setData({ playingId: "", status: "录音文件无法播放，可能已被系统清理。" }));
    player.play();
    this.setData({ playingId: book.id });
  },
});
