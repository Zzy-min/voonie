from pathlib import Path
from voonie.backend.app.core.config import Settings, settings
from voonie.backend.app.models.schemas import ComicPanel, CharacterConfig
from voonie.backend.app.providers.image import (
    ImagePromptRejectedError,
    ImageProvider,
    get_image_provider,
)
from voonie.backend.app.services.storage_service import StorageService, storage_service
from voonie.backend.app.services.prompt_builder import build_panel_prompt

class ImageGenService:
    """连环画单格图像生成服务"""

    def __init__(
        self,
        provider: ImageProvider | None = None,
        app_settings: Settings = settings,
        storage: StorageService = storage_service,
    ) -> None:
        self.provider = provider or get_image_provider(app_settings)
        self.settings = app_settings
        self.storage = storage

    async def generate_panel_image(
        self,
        panel: ComicPanel,
        character: CharacterConfig,
        custom_style: str = None,
        ref_image: bytes | None = None,
    ) -> tuple[Path, str]:
        style_prompt = custom_style or self.settings.STYLE_PRESETS.get(
            character.style_preset,
            self.settings.STYLE_PRESETS["chibi_manga"],
        )
        full_prompt = build_panel_prompt(
            panel,
            character,
            style_prompt,
            getattr(character, "bible", None),
            use_ref=bool(ref_image),
        )
        try:
            image_bytes = await self.provider.generate(full_prompt, ref_image=ref_image, seed=None)
        except ImagePromptRejectedError:
            full_prompt = build_panel_prompt(
                panel,
                character,
                style_prompt,
                getattr(character, "bible", None),
                use_ref=bool(ref_image),
                abstract=True,
            )
            image_bytes = await self.provider.generate(full_prompt, ref_image=ref_image, seed=None)
        path = self.storage.save_bytes(image_bytes, suffix=".png")
        return path, full_prompt

image_gen_service = ImageGenService()
