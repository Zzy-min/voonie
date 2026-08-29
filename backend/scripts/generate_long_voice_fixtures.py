"""Generate sparse, real-speech WAV fixtures for long voice endpoint smoke tests."""

from __future__ import annotations

import argparse
import audioop
from fractions import Fraction
from pathlib import Path
import wave

import av
import numpy as np


TARGET_RATE = 8_000
TARGET_WIDTH = 1
OPUS_RATE = 48_000
SPEECH_INTERVAL_SECONDS = 60


def convert_phrase(source: Path) -> bytes:
    with wave.open(str(source), "rb") as reader:
        if reader.getnchannels() != 1:
            raise ValueError("source WAV must be mono")
        frames = reader.readframes(reader.getnframes())
        frames, _ = audioop.ratecv(
            frames,
            reader.getsampwidth(),
            1,
            reader.getframerate(),
            TARGET_RATE,
            None,
        )
        frames = audioop.lin2lin(frames, reader.getsampwidth(), TARGET_WIDTH)
        return audioop.bias(frames, TARGET_WIDTH, 128)


def write_fixture(destination: Path, phrase: bytes, duration_seconds: int) -> None:
    target_frames = duration_seconds * TARGET_RATE
    phrase_frames = len(phrase) // TARGET_WIDTH
    output = bytearray(b"\x80" * target_frames)
    for start_second in range(0, duration_seconds, SPEECH_INTERVAL_SECONDS):
        start = start_second * TARGET_RATE
        end = min(start + phrase_frames, target_frames)
        output[start:end] = phrase[: end - start]

    destination.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(destination), "wb") as writer:
        writer.setnchannels(1)
        writer.setsampwidth(TARGET_WIDTH)
        writer.setframerate(TARGET_RATE)
        writer.writeframes(output)


def convert_phrase_for_opus(source: Path) -> np.ndarray:
    with wave.open(str(source), "rb") as reader:
        frames = reader.readframes(reader.getnframes())
        frames, _ = audioop.ratecv(
            frames,
            reader.getsampwidth(),
            reader.getnchannels(),
            reader.getframerate(),
            OPUS_RATE,
            None,
        )
        if reader.getnchannels() != 1:
            frames = audioop.tomono(frames, reader.getsampwidth(), 0.5, 0.5)
        if reader.getsampwidth() != 2:
            frames = audioop.lin2lin(frames, reader.getsampwidth(), 2)
    return np.frombuffer(frames, dtype="<i2")


def write_webm_fixture(destination: Path, phrase: np.ndarray, duration_seconds: int) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    with av.open(str(destination), "w", format="webm") as container:
        stream = container.add_stream("libopus", rate=OPUS_RATE)
        stream.bit_rate = 24_000
        stream.layout = "mono"
        phrase_seconds = (len(phrase) + OPUS_RATE - 1) // OPUS_RATE
        use_continuous_source = len(phrase) >= duration_seconds * OPUS_RATE
        for second in range(duration_seconds):
            chunk = np.zeros(OPUS_RATE, dtype=np.int16)
            if use_continuous_source:
                source_start = second * OPUS_RATE
                source_end = source_start + OPUS_RATE
                chunk[:] = phrase[source_start:source_end]
            else:
                offset = second % SPEECH_INTERVAL_SECONDS
                source_start = offset * OPUS_RATE
                source_end = min(source_start + OPUS_RATE, len(phrase))
                if offset < phrase_seconds:
                    chunk[: source_end - source_start] = phrase[source_start:source_end]
            frame = av.AudioFrame.from_ndarray(chunk.reshape(1, -1), format="s16", layout="mono")
            frame.sample_rate = OPUS_RATE
            frame.pts = second * OPUS_RATE
            frame.time_base = Fraction(1, OPUS_RATE)
            for packet in stream.encode(frame):
                container.mux(packet)
        for packet in stream.encode(None):
            container.mux(packet)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("destination", type=Path)
    parser.add_argument("duration", type=int)
    args = parser.parse_args()
    if args.duration <= 0:
        raise ValueError("duration must be positive")
    if args.destination.suffix.lower() == ".webm":
        write_webm_fixture(args.destination, convert_phrase_for_opus(args.source), args.duration)
    else:
        write_fixture(args.destination, convert_phrase(args.source), args.duration)


if __name__ == "__main__":
    main()
