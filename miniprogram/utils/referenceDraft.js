const TYPES = { subject: "主体参考", style: "画风参考", scene: "场景参考", tone: "色调参考", combined: "综合参考" };
function normalizeReferences(draft) {
  const source = Array.isArray(draft.references) ? draft.references : draft.referencePath ? [{
    key: "legacy", path: draft.referencePath, id: draft.referenceId, entryId: draft.referenceEntryId,
    type: draft.referenceType, includeInContent: draft.referenceIncludeInContent,
  }] : [];
  return source.slice(0, 3).map((item, index) => ({
    key: item.key || `reference-${index}`, path: item.path || "", id: item.id || "", entryId: item.entryId || "",
    type: TYPES[item.type] ? item.type : "combined", typeLabel: TYPES[item.type] || TYPES.combined,
    includeInContent: item.includeInContent !== false, progress: item.id ? 100 : 0, status: item.id ? "uploaded" : "ready",
    missing: Boolean(item.missing),
  }));
}
function paragraphAnchor(text, index, count) {
  const paragraphs = text.replace(/\r\n/g, "\n").split(/\n\s*\n/).map((item) => item.trim()).filter(Boolean);
  return (paragraphs[Math.min(paragraphs.length - 1, Math.floor(index * paragraphs.length / Math.max(count, 1)))] || "").slice(0, 120);
}
module.exports = { normalizeReferences, paragraphAnchor, TYPES };
