import struct
from pathlib import Path
import uuid

import pytest

from voonie.backend.app.services.audio_duration import (
    AudioMetadataError,
    audio_duration_seconds,
    is_within_audio_duration_limit,
)
from voonie.backend.app.core.config import Settings


def test_audio_duration_limit_allows_small_container_tail_but_not_extra_recording_time():
    assert is_within_audio_duration_limit(600.008, 600)
    assert is_within_audio_duration_limit(601.0, 600)
    assert not is_within_audio_duration_limit(601.001, 600)


def test_default_upload_limit_accepts_ten_minutes_of_mobile_aac():
    settings = Settings()

    # Mobile Safari commonly records AAC near 128 kbps. Ten minutes is about
    # 9.6 MB before container overhead, so the default must leave headroom.
    assert settings.MAX_AUDIO_BYTES >= 16 * 1024 * 1024


def temp_audio(payload: bytes, suffix: str) -> Path:
    path = Path("voonie/backend/.pytest-data") / f"audio-{uuid.uuid4().hex}{suffix}"
    path.parent.mkdir(exist_ok=True)
    path.write_bytes(payload)
    return path


def test_webm_duration_uses_duration_and_timecode_scale():
    payload = b"\x2a\xd7\xb1\x83" + (1_000_000).to_bytes(3, "big")
    payload += b"\x44\x89\x88" + struct.pack(">d", 181_000.0)
    path = temp_audio(payload, ".webm")
    try:
        assert audio_duration_seconds(path, "audio/webm") == pytest.approx(181.0)
    finally:
        path.unlink(missing_ok=True)


def test_compressed_audio_without_duration_metadata_is_rejected():
    path = temp_audio(b"not-media", ".webm")
    try:
        with pytest.raises(AudioMetadataError):
            audio_duration_seconds(path, "audio/webm")
    finally:
        path.unlink(missing_ok=True)
