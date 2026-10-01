/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The room behind the glass: plaster walls, a micro-cement floor, an arched window in the left wall, and the shop's plinths.
 */

import {
  BoxGeometry,
  Color,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Path,
  PlaneGeometry,
  Shape,
  type Texture,
} from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

import type { Plinth, Room } from "@/lib/display/scene";

/**
 * docs/adr/048. The room is built around the set (src/lib/display/scene.ts
 * gives its walls), so a sofa and a vase both stand in a room that suits them.
 *
 * THE WINDOW is the light's way in. It is a real opening in a 22 cm thick wall
 * (an extruded shape with an arched hole), with a glazing cross in it. The sun
 * is a spot light outside, and the wall itself casts the shadow — so the patch
 * of light on the floor has the window's own shape, arch and bars included,
 * because that is how light through a window works, not because it was painted.
 */

export const WINDOW = { width: 1.15, sill: 0.5, height: 2.25, wall: 0.22 } as const;

export type Palette = { wall: Color; floor: Color; trim: Color; plinth: Color; sky: Color };

export type RoomSurfaces = { plaster: { map: Texture; roughness: Texture }; cement: { map: Texture; roughness: Texture } };

export type BuiltRoom = {
  group: Group;
  /** Where the window's opening is, at the wall's inside face: its centre (z) and the arch's outline in the wall plane. */
  window: { x: number; z: number; outline: { z: number; y: number }[] };
  /** Every plaster surface (recoloured by the mood), the floor, the trim, and the sky seen through the window. */
  materials: { walls: MeshStandardMaterial[]; floor: MeshStandardMaterial; trim: MeshStandardMaterial; sky: MeshBasicMaterial };
  dispose: () => void;
};

function surface(source: { map: Texture; roughness: Texture }, colour: Color, repeatX: number, repeatY: number, roughness: number): MeshStandardMaterial {
  const map = source.map.clone();
  const rough = source.roughness.clone();
  for (const texture of [map, rough]) {
    texture.repeat.set(repeatX, repeatY);
    texture.needsUpdate = true;
  }
  return new MeshStandardMaterial({ color: colour, map, roughnessMap: rough, roughness, metalness: 0 });
}

/** The arch: straight jambs from the sill to the springing line, then a half circle. */
function archOutline(centreZ: number): { z: number; y: number }[] {
  const half = WINDOW.width / 2;
  const spring = WINDOW.sill + WINDOW.height - half;
  const points: { z: number; y: number }[] = [
    { z: centreZ - half, y: WINDOW.sill },
    { z: centreZ + half, y: WINDOW.sill },
    { z: centreZ + half, y: spring },
  ];
  for (let step = 1; step < 24; step += 1) {
    const angle = (Math.PI * step) / 24;
    points.push({ z: centreZ + half * Math.cos(angle), y: spring + half * Math.sin(angle) });
  }
  points.push({ z: centreZ - half, y: spring });
  return points;
}

export function buildRoom(room: Room, palette: Palette, surfaces: RoomSurfaces, reachZ: number): BuiltRoom {
  const group = new Group();
  group.name = "room";
  const width = room.maxX - room.minX;
  const depth = reachZ - room.backZ;
  const centreX = (room.minX + room.maxX) / 2;

  const wall = surface(surfaces.plaster, palette.wall, depth / 2.4, room.height / 2.4, 0.93);
  const back = surface(surfaces.plaster, palette.wall, width / 2.4, room.height / 2.4, 0.93);
  const floor = surface(surfaces.cement, palette.floor, width / 2.2, depth / 2.2, 0.72);
  const trim = new MeshStandardMaterial({ color: palette.trim, roughness: 0.6 });
  const sky = new MeshBasicMaterial({ color: palette.sky });
  const ceilingMaterial = surface(surfaces.plaster, palette.wall, width / 3, depth / 3, 0.95);
  const geometries: { dispose: () => void }[] = [];
  const add = (mesh: Mesh, shadows: { cast: boolean; receive: boolean }) => {
    mesh.castShadow = shadows.cast;
    mesh.receiveShadow = shadows.receive;
    geometries.push(mesh.geometry);
    group.add(mesh);
    return mesh;
  };

  // Floor, running out past the glass to beyond the camera.
  const floorMesh = new Mesh(new PlaneGeometry(width, depth), floor);
  floorMesh.rotation.x = -Math.PI / 2;
  floorMesh.position.set(centreX, 0, room.backZ + depth / 2);
  add(floorMesh, { cast: false, receive: true });

  const ceiling = new Mesh(new PlaneGeometry(width, depth), ceilingMaterial);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(centreX, room.height, room.backZ + depth / 2);
  add(ceiling, { cast: false, receive: true });

  const backWall = new Mesh(new PlaneGeometry(width, room.height), back);
  backWall.position.set(centreX, room.height / 2, room.backZ);
  add(backWall, { cast: false, receive: true });

  const rightWall = new Mesh(new PlaneGeometry(depth, room.height), wall);
  rightWall.rotation.y = -Math.PI / 2;
  rightWall.position.set(room.maxX, room.height / 2, room.backZ + depth / 2);
  add(rightWall, { cast: false, receive: true });

  // The left wall, with the window: a shape in the wall's own plane (u along +z, v up), extruded to the wall's thickness.
  const windowZ = Math.min(room.frontZ - 0.9, Math.max(room.backZ + 1.1, (room.backZ + room.frontZ) / 2 + 0.35));
  const outline = archOutline(windowZ);
  const shape = new Shape();
  shape.moveTo(room.backZ, 0);
  shape.lineTo(reachZ, 0);
  shape.lineTo(reachZ, room.height);
  shape.lineTo(room.backZ, room.height);
  shape.lineTo(room.backZ, 0);
  const hole = new Path();
  outline.forEach((point, index) => (index === 0 ? hole.moveTo(point.z, point.y) : hole.lineTo(point.z, point.y)));
  hole.closePath();
  shape.holes.push(hole);
  const leftGeometry = new ExtrudeGeometry(shape, { depth: WINDOW.wall, bevelEnabled: false, curveSegments: 24 });
  const leftMaterial = wall.clone();
  leftMaterial.side = DoubleSide;
  const leftWall = new Mesh(leftGeometry, leftMaterial);
  // rotateY(−π/2) carries the shape's x to world +z; the extrusion then runs towards −x, outwards from the room.
  leftWall.rotation.y = -Math.PI / 2;
  leftWall.position.set(room.minX, 0, 0);
  add(leftWall, { cast: true, receive: true });

  // The glazing cross: a mullion and a transom at the springing line, in the wall's middle.
  const spring = WINDOW.sill + WINDOW.height - WINDOW.width / 2;
  const glazingX = room.minX - WINDOW.wall * 0.55;
  const mullion = new Mesh(new BoxGeometry(0.035, WINDOW.height, 0.035), trim);
  mullion.position.set(glazingX, WINDOW.sill + WINDOW.height / 2, windowZ);
  add(mullion, { cast: true, receive: false });
  const transom = new Mesh(new BoxGeometry(0.035, 0.035, WINDOW.width), trim);
  transom.position.set(glazingX, spring, windowZ);
  add(transom, { cast: true, receive: false });
  const lower = new Mesh(new BoxGeometry(0.03, 0.03, WINDOW.width), trim);
  lower.position.set(glazingX, WINDOW.sill + (spring - WINDOW.sill) * 0.48, windowZ);
  add(lower, { cast: true, receive: false });

  // The sky seen through the window: bright, the colour of the outside light.
  // Wide enough that a camera looking through the window at a slant still sees sky, never the void.
  const skyPlane = new Mesh(new PlaneGeometry(90, 24), sky);
  skyPlane.rotation.y = Math.PI / 2;
  skyPlane.position.set(room.minX - 5, 4, windowZ);
  geometries.push(skyPlane.geometry);
  group.add(skyPlane);

  // Skirting along the back and right walls: a small detail every real room has.
  const skirtHeight = 0.09;
  const backSkirt = new Mesh(new BoxGeometry(width, skirtHeight, 0.014), trim);
  backSkirt.position.set(centreX, skirtHeight / 2, room.backZ + 0.007);
  add(backSkirt, { cast: false, receive: true });
  const rightSkirt = new Mesh(new BoxGeometry(0.014, skirtHeight, depth), trim);
  rightSkirt.position.set(room.maxX - 0.007, skirtHeight / 2, room.backZ + depth / 2);
  add(rightSkirt, { cast: false, receive: true });
  const leftSkirt = new Mesh(new BoxGeometry(0.014, skirtHeight, windowZ - WINDOW.width / 2 - room.backZ), trim);
  leftSkirt.position.set(room.minX + 0.007, skirtHeight / 2, (room.backZ + windowZ - WINDOW.width / 2) / 2);
  add(leftSkirt, { cast: false, receive: true });

  const materials = { walls: [wall, back, ceilingMaterial, leftMaterial], floor, trim, sky };
  return {
    group,
    window: { x: room.minX, z: windowZ, outline },
    materials,
    dispose: () => {
      for (const geometry of geometries) geometry.dispose();
      for (const material of [wall, back, floor, trim, sky, ceilingMaterial, leftMaterial]) {
        material.map?.dispose();
        material.dispose();
      }
    },
  };
}

/** The shop's display plinths: crisp boxes with softly rounded edges that catch the light, in a pale plaster. */
export function buildPlinths(plinths: readonly Plinth[], colour: Color): { group: Group; meshes: Map<string, Mesh>; dispose: () => void } {
  const group = new Group();
  group.name = "plinths";
  const material = new MeshStandardMaterial({ color: colour, roughness: 0.82 });
  const meshes = new Map<string, Mesh>();
  for (const plinth of plinths) {
    const mesh = new Mesh(new RoundedBoxGeometry(plinth.size.x, plinth.size.y, plinth.size.z, 3, 0.012), material);
    mesh.position.set(plinth.position.x, plinth.size.y / 2, plinth.position.z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = plinth.id;
    meshes.set(plinth.id, mesh);
    group.add(mesh);
  }
  return {
    group,
    meshes,
    dispose: () => {
      for (const mesh of meshes.values()) mesh.geometry.dispose();
      material.dispose();
    },
  };
}
