import base64
from io import BytesIO

from fastapi import APIRouter, Depends, Request, status
from PIL import Image
from sqlalchemy.ext.asyncio import AsyncSession

from voonie.backend.app.api.deps import get_current_user
from voonie.backend.app.core.exceptions import ApiError
from voonie.backend.app.db.models import Feedback, User
from voonie.backend.app.db.session import get_db
from voonie.backend.app.schemas.feedback import FeedbackCreate, FeedbackResponse


router = APIRouter(prefix="/feedback", tags=["Feedback"])


@router.post("", response_model=FeedbackResponse, status_code=status.HTTP_201_CREATED)
async def create_feedback(
    body: FeedbackCreate,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> FeedbackResponse:
    attachment_key = None
    if body.screenshot_base64:
        try:
            payload = base64.b64decode(body.screenshot_base64, validate=True)
            if len(payload) > 5 * 1024 * 1024:
                raise ApiError(413, "feedback_image_too_large", "截图不能超过 5MB")
            with Image.open(BytesIO(payload)) as image:
                image.verify()
            attachment_key = str(request.app.state.storage.save_bytes(payload, suffix=".jpg"))
        except ApiError:
            raise
        except Exception as exc:
            raise ApiError(415, "invalid_feedback_image", "截图格式无法识别") from exc

    # diagnostics 仅接收请求标识、任务标识、错误码等结构化字段；正文不会自动附带。
    allowed_diagnostics = {key: value for key, value in body.diagnostics.items() if key in {
        "requestId", "taskId", "errorCode", "currentPage", "occurredAt"
    }}
    item = Feedback(
        user_id=current_user.id,
        category=body.category,
        description=body.description.strip(),
        contact=(body.contact or "").strip() or None,
        device_json=body.device,
        diagnostics_json=allowed_diagnostics,
        attachment_key=attachment_key,
        include_related_content=body.include_related_content,
    )
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return FeedbackResponse(id=item.id, status=item.status)
