"""
Vitrine — AI-native e-shop (ITC 4949 Capstone)
Copyright (c) 2026 George Papasotiriou. All rights reserved.
Author: George Papasotiriou <g.papasotiriou@acg.edu>
Project started: 2026-09-12

Converts the official Depth Anything V2 metric-indoor checkpoint into the ONNX file the browser runs, choosing its compression by measurement.

WHY THIS EXISTS. The paper-free room mode needs a depth model that runs in the
shopper's browser and answers in metres. transformers.js has no metric Depth
Anything; Apple's DepthPro is 600 MB; and the ready-made ONNX files on the model
hub come from unverified uploaders, which is not something to ship to shoppers.
So the conversion is done here, from the official checkpoint, on George's
machine, and the result is served by the shop itself.

WHY THE COMPRESSION IS MEASURED. A 99 MB model is too much to send to a phone,
so its weights are compressed to 8 bits. But the room geometry turns an error in
depth into the same error in the drawn size of a piece (evaluation E4, section
7), and the textbook 8-bit compression moved depth by 2.3% (median) and 6.1%
(p95) on real rooms — a large bite of the plan's 10% budget before a single tap.
So several compressions are tried, each is run on real room photographs next to
the original PyTorch model, and the smallest one within the accuracy budget is
kept. The winner, 8-bit weights in blocks of 32 with the arithmetic left in
floating point, stays within 0.13% (median) at 36 MB. The numbers are written
into the manifest and the report.

WHAT IT DOWNLOADS (once, only when run):
  - the checkpoint depth-anything/Depth-Anything-V2-Metric-Indoor-Small-hf,
    about 99 MB, Apache-2.0
  - the Python tooling it needs, into research/.venv (see research/README)

    pnpm depth-model inputs            # real room photos, prepared as the browser prepares them
    python research/export_depth_model.py --out public/models/depth
    python research/export_depth_model.py --dry-run    # say what would happen, download nothing
"""

from __future__ import annotations

import argparse
import hashlib
import json
import time
from pathlib import Path

MODEL_ID = "depth-anything/Depth-Anything-V2-Metric-Indoor-Small-hf"
# The backbone works in 14-pixel patches: 518 = 37 x 14, the size the model was trained at.
INPUT_SIZE = 518
FILENAME = "depth-anything-v2-metric-indoor-small.onnx"
VERIFY_DIR = Path(".local/depth-verify")

# The accuracy budget for compression, as relative change in depth against the
# original model over real room photographs. A 1% median change is 1% of drawn
# size: small next to the model's own error, and far inside the plan's 10%.
MAX_MEDIAN_CHANGE = 0.01
MAX_P95_CHANGE = 0.03


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def plan(out: Path) -> None:
    print(f"""Depth model conversion plan

  Checkpoint   {MODEL_ID}
               about 99 MB, Apache-2.0, from the official Hugging Face repository
  Input        {INPUT_SIZE} x {INPUT_SIZE} RGB, ImageNet normalisation
  Output       metric depth in metres, one value per pixel
  Compression  chosen by measurement: the smallest file whose depth stays within
               {MAX_MEDIAN_CHANGE:.0%} (median) and {MAX_P95_CHANGE:.0%} (p95) of the original on real rooms
  Writes       {out / FILENAME} and {out / 'manifest.json'}

Nothing was downloaded.
""")


def load_inputs(np):
    """The verification photographs, prepared by `pnpm depth-model inputs`, plus one synthetic image."""
    inputs = {}
    for file in sorted(VERIFY_DIR.glob("*.f32")):
        inputs[file.stem] = np.fromfile(file, dtype=np.float32).reshape(1, 3, INPUT_SIZE, INPUT_SIZE)
    rng = np.random.default_rng(7)
    ys, xs = np.mgrid[0:INPUT_SIZE, 0:INPUT_SIZE] / INPUT_SIZE
    image = np.stack([xs, ys, 0.5 * (xs + ys)]) + 0.05 * rng.standard_normal((3, INPUT_SIZE, INPUT_SIZE))
    mean = np.array([0.485, 0.456, 0.406])[:, None, None]
    std = np.array([0.229, 0.224, 0.225])[:, None, None]
    inputs["synthetic-gradient"] = ((image - mean) / std)[None].astype(np.float32)
    return inputs


def measure(model_path: Path, inputs, references, np):
    """Median and p95 relative change in depth against PyTorch, over all inputs, and the time per image."""
    import onnxruntime

    session = onnxruntime.InferenceSession(str(model_path), providers=["CPUExecutionProvider"])
    name = session.get_inputs()[0].name
    changes = []
    started = time.perf_counter()
    for key, tensor in inputs.items():
        output = session.run(None, {name: tensor})[0]
        reference = references[key]
        changes.append((np.abs(output - reference) / np.maximum(np.abs(reference), 1e-3)).ravel())
    per_image_ms = (time.perf_counter() - started) * 1000 / len(inputs)
    joined = np.concatenate(changes)
    return float(np.median(joined)), float(np.percentile(joined, 95)), per_image_ms


def export(out: Path, choice: str) -> None:
    # Trust the operating system's certificates, as pip does. On machines whose
    # HTTPS passes through antivirus or a company proxy, Python's own bundle does
    # not know that certificate and the download fails; verification stays on.
    try:
        import truststore

        truststore.inject_into_ssl()
    except ImportError:
        pass

    import numpy as np
    import torch  # imported here so --dry-run needs none of it
    from onnxruntime.quantization import QuantType, quantize_dynamic
    from transformers import AutoModelForDepthEstimation

    out.mkdir(parents=True, exist_ok=True)
    work = Path("research/.venv/depth-work")
    work.mkdir(parents=True, exist_ok=True)

    print(f"Loading {MODEL_ID} …")
    model = AutoModelForDepthEstimation.from_pretrained(MODEL_ID)
    model.eval()

    class Depth(torch.nn.Module):
        """The bare model: pixels in, metres out, with no processor around it."""

        def __init__(self, inner: torch.nn.Module) -> None:
            super().__init__()
            self.inner = inner

        def forward(self, pixel_values: torch.Tensor) -> torch.Tensor:
            return self.inner(pixel_values=pixel_values).predicted_depth

    wrapped = Depth(model)
    inputs = load_inputs(np)
    real = [key for key in inputs if key != "synthetic-gradient"]
    print(f"Verification images: {len(real)} real room photographs and one synthetic image")
    if not real:
        print("  (none found: run `pnpm depth-model inputs` first for a measurement that means something)")
    with torch.no_grad():
        references = {key: wrapped(torch.from_numpy(tensor)).numpy() for key, tensor in inputs.items()}
    for key in real:
        ref = references[key]
        print(f"  {key}: the original model sees {float(np.percentile(ref, 5)):.2f}–{float(np.percentile(ref, 95)):.2f} m")

    fp32 = work / "fp32.onnx"
    print("Exporting the float32 graph …")
    try:
        # The TorchScript exporter gives the most portable graph for onnxruntime-web.
        torch.onnx.export(wrapped, (torch.from_numpy(inputs["synthetic-gradient"]),), str(fp32),
                          input_names=["pixel_values"], output_names=["predicted_depth"], opset_version=17, dynamo=False)
    except Exception as error:  # newer torch releases may only keep the dynamo exporter
        print(f"TorchScript export unavailable ({type(error).__name__}); using the dynamo exporter.")
        torch.onnx.export(wrapped, (torch.from_numpy(inputs["synthetic-gradient"]),), str(fp32),
                          input_names=["pixel_values"], output_names=["predicted_depth"], opset_version=18, dynamo=True,
                          external_data=False)

    # The candidates, smallest first in expectation. Per-channel scales give
    # each output channel its own range, which matters in a vision transformer
    # whose channels differ in magnitude by orders; leaving the convolutional
    # head in float keeps the layers that paint the final depth exact.
    candidates = {
        "int8": dict(per_channel=False, weight_type=QuantType.QUInt8, op_types_to_quantize=None),
        "int8-per-channel": dict(per_channel=True, weight_type=QuantType.QInt8, op_types_to_quantize=None),
        "int8-matmul-per-channel": dict(per_channel=True, weight_type=QuantType.QInt8, op_types_to_quantize=["MatMul"]),
    }
    results = []
    for name, options in candidates.items():
        if choice not in ("auto", name):
            continue
        path = work / f"{name}.onnx"
        kwargs = {k: v for k, v in options.items() if v is not None}
        quantize_dynamic(str(fp32), str(path), **kwargs)
        median, p95, ms = measure(path, inputs, references, np)
        results.append({"name": name, "path": path, "bytes": path.stat().st_size, "median": median, "p95": p95, "ms": ms})

    # Weight-only, block-wise (MatMulNBits). The dynamic schemes above also
    # squeeze every intermediate activation into 8 bits, and that is where
    # their error comes from. Here only the stored weights are compressed, each
    # block of 32 with its own scale, and the arithmetic stays in 32-bit floats:
    # nearly the size of 8-bit, nearly the accuracy of the original.
    import onnx
    from onnxruntime.quantization.matmul_nbits_quantizer import MatMulNBitsQuantizer

    for bits in (8, 4):
        name = f"int{bits}-weights-block32"
        if choice not in ("auto", name):
            continue
        path = work / f"{name}.onnx"
        quantizer = MatMulNBitsQuantizer(onnx.load(str(fp32)), bits=bits, block_size=32, is_symmetric=True)
        quantizer.process()
        quantizer.model.save_model_to_file(str(path), use_external_data_format=False)
        median, p95, ms = measure(path, inputs, references, np)
        results.append({"name": name, "path": path, "bytes": path.stat().st_size, "median": median, "p95": p95, "ms": ms})
    if choice in ("auto", "fp32"):
        median, p95, ms = measure(fp32, inputs, references, np)
        results.append({"name": "fp32", "path": fp32, "bytes": fp32.stat().st_size, "median": median, "p95": p95, "ms": ms})

    print("\nCompression   size      depth change vs original (median / p95)   time per image")
    for r in sorted(results, key=lambda r: r["bytes"]):
        within = r["median"] <= MAX_MEDIAN_CHANGE and r["p95"] <= MAX_P95_CHANGE
        print(f"  {r['name']:<24} {r['bytes'] / 1_048_576:6.1f} MB   {100 * r['median']:5.2f}% / {100 * r['p95']:5.2f}%"
              f"   {r['ms']:6.0f} ms   {'within budget' if within else 'outside budget'}")

    eligible = [r for r in results if r["median"] <= MAX_MEDIAN_CHANGE and r["p95"] <= MAX_P95_CHANGE]
    chosen = min(eligible or results, key=lambda r: r["bytes"] if eligible else r["median"])
    target = out / FILENAME
    target.write_bytes(chosen["path"].read_bytes())
    print(f"\nKept {chosen['name']}: {chosen['bytes'] / 1_048_576:.1f} MB, depth within "
          f"{100 * chosen['median']:.2f}% (median) of the original on {len(real)} real rooms.")

    manifest = {
        "name": "Depth Anything V2 Metric (indoor, small)",
        "source": MODEL_ID,
        "licence": "Apache-2.0",
        "model": FILENAME,
        "runtime": "ort.wasm.min.js",
        "inputSize": INPUT_SIZE,
        "output": "metric_depth",
        "inputName": "pixel_values",
        "outputName": "predicted_depth",
        # WebAssembly first: 8-bit integer kernels are fastest there, and it runs on every browser.
        "providers": ["wasm"],
        "compression": chosen["name"],
        "measured": {
            "medianDepthChange": round(chosen["median"], 5),
            "p95DepthChange": round(chosen["p95"], 5),
            "realRooms": len(real),
            "cpuMsPerImage": round(chosen["ms"]),
        },
        "sha256": sha256(target),
        "bytes": target.stat().st_size,
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    (work / "comparison.json").write_text(
        json.dumps([{k: v for k, v in r.items() if k != "path"} for r in results], indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {target} and manifest.json. Next: pnpm depth-model runtime")


def main() -> None:
    parser = argparse.ArgumentParser(description="Convert Depth Anything V2 metric indoor to ONNX for the browser")
    parser.add_argument("--out", type=Path, default=Path("public/models/depth"))
    parser.add_argument("--dry-run", action="store_true", help="say what would be downloaded, and stop")
    parser.add_argument("--compression", default="auto",
                        choices=["auto", "int8", "int8-per-channel", "int8-matmul-per-channel", "int8-weights-block32", "int4-weights-block32", "fp32"],
                        help="auto (default) keeps the smallest file within the accuracy budget")
    args = parser.parse_args()

    if args.dry_run:
        plan(args.out)
        return
    export(args.out, args.compression)


if __name__ == "__main__":
    main()
