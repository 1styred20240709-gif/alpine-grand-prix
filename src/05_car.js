
// =====================================================================
// FORMULA CAR MODEL — procedural, model space: y=0 ground (static ride),
// z=0 at the centre of gravity, +z forward, +x = car's left.
// =====================================================================
const CAR = {
  frontAxle: 1.944, rearAxle: -1.656, xF: 0.80, xR: 0.78, radius: 0.36, rimR: 0.229,
  widthF: 0.305, widthR: 0.405, cgH: 0.30, anchorY: 0.148, eye: new THREE.Vector3(0, 0.83, 0.08)
};
// Superellipse loft along z. sections front->back: {z, w, yt, yb, x?, n?, ym?}
function loftZ(sections, M = 28, capFront = true, capBack = true, mirrorX = 1) {
  const pos = [], uv = [], idx = [];
  let total = 0; for (let i = 1; i < sections.length; i++) total += Math.abs(sections[i].z - sections[i - 1].z);
  let acc = 0;
  sections.forEach((s, i) => {
    if (i > 0) acc += Math.abs(s.z - sections[i - 1].z);
    const n = s.n || 2.6, ym = s.ym != null ? s.ym : (s.yt + s.yb) / 2, cx = (s.x || 0) * mirrorX;
    for (let j = 0; j <= M; j++) {
      const th = j / M * TAU, c = Math.cos(th), sn = Math.sin(th);
      const ex = Math.sign(c) * Math.pow(Math.abs(c), 2 / n), ey = Math.sign(sn) * Math.pow(Math.abs(sn), 2 / n);
      const x = cx + ex * s.w / 2, y = ey >= 0 ? ym + ey * (s.yt - ym) : ym + ey * (ym - s.yb);
      pos.push(x, y, s.z); uv.push(j / M, acc / total);
    }
  });
  const R = M + 1;
  for (let i = 0; i < sections.length - 1; i++) for (let j = 0; j < M; j++) { const a = i * R + j, b = (i + 1) * R + j; idx.push(a, b, a + 1, a + 1, b, b + 1); }
  const addCap = (ring, front) => {
    const s = sections[ring], ym = s.ym != null ? s.ym : (s.yt + s.yb) / 2; const c = pos.length / 3;
    pos.push((s.x || 0) * mirrorX, ym, s.z); uv.push(0.5, front ? 0 : 1);
    for (let j = 0; j < M; j++) { const a = ring * R + j; if (front) idx.push(c, a, a + 1); else idx.push(c, a + 1, a); }
  };
  if (capFront) addCap(0, true); if (capBack) addCap(sections.length - 1, false);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}
// Airfoil loft along x (span). spans: [{x, z (leading edge), y, c (chord), a (angle, + = trailing edge up), t (thickness ratio)}]
function wingX(spans, K = 14) {
  const pos = [], idx = [], uv = [];
  const prof = [];
  for (let k = 0; k <= K; k++) { const xx = 1 - Math.cos(k / K * Math.PI) * 0.5 - 0.5; prof.push(xx); } // cosine spacing 0..1
  spans.forEach((sp, si) => {
    const pts = [];
    const th = (x) => 5 * sp.t * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
    for (let k = K; k >= 0; k--) { const x = prof[k]; pts.push([x, th(x) - 0.04 * x * (1 - x) * 4 * sp.t]); }      // upper TE->LE
    for (let k = 1; k <= K; k++) { const x = prof[k]; pts.push([x, -th(x) - 0.04 * x * (1 - x) * 4 * sp.t]); }   // lower LE->TE
    const ca = Math.cos(sp.a), sa = Math.sin(sp.a);
    pts.forEach(([x, y], j) => {
      const lz = -x * sp.c, ly = y * sp.c; // chord runs backwards (-z)
      // rotate about x so that a positive angle raises the trailing edge
      const zr = lz * ca + ly * sa, yr = -lz * sa + ly * ca;
      pos.push(sp.x, sp.y + yr, sp.z + zr); uv.push(j / (2 * K), si / (spans.length - 1));
    });
  });
  const R = 2 * K + 1;
  for (let i = 0; i < spans.length - 1; i++) for (let j = 0; j < R - 1; j++) { const a = i * R + j, b = (i + 1) * R + j; idx.push(a, b, a + 1, a + 1, b, b + 1); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}
// Flat plate defined by a polygon in the (z,y) plane, extruded in x
function plateZY(pts, thick, x) {
  const sh = new THREE.Shape(); pts.forEach(([z, y], i) => i ? sh.lineTo(-z, y) : sh.moveTo(-z, y));
  const g = new THREE.ExtrudeGeometry(sh, { depth: thick, bevelEnabled: false, curveSegments: 6 });
  g.rotateY(Math.PI / 2); g.translate(x - thick / 2, 0, 0);
  return g;
}
const CarAssets = {
  built: false,
  build() {
    if (this.built) return; this.built = true;
    const G = { paint: [], accent: [], carbon: [], dark: [], metal: [], halo: [], light: [] };
    // ---------------- nose
    G.paint.push(loftZ([
      { z: 2.80, w: 0.16, yt: 0.29, yb: 0.17, n: 2.2 }, { z: 2.62, w: 0.24, yt: 0.33, yb: 0.165 }, { z: 2.40, w: 0.29, yt: 0.37, yb: 0.17 },
      { z: 2.12, w: 0.34, yt: 0.43, yb: 0.19 }, { z: 1.82, w: 0.40, yt: 0.49, yb: 0.21 }, { z: 1.50, w: 0.48, yt: 0.55, yb: 0.21 },
      { z: 1.20, w: 0.56, yt: 0.60, yb: 0.19 }, { z: 1.00, w: 0.62, yt: 0.64, yb: 0.16 }], 28, true, false));
    G.accent.push(loftZ([{ z: 2.84, w: 0.12, yt: 0.27, yb: 0.18, n: 2.2 }, { z: 2.78, w: 0.17, yt: 0.295, yb: 0.168 }], 20, true, true));
    // ---------------- monocoque / airbox / engine cover
    G.paint.push(loftZ([
      { z: 1.00, w: 0.62, yt: 0.64, yb: 0.16, n: 3 }, { z: 0.85, w: 0.70, yt: 0.68, yb: 0.13, n: 3 }, { z: 0.70, w: 0.76, yt: 0.665, yb: 0.12, n: 3 },
      { z: 0.60, w: 0.80, yt: 0.50, yb: 0.12, n: 3.2 }, { z: 0.20, w: 0.82, yt: 0.48, yb: 0.12, n: 3.2 }, { z: -0.12, w: 0.82, yt: 0.50, yb: 0.12, n: 3.2 },
      { z: -0.22, w: 0.80, yt: 0.74, yb: 0.12, n: 3 }, { z: -0.40, w: 0.74, yt: 0.96, yb: 0.14, n: 2.6, ym: 0.5 }, { z: -0.66, w: 0.68, yt: 0.93, yb: 0.16, n: 2.6, ym: 0.5 },
      { z: -1.00, w: 0.56, yt: 0.79, yb: 0.18, n: 2.6 }, { z: -1.40, w: 0.44, yt: 0.65, yb: 0.20, n: 2.6 }, { z: -1.80, w: 0.32, yt: 0.53, yb: 0.22, n: 2.4 },
      { z: -2.15, w: 0.24, yt: 0.45, yb: 0.24, n: 2.2 }, { z: -2.30, w: 0.18, yt: 0.41, yb: 0.26, n: 2.2 }], 32, false, true));
    // cockpit side rails, interior, headrest
    for (const s of [1, -1]) G.paint.push(loftZ([{ z: 0.64, w: 0.08, yt: 0.62, yb: 0.42, x: 0.37 }, { z: 0.40, w: 0.10, yt: 0.655, yb: 0.42, x: 0.37 }, { z: -0.05, w: 0.10, yt: 0.66, yb: 0.42, x: 0.36 }, { z: -0.20, w: 0.10, yt: 0.70, yb: 0.42, x: 0.35 }], 14, true, true, s));
    G.dark.push(loftZ([{ z: 0.62, w: 0.58, yt: 0.495, yb: 0.40, n: 4 }, { z: 0.30, w: 0.62, yt: 0.495, yb: 0.40, n: 4 }, { z: -0.16, w: 0.62, yt: 0.5, yb: 0.40, n: 4 }], 20));
    G.dark.push(loftZ([{ z: -0.12, w: 0.64, yt: 0.70, yb: 0.48, n: 3.5 }, { z: -0.22, w: 0.66, yt: 0.72, yb: 0.48, n: 3.5 }], 20));
    // airbox intake opening
    G.dark.push(xform(new THREE.CircleGeometry(1, 24), 0, 0.865, -0.255, 0, 0, 0, 0.11, 0.075, 1));
    G.carbon.push(loftZ([{ z: -0.245, w: 0.25, yt: 0.95, yb: 0.78, n: 2.2 }, { z: -0.30, w: 0.28, yt: 0.965, yb: 0.77, n: 2.2 }], 20, false, false));
    // ---------------- sidepods
    for (const s of [1, -1]) {
      G.paint.push(loftZ([
        { z: 0.62, x: 0.50, w: 0.30, yt: 0.55, yb: 0.22, n: 2.6 }, { z: 0.56, x: 0.52, w: 0.38, yt: 0.585, yb: 0.17 }, { z: 0.30, x: 0.53, w: 0.42, yt: 0.60, yb: 0.15 },
        { z: -0.15, x: 0.51, w: 0.40, yt: 0.575, yb: 0.13 }, { z: -0.60, x: 0.46, w: 0.33, yt: 0.52, yb: 0.13 }, { z: -1.00, x: 0.38, w: 0.25, yt: 0.44, yb: 0.15 },
        { z: -1.45, x: 0.27, w: 0.13, yt: 0.34, yb: 0.20, n: 2.2 }], 26, false, true, s));
      G.dark.push(loftZ([{ z: 0.625, x: 0.50, w: 0.26, yt: 0.53, yb: 0.24, n: 2.8 }, { z: 0.50, x: 0.50, w: 0.24, yt: 0.51, yb: 0.26, n: 2.8 }], 20, false, true, s));
      // side impact spar & mirror
      G.carbon.push(xform(new THREE.BoxGeometry(0.42, 0.035, 0.08), s * 0.62, 0.47, 0.70));
      G.carbon.push(strutGeo(new THREE.Vector3(s * 0.38, 0.62, 0.55), new THREE.Vector3(s * 0.50, 0.70, 0.52), 0.012));
      G.paint.push(xform(new THREE.BoxGeometry(0.16, 0.065, 0.07), s * 0.53, 0.71, 0.52));
      G.metal.push(xform(new THREE.PlaneGeometry(0.14, 0.05), s * 0.53, 0.71, 0.484, 0, Math.PI, 0));
      // floor edge fences / bargeboard
      for (const fx of [0.30, 0.40, 0.50]) G.carbon.push(xform(new THREE.BoxGeometry(0.012, 0.09, 0.42), s * fx, 0.11, 0.95, 0, s * 0.08, 0));
    }
    // ---------------- floor, plank, diffuser
    const fl = new THREE.Shape(), outline = [[0.20, 1.40], [0.45, 1.05], [0.66, 0.75], [0.76, 0.35], [0.79, -0.20], [0.78, -1.20], [0.70, -1.48], [0.55, -1.64]];
    outline.forEach(([x, z], i) => i ? fl.lineTo(x, z) : fl.moveTo(x, z));
    [...outline].reverse().forEach(([x, z]) => fl.lineTo(-x, z));
    const flg = new THREE.ExtrudeGeometry(fl, { depth: 0.02, bevelEnabled: false }); flg.rotateX(Math.PI / 2); flg.translate(0, 0.085, 0); G.carbon.push(flg);
    for (const s of [1, -1]) G.carbon.push(xform(new THREE.BoxGeometry(0.02, 0.05, 1.7), s * 0.785, 0.105, -0.45)); // floor edge lip
    G.dark.push(xform(new THREE.BoxGeometry(0.16, 0.012, 2.5), 0, 0.061, -0.1)); // plank
    const dif = new THREE.BoxGeometry(1.0, 0.012, 0.72); dif.rotateX(-0.32); dif.translate(0, 0.18, -1.98); G.carbon.push(dif);
    for (const sx of [-0.48, -0.3, -0.12, 0.12, 0.3, 0.48]) G.carbon.push(plateZY([[-1.62, 0.07], [-2.34, 0.30], [-2.34, 0.08]], 0.012, sx));
    // ---------------- front wing
    const fw = (zLE, yLE, c, a, x0, x1, t = 0.10, lift = 0) => wingX([
      { x: x0, z: zLE, y: yLE + lift, c, a, t }, { x: lerp(x0, x1, 0.33), z: zLE - 0.01, y: yLE, c, a, t }, { x: lerp(x0, x1, 0.66), z: zLE - 0.02, y: yLE - 0.005, c: c * 0.98, a, t }, { x: x1, z: zLE - 0.03, y: yLE - 0.01, c: c * 0.95, a, t }]);
    G.carbon.push(wingX([{ x: -0.95, z: 2.98, y: 0.075, c: 0.30, a: 0.06, t: 0.1 }, { x: -0.5, z: 3.0, y: 0.08, c: 0.31, a: 0.06, t: 0.1 }, { x: -0.22, z: 3.02, y: 0.11, c: 0.30, a: 0.04, t: 0.1 }, { x: 0, z: 3.02, y: 0.12, c: 0.30, a: 0.04, t: 0.1 }, { x: 0.22, z: 3.02, y: 0.11, c: 0.30, a: 0.04, t: 0.1 }, { x: 0.5, z: 3.0, y: 0.08, c: 0.31, a: 0.06, t: 0.1 }, { x: 0.95, z: 2.98, y: 0.075, c: 0.30, a: 0.06, t: 0.1 }]));
    for (const s of [1, -1]) {
      const a0 = s > 0 ? 0.26 : -0.95, a1 = s > 0 ? 0.95 : -0.26;
      G.accent.push(fw(2.72, 0.125, 0.19, 0.38, a0, a1));
      G.carbon.push(fw(2.57, 0.175, 0.16, 0.62, a0, a1));
      G.accent.push(fw(2.45, 0.235, 0.13, 0.86, a0, a1)); // adjustable flap
      G.carbon.push(plateZY([[3.06, 0.05], [3.06, 0.20], [2.85, 0.33], [2.38, 0.36], [2.30, 0.26], [2.36, 0.05]], 0.016, s * 0.965));
      G.carbon.push(xform(new THREE.BoxGeometry(0.012, 0.05, 0.28), s * 0.985, 0.075, 2.85));
      G.carbon.push(plateZY([[2.78, 0.12], [2.62, 0.19], [2.52, 0.19], [2.62, 0.11]], 0.012, s * 0.07)); // pylons
    }
    // ---------------- rear wing, beam wing, endplates, crash structure, exhaust, shark fin
    G.carbon.push(wingX([{ x: -0.50, z: -2.30, y: 0.86, c: 0.31, a: 0.30, t: 0.12 }, { x: 0, z: -2.31, y: 0.845, c: 0.32, a: 0.30, t: 0.12 }, { x: 0.50, z: -2.30, y: 0.86, c: 0.31, a: 0.30, t: 0.12 }]));
    G.carbon.push(wingX([{ x: -0.38, z: -2.24, y: 0.42, c: 0.17, a: 0.22, t: 0.12 }, { x: 0.38, z: -2.24, y: 0.42, c: 0.17, a: 0.22, t: 0.12 }]));
    for (const s of [1, -1]) {
      G.accent.push(plateZY([[-2.12, 0.40], [-2.05, 0.82], [-2.20, 1.15], [-2.74, 1.18], [-2.80, 0.98], [-2.70, 0.48], [-2.45, 0.34]], 0.016, s * 0.51));
      G.carbon.push(xform(new THREE.BoxGeometry(0.016, 0.28, 0.05), s * 0.51, 0.26, -2.40, 0.2));
    }
    G.carbon.push(plateZY([[-2.20, 0.40], [-2.28, 0.86], [-2.42, 0.86], [-2.42, 0.38]], 0.03, 0)); // swan-neck pylon
    G.carbon.push(loftZ([{ z: -2.24, w: 0.17, yt: 0.40, yb: 0.22, n: 2.4 }, { z: -2.45, w: 0.14, yt: 0.37, yb: 0.24, n: 2.4 }, { z: -2.62, w: 0.10, yt: 0.34, yb: 0.27, n: 2.4 }], 18, false, true));
    G.metal.push(xform(new THREE.CylinderGeometry(0.048, 0.042, 0.30, 16, 1, true), 0, 0.50, -2.33, Math.PI / 2));
    G.dark.push(xform(new THREE.CircleGeometry(0.04, 14), 0, 0.50, -2.47, 0, Math.PI, 0));
    G.light.push(xform(new THREE.BoxGeometry(0.07, 0.04, 0.02), 0, 0.305, -2.635));
    G.paint.push(plateZY([[-0.42, 0.95], [-0.50, 0.97], [-1.95, 0.60], [-1.95, 0.48], [-1.2, 0.66], [-0.75, 0.80]], 0.012, 0));
    // engine cover number decal plate
    // ---------------- halo (continuous tube, three mounts)
    const hp = [[0.355, 0.60, -0.21], [0.37, 0.79, -0.12], [0.34, 0.905, 0.04], [0.24, 0.935, 0.24], [0.10, 0.93, 0.37], [0, 0.925, 0.41]];
    const hoop = [...hp.map(p => new THREE.Vector3(...p)), ...hp.slice(0, -1).reverse().map(p => new THREE.Vector3(-p[0], p[1], p[2]))];
    G.halo.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(hoop, false, 'centripetal'), 60, 0.027, 10, false));
    G.halo.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0.925, 0.41), new THREE.Vector3(0, 0.86, 0.56), new THREE.Vector3(0, 0.74, 0.70), new THREE.Vector3(0, 0.665, 0.78)]), 20, 0.024, 10, false));
    for (const s of [1, -1]) G.halo.push(xform(new THREE.SphereGeometry(0.04, 10, 8), s * 0.355, 0.60, -0.21));
    // roll hoop structure above the airbox
    G.carbon.push(xform(new THREE.BoxGeometry(0.05, 0.06, 0.18), 0, 0.98, -0.40));
    // ---------------- driver (shoulders + HANS area); helmet built separately so the cockpit camera can hide it
    G.dark.push(xform(new THREE.CapsuleGeometry(0.11, 0.30, 4, 10), 0, 0.56, -0.06, 0, 0, Math.PI / 2));
    this.geo = {};
    for (const [k, list] of Object.entries(G)) this.geo[k] = list.length ? mergeList(list) : null;
    // ---------------- wheels (shared)
    this.tireF = this.tireGeo(CAR.widthF); this.tireR = this.tireGeo(CAR.widthR);
    this.rimF = this.rimGeo(CAR.widthF); this.rimR = this.rimGeo(CAR.widthR);
    this.disc = xform(new THREE.CylinderGeometry(0.165, 0.165, 0.032, 28), 0, 0, 0, 0, 0, Math.PI / 2);
    const cal = new THREE.Shape(); cal.absarc(0, 0, 0.19, -0.5, 0.5, false); cal.absarc(0, 0, 0.12, 0.5, -0.5, true);
    const calG = new THREE.ExtrudeGeometry(cal, { depth: 0.07, bevelEnabled: false, curveSegments: 6 }); calG.rotateY(Math.PI / 2); calG.translate(-0.035, 0, 0); calG.rotateX(-1.1);
    this.caliper = calG;
    this.upright = mergeList([xform(new THREE.BoxGeometry(0.06, 0.34, 0.08), 0, 0, 0), xform(new THREE.CylinderGeometry(0.05, 0.05, 0.08, 10), 0, 0, 0, 0, 0, Math.PI / 2)]);
    this.duct = mergeList([xform(new THREE.BoxGeometry(0.06, 0.16, 0.18), 0, 0.02, 0.12)]);
    this.helmet = mergeList([new THREE.SphereGeometry(0.14, 20, 14).scale(1, 1.05, 1.12)]);
    this.visor = xform(new THREE.SphereGeometry(0.1, 16, 10), 0, 0.015, 0.07, 0, 0, 0, 1.22, 0.42, 0.92);
    this.unitArm = new THREE.CylinderGeometry(1, 1, 1, 6, 1); this.unitArm.translate(0, 0.5, 0);
    // ---------------- DRS flap (pivot at its trailing edge)
    const flap = wingX([{ x: -0.495, z: 0, y: 0, c: 0.20, a: 0, t: 0.11 }, { x: 0.495, z: 0, y: 0, c: 0.20, a: 0, t: 0.11 }]);
    flap.translate(0, 0, 0.20); // trailing edge at origin, leading edge at z=+0.2
    this.flap = flap;
    // ---------------- materials (shared)
    const cb = Tex.carbon();
    this.mat = {
      carbon: new THREE.MeshPhysicalMaterial({ map: cb.map, normalMap: cb.normalMap, normalScale: new THREE.Vector2(0.25, 0.25), roughness: 0.32, metalness: 0.15, clearcoat: 0.8, clearcoatRoughness: 0.12, side: THREE.DoubleSide }),
      dark: new THREE.MeshStandardMaterial({ color: 0x0b0c0f, roughness: 0.8, side: THREE.DoubleSide }),
      metal: new THREE.MeshStandardMaterial({ color: 0xb8bcc2, roughness: 0.25, metalness: 1.0, side: THREE.DoubleSide }),
      halo: new THREE.MeshPhysicalMaterial({ color: 0x15171c, roughness: 0.35, metalness: 0.4, clearcoat: 0.6, side: THREE.DoubleSide }),
      rubber: new THREE.MeshStandardMaterial({ map: Tex.tire(), roughness: 0.88, metalness: 0.0, side: THREE.DoubleSide }),
      rim: new THREE.MeshStandardMaterial({ color: 0x1a1c20, roughness: 0.35, metalness: 0.85, side: THREE.DoubleSide }),
      arm: new THREE.MeshPhysicalMaterial({ map: cb.map, color: 0x9aa0a8, roughness: 0.35, metalness: 0.2, clearcoat: 0.5 }),
      visor: new THREE.MeshPhysicalMaterial({ color: 0x111111, roughness: 0.05, metalness: 0.9 }),
      caliper: new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.5, metalness: 0.6, side: THREE.DoubleSide })
    };
    this.flameTex = (() => { const c = Tex.canvas(64, 64), x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,255,230,1)'); g.addColorStop(0.3, 'rgba(255,170,60,0.9)'); g.addColorStop(0.7, 'rgba(255,60,10,0.35)'); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64); return Tex.finish(c, true, false); })();
  },
  tireGeo(w) {
    const r0 = CAR.rimR + 0.004, R = CAR.radius, h = w / 2;
    const pts = [[r0, -h + 0.03], [r0 + 0.02, -h - 0.002], [0.30, -h - 0.012], [0.335, -h + 0.004], [R - 0.008, -h + 0.03], [R, -h + 0.07], [R, h - 0.07], [R - 0.008, h - 0.03], [0.335, h - 0.004], [0.30, h + 0.012], [r0 + 0.02, h + 0.002], [r0, h - 0.03]];
    const g = new THREE.LatheGeometry(pts.map(p => new THREE.Vector2(p[0], p[1])), 48);
    g.rotateZ(-Math.PI / 2); // axle along x
    return g;
  },
  rimGeo(w) {
    const h = w / 2, r = CAR.rimR;
    const barrel = new THREE.LatheGeometry([[r - 0.01, -h + 0.03], [r, -h + 0.02], [r, h - 0.02], [r + 0.012, h - 0.01], [r + 0.012, h + 0.004]].map(p => new THREE.Vector2(p[0], p[1])), 40); barrel.rotateZ(-Math.PI / 2);
    const parts = [barrel];
    for (let k = 0; k < 10; k++) { const sp = new THREE.BoxGeometry(0.02, 0.17, 0.028); sp.translate(0, 0.125, 0); sp.rotateX(k / 10 * TAU); sp.translate(h - 0.03, 0, 0); parts.push(sp); }
    parts.push(xform(new THREE.CylinderGeometry(0.055, 0.06, 0.08, 16), h - 0.03, 0, 0, 0, 0, Math.PI / 2));
    const ring = new THREE.TorusGeometry(r - 0.012, 0.008, 6, 40); ring.rotateY(Math.PI / 2); ring.translate(h - 0.005, 0, 0); parts.push(ring);
    return mergeList(parts);
  }
};

// ---------------------------------------------------------------------
// CarModel: per-car pose (transform hierarchy, suspension links, DRS flap,
// brake glow). All car geometry is drawn by the shared CarFleet below, so
// the whole field costs ~20 instanced draw calls instead of ~45 per car.
// ---------------------------------------------------------------------
class CarModel {
  constructor(opts) {
    CarAssets.build();
    const A = CarAssets;
    this.opts = opts;
    this.root = new THREE.Group(); this.root.name = 'car-' + opts.code;
    this.body = new THREE.Group(); this.body.position.y = -CAR.cgH; this.root.add(this.body);
    this.helmet = new THREE.Object3D(); this.helmet.position.set(0, 0.785, -0.02); this.body.add(this.helmet);
    this.drsPivot = new THREE.Object3D(); this.drsPivot.position.set(0, 1.138, -2.676);
    this.drsClosed = 0.95; this.drsOpenAngle = 0.25; this.drsPivot.rotation.x = this.drsClosed; this.body.add(this.drsPivot);
    this.wheels = [];
    const corners = [[CAR.xF, CAR.frontAxle, true], [-CAR.xF, CAR.frontAxle, true], [CAR.xR, CAR.rearAxle, false], [-CAR.xR, CAR.rearAxle, false]];
    corners.forEach(([x, z, front]) => {
      const side = Math.sign(x);
      const corner = new THREE.Object3D(); corner.position.set(x, CAR.radius, z);
      const steer = new THREE.Object3D(); corner.add(steer);
      const mirror = new THREE.Object3D(); mirror.scale.x = side; steer.add(mirror);
      const spin = new THREE.Object3D(); mirror.add(spin);
      this.body.add(corner);
      this.wheels.push({ corner, steer, mirror, spin, x, z, front, side });
    });
    this._defineLinks();
    this.armMats = Array.from({ length: 24 }, () => new THREE.Matrix4());
    this.discGlow = [0, 0, 0, 0]; this.lightI = 0.35; this.helmetVisible = true; this.blobMatrix = new THREE.Matrix4();
    // steering wheel with live display: player only (it is inside the cockpit)
    if (opts.player) {
      this.wheelGroup = new THREE.Group(); this.wheelGroup.position.set(0, 0.615, 0.47); this.wheelGroup.rotation.x = -0.35;
      const sw = mergeList([xform(new THREE.BoxGeometry(0.20, 0.11, 0.03), 0, 0, 0), xform(new THREE.CylinderGeometry(0.022, 0.022, 0.11, 10), 0.115, -0.005, 0, 0, 0, 0.25), xform(new THREE.CylinderGeometry(0.022, 0.022, 0.11, 10), -0.115, -0.005, 0, 0, 0, -0.25), xform(new THREE.BoxGeometry(0.16, 0.03, 0.03), 0, -0.07, 0)]);
      this.wheelGroup.add(new THREE.Mesh(sw, A.mat.dark));
      const btn = [];
      [0xff3030, 0x30a0ff, 0xffd23f, 0x30ff70, 0xffffff, 0xff8a00].forEach((hex, k) => { const c = new THREE.Color(hex); const b = xform(new THREE.CylinderGeometry(0.008, 0.008, 0.01, 8), (k < 3 ? -1 : 1) * 0.078, 0.03 - (k % 3) * 0.025, -0.017, Math.PI / 2); colorGeo(b, c.r, c.g, c.b); btn.push(b); });
      this.wheelGroup.add(new THREE.Mesh(mergeList(btn, true), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4 })));
      this.dispCanvas = Tex.canvas(256, 128); this.dispTex = Tex.finish(this.dispCanvas, true, false);
      const disp = new THREE.Mesh(new THREE.PlaneGeometry(0.13, 0.065), new THREE.MeshBasicMaterial({ map: this.dispTex, toneMapped: false }));
      disp.rotation.y = Math.PI; disp.position.set(0, 0.005, -0.0165); this.wheelGroup.add(disp);
      this.body.add(this.wheelGroup);
      this.body.add(new THREE.Mesh(strutGeo(new THREE.Vector3(0, 0.6, 0.5), new THREE.Vector3(0, 0.55, 0.85), 0.015), A.mat.metal));
    }
    // exhaust flame (backfire): only drawn while firing
    this.flame = new THREE.Sprite(new THREE.SpriteMaterial({ map: A.flameTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
    this.flame.position.set(0, 0.50, -2.55); this.flame.scale.set(0.35, 0.35, 0.35); this.flame.visible = false; this.body.add(this.flame);
    this.flameT = 0;
    this._dispT = 0;
  }
  _defineLinks() {
    const L = [];
    for (const w of this.wheels) {
      const s = w.side, z = w.z;
      if (w.front) L.push(
        { c: [s * 0.20, 0.50, z + 0.18], u: [-0.14, 0.17, 0] }, { c: [s * 0.22, 0.50, z - 0.24], u: [-0.14, 0.17, 0] },
        { c: [s * 0.16, 0.25, z + 0.26], u: [-0.10, -0.15, 0] }, { c: [s * 0.20, 0.24, z - 0.32], u: [-0.10, -0.15, 0] },
        { c: [s * 0.22, 0.55, z - 0.08], u: [-0.14, -0.12, -0.02] }, { c: [s * 0.18, 0.42, z - 0.10], u: [-0.12, 0.02, -0.14], steer: true });
      else L.push(
        { c: [s * 0.18, 0.50, z + 0.21], u: [-0.16, 0.18, 0] }, { c: [s * 0.16, 0.50, z - 0.19], u: [-0.16, 0.18, 0] },
        { c: [s * 0.15, 0.22, z + 0.26], u: [-0.12, -0.15, 0] }, { c: [s * 0.15, 0.22, z - 0.29], u: [-0.12, -0.15, 0] },
        { c: [s * 0.18, 0.20, z - 0.10], u: [-0.16, 0.14, -0.04] }, { c: [s * 0.17, 0.30, z - 0.29], u: [-0.12, 0.0, -0.19] });
      w.links = L.slice(-6);
    }
    this.links = L;
  }
  // st: {hubY[4] (model-space hub centre y), steer[4], spin[4], steerWheel, drs (0..1), brakeTemp[4], braking, rpm, gear, speedKmh, cockpit}
  update(st, dt, detail = true) {
    const a = _v1, b = _v2, d = _v3;
    let k = 0;
    this.wheels.forEach((w, i) => {
      w.corner.position.y = st.hubY[i];
      w.steer.rotation.y = st.steer[i];
      w.spin.rotation.x = st.spin[i];
      const t = st.brakeTemp ? st.brakeTemp[i] : 300;
      this.discGlow[i] = clamp((t - 620) / 380, 0, 1) * 2.2;
      if (!detail) return; // distant cars keep last suspension pose
      const cs = Math.cos(st.steer[i]), sn = Math.sin(st.steer[i]);
      for (const l of w.links) {
        a.set(l.c[0], l.c[1], l.c[2]);
        let ux = l.u[0] * w.side, uy = l.u[1], uz = l.u[2];
        if (w.front) { const rx = ux * cs + uz * sn, rz = -ux * sn + uz * cs; ux = rx; uz = rz; }
        b.set(w.x + ux, st.hubY[i] + uy, w.z + uz);
        d.subVectors(b, a); const len = d.length(); d.multiplyScalar(1 / len);
        _q.setFromUnitVectors(_v2.set(0, 1, 0), d);
        this.armMats[k++].compose(a, _q, _v3.set(0.017, len, 0.017));
      }
    });
    if (this.wheelGroup) this.wheelGroup.rotation.z = st.steerWheel;
    this.drsPivot.rotation.x = lerp(this.drsClosed, this.drsOpenAngle, st.drs);
    this.lightI = st.braking ? 2.2 : (st.rainLight ? 1.2 : 0.35);
    this.helmetVisible = !st.cockpit;
    if (st.backfire) this.flameT = 0.09;
    if (this.flameT > 0) { this.flameT -= dt; const f = clamp(this.flameT / 0.09, 0, 1); this.flame.visible = true; this.flame.material.opacity = f; const sc = 0.22 + Math.random() * 0.25; this.flame.scale.set(sc, sc, sc); } else this.flame.visible = false;
    if (this.dispCanvas) {
      this._dispT -= dt;
      if (this._dispT <= 0) {
        this._dispT = 0.06;
        const c = this.dispCanvas.getContext('2d');
        c.fillStyle = '#050608'; c.fillRect(0, 0, 256, 128);
        const n = 15, lit = Math.round(clamp((st.rpm - 9000) / 3000, 0, 1) * n);
        for (let j = 0; j < n; j++) { c.fillStyle = j < lit ? (j < 5 ? '#24e05a' : j < 10 ? '#ff2b2b' : '#3b7bff') : '#1a1d22'; if (st.rpm > 12150) c.fillStyle = (performance.now() % 120 < 60) ? '#3b7bff' : '#1a1d22'; c.fillRect(8 + j * 16, 6, 12, 12); }
        c.fillStyle = '#ffffff'; c.font = '900 70px Arial'; c.textAlign = 'center'; c.fillText(st.gear, 128, 98);
        c.font = '700 30px Arial'; c.textAlign = 'left'; c.fillText(String(Math.round(st.speedKmh)), 10, 70); c.font = '600 16px Arial'; c.fillText('KM/H', 12, 92);
        c.textAlign = 'right'; c.font = '700 26px Arial'; c.fillStyle = st.drs > 0.5 ? '#24e05a' : '#56606c'; c.fillText('DRS', 246, 64);
        c.fillStyle = '#9fb0c2'; c.font = '600 18px Arial'; c.fillText(st.delta || '', 246, 98);
        this.dispTex.needsUpdate = true;
      }
    }
  }
}

// ---------------------------------------------------------------------
// CarFleet: instanced renderer for every car on track.
// One InstancedMesh per part type; per-car paint/accent/helmet colours and
// brake-disc / rain-light glow come from instanceColor; race numbers come
// from a texture atlas indexed per instance.
// ---------------------------------------------------------------------
class CarFleet {
  constructor(cap, blobMat) {
    CarAssets.build(); const A = CarAssets;
    this.cap = cap; this.group = new THREE.Group(); this.group.name = 'car-fleet'; this.owner = new Array(cap).fill(null);
    const emissiveFromInstance = (mat, key) => {
      mat.onBeforeCompile = (sh) => {
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <color_fragment>', '')
          .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n#ifdef USE_COLOR\n totalEmissiveRadiance *= vColor.r;\n#endif');
      };
      mat.customProgramCacheKey = () => 'inst-emissive-' + key;
      return mat;
    };
    const M = {
      paint: new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.32, metalness: 0.25, clearcoat: 1.0, clearcoatRoughness: 0.06, side: THREE.DoubleSide }),
      accent: new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.2, clearcoat: 0.8, side: THREE.DoubleSide }),
      carbon: A.mat.carbon, dark: A.mat.dark, metal: A.mat.metal, halo: A.mat.halo,
      light: emissiveFromInstance(new THREE.MeshStandardMaterial({ color: 0x330000, emissive: 0xff1010, emissiveIntensity: 1 }), 'light'),
      disc: emissiveFromInstance(new THREE.MeshStandardMaterial({ color: 0x3a3a3e, roughness: 0.55, metalness: 0.4, emissive: 0xff3300, emissiveIntensity: 1 }), 'disc'),
      helmet: new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.2, clearcoat: 1 })
    };
    this.M = M;
    // race-number atlas (4x4 cells of 128 px)
    this.numCanvas = Tex.canvas(512, 512); this.numTex = Tex.finish(this.numCanvas, true, false);
    const numMat = new THREE.MeshStandardMaterial({ map: this.numTex, roughness: 0.4, polygonOffset: true, polygonOffsetFactor: -2 });
    numMat.onBeforeCompile = (sh) => {
      sh.vertexShader = 'attribute vec2 numCell;\n' + sh.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\n vMapUv = vMapUv * 0.25 + numCell;\n#endif');
    };
    numMat.customProgramCacheKey = () => 'num-atlas';
    const mk = (name, geo, mat, per, shadow) => {
      const m = new THREE.InstancedMesh(geo, mat, cap * per); m.name = 'fleet-' + name;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.frustumCulled = false; m.castShadow = shadow; m.receiveShadow = true; m.count = 0; m.userData.per = per;
      this.group.add(m); return m;
    };
    this.parts = {};
    for (const [k, g] of Object.entries(A.geo)) if (g) this.parts[k] = mk(k, g, M[k], 1, k !== 'light' && k !== 'metal');
    this.flap = mk('flap', A.flap, M.accent, 1, true);
    this.helmet = mk('helmet', A.helmet, M.helmet, 1, true);
    this.visor = mk('visor', A.visor, A.mat.visor, 1, false);
    const numGeo = xform(new THREE.PlaneGeometry(0.16, 0.16), 0, 0.395, 2.30, -Math.PI / 2 + 0.18, 0, Math.PI);
    numGeo.setAttribute('numCell', new THREE.InstancedBufferAttribute(new Float32Array(cap * 2), 2));
    this.number = mk('number', numGeo, numMat, 1, false);
    this.tireF = mk('tireF', A.tireF, A.mat.rubber, 2, true); this.tireR = mk('tireR', A.tireR, A.mat.rubber, 2, true);
    this.rimF = mk('rimF', A.rimF, A.mat.rim, 2, false); this.rimR = mk('rimR', A.rimR, A.mat.rim, 2, false);
    this.disc = mk('disc', A.disc.clone().translate(-0.05, 0, 0), M.disc, 4, false);
    const cal = A.caliper.clone().translate(-0.05, 0, 0), up = A.upright.clone().translate(-0.14, 0, 0), duct = A.duct.clone().translate(-0.12, 0, 0);
    this.hubF = mk('hubF', mergeList([cal, up, duct]), A.mat.carbon, 2, false);
    this.hubR = mk('hubR', mergeList([cal.clone(), up.clone()]), A.mat.carbon, 2, false);
    this.arms = mk('arms', A.unitArm, A.mat.arm, 24, true);
    this.blob = mk('blob', new THREE.PlaneGeometry(2.4, 5.9), blobMat, 1, false); this.blob.receiveShadow = false; this.blob.renderOrder = 1;
    // allocate instanceColor attributes up front so shader variants are stable
    const white = new THREE.Color(1, 1, 1);
    for (const m of [this.parts.paint, this.parts.accent, this.parts.light, this.flap, this.helmet, this.disc]) { for (let i = 0; i < m.instanceMatrix.count; i++) m.setColorAt(i, white); m.instanceColor.setUsage(THREE.DynamicDrawUsage); }
    this.all = this.group.children;
    this._zero = new THREE.Matrix4().makeScale(0, 0, 0); this._t = new THREE.Matrix4(); this._c = new THREE.Color();
  }
  _assign(i, model) {
    const o = model.opts, c = this._c;
    this.parts.paint.setColorAt(i, c.setHex(o.color)); this.parts.accent.setColorAt(i, c.setHex(o.accent)); this.flap.setColorAt(i, c.setHex(o.accent));
    this.helmet.setColorAt(i, c.setHex(o.helmet || 0xffffff));
    const ctx = this.numCanvas.getContext('2d'), col = i % 4, row = Math.floor(i / 4);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(col * 128, row * 128, 128, 128); ctx.fillStyle = '#111111'; ctx.font = '900 86px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(o.number), col * 128 + 64, row * 128 + 70); this.numTex.needsUpdate = true;
    const nc = this.number.geometry.attributes.numCell; nc.setXY(i, col * 0.25, 1 - (row + 1) * 0.25); nc.needsUpdate = true;
    for (const m of [this.parts.paint, this.parts.accent, this.flap, this.helmet]) m.instanceColor.needsUpdate = true;
    this.owner[i] = model;
  }
  sync(cars) {
    const n = Math.min(cars.length, this.cap), t = this._t, c = this._c;
    for (const m of this.all) m.count = n * m.userData.per;
    for (let i = 0; i < n; i++) {
      const md = cars[i].model;
      if (this.owner[i] !== md) this._assign(i, md);
      md.root.updateMatrixWorld(true);
      const B = md.body.matrixWorld;
      for (const k in this.parts) this.parts[k].setMatrixAt(i, B);
      this.number.setMatrixAt(i, B);
      this.parts.light.setColorAt(i, c.setRGB(md.lightI, md.lightI, md.lightI));
      this.flap.setMatrixAt(i, md.drsPivot.matrixWorld);
      const hm = md.helmetVisible ? md.helmet.matrixWorld : this._zero;
      this.helmet.setMatrixAt(i, hm); this.visor.setMatrixAt(i, hm);
      let f = 0, r = 0;
      md.wheels.forEach((w, k) => {
        if (w.front) { this.tireF.setMatrixAt(i * 2 + f, w.spin.matrixWorld); this.rimF.setMatrixAt(i * 2 + f, w.spin.matrixWorld); this.hubF.setMatrixAt(i * 2 + f, w.mirror.matrixWorld); f++; }
        else { this.tireR.setMatrixAt(i * 2 + r, w.spin.matrixWorld); this.rimR.setMatrixAt(i * 2 + r, w.spin.matrixWorld); this.hubR.setMatrixAt(i * 2 + r, w.mirror.matrixWorld); r++; }
        this.disc.setMatrixAt(i * 4 + k, w.spin.matrixWorld); const gl = md.discGlow[k]; this.disc.setColorAt(i * 4 + k, c.setRGB(gl, gl, gl));
      });
      for (let k = 0; k < 24; k++) this.arms.setMatrixAt(i * 24 + k, t.multiplyMatrices(B, md.armMats[k]));
      this.blob.setMatrixAt(i, md.blobMatrix);
    }
    for (const m of this.all) m.instanceMatrix.needsUpdate = true;
    this.parts.light.instanceColor.needsUpdate = true; this.disc.instanceColor.needsUpdate = true;
  }
}
