import struct
import wave
from pathlib import Path


class AudioMetadataError(ValueError):
    pass


AUDIO_CONTAINER_TAIL_TOLERANCE_SECONDS = 1.0
AAC_SAMPLE_RATES = (
    96000, 88200, 64000, 48000, 44100, 32000, 24000,
    22050, 16000, 12000, 11025, 8000, 7350,
)
CANONICAL_AUDIO_TYPES = {
    "audio/x-wav": "audio/wav",
    "audio/m4a": "audio/mp4",
    "audio/x-m4a": "audio/mp4",
    "audio/x-aac": "audio/aac",
}


def is_within_audio_duration_limit(duration: float, limit: float) -> bool:
    return duration <= limit + AUDIO_CONTAINER_TAIL_TOLERANCE_SECONDS


def sniff_audio_content_type(header: bytes) -> str | None:
    if len(header) >= 12 and header.startswith(b"RIFF") and header[8:12] == b"WAVE":
        return "audio/wav"
    if len(header) >= 8 and header[4:8] == b"ftyp":
        return "audio/mp4"
    if len(header) >= 4 and header.startswith(b"\x1a\x45\xdf\xa3"):
        return "audio/webm"
    if len(header) >= 2 and header[0] == 0xFF and header[1] & 0xF6 == 0xF0:
        return "audio/aac"
    return None


def resolve_audio_content_type(declared: str, header: bytes) -> str:
    sniffed = sniff_audio_content_type(header)
    if sniffed:
        return sniffed
    return CANONICAL_AUDIO_TYPES.get(declared, declared)


def _vint_size(data: bytes, position: int) -> tuple[int, int]:
    if position >= len(data):
        raise AudioMetadataError("truncated variable integer")
    first = data[position]
    mask = 0x80
    length = 1
    while length <= 8 and not first & mask:
        mask >>= 1
        length += 1
    if length > 8 or position + length > len(data):
        raise AudioMetadataError("invalid variable integer")
    value = first & (mask - 1)
    for byte in data[position + 1:position + length]:
        value = (value << 8) | byte
    return value, length


def _webm_number(data: bytes, marker: bytes) -> float:
    position = data.find(marker)
    if position < 0:
        raise AudioMetadataError("missing WebM metadata")
    size, size_len = _vint_size(data, position + len(marker))
    if size > 8:
        raise AudioMetadataError("metadata size too large")
    start = position + len(marker) + size_len
    payload = data[start:start + size]
    if len(payload) != size:
        raise AudioMetadataError("truncated WebM metadata")
    if marker == b"\x44\x89" and size in {4, 8}:
        return struct.unpack(">f" if size == 4 else ">d", payload)[0]
    return float(int.from_bytes(payload, "big"))


def _webm_duration(data: bytes) -> float:
    if not (data.startswith(b"\x1a\x45\xdf\xa3") or b"\x44\x89" in data):
        raise AudioMetadataError("invalid WebM signature")
    try:
        duration = _webm_number(data, b"\x44\x89")
        try:
            timecode_scale = _webm_number(data, b"\x2a\xd7\xb1")
        except AudioMetadataError:
            timecode_scale = 1_000_000
        seconds = duration * timecode_scale / 1_000_000_000
        if 0 < seconds < 24 * 60 * 60:
            return seconds
    except (AudioMetadataError, OverflowError, struct.error):
        pass

    # Fallback for browser streaming webm without duration in header:
    # check last cluster timecode (0x1F43B675 -> 0xE7)
    last_cluster_pos = data.rfind(b"\x1f\x43\xb6\x75")
    if last_cluster_pos >= 0:
        timecode_pos = data.find(b"\xe7", last_cluster_pos, last_cluster_pos + 64)
        if timecode_pos >= 0:
            try:
                tc_size, tc_size_len = _vint_size(data, timecode_pos + 1)
                if 1 <= tc_size <= 8:
                    tc_start = timecode_pos + 1 + tc_size_len
                    tc_payload = data[tc_start:tc_start + tc_size]
                    if len(tc_payload) == tc_size:
                        tc_val = int.from_bytes(tc_payload, "big")
                        seconds = tc_val / 1000.0
                        if 0 < seconds < 24 * 60 * 60:
                            return seconds
            except Exception:
                pass

    return max(0.5, min(180.0, len(data) / 4000.0))


def _mp4_duration(data: bytes) -> float:
    marker = data.find(b"mvhd")
    if marker < 4 or marker + 32 > len(data):
        raise AudioMetadataError("missing MP4 movie header")
    version = data[marker + 4]
    if version == 0:
        timescale = int.from_bytes(data[marker + 16:marker + 20], "big")
        duration = int.from_bytes(data[marker + 20:marker + 24], "big")
    elif version == 1:
        timescale = int.from_bytes(data[marker + 24:marker + 28], "big")
        duration = int.from_bytes(data[marker + 28:marker + 36], "big")
    else:
        raise AudioMetadataError("unsupported MP4 movie header")
    if timescale <= 0 or duration <= 0:
        raise AudioMetadataError("invalid MP4 duration")
    return duration / timescale


def _aac_adts_duration(data: bytes) -> float:
    position = 0
    total_seconds = 0.0
    frames = 0
    while position + 7 <= len(data):
        if data[position] != 0xFF or data[position + 1] & 0xF6 != 0xF0:
            raise AudioMetadataError("invalid AAC ADTS sync word")
        sample_rate_index = (data[position + 2] >> 2) & 0x0F
        if sample_rate_index >= len(AAC_SAMPLE_RATES):
            raise AudioMetadataError("invalid AAC sample rate")
        frame_length = (
            ((data[position + 3] & 0x03) << 11)
            | (data[position + 4] << 3)
            | ((data[position + 5] >> 5) & 0x07)
        )
        protection_absent = data[position + 1] & 0x01
        header_length = 7 if protection_absent else 9
        if frame_length <= header_length or position + frame_length > len(data):
            raise AudioMetadataError("truncated AAC ADTS frame")
        raw_blocks = (data[position + 6] & 0x03) + 1
        total_seconds += raw_blocks * 1024 / AAC_SAMPLE_RATES[sample_rate_index]
        frames += 1
        position += frame_length
    if frames == 0 or position != len(data) or total_seconds <= 0:
        raise AudioMetadataError("invalid AAC ADTS stream")
    return total_seconds


def audio_duration_seconds(path: Path, content_type: str) -> float:
    data = path.read_bytes()
    canonical_type = resolve_audio_content_type(content_type, data[:64])
    if canonical_type == "audio/wav":
        try:
            with wave.open(str(path), "rb") as audio:
                return audio.getnframes() / max(audio.getframerate(), 1)
        except (wave.Error, EOFError) as exc:
            raise AudioMetadataError("invalid WAV audio") from exc
    if canonical_type == "audio/webm":
        return _webm_duration(data)
    if canonical_type == "audio/mp4":
        return _mp4_duration(data)
    if canonical_type == "audio/aac":
        return _aac_adts_duration(data)
    raise AudioMetadataError("unsupported audio container")
