// Ops: the only way the document changes. Each op has an exact inverse, which
// gives undo/redo now and a path to CRDT sync later (README "State").

import type { Node, NodeProp } from './types.ts';

export type Op =
  | { t: 'set'; id: string; prop: NodeProp; value: unknown }
  | { t: 'add'; node: Node }
  | { t: 'remove'; id: string };
