import math
import re
from collections import Counter
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from voonie.backend.app.db.models import DiaryArtifact, DiaryEntry, Job, MemoryItem, User
from voonie.backend.app.models.schemas import MemoryContextItem
from voonie.backend.app.providers.embeddings import EmbeddingProvider


def tokens(text: str) -> list[str]:
    normalized = re.sub(r"\s+", "", text.lower())
    latin = re.findall(r"[a-z0-9]+", normalized)
    han = [char for char in normalized if "\u4e00" <= char <= "\u9fff"]
    bigrams = ["".join(han[index:index + 2]) for index in range(len(han) - 1)]
    return latin + han + bigrams


def cosine(left: list[float], right: list[float]) -> float:
    if not left or len(left) != len(right):
        return 0.0
    left_norm = math.sqrt(sum(value * value for value in left))
    right_norm = math.sqrt(sum(value * value for value in right))
    if not left_norm or not right_norm:
        return 0.0
    return sum(a * b for a, b in zip(left, right)) / (left_norm * right_norm)


class MemoryService:
    def __init__(self, embedding_provider: EmbeddingProvider) -> None:
        self.embedding_provider = embedding_provider

    async def search(
        self,
        db: AsyncSession,
        user_id: str,
        query: str,
        *,
        limit: int = 5,
        now: datetime | None = None,
    ) -> list[MemoryContextItem]:
        user = await db.get(User, user_id)
        if user is None:
            return []

        # 1. Fetch user-scoped DiaryArtifacts
        artifact_stmt = (
            select(DiaryArtifact)
            .join(Job, Job.id == DiaryArtifact.job_id)
            .where(DiaryArtifact.user_id == user_id, Job.status == "done")
            .order_by(DiaryArtifact.created_at.desc())
            .limit(50)
        )
        artifacts = list((await db.scalars(artifact_stmt)).all())

        # 2. Fetch user-scoped DiaryEntries
        entry_stmt = (
            select(DiaryEntry)
            .where(DiaryEntry.user_id == user_id, DiaryEntry.status == "confirmed")
            .order_by(DiaryEntry.entry_date.desc())
            .limit(50)
        )
        entries = list((await db.scalars(entry_stmt)).all())

        # 3. Fetch user-scoped MemoryItems
        memory_stmt = (
            select(MemoryItem)
            .where(MemoryItem.user_id == user_id)
            .order_by(MemoryItem.happened_on.desc())
            .limit(50)
        )
        memories = list((await db.scalars(memory_stmt)).all())

        # Aggregate candidates
        candidates: list[dict] = []
        for a in artifacts:
            summary = a.transcript_redacted or a.companion_note or a.title
            candidates.append({
                "date": a.created_at.date().isoformat() if a.created_at else "",
                "title": a.title or "绘本日记",
                "summary": summary[:200],
                "emotion": a.emotion_label or "记录",
                "text_for_search": f"{a.title} {summary} {a.emotion_label}",
                "embedding": None,
                "created_at": a.created_at,
            })

        for e in entries:
            text = e.redacted_text or ""
            emotion_val = e.emotion_json.get("label", "记录") if isinstance(e.emotion_json, dict) else "记录"
            candidates.append({
                "date": (e.created_at or e.entry_date).date().isoformat() if (e.created_at or e.entry_date) else "",
                "title": f"手帐日记 ({emotion_val})",
                "summary": text[:200],
                "emotion": emotion_val,
                "text_for_search": f"{text} {emotion_val}",
                "embedding": None,
                "created_at": e.created_at or e.entry_date,
            })

        for m in memories:
            candidates.append({
                "date": (m.happened_on or m.created_at).date().isoformat() if (m.happened_on or m.created_at) else "",
                "title": m.title or "回忆记录",
                "summary": m.summary[:200],
                "emotion": m.emotion or "记录",
                "text_for_search": f"{m.title} {m.summary} {' '.join(m.tags_json or [])} {m.emotion}",
                "embedding": m.embedding,
                "created_at": m.happened_on or m.created_at,
            })

        if not candidates:
            return []

        query_tokens = tokens(query)
        if not query_tokens:
            return []

        doc_tokens_list = [tokens(c["text_for_search"]) for c in candidates]
        document_frequency = Counter(tok for terms in doc_tokens_list for tok in set(terms))

        query_embedding: list[float] = []
        if any(c["embedding"] for c in candidates):
            try:
                query_embedding = await self.embedding_provider.embed(query)
            except Exception:
                query_embedding = []

        scored: list[tuple[float, dict]] = []
        doc_count = len(candidates)
        avg_len = sum(len(terms) for terms in doc_tokens_list) / doc_count or 1.0

        for candidate, terms in zip(candidates, doc_tokens_list):
            counts = Counter(terms)
            bm25 = 0.0
            for tok in query_tokens:
                freq = counts[tok]
                if not freq:
                    continue
                idf = math.log(1 + (doc_count - document_frequency[tok] + 0.5) / (document_frequency[tok] + 0.5))
                denom = freq + 1.2 * (0.25 + 0.75 * len(terms) / avg_len)
                bm25 += idf * freq * 2.2 / denom

            vector_score = cosine(query_embedding, candidate["embedding"] or [])
            final_score = bm25 + max(vector_score, 0.0) * 0.5
            if final_score > 0:
                scored.append((final_score, candidate))

        # Sort by relevance score descending
        scored.sort(key=lambda pair: pair[0], reverse=True)

        # De-duplicate by title + date
        seen = set()
        results: list[MemoryContextItem] = []
        for score, cand in scored:
            key = (cand["title"], cand["date"])
            if key in seen:
                continue
            seen.add(key)
            results.append(
                MemoryContextItem(
                    happened_date=cand["date"],
                    title=cand["title"],
                    summary=cand["summary"],
                    emotion=cand["emotion"],
                )
            )
            if len(results) >= limit:
                break

        return results
