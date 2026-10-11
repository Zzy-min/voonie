import io
from pathlib import Path
from typing import Any
from PIL import Image
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
        character_bible: dict[str, Any] | None = None,
        seed: int | None = None,
        aspect_ratio: str = "4:3",
        review_openid: str | None = None,
        ref_images: list[bytes] | None = None,
        reference_types: list[str] | None = None,
    ) -> tuple[Path, str]:
        style_prompt = custom_style or self.settings.STYLE_PRESETS.get(
            character.style_preset,
            self.settings.STYLE_PRESETS["chibi_manga"],
        )
        full_prompt = build_panel_prompt(
            panel,
            character,
            style_prompt,
            character_bible,
            use_ref=bool(ref_image),
        )
        reference_note = ""
        if ref_images:
            offset = 2 if ref_image else 1
            reference_note = "\nReference images are context, not extra protagonists. "
            if ref_image:
                reference_note += "Image 1 locks the established protagonist identity. "
            reference_note += "; ".join(
                f"Image {index + offset}: {kind} reference only"
                for index, kind in enumerate(reference_types or ["combined"] * len(ref_images))
            )
            reference_note += ". Follow the diary's species and actions; do not merge bodies or invent people."
        full_prompt += reference_note
        provider_options = {"ref_image": ref_image, "seed": seed}
        if ref_images:
            provider_options["ref_images"] = ref_images
        try:
            image_bytes = await self.provider.generate(full_prompt, **provider_options)
        except ImagePromptRejectedError:
            full_prompt = build_panel_prompt(
                panel,
                character,
                style_prompt,
                character_bible,
                use_ref=bool(ref_image),
                abstract=True,
            )
            full_prompt += reference_note
            image_bytes = await self.provider.generate(full_prompt, **provider_options)
        image_bytes = self._fit_without_crop(image_bytes, aspect_ratio)
        # Generated output is subject to the image provider's own safeguards.
        # User-supplied images are handled separately at their upload endpoints.
        path = self.storage.save_bytes(image_bytes, suffix=".png")
        return path, full_prompt

    @staticmethod
    def _fit_without_crop(image_bytes: bytes, aspect_ratio: str) -> bytes:
        """Normalize output dimensions without removing any generated content."""
        sizes = {"1:1": (1024, 1024), "4:3": (1024, 768), "3:4": (768, 1024)}
        target = sizes.get(aspect_ratio, sizes["4:3"])
        with Image.open(io.BytesIO(image_bytes)) as source:
            image = source.convert("RGB")
            image.thumbnail(target, Image.Resampling.LANCZOS)
            canvas = Image.new("RGB", target, (255, 249, 241))
            left = (target[0] - image.width) // 2
            top = (target[1] - image.height) // 2
            canvas.paste(image, (left, top))
            output = io.BytesIO()
            canvas.save(output, format="PNG", optimize=True)
            return output.getvalue()

image_gen_service = ImageGenService()
