from __future__ import annotations

import sys
from collections import deque
from pathlib import Path

from PIL import Image


def is_background(pixel: tuple[int, int, int, int]) -> bool:
    red, green, blue, _ = pixel
    return min(red, green, blue) >= 225 and max(red, green, blue) - min(red, green, blue) <= 18


def clear_connected_background(image: Image.Image) -> Image.Image:
    result = image.convert("RGBA")
    width, height = result.size
    pixels = result.load()
    visited = bytearray(width * height)
    queue: deque[tuple[int, int]] = deque()

    def enqueue(x: int, y: int) -> None:
        index = y * width + x
        if visited[index] or not is_background(pixels[x, y]):
            return
        visited[index] = 1
        queue.append((x, y))

    for x in range(width):
        enqueue(x, 0)
        enqueue(x, height - 1)
    for y in range(height):
        enqueue(0, y)
        enqueue(width - 1, y)

    while queue:
        x, y = queue.popleft()
        if x > 0:
            enqueue(x - 1, y)
        if x + 1 < width:
            enqueue(x + 1, y)
        if y > 0:
            enqueue(x, y - 1)
        if y + 1 < height:
            enqueue(x, y + 1)

    for y in range(height):
        for x in range(width):
            if visited[y * width + x]:
                pixels[x, y] = (0, 0, 0, 0)

    return result


def main() -> None:
    if len(sys.argv) != 4:
        raise SystemExit("usage: clean_mascot_sprite.py INPUT SHEET_OUTPUT PORTRAIT_OUTPUT")

    source = Path(sys.argv[1])
    sheet_output = Path(sys.argv[2])
    portrait_output = Path(sys.argv[3])
    cleaned = clear_connected_background(Image.open(source))
    cleaned.save(sheet_output)

    cell_width = cleaned.width // 3
    cell_height = cleaned.height // 3
    portrait = cleaned.crop((0, 0, cell_width, cell_height))
    portrait.save(portrait_output)


if __name__ == "__main__":
    main()
