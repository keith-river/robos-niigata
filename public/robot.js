/* ミニロボットの3Dモデル（ロボ箱庭すごろくのモデルをそのまま利用）。color ごとに頭の飾りが変わる。 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/RoundedBoxGeometry.js';
const TAU = Math.PI * 2;

export function makeRobot(colorHex, variant) {
  const col = new THREE.Color(colorHex);
  const light = col.clone().lerp(new THREE.Color('#ffffff'), 0.4);
  const mMain = new THREE.MeshStandardMaterial({ color: col, roughness: 0.38, metalness: 0.12 });
  const mLight = new THREE.MeshStandardMaterial({ color: light, roughness: 0.34, metalness: 0.1 });
  const mDark = new THREE.MeshStandardMaterial({ color: 0x2d3343, roughness: 0.55, metalness: 0.35 });
  const mScreen = new THREE.MeshStandardMaterial({ color: 0x0d121b, roughness: 0.2, metalness: 0.5 });
  const mGlow = new THREE.MeshStandardMaterial({ color: 0xaaf7ff, emissive: 0x58e6ff, emissiveIntensity: 1.7 });
  const mAcc = new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.9 });
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  const add = (geo, m, x, y, z, parent = body) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true; parent.add(o); return o; };

  // 足
  [-1, 1].forEach((s) => { add(new RoundedBoxGeometry(0.36, 0.2, 0.52, 3, 0.07), mDark, s * 0.27, 0.1, 0.05); add(new THREE.CylinderGeometry(0.09, 0.1, 0.28, 8), mDark, s * 0.27, 0.32, 0); });
  // 胴
  add(new RoundedBoxGeometry(0.98, 0.8, 0.74, 5, 0.22), mMain, 0, 0.9, 0);
  add(new RoundedBoxGeometry(0.52, 0.32, 0.06, 3, 0.05), mLight, 0, 0.88, 0.37);
  add(new THREE.SphereGeometry(0.075, 10, 8), mAcc, 0, 0.88, 0.41);
  add(new THREE.CylinderGeometry(0.13, 0.15, 0.14, 8), mDark, 0, 1.36, 0);
  // 頭
  const head = new THREE.Group(); head.position.y = 1.82; body.add(head);
  add(new RoundedBoxGeometry(1.14, 0.82, 0.9, 5, 0.27), mLight, 0, 0, 0, head);
  add(new RoundedBoxGeometry(0.88, 0.52, 0.08, 3, 0.1), mScreen, 0, 0.02, 0.44, head);
  const eyes = new THREE.Group(); eyes.position.set(0, 0.06, 0.5); head.add(eyes);
  [-1, 1].forEach((s) => add(new RoundedBoxGeometry(0.15, 0.21, 0.04, 2, 0.05), mGlow, s * 0.21, 0.02, 0, eyes));
  const mouth = add(new RoundedBoxGeometry(0.22, 0.045, 0.03, 2, 0.02), mGlow, 0, -0.15, 0.5, head);
  const xeyes = new THREE.Group(); xeyes.position.set(0, 0.06, 0.5); xeyes.visible = false; head.add(xeyes);
  const mRed = new THREE.MeshStandardMaterial({ color: 0xff6b6b, emissive: 0xff3b3b, emissiveIntensity: 1.5 });
  [-1, 1].forEach((s) => [0.7, -0.7].forEach((r) => { const b = add(new THREE.BoxGeometry(0.24, 0.045, 0.03), mRed, s * 0.21, 0.02, 0, xeyes); b.rotation.z = r; }));
  [-1, 1].forEach((s) => { const ear = add(new THREE.CylinderGeometry(0.14, 0.14, 0.17, 12), mMain, s * 0.62, 0, 0, head); ear.rotation.z = Math.PI / 2; });
  // 頭の飾り（個体ごとに違う）
  let spin = null;
  switch (variant % 8) {
    case 0: add(new THREE.CylinderGeometry(0.03, 0.03, 0.34, 6), mDark, 0, 0.55, 0, head); add(new THREE.SphereGeometry(0.1, 10, 8), mAcc, 0, 0.76, 0, head); break;
    case 1: [-1, 1].forEach((s) => { const g = new THREE.Group(); g.position.set(s * 0.25, 0.4, 0); g.rotation.z = -s * 0.35; head.add(g); add(new THREE.CylinderGeometry(0.025, 0.025, 0.4, 6), mDark, 0, 0.2, 0, g); add(new THREE.SphereGeometry(0.085, 10, 8), mAcc, 0, 0.42, 0, g); }); break;
    case 2: [-1, 1].forEach((s) => { const c = add(new THREE.ConeGeometry(0.17, 0.3, 4), mMain, s * 0.34, 0.54, 0, head); c.rotation.z = -s * 0.25; c.rotation.y = Math.PI / 4; }); break;
    case 3: add(new RoundedBoxGeometry(0.08, 0.34, 0.62, 2, 0.03), mMain, 0, 0.55, 0, head); break;
    case 4: { add(new THREE.CylinderGeometry(0.03, 0.03, 0.22, 6), mDark, 0, 0.5, 0, head); spin = new THREE.Group(); spin.position.y = 0.62; head.add(spin); [0, Math.PI / 2].forEach((r) => { const b = add(new THREE.BoxGeometry(0.62, 0.025, 0.1), mAcc, 0, 0, 0, spin); b.rotation.y = r; }); break; }
    case 5: { const d = add(new THREE.SphereGeometry(0.2, 12, 8, 0, TAU, 0, Math.PI / 2), mAcc, 0, 0.4, 0, head); d.scale.y = 1.1; break; }
    case 6: add(new THREE.ConeGeometry(0.1, 0.4, 8), mAcc, 0, 0.6, 0, head); break;
    default: add(new THREE.CylinderGeometry(0.02, 0.02, 0.3, 6), mDark, 0, 0.5, 0, head); add(new THREE.SphereGeometry(0.15, 10, 8), mLight, 0, 0.7, 0, head);
  }
  // 腕（肩を支点に回転）
  const arms = [-1, 1].map((s) => {
    const a = new THREE.Group(); a.position.set(s * 0.62, 1.2, 0); body.add(a);
    add(new THREE.CapsuleGeometry(0.1, 0.32, 4, 8), mMain, 0, -0.24, 0, a);
    add(new THREE.SphereGeometry(0.15, 10, 8), mLight, 0, -0.52, 0, a);
    return a;
  });
  root.scale.setScalar(0.82);
  return { root, body, head, eyes, xeyes, mouth, armL: arms[0], armR: arms[1], spin, mats: [mMain, mLight] };
}
