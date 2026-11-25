"""Make an ONNX model fit WebGPU's per-shader buffer limit.

Chrome's WebGPU on Windows allows 16 storage buffers per shader, whatever the
GPU. BiRefNet has Split nodes with 32 outputs (and a few wide Concats), which
need 33 buffers in one shader and fail there. This rewrites every Split or
Concat touching more than MAX tensors into a two-level tree of smaller ones.
The maths is unchanged: a split of a split, or a concat of concats, along the
same axis gives the same tensors in the same order.

Usage: python patch_wide_ops.py in.onnx out.onnx      (needs: pip install onnx)
"""
import sys

import onnx
from onnx import helper, numpy_helper

MAX = 8  # pieces per node after patching: 1 + 8 buffers, far under 16


def chunks(seq, n):
    return [seq[i:i + n] for i in range(0, len(seq), n)]


def const_values(graph, name):
    """The integer values of an initializer or Constant output, or None."""
    for init in graph.initializer:
        if init.name == name:
            return [int(v) for v in numpy_helper.to_array(init).flatten()]
    for node in graph.node:
        if node.op_type == 'Constant' and node.output[0] == name:
            return [int(v) for v in numpy_helper.to_array(node.attribute[0].t).flatten()]
    return None


def axis_of(node):
    return next((a.i for a in node.attribute if a.name == 'axis'), 0)


def patch(model):
    g = model.graph
    out_nodes, made = [], 0
    for node in g.node:
        wide_split = node.op_type == 'Split' and len(node.output) > MAX
        wide_concat = node.op_type == 'Concat' and len(node.input) > MAX
        if not (wide_split or wide_concat):
            out_nodes.append(node)
            continue
        axis = axis_of(node)
        if wide_concat:
            parts = []
            for i, group in enumerate(chunks(list(node.input), MAX)):
                mid = f'{node.name}/part{i}'
                out_nodes.append(helper.make_node('Concat', group, [mid], name=f'{node.name}_part{i}', axis=axis))
                parts.append(mid)
            out_nodes.append(helper.make_node('Concat', parts, list(node.output), name=node.name, axis=axis))
        else:
            sizes = const_values(g, node.input[1]) if len(node.input) > 1 and node.input[1] else None
            if sizes is None:
                raise SystemExit(f'{node.name}: split sizes are not a constant; cannot patch')
            groups = chunks(list(zip(node.output, sizes)), MAX)
            mids = []
            for i, group in enumerate(groups):
                mid = f'{node.name}/part{i}'
                size_name = f'{node.name}/part{i}_sizes'
                g.initializer.append(numpy_helper.from_array(
                    __import__('numpy').array([s for _, s in group], dtype='int64'), size_name))
                mids.append((mid, sum(s for _, s in group), [o for o, _ in group], size_name))
            outer_sizes = f'{node.name}/outer_sizes'
            g.initializer.append(numpy_helper.from_array(
                __import__('numpy').array([m[1] for m in mids], dtype='int64'), outer_sizes))
            out_nodes.append(helper.make_node('Split', [node.input[0], outer_sizes], [m[0] for m in mids], name=node.name, axis=axis))
            for mid, _, outs, size_name in mids:
                out_nodes.append(helper.make_node('Split', [mid, size_name], outs, name=f'{mid}_split', axis=axis))
        made += 1
    del g.node[:]
    g.node.extend(out_nodes)
    return made


if __name__ == '__main__':
    src, dst = sys.argv[1], sys.argv[2]
    m = onnx.load(src)
    n = patch(m)
    onnx.checker.check_model(m)
    onnx.save(m, dst)
    print(f'patched {n} wide nodes -> {dst}')
