/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Soft contact shadows: what makes a piece look set down on the floor rather than pasted onto it.
 */

import {
  Color,
  Mesh,
  MeshBasicMaterial,
  MeshDepthMaterial,
  OrthographicCamera,
  PlaneGeometry,
  ShaderMaterial,
  WebGLRenderTarget,
  type Scene,
  type WebGLRenderer,
} from "three";
import { HorizontalBlurShader } from "three/addons/shaders/HorizontalBlurShader.js";
import { VerticalBlurShader } from "three/addons/shaders/VerticalBlurShader.js";

/**
 * docs/adr/048. The sun's shadow is crisp where the window light falls and
 * absent everywhere else; a real floor is also darker right under and around
 * whatever stands on it, because less of the room's light reaches there. That
 * is ambient occlusion, and this is its cheapest honest form:
 *
 *   1. An orthographic camera lies on the floor looking straight up and draws
 *      every piece as black, more opaque the nearer the floor it is.
 *   2. That picture is blurred twice, horizontally then vertically.
 *   3. It is laid on the floor as a transparent texture.
 *
 * Height becomes softness: a sofa's legs leave tight dark marks, its seat a
 * wide faint pool. It is drawn once per arrangement (nothing in the set moves
 * once placed), so it costs nothing per frame. Pieces are on render layer 1,
 * which is all this camera sees.
 */

export const PIECE_LAYER = 1;

export type ContactShadows = {
  plane: Mesh;
  /** Draws the shadows for what is on the piece layer now. */
  update: (renderer: WebGLRenderer, scene: Scene) => void;
  dispose: () => void;
};

export function buildContactShadows(area: { centreX: number; centreZ: number; width: number; depth: number }, options: { resolution: number; opacity: number; blur: number; reach: number }): ContactShadows {
  const target = new WebGLRenderTarget(options.resolution, options.resolution);
  const blurred = new WebGLRenderTarget(options.resolution, options.resolution);
  target.texture.generateMipmaps = false;
  blurred.texture.generateMipmaps = false;

  // Face up; the picture's u runs along +x and, with the flip below, its v along +z — as the camera underneath sees them.
  const planeGeometry = new PlaneGeometry(area.width, area.depth).rotateX(-Math.PI / 2);
  const planeMaterial = new MeshBasicMaterial({ map: target.texture, transparent: true, opacity: options.opacity, depthWrite: false });
  const plane = new Mesh(planeGeometry, planeMaterial);
  // A hair above the floor, drawn after it.
  plane.position.set(area.centreX, 0.002, area.centreZ);
  plane.scale.z = -1;
  plane.renderOrder = 1;

  const camera = new OrthographicCamera(-area.width / 2, area.width / 2, area.depth / 2, -area.depth / 2, 0, options.reach);
  camera.position.set(area.centreX, 0, area.centreZ);
  camera.rotation.x = Math.PI / 2;
  camera.layers.set(PIECE_LAYER);

  const depthMaterial = new MeshDepthMaterial();
  depthMaterial.depthTest = false;
  depthMaterial.depthWrite = false;
  depthMaterial.onBeforeCompile = (shader) => {
    shader.uniforms.darkness = { value: 1.6 };
    shader.fragmentShader = `uniform float darkness;\n${shader.fragmentShader.replace(
      "gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );",
      "gl_FragColor = vec4( vec3( 0.0 ), ( 1.0 - fragCoordZ ) * darkness );",
    )}`;
  };

  const horizontal = new ShaderMaterial({ ...HorizontalBlurShader, depthTest: false });
  const vertical = new ShaderMaterial({ ...VerticalBlurShader, depthTest: false });
  const quad = new Mesh(new PlaneGeometry(), horizontal);
  quad.layers.set(PIECE_LAYER);
  quad.frustumCulled = false;

  function blur(renderer: WebGLRenderer, amount: number) {
    quad.visible = true;
    quad.material = horizontal;
    horizontal.uniforms.tDiffuse!.value = target.texture;
    horizontal.uniforms.h!.value = amount / 256;
    renderer.setRenderTarget(blurred);
    renderer.render(quad, camera);
    quad.material = vertical;
    vertical.uniforms.tDiffuse!.value = blurred.texture;
    vertical.uniforms.v!.value = amount / 256;
    renderer.setRenderTarget(target);
    renderer.render(quad, camera);
    quad.visible = false;
  }

  return {
    plane,
    update(renderer, scene) {
      const background = scene.background;
      const previousTarget = renderer.getRenderTarget();
      const autoClear = renderer.autoClear;
      const clearColour = renderer.getClearColor(new Color());
      const clearAlpha = renderer.getClearAlpha();
      scene.background = null;
      scene.overrideMaterial = depthMaterial;
      plane.visible = false;
      renderer.autoClear = true;
      renderer.setClearColor(0x000000, 0);
      renderer.setRenderTarget(target);
      renderer.clear();
      renderer.render(scene, camera);
      scene.overrideMaterial = null;
      // The quad renders as its own scene, filling the camera's view.
      quad.position.copy(camera.position);
      quad.rotation.copy(camera.rotation);
      quad.translateZ(-0.01);
      quad.scale.set(area.width, area.depth, 1);
      blur(renderer, options.blur);
      blur(renderer, options.blur * 0.4);
      renderer.setRenderTarget(previousTarget);
      renderer.autoClear = autoClear;
      renderer.setClearColor(clearColour, clearAlpha);
      scene.background = background;
      plane.visible = true;
    },
    dispose() {
      target.dispose();
      blurred.dispose();
      planeGeometry.dispose();
      planeMaterial.dispose();
      depthMaterial.dispose();
      horizontal.dispose();
      vertical.dispose();
      quad.geometry.dispose();
    },
  };
}
