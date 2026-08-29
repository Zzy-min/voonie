from voonie.backend.app.services.legacy_diary_sanitizer import sanitize_legacy_diary_result


def panel(panel_id: int, *, source_excerpt: str = "", anchor_text: str = "") -> dict:
    return {
        "panel_id": panel_id,
        "shot_type": "medium_shot",
        "scene_desc": "虚构的未来场景",
        "character_action": "用户没有提到的动作",
        "narration": "后来一切突然变好了。",
        "speech_bubble": {"text": "终于到家啦！", "bubble_type": "speech"},
        "sfx": "叮咚",
        "image_url": f"/media/{panel_id}.png",
        "source_excerpt": source_excerpt,
        "anchor_text": anchor_text,
        "emotion_label": "开心",
        "visual_reason": "",
        "forbidden": [],
    }


def test_reanchors_legacy_panels_without_changing_diary_text_or_removing_all_images():
    raw = "今天和同学参展回来，地铁上全是人，我们坐了十站，感觉很烦。"
    result = {
        "raw_transcript": raw,
        "title": "地铁里的十站路",
        "panels": [panel(index) for index in range(1, 5)],
    }

    sanitized = sanitize_legacy_diary_result(result, {"text": raw})

    assert sanitized["raw_transcript"] == raw
    assert len(sanitized["panels"]) == 1
    assert sanitized["panels"][0]["image_url"] == "/media/1.png"
    assert sanitized["panels"][0]["source_excerpt"] == raw
    assert sanitized["panels"][0]["anchor_text"] == raw
    assert sanitized["panels"][0]["narration"] == raw
    assert sanitized["panels"][0]["speech_bubble"] is None
    assert result["panels"] != []


def test_keeps_only_grounded_panels_within_length_limit_and_removes_fabricated_captions():
    raw = "晚上回来的时候看到晚霞特别漂亮。"
    result = {
        "raw_transcript": raw,
        "organized_diary": raw,
        "panels": [
            panel(1, source_excerpt=raw, anchor_text=raw),
            panel(2, source_excerpt=raw, anchor_text=raw),
        ],
    }

    sanitized = sanitize_legacy_diary_result(result, {"text": raw})

    assert len(sanitized["panels"]) == 1
    kept = sanitized["panels"][0]
    assert kept["narration"] == raw
    assert kept["speech_bubble"] is None
    assert kept["sfx"] is None


def test_longer_diary_keeps_up_to_expected_grounded_panel_count():
    sentences = [f"第{index}段真实记录。" for index in range(1, 16)]
    raw = "".join(sentences)
    result = {
        "raw_transcript": raw,
        "organized_diary": raw,
        "panels": [
            panel(index, source_excerpt=sentences[index - 1], anchor_text=sentences[index - 1])
            for index in range(1, 5)
        ],
    }

    sanitized = sanitize_legacy_diary_result(result, {"text": raw})

    assert len(raw) >= 80
    assert len(raw) < 240
    assert len(sanitized["panels"]) == 2
