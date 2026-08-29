from __future__ import annotations

import re
from typing import Any

from voonie.backend.app.services.storyboard_agent import StoryboardAgent


def _is_exact_excerpt(value: Any, text: str) -> bool:
    excerpt = value.strip() if isinstance(value, str) else ""
    return bool(excerpt and excerpt in text)


def sanitize_legacy_diary_result(result: dict[str, Any], request_json: dict[str, Any] | None) -> dict[str, Any]:
    """Return a presentation-safe copy while leaving stored legacy data intact."""
    sanitized = dict(result)
    request_json = request_json or {}
    raw = str(result.get("raw_transcript") or request_json.get("text") or "")
    organized = str(result.get("organized_diary") or raw)
    source_text = f"{raw}\n{organized}"
    panel_limit = StoryboardAgent.illustration_count(raw)

    legacy_panels = [item for item in result.get("panels") or [] if isinstance(item, dict)]
    grounded_panels: list[dict[str, Any]] = []
    for item in legacy_panels:
        if not isinstance(item, dict):
            continue
        source_excerpt = item.get("source_excerpt")
        if not _is_exact_excerpt(source_excerpt, source_text):
            continue

        safe_panel = dict(item)
        safe_panel["narration"] = str(source_excerpt).strip()
        safe_panel["speech_bubble"] = None
        safe_panel["sfx"] = None
        grounded_panels.append(safe_panel)
        if len(grounded_panels) >= panel_limit:
            break

    if not grounded_panels and raw.strip():
        excerpts = [
            sentence.strip()
            for sentence in re.split(r"(?<=[。！？!?])", raw)
            if sentence.strip()
        ] or [raw.strip()]
        for index, item in enumerate(legacy_panels[:panel_limit]):
            excerpt = excerpts[min(index, len(excerpts) - 1)]
            safe_panel = dict(item)
            safe_panel["scene_desc"] = f"与原始记录“{excerpt[:60]}”对应的记忆插图"
            safe_panel["character_action"] = "仅表现原始记录中明确提到的人物、动作与情绪"
            safe_panel["source_excerpt"] = excerpt
            safe_panel["anchor_text"] = excerpt if excerpt in organized else organized
            safe_panel["narration"] = excerpt
            safe_panel["speech_bubble"] = None
            safe_panel["sfx"] = None
            safe_panel["visual_reason"] = "历史插图已按原始日记重新校准。"
            grounded_panels.append(safe_panel)

    sanitized["panels"] = grounded_panels
    return sanitized
