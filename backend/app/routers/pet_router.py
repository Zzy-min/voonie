from datetime import datetime
import json
from typing import Any, Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from voonie.backend.app.api.deps import get_current_user
from voonie.backend.app.db.models import DiaryArtifact, DiaryEntry, MemoryItem, User
from voonie.backend.app.db.session import get_db
from voonie.backend.app.models.schemas import PetChatRequest, PetChatResponse
from voonie.backend.app.services.pet_agent import PetCompanionAgent


router = APIRouter(prefix="/pet", tags=["Pet Companion"])


@router.post("/chat")
async def chat_with_pet(
    req: PetChatRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """与小宠物聊天（自动接入用户账户数据、昵称、最近日记与心情）。"""
    await request.app.state.rate_limiter.consume(
        db,
        current_user.id,
        "chat",
        request.app.state.settings.CHAT_HOURLY_LIMIT,
    )

    # 1. Real-time Chinese clock context
    now_cn = datetime.now(ZoneInfo("Asia/Shanghai"))
    hour = now_cn.hour
    time_period = "深夜" if hour < 6 else "早晨" if hour < 11 else "中午" if hour < 14 else "下午" if hour < 18 else "晚上"
    weekdays = ["星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"]
    time_context = f"{now_cn.strftime('%Y年%m月%d日')} {weekdays[now_cn.weekday()]} {time_period} {now_cn.strftime('%H:%M')}"

    # 2. User Profile Data
    nickname = req.user_nickname or current_user.nickname or "小主人"
    user_quote = getattr(current_user, "quote", "") or ""
    user_quote_note = getattr(current_user, "quote_note", "") or ""

    # 3. Query Total Diaries and Recent Diary Entries & Artifacts
    total_diaries = (
        await db.scalar(
            select(func.count()).select_from(DiaryArtifact).where(DiaryArtifact.user_id == current_user.id)
        )
    ) or 0

    recent_artifacts: list[DiaryArtifact] = []
    recent_entries: list[DiaryEntry] = []
    if current_user.memory_opt_in:
        recent_artifacts = list(
            (
                await db.scalars(
                    select(DiaryArtifact)
                    .where(DiaryArtifact.user_id == current_user.id)
                    .order_by(DiaryArtifact.created_at.desc())
                    .limit(5)
                )
            ).all()
        )

        recent_entries = list(
            (
                await db.scalars(
                    select(DiaryEntry)
                    .where(DiaryEntry.user_id == current_user.id)
                    .order_by(DiaryEntry.entry_date.desc())
                    .limit(5)
                )
            ).all()
        )

    # 4. Format Recent Diary Data
    recent_diaries_list: list[dict[str, Any]] = []
    emotions_list: list[str] = []

    for art in recent_artifacts:
        date_str = art.created_at.strftime("%Y-%m-%d") if art.created_at else ""
        recent_diaries_list.append({
            "date": date_str,
            "title": art.title,
            "text": art.transcript_redacted or art.companion_note,
            "emotion": f"{art.emotion_label} ({art.mood_score}/10)",
        })
        if art.emotion_label:
            emotions_list.append(art.emotion_label)

    for entry in recent_entries:
        date_str = entry.entry_date.strftime("%Y-%m-%d") if entry.entry_date else ""
        if not any(d["date"] == date_str for d in recent_diaries_list):
            emo_data = entry.emotion_json or {}
            label = emo_data.get("label", "平静")
            intensity = emo_data.get("intensity", 7)
            recent_diaries_list.append({
                "date": date_str,
                "title": "今日随笔",
                "text": entry.redacted_text,
                "emotion": f"{label} ({intensity}/10)",
            })
            emotions_list.append(label)

    # Mood Trend calculation
    recent_mood = req.recent_mood_trend
    if not recent_mood:
        if emotions_list:
            recent_mood = f"最近心情主要是：{'、'.join(set(emotions_list[:3]))}"
        else:
            recent_mood = "平静温和"

    # Contextual memory retrieval decision
    # Historical context is always loaded from the authenticated user's server-side data.
    # Client-supplied memory is intentionally ignored because it can be stale, cross-account,
    # or forged and must never be presented to the model as trusted diary history.
    context_items = []
    if current_user.memory_opt_in and PetCompanionAgent.should_retrieve_memory(req.message):
        try:
            context_items = await request.app.state.memory_service.search(db, current_user.id, req.message, limit=5)
        except Exception:
            context_items = []
    if not context_items:
        context_items = []

    history_list = [h.model_dump(mode="json") for h in req.history] if req.history else None

    response = await request.app.state.pet_agent.chat(
        message=req.message,
        pet_name=req.pet_name or "Voonie",
        pet_type=req.pet_type or "dog",
        user_nickname=nickname,
        user_quote=user_quote,
        user_quote_note=user_quote_note,
        time_context=time_context,
        total_diaries_count=total_diaries,
        recent_diaries=recent_diaries_list,
        history=history_list,
        local_memory_context=context_items,
        recent_mood_trend=recent_mood,
    )
    if not req.stream:
        return response

    async def events():
        for token in response.reply:
            yield f"event: token\ndata: {json.dumps({'token': token}, ensure_ascii=False)}\n\n"
        payload = {
            "pet_action": response.pet_action,
            "referenced_memories": response.referenced_memories or [],
        }
        yield f"event: action\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"

    return StreamingResponse(events(), media_type="text/event-stream")


@router.get("/status")
async def get_pet_status(pet_name: str = "Voonie", _current_user: User = Depends(get_current_user)):
    return {
        "pet_name": pet_name,
        "greeting": f"嗨！我是你的日记小管家 {pet_name}，今天发生了什么有趣的事吗？快说给我听听吧！🐾",
        "idle_animations": ["sleep", "look_around", "write_diary", "happy_dance"],
        "status": "ready",
    }


@router.get("/memories")
async def get_pet_memories(
    query: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not current_user.memory_opt_in:
        return []
    rows = (await db.scalars(
        select(MemoryItem).where(MemoryItem.user_id == current_user.id).order_by(MemoryItem.happened_on.desc())
    )).all()
    return [
        {
            "id": item.id,
            "title": item.title,
            "happened_date": (item.happened_on or item.created_at).date().isoformat(),
            "summary": item.summary,
            "emotion": item.emotion,
            "mood_score": item.mood_score,
        }
        for item in rows
        if not query or query in f"{item.title} {item.summary}"
    ][:10]
