import {
  CharacterItem,
  authenticatedMediaUrl,
  createCharacter,
  deleteCharacter,
  deleteCharacterReference,
  getActiveCharacterId,
  getSessionScope,
  listCharacters,
  setActiveCharacterId,
  uploadCharacterReference,
} from "../../utils/api";
import { getNavInfo } from "../../utils/nav";
import { OFFICIAL_CHARACTERS } from "../../utils/officialCharacters";
import { enableHomeShareMenu, homeShareHandlers } from "../../utils/homeShare";

Page({
  ...homeShareHandlers,
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    navRightPadding: 96,
    characters: [] as Array<CharacterItem & { cover: string; initial: string; references: Array<CharacterItem["references"][number] & { url: string; imageFailed?: boolean }> }>,
    activeId: "",
    loading: true,
    loadError: false,
    saving: false,
    name: "",
    appearance: "",
    stylePreset: "warm_watercolor" as CharacterItem["style_preset"],
    styleLabel: "温暖绘本",
    officialCharacters: OFFICIAL_CHARACTERS,
    showCreate: false,
    deletingId: "",
    deletingReferenceId: "",
  },

  onLoad() {
    enableHomeShareMenu();
    const nav = getNavInfo();
    this.setData({
      statusBarHeight: nav.statusBarHeight,
      navBarHeight: nav.navBarHeight,
      navRightPadding: nav.navRightPadding,
      activeId: getActiveCharacterId(),
    });
    this.loadCharacters();
  },

  async loadCharacters() {
    const scope = getSessionScope();
    this.setData({ loading: true, loadError: false });
    try {
      const rows = await listCharacters();
      const characters = await Promise.all(rows.map(async (item) => {
        const references = await Promise.all(item.references.map(async (reference) => {
          try {
            return { ...reference, url: await authenticatedMediaUrl(reference.media_key), imageFailed: false };
          } catch {
            return { ...reference, url: "", imageFailed: true };
          }
        }));
        return { ...item, references, cover: references[0]?.url || "", initial: item.name ? item.name.slice(0, 1) : "角" };
      }));
      if (scope !== getSessionScope()) return;
      this.setData({ characters, loading: false, loadError: false });
    } catch (error) {
      if (scope !== getSessionScope()) return;
      this.setData({ loading: false, loadError: true });
    }
  },

  onRetryLoad() {
    this.loadCharacters();
  },

  onNameInput(e: WechatMiniprogram.Input) { this.setData({ name: e.detail.value }); },
  onAppearanceInput(e: WechatMiniprogram.Input) { this.setData({ appearance: e.detail.value }); },

  onChooseStyle() {
    const values: CharacterItem["style_preset"][] = ["warm_watercolor", "chibi_manga", "retro_comic"];
    const labels = ["温暖绘本", "轻漫画", "复古漫画"];
    wx.showActionSheet({
      itemList: labels,
      success: (res) => this.setData({ stylePreset: values[res.tapIndex], styleLabel: labels[res.tapIndex] }),
    });
  },

  async onCreate() {
    const name = this.data.name.trim();
    const appearance = this.data.appearance.trim();
    if (!name || !appearance || this.data.saving) {
      wx.showToast({ title: "请填写角色名称和外貌特点", icon: "none" });
      return;
    }
    this.setData({ saving: true });
    try {
      const created = await createCharacter({ name, appearance_prompt: appearance, style_preset: this.data.stylePreset });
      setActiveCharacterId(created.id);
      this.setData({ activeId: created.id, name: "", appearance: "", saving: false });
      await this.loadCharacters();
      wx.showToast({ title: "主角已创建", icon: "success" });
    } catch (error: any) {
      this.setData({ saving: false });
      wx.showToast({ title: error?.message || "创建失败", icon: "none" });
    }
  },

  onSelect(e: WechatMiniprogram.BaseEvent) {
    const id = e.currentTarget.dataset.id || "";
    setActiveCharacterId(id);
    this.setData({ activeId: id });
    wx.showToast({ title: "已设为日记主角", icon: "success" });
  },

  onUseDefault() {
    setActiveCharacterId("official:xia");
    this.setData({ activeId: "official:xia" });
    wx.showToast({ title: "已选择小夏", icon: "success" });
  },

  onSelectOfficial(e: WechatMiniprogram.BaseEvent) {
    const id = `official:${e.currentTarget.dataset.id || "xia"}`;
    setActiveCharacterId(id);
    this.setData({ activeId: id });
    wx.showToast({ title: "已设为日记主角", icon: "success" });
  },

  onToggleCreate() {
    this.setData({ showCreate: !this.data.showCreate });
  },

  onUploadReference(e: WechatMiniprogram.BaseEvent) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.chooseMedia({
      count: 1,
      mediaType: ["image"],
      sourceType: ["album", "camera"],
      sizeType: ["compressed"],
      success: async (res) => {
        const path = res.tempFiles && res.tempFiles[0] && res.tempFiles[0].tempFilePath;
        if (!path) return;
        wx.showLoading({ title: "上传参考图…", mask: true });
        try {
          await uploadCharacterReference(id, path);
          wx.hideLoading();
          await this.loadCharacters();
          wx.showToast({ title: "参考图已保存", icon: "success" });
        } catch (error: any) {
          wx.hideLoading();
          wx.showToast({ title: error?.message || "上传失败", icon: "none" });
        }
      },
    });
  },

  onPreviewReference(e: WechatMiniprogram.BaseEvent) {
    const character = this.data.characters.find((item) => item.id === e.currentTarget.dataset.id);
    const reference = character?.references.find((item) => item.id === e.currentTarget.dataset.referenceId);
    if (!character || !reference?.url || reference.imageFailed) return;
    wx.previewImage({ current: reference.url, urls: character.references.filter((item) => item.url && !item.imageFailed).map((item) => item.url) });
  },

  onReferenceError(e: WechatMiniprogram.BaseEvent) {
    const id = e.currentTarget.dataset.id;
    const referenceId = e.currentTarget.dataset.referenceId;
    const characters = this.data.characters.map((item) => {
      if (item.id !== id) return item;
      const references = item.references.map((reference) => reference.id === referenceId ? { ...reference, url: "", imageFailed: true } : reference);
      return { ...item, references, cover: references[0]?.url || "" };
    });
    this.setData({ characters });
  },

  async onRetryReference(e: WechatMiniprogram.BaseEvent) {
    const id = e.currentTarget.dataset.id;
    const referenceId = e.currentTarget.dataset.referenceId;
    const character = this.data.characters.find((item) => item.id === id);
    const reference = character?.references.find((item) => item.id === referenceId);
    if (!reference) return;
    const scope = getSessionScope();
    try {
      const url = await authenticatedMediaUrl(reference.media_key, true);
      if (scope !== getSessionScope()) return;
      const characters = this.data.characters.map((item) => {
        if (item.id !== id) return item;
        const references = item.references.map((ref) => ref.id === referenceId ? { ...ref, url, imageFailed: false } : ref);
        return { ...item, references, cover: references[0]?.url || "" };
      });
      this.setData({ characters });
    } catch (error: any) {
      if (scope === getSessionScope()) wx.showToast({ title: error?.message || "参考图暂时无法加载", icon: "none" });
    }
  },

  onDeleteReference(e: WechatMiniprogram.BaseEvent) {
    const id = e.currentTarget.dataset.id || "";
    const referenceId = e.currentTarget.dataset.referenceId || "";
    const character = this.data.characters.find((item) => item.id === id);
    if (!character?.references.some((item) => item.id === referenceId) || this.data.deletingReferenceId || this.data.deletingId) return;
    wx.showModal({
      title: "删除这张参考图？",
      content: "仅删除所选参考图，角色名称、外貌设定和已生成的日记都会保留。",
      confirmText: "删除",
      confirmColor: "#B75B4B",
      success: async (result) => {
        if (!result.confirm || this.data.deletingReferenceId || this.data.deletingId) return;
        this.setData({ deletingReferenceId: referenceId });
        try {
          await deleteCharacterReference(id, referenceId);
          const characters = this.data.characters.map((item) => {
            if (item.id !== id) return item;
            const references = item.references.filter((reference) => reference.id !== referenceId);
            return { ...item, references, cover: references[0]?.url || "", version: item.version + 1 };
          });
          this.setData({ characters });
          wx.showToast({ title: "参考图已删除", icon: "success" });
        } catch (error: any) {
          wx.showToast({ title: error?.message || "参考图删除失败", icon: "none" });
        } finally {
          this.setData({ deletingReferenceId: "" });
        }
      },
    });
  },

  onDeleteCharacter(e: WechatMiniprogram.BaseEvent) {
    const id = e.currentTarget.dataset.id || "";
    const character = this.data.characters.find((item) => item.id === id);
    if (!id || !character || this.data.deletingId || this.data.deletingReferenceId) return;
    wx.showModal({
      title: `删除“${character.name}”？`,
      content: "角色和已上传的参考图将被删除。已经生成的日记不会受到影响。",
      confirmText: "删除",
      confirmColor: "#B75B4B",
      cancelText: "保留",
      success: async (result) => {
        if (!result.confirm) return;
        this.setData({ deletingId: id });
        try {
          await deleteCharacter(id);
          const wasActive = this.data.activeId === id;
          if (wasActive) setActiveCharacterId("official:xia");
          this.setData({
            deletingId: "",
            activeId: wasActive ? "official:xia" : this.data.activeId,
          });
          await this.loadCharacters();
          wx.showToast({ title: "角色已删除", icon: "success" });
        } catch (error: any) {
          this.setData({ deletingId: "" });
          wx.showToast({ title: error?.message || "删除失败", icon: "none" });
        }
      },
    });
  },

  onBack() { wx.navigateBack(); },
});
