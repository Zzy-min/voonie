import { getNavInfo } from "../../utils/nav";
import { getSessionScope, localDiaryStore, localMediaStore, trimLocalImageCache, unpinOfflineDiary, saveDiaryOffline, isDiaryOfflineSaved, registerLocalRecording, subscribeDiaryUpdates } from "../../utils/api";

function formatBytes(bytes: number): string {
  return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
Page({
  data: {
    statusBarHeight: 20, navBarHeight: 44, navRightPadding: 96,
    total: "0 KB", cache: "0 KB", fixed: "0 KB", recordingsSize: "0 KB", draftsSize: "0 KB",
    books: [] as Array<{ id: string; title: string; ready: boolean }>,
    recordings: [] as Array<{ path: string; localId: string; label: string; size: string }>,
    busy: false, error: "", playingId: "", scope: "",
  },
  player: null as WechatMiniprogram.InnerAudioContext | null,
  stopUpdates: null as null | (() => void),
  onLoad() { this.setData(getNavInfo()); this.stopUpdates = subscribeDiaryUpdates(() => { if (this.data.scope !== getSessionScope()) this.player?.stop(); this.refresh(); }); },
  onShow() { this.refresh(); },
  onHide() { this.player?.stop(); this.setData({ playingId: "" }); },
  onUnload() { this.stopUpdates?.(); this.player?.destroy(); },
  refresh() {
    const scope = getSessionScope(), scan = localMediaStore.scan();
    const entries = scope ? localMediaStore.entries(scope) as Array<{ pinned: boolean; bytes: number }> : [];
    const state = localDiaryStore.snapshot(scope);
    const draft = scope ? wx.getStorageSync(`voonie_diary_draft:${scope}`) : null;
    if (draft?.audioPath) registerLocalRecording(draft.audioPath, draft.localId || "draft", draft.entryDate || "");
    const stored = scope ? wx.getStorageSync(`voling_recordings:${scope}`) : [];
    const source = Array.isArray(stored) ? stored : [];
    const recordings = source.filter((item: any) => item.path && item.path.startsWith(`${wx.env.USER_DATA_PATH}/voice-`) && !item.path.includes("/../")).flatMap((item: any) => {
      try {
        const stat = wx.getFileSystemManager().statSync(item.path);
        return [{ ...item, label: (item.entryDate || "").slice(0, 10) || "本机录音", size: formatBytes(Array.isArray(stat) ? 0 : stat.size) }];
      } catch { return []; }
    });
    this.setData({ scope, total: formatBytes(scan.total), recordingsSize: formatBytes(scan.recordings), draftsSize: formatBytes(scan.references + scan.metadata),
      cache: formatBytes(entries.filter((item) => !item.pinned).reduce((sum, item) => sum + item.bytes, 0)),
      fixed: formatBytes(entries.filter((item) => item.pinned).reduce((sum, item) => sum + item.bytes, 0)),
      books: Object.keys(state.pins).filter((id) => state.items[id]).map((id) => ({ id, title: state.items[id].title, ready: isDiaryOfflineSaved(id) })),
      recordings,
    });
  },
  onClean() {
    if (!this.data.scope || this.data.busy) return;
    wx.showModal({ title: "清理普通图片缓存？", content: "仅清理当前账号可重新下载的普通图片。固定保存图片、日记文字、草稿和录音原文件都会保留。", confirmText: "清理缓存", success: (res) => {
      if (!res.confirm || this.data.scope !== getSessionScope()) return;
      this.setData({ busy: true });
      try { const result = trimLocalImageCache(true); wx.showToast({ title: `已清理 ${formatBytes(result.removed)}`, icon: "none" }); }
      catch { this.setData({ error: "部分缓存未能清理，请重试" }); }
      finally { this.setData({ busy: false }); this.refresh(); }
    } });
  },
  onUnpin(e: WechatMiniprogram.BaseEvent) {
    const id = e.currentTarget.dataset.id, scope = getSessionScope();
    wx.showModal({ title: "取消固定保存？", content: "图片不会立即删除，但以后可以作为普通缓存清理。日记仍保留在服务器。", success: (res) => {
      if (!res.confirm || scope !== getSessionScope()) return;
      try { unpinOfflineDiary(id); this.refresh(); } catch (error: any) { wx.showToast({ title: error.message, icon: "none" }); }
    } });
  },
  async onRetry(e: WechatMiniprogram.BaseEvent) {
    if (this.data.busy) return;
    this.setData({ busy: true, error: "" });
    try { await saveDiaryOffline(e.currentTarget.dataset.id); }
    catch (error: any) { this.setData({ error: error.message || "下载未完成，请稍后重试" }); }
    finally { this.setData({ busy: false }); this.refresh(); }
  },
  onPlay(e: WechatMiniprogram.BaseEvent) {
    const recording = this.data.recordings.find((item) => item.localId === e.currentTarget.dataset.id);
    if (!recording || this.data.scope !== getSessionScope()) return;
    if (this.data.playingId === recording.localId) { this.player?.stop(); this.setData({ playingId: "" }); return; }
    this.player?.destroy(); this.player = wx.createInnerAudioContext();
    this.player.src = recording.path;
    this.player.onEnded(() => this.setData({ playingId: "" }));
    this.player.onError(() => { this.setData({ playingId: "" }); wx.showToast({ title: "录音暂时无法播放", icon: "none" }); });
    this.setData({ playingId: recording.localId }); this.player.play();
  },
  onExport(e: WechatMiniprogram.BaseEvent) {
    const recording = this.data.recordings.find((item) => item.localId === e.currentTarget.dataset.id);
    if (!recording || this.data.scope !== getSessionScope()) return;
    if (typeof wx.shareFileMessage !== "function") { wx.showToast({ title: "当前微信版本不支持导出文件", icon: "none" }); return; }
    wx.shareFileMessage({ filePath: recording.path, fileName: `Voling-${recording.label}.${recording.path.split(".").pop()}`, fail: () => wx.showToast({ title: "导出未完成", icon: "none" }) });
  },
  onBack() { wx.navigateBack({ fail: () => wx.switchTab({ url: "/pages/profile/index" }) }); },
});
