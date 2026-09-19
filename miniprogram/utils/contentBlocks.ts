export type ContentBlock = {
  type: "text" | "image";
  text?: string;
  url?: string;
  key: string;
};

export function paragraphizeDiary(text: string): string {
  const raw = (text || "").replace(/\r\n/g, "\n").trim();
  if (!raw) return "";
  if (/\n\s*\n/.test(raw)) {
    return raw
      .split(/\n\s*\n/)
      .map((item) => item.trim())
      .filter(Boolean)
      .join("\n\n");
  }

  const sentences = raw.split(/(?<=[。！？!?])/).map((item) => item.trim()).filter(Boolean);
  if (!sentences.length) return raw;

  const paragraphs: string[] = [];
  sentences.forEach((sentence) => {
    const chunks = sentence.length >= 36 && sentence.includes("，")
      ? splitLongSentence(sentence)
      : [sentence];
    chunks.forEach((chunk) => {
      if (paragraphs.length && paragraphs[paragraphs.length - 1].length < 28 && chunk.length < 28) {
        paragraphs[paragraphs.length - 1] += chunk;
      } else {
        paragraphs.push(chunk);
      }
    });
  });
  return paragraphs.join("\n\n");
}

function splitLongSentence(sentence: string): string[] {
  const clauses = sentence.split("，");
  if (clauses.length < 2) return [sentence];
  const chunks: string[] = [];
  let current = clauses[0];
  clauses.slice(1).forEach((clause) => {
    if (current.length >= 22) {
      chunks.push(current);
      current = clause;
    } else {
      current = `${current}，${clause}`;
    }
  });
  if (current) chunks.push(current);
  return chunks.length ? chunks : [sentence];
}

export function buildContentBlocks(content: string, imageUrls: string[], anchors: string[] = []): ContentBlock[] {
  const display = paragraphizeDiary(content);
  const paragraphs = display.split("\n\n").map((item) => item.trim()).filter(Boolean);
  const urls = imageUrls || [];
  const used = new Set<number>();
  const buckets = new Map<number, string[]>();

  urls.forEach((url, index) => {
    const anchor = (anchors[index] || "").trim();
    let paragraphIndex = paragraphIndexForAnchor(paragraphs, anchor, used);
    if (paragraphIndex < 0) {
      paragraphIndex = fallbackParagraphIndex(paragraphs, index, urls.length, used);
    }
    used.add(paragraphIndex);
    const bucket = buckets.get(paragraphIndex) || [];
    bucket.push(url);
    buckets.set(paragraphIndex, bucket);
  });

  const blocks: ContentBlock[] = [];
  paragraphs.forEach((text, index) => {
    blocks.push({ type: "text", text, key: `text-${index}` });
    (buckets.get(index) || []).forEach((url, imageIndex) => {
      blocks.push({ type: "image", url, key: `image-${index}-${imageIndex}` });
    });
  });
  if (!paragraphs.length) {
    urls.forEach((url, index) => blocks.push({ type: "image", url, key: `image-${index}` }));
  }
  return blocks;
}

function paragraphIndexForAnchor(paragraphs: string[], anchor: string, used: Set<number>): number {
  if (!anchor) return -1;
  const unused = paragraphs.findIndex((paragraph, index) => paragraph.includes(anchor) && !used.has(index));
  if (unused >= 0) return unused;
  return paragraphs.findIndex((paragraph) => paragraph.includes(anchor));
}

function fallbackParagraphIndex(paragraphs: string[], imageIndex: number, imageCount: number, used: Set<number>): number {
  if (!paragraphs.length) return 0;
  const guess = Math.min(
    paragraphs.length - 1,
    Math.max(0, Math.floor((imageIndex * paragraphs.length) / Math.max(imageCount, 1)))
  );
  if (!used.has(guess)) return guess;
  const free = paragraphs.findIndex((_, index) => !used.has(index));
  return free >= 0 ? free : guess;
}
