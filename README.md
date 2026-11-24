# Nook — Concept & MVP Plan

Nov 23, 2026 · @Aldair

## Concept

Nook is a browser-based, Figma-style design tool for motion designers that works on your phone: you design boards on the go with real layers, and they go straight into animation with the structure intact. It is also a fast tool for making social posts.

**Who it's for:** motion designers who design styleframes and boards in Figma or Illustrator and then rebuild them by hand in After Effects. You are the first user, and you mostly design on your phone.

**The wedge:** Figma exports flat images or SVGs with mangled names. Nook keeps layer names, groups and frames so each board exports as a structured scene: frames become comps, groups become precomps, and shapes, text and gradients stay editable. The primary target is Pain By Choice (PBC): Nook writes `.pbc` files directly, a format you own and can change. After Effects comes second, through a JSX script that builds the comps inside AE (no `.aep` writing).

**Second job:** social posts. These include story/post/reel frame presets, social text boxes, sticker effects and one-click PNG/JPG export. This is what you'll use every week, so it keeps the app honest.

**Siblings:** photos come from Heirloom, boards go into PBC as `.pbc` scenes to animate, and boards and stickers go into Sonant as PNG or SVG image layers. Nook, Heirloom and Sonant share AI, storage and design-token packages.

**Principles**

- Mobile-first: designing and posting work on a phone (touch, small screen, installed PWA). Desktop is required only for the AE handoff.
- Restraint: a small tool set that works well beats a long feature list.
- Single-player first. Multiplayer is designed for in the data model but not built.
- Local-first: no account, files stay on the device, works offline as a PWA.
- Free and open source, with no dark patterns.
- AI is off by default, runs on the device and is optional.

## Run it

```bash
pnpm install
pnpm dev        # dev server, reachable from your phone on the same Wi-Fi (--host)
pnpm test       # engine unit tests
pnpm check      # type checks for every package and the app
pnpm build      # production PWA build in apps/nook/dist
```

**Code map**

- `apps/nook/src/components/`: one Svelte component per file. `Canvas` hosts the engine; `TopBar`, `Toolbar` and `ActionBar` are the phone controls; `LayersPanel`/`LayerRow`, `PresetSheet`/`Sheet`, `FrameLabels`, `ViewInfo`, `Icon`/`IconButton`.
- `apps/nook/src/lib/`: `session` (the editor, its reactive state and autosave), `shortcuts`, `files` (share sheet or download), `theme`.
- `packages/engine/src/`:
  - `doc/`: node types, fractional order keys, the document store, ops, undo history, factories and `doc.json`.
  - `editor/`: the `Editor` (selection and edits), hit-testing, bounds, handles, and `tools/` (select, shape).
  - `geom/`: affine matrix maths. `camera/`: view maths. `input/`: routes fingers, pen, mouse and wheel.
  - `render/`: CanvasKit loader, renderer, frame loop. `engine.ts` wires them to one canvas.
- `packages/scene-export`: Nook → `.pbc` (PBC project JSON).
- `packages/ai`, `packages/storage`, `packages/tokens`: the AI switch and model loader, OPFS helpers, design tokens.

**Status:** see the ✅ and 🚧 marks in [MVP stages](#mvp-stages).

## MVP scope

The MVP is done when you can design a 3-frame styleframe board and an Instagram post in Nook on your phone, export the board as a `.pbc` scene that opens in PBC with its layers intact, and share the post as a PNG straight to Instagram.

| In the MVP | Later | Not planned |
| --- | --- | --- |
| Infinite canvas, frames with social size presets | Auto layout (Yoga) | Real-time multiplayer as a launch feature |
| Rect, ellipse, line, polygon, star, image | Components and instances | Plugin marketplace |
| Pen tool with Bézier paths, boolean ops | Vector networks (Figma-style) | Template store, accounts |
| Multiple fills/strokes, linear/radial gradients, blend modes, opacity | Brushes and raster painting | Code/dev-mode handoff |
| Effects: drop shadow, inner shadow, layer blur, background blur | Prototyping and transitions |  |
| Text: fonts, weight, size, spacing, alignment | Animation timeline inside Nook |  |
| Social text boxes and sticker effects | PSD/Figma import |  |
| Layers panel, groups, names, lock/hide | SVG import |  |
| Undo/redo, autosave, .nook file save/open | Multiplayer |  |
| Touch UI: phone layout, gestures, long-press menus | AE export via JSX script | Writing `.aep` files directly |
| Background removal on images (BiRefNet, new; licence already checked in Heirloom) | Click-to-select (MobileSAM), object removal (MI-GAN), both already working in Heirloom |  |
| Export: PNG/JPG/WebP @1x–4x with Web Share, SVG, `.pbc` scene for PBC | PDF export, device-to-device sync (Heirloom's WebRTC) |  |

## Tech stack and architecture

The engine is plain TypeScript rendering through CanvasKit (Skia in WASM). The UI is Svelte 5 on top, and the engine never imports UI code.

| Layer | Choice | Why |
| --- | --- | --- |
| Build / app shell | Vite + TypeScript, installable PWA | Same as Heirloom and Sonant; installing also protects storage from eviction on iOS |
| UI | Svelte 5 | Matches Sonant (Heirloom is React, which is fine: the engine has no UI code); low overhead for panel-heavy UI |
| Renderer | CanvasKit on WebGL2 | Paths, PathOps booleans, gradients, all blend modes, blur/shadow filters, HarfBuzz text in one dependency |
| Custom effects | SkSL runtime effects | Sticker outlines, halftone, grain without leaving Skia |
| Text | CanvasKit Paragraph + @fontsource fonts | Proper shaping; reuses Sonant's font set |
| State | Document store + op log | Every change is `{nodeId, prop, value}`: undo/redo now, CRDT (Loro/Yjs) later |
| Storage | OPFS + IndexedDB, autosave | Local-first; `.nook` = zip of `doc.json` + `assets/` |
| AI | Shared `ai` package (ORT Web, WebGPU → WASM) | BiRefNet background removal, same AI switch as Heirloom; models load only when AI is on (mobile data and memory) |
| Workers | Export, AI, and font loading off the main thread | Keeps the canvas at 60 fps |

**Repo layout (pnpm workspaces)**

Nook starts as its own repo. Heirloom and Sonant stay in their repos and move in only once a package is actually shared with them: Heirloom (React 18, Vite 5) and Sonant (Svelte 5, Vite 8, TS 6) need version alignment first, and Sonant's AI runs on transformers.js rather than ORT.

- `apps/nook`
- `packages/engine`: document model, ops, hit-testing, layout, CanvasKit renderer
- `packages/ai`: ORT loader, model cache, AI on/off switch (ported from Heirloom)
- `packages/storage`: OPFS/IndexedDB helpers, file save/open
- `packages/tokens`: shared design tokens and fonts
- `packages/scene-export`: Nook scene → `.pbc` (primary), then → AE JSX script

**Frame loop:** input → ops → document → dirty nodes → render only visible nodes inside the camera rectangle, with cached pictures (SkPicture) for nodes that didn't change.

## Data model

A document is a flat map of nodes by id. Each node keeps its `parentId` and a fractional-index `order`, so moves, reorders and future multiplayer merges stay one-property ops.

```ts
type NodeType = 'page' | 'frame' | 'group' | 'rect' | 'ellipse'
  | 'polygon' | 'star' | 'line' | 'vector' | 'text' | 'image' | 'boolean'
  | 'component' | 'instance'   // reserved, not in MVP

interface BaseNode {
  id: string; type: NodeType; name: string
  parentId: string | null; order: string        // fractional index
  transform: [a, b, c, d, tx, ty]               // local 2D affine
  width: number; height: number
  visible: boolean; locked: boolean
  opacity: number; blendMode: BlendMode
  fills: Paint[]; strokes: Stroke[]; effects: Effect[]
  constraints?: { h: 'left'|'right'|'center'|'stretch'|'scale', v: ... }
  motion?: { role?: 'comp'|'precomp'|'layer', notes?: string } // PBC/AE export hints
}

type Paint =
  | { kind: 'solid'; color: RGBA; opacity: number; blendMode: BlendMode; visible: boolean }
  | { kind: 'linear'|'radial'|'angular'; stops: Stop[]; handles: [P, P, P]; ... }
  | { kind: 'image'; assetId: string; scaleMode: 'fill'|'fit'|'crop'|'tile'; ... }

type Effect =
  | { kind: 'dropShadow'|'innerShadow'; offset: P; blur: number; spread: number; color: RGBA }
  | { kind: 'layerBlur'|'backgroundBlur'; radius: number }
  | { kind: 'stickerOutline'; width: number; color: RGBA; shadow?: ... }   // Nook-specific
```

**Rules**

- Colors are stored as sRGB floats with a colour-space tag, and blending is done in sRGB, which matches Figma and AE's default. (Heirloom is linear because it does photo maths; Nook doesn't need to be.) Check that PBC blends the same way so boards look identical there.
- The `.pbc` writer follows PBC's document model (`crates/core`). Any change to the format is made in PBC first, and old `.pbc` files must keep opening.
- Vector paths are stored as Béziers in node-local space. Boolean nodes keep their children, so they stay editable (non-destructive).
- Assets (images, removed-background PNGs, fonts) are content-hashed in `assets/`, and nodes refer to them by hash.
- Leave room for components: instances will store overrides keyed by the node path inside the component. Settle the shape of that map now, even though the feature ships later.

## Social media features

The social features are presets built from engine primitives (text, fills, effects), not separate systems. Every one stays editable and exports to PBC like any other layer.

**Frame presets:** IG post 1080×1350 and 1080×1080, Story/Reel/TikTok 1080×1920, YouTube thumbnail 1280×720, X post 1600×900. Optional safe-zone overlays (UI-covered areas) come from Sonant's safe zones.

**Social text boxes**

| Style | How it's built |
| --- | --- |
| Pill / boxed caption (IG-story style) | Text node with a per-line background: rounded rect behind each shaped line, padding and radius set by the user |
| Highlight / marker | A per-line background that is shorter and skewed, with multiply blend |
| Outline / stroked text | Text strokes from CanvasKit, stroke outside |
| Bubble / callout | Auto-sized rect or ellipse plus a tail path, grouped with the text and resized as the text changes |
| Lower third / label | Frame preset: bar, title and subtitle |

The per-line background is the one new engine feature here. It needs the line boxes from Paragraph (`getLineMetrics` / rects for ranges).

**Sticker effects**

- **Sticker outline:** a thick white contour that follows an image's alpha or a shape, made by dilating the alpha (morphology filter) and filling it with color. Optional drop shadow and a slight paper edge.
- **Cut-out from photo:** background removal (BiRefNet) followed by an automatic sticker outline. This is the flagship one-click action.
- **Peel / tilt:** a small rotation plus a soft shadow preset, optionally with a curled-corner shape.
- **Texture:** grain or halftone as an SkSL effect, with a blend mode.
- **Sticker library:** user stickers saved to a local library (assets plus effect settings) and dragged in from a side panel.

## MVP stages

There are seven stages, and each one ships a deployable build. Every "done when" is tested on your phone (iPhone Safari as the hardest case) unless it says desktop. Stage 3 is the first one you can use for real posts. Stage 4 proves the motion wedge.

1. ✅ **Stage 0: Foundations.** Set up the pnpm workspace, port Heirloom's AI loader into `packages/ai`, and load CanvasKit in a Vite + Svelte PWA shell with tokens and fonts.
   - Done when a CanvasKit surface draws and pans a rect at 60 fps on your phone, and the installed PWA reloads offline.
   - Built. Still to check on a real phone: 60 fps and an offline reload of the installed app.
2. ✅ **Stage 1: Canvas, selection and a PBC spike.** Build the camera (one finger on empty space or an unselected board pans, two fingers pan and pinch zoom, plus wheel, trackpad, middle-drag and Space-drag on desktop), frames, rect and ellipse, touch-friendly hit-testing (large hit areas, tap again to cycle through overlapping layers), tap, a multi-select mode (touch has no Shift) and marquee, move, resize and rotate handles that stay a constant size on screen, the op log with undo/redo, and the layers drawer (rename, reorder, hide, lock, group). Boards are selected by tapping their name label. End with a thin `.pbc` export: frames, rects, ellipses and groups.
   - Done when you can lay out 3 frames with 50 shapes on your phone, undo 100 steps, reload with nothing lost (autosave to OPFS), and open the result in PBC with names and groups intact.
   - Built: everything above, plus snapping while moving to edges, centres and equal gaps (Alt turns it off), resizing groups and multi-selections (children change size, never get scaled transforms), dragging layers into or out of frames, and cached drawing (one SkPicture per board, re-recorded only when something inside it changes). Unit tests cover undo, grouping, reorder, drop-into-frame, group resize, snapping, change tracking, `doc.json` and the `.pbc` writer.
   - Checked in PBC: exported boards with rects, ellipses, rotation, groups and a nested frame pass `motion check` with nothing dropped, and `motion preview` draws every layer where Nook puts it.
   - Still to check on a real phone: the "done when" run (3 frames, 50 shapes, 100 undos, reload) and opening a phone-made export in PBC.
3. **Stage 2: Paint and text.** Add the properties panel as a bottom sheet: multiple fills and strokes, solid and gradient fills with on-canvas gradient handles, opacity, all blend modes, and the four effects. Add text nodes (fonts, weight, size, line height, letter spacing, alignment, auto-width and fixed boxes) with on-canvas text editing that keeps the caret visible when the keyboard opens. Extend the `.pbc` export to fills, gradients and text.
   - Done when you can rebuild one of your real styleframes on your phone and it looks the same in PBC.
4. **Stage 3: Images, social presets and export.** Add image import (photo picker, drag-drop and paste) as image fills, frame presets and safe zones, background removal, PNG/JPG/WebP export at 1x–4x per frame through the Web Share API, and `.nook` save/open.
   - Done when you can make and post a real IG carousel from your phone. **First usable release.**
5. **Stage 4: Motion export.** Add a `motion` panel on frames and groups (comp/precomp/layer role, notes) and finish `scene-export` to `.pbc`: layers, transforms, gradients, text and effects, with an export report listing anything PBC can't represent.
   - Done when a 3-frame board designed on your phone opens in PBC with named shape and text layers, precomps from groups, and correct positions and gradients, ready to animate. **Wedge proven.**
6. **Stage 5: Social text boxes and stickers.** Add per-line text backgrounds (pill and highlight), bubbles, the sticker outline effect, the one-click photo-to-sticker action, the sticker library, and SkSL grain/halftone.
   - Done when a story with 3 caption styles and 2 photo stickers takes under 5 minutes on your phone.
7. **Stage 6: Vectors.** Add the pen tool (tap for points, drag for Bézier handles, close path, with a touch-sized loupe), node editing, line, polygon and star, non-destructive boolean ops (union, subtract, intersect, exclude), flatten, smart guides and snapping (edges, centers, spacing), SVG export, and vector paths in the `.pbc` export.
   - Done when you can draw an icon and a character silhouette without leaving Nook. **MVP complete.**

**After the MVP, in order:** AE export through a JSX script (desktop), click-to-select and object removal (port from Heirloom), device-to-device sync, auto layout (Yoga), components and instances, SVG/PSD import, then multiplayer.

## Risks and open decisions

The biggest risk is scope: the interaction layer (selection, handles, snapping, pen tool, text editing) will take longer than rendering, and touch makes it harder. The plan front-loads selection in stage 1 and leaves the pen tool for last.

| Risk | Mitigation |
| --- | --- |
| CanvasKit's \~7 MB WASM slows first load, worse on mobile data | Cache it with the service worker; show the file list while it loads |
| iOS Safari: GPU memory limits, OPFS quirks, storage eviction, weak WebGPU | Cap image texture sizes; prompt to install the PWA; make `.nook` backup easy; AI falls back to WASM |
| Touch precision for selection, handles and the pen tool | Large hit areas, screen-size handles, tap to cycle, loupe for the pen tool; test on your phone every stage |
| On-canvas text editing (cursor, IME, selection, on-screen keyboard) is hard | Use a hidden `<textarea>` for input and draw the cursor and selection from Paragraph metrics; handle the viewport resizing when the keyboard opens |
| `.pbc` format changes while Nook targets it | You own both: change the format in PBC first, keep old files opening, and test the Nook export against PBC's importer |
| Mapping effects and blend modes to PBC (and later AE) isn't 1:1 | Keep a mapping table; flag unmappable layers in the export report instead of guessing |
| Pen tool UX disappoints Illustrator/Figma users | Copy Figma's interaction model, adapted for touch, then test with 2–3 designer friends after stage 6 |
| Running PBC, Sonant, Heirloom and Nook at once | Nook's stages 0–3 reuse the most shared code; pause other apps to new features while it's built |
| BiRefNet weights size and licence | Licence already checked MIT in Heirloom; lazy-load only when AI is on and pin the hash |

**Decisions made**

- [x] Primary motion target is PBC: Nook writes `.pbc` directly. AE comes after the MVP, through a JSX script; no `.aep` writing.
- [x] UI is Svelte 5.
- [x] `.nook` files are not read by Sonant; Sonant gets PNG/SVG exports.
- [x] Mobile is the primary device for designing and posting; desktop is needed only for the AE handoff.
