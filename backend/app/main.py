import asyncio
import json
import logging
import time
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from arq import create_pool
from arq.connections import RedisSettings
from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from redis.exceptions import RedisError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from voonie.backend.app.api.routers import auth, entries, health, jobs
from voonie.backend.app.api.deps import TEST_USER_ID, get_current_user
from voonie.backend.app.core.config import Settings, settings
from voonie.backend.app.core.exceptions import ApiError, register_exception_handlers
from voonie.backend.app.routers import diary_router, pet_router
from voonie.backend.app.services.comic_composer import ComicComposer
from voonie.backend.app.services.image_gen_service import ImageGenService
from voonie.backend.app.services.storage_service import StorageService
from voonie.backend.app.services.storyboard_agent import StoryboardAgent
from voonie.backend.app.services.asr_service import ASRService
from voonie.backend.app.providers.embeddings import get_embedding_provider
from voonie.backend.app.services.memory_service import MemoryService
from voonie.backend.app.services.rate_limiter import RateLimiter
from voonie.backend.app.services.pet_agent import PetCompanionAgent
from voonie.backend.app.db.models import Base, Character, CharacterReference, DiaryArtifact, Panel, User
from voonie.backend.app.db.session import get_db

WEB_DIR = Path(__file__).resolve().parents[2] / "web"
LEGACY_WEB_DIR = WEB_DIR


def build_lifespan(app_settings: Settings):
    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        app_settings.TEMP_MEDIA_DIR.mkdir(parents=True, exist_ok=True)
        if app_settings.TESTING:
            async with app.state.db_engine.begin() as connection:
                await connection.run_sync(Base.metadata.create_all)
            async with app.state.db_session_factory() as session:
                if await session.get(User, TEST_USER_ID) is None:
                    session.add(User(id=TEST_USER_ID, device_id="test-device"))
                    await session.commit()
        http_client = httpx.AsyncClient()
        app.state.http_client = http_client
        if not app_settings.ARQ_INLINE:
            try:
                redis_settings = RedisSettings.from_dsn(app_settings.REDIS_URL)
                redis_settings.conn_retries = 1
                redis_settings.conn_retry_delay = 0
                app.state.arq_pool = await create_pool(redis_settings)
                app.state.redis = app.state.arq_pool
            except (OSError, RedisError):
                app.state.arq_pool = None
                app.state.redis = None
        try:
            yield
        finally:
            if app.state.inline_tasks:
                await asyncio.gather(*app.state.inline_tasks, return_exceptions=True)
            if app.state.arq_pool is not None:
                await app.state.arq_pool.aclose()
            await http_client.aclose()
            await app.state.db_engine.dispose()

    return lifespan


def create_app(app_settings: Settings | None = None) -> FastAPI:
    app_settings = app_settings or settings
    app = FastAPI(
        title=app_settings.APP_NAME,
        version=app_settings.VERSION,
        description="Voonie voice comic diary and companion API",
        lifespan=build_lifespan(app_settings),
    )
    app.state.settings = app_settings
    app.state.db_engine = create_async_engine(app_settings.DATABASE_URL)
    app.state.db_session_factory = async_sessionmaker(app.state.db_engine, expire_on_commit=False)
    app.state.redis = None
    app.state.arq_pool = None
    app.state.inline_tasks = set()
    app.state.storage = StorageService(app_settings)
    app.state.storyboard_agent = StoryboardAgent(app_settings=app_settings)
    app.state.image_service = ImageGenService(app_settings=app_settings, storage=app.state.storage)
    app.state.composer = ComicComposer(storage=app.state.storage)
    app.state.asr_service = ASRService(app_settings=app_settings)
    app.state.embedding_provider = get_embedding_provider(app_settings)
    app.state.memory_service = MemoryService(app.state.embedding_provider)
    app.state.rate_limiter = RateLimiter()
    app.state.pet_agent = PetCompanionAgent(app_settings=app_settings)
    from voonie.backend.app.services.diary_analyzer import DiaryAnalyzer
    app.state.diary_analyzer = DiaryAnalyzer(app_settings=app_settings)

    wildcard_cors = "*" in app_settings.CORS_ORIGINS
    app.add_middleware(
        CORSMiddleware,
        allow_origins=app_settings.CORS_ORIGINS,
        allow_credentials=not wildcard_cors,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "Prefer", "Idempotency-Key"],
    )

    register_exception_handlers(app)

    access_logger = logging.getLogger("voonie.access")

    @app.middleware("http")
    async def structured_access_log(request: Request, call_next):
        request_id = request.headers.get("X-Request-ID") or uuid.uuid4().hex
        request.state.request_id = request_id
        started = time.perf_counter()
        response = None
        status_code = 500
        try:
            response = await call_next(request)
            status_code = response.status_code
            return response
        finally:
            if response is not None:
                response.headers["X-Request-ID"] = request_id
            access_logger.info(json.dumps({
                "event": "http_request",
                "request_id": request_id,
                "user_id": getattr(request.state, "user_id", None),
                "job_id": getattr(request.state, "job_id", None),
                "stage": "request_complete",
                "method": request.method,
                "path": request.url.path,
                "status": status_code,
                "provider_latency_ms": None,
                "tokens": None,
                "cost_usd": None,
                "duration_ms": round((time.perf_counter() - started) * 1000, 2),
            }, separators=(",", ":")))
    app.include_router(health.router)
    app.include_router(auth.router, prefix=app_settings.API_PREFIX)
    app.include_router(jobs.router, prefix=app_settings.API_PREFIX)
    app.include_router(entries.router, prefix=app_settings.API_PREFIX)
    from voonie.backend.app.api.routers import artifacts, characters, daily
    app.include_router(characters.router, prefix=app_settings.API_PREFIX)
    app.include_router(artifacts.router, prefix=app_settings.API_PREFIX)
    app.include_router(daily.router, prefix=app_settings.API_PREFIX)
    from voonie.backend.app.api.routers import me
    app.include_router(me.router, prefix=app_settings.API_PREFIX)
    app.include_router(diary_router.router, prefix=app_settings.API_PREFIX)
    app.include_router(pet_router.router, prefix=app_settings.API_PREFIX)

    app_settings.TEMP_MEDIA_DIR.mkdir(parents=True, exist_ok=True)

    @app.get("/media/{filename}", name="media")
    async def serve_private_media(
        filename: str,
        current_user: User = Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
    ):
        if Path(filename).name != filename:
            raise ApiError(404, "media_not_found", "Media not found")
        artifacts = (await db.scalars(
            select(DiaryArtifact).where(DiaryArtifact.user_id == current_user.id)
        )).all()
        owned_keys = {
            key for artifact in artifacts
            for key in [artifact.composite_key, *(artifact.panel_keys_json or [])]
            if key
        }
        artifact_ids = [artifact.id for artifact in artifacts]
        if artifact_ids:
            panels = (await db.scalars(select(Panel).where(Panel.artifact_id.in_(artifact_ids)))).all()
            owned_keys.update(panel.image_key for panel in panels if panel.image_key)
        character_keys = (await db.scalars(
            select(CharacterReference.media_key)
            .join(Character, Character.id == CharacterReference.character_id)
            .where(Character.user_id == current_user.id)
        )).all()
        owned_keys.update(character_keys)
        matched = next((key for key in owned_keys if Path(key).name == filename), None)
        if matched is None:
            raise ApiError(404, "media_not_found", "Media not found")
        media_path = app_settings.TEMP_MEDIA_DIR / filename
        if not media_path.is_file():
            raise ApiError(404, "media_not_found", "Media not found")
        return FileResponse(str(media_path))

    assets_dir = LEGACY_WEB_DIR / "assets"
    assets_dir.mkdir(parents=True, exist_ok=True)
    app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets")
    app.mount("/static", StaticFiles(directory=str(LEGACY_WEB_DIR)), name="static")

    @app.get("/")
    async def serve_index():
        return {
            "status": "ok",
            "app": app_settings.APP_NAME,
            "ui": "v2",
            "ui_dev": "http://127.0.0.1:5173/",
            "legacy_ui": "/legacy/",
        }

    @app.get("/legacy/")
    async def serve_legacy_index():
        index_file = LEGACY_WEB_DIR / "index.html"
        if index_file.exists():
            return FileResponse(str(index_file))
        return {"status": "missing", "app": app_settings.APP_NAME}

    @app.get("/style.css")
    async def serve_css():
        return FileResponse(str(LEGACY_WEB_DIR / "style.css"))

    @app.get("/app.js")
    async def serve_js():
        return FileResponse(str(LEGACY_WEB_DIR / "app.js"))

    return app


app = create_app()

if __name__ == "__main__":
    import uvicorn

    uvicorn.run("voonie.backend.app.main:app", host="0.0.0.0", port=8000, reload=True)
