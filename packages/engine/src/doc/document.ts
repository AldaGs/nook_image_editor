// Document: the flat node map plus tree queries (children in order, world transforms).
// Mutate only through `apply`, which returns the inverse op.

import { identity, multiply, type Affine } from '../geom/affine.ts';
import type { Op } from './ops.ts';
import type { Node } from './types.ts';

export class Doc {
  readonly nodes = new Map<string, Node>();
  /** Bumped on every change; caches and the renderer key off it. */
  version = 0;
  private childCache = new Map<string | null, Node[]>();

  get(id: string): Node | undefined {
    return this.nodes.get(id);
  }

  /** Children sorted back-to-front (last is drawn on top). */
  children(parentId: string | null): Node[] {
    let list = this.childCache.get(parentId);
    if (!list) {
      list = [...this.nodes.values()].filter(n => n.parentId === parentId).sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0));
      this.childCache.set(parentId, list);
    }
    return list;
  }

  /** Parent first, ending at the root (page). */
  ancestors(id: string): Node[] {
    const out: Node[] = [];
    for (let n = this.get(this.get(id)?.parentId ?? ''); n; n = this.get(n.parentId ?? '')) out.push(n);
    return out;
  }

  /** Node, its children, their children… (depth-first, parents before children). */
  descendants(id: string): Node[] {
    const out: Node[] = [];
    const walk = (pid: string) => this.children(pid).forEach(c => { out.push(c); walk(c.id); });
    walk(id);
    return out;
  }

  /** Local → world (page) transform. */
  worldTransform(id: string): Affine {
    let m = identity();
    for (let n = this.get(id); n; n = this.get(n.parentId ?? '')) m = multiply(n.transform, m);
    return m;
  }

  /** Apply an op and return its inverse. */
  apply(op: Op): Op {
    let inverse: Op;
    switch (op.t) {
      case 'set': {
        const node = this.must(op.id);
        const old = node[op.prop];
        (node as unknown as Record<string, unknown>)[op.prop] = structuredClone(op.value);
        inverse = { t: 'set', id: op.id, prop: op.prop, value: structuredClone(old) };
        break;
      }
      case 'add':
        if (this.nodes.has(op.node.id)) throw new Error(`node ${op.node.id} already exists`);
        this.nodes.set(op.node.id, structuredClone(op.node));
        inverse = { t: 'remove', id: op.node.id };
        break;
      case 'remove': {
        const node = this.must(op.id);
        if (this.children(op.id).length) throw new Error(`remove children of ${op.id} first`);
        this.nodes.delete(op.id);
        inverse = { t: 'add', node };
        break;
      }
    }
    this.version++;
    this.childCache.clear();
    return inverse;
  }

  private must(id: string): Node {
    const n = this.nodes.get(id);
    if (!n) throw new Error(`no node ${id}`);
    return n;
  }
}
