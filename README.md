# Nook — Concept & MVP Plan

Nov 23, 2026 · @Aldair

## Concept

Nook is a browser-based, Figma-style design tool for motion designers: you design boards with real layers and they go straight into animation with the structure intact. It is also a fast tool for making social posts.

**Who it's for:** motion designers who design styleframes and boards in Figma or Illustrator and then rebuild them by hand in After Effects. You are the first user.

**The wedge:** Figma exports flat images or SVGs with mangled names. Nook keeps layer names, groups and frames so each board exports as a structured scene: frames become comps, groups become precomps, and shapes, text and gradients stay editable. Targets are Pain By Choice (PBC) and your AEP pipeline (JSON to JSX to .aep).

**Second job:** social posts. These include story/post/reel frame presets, social text boxes, sticker effects and one-click PNG/JPG export. This is what you'll use every week, so it keeps the app honest.

**Siblings:** photos come from Heirloom, and boards and stickers go into Sonant as image or text layers. All three share AI, storage and design-token packages.

**Principles**

- Restraint: a small tool set that works well beats a long feature list.
- Single-player first. Multiplayer is designed for in the data model but not built.
- Local-first: no account, files stay on the device, works offline as a PWA.
- Free and open source, with no dark patterns.
- AI is off by default, runs on the device and is optional.

## MVP scope

The MVP is done when you can design a 3-frame styleframe board and an Instagram post in Nook, export the board as a structured scene that opens in After Effects with its layers intact, and export the post as a PNG.

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
| Background removal on images (from Heirloom) | Click-to-select (MobileSAM), object removal |  |
| Export: PNG/JPG/WebP @1x–4x, SVG, scene JSON for AE/PBC | PDF export |  |

## Tech stack and architecture

The engine is plain TypeScript rendering through CanvasKit (Skia in WASM). The UI is Svelte 5 on top, and the engine never imports UI code.

| Layer | Choice | Why |
| --- | --- | --- |
| Build / app shell | Vite + TypeScript, installable PWA | Same as Heirloom and Sonant |
| UI | Svelte 5 | Matches Sonant; low overhead for panel-heavy UI |
| Renderer | CanvasKit on WebGL2 | Paths, PathOps booleans, gradients, all blend modes, blur/shadow filters, HarfBuzz text in one dependency |
| Custom effects | SkSL runtime effects | Sticker outlines, halftone, grain without leaving Skia |
| Text | CanvasKit Paragraph + @fontsource fonts | Proper shaping; reuses Sonant's font set |
| State | Document store + op log | Every change is `{nodeId, prop, value}`: undo/redo now, CRDT (Loro/Yjs) later |
| Storage | OPFS + IndexedDB, autosave | Local-first; `.nook` = zip of `doc.json` + `assets/` |
| AI | Shared `ai` package (ORT Web, WebGPU → WASM) | BiRefNet background removal, same AI switch as Heirloom |
| Workers | Export, AI, and font loading off the main thread | Keeps the canvas at 60 fps |

**Monorepo (pnpm workspaces)**

- `apps/nook`, `apps/heirloom`, `apps/sonant`
- `packages/engine`: document model, ops, hit-testing, layout, CanvasKit renderer
- `packages/ai`: ORT loader, model cache, AI on/off switch (moved out of Heirloom)
- `packages/storage`: OPFS/IndexedDB helpers, file save/open
- `packages/tokens`: shared design tokens and fonts
- `packages/scene-export`: Nook scene → AE JSON / PBC format

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
  motion?: { role?: 'comp'|'precomp'|'layer', notes?: string } // AE export hints
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

- Colors are stored in linear float and converted at render time, which matches Heirloom.
- Vector paths are stored as Béziers in node-local space. Boolean nodes keep their children, so they stay editable (non-destructive).
- Assets (images, removed-background PNGs, fonts) are content-hashed in `assets/`, and nodes refer to them by hash.
- Leave room for components: instances will store overrides keyed by the node path inside the component. Settle the shape of that map now, even though the feature ships later.

## Social media features

The social features are presets built from engine primitives (text, fills, effects), not separate systems. Every one stays editable and exports to AE like any other layer.

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

There are seven stages, and each one ships a deployable build. Stage 3 is the first one you can use for real posts. Stage 6 proves the motion wedge.

1. **Stage 0: Foundations.** Set up the pnpm monorepo, move Heirloom's AI code into `packages/ai`, and load CanvasKit in a Vite + Svelte shell with tokens and fonts.
   - Done when a CanvasKit surface draws a rect at 60 fps, and Heirloom still builds against the shared `ai` package.
2. **Stage 1: Canvas and selection.** Build the camera (pan, zoom to cursor, trackpad pinch), frames, rect and ellipse, hit-testing, click, shift and marquee selection, move, resize and rotate handles, the op log with undo/redo, and the layers panel (rename, reorder, hide, lock, group).
   - Done when you can lay out 3 frames with 50 shapes, undo 100 steps, and reload with nothing lost (autosave to OPFS).
3. **Stage 2: Paint and text.** Add the properties panel: multiple fills and strokes, solid and gradient fills with on-canvas gradient handles, opacity, all blend modes, and the four effects. Add text nodes (fonts, weight, size, line height, letter spacing, alignment, auto-width and fixed boxes) with on-canvas text editing.
   - Done when you can rebuild one of your real styleframes visually.
4. **Stage 3: Images, social presets and export.** Add image import, drag-drop and paste as image fills, frame presets and safe zones, background removal, PNG/JPG/WebP export at 1x–4x per frame, and `.nook` save/open.
   - Done when you can make and post a real IG carousel from Nook. **First usable release.**
5. **Stage 4: Vectors.** Add the pen tool (click for points, drag for Bézier handles, close path), node editing, line, polygon and star, non-destructive boolean ops (union, subtract, intersect, exclude), flatten, and smart guides and snapping (edges, centers, spacing).
   - Done when you can draw an icon and a character silhouette without leaving Nook.
6. **Stage 5: Social text boxes and stickers.** Add per-line text backgrounds (pill and highlight), bubbles, the sticker outline effect, the one-click photo-to-sticker action, the sticker library, and SkSL grain/halftone.
   - Done when a story with 3 caption styles and 2 photo stickers takes under 5 minutes.
7. **Stage 6: Motion export.** Add a `motion` panel on frames and groups (comp/precomp/layer role, notes), a `scene-export` that writes per-frame JSON (layers, transforms, paths, gradients, text, effects mapped to AE equivalents) for your JSX → .aep pipeline and PBC, and SVG export.
   - Done when a 3-frame board opens in AE with named shape and text layers, precomps from groups, and correct positions and gradients. **MVP complete.**

**After the MVP, in order:** auto layout (Yoga), then components and instances, then click-to-select and object removal, then SVG/PSD import, then multiplayer.

## Risks and open decisions

The biggest risk is scope: the interaction layer (selection, handles, snapping, pen tool, text editing) will take longer than rendering. The plan front-loads it in stages 1 and 4.

| Risk | Mitigation |
| --- | --- |
| CanvasKit's \~7 MB WASM slows first load | Cache it with the service worker; show the file list while it loads |
| On-canvas text editing (cursor, IME, selection) is hard | Use a hidden `<textarea>` for input and draw the cursor and selection from Paragraph metrics |
| Mapping effects and blend modes to AE isn't 1:1 | Keep a mapping table; flag unmappable layers in the export report instead of guessing |
| Pen tool UX disappoints Illustrator/Figma users | Copy Figma's interaction model exactly, then test with 2–3 designer friends after stage 4 |
| Running PBC, Sonant, Heirloom and Nook at once | Nook's stages 0–3 reuse the most shared code; pause other apps to new features while it's built |
| BiRefNet weights size and licence | Already checked MIT in Heirloom; lazy-load and pin the hash |

**Open decisions**

- [ ] Is the AE handoff a JSON consumed by your AEP pipeline, a direct JSX script, or both?
- [ ] Is PBC's scene format stable enough to target in stage 6, or should Nook export to AE first?
- [ ] Svelte 5 or React for Nook's UI? (The engine works with either.)
- [ ] Should `.nook` files be readable by Sonant directly, or exported as PNG/SVG only?
- [ ] Is mobile in scope for the MVP (view and export only), or is it desktop only?
