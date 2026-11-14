
// =====================================================================
// TRACK FACILITIES — pit building, grandstands, crowd, gantry, signage
// Everything is positioned from the track frame system (s, lateral u).
// =====================================================================
class Facilities {
  constructor(track, terrain, M) {
    this.track = track; this.terrain = terrain; this.M = M;
    this.group = new THREE.Group(); this.group.name = 'facilities';
    this.exclusions = []; this.startLightMats = [];
  }
  // place a local-space geometry at (s,u): local +Z along track, +X to the left of the track
  placeMatrix(s, u, yOff = 0, extraRot = 0) {
    const f = this.track.frameAt(s, u);
    return new THREE.Matrix4().compose(new THREE.Vector3(f.pos.x, f.pos.y + yOff, f.pos.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), f.heading + extraRot), new THREE.Vector3(1, 1, 1));
  }
  box(w, h, d, x, y, z) { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); return g; }
  build() {
    const tr = this.track, M = this.M;
    const buckets = { white: [], dark: [], glass: [], door: [], steel: [], accent: [], red: [], orange: [], concrete: [], seat: [] };
    const push = (k, g, m) => { if (m) g.applyMatrix4(m); buckets[k].push(g); };
    const p = tr.pit;
    // ---------------- pit building (main straight, left side)
    const garLen = tr.wrapS(p.garEnd - p.garStart), mid = p.garStart + garLen / 2, mB = this.placeMatrix(mid, 0);
    const x0 = PIT.garageU, depth = 18, nGar = Math.floor(garLen / 16);
    push('white', this.box(depth, 0.5, garLen + 4, x0 + depth / 2, 5.2, 0), mB);
    push('white', this.box(depth - 1, 0.6, garLen + 2, x0 + depth / 2 + 0.5, 10.3, 0), mB);
    push('white', this.box(depth + 2.5, 0.35, garLen + 6, x0 + depth / 2 - 0.6, 10.8, 0), mB);
    push('glass', this.box(0.15, 4.5, garLen, x0 + 1.2, 7.7, 0), mB);
    push('dark', this.box(depth - 2, 4.2, garLen, x0 + depth / 2 + 0.8, 2.1, 0), mB);
    push('white', this.box(depth, 5, 0.6, x0 + depth / 2, 2.5, garLen / 2 + 1.7), mB);
    push('white', this.box(depth, 5, 0.6, x0 + depth / 2, 2.5, -garLen / 2 - 1.7), mB);
    push('white', this.box(0.5, 10.5, garLen + 4, x0 + depth, 5.25, 0), mB);
    for (let g = 0; g <= nGar; g++) {
      const z = -garLen / 2 + g * (garLen / nGar);
      push('white', this.box(1.2, 5.0, 1.6, x0 + 0.6, 2.5, z), mB);
      if (g < nGar) {
        const zc = z + garLen / nGar / 2;
        push('door', this.box(0.2, 1.4, garLen / nGar - 1.8, x0 + 0.8, 3.6, zc), mB);
        push('accent', this.box(0.12, 0.5, garLen / nGar - 1.8, x0 + 0.05, 4.65, zc), mB);
      }
    }
    for (let z = -garLen / 2; z <= garLen / 2; z += 3) push('steel', this.box(0.08, 1.0, 0.08, x0 - 0.6, 5.95, z), mB);
    push('steel', this.box(0.08, 0.08, garLen + 4, x0 - 0.6, 6.45, 0), mB);
    this.exclusions.push({ ...this._xz(mid, x0 + 9), r: garLen / 2 + 40 });
    // paddock motorhomes behind the pits
    for (let k = 0; k < 8; k++) { const s = p.garStart + 20 + k * garLen / 8; const m = this.placeMatrix(s, x0 + depth + 14); push(k % 2 ? 'white' : 'dark', this.box(9, 4.2, 18, 0, 2.6, 0), m); push('accent', this.box(9.1, 0.4, 18.1, 0, 3.9, 0), m); }
    // pit-wall gantry stands
    const pwLen = tr.wrapS(p.wallEnd - p.wallStart);
    for (let d = 40; d < pwLen - 30; d += 45) {
      const m = this.placeMatrix(p.wallStart + d, PIT.wallU + 1.4);
      push('dark', this.box(2.2, 1.8, 7, 0, 1.0, 0), m); push('white', this.box(2.6, 0.12, 7.4, 0, 3.0, 0), m);
      push('steel', this.box(0.1, 3.0, 0.1, -1.1, 1.5, 3.4), m); push('steel', this.box(0.1, 3.0, 0.1, -1.1, 1.5, -3.4), m);
    }
    // ---------------- grandstands
    const R = tr.wallR, mainLen = 150;
    for (let k = 0; k < 3; k++) {
      const s = -120 + k * 170;
      this._grandstand(buckets, s, -1, tr.sampleVal(R, s) + 6, mainLen, 14);
    }
    const c1 = tr.corners[0], cl = tr.corners[tr.corners.length - 1];
    for (const c of [c1, cl]) {
      const s = (c.start + c.end) / 2 * tr.ds, side = c.sign > 0 ? -1 : 1;
      const wall = side > 0 ? tr.sampleVal(tr.wallL, s) : tr.sampleVal(tr.wallR, s), verge = side > 0 ? tr.sampleVal(tr.vergeL, s) : tr.sampleVal(tr.vergeR, s);
      this._grandstand(buckets, s, side, wall + Math.min(verge, 8) + 5, 70, 10);
    }
    // ---------------- start light gantry
    const gS = 14, gm = this.placeMatrix(gS, 0);
    const uR = -tr.sampleVal(R, gS) - 0.6, uL = PIT.wallU + 0.6, span = uL - uR, uc = (uL + uR) / 2;
    push('steel', this.box(0.6, 7.6, 0.6, uR, 3.8, 0), gm); push('steel', this.box(0.6, 7.6, 0.6, uL, 3.8, 0), gm);
    push('steel', this.box(span, 0.35, 0.35, uc, 7.0, 0.35), gm); push('steel', this.box(span, 0.35, 0.35, uc, 7.0, -0.35), gm);
    push('steel', this.box(span, 0.35, 0.35, uc, 7.7, 0), gm);
    for (let x = uR; x < uL; x += 1.4) push('steel', strutGeo(new THREE.Vector3(x, 7.0, 0.35), new THREE.Vector3(x + 0.7, 7.7, 0), 0.05), gm);
    push('dark', this.box(4.6, 1.6, 0.5, 0, 6.2, 0), gm);
    for (let k = 0; k < 5; k++) {
      const mat = new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff1500, emissiveIntensity: 0, roughness: 0.3 });
      this.startLightMats.push(mat);
      const lg = new THREE.CircleGeometry(0.22, 16); lg.rotateY(Math.PI); // faces -Z (toward the grid)
      for (const y of [6.55, 5.95]) { const g2 = lg.clone(); g2.translate(-1.8 + k * 0.9, y, -0.26); g2.applyMatrix4(gm); const m = new THREE.Mesh(g2, mat); this.group.add(m); }
    }
    // ---------------- timing tower (live standings screen)
    const tS = 70, tU = -tr.sampleVal(R, tS) - 9, tm = this.placeMatrix(tS, tU);
    push('steel', this.box(1.6, 22, 1.6, 0, 11, 0), tm); push('dark', this.box(0.8, 11, 5.4, 0, 16, 0), tm);
    this.towerCanvas = Tex.canvas(256, 512); this.towerTex = Tex.finish(this.towerCanvas, true, false);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(5, 10.4), new THREE.MeshBasicMaterial({ map: this.towerTex, toneMapped: false }));
    screen.geometry.rotateY(Math.PI / 2); screen.geometry.translate(0.42, 16, 0); screen.geometry.applyMatrix4(tm);
        this.group.add(screen);
    this.exclusions.push({ ...this._xz(tS, tU), r: 15 });
    // ---------------- marshal posts, corner boards, braking boards
    const cornerBoards = [];
    for (const c of tr.corners) {
      const s = c.start * tr.ds, side = c.sign > 0 ? -1 : 1;
      const wall = side > 0 ? tr.sampleVal(tr.wallL, s) : tr.sampleVal(tr.wallR, s);
      const mp = this.placeMatrix(s - 30, side * (wall + 3.2));
      push('orange', this.box(2.2, 2.4, 2.2, 0, 1.2, 0), mp); push('white', this.box(2.6, 0.2, 2.6, 0, 2.5, 0), mp); push('steel', this.box(0.06, 3.5, 0.06, 1.0, 3.6, 1.0), mp);
      cornerBoards.push({ s: s - 10, u: side * (wall + 1.6), label: String(c.num) });
      if (c.radius < 140) for (const d of [100, 200, 300]) cornerBoards.push({ s: s - d, u: side * ((side > 0 ? tr.sampleVal(tr.wallL, s - d) : tr.sampleVal(tr.wallR, s - d)) + 1.4), label: String(d / 100), brake: true });
    }
    const labels = []; // every sign shares one texture atlas -> one draw call
    for (const b of cornerBoards) {
      const m = this.placeMatrix(b.s, b.u);
      push('steel', this.box(0.08, 2.2, 0.08, 0, 1.1, 0), m);
      const plane = new THREE.PlaneGeometry(1.1, 1.1); plane.rotateY(Math.PI); plane.translate(0, 2.4, 0); plane.applyMatrix4(m);
      labels.push({ geo: plane, text: b.label, w: 256, h: 256, opts: b.brake ? { bg: '#ffffff', fg: '#111', border: '#c8102e', size: 150 } : { bg: '#111111', fg: '#ffd23f', size: 160 } });
    }
    // ---------------- advertising boards along barriers
    const ads = [];
    const adBoard = (s0, side, row) => {
      const len = 12, steps = 4, pos = [], uv = [], idx = [];
      for (let r = 0; r <= steps; r++) {
        const s = s0 + len * r / steps; const wall = side > 0 ? tr.sampleVal(tr.wallL, s) : tr.sampleVal(tr.wallR, s);
        const f = tr.frameAt(s, side * (wall - 0.04));
        for (const [y, v] of [[0.12, 1 - (row + 1) / 8], [1.0, 1 - row / 8]]) { pos.push(f.pos.x, f.pos.y + y, f.pos.z); uv.push(side > 0 ? r / steps : 1 - r / steps, v + (v > 1 - (row + 1) / 8 + 0.001 ? -0.004 : 0.004)); }
      }
      for (let r = 0; r < steps; r++) { const a = r * 2, b = a + 2; if (side > 0) idx.push(a, b, a + 1, b, b + 1, a + 1); else idx.push(a, a + 1, b, b, a + 1, b + 1); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals(); ads.push(g);
    };
    let row = 0;
    for (let s = -300; s < 520; s += 12.5) { if (!tr.barrierR[tr.idxAt(s)]) continue; adBoard(s, -1, (row++) % 8); }
    for (const c of tr.corners) {
      const side = c.sign > 0 ? -1 : 1; const sa = c.apex * tr.ds;
      for (let s = sa - 50; s < sa + 50; s += 12.5) { const i = tr.idxAt(s); if (!(side > 0 ? tr.barrierL[i] : tr.barrierR[i])) continue; adBoard(s, side, (row++) % 8); }
    }
    if (ads.length) { const m = new THREE.Mesh(mergeList(ads), M.ads); m.receiveShadow = true; this.group.add(m); }
    // ---------------- light towers
    const lt = [];
    for (let s = 40; s < tr.length; s += 160) {
      const i = tr.idxAt(s); const side = tr.kappaS[i] > 0 ? 1 : -1; // inside of the curve
      const wall = side > 0 ? tr.wallL[i] : tr.wallR[i], verge = side > 0 ? tr.vergeL[i] : tr.vergeR[i];
      if (verge < 4) continue;
      const f = tr.frameAt(s, side * (wall + 3));
      lt.push(new THREE.Matrix4().compose(new THREE.Vector3(f.pos.x, f.pos.y, f.pos.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), f.heading + (side > 0 ? Math.PI : 0)), new THREE.Vector3(1, 1, 1)));
    }
    const towerGeo = mergeList([new THREE.CylinderGeometry(0.16, 0.26, 16, 8).translate(0, 8, 0), this.box(3.2, 1.0, 0.5, 0, 16.2, 0.3), this.box(0.4, 0.4, 0.4, 0, 15.6, 0)]);
    const lti = new THREE.InstancedMesh(towerGeo, M.steel, lt.length); lt.forEach((m, k) => lti.setMatrixAt(k, m)); lti.computeBoundingSphere(); lti.castShadow = true; this.group.add(lti);
    const lampGeo = this.box(3.0, 0.8, 0.05, 0, 16.2, -0.0); lampGeo.translate(0, 0, 0.58);
    const lampMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2d8, emissiveIntensity: 0.35, roughness: 0.3 });
    const lmi = new THREE.InstancedMesh(lampGeo, lampMat, lt.length); lt.forEach((m, k) => lmi.setMatrixAt(k, m)); lmi.computeBoundingSphere(); this.group.add(lmi);
    // ---------------- sector boards
    tr.sectorS.forEach((s, k) => {
      const wall = tr.sampleVal(tr.wallR, s), m = this.placeMatrix(s, -(wall + 1.2));
      push('steel', this.box(0.1, 2.6, 0.1, 0, 1.3, 0), m);
      const pl = new THREE.PlaneGeometry(1.6, 0.8); pl.rotateY(Math.PI); pl.translate(0, 2.9, 0); pl.applyMatrix4(m);
      labels.push({ geo: pl, text: k === 0 ? 'S/F' : 'S' + (k + 1), w: 256, h: 128, opts: { bg: '#ffd23f', fg: '#111', size: 90 } });
    });
    tr.drsZones.forEach(z => {
      const s = z.start, wall = tr.sampleVal(tr.wallR, s), m = this.placeMatrix(s, -(wall + 1.2));
      push('steel', this.box(0.1, 2.6, 0.1, 0, 1.3, 0), m);
      const pl = new THREE.PlaneGeometry(1.6, 0.8); pl.rotateY(Math.PI); pl.translate(0, 2.9, 0); pl.applyMatrix4(m);
      labels.push({ geo: pl, text: 'DRS', w: 256, h: 128, opts: { bg: '#ffffff', fg: '#0a8f3c', size: 90 } });
    });
    this._labelAtlas(labels);
    // ---------------- merge buckets
    const mats = { white: M.building, dark: M.dark, glass: M.glass, door: M.door, steel: M.steel, accent: M.accent, red: M.redPaint, orange: M.orange, concrete: M.wall, seat: M.seat };
    for (const [k, list] of Object.entries(buckets)) {
      if (!list.length) continue;
      const geo = mergeList(list, k === 'seat');
      const m = new THREE.Mesh(geo, mats[k]); m.castShadow = k !== 'glass'; m.receiveShadow = true; this.group.add(m);
    }
    if (this.crowd) this.group.add(this.crowd);
    this.mergedDraws = mergeStaticByMaterial(this.group);
    return this.group;
  }
  _labelAtlas(labels) {
    const S = 256, cols = 8, rows = Math.ceil(labels.length / cols), W = S * cols, H = Math.pow(2, Math.ceil(Math.log2(S * rows))); // power-of-two for WebGL1 mipmaps
    const c = Tex.canvas(W, H), ctx = c.getContext('2d');
    labels.forEach((L, i) => {
      const x = (i % cols) * S, y = Math.floor(i / cols) * S, o = L.opts;
      ctx.fillStyle = o.bg; ctx.fillRect(x, y, L.w, L.h);
      if (o.border) { ctx.strokeStyle = o.border; ctx.lineWidth = L.w * 0.06; ctx.strokeRect(x + L.w * .03, y + L.h * .03, L.w * .94, L.h * .94); }
      ctx.fillStyle = o.fg; ctx.font = `900 ${o.size}px Arial`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(L.text, x + L.w / 2, y + L.h / 2);
      const uv = L.geo.attributes.uv;
      for (let k = 0; k < uv.count; k++) {
        const u = uv.getX(k), v = uv.getY(k);
        uv.setXY(k, (x + u * (L.w - 2) + 1) / W, 1 - (y + (1 - v) * (L.h - 2) + 1) / H);
      }
    });
    const tex = Tex.finish(c, true, false);
    const m = new THREE.Mesh(mergeList(labels.map(L => L.geo)), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }));
    m.name = 'signs'; this.group.add(m);
  }
  _xz(s, u) { const f = this.track.frameAt(s, u); return { x: f.pos.x, z: f.pos.z }; }
  _grandstand(buckets, s, side, uFront, len, rows) {
    // local frame: +X toward the track's left; the stand rises away from the track
    const m = this.placeMatrix(s, side * uFront);
    const dir = side; // outward direction in local x
    const stepD = 0.85, stepH = 0.48;
    for (let r = 0; r < rows; r++) {
      const x = dir * (r * stepD + stepD / 2), h = 1.4 + r * stepH;
      const g = this.box(stepD, h, len, x, h / 2 - 1.2, 0); g.applyMatrix4(m); buckets.concrete.push(g);
      const seat = this.box(stepD * 0.5, 0.35, len - 0.6, x + dir * 0.1, h - 1.2 + 0.17, 0); seat.applyMatrix4(m);
      const c = [[0.05, 0.16, 0.45], [0.55, 0.05, 0.05], [0.05, 0.16, 0.45]][Math.floor(r / 5) % 3]; colorGeo(seat, c[0], c[1], c[2]); buckets.seat.push(seat);
    }
    const backX = dir * (rows * stepD + 0.3), topH = 1.4 + rows * stepH;
    const back = this.box(0.4, topH + 4.5, len, backX, (topH + 3.3) / 2 - 1.2, 0); back.applyMatrix4(m); buckets.white.push(back);
    const roof = this.box(rows * stepD + 3, 0.3, len + 2, dir * (rows * stepD / 2 - 0.5), topH + 3.3, 0); roof.applyMatrix4(m); buckets.white.push(roof);
    for (let z = -len / 2; z <= len / 2; z += 15) { const col = this.box(0.35, topH + 4.4, 0.35, backX - dir * 0.3, (topH + 3.2) / 2 - 1.2, z); col.applyMatrix4(m); buckets.steel.push(col); }
    for (let z = -len / 2 + 6; z <= len / 2 - 6; z += 20) { const col = this.box(0.25, 3.6, 0.25, dir * -0.6, 0.6, z); col.applyMatrix4(m); buckets.steel.push(col); }
    const fr = this.box(rows * stepD + 3, 0.6, len + 2, dir * (rows * stepD / 2 - 0.5), topH + 3.0, 0); fr.applyMatrix4(m); buckets.accent.push(fr);
    // crowd silhouettes
    const seats = [];
    const r = mulberry32(Math.floor(s * 7 + 99));
    for (let rr = 0; rr < rows; rr++) for (let z = -len / 2 + 0.6; z < len / 2 - 0.6; z += 0.62) if (r() < 0.82) seats.push([dir * (rr * stepD + stepD / 2 + 0.05), 1.4 + rr * stepH - 1.2 + 0.35, z + (r() - 0.5) * 0.12, 0.85 + r() * 0.3, r()]);
    this._addCrowd(seats, m);
    const f = this.track.frameAt(s, side * (uFront + rows * stepD / 2));
    this.exclusions.push({ x: f.pos.x, z: f.pos.z, r: len / 2 + 25 });
  }
  _addCrowd(list, m) {
    if (!this._crowdList) this._crowdList = [];
    for (const it of list) { const v = new THREE.Vector3(it[0], it[1], it[2]).applyMatrix4(m); this._crowdList.push([v.x, v.y, v.z, it[3], it[4]]); }
    // low-poly spectators (28 triangles each): thousands are visible at once
    const body = new THREE.CylinderGeometry(0.16, 0.21, 0.66, 5); body.translate(0, 0.42, 0);
    const head = new THREE.OctahedronGeometry(0.13, 0); head.translate(0, 0.9, 0); colorGeo(head, 0.75, 0.55, 0.42); colorGeo(body, 1, 1, 1);
    const geo = mergeList([body, head], true);
    if (this.crowd) { this.crowd.geometry.dispose(); }
    const im = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }), this._crowdList.length);
    const palette = [0xc8102e, 0xffffff, 0x1d4ed8, 0xffd23f, 0x111111, 0x22c55e, 0xf97316, 0x9ca3af, 0x0ea5e9];
    const col = new THREE.Color();
    this._crowdList.forEach((it, k) => { _m4.compose(_v1.set(it[0], it[1], it[2]), _q.setFromAxisAngle(_v2.set(0, 1, 0), it[4] * 0.6), _v3.set(1, it[3], 1)); im.setMatrixAt(k, _m4); im.setColorAt(k, col.setHex(palette[Math.floor(it[4] * palette.length)])); });
    im.computeBoundingSphere(); im.castShadow = false; im.receiveShadow = true;
    this.crowd = im;
  }
  updateTower(rows) {
    const c = this.towerCanvas, ctx = c.getContext('2d');
    ctx.fillStyle = '#0b0f17'; ctx.fillRect(0, 0, 256, 512);
    ctx.fillStyle = '#e10600'; ctx.fillRect(0, 0, 256, 44); ctx.fillStyle = '#fff'; ctx.font = '900 26px Arial'; ctx.fillText('LAC DES CIMES', 14, 31);
    ctx.font = '700 24px Arial';
    rows.slice(0, 10).forEach((r, i) => {
      const y = 82 + i * 42; ctx.fillStyle = i % 2 ? '#141a26' : '#0f141f'; ctx.fillRect(0, y - 28, 256, 40);
      ctx.fillStyle = '#9aa'; ctx.fillText(String(i + 1), 12, y); ctx.fillStyle = r.color; ctx.fillRect(44, y - 20, 6, 26);
      ctx.fillStyle = '#fff'; ctx.fillText(r.code, 60, y);
      ctx.fillStyle = '#ffd23f'; ctx.font = '600 20px Arial'; ctx.fillText(r.gap, 150, y); ctx.font = '700 24px Arial';
    });
    this.towerTex.needsUpdate = true;
  }
}
