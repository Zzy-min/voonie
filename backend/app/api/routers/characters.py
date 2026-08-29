import hashlib
from io import BytesIO

from fastapi import APIRouter, Depends, File, Form, Request, UploadFile, status
from PIL import Image
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from voonie.backend.app.api.deps import get_current_user
from voonie.backend.app.core.exceptions import ApiError
from voonie.backend.app.db.models import Character, CharacterReference, User
from voonie.backend.app.db.session import get_db
from voonie.backend.app.schemas.characters import (
    CharacterCreate,
    CharacterReferenceResponse,
    CharacterResponse,
    CharacterUpdate,
)


router = APIRouter(prefix="/characters", tags=["Characters"])
ALLOWED_KINDS = {"front", "side", "full_body", "style"}
MAX_REFERENCE_BYTES = 10 * 1024 * 1024
MAX_REFERENCE_PIXELS = 16_000_000


def serialize(character: Character, storage) -> CharacterResponse:
    return CharacterResponse(
        id=character.id,
        name=character.name,
        appearance_prompt=character.appearance_prompt,
        style_preset=character.style_preset,
        bible=character.bible_json,
        version=character.version,
        seed=character.seed,
        references=[
            CharacterReferenceResponse(
                id=item.id,
                kind=item.kind,
                media_key=storage.get_file_url(item.media_key),
                content_hash=item.content_hash,
                width=item.width,
                height=item.height,
                moderation_status=item.moderation_status,
            )
            for item in character.references
        ],
    )


async def owned_character(db: AsyncSession, character_id: str, user_id: str) -> Character:
    character = await db.scalar(
        select(Character)
        .options(selectinload(Character.references))
        .where(Character.id == character_id, Character.user_id == user_id)
    )
    if character is None:
        raise ApiError(404, "character_not_found", "Character not found")
    return character


@router.post("", response_model=CharacterResponse, status_code=status.HTTP_201_CREATED)
async def create_character(
    body: CharacterCreate,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> CharacterResponse:
    character = Character(
        user_id=current_user.id,
        name=body.name,
        appearance_prompt=body.appearance_prompt,
        style_preset=body.style_preset,
        bible_json=body.bible.model_dump(mode="json"),
        seed=body.seed,
    )
    db.add(character)
    await db.commit()
    character = await owned_character(db, character.id, current_user.id)
    return serialize(character, request.app.state.storage)


@router.get("", response_model=list[CharacterResponse])
async def list_characters(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[CharacterResponse]:
    rows = (
        await db.scalars(
            select(Character)
            .options(selectinload(Character.references))
            .where(Character.user_id == current_user.id)
            .order_by(Character.created_at.desc())
        )
    ).all()
    return [serialize(row, request.app.state.storage) for row in rows]


@router.patch("/{character_id}", response_model=CharacterResponse)
async def update_character(
    character_id: str,
    body: CharacterUpdate,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> CharacterResponse:
    character = await owned_character(db, character_id, current_user.id)
    changes = body.model_dump(exclude_unset=True)
    if "bible" in changes and changes["bible"] is not None:
        character.bible_json = changes.pop("bible")
    for key, value in changes.items():
        setattr(character, key, value)
    character.version += 1
    await db.commit()
    character = await owned_character(db, character.id, current_user.id)
    return serialize(character, request.app.state.storage)


@router.post("/{character_id}/references", response_model=CharacterReferenceResponse, status_code=status.HTTP_201_CREATED)
async def upload_reference(
    character_id: str,
    request: Request,
    kind: str = Form(...),
    image_file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> CharacterReferenceResponse:
    if kind not in ALLOWED_KINDS:
        raise ApiError(422, "invalid_reference_kind", "Unsupported character reference kind")
    character = await owned_character(db, character_id, current_user.id)
    if len(character.references) >= 5:
        raise ApiError(409, "too_many_references", "A character can keep at most 5 reference images")
    await request.app.state.rate_limiter.consume(db, current_user.id, "character_reference", 20)
    chunks: list[bytes] = []
    size = 0
    while chunk := await image_file.read(1024 * 1024):
        size += len(chunk)
        if size > MAX_REFERENCE_BYTES:
            raise ApiError(413, "image_too_large", "Reference image exceeds the size limit")
        chunks.append(chunk)
    payload = b"".join(chunks)
    if not payload:
        raise ApiError(400, "empty_image", "Reference image is empty")
    try:
        with Image.open(BytesIO(payload)) as image:
            width, height = image.size
            if width <= 0 or height <= 0 or width * height > MAX_REFERENCE_PIXELS:
                raise ApiError(413, "image_dimensions_too_large", "Reference image dimensions exceed the limit")
            image.verify()
    except ApiError:
        raise
    except Exception as exc:
        raise ApiError(415, "invalid_image", "Reference image is not a valid image") from exc
    saved = request.app.state.storage.save_bytes(payload, suffix=".png")
    occupied_slots = {item.slot for item in character.references if item.slot is not None}
    reference_slot = next(slot for slot in range(1, 6) if slot not in occupied_slots)
    reference = CharacterReference(
        character_id=character.id,
        kind=kind,
        slot=reference_slot,
        media_key=str(saved),
        content_hash=hashlib.sha256(payload).hexdigest(),
        width=width,
        height=height,
        moderation_status="approved",
    )
    db.add(reference)
    character.version += 1
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        request.app.state.storage.delete(str(saved))
        raise ApiError(409, "too_many_references", "A character can keep at most 5 reference images") from exc
    await db.refresh(reference)
    return CharacterReferenceResponse(
        id=reference.id,
        kind=reference.kind,
        media_key=request.app.state.storage.get_file_url(reference.media_key),
        content_hash=reference.content_hash,
        width=reference.width,
        height=reference.height,
        moderation_status=reference.moderation_status,
    )


@router.delete("/{character_id}/references/{reference_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_reference(
    character_id: str,
    reference_id: str,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    character = await owned_character(db, character_id, current_user.id)
    reference = next((item for item in character.references if item.id == reference_id), None)
    if reference is None:
        raise ApiError(404, "reference_not_found", "Character reference not found")
    request.app.state.storage.delete(reference.media_key)
    await db.delete(reference)
    character.version += 1
    await db.commit()
