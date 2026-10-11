const stores = new Set();
function notifySessionChanged() { stores.forEach((store) => store.sync()); }
function createConversationStore(storage, getScope, sender) {
  let scope = "", messages = [], pending = false, revision = 0;
  const listeners = new Set();
  const snapshot = () => ({ messages: messages.map((item) => ({ ...item })), loading: pending });
  const emit = () => listeners.forEach((listener) => listener(snapshot()));
  const save = () => {
    if (!scope) return;
    try { storage.setStorageSync(`voling_pet_chat:${scope}`, messages.slice(-40)); }
    catch { emitError("聊天记录暂时无法保存，请检查本机存储空间"); }
  };
  function emitError(message) { if (storage.showToast) storage.showToast({ title: message, icon: "none" }); }
  const store = {
    sync() {
      const next = getScope() || "";
      if (scope === next) return snapshot();
      scope = next; revision += 1; pending = false; messages = [];
      if (scope) {
        try {
          const saved = storage.getStorageSync(`voling_pet_chat:${scope}`);
          if (Array.isArray(saved)) messages = saved.filter((item) => item && ["user", "pet"].includes(item.role) && typeof item.content === "string").slice(-40)
            .map((item) => ({ ...item, status: item.status === "pending" ? "failed" : item.status }));
        } catch { emitError("聊天记录读取失败，可清空后重新开始"); }
      }
      emit(); return snapshot();
    },
    subscribe(listener) { listeners.add(listener); store.sync(); listener(snapshot()); return () => listeners.delete(listener); },
    clear() { revision += 1; messages = []; pending = false; save(); emit(); },
    async send(text, options = {}, retryId) {
      store.sync();
      if (!scope) throw new Error("暂时无法连接，请稍后重试");
      if (pending) return;
      const retry = retryId && messages.find((item) => item.id === retryId && item.role === "user" && item.status === "failed");
      if (retryId && !retry) return;
      const content = (retry ? retry.content : text || "").trim();
      if (!content) return;
      const preceding = retry ? messages.slice(0, messages.indexOf(retry)) : messages;
      const history = preceding.filter((item) => item.status === "sent" && item.id !== retryId).slice(-20)
        .map((item) => ({ role: item.role === "pet" ? "assistant" : "user", content: item.content }));
      const message = retry || { id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, role: "user", content };
      message.status = "pending"; message.error = "";
      if (!retry) messages.push(message);
      messages = messages.slice(-40); pending = true; save(); emit();
      const owner = scope, version = revision;
      try {
        const result = await sender(content, { ...options, history });
        store.sync();
        if (owner !== scope || version !== revision) return;
        if (!result || !result.reply) throw new Error("回复暂时未完成，请重试");
        message.status = "sent";
        messages.splice(messages.indexOf(message) + 1, 0, { id: `pet-${message.id}`, role: "pet", content: result.reply, status: "sent" });
      } catch (error) {
        store.sync();
        if (owner !== scope || version !== revision) return;
        message.status = "failed"; message.error = error.message || "回复失败，请重试";
      } finally {
        if (owner === scope && version === revision) { messages = messages.slice(-40); pending = false; save(); emit(); }
      }
    },
  };
  stores.add(store);
  return store;
}
module.exports = { createConversationStore, notifySessionChanged };
