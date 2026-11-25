/* ロボ箱庭ツボすごろく — 3Dの箱庭（three.js）
 * 木のトレーの上に、新潟県30市町村の石畳（模式図）・海・山・川・風車・雪を並べたジオラマ。
 * ゲームの進行は知らず、main.js から渡される「出来事(event)」を演出として再生するだけ。
 * ロボットのモデル・サイコロ・パーティクル・時間の扱いは、元の「ロボ箱庭すごろく」(MIT)のものをもとにしている。
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/RoundedBoxGeometry.js';
import { makeRobot } from './robot.js';

const NG = window.NIIGATA;
const RL = window.ROLES;
const K = 1.35;                 // 地図の座標 → 世界の座標
const TILE_TOP = 0.42;          // 石の上面の高さ
const TILE_R = 0.82;
const TAU = Math.PI * 2;
const FONT = '"Hiragino Maru Gothic ProN","Zen Kaku Gothic New","Noto Sans JP","Noto Sans CJK JP",sans-serif';

const mulberry32 = (a) => () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const lerp = (a, b, k) => a + (b - a) * k;
const clamp01 = (k) => Math.max(0, Math.min(1, k));
const ease = { out: (k) => 1 - (1 - k) ** 3, inOut: (k) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2) };
const angDiff = (a, b) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };

export const tilePos = (i) => new THREE.Vector3(NG.MUNI[i].x * K, TILE_TOP, NG.MUNI[i].y * K);
const roleColor = (id) => (RL.byId(id) || RL.ROLES[0]).color;

function canvasTex(w, h, draw, { repeat } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
  return t;
}
const rrect = (ctx, x, y, w, h, r) => { ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h); };

// ============================================================================
export class World {
  constructor(canvas) {
    this.canvas = canvas;
    this.robots = new Map();
    this.tweens = []; this.tiles = []; this.options = new Map(); this.optionSet = new Set();
    this._last = performance.now(); this.time = 0;
    this.focus = new THREE.Vector3(-1.7, 0.4, -1.1); this.focusDist = null;
    this.pickHandler = null; this.hoverHandler = null; this.hoverTile = null;
    this.turnId = null; this.celebrate = null; this.assign = [...NG.DEFAULT_ASSIGN];
    this.center = null; this.wantRotate = true; this.orb = null; this.mood = new Map();

    const renderer = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;

    const scene = this.scene = new THREE.Scene();
    scene.background = canvasTex(8, 512, (ctx, w, h) => { const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#a8d8f2'); g.addColorStop(0.55, '#e3f3fb'); g.addColorStop(1, '#fbeedb'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); });
    scene.fog = new THREE.Fog(0xe3f3fb, 70, 150);

    const camera = this.camera = new THREE.PerspectiveCamera(38, 1, 0.5, 300);
    camera.position.set(-1.7, 22, 26);
    const controls = this.controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true; controls.dampingFactor = 0.08; controls.enablePan = false;
    controls.minPolarAngle = 0.25; controls.maxPolarAngle = 1.36; controls.minDistance = 9; controls.maxDistance = 52;
    controls.target.copy(this.focus); controls.autoRotateSpeed = 0.45;
    controls.addEventListener('start', () => { this._userMoved = true; });

    this.buildLights(); this.buildTable(); this.buildLand(); this.buildTiles(); this.buildEdges();
    this.buildDecor(); this.buildRings(); this.buildSnow(); this.buildParticles(); this.buildDice(); this.buildJudge();
    this.resize = this.resize.bind(this); window.addEventListener('resize', this.resize);
    this.resize(); this.fitCamera(); this.bindPicking();
    this.loop = this.loop.bind(this); renderer.setAnimationLoop(this.loop);
  }

  // ---------------------------------------------------------------- 光
  buildLights() {
    const { scene } = this;
    scene.add(new THREE.HemisphereLight(0xcfe9ff, 0xb78b5c, 0.9));
    const sun = this.sun = new THREE.DirectionalLight(0xfff0d2, 2.6);
    sun.position.set(12, 26, 14); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera; sc.left = -22; sc.right = 22; sc.top = 22; sc.bottom = -22; sc.near = 5; sc.far = 80;
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03; sun.target.position.set(-1.7, 0, -1.1);
    scene.add(sun, sun.target);
    const fill = new THREE.DirectionalLight(0xbcd4ff, 0.55); fill.position.set(-14, 10, -8); scene.add(fill);
  }

  // ---------------------------------------------------------------- 机と木のトレー・海
  buildTable() {
    const { scene } = this;
    const wood = canvasTex(512, 512, (ctx, w, h) => {
      ctx.fillStyle = '#a97b4f'; ctx.fillRect(0, 0, w, h);
      const r = mulberry32(5);
      for (let i = 0; i < 90; i++) { ctx.strokeStyle = `rgba(${70 + r() * 40},${40 + r() * 30},20,${0.08 + r() * 0.12})`; ctx.lineWidth = 1 + r() * 3; ctx.beginPath(); const y = r() * h; ctx.moveTo(0, y); ctx.bezierCurveTo(w * 0.3, y + r() * 14 - 7, w * 0.7, y + r() * 14 - 7, w, y + r() * 10 - 5); ctx.stroke(); }
    }, { repeat: [3, 3] });
    const table = new THREE.Mesh(new THREE.CircleGeometry(90, 48), new THREE.MeshStandardMaterial({ color: 0xf3e6cf, roughness: 0.95 }));
    table.rotation.x = -Math.PI / 2; table.position.y = -1.3; table.receiveShadow = true; scene.add(table);
    const W = 36, D = 37, cx = -1.7, cz = -1.1;
    const tray = new THREE.Mesh(new RoundedBoxGeometry(W + 2.4, 1.4, D + 2.4, 4, 0.35), new THREE.MeshStandardMaterial({ map: wood, roughness: 0.75 }));
    tray.position.set(cx, -0.55, cz); tray.castShadow = true; tray.receiveShadow = true; scene.add(tray);
    // 海（トレーのくぼみ）
    const waves = this.waveTex = canvasTex(512, 512, (ctx, w, h) => {
      const g = ctx.createLinearGradient(0, 0, w, h); g.addColorStop(0, '#4aa7dc'); g.addColorStop(1, '#2f86c4'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      const r = mulberry32(9);
      ctx.strokeStyle = 'rgba(255,255,255,.28)'; ctx.lineWidth = 3;
      for (let i = 0; i < 70; i++) { const x = r() * w, y = r() * h; ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + 14, y - 8, x + 30, y); ctx.quadraticCurveTo(x + 44, y + 8, x + 60, y); ctx.stroke(); }
    }, { repeat: [5, 5] });
    const sea = this.sea = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({ map: waves, roughness: 0.28, metalness: 0.05 }));
    sea.rotation.x = -Math.PI / 2; sea.position.set(cx, 0.1, cz); sea.receiveShadow = true; scene.add(sea);
  }

  // ---------------------------------------------------------------- 陸地（石ごとの円盤＋道の帯。つなげると県の形になる）
  buildLand() {
    const g = this.landGroup = new THREE.Group(); this.scene.add(g);
    const grass = new THREE.MeshStandardMaterial({ color: 0x92cf79, roughness: 0.95 });
    const sand = new THREE.MeshStandardMaterial({ color: 0xe9d9a7, roughness: 1 });
    const mk = (geo, mat, x, y, z, rot = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.y = rot; m.receiveShadow = true; m.castShadow = false; g.add(m); return m; };
    NG.MUNI.forEach((m) => {
      const p = tilePos(m.i); const big = m.isl ? 1.55 : 1.8;
      mk(new THREE.CylinderGeometry(big + 0.22, big + 0.3, 0.2, 32), sand, p.x, 0.1, p.z);
      mk(new THREE.CylinderGeometry(big, big + 0.05, 0.3, 32), grass, p.x, 0.15, p.z);
    });
    NG.EDGES.forEach(([a, b]) => {
      if (NG.isFerry(a, b)) return;
      const A = tilePos(a), B = tilePos(b), L = A.distanceTo(B), mid = A.clone().add(B).multiplyScalar(0.5), rot = Math.atan2(B.x - A.x, B.z - A.z);
      mk(new THREE.BoxGeometry(1.9, 0.2, L), sand, mid.x, 0.1, mid.z, rot);
      mk(new THREE.BoxGeometry(1.5, 0.3, L), grass, mid.x, 0.15, mid.z, rot);
    });
  }

  // ---------------------------------------------------------------- 石畳（市町村）
  tileTexture(i) {
    const is = NG.ISSUES[this.assign[i]];
    return canvasTex(256, 256, (ctx, w, h) => {
      ctx.fillStyle = '#d8d2c4'; ctx.fillRect(0, 0, w, h);
      ctx.beginPath(); ctx.arc(128, 128, 112, 0, TAU); ctx.fillStyle = is.c; ctx.fill();
      ctx.beginPath(); ctx.arc(128, 128, 112, 0, TAU); ctx.lineWidth = 8; ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = `900 150px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(is.g, 128, 138);
    });
  }
  labelTexture(i) {
    const is = NG.ISSUES[this.assign[i]], name = NG.NAMES[i];
    return canvasTex(300, 100, (ctx, w, h) => {
      rrect(ctx, 4, 4, w - 8, h - 8, 22); ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.fill(); ctx.lineWidth = 5; ctx.strokeStyle = is.c; ctx.stroke();
      ctx.fillStyle = '#1d2433'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      let fs = 34; ctx.font = `800 ${fs}px ${FONT}`; while (ctx.measureText(name).width > w - 30 && fs > 20) { fs -= 2; ctx.font = `800 ${fs}px ${FONT}`; }
      ctx.fillText(name, w / 2, 32);
      fs = 26; ctx.font = `700 ${fs}px ${FONT}`; while (ctx.measureText(is.k).width > w - 30 && fs > 14) { fs -= 2; ctx.font = `700 ${fs}px ${FONT}`; }
      ctx.fillStyle = is.c; ctx.fillText(is.k, w / 2, 70);
    });
  }
  buildTiles() {
    const stone = new THREE.MeshStandardMaterial({ color: 0xcfc8b8, roughness: 0.8 });
    NG.MUNI.forEach((m) => {
      const p = tilePos(m.i), grp = new THREE.Group(); grp.position.set(p.x, 0, p.z);
      const side = new THREE.Mesh(new THREE.CylinderGeometry(TILE_R, TILE_R + 0.06, TILE_TOP - 0.2, 28), stone); side.position.y = (TILE_TOP + 0.2) / 2; side.castShadow = true; side.receiveShadow = true;
      const topMat = new THREE.MeshStandardMaterial({ map: this.tileTexture(m.i), roughness: 0.6 });
      const top = new THREE.Mesh(new THREE.CircleGeometry(TILE_R - 0.02, 28), topMat); top.rotation.x = -Math.PI / 2; top.position.y = TILE_TOP + 0.002; top.receiveShadow = true;
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.labelTexture(m.i), transparent: true })); sp.scale.set(2.1, 0.7, 1); sp.position.y = 1.05; sp.renderOrder = 6;
      const hit = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.15, 0.8, 16), new THREE.MeshBasicMaterial({ visible: false })); hit.position.y = 0.4; hit.userData.tile = m.i;
      grp.add(side, top, sp, hit); this.scene.add(grp);
      this.tiles[m.i] = { grp, top, topMat, sprite: sp, hit, side };
    });
  }
  /** 課題の割り当てを描き直す */
  setAssign(assign) {
    this.assign = [...assign];
    this.tiles.forEach((t, i) => {
      t.topMat.map.dispose(); t.topMat.map = this.tileTexture(i); t.topMat.needsUpdate = true;
      t.sprite.material.map.dispose(); t.sprite.material.map = this.labelTexture(i); t.sprite.material.needsUpdate = true;
    });
  }
  buildEdges() {
    // 石畳の道（飛び石）と、島をつなぐ船
    const stone = new THREE.MeshStandardMaterial({ color: 0xe6dfcf, roughness: 0.85 });
    this.boats = [];
    NG.EDGES.forEach(([a, b]) => {
      const A = tilePos(a), B = tilePos(b), L = A.distanceTo(B), dir = B.clone().sub(A).normalize();
      if (NG.isFerry(a, b)) {
        const n = Math.floor(L / 0.9);
        const dots = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xbfe6ff, emissiveIntensity: 0.6 }));
        for (let k = 1; k < n; k++) { const d = dots.clone(); d.position.copy(A).addScaledVector(dir, (L * k) / n); d.position.y = 0.2; this.scene.add(d); }
        const boat = new THREE.Group();
        const hull = new THREE.Mesh(new RoundedBoxGeometry(1.0, 0.28, 0.46, 3, 0.1), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 }));
        const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.08, 0.48), new THREE.MeshStandardMaterial({ color: 0xe63946 })); stripe.position.y = -0.04;
        const cab = new THREE.Mesh(new RoundedBoxGeometry(0.4, 0.28, 0.34, 2, 0.06), new THREE.MeshStandardMaterial({ color: 0xf4a261 })); cab.position.set(-0.1, 0.26, 0);
        boat.add(hull, stripe, cab); boat.userData = { A, B, ph: Math.random() * 6 }; this.scene.add(boat); this.boats.push(boat);
        return;
      }
      const n = Math.max(1, Math.round(L / 0.75));
      for (let k = 1; k < n; k++) {
        const s = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.1, 10), stone);
        s.position.copy(A).addScaledVector(dir, (L * k) / n); s.position.y = 0.33 + 0.01 * (k % 2); s.position.x += Math.sin(k * 12.9 + a) * 0.1; s.receiveShadow = true; this.scene.add(s);
      }
    });
  }

  // ---------------------------------------------------------------- 飾り（山・木・川・風車・案内）
  buildDecor() {
    const { scene } = this; const r = mulberry32(2026);
    const tilesXZ = NG.MUNI.map((m) => [m.x * K, m.y * K]);
    const nearTile = (x, z, d) => tilesXZ.some(([a, b]) => Math.hypot(a - x, b - z) < d);
    // 隣県の山（東と南）。雪をかぶった円錐
    const rock = new THREE.MeshStandardMaterial({ color: 0x7e9a7a, roughness: 0.95, flatShading: true });
    const snow = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true });
    const base = new THREE.Mesh(new THREE.BoxGeometry(11.5, 0.6, 38), new THREE.MeshStandardMaterial({ color: 0x9db98c, roughness: 1 })); base.position.set(12.6, 0.12, -1.1); base.receiveShadow = true; scene.add(base);
    const base2 = new THREE.Mesh(new THREE.BoxGeometry(14, 0.6, 7.2), new THREE.MeshStandardMaterial({ color: 0x9db98c, roughness: 1 })); base2.position.set(5.5, 0.12, 15.5); base2.receiveShadow = true; scene.add(base2);
    const peak = (x, z, s) => {
      const h = 2.2 + r() * 2.6 * s, rad = 1.5 + r() * 1.3 * s;
      const m = new THREE.Mesh(new THREE.ConeGeometry(rad, h, 7), rock); m.position.set(x, h / 2 + 0.4, z); m.castShadow = true; scene.add(m);
      const c = new THREE.Mesh(new THREE.ConeGeometry(rad * 0.46, h * 0.42, 7), snow); c.position.set(x, h * 0.8 + 0.4, z); scene.add(c);
    };
    for (let i = 0; i < 20; i++) peak(8.8 + r() * 8, -17 + r() * 32, 1);
    for (let i = 0; i < 8; i++) peak(-1.5 + r() * 14, 12.8 + r() * 5, 0.8);
    // 木（円錐の松）
    const trunk = new THREE.MeshStandardMaterial({ color: 0x7a5a3a }), leaf = new THREE.MeshStandardMaterial({ color: 0x2f8f5b, roughness: 0.9, flatShading: true });
    let placed = 0, guard = 0;
    while (placed < 90 && guard++ < 1500) {
      const t = NG.MUNI[Math.floor(r() * 30)], a = r() * TAU, d = 1.1 + r() * 1.0;
      const x = t.x * K + Math.cos(a) * d * 1.25, z = t.y * K + Math.sin(a) * d * 1.25;
      if (nearTile(x, z, 1.55)) continue; placed++;
      const s = 0.55 + r() * 0.45;
      const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.4 * s, 6), trunk); tr.position.set(x, 0.5, z);
      const lf = new THREE.Mesh(new THREE.ConeGeometry(0.34 * s, 0.9 * s, 7), leaf); lf.position.set(x, 0.3 + 0.7 * s, z); lf.castShadow = true;
      scene.add(tr, lf);
    }
    // 川（信濃川・阿賀野川）
    const water = new THREE.MeshStandardMaterial({ color: 0x5bb8ec, roughness: 0.2, emissive: 0x1d5f8f, emissiveIntensity: 0.25 });
    const river = (ids) => ids.slice(1).forEach((b, k) => {
      const A = tilePos(ids[k]), B = tilePos(b), L = A.distanceTo(B), mid = A.clone().add(B).multiplyScalar(0.5);
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.03, L), water); m.position.set(mid.x + 0.5, 0.335, mid.z + 0.3); m.rotation.y = Math.atan2(B.x - A.x, B.z - A.z); scene.add(m);
    });
    river([22, 21, 20, 1, 2, 5, 0]); river([15, 9, 0]);
    // 風車（海沿い）
    this.turbines = [];
    [[18, -2.5, 0.4], [12, -2.3, -0.4], [13, -2.2, -0.2], [29, -2.2, 0.8]].forEach(([i, dx, dz]) => {
      const p = tilePos(i); const g = new THREE.Group(); g.position.set(p.x + dx, 0.3, p.z + dz);
      const tw = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.1, 2.4, 8), new THREE.MeshStandardMaterial({ color: 0xffffff })); tw.position.y = 1.2; tw.castShadow = true;
      const hub = new THREE.Group(); hub.position.set(0, 2.45, 0.1);
      for (let k = 0; k < 3; k++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.1, 0.02), new THREE.MeshStandardMaterial({ color: 0xffffff })); b.position.y = 0.55; const holder = new THREE.Group(); holder.rotation.z = (k * TAU) / 3; holder.add(b); hub.add(holder); }
      g.add(tw, hub); scene.add(g); this.turbines.push(hub);
    });
    // 道しるべ：北の標識
    const north = canvasTex(128, 128, (ctx) => { ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.beginPath(); ctx.arc(64, 64, 58, 0, TAU); ctx.fill(); ctx.fillStyle = '#c0392b'; ctx.font = `900 64px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('北', 64, 70); });
    const ns = new THREE.Sprite(new THREE.SpriteMaterial({ map: north, transparent: true })); ns.scale.set(1.6, 1.6, 1); ns.position.set(-11.5, 1.6, -13.2); scene.add(ns);
    // 日本海のラベル
    const sea = canvasTex(256, 64, (ctx) => { ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.font = `800 40px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.letterSpacing = '8px'; ctx.fillText('日本海', 128, 34); });
    const ss = new THREE.Sprite(new THREE.SpriteMaterial({ map: sea, transparent: true })); ss.scale.set(5.2, 1.3, 1); ss.position.set(-13, 0.9, -3); scene.add(ss);
  }

  // ---------------------------------------------------------------- 集まりの石・半径の輪
  buildRings() {
    const dash = (color) => canvasTex(512, 16, (ctx, w, h) => { ctx.clearRect(0, 0, w, h); ctx.fillStyle = color; for (let x = 0; x < w; x += 32) ctx.fillRect(x, 0, 18, h); }, { repeat: [1, 1] });
    const mkRing = (rad, color, opacity) => {
      const m = new THREE.Mesh(new THREE.RingGeometry(rad - 0.09, rad + 0.09, 128), new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false }));
      m.rotation.x = -Math.PI / 2; m.visible = false; this.scene.add(m); return m;
    };
    this.ringGather = mkRing(3 * K, 0xffc83d, 0.95);
    this.ringStart = mkRing(7 * K, 0xffffff, 0.45);
    this.ringFill = new THREE.Mesh(new THREE.CircleGeometry(3 * K, 64), new THREE.MeshBasicMaterial({ color: 0xffd24a, transparent: true, opacity: 0.16, depthWrite: false }));
    this.ringFill.rotation.x = -Math.PI / 2; this.ringFill.visible = false; this.scene.add(this.ringFill);
    // 集まりの石の目印（赤い鳥居）
    const red = new THREE.MeshStandardMaterial({ color: 0xd9382c, roughness: 0.5 }), blk = new THREE.MeshStandardMaterial({ color: 0x1b1b1b });
    const t = this.torii = new THREE.Group();
    [-0.7, 0.7].forEach((x) => { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 2.1, 10), red); p.position.set(x, 1.05, 0); p.castShadow = true; t.add(p); });
    const b1 = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.16, 0.2), red); b1.position.y = 1.9; const b2 = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.1, 0.16), red); b2.position.y = 1.62;
    const cap = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.1, 0.28), blk); cap.position.y = 2.02;
    t.add(b1, b2, cap); t.visible = false; this.scene.add(t);
    this.beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 6, 8, 1, true), new THREE.MeshBasicMaterial({ color: 0xffe28a, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide }));
    this.beacon.visible = false; this.scene.add(this.beacon);
  }
  setCenter(c) {
    this.center = c;
    const on = c != null; [this.ringGather, this.ringStart, this.ringFill, this.torii, this.beacon].forEach((o) => { o.visible = on; });
    if (!on) return;
    const p = tilePos(c);
    [this.ringGather, this.ringStart, this.ringFill].forEach((o) => o.position.set(p.x, 0.5, p.z));
    this.torii.position.set(p.x, TILE_TOP, p.z - 0.05); this.beacon.position.set(p.x, 3.4, p.z);
  }

  // ---------------------------------------------------------------- 雪・パーティクル
  buildSnow() {
    const N = 160, geo = new THREE.BufferGeometry();
    this.snowPos = new Float32Array(N * 3); this.snowVel = []; const rr = mulberry32(71);
    for (let i = 0; i < N; i++) { this.snowPos.set([(rr() - 0.5) * 44 - 1.7, rr() * 16, (rr() - 0.5) * 44 - 1], i * 3); this.snowVel.push([(rr() - 0.4) * 0.4, -0.45 - rr() * 0.5, (rr() - 0.5) * 0.3, rr() * 6]); }
    geo.setAttribute('position', new THREE.BufferAttribute(this.snowPos, 3));
    const dot = canvasTex(32, 32, (ctx) => { const g = ctx.createRadialGradient(16, 16, 1, 16, 16, 15); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, 32, 32); });
    this.snow = new THREE.Points(geo, new THREE.PointsMaterial({ map: dot, color: 0xffffff, size: 0.34, transparent: true, opacity: 0.95, depthWrite: false }));
    this.snow.frustumCulled = false; this.scene.add(this.snow);
  }
  buildParticles() {
    const MAX = 500; this.pMax = MAX; this.pPos = new Float32Array(MAX * 3); this.pCol = new Float32Array(MAX * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3));
    const dot = canvasTex(64, 64, (ctx) => { const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64); });
    this.pPoints = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.42, map: dot, vertexColors: true, transparent: true, depthWrite: false }));
    this.pPoints.frustumCulled = false; this.scene.add(this.pPoints);
    this.pData = Array.from({ length: MAX }, () => ({ life: 0 })); this.pPos.fill(-999);
  }
  burst(pos, { color = '#ffffff', n = 14, speed = 2.2, life = 0.7, up = 1.2, gravity = 3, spread = 1 } = {}) {
    const c = new THREE.Color(color);
    for (let k = 0; k < n; k++) {
      const i = this.pData.findIndex((d) => d.life <= 0); if (i < 0) return;
      const a = Math.random() * TAU, s = (0.4 + Math.random() * 0.8) * speed * spread;
      Object.assign(this.pData[i], { life: life * (0.6 + Math.random() * 0.6), max: life, vx: Math.cos(a) * s, vy: up * (0.5 + Math.random()), vz: Math.sin(a) * s, g: gravity, x: pos.x, y: pos.y, z: pos.z });
      this.pCol.set([c.r, c.g, c.b], i * 3);
    }
  }
  confetti(at) { ['#ff5a5f', '#ffd24a', '#2ec4b6', '#4d8bff', '#ff7eb6', '#a06bff'].forEach((c) => this.burst(new THREE.Vector3(at.x, 4.5, at.z), { color: c, n: 10, speed: 3.2, up: 1, gravity: 4, life: 2.4, spread: 1.4 })); }

  // ---------------------------------------------------------------- サイコロ（1〜3の面を使う）
  buildDice() {
    const pips = { 1: [4], 2: [2, 6], 3: [2, 4, 6], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
    const face = (n) => canvasTex(128, 128, (ctx, w, h) => {
      ctx.fillStyle = '#fffdf7'; ctx.fillRect(0, 0, w, h); ctx.strokeStyle = '#e4dccb'; ctx.lineWidth = 8; ctx.strokeRect(0, 0, w, h);
      for (const k of pips[n]) { ctx.beginPath(); ctx.arc(32 + (k % 3) * 32, 32 + Math.floor(k / 3) * 32, 11, 0, TAU); ctx.fillStyle = n === 1 ? '#e63946' : '#26303f'; ctx.fill(); }
    });
    const faces = [3, 4, 1, 6, 2, 5].map((n) => new THREE.MeshStandardMaterial({ map: face(n), roughness: 0.35 }));
    const die = this.die = new THREE.Mesh(new RoundedBoxGeometry(1.05, 1.05, 1.05, 4, 0.16), faces); die.castShadow = true; die.visible = false; this.scene.add(die);
    const e = (x, y, z) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z));
    this.dieUp = { 1: e(0, 0, 0), 6: e(Math.PI, 0, 0), 2: e(-Math.PI / 2, 0, 0), 5: e(Math.PI / 2, 0, 0), 3: e(0, 0, Math.PI / 2), 4: e(0, 0, -Math.PI / 2) };
  }

  // ---------------------------------------------------------------- AI審査員（鬼審査員ロボ）
  buildJudge() {
    const parts = makeRobot('#7a1f2b', 6); parts.root.scale.setScalar(1.25);
    const mono = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.025, 8, 20), new THREE.MeshStandardMaterial({ color: 0xffd24a, metalness: 0.7, roughness: 0.3 })); mono.position.set(0.22, 0.04, 0.52); parts.head.add(mono);
    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.06, 0.05), new THREE.MeshStandardMaterial({ color: 0x1b1b1b })); brow.position.set(0, 0.28, 0.5); brow.rotation.z = -0.12; parts.head.add(brow);
    const label = canvasTex(300, 90, (ctx, w, h) => { rrect(ctx, 4, 4, w - 8, h - 8, 24); ctx.fillStyle = 'rgba(122,31,43,.92)'; ctx.fill(); ctx.lineWidth = 5; ctx.strokeStyle = '#ffd24a'; ctx.stroke(); ctx.fillStyle = '#fff'; ctx.font = `800 36px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('鬼審査員', w / 2, 46); });
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: label, transparent: true, depthTest: false })); sp.scale.set(2.6, 0.78, 1); sp.position.y = 3.3; sp.renderOrder = 9; parts.root.add(sp);
    this.judge = { ...parts, shake: 0, think: false, base: new THREE.Vector3(0, 4.6, 0) };
    parts.root.visible = false; this.scene.add(parts.root);
  }

  // ============================================================== ロボット
  roleLabel(r) {
    const { c, tex } = r.label; const ctx = c.getContext('2d'); const w = c.width, h = c.height; ctx.clearRect(0, 0, w, h);
    rrect(ctx, 6, 6, w - 12, h - 12, 30); ctx.fillStyle = 'rgba(22,28,42,.86)'; ctx.fill(); ctx.lineWidth = 6; ctx.strokeStyle = r.color; ctx.stroke();
    let fs = 38; ctx.font = `800 ${fs}px ${FONT}`; while (ctx.measureText(r.name).width > w - 50 && fs > 20) { fs -= 2; ctx.font = `800 ${fs}px ${FONT}`; }
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(r.name, w / 2, 42);
    const role = RL.byId(r.role); const txt = role ? `${role.icon} ${role.name}` : '';
    fs = 25; ctx.font = `700 ${fs}px ${FONT}`; while (ctx.measureText(txt).width > w - 34 && fs > 13) { fs -= 1; ctx.font = `700 ${fs}px ${FONT}`; }
    ctx.fillStyle = r.color; ctx.fillText(txt, w / 2, 90); tex.needsUpdate = true;
  }
  addRobot(p) {
    const color = roleColor(p.role);
    const parts = makeRobot(color, p.color);
    const c = document.createElement('canvas'); c.width = 380; c.height = 124;
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    sprite.scale.set(3.0, 0.98, 1); sprite.position.y = 2.8; sprite.renderOrder = 9; parts.root.add(sprite);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.8, 1.0, 40), new THREE.MeshBasicMaterial({ color: 0xffd24a, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.04; ring.visible = false; parts.root.add(ring);
    const r = { id: p.id, name: p.name, role: p.role, color, tile: p.tile ?? 0, ...parts, label: { c, tex }, sprite, ring, base: new THREE.Vector3(), yaw: 0, yawTarget: 0, fx: { y: 0, sy: 0, armR: 0, armL: 0, shake: 0, spin: 0, flash: 0, tilt: 0, scale: 1 }, hopping: false, phase: Math.random() * 10, gone: false };
    this.roleLabel(r); this.scene.add(parts.root); this.robots.set(p.id, r); return r;
  }
  removeRobot(id) { const r = this.robots.get(id); if (!r) return; this.scene.remove(r.root); this.robots.delete(id); }
  slotPos(r) {
    const mates = [...this.robots.values()].filter((o) => o.tile === r.tile).sort((a, b) => (a.id < b.id ? -1 : 1)), n = mates.length, i = Math.max(0, mates.indexOf(r)), c = tilePos(r.tile);
    if (n <= 1) return c; const t = (i / n) * TAU, R = 0.45; return c.add(new THREE.Vector3(Math.cos(t) * R, 0, Math.sin(t) * R));
  }
  faceCenter(r) { if (this.center == null) return; const c = tilePos(this.center); r.yawTarget = Math.atan2(c.x - r.base.x, c.z - r.base.z); }

  /** サーバの最新状態に、演出なしで合わせる（途中参加・再接続・ロビー） */
  sync(s) {
    this.setAssign(s.assign);
    const ids = new Set(s.players.map((p) => p.id));
    for (const id of [...this.robots.keys()]) if (!ids.has(id)) this.removeRobot(id);
    const lobby = s.phase === 'lobby', LOBBY = [0, 1, 26, 13];
    this.setCenter(lobby ? null : s.center);
    s.players.forEach((p, i) => {
      const r = this.robots.get(p.id) || this.addRobot({ ...p, tile: lobby ? LOBBY[i] : p.tile });
      r.name = p.name; r.role = p.role; r.color = roleColor(p.role);
      r.root.traverse(() => {}); this.roleLabel(r);
      r.mats.forEach((m) => m.color.set(r.color));
      if (!r.hopping) { r.tile = lobby ? LOBBY[i] : (p.tile ?? LOBBY[i]); }
      r.fx.scale = 1; r.fx.y = 0;
    });
    this.robots.forEach((r) => { r.base.copy(this.slotPos(r)); if (!this._synced) { this.faceCenter(r); r.yaw = r.yawTarget; } });
    if (!lobby) this.robots.forEach((r) => this.faceCenter(r));
    this._synced = true;
    this.setOptions([]); this.die.visible = false;
    if (s.theme && (s.phase === 'debate' || s.phase === 'over')) this.showOrb(s.theme, false); else this.clearOrb();
    this.judge.root.visible = s.phase === 'debate' || s.phase === 'over';
    this.wantRotate = lobby || s.phase === 'over';
    if (lobby) { this.focus.set(-1.7, 0.4, -1.1); this.focusDist = null; }
  }
  setTurn(id) { this.turnId = id; this.robots.forEach((r) => { r.ring.visible = r.id === id; }); }

  // ---------------------------------------------------------------- 行き先の石（クリックできる）
  setOptions(list) {
    this.optionSet = new Set(list);
    for (const [t, o] of this.options) if (!this.optionSet.has(t)) { this.scene.remove(o.group); this.options.delete(t); }
    for (const t of list) {
      if (this.options.has(t)) continue;
      const g = new THREE.Group(); const p = tilePos(t); g.position.set(p.x, 0, p.z);
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.95, 1.2, 40), new THREE.MeshBasicMaterial({ color: 0xffd24a, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2; ring.position.y = TILE_TOP + 0.05;
      const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.62, 16), new THREE.MeshStandardMaterial({ color: 0xffd24a, emissive: 0xffa500, emissiveIntensity: 0.7 }));
      arrow.rotation.x = Math.PI; g.add(ring, arrow); this.scene.add(g); this.options.set(t, { group: g, ring, arrow });
    }
  }
  onPick(fn) { this.pickHandler = fn; }
  onHover(fn) { this.hoverHandler = fn; }
  bindPicking() {
    const ray = new THREE.Raycaster(), v = new THREE.Vector2(); let down = null;
    const hits = () => ray.intersectObjects(this.tiles.map((t) => t.hit), false);
    const at = (e) => { const r = this.canvas.getBoundingClientRect(); v.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(v, this.camera); };
    this.canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
    this.canvas.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) { down = null; return; } down = null;
      at(e); const h = hits()[0]; if (h && this.optionSet.has(h.object.userData.tile) && this.pickHandler) this.pickHandler(h.object.userData.tile);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      at(e); const h = hits()[0], t = h ? h.object.userData.tile : null;
      this.canvas.style.cursor = t != null && this.optionSet.has(t) ? 'pointer' : '';
      if (t !== this.hoverTile) { this.hoverTile = t; if (this.hoverHandler) this.hoverHandler(t); }
    });
    this.canvas.addEventListener('pointerleave', () => { if (this.hoverTile != null) { this.hoverTile = null; if (this.hoverHandler) this.hoverHandler(null); } });
  }

  // ---------------------------------------------------------------- お題のオーブ（集まった立ち位置の課題が1つに束ねられる）
  clearOrb() { if (this.orb) { this.scene.remove(this.orb.group); this.orb = null; } }
  showOrb(theme, animate = true) {
    this.clearOrb();
    const pts = theme.items.map((i) => tilePos(i.tile)); const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length, cz = pts.reduce((s, p) => s + p.z, 0) / pts.length;
    const g = new THREE.Group(); const top = new THREE.Vector3(cx, 6.2, cz);
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.85, 1), new THREE.MeshStandardMaterial({ color: 0xfff1b8, emissive: 0xffc83d, emissiveIntensity: 1.1, roughness: 0.25, flatShading: true }));
    core.position.copy(top); g.add(core);
    const beams = theme.items.map((it) => {
      const base = tilePos(it.tile), col = NG.ISSUES[it.issueIdx].c;
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1, 8, 1, true), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide }));
      const mid = base.clone().add(top).multiplyScalar(0.5), len = base.distanceTo(top); m.position.copy(mid); m.scale.y = len;
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), top.clone().sub(base).normalize()); g.add(m); return m;
    });
    const tex = canvasTex(640, 150, (ctx, w, h) => { rrect(ctx, 6, 6, w - 12, h - 12, 34); ctx.fillStyle = 'rgba(255,248,222,.95)'; ctx.fill(); ctx.lineWidth = 7; ctx.strokeStyle = '#ffc83d'; ctx.stroke(); ctx.fillStyle = '#6a4300'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = `800 28px ${FONT}`; ctx.fillText('今回のお題', w / 2, 36); let fs = 44; ctx.font = `900 ${fs}px ${FONT}`; while (ctx.measureText(theme.title).width > w - 50 && fs > 18) { fs -= 2; ctx.font = `900 ${fs}px ${FONT}`; } ctx.fillStyle = '#1d2433'; ctx.fillText(theme.title, w / 2, 94); });
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false })); sp.scale.set(7.2, 1.7, 1); sp.position.set(cx, 8.1, cz); sp.renderOrder = 10; g.add(sp);
    g.scale.setScalar(animate ? 0.01 : 1); this.scene.add(g); this.orb = { group: g, core, beams, top };
    if (animate) this.tween(900, (k) => { g.scale.setScalar(Math.max(0.01, ease.out(k))); });
  }

  // ============================================================== 時間まわり
  tween(ms, fn, easing = (k) => k) { return new Promise((resolve) => this.tweens.push({ start: performance.now(), ms, fn, easing, resolve })); }
  wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

  // ============================================================== 出来事の再生
  async play(ev) {
    switch (ev.t) {
      case 'start': return this.evStart(ev);
      case 'turn': return this.evTurn(ev);
      case 'roll': return this.evRoll(ev);
      case 'move': return this.evMove(ev, false);
      case 'pull': return this.evMove(ev, true);
      case 'gathered': return this.evGathered(ev);
      case 'theme': return this.evTheme(ev);
      case 'debateStart': return this.evDebateStart(ev);
      case 'proposal': return this.evProposal(ev);
      case 'critique': return this.evCritique(ev);
      case 'final': return this.evFinal(ev);
      case 'lobby': this.robots.forEach((_, id) => this.removeRobot(id)); this.clearOrb(); this.setCenter(null); this.setOptions([]); this.setTurn(null); this.celebrate = null; this.judge.root.visible = false; this.wantRotate = true; this.focusDist = null; this.focus.set(-1.7, 0.4, -1.1); return this.wait(ev.ms);
      default: return this.wait(ev.ms || 0);
    }
  }
  async evStart(ev) {
    this.celebrate = null; this.clearOrb(); this.setOptions([]); this.judge.root.visible = false;
    this.robots.forEach((_, id) => this.removeRobot(id));
    this.setAssign(ev.assign); this.setCenter(ev.center);
    this.wantRotate = false; this.focusDist = null; this.focus.set(-1.7, 0.4, -1.1);
    const list = ev.players.map((p) => { const r = this.addRobot(p); r.tile = p.tile; r.base.copy(tilePos(p.tile)); this.faceCenter(r); r.yaw = r.yawTarget; r.fx.y = 14; r.root.visible = false; return r; });
    list.forEach((r, i) => setTimeout(() => {
      r.root.visible = true;
      this.tween(800, (k) => { const b = 1 - ease.out(k); r.fx.y = 14 * b * b; }).then(() => { r.fx.y = 0; this.burst(r.base.clone().setY(TILE_TOP), { color: '#e8dcc0', n: 10, speed: 1.6 }); });
    }, 200 + i * 220));
    await this.wait(ev.ms);
  }
  async evTurn(ev) {
    this.setOptions([]); this.die.visible = false; this.setTurn(ev.id);
    const r = this.robots.get(ev.id); if (r) { this.focus.copy(r.base); this.focus.y = 0.6; this.focus.lerp(tilePos(this.center ?? r.tile), 0.35); this.focusDist = null; this.wantRotate = false; }
    await this.wait(ev.ms);
  }
  async evRoll(ev) {
    const r = this.robots.get(ev.id); if (!r) return this.wait(ev.ms);
    const die = this.die; die.visible = true;
    const axis = new THREE.Vector3(Math.random() - 0.5, 1, Math.random() - 0.5).normalize(), final = this.dieUp[ev.dice];
    const origin = r.base.clone(); origin.y = 4.1; const q = new THREE.Quaternion();
    await this.tween(950, (k) => {
      const kk = ease.out(k), hop = Math.abs(Math.sin(k * Math.PI * 3)) * (1 - k) * 1.8;
      die.position.set(origin.x, origin.y + hop, origin.z); q.setFromAxisAngle(axis, (1 - kk) * 14); die.quaternion.copy(q).multiply(final); die.scale.setScalar(1 + (1 - k) * 0.25);
    });
    die.quaternion.copy(final); die.scale.setScalar(1); this.burst(origin, { color: '#ffe38a', n: 12, speed: 1.4, up: 0.6, gravity: 1 });
    this.setOptions(this.mine === ev.id ? (ev.options || []) : []);
    await this.wait(Math.max(0, ev.ms - 950 - 350));
    await this.tween(350, (k) => { die.position.y = origin.y + k * 1.2; die.scale.setScalar(1 - k); });
    die.visible = false;
  }
  async evMove(ev, pull) {
    const r = this.robots.get(ev.id); if (!r) return this.wait(ev.ms);
    this.setOptions([]); this.die.visible = false;
    const per = ev.ms / Math.max(1, ev.path.length);
    for (const t of ev.path) {
      const from = r.base.clone(); r.tile = t; const to = this.slotPos(r);
      r.yawTarget = Math.atan2(to.x - from.x, to.z - from.z); this.focus.lerp(to, 0.5); r.hopping = true;
      const long = from.distanceTo(to) > 4;
      await this.tween(per, (k) => {
        r.base.set(lerp(from.x, to.x, k), lerp(from.y, to.y, k), lerp(from.z, to.z, k));
        r.fx.y = Math.sin(k * Math.PI) * (pull ? 1.6 : long ? 1.7 : 0.95);
        r.fx.sy = k < 0.15 ? -0.18 * (k / 0.15) : (k > 0.85 ? -0.18 * ((k - 0.85) / 0.15) : 0.1);
        if (pull && Math.random() < 0.5) this.burst(new THREE.Vector3(r.base.x, r.base.y + r.fx.y + 1, r.base.z), { color: '#ffd24a', n: 1, speed: 0.6, life: 0.5, up: 0.2, gravity: 0 });
      });
      r.fx.y = 0; r.fx.sy = 0; r.hopping = false;
      this.burst(new THREE.Vector3(to.x, TILE_TOP, to.z), { color: '#e9dfc7', n: 6, speed: 1.1, up: 0.5, life: 0.5 });
    }
    this.faceCenter(r);
  }
  async evGathered(ev) {
    this.setTurn(null); this.setOptions([]);
    const ps = [...this.robots.values()]; const c = new THREE.Vector3(); ps.forEach((r) => c.add(r.base)); c.multiplyScalar(1 / Math.max(1, ps.length));
    this.focus.copy(c); this.focus.y = 1.0; this.focusDist = 27; this.wantRotate = true;
    ps.forEach((r, i) => { this.faceCenter(r); setTimeout(() => { this.burst(r.base.clone().setY(2.2), { color: '#ffd24a', n: 14, speed: 2.2, up: 1.6, gravity: 2 }); r.fx.armL = -2.5; r.fx.armR = -2.5; setTimeout(() => { r.fx.armL = 0; r.fx.armR = 0; }, 900); }, i * 150); });
    await this.wait(ev.ms);
  }
  async evTheme(ev) { this.showOrb(ev.theme, true); this.wantRotate = true; await this.wait(ev.ms); }
  async evDebateStart(ev) {
    const j = this.judge; j.root.visible = true; j.root.scale.setScalar(0.01);
    const c = this.orb ? this.orb.top : new THREE.Vector3(0, 6, 0); j.base.set(c.x + 4.2, 5.4, c.z - 1.5);
    j.root.position.copy(j.base); await this.tween(800, (k) => { j.root.scale.setScalar(1.0 * Math.max(0.01, ease.out(k))); });
    this.setTurn(ev.writerId); await this.wait(Math.max(0, ev.ms - 800));
  }
  async evProposal(ev) {
    const r = this.robots.get(ev.sub.writerId); this.setTurn(ev.sub.writerId);
    if (r) { this.focus.copy(r.base); this.focus.y = 1.2; this.focusDist = 27; r.fx.armR = -2.2; this.burst(r.base.clone().setY(3.4), { color: '#ffffff', n: 12, speed: 1.6, up: 1.2, gravity: 1 }); }
    this.judge.think = true;
    await this.wait(ev.ms); if (r) r.fx.armR = 0;
  }
  async evCritique(ev) {
    const j = this.judge; j.think = false; j.shake = 1; this.burst(j.root.position.clone(), { color: '#ff5a5f', n: 20, speed: 3, up: 1, gravity: 2 });
    const pm = { yes: 'yes', maybe: 'maybe', no: 'no' };
    (ev.critique.reactions || []).forEach((rc, i) => { setTimeout(() => this.mood.set(rc.id, { t: performance.now(), m: pm[rc.mood] || 'maybe' }), 300 + i * 220); });
    await this.wait(ev.ms); j.shake = 0;
  }
  async evFinal(ev) {
    this.setTurn(null); this.wantRotate = true; this.focusDist = 32; this.focus.set(-1.7, 1, -1.1);
    this.robots.forEach((r) => { r.fx.armL = -2.7; r.fx.armR = -2.7; });
    for (let i = 0; i < 6; i++) setTimeout(() => this.confetti(this.orb ? this.orb.top : new THREE.Vector3()), i * 350);
    this.celebrate = { all: true };
    await this.wait(ev.ms);
  }

  // ============================================================== カメラ
  resize() {
    const w = this.canvas.clientWidth || window.innerWidth, h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); this.fitCamera();
  }
  fitCamera() {
    if (this._userMoved) return;
    const aspect = this.camera.aspect, vfov = THREE.MathUtils.degToRad(this.camera.fov);
    const needW = 38, dist = Math.max(36, needW / (2 * Math.tan(vfov / 2) * aspect) + 4);
    const dir = new THREE.Vector3(0, 0.66, 0.75).normalize();
    this.camera.position.copy(this.controls.target).addScaledVector(dir, Math.min(dist, 50));
  }

  // ============================================================== フレーム更新
  loop() {
    const nowT = performance.now(), dt = Math.min((nowT - this._last) / 1000, 0.1); this._last = nowT; this.time += dt;
    const t = this.time, now = performance.now();
    for (let i = this.tweens.length - 1; i >= 0; i--) { const tw = this.tweens[i], k = clamp01((now - tw.start) / Math.max(1, tw.ms)); tw.fn(tw.easing(k)); if (k >= 1) { this.tweens.splice(i, 1); tw.resolve(); } }

    this.robots.forEach((r) => {
      const fx = r.fx;
      if (!r.hopping) r.base.lerp(this.slotPos(r), 1 - Math.exp(-7 * dt));
      r.yaw += angDiff(r.yaw, r.yawTarget) * (1 - Math.exp(-10 * dt));
      const idle = Math.sin(t * 2.4 + r.phase);
      // 審査員への反応（うなずく・首をかしげる・ぷるぷる）
      const md = this.mood.get(r.id); let mx = 0, my = 0, mt = 0;
      if (md) { const k = (now - md.t) / 1400; if (k >= 1) this.mood.delete(r.id); else { const s = Math.sin(k * Math.PI); if (md.m === 'yes') my = Math.abs(Math.sin(k * Math.PI * 3)) * 0.7 * (1 - k); else if (md.m === 'no') mx = Math.sin(k * 40) * 0.12 * s; else mt = Math.sin(k * 10) * 0.18 * s; } }
      r.root.position.set(r.base.x + fx.shake + mx, r.base.y + fx.y + my, r.base.z);
      r.root.rotation.set(0, r.yaw + fx.spin, fx.tilt + mt); r.root.scale.setScalar(fx.scale);
      r.body.position.y = r.hopping ? 0 : 0.035 * idle; r.body.scale.set(1 - fx.sy * 0.5, 1 + fx.sy, 1 - fx.sy * 0.5);
      r.armR.rotation.x = fx.armR + (fx.armR === 0 ? Math.sin(t * 2.4 + r.phase + 1) * 0.08 : 0); r.armL.rotation.x = fx.armL + (fx.armL === 0 ? Math.sin(t * 2.4 + r.phase) * 0.08 : 0);
      r.armL.rotation.z = 0.08; r.armR.rotation.z = -0.08; r.head.rotation.z = Math.sin(t * 1.3 + r.phase) * 0.03; if (r.spin) r.spin.rotation.y = t * 14;
      r.eyes.scale.y = (Math.floor((t + r.phase) * 10) % 40) === 0 ? 0.1 : 1;
      if (r.ring.visible) { r.ring.rotation.z = t * 1.5; const s = 1 + Math.sin(t * 4) * 0.06; r.ring.scale.set(s, s, s); }
      r.sprite.position.y = 2.8 + 0.05 * Math.sin(t * 2 + r.phase);
    });
    if (this.celebrate && this.celebrate.all) this.robots.forEach((r) => { r.fx.y = Math.abs(Math.sin(t * 5 + r.phase)) * 0.6; r.fx.armL = -2.7 + Math.sin(t * 10) * 0.3; r.fx.armR = -2.7 - Math.sin(t * 10) * 0.3; });

    // 審査員ロボ
    const j = this.judge; if (j.root.visible) {
      const bob = Math.sin(t * 1.6) * 0.18;
      j.root.position.set(j.base.x + (j.shake ? Math.sin(t * 60) * 0.12 * j.shake : 0), j.base.y + bob, j.base.z);
      j.root.rotation.y = j.think ? t * 3 : Math.sin(t * 0.6) * 0.5; j.armR.rotation.x = j.think ? -2.0 + Math.sin(t * 8) * 0.3 : 0.1; j.armL.rotation.x = 0.1; if (j.spin) j.spin.rotation.y = t * 14;
    }
    // 行き先の石の点滅
    this.options.forEach((o, i) => { const s = 1 + Math.sin(t * 5 + i) * 0.08; o.ring.scale.set(s, s, s); o.ring.material.opacity = 0.65 + Math.sin(t * 5 + i) * 0.3; o.arrow.position.y = TILE_TOP + 1.1 + Math.sin(t * 5 + i) * 0.16; o.arrow.rotation.y = t * 2; });
    // ホバー中の石を少し浮かせる
    this.tiles.forEach((tl, i) => { const target = this.hoverTile === i ? 0.12 : 0; tl.grp.position.y = lerp(tl.grp.position.y, target, 1 - Math.exp(-12 * dt)); });
    // 輪・鳥居・ビーコン
    if (this.ringGather.visible) { this.ringGather.rotation.z = t * 0.15; this.ringFill.material.opacity = 0.13 + Math.sin(t * 2) * 0.04; this.beacon.material.opacity = 0.28 + Math.sin(t * 3) * 0.08; }
    // お題のオーブ
    if (this.orb) { this.orb.core.rotation.y = t * 1.2; this.orb.core.rotation.x = t * 0.7; this.orb.core.position.y = this.orb.top.y + Math.sin(t * 2) * 0.15; this.orb.beams.forEach((b, i) => { b.material.opacity = 0.5 + Math.sin(t * 3 + i) * 0.2; }); }
    // 海・船・風車
    this.waveTex.offset.set(t * 0.012, t * 0.008);
    this.boats.forEach((b) => { const { A, B, ph } = b.userData; const k = (Math.sin(t * 0.35 + ph) + 1) / 2; b.position.set(lerp(A.x, B.x, k), 0.22 + Math.sin(t * 2 + ph) * 0.04, lerp(A.z, B.z, k)); b.rotation.y = Math.atan2(B.x - A.x, B.z - A.z) + Math.PI / 2 * (Math.cos(t * 0.35 + ph) >= 0 ? -1 : 1) + Math.PI; b.rotation.z = Math.sin(t * 1.8 + ph) * 0.05; });
    this.turbines.forEach((h) => { h.rotation.z -= dt * 1.1; });
    // 雪
    const sp = this.snowPos;
    for (let i = 0; i < this.snowVel.length; i++) { const v = this.snowVel[i]; sp[i * 3] += (v[0] + Math.sin(t * 0.8 + v[3]) * 0.3) * dt; sp[i * 3 + 1] += v[1] * dt; sp[i * 3 + 2] += (v[2] + Math.cos(t * 0.7 + v[3]) * 0.25) * dt; if (sp[i * 3 + 1] < 0.4) { sp[i * 3 + 1] = 14 + Math.random() * 3; sp[i * 3] = (Math.random() - 0.5) * 44 - 1.7; sp[i * 3 + 2] = (Math.random() - 0.5) * 44 - 1; } }
    this.snow.geometry.attributes.position.needsUpdate = true;
    // パーティクル
    let any = false;
    for (let i = 0; i < this.pMax; i++) { const d = this.pData[i]; if (d.life > 0) { d.life -= dt; any = true; d.vy -= d.g * dt; d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt; if (d.y < 0.05) { d.y = 0.05; d.vy *= -0.3; d.vx *= 0.8; d.vz *= 0.8; } this.pPos[i * 3] = d.x; this.pPos[i * 3 + 1] = d.y; this.pPos[i * 3 + 2] = d.z; if (d.life <= 0) this.pPos[i * 3 + 1] = -999; } }
    if (any || this._pDirty) { this.pPoints.geometry.attributes.position.needsUpdate = true; this.pPoints.geometry.attributes.color.needsUpdate = true; this._pDirty = any; }

    this.controls.target.lerp(this.focus, 1 - Math.exp(-3 * dt));
    if (this.focusDist) { const off = this.camera.position.clone().sub(this.controls.target), d = off.length(), nd = lerp(d, this.focusDist, 1 - Math.exp(-2.5 * dt)); this.camera.position.copy(this.controls.target).addScaledVector(off.normalize(), nd); }
    this.controls.autoRotate = !!this.wantRotate && !this.options.size;
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
