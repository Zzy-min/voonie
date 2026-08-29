import re
from datetime import datetime, timezone
import hashlib
import hmac
import secrets

from fastapi import APIRouter, Depends, Request, Response, status
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from voonie.backend.app.api.deps import get_current_user
from voonie.backend.app.core.exceptions import ApiError
from voonie.backend.app.core.security import (
    TokenValidationError,
    create_token,
    decode_token,
    hash_password,
    hash_refresh_token,
    verify_password,
)
from voonie.backend.app.db.models import RefreshToken, User
from voonie.backend.app.db.session import get_db
from voonie.backend.app.schemas.auth import (
    DeviceAuthRequest,
    EmailLoginRequest,
    EmailRegisterRequest,
    RefreshRequest,
    TokenResponse,
    UserResponse,
)


router = APIRouter(prefix="/auth", tags=["Authentication"])

EMAIL_REGEX = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


async def issue_token_pair(user: User, request: Request, response: Response, db: AsyncSession) -> TokenResponse:
    settings = request.app.state.settings
    access_token, _ = create_token(user.id, "access", settings, user.auth_version)
    refresh_token, refresh_expires_at = create_token(user.id, "refresh", settings, user.auth_version)
    db.add(
        RefreshToken(
            user_id=user.id,
            hashed_token=hash_refresh_token(refresh_token),
            expires_at=refresh_expires_at,
        )
    )
    cookie_options = {
        "httponly": True,
        "secure": settings.COOKIE_SECURE,
        "samesite": "lax",
    }
    response.set_cookie(
        "voonie_access",
        access_token,
        max_age=settings.ACCESS_TOKEN_MINUTES * 60,
        path="/",
        **cookie_options,
    )
    response.set_cookie(
        "voonie_refresh",
        refresh_token,
        max_age=settings.REFRESH_TOKEN_DAYS * 24 * 60 * 60,
        path=f"{settings.API_PREFIX}/auth",
        **cookie_options,
    )
    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        expires_in=settings.ACCESS_TOKEN_MINUTES * 60,
        user_id=user.id,
        email=user.email,
        nickname=user.nickname,
    )


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def register_by_email(
    body: EmailRegisterRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> TokenResponse:
    email = body.email.strip().lower()
    if not EMAIL_REGEX.match(email):
        raise ApiError(status.HTTP_422_UNPROCESSABLE_ENTITY, "invalid_email_format", "请输入有效的邮箱地址")

    if len(body.password) < 6:
        raise ApiError(status.HTTP_422_UNPROCESSABLE_ENTITY, "password_too_short", "密码长度至少需要 6 个字符")

    if body.confirm_password is not None and body.password != body.confirm_password:
        raise ApiError(status.HTTP_422_UNPROCESSABLE_ENTITY, "password_mismatch", "两次输入的密码不一致")

    existing_user = await db.scalar(select(User).where(User.email == email))
    if existing_user is not None:
        raise ApiError(status.HTTP_409_CONFLICT, "email_already_registered", "该邮箱已被注册，请直接登录")

    user = User(
        email=email,
        password_hash=hash_password(body.password),
        nickname=body.nickname or "小主人",
        memory_opt_in=True,
    )
    db.add(user)
    try:
        await db.flush()
    except IntegrityError as exc:
        await db.rollback()
        raise ApiError(status.HTTP_409_CONFLICT, "email_already_registered", "该邮箱已被注册，请直接登录") from exc

    tokens = await issue_token_pair(user, request, response, db)
    await db.commit()
    return tokens


@router.post("/login", response_model=TokenResponse)
async def login_by_email(
    body: EmailLoginRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> TokenResponse:
    email = body.email.strip().lower()
    if not email:
        raise ApiError(status.HTTP_422_UNPROCESSABLE_ENTITY, "missing_email", "请输入邮箱地址")

    user = await db.scalar(select(User).where(User.email == email))
    if user is None or not verify_password(body.password, user.password_hash):
        if user is not None:
            await request.app.state.rate_limiter.consume(
                db,
                user.id,
                "login_failed",
                request.app.state.settings.LOGIN_FAILED_HOURLY_LIMIT,
            )
        raise ApiError(status.HTTP_401_UNAUTHORIZED, "invalid_credentials", "邮箱或密码错误，请核对后重试")

    tokens = await issue_token_pair(user, request, response, db)
    await db.commit()
    return tokens


@router.post("/logout")
async def logout(
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    authorization = request.headers.get("Authorization", "")
    bearer_token = authorization[7:] if authorization.lower().startswith("bearer ") else None
    token = request.cookies.get("voonie_access") or bearer_token
    if token:
        try:
            payload = decode_token(token, "access", request.app.state.settings)
            user_id = payload.get("sub")
            if user_id:
                user = await db.get(User, user_id)
                if user is not None:
                    user.auth_version += 1
                await db.execute(delete(RefreshToken).where(RefreshToken.user_id == user_id))
                await db.commit()
        except Exception:
            pass

    response.delete_cookie("voonie_access", path="/")
    response.delete_cookie("voonie_refresh", path=f"{request.app.state.settings.API_PREFIX}/auth")
    return {"ok": True, "message": "已成功退出登录"}


@router.get("/me", response_model=UserResponse)
async def get_me(current_user: User = Depends(get_current_user)) -> UserResponse:
    return UserResponse(
        id=current_user.id,
        email=current_user.email,
        nickname=current_user.nickname,
        quote=current_user.quote,
        quote_note=current_user.quote_note,
        memory_opt_in=current_user.memory_opt_in,
        created_at=current_user.created_at.isoformat() if current_user.created_at else None,
    )


@router.post("/device", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def register_device(
    body: DeviceAuthRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> TokenResponse:
    user = await db.scalar(select(User).where(User.device_id == body.device_id))
    issued_device_secret: str | None = None
    if user is None:
        issued_device_secret = secrets.token_urlsafe(32)
        user = User(
            device_id=body.device_id,
            device_secret_hash=hashlib.sha256(issued_device_secret.encode()).hexdigest(),
            memory_opt_in=request.app.state.settings.MEMORY_OPT_IN_DEFAULT,
        )
        db.add(user)
        try:
            await db.flush()
        except IntegrityError as exc:
            await db.rollback()
            raise ApiError(
                status.HTTP_409_CONFLICT,
                "device_registration_raced",
                "Device registration raced with another request; retry with the issued device proof",
            ) from exc
    else:
        supplied_secret = body.device_secret or request.cookies.get("voonie_device")
        supplied_hash = hashlib.sha256((supplied_secret or "").encode()).hexdigest()
        legacy_session_valid = False
        if not user.device_secret_hash:
            authorization = request.headers.get("Authorization", "")
            bearer_token = authorization[7:] if authorization.lower().startswith("bearer ") else None
            access_cookie = request.cookies.get("voonie_access") or bearer_token
            try:
                legacy_session_valid = bool(
                    access_cookie
                    and decode_token(access_cookie, "access", request.app.state.settings).get("sub") == user.id
                )
            except TokenValidationError:
                legacy_session_valid = False
            if legacy_session_valid:
                issued_device_secret = secrets.token_urlsafe(32)
                user.device_secret_hash = hashlib.sha256(issued_device_secret.encode()).hexdigest()
        if not legacy_session_valid and (
            not user.device_secret_hash or not hmac.compare_digest(user.device_secret_hash, supplied_hash)
        ):
            raise ApiError(status.HTTP_401_UNAUTHORIZED, "device_proof_required", "Device proof is required")
    if issued_device_secret:
        response.set_cookie(
            "voonie_device",
            issued_device_secret,
            max_age=365 * 24 * 60 * 60,
            path=f"{request.app.state.settings.API_PREFIX}/auth",
            httponly=True,
            secure=request.app.state.settings.COOKIE_SECURE,
            samesite="lax",
        )
    tokens = await issue_token_pair(user, request, response, db)
    tokens.device_secret = issued_device_secret
    return tokens


@router.post("/refresh", response_model=TokenResponse)
async def refresh_tokens(
    body: RefreshRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> TokenResponse:
    settings = request.app.state.settings
    refresh_token = body.refresh_token or request.cookies.get("voonie_refresh")
    if not refresh_token:
        raise ApiError(status.HTTP_401_UNAUTHORIZED, "invalid_refresh_token", "Invalid refresh token")
    try:
        payload = decode_token(refresh_token, "refresh", settings)
    except TokenValidationError as exc:
        raise ApiError(
            status.HTTP_401_UNAUTHORIZED,
            "invalid_refresh_token",
            "Invalid refresh token",
        ) from exc

    user = await db.get(User, payload["sub"])
    if user is None or payload.get("ver", 0) != user.auth_version:
        raise ApiError(
            status.HTTP_401_UNAUTHORIZED,
            "invalid_refresh_token",
            "Invalid refresh token",
        )
    consumed = await db.execute(
        delete(RefreshToken).where(
            RefreshToken.user_id == payload["sub"],
            RefreshToken.hashed_token == hash_refresh_token(refresh_token),
            RefreshToken.expires_at > datetime.now(timezone.utc),
        )
    )
    if consumed.rowcount != 1:
        raise ApiError(
            status.HTTP_401_UNAUTHORIZED,
            "invalid_refresh_token",
            "Invalid refresh token",
        )
    return await issue_token_pair(user, request, response, db)
