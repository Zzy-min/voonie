from voonie.backend.app.core.config import Settings, settings
from voonie.backend.app.providers.asr import ASRProvider, get_asr_provider

class ASRService:
    """语音识别与转写服务"""

    def __init__(
        self,
        provider: ASRProvider | None = None,
        app_settings: Settings = settings,
    ) -> None:
        self.provider = provider or get_asr_provider(app_settings)

    @property
    def supports_real_transcription(self) -> bool:
        return self.provider.supports_real_transcription

    async def transcribe(self, audio_bytes: bytes, filename: str = "voice.m4a") -> str:
        return await self.provider.transcribe(audio_bytes, filename)

asr_service = ASRService()
