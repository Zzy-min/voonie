import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone
import uuid

import jwt
from jwt import InvalidTokenError

from voonie.backend.app.core.config import Settings


class TokenValidationError(ValueError):
    pass


def create_token(
    user_id: str,
    token_type: str,
    settings: Settings,
    auth_version: int = 0,
) -> tuple[str, datetime]:
    now = datetime.now(timezone.utc)
    lifetime = (
        timedelta(minutes=settings.ACCESS_TOKEN_MINUTES)
        if token_type == "access"
        else timedelta(days=settings.REFRESH_TOKEN_DAYS)
    )
    expires_at = now + lifetime
    payload = {
        "sub": user_id,
        "type": token_type,
        "iss": settings.JWT_ISSUER,
        "aud": settings.JWT_AUDIENCE,
        "iat": now,
        "exp": expires_at,
        "jti": str(uuid.uuid4()),
        "ver": auth_version,
    }
    encoded = jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)
    return encoded, expires_at


def decode_token(token: str, expected_type: str, settings: Settings) -> dict:
    try:
        payload = jwt.decode(
            token,
            settings.JWT_SECRET,
            algorithms=[settings.JWT_ALGORITHM],
            issuer=settings.JWT_ISSUER,
            audience=settings.JWT_AUDIENCE,
            leeway=10,
            options={"require": ["sub", "type", "iss", "aud", "iat", "exp", "jti"]},
        )
    except InvalidTokenError as exc:
        raise TokenValidationError("Token validation failed") from exc
    if payload.get("type") != expected_type:
        raise TokenValidationError("Unexpected token type")
    return payload


def hash_refresh_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    key = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 100_000)
    return f"pbkdf2_sha256${salt}${key.hex()}"


def verify_password(plain_password: str, hashed_password: str | None) -> bool:
    if not hashed_password or not plain_password:
        return False
    parts = hashed_password.split("$")
    if len(parts) != 3 or parts[0] != "pbkdf2_sha256":
        return False
    _, salt, key_hex = parts
    computed = hashlib.pbkdf2_hmac("sha256", plain_password.encode("utf-8"), salt.encode("utf-8"), 100_000)
    return hmac.compare_digest(computed.hex(), key_hex)
