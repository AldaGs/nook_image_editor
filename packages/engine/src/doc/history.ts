// Undo history. Changes are grouped into transactions: one user action (a tap,
// a whole drag) is one undo step, however many ops it applied.

import type { Doc } from './document.ts';
import type { Op } from './ops.ts';

interface Entry { label: string; forward: Op[]; inverse: Op[]; mergeKey?: string }

const LIMIT = 500;

export class History {
  private undoStack: Entry[] = [];
  private redoStack: Entry[] = [];
  private pending: Entry | null = null;

  private doc: Doc;
  private onChange: () => void;

  constructor(doc: Doc, onChange: () => void) {
    this.doc = doc;
    this.onChange = onChange;
  }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
  get inTransaction() { return this.pending !== null; }

  /** Start grouping ops. Nested begins join the outer transaction. */
  begin(label: string): void {
    this.pending ??= { label, forward: [], inverse: [] };
  }

  /** Apply ops inside the open transaction (opens a one-op one if none). */
  apply(...ops: Op[]): void {
    const auto = !this.pending;
    if (auto) this.begin('edit');
    for (const op of ops) {
      this.pending!.inverse.push(this.doc.apply(op));
      this.pending!.forward.push(op);
    }
    if (auto) this.commit();
    else this.onChange();
  }

  /**
   * Close the transaction as one undo step. Empty transactions are dropped.
   * With a `mergeKey` equal to the last step's (and nothing undone since), it
   * joins that step instead: a run of typing undoes as one.
   */
  commit(mergeKey?: string): void {
    const e = this.pending;
    this.pending = null;
    if (!e || !e.forward.length) return;
    const last = this.undoStack[this.undoStack.length - 1];
    if (mergeKey && last?.mergeKey === mergeKey && !this.redoStack.length) {
      last.forward.push(...e.forward);
      last.inverse.push(...e.inverse);
      this.onChange();
      return;
    }
    e.mergeKey = mergeKey;
    this.undoStack.push(e);
    if (this.undoStack.length > LIMIT) this.undoStack.shift();
    this.redoStack = [];
    this.onChange();
  }

  /** Revert everything applied since `begin` (e.g. a second finger cancels a drag). */
  cancel(): void {
    const e = this.pending;
    this.pending = null;
    if (!e) return;
    for (const op of [...e.inverse].reverse()) this.doc.apply(op);
    this.onChange();
  }

  /** Revert the open transaction's ops but keep it open (drags re-apply from their start state). */
  rewind(): void {
    const e = this.pending;
    if (!e) return;
    for (const op of [...e.inverse].reverse()) this.doc.apply(op);
    e.forward = [];
    e.inverse = [];
  }

  undo(): void {
    this.commit();
    const e = this.undoStack.pop();
    if (!e) return;
    // Inverses run newest-first; redo replays the original forward ops.
    for (const op of [...e.inverse].reverse()) this.doc.apply(op);
    this.redoStack.push(e);
    this.onChange();
  }

  redo(): void {
    const e = this.redoStack.pop();
    if (!e) return;
    const inverse = e.forward.map(op => this.doc.apply(op));
    this.undoStack.push({ label: e.label, forward: e.forward, inverse });
    this.onChange();
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.pending = null;
  }
}
