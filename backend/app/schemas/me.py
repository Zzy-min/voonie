from pydantic import BaseModel, Field


class PreferencesResponse(BaseModel):
    user_id: str
    nickname: str
    quote: str
    quote_note: str
    memory_opt_in: bool


class PreferencesUpdate(BaseModel):
    nickname: str | None = Field(default=None, min_length=1, max_length=12)
    quote: str | None = Field(default=None, min_length=1, max_length=80)
    quote_note: str | None = Field(default=None, min_length=1, max_length=40)
    memory_opt_in: bool | None = None
