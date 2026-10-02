/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The shop window's engine: one lit room, re-dressed for each theme, drawn only while something moves.
 */

import {
  Box3,
  Color,
  Group,
  MeshBasicMaterial,
  NeutralToneMapping,
  PCFShadowMap,
  PerspectiveCamera,
  Plane,
  PMREMGenerator,
  Raycaster,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  type Material,
  type Object3D,
} from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

import { blendMoods, kelvinToLinearRgb, type Mood } from "@/lib/display/moods";
import { arrangeScene, CEILING_M, frameShot, sceneBounds, type Bounds, type CameraShot, type Placement, type Room, type SceneLayout } from "@/lib/display/scene";
import type { TemplateId } from "@/lib/optimize/templates";

import { createCameraRig, type CameraRig } from "./camera-rig";
import { buildContactShadows, PIECE_LAYER, type ContactShadows } from "./contact-shadows";
import { buildLight, type BuiltLight } from "./light";
import { bulbOf, loadPiece, type EnginePiece, type LoadedPiece } from "./pieces";
import { buildPlinths, buildRoom, type BuiltRoom, type Palette } from "./room";
import { cement, mote, plaster } from "./textures";

export type { EnginePiece } from "./pieces";

/**
 * docs/adr/048.
 *
 * ONE ROOM, RE-DRESSED. The room stays put from theme to theme — the same
 * plaster, the same window — as a real shop window does; only the set and the
 * light change. A new set is arranged by the room grammar
 * (src/lib/display/scene.ts) and moved so its back meets the back wall, a
 * little right of centre so the window's light has room to cross the floor.
 * Its pieces rise into place through the floor, the way a stage lift brings
 * up a set (a clipping plane at the floor hides what is still below it); a
 * pendant comes down from the ceiling; rugs and pictures fade in. The old set
 * sinks first, quicker than the new one rises.
 *
 * DRAWN ONLY WHEN NEEDED. A frame is drawn while the camera or a transition is
 * moving, while dust drifts in the beam, or after something changed — and
 * never while the window is scrolled off screen or the tab is hidden.
 *
 * QUALITY. A tier is chosen from the device (software renderers, phones and
 * small machines get fewer pixels, smaller shadow maps and no dust), and
 * stepped down once if the first second and a half runs slow.
 */

export type EngineDisplay = { key: string; template: TemplateId | null; mood: Mood; pieces: EnginePiece[] };

export type Hotspot = { id: string; left: number; top: number; width: number; height: number; visible: boolean };

export type EngineEvents = {
  progress?: (share: number) => void;
  state?: (state: "loading" | "ready" | "lost") => void;
  hotspots?: (spots: Hotspot[]) => void;
  /** The look-around angles each frame, for the glass's parallax. */
  frame?: (angles: { yaw: number; pitch: number }) => void;
};

export type WindowEngine = {
  canvas: HTMLCanvasElement;
  attach: (surface: HTMLElement, events: EngineEvents) => void;
  detach: () => void;
  show: (display: EngineDisplay) => Promise<void>;
  /** Re-lights the room for another hour, easing from the light it has now. */
  setMood: (mood: Mood) => void;
  focus: (id: string | null) => void;
  /** True when the last pointer press was a drag, so it is not also a click on a piece. */
  dragged: () => boolean;
  setReducedMotion: (reduce: boolean) => void;
  /** For development and tests only: the scene graph, the camera and the transitions in flight. */
  inspect: () => { scene: Scene; camera: PerspectiveCamera; motions: number; dressed: string | null };
  /** For tests and screenshots: finish every move at once and draw the result (a hidden tab draws no frames by itself). */
  settle: () => void;
  dispose: () => void;
};

/** `ambient`: the slow breath of the camera and the dust in the beam, which keep drawing frames while nothing else moves. */
type Tier = { pixelRatio: number; shadowSize: number; contactResolution: number; dust: number; ambient: boolean; textureSize: number };

/** Ambient motion rests after this long without the shopper touching the window, so an open tab does not keep the GPU busy. */
const AMBIENT_FOR_S = 45;

const STAGE: Room = { minX: -3.4, maxX: 3.8, backZ: 0, frontZ: 4.8, height: CEILING_M };
const SET_CENTRE_X = 0.35;
const REACH_Z = 16;

function tierFor(renderer: WebGLRenderer): Tier {
  const ratio = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
  let rendererName = "";
  try {
    const gl = renderer.getContext();
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    if (info !== null) rendererName = String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL));
  } catch {
    // Unknown renderer: judged by the device alone.
  }
  if (/swiftshader|llvmpipe|software|microsoft basic/i.test(rendererName)) return { pixelRatio: 1, shadowSize: 1024, contactResolution: 256, dust: 0, ambient: false, textureSize: 256 };
  const phone = window.matchMedia("(pointer: coarse)").matches;
  const cores = navigator.hardwareConcurrency ?? 4;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  // Phones keep the still room and save their battery; desktops with a real GPU get the drifting dust and the breath.
  if (phone || cores <= 4 || memory <= 4) return { pixelRatio: Math.min(ratio, 1.5), shadowSize: 1024, contactResolution: 256, dust: 0, ambient: false, textureSize: 256 };
  return { pixelRatio: Math.min(ratio, 2), shadowSize: 2048, contactResolution: 512, dust: 420, ambient: true, textureSize: 512 };
}

/** The shop's design tokens, read from the page, so the room is painted in the shop's own colours. */
function palette(): Palette & { dusk: Color } {
  const styles = getComputedStyle(document.documentElement);
  const token = (name: string, fallback: string) => new Color((styles.getPropertyValue(name).trim() || fallback) as string);
  // Fallbacks only matter if the stylesheet has not loaded; they repeat the tokens' values.
  const plinth = token("--color-plinth", "#e4e6e2");
  const dusk = token("--color-dusk", "#1d2330");
  const wall = plinth.clone().lerp(new Color(1, 0.985, 0.96), 0.35);
  const floor = plinth.clone().lerp(dusk, 0.16).lerp(new Color(0.78, 0.74, 0.68), 0.25);
  const trim = plinth.clone().multiplyScalar(0.93);
  const display = plinth.clone().lerp(new Color(1, 1, 1), 0.55);
  return { wall, floor, trim, plinth: display, sky: new Color(1, 1, 1), dusk };
}

const easeOut = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
const easeIn = (t: number) => Math.pow(Math.min(1, Math.max(0, t)), 3);
const easeInOut = (t: number) => {
  const k = Math.min(1, Math.max(0, t));
  return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
};

type Motion = {
  object: Object3D;
  kind: "rise" | "descend" | "fade-in" | "sink" | "ascend" | "fade-out";
  distance: number;
  delay: number;
  duration: number;
  elapsed: number;
  materials: Material[];
  base: number;
  onDone?: () => void;
};

type Dressed = {
  key: string;
  group: Group;
  layout: SceneLayout;
  boxes: Map<string, Box3>;
  shot: CameraShot;
  bounds: Bounds;
  stillLife: { lowestTop: number } | null;
  shadows: ContactShadows;
  dispose: () => void;
  motions: (direction: "in" | "out") => Motion[];
};

export function createWindowEngine(options: { reducedMotion: boolean }): WindowEngine {
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.display = "block";
  canvas.style.width = "100%";
  canvas.style.height = "100%";

  const renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance", alpha: false });
  renderer.outputColorSpace = SRGBColorSpace;
  // Khronos PBR Neutral: keeps a product's colour true under the light, which matters in a shop.
  renderer.toneMapping = NeutralToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  // The floor and the ceiling are trapdoors: what is still below or above them is not drawn. Each plane
  // sits 4 mm beyond its surface, so the floor and the ceiling themselves are never clipped by rounding.
  renderer.clippingPlanes = [new Plane(new Vector3(0, 1, 0), 0.004), new Plane(new Vector3(0, -1, 0), CEILING_M + 0.004)];
  let tier = tierFor(renderer);
  renderer.setPixelRatio(tier.pixelRatio);

  const scene = new Scene();
  const pmrem = new PMREMGenerator(renderer);
  const studio = new RoomEnvironment();
  const environment = pmrem.fromScene(studio, 0.04).texture;
  studio.dispose();
  scene.environment = environment;
  scene.environmentIntensity = 0.32;
  pmrem.dispose();

  const camera = new PerspectiveCamera(35, 16 / 9, 0.1, 60);
  const colours = palette();
  // Drawn on the main thread at load: smaller on phones and software renderers, where it would hold up the page.
  const surfaces = { plaster: plaster(tier.textureSize), cement: cement(tier.textureSize) };
  const room: BuiltRoom = buildRoom(STAGE, colours, surfaces, REACH_Z);
  scene.add(room.group);
  const moteTexture = mote();
  const light: BuiltLight = buildLight(room.window, { shadowSize: tier.shadowSize, dust: options.reducedMotion ? 0 : tier.dust, moteTexture });
  scene.add(light.group);

  // Shaders are compiled in parallel, off the page's thread (KHR_parallel_shader_compile), before anything is
  // drawn with them. Compiled on first draw instead, they held the page up for seconds on a phone (Lighthouse
  // on the live Showcase, 2026-10-02: 3.2 s of 4.7 s blocked waiting for shader links). One empty draw comes
  // first, because three.js counts the floor and ceiling clipping planes only when it draws; it clears to the
  // shopfront's dusk, which the canvas shows until the room is ready.
  renderer.setClearColor(colours.dusk);
  renderer.render(new Scene(), camera);
  let roomReady = false;
  const roomCompiled = renderer.compileAsync(scene, camera).then(() => {
    roomReady = true;
    invalidate();
  });

  let reduced = options.reducedMotion;
  const rig: CameraRig = createCameraRig(camera, frameShot({ min: { x: -1, y: 0, z: 0 }, max: { x: 1.6, y: 1.2, z: 1.2 } }, 16 / 9));
  let dressed: Dressed | null = null;
  let leaving: Dressed[] = [];
  let motions: Motion[] = [];
  let mood: Mood | null = null;
  let moodFrom: Mood | null = null;
  let moodTo: Mood | null = null;
  let moodElapsed = 0;
  let focused: string | null = null;
  let firstShow = true;
  let showToken = 0;

  let surface: HTMLElement | null = null;
  let events: EngineEvents = {};
  let visible = true;
  let frameId = 0;
  let running = false;
  let last = 0;
  let elapsed = 0;
  let wasDrag = false;
  let slowFrames = 0;
  let sampledFrames = 0;
  let steppedDown = false;
  const cleanups: (() => void)[] = [];

  function applyMood(next: Mood) {
    mood = next;
    light.apply(next);
    renderer.toneMappingExposure = next.exposure;
    for (const material of room.materials.walls) material.color.copy(colours.wall).multiplyScalar(next.wall);
    const sky = kelvinToLinearRgb(next.ambient.kelvin);
    room.materials.sky.color.setRGB(sky.r, sky.g, sky.b).multiplyScalar(1.4 + next.beam * 1.2);
    scene.environmentIntensity = 0.38 + next.ambient.intensity * 0.3;
  }

  function size(): { width: number; height: number } {
    const rect = (surface ?? canvas).getBoundingClientRect();
    return { width: Math.max(1, Math.round(rect.width)), height: Math.max(1, Math.round(rect.height)) };
  }

  function aspect(): number {
    const { width, height } = size();
    return width / height;
  }

  /**
   * The set's shot: its box, widened a little towards the window so the light's source is part of the picture.
   * A still life — everything on plinths, nothing on the floor — is framed from just below the plinth tops,
   * so a vase is not lost above a metre of plinth.
   */
  function setShot(bounds: Bounds, stillLife: { lowestTop: number } | null = null): CameraShot {
    const floor = stillLife === null ? bounds.min.y : Math.max(bounds.min.y, stillLife.lowestTop - 0.32);
    const widened: Bounds = {
      min: { ...bounds.min, x: bounds.min.x - (bounds.max.x - bounds.min.x) * 0.12, y: floor },
      max: { ...bounds.max, y: Math.max(bounds.max.y, stillLife === null ? 1.3 : bounds.max.y) },
    };
    // A slightly long lens (30°, about a 45 mm on a full-frame camera) and a low eye: how interiors are photographed.
    return frameShot(widened, aspect(), { margin: 0.1, elevationDeg: 6, fovDeg: 30 });
  }

  /** A piece's close-up, moved aside so the placard beside it (or the sheet below it, on a phone) does not cover it. */
  function pieceShot(box: Box3): CameraShot {
    const ratio = aspect();
    const wide = ratio > 1.1;
    const bounds: Bounds = { min: { x: box.min.x, y: box.min.y, z: box.min.z }, max: { x: box.max.x, y: box.max.y, z: box.max.z } };
    const side = (box.min.x + box.max.x) / 2 < SET_CENTRE_X ? -1 : 1;
    const shot = frameShot(bounds, ratio, { margin: wide ? 0.34 : 0.3, elevationDeg: 11, azimuthDeg: 14 * side, fovDeg: 30 });
    const eye = new Vector3(shot.position.x, shot.position.y, shot.position.z);
    const target = new Vector3(shot.target.x, shot.target.y, shot.target.z);
    const forward = target.clone().sub(eye).normalize();
    const right = forward.clone().cross(new Vector3(0, 1, 0)).normalize();
    const up = right.clone().cross(forward).normalize();
    const distance = eye.distanceTo(target);
    const halfHeight = distance * Math.tan((shot.fovDeg * Math.PI) / 360);
    const shift = wide ? right.multiplyScalar(halfHeight * ratio * 0.3) : up.multiplyScalar(-halfHeight * 0.55);
    eye.add(shift);
    target.add(shift);
    return { position: { x: eye.x, y: eye.y, z: eye.z }, target: { x: target.x, y: target.y, z: target.z }, fovDeg: shot.fovDeg };
  }

  function emitHotspots() {
    if (events.hotspots === undefined || dressed === null) return;
    const { width, height } = size();
    const spots: Hotspot[] = [];
    const corner = new Vector3();
    for (const [id, box] of dressed.boxes) {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      let behind = false;
      for (let index = 0; index < 8; index += 1) {
        corner.set(index & 1 ? box.max.x : box.min.x, index & 2 ? box.max.y : box.min.y, index & 4 ? box.max.z : box.min.z);
        corner.project(camera);
        if (corner.z > 1) behind = true;
        minX = Math.min(minX, corner.x);
        maxX = Math.max(maxX, corner.x);
        minY = Math.min(minY, corner.y);
        maxY = Math.max(maxY, corner.y);
      }
      const left = ((minX + 1) / 2) * width;
      const right = ((maxX + 1) / 2) * width;
      const top = ((1 - maxY) / 2) * height;
      const bottom = ((1 - minY) / 2) * height;
      spots.push({ id, left, top, width: right - left, height: bottom - top, visible: !behind && right > 0 && left < width && bottom > 0 && top < height });
    }
    events.hotspots(spots);
  }

  function render() {
    // Until the room's shaders are ready the canvas keeps its dusk colour; a frame drawn now would compile them on the spot.
    if (roomReady) renderer.render(scene, camera);
  }

  function frame(now: number) {
    const dt = last === 0 ? 1 / 60 : Math.min(0.1, (now - last) / 1000);
    last = now;
    const { busy, dust } = step(dt);

    // One step down in quality if the first second and a half runs slow.
    if (!steppedDown && sampledFrames < 90) {
      sampledFrames += 1;
      if (dt > 0.026) slowFrames += 1;
      if (sampledFrames === 90 && slowFrames > 45) stepDown();
    }

    if ((busy || dust) && visible) frameId = requestAnimationFrame(frame);
    else {
      running = false;
      last = 0;
    }
  }

  /** Advances everything by dt seconds and draws one frame. */
  function step(dt: number): { busy: boolean; dust: boolean } {
    elapsed += dt;
    const ambient = tier.ambient && !reduced && rig.idleFor() < AMBIENT_FOR_S;
    rig.setAmbient(ambient);
    let busy = rig.update(dt, elapsed);

    // Mood ease.
    if (moodFrom !== null && moodTo !== null) {
      moodElapsed += dt;
      const t = reduced ? 1 : moodElapsed / 1.4;
      applyMood(blendMoods(moodFrom, moodTo, easeInOut(t)));
      if (t >= 1) {
        moodFrom = null;
        moodTo = null;
      } else busy = true;
    }

    // Set transitions.
    if (motions.length > 0) {
      busy = true;
      motions = motions.filter((motion) => {
        motion.elapsed += dt;
        const t = (motion.elapsed - motion.delay) / motion.duration;
        if (t < 0) return true;
        const k = motion.kind === "sink" || motion.kind === "ascend" || motion.kind === "fade-out" ? easeIn(t) : easeOut(t);
        if (motion.kind === "rise") motion.object.position.y = motion.base - motion.distance * (1 - k);
        else if (motion.kind === "descend") motion.object.position.y = motion.base + motion.distance * (1 - k);
        else if (motion.kind === "sink") motion.object.position.y = motion.base - motion.distance * k;
        else if (motion.kind === "ascend") motion.object.position.y = motion.base + motion.distance * k;
        for (const material of motion.materials) {
          const opacity = motion.kind === "fade-in" || motion.kind === "rise" || motion.kind === "descend" ? k : 1 - k;
          (material as Material & { opacity: number }).opacity = opacity * ((material.userData.opacity as number | undefined) ?? 1);
        }
        if (t >= 1) {
          motion.onDone?.();
          return false;
        }
        return true;
      });
    }

    const dust = ambient && tier.dust > 0 && (mood?.beam ?? 0) > 0.05;
    light.showDust(dust);
    if (dust) light.tick(elapsed);
    render();
    emitHotspots();
    events.frame?.(rig.angles());
    return { busy, dust };
  }

  function invalidate() {
    if (running || !visible || surface === null) return;
    running = true;
    last = 0;
    frameId = requestAnimationFrame(frame);
  }

  function stepDown() {
    steppedDown = true;
    tier = { ...tier, pixelRatio: Math.max(1, tier.pixelRatio - 0.5), shadowSize: 1024, dust: 0, ambient: false };
    renderer.setPixelRatio(tier.pixelRatio);
    resize();
  }

  function resize() {
    const { width, height } = size();
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    if (dressed !== null) {
      const box = focused === null ? null : (dressed.boxes.get(focused) ?? null);
      dressed.shot = setShot(dressed.bounds, dressed.stillLife);
      rig.goTo(box === null ? dressed.shot : pieceShot(box), { pace: "glide" });
    }
    invalidate();
  }

  async function dress(display: EngineDisplay, token: number): Promise<Dressed | null> {
    const shares = display.pieces.map(() => 0);
    const report = () => events.progress?.(shares.reduce((sum, share) => sum + share, 0) / Math.max(1, shares.length));
    const results = await Promise.all(
      display.pieces.map((piece, index) =>
        loadPiece(piece, (got, total) => {
          shares[index] = total > 0 ? Math.min(0.98, got / total) : 0.5;
          report();
        }).then((result) => {
          shares[index] = 1;
          report();
          return result;
        }),
      ),
    );
    if (token !== showToken) return null;
    // A piece with nothing fit to draw it from (no scan, no studio photograph) stays out of the room; the list below names it.
    const loaded = results.filter((entry): entry is LoadedPiece => entry !== null);

    const byId = new Map<string, LoadedPiece>(loaded.map((entry) => [entry.piece.id, entry]));
    const arranged = arrangeScene(
      display.template,
      loaded.map((entry) => ({ id: entry.piece.id, role: entry.piece.role, kind: entry.piece.kind, quantity: entry.piece.quantity, size: entry.size, form: entry.form, hangs: entry.hangs })),
    );
    // Back against the back wall, a little right of centre.
    const dx = SET_CENTRE_X - (arranged.bounds.min.x + arranged.bounds.max.x) / 2;
    const dz = STAGE.backZ - arranged.room.backZ;
    const move = (point: { x: number; y: number; z: number }) => ({ x: point.x + dx, y: point.y, z: point.z + dz });
    const layout: SceneLayout = {
      placements: arranged.placements.map((entry) => ({ ...entry, position: move(entry.position) })),
      plinths: arranged.plinths.map((entry) => ({ ...entry, position: move(entry.position) })),
      room: STAGE,
      bounds: { min: move(arranged.bounds.min), max: move(arranged.bounds.max) },
    };

    const group = new Group();
    group.name = `set:${display.key}`;
    const plinths = buildPlinths(layout.plinths, colours.plinth);
    group.add(plinths.group);
    for (const mesh of plinths.meshes.values()) mesh.layers.enable(PIECE_LAYER);
    const holders = new Map<string, { holder: Group; placement: Placement; loaded: LoadedPiece }>();
    for (const placement of layout.placements) {
      const entry = byId.get(placement.id);
      if (entry === undefined) continue;
      const holder = entry.make();
      holder.position.set(placement.position.x, placement.position.y, placement.position.z);
      holder.rotation.order = "YXZ";
      holder.rotation.y = placement.rotationY;
      holder.rotation.x = placement.tiltX;
      group.add(holder);
      holders.set(placement.key, { holder, placement, loaded: entry });
    }
    group.updateMatrixWorld(true);

    // Pieces on pieces are set down on the support's real surface: a ray straight down at their spot.
    const ray = new Raycaster();
    for (const { holder, placement } of holders.values()) {
      if (placement.support === null || placement.support.startsWith("plinth:")) continue;
      const support = holders.get(placement.support);
      if (support === undefined) continue;
      ray.set(new Vector3(placement.position.x, CEILING_M, placement.position.z), new Vector3(0, -1, 0));
      const hit = ray.intersectObject(support.holder, true)[0];
      if (hit !== undefined) holder.position.y = hit.point.y - 0.005;
    }
    group.updateMatrixWorld(true);

    // Each piece's box (its first copy), for the hotspots and the close-up.
    const boxes = new Map<string, Box3>();
    for (const { holder, placement } of holders.values()) {
      if (placement.copy !== 0) continue;
      boxes.set(placement.id, new Box3().setFromObject(holder));
    }
    // Lamps, lit by the mood.
    const bulbs: Vector3[] = [];
    for (const { holder, loaded: entry } of holders.values()) {
      const bulb = bulbOf(entry, holder.position);
      if (bulb !== null) bulbs.push(bulb);
    }

    // The contact shadows, drawn once, with everything in its final place.
    const margin = 0.9;
    const shadows = buildContactShadows(
      {
        centreX: (layout.bounds.min.x + layout.bounds.max.x) / 2,
        centreZ: (layout.bounds.min.z + layout.bounds.max.z) / 2,
        width: layout.bounds.max.x - layout.bounds.min.x + 2 * margin,
        depth: layout.bounds.max.z - layout.bounds.min.z + 2 * margin,
      },
      { resolution: tier.contactResolution, opacity: 0.72, blur: 2.6, reach: 1.2 },
    );
    group.add(shadows.plane);

    // The set's shaders are compiled before it is drawn, as the room's are (above); the room, and the set
    // before this one, go on drawing meanwhile. Nothing is awaited after the set joins the scene, so no frame
    // can show it before show() has set its first positions.
    await Promise.all([roomCompiled, renderer.compileAsync(group, camera, scene), shadows.warm(renderer, scene)]);
    if (token !== showToken) {
      plinths.dispose();
      shadows.dispose();
      return null;
    }
    light.setLamps(bulbs);
    scene.add(group);
    const hiddenSets = leaving.map((set) => set.group).concat(dressed === null ? [] : [dressed.group]);
    for (const other of hiddenSets) other.visible = false;
    shadows.update(renderer, scene);
    for (const other of hiddenSets) other.visible = true;
    const shadowMaterial = shadows.plane.material as MeshBasicMaterial;
    shadowMaterial.userData.opacity = shadowMaterial.opacity;

    // The shot frames what stands; a rug may run out of the picture, as rugs do in any room photograph, and of a
    // pendant only its shade counts — its cord may rise out of the top of the frame.
    const bounds = sceneBounds(
      layout.placements
        .filter((entry) => entry.form !== "rug")
        .map((entry) => (entry.hangs ? { ...entry, position: { ...entry.position, y: entry.position.y - entry.size.y + Math.min(entry.size.y, 0.45) }, size: { ...entry.size, y: Math.min(entry.size.y, 0.45) } } : entry)),
      layout.plinths,
    );
    const standing = layout.placements.filter((entry) => entry.form === "scan" || entry.form === "photo");
    const stillLife = standing.length > 0 && standing.every((entry) => entry.support !== null) && layout.plinths.length > 0 ? { lowestTop: Math.min(...layout.plinths.map((plinth) => plinth.size.y)) } : null;
    return {
      key: display.key,
      group,
      layout,
      boxes,
      bounds,
      stillLife,
      shot: setShot(bounds, stillLife),
      shadows,
      dispose: () => {
        scene.remove(group);
        plinths.dispose();
        shadows.dispose();
      },
      motions: (direction) => {
        // Units move as one: a plinth with what stands on it, a bed with its pillows, a side table with its lamp.
        type Unit = { members: Object3D[]; top: number; z: number; x: number; kind: "lift" | "hang" | "fade"; fade: Material[] };
        const units: Unit[] = [];
        const riders = (key: string) => [...holders.values()].filter((entry) => entry.placement.support === key);
        for (const mesh of plinths.meshes.values()) {
          const on = riders(mesh.name);
          units.push({
            members: [mesh, ...on.map((entry) => entry.holder)],
            top: Math.max(mesh.position.y * 2, ...on.map((entry) => entry.holder.position.y + entry.placement.size.y)),
            z: mesh.position.z,
            x: mesh.position.x,
            kind: "lift",
            fade: [],
          });
        }
        for (const entry of holders.values()) {
          const { placement, holder, loaded: piece } = entry;
          if (placement.support !== null) continue;
          if (piece.form === "rug" || piece.form === "wall") {
            for (const material of piece.fadeable) {
              material.transparent = true;
              material.userData.opacity ??= 1;
            }
            units.push({ members: [holder], top: 0, z: placement.position.z, x: placement.position.x, kind: "fade", fade: piece.fadeable });
            continue;
          }
          if (piece.hangs) {
            units.push({ members: [holder], top: placement.size.y, z: placement.position.z, x: placement.position.x, kind: "hang", fade: [] });
            continue;
          }
          const on = riders(placement.key);
          units.push({
            members: [holder, ...on.map((rider) => rider.holder)],
            top: Math.max(placement.size.y, ...on.map((rider) => rider.holder.position.y + rider.placement.size.y)),
            z: placement.position.z,
            x: placement.position.x,
            kind: "lift",
            fade: [],
          });
        }
        // From the back of the set forwards, then left to right: the set assembles towards the viewer.
        units.sort((a, b) => a.z - b.z || a.x - b.x);
        const into = direction === "in";
        const list: Motion[] = [];
        units.forEach((unit, index) => {
          const delay = into ? 0.12 + index * 0.09 : index * 0.025;
          const duration = into ? (unit.kind === "fade" ? 0.9 : 1.0) : 0.42;
          if (unit.kind === "fade") {
            list.push({ object: unit.members[0]!, kind: into ? "fade-in" : "fade-out", distance: 0, delay, duration, elapsed: 0, materials: unit.fade, base: unit.members[0]!.position.y });
            return;
          }
          const distance = unit.top + 0.06;
          for (const member of unit.members) {
            const kind = unit.kind === "hang" ? (into ? "descend" : "ascend") : into ? "rise" : "sink";
            list.push({ object: member, kind, distance, delay, duration, elapsed: 0, materials: [], base: member.position.y });
          }
        });
        list.push({ object: shadows.plane, kind: into ? "fade-in" : "fade-out", distance: 0, delay: into ? 0.45 : 0, duration: into ? 1.1 : 0.3, elapsed: 0, materials: [shadowMaterial], base: shadows.plane.position.y });
        return list;
      },
    };
  }

  async function show(display: EngineDisplay) {
    if (dressed?.key === display.key) return;
    const token = ++showToken;
    events.state?.("loading");
    events.progress?.(0);
    // The light begins to change at once, while the new set loads.
    if (mood === null) applyMood(display.mood);
    else {
      moodFrom = mood;
      moodTo = display.mood;
      moodElapsed = 0;
    }
    invalidate();

    let next: Dressed | null;
    try {
      next = await dress(display, token);
    } catch {
      next = null;
    }
    if (next === null || token !== showToken) return;

    const previous = dressed;
    dressed = next;
    focused = null;
    if (previous !== null) {
      leaving.push(previous);
      if (reduced) {
        previous.dispose();
        leaving = leaving.filter((set) => set !== previous);
      } else {
        const out = previous.motions("out");
        let remaining = out.length;
        for (const motion of out) {
          motion.onDone = () => {
            remaining -= 1;
            if (remaining === 0) {
              previous.dispose();
              leaving = leaving.filter((set) => set !== previous);
            }
          };
        }
        motions.push(...out);
      }
    }
    if (!reduced) {
      const into = next.motions("in");
      // Start below the floor (or above the ceiling) before the first frame draws them.
      for (const motion of into) {
        motion.delay += previous === null ? 0 : 0.32;
        if (motion.kind === "rise") motion.object.position.y = motion.base - motion.distance;
        if (motion.kind === "descend") motion.object.position.y = motion.base + motion.distance;
        for (const material of motion.materials) (material as Material & { opacity: number }).opacity = 0;
      }
      motions.push(...into);
    }
    rig.goTo(next.shot, { intro: firstShow, pace: firstShow ? "settle" : "glide" });
    firstShow = false;
    events.state?.("ready");
    invalidate();
  }

  function bindControls(element: HTMLElement) {
    const pointers = new Map<number, { x: number; y: number }>();
    let pinch = 0;
    let travelled = 0;
    const local = (event: PointerEvent) => {
      const rect = element.getBoundingClientRect();
      return { x: ((event.clientX - rect.left) / rect.width) * 2 - 1, y: ((event.clientY - rect.top) / rect.height) * 2 - 1 };
    };
    const down = (event: PointerEvent) => {
      if (event.button !== 0 && event.pointerType === "mouse") return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      travelled = 0;
      wasDrag = false;
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      }
    };
    const move = (event: PointerEvent) => {
      const previous = pointers.get(event.pointerId);
      if (previous === undefined) {
        if (event.pointerType === "mouse") {
          rig.point(local(event));
          invalidate();
        }
        return;
      }
      const dx = event.clientX - previous.x;
      const dy = event.clientY - previous.y;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const spread = Math.hypot(a!.x - b!.x, a!.y - b!.y);
        if (pinch > 0) rig.zoom(pinch / spread);
        pinch = spread;
        wasDrag = true;
      } else {
        travelled += Math.hypot(dx, dy);
        if (travelled > 6) {
          if (!wasDrag) element.setPointerCapture?.(event.pointerId);
          wasDrag = true;
          rig.drag(dx, dy);
        }
      }
      invalidate();
    };
    const up = (event: PointerEvent) => {
      pointers.delete(event.pointerId);
      if (pointers.size < 2) pinch = 0;
    };
    const leave = () => {
      rig.point(null);
      invalidate();
    };
    const wheel = (event: WheelEvent) => {
      // Only a pinch on a trackpad (which arrives as ctrl + wheel) zooms; an ordinary wheel scrolls the page.
      if (!event.ctrlKey) return;
      event.preventDefault();
      rig.zoom(Math.exp(event.deltaY * 0.004));
      invalidate();
    };
    const twice = () => {
      rig.recentre();
      invalidate();
    };
    element.addEventListener("pointerdown", down);
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerup", up);
    element.addEventListener("pointercancel", up);
    element.addEventListener("pointerleave", leave);
    element.addEventListener("wheel", wheel, { passive: false });
    element.addEventListener("dblclick", twice);
    cleanups.push(() => {
      element.removeEventListener("pointerdown", down);
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", up);
      element.removeEventListener("pointercancel", up);
      element.removeEventListener("pointerleave", leave);
      element.removeEventListener("wheel", wheel);
      element.removeEventListener("dblclick", twice);
    });
  }

  const lost = (event: Event) => {
    event.preventDefault();
    events.state?.("lost");
  };
  canvas.addEventListener("webglcontextlost", lost);

  return {
    canvas,
    attach(element, handlers) {
      surface = element;
      events = handlers;
      bindControls(element);
      const observer = new ResizeObserver(() => resize());
      observer.observe(element);
      const seen = new IntersectionObserver(([entry]) => {
        visible = (entry?.isIntersecting ?? true) && document.visibilityState === "visible";
        invalidate();
      });
      seen.observe(element);
      const visibility = () => {
        visible = document.visibilityState === "visible";
        invalidate();
      };
      document.addEventListener("visibilitychange", visibility);
      cleanups.push(() => {
        observer.disconnect();
        seen.disconnect();
        document.removeEventListener("visibilitychange", visibility);
      });
      resize();
      if (dressed !== null) events.state?.("ready");
    },
    detach() {
      for (const cleanup of cleanups.splice(0)) cleanup();
      cancelAnimationFrame(frameId);
      running = false;
      surface = null;
      events = {};
    },
    show,
    setMood(next) {
      if (mood === null) {
        applyMood(next);
      } else {
        moodFrom = mood;
        moodTo = next;
        moodElapsed = 0;
      }
      invalidate();
    },
    focus(id) {
      focused = id;
      if (dressed === null) return;
      const box = id === null ? null : (dressed.boxes.get(id) ?? null);
      rig.goTo(box === null ? dressed.shot : pieceShot(box), { pace: "glide" });
      invalidate();
    },
    dragged: () => wasDrag,
    inspect: () => ({ scene, camera, motions: motions.length, dressed: dressed?.key ?? null }),
    settle() {
      for (const motion of motions) motion.elapsed = motion.delay + motion.duration;
      moodElapsed = 1.4;
      rig.snap();
      step(1 / 60);
    },
    setReducedMotion(reduce) {
      reduced = reduce;
      rig.setReducedMotion(reduce);
      if (reduce) {
        for (const motion of motions) {
          motion.elapsed = motion.delay + motion.duration;
        }
      }
      invalidate();
    },
    dispose() {
      showToken += 1;
      for (const cleanup of cleanups.splice(0)) cleanup();
      cancelAnimationFrame(frameId);
      canvas.removeEventListener("webglcontextlost", lost);
      dressed?.dispose();
      for (const set of leaving) set.dispose();
      room.dispose();
      light.dispose();
      environment.dispose();
      moteTexture.dispose();
      for (const texture of [surfaces.plaster.map, surfaces.plaster.roughness, surfaces.cement.map, surfaces.cement.roughness]) texture.dispose();
      renderer.dispose();
    },
  };
}
