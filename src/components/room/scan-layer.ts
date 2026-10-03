/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * A piece's real 3D scan drawn into the shopper's room photograph, with the camera recovered from the sheet of paper.
 */

import { Color, DirectionalLight, Group, HemisphereLight, Matrix4, NeutralToneMapping, PerspectiveCamera, Scene, SRGBColorSpace, Vector3, WebGLRenderer, type Texture } from "three";

import { captureRoomEnvironment } from "@/components/display/engine/environment";
import { loadScan } from "@/components/display/engine/pieces";
import { upSign, type Placement, type Pose } from "@/lib/vision/camera";
import { pieceMatrix, projectionFromIntrinsics, viewMatrix } from "@/lib/vision/gl-camera";
import type { LightEstimate } from "@/lib/vision/harmonize";
import type { Mat3 } from "@/lib/vision/linalg";

/**
 * docs/adr/052. Before this, "See it in your room" stood the piece's studio
 * photograph up in the room as a flat cut-out: turning it turned the footprint
 * and the shadow, never the piece (George, 2026-10-03). A piece with its own
 * scan (docs/adr/035) is now drawn as the scan itself:
 *
 * - with the camera the sheet of paper gave (src/lib/vision/gl-camera.ts: the
 *   view and projection matrices that put every point on the pixel the vision
 *   code computes), so it stands at true size and in true perspective;
 * - lit from the photograph: the room's colour and exposure, and a key light
 *   from the side the light falls from where the piece stands
 *   (src/lib/vision/harmonize.ts), over the same RoomEnvironment reflections as
 *   the shop window;
 * - in its own off-screen WebGL canvas the size of the photograph, which the
 *   planner draws over the photograph and its contact shadows, so "Save
 *   picture" keeps it.
 *
 * Its shaders are compiled in parallel before its first draw, as the window's
 * are (docs/adr/048, addendum 2). A pendant, which hangs from a ceiling the
 * photograph does not measure, is not drawn here.
 */

export type ScanLayer = {
  /** The scan's measured size, metres: its true extent, which the planner's box takes over from the listing. */
  size: { width: number; height: number; depth: number };
  draw: (frame: { K: Mat3; pose: Pose; placement: Pick<Placement, "x" | "y" | "rotation">; width: number; height: number; light: LightEstimate | null }) => HTMLCanvasElement;
  dispose: () => void;
};

export async function loadScanLayer(src: string, kind: string): Promise<ScanLayer | null> {
  let scan: Awaited<ReturnType<typeof loadScan>>;
  try {
    scan = await loadScan(src, kind);
  } catch {
    return null;
  }
  if (scan.hangs) return null;

  const canvas = document.createElement("canvas");
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
  } catch {
    return null;
  }
  renderer.outputColorSpace = SRGBColorSpace;
  // Khronos PBR Neutral, as in the window: a piece's colour stays its own.
  renderer.toneMapping = NeutralToneMapping;
  renderer.setPixelRatio(1);
  renderer.setClearColor(0x000000, 0);

  const scene = new Scene();
  scene.environmentIntensity = 0.55;
  const piece = new Group();
  piece.matrixAutoUpdate = false;
  piece.add(scan.scene.clone(true));
  scene.add(piece);

  const sky = new HemisphereLight(0xffffff, 0x8a8178, 0.9);
  const key = new DirectionalLight(0xffffff, 1.6);
  const fill = new DirectionalLight(0xffffff, 0.35);
  scene.add(sky, key, key.target, fill, fill.target);

  const camera = new PerspectiveCamera();
  camera.matrixAutoUpdate = false;

  let environment: Texture | null = null;
  try {
    environment = await captureRoomEnvironment(renderer, camera);
    scene.environment = environment;
    await renderer.compileAsync(scene, camera);
  } catch {
    // Without reflections the piece is still drawn, a little flatter.
  }
  const view = new Matrix4();
  const at = new Vector3();
  const towards = new Vector3();

  return {
    size: { width: scan.size.x, height: scan.size.y, depth: scan.size.z },
    draw({ K, pose, placement, width, height, light }) {
      if (canvas.width !== width || canvas.height !== height) renderer.setSize(width, height, false);
      const up = upSign(pose);

      piece.matrix.fromArray(pieceMatrix(placement, up));
      piece.matrixWorldNeedsUpdate = true;

      // The camera of the photograph: its world matrix is the inverse of the view.
      view.fromArray(viewMatrix(pose));
      camera.matrix.copy(view).invert();
      camera.matrixWorldNeedsUpdate = true;
      camera.projectionMatrix.fromArray(projectionFromIntrinsics(K, width, height));
      camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();

      // The camera's own axes in the room, from the rows of R: right, down, forward.
      const { R } = pose;
      const right = new Vector3(R[0], R[1], R[2]);
      const down = new Vector3(R[3], R[4], R[5]);
      const forward = new Vector3(R[6], R[7], R[8]);
      const upAxis = new Vector3(0, 0, up);
      at.set(placement.x, placement.y, 0);

      // The light comes from the side of the photograph it falls from where the piece stands
      // (towardsLight is that side, in image pixels), from above, and a little from the camera.
      const [tx, ty] = light?.towardsLight ?? [-0.55, -0.35];
      towards
        .copy(right)
        .multiplyScalar(tx)
        .addScaledVector(down, ty)
        .multiplyScalar(0.9)
        .addScaledVector(upAxis, 1.25)
        .addScaledVector(forward, -0.35)
        .normalize();
      key.position.copy(at).addScaledVector(towards, 6);
      key.target.position.copy(at);
      fill.position.copy(at).addScaledVector(forward, -6).addScaledVector(upAxis, 2);
      fill.target.position.copy(at);
      // A hemisphere light's sky is the side its position points to: the room's up.
      sky.position.copy(upAxis);

      const strength = light?.strength ?? 0.4;
      key.intensity = 1.1 + strength * 1.3;
      fill.intensity = 0.45 - strength * 0.2;
      if (light !== null) {
        const [r, g, b] = light.tint;
        const peak = Math.max(r, g, b, 1e-6);
        const tint = new Color(r / peak, g / peak, b / peak);
        key.color.copy(tint);
        sky.color.copy(tint);
        renderer.toneMappingExposure = 0.7 + light.exposure * 0.45;
      } else {
        key.color.set(0xffffff);
        sky.color.set(0xffffff);
        renderer.toneMappingExposure = 1;
      }

      renderer.render(scene, camera);
      return canvas;
    },
    dispose() {
      environment?.dispose();
      // The scan's geometry and materials are shared with every other view of it (pieces.ts), so only the renderer goes.
      renderer.dispose();
    },
  };
}
