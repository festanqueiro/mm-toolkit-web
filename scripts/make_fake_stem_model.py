"""Build fixtures/stems/fake-htdemucs.onnx: a ~1 KB stand-in for the HT-Demucs forward export
(`webnn/stem-separator`) with the same inputs and outputs, so tests exercise the Stem Splitter
pipeline without the 170 MB model. Post-processing adds each stem's spectral and time branches,
so each branch carries half: after de-normalisation the stems are drums 0.4, bass 0.3, other 0.2
and vocals 0.1 of the mix (plus a negligible DC term) — they differ and sum back to the mix.

    python scripts/make_fake_stem_model.py   (needs `pip install onnx numpy`)
"""
from pathlib import Path

import numpy as np
import onnx
from onnx import TensorProto, helper, numpy_helper

SEGMENT, BINS, FRAMES = 343_980, 2048, 336
WEIGHTS = [0.2, 0.15, 0.1, 0.05]  # per branch; doubled by summing both branches

x = helper.make_tensor_value_info("x", TensorProto.FLOAT, [1, 4, BINS, FRAMES])
xt = helper.make_tensor_value_info("xt", TensorProto.FLOAT, [1, 2, SEGMENT])
x_out = helper.make_tensor_value_info("x_out", TensorProto.FLOAT, [1, 16, BINS, FRAMES])
xt_out = helper.make_tensor_value_info("xt_out", TensorProto.FLOAT, [1, 8, SEGMENT])

nodes, inits = [], []
for name, inp in (("x", "x"), ("xt", "xt")):
    parts = []
    for i, w in enumerate(WEIGHTS):
        c = f"{name}_w{i}"
        inits.append(numpy_helper.from_array(np.array(w, dtype=np.float32), c))
        nodes.append(helper.make_node("Mul", [inp, c], [f"{name}_s{i}"]))
        parts.append(f"{name}_s{i}")
    nodes.append(helper.make_node("Concat", parts, [f"{name}_out"], axis=1))

graph = helper.make_graph(nodes, "fake_htdemucs_fwd", [x, xt], [x_out, xt_out], inits)
model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 17)], producer_name="mm-toolkit-tests")
model.ir_version = 9  # IR for opset 17; newer onnx packages default to IRs onnxruntime-web rejects
onnx.checker.check_model(model)
out = Path(__file__).resolve().parent.parent / "fixtures" / "stems" / "fake-htdemucs.onnx"
out.parent.mkdir(parents=True, exist_ok=True)
onnx.save(model, out)
print(f"wrote {out} ({out.stat().st_size} bytes)")
