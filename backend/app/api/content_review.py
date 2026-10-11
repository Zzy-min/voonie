import base64
from io import BytesIO
import logging

from fastapi import Request
from PIL import Image

from voonie.backend.app.core.exceptions import ApiError
from voonie.backend.app.db.models import User
from voonie.backend.app.services.wechat_content_safety import ContentReviewRejected, ContentReviewUnavailable

logger = logging.getLogger(__name__)


async def review_text(request: Request, user: User, content: str) -> None:
    if not request.app.state.settings.CONTENT_REVIEW_ENABLED or not user.wechat_openid:
        return
    try:
        await request.app.state.content_review.check_text(content, user.wechat_openid)
    except ContentReviewRejected as exc:
        raise ApiError(422, "content_needs_review", "内容需要修改或人工复核后才能继续") from exc
    except ContentReviewUnavailable as exc:
        logger.warning("text content review unavailable: %s", exc)
        raise ApiError(503, "content_review_unavailable", "内容检查暂不可用，请稍后重试") from exc


async def review_image(request: Request, user: User, data: bytes, mime_type: str) -> None:
    if not request.app.state.settings.IMAGE_CONTENT_REVIEW_ENABLED or not user.wechat_openid:
        return
    try:
        await request.app.state.content_review.check_image(data, mime_type)
    except ContentReviewRejected as exc:
        raise ApiError(422, "image_needs_review", "图片需要修改或人工复核后才能继续") from exc
    except ContentReviewUnavailable as exc:
        logger.warning("image content review unavailable: %s", exc)
        raise ApiError(503, "content_review_unavailable", "内容检查暂不可用，请稍后重试") from exc


async def review_embedded_reference(request: Request, user: User, value: str | None) -> None:
    if not value:
        return
    encoded = value.split(",", 1)[-1]
    if len(encoded) > 7 * 1024 * 1024:
        raise ApiError(413, "image_too_large", "参考图不能超过 5MB")
    try:
        source = base64.b64decode(encoded, validate=True)
        with Image.open(BytesIO(source)) as image:
            if image.width * image.height > 24_000_000:
                raise ApiError(413, "image_dimensions_too_large", "参考图尺寸过大")
            output = BytesIO()
            image.convert("RGB").save(output, format="PNG")
    except ApiError:
        raise
    except Exception as exc:
        raise ApiError(415, "invalid_image", "参考图格式无法识别") from exc
    await review_image(request, user, output.getvalue(), "image/png")
