
// =====================================================================
// TRACK — Nürburgring Nordschleife (20.7 km)
// Real centreline + elevation (see 02a_nordschleife.js) -> Catmull-Rom spline
// -> arc-length samples -> parallel-transport frames with banking -> custom
// BufferGeometry surfaces + collision data. Built in ~2 km chunks so that
// frustum culling and shadow passes only touch nearby track.
// =====================================================================
// Per-section width (m) and bank magnitude (deg); everything else uses the defaults.
const SECTION_STYLE = {
  'Döttinger Höhe': { w: 12 }, 'Nürburgring Nordschleife': { w: 12 }, 'Antoniusbuche': { w: 11 },
  'T13': { w: 11 }, 'Sabine-Schmitz-Kurve': { w: 11 }, 'Hohenrain': { w: 10.5 },
  'Karussell': { w: 9, bank: 18 }, 'Mini-Karussell': { w: 9.5, bank: 7 }, 'Steilstrecke': { w: 9.5 }, 'Hohe Acht': { w: 9.5 },
  'Fuchsröhre': { w: 9.5 }, 'Bergwerk': { w: 9.5 }
};
const TRACK_START_S = 20578; // start/finish line on Döttinger Höhe (metres along the OSM centreline)
const NORDS = (() => {
  const xz = decodeI16(NORDS_DATA.xz), yy = decodeI16(NORDS_DATA.y), n = yy.length;
  let x = [], z = [], y = [];
  for (let i = 0; i < n; i++) { x.push(xz[i * 2] / 10); z.push(xz[i * 2 + 1] / 10); y.push(yy[i] / 10); }
  const sm = (a, r, passes) => { for (let p = 0; p < passes; p++) { const b = a.slice(); for (let i = 0; i < n; i++) { let s = 0; for (let k = -r; k <= r; k++) s += b[(i + k + n) % n]; a[i] = s / (2 * r + 1); } } return a; };
  x = sm(x, 1, 1); z = sm(z, 1, 1); y = sm(y, 3, 2); // DEM noise -> smooth vertical profile
  const secs = NORDS_DATA.sections; let sp = 0;
  const cp = [];
  for (let i = 0; i < n; i++) {
    while (sp + 1 < secs.length && secs[sp + 1][0] <= i) sp++;
    const name = i < secs[0][0] ? secs[secs.length - 1][1] : secs[sp][1], st = SECTION_STYLE[name] || {};
    cp.push([x[i], z[i], y[i], st.w || 10, st.bank != null ? st.bank : 2, name]);
  }
  const si0 = Math.round(TRACK_START_S / NORDS_DATA.step) % n;
  return { cp, start: [x[si0], z[si0]] };
})();
const TRACK_CP = NORDS.cp;
const TRACK_SCALE = 1;
const SURF = { ROAD: 0, KERB: 1, EDGE: 2, RUNOFF: 3, GRASS: 4, GRAVEL: 5, PIT: 6, CONCRETE: 7 };
const SURF_PROPS = [
  { name: 'Asphalt', mu: 1.00, rr: 0.012, drag: 0.0, bump: 0.0, noise: 0.0 },
  { name: 'Kerb', mu: 0.90, rr: 0.016, drag: 0.0, bump: 0.006, noise: 0.05 },
  { name: 'Edge', mu: 0.95, rr: 0.013, drag: 0.0, bump: 0.0, noise: 0.0 },
  { name: 'Runoff', mu: 0.92, rr: 0.014, drag: 0.0, bump: 0.002, noise: 0.03 },
  { name: 'Grass', mu: 0.52, rr: 0.07, drag: 0.35, bump: 0.012, noise: 0.22 },
  { name: 'Gravel', mu: 0.42, rr: 0.18, drag: 0.6, bump: 0.02, noise: 0.30 },
  { name: 'Pit lane', mu: 0.95, rr: 0.013, drag: 0.0, bump: 0.0, noise: 0.0 },
  { name: 'Concrete', mu: 0.85, rr: 0.014, drag: 0.0, bump: 0.0, noise: 0.02 }
];
const KERB_W = 1.3;
const PIT = { wallU: 13.5, laneIn: 14.0, fastLane: 22.0, garageU: 30.0, limit: 80 / 3.6 };

class Track {
  constructor() {
    const pts = TRACK_CP.map(p => new THREE.Vector3(p[0] * TRACK_SCALE, p[2], p[1] * TRACK_SCALE));
    this.curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
    this.curve.arcLengthDivisions = Math.max(6000, TRACK_CP.length * 48);
    this.length = this.curve.getLength();
    const N = this.N = Math.round(this.length / 2);
    this.ds = this.length / N;
    // ---- raw arc-length samples (start index found later)
    const raw = [];
    const ncp = TRACK_CP.length;
    for (let i = 0; i < N; i++) {
      const u = i / N, t = this.curve.getUtoTmapping(u);
      const p = this.curve.getPoint(t), tg = this.curve.getTangent(t).normalize();
      const seg = t * ncp, k = Math.floor(seg) % ncp, f = smoothstep(0, 1, seg - Math.floor(seg));
      const a = TRACK_CP[k], b = TRACK_CP[(k + 1) % ncp];
      raw.push({ p, t: tg, w: lerp(a[3], b[3], f), bank: lerp(a[4], b[4], f) * Math.PI / 180, name: f < 0.5 ? a[5] : b[5] });
    }
    // ---- re-base so sample 0 lies on the start/finish line (on the main straight)
    let best = 0, bd = Infinity;
    const sf = new THREE.Vector3(NORDS.start[0], 0, NORDS.start[1]);
    raw.forEach((r, i) => { const d = (r.p.x - sf.x) ** 2 + (r.p.z - sf.z) ** 2; if (d < bd) { bd = d; best = i; } });
    const S = []; for (let i = 0; i < N; i++) S.push(raw[(i + best) % N]);
    this.P = S.map(r => r.p); this.T = S.map(r => r.t); this.secName = S.map(r => r.name || '');
    this.halfW = new Float32Array(N); S.forEach((r, i) => this.halfW[i] = r.w / 2);
    const bankMag = new Float32Array(N); S.forEach((r, i) => bankMag[i] = r.bank);
    this._frames(bankMag);
    this._zones();
    this._walls();
    this._corners();
    this._racingLine();
    this.vRef = this.speedProfile(1.6);
    this._grid();
    this._sectors();
  }
  wrapS(s) { const L = this.length; return ((s % L) + L) % L; }
  idxAt(s) { return Math.floor(this.wrapS(s) / this.ds) % this.N; }
  inRange(s, a, b) { s = this.wrapS(s); a = this.wrapS(a); b = this.wrapS(b); return a <= b ? (s >= a && s <= b) : (s >= a || s <= b); }
  // ---------------------------------------------------------------- frames
  _frames(bankMag) {
    const N = this.N, T = this.T, Y = new THREE.Vector3(0, 1, 0);
    // 1) Parallel transport (rotation-minimising) frames with closed-loop twist correction.
    const PT = new Array(N);
    PT[0] = Y.clone().addScaledVector(T[0], -T[0].dot(Y)).normalize();
    const axis = new THREE.Vector3(), q = new THREE.Quaternion();
    for (let i = 1; i < N; i++) {
      axis.crossVectors(T[i - 1], T[i]); const sl = axis.length();
      const n = PT[i - 1].clone();
      if (sl > 1e-9) { q.setFromAxisAngle(axis.multiplyScalar(1 / sl), Math.acos(clamp(T[i - 1].dot(T[i]), -1, 1))); n.applyQuaternion(q); }
      n.addScaledVector(T[i], -n.dot(T[i])).normalize(); PT[i] = n;
    }
    axis.crossVectors(T[N - 1], T[0]); const nEnd = PT[N - 1].clone();
    if (axis.length() > 1e-9) { q.setFromAxisAngle(axis.normalize(), Math.acos(clamp(T[N - 1].dot(T[0]), -1, 1))); nEnd.applyQuaternion(q); }
    const tw = Math.atan2(new THREE.Vector3().crossVectors(nEnd, PT[0]).dot(T[0]), nEnd.dot(PT[0]));
    for (let i = 0; i < N; i++) { q.setFromAxisAngle(T[i], tw * i / N); PT[i].applyQuaternion(q); }
    this.closureTwist = tw;
    // 2) Signed horizontal curvature (positive = turning left)
    const Lflat = T.map(t => new THREE.Vector3().crossVectors(Y, t).normalize());
    const kr = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = T[(i - 1 + N) % N], b = T[(i + 1) % N];
      kr[i] = (b.x - a.x) * Lflat[i].x / (2 * this.ds) + (b.z - a.z) * Lflat[i].z / (2 * this.ds);
    }
    this.kappa = kr;
    this.kappaS = this._smooth(kr, 10, 2);
    // 3) Road frame: parallel-transport frame rolled to the designed bank relative to gravity.
    this.U = new Array(N); this.L = new Array(N); this.bank = new Float32Array(N); this.ptRoll = new Float32Array(N);
    let minUp = 1;
    for (let i = 0; i < N; i++) {
      const t = T[i];
      const uFlat = Y.clone().addScaledVector(t, -t.dot(Y)).normalize();
      this.ptRoll[i] = Math.atan2(new THREE.Vector3().crossVectors(uFlat, PT[i]).dot(t), uFlat.dot(PT[i]));
      const bank = -bankMag[i] * clamp(this.kappaS[i] * 180, -1, 1); // outside of the corner raised
      this.bank[i] = bank;
      q.setFromAxisAngle(t, bank);
      const U = uFlat.clone().applyQuaternion(q); // rotate the gravity-aligned normal by the designed bank
      this.U[i] = U; this.L[i] = new THREE.Vector3().crossVectors(U, t).normalize();
      minUp = Math.min(minUp, U.y);
    }
    this.minUp = minUp;
    if (minUp < 0.8) throw new Error('Track frame validation failed (inverted section)');
  }
  _smooth(arr, rad, passes) {
    const N = arr.length; let a = Float32Array.from(arr);
    for (let p = 0; p < passes; p++) {
      const b = new Float32Array(N);
      for (let i = 0; i < N; i++) { let s = 0; for (let k = -rad; k <= rad; k++) s += a[(i + k + N) % N]; b[i] = s / (2 * rad + 1); }
      a = b;
    }
    return a;
  }
  // ---------------------------------------------------------------- surface zones
  _zones() {
    const N = this.N;
    // start straight (Döttinger Höhe) is the stretch around s = 0; pit complex positions are offsets from the line
    this.mainStraight = new Uint8Array(N);
    for (let i = 0; i < N; i++) { const s = i * this.ds; if (this.inRange(s, -640, 630)) this.mainStraight[i] = 1; }
    const W = (s) => this.wrapS(s);
    this.pit = { entry: W(-420), wallStart: W(-290), garStart: W(30), garEnd: W(390), wallEnd: W(510), exit: W(610), limitStart: W(-290), limitEnd: W(510) };
    // kerbs where the smoothed curvature is significant
    this.kerbL = new Uint8Array(N); this.kerbR = new Uint8Array(N);
    const flag = new Uint8Array(N);
    for (let i = 0; i < N; i++) if (Math.abs(this.kappaS[i]) > 1 / 320 && !this.mainStraight[i]) flag[i] = 1;
    for (let i = 0; i < N; i++) if (flag[i]) for (let k = -7; k <= 7; k++) { this.kerbL[(i + k + N) % N] = 1; this.kerbR[(i + k + N) % N] = 1; }
  }
  // ---------------------------------------------------------------- walls / runoff
  _walls() {
    const N = this.N;
    const wantL = new Float32Array(N), wantR = new Float32Array(N);
    for (let i = 0; i < N; i++) { wantL[i] = wantR[i] = this.halfW[i] + 3.2 + 1.5 * NOISE.noise(i * 0.004, 3.3) ** 2 * 4; }
    this.typeL = new Uint8Array(N).fill(SURF.GRASS); this.typeR = new Uint8Array(N).fill(SURF.GRASS);
    // corners: outside gravel / asphalt, inside grass
    const ks = this.kappaS;
    let ci = 0;
    for (let i = 0; i < N; i++) {
      const k = ks[i]; if (Math.abs(k) < 1 / 330) continue;
      const R = 1 / Math.abs(k);
      const cornerIdx = Math.floor(i / 60);
      const outsideType = (cornerIdx % 5 === 2) ? SURF.GRAVEL : (cornerIdx % 5 === 4) ? SURF.RUNOFF : SURF.GRASS;
      const outW = this.halfW[i] + (R < 70 ? 7 : 10);
      for (let d = -22; d <= 22; d++) {
        const j = (i + d + N) % N;
        if (k > 0) { wantR[j] = Math.max(wantR[j], outW); this.typeR[j] = outsideType; }
        else { wantL[j] = Math.max(wantL[j], outW); this.typeL[j] = outsideType; }
      }
      ci++;
    }
    // main straight: asphalt runoff, pit complex on the left (+lateral)
    for (let i = 0; i < N; i++) if (this.mainStraight[i]) {
      const s = i * this.ds;
      this.typeR[i] = SURF.RUNOFF; wantR[i] = 13;
      if (this.inRange(s, this.pit.entry, this.pit.exit)) { this.typeL[i] = SURF.PIT; wantL[i] = PIT.garageU; }
      else { this.typeL[i] = SURF.RUNOFF; wantL[i] = 13; }
    }
    // proximity limits so that walls of neighbouring sections never overlap
    const maxL = new Float32Array(N).fill(60), maxR = new Float32Array(N).fill(60);
    const cell = 60, grid = new Map(), key = (a, b) => a * 73856093 ^ b * 19349663;
    for (let i = 0; i < N; i += 2) { const p = this.P[i]; const k = key(Math.floor(p.x / cell), Math.floor(p.z / cell)); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i); }
    for (let i = 0; i < N; i++) {
      const p = this.P[i], cx = Math.floor(p.x / cell), cz = Math.floor(p.z / cell);
      for (let gx = -2; gx <= 2; gx++) for (let gz = -2; gz <= 2; gz++) {
        const arr = grid.get(key(cx + gx, cz + gz)); if (!arr) continue;
        for (const j of arr) {
          let di = Math.abs(i - j); di = Math.min(di, N - di) * this.ds; if (di < 160) continue;
          const dx = this.P[j].x - p.x, dz = this.P[j].z - p.z, d = Math.hypot(dx, dz); if (d > 150) continue;
          const lat = (dx * this.L[i].x + dz * this.L[i].z) / d;
          if (Math.abs(lat) < 0.45) continue;
          const lim = (d - this.halfW[i] - this.halfW[j]) / 2 + this.halfW[i] - 4;
          if (lat > 0) maxL[i] = Math.min(maxL[i], lim); else maxR[i] = Math.min(maxR[i], lim);
        }
      }
    }
    const fixW = (want, max) => {
      let a = new Float32Array(N); for (let i = 0; i < N; i++) a[i] = Math.min(want[i], max[i]);
      a = this._smooth(a, 12, 3);
      for (let i = 0; i < N; i++) a[i] = Math.max(this.halfW[i] + 4, Math.min(a[i], max[i]));
      return this._smooth(a, 3, 1);
    };
    this.wallL = fixW(wantL, maxL); this.wallR = fixW(wantR, maxR);
    // keep the pit garage line straight and exact
    for (let i = 0; i < N; i++) { const s = i * this.ds; if (this.mainStraight[i] && this.inRange(s, this.pit.wallStart, this.pit.wallEnd)) this.wallL[i] = PIT.garageU; }
    this.vergeL = new Float32Array(N); this.vergeR = new Float32Array(N);
    for (let i = 0; i < N; i++) { this.vergeL[i] = clamp(maxL[i] - this.wallL[i], 0, 22); this.vergeR[i] = clamp(maxR[i] - this.wallR[i], 0, 22); }
    this.vergeL = this._smooth(this.vergeL, 6, 2); this.vergeR = this._smooth(this.vergeR, 6, 2);
    // barrier style: 0 = armco, 1 = concrete
    this.barrierL = new Uint8Array(N); this.barrierR = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      this.barrierL[i] = (this.mainStraight[i] || this.typeL[i] === SURF.RUNOFF) ? 1 : 0;
      this.barrierR[i] = (this.mainStraight[i] || this.typeR[i] === SURF.RUNOFF) ? 1 : 0;
    }
  }
  _corners() {
    const N = this.N, k = this._smooth(this.kappa, 4, 1), th = 1 / 330;
    const segs = []; let cur = null;
    for (let i = 0; i < N; i++) {
      const on = Math.abs(k[i]) > th, sg = Math.sign(k[i]);
      if (on && (!cur || cur.sign !== sg)) { if (cur) segs.push(cur); cur = { start: i, end: i, sign: sg, peak: Math.abs(k[i]), apex: i }; }
      else if (on) { cur.end = i; if (Math.abs(k[i]) > cur.peak) { cur.peak = Math.abs(k[i]); cur.apex = i; } }
      else if (cur) { segs.push(cur); cur = null; }
    }
    if (cur) segs.push(cur);
    // merge tiny gaps of same sign, drop insignificant blips
    const out = [];
    for (const s of segs) {
      const last = out[out.length - 1];
      if (last && last.sign === s.sign && (s.start - last.end) * this.ds < 24) { last.end = s.end; if (s.peak > last.peak) { last.peak = s.peak; last.apex = s.apex; } continue; }
      if ((s.end - s.start) * this.ds < 14 && s.peak < 1 / 160) continue;
      out.push(s);
    }
    this.corners = out.map((c, n) => ({ ...c, num: n + 1, radius: 1 / c.peak, s: c.start * this.ds, dir: c.sign > 0 ? 'L' : 'R' }));
  }
  // ---------------------------------------------------------------- racing line + speed profile
  _racingLine() {
    const N = this.N, off = new Float32Array(N);
    const px = new Float32Array(N), pz = new Float32Array(N);
    for (let it = 0; it < 500; it++) {
      for (let i = 0; i < N; i++) { px[i] = this.P[i].x + this.L[i].x * off[i]; pz[i] = this.P[i].z + this.L[i].z * off[i]; }
      for (let i = 0; i < N; i++) {
        const a = (i - 3 + N) % N, b = (i + 3) % N;
        const tx = (px[a] + px[b]) / 2 - px[i], tz = (pz[a] + pz[b]) / 2 - pz[i];
        const lim = this.halfW[i] - 1.5;
        off[i] = clamp(off[i] + (tx * this.L[i].x + tz * this.L[i].z) * 0.6, -lim, lim);
      }
    }
    this.rl = this._smooth(off, 2, 1);
    // curvature of the racing line
    for (let i = 0; i < N; i++) { px[i] = this.P[i].x + this.L[i].x * this.rl[i]; pz[i] = this.P[i].z + this.L[i].z * this.rl[i]; }
    const k = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = (i - 4 + N) % N, b = (i + 4) % N;
      const ax = px[i] - px[a], az = pz[i] - pz[a], bx = px[b] - px[i], bz = pz[b] - pz[i];
      const la = Math.hypot(ax, az), lb = Math.hypot(bx, bz);
      const cr = (ax * bz - az * bx) / (la * lb); k[i] = Math.asin(clamp(cr, -1, 1)) / ((la + lb) / 2);
    }
    this.rlK = this._smooth(k, 3, 2);
    this.rlX = px; this.rlZ = pz;
  }
  // speed profile for a given grip coefficient (used by AI)
  speedProfile(mu, car) {
    const c = car || { mass: 1500, ClA: 0.3, CdA: 0.8, peakPower: 350000, vmax: 85, driveFront: 0.3 };
    const N = this.N, v = new Float32Array(N), m = c.mass, rho = 1.225, ClA = c.ClA, CdA = c.CdA, P = c.peakPower, g = 9.81, vcap = c.vmax;
    const ka = 0.5 * rho * ClA / m;
    for (let i = 0; i < N; i++) {
      const kk = Math.abs(this.rlK[i]);
      const den = kk - mu * ka;
      v[i] = den <= 1e-6 ? vcap : Math.min(vcap, Math.sqrt(mu * g / den));
    }
    for (let pass = 0; pass < 2; pass++) {
      for (let n = 0; n < N * 2; n++) { // braking (backwards)
        const i = (N * 2 - n) % N, j = (i + 1) % N, vj = v[j];
        const a = mu * 0.92 * (g + ka * vj * vj) + 0.5 * rho * CdA * vj * vj / m;
        v[i] = Math.min(v[i], Math.sqrt(vj * vj + 2 * a * this.ds));
      }
      for (let n = 0; n < N * 2; n++) { // traction (forwards)
        const i = n % N, j = (i + 1) % N, vi = Math.max(v[i], 5);
        const a = Math.min(mu * g * 0.75, P / (m * vi)) - 0.5 * rho * CdA * vi * vi / m;
        v[j] = Math.min(v[j], Math.sqrt(Math.max(0, vi * vi + 2 * Math.max(a, 0) * this.ds)));
      }
    }
    return v;
  }
  _grid() {
    this.cell = 40; this.gmap = new Map();
    for (let i = 0; i < this.N; i++) { const k = this._gkey(Math.floor(this.P[i].x / this.cell), Math.floor(this.P[i].z / this.cell)); let a = this.gmap.get(k); if (!a) this.gmap.set(k, a = []); a.push(i); }
  }
  _gkey(a, b) { return (a + 2000) * 4096 + (b + 2000); }
  _sectors() {
    const L = this.length;
    this.sectorS = [0, L * 0.34, L * 0.68];
    this.cpCount = 64; // ordered checkpoints every ~325 m
    this.checkpoints = []; for (let k = 1; k < this.cpCount; k++) this.checkpoints.push(L * k / this.cpCount);
    // DRS (only cars with an active rear wing use it): zone A = Döttinger Höhe, zone B = longest other straight
    const N = this.N, straight = new Uint8Array(N);
    for (let i = 0; i < N; i++) straight[i] = Math.abs(this.kappaS[i]) < 1 / 900 ? 1 : 0;
    let best = null, run = null;
    for (let n = 0; n < N * 2; n++) {
      const i = n % N;
      if (straight[i] && !this.mainStraight[i]) { if (!run) run = { a: n, b: n }; else run.b = n; }
      else if (run) { if (!best || run.b - run.a > best.b - best.a) best = run; run = null; if (n >= N) break; }
    }
    this.drsZones = [{ detect: this.wrapS(-680), start: this.wrapS(-360), end: this.wrapS(630) }];
    if (best && (best.b - best.a) * this.ds > 450) { const a = best.a * this.ds, b = best.b * this.ds; this.drsZones.push({ detect: this.wrapS(a - 150), start: this.wrapS(a + 40), end: this.wrapS(b - 60) }); }
  }
  sectionAt(s) { return this.secName[this.idxAt(s)] || ''; }
  // ---------------------------------------------------------------- queries
  nearest(x, z, hint) {
    const N = this.N;
    if (hint >= 0) {
      let b = -1, bd = Infinity;
      for (let k = -10; k <= 10; k++) { const i = (hint + k + N) % N, p = this.P[i]; const d = (p.x - x) ** 2 + (p.z - z) ** 2; if (d < bd) { bd = d; b = i; } }
      const di = Math.abs(b - hint), dd = Math.min(di, N - di);
      if (bd < 70 * 70 && dd < 9) return b;
    }
    const cx = Math.floor(x / this.cell), cz = Math.floor(z / this.cell);
    let b = 0, bd = Infinity;
    for (let r = 0; r < 14; r++) {
      for (let gx = -r; gx <= r; gx++) for (let gz = -r; gz <= r; gz++) {
        if (Math.max(Math.abs(gx), Math.abs(gz)) !== r) continue;
        const a = this.gmap.get(this._gkey(cx + gx, cz + gz)); if (!a) continue;
        for (const i of a) { const p = this.P[i]; const d = (p.x - x) ** 2 + (p.z - z) ** 2; if (d < bd) { bd = d; b = i; } }
      }
      if (bd < ((r) * this.cell) ** 2) break;
    }
    return b;
  }
  // Full surface query. Writes into `o` and returns it.
  query(x, z, hint, o) {
    const N = this.N; let i = this.nearest(x, z, hint);
    let j = i, P0 = this.P[i], P1 = this.P[(i + 1) % N];
    let dx = P1.x - P0.x, dz = P1.z - P0.z, len2 = dx * dx + dz * dz;
    let t = ((x - P0.x) * dx + (z - P0.z) * dz) / len2;
    if (t < 0) { j = (i - 1 + N) % N; P0 = this.P[j]; P1 = this.P[i]; dx = P1.x - P0.x; dz = P1.z - P0.z; len2 = dx * dx + dz * dz; t = ((x - P0.x) * dx + (z - P0.z) * dz) / len2; }
    t = clamp(t, 0, 1);
    const k = (j + 1) % N;
    const L0 = this.L[j], L1 = this.L[k], U0 = this.U[j], U1 = this.U[k];
    const cx = lerp(P0.x, P1.x, t), cy = lerp(P0.y, P1.y, t), cz = lerp(P0.z, P1.z, t);
    const lx = lerp(L0.x, L1.x, t), ly = lerp(L0.y, L1.y, t), lz = lerp(L0.z, L1.z, t);
    const lh2 = lx * lx + lz * lz;
    const u = ((x - cx) * lx + (z - cz) * lz) / lh2;
    let nx = lerp(U0.x, U1.x, t), ny = lerp(U0.y, U1.y, t), nz = lerp(U0.z, U1.z, t); const nl = Math.hypot(nx, ny, nz);
    o.i = j; o.t = t; o.s = (j + t) * this.ds; o.u = u;
    o.nx = nx / nl; o.ny = ny / nl; o.nz = nz / nl;
    o.tx = lerp(this.T[j].x, this.T[k].x, t); o.tz = lerp(this.T[j].z, this.T[k].z, t);
    o.lx = lx; o.lz = lz;
    o.halfW = lerp(this.halfW[j], this.halfW[k], t);
    o.wallL = lerp(this.wallL[j], this.wallL[k], t); o.wallR = lerp(this.wallR[j], this.wallR[k], t);
    let y = cy + ly * u;
    const au = Math.abs(u), left = u >= 0;
    const kerb = left ? this.kerbL[j] : this.kerbR[j];
    let surf;
    if (au <= o.halfW) surf = SURF.ROAD;
    else if (kerb && au <= o.halfW + KERB_W) { surf = SURF.KERB; const f = (au - o.halfW) / KERB_W; y += 0.05 * Math.sin(Math.PI * Math.min(f * 1.25, 1)) * (0.9 + 0.1 * Math.sin(o.s * 6)); }
    else if (au <= o.halfW + (kerb ? KERB_W : 0) + 0.8) surf = SURF.EDGE;
    else if (au >= (left ? o.wallL : o.wallR) - 1.2) surf = SURF.CONCRETE;
    else {
      surf = left ? this.typeL[j] : this.typeR[j];
      if (left && surf === SURF.PIT && au < PIT.laneIn && this.inRange(o.s, this.pit.wallStart, this.pit.wallEnd)) surf = SURF.RUNOFF;
    }
    o.surf = surf; o.y = y;
    o.pitWall = left && this.mainStraight[j] && this.inRange(o.s, this.pit.wallStart, this.pit.wallEnd);
    return o;
  }
  // Frame at arc length s and lateral offset u (position on the road plane)
  frameAt(s, u = 0, out = {}) {
    s = this.wrapS(s); const f = s / this.ds, j = Math.floor(f) % this.N, k = (j + 1) % this.N, t = f - Math.floor(f);
    // out.reuse = true lets per-frame callers recycle the vectors (no allocation)
    const R = out.reuse && out.pos;
    const p = (R ? out.pos : new THREE.Vector3()).lerpVectors(this.P[j], this.P[k], t);
    const L = (R ? out.L : new THREE.Vector3()).lerpVectors(this.L[j], this.L[k], t).normalize();
    const U = (R ? out.U : new THREE.Vector3()).lerpVectors(this.U[j], this.U[k], t).normalize();
    const T = (R ? out.T : new THREE.Vector3()).lerpVectors(this.T[j], this.T[k], t).normalize();
    out.pos = p.addScaledVector(L, u); out.L = L; out.U = U; out.T = T; out.i = j;
    out.heading = Math.atan2(T.x, T.z);
    return out;
  }
  sampleVal(arr, s) { s = this.wrapS(s); const f = s / this.ds, j = Math.floor(f) % this.N, k = (j + 1) % this.N; return lerp(arr[j], arr[k], f - Math.floor(f)); }

  // ---------------------------------------------------------------- mesh construction
  // Generic strip: cols lateral positions per row from colFn(i) -> [u...], liftFn optional
  _strip(opts) {
    // rows R0..R1+1 only (the current chunk); r below is the global row index so UVs stay continuous
    const N = this.N, cols = opts.cols, R0 = this._rows ? this._rows[0] : 0, R1 = this._rows ? this._rows[1] : N - 1; const rows = R1 - R0 + 2;
    const pos = new Float32Array(rows * cols * 3), nor = new Float32Array(rows * cols * 3), uv = new Float32Array(rows * cols * 2);
    const col = opts.color ? new Float32Array(rows * cols * 3) : null;
    const texLen = this.length / Math.max(1, Math.round(this.length / (opts.texLen || 16)));
    for (let rr = 0; rr < rows; rr++) {
      const r = R0 + rr, i = r % N, C = this.P[i], L = this.L[i], U = this.U[i];
      for (let c = 0; c < cols; c++) {
        const [u, lift, uu, nOverride] = opts.vert(i, c);
        const k = rr * cols + c;
        pos[k * 3] = C.x + L.x * u + U.x * lift; pos[k * 3 + 1] = C.y + L.y * u + U.y * lift; pos[k * 3 + 2] = C.z + L.z * u + U.z * lift;
        const n = nOverride || U; nor[k * 3] = n.x; nor[k * 3 + 1] = n.y; nor[k * 3 + 2] = n.z;
        uv[k * 2] = uu; uv[k * 2 + 1] = (r * this.ds) / texLen;
        if (col) { const cc = opts.color(i, c, u); col[k * 3] = cc; col[k * 3 + 1] = cc; col[k * 3 + 2] = cc; }
      }
    }
    const idx = [];
    for (let rr = 0; rr < rows - 1; rr++) {
      const r = (R0 + rr) % N;
      if (opts.include && !opts.include(r)) continue;
      for (let c = 0; c < cols - 1; c++) {
        if (opts.skipCol && opts.skipCol(r, c)) continue;
        const a = rr * cols + c, b = (rr + 1) * cols + c, cc = rr * cols + c + 1, d = (rr + 1) * cols + c + 1;
        if (opts.flip) idx.push(a, cc, b, cc, d, b); else idx.push(a, b, cc, cc, b, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    if (col) g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(idx); if (opts.computeNormals) g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
  // Small decal patch between s0..s1 and lateral u0..u1 (follows road plane)
  patchGeo(s0, s1, u0, u1, lift = 0.012, uvRep = [1, 1]) {
    const steps = Math.max(1, Math.ceil(Math.abs(s1 - s0) / 2));
    const pos = [], uv = [], nor = [], idx = [];
    for (let r = 0; r <= steps; r++) {
      const s = lerp(s0, s1, r / steps), f = this.frameAt(s, 0);
      for (let c = 0; c < 2; c++) {
        const u = c ? u1 : u0;
        const p = f.pos.clone().addScaledVector(f.L, u).addScaledVector(f.U, lift);
        pos.push(p.x, p.y, p.z); nor.push(f.U.x, f.U.y, f.U.z); uv.push(c * uvRep[0], r / steps * uvRep[1]);
      }
    }
    for (let r = 0; r < steps; r++) { const a = r * 2, b = (r + 1) * 2; idx.push(a, b, a + 1, a + 1, b, b + 1); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); return g;
  }
  buildMeshes(M, low = false) {
    const root = new THREE.Group(); root.name = 'track';
    const CH = low ? 400 : 1000; // samples per chunk (~2 km; ~0.8 km on low-detail devices, which also distance-cull them)
    for (let r0 = 0; r0 < this.N; r0 += CH) {
      this._rows = [r0, Math.min(this.N - 1, r0 + CH - 1)];
      const g = new THREE.Group(); g.name = 'track-chunk'; this._buildChunk(g, M); mergeStaticByMaterial(g); root.add(g);
    }
    this._rows = null;
    const mk = new THREE.Group(); mk.name = 'track-markings'; this._markings(mk, M); mergeStaticByMaterial(mk); root.add(mk);
    return root;
  }
  _buildChunk(group, M) {
    const N = this.N;
    const add = (g, mat, opts = {}) => { if (!g.index || g.index.count === 0) { g.dispose(); return null; } const m = new THREE.Mesh(g, mat); m.receiveShadow = true; m.castShadow = !!opts.cast; if (opts.order) m.renderOrder = opts.order; group.add(m); return m; };
    // ---- racing surface: 13 lateral columns, vertex colour = rubber deposits along racing line
    const RC = 13;
    add(this._strip({
      cols: RC, texLen: 16,
      vert: (i, c) => { const hw = this.halfW[i]; const u = lerp(-hw, hw, c / (RC - 1)); return [u, 0, c / (RC - 1)]; },
      color: (i, c, u) => { const d = u - this.rl[i]; const brake = clamp((this.vRef ? (this.vRef[(i + 20) % N] < this.vRef[i] - 3 ? 1 : 0) : 0), 0, 1); return 1 - (0.22 + 0.1 * brake) * Math.exp(-(d * d) / 3.2); }
    }), M.road);
    // ---- kerbs (raised, profiled)
    const kerbProfile = [0, 0.25, 0.5, 0.8, 1];
    for (const side of [1, -1]) {
      const flags = side > 0 ? this.kerbL : this.kerbR;
      add(this._strip({
        cols: kerbProfile.length, texLen: 4, computeNormals: true, flip: side < 0,
        vert: (i, c) => { const f = kerbProfile[c]; const u = side * (this.halfW[i] + f * KERB_W); return [u, 0.05 * Math.sin(Math.PI * Math.min(f * 1.25, 1)) + 0.002, f]; },
        include: (r) => flags[r] && flags[(r + 1) % N]
      }), M.kerb);
    }
    // ---- shoulders: edge strip + runoff by surface type
    for (const side of [1, -1]) {
      const kerb = side > 0 ? this.kerbL : this.kerbR, wall = side > 0 ? this.wallL : this.wallR, type = side > 0 ? this.typeL : this.typeR;
      const inner = (i) => this.halfW[i] + (kerb[i] ? KERB_W : 0);
      const edgeU = (i) => inner(i) + 0.8;
      // edge strip (asphalt, no lines)
      add(this._strip({ cols: 2, texLen: 8, flip: side < 0, vert: (i, c) => [side * (c ? edgeU(i) : inner(i)), -0.003, c * 0.06] }), M.runoff);
      const types = [SURF.RUNOFF, SURF.GRASS, SURF.GRAVEL, SURF.PIT];
      for (const ty of types) {
        const mat = ty === SURF.GRASS ? M.grass : ty === SURF.GRAVEL ? M.gravel : M.runoff;
        add(this._strip({
          cols: 3, texLen: ty === SURF.GRASS ? 12 : 8, flip: side < 0,
          vert: (i, c) => { const a = edgeU(i), b = wall[i] - 1.2; const u = side * lerp(a, b, c / 2); return [u, ty === SURF.GRAVEL ? -0.02 : -0.004, (lerp(a, b, c / 2)) / 8]; },
          include: (r) => type[r] === ty
        }), mat);
      }
      // concrete apron at the barrier base
      add(this._strip({ cols: 2, texLen: 8, flip: side < 0, vert: (i, c) => [side * (wall[i] - 1.2 + c * 1.2), -0.004, c * 0.15] }), M.concrete);
      // verge beyond the barrier, then a skirt dropping into the terrain
      const verge = side > 0 ? this.vergeL : this.vergeR;
      add(this._strip({
        cols: 4, texLen: 12, flip: side < 0,
        vert: (i, c) => { const w = wall[i]; const us = [w, w + 0.6, w + 0.6 + verge[i], w + 0.6 + verge[i] + 0.5]; const lifts = [-0.004, -0.004, -0.4, -3.5]; return [side * us[c], lifts[c], us[c] / 12]; },
        computeNormals: true
      }), M.grass);
    }
    // ---- barriers
    this._barriers(group, M);
  }
  _barriers(group, M) {
    const N = this.N;
    const concreteGeos = [], railGeos = [], fenceGeos = [], postMatrices = [];
    for (const side of [1, -1]) {
      const wall = side > 0 ? this.wallL : this.wallR, style = side > 0 ? this.barrierL : this.barrierR;
      // concrete wall profile (inner face exactly at the collision offset)
      const prof = [[0, 0], [0, 1.05], [0.35, 1.1], [0.55, 0]];
      concreteGeos.push(this._strip({ cols: 4, texLen: 6, computeNormals: true, flip: side < 0, vert: (i, c) => [side * (wall[i] + prof[c][0]), prof[c][1], c / 3], include: (r) => style[r] || style[(r + 1) % N] }));
      // armco: double W-beam rails
      const rprof = [[0.05, 0.45], [0, 0.55], [0.05, 0.65], [0, 0.75], [0.05, 0.85]];
      railGeos.push(this._strip({ cols: 5, texLen: 4, computeNormals: true, flip: side < 0, vert: (i, c) => [side * (wall[i] + rprof[c][0]), rprof[c][1], c / 4], include: (r) => !style[r] }));
      // catch fence (debris fence) on top of everything
      fenceGeos.push(this._strip({ cols: 2, texLen: 3, flip: side < 0, vert: (i, c) => [side * (wall[i] + 0.3), style[i] ? (c ? 4.2 : 1.1) : (c ? 3.4 : 0.9), c ? 1.0 : 0.0] }));
      const [R0, R1] = this._rows || [0, N - 1];
      for (let i = R0 - (R0 % 2); i <= R1; i += 2) {
        const f = this.frameAt(i * this.ds, side * (wall[i] + 0.35));
        if (!style[i]) postMatrices.push([f.pos.x, f.pos.y, f.pos.z, 0.9]);
        if (i % 3 === 0) postMatrices.push([f.pos.x, f.pos.y, f.pos.z, style[i] ? 4.3 : 3.5]);
      }
    }
    // pit wall
    const pw = this._strip({ cols: 4, texLen: 6, computeNormals: true, vert: (i, c) => { const pr = [[0, 0], [0, 1.1], [0.5, 1.1], [0.5, 0]]; return [PIT.wallU + pr[c][0], pr[c][1], c / 3]; }, include: (r) => this.mainStraight[r] && this.inRange(r * this.ds, this.pit.wallStart, this.pit.wallEnd) });
    concreteGeos.push(pw);
    fenceGeos.push(this._strip({ cols: 2, texLen: 3, vert: (i, c) => [PIT.wallU + 0.25, c ? 3.6 : 1.1, c], include: (r) => this.mainStraight[r] && this.inRange(r * this.ds, this.pit.wallStart, this.pit.wallEnd) }));
    for (const g of concreteGeos) { if (!g.index || !g.index.count) continue; const m = new THREE.Mesh(g, M.wall); m.castShadow = true; m.receiveShadow = true; group.add(m); }
    for (const g of railGeos) { if (!g.index || !g.index.count) continue; const m = new THREE.Mesh(g, M.armco); m.castShadow = true; m.receiveShadow = true; group.add(m); }
    for (const g of fenceGeos) { if (!g.index || !g.index.count) continue; const m = new THREE.Mesh(g, M.fence); group.add(m); }
    if (postMatrices.length) {
    const post = new THREE.CylinderGeometry(0.06, 0.06, 1, 6); post.translate(0, 0.5, 0);
    const posts = new THREE.InstancedMesh(post, M.metal, postMatrices.length);
    postMatrices.forEach((p, k) => { _m4.compose(_v1.set(p[0], p[1], p[2]), _q.identity(), _v2.set(1, p[3], 1)); posts.setMatrixAt(k, _m4); });
    posts.computeBoundingSphere(); posts.castShadow = true; group.add(posts);
    }
  }
  _markings(group, M) {
    const white = [], yellow = [];
    const HW = (s) => this.sampleVal(this.halfW, s);
    // start / finish chequered line
    group.add(new THREE.Mesh(this.patchGeo(-0.8, 0.8, -HW(0), HW(0), 0.013, [16 / 4, 1]), M.checker));
    // grid boxes (staggered, pole on the right)
    this.grid = [];
    for (let k = 0; k < 12; k++) {
      const s = -9 - k * 8, u = (k % 2 === 0) ? -3.6 : 3.6;
      this.grid.push({ s, u });
      white.push(this.patchGeo(s - 0.12, s + 0.12, u - 1.6, u + 1.6));
      white.push(this.patchGeo(s - 2.6, s, u - 1.6, u - 1.45));
      white.push(this.patchGeo(s - 2.6, s, u + 1.45, u + 1.6));
    }
    // sector lines (thin dashes across the track)
    for (const ss of this.sectorS.slice(1)) for (let d = -1; d <= 1; d += 2) yellow.push(this.patchGeo(ss - 0.15, ss + 0.15, d > 0 ? 0.3 : -HW(ss), d > 0 ? HW(ss) : -0.3));
    // DRS detection (dashed) and activation (solid) lines
    for (const z of this.drsZones) {
      const hw = HW(z.detect);
      for (let u = -hw; u < hw - 0.5; u += 1.6) white.push(this.patchGeo(z.detect - 0.2, z.detect + 0.2, u, u + 0.8));
      white.push(this.patchGeo(z.start - 0.2, z.start + 0.2, -HW(z.start), HW(z.start)));
    }
    // pit lane: entry/exit separation line, fast lane line, speed-limit lines
    const p = this.pit, L = this.length;
    const pitLen = (this.wrapS(p.wallStart - p.entry));
    for (let s = p.entry; ; s += 2) {
      const f = (this.wrapS(s - p.entry)) / pitLen; if (f > 1) break;
      const u = lerp(this.sampleVal(this.halfW, s) + 0.5, PIT.wallU, smoothstep(0, 1, f));
      white.push(this.patchGeo(s, s + 2, u, u + 0.2));
    }
    const exitLen = this.wrapS(p.exit - p.wallEnd);
    for (let s = p.wallEnd; ; s += 2) {
      const f = this.wrapS(s - p.wallEnd) / exitLen; if (f > 1) break;
      const u = lerp(PIT.wallU, this.sampleVal(this.halfW, s) + 0.5, smoothstep(0, 1, f));
      white.push(this.patchGeo(s, s + 2, u, u + 0.2));
    }
    const lane = this.wrapS(p.wallEnd - p.wallStart);
    for (let d = 0; d < lane; d += 6) white.push(this.patchGeo(p.wallStart + d, p.wallStart + d + 3, PIT.fastLane, PIT.fastLane + 0.15));
    for (const s of [p.limitStart, p.limitEnd]) yellow.push(this.patchGeo(s - 0.3, s + 0.3, PIT.laneIn, PIT.garageU));
    // garage boxes
    const gl = this.wrapS(p.garEnd - p.garStart);
    for (let d = 0; d <= gl; d += 16) white.push(this.patchGeo(p.garStart + d - 0.08, p.garStart + d + 0.08, PIT.fastLane + 0.6, PIT.garageU));
    const wg = new THREE.Mesh(mergeList(white), M.paint); wg.receiveShadow = true; group.add(wg);
    const yg = new THREE.Mesh(mergeList(yellow), M.paintY); yg.receiveShadow = true; group.add(yg);
  }
}
