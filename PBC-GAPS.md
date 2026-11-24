# What PBC can't show yet

Things Nook can design that a `.pbc` can't carry or PBC can't draw yet. PBC implements these later, in its own repo (`_pbc`). Until then Nook's export falls back as described and lists each one in the export report.

Only items marked **Important** affect whether a board looks the same in PBC in everyday use. The rest can wait until PBC gets to them.

Updated: Nov 24, 2026 (Nook Stage 5).

## Important

| Gap | What happens now | What PBC needs |
| --- | --- | --- |
| **Variable-font weights.** With a variable font installed (for example `Montserrat-VariableFont_wght.ttf`), PBC draws weights 600, 800 and 900 all as the heaviest cut. 300 and 400 are right. | Heavier text is bolder and wider in PBC than in Nook, so it can wrap onto extra lines. Nook writes the right weight. | A bug in PBC's text shaping (`crates/core/src/text.rs`). The variable `wght` axis should be set to the requested weight, as `node.rs` already says it should. Likely suspects are fontique picking a bold instance or applying synthetic emboldening. |

## Effects

| Gap | What happens now | What PBC needs |
| --- | --- | --- |
| Inner shadow | Left out of the export. | An `InnerShadow` effect (colour, offset, blur, spread), drawn inside the layer's alpha. |
| Background blur | Left out of the export. | A blur of what is behind the layer, clipped to the layer's shape. Needs the backdrop, so it belongs in the compositor. |
| Drop shadow spread | Exported without the spread. | A `spread` value on `DropShadow` that grows (or, negative, shrinks) the alpha before blurring. |

## Paint

| Gap | What happens now | What PBC needs |
| --- | --- | --- |
| More than one fill on a layer | Only the top fill is exported. | A stack of fills per layer, or Nook exports each extra fill as its own layer. |
| More than one stroke on a layer | Only the top stroke is exported. | A stack of strokes per layer. |
| Strokes inside or outside the outline | Exported centred on the outline. | A stroke alignment setting: inside clips to the shape, outside clips it out, as Nook draws them. |
| Gradient strokes | Flattened to the gradient's average colour. | A `gradient` on `Stroke`, like the one on fills. |
| A fill's own blend mode (separate from the layer's) | Drawn as Normal. | A blend mode per paint. |
| Gradient fills: editing in PBC | PBC draws them (commit `14eb946`, "Gradient fills") but can't edit them. | Gradient controls in PBC's properties panel: kind, the two end points and the stops. |
| Gradients on per-character animated text | PBC draws the solid fallback fill. | Map the ramp through each glyph piece's own transform (`crates/core/src/eval.rs`, the animated-text branch). |

## Structure

| Gap | What happens now | What PBC needs |
| --- | --- | --- |
| A board's own strokes and effects, or a rotated board | Not exported, because a comp has no strokes, effects or rotation. | Probably nothing: in Nook, keep that styling on a layer inside the board. |

| Rounded corners on a nested board's clip | The precomp's mask is square. | Nothing new: Nook could write the mask as a rounded Vector path. To do on the Nook side. |
| Image fills | Drawn as a gray box. | PBC footage is a file path (`Asset.path`, used as given). A `.pbc` that travels with its pictures needs asset paths resolved beside the project file; then Nook can export a folder or zip. |
| Motion notes | Written to the layer's `tags` as `note: …` (the root layer's for a board). | A notes field PBC shows, if wanted. |

## Text

| Gap | What happens now | What PBC needs |
| --- | --- | --- |
| Fonts | PBC finds fonts by name on the computer that opens the file. The export report lists the fonts to install. | Nothing, if the fonts are installed (PBC's invariant 9: documents store font names, not font files). Bundling Nook's six families with PBC would make this automatic. |
| Text strokes inside or outside | Exported centred. (Nook draws an outside stroke under the fill; an inside one draws centred.) | The same stroke alignment as for shapes, applied to glyph outlines. |
| Line backgrounds and bubbles (pill, highlight, bubble) | Left out of the export; the report names each text layer. | A per-line box behind text (style, colour, padding), or Nook exports each line's box as a Rect layer. |
| Line breaks and line heights | Nook lays text out with Skia, PBC with parley. With the same font they agree closely, but a line can break at a different word near the edge of a box. | Nothing to build. Recheck wrapped text when it matters. |
