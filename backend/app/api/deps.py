from fastapi import Depends, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from voonie.backend.app.core.exceptions import ApiError
from voonie.backend.app.core.security import TokenValidationError, decode_token
from voonie.backend.app.db.models import User
from voonie.backend.app.db.session import get_db


bearer_scheme = HTTPBearer(auto_error=False)
TEST_USER_ID = "00000000-0000-0000-0000-000000000001"


async def get_authenticated_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    token = credentials.credentials if credentials is not None else request.cookies.get("voonie_access")
    if request.app.state.settings.TESTING and token is None:
        request.state.user_id = TEST_USER_ID
        return User(id=TEST_USER_ID, device_id="test-device", wechat_openid="test-openid")
    if token is None:
        raise ApiError(
            status.HTTP_401_UNAUTHORIZED,
            "authentication_required",
            "An access token is required",
        )
    try:
        payload = decode_token(token, "access", request.app.state.settings)
    except TokenValidationError as exc:
        raise ApiError(status.HTTP_401_UNAUTHORIZED, "invalid_token", "Invalid access token") from exc
    user = await db.get(User, payload["sub"])
    if user is None or payload.get("ver", 0) != user.auth_version:
        raise ApiError(status.HTTP_401_UNAUTHORIZED, "invalid_token", "Invalid access token")
    request.state.user_id = user.id
    return user


async def get_current_user(
    request: Request,
    user: User = Depends(get_authenticated_user),
) -> User:
    """Return a fully activated account.

    Email, phone and legacy device credentials may prove account ownership, but
    product data is available only after the account is bound to WeChat.
    """
    if request.app.state.settings.REQUIRE_WECHAT_BINDING and not user.wechat_openid:
        raise ApiError(
            status.HTTP_403_FORBIDDEN,
            "wechat_binding_required",
            "请先绑定微信后继续使用 Voling 日记",
        )
    return user
