from typing import Literal

from fastapi import APIRouter, Request, status
from sqlalchemy import text

from voonie.backend.app.core.exceptions import ApiError


router = APIRouter(tags=["Health"])


async def database_status(request: Request) -> Literal["ok", "unavailable"]:
    try:
        async with request.app.state.db_engine.connect() as connection:
            await connection.execute(text("SELECT 1"))
    except Exception:
        return "unavailable"
    return "ok"


async def redis_status(request: Request) -> Literal["ok", "skipped", "unavailable"]:
    if request.app.state.settings.ARQ_INLINE:
        return "skipped"
    try:
        await request.app.state.redis.ping()
    except Exception:
        return "unavailable"
    return "ok"


@router.get("/health")
async def health(request: Request) -> dict:
    db_status = await database_status(request)
    if db_status != "ok":
        raise ApiError(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "service_unhealthy",
            "Database health check failed",
            details={"database": db_status},
        )
    settings = request.app.state.settings
    return {
        "status": "ok",
        "app": settings.APP_NAME,
        "version": settings.VERSION,
        "checks": {"database": db_status},
    }


@router.get("/health/ready")
async def ready(request: Request) -> dict:
    checks = {
        "database": await database_status(request),
        "redis": await redis_status(request),
    }
    if checks["database"] != "ok" or checks["redis"] == "unavailable":
        raise ApiError(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "service_not_ready",
            "One or more required dependencies are unavailable",
            details=checks,
        )
    return {"status": "ready", "checks": checks}

