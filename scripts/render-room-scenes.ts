/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * E4's rendered rooms: real ABO scans of known size, photographed by a virtual phone, so the truth is exact.
 */

/**
 * docs/adr/036 (addendum).
 *
 *   pnpm e4:render [--per-category 4] [--seed 4949] [--out .local/e4-render]
 *
 * The web-photo proxy (evaluate-room-web.ts) has hand marks, manufacturers'
 * heights and product photographers' low, level cameras. This tier removes
 * all three: each of the catalogue's compressed 3D scans (`pnpm catalog
 * models`) is stood on a plank floor in front of a wall and photographed by a
 * virtual camera held like a phone — 1.25 to 1.55 m up, tilted towards the
 * piece, a 69° lens, 1600 × 1200. The piece's height is its scan's height,
 * and the marks are where the camera projects the foot and the top of the
 * piece's vertical axis, computed, not clicked. What is left to measure is
 * exactly the method's own part: the depth model, the floor it finds and the
 * size that follows.
 *
 * Rendered with three.js (the copy model-viewer already installs) in
 * headless Chromium through Playwright, each scene from a seed. Writes the
 * images and a manifest to .local/e4-render (never committed); `pnpm
 * evals:room-rendered` measures them.
 *
 * A rendered room is easier than a photograph in some ways (clean geometry, no
 * clutter) and harder in others (the depth model was trained on photographs
 * and on Hypersim, whose renders look different); the report says so.
 */

import { createReadStream, existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { chromium } from "@playwright/test";
import sharp from "sharp";

import { catalogFixtureSchema } from "@/lib/catalog/input";
import { modelKey } from "@/lib/catalog/model-compress";
import { seededRandom } from "@/lib/reco/simulate";

export const RENDER_DIR = path.join(".local", "e4-render");
export const RENDER_MANIFEST = path.join(RENDER_DIR, "manifest.json");
/** Another set of rooms (`--out`), such as E4-H's development rooms, keeps its manifest beside its images. */
export const manifestIn = (dir: string) => path.join(dir, "manifest.json");
const SCANS = path.join(".local", "storage");
const WIDTH = 1600;
const HEIGHT = 1200;
/** The lens the room page assumes without EXIF, used here so the lens guess is right and only depth is tested. */
export const RENDER_FOV = 69;

export type RenderedScene = {
  file: string;
  sourceId: string;
  piece: string;
  category: string;
  heightCm: number;
  base: [number, number];
  top: [number, number];
  width: number;
  height: number;
  fovDegrees: number;
  cameraHeightM: number;
  distanceM: number;
  /** The renderer's exact depth (Float32, little-endian, row by row), for the control run. */
  exactDepth: { file: string; width: number; height: number };
  /** E4-H's images (docs/adr/042): in the room, the room alone, the studio photograph, the outline. */
  harmonise: { truth: string; room: string; studio: string; mask: string };
  /** The scene's light: colour (0xRRGGBB) and strength. */
  light: { colour: number; level: number };
};

type SceneParams = { glbUrl: string; seed: number; cameraHeight: number; distance: number; sideways: number; yawDegrees: number; wallGap: number; hfovDegrees: number };

/** three.js from model-viewer's own dependency: no new package for an evaluation. */
function threeDirectory(): string {
  const fromModelViewer = createRequire(createRequire(import.meta.url).resolve("@google/model-viewer/package.json"));
  // three exports no package.json; its main entry sits in build/, one level below the package.
  return path.dirname(path.dirname(fromModelViewer.resolve("three")));
}

const PAGE = `<!doctype html><html><head><meta charset="utf-8">
<script type="importmap">{"imports":{"three":"/three/build/three.module.js","three/addons/":"/three/examples/jsm/"}}</script>
<style>html,body{margin:0;background:#000}</style></head><body>
<script type="module">
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

const W = ${WIDTH}, H = ${HEIGHT};
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(W, H, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);
const environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;

// A small seeded generator, so a scene's floor and walls are the same on every run.
function random(seed) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function planks(seed) {
  const r = random(seed), canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1024;
  const g = canvas.getContext("2d");
  const base = [110 + r() * 70, 70 + r() * 40, 40 + r() * 25];
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 4; j++) {
      const shade = 0.85 + r() * 0.3, offset = (i % 2) * 128;
      g.fillStyle = "rgb(" + base.map((c) => Math.min(255, c * shade)).join(",") + ")";
      g.fillRect(i * 128, j * 256 + offset - 256, 126, 254);
      g.fillRect(i * 128, j * 256 + offset + 768, 126, 254);
    }
  }
  for (let k = 0; k < 6000; k++) { g.fillStyle = "rgba(40,20,5," + (r() * 0.08) + ")"; g.fillRect(r() * 1024, r() * 1024, 1 + r() * 2, 8 + r() * 40); }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function paint(seed) {
  const r = random(seed), canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const g = canvas.getContext("2d");
  const tone = [215 + r() * 30, 205 + r() * 30, 190 + r() * 35];
  g.fillStyle = "rgb(" + tone.join(",") + ")";
  g.fillRect(0, 0, 256, 256);
  for (let k = 0; k < 3000; k++) { g.fillStyle = "rgba(0,0,0," + (r() * 0.03) + ")"; g.fillRect(r() * 256, r() * 256, 2, 2); }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const loader = new GLTFLoader();
window.renderScene = async (p) => {
  const scene = new THREE.Scene();
  scene.environment = environment;
  scene.environmentIntensity = 0.7;
  scene.background = new THREE.Color(0x202020);

  const gltf = await loader.loadAsync(p.glbUrl);
  const piece = gltf.scene;
  piece.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  piece.rotation.y = (p.yawDegrees * Math.PI) / 180;
  piece.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(piece);
  const centre = box.getCenter(new THREE.Vector3());
  piece.position.set(-centre.x, -box.min.y, -centre.z);
  piece.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(piece);
  const height = box.max.y - box.min.y, depth = box.max.z - box.min.z;
  scene.add(piece);

  const floorMap = planks(p.seed);
  floorMap.repeat.set(12 / 1.2, 12 / 1.2);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), new THREE.MeshStandardMaterial({ map: floorMap, roughness: 0.75 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const wallMap = paint(p.seed + 1);
  const wallMaterial = new THREE.MeshStandardMaterial({ map: wallMap, roughness: 0.95 });
  const back = new THREE.Mesh(new THREE.PlaneGeometry(12, 3), wallMaterial);
  back.position.set(0, 1.5, box.min.z - p.wallGap);
  back.receiveShadow = true;
  scene.add(back);
  const side = new THREE.Mesh(new THREE.PlaneGeometry(12, 3), wallMaterial);
  side.rotation.y = Math.PI / 2;
  side.position.set(-2.2 - (p.seed % 7) * 0.2, 1.5, 0);
  side.receiveShadow = true;
  scene.add(side);
  const skirting = new THREE.Mesh(new THREE.BoxGeometry(12, 0.08, 0.02), new THREE.MeshStandardMaterial({ color: 0xf2efe8, roughness: 0.6 }));
  skirting.position.set(0, 0.04, back.position.z + 0.01);
  scene.add(skirting);

  // Each scene its own light (docs/adr/042): warm lamp, neutral bulb or cool daylight, bright to dim,
  // so harmonisation has something to match.
  const LIGHT_COLOURS = [0xffc58f, 0xfff4e6, 0xd6e6ff];
  const lightColour = LIGHT_COLOURS[p.seed % 3];
  const lightLevel = 0.8 + (p.seed % 5) * 0.35;
  scene.environmentIntensity = 0.3 + ((p.seed * 7) % 5) * 0.1;
  const sky = new THREE.HemisphereLight(lightColour, 0x8a7f70, 0.25 + ((p.seed * 3) % 5) * 0.1);
  scene.add(sky);
  const sun = new THREE.DirectionalLight(lightColour, lightLevel);
  sun.position.set(1.5 + (p.seed % 3), 4, 2.5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 0.5, far: 15 });
  sun.shadow.bias = -0.0005;
  scene.add(sun);

  // A phone held at standing height, turned and tilted towards the piece; the lens is horizontal, as the method takes it.
  const vfov = (2 * Math.atan(Math.tan((p.hfovDegrees * Math.PI) / 360) * (H / W)) * 180) / Math.PI;
  const camera = new THREE.PerspectiveCamera(vfov, W / H, 0.05, 40);
  // A tall piece needs the phone further back to be in the picture, as a person would step back.
  camera.position.set(p.sideways, p.cameraHeight, box.max.z + p.distance + Math.max(0, height - 0.9) * 1.3);
  camera.lookAt(0, height * 0.45, 0);
  camera.updateMatrixWorld(true);

  renderer.render(scene, camera);
  const dataUrl = renderer.domElement.toDataURL("image/png");

  // The control: the scene's exact distance along the camera's axis, a quarter of the photo's size,
  // so the method can be run once with perfect depth and once with the model's.
  const DW = W / 4, DH = H / 4;
  const target = new THREE.WebGLRenderTarget(DW, DH, { type: THREE.FloatType });
  scene.overrideMaterial = new THREE.ShaderMaterial({
    vertexShader: "varying float vz; void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vz = -mv.z; gl_Position = projectionMatrix * mv; }",
    fragmentShader: "varying float vz; void main() { gl_FragColor = vec4(vz, 0.0, 0.0, 1.0); }",
    side: THREE.DoubleSide,
  });
  const background = scene.background;
  scene.background = null;
  renderer.setRenderTarget(target);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  renderer.render(scene, camera);
  const rgba = new Float32Array(DW * DH * 4);
  renderer.readRenderTargetPixels(target, 0, 0, DW, DH, rgba);
  renderer.setRenderTarget(null);
  scene.overrideMaterial.dispose();
  scene.overrideMaterial = null;
  scene.background = background;
  target.dispose();
  // GL rows run bottom to top; the depth map's run top to bottom.
  const exact = new Float32Array(DW * DH);
  for (let y = 0; y < DH; y++) for (let x = 0; x < DW; x++) exact[y * DW + x] = rgba[((DH - 1 - y) * DW + x) * 4];
  const bytes = new Uint8Array(exact.buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768));

  // E4-H (docs/adr/042): the room as a shopper would photograph it, without the piece; the piece alone
  // under neutral studio light from the same camera, as a product photograph; and its exact outline.
  piece.visible = false;
  renderer.render(scene, camera);
  const roomUrl = renderer.domElement.toDataURL("image/png");
  piece.visible = true;

  const others = scene.children.filter((child) => child !== piece);
  others.forEach((child) => { child.visible = false; });
  const studioLights = [new THREE.HemisphereLight(0xffffff, 0xffffff, 1.0), new THREE.DirectionalLight(0xffffff, 1.4)];
  studioLights[1].position.copy(camera.position).add(new THREE.Vector3(0.5, 1.5, 0));
  studioLights.forEach((light) => scene.add(light));
  const roomEnvironmentIntensity = scene.environmentIntensity;
  scene.environmentIntensity = 0.7;
  scene.background = new THREE.Color(0xffffff);
  renderer.render(scene, camera);
  const studioUrl = renderer.domElement.toDataURL("image/png");
  studioLights.forEach((light) => { scene.remove(light); light.dispose(); });
  scene.environmentIntensity = roomEnvironmentIntensity;

  scene.background = new THREE.Color(0x000000);
  scene.overrideMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
  renderer.render(scene, camera);
  const maskUrl = renderer.domElement.toDataURL("image/png");
  scene.overrideMaterial.dispose();
  scene.overrideMaterial = null;
  others.forEach((child) => { child.visible = true; });
  scene.background = background;

  const pixel = (v) => { const n = v.clone().project(camera); return [((n.x + 1) / 2) * W, ((1 - n.y) / 2) * H]; };
  const result = {
    dataUrl,
    roomUrl,
    studioUrl,
    maskUrl,
    light: { colour: lightColour, level: lightLevel },
    exactDepth: { width: DW, height: DH, base64: btoa(binary) },
    base: pixel(new THREE.Vector3(0, 0, 0)),
    top: pixel(new THREE.Vector3(0, height, 0)),
    heightM: height,
    depthM: depth,
    distanceM: Math.hypot(camera.position.x, camera.position.z),
  };
  scene.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); [].concat(o.material).forEach((m) => { m.map?.dispose(); m.dispose(); }); } });
  floorMap.dispose(); wallMap.dispose();
  return result;
};
window.ready = true;
</script></body></html>`;

function serve(threeDir: string): Promise<{ server: Server; port: number }> {
  const types: Record<string, string> = { ".js": "text/javascript", ".glb": "model/gltf-binary", ".html": "text/html" };
  const server = createServer((request, response) => {
    const url = decodeURIComponent((request.url ?? "/").split("?")[0]!);
    let file: string | null = null;
    if (url === "/") {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(PAGE);
      return;
    }
    if (url.startsWith("/three/")) file = path.join(threeDir, url.slice("/three/".length));
    if (url.startsWith("/scan/")) file = path.join(SCANS, url.slice("/scan/".length));
    if (file === null || file.includes("..") || !existsSync(file)) {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, { "content-type": types[path.extname(file)] ?? "application/octet-stream" });
    createReadStream(file).pipe(response);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, port: (server.address() as { port: number }).port })));
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { "per-category": { type: "string" }, seed: { type: "string" }, out: { type: "string" } } });
  const outDir = values.out ?? RENDER_DIR;
  const perCategory = Math.max(1, Number.parseInt(values["per-category"] ?? "4", 10));
  const seed = Number.parseInt(values.seed ?? "4949", 10);

  // Pieces with a stored scan, taken by rule: the first in each category by ABO id.
  const fixture = catalogFixtureSchema.parse(JSON.parse(await readFile("src/lib/catalog/fixtures/abo.json", "utf8")));
  const byCategory = new Map<string, typeof fixture.products>();
  for (const product of [...fixture.products].sort((a, b) => a.sourceId.localeCompare(b.sourceId))) {
    if (product.modelSource === undefined || !existsSync(path.join(SCANS, modelKey(product.sourceId)))) continue;
    const list = byCategory.get(product.category) ?? [];
    if (list.length < perCategory) list.push(product);
    byCategory.set(product.category, list);
  }
  const chosen = [...byCategory.values()].flat();
  if (chosen.length === 0) throw new Error("No stored 3D scans in .local/storage. Run `pnpm catalog models` first.");
  process.stdout.write(`E4 rendered rooms: ${chosen.length} scans (${[...byCategory.entries()].map(([category, list]) => `${category} ${list.length}`).join(", ")}), seed ${seed}\n`);

  const { server, port } = await serve(threeDirectory());
  // Software WebGL, so it renders the same on a machine without a GPU.
  const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
  page.on("pageerror", (error) => process.stderr.write(`  page error: ${error.message}\n`));
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => (window as unknown as { ready?: boolean }).ready === true, undefined, { timeout: 60_000 });

  await mkdir(outDir, { recursive: true });
  const random = seededRandom(seed);
  const scenes: RenderedScene[] = [];
  for (const [index, product] of chosen.entries()) {
    const params: SceneParams = {
      glbUrl: `/scan/${modelKey(product.sourceId)}`,
      seed: seed + index,
      cameraHeight: 1.25 + random() * 0.3,
      distance: 1.4 + random() * 1.4,
      sideways: (random() - 0.5) * 0.8,
      yawDegrees: (random() - 0.5) * 70,
      wallGap: 0.3 + random() * 0.9,
      hfovDegrees: RENDER_FOV,
    };
    const result = await page.evaluate(
      (p) => (window as unknown as { renderScene: (p: SceneParams) => Promise<{ dataUrl: string; base: [number, number]; top: [number, number]; heightM: number; distanceM: number; exactDepth: { width: number; height: number; base64: string }; roomUrl: string; studioUrl: string; maskUrl: string; light: { colour: number; level: number } }> }).renderScene(p),
      params,
    );
    const file = `${String(index + 1).padStart(2, "0")}-${product.sourceId.toLowerCase()}.jpg`;
    const png = Buffer.from(result.dataUrl.slice(result.dataUrl.indexOf(",") + 1), "base64");
    await sharp(png).jpeg({ quality: 90 }).toFile(path.join(outDir, file));
    const depthFile = file.replace(/\.jpg$/, ".depth.f32");
    // E4-H's four images, lossless: the truth in the room, the room without the piece, the studio photo, the outline.
    const passes = { truth: result.dataUrl, room: result.roomUrl, studio: result.studioUrl, mask: result.maskUrl } as const;
    const harmonise: Record<keyof typeof passes, string> = { truth: "", room: "", studio: "", mask: "" };
    for (const [name, url] of Object.entries(passes) as [keyof typeof passes, string][]) {
      harmonise[name] = file.replace(/\.jpg$/, `.${name}.png`);
      await writeFile(path.join(outDir, harmonise[name]), Buffer.from(url.slice(url.indexOf(",") + 1), "base64"));
    }
    await writeFile(path.join(outDir, depthFile), Buffer.from(result.exactDepth.base64, "base64"));
    const inFrame = (point: [number, number]) => point[0] >= 0 && point[0] < WIDTH && point[1] >= 0 && point[1] < HEIGHT;
    if (!inFrame(result.base) || !inFrame(result.top)) {
      process.stdout.write(`  ${file}: the piece leaves the frame, skipped\n`);
      continue;
    }
    scenes.push({
      file,
      sourceId: product.sourceId,
      piece: product.titleEn.slice(0, 60),
      category: product.category,
      heightCm: Math.round(result.heightM * 1000) / 10,
      base: result.base,
      top: result.top,
      width: WIDTH,
      height: HEIGHT,
      fovDegrees: RENDER_FOV,
      cameraHeightM: Math.round(params.cameraHeight * 1000) / 1000,
      distanceM: Math.round(result.distanceM * 1000) / 1000,
      exactDepth: { file: depthFile, width: result.exactDepth.width, height: result.exactDepth.height },
      harmonise,
      light: result.light,
    });
    process.stdout.write(`  ${file}  ${product.category.padEnd(10)} ${String(Math.round(result.heightM * 100)).padStart(3)} cm, camera ${params.cameraHeight.toFixed(2)} m\n`);
  }
  await browser.close();
  server.close();
  await writeFile(manifestIn(outDir), `${JSON.stringify({ seed, renderedAt: new Date().toISOString(), fovDegrees: RENDER_FOV, scenes }, null, 2)}\n`);
  process.stdout.write(`${scenes.length} scenes written to ${outDir}\n`);
}

// Run only when executed, so the measuring script can import the scene type and paths.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`[e4:render] ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
    process.exitCode = 1;
  });
}
