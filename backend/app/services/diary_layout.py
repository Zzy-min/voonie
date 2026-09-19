import re

_SENTENCE_END = re.compile(r"[。！？!?]")


def paragraphize_diary(text: str) -> str:
    raw = (text or "").replace("\r\n", "\n").strip()
    if not raw:
        return ""
    if re.search(r"\n\s*\n", raw):
        return "\n\n".join(part.strip() for part in re.split(r"\n\s*\n", raw) if part.strip())

    sentences = [item.strip() for item in re.split(r"(?<=[。！？!?])", raw) if item.strip()]
    if not sentences:
        return raw

    paragraphs: list[str] = []
    for sentence in sentences:
        chunks = _split_long_sentence(sentence) if len(sentence) >= 36 and "，" in sentence else [sentence]
        for chunk in chunks:
            if paragraphs and len(paragraphs[-1]) < 28 and len(chunk) < 28:
                paragraphs[-1] += chunk
            else:
                paragraphs.append(chunk)
    return "\n\n".join(paragraphs)


def _split_long_sentence(sentence: str) -> list[str]:
    clauses = sentence.split("，")
    if len(clauses) < 2:
        return [sentence]
    chunks: list[str] = []
    current = clauses[0]
    for clause in clauses[1:]:
        if len(current) >= 22:
            chunks.append(current)
            current = clause
        else:
            current = f"{current}，{clause}"
    if current:
        chunks.append(current)
    return chunks or [sentence]


def snap_to_block_end(text: str, position: int) -> int:
    if position <= 0:
        return 0
    if position >= len(text):
        return len(text)
    rest = text[position:]
    paragraph_break = rest.find("\n\n")
    sentence = _SENTENCE_END.search(rest)
    candidates: list[int] = []
    if paragraph_break >= 0:
        candidates.append(position + paragraph_break)
    if sentence:
        candidates.append(position + sentence.end())
    return min(candidates) if candidates else len(text)


def build_content_blocks(
    content: str,
    image_urls: list[str],
    anchors: list[str] | None = None,
) -> list[dict[str, str]]:
    display = paragraphize_diary(content)
    paragraphs = [item for item in display.split("\n\n") if item]
    urls = list(image_urls or [])
    anchor_list = list(anchors or [])
    if not paragraphs and display:
        paragraphs = [display]

    placements: list[tuple[int, str]] = []
    used_paragraphs: set[int] = set()
    for index, url in enumerate(urls):
        anchor = (anchor_list[index] if index < len(anchor_list) else "").strip()
        paragraph_index = _paragraph_index_for_anchor(paragraphs, anchor, used_paragraphs)
        if paragraph_index < 0:
            paragraph_index = _fallback_paragraph_index(paragraphs, index, len(urls), used_paragraphs)
        used_paragraphs.add(paragraph_index)
        placements.append((paragraph_index, url))

    buckets: dict[int, list[str]] = {}
    for paragraph_index, url in placements:
        buckets.setdefault(paragraph_index, []).append(url)

    blocks: list[dict[str, str]] = []
    for index, paragraph in enumerate(paragraphs):
        blocks.append({"type": "text", "text": paragraph, "key": f"text-{index}"})
        for image_index, url in enumerate(buckets.get(index, [])):
            blocks.append({"type": "image", "url": url, "key": f"image-{index}-{image_index}"})
    if not paragraphs:
        for index, url in enumerate(urls):
            blocks.append({"type": "image", "url": url, "key": f"image-{index}"})
    return blocks


def _paragraph_index_for_anchor(paragraphs: list[str], anchor: str, used: set[int]) -> int:
    if not anchor:
        return -1
    for index, paragraph in enumerate(paragraphs):
        if anchor in paragraph and index not in used:
            return index
    for index, paragraph in enumerate(paragraphs):
        if anchor in paragraph:
            return index
    return -1


def _fallback_paragraph_index(paragraphs: list[str], image_index: int, image_count: int, used: set[int]) -> int:
    if not paragraphs:
        return 0
    guess = min(len(paragraphs) - 1, max(0, (image_index * len(paragraphs)) // max(image_count, 1)))
    if guess not in used:
        return guess
    for index in range(len(paragraphs)):
        if index not in used:
            return index
    return guess
