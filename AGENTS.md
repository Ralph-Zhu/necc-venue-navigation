# Project instructions for Codex

## Project

This repository contains the National Exhibition and Convention Center SVG-to-3D venue navigation prototype. It must run on Windows and macOS and remain usable on desktop, iPad, H5, and mobile WebView layouts.

## Read before changing 3D generation

Read `MODEL_GENERATION_STANDARD_V2_DRAFT.md` before modifying any geometry, camera, LOD, marker, floor, COVER, or routing behavior. Treat its current proposed values as the implementation baseline until the user confirms replacements.

Read `MODEL_UPDATE_20260907.md` as the latest user-authorized override for SVG sources, exact facility footprints, automatic all-hall LOD, icon density and exploded display spacing.

Read `MODEL_UPDATE_20260911.md` before changing Shop annexes, public escalators, their navigation endpoints, the 20260911 SVG sources, or the NH editor orientation.

Read `NAVIGATION_RULES_20260907.md` before routing changes. Current routing uses `navigation-engine.js` in `navigation-worker.js`: hall → public road → hall only; no third-hall or Mid shortcuts, including cross-floor legs. Keep final geometry audit and cancellation safeguards.

Key invariants:

- SVG scale is `10 px = 1 m`; do not add responsive model scaling.
- Physical floor elevation and exploded display offset are separate concepts.
- A floor's ground, halls, Mid area, markers, and routes must share one display transform.
- Parent and child object scales remain `(1,1,1)`.
- Walls and booths are not walkable; doors create connections; COVER never participates in routing.
- F3 retains its central circular hole and surrounding Mid business area.
- Stairs, escalators, and elevators use fixed configured heights and bounded footprints.
- Same-floor navigation uses the single-floor view; cross-floor navigation switches to the combined view.
- Preserve left-drag pan/right-drag rotate on desktop. Touch: one-finger pan, two-finger pinch zoom and twist rotate (20260907-4 override).

## Main pages

- `campus-all.html`: current F1/F3 combined map and navigation demo.
- `campus-3f.html`: single-floor overview prototype.
- `figma-test.html`: detailed 7.2 hall and SVG/booth recognition prototype.
- `index.html`: earlier editor/demo entry.

## Source assets

- `assets/figma-f1-20260907.svg`: current F1 source.
- `assets/figma-f3-20260907.svg`: current F3 source.
- `assets/figma-7.2.svg` and related files: 7.2 hall test sources.

Some Figma-exported IDs are historically incorrect. Use the containing floor/hall group as authoritative where documented, and update `SVG_NAMING_CORRECTIONS.md` when correcting source names.

## Run locally

From the repository root:

```bash
node tools/static-server.js
```

If Node.js is unavailable on macOS:

```bash
python3 -m http.server 8765
```

Then open `http://127.0.0.1:8765/campus-all.html`.

Do not open pages through `file://`; SVG fetching requires a local HTTP server.

## Validation

- Run `node --check` on every changed JavaScript file.
- Verify F1, F3, combined view, same-floor navigation, and cross-floor navigation.
- Compare model changes against the regression checklist in the model standard.
- Do not commit `.edge-qa*` browser profiles, secrets, dependencies, or generated archives.
