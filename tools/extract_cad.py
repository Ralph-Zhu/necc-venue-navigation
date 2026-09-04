"""Extract lightweight venue geometry from the two fixed DXF floor plans."""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import ezdxf
from ezdxf import bbox


FILES = {
    "F1": "1.1号馆.dxf",
    "F3": "1.2号馆.dxf",
}

SUPPORTED = {"LINE", "LWPOLYLINE", "POLYLINE", "ARC", "CIRCLE"}


def category(layer: str) -> str | None:
    name = layer.lower()
    if any(token in name for token in ("tk-2", "dim", "text", "中心线", "细实线", "云线", "消火栓")):
        return None
    if any(token in name for token in ("strs", "stair", "escl", "trea", "hral", "evtr")):
        return "circulation"
    if any(token in name for token in ("wall", "wind", "door", "partition", "柱")) or layer == "0":
        return "structure"
    return None


def entity_points(entity) -> list[list[float]]:
    kind = entity.dxftype()
    if kind == "LINE":
        return [[entity.dxf.start.x, entity.dxf.start.y], [entity.dxf.end.x, entity.dxf.end.y]]
    if kind == "LWPOLYLINE":
        points = [[p[0], p[1]] for p in entity.get_points("xy")]
        if entity.closed and points:
            points.append(points[0])
        return points
    if kind == "POLYLINE":
        points = [[v.dxf.location.x, v.dxf.location.y] for v in entity.vertices]
        if entity.is_closed and points:
            points.append(points[0])
        return points
    if kind in {"ARC", "CIRCLE"}:
        center = entity.dxf.center
        radius = entity.dxf.radius
        start = 0 if kind == "CIRCLE" else entity.dxf.start_angle
        end = 360 if kind == "CIRCLE" else entity.dxf.end_angle
        if end <= start:
            end += 360
        count = max(8, min(48, math.ceil((end - start) / 10)))
        return [[center.x + radius * math.cos(math.radians(start + (end - start) * i / count)),
                 center.y + radius * math.sin(math.radians(start + (end - start) * i / count))]
                for i in range(count + 1)]
    return []


def round_point(point: list[float], bounds) -> list[float]:
    x = (point[0] - bounds.extmin.x) / 1000
    y = (bounds.extmax.y - point[1]) / 1000
    return [round(x, 2), round(y, 2)]


def floor_bounds(modelspace):
    candidates = [e for e in modelspace if e.dxftype() in SUPPORTED and e.dxf.layer == "0"]
    return bbox.extents(candidates, fast=True)


def extract_floor(path: Path) -> dict:
    doc = ezdxf.readfile(path)
    modelspace = doc.modelspace()
    bounds = floor_bounds(modelspace)
    width = bounds.size.x / 1000
    depth = bounds.size.y / 1000

    groups: dict[str, list[list[list[float]]]] = {"structure": [], "circulation": []}
    seen = set()
    for entity in modelspace:
        if entity.dxftype() not in SUPPORTED:
            continue
        group = category(entity.dxf.layer)
        if not group:
            continue
        points = entity_points(entity)
        normalized = [round_point(p, bounds) for p in points]
        normalized = [p for p in normalized if -2 <= p[0] <= width + 2 and -2 <= p[1] <= depth + 2]
        if len(normalized) < 2:
            continue
        key = (group, tuple(tuple(p) for p in normalized))
        reverse_key = (group, tuple(tuple(p) for p in reversed(normalized)))
        if key in seen or reverse_key in seen:
            continue
        seen.add(key)
        groups[group].append(normalized)

    facilities = []
    for entity in modelspace.query("INSERT"):
        name = entity.dxf.name.lower()
        if "elevator" in name:
            kind, label = "elevator", "电梯"
        elif entity.dxf.name == "男卫":
            kind, label = "wc", "男卫生间"
        elif entity.dxf.name == "女卫":
            kind, label = "wc", "女卫生间"
        else:
            continue
        point = round_point([entity.dxf.insert.x, entity.dxf.insert.y], bounds)
        if -2 <= point[0] <= width + 2 and -2 <= point[1] <= depth + 2:
            facilities.append({"type": kind, "x": point[0], "y": point[1], "label": label})

    return {
        "width": round(width, 2),
        "depth": round(depth, 2),
        "origin": [round(bounds.extmin.x, 3), round(bounds.extmin.y, 3)],
        "source": path.name,
        "structure": groups["structure"],
        "circulation": groups["circulation"],
        "facilities": facilities,
        "stats": {
            "structurePaths": len(groups["structure"]),
            "circulationPaths": len(groups["circulation"]),
            "facilities": len(facilities),
        },
    }


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("usage: extract_cad.py <cad-dir> <output-js>")
    cad_dir = Path(sys.argv[1])
    output = Path(sys.argv[2])
    result = {floor: extract_floor(cad_dir / filename) for floor, filename in FILES.items()}
    output.write_text("window.CAD_GEOMETRY = " + json.dumps(result, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")
    for floor, data in result.items():
        print(f"{floor}: {data['width']} × {data['depth']} m, {data['stats']}")


if __name__ == "__main__":
    main()
