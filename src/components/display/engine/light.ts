/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The window's light: the sun through the arch, the sky's fill, lamps lit at dusk, and the sunbeam with dust drifting in it.
 */

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  HemisphereLight,
  Mesh,
  Object3D,
  PointLight,
  Points,
  ShaderMaterial,
  SpotLight,
  Sprite,
  SpriteMaterial,
  Vector3,
  type Texture,
} from "three";

import { kelvinToLinearRgb, sunDirection, type Mood } from "@/lib/display/moods";

/**
 * docs/adr/048.
 *
 * THE SUN is a spot light six metres outside the window, aimed through it. Its
 * colour comes from the mood's colour temperature (src/lib/display/moods.ts),
 * its shadow softness from the mood (a PCF filter radius: overcast light is
 * soft, a low winter sun is crisp). The window's own wall shapes the light.
 *
 * THE SKY'S FILL is a hemisphere light: cool from above, a warm bounce from the
 * floor, both from the mood. The image-based environment (set by the engine)
 * adds the soft reflections that make materials read as materials.
 *
 * THE BEAM is the one flourish: light made visible in the air, as it is in a
 * real room with a little dust. It is the window's arch swept along the sun's
 * direction into a prism, drawn with additive blending, fading along its
 * length and wherever it is seen edge-on, so it reads as a volume, not a solid.
 * Dust motes drift slowly inside it. With reduced motion the dust stands still.
 */

const BEAM_LENGTH = 4.2;

export type BuiltLight = {
  group: Group;
  sun: SpotLight;
  apply: (mood: Mood) => void;
  /** Lamps in the set, lit by the mood: one warm light per lamp, at its shade. */
  setLamps: (positions: Vector3[]) => void;
  tick: (seconds: number) => void;
  /** Dust only drifts where motion is welcome and the device can afford it. */
  showDust: (show: boolean) => void;
  dispose: () => void;
};

const colourOf = (kelvin: number) => {
  const { r, g, b } = kelvinToLinearRgb(kelvin);
  return new Color().setRGB(r, g, b);
};

export function buildLight(windowAt: { x: number; z: number; outline: { z: number; y: number }[] }, options: { shadowSize: number; dust: number; moteTexture: Texture }): BuiltLight {
  const group = new Group();
  group.name = "light";
  const centre = new Vector3(windowAt.x, 1.6, windowAt.z);

  const sun = new SpotLight(0xffffff, 1, 0, 0.42, 0.35, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(options.shadowSize, options.shadowSize);
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.025;
  sun.shadow.camera.near = 2;
  sun.shadow.camera.far = 18;
  const sunTarget = new Object3D();
  sun.target = sunTarget;
  group.add(sun, sunTarget);

  const sky = new HemisphereLight(0xffffff, 0xffffff, 1);
  group.add(sky);

  // The beam: the window's outline at the wall, swept into the room along the sun.
  const outline = windowAt.outline.map((point) => new Vector3(windowAt.x, point.y, point.z));
  const beamGeometry = new BufferGeometry();
  const beamMaterial = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
    uniforms: { uColour: { value: new Color() }, uStrength: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute float along;
      varying float vAlong;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        vAlong = along;
        vec4 world = modelMatrix * vec4(position, 1.0);
        vNormal = normalize(mat3(modelMatrix) * normal);
        vView = normalize(cameraPosition - world.xyz);
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColour;
      uniform float uStrength;
      varying float vAlong;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        // Faces seen square-on are where the light is thickest; edge-on, it thins to nothing.
        float facing = pow(abs(dot(normalize(vNormal), normalize(vView))), 1.6);
        float fall = pow(1.0 - clamp(vAlong, 0.0, 1.0), 1.7) * smoothstep(0.0, 0.06, vAlong);
        gl_FragColor = vec4(uColour * uStrength * facing * fall, 1.0);
      }
    `,
  });
  const beam = new Mesh(beamGeometry, beamMaterial);
  beam.frustumCulled = false;
  beam.renderOrder = 2;
  group.add(beam);

  // Dust: points scattered inside the prism, each with its own drift.
  const dustCount = options.dust;
  const dustGeometry = new BufferGeometry();
  const dustMaterial = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uColour: { value: new Color() }, uStrength: { value: 0 }, uSprite: { value: options.moteTexture }, uScale: { value: 1 } },
    vertexShader: /* glsl */ `
      attribute float seed;
      attribute float along;
      uniform float uTime;
      uniform float uScale;
      varying float vFade;
      void main() {
        vec3 drift = vec3(sin(uTime * 0.11 + seed * 6.28), sin(uTime * 0.07 + seed * 11.0) * 0.6, cos(uTime * 0.09 + seed * 4.0)) * 0.05;
        vec4 view = viewMatrix * modelMatrix * vec4(position + drift, 1.0);
        gl_Position = projectionMatrix * view;
        gl_PointSize = uScale * (1.4 + fract(seed * 7.13) * 2.2) * (6.0 / -view.z);
        float twinkle = 0.55 + 0.45 * sin(uTime * (0.6 + seed) + seed * 40.0);
        vFade = twinkle * pow(1.0 - along, 1.4);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uSprite;
      uniform vec3 uColour;
      uniform float uStrength;
      varying float vFade;
      void main() {
        float a = texture2D(uSprite, gl_PointCoord).a;
        gl_FragColor = vec4(uColour * uStrength * vFade * a, 1.0);
      }
    `,
  });
  const dust = new Points(dustGeometry, dustMaterial);
  dust.frustumCulled = false;
  if (dustCount > 0) group.add(dust);

  let lamps: PointLight[] = [];
  // A lit lamp's glow: a soft warm halo at the bulb, seen through the shade as light through fabric.
  let glows: Sprite[] = [];
  const glowMaterial = new SpriteMaterial({ map: options.moteTexture, blending: AdditiveBlending, depthWrite: false, depthTest: false, transparent: true, opacity: 0 });
  const lampGroup = new Group();
  group.add(lampGroup);
  let mood: Mood | null = null;

  function sweep(direction: Vector3) {
    // The prism's two caps: the outline at the wall, and the same outline BEAM_LENGTH along the sun.
    const far = outline.map((point) => point.clone().addScaledVector(direction, BEAM_LENGTH));
    const positions: number[] = [];
    const along: number[] = [];
    for (let index = 0; index < outline.length; index += 1) {
      const a = outline[index]!;
      const b = outline[(index + 1) % outline.length]!;
      const c = far[(index + 1) % outline.length]!;
      const d = far[index]!;
      positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, a.x, a.y, a.z, c.x, c.y, c.z, d.x, d.y, d.z);
      along.push(0, 0, 1, 0, 1, 1);
    }
    beamGeometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
    beamGeometry.setAttribute("along", new BufferAttribute(new Float32Array(along), 1));
    beamGeometry.computeVertexNormals();
    beamGeometry.computeBoundingSphere();

    if (dustCount > 0) {
      // Scatter inside the arch (rejection sampling in its bounding box), then along the sun.
      let state = 97;
      const random = () => {
        state = (state * 16_807) % 2_147_483_647;
        return state / 2_147_483_647;
      };
      const zs = outline.map((point) => point.z);
      const ys = outline.map((point) => point.y);
      const minZ = Math.min(...zs);
      const maxZ = Math.max(...zs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      const inside = (z: number, y: number) => {
        let crossings = 0;
        for (let index = 0; index < outline.length; index += 1) {
          const p = outline[index]!;
          const q = outline[(index + 1) % outline.length]!;
          if (p.y > y !== q.y > y && z < ((q.z - p.z) * (y - p.y)) / (q.y - p.y) + p.z) crossings += 1;
        }
        return crossings % 2 === 1;
      };
      const points = new Float32Array(dustCount * 3);
      const seeds = new Float32Array(dustCount);
      const alongs = new Float32Array(dustCount);
      for (let index = 0; index < dustCount; index += 1) {
        let z = 0;
        let y = 0;
        do {
          z = minZ + random() * (maxZ - minZ);
          y = minY + random() * (maxY - minY);
        } while (!inside(z, y));
        const t = Math.pow(random(), 0.8) * 0.85;
        const p = new Vector3(windowAt.x, y, z).addScaledVector(direction, t * BEAM_LENGTH);
        points.set([p.x, p.y, p.z], index * 3);
        seeds[index] = random();
        alongs[index] = t;
      }
      dustGeometry.setAttribute("position", new BufferAttribute(points, 3));
      dustGeometry.setAttribute("seed", new BufferAttribute(seeds, 1));
      dustGeometry.setAttribute("along", new BufferAttribute(alongs, 1));
    }
  }

  let swept: string | null = null;

  function apply(next: Mood) {
    mood = next;
    const d = sunDirection(next);
    const direction = new Vector3(d.x, d.y, d.z);
    const sunColour = colourOf(next.sun.kelvin);
    sun.color.copy(sunColour);
    // The sun's power through a window, tuned so a clear afternoon reads like one under neutral tone mapping.
    sun.intensity = next.sun.intensity * 4.2;
    sun.position.copy(centre).addScaledVector(direction, -6);
    sunTarget.position.copy(centre).addScaledVector(direction, 3);
    // r183's PCF filter takes five samples turned per pixel; a small radius keeps the edge smooth rather than grainy.
    sun.shadow.radius = 1.2 + next.sun.softness * 2.2;

    // The sky's cool light from above; from below, the warm light the sunlit floor throws back up.
    sky.color.copy(colourOf(next.ambient.kelvin)).lerp(colourOf(next.sun.kelvin), 0.25);
    sky.groundColor.copy(colourOf(next.sun.kelvin)).multiplyScalar(0.85);
    sky.intensity = 0.5 + next.ambient.intensity * 1.9;

    beamMaterial.uniforms.uColour!.value.copy(sunColour);
    beamMaterial.uniforms.uStrength!.value = next.beam * 0.075;
    dustMaterial.uniforms.uColour!.value.copy(sunColour);
    dustMaterial.uniforms.uStrength!.value = next.beam * 0.9;

    // Rebuild the prism only when the sun has really moved.
    const key = `${d.x.toFixed(3)},${d.y.toFixed(3)},${d.z.toFixed(3)}`;
    if (key !== swept) {
      sweep(direction);
      swept = key;
    }
    for (const lamp of lamps) {
      lamp.color.copy(colourOf(next.lamps?.kelvin ?? 2700));
      lamp.intensity = (next.lamps?.intensity ?? 0) * 2.4;
      lamp.visible = lamp.intensity > 0.01;
    }
    glowMaterial.color.copy(colourOf(next.lamps?.kelvin ?? 2700));
    glowMaterial.opacity = Math.min(0.85, (next.lamps?.intensity ?? 0) * 0.6);
    for (const glow of glows) glow.visible = glowMaterial.opacity > 0.02;
  }

  return {
    group,
    sun,
    apply,
    setLamps(positions) {
      for (const lamp of lamps) {
        lampGroup.remove(lamp);
        lamp.dispose();
      }
      for (const glow of glows) lampGroup.remove(glow);
      lamps = positions.map((position) => {
        const lamp = new PointLight(0xffffff, 0, 4.5, 2);
        lamp.position.copy(position);
        lampGroup.add(lamp);
        return lamp;
      });
      glows = positions.map((position) => {
        const glow = new Sprite(glowMaterial);
        glow.position.copy(position);
        glow.scale.setScalar(0.42);
        glow.renderOrder = 3;
        lampGroup.add(glow);
        return glow;
      });
      if (mood !== null) apply(mood);
    },
    tick(seconds) {
      dustMaterial.uniforms.uTime!.value = seconds;
    },
    showDust(show) {
      dust.visible = show && dustCount > 0;
    },
    dispose() {
      beamGeometry.dispose();
      beamMaterial.dispose();
      dustGeometry.dispose();
      dustMaterial.dispose();
      glowMaterial.dispose();
      sun.shadow.map?.dispose();
      for (const lamp of lamps) lamp.dispose();
    },
  };
}
