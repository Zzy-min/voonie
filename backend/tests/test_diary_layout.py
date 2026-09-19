from voonie.backend.app.services.diary_layout import build_content_blocks, paragraphize_diary


def _words(text: str) -> list[str]:
    import re

    return re.findall(r"[\u4e00-\u9fffA-Za-z0-9]+", text)


def test_paragraphize_keeps_user_words_and_splits_long_spoken_sentence():
    raw = (
        "今天我们来开会，因为教室被补考的人占用了，然后我们在门外等了很长时间，"
        "心情有点烦躁，还有点饿。"
    )
    organized = paragraphize_diary(raw)
    assert _words(organized) == _words(raw)
    paragraphs = [item for item in organized.split("\n\n") if item]
    assert len(paragraphs) >= 2
    assert "心情有点烦躁" in paragraphs[-1]
    assert "等了很长时间" in paragraphs[0]


def test_build_content_blocks_places_image_after_paragraph_not_mid_clause():
    raw = (
        "今天我们来开会，因为教室被补考的人占用了，然后我们在门外等了很长时间，"
        "心情有点烦躁，还有点饿。"
    )
    blocks = build_content_blocks(raw, ["https://img/1.png"], ["等了很长时间"])
    types = [item["type"] for item in blocks]
    texts = [item.get("text", "") for item in blocks if item["type"] == "text"]
    joined = "".join(texts)
    assert "image" in types
    assert types[0] == "text"
    assert "等了很长时间" in blocks[0]["text"]
    assert "心情有点烦躁" not in blocks[0]["text"]
    assert any("心情有点烦躁" in text for text in texts)
    assert "，心情" not in joined
    image_index = types.index("image")
    assert image_index > 0
    assert types[image_index - 1] == "text"


def test_short_diary_stays_one_paragraph():
    raw = "今天看到一朵很好看的云。"
    assert paragraphize_diary(raw) == raw
