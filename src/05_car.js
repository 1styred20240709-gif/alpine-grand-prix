
// =====================================================================
// ROAD CAR MODELS — procedural bodies for the four cars. Model space: y=0 is
// the ground at static ride height, z=0 the centre of gravity, +z forward,
// +x the car's left. Generic lofting helpers first, then per-car builders.
// =====================================================================
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
// ---------------------------------------------------------------------
// Road-car body layouts. Every number is measured from the car's real axle
// positions and overhangs (P from carPhys), so proportions follow the specs.
// ---------------------------------------------------------------------
function carLayout(P) {
  const st = P.spec.body, fa = P.frontAxle, ra = P.rearAxle, zf = P.zFront, zr = P.zRear, H = P.height;
  const hatch = { front: [[zf, 0.60], [zf - 0.14, 0.76], [fa + 0.25, 0.86]], cowlY: 0.99, rear: [[zr + 0.14, 1.06], [zr + 0.03, 0.99], [zr, 0.90]], zW0: fa - 0.55, zW1: fa - 1.30, zW2: ra + 0.05, zW3: zr + 0.14, deckY: 1.06, nose: 0.88, tail: 0.95, yb: 0.17 };
  const L = {
    hatch,
    rally: { ...hatch, front: [[zf, 0.64], [zf - 0.14, 0.80], [fa + 0.25, 0.90]], cowlY: 1.03, rear: [[zr + 0.14, 1.10], [zr + 0.03, 1.03], [zr, 0.94]], deckY: 1.10, yb: 0.25, nose: 0.9, tail: 0.96 },
    fastback: { front: [[zf, 0.57], [zf - 0.2, 0.73], [fa + 0.1, 0.83]], cowlY: 0.99, rear: [[zr + 0.2, 1.05], [zr + 0.03, 1.0], [zr, 0.9]], zW0: fa - 0.72, zW1: fa - 1.5, zW2: ra + 0.55, zW3: ra - 0.4, deckY: 1.04, nose: 0.85, tail: 0.95, yb: 0.15 },
    sedan: { front: [[zf, 0.60], [zf - 0.12, 0.74], [fa + 0.2, 0.83]], cowlY: 0.99, rear: [[zr + 0.28, 1.03], [zr + 0.04, 1.0], [zr, 0.92]], zW0: fa - 0.7, zW1: fa - 1.55, zW2: ra + 0.2, zW3: ra - 0.28, deckY: 1.03, nose: 0.88, tail: 0.95, yb: 0.16 },
    rs911: { front: [[zf, 0.50], [zf - 0.15, 0.62], [fa + 0.1, 0.70]], cowlY: 0.90, rear: [[zr + 0.2, 0.98], [zr + 0.03, 0.95], [zr, 0.88]], zW0: fa - 0.85, zW1: fa - 1.55, zW2: fa - 2.05, zW3: ra - 0.45, deckY: 0.98, nose: 0.84, tail: 0.97, yb: 0.13 }
  }[st];
  L.H = H; L.top = [...L.front, [L.zW0, L.cowlY], [L.zW3, L.deckY], ...L.rear]; // front -> back
  L.eye = new THREE.Vector3(0.37, H - 0.17, L.zW1 - 0.42);
  return L;
}
function profileY(pts, z) { // piecewise linear, pts ordered by decreasing z
  if (z >= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) if (z >= pts[i][0]) { const a = pts[i - 1], b = pts[i]; return lerp(b[1], a[1], (z - b[0]) / (a[0] - b[0])); }
  return pts[pts.length - 1][1];
}
// Build all static body geometry for one car type, grouped by material key.
function buildRoadCar(P) {
  const L = carLayout(P), st = P.spec.body, G = { paint: [], accent: [], trim: [], carbon: [], dark: [], metal: [], glass: [], tail: [], head: [], lamp: [] };
  const fa = P.frontAxle, ra = P.rearAxle, zf = P.zFront, zr = P.zRear, hw = P.width / 2, H = L.H;
  const rF = P.wheels[0].R, rR = P.wheels[2].R, tF = P.spec.dims.tireF, tR = P.spec.dims.tireR;
  const rally = st === 'rally', hatchy = st === 'hatch' || rally;
  const archF = rF + 0.05, archR = rR + 0.05, yA = Math.max(2 * rF, 2 * rR) + 0.03;
  // plan view: tapered nose/tail with rounded corners; side view: bumpers tuck up at both ends
  const rc = 0.34, corner = (d) => d >= rc ? 1 : 0.7 + 0.3 * Math.sqrt(Math.max(0, 1 - (1 - d / rc) ** 2));
  const hwAt = (z) => hw * (z > fa ? lerp(1, L.nose, smoothstep(fa, zf, z)) : z < ra ? lerp(1, L.tail, smoothstep(ra, zr, z)) : 1) * corner(zf - z) * corner(z - zr);
  const ybAt = (z) => L.yb + 0.07 * (1 - smoothstep(0, 0.45, zf - z)) + 0.05 * (1 - smoothstep(0, 0.35, z - zr));
  const top = (z) => profileY(L.top, z);
  const slopeAt = (z) => Math.atan2(top(z - 0.05) - top(z + 0.05), 0.1); // hood/deck pitch for parts lying on the surface
  const zs = (a, b, n) => { const out = []; for (let i = 0; i <= n; i++) out.push(lerp(a, b, i / n)); return out; };
  // lower body: narrow core (between the wheels), full-width shoulder above the arches, sills and bumpers below
  const coreHW = Math.min(P.xF - tF / 2, P.xR - tR / 2) - 0.03;
  // the cabin (windscreen base .. rear glass) is hollow: floor + door panels, so the interior and cockpit view are open
  const cz0 = L.zW0 - 0.04, cz1 = L.zW3 + 0.06;
  const cabRamp = (z) => smoothstep(cz0 + 0.12, cz0 - 0.08, z) * smoothstep(cz1 - 0.12, cz1 + 0.08, z); // 0 outside, 1 inside
  const floorY = L.yb + 0.3;
  const LD = P.spec.livery ? 3 : 1; // livery cars: denser lofts so the colour blocks have crisp edges
  G.paint.push(loftZ(zs(zf - 0.02, zr + 0.02, 48 * LD).map(z => ({ z, w: 2 * Math.min(hwAt(z), coreHW), yt: lerp(top(z) - 0.01, floorY, cabRamp(z)), yb: ybAt(z) + 0.01, n: 2.8 })), 24));
  const endBlend = (z) => Math.max(smoothstep(fa + archF - 0.05, fa + archF + 0.3, z), smoothstep(ra - archR + 0.05, ra - archR - 0.3, z));
  const bumpBlend = (z) => Math.max(smoothstep(fa + archF + 0.02, fa + archF + 0.22, z), smoothstep(ra - archR - 0.02, ra - archR - 0.22, z));
  G.paint.push(loftZ(zs(zf, zr, 64 * LD).map(z => {
    const e = endBlend(z), b = bumpBlend(z), c = cabRamp(z), t = lerp(Math.max(top(z), yA + 0.04), Math.max(top(z), yA - 0.05), e);
    const yb = lerp(yA - 0.02, ybAt(z) + 0.02, b); // ahead of / behind the wheels the panel runs down into one bumper
    return { z, w: 2 * hwAt(z), yt: lerp(t, yA + 0.03, c), yb, n: lerp(2.6, 3.3, b), ym: lerp(lerp(yA + 0.04, yA, c), lerp(yb, t, 0.62), b) };
  }), 32));
  for (const s of [1, -1]) G.paint.push(loftZ(zs(cz0 + 0.06, cz1 - 0.06, 10 * LD).map(z => ({ z, x: hwAt(z) - 0.07, w: 0.14, yt: top(z), yb: yA - 0.03, n: 3.5 })), 14, true, true, s)); // door panels
  G.dark.push(loftZ(zs(cz0 - 0.02, cz1 + 0.02, 6).map(z => ({ z, w: 2 * (hwAt(z) - 0.13), yt: floorY + 0.02, yb: floorY - 0.02, n: 6 })), 12)); // carpet
  const sill = (z0, z1) => G.paint.push(loftZ(zs(z0, z1, 10 * LD).map(z => ({ z, w: 2 * hwAt(z) * 0.975, yt: yA + 0.01, yb: ybAt(z), n: 3.6 })), 20));
  sill(zf, fa + archF); sill(fa - archF, ra + archR); sill(ra - archR, zr);
  // surface probe: details (lamps, vents, intakes) are snapped onto the real body surface by raycasting
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z), DOWN = V3(0, -1, 0), AX = V3(1, 0, 0), AY = V3(0, 1, 0), AZ = V3(0, 0, 1);
  const probe = new THREE.Mesh(mergeList(G.paint.slice()), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })), ray = new THREE.Raycaster();
  const onBody = (from, dir, base, lift = 0.004) => {
    ray.set(from, dir); const h = ray.intersectObject(probe, false)[0]; if (!h) return null;
    const n = h.face.normal.clone(); if (n.dot(dir) > 0) n.negate();
    return new THREE.Matrix4().compose(h.point.clone().addScaledVector(n, lift), new THREE.Quaternion().setFromUnitVectors(base, n), V3(1, 1, 1));
  };
  // wheel-arch liners + flared arch lips
  for (const [z, r, xw, tw] of [[fa, rF, P.xF, tF], [ra, rR, P.xR, tR]]) for (const s of [1, -1]) {
    const g = new THREE.CylinderGeometry(r + 0.045, r + 0.045, tw + 0.08, 18, 1, true, -Math.PI / 2, Math.PI); g.rotateZ(Math.PI / 2); g.translate(s * xw, r, z); G.dark.push(g);
    const R = r + (rally ? 0.1 : 0.065), tube = rally ? 0.075 : 0.04;
    const f = new THREE.TorusGeometry(R, tube, 6, 24, Math.PI); f.scale(1, 1, rally ? 0.95 : 0.6); f.rotateY(Math.PI / 2);
    f.translate(s * (hwAt(z) + (rally ? 0.03 : -0.012)), r, z); G.paint.push(f);
  }
  // side skirts
  const skL = (fa - archF) - (ra + archR), skZ = (fa - archF + ra + archR) / 2;
  for (const s of [1, -1]) (rally ? G.paint : st === 'sedan' ? G.carbon : G.dark).push(xform(new THREE.BoxGeometry(rally ? 0.12 : 0.05, 0.07, skL), s * (hw * 0.975 + (rally ? 0.03 : 0.004)), L.yb + 0.035, skZ));
  // glasshouse (transparent) + roof + pillars
  const cab = [
    { z: L.zW0, w: 2 * hwAt(L.zW0) * 0.86, yt: L.cowlY + 0.012, yb: L.cowlY - 0.012, n: 3 },
    { z: L.zW1, w: 2 * hw * 0.74, yt: H, yb: profileY(L.top, L.zW1), n: 3 },
    { z: L.zW2, w: 2 * hw * 0.73, yt: H - 0.015, yb: profileY(L.top, L.zW2), n: 3 },
    { z: L.zW3, w: 2 * hwAt(L.zW3) * 0.82, yt: L.deckY + 0.012, yb: L.deckY - 0.012, n: 3 }];
  if (st === 'sedan' || hatchy) cab.splice(2, 0, { z: lerp(L.zW1, L.zW2, 0.5), w: 2 * hw * 0.745, yt: H + 0.005, yb: profileY(L.top, lerp(L.zW1, L.zW2, 0.5)), n: 3 });
  G.glass.push(loftZ(cab, 28, false, false));
  if (st === 'fastback') { // GT-R R35: solid body-colour sail panels around a narrow rear window
    const sail = zs(L.zW2 + 0.02, L.zW3 - 0.02, 6).map(z => { const t = (L.zW2 - z) / (L.zW2 - L.zW3), yt = lerp(H - 0.012, L.deckY + 0.014, t); return { z, w: 2 * lerp(hw * 0.735, hwAt(L.zW3) * 0.825, t), yt, yb: profileY(L.top, z) - 0.01, n: 3 }; });
    G.paint.push(loftZ(sail, 28, false, false));
    G.glass.push(loftZ(sail.map(c => ({ ...c, w: c.w * 0.62, yt: c.yt + 0.006, yb: c.yt - 0.05, n: 4 })), 20, false, false));
  }
  const roofSecs = zs(L.zW1 - 0.06, L.zW2 + 0.04, 6).map(z => { const t = lerp(H, H - 0.015, (L.zW1 - z) / (L.zW1 - L.zW2)); return { z, w: 2 * hw * 0.748, yt: t + 0.014, yb: t - 0.035, n: 6 }; });
  (st === 'sedan' ? G.carbon : G.paint).push(loftZ(roofSecs, 22)); // M3 CS: carbon roof
  const zb = lerp(L.zW1, L.zW2, st === 'rs911' ? 0.9 : 0.5);
  for (const s of [1, -1]) {
    G.dark.push(strutGeo(new THREE.Vector3(s * hwAt(L.zW0) * 0.86, L.cowlY, L.zW0), new THREE.Vector3(s * hw * 0.735, H - 0.01, L.zW1), 0.03, 8)); // black A-pillar trim
    if (st !== 'fastback') G.dark.push(strutGeo(new THREE.Vector3(s * hw * 0.73, H - 0.02, L.zW2), new THREE.Vector3(s * hwAt(L.zW3) * 0.82, L.deckY, L.zW3), 0.034, 8));
    G.dark.push(strutGeo(new THREE.Vector3(s * hw * 0.76, profileY(L.top, zb), zb), new THREE.Vector3(s * hw * 0.74, H - 0.02, zb), 0.03, 6));
    // mirrors: housing on a short arm
    const mz = L.zW0 - 0.14;
    (st === 'sedan' || st === 'rs911' ? G.carbon : st === 'hatch' ? G.trim : G.paint).push(xform(new THREE.SphereGeometry(0.07, 12, 8), s * (hw + 0.045), L.cowlY + 0.08, mz, 0, 0, 0, 0.75, 0.62, 1.0));
    G.dark.push(xform(new THREE.BoxGeometry(0.07, 0.02, 0.05), s * (hw - 0.01), L.cowlY + 0.04, mz + 0.01));
    G.dark.push(xform(new THREE.CircleGeometry(0.045, 12), s * (hw + 0.045), L.cowlY + 0.08, mz - 0.071, 0, Math.PI, 0, 1, 0.75, 1));
    // door handle
    G.metal.push(xform(new THREE.BoxGeometry(0.012, 0.025, 0.13), s * (hw + 0.004), yA + 0.06, zb + 0.15));
  }
  // interior: dashboard, seats, console (visible through the glass and from the cockpit camera)
  G.dark.push(loftZ([{ z: L.zW0 + 0.02, w: 2 * hw * 0.82, yt: L.cowlY + 0.06, yb: L.cowlY - 0.3, n: 5 }, { z: L.zW0 - 0.38, w: 2 * hw * 0.84, yt: L.cowlY + 0.08, yb: L.cowlY - 0.34, n: 5 }], 16));
  for (const s of [1, -1]) {
    G.dark.push(xform(new THREE.BoxGeometry(0.5, 0.13, 0.52), s * 0.37, L.cowlY - 0.48, L.eye.z - 0.12));
    G.dark.push(xform(new THREE.BoxGeometry(0.5, 0.68, 0.12), s * 0.37, L.cowlY - 0.12, L.eye.z - 0.42, -0.2));
  }
  G.dark.push(xform(new THREE.BoxGeometry(0.2, 0.2, 0.9), 0, L.cowlY - 0.42, L.eye.z + 0.05));
  G.dark.push(xform(new THREE.BoxGeometry(2 * coreHW, 0.02, Math.abs(L.zW0 - L.zW3)), 0, L.yb + 0.14, (L.zW0 + L.zW3) / 2));
  if (rally) { // roll cage: main hoop, A-pillar tubes, roof cross and diagonal
    const hz = L.eye.z - 0.55, hx = hw * 0.66, ry = H - 0.07, fy = floorY + 0.02, V = (x, y, z) => new THREE.Vector3(x, y, z);
    for (const s of [1, -1]) {
      G.metal.push(strutGeo(V(s * hx, fy, hz), V(s * hx, ry, hz), 0.02, 6));
      G.metal.push(strutGeo(V(s * hx, ry, hz), V(s * hw * 0.68, ry, L.zW1 - 0.05), 0.02, 6));
      G.metal.push(strutGeo(V(s * hw * 0.68, ry, L.zW1 - 0.05), V(s * hwAt(L.zW0) * 0.78, L.cowlY - 0.05, L.zW0 - 0.06), 0.02, 6));
      G.metal.push(strutGeo(V(s * hx, ry, hz), V(s * hw * 0.6, fy + 0.15, L.zW3 + 0.15), 0.018, 6));
    }
    G.metal.push(strutGeo(V(hx, ry, hz), V(-hx, ry, hz), 0.02, 6)); G.metal.push(strutGeo(V(hx, ry, hz), V(-hx, fy, hz), 0.018, 6));
  }
  // ---------------------------------------------------------------- front
  G.dark.push(xform(new THREE.BoxGeometry(hw * 1.75, 0.035, 0.12), 0, ybAt(zf) - 0.03, zf - 0.06)); // splitter
  const vent = (w, d) => new THREE.BoxGeometry(w, 0.008, d);
  const plane = (w, h) => new THREE.PlaneGeometry(w, h);
  const ventTop = (w, d, x, z) => { const m = onBody(V3(x, 4, z), DOWN, AY); if (m) G.dark.push(vent(w, d).applyMatrix4(m)); };
  const ventSide = (h, l, y, z) => { for (const s of [1, -1]) { const m = onBody(V3(s * 4, y, z), V3(-s, 0, 0), AX, 0.002); if (m) G.dark.push(new THREE.BoxGeometry(0.008, h, l).applyMatrix4(m)); } };
  const lampFront = (list, w, h, x, y, lift) => { const m = onBody(V3(x, y, zf + 2), V3(0, 0, -1), AZ, lift); if (m) list.push(plane(w, h).applyMatrix4(m)); return m; };
  const lampRear = (list, w, h, x, y, lift) => { const m = onBody(V3(x, y, zr - 2), V3(0, 0, 1), AZ, lift); if (m) list.push(plane(w, h).applyMatrix4(m)); return m; };
  const noseY = (dz) => top(zf - dz) - 0.03;
  if (st === 'rs911') {
    for (const s of [1, -1]) {
      const m = onBody(V3(s * hw * 0.66, 4, fa + 0.55), DOWN, AZ);
      if (m) {
        G.dark.push(new THREE.RingGeometry(0.098, 0.12, 24).applyMatrix4(m));
        G.head.push(new THREE.CircleGeometry(0.1, 24).translate(0, 0, 0.001).applyMatrix4(m));
        for (let k = 0; k < 4; k++) { const a = k / 4 * TAU + Math.PI / 4; G.lamp.push(new THREE.CircleGeometry(0.017, 8).translate(Math.cos(a) * 0.06, Math.sin(a) * 0.06, 0.003).applyMatrix4(m)); } // four-point DRLs
      }
      for (let k = 0; k < 5; k++) ventTop(0.2, 0.035, s * hw * 0.68, fa + 0.1 - k * 0.07); // fender louvres
      ventTop(0.3, 0.2, s * 0.24, fa + 0.2); // front-lid vents
      G.carbon.push(xform(new THREE.BoxGeometry(0.18, 0.012, 0.1), s * hw * 0.8, ybAt(zf) + 0.12, zf - 0.14, 0, s * 0.5, s * 0.25)); // dive planes
      const ci = onBody(V3(s * hw * 0.52, ybAt(zf) + 0.14, zf + 2), V3(0, 0, -1), AZ); if (ci) G.dark.push(plane(0.32, 0.15).applyMatrix4(ci)); // corner intakes
    }
    ventSide(0.12, 0.26, yA + 0.05, ra + archR + 0.2); // side intakes
    const mi = onBody(V3(0, ybAt(zf) + 0.12, zf + 2), V3(0, 0, -1), AZ); if (mi) G.dark.push(plane(0.5, 0.12).applyMatrix4(mi));
    G.carbon.push(plateZY([[L.zW2 + 0.05, H - 0.02], [L.zW2 - 0.05, H + 0.035], [L.zW3 + 0.18, L.deckY + 0.04], [L.zW3 + 0.12, L.deckY]], 0.012, 0)); // roof fin
    for (let k = 0; k < 7; k++) ventTop(hw * 1.1, 0.03, 0, L.zW3 - 0.1 - k * 0.06); // engine-lid slats
  } else if (st === 'fastback') { // GT-R R35 NISMO
    for (const s of [1, -1]) {
      lampFront(G.dark, 0.4, 0.11, s * hw * 0.6, noseY(0.16), 0.002);
      lampFront(G.head, 0.34, 0.06, s * hw * 0.6, noseY(0.16), 0.004);
      lampFront(G.head, 0.12, 0.03, s * hw * 0.8, noseY(0.3) + 0.02, 0.004); // boomerang sweep into the fender
      lampFront(G.dark, 0.24, 0.12, s * hw * 0.6, ybAt(zf) + 0.16, 0.002); // side intakes
      lampFront(G.lamp, 0.13, 0.02, s * hw * 0.6, ybAt(zf) + 0.25, 0.003); // DRL strips
      ventTop(0.2, 0.14, s * 0.3, fa + 0.2); // hood vents
    }
    ventSide(0.1, 0.2, yA + 0.05, fa - archF - 0.16); // fender vents
    lampFront(G.metal, hw * 0.8, 0.26, 0, ybAt(zf) + 0.3, 0.002); // chrome grille surround
    lampFront(G.dark, hw * 0.72, 0.21, 0, ybAt(zf) + 0.3, 0.004);
    G.accent.push(xform(new THREE.BoxGeometry(hw * 1.6, 0.02, 0.05), 0, ybAt(zf) + 0.005, zf - 0.08)); // NISMO red lip line
  } else if (st === 'sedan') { // M3 CS
    for (const s of [1, -1]) {
      lampFront(G.dark, 0.36, 0.11, s * hw * 0.64, noseY(0.1), 0.002);
      lampFront(G.head, 0.3, 0.055, s * hw * 0.64, noseY(0.1) - 0.01, 0.004);
      lampFront(G.lamp, 0.26, 0.016, s * hw * 0.64, noseY(0.1) + 0.03, 0.005); // yellow CS daytime lights
      lampFront(G.metal, 0.27, 0.4, s * 0.16, ybAt(zf) + 0.36, 0.002); // kidney frame
      lampFront(G.dark, 0.235, 0.36, s * 0.16, ybAt(zf) + 0.36, 0.004); // kidney
      lampFront(G.dark, 0.24, 0.16, s * hw * 0.68, ybAt(zf) + 0.13, 0.002); // corner intakes
      ventTop(0.18, 0.18, s * 0.32, fa + 0.1); // carbon-hood vents
    }
    ventSide(0.08, 0.18, yA + 0.05, fa - archF - 0.14); // side gills
    G.carbon.push(loftZ(zs(fa + 0.45, L.zW0 + 0.04, 6).map(z => ({ z, w: 0.5, yt: top(z) + 0.014, yb: top(z) - 0.05, n: 3 })), 16)); // carbon power dome
    lampFront(G.dark, hw * 0.7, 0.12, 0, ybAt(zf) + 0.11, 0.002);
  } else if (st === 'hatch') { // i30 N: sharp LED headlights, big mesh grille, red lip
    for (const s of [1, -1]) {
      lampFront(G.dark, 0.4, 0.075, s * hw * 0.62, noseY(0.14), 0.002);
      lampFront(G.head, 0.34, 0.026, s * hw * 0.62, noseY(0.14) + 0.012, 0.004);
      lampFront(G.lamp, 0.2, 0.012, s * hw * 0.66, noseY(0.14) - 0.022, 0.005);
      lampFront(G.dark, 0.24, 0.13, s * hw * 0.66, ybAt(zf) + 0.13, 0.002); // corner intakes
    }
    lampFront(G.dark, hw * 0.95, 0.27, 0, ybAt(zf) + 0.25, 0.003); // cascading grille
    G.accent.push(xform(new THREE.BoxGeometry(hw * 1.7, 0.016, 0.05), 0, ybAt(zf) - 0.012, zf - 0.07)); // red lip line
    for (const s of [1, -1]) { G.accent.push(xform(new THREE.BoxGeometry(0.01, 0.014, skL * 0.9), s * (hw * 0.975 + 0.03), L.yb + 0.005, skZ)); G.metal.push(xform(new THREE.BoxGeometry(0.012, 0.025, 0.12), s * (hw + 0.002), yA + 0.06, zb - 0.75)); } // red skirt line, rear-door handles
  } else { // i20 N Rally1
    for (const s of [1, -1]) {
      lampFront(G.dark, 0.36, 0.08, s * hw * 0.62, noseY(0.12), 0.002);
      lampFront(G.head, 0.3, 0.035, s * hw * 0.62, noseY(0.12), 0.004);
      lampFront(G.dark, 0.26, 0.16, s * hw * 0.66, ybAt(zf) + 0.15, 0.003); // brake ducts
      ventTop(0.2, 0.16, s * 0.25, fa + 0.25);
    }
    lampFront(G.dark, hw * 0.9, 0.24, 0, ybAt(zf) + 0.24, 0.003); // radiator opening
    G.dark.push(xform(new THREE.BoxGeometry(hw * 1.95, 0.04, 0.22), 0, ybAt(zf) - 0.035, zf - 0.04)); // big splitter
    for (const [z, ry] of [[zf - 0.02, 0], [zr + 0.02, Math.PI]]) G.accent.push(xform(new THREE.TorusGeometry(0.04, 0.012, 6, 12), -hw * 0.5, ybAt(z) + 0.08, z + (ry ? -0.02 : 0.02), 0, Math.PI / 2)); // tow hooks
    G.trim.push(xform(new THREE.BoxGeometry(0.3, 0.06, 0.26), 0, H + 0.02, L.zW1 - 0.2)); // roof scoop
    G.dark.push(xform(new THREE.BoxGeometry(0.24, 0.035, 0.02), 0, H + 0.025, L.zW1 - 0.07));
    G.metal.push(strutGeo(new THREE.Vector3(0, H, lerp(L.zW1, L.zW2, 0.7)), new THREE.Vector3(0, H + 0.22, lerp(L.zW1, L.zW2, 0.75)), 0.004, 4));
  }
  if (st === 'hatch') G.paint.push(xform(new THREE.BoxGeometry(hw * 1.5, 0.035, 0.32), 0, H - 0.03, L.zW2 - 0.12, -0.12));
  // ---------------------------------------------------------------- rear
  const tailY = profileY(L.top, zr + 0.05) - 0.08;
  if (st === 'fastback') for (const s of [1, -1]) for (const k of [0.45, 0.72]) { // four round lamps
    const m = onBody(V3(s * hw * k, tailY, zr - 2), V3(0, 0, 1), AZ, 0.002);
    if (m) { G.dark.push(new THREE.CircleGeometry(0.088, 20).applyMatrix4(m)); G.tail.push(new THREE.RingGeometry(0.035, 0.075, 20).translate(0, 0, 0.002).applyMatrix4(m)); }
  }
  else if (st === 'rs911') lampRear(G.tail, hw * 1.7, 0.035, 0, tailY + 0.03, 0.003);
  else if (st === 'sedan') for (const s of [1, -1]) { lampRear(G.tail, 0.34, 0.05, s * hw * 0.66, tailY + 0.02, 0.003); lampRear(G.tail, 0.05, 0.12, s * hw * 0.82, tailY - 0.04, 0.003); } // L-shaped lamps
  else for (const s of [1, -1]) lampRear(G.tail, 0.3, 0.08, s * hw * 0.68, tailY, 0.003);
  (st === 'fastback' || st === 'sedan' || st === 'rs911' ? G.carbon : G.dark).push(xform(new THREE.BoxGeometry(hw * 1.4, 0.16, 0.25), 0, L.yb + 0.08, zr + 0.1)); // diffuser
  for (const x of [-0.3, 0, 0.3]) G.dark.push(xform(new THREE.BoxGeometry(0.012, 0.12, 0.3), x * hw, L.yb + 0.06, zr + 0.12)); // diffuser strakes
  const ex = { rally: [[-0.62, 0.065]], hatch: [[0.62, 0.06], [-0.62, 0.06]], rs911: [[0.08, 0.055], [-0.08, 0.055]], sedan: [[0.3, 0.045], [0.48, 0.045], [-0.3, 0.045], [-0.48, 0.045]], fastback: [[0.62, 0.052], [0.78, 0.052], [-0.62, 0.052], [-0.78, 0.052]] }[st];
  for (const [x, r] of ex) G.metal.push(xform(new THREE.CylinderGeometry(r, r, 0.16, 16, 1, true), x * hw, L.yb + 0.12, zr + 0.02, Math.PI / 2));
  // wings / spoilers
  if (st === 'sedan') G.carbon.push(xform(new THREE.BoxGeometry(hw * 1.45, 0.03, 0.12), 0, L.deckY + 0.025, zr + 0.07, 0.25));
  if (st === 'fastback') {
    const wy = L.deckY + 0.24, wz = zr + 0.48;
    G.carbon.push(wingX([{ x: -hw * 0.82, z: wz, y: wy, c: 0.28, a: 0.12, t: 0.1 }, { x: hw * 0.82, z: wz, y: wy, c: 0.28, a: 0.12, t: 0.1 }]));
    for (const s of [1, -1]) { G.carbon.push(plateZY([[wz + 0.05, wy - 0.02], [wz - 0.3, wy - 0.02], [wz - 0.25, L.deckY - 0.02], [wz - 0.05, L.deckY - 0.02]], 0.02, s * hw * 0.55)); G.carbon.push(plateZY([[wz + 0.02, wy - 0.06], [wz - 0.34, wy - 0.04], [wz - 0.3, wy + 0.08], [wz, wy + 0.06]], 0.012, s * hw * 0.83)); }
  }
  if (st === 'rs911') {
    const wy = 1.42, wz = zr + 0.6;
    G.carbon.push(wingX([{ x: -0.8, z: wz, y: wy, c: 0.38, a: 0.1, t: 0.11 }, { x: 0, z: wz - 0.02, y: wy - 0.01, c: 0.39, a: 0.1, t: 0.11 }, { x: 0.8, z: wz, y: wy, c: 0.38, a: 0.1, t: 0.11 }]));
    for (const s of [1, -1]) {
      G.carbon.push(plateZY([[wz - 0.02, wy + 0.06], [wz - 0.16, wy + 0.08], [wz - 0.36, L.deckY], [wz - 0.12, L.deckY]], 0.025, s * 0.26)); // swan-neck pylons
      G.accent.push(plateZY([[wz + 0.06, wy - 0.06], [wz - 0.5, wy - 0.06], [wz - 0.52, wy + 0.24], [wz - 0.06, wy + 0.2]], 0.014, s * 0.81)); // end plates
    }
  }
  if (rally) {
    // big roof wing over the tailgate, on two pylons, with tall end plates
    const wy = H + 0.03, wz = L.zW2 + 0.04;
    G.dark.push(wingX([{ x: -hw * 0.86, z: wz, y: wy, c: 0.4, a: 0.16, t: 0.1 }, { x: hw * 0.86, z: wz, y: wy, c: 0.4, a: 0.16, t: 0.1 }]));
    G.dark.push(wingX([{ x: -hw * 0.84, z: wz - 0.32, y: wy + 0.1, c: 0.16, a: 0.5, t: 0.1 }, { x: hw * 0.84, z: wz - 0.32, y: wy + 0.1, c: 0.16, a: 0.5, t: 0.1 }]));
    for (const s of [1, -1]) {
      G.trim.push(plateZY([[wz + 0.04, wy - 0.05], [wz - 0.44, wy - 0.08], [wz - 0.46, wy + 0.14], [wz - 0.02, wy + 0.07]], 0.016, s * hw * 0.87));
      G.dark.push(plateZY([[wz - 0.05, wy], [wz - 0.25, wy - 0.02], [wz - 0.3, H - 0.1], [wz - 0.12, H - 0.04]], 0.02, s * hw * 0.4));
    }
    // mud flaps behind every wheel
    for (const [z, r, xw, tw] of [[fa, rF, P.xF, tF], [ra, rR, P.xR, tR]]) for (const s of [1, -1]) {
      G.dark.push(xform(new THREE.BoxGeometry(tw + 0.05, 0.22, 0.012), s * xw, 0.15, z - r - 0.1));
      G.accent.push(xform(new THREE.BoxGeometry(tw * 0.6, 0.04, 0.004), s * xw, 0.2, z - r - 0.107));
    }
  }
  // race-number roundels on both doors (instanced atlas, see CarFleet)
  const num = [];
  for (const s of [1, -1]) { const p = new THREE.CircleGeometry(0.2, 24); p.rotateY(s * Math.PI / 2); p.translate(s * (hwAt(0) + 0.008), (yA + profileY(L.top, 0)) / 2, lerp(L.zW1, L.zW2, 0.45)); num.push(p); }
  // DRS flap (911 GT3 RS only): built with its trailing edge at the origin, pivots there
  let flap = null, flapPivot = null;
  if (P.hasDRS) {
    const wz = zr + 0.6, wy = 1.42, c = 0.22, aClosed = 0.55, le = new THREE.Vector3(0, wy + 0.08, wz - 0.3);
    flap = wingX([{ x: -0.79, z: 0, y: 0, c, a: 0, t: 0.1 }, { x: 0.79, z: 0, y: 0, c, a: 0, t: 0.1 }]); flap.translate(0, 0, c);
    flapPivot = new THREE.Vector3(0, le.y + c * Math.sin(aClosed), le.z - c * Math.cos(aClosed));
  }
  const geo = {};
  for (const [k, list] of Object.entries(G)) geo[k] = list.length ? mergeList(list) : null;
  if (P.spec.livery === 'rally1') { // light blue-grey body, dark navy tail and sills, red sweep ahead of the navy (no sponsor logos)
    const g = geo.paint = mergeList(G.paint, true), p = g.attributes.position, col = g.attributes.color;
    const base = new THREE.Color(0xaec3d6), navy = new THREE.Color(0x1a2442), red = new THREE.Color(0xd9001b);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i), rearB = ra + 0.5 + (y - 0.45) * 1.1;
      let c = base;
      if (z < rearB) c = navy; else if (z < rearB + 0.24 && y > 0.4) c = red;
      else if (y < 0.4 && Math.abs(x) > hw * 0.7) c = navy;
      else if (z > zf - 0.3 && y < 0.6) c = navy;
      else if (z > zf - 0.42 && y < 0.6) c = red;
      else if (y > H - 0.06 && z > lerp(L.zW1, L.zW2, 0.45)) c = red;
      col.setXYZ(i, c.r, c.g, c.b);
    }
  }
  return { geo, num: mergeList(num), flap, flapPivot, layout: L };
}

const CarAssets = {
  built: false, specs: new Map(),
  build() {
    if (this.built) return; this.built = true;
    this.helmet = mergeList([new THREE.SphereGeometry(0.135, 20, 14).scale(1, 1.05, 1.12)]);
    this.visor = xform(new THREE.SphereGeometry(0.1, 16, 10), 0, 0.015, 0.07, 0, 0, 0, 1.22, 0.42, 0.92);
    const cb = Tex.carbon();
    this.mat = {
      carbon: new THREE.MeshPhysicalMaterial({ map: cb.map, normalMap: cb.normalMap, normalScale: new THREE.Vector2(0.25, 0.25), roughness: 0.32, metalness: 0.15, clearcoat: 0.8, clearcoatRoughness: 0.12, side: THREE.DoubleSide }),
      dark: new THREE.MeshStandardMaterial({ color: 0x101114, roughness: 0.8, side: THREE.DoubleSide }),
      metal: new THREE.MeshStandardMaterial({ color: 0xc8ccd2, roughness: 0.22, metalness: 1.0, side: THREE.DoubleSide }),
      glass: new THREE.MeshStandardMaterial({ color: 0x080c10, roughness: 0.05, metalness: 0.35, transparent: true, opacity: 0.86, side: THREE.DoubleSide, depthWrite: false }), // tinted: reads as glass from outside (hidden in the cockpit view)
      head: new THREE.MeshStandardMaterial({ color: 0xf4f6ff, emissive: 0xe8eeff, emissiveIntensity: 0.9, roughness: 0.2, side: THREE.DoubleSide }),
      rubber: new THREE.MeshStandardMaterial({ map: Tex.tire(), roughness: 0.88, metalness: 0.0, side: THREE.DoubleSide }),
      visor: new THREE.MeshPhysicalMaterial({ color: 0x111111, roughness: 0.05, metalness: 0.9 })
    };
    this.flameTex = (() => { const c = Tex.canvas(64, 64), x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,255,230,1)'); g.addColorStop(0.3, 'rgba(255,170,60,0.9)'); g.addColorStop(0.7, 'rgba(255,60,10,0.35)'); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64); return Tex.finish(c, true, false); })();
  },
  // per-car-type geometry (cached)
  forSpec(P) {
    this.build();
    if (this.specs.has(P.id)) return this.specs.get(P.id);
    const d = P.spec.dims, rimR = d.rimIn * 0.0254 / 2;
    const body = buildRoadCar(P);
    const a = {
      ...body, rimR,
      tireF: this.tireGeo(d.tireF, d.rF, rimR), tireR: this.tireGeo(d.tireR, d.rR, rimR),
      rimF: this.rimGeo(d.tireF, rimR), rimR_: this.rimGeo(d.tireR, rimR),
      disc: xform(new THREE.CylinderGeometry(rimR * 0.82, rimR * 0.82, 0.03, 28), -0.06, 0, 0, 0, 0, Math.PI / 2),
      hub: (() => { const cal = new THREE.Shape(); cal.absarc(0, 0, rimR * 0.92, -0.5, 0.5, false); cal.absarc(0, 0, rimR * 0.6, 0.5, -0.5, true); const g = new THREE.ExtrudeGeometry(cal, { depth: 0.07, bevelEnabled: false, curveSegments: 6 }); g.rotateY(Math.PI / 2); g.translate(-0.095, 0, 0); g.rotateX(-1.1); return g; })()
    };
    P.eye = body.layout.eye;
    this.specs.set(P.id, a); return a;
  },
  tireGeo(w, R, rimR) {
    const r0 = rimR + 0.004, h = w / 2, sw = R - r0;
    const pts = [[r0, -h + 0.02], [r0 + sw * 0.1, -h - 0.002], [r0 + sw * 0.55, -h - 0.012], [r0 + sw * 0.85, -h + 0.004], [R - 0.008, -h + 0.025], [R, -h + 0.05], [R, h - 0.05], [R - 0.008, h - 0.025], [r0 + sw * 0.85, h - 0.004], [r0 + sw * 0.55, h + 0.012], [r0 + sw * 0.1, h + 0.002], [r0, h - 0.02]];
    const g = new THREE.LatheGeometry(pts.map(p => new THREE.Vector2(p[0], p[1])), 44);
    g.rotateZ(-Math.PI / 2);
    return g;
  },
  rimGeo(w, r) {
    const h = w / 2;
    const barrel = new THREE.LatheGeometry([[r - 0.01, -h + 0.02], [r, -h + 0.015], [r, h - 0.02], [r + 0.012, h - 0.01], [r + 0.012, h + 0.004]].map(p => new THREE.Vector2(p[0], p[1])), 40); barrel.rotateZ(-Math.PI / 2);
    const parts = [barrel];
    for (let k = 0; k < 10; k++) { const sp = new THREE.BoxGeometry(0.022, r * 0.78, 0.03); sp.translate(0, r * 0.52, 0); sp.rotateX(k / 10 * TAU + (k % 2) * 0.12); sp.translate(h - 0.03, 0, 0); parts.push(sp); }
    parts.push(xform(new THREE.CylinderGeometry(0.06, 0.065, 0.07, 16), h - 0.03, 0, 0, 0, 0, Math.PI / 2));
    const ring = new THREE.TorusGeometry(r - 0.012, 0.008, 6, 40); ring.rotateY(Math.PI / 2); ring.translate(h - 0.005, 0, 0); parts.push(ring);
    return mergeList(parts);
  }
};

// ---------------------------------------------------------------------
// CarModel: per-car pose (transform hierarchy, wheel steer/spin/travel,
// DRS flap, brake glow, cockpit hiding). Geometry is drawn by CarFleet.
// ---------------------------------------------------------------------
class CarModel {
  constructor(opts) {
    const P = opts.P, A = CarAssets.forSpec(P);
    this.opts = opts; this.P = P; this.A = A;
    this.root = new THREE.Group(); this.root.name = 'car-' + opts.code;
    this.body = new THREE.Group(); this.body.position.y = -P.cgH; this.root.add(this.body);
    const L = A.layout;
    this.helmet = new THREE.Object3D(); this.helmet.position.set(0.37, L.H - 0.27, L.eye.z - 0.04); this.body.add(this.helmet);
    this.drsPivot = new THREE.Object3D(); this.drsClosed = 0.55; this.drsOpenAngle = 0.12;
    if (A.flapPivot) this.drsPivot.position.copy(A.flapPivot);
    this.drsPivot.rotation.x = this.drsClosed; this.body.add(this.drsPivot);
    this.wheels = [];
    P.wheels.forEach((pw) => {
      const side = Math.sign(pw.x);
      const corner = new THREE.Object3D(); corner.position.set(pw.x, pw.R, pw.z);
      const steer = new THREE.Object3D(); corner.add(steer);
      const mirror = new THREE.Object3D(); mirror.scale.x = side; steer.add(mirror);
      const spin = new THREE.Object3D(); mirror.add(spin);
      this.body.add(corner);
      this.wheels.push({ corner, steer, mirror, spin, x: pw.x, z: pw.z, front: pw.front, side });
    });
    this.discGlow = [0, 0, 0, 0]; this.lightI = 0.35; this.cockpit = false; this.blobMatrix = new THREE.Matrix4();
    // round steering wheel + instrument display (player car only: it is inside the cabin)
    if (opts.player) {
      const e = L.eye, grp = this.wheelGroup = new THREE.Group();
      grp.position.set(0.37, L.cowlY - 0.1, e.z + 0.48); grp.rotation.x = -0.3;
      const rim = new THREE.TorusGeometry(0.17, 0.017, 10, 40);
      const spokes = [xform(new THREE.BoxGeometry(0.28, 0.026, 0.016), 0, -0.02, 0), xform(new THREE.BoxGeometry(0.028, 0.15, 0.016), 0, -0.095, 0), xform(new THREE.CylinderGeometry(0.045, 0.045, 0.04, 16), 0, 0, 0, Math.PI / 2)];
      grp.add(new THREE.Mesh(mergeList([rim, ...spokes]), CarAssets.mat.dark));
      grp.add(new THREE.Mesh(xform(new THREE.BoxGeometry(0.04, 0.014, 0.02), 0, 0.17, -0.006), new THREE.MeshStandardMaterial({ color: 0xff2b2b }))); // 12 o'clock marker
      this.body.add(grp);
      this.dispCanvas = Tex.canvas(256, 128); this.dispTex = Tex.finish(this.dispCanvas, true, false);
      const disp = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.13), new THREE.MeshBasicMaterial({ map: this.dispTex, toneMapped: false }));
      disp.position.set(0.37, L.cowlY + 0.12, e.z + 0.74); disp.rotation.set(-0.35, Math.PI, 0); this.body.add(disp);
      this.body.add(new THREE.Mesh(strutGeo(new THREE.Vector3(0.37, L.cowlY - 0.13, e.z + 0.53), new THREE.Vector3(0.37, L.cowlY - 0.2, e.z + 0.85), 0.022), CarAssets.mat.metal));
    }
    this.flame = new THREE.Sprite(new THREE.SpriteMaterial({ map: CarAssets.flameTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
    this.flame.position.set(0, L.yb + 0.12, P.zRear - 0.1); this.flame.scale.set(0.3, 0.3, 0.3); this.flame.visible = false; this.body.add(this.flame);
    this.flameT = 0; this._dispT = 0;
  }
  // st: {hubY[4] (model-space hub centre y), steer[4], spin[4], steerWheel, drs (0..1), brakeTemp[4], braking, rpm, gear, speedKmh, cockpit}
  update(st, dt) {
    this.wheels.forEach((w, i) => {
      w.corner.position.y = st.hubY[i];
      w.steer.rotation.y = st.steer[i];
      w.spin.rotation.x = st.spin[i];
      const t = st.brakeTemp ? st.brakeTemp[i] : 300;
      this.discGlow[i] = clamp((t - 620) / 380, 0, 1) * 2.2;
    });
    if (this.wheelGroup) this.wheelGroup.rotation.z = st.steerWheel;
    this.drsPivot.rotation.x = lerp(this.drsClosed, this.drsOpenAngle, st.drs);
    this.lightI = st.braking ? 2.4 : 0.45;
    this.cockpit = !!st.cockpit;
    if (st.backfire) this.flameT = 0.09;
    if (this.flameT > 0) { this.flameT -= dt; const f = clamp(this.flameT / 0.09, 0, 1); this.flame.visible = true; this.flame.material.opacity = f; const sc = 0.18 + Math.random() * 0.2; this.flame.scale.set(sc, sc, sc); } else this.flame.visible = false;
    if (this.dispCanvas) {
      this._dispT -= dt;
      if (this._dispT <= 0) {
        this._dispT = 0.06;
        const c = this.dispCanvas.getContext('2d'), P = this.P;
        c.fillStyle = '#050608'; c.fillRect(0, 0, 256, 128);
        const n = 15, lit = Math.round(clamp((st.rpm - 0.72 * P.cutRPM) / (0.26 * P.cutRPM), 0, 1) * n);
        for (let j = 0; j < n; j++) { c.fillStyle = j < lit ? (j < 5 ? '#24e05a' : j < 10 ? '#ffb400' : '#ff2b2b') : '#1a1d22'; if (st.rpm > P.cutRPM - 120) c.fillStyle = (performance.now() % 120 < 60) ? '#3b7bff' : '#1a1d22'; c.fillRect(8 + j * 16, 6, 12, 8); }
        c.fillStyle = '#ffffff'; c.font = '900 64px Arial'; c.textAlign = 'center'; c.fillText(st.gear, 128, 92);
        c.font = '700 34px Arial'; c.textAlign = 'left'; c.fillText(String(Math.round(st.speedKmh)), 10, 70); c.font = '600 16px Arial'; c.fillText('KM/H', 12, 92);
        c.textAlign = 'right'; c.font = '700 22px Arial'; c.fillStyle = '#9fb0c2'; c.fillText(Math.round(st.rpm) + '', 246, 62); c.font = '600 14px Arial'; c.fillText('RPM', 246, 80);
        if (P.hasDRS) { c.fillStyle = st.drs > 0.5 ? '#24e05a' : '#56606c'; c.font = '700 18px Arial'; c.fillText('DRS', 246, 112); }
        c.fillStyle = '#9fb0c2'; c.font = '600 16px Arial'; c.textAlign = 'left'; c.fillText(st.delta || '', 10, 118);
        this.dispTex.needsUpdate = true;
      }
    }
  }
}

// ---------------------------------------------------------------------
// CarFleet: instanced renderer for every car of one type. Per-car paint,
// accent and helmet colours, brake-disc and tail-light glow come from
// instanceColor; race numbers from a texture atlas indexed per instance.
// ---------------------------------------------------------------------
class CarFleet {
  constructor(P, cap, blobMat) {
    const A = CarAssets.forSpec(P), MA = CarAssets.mat;
    this.P = P; this.cap = cap; this.group = new THREE.Group(); this.group.name = 'car-fleet-' + P.id; this.owner = new Array(cap).fill(null);
    const emissiveFromInstance = (mat, key) => {
      mat.onBeforeCompile = (sh) => {
        sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', '')
          .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n#ifdef USE_COLOR\n totalEmissiveRadiance *= vColor.r;\n#endif');
      };
      mat.customProgramCacheKey = () => 'inst-emissive-' + key;
      return mat;
    };
    const M = {
      paint: new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.28, metalness: P.spec.livery ? 0.15 : 0.35, clearcoat: 1.0, clearcoatRoughness: 0.05, side: THREE.DoubleSide, vertexColors: !!P.spec.livery }),
      accent: new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.2, clearcoat: 0.8, side: THREE.DoubleSide }),
      carbon: MA.carbon, dark: MA.dark, metal: MA.metal, glass: MA.glass, head: MA.head,
      trim: new THREE.MeshPhysicalMaterial({ color: P.spec.trim || 0x222222, roughness: 0.3, metalness: 0.2, clearcoat: 1.0, side: THREE.DoubleSide }),
      lamp: new THREE.MeshStandardMaterial({ color: P.spec.lamp || 0xffffff, emissive: P.spec.lamp || 0xffffff, emissiveIntensity: 1.3, side: THREE.DoubleSide }),
      tail: emissiveFromInstance(new THREE.MeshStandardMaterial({ color: 0x3a0000, emissive: 0xff1010, emissiveIntensity: 1, side: THREE.DoubleSide }), 'tail'),
      disc: emissiveFromInstance(new THREE.MeshStandardMaterial({ color: 0x3a3a3e, roughness: 0.55, metalness: 0.4, emissive: 0xff3300, emissiveIntensity: 1 }), 'disc'),
      helmet: new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.2, clearcoat: 1 }),
      rim: new THREE.MeshStandardMaterial({ color: P.spec.rimColor, roughness: 0.35, metalness: 0.85, side: THREE.DoubleSide }),
      caliper: new THREE.MeshStandardMaterial({ color: P.spec.caliper, roughness: 0.45, metalness: 0.3, side: THREE.DoubleSide })
    };
    this.M = M;
    this.numCanvas = Tex.canvas(512, 512); this.numTex = Tex.finish(this.numCanvas, true, false);
    const numMat = new THREE.MeshStandardMaterial({ map: this.numTex, roughness: 0.4, polygonOffset: true, polygonOffsetFactor: -2 });
    numMat.onBeforeCompile = (sh) => { sh.vertexShader = 'attribute vec2 numCell;\n' + sh.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\n vMapUv = vMapUv * 0.25 + numCell;\n#endif'); };
    numMat.customProgramCacheKey = () => 'num-atlas';
    const mk = (name, geo, mat, per, shadow) => {
      const m = new THREE.InstancedMesh(geo, mat, cap * per); m.name = 'fleet-' + name;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.frustumCulled = false; m.castShadow = shadow; m.receiveShadow = true; m.count = 0; m.userData.per = per;
      this.group.add(m); return m;
    };
    this.parts = {};
    for (const [k, g] of Object.entries(A.geo)) if (g) this.parts[k] = mk(k, g, M[k], 1, !['tail', 'head', 'glass', 'metal', 'lamp'].includes(k));
    if (this.parts.glass) this.parts.glass.renderOrder = 3;
    this.flap = A.flap ? mk('flap', A.flap, M.accent, 1, true) : null;
    this.helmet = mk('helmet', CarAssets.helmet, M.helmet, 1, true);
    this.visor = mk('visor', CarAssets.visor, CarAssets.mat.visor, 1, false);
    const numGeo = A.num.clone(); numGeo.setAttribute('numCell', new THREE.InstancedBufferAttribute(new Float32Array(cap * 2), 2));
    this.number = mk('number', numGeo, numMat, 1, false);
    this.tireF = mk('tireF', A.tireF, MA.rubber, 2, true); this.tireR = mk('tireR', A.tireR, MA.rubber, 2, true);
    this.rimF = mk('rimF', A.rimF, M.rim, 2, false); this.rimR = mk('rimR', A.rimR_, M.rim, 2, false);
    this.disc = mk('disc', A.disc, M.disc, 4, false);
    this.hub = mk('hub', A.hub, M.caliper, 4, false);
    const blobGeo = new THREE.PlaneGeometry(P.width * 1.25, P.length * 1.08);
    this.blob = mk('blob', blobGeo, blobMat, 1, false); this.blob.receiveShadow = false; this.blob.renderOrder = 1;
    const white = new THREE.Color(1, 1, 1);
    for (const m of [this.parts.paint, this.parts.accent, this.parts.tail, this.flap, this.helmet, this.disc]) { if (!m) continue; for (let i = 0; i < m.instanceMatrix.count; i++) m.setColorAt(i, white); m.instanceColor.setUsage(THREE.DynamicDrawUsage); }
    this.all = this.group.children;
    this._zero = new THREE.Matrix4().makeScale(0, 0, 0); this._t = new THREE.Matrix4(); this._c = new THREE.Color();
  }
  _assign(i, model) {
    const o = model.opts, c = this._c;
    if (this.parts.paint) this.parts.paint.setColorAt(i, c.setHex(o.color));
    if (this.parts.accent) this.parts.accent.setColorAt(i, c.setHex(o.accent));
    if (this.flap) this.flap.setColorAt(i, c.setHex(o.accent));
    this.helmet.setColorAt(i, c.setHex(o.helmet || 0xffffff));
    const ctx = this.numCanvas.getContext('2d'), col = i % 4, row = Math.floor(i / 4);
    ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.fillRect(col * 128, row * 128, 128, 128); ctx.fillStyle = '#111111'; ctx.font = '900 80px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(o.number), col * 128 + 64, row * 128 + 68); this.numTex.needsUpdate = true;
    const nc = this.number.geometry.attributes.numCell; nc.setXY(i, col * 0.25, 1 - (row + 1) * 0.25); nc.needsUpdate = true;
    for (const m of [this.parts.paint, this.parts.accent, this.flap, this.helmet]) if (m) m.instanceColor.needsUpdate = true;
    this.owner[i] = model;
  }
  sync(cars) {
    const n = Math.min(cars.length, this.cap), c = this._c;
    this.group.visible = n > 0;
    for (const m of this.all) m.count = n * m.userData.per;
    for (let i = 0; i < n; i++) {
      const md = cars[i].model;
      if (this.owner[i] !== md) this._assign(i, md);
      md.root.updateMatrixWorld(true);
      const B = md.body.matrixWorld;
      for (const k in this.parts) this.parts[k].setMatrixAt(i, (k === 'glass' && md.cockpit) ? this._zero : B);
      this.number.setMatrixAt(i, B);
      if (this.parts.tail) this.parts.tail.setColorAt(i, c.setRGB(md.lightI, md.lightI, md.lightI));
      if (this.flap) this.flap.setMatrixAt(i, md.drsPivot.matrixWorld);
      const hm = md.cockpit ? this._zero : md.helmet.matrixWorld;
      this.helmet.setMatrixAt(i, hm); this.visor.setMatrixAt(i, hm);
      let f = 0, r = 0;
      md.wheels.forEach((w, k) => {
        if (w.front) { this.tireF.setMatrixAt(i * 2 + f, w.spin.matrixWorld); this.rimF.setMatrixAt(i * 2 + f, w.spin.matrixWorld); f++; }
        else { this.tireR.setMatrixAt(i * 2 + r, w.spin.matrixWorld); this.rimR.setMatrixAt(i * 2 + r, w.spin.matrixWorld); r++; }
        this.hub.setMatrixAt(i * 4 + k, w.mirror.matrixWorld);
        this.disc.setMatrixAt(i * 4 + k, w.spin.matrixWorld); const gl = md.discGlow[k]; this.disc.setColorAt(i * 4 + k, c.setRGB(gl, gl, gl));
      });
      this.blob.setMatrixAt(i, md.blobMatrix);
    }
    for (const m of this.all) m.instanceMatrix.needsUpdate = true;
    if (this.parts.tail) this.parts.tail.instanceColor.needsUpdate = true; this.disc.instanceColor.needsUpdate = true;
  }
}
