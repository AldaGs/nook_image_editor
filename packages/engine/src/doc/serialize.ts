// doc.json: the document as a node list. Versioned so old files keep opening.

import { Doc } from './document.ts';
import { keysAfter } from './fractional.ts';
import { createNode, FRAME_PRESETS } from './factory.ts';
import { translation } from '../geom/affine.ts';
import { solid, type Node } from './types.ts';

export const DOC_FORMAT_VERSION = 1;

export interface DocFile { format: 'nook'; version: number; nodes: Node[] }

export function toFile(doc: Doc): DocFile {
  return { format: 'nook', version: DOC_FORMAT_VERSION, nodes: [...doc.nodes.values()] };
}

export function fromFile(file: unknown): Doc {
  const f = file as Partial<DocFile>;
  if (f?.format !== 'nook' || !Array.isArray(f.nodes)) throw new Error('not a Nook document');
  if ((f.version ?? 0) > DOC_FORMAT_VERSION) throw new Error('made by a newer Nook: update the app to open it');
  const doc = new Doc();
  for (const n of f.nodes) doc.apply({ t: 'add', node: n });
  return doc;
}

/** The picture files a document uses (asset ids, each once). */
export function usedAssets(doc: Doc): string[] {
  const ids = new Set<string>();
  for (const n of doc.nodes.values()) {
    for (const p of [...n.fills, ...n.strokes.map(s => s.paint)]) if (p.kind === 'image') ids.add(p.assetId);
  }
  return [...ids];
}

/** A new document: one page with three IG-post boards, each with a shape. */
export function starterDoc(): Doc {
  const doc = new Doc();
  const page = createNode('page', { name: 'Page 1', parentId: null, order: 'V', fills: [] });
  doc.apply({ t: 'add', node: page });
  const preset = FRAME_PRESETS[0];
  keysAfter(null, 3).forEach((order, i) => {
    const frame = createNode('frame', {
      name: `Board ${i + 1}`, parentId: page.id, order,
      transform: translation(i * (preset.width + 120), 0), width: preset.width, height: preset.height,
    });
    doc.apply({ t: 'add', node: frame });
    doc.apply({ t: 'add', node: createNode('rect', {
      name: 'Card', parentId: frame.id, order: 'V',
      transform: translation(240, 375), width: 600, height: 600, cornerRadius: 48 * (i + 1),
      fills: [solid({ r: 0.427, g: 0.29, b: 1, a: 1 })],
    }) });
  });
  return doc;
}
