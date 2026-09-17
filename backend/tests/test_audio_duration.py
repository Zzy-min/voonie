import struct
from pathlib import Path
import uuid

import pytest

from voonie.backend.app.services.audio_duration import (
    AudioMetadataError,
    audio_duration_seconds,
    is_within_audio_duration_limit,
    resolve_audio_content_type,
    sniff_audio_content_type,
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


def adts_frame(
    payload_size: int = 8,
    sample_rate_index: int = 8,
    protection_absent: bool = True,
    raw_blocks: int = 1,
) -> bytes:
    header_length = 7 if protection_absent else 9
    frame_length = header_length + payload_size
    return bytes([
        0xFF,
        0xF0 | int(protection_absent),
        (1 << 6) | (sample_rate_index << 2),
        (1 << 6) | ((frame_length >> 11) & 0x03),
        (frame_length >> 3) & 0xFF,
        ((frame_length & 0x07) << 5) | 0x1F,
        0xFC | (raw_blocks - 1),
    ]) + (b"" if protection_absent else b"\x00\x00") + bytes(payload_size)


def test_aac_adts_duration_uses_frame_count_and_sample_rate():
    payload = adts_frame() * 10
    path = temp_audio(payload, ".aac")
    try:
        assert audio_duration_seconds(path, "audio/aac") == pytest.approx(10 * 1024 / 16000)
        assert audio_duration_seconds(path, "audio/x-aac") == pytest.approx(10 * 1024 / 16000)
    finally:
        path.unlink(missing_ok=True)


def test_invalid_aac_adts_stream_is_rejected():
    path = temp_audio(b"not-aac", ".aac")
    try:
        with pytest.raises(AudioMetadataError):
            audio_duration_seconds(path, "audio/aac")
    finally:
        path.unlink(missing_ok=True)


@pytest.mark.parametrize("payload", [
    adts_frame(payload_size=0),
    adts_frame(payload_size=0, protection_absent=False),
    adts_frame(sample_rate_index=13),
    adts_frame()[:-1],
    adts_frame() + b"trailing",
])
def test_invalid_aac_adts_boundaries_are_rejected(payload: bytes):
    path = temp_audio(payload, ".aac")
    try:
        with pytest.raises(AudioMetadataError):
            audio_duration_seconds(path, "audio/aac")
    finally:
        path.unlink(missing_ok=True)


def test_aac_crc_and_multiple_raw_blocks_are_counted():
    payload = adts_frame(protection_absent=False, raw_blocks=2)
    path = temp_audio(payload, ".aac")
    try:
        assert audio_duration_seconds(path, "audio/aac") == pytest.approx(2 * 1024 / 16000)
    finally:
        path.unlink(missing_ok=True)


def mp4_payload(timescale: int = 1000, duration: int = 6912) -> bytes:
    prefix = b"\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00mp42isom"
    mvhd = b"mvhd" + bytes(4) + bytes(8) + timescale.to_bytes(4, "big") + duration.to_bytes(4, "big") + bytes(12)
    return prefix + mvhd


def test_sniff_prefers_mp4_container_over_declared_aac():
    payload = mp4_payload()
    assert sniff_audio_content_type(payload[:16]) == "audio/mp4"
    assert resolve_audio_content_type("audio/aac", payload[:16]) == "audio/mp4"
    assert resolve_audio_content_type("audio/x-aac", payload[:16]) == "audio/mp4"


def test_mp4_container_declared_as_aac_uses_movie_header():
    payload = mp4_payload()
    path = temp_audio(payload, ".aac")
    try:
        assert audio_duration_seconds(path, "audio/mp4") == pytest.approx(6.912)
        assert audio_duration_seconds(path, resolve_audio_content_type("audio/aac", payload[:16])) == pytest.approx(6.912)
        assert audio_duration_seconds(path, "audio/aac") == pytest.approx(6.912)
    finally:
        path.unlink(missing_ok=True)
