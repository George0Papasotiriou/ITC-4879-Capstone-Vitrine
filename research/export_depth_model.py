"""
Vitrine — AI-native e-shop (ITC 4949 Capstone)
Copyright (c) 2026 George Papasotiriou. All rights reserved.
Author: George Papasotiriou <g.papasotiriou@acg.edu>
Project started: 2026-09-12

Converts the official Depth Anything V2 metric-indoor checkpoint into the quantised ONNX file the browser runs.

WHY THIS EXISTS. The paper-free room mode needs a depth model that runs in the
shopper's browser and answers in metres. transformers.js has no metric Depth
Anything; Apple's DepthPro is 600 MB; and the ready-made ONNX files on the model
hub come from unverified uploaders, which is not something to ship to shoppers.
So the conversion is done here, from the official checkpoint, on George's
machine, and the result is served by the shop itself.

WHAT IT DOWNLOADS (once, only when run):
  - the checkpoint depth-anything/Depth-Anything-V2-Metric-Indoor-Small-hf,
    about 99 MB, Apache-2.0
  - the Python tooling it needs (torch, transformers, onnx, onnxruntime), a few
    hundred megabytes into research/.venv

    uv run --with torch --with transformers --with onnx --with onnxruntime \
      python research/export_depth_model.py --out public/models/depth

  python research/export_depth_model.py --dry-run     # say what would happen, download nothing

The output is public/models/depth/depth-anything-v2-metric-indoor-small.onnx
(int8 weights, roughly 25 MB) plus a manifest the browser reads. Nothing here
touches a shopper's photograph: the model is a file, and it runs on their device.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

MODEL_ID = "depth-anything/Depth-Anything-V2-Metric-Indoor-Small-hf"
# The backbone works in 14-pixel patches: 518 = 37 x 14, the size the model was trained at.
INPUT_SIZE = 518
FILENAME = "depth-anything-v2-metric-indoor-small.onnx"


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
  Tooling      torch, transformers, onnx, onnxruntime (a few hundred MB, into research/.venv)
  Input        {INPUT_SIZE} x {INPUT_SIZE} RGB, ImageNet normalisation
  Output       metric depth in metres, one value per pixel
  Writes       {out / FILENAME} (int8 weights, roughly 25 MB)
               {out / 'manifest.json'}

Nothing was downloaded. To do it:

  uv run --with torch --with transformers --with onnx --with onnxruntime \\
    python research/export_depth_model.py --out {out}
""")


def export(out: Path, quantise: bool) -> None:
    import torch  # imported here so --dry-run needs none of it
    from transformers import AutoModelForDepthEstimation

    out.mkdir(parents=True, exist_ok=True)
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
    example = torch.zeros(1, 3, INPUT_SIZE, INPUT_SIZE)
    with torch.no_grad():
        sample = wrapped(example)
    print(f"Output shape {tuple(sample.shape)}, range {float(sample.min()):.2f}–{float(sample.max()):.2f} m on a blank image")

    raw = out / f"raw-{FILENAME}"
    print(f"Exporting to {raw} …")
    torch.onnx.export(
        wrapped,
        (example,),
        str(raw),
        input_names=["pixel_values"],
        output_names=["predicted_depth"],
        opset_version=17,
        dynamo=False,
    )

    target = out / FILENAME
    if quantise:
        from onnxruntime.quantization import QuantType, quantize_dynamic

        print("Quantising the weights to int8 …")
        # Weights only: the activations stay float, which keeps depth accurate
        # while making the download about a quarter of the size.
        quantize_dynamic(str(raw), str(target), weight_type=QuantType.QUInt8)
        raw.unlink()
    else:
        raw.rename(target)

    manifest = {
        "name": "Depth Anything V2 Metric (indoor, small)",
        "source": MODEL_ID,
        "licence": "Apache-2.0",
        "model": FILENAME,
        "runtime": "ort.min.js",
        "inputSize": INPUT_SIZE,
        "output": "metric_depth",
        "inputName": "pixel_values",
        "outputName": "predicted_depth",
        "providers": ["webgpu", "wasm"],
        "sha256": sha256(target),
        "bytes": target.stat().st_size,
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {target} ({target.stat().st_size / 1_048_576:.1f} MB) and manifest.json")
    print("Now copy the WebAssembly runtime next to it:  pnpm depth-model runtime")


def main() -> None:
    parser = argparse.ArgumentParser(description="Convert Depth Anything V2 metric indoor to ONNX for the browser")
    parser.add_argument("--out", type=Path, default=Path("public/models/depth"))
    parser.add_argument("--dry-run", action="store_true", help="say what would be downloaded, and stop")
    parser.add_argument("--no-quantise", action="store_true", help="keep float32 weights (about 99 MB)")
    args = parser.parse_args()

    if args.dry_run:
        plan(args.out)
        return
    export(args.out, quantise=not args.no_quantise)


if __name__ == "__main__":
    main()
