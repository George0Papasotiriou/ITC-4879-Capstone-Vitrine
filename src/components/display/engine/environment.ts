/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * A room's reflected light for a three.js scene, captured without holding up the page.
 */

import { BufferGeometry, Group, Mesh, PMREMGenerator, type Camera, type Material, type Texture, type WebGLRenderer, type WebGLRenderTarget } from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

/**
 * docs/adr/048 (addendum 2), docs/adr/052. The shop window and the room
 * planner both light their scans with three's RoomEnvironment, captured by its
 * PMREM generator. three.js offers no asynchronous capture, and its shaders are
 * the heaviest either page has (the GGX convolution alone held a phone-speed
 * page for 1.2 s on Windows' Direct3D, 2026-10-02). They exist as soon as the
 * generator has sized its targets, so they are compiled in parallel first
 * (KHR_parallel_shader_compile), with the RoomEnvironment's own materials and
 * with a render target current, as the capture draws them; the capture then
 * only draws. This reaches into the generator's internals (three 0.183.2,
 * pinned), so if they ever change it captures as before.
 */
export async function captureRoomEnvironment(renderer: WebGLRenderer, camera: Camera, sigma = 0.04): Promise<Texture> {
  const pmrem = new PMREMGenerator(renderer);
  const studio = new RoomEnvironment();
  const internals = pmrem as unknown as {
    _setSize?: (size: number) => void;
    _allocateTargets?: () => WebGLRenderTarget;
    _blurMaterial?: Material | null;
    _ggxMaterial?: Material | null;
  };
  if (typeof internals._setSize === "function" && typeof internals._allocateTargets === "function") {
    internals._setSize(256);
    const probe = internals._allocateTargets.call(pmrem);
    const shaders = new Group();
    for (const material of [internals._blurMaterial, internals._ggxMaterial]) if (material != null) shaders.add(new Mesh(new BufferGeometry(), material));
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(probe);
    const compiled = Promise.all([renderer.compileAsync(shaders, camera), renderer.compileAsync(studio, camera)]);
    renderer.setRenderTarget(previous);
    await compiled;
    probe.dispose();
    for (const mesh of shaders.children) (mesh as Mesh).geometry.dispose();
  }
  const texture = pmrem.fromScene(studio, sigma).texture;
  studio.dispose();
  pmrem.dispose();
  return texture;
}
