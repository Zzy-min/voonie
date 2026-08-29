import json
from pathlib import Path
from typing import Annotated, Any

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


BACKEND_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BACKEND_DIR / ".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    APP_NAME: str = "Voonie Comic Voice Diary API"
    VERSION: str = "1.0.0"
    API_PREFIX: str = "/api/v1"

    DATABASE_URL: str = f"sqlite+aiosqlite:///{(BACKEND_DIR / 'voonie.db').as_posix()}"
    REDIS_URL: str = "redis://127.0.0.1:6379/0"
    JWT_SECRET: str = "development-only-change-me-before-production"
    JWT_ALGORITHM: str = "HS256"
    JWT_ISSUER: str = "voonie-api"
    JWT_AUDIENCE: str = "voonie-app"
    ACCESS_TOKEN_MINUTES: int = 30
    REFRESH_TOKEN_DAYS: int = 30
    CORS_ORIGINS: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: [
            "http://localhost:3000",
            "http://localhost:8080",
            "http://127.0.0.1:5173",
            "http://localhost:5173",
        ]
    )
    MEDIA_PUBLIC_BASE: str = ""
    MEMORY_OPT_IN_DEFAULT: bool = False
    ARQ_INLINE: bool = True
    COMPAT_WAIT_SECONDS: float = 15.0
    TESTING: bool = False
    PRODUCTION: bool = False
    COOKIE_SECURE: bool = False

    BASE_DIR: Path = BACKEND_DIR
    TEMP_MEDIA_DIR: Path = BASE_DIR / "temp_media"
    TEMP_FILE_TTL_HOURS: int = 1
    MAX_AUDIO_BYTES: int = 16 * 1024 * 1024
    MAX_AUDIO_SECONDS: int = 600
    COMIC_HOURLY_LIMIT: int = 10
    CHAT_HOURLY_LIMIT: int = 60
    LOGIN_FAILED_HOURLY_LIMIT: int = 10
    # Compressed containers require ffprobe-style duration and audio-track validation.
    ALLOWED_AUDIO_TYPES: set[str] = {
        "audio/wav",
        "audio/x-wav",
        "audio/webm",
        "audio/mp4",
        "audio/m4a",
        "audio/x-m4a",
        "audio/ogg",
        "audio/opus",
        "application/octet-stream",
    }

    OPENAI_API_KEY: str = ""
    ALLOW_MOCK_ASR: bool = False
    LOCAL_ASR_ENABLED: bool = True
    LOCAL_ASR_MODEL: str = "small"
    LOCAL_ASR_LANGUAGE: str = "zh"
    LOCAL_ASR_INITIAL_PROMPT: str = "以下是普通话生活日记，请使用简体中文准确转录。"
    LOCAL_ASR_DEVICE: str = "cpu"
    LOCAL_ASR_COMPUTE_TYPE: str = "int8"
    LOCAL_ASR_BEAM_SIZE: int = 5
    OPENAI_BASE_URL: str = "https://api.openai.com/v1"
    DEFAULT_LLM_MODEL: str = "gpt-4o-mini"
    DEFAULT_ASR_MODEL: str = "whisper-1"
    DEFAULT_IMAGE_MODEL: str = "dall-e-3"
    DEFAULT_EMBEDDING_MODEL: str = "text-embedding-3-small"
    ARK_API_KEY: str = ""
    ARK_BASE_URL: str = "https://ark.cn-beijing.volces.com/api/v3"
    ARK_IMAGE_MODEL: str = "doubao-seedream-4-0-250828"
    DEEPSEEK_API_KEY: str = ""
    DEEPSEEK_BASE_URL: str = "https://api.deepseek.com/v1"
    DEEPSEEK_MODEL: str = "deepseek-chat"

    STYLE_PRESETS: dict[str, str] = {
        "chibi_manga": (
            "Masterpiece Japanese anime comic illustration, vibrant cel shading anime style, "
            "clean sharp line art, soft luminous lighting, delicate gradients, cute chibi proportions, "
            "warm cozy atmosphere, expressive characters, highly detailed, clean composition"
        ),
        "warm_watercolor": (
            "Masterpiece soft watercolor storybook illustration, gentle ink outlines, "
            "warm pastel color wash, cozy luminous lighting, subtle paper texture, "
            "delicate emotional atmosphere, whimsical charming details, clean composition"
        ),
        "anime_cel": (
            "High quality modern Japanese anime key visual, crisp cel shading, "
            "beautiful rim lighting, rich harmonious colors, dynamic camera angle, "
            "clean character lines, studio anime quality, masterpiece"
        ),
        "retro_comic": (
            "Vintage retro storybook comic style, nostalgic warm tones, "
            "expressive hand-drawn linework, subtle screen-tone dots, classic comic aesthetic"
        ),
    }

    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def parse_cors_origins(cls, value: Any) -> Any:
        if isinstance(value, str):
            stripped = value.strip()
            if stripped.startswith("["):
                return json.loads(stripped)
            return [origin.strip() for origin in stripped.split(",") if origin.strip()]
        return value

    @model_validator(mode="after")
    def validate_production_secrets(self):
        if self.PRODUCTION:
            if self.JWT_SECRET == "development-only-change-me-before-production" or len(self.JWT_SECRET) < 32:
                raise ValueError("JWT_SECRET must be a unique value of at least 32 characters in production")
            if not self.COOKIE_SECURE:
                raise ValueError("COOKIE_SECURE must be enabled in production")
            if not self.OPENAI_API_KEY and not self.LOCAL_ASR_ENABLED:
                raise ValueError("A real ASR provider is required in production; mock providers are not allowed")
        return self

settings = Settings()
