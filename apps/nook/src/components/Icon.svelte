<!-- Icon: a Lucide icon inlined as SVG, sized by the surrounding font size. -->
<script lang="ts" module>
  // Only the icons we use are bundled.
  import arrowDown from 'lucide-static/icons/arrow-down.svg?raw';
  import arrowUp from 'lucide-static/icons/arrow-up.svg?raw';
  import chevronDown from 'lucide-static/icons/chevron-down.svg?raw';
  import chevronRight from 'lucide-static/icons/chevron-right.svg?raw';
  import circle from 'lucide-static/icons/circle.svg?raw';
  import eye from 'lucide-static/icons/eye.svg?raw';
  import eyeOff from 'lucide-static/icons/eye-off.svg?raw';
  import frame from 'lucide-static/icons/frame.svg?raw';
  import group from 'lucide-static/icons/group.svg?raw';
  import image from 'lucide-static/icons/image.svg?raw';
  import layers from 'lucide-static/icons/layers.svg?raw';
  import layoutTemplate from 'lucide-static/icons/layout-template.svg?raw';
  import listChecks from 'lucide-static/icons/list-checks.svg?raw';
  import lock from 'lucide-static/icons/lock.svg?raw';
  import lockOpen from 'lucide-static/icons/lock-open.svg?raw';
  import maximize from 'lucide-static/icons/maximize.svg?raw';
  import minus from 'lucide-static/icons/minus.svg?raw';
  import plus from 'lucide-static/icons/plus.svg?raw';
  import sliders from 'lucide-static/icons/sliders-horizontal.svg?raw';
  import smartphone from 'lucide-static/icons/smartphone.svg?raw';
  import pipette from 'lucide-static/icons/pipette.svg?raw';
  import pointer from 'lucide-static/icons/mouse-pointer-2.svg?raw';
  import redo from 'lucide-static/icons/redo-2.svg?raw';
  import settings from 'lucide-static/icons/settings.svg?raw';
  import share from 'lucide-static/icons/share.svg?raw';
  import sticker from 'lucide-static/icons/sticker.svg?raw';
  import bookmarkPlus from 'lucide-static/icons/bookmark-plus.svg?raw';
  import pentagon from 'lucide-static/icons/pentagon.svg?raw';
  import star from 'lucide-static/icons/star.svg?raw';
  import slash from 'lucide-static/icons/slash.svg?raw';
  import penTool from 'lucide-static/icons/pen-tool.svg?raw';
  import check from 'lucide-static/icons/check.svg?raw';
  import spline from 'lucide-static/icons/spline.svg?raw';
  import combine from 'lucide-static/icons/combine.svg?raw';
  import square from 'lucide-static/icons/square.svg?raw';
  import trash from 'lucide-static/icons/trash-2.svg?raw';
  import type_ from 'lucide-static/icons/type.svg?raw';
  import undo from 'lucide-static/icons/undo-2.svg?raw';
  import ungroup from 'lucide-static/icons/ungroup.svg?raw';
  import x from 'lucide-static/icons/x.svg?raw';

  const ICONS = {
    arrowDown, arrowUp, chevronDown, chevronRight, circle, eye, eyeOff, frame, group, image, layers,
    layoutTemplate, listChecks, lock, lockOpen, maximize, minus, pipette, plus, pointer, redo, settings, share, sliders, smartphone, square, combine, spline, penTool, check, pentagon, star, slash, sticker, bookmarkPlus, trash, type: type_,
    undo, ungroup, x,
  };
  export type IconName = keyof typeof ICONS;
</script>

<script lang="ts">
  let { name }: { name: IconName } = $props();
</script>

<span class="icon" aria-hidden="true">{@html ICONS[name]}</span>

<style>
  .icon { display: inline-flex; width: 1.25em; height: 1.25em; }
  .icon :global(svg) { width: 100%; height: 100%; }
</style>
