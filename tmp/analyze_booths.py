from collections import deque
from pathlib import Path
import sys

import numpy as np
from PIL import Image, ImageDraw


source = Path(sys.argv[1])
output = Path(sys.argv[2])
image = Image.open(source).convert("RGB")
scale = 0.25
small = image.resize((round(image.width * scale), round(image.height * scale)))
pixels = np.asarray(small)

# The sample drawing uses highly saturated green for booth footprints.
mask = (
    (pixels[:, :, 1] >= 180)
    & (pixels[:, :, 0] <= 110)
    & (pixels[:, :, 2] <= 110)
)
height, width = mask.shape
visited = np.zeros_like(mask, dtype=np.bool_)
components = []

for y in range(height):
    for x in range(width):
        if not mask[y, x] or visited[y, x]:
            continue
        queue = deque([(x, y)])
        visited[y, x] = True
        min_x = max_x = x
        min_y = max_y = y
        area = 0
        while queue:
            px, py = queue.popleft()
            area += 1
            min_x = min(min_x, px)
            max_x = max(max_x, px)
            min_y = min(min_y, py)
            max_y = max(max_y, py)
            for nx, ny in ((px - 1, py), (px + 1, py), (px, py - 1), (px, py + 1)):
                if 0 <= nx < width and 0 <= ny < height and mask[ny, nx] and not visited[ny, nx]:
                    visited[ny, nx] = True
                    queue.append((nx, ny))
        box_w = max_x - min_x + 1
        box_h = max_y - min_y + 1
        fill = area / (box_w * box_h)
        # Remove legend swatches, text fragments, dimension marks and tiny icons.
        if area >= 150 and box_w >= 9 and box_h >= 6 and min_y >= 230 and fill >= 0.34:
            components.append((min_x, min_y, max_x, max_y, area, fill))

preview = small.copy()
draw = ImageDraw.Draw(preview)
for index, (x1, y1, x2, y2, area, fill) in enumerate(components, 1):
    draw.rectangle((x1, y1, x2, y2), outline=(255, 40, 40), width=2)
    if (x2 - x1) > 22 and (y2 - y1) > 12:
        draw.text((x1 + 2, y1 + 2), str(index), fill=(180, 0, 0))

output.parent.mkdir(parents=True, exist_ok=True)
preview.save(output)
print(f"source={image.width}x{image.height}")
print(f"analysis={width}x{height}")
print(f"candidates={len(components)}")
areas = [item[4] for item in components]
fills = [item[5] for item in components]
print(f"area_range={min(areas)}..{max(areas)}")
print(f"fill_range={min(fills):.3f}..{max(fills):.3f}")
