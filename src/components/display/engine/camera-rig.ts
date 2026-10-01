/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The camera's movement: critically damped springs, a look around within limits, and a slow breath when left alone.
 */

import { Spherical, Vector3, type PerspectiveCamera } from "three";

import type { CameraShot } from "@/lib/display/scene";

/**
 * docs/adr/048. Every move of the camera is a spring, never a timed tween. A
 * critically damped spring
 *
 *   x'' = −ω² (x − goal) − 2ω x'
 *
 * reaches its goal as fast as a spring can without overshooting, and it can be
 * given a new goal at any moment — mid-flight, the move simply bends towards
 * the new one, which is what makes a camera feel attached to the hand rather
 * than played back. ω sets the pace: about 6.6/ω seconds to settle within 1%.
 * Each step integrates velocity first, then position (semi-implicit Euler),
 * which stays stable for the frame times a browser gives.
 *
 * The shot (src/lib/display/scene.ts frameShot) gives the eye and the target.
 * On top of it, as angles about the target: the shopper's drag (limited to
 * ±32° around and a little up or down), the pointer's parallax (±3°), and, when
 * nobody has touched it for a while, a very slow breath. Zoom scales the
 * distance within limits. With reduced motion there is no parallax, no breath,
 * and every move arrives at once.
 */

class Spring {
  value: number;
  velocity = 0;
  goal: number;
  constructor(
    initial: number,
    public omega: number,
  ) {
    this.value = initial;
    this.goal = initial;
  }
  step(dt: number): void {
    const acceleration = -this.omega * this.omega * (this.value - this.goal) - 2 * this.omega * this.velocity;
    this.velocity += acceleration * dt;
    this.value += this.velocity * dt;
  }
  get settled(): boolean {
    return Math.abs(this.value - this.goal) < 1e-4 && Math.abs(this.velocity) < 1e-4;
  }
  snap(): void {
    this.value = this.goal;
    this.velocity = 0;
  }
}

class VectorSpring {
  readonly x: Spring;
  readonly y: Spring;
  readonly z: Spring;
  constructor(initial: Vector3, omega: number) {
    this.x = new Spring(initial.x, omega);
    this.y = new Spring(initial.y, omega);
    this.z = new Spring(initial.z, omega);
  }
  set goal(value: Vector3) {
    this.x.goal = value.x;
    this.y.goal = value.y;
    this.z.goal = value.z;
  }
  set omega(value: number) {
    this.x.omega = value;
    this.y.omega = value;
    this.z.omega = value;
  }
  step(dt: number) {
    this.x.step(dt);
    this.y.step(dt);
    this.z.step(dt);
  }
  snap() {
    this.x.snap();
    this.y.snap();
    this.z.snap();
  }
  get settled() {
    return this.x.settled && this.y.settled && this.z.settled;
  }
  value(target = new Vector3()) {
    return target.set(this.x.value, this.y.value, this.z.value);
  }
}

const YAW_LIMIT = (32 * Math.PI) / 180;
const PITCH_LIMIT = { down: -0.1, up: 0.32 };
const ZOOM_LIMIT = { near: 0.55, far: 1.18 };
const PARALLAX = { yaw: 0.05, pitch: 0.03 };
const IDLE_AFTER_S = 4;

export type CameraRig = {
  /** Fly to a shot; `intro` starts from further back, as if walking up to the glass. */
  goTo: (shot: CameraShot, options?: { intro?: boolean; pace?: "glide" | "settle" }) => void;
  drag: (dx: number, dy: number) => void;
  zoom: (factor: number) => void;
  /** The pointer over the window, −1 to 1 each way, or null when it leaves. */
  point: (at: { x: number; y: number } | null) => void;
  /** Back to the shot's own angle (after a drag). */
  recentre: () => void;
  setReducedMotion: (reduce: boolean) => void;
  /** Whether the slow breath may run when the camera is left alone (capable devices, recently touched). */
  setAmbient: (allowed: boolean) => void;
  /** Seconds since the shopper last moved the camera. */
  idleFor: () => number;
  /** Advances by dt seconds and places the camera; true while anything is still moving. */
  update: (dt: number, elapsed: number) => boolean;
  /** The current look-around angles, for the parallax of the glass in front. */
  angles: () => { yaw: number; pitch: number };
  /** Every spring at its goal at once (tests and screenshots). */
  snap: () => void;
};

export function createCameraRig(camera: PerspectiveCamera, initial: CameraShot): CameraRig {
  const eye = new VectorSpring(new Vector3(initial.position.x, initial.position.y, initial.position.z), 2.8);
  const target = new VectorSpring(new Vector3(initial.target.x, initial.target.y, initial.target.z), 2.8);
  const yaw = new Spring(0, 7);
  const pitch = new Spring(0, 7);
  const distance = new Spring(1, 6);
  const parallaxYaw = new Spring(0, 3.2);
  const parallaxPitch = new Spring(0, 3.2);
  let reduced = false;
  let ambient = true;
  let lastTouch = 0;
  let now = 0;
  const offset = new Vector3();
  const spherical = new Spherical();
  const look = new Vector3();
  const at = new Vector3();

  camera.fov = initial.fovDeg;
  camera.updateProjectionMatrix();

  const all = [yaw, pitch, distance, parallaxYaw, parallaxPitch];

  return {
    goTo(shot, options = {}) {
      const nextEye = new Vector3(shot.position.x, shot.position.y, shot.position.z);
      const nextTarget = new Vector3(shot.target.x, shot.target.y, shot.target.z);
      if (camera.fov !== shot.fovDeg) {
        camera.fov = shot.fovDeg;
        camera.updateProjectionMatrix();
      }
      if (options.intro === true && !reduced) {
        // Start on the pavement: 2.4 m further out and a little higher, then walk up to the glass.
        const back = nextEye.clone().sub(nextTarget).normalize();
        const start = nextEye.clone().addScaledVector(back, 2.4).add(new Vector3(0, 0.25, 0));
        eye.x.value = start.x;
        eye.y.value = start.y;
        eye.z.value = start.z;
        for (const spring of [eye.x, eye.y, eye.z]) spring.velocity = 0;
      }
      // A glide to a piece is a touch quicker than the walk to the window.
      const omega = options.pace === "glide" ? 3.4 : 2.6;
      eye.omega = omega;
      target.omega = omega;
      eye.goal = nextEye;
      target.goal = nextTarget;
      yaw.goal = 0;
      pitch.goal = 0;
      distance.goal = 1;
      if (reduced) {
        eye.snap();
        target.snap();
        for (const spring of all) spring.snap();
      }
    },
    drag(dx, dy) {
      lastTouch = now;
      yaw.goal = Math.max(-YAW_LIMIT, Math.min(YAW_LIMIT, yaw.goal - dx * 0.0045));
      pitch.goal = Math.max(PITCH_LIMIT.down, Math.min(PITCH_LIMIT.up, pitch.goal + dy * 0.0032));
      if (reduced) {
        yaw.snap();
        pitch.snap();
      }
    },
    zoom(factor) {
      lastTouch = now;
      distance.goal = Math.max(ZOOM_LIMIT.near, Math.min(ZOOM_LIMIT.far, distance.goal * factor));
      if (reduced) distance.snap();
    },
    point(position) {
      lastTouch = now;
      if (reduced) return;
      parallaxYaw.goal = position === null ? 0 : -position.x * PARALLAX.yaw;
      parallaxPitch.goal = position === null ? 0 : position.y * PARALLAX.pitch;
    },
    recentre() {
      yaw.goal = 0;
      pitch.goal = 0;
      distance.goal = 1;
    },
    setAmbient(allowed) {
      ambient = allowed;
    },
    idleFor() {
      return now - lastTouch;
    },
    setReducedMotion(reduce) {
      reduced = reduce;
      if (reduce) {
        parallaxYaw.goal = 0;
        parallaxPitch.goal = 0;
        eye.snap();
        target.snap();
        for (const spring of all) spring.snap();
      }
    },
    update(dt, elapsed) {
      now = elapsed;
      const step = Math.min(dt, 1 / 30);
      eye.step(step);
      target.step(step);
      for (const spring of all) spring.step(step);

      // The breath: a few tenths of a degree, over about a minute and a half, only when left alone.
      const idle = ambient && !reduced && now - lastTouch > IDLE_AFTER_S;
      const breathYaw = idle ? Math.sin(elapsed * 0.071) * 0.022 : 0;
      const breathPitch = idle ? Math.sin(elapsed * 0.053 + 1.3) * 0.009 : 0;

      eye.value(at);
      target.value(look);
      offset.copy(at).sub(look);
      spherical.setFromVector3(offset);
      spherical.theta += yaw.value + parallaxYaw.value + breathYaw;
      spherical.phi = Math.max(0.35, Math.min(Math.PI / 2 - 0.02, spherical.phi - pitch.value - parallaxPitch.value - breathPitch));
      spherical.radius *= distance.value;
      offset.setFromSpherical(spherical);
      camera.position.copy(look).add(offset);
      // Never below the floor or through the ceiling.
      camera.position.y = Math.max(0.35, Math.min(2.7, camera.position.y));
      camera.lookAt(look);

      const moving = !(eye.settled && target.settled && all.every((spring) => spring.settled));
      return moving || idle;
    },
    angles() {
      return { yaw: yaw.value + parallaxYaw.value, pitch: pitch.value + parallaxPitch.value };
    },
    snap() {
      eye.snap();
      target.snap();
      for (const spring of all) spring.snap();
    },
  };
}
