(() => {
'use strict';
const $ = id => document.getElementById(id);
if (!window.THREE) { $('ovSub').textContent = 'The 3D engine did not load. Check your connection and reload the page.'; $('ovBtn').hidden = true; return; }
const TH = THREE;

/* ============================== constants ============================== */
const HX = 14, HZ = 7.5;                         // half length / half width of the court (m)
const HOOP_X = 12.35, BOARD_X = 12.8, RIM_Y = 3.05, RIM_R = 0.30, TUBE = 0.02, BALL_R = 0.15;
const ARC_R = 6.75;                              // three-point radius from the hoop centre
const G = 11;                                    // ball gravity, a little snappier than real
const GAME_SECONDS = 50;

// CPU difficulty. wind = tackle windup (s), every = seconds between tackle tries, dodge = chance to quickstep away,
// steal / land = chance the CPU's tackle / takedown connects, shotErr = CPU shot miss multiplier, jump + delay = chance
// and reaction time for contesting shots and passes, takedown = how often it picks a takedown, gap = how tight it guards.
const DIFFS = {
  veryEasy: { label: 'Very easy', speed: 0.70, wind: 0.60, every: [1.8, 3.0], dodge: 0.05, steal: 0.30, land: 0.30, shotErr: 1.7,  jump: 0.05, delay: 0.60, takedown: 0.00, gap: 1.8 },
  easy:     { label: 'Easy',      speed: 0.80, wind: 0.48, every: [1.2, 2.2], dodge: 0.20, steal: 0.45, land: 0.50, shotErr: 1.35, jump: 0.15, delay: 0.45, takedown: 0.05, gap: 1.5 },
  medium:   { label: 'Medium',    speed: 0.90, wind: 0.36, every: [0.8, 1.5], dodge: 0.40, steal: 0.60, land: 0.65, shotErr: 1.15, jump: 0.35, delay: 0.30, takedown: 0.15, gap: 1.2 },
  hard:     { label: 'Hard',      speed: 0.96, wind: 0.30, every: [0.55, 1.2], dodge: 0.60, steal: 0.70, land: 0.75, shotErr: 1.0,  jump: 0.50, delay: 0.20, takedown: 0.30, gap: 0.95 },
};
const DIFF_ORDER = ['veryEasy', 'easy', 'medium', 'hard'];
let DIFF = DIFFS.medium, diffId = 'medium';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const sgn = v => (v >= 0 ? 1 : -1);
const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const angDiff = (a, b) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
const dist2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
  const t = clamp(((px - ax) * dx + (pz - az) * dz) / l2, 0, 1);
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

/* ============================== renderer / scene ============================== */
const canvas = $('gl');
let renderer;
try {
  renderer = new TH.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch (e) {
  $('ovSub').textContent = 'WebGL is not available in this browser, so the court cannot be drawn.'; $('ovBtn').hidden = true; return;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = TH.PCFSoftShadowMap;
renderer.toneMapping = TH.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;

const scene = new TH.Scene();
scene.background = new TH.Color(0x05070d);
scene.fog = new TH.Fog(0x05070d, 38, 78);
const camera = new TH.PerspectiveCamera(45, 16 / 9, 0.5, 200);
let camScale = 1, camX = 0;

scene.add(new TH.HemisphereLight(0xcfd9ff, 0x4a3524, 0.75));
const sun = new TH.DirectionalLight(0xfff1dc, 1.0);
sun.position.set(-5, 26, 9);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -19, right: 19, top: 12, bottom: -12, near: 1, far: 60 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02; sun.shadow.radius = 3;
scene.add(sun);
// warm pools of light over each basket, no shadows (cheap)
for (const s of [-1, 1]) {
  const sp = new TH.SpotLight(0xffe2b8, 0.9, 40, 0.75, 0.7, 1.2);
  sp.position.set(s * 8, 18, 3); sp.target.position.set(s * 11, 0, 0);
  scene.add(sp, sp.target);
}

/* ---------- court floor ---------- */
function mulberry(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const DISPLAY_FONT = '"Big Shoulders Display", Impact, "Arial Narrow", sans-serif';
let courtCanvas = null;
function drawCourt() {
  const S = 96, W = 32 * S, H = 19 * S;
  if (!courtCanvas) { courtCanvas = document.createElement('canvas'); courtCanvas.width = W; courtCanvas.height = H; }
  const g = courtCanvas.getContext('2d');
  const rnd = mulberry(1234);
  const X = x => (x + 16) * S, Z = z => (z + 9.5) * S;

  // surround / apron
  const ap = g.createLinearGradient(0, 0, 0, H);
  ap.addColorStop(0, '#0d1424'); ap.addColorStop(0.5, '#141d33'); ap.addColorStop(1, '#0d1424');
  g.fillStyle = ap; g.fillRect(0, 0, W, H);

  // maple planks, run along the length of the court
  const x0 = X(-HX - 1.2), x1 = X(HX + 1.2), z0 = Z(-HZ - 1.2), z1 = Z(HZ + 1.2), plank = 0.1 * S;
  g.save(); g.beginPath(); g.rect(x0, z0, x1 - x0, z1 - z0); g.clip();
  for (let y = z0, i = 0; y < z1; y += plank, i++) {
    let x = x0 - rnd() * 2.2 * S;
    while (x < x1) {
      const len = (1.4 + rnd() * 1.6) * S, v = rnd();
      const L = 47 + v * 7 + (i % 3) * 0.8;
      g.fillStyle = `hsl(${29 + v * 5},${72 + v * 8}%,${L}%)`;
      g.fillRect(x, y, len, plank);
      g.fillStyle = 'rgba(95,52,18,.30)'; g.fillRect(x, y, len, 1);          // plank seam
      g.fillRect(x, y, 1, plank);                                              // butt joint
      for (let k = 0; k < 5; k++) {                                            // grain
        g.fillStyle = `rgba(${rnd() < 0.5 ? '120,70,30' : '255,235,200'},${0.05 + rnd() * 0.07})`;
        g.fillRect(x + rnd() * len * 0.3, y + rnd() * plank, len * (0.3 + rnd() * 0.6), 1);
      }
      x += len;
    }
  }
  g.restore();
  // soft darkening of the sidelines/baseline apron
  g.fillStyle = 'rgba(8,14,30,.5)';
  g.beginPath(); g.rect(x0, z0, x1 - x0, z1 - z0); g.rect(X(-HX), Z(-HZ), 2 * HX * S, 2 * HZ * S); g.fill('evenodd');

  // painted keys: home defends the left hoop (blue), CPU the right (red)
  const key = (xa, xb, c0, c1) => {
    const gr = g.createLinearGradient(X(xa), 0, X(xb), 0); gr.addColorStop(0, c0); gr.addColorStop(1, c1);
    g.fillStyle = gr; g.fillRect(X(Math.min(xa, xb)), Z(-2.45), Math.abs(xb - xa) * S, 4.9 * S);
  };
  key(-HX, -HX + 5.8, 'rgba(28,62,210,.92)', 'rgba(52,92,245,.78)');
  key(HX, HX - 5.8, 'rgba(215,32,58,.92)', 'rgba(244,70,92,.78)');
  g.save(); g.lineCap = 'round'; g.lineJoin = 'round';
  g.fillStyle = 'rgba(255,255,255,.07)';
  for (const s of [-1, 1]) {                                                    // painted restricted-area disc
    g.beginPath(); g.arc(X(s * HOOP_X), Z(0), 1.25 * S, s > 0 ? Math.PI * 0.5 : -Math.PI * 0.5, s > 0 ? Math.PI * 1.5 : Math.PI * 0.5); g.fill();
  }
  g.restore();

  g.strokeStyle = '#f7f3ea'; g.lineWidth = 0.055 * S; g.lineJoin = 'round'; g.lineCap = 'butt';
  const circle = (cx, cz, r, a0 = 0, a1 = Math.PI * 2) => { g.beginPath(); g.arc(X(cx), Z(cz), r * S, a0, a1); g.stroke(); };
  const seg = (ax, az, bx, bz) => { g.beginPath(); g.moveTo(X(ax), Z(az)); g.lineTo(X(bx), Z(bz)); g.stroke(); };
  g.strokeRect(X(-HX), Z(-HZ), 2 * HX * S, 2 * HZ * S);
  seg(0, -HZ, 0, HZ);
  // centre circle with badge
  g.fillStyle = 'rgba(10,16,34,.55)'; g.beginPath(); g.arc(X(0), Z(0), 1.8 * S, 0, Math.PI * 2); g.fill();
  circle(0, 0, 1.8); circle(0, 0, 0.9);
  const delta = Math.asin(6.6 / ARC_R), xm = Math.sqrt(ARC_R * ARC_R - 6.6 * 6.6);
  for (const s of [-1, 1]) {
    const ftx = s * (HX - 5.8), hx = s * HOOP_X;
    g.strokeRect(X(Math.min(s * HX, ftx)), Z(-2.45), 5.8 * S, 4.9 * S);
    // free-throw circle: solid half toward midcourt, dashed half inside the key
    circle(ftx, 0, 1.8, s > 0 ? Math.PI * 0.5 : -Math.PI * 0.5, s > 0 ? Math.PI * 1.5 : Math.PI * 0.5);
    g.save(); g.setLineDash([0.22 * S, 0.2 * S]);
    circle(ftx, 0, 1.8, s > 0 ? -Math.PI * 0.5 : Math.PI * 0.5, s > 0 ? Math.PI * 0.5 : Math.PI * 1.5);
    g.restore();
    if (s > 0) circle(hx, 0, ARC_R, Math.PI - delta, Math.PI + delta); else circle(hx, 0, ARC_R, -delta, delta);
    seg(s * HX, -6.6, hx - s * xm, -6.6);
    seg(s * HX, 6.6, hx - s * xm, 6.6);
    circle(hx, 0, 1.25, s > 0 ? Math.PI * 0.5 : -Math.PI * 0.5, s > 0 ? Math.PI * 1.5 : Math.PI * 0.5);
    // lane hash marks
    for (const zz of [-2.45, 2.45]) for (const o of [1.8, 2.5, 3.4, 4.1]) {
      const px = s * HX - s * o, dz = zz > 0 ? 0.28 : -0.28;
      seg(px, zz, px, zz + dz);
    }
    // block + backboard footprint
    g.fillStyle = '#f7f3ea'; g.fillRect(X(hx - 0.04), Z(-0.9), 0.08 * S, 1.8 * S);
  }

  // centre-court logo and key lettering
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = 'rgba(255,200,60,.92)'; g.font = `900 ${1.05 * S}px ${DISPLAY_FONT}`;
  g.fillText('3v3', X(0), Z(0.04));
  g.fillStyle = 'rgba(255,255,255,.55)'; g.font = `800 ${0.34 * S}px ${DISPLAY_FONT}`;
  g.fillText('H A R D W O O D', X(0), Z(-1.45));
  for (const [s, label] of [[-1, 'HOME'], [1, 'CPU']]) {
    g.save(); g.translate(X(s * (HX - 2.9)), Z(0)); g.rotate(s > 0 ? Math.PI / 2 : -Math.PI / 2);
    g.fillStyle = 'rgba(255,255,255,.4)'; g.font = `900 ${1.4 * S}px ${DISPLAY_FONT}`; g.fillText(label, 0, 0); g.restore();
  }
  // subtle top-down sheen so the floor reads as lacquered
  const sh = g.createRadialGradient(X(0), Z(0), 1 * S, X(0), Z(0), 18 * S);
  sh.addColorStop(0, 'rgba(255,240,210,.05)'); sh.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = sh; g.fillRect(0, 0, W, H);
}
drawCourt();
const courtTex = new TH.CanvasTexture(courtCanvas);
courtTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
const floor = new TH.Mesh(new TH.PlaneGeometry(32, 19), new TH.MeshPhysicalMaterial({ map: courtTex, roughness: 0.34, metalness: 0, clearcoat: 0.55, clearcoatRoughness: 0.28 }));
floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
scene.add(floor);
const base = new TH.Mesh(new TH.PlaneGeometry(160, 120), new TH.MeshStandardMaterial({ color: 0x0a0d16, roughness: 1 }));
base.rotation.x = -Math.PI / 2; base.position.y = -0.03; scene.add(base);
if (document.fonts && document.fonts.load) {
  document.fonts.load('900 60px "Big Shoulders Display"').then(() => { drawCourt(); courtTex.needsUpdate = true; }).catch(() => {});
}

/* ---------- arena: LED ribbons, scorer's table, stands + crowd ---------- */
let ledTex = null;
const crowd = { joy: 0 };
(function makeArena() {
  // scrolling LED ribbon around the court
  const c = document.createElement('canvas'); c.width = 2048; c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, 64); gr.addColorStop(0, '#101a33'); gr.addColorStop(1, '#070b16');
  g.fillStyle = gr; g.fillRect(0, 0, 2048, 64);
  g.textBaseline = 'middle'; g.font = `800 38px ${DISPLAY_FONT}`;
  const items = [['HARDWOOD 3v3', '#ffc83d'], ['HOME', '#7fa2ff'], ['VS', '#ffffff'], ['CPU', '#ff8c99'], ['THREE MINUTES', '#ffffff'], ['SHOOT  PASS  TACKLE', '#ffb36b']];
  let x = 20; for (let k = 0; k < 12; k++) { const [t, col] = items[k % items.length]; g.fillStyle = col; g.fillText(t, x, 34); x += g.measureText(t).width + 60; if (x > 2000) break; }
  ledTex = new TH.CanvasTexture(c); ledTex.wrapS = TH.RepeatWrapping; ledTex.repeat.set(1.6, 1); ledTex.anisotropy = 4;
  const ledMat = new TH.MeshBasicMaterial({ map: ledTex, toneMapped: false, color: 0xd8d8d8 });
  const trim = new TH.MeshStandardMaterial({ color: 0x1a2136, roughness: 0.5, metalness: 0.5 });
  const mk = (w, h, d, px, py, pz, mat) => { const m = new TH.Mesh(new TH.BoxGeometry(w, h, d), mat); m.position.set(px, py, pz); scene.add(m); return m; };
  mk(32, 0.72, 0.14, 0, 0.4, -9.35, trim); mk(32, 0.62, 0.02, 0, 0.42, -9.27, ledMat);
  for (const s of [-1, 1]) { mk(0.14, 0.72, 17.4, s * 15.65, 0.4, -0.1, trim); const m = mk(0.02, 0.62, 17, s * 15.57, 0.42, -0.1, ledMat); m.rotation.y = Math.PI; }
  ledMat.map.repeat.set(1.6, 1);

  // scorer's table + team benches along the far sideline
  const wood = new TH.MeshStandardMaterial({ color: 0x1c2438, roughness: 0.6, metalness: 0.2 });
  const glow = new TH.MeshBasicMaterial({ color: 0xffc83d, toneMapped: false });
  const table = mk(5.2, 0.8, 0.7, 0, 0.4, -8.35, wood); table.castShadow = true; table.receiveShadow = true;
  mk(5.0, 0.06, 0.04, 0, 0.62, -8.0, glow);
  mk(1.0, 0.5, 0.02, -1.4, 1.05, -8.5, new TH.MeshStandardMaterial({ color: 0x0c1220, emissive: 0x15264d, roughness: 0.4 }));
  const bench = new TH.MeshStandardMaterial({ color: 0x2a3350, roughness: 0.7 });
  for (const [bx, col] of [[-7.2, 0x3a63ff], [7.2, 0xff4458]]) {
    const b = mk(3.2, 0.12, 0.5, bx, 0.45, -8.4, bench); b.castShadow = true;
    mk(3.2, 0.5, 0.06, bx, 0.75, -8.65, bench);
    mk(3.2, 0.02, 0.5, bx, 0.52, -8.4, new TH.MeshBasicMaterial({ color: col, toneMapped: false })).scale.set(1, 1, 0.12);
  }

  // stands
  const rnd = mulberry(77);
  const seatCols = [0x141a2b, 0x182036, 0x111726];
  const rows = 9, depth = 1.0, rise = 0.46;
  const people = [];
  const addRow = (cx, cz, len, alongX, r) => {
    const h = rise * (r + 1);
    const m = new TH.Mesh(new TH.BoxGeometry(alongX ? len : depth, h, alongX ? depth : len), new TH.MeshStandardMaterial({ color: seatCols[r % 3], roughness: 0.95 }));
    m.position.set(cx, h / 2, cz); scene.add(m);
    if (alongX) {
      const lip = new TH.Mesh(new TH.BoxGeometry(len, 0.04, 0.05), new TH.MeshBasicMaterial({ color: 0x2a3858, toneMapped: false }));
      lip.position.set(cx, h + 0.02, cz + depth / 2 - 0.03); scene.add(lip);
    }
  };
  const palette = ['#3b4256', '#5a3b3b', '#2f4a5f', '#6b5a3c', '#44335a', '#2e3f35', '#3a63ff', '#ff4458', '#8a8fa3', '#e8e2d0', '#1f2937', '#d4a437'].map(c => new TH.Color(c));
  const skins = [0xf1c9a5, 0xc68c5f, 0x8d5a3b, 0x5b3a25, 0xe3b48c].map(c => new TH.Color(c));
  const place = (x, y, z, nearX) => {
    if (rnd() < 0.1) return;                                                  // some empty seats
    const t = clamp((nearX + 22) / 44, 0, 1);
    let col = palette[Math.floor(rnd() * palette.length)];
    if (rnd() < 0.3) col = new TH.Color(t < 0.5 ? '#3a63ff' : '#ff4458').multiplyScalar(0.55 + rnd() * 0.5);
    people.push({ x: x + (rnd() - 0.5) * 0.16, y, z: z + (rnd() - 0.5) * 0.14, col, skin: skins[Math.floor(rnd() * skins.length)], ph: rnd() * 6.28 });
  };
  for (let r = 0; r < rows; r++) {
    const h = rise * (r + 1), bz = -(10.1 + depth / 2 + r * depth);
    addRow(0, bz, 50, true, r);
    for (let x = -22; x <= 22; x += 0.58) place(x, h, bz + 0.05, x);
    for (const s of [-1, 1]) {
      const bx = s * (16.5 + depth / 2 + r * depth);
      addRow(bx, 0, 19.4, false, r);
      for (let z = -9; z <= 9; z += 0.58) place(bx, h, z, s * 22);
    }
  }
  const bodyGeo = new TH.SphereGeometry(0.2, 8, 6); bodyGeo.scale(1, 1.25, 0.8); bodyGeo.translate(0, 0.28, 0);
  const headGeo = new TH.SphereGeometry(0.105, 8, 6); headGeo.translate(0, 0.66, 0);
  const bodies = new TH.InstancedMesh(bodyGeo, new TH.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }), people.length);
  const heads = new TH.InstancedMesh(headGeo, new TH.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 }), people.length);
  bodies.instanceMatrix.setUsage(TH.DynamicDrawUsage); heads.instanceMatrix.setUsage(TH.DynamicDrawUsage);
  const m4 = new TH.Matrix4();
  people.forEach((p, i) => { m4.makeTranslation(p.x, p.y, p.z); bodies.setMatrixAt(i, m4); heads.setMatrixAt(i, m4); bodies.setColorAt(i, p.col); heads.setColorAt(i, p.skin); });
  bodies.frustumCulled = heads.frustumCulled = false;
  scene.add(bodies, heads);
  crowd.people = people; crowd.bodies = bodies; crowd.heads = heads; crowd.m4 = m4;

  // dark upper wall with lit suites so the far background is not a void
  const wc = document.createElement('canvas'); wc.width = 1024; wc.height = 128;
  const wg = wc.getContext('2d'); wg.fillStyle = '#080b14'; wg.fillRect(0, 0, 1024, 128);
  const wr = mulberry(5);
  for (let x = 8; x < 1024; x += 38) { const lit = wr() < 0.7; wg.fillStyle = lit ? `hsl(${32 + wr() * 18},70%,${38 + wr() * 18}%)` : '#0d1424'; wg.fillRect(x, 30, 30, 62); }
  const wtex = new TH.CanvasTexture(wc); wtex.wrapS = TH.RepeatWrapping; wtex.repeat.set(2, 1);
  const wall = new TH.Mesh(new TH.PlaneGeometry(90, 9), new TH.MeshBasicMaterial({ map: wtex, color: 0x9a9aa6 }));
  wall.position.set(0, 8.8, -20.5); scene.add(wall);
})();
function updateCrowd(t, joy) {
  if (!crowd.people || joy <= 0.01) return;
  const { people, bodies, heads, m4 } = crowd;
  for (let i = 0; i < people.length; i++) {
    const p = people[i], j = Math.max(0, Math.sin(t * 11 + p.ph)) * 0.14 * joy;
    m4.makeTranslation(p.x, p.y + j, p.z); bodies.setMatrixAt(i, m4); heads.setMatrixAt(i, m4);
  }
  bodies.instanceMatrix.needsUpdate = heads.instanceMatrix.needsUpdate = true;
}

/* ---------- hoops + nets ---------- */
const nets = {};
const NET_N = 16, NET_ROWS = 7, NET_H = 0.45, NET_RB = 0.165;
function makeNet(s) {
  const nv = NET_N * (NET_ROWS + 1);
  const rest = new Float32Array(nv * 3), pos = new Float32Array(nv * 3), vel = new Float32Array(nv * 3), idxs = [];
  const id = (j, i) => j * NET_N + (((i % NET_N) + NET_N) % NET_N);
  for (let j = 0; j <= NET_ROWS; j++) for (let i = 0; i < NET_N; i++) {
    const u = j / NET_ROWS, a = (i + 0.5 * (j & 1)) / NET_N * Math.PI * 2;
    const r = lerp(RIM_R - 0.004, NET_RB, Math.pow(u, 0.75)), k = id(j, i) * 3;
    rest[k] = Math.cos(a) * r; rest[k + 1] = -NET_H * u; rest[k + 2] = Math.sin(a) * r;
    pos[k] = rest[k]; pos[k + 1] = rest[k + 1]; pos[k + 2] = rest[k + 2];
    if (j < NET_ROWS) { idxs.push(id(j, i), id(j + 1, i), id(j, i), id(j + 1, (j & 1) ? i + 1 : i - 1)); }
  }
  const geo = new TH.BufferGeometry();
  const attr = new TH.BufferAttribute(pos, 3); attr.setUsage(TH.DynamicDrawUsage);
  geo.setAttribute('position', attr); geo.setIndex(idxs);
  const mesh = new TH.LineSegments(geo, new TH.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.92 }));
  mesh.frustumCulled = false; mesh.position.set(s * HOOP_X, RIM_Y, 0);
  scene.add(mesh);
  nets[s] = { mesh, pulse: 0, prev: 0, rest, pos, vel, attr, side: s, ph: s * 1.7 };
}
function updateNets(dt, t) {
  dt = Math.min(dt, 0.033);
  for (const s of [-1, 1]) {
    const n = nets[s], { rest, pos, vel } = n;
    if (n.pulse > n.prev + 0.5) {                                   // a basket was just scored: swish impulse
      for (let j = 1; j <= NET_ROWS; j++) for (let i = 0; i < NET_N; i++) {
        const k = (j * NET_N + i) * 3, u = j / NET_ROWS;
        vel[k + 1] -= 2.4 * u; vel[k] -= pos[k] * 7 * u; vel[k + 2] -= pos[k + 2] * 7 * u;
      }
    }
    n.pulse = Math.max(0, n.pulse - dt * 2); n.prev = n.pulse;
    const bx = ball.x - s * HOOP_X, by = ball.y - RIM_Y, bz = ball.z;
    const near = Math.abs(bx) < 0.7 && Math.abs(bz) < 0.7 && by > -1.0 && by < 0.5;
    const sub = 2, h = dt / sub;
    for (let st = 0; st < sub; st++) {
      for (let j = 1; j <= NET_ROWS; j++) {
        const u = j / NET_ROWS, kS = 95 - 45 * u, cD = 3.4;
        for (let i = 0; i < NET_N; i++) {
          const k = (j * NET_N + i) * 3, a = i * 0.9 + j * 0.5 + n.ph;
          const wx = Math.sin(t * 1.5 + a) * 0.012 * u * u, wz = Math.cos(t * 1.15 + a * 1.3) * 0.012 * u * u;
          vel[k] += (kS * (rest[k] + wx - pos[k]) - cD * vel[k]) * h;
          vel[k + 1] += (kS * (rest[k + 1] - pos[k + 1]) - cD * vel[k + 1]) * h;
          vel[k + 2] += (kS * (rest[k + 2] + wz - pos[k + 2]) - cD * vel[k + 2]) * h;
          pos[k] += vel[k] * h; pos[k + 1] += vel[k + 1] * h; pos[k + 2] += vel[k + 2] * h;
          if (near) {                                              // the ball pushes the strands aside and drags them along
            const dx = pos[k] - bx, dy = pos[k + 1] - by, dz = pos[k + 2] - bz, L = Math.hypot(dx, dy, dz), md = BALL_R + 0.012;
            if (L < md && L > 1e-5) {
              const nx = dx / L, ny = dy / L, nz = dz / L;
              pos[k] = bx + nx * md; pos[k + 1] = by + ny * md; pos[k + 2] = bz + nz * md;
              vel[k] += (ball.vx - vel[k]) * 0.4; vel[k + 1] += (ball.vy - vel[k + 1]) * 0.4; vel[k + 2] += (ball.vz - vel[k + 2]) * 0.4;
              const vn = (vel[k] - ball.vx) * nx + (vel[k + 1] - ball.vy) * ny + (vel[k + 2] - ball.vz) * nz;
              if (vn < 0) { vel[k] -= vn * nx; vel[k + 1] -= vn * ny; vel[k + 2] -= vn * nz; }
            }
          }
        }
      }
    }
    n.attr.needsUpdate = true;
  }
}

function makeHoop(s) {
  const steel = new TH.MeshStandardMaterial({ color: 0x2a3042, roughness: 0.5, metalness: 0.6 });
  const frameM = new TH.MeshStandardMaterial({ color: 0xdfe5f2, roughness: 0.35, metalness: 0.7 });
  const glass = new TH.MeshPhysicalMaterial({ color: 0xcfe2ff, transparent: true, opacity: 0.26, roughness: 0.04, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05, depthWrite: false });
  const bw = 1.8, bh = 1.05, bx = s * (BOARD_X + 0.02), by = 3.425;
  const board = new TH.Mesh(new TH.BoxGeometry(0.04, bh, bw), glass); board.position.set(bx, by, 0); board.renderOrder = 2; scene.add(board);
  const bar = (w, h, d, x, y, z, mat) => { const m = new TH.Mesh(new TH.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.castShadow = true; scene.add(m); return m; };
  // aluminium frame
  bar(0.06, 0.05, bw + 0.04, bx, by + bh / 2, 0, frameM); bar(0.06, 0.05, bw + 0.04, bx, by - bh / 2, 0, frameM);
  bar(0.06, bh, 0.05, bx, by, bw / 2, frameM); bar(0.06, bh, 0.05, bx, by, -bw / 2, frameM);
  // shooter's square
  const sqM = new TH.MeshBasicMaterial({ color: 0xf5f5f5, toneMapped: false }), sqW = 0.59, sqH = 0.45, sqY = 3.0 + sqH / 2, sqX = s * (BOARD_X - 0.003);
  bar(0.012, 0.025, sqW, sqX, sqY + sqH / 2, 0, sqM); bar(0.012, 0.025, sqW, sqX, sqY - sqH / 2, 0, sqM);
  bar(0.012, sqH, 0.025, sqX, sqY, sqW / 2, sqM); bar(0.012, sqH, 0.025, sqX, sqY, -sqW / 2, sqM);
  // padded lower edge + support behind the glass
  bar(0.1, 0.07, bw + 0.1, bx + s * 0.02, by - bh / 2 - 0.02, 0, new TH.MeshStandardMaterial({ color: 0x151b2e, roughness: 0.9 }));
  bar(0.1, 0.5, 0.5, bx + s * 0.08, 3.35, 0, steel);

  // rim
  const orange = new TH.MeshStandardMaterial({ color: 0xff5a1f, emissive: 0x4a1400, roughness: 0.28, metalness: 0.55 });
  const rim = new TH.Mesh(new TH.TorusGeometry(RIM_R, TUBE, 14, 56), orange);
  rim.rotation.x = Math.PI / 2; rim.position.set(s * HOOP_X, RIM_Y, 0); rim.castShadow = true; scene.add(rim);
  const rx0 = s * (HOOP_X + RIM_R), rx1 = s * BOARD_X, plate = new TH.Mesh(new TH.BoxGeometry(Math.abs(rx1 - rx0) + 0.02, 0.035, 0.16), orange);
  plate.position.set((rx0 + rx1) / 2, RIM_Y, 0); plate.castShadow = true; scene.add(plate);
  makeNet(s);

  // stanchion: padded base, upright, arm and brace
  const pole = new TH.Mesh(new TH.CylinderGeometry(0.09, 0.11, 3.7, 16), steel);
  pole.position.set(s * 14.9, 1.85, 0); pole.castShadow = true; scene.add(pole);
  const arm = new TH.Mesh(new TH.BoxGeometry(2.1, 0.14, 0.14), steel);
  arm.position.set(s * 13.85, 3.3, 0); arm.castShadow = true; scene.add(arm);
  const bl = Math.hypot(1.2, 1.1), brace = new TH.Mesh(new TH.CylinderGeometry(0.04, 0.04, bl, 8), steel);
  brace.position.set(s * 14.3, 2.75, 0); brace.rotation.z = s * Math.atan2(1.2, 1.1); scene.add(brace);
  const pad = new TH.Mesh(new TH.BoxGeometry(0.3, 1.3, 2.0), new TH.MeshStandardMaterial({ color: 0x16203a, roughness: 0.85 }));
  pad.position.set(s * 14.75, 0.65, 0); pad.castShadow = true; scene.add(pad);
  const stripe = new TH.Mesh(new TH.BoxGeometry(0.32, 0.16, 2.02), new TH.MeshBasicMaterial({ color: s < 0 ? 0x3a63ff : 0xff4458, toneMapped: false }));
  stripe.position.set(s * 14.75, 1.0, 0); scene.add(stripe);
  const foot = new TH.Mesh(new TH.BoxGeometry(0.9, 0.08, 1.1), steel); foot.position.set(s * 14.9, 0.04, 0); scene.add(foot);
}
makeHoop(1); makeHoop(-1);

/* ---------- ball ---------- */
function makeBallTexture() {
  const W = 512, H = 256, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'), rnd = mulberry(9);
  const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#d9611a'); gr.addColorStop(0.5, '#ee7a2a'); gr.addColorStop(1, '#d9611a');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 5200; i++) { g.fillStyle = `rgba(${rnd() < 0.5 ? '70,25,5' : '255,170,100'},${0.05 + rnd() * 0.09})`; g.fillRect(rnd() * W, rnd() * H, 1.6, 1.6); }
  g.strokeStyle = '#25110a'; g.lineWidth = 5; g.lineCap = 'round';
  g.beginPath(); g.moveTo(0, H / 2); g.lineTo(W, H / 2);
  for (const x of [0, W / 2, W]) { g.moveTo(x, 0); g.lineTo(x, H); }
  g.stroke();
  for (const [x0, sgn_] of [[W * 0.25, 1], [W * 0.75, -1]]) {
    g.beginPath();
    for (let y = 0; y <= H; y += 4) { const x = x0 + sgn_ * Math.sin(y / H * Math.PI) * 44; if (y === 0) g.moveTo(x, y); else g.lineTo(x, y); }
    g.stroke();
  }
  const t = new TH.CanvasTexture(c); t.anisotropy = 4; return t;
}
const ballMesh = new TH.Mesh(new TH.SphereGeometry(BALL_R, 40, 28), new TH.MeshStandardMaterial({ map: makeBallTexture(), roughness: 0.55, metalness: 0.02 }));
ballMesh.castShadow = true; scene.add(ballMesh);

/* ---------- player rigs ---------- */
const SKIN = [0xf1c9a5, 0xc68c5f, 0x8d5a3b, 0x5b3a25];
function numberTexture(n) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.font = '900 52px Impact, "Arial Narrow", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(String(n), 32, 34);
  return new TH.CanvasTexture(c);
}
const HAIR = [0x16100c, 0x2a1a10, 0x0d0d0d, 0x4a3320];
const blobGeo = new TH.CircleGeometry(0.45, 24), blobMat = new TH.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.2, depthWrite: false });
function makeRig(color, number, skin) {
  const root = new TH.Group(), body = new TH.Group(); root.add(body);
  const jersey = new TH.MeshStandardMaterial({ color, roughness: 0.62 });
  const shorts = new TH.MeshStandardMaterial({ color: new TH.Color(color).multiplyScalar(0.5), roughness: 0.75 });
  const skinM = new TH.MeshStandardMaterial({ color: skin, roughness: 0.7 });
  const trimM = new TH.MeshStandardMaterial({ color: 0xf4f4f4, roughness: 0.6 });
  const hairM = new TH.MeshStandardMaterial({ color: HAIR[number % 4], roughness: 0.9 });
  const add = (geo, mat, x, y, z, parent = body) => { const m = new TH.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m; };
  const torso = add(new TH.CylinderGeometry(0.255, 0.2, 0.64, 20), jersey, 0, 1.17, 0); torso.scale.z = 0.72;
  const hips = add(new TH.CylinderGeometry(0.215, 0.235, 0.28, 20), shorts, 0, 0.81, 0); hips.scale.z = 0.75;
  add(new TH.CylinderGeometry(0.222, 0.222, 0.025, 20), trimM, 0, 0.95, 0).scale.z = 0.76;       // waistband trim
  for (const sx of [-1, 1]) add(new TH.SphereGeometry(0.115, 14, 10), jersey, sx * 0.265, 1.42, 0);  // shoulders
  add(new TH.CylinderGeometry(0.06, 0.07, 0.1, 10), skinM, 0, 1.53, 0);                           // neck
  const head = add(new TH.SphereGeometry(0.15, 20, 14), skinM, 0, 1.69, 0); head.scale.set(0.95, 1.08, 1);
  const hair = add(new TH.SphereGeometry(0.158, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.52), hairM, 0, 1.7, -0.01); hair.rotation.x = -0.2;
  const numTex = numberTexture(number), numMat = new TH.MeshBasicMaterial({ map: numTex, transparent: true, depthWrite: false });
  const num = new TH.Mesh(new TH.PlaneGeometry(0.3, 0.3), numMat);
  num.position.set(0, 1.2, -0.19); num.rotation.y = Math.PI; body.add(num);
  const legs = [-1, 1].map(s => {
    const p = new TH.Group(); p.position.set(s * 0.11, 0.7, 0); body.add(p);
    add(new TH.CylinderGeometry(0.082, 0.062, 0.34, 12), skinM, 0, -0.17, 0, p);                  // thigh
    add(new TH.CylinderGeometry(0.06, 0.05, 0.3, 12), skinM, 0, -0.45, 0, p);                      // calf
    add(new TH.CylinderGeometry(0.058, 0.058, 0.14, 12), trimM, 0, -0.52, 0, p);                   // sock
    const shoe = add(new TH.BoxGeometry(0.125, 0.085, 0.27), trimM, 0, -0.64, 0.05, p);
    add(new TH.BoxGeometry(0.13, 0.03, 0.28), new TH.MeshStandardMaterial({ color }), 0, -0.685, 0.05, p);   // sole in team colour
    return p;
  });
  const arms = [-1, 1].map(s => {   // index 0 = right arm (faces +z, so right is -x)
    const p = new TH.Group(); p.position.set(s * 0.31, 1.42, 0); body.add(p);
    add(new TH.CylinderGeometry(0.058, 0.05, 0.56, 12), skinM, 0, -0.27, 0, p);
    add(new TH.SphereGeometry(0.062, 10, 8), skinM, 0, -0.57, 0, p);
    return p;
  });
  const blob = new TH.Mesh(blobGeo, blobMat); blob.rotation.x = -Math.PI / 2; root.add(blob);
  return { root, body, legs, arms, blob };
}

/* ---------- controlled-player marker + fx ---------- */
const marker = new TH.Group();
const ringM = new TH.Mesh(new TH.RingGeometry(0.55, 0.68, 40), new TH.MeshBasicMaterial({ color: 0xffc83d, transparent: true, opacity: 0.9, side: TH.DoubleSide, depthWrite: false }));
ringM.rotation.x = -Math.PI / 2; ringM.position.y = 0.03;
const arrow = new TH.Mesh(new TH.ConeGeometry(0.16, 0.3, 4), new TH.MeshBasicMaterial({ color: 0xffc83d }));
arrow.rotation.x = Math.PI;
marker.add(ringM, arrow); scene.add(marker);

const fx = [];
const fxGeo = new TH.RingGeometry(0.8, 1, 32);
function spawnRing(x, z, color, r1 = 1.7, life = 0.42) {
  const m = new TH.Mesh(fxGeo, new TH.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, side: TH.DoubleSide, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.position.set(x, 0.04, z); m.scale.setScalar(0.4);
  scene.add(m); fx.push({ m, t: 0, life, r1 });
}

/* ============================== audio ============================== */
let ac = null, muted = false, noiseBuf = null;
function initAudio() {
  if (!ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { ac = null; } }
  if (ac && ac.state === 'suspended') ac.resume().catch(() => {});
}
function tone(f0, f1, dur, type, vol) {
  if (!ac || muted) return;
  const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime;
  o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(ac.destination); o.start(t); o.stop(t + dur + 0.02);
}
function noise(dur, vol, hp) {
  if (!ac || muted) return;
  if (!noiseBuf) { noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
  const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain(), t = ac.currentTime;
  s.buffer = noiseBuf; f.type = 'highpass'; f.frequency.value = hp;
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f); f.connect(g); g.connect(ac.destination); s.start(t); s.stop(t + dur + 0.02);
}
const sfx = {
  bounce: v => tone(150, 55, 0.09, 'sine', 0.3 * clamp(v, 0.1, 1)),
  rim: () => { tone(820, 420, 0.28, 'triangle', 0.22); tone(1230, 600, 0.2, 'sine', 0.08); },
  board: () => tone(260, 140, 0.12, 'square', 0.1),
  swish: () => noise(0.4, 0.2, 3500),
  hit: () => { noise(0.16, 0.3, 300); tone(110, 50, 0.16, 'square', 0.13); },
  dash: () => noise(0.14, 0.1, 2200),
  pass: () => tone(500, 300, 0.07, 'triangle', 0.12),
  whistle: () => tone(1900, 1700, 0.25, 'sine', 0.1),
  buzzer: () => tone(200, 200, 1.0, 'sawtooth', 0.16),
};

/* ============================== game state ============================== */
const teams = [
  { idx: 0, name: 'HOME', color: 0x3a63ff, css: '#8fb0ff', dir: 1, score: 0, players: [], cpu: false },
  { idx: 1, name: 'CPU', color: 0xff4458, css: '#ff8c99', dir: -1, score: 0, players: [], cpu: true },
];
const players = [];
const NUMS = [[3, 11, 24], [7, 15, 32]];
teams.forEach(tm => {
  for (let i = 0; i < 3; i++) {
    const rig = makeRig(tm.color, NUMS[tm.idx][i], SKIN[(i + tm.idx * 2) % 4]);
    scene.add(rig.root);
    const p = Object.assign({
      team: tm, idx: i, x: 0, z: 0, y: 0, vx: 0, vz: 0, yaw: tm.dir * Math.PI / 2, spot: { x: 0, z: 0 }, phase: Math.random() * 6,
      hp: 100, maxHp: 100,                       // health is not used yet; see onHit()
      tackleCd: 0, quickCd: 0, stun: 0, evadeT: 0, dashT: 0, dashX: 0, dashZ: 0, windup: 0, windupOn: false, aimYaw: 0,
      lunge: 0, lungeOn: false, lungeYaw: 0, hitDone: false, shootT: 0, shotFired: false, passAnim: 0,
      atk: 'tackle', jumpT: 0, jumpCd: 0, tdCd: 0, stunKind: 'stumble', aiJumpIn: 0, sLie: 0,
      holdT: 0, aiReact: 0, aiTackleT: rand(0.4, 1), sBody: 0, sAL: 0, sAR: 0,
    }, rig);
    tm.players.push(p); players.push(p);
  }
});
const oppsOf = p => teams[1 - p.team.idx].players;
const matesOf = p => p.team.players.filter(m => m !== p);

const ball = {
  x: 0, y: 1, z: 0, vx: 0, vy: 0, vz: 0, g: G, state: 'held', holder: null, lastTeam: null, shooter: null, target: null,
  hoopSide: 1, is3: false, rolled: null, passer: null, touched: false, lock: 0, dribT: 0, dribFloor: 0, looseT: 0, passT: 0, spinX: 0,
};

let phase = 'menu';          // menu | live | dead | over
let paused = false;
let deadMode = 'score', deadT = 0, inbound = teams[0];
let clock = GAME_SECONDS, sudden = false, gameTime = 0;
let controlled = null;
let autoPilot = false;       // lets the test harness play both sides

/* ============================== input ============================== */
const keys = {}, just = {};
const GAME_KEYS = new Set(['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'a', 's', 'd', 'f', 'e', 'm', 'enter', ' ']);
window.addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if (GAME_KEYS.has(k)) e.preventDefault();
  if (e.repeat) return;
  keys[k] = true; just[k] = true;
  if (k === 'm') { muted = !muted; $('muteLbl').textContent = muted ? 'Sound off' : 'Sound on'; }
  if (k === 'enter') onOverlayAction();
  if (!$('overlay').hidden && !paused && (phase === 'menu' || phase === 'over') && (k === 'arrowleft' || k === 'arrowright')) stepDifficulty(k === 'arrowright' ? 1 : -1);
});
window.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });
window.addEventListener('blur', () => {
  for (const k in keys) keys[k] = false;
  if (phase === 'live' || phase === 'dead') setPaused(true);
});
canvas.addEventListener('pointerdown', () => canvas.focus());

/* ============================== HUD ============================== */
const toastEl = $('toast');
function toast(main, sub, team) {
  const b = toastEl.querySelector('b'), i = toastEl.querySelector('i');
  b.textContent = main; i.textContent = sub || ''; b.style.color = team ? team.css : '#eef2ff';
  toastEl.classList.remove('show'); void toastEl.offsetWidth; toastEl.classList.add('show');
}
function fmtClock(s) { s = Math.max(0, Math.ceil(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
const hudCache = {};
function setText(id, v) { if (hudCache[id] !== v) { hudCache[id] = v; $(id).textContent = v; } }
function updateHud() {
  setText('clock', fmtClock(clock));
  setText('sHome', String(teams[0].score)); setText('sAway', String(teams[1].score));
  let label;
  if (sudden) label = 'Sudden death';
  else if (phase !== 'live') label = phase === 'dead' ? '' : 'Tip-off';
  else if (ball.holder) label = ball.holder.team.name + ' ball';
  else label = ball.state === 'shot' ? 'Shot' : ball.state === 'pass' ? 'Pass' : 'Loose ball';
  setText('period', label || (deadMode === 'score' ? 'Basket' : 'Dead ball'));
  document.querySelectorAll('kbd[data-k]').forEach(el => el.classList.toggle('on', !!keys[el.dataset.k]));
  if (controlled) {
    $('cdF').style.setProperty('--r', (1 - controlled.tackleCd / 1.25).toFixed(2));
    $('cdA').style.setProperty('--r', (1 - controlled.tdCd / 2.6).toFixed(2));
    $('cdD').style.setProperty('--r', (1 - controlled.jumpCd / 1.2).toFixed(2));
    $('cdQ').style.setProperty('--r', (1 - controlled.quickCd / 1.5).toFixed(2));
  }
}

/* ============================== overlay ============================== */
function showOverlay(mode) {
  const eye = $('ovEye'), title = $('ovTitle'), sub = $('ovSub'), btn = $('ovBtn'), controls = $('ovControls');
  $('overlay').hidden = false;
  controls.hidden = mode !== 'menu';
  $('ovDiff').hidden = mode === 'paused';
  if (mode === 'menu') {
    eye.textContent = '3 on 3 · vs CPU'; title.innerHTML = 'Hardwood <span>3v3</span>';
    sub.textContent = 'Three minutes on the clock. Most points wins, threes count three, and a tie goes to sudden death.'; btn.textContent = 'Tip off';
  } else if (mode === 'paused') {
    eye.textContent = 'Paused'; title.textContent = 'Back in a sec';
    sub.textContent = 'Click or press Enter to get back on the court.'; btn.textContent = 'Resume';
  } else {
    const h = teams[0].score, a = teams[1].score;
    eye.textContent = 'Final';
    title.textContent = h > a ? 'You win' : 'CPU wins';
    sub.textContent = `HOME ${h} – ${a} CPU`; btn.textContent = 'Play again';
  }
  btn.focus({ preventScroll: true });
}
function onOverlayAction() {
  if (paused) setPaused(false);
  else if (phase === 'menu' || phase === 'over') startGame();
}
function setPaused(v) {
  if (v === paused) return;
  paused = v;
  if (v) showOverlay('paused'); else { $('overlay').hidden = true; canvas.focus(); }
}
$('ovBtn').addEventListener('click', onOverlayAction);

/* ============================== ball & possession ============================== */
function giveBall(p) {
  const prev = ball.holder;
  if (prev && prev !== p && prev.shootT > 0 && !prev.shotFired) prev.shootT = 0;
  ball.holder = p; ball.state = 'held'; ball.lastTeam = p.team;
  ball.vx = ball.vy = ball.vz = 0; ball.is3 = false; ball.touched = false; ball.target = null; ball.looseT = 0;
  p.holdT = 0;
}
function popBall(from, by) {
  ball.holder = null; ball.state = 'loose'; ball.lock = 0.35; ball.g = G; ball.looseT = 0; ball.lastTeam = from.team;
  let dx = from.x - by.x, dz = from.z - by.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
  ball.vx = dx * 3.2 + rand(-1.5, 1.5); ball.vz = dz * 3.2 + rand(-1.5, 1.5); ball.vy = rand(2.5, 4);
}

function placeHeld(dt) {
  const p = ball.holder, fx_ = Math.sin(p.yaw), fz_ = Math.cos(p.yaw), rx = -Math.cos(p.yaw), rz = Math.sin(p.yaw);
  const sp = Math.hypot(p.vx, p.vz);
  p.holdT += dt;
  if (p.shootT > 0) {
    const u = clamp(p.shootT / 0.36, 0, 1);
    ball.x = p.x + fx_ * lerp(0.38, 0.12, u) + rx * lerp(0.28, 0.05, u);
    ball.z = p.z + fz_ * lerp(0.38, 0.12, u) + rz * lerp(0.28, 0.05, u);
    ball.y = lerp(1.0, 2.2 + p.y, u);
  } else {
    ball.dribT += dt * (1.8 + sp * 0.2);
    const f = Math.floor(ball.dribT);
    if (f !== ball.dribFloor) { ball.dribFloor = f; sfx.bounce(0.6); }
    const ph = ball.dribT - f, f0 = 0.4 + sp * 0.035;
    ball.x = p.x + fx_ * f0 + rx * 0.28; ball.z = p.z + fz_ * f0 + rz * 0.28;
    ball.y = BALL_R + 4 * ph * (1 - ph) * (0.82 + 0.1 * clamp(sp / 5, 0, 1));
  }
}

function scoreBasket(side) {
  const tm = teams.find(t => t.dir === side);
  const pts = ball.is3 && ball.shooter && ball.shooter.team === tm ? 3 : 2;
  tm.score += pts;
  ball.state = 'net'; ball.g = G;
  phase = 'dead'; deadMode = 'score'; deadT = 2.3; inbound = teams[1 - tm.idx];
  formation(inbound);
  for (const p of players) { p.shootT = 0; p.windupOn = false; p.windup = 0; p.lunge = 0; p.lungeOn = false; p.dashT = 0; }
  toast(pts === 3 ? 'Three!' : ball.touched ? 'Bucket' : 'Swish', `+${pts} ${tm.name}`, tm);
  if (!ball.touched) sfx.swish(); else { sfx.swish(); sfx.rim(); }
  nets[side].pulse = 1; crowd.joy = 1;
}

const REST_FLOOR = 0.78, REST_BOARD = 0.62, REST_RIM = 0.52;
function stepBall(dt) {
  const px = ball.x, py = ball.y, pz = ball.z;
  ball.vy -= ball.g * dt;
  ball.x += ball.vx * dt; ball.y += ball.vy * dt; ball.z += ball.vz * dt;
  if (ball.lock > 0) ball.lock -= dt;

  if (ball.state === 'net') {                   // dropping through the net: it guides the ball to the hoop axis and slows it
    const hx = ball.hoopSide * HOOP_X;
    if (ball.y > RIM_Y - 0.6) {
      ball.vx += (hx - ball.x) * 60 * dt; ball.vz += (0 - ball.z) * 60 * dt;
      const k = Math.exp(-10 * dt); ball.vx *= k; ball.vz *= k;
      if (ball.y < RIM_Y) ball.vy *= Math.exp(-1.6 * dt);
    }
  }

  // floor: lively bounce, each contact scrubs a little horizontal speed, then it rolls out
  if (ball.y < BALL_R) {
    ball.y = BALL_R;
    if (ball.vy < 0) {
      const vin = -ball.vy;
      if (vin > 1.5) sfx.bounce(vin / 8);
      ball.vy = vin * REST_FLOOR;
      if (ball.vy < 0.9) ball.vy = 0;
      const fr = ball.state === 'net' ? 0.98 : 0.94;
      ball.vx *= fr; ball.vz *= fr;
      if (ball.state === 'pass' || ball.state === 'shot') { ball.state = 'loose'; ball.looseT = 0; ball.g = G; ball.lock = 0.1; }
    }
    if (ball.vy === 0) {
      const k = Math.exp(-1.9 * dt); ball.vx *= k; ball.vz *= k;
      if (Math.hypot(ball.vx, ball.vz) < 0.06) { ball.vx = 0; ball.vz = 0; }
    }
  }

  if (ball.state === 'shot' || ball.state === 'loose') {
    for (const side of [-1, 1]) {
      const hx = side * HOOP_X;
      // backboard: a flat glass plane with a finite face; reflects the approach speed and scrubs some sideways speed
      if (side * ball.x + BALL_R > BOARD_X && side * ball.x < BOARD_X + 0.25 && Math.abs(ball.z) < 0.9 + BALL_R * 0.7 &&
          ball.y > 2.9 - BALL_R * 0.7 && ball.y < 3.95 + BALL_R * 0.7 && side * ball.vx > 0) {
        if (Math.abs(ball.vx) > 1) sfx.board();
        ball.x = side * (BOARD_X - BALL_R); ball.vx = -ball.vx * REST_BOARD; ball.vy *= 0.94; ball.vz *= 0.94; ball.touched = true;
        if (ball.state === 'shot') { ball.state = 'loose'; ball.looseT = 0; ball.lock = 0.15; }
      }
      // rim: exact torus. Collide with the nearest point on the ring's centre circle.
      const rdx = ball.x - hx, rdz = ball.z, rho = Math.hypot(rdx, rdz);
      if (rho < RIM_R + 0.4 && rho > 1e-5 && Math.abs(ball.y - RIM_Y) < 0.35) {
        const cx = hx + rdx / rho * RIM_R, cz = rdz / rho * RIM_R;
        const dx = ball.x - cx, dy = ball.y - RIM_Y, dz = ball.z - cz, dd = Math.hypot(dx, dy, dz), md = BALL_R + TUBE;
        if (dd < md && dd > 1e-5) {
          const nx = dx / dd, ny = dy / dd, nz = dz / dd;
          ball.x += nx * (md - dd); ball.y += ny * (md - dd); ball.z += nz * (md - dd);
          const vn = ball.vx * nx + ball.vy * ny + ball.vz * nz;
          if (vn < 0) {
            const j = (1 + REST_RIM) * vn;
            ball.vx -= j * nx; ball.vy -= j * ny; ball.vz -= j * nz;
            ball.vx *= 0.97; ball.vz *= 0.97;
            if (-vn > 1.2) sfx.rim();
            ball.touched = true;
            if (ball.state === 'shot') { ball.state = 'loose'; ball.looseT = 0; ball.lock = 0.15; }
          }
        }
      }
      // through the hoop? centre must cross the rim plane downward inside the ring
      if ((ball.state === 'shot' || ball.state === 'loose') && py > RIM_Y && ball.y <= RIM_Y && ball.vy < 0) {
        const f = (py - RIM_Y) / (py - ball.y), cx = lerp(px, ball.x, f), cz = lerp(pz, ball.z, f);
        if (Math.hypot(cx - hx, cz) < RIM_R - 0.03) { ball.hoopSide = side; scoreBasket(side); return; }
      }
    }
    if (ball.state === 'shot' && ball.vy < 0 && ball.y < RIM_Y - 0.6) { ball.state = 'loose'; ball.looseT = 0; ball.lock = 0.1; }
  }
  if (ball.state === 'pass') ball.passT += dt;
}

/* ============================== formations ============================== */
function formation(T) {
  const O = teams[1 - T.idx], d = T.dir;
  const A = [[-2, 0], [-3.6, 4.6], [-3.6, -4.6]], B = [[0.8, 0], [-0.4, 3.8], [-0.4, -3.8]];
  T.players.forEach((p, i) => { p.spot = { x: d * A[i][0], z: A[i][1] }; });
  O.players.forEach((p, i) => { p.spot = { x: d * B[i][0], z: B[i][1] }; });
}
function snapToSpots() {
  for (const p of players) {
    p.x = p.spot.x; p.z = p.spot.z; p.vx = p.vz = 0; p.stun = 0; p.y = 0;
    p.yaw = p.team.dir * Math.PI / 2;
  }
}

/* ============================== actions ============================== */
function startShot(p) { p.shootT = 0.0001; p.shotFired = false; }

function fireShot(p) {
  const side = p.team.dir, hx = side * HOOP_X;
  const dx0 = hx - p.x, dz0 = -p.z, d = Math.hypot(dx0, dz0), ux = dx0 / (d || 1), uz = dz0 / (d || 1);
  let contest = 0;
  for (const o of oppsOf(p)) {
    if (o.stun > 0) continue;
    const ox = o.x - p.x, oz = o.z - p.z, od = Math.hypot(ox, oz);
    if (od < 2.4 && (ox * ux + oz * uz) > -0.25 * od) contest = Math.max(contest, 1 - od / 2.4);
    if (o.jumpT > 0 && od < 2.2) contest = Math.max(contest, 0.9);
  }
  const mv = clamp(Math.hypot(p.vx, p.vz) / 5.5, 0, 1);
  const sigma = (0.06 + 0.1 * clamp((d - 1.2) / 8.5, 0, 1) + 0.09 * contest + 0.025 * mv) * (p.team.cpu ? DIFF.shotErr : 1);   // metres of miss at the rim
  const depth = gauss() * sigma * 1.15, lat = gauss() * sigma;
  const tx = hx + ux * depth - uz * lat, tz = uz * depth + ux * lat;
  const Tf = 0.78 + 0.052 * d;
  ball.g = G;
  ball.vx = (tx - ball.x) / Tf; ball.vz = (tz - ball.z) / Tf; ball.vy = ((RIM_Y - ball.y) + 0.5 * G * Tf * Tf) / Tf;
  ball.holder = null; ball.state = 'shot'; ball.shooter = p; ball.lastTeam = p.team; ball.hoopSide = side;
  ball.is3 = d > ARC_R; ball.touched = false; ball.lock = 0; ball.target = null; ball.rolled = new Set();
  sfx.pass();
}

function pickMate(p, it) {
  let ax = it.mx, az = it.mz; const am = Math.hypot(ax, az);
  if (am < 0.1) { ax = Math.sin(p.yaw); az = Math.cos(p.yaw); } else { ax /= am; az /= am; }
  let best = null, bs = -1e9;
  for (const m of matesOf(p)) {
    const dx = m.x - p.x, dz = m.z - p.z, d = Math.hypot(dx, dz) || 1;
    let open = 4; for (const o of oppsOf(p)) open = Math.min(open, dist2(o, m));
    const s = (dx * ax + dz * az) / d * 1.6 + open / 4 * 0.8 + p.team.dir * dx / 10 * 0.3;
    if (s > bs) { bs = s; best = m; }
  }
  return best;
}
function cpuMate(p) {
  let best = null, bs = -1e9;
  for (const m of matesOf(p)) {
    let open = 9, lane = 9;
    for (const o of oppsOf(p)) { open = Math.min(open, dist2(o, m)); lane = Math.min(lane, segDist(o.x, o.z, p.x, p.z, m.x, m.z)); }
    if (open < 2.0 || lane < 1.0) continue;
    const s = open * 0.6 + p.team.dir * (m.x - p.x) * 0.15 - Math.abs(m.z) * 0.05;
    if (s > bs) { bs = s; best = m; }
  }
  return best;
}
function doPass(p, it) {
  const mate = it.passTo || pickMate(p, it);
  if (!mate) return;
  const dx = mate.x - p.x, dz = mate.z - p.z, dist = Math.hypot(dx, dz);
  const Tf = clamp(dist / 15, 0.22, 0.9);
  const lx = mate.x + mate.vx * Tf * 0.6, lz = mate.z + mate.vz * Tf * 0.6;
  ball.g = 6;
  ball.vx = (lx - ball.x) / Tf; ball.vz = (lz - ball.z) / Tf; ball.vy = ((1.35 - ball.y) + 0.5 * ball.g * Tf * Tf) / Tf;
  ball.holder = null; ball.state = 'pass'; ball.target = mate; ball.lastTeam = p.team; ball.passT = 0; ball.lock = 0; ball.passer = p;
  p.passAnim = 0.28; p.yaw = Math.atan2(dx, dz);
  sfx.pass();
}

function aimAtOpp(p) {
  let best = null, bd = 3.3;
  for (const o of oppsOf(p)) { let d = dist2(p, o); if (ball.holder === o) d -= 0.8; if (d < bd) { bd = d; best = o; } }
  return best ? Math.atan2(best.x - p.x, best.z - p.z) : p.yaw;
}
const lv = p => (p.team.cpu ? DIFF : DIFFS.medium);
function setStun(p, s, kind = 'stumble') { if (s >= p.stun) { p.stun = s; p.stunKind = kind; } }
function startAttack(p, kind) {
  p.atk = kind; p.windupOn = true; p.aimYaw = aimAtOpp(p);
  const react = p === controlled ? 0.1 : lv(p).wind;
  if (kind === 'tackle') { p.tackleCd = 1.25; p.tdCd = Math.max(p.tdCd, 0.8); p.windup = react; }
  else { p.tdCd = 2.6; p.tackleCd = Math.max(p.tackleCd, 0.8); p.windup = react + 0.12; }
}
function beginLunge(p) {
  p.aimYaw = aimAtOpp(p); p.lungeYaw = p.aimYaw; p.lunge = p.atk === 'tackle' ? 0.26 : 0.22; p.lungeOn = true; p.hitDone = false; sfx.dash();
}
function startJump(p) { p.jumpT = 0.6; p.jumpCd = 1.2; sfx.dash(); }
function blockShot(o) {
  const dx = ball.x - o.x, dz = ball.z - o.z, l = Math.hypot(dx, dz) || 1;
  ball.state = 'loose'; ball.looseT = 0; ball.lock = 0.3; ball.g = G;
  ball.vx = dx / l * 4 + rand(-1, 1); ball.vz = dz / l * 4 + rand(-1, 1); ball.vy = rand(-2, 0.5);
  toast('Blocked!', 'Swatted away', o.team); sfx.hit(); spawnRing(o.x, o.z, 0xffd27a, 1.6, 0.35);
}
function startQuick(p, it) {
  let dx = it.mx, dz = it.mz; const m = Math.hypot(dx, dz);
  if (m < 0.1) { dx = Math.sin(p.yaw); dz = Math.cos(p.yaw); } else { dx /= m; dz /= m; }
  p.dashX = dx; p.dashZ = dz; p.dashT = 0.24; p.evadeT = 0.5; p.quickCd = 1.5;
  spawnRing(p.x, p.z, 0x9fd4ff, 1.5, 0.35); sfx.dash();
}

// Extension point for the health / damage system: called for every tackle that connects.
function onHit(attacker, victim, hadBall, kind) { /* kind is 'tackle' or 'takedown'; victim.hp -= ... */ }

function resolveTackle(t, o) {
  const holder = ball.holder === o;
  t.lunge = 0;
  if (o.evadeT > 0) {
    setStun(t, 0.9); toast('Evaded', `${o.team.name} #${NUMS[o.team.idx][o.idx]}`, o.team); sfx.dash(); spawnRing(o.x, o.z, 0x9fd4ff, 2, 0.4);
    return;
  }
  if (holder && o.shootT > 0 && !o.shotFired) {
    o.shootT = 0; setStun(o, 0.6); popBall(o, t); toast('Stuffed', t.team.name + ' ball', t.team);
  } else if (holder) {
    setStun(o, 0.75);
    if (Math.random() < (t.team.cpu ? DIFF.steal : 0.7)) { giveBall(t); toast('Stolen!', t.team.name + ' ball', t.team); }
    else { popBall(o, t); toast('Knocked loose', '', null); }
  } else {
    setStun(o, 0.45);
  }
  setStun(t, 0.2);
  sfx.hit(); spawnRing(o.x, o.z, 0xffd27a, 1.6, 0.35);
  onHit(t, o, holder, 'tackle');
}

// Wrestling throw: floors the target for a long stun, but the attacker hits the floor if it fails or is dodged.
function resolveTakedown(t, o) {
  const holder = ball.holder === o;
  t.lunge = 0;
  if (o.evadeT > 0) {
    setStun(t, 1.2, 'fell'); toast('Dodged', 'Takedown missed', o.team); sfx.dash(); spawnRing(o.x, o.z, 0x9fd4ff, 2, 0.4);
    return;
  }
  const away = Math.sin(t.yaw) * Math.sin(o.yaw) + Math.cos(t.yaw) * Math.cos(o.yaw);   // > 0 when the target faces away from the attacker
  let chance = (holder ? 0.7 : 0.85) + 0.15 * away;
  if (t.team.cpu) chance *= DIFF.land / 0.75;
  if (Math.random() < clamp(chance, 0.05, 0.95)) {
    if (holder) popBall(o, t);
    o.shootT = 0; setStun(o, 1.5, 'thrown'); setStun(t, 0.4);
    const dx = o.x - t.x, dz = o.z - t.z, l = Math.hypot(dx, dz) || 1; o.vx = dx / l * 4; o.vz = dz / l * 4;
    toast('Takedown!', t.team.name + ' #' + NUMS[t.team.idx][t.idx], t.team); sfx.hit(); spawnRing(o.x, o.z, 0xff8a5c, 2, 0.45);
    onHit(t, o, holder, 'takedown');
  } else {
    setStun(t, 1.1, 'fell'); toast('Takedown failed', t.team.name + ' hit the floor', t.team); sfx.hit();
  }
}

/* ============================== AI ============================== */
function moveTo(it, p, tx, tz, arrive) {
  const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
  if (d <= arrive) return d;
  const s = clamp((d - arrive) / 1.2, 0.35, 1);
  it.mx = dx / d * s; it.mz = dz / d * s;
  return d;
}
let chaser = [null, null];
function computeChasers() {
  chaser = [null, null];
  if (ball.state !== 'loose') return;
  for (const tm of teams) {
    let bd = 1e9;
    for (const p of tm.players) { if (p.stun > 0) continue; const d = dist2(p, ball); if (d < bd) { bd = d; chaser[tm.idx] = p; } }
  }
}

function aiHandler(p, it, dt) {
  const d = p.team.dir, hoop = { x: d * HOOP_X, z: 0 };
  const opp = oppsOf(p);
  const dH = Math.hypot(hoop.x - p.x, hoop.z - p.z);
  let nd = null, ndd = 99;
  for (const o of opp) { const dd = dist2(p, o); if (dd < ndd) { ndd = dd; nd = o; } }

  let tx = hoop.x - d * 2.3, tz = 0;
  if (nd && ndd < 3.2 && dH > 3.5) tz = clamp(p.z + sgn(p.z - nd.z) * 3, -4.5, 4.5);
  moveTo(it, p, tx, tz, 0.3);
  it.lookX = hoop.x; it.lookZ = hoop.z;

  // dodge an incoming tackle
  if (p.quickCd <= 0 && p.aiReact <= 0) {
    for (const o of opp) {
      if ((o.windupOn || o.lunge > 0) && dist2(o, p) < 3.0) {
        p.aiReact = 0.8;
        if (Math.random() < lv(p).dodge) {
          const ox = o.x - p.x, oz = o.z - p.z, l = Math.hypot(ox, oz) || 1;
          let px = -oz / l, pz = ox / l;
          if (px * (hoop.x - p.x) + pz * (hoop.z - p.z) < 0) { px = -px; pz = -pz; }
          it.mx = px; it.mz = pz; it.quick = true;
        }
        break;
      }
    }
  }
  if (it.quick || p.shootT > 0) return;

  // Pressure: a defender closing in. Shake him with a quickstep, or move the ball, before he can tackle.
  if (nd && ndd < 2.4 && p.holdT > 0.35) {
    if (Math.random() < dt * 3.0) {
      const m = cpuMate(p);
      if (m) { it.pass = true; it.passTo = m; return; }
    }
    if (p.quickCd <= 0 && ndd < 1.8 && Math.random() < dt * 2.5) {
      const ox = nd.x - p.x, oz = nd.z - p.z, l = Math.hypot(ox, oz) || 1;
      let px = -oz / l, pz = ox / l;
      if (px * (hoop.x - p.x) + pz * (hoop.z - p.z) < 0) { px = -px; pz = -pz; }
      it.mx = px; it.mz = pz; it.quick = true; return;
    }
  }
  const open = ndd > 1.7;
  if (p.holdT > 0.35 && dH < 3.6 && ndd > 0.8) it.shoot = true;
  else if (p.holdT > 0.7 && dH < 9 && open && Math.random() < dt * 2.2) it.shoot = true;
  else if (p.holdT > 1.1 && dH < 7 && Math.random() < dt * 1.0) it.shoot = true;   // contested look rather than get stripped
  else if (p.holdT > 3 && dH < 11) it.shoot = true;
}

function aiOffense(p, it) {
  const tm = p.team, d = tm.dir, holder = ball.holder || ball.target || null;
  const off = tm.players.filter(m => m !== holder);
  const j = Math.max(0, off.indexOf(p)), shift = Math.floor(gameTime / 7) % 2;
  const spots = [[5.4, 4.7], [5.4, -4.7], [2.9, 3.2], [2.9, -3.2]];
  const s = spots[(j + shift * 2) % 4];
  let xd = Math.min(HOOP_X - s[0], d * ball.x + 6);
  moveTo(it, p, d * xd, s[1], 0.4);
  it.lookX = ball.x; it.lookZ = ball.z;
}

function aiDefense(p, it, dt) {
  const tm = p.team, opp = oppsOf(p), own = { x: -tm.dir * HOOP_X, z: 0 };
  const h = ball.holder && ball.holder.team !== tm ? ball.holder
    : (ball.state === 'pass' && ball.target && ball.target.team !== tm ? ball.target : null);
  let prim = null, pd = 1e9;
  if (h) for (const m of tm.players) { const dd = dist2(m, h); if (dd < pd) { pd = dd; prim = m; } }
  const defs = prim ? tm.players.filter(m => m !== prim) : tm.players.slice();
  const others = h ? opp.filter(o => o !== h) : opp.slice();
  if (p === prim) {
    const vx = own.x - h.x, vz = own.z - h.z, vl = Math.hypot(vx, vz) || 1;
    moveTo(it, p, h.x + vx / vl * lv(p).gap, h.z + vz / vl * lv(p).gap, 0.15);
    it.lookX = h.x; it.lookZ = h.z;
    const canT = p.tackleCd <= 0, canD = p.tdCd <= 0;
    if (dist2(p, h) < 2.0 && (canT || canD) && p.stun <= 0) {
      p.aiTackleT -= dt;
      if (p.aiTackleT <= 0) {
        if (canD && (!canT || Math.random() < lv(p).takedown)) it.takedown = true; else it.tackle = true;
        p.aiTackleT = rand(lv(p).every[0], lv(p).every[1]);
      }
    } else p.aiTackleT = Math.max(p.aiTackleT, 0.25);
    return;
  }
  const mark = others[Math.max(0, defs.indexOf(p))] || others[0];
  if (!mark) return;
  const vx = own.x - mark.x, vz = own.z - mark.z, vl = Math.hypot(vx, vz) || 1;
  let tx = mark.x + vx / vl * 1.5, tz = mark.z + vz / vl * 1.5;
  tx = lerp(tx, ball.x, 0.15); tz = lerp(tz, ball.z, 0.15);
  moveTo(it, p, tx, tz, 0.3);
  it.lookX = ball.x; it.lookZ = ball.z;
}

// Off-ball defenders react to a shot wind-up or a pass in the air by jumping, depending on difficulty.
function aiReactions(p, it, dt) {
  if (p.aiJumpIn > 0) { p.aiJumpIn -= dt; if (p.aiJumpIn <= 0 && p.jumpCd <= 0) it.jump = true; }
  if (p.aiReact > 0 || p.jumpCd > 0 || p.stun > 0 || p.aiJumpIn > 0) return;
  let trigger = false;
  if (ball.state === 'pass' && ball.passer && ball.passer.team !== p.team && dist2(p, ball) < 2.4) trigger = true;
  else for (const o of oppsOf(p)) if (o.shootT > 0 && !o.shotFired && ball.holder === o && dist2(p, o) < 2.0) { trigger = true; break; }
  if (!trigger) return;
  p.aiReact = 0.8;
  if (Math.random() < lv(p).jump) p.aiJumpIn = lv(p).delay;
}

function aiIntent(p, it, dt) {
  const tm = p.team;
  if (ball.holder === p) { aiHandler(p, it, dt); return; }
  aiReactions(p, it, dt);
  if (ball.state === 'loose' && chaser[tm.idx] === p) { moveTo(it, p, ball.x + ball.vx * 0.25, ball.z + ball.vz * 0.25, 0.15); it.lookX = ball.x; it.lookZ = ball.z; return; }
  if (ball.state === 'pass' && ball.target === p) { moveTo(it, p, ball.x + ball.vx * 0.2, ball.z + ball.vz * 0.2, 0.15); it.lookX = ball.x; it.lookZ = ball.z; return; }
  if (ball.state === 'shot') {                                 // crash the boards
    const side = ball.hoopSide, spots = [[1.4, 0], [2.0, 1.3], [2.0, -1.3]];
    const s = spots[p.idx];
    moveTo(it, p, side * (HOOP_X - s[0]), s[1], 0.3); it.lookX = side * HOOP_X; it.lookZ = 0; return;
  }
  const poss = ball.holder ? ball.holder.team : ball.lastTeam;
  if (poss === tm) aiOffense(p, it); else aiDefense(p, it, dt);
}

function humanIntent(p, it) {
  const ix = (keys.arrowright ? 1 : 0) - (keys.arrowleft ? 1 : 0), iz = (keys.arrowdown ? 1 : 0) - (keys.arrowup ? 1 : 0);
  const m = Math.hypot(ix, iz);
  if (m > 0) { it.mx = ix / m; it.mz = iz / m; }
  if (just.s) it.shoot = true;
  if (just.f) it.tackle = true;
  if (just.a) it.takedown = true;
  if (just.d) it.jump = true;
  if (just[' ']) it.quick = true;
  if (just.e) it.pass = true;
}
function walkIntent(p, it) {
  moveTo(it, p, p.spot.x, p.spot.z, 0.25);
  it.lookX = p.team.dir * 10; it.lookZ = 0;
}

/* ============================== player step ============================== */
function stepPlayer(p, dt) {
  for (const k of ['tackleCd', 'quickCd', 'tdCd', 'jumpT', 'jumpCd', 'stun', 'evadeT', 'dashT', 'windup', 'lunge', 'aiReact', 'passAnim']) if (p[k] > 0) p[k] = Math.max(0, p[k] - dt);
  const live = phase === 'live', hasBall = ball.holder === p;
  const it = { mx: 0, mz: 0, shoot: false, tackle: false, takedown: false, jump: false, quick: false, pass: false, passTo: null };

  if (p.stun <= 0) {
    if (live) { if (p === controlled && !autoPilot) humanIntent(p, it); else aiIntent(p, it, dt); }
    else if (phase === 'dead' && deadMode === 'score') walkIntent(p, it);
  }
  if (live && p.stun <= 0) {
    if (it.quick && p.quickCd <= 0 && p.shootT <= 0 && p.lunge <= 0 && !p.windupOn) startQuick(p, it);
    const free = !hasBall && !p.windupOn && p.lunge <= 0 && p.dashT <= 0 && p.jumpT <= 0;
    if (it.tackle && free && p.tackleCd <= 0) startAttack(p, 'tackle');
    if (it.takedown && free && p.tdCd <= 0) startAttack(p, 'takedown');
    if (it.jump && free && p.jumpCd <= 0 && p.shootT <= 0) startJump(p);
    if (it.shoot && hasBall && p.shootT <= 0 && p.dashT <= 0) startShot(p);
    if (it.pass && hasBall && p.shootT <= 0) doPass(p, it);
  }

  // tackle phases
  if (p.windupOn && p.windup <= 0) { p.windupOn = false; if (p.stun <= 0) beginLunge(p); }
  if (p.lungeOn && p.lunge <= 0) {
    p.lungeOn = false;
    if (!p.hitDone) {
      if (p.atk === 'takedown') { setStun(p, 1.0, 'fell'); toast('Takedown missed', p.team.name + ' hit the floor', p.team); }
      else setStun(p, 0.35);
    }
  }
  if (p.stun > 0) { p.windupOn = false; p.jumpT = 0; if (p.lunge > 0) { p.lunge = 0; } }

  // movement
  let sp = (hasBall ? 5.4 : 6.1) * (p.team.cpu ? (hasBall ? Math.max(DIFF.speed, 0.97) : DIFF.speed) : p === controlled ? 1 : 0.95);   // the CPU's ball handler is not slowed by the difficulty handicap, so it can actually get to a shot
  if (p.shootT > 0) sp *= 0.12;
  if (p.windupOn) sp *= 0.35;
  if (p.jumpT > 0) sp *= 0.7;
  let tvx = it.mx * sp, tvz = it.mz * sp;
  if (p.stun > 0) { tvx = 0; tvz = 0; }
  const rate = p.stun > 0 ? 14 : (tvx * tvx + tvz * tvz > 0.01 ? 46 : 60);   // m/s^2: quick to start, a little slide when you let go
  let ax = tvx - p.vx, az = tvz - p.vz; const al = Math.hypot(ax, az), stepV = rate * dt;
  if (al > stepV) { ax *= stepV / al; az *= stepV / al; }
  p.vx += ax; p.vz += az;
  if (p.dashT > 0) { p.vx = p.dashX * 10.5; p.vz = p.dashZ * 10.5; }
  else if (p.lunge > 0) { const ls = p.atk === 'tackle' ? 6.5 : 5.5; p.vx = Math.sin(p.lungeYaw) * ls; p.vz = Math.cos(p.lungeYaw) * ls; }
  p.x = clamp(p.x + p.vx * dt, -HX + 0.3, HX - 0.3);
  p.z = clamp(p.z + p.vz * dt, -HZ + 0.3, HZ - 0.3);

  // facing
  const spd = Math.hypot(p.vx, p.vz);
  let ty = null;
  if (p.shootT > 0) ty = Math.atan2(p.team.dir * HOOP_X - p.x, -p.z);
  else if (p.lunge > 0) ty = p.lungeYaw;
  else if (p.windupOn) ty = p.aimYaw;
  else if (p.dashT > 0 || spd > 0.8) ty = Math.atan2(p.vx, p.vz);
  else if (it.lookX !== undefined) ty = Math.atan2(it.lookX - p.x, it.lookZ - p.z);
  if (p.stun > 0) ty = null;
  if (ty !== null) p.yaw += angDiff(p.yaw, ty) * Math.min(1, (p.shootT > 0 || p.windupOn ? 20 : 11) * dt);

  // shooting timeline: wind-up, release near the top of the jump, follow-through
  if (p.shootT > 0) {
    if (!hasBall && !p.shotFired) p.shootT = 0;
    else {
      p.shootT += dt;
      if (!p.shotFired && p.shootT >= 0.36) { p.shotFired = true; fireShot(p); }
      if (p.shootT >= 0.75) p.shootT = 0;
    }
  }
  p.y = p.shootT > 0 ? Math.sin(clamp(p.shootT / 0.75, 0, 1) * Math.PI) * 0.38 : p.jumpT > 0 ? Math.sin((1 - p.jumpT / 0.6) * Math.PI) * 0.75 : 0;

  // tackle / takedown contact
  if (p.lunge > 0 && !p.hitDone && live) {
    const tackle = p.atk === 'tackle', reach = tackle ? 1.1 : 0.95, cone = tackle ? 1.1 : 0.8;
    for (const o of oppsOf(p)) {
      if (o.stun > 0.05) continue;
      const d = dist2(p, o);
      if (d > reach || Math.abs(angDiff(p.yaw, Math.atan2(o.x - p.x, o.z - p.z))) > cone) continue;
      p.hitDone = true; (tackle ? resolveTackle : resolveTakedown)(p, o); break;
    }
  }
}

function separate() {
  for (let i = 0; i < players.length; i++) for (let j = i + 1; j < players.length; j++) {
    const a = players[i], b = players[j];
    const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
    if (d < 0.75 && d > 1e-4) {
      const push = (0.75 - d) / 2, nx = dx / d, nz = dz / d;
      a.x -= nx * push; a.z -= nz * push; b.x += nx * push; b.z += nz * push;
    }
  }
  for (const p of players) { p.x = clamp(p.x, -HX + 0.3, HX - 0.3); p.z = clamp(p.z, -HZ + 0.3, HZ - 0.3); }
}

/* ============================== control selection ============================== */
function pickControlled() {
  const H = teams[0];
  let want = null;
  if (ball.holder && ball.holder.team === H) want = ball.holder;
  else if (ball.state === 'pass' && ball.lastTeam === H && ball.target) want = ball.target;
  else if (ball.state === 'shot' && ball.lastTeam === H && ball.shooter) want = ball.shooter;
  else {
    let best = null, bd = 1e9;
    for (const p of H.players) { const d = dist2(p, ball); if (d < bd) { bd = d; best = p; } }
    if (controlled && controlled.team === H && dist2(controlled, ball) <= bd + 1.3) best = controlled;
    want = best;
  }
  if (want) controlled = want;
}

/* ============================== game flow ============================== */
function resetGame() {
  teams.forEach(t => { t.score = 0; });
  clock = GAME_SECONDS; sudden = false; gameTime = 0;
  inbound = teams[0]; formation(inbound); snapToSpots();
  for (const p of players) { p.shootT = 0; p.windupOn = false; p.windup = 0; p.lunge = 0; p.lungeOn = false; p.dashT = 0; p.tackleCd = p.quickCd = p.evadeT = 0; p.hp = p.maxHp; }
  ball.holder = null; ball.shooter = null; ball.target = null; ball.lastTeam = null;
  giveBall(inbound.players[0]);
  controlled = inbound.players[0];
}
function startGame() {
  if (phase === 'live' || phase === 'dead') return;
  initAudio();
  resetGame();
  $('overlay').hidden = true; canvas.focus();
  phase = 'dead'; deadMode = 'inbound'; deadT = 1.0;
  toast('Tip off', 'Most points in 3:00', null);
  sfx.whistle();
}
function endGame() {
  phase = 'over'; sfx.buzzer(); showOverlay('over');
}
function checkEnd() {
  if (clock > 0 || ball.state === 'shot') return;
  if (teams[0].score !== teams[1].score) { endGame(); return; }
  if (!sudden) { sudden = true; toast('Sudden death', 'Next basket wins', null); sfx.whistle(); }
}
function endDead() {
  if (deadMode === 'score') {
    clock = Math.max(clock, 0);
    if (sudden || clock <= 0) { if (teams[0].score !== teams[1].score) { endGame(); return; } if (!sudden) { sudden = true; toast('Sudden death', 'Next basket wins', null); sfx.whistle(); } }
    snapToSpots();
    giveBall(inbound.players[0]);
  }
  phase = 'live';
}
function outOfBounds() {
  const tm = ball.lastTeam ? teams[1 - ball.lastTeam.idx] : teams[0];
  const sx = clamp(ball.x, -(HX - 0.9), HX - 0.9), sz = clamp(ball.z, -(HZ - 0.7), HZ - 0.7);
  let best = null, bd = 1e9;
  for (const p of tm.players) { const d = Math.hypot(p.x - sx, p.z - sz); if (d < bd) { bd = d; best = p; } }
  best.x = sx; best.z = sz; best.vx = best.vz = 0; best.stun = 0; best.yaw = Math.atan2(-sx, -sz);
  giveBall(best);
  phase = 'dead'; deadMode = 'inbound'; deadT = 0.7;
  toast('Out of bounds', tm.name + ' ball', tm); sfx.whistle();
}

/* ============================== update ============================== */
function update(dt) {
  gameTime += dt;
  if (phase === 'live') {
    clock -= dt;
    if (clock <= 0) { clock = 0; checkEnd(); if (phase === 'over') return; }
  }
  if (phase === 'dead') { deadT -= dt; if (deadT <= 0) { endDead(); if (phase === 'over') return; } }

  pickControlled();
  computeChasers();
  for (const p of players) stepPlayer(p, dt);
  separate();

  if (ball.holder) placeHeld(dt);
  else {
    const n = Math.max(1, Math.ceil(dt / 0.004)), h = dt / n;
    for (let i = 0; i < n; i++) { stepBall(h); if (ball.holder) break; }
    if (ball.state === 'loose') { ball.looseT += dt; if (ball.looseT > 7) { let b = null, bd = 1e9; for (const p of players) { const d = dist2(p, ball); if (d < bd) { bd = d; b = p; } } giveBall(b); } }
  }

  if (phase === 'live') {
    for (const o of players) {                       // airborne players reach higher: pick off passes, block shots, grab rebounds
      if (o.jumpT <= 0 || o.stun > 0 || ball.holder === o) continue;
      const d = dist2(o, ball);
      if (ball.state === 'pass' && ball.passer && o.team !== ball.passer.team && d < 1.4 && ball.y < 3.4) {
        giveBall(o); toast('Picked off', o.team.name + ' ball', o.team); sfx.hit(); break;
      }
      if (ball.state === 'shot' && ball.shooter && o.team !== ball.shooter.team && d < 1.15 && ball.y > 1.2 && ball.y < 3.7 && ball.rolled && !ball.rolled.has(o)) {
        ball.rolled.add(o);
        if (Math.random() < 0.85) { blockShot(o); break; }
      }
      if (ball.state === 'loose' && ball.lock <= 0 && d < 1.1 && ball.y < 3.3) { giveBall(o); break; }
    }
    if (ball.state === 'pass' && ball.target) {
      const r = ball.target;
      if (r.stun <= 0 && (r.jumpT > 0 ? dist2(r, ball) < 1.3 && ball.y < 3.3 : dist2(r, ball) < 0.9 && ball.y < 2.4)) { giveBall(r); }
      else {
        for (const o of oppsOf(ball.passer || r)) {
          if (o.stun <= 0 && dist2(o, ball) < 0.75 && ball.y > 0.2 && ball.y < 2.3) { giveBall(o); toast('Intercepted', o.team.name + ' ball', o.team); sfx.hit(); break; }
        }
      }
      if (ball.state === 'pass' && ball.passT > 2.5) { ball.state = 'loose'; ball.g = G; }
    }
    if (ball.state === 'loose' && ball.lock <= 0 && ball.y < 2.2) {
      let best = null, bd = 0.9;
      for (const p of players) { if (p.stun > 0) continue; const d = dist2(p, ball); if (d < bd) { bd = d; best = p; } }
      if (best) giveBall(best);
    }
    if ((ball.state === 'loose' || ball.state === 'pass') && (Math.abs(ball.x) > HX + 0.2 || Math.abs(ball.z) > HZ + 0.2)) outOfBounds();
    if (phase === 'live' && clock <= 0) checkEnd();
  }

  // ball mesh
  ballMesh.position.set(ball.x, ball.y, ball.z);
  const bsp = Math.hypot(ball.vx, ball.vz);
  if (!ball.holder && bsp > 0.05) { ballMesh.rotateOnWorldAxis(new TH.Vector3(ball.vz, 0, -ball.vx).normalize(), bsp / BALL_R * dt); }
  else if (ball.holder) ballMesh.rotation.x += dt * 6;

  for (let i = fx.length - 1; i >= 0; i--) {
    const f = fx[i]; f.t += dt;
    const u = f.t / f.life;
    if (u >= 1) { scene.remove(f.m); f.m.material.dispose(); fx.splice(i, 1); continue; }
    f.m.scale.setScalar(lerp(0.4, f.r1, 1 - (1 - u) * (1 - u))); f.m.material.opacity = 0.8 * (1 - u);
  }

  for (const k in just) just[k] = false;
}

/* ============================== animation + camera ============================== */
function animatePlayer(p, dt, t) {
  const sp = Math.hypot(p.vx, p.vz), k = clamp(sp / 5.5, 0, 1);
  p.phase += dt * (4 + sp * 1.5);
  const sw = Math.sin(p.phase) * k;
  let body = 0.14 * k, aL = sw * 0.8, aR = -sw * 0.8;
  const hasBall = ball.holder === p;
  if (hasBall && p.shootT <= 0) aR = -0.2 - Math.abs(Math.sin((ball.dribT % 1) * Math.PI)) * 0.45;
  if (p.shootT > 0) {
    const u = p.shootT / 0.75, raise = clamp(u / 0.4, 0, 1), r2 = raise * raise * (3 - 2 * raise);
    aL = aR = -r2 * 2.75 - (u > 0.5 ? 0.2 : 0); body = -0.08 * r2;
  }
  if (p.windupOn) { body = 0.38; aL = aR = -1.35; }
  if (p.lunge > 0) { body = p.atk === 'tackle' ? 0.8 : 1.05; aL = aR = p.atk === 'tackle' ? -1.5 : -1.1; }
  if (p.dashT > 0) body = 0.42;
  if (p.passAnim > 0) { aL = aR = -1.45; }
  if (p.jumpT > 0) { aL = aR = -2.9; body = -0.05; }
  let lie = 0;
  if (p.stun > 0) {
    if (p.stunKind === 'thrown') { body = -1.55; aL = aR = -2.2; lie = 0.26; }
    else if (p.stunKind === 'fell') { body = 1.5; aL = aR = -2.4; lie = 0.26; }
    else { body = -1.15; aL = -0.5; aR = 0.4; lie = 0.1; }
  }
  const e = Math.min(1, 16 * dt);
  p.sLie += (lie - p.sLie) * e; p.sBody += (body - p.sBody) * e; p.sAL += (aL - p.sAL) * e; p.sAR += (aR - p.sAR) * e;
  p.legs[0].rotation.x = sw * 0.85; p.legs[1].rotation.x = -sw * 0.85;
  p.arms[0].rotation.x = p.sAR; p.arms[1].rotation.x = p.sAL;
  p.body.rotation.x = p.sBody;
  const bob = p.stun > 0 || p.jumpT > 0 || p.shootT > 0 ? 0 : Math.abs(Math.sin(p.phase)) * 0.045 * k;
  p.root.position.set(p.x, p.y + p.sLie + bob, p.z); p.root.rotation.y = p.yaw;
  p.blob.position.y = 0.025 - (p.y + p.sLie + bob); p.blob.scale.setScalar(1 - clamp((p.y + p.sLie) * 0.5, 0, 0.35));
}

function updateCamera(dt, t) {
  let tx;
  if (phase === 'menu' || phase === 'over') tx = Math.sin(t * 0.15) * 5;
  else tx = 0.6 * ball.x + 0.4 * (controlled ? controlled.x : ball.x);
  tx = clamp(tx, -6.5, 6.5);
  camX += (tx - camX) * Math.min(1, 2.6 * dt);
  camera.position.set(camX, 12 * camScale, 14.5 * camScale);
  camera.lookAt(camX, 0.3, 1.5);
}

function resize() {
  const w = canvas.clientWidth || window.innerWidth, h = canvas.clientHeight || window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  camScale = clamp(1.75 / camera.aspect, 1, 2.4);
}
window.addEventListener('resize', resize);
if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas);
resize();

/* ============================== main loop ============================== */
function setDifficulty(id) {
  if (!DIFFS[id]) return;
  diffId = id; DIFF = DIFFS[id];
  document.querySelectorAll('#diff button').forEach(b => b.setAttribute('aria-checked', String(b.dataset.d === id)));
  $('diffLbl').textContent = DIFF.label;
  try { localStorage.setItem('hw-diff', id); } catch (e) { /* storage can be blocked */ }
}
function stepDifficulty(n) { setDifficulty(DIFF_ORDER[clamp(DIFF_ORDER.indexOf(diffId) + n, 0, DIFF_ORDER.length - 1)]); }
$('diff').addEventListener('click', e => { const b = e.target.closest('button[data-d]'); if (b) setDifficulty(b.dataset.d); });
let savedDiff = 'medium';
try { savedDiff = localStorage.getItem('hw-diff') || 'medium'; } catch (e) { /* ignore */ }
setDifficulty(DIFFS[savedDiff] ? savedDiff : 'medium');

resetGame();
showOverlay('menu');
let last = performance.now(), clockT = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.033, Math.max(0.0005, (now - last) / 1000)); last = now; clockT += dt;
  if (!paused && (phase === 'live' || phase === 'dead')) update(dt);
  else if (phase === 'menu' || phase === 'over') { if (ball.holder) placeHeld(dt); ballMesh.position.set(ball.x, ball.y, ball.z); }
  if (!paused) {
    for (const p of players) animatePlayer(p, dt, clockT);
    updateNets(dt, clockT);
    crowd.joy = Math.max(0, crowd.joy - dt * 0.45); updateCrowd(clockT, crowd.joy);
  }
  const showMarker = controlled && phase !== 'menu' && phase !== 'over';
  marker.visible = !!showMarker;
  if (showMarker) { marker.position.set(controlled.x, 0, controlled.z); arrow.position.y = 2.3 + Math.sin(clockT * 5) * 0.08; arrow.rotation.y = clockT * 2; }
  updateCamera(dt, clockT);
  updateHud();
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);
//@debug
if (/[?&]debug\b/.test(location.search)) window.__hw = { update, updateNets, ball, players, teams, nets, stepBall, fireShot, giveBall, scoreBasket, get phase() { return phase; }, set phase(v) { phase = v; }, startGame, scene, renderer, camera, crowd, get controlled() { return controlled; }, set autoPilot(v) { autoPilot = v; } };
})();
