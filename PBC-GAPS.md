# What PBC can't show yet

Things Nook can design that a `.pbc` can't carry or PBC can't draw yet. PBC implements these later, in its own repo (`_pbc`). Until then Nook's export falls back as described and lists each one in the export report.

Only items marked **Important** affect whether a board looks the same in PBC in everyday use. The rest can wait until PBC gets to them.

Updated: Nov 24, 2026. PBC also gained, and Nook now exports: paths with several contours and an even-odd fill (`89a2783`), drop shadow spread (`e859533`), stroke alignment (`f1a6227`), inner shadow (`29792df`) and gradient strokes (`46ebaa9`).

## Important

None right now. Fixed in PBC on Nov 24, 2026: variable-font weights (`56a3ace`) and holes in compound paths (`10c581d`).


## Effects

| Gap | What happens now | What PBC needs |
| --- | --- | --- |
| Background blur | Left out of the export. | A blur of what is behind the layer, clipped to the layer's shape. Needs the backdrop, so it belongs in the compositor. |
| Sticker outline | Left out of the export. | A solid border round the layer's alpha with round corners (dilate, blur, threshold), drawn under the layer. |
| Grain and halftone | Left out of the export. | Two texture effects: hashed noise of a cell size mixed into the layer's colour, and dots on a turned grid sized by darkness. Both are a shader plus a blend with the layer's own pixels (SkSL in Nook). |

## Paint

| Gap | What happens now | What PBC needs |
| --- | --- | --- |
| More than one fill on a layer | Only the top fill is exported. | A stack of fills per layer, or Nook exports each extra fill as its own layer. |
| More than one stroke on a layer | Only the top stroke is exported. | A stack of strokes per layer. |
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
