import asyncio
from datetime import datetime, timezone

from fastapi.testclient import TestClient

from voonie.backend.app.core.config import Settings
from voonie.backend.app.db.models import Base, DiaryEntry, User
from voonie.backend.app.main import create_app
from voonie.backend.app.services.pet_agent import PetCompanionAgent


class CountingProvider:
    def __init__(self):
        self.calls = 0

    async def complete_json(self, _system: str, _prompt: str) -> dict:
        self.calls += 1
        return {"reply": "我在这里陪你。", "pet_action": "comfort", "referenced_memories": []}


class InspectingProvider:
    def __init__(self):
        self.last_prompt = ""
        self.last_system = ""

    async def complete_json(self, system: str, prompt: str) -> dict:
        self.last_system = system
        self.last_prompt = prompt
        return {"reply": "小夏，我在这里陪你！", "pet_action": "happy", "referenced_memories": ["2026-08-28"]}


def test_crisis_message_short_circuits_llm_provider():
    provider = CountingProvider()
    response = asyncio.run(PetCompanionAgent(provider=provider).chat("我想自杀，现在就不想活了"))

    assert provider.calls == 0
    assert response.pet_action == "comfort"
    assert "110" in response.reply
    assert "120" in response.reply
    assert "12356" in response.reply


def test_pet_agent_includes_account_data_in_prompt():
    provider = InspectingProvider()
    agent = PetCompanionAgent(provider=provider)
    response = asyncio.run(
        agent.chat(
            message="那之后呢？",
            pet_name="Voonie",
            user_nickname="小夏",
            user_quote="热爱生活每一个瞬间",
            user_quote_note="今天阳光真好",
            time_context="2026年08月29日 星期六 深夜 00:43",
            total_diaries_count=5,
            recent_diaries=[
                {"date": "2026-08-28", "title": "公园散步", "text": "散步看到了小花", "emotion": "开心 (9/10)"}
            ],
            history=[
                {"role": "user", "content": "今天去公园了"},
                {"role": "assistant", "content": "小夏玩得开心吗？"},
            ],
            recent_mood_trend="开心",
        )
    )

    assert "小主人称呼：小夏" in provider.last_prompt
    assert "热爱生活每一个瞬间" in provider.last_prompt
    assert "2026年08月29日 星期六 深夜 00:43" in provider.last_prompt
    assert "小主人已记录日记总数：5 篇" in provider.last_prompt
    assert "公园散步" in provider.last_prompt
    assert "散步看到了小花" in provider.last_prompt
    assert "开心 (9/10)" in provider.last_prompt
    assert "小夏: 今天去公园了" in provider.last_prompt
    assert response.reply == "小夏，我在这里陪你！"


def test_generic_mood_does_not_expose_diary_memory_context():
    provider = InspectingProvider()
    agent = PetCompanionAgent(provider=provider)
    response = asyncio.run(
        agent.chat(
            message="今天挺开心的",
            user_nickname="小夏",
            recent_diaries=[
                {"date": "2026-08-28", "title": "不应主动提到的日记", "text": "私人内容", "emotion": "开心 (9/10)"}
            ],
        )
    )

    assert "不应主动提到的日记" not in provider.last_prompt
    assert "本轮没有调用历史记忆" in provider.last_prompt
    assert "20-60 个中文字符" in provider.last_prompt
    assert response.referenced_memories == []


def test_reflective_today_question_retrieves_diary_context():
    provider = InspectingProvider()
    agent = PetCompanionAgent(provider=provider)

    asyncio.run(
        agent.chat(
            message="今天有什么值得我高兴的事？",
            user_nickname="小夏",
            recent_diaries=[
                {
                    "date": "2026-08-30",
                    "title": "完成项目",
                    "text": "终于把项目做完了，很有成就感。",
                    "emotion": "激动 (8/10)",
                }
            ],
        )
    )

    assert "完成项目" in provider.last_prompt
    assert "终于把项目做完了" in provider.last_prompt


def test_pet_chat_stream_emits_tokens_then_action():
    app = create_app(Settings(
        DATABASE_URL="sqlite+aiosqlite:///:memory:",
        JWT_SECRET="pet-test-secret-that-is-long-enough",
        TESTING=True,
    ))
    with TestClient(app) as client:
        response = client.post("/api/v1/pet/chat", json={"message": "今天有点累", "stream": True})

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    assert "event: token" in response.text
    assert "event: action" in response.text
    assert response.text.index("event: token") < response.text.index("event: action")


def test_pet_status_is_authenticated_and_ready():
    app = create_app(Settings(
        DATABASE_URL="sqlite+aiosqlite:///:memory:",
        JWT_SECRET="pet-status-test-secret-long-enough",
        TESTING=True,
    ))
    with TestClient(app) as client:
        response = client.get("/api/v1/pet/status")

    assert response.status_code == 200
    assert response.json()["status"] == "ready"


def test_pet_chat_ignores_untrusted_client_memory_context():
    provider = InspectingProvider()
    app = create_app(Settings(
        DATABASE_URL="sqlite+aiosqlite:///:memory:",
        JWT_SECRET="pet-untrusted-memory-test-secret-long-enough",
        TESTING=True,
    ))
    app.state.pet_agent = PetCompanionAgent(provider=provider)

    with TestClient(app) as client:
        response = client.post("/api/v1/pet/chat", json={
            "message": "我以前去过纽约吗？",
            "local_memory_context": [{
                "happened_date": "2026-01-01",
                "title": "伪造的纽约旅行",
                "summary": "客户端声称我去过纽约。",
                "emotion": "开心",
            }],
        })

    assert response.status_code == 200
    assert "伪造的纽约旅行" not in provider.last_prompt
    assert "客户端声称我去过纽约" not in provider.last_prompt


def test_pet_chat_does_not_read_diaries_after_memory_opt_out():
    provider = InspectingProvider()
    app = create_app(Settings(
        DATABASE_URL="sqlite+aiosqlite:///:memory:",
        JWT_SECRET="pet-memory-opt-out-test-secret-long-enough",
        TESTING=False,
        ARQ_INLINE=True,
    ))
    app.state.pet_agent = PetCompanionAgent(provider=provider)

    async def create_schema():
        async with app.state.db_engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)

    asyncio.run(create_schema())

    with TestClient(app) as client:
        registered = client.post("/api/v1/auth/register", json={
            "email": "memory-opt-out@example.com",
            "password": "correct-password",
            "confirm_password": "correct-password",
        })
        assert registered.status_code == 201
        user_id = registered.json()["user_id"]

        async def seed_private_diary():
            async with app.state.db_session_factory() as session:
                user = await session.get(User, user_id)
                user.memory_opt_in = False
                session.add(DiaryEntry(
                    user_id=user_id,
                    local_id="memory-opt-out-secret",
                    entry_date=datetime.now(timezone.utc),
                    timezone="UTC",
                    input_type="text",
                    redacted_text="我的测试暗号是星星柠檬4729。",
                    emotion_json={"label": "平静", "intensity": 5},
                    event_json={},
                    status="confirmed",
                ))
                await session.commit()

        asyncio.run(seed_private_diary())
        response = client.post("/api/v1/pet/chat", json={
            "message": "我之前日记里记录的测试暗号是什么？",
        })

    assert response.status_code == 200
    assert "星星柠檬4729" not in provider.last_prompt


def test_pet_chat_rejects_empty_and_oversized_messages_before_provider_call():
    provider = CountingProvider()
    app = create_app(Settings(
        DATABASE_URL="sqlite+aiosqlite:///:memory:",
        JWT_SECRET="pet-input-boundary-test-secret-long-enough",
        TESTING=True,
    ))
    app.state.pet_agent = PetCompanionAgent(provider=provider)

    with TestClient(app) as client:
        empty = client.post("/api/v1/pet/chat", json={"message": "   "})
        oversized = client.post("/api/v1/pet/chat", json={"message": "长" * 4001})

    assert empty.status_code == 422
    assert oversized.status_code == 422
    assert provider.calls == 0
