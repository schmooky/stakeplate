// DiceScene — the three.js + cannon-es renderer for Dice Cascade.
//
// Faithful to the reference drop-sim: the SERVER decides every die's face up
// front; for each drop we PRE-SIMULATE the fall off-screen (cannon-es) to learn
// which geometric face lands up, arrange the textures so the server's outcome is
// on that face BEFORE anything shows, then play back the recorded frames (no
// live physics on screen). Settled dice stay as static bodies so later dice
// (spawned by mystery faces) pile and cascade on top of them.
//
// All timing is self-contained (driven by the loop's dt), so the whole cascade
// is deterministic and can be hand-pumped (preview/tests) via `pump(dt)`.

import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { COLORS, faceEq } from '@/config/colors';
import type { CascadeDie, Face } from '@/domain/types';
import type { Disposable } from '@/utils/Disposable';

const SIZE = 1.1;
const TRAY = 9;
const FACE_NORMALS = [
  new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0),
  new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0),
  new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1),
];
const UP = new THREE.Vector3(0, 1, 0);

interface Frame { x: number; y: number; z: number; qx: number; qy: number; qz: number; qw: number }
interface RenderDie {
  mesh: THREE.Mesh;
  frames: Frame[];
  idx: number;
  acc: number;
  cascadeIndex: number;
  face: Face;
  playing: boolean;
  resolveT: number; // >=0: counting down to resolve; <0: done/none
  resolved: boolean;
  poofT: number;    // >=0: poofing out
}

export interface Tally { dropped: number; winSum: number; mult: number }

const texCache = new Map<string, THREE.CanvasTexture>();
function faceTexture(hex: string, face: Face): THREE.CanvasTexture {
  const key = hex + JSON.stringify(face);
  const cached = texCache.get(key);
  if (cached) return cached;
  const s = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const x = cv.getContext('2d')!;
  x.fillStyle = hex; x.fillRect(0, 0, s, s);
  x.strokeStyle = 'rgba(0,0,0,.18)'; x.lineWidth = 10; x.strokeRect(5, 5, s - 10, s - 10);
  x.textAlign = 'center'; x.textBaseline = 'middle';
  const dark = '#1a1d24';
  if (face.kind === 'pay') {
    x.fillStyle = dark; x.font = `700 ${face.v >= 100 ? 86 : 110}px "Space Grotesk", system-ui, sans-serif`;
    x.fillText(String(face.v), s / 2, s / 2 + 6);
  } else if (face.kind === 'mystery') {
    x.fillStyle = dark; x.font = '700 150px "Space Grotesk", system-ui, sans-serif';
    x.fillText('?', s / 2, s / 2 + 8);
  } else if (face.kind === 'mult') {
    x.fillStyle = '#7a4f00'; x.font = '700 120px "Space Grotesk", system-ui, sans-serif';
    x.fillText('x' + face.k, s / 2, s / 2 + 6);
  } // blank: just the colour
  const t = new THREE.CanvasTexture(cv);
  t.anisotropy = 4; t.colorSpace = THREE.SRGBColorSpace;
  texCache.set(key, t);
  return t;
}

export class DiceScene implements Disposable {
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private simWorld!: CANNON.World;
  private matDie!: CANNON.Material;
  private settledStatics: CANNON.Body[] = [];
  private dice: RenderDie[] = [];
  private pendingDrops: Array<{ die: CascadeDie; at: THREE.Vector3; t: number }> = [];
  private clock = new THREE.Clock();
  private raf = 0;
  private host!: HTMLElement;
  private speed = 1;
  private resizeFn = (): void => this.resize();

  private cascadeDone: (() => void) | null = null;
  private cascadeTotal = 0;
  private resolvedCount = 0;
  private childrenByParent = new Map<number, CascadeDie[]>();
  private indexOf = new Map<CascadeDie, number>();
  private clearDone: (() => void) | null = null;
  private clearing = 0;

  onTally: ((t: Tally) => void) | null = null;
  private winSum = 0;
  private mult = 1;
  private dropped = 0;

  init(host: HTMLElement): void {
    this.host = host;
    const canvas = document.createElement('canvas');
    host.appendChild(canvas);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#0f1218');

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
    this.camera.position.set(0, 13.5, 12.5);
    this.camera.lookAt(0, 0, 0);

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(6, 14, 8); key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -12; key.shadow.camera.right = 12;
    key.shadow.camera.top = 12; key.shadow.camera.bottom = -12;
    this.scene.add(key);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(TRAY * 2, TRAY * 2),
      new THREE.MeshStandardMaterial({ color: '#1b202b', roughness: 0.95 }),
    );
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
    this.scene.add(floor);
    const grid = new THREE.GridHelper(TRAY * 2, 18, 0x2a3140, 0x222936);
    grid.position.y = 0.01; this.scene.add(grid);

    this.simWorld = new CANNON.World({ gravity: new CANNON.Vec3(0, -32, 0) });
    this.matDie = new CANNON.Material('die');
    this.simWorld.addContactMaterial(new CANNON.ContactMaterial(this.matDie, this.matDie, { friction: 0.3, restitution: 0.25 }));
    const ground = new CANNON.Body({ mass: 0, shape: new CANNON.Plane(), material: this.matDie });
    ground.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    this.simWorld.addBody(ground);
    const wall = (hx: number, hy: number, hz: number, x: number, y: number, z: number): void => {
      const b = new CANNON.Body({ mass: 0, material: this.matDie, shape: new CANNON.Box(new CANNON.Vec3(hx, hy, hz)) });
      b.position.set(x, y, z); this.simWorld.addBody(b);
    };
    wall(TRAY, 3, 0.3, 0, 3, -TRAY); wall(TRAY, 3, 0.3, 0, 3, TRAY);
    wall(0.3, 3, TRAY, -TRAY, 3, 0); wall(0.3, 3, TRAY, TRAY, 3, 0);

    this.resize();
    window.addEventListener('resize', this.resizeFn, { passive: true });
    const tick = (): void => { this.raf = requestAnimationFrame(tick); this.step(Math.min(this.clock.getDelta(), 1 / 30)); };
    tick();
  }

  setTurbo(on: boolean): void { this.speed = on ? 6 : 1; }

  private resize(): void {
    const w = this.host.clientWidth || window.innerWidth;
    const h = this.host.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private presim(start: THREE.Vector3): Frame[] {
    const body = new CANNON.Body({
      mass: 1, material: this.matDie,
      shape: new CANNON.Box(new CANNON.Vec3(SIZE / 2, SIZE / 2, SIZE / 2)),
      position: new CANNON.Vec3(start.x, start.y, start.z),
    });
    body.angularVelocity.set((Math.random() - .5) * 14, (Math.random() - .5) * 14, (Math.random() - .5) * 14);
    body.velocity.set((Math.random() - .5) * 3, -3, (Math.random() - .5) * 3);
    this.simWorld.addBody(body);
    const frames: Frame[] = [];
    let calm = 0;
    for (let step = 0; step < 800; step++) {
      this.simWorld.step(1 / 60);
      frames.push({ x: body.position.x, y: body.position.y, z: body.position.z, qx: body.quaternion.x, qy: body.quaternion.y, qz: body.quaternion.z, qw: body.quaternion.w });
      if (body.velocity.length() < 0.12 && body.angularVelocity.length() < 0.12) { if (++calm > 18) break; } else calm = 0;
    }
    this.simWorld.removeBody(body);
    const last = frames[frames.length - 1]!;
    const stat = new CANNON.Body({ mass: 0, material: this.matDie, shape: new CANNON.Box(new CANNON.Vec3(SIZE / 2, SIZE / 2, SIZE / 2)) });
    stat.position.set(last.x, last.y, last.z);
    stat.quaternion.set(last.qx, last.qy, last.qz, last.qw);
    this.simWorld.addBody(stat);
    this.settledStatics.push(stat);
    return frames;
  }

  private upFaceIndex(q: THREE.Quaternion): number {
    let upIdx = 0, best = -Infinity;
    FACE_NORMALS.forEach((n, i) => { const d = n.clone().applyQuaternion(q).dot(UP); if (d > best) { best = d; upIdx = i; } });
    return upIdx;
  }

  private dropDie(d: CascadeDie, at: THREE.Vector3): void {
    const col = COLORS[d.color] ?? COLORS.white!;
    const frames = this.presim(at);
    const last = frames[frames.length - 1]!;
    const upIdx = this.upFaceIndex(new THREE.Quaternion(last.qx, last.qy, last.qz, last.qw));

    const others = col.faces.filter((f) => !faceEq(f, d.face));
    const arrangement = new Array<Face>(6);
    arrangement[upIdx] = d.face;
    let k = 0;
    for (let i = 0; i < 6; i++) if (i !== upIdx) arrangement[i] = others[k++ % others.length] ?? { kind: 'blank' };
    const mats = arrangement.map((f) => new THREE.MeshStandardMaterial({ map: faceTexture(col.hex, f), roughness: 0.45, metalness: 0.05 }));

    const mesh = new THREE.Mesh(new THREE.BoxGeometry(SIZE, SIZE, SIZE), mats);
    mesh.castShadow = true;
    const f0 = frames[0]!;
    mesh.position.set(f0.x, f0.y, f0.z);
    mesh.quaternion.set(f0.qx, f0.qy, f0.qz, f0.qw);
    this.scene.add(mesh);

    this.dice.push({ mesh, frames, idx: 0, acc: 0, cascadeIndex: this.indexOf.get(d) ?? -1, face: d.face, playing: true, resolveT: -1, resolved: false, poofT: -1 });
    this.dropped++;
    this.emitTally();
  }

  playCascade(cascade: CascadeDie[]): Promise<void> {
    this.childrenByParent.clear();
    this.indexOf.clear();
    cascade.forEach((d, i) => {
      this.indexOf.set(d, i);
      const arr = this.childrenByParent.get(d.parent) ?? [];
      arr.push(d);
      this.childrenByParent.set(d.parent, arr);
    });
    this.cascadeTotal = cascade.length;
    this.resolvedCount = 0;
    this.winSum = 0; this.mult = 1; this.dropped = 0;
    this.emitTally();

    const seed = cascade.find((d) => d.parent === -1);
    return new Promise<void>((resolve) => {
      this.cascadeDone = resolve;
      if (!seed) { resolve(); return; }
      this.dropDie(seed, new THREE.Vector3((Math.random() - .5) * 4, 7.5, (Math.random() - .5) * 4));
    });
  }

  private resolveDie(die: RenderDie): void {
    if (die.resolved) return;
    die.resolved = true;
    const f = die.face;
    if (f.kind === 'pay') this.winSum += f.v;
    else if (f.kind === 'mult') this.mult *= f.k;
    this.emitTally();
    this.resolvedCount++;

    if (f.kind === 'mystery') {
      const kids = this.childrenByParent.get(die.cascadeIndex) ?? [];
      const last = die.frames[die.frames.length - 1]!;
      kids.forEach((kid, i) => {
        this.pendingDrops.push({
          die: kid,
          at: new THREE.Vector3(last.x + (Math.random() - .5) * 2, 6 + Math.random() * 2, last.z + (Math.random() - .5) * 2),
          t: (0.17 * i + 0.12),
        });
      });
    }

    if (this.resolvedCount >= this.cascadeTotal && this.pendingDrops.length === 0) {
      const done = this.cascadeDone; this.cascadeDone = null;
      done?.();
    }
  }

  private emitTally(): void {
    this.onTally?.({ dropped: this.dropped, winSum: this.winSum, mult: this.mult });
  }

  clear(): Promise<void> {
    for (const b of this.settledStatics) this.simWorld.removeBody(b);
    this.settledStatics = [];
    this.pendingDrops = [];
    this.winSum = 0; this.mult = 1; this.dropped = 0; this.emitTally();
    const live = this.dice.filter((d) => d.poofT < 0);
    if (!live.length) return Promise.resolve();
    live.forEach((d, i) => { d.poofT = i * 0.02; d.playing = false; });
    this.clearing = live.length;
    return new Promise<void>((resolve) => { this.clearDone = resolve; });
  }

  /** Advance the whole scene by `dt` seconds and render. Driven by the rAF loop
   *  in production; callable directly to hand-pump (preview/tests). */
  step(dt: number): void {
    const d = dt * this.speed;

    // Scheduled cascade drops.
    for (let i = this.pendingDrops.length - 1; i >= 0; i--) {
      const p = this.pendingDrops[i]!;
      p.t -= d;
      if (p.t <= 0) { this.pendingDrops.splice(i, 1); this.dropDie(p.die, p.at); }
    }

    for (let i = this.dice.length - 1; i >= 0; i--) {
      const die = this.dice[i]!;
      if (die.poofT >= 0) {
        die.poofT -= d;
        if (die.poofT <= 0) {
          const s = Math.max(0, die.mesh.scale.x - d * 5);
          die.mesh.scale.set(s, s, s);
          if (s <= 0.001) {
            this.scene.remove(die.mesh);
            die.mesh.geometry.dispose();
            (die.mesh.material as THREE.Material[]).forEach((m) => m.dispose());
            this.dice.splice(i, 1);
            if (--this.clearing <= 0 && this.clearDone) { const done = this.clearDone; this.clearDone = null; done(); }
          }
        }
        continue;
      }
      if (die.playing) {
        die.acc += d;
        while (die.acc >= 1 / 60 && die.idx < die.frames.length - 1) { die.idx++; die.acc -= 1 / 60; }
        const f = die.frames[die.idx]!;
        die.mesh.position.set(f.x, f.y, f.z);
        die.mesh.quaternion.set(f.qx, f.qy, f.qz, f.qw);
        if (die.idx >= die.frames.length - 1) { die.playing = false; die.resolveT = 0.16; }
      } else if (die.resolveT >= 0) {
        die.resolveT -= d;
        if (die.resolveT <= 0) { die.resolveT = -1; this.resolveDie(die); }
      }
    }

    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.resizeFn);
    this.renderer.dispose();
  }
}
