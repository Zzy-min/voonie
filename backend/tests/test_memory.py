import asyncio
from datetime import datetime, timedelta, timezone

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from voonie.backend.app.db.models import Base, MemoryItem, User
from voonie.backend.app.providers.embeddings import MockEmbeddingProvider
from voonie.backend.app.services.memory_service import MemoryService


def test_memory_search_uses_real_user_rows_and_limits_results():
    async def scenario():
        engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        factory = async_sessionmaker(engine, expire_on_commit=False)
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        provider = MockEmbeddingProvider()
        service = MemoryService(provider)
        now = datetime(2026, 8, 28, tzinfo=timezone.utc)
        async with factory() as session:
            owner = User(device_id="memory-owner", memory_opt_in=True)
            other = User(device_id="memory-other", memory_opt_in=True)
            session.add_all([owner, other])
            await session.flush()
            rows = [
                ("第一次做提拉米苏", "上周六在厨房做成功了提拉米苏", now - timedelta(days=6)),
                ("雨天咖啡馆", "雨天喝了一杯拿铁", now - timedelta(days=5)),
                ("散步", "晚饭后去公园散步", now - timedelta(days=4)),
                ("看书", "读完了一本小说", now - timedelta(days=3)),
            ]
            for title, summary, happened_on in rows:
                session.add(MemoryItem(
                    user_id=owner.id,
                    happened_on=happened_on,
                    title=title,
                    summary=summary,
                    embedding=await provider.embed(f"{title} {summary}"),
                    tags_json=["diary"],
                ))
            session.add(MemoryItem(
                user_id=other.id,
                happened_on=now - timedelta(days=6),
                title="别人的提拉米苏",
                summary="不应被当前用户检索到",
                embedding=await provider.embed("别人的提拉米苏"),
                tags_json=[],
            ))
            await session.commit()

            results = await service.search(session, owner.id, "上周做提拉米苏那天发生了什么", now=now)

            assert len(results) <= 3
            assert results[0].title == "第一次做提拉米苏"
            assert all("别人" not in item.title for item in results)
        await engine.dispose()

    asyncio.run(scenario())


def test_memory_search_returns_nothing_for_opted_out_user():
    async def scenario():
        engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        factory = async_sessionmaker(engine, expire_on_commit=False)
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        async with factory() as session:
            user = User(device_id="memory-off", memory_opt_in=False)
            session.add(user)
            await session.flush()
            session.add(MemoryItem(user_id=user.id, title="stale", summary="must not leak", tags_json=[]))
            await session.commit()

            results = await MemoryService(MockEmbeddingProvider()).search(session, user.id, "stale")

            assert results == []
        await engine.dispose()

    asyncio.run(scenario())
