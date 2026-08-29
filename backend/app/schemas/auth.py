from pydantic import BaseModel, Field


class DeviceAuthRequest(BaseModel):
    device_id: str = Field(min_length=8, max_length=255)
    app_version: str = Field(min_length=1, max_length=32)
    device_secret: str | None = Field(default=None, min_length=32, max_length=255)


class RefreshRequest(BaseModel):
    refresh_token: str | None = Field(default=None, min_length=32)


class EmailRegisterRequest(BaseModel):
    email: str = Field(min_length=3, max_length=255)
    password: str = Field(min_length=6, max_length=128)
    confirm_password: str | None = Field(default=None, max_length=128)
    nickname: str | None = Field(default="小主人", max_length=32)


class EmailLoginRequest(BaseModel):
    email: str = Field(min_length=3, max_length=255)
    password: str = Field(min_length=1, max_length=128)


class UserResponse(BaseModel):
    id: str
    email: str | None = None
    nickname: str = "小主人"
    quote: str = "生活或许忙碌，但记得停下来，听一听自己的声音。"
    quote_note: str = "今天也值得被好好收藏。"
    memory_opt_in: bool = True
    created_at: str | None = None


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int
    user_id: str
    email: str | None = None
    nickname: str | None = None
    device_secret: str | None = None
