
// =====================================================================
// ENVIRONMENT — terrain, lake, mountain ranges, sky, clouds, vegetation
// =====================================================================
const WATER_LEVEL = -4.0;
const LAKE = { x: 860, z: 120 };
const WORLD_C = { x: -380, z: -60 };
const srgb = (r, g, b) => [Math.pow(r, 2.2), Math.pow(g, 2.2), Math.pow(b, 2.2)];
const WIND = { uTime: { value: 0 } };

function lakeMask(x, z) {
  const dx = x - LAKE.x, dz = z - LAKE.z, a = Math.atan2(dz, dx);
  const R = 440 + 85 * Math.sin(3 * a + 1.1) + 55 * Math.sin(5 * a + 2.3) + 30 * Math.sin(9 * a + 0.4) + 40 * NOISE2.noise(Math.cos(a) * 2 + 9, Math.sin(a) * 2);
  const q = Math.hypot(dx, dz) / R;
  return smoothstep(1.18, 0.55, q);
}
function naturalHeight(x, z) {
  const base = 30 * smoothstep(-180, -1150, x);
  const hills = NOISE.fbm(x * 0.0018, z * 0.0018, 5) * 18 + NOISE.fbm(x * 0.0047 + 7.1, z * 0.0047 - 3.3, 3) * 4;
  const r = Math.hypot(x - WORLD_C.x, z - WORLD_C.z);
  const mnt = smoothstep(1000, 2600, r);
  let mountains = 0;
  if (mnt > 0) {
    const wx = x + NOISE.fbm(x * 0.0004, z * 0.0004, 3) * 500, wz = z + NOISE.fbm(x * 0.0004 + 5, z * 0.0004, 3) * 500;
    const ridge = NOISE2.ridged(wx * 0.00062, wz * 0.00062, 6);
    mountains = mnt * (ridge * 900 + NOISE.fbm(x * 0.0011, z * 0.0011, 4) * 170 + 70 * mnt);
  }
  let h = base + hills + mountains;
  const lm = lakeMask(x, z);
  if (lm > 0) { const floor = WATER_LEVEL - 1.5 - 30 * lm; h = lerp(h, floor, smoothstep(0, 0.38, lm)); }
  return h;
}

class Terrain {
  constructor(track, seg) {
    this.track = track; this.size = 5600; this.seg = seg;
    this.x0 = WORLD_C.x - this.size / 2; this.z0 = WORLD_C.z - this.size / 2; this.cellSize = this.size / seg;
  }
  async build(progress) {
    const n = this.seg + 1, tr = this.track, N = tr.N;
    const H = this.H = new Float32Array(n * n), D = this.D = new Float32Array(n * n).fill(9999);
    // per-sample cover widths (road + runoff + barrier + verge)
    const covL = new Float32Array(N), covR = new Float32Array(N);
    for (let i = 0; i < N; i++) { covL[i] = tr.wallL[i] + 0.6 + tr.vergeL[i]; covR[i] = tr.wallR[i] + 0.6 + tr.vergeR[i]; }
    for (let r = 0; r < n; r++) {
      const z = this.z0 + r * this.cellSize;
      for (let c = 0; c < n; c++) {
        const x = this.x0 + c * this.cellSize;
        const nat = naturalHeight(x, z);
        // gather nearby track samples
        const cx = Math.floor(x / tr.cell), cz = Math.floor(z / tr.cell);
        let sw = 0, sh = 0, eMin = 9999, any = false;
        for (let gx = -4; gx <= 4; gx++) for (let gz = -4; gz <= 4; gz++) {
          const arr = tr.gmap.get(tr._gkey(cx + gx, cz + gz)); if (!arr) continue;
          for (let q = 0; q < arr.length; q += 2) {
            const j = arr[q], P = tr.P[j], L = tr.L[j], T = tr.T[j];
            const dx = x - P.x, dz = z - P.z;
            const lh = Math.hypot(L.x, L.z);
            const u = (dx * L.x + dz * L.z) / (lh * lh), along = dx * T.x + dz * T.z;
            const cov = u >= 0 ? covL[j] : covR[j];
            const e = Math.hypot(Math.max(Math.abs(along) - 2.2, 0), Math.max(Math.abs(u) - cov, 0));
            if (e > 170) continue;
            any = true;
            const hj = P.y + L.y * clamp(u, -covR[j], covL[j]);
            const w = 1 / Math.pow(e + 1, 3);
            sw += w; sh += w * hj; if (e < eMin) eMin = e;
          }
        }
        let h = nat;
        if (any) {
          const ht = sh / sw;
          if (eMin <= 0.01) h = ht - 1.1;
          else h = lerp(ht - 0.6, nat, smoothstep(10, 150, eMin));
          D[r * n + c] = eMin;
        }
        H[r * n + c] = h;
      }
      if (r % 24 === 0) { progress && progress(r / n); await nextFrame(); }
    }
  }
  height(x, z) {
    const n = this.seg + 1; const fx = clamp((x - this.x0) / this.cellSize, 0, this.seg - 1e-4), fz = clamp((z - this.z0) / this.cellSize, 0, this.seg - 1e-4);
    const c = Math.floor(fx), r = Math.floor(fz), tx = fx - c, tz = fz - r;
    const a = this.H[r * n + c], b = this.H[r * n + c + 1], d = this.H[(r + 1) * n + c], e = this.H[(r + 1) * n + c + 1];
    return lerp(lerp(a, b, tx), lerp(d, e, tx), tz);
  }
  trackDist(x, z) {
    const n = this.seg + 1; const fx = (x - this.x0) / this.cellSize, fz = (z - this.z0) / this.cellSize;
    if (fx < 0 || fz < 0 || fx >= this.seg || fz >= this.seg) return 9999;
    const c = Math.floor(fx), r = Math.floor(fz);
    return Math.min(this.D[r * n + c], this.D[r * n + c + 1], this.D[(r + 1) * n + c], this.D[(r + 1) * n + c + 1]);
  }
  normalY(x, z) {
    const e = 6; const hx = this.height(x + e, z) - this.height(x - e, z), hz = this.height(x, z + e) - this.height(x, z - e);
    return 2 * e / Math.hypot(hx, 2 * e, hz);
  }
  forest(x, z) { return NOISE2.fbm(x * 0.0021 + 3.7, z * 0.0021 - 1.2, 4); }
  mesh(mat) {
    const n = this.seg + 1;
    const g = new THREE.PlaneGeometry(this.size, this.size, this.seg, this.seg);
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position, uv = g.attributes.uv;
    const col = new Float32Array(pos.count * 3);
    // PlaneGeometry rows go from +z (top) to -z after rotation: vertex (ix, iy) -> x = -size/2 + ix*cs, z = -size/2 + iy*cs
    for (let k = 0; k < pos.count; k++) {
      const ix = k % n, iy = Math.floor(k / n);
      const x = this.x0 + ix * this.cellSize, z = this.z0 + iy * this.cellSize;
      pos.setXYZ(k, x, this.H[iy * n + ix], z);
      uv.setXY(k, x / 22, z / 22);
    }
    g.computeVertexNormals();
    const nor = g.attributes.normal;
    for (let k = 0; k < pos.count; k++) {
      const x = pos.getX(k), y = pos.getY(k), z = pos.getZ(k), ny = nor.getY(k);
      const slope = 1 - ny, nn = NOISE.fbm(x * 0.01, z * 0.01, 3), d = this.D[k];
      const forest = this.forest(x, z);
      let c = srgb(0.30 + nn * 0.05, 0.42 + nn * 0.06, 0.17);                                           // meadow grass
      const dark = srgb(0.17, 0.26, 0.11);
      let f = smoothstep(0.0, 0.25, forest) * smoothstep(40, 90, d); c = c.map((v, i) => lerp(v, dark[i], f)); // forest floor
      const soil = srgb(0.40, 0.32, 0.22); f = smoothstep(0.22, 0.42, slope + nn * 0.08); c = c.map((v, i) => lerp(v, soil[i], f * 0.8));
      const rock = srgb(0.47 + nn * 0.08, 0.45 + nn * 0.08, 0.43 + nn * 0.07); f = Math.max(smoothstep(0.38, 0.58, slope + nn * 0.1), smoothstep(700, 1000, y + nn * 120)); c = c.map((v, i) => lerp(v, rock[i], f));
      const snow = srgb(0.93, 0.95, 0.98); f = smoothstep(980, 1150, y + nn * 160) * smoothstep(0.75, 0.45, slope); c = c.map((v, i) => lerp(v, snow[i], f));
      const sand = srgb(0.62, 0.58, 0.5); f = smoothstep(WATER_LEVEL + 2.5, WATER_LEVEL + 0.3, y) * (1 - smoothstep(60, 90, y)); c = c.map((v, i) => lerp(v, sand[i], f));
      const mown = srgb(0.36, 0.50, 0.19); f = smoothstep(30, 6, d); c = c.map((v, i) => lerp(v, mown[i], f));
      col[k * 3] = c[0]; col[k * 3 + 1] = c[1]; col[k * 3 + 2] = c[2];
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const m = new THREE.Mesh(g, mat); m.receiveShadow = true; m.name = 'terrain';
    return m;
  }
}

function mountainRing(rIn, rOut, rs, as, heightFn, colorFn) {
  const pos = [], col = [], idx = [];
  for (let i = 0; i <= rs; i++) {
    const r = lerp(rIn, rOut, Math.pow(i / rs, 1.3));
    for (let j = 0; j <= as; j++) {
      const a = j / as * TAU; const x = WORLD_C.x + Math.cos(a) * r, z = WORLD_C.z + Math.sin(a) * r;
      const h = heightFn(x, z, r, i / rs); pos.push(x, h, z); const c = colorFn(x, h, z, r); col.push(c[0], c[1], c[2]);
    }
  }
  for (let i = 0; i < rs; i++) for (let j = 0; j < as; j++) { const a = i * (as + 1) + j, b = a + as + 1; idx.push(a, a + 1, b, a + 1, b + 1, b); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}
function buildMountains(mat) {
  const group = new THREE.Group();
  // mid-distance ranges: several ridges, forests low, rock and snow high
  const mid = mountainRing(2650, 8200, 46, 300, (x, z, r, f) => {
    const ridge = NOISE2.ridged(x * 0.00035 + 11, z * 0.00035, 6), base = NOISE.fbm(x * 0.0002, z * 0.0002, 3);
    return 260 + ridge * 1500 * (0.55 + 0.45 * smoothstep(0, 0.4, f)) + base * 300 - 400 * smoothstep(0.85, 1, f);
  }, (x, h, z) => {
    const n = NOISE.fbm(x * 0.003, z * 0.003, 2);
    let c = srgb(0.18, 0.27, 0.13); const rock = srgb(0.45, 0.44, 0.44), snow = srgb(0.92, 0.94, 0.98);
    c = c.map((v, i) => lerp(v, rock[i], smoothstep(650, 1000, h + n * 200)));
    c = c.map((v, i) => lerp(v, snow[i], smoothstep(1250, 1450, h + n * 250)));
    return c;
  });
  const mm = new THREE.Mesh(mid, mat); mm.name = 'mountains-mid'; group.add(mm);
  // distant giants: simple silhouettes, colour pushed toward haze
  const far = mountainRing(7600, 17000, 28, 360, (x, z, r, f) => {
    const ridge = NOISE.ridged(x * 0.00022 + 3, z * 0.00022 - 7, 6);
    const base = NOISE2.fbm(x * 0.00008, z * 0.00008, 3);
    return 400 + ridge * 2300 * (0.55 + 0.45 * smoothstep(0.0, 0.35, f)) * (1 - 0.5 * f) + base * 400 - 700 * smoothstep(0.75, 1, f);
  }, (x, h, z) => {
    const n = NOISE.fbm(x * 0.002, z * 0.002, 2);
    const snow = smoothstep(1700, 2100, h + n * 300);
    const rock = srgb(0.30, 0.34, 0.40), forest = srgb(0.16, 0.24, 0.20), sn = srgb(0.90, 0.93, 0.98);
    let c = forest.map((v, i) => lerp(v, rock[i], smoothstep(700, 1300, h + n * 200)));
    return c.map((v, i) => lerp(v, sn[i], snow));
  });
  const fm = new THREE.Mesh(far, mat); fm.name = 'mountains-far'; group.add(fm);
  return group;
}

// -------------------------------------------------------------------- water
function buildLake(terrain) {
  const size = 1400, seg = 160;
  const g = new THREE.PlaneGeometry(size, size, seg, seg); g.rotateX(-Math.PI / 2); g.translate(LAKE.x, WATER_LEVEL, LAKE.z);
  const pos = g.attributes.position, depth = new Float32Array(pos.count);
  for (let k = 0; k < pos.count; k++) depth[k] = WATER_LEVEL - terrain.height(pos.getX(k), pos.getZ(k));
  g.setAttribute('depth', new THREE.BufferAttribute(depth, 1));
  const mat = new THREE.ShaderMaterial({
    fog: true, transparent: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uTime: { value: 0 }, uSun: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color(1, 0.95, 0.85) },
      uZenith: { value: new THREE.Color(0x2c63a8) }, uHorizon: { value: new THREE.Color(0xb9d2e8) },
      uShallow: { value: new THREE.Color(0x2f7f7a) }, uDeep: { value: new THREE.Color(0x0b2a3a) }
    }]),
    vertexShader: `
      attribute float depth; uniform float uTime; varying vec3 vW; varying float vDepth;
      #include <fog_pars_vertex>
      void main(){
        vec3 p = position;
        float a = smoothstep(0.0, 3.0, depth);
        p.y += a * (0.06*sin(p.x*0.045 + uTime*0.9) + 0.05*sin(p.z*0.06 - uTime*1.1) + 0.03*sin((p.x+p.z)*0.11 + uTime*1.7));
        vec4 wp = modelMatrix * vec4(p,1.0); vW = wp.xyz; vDepth = depth;
        vec4 mvPosition = viewMatrix * wp; gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      uniform float uTime; uniform vec3 uSun, uSunCol, uZenith, uHorizon, uShallow, uDeep; varying vec3 vW; varying float vDepth;
      #include <common>
      #include <fog_pars_fragment>
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
      float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
        return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
      vec2 waveGrad(vec2 p){
        vec2 g = vec2(0.0);
        float t = uTime;
        g += vec2(0.045,0.0)*cos(p.x*0.045+t*0.9)*0.06;
        g += vec2(0.0,0.06)*cos(p.y*0.06-t*1.1)*0.05;
        g += vec2(0.11,0.11)*cos((p.x+p.y)*0.11+t*1.7)*0.03;
        // small ripples: finite-difference of animated value noise
        vec2 q = p*0.35 + vec2(t*0.25, -t*0.18); float e = 0.15;
        float n0 = vnoise(q), nx = vnoise(q+vec2(e,0.0)), ny = vnoise(q+vec2(0.0,e));
        g += vec2(nx-n0, ny-n0)/e * 0.035;
        vec2 q2 = p*1.3 + vec2(-t*0.6, t*0.45);
        float m0 = vnoise(q2), mx = vnoise(q2+vec2(e,0.0)), my = vnoise(q2+vec2(0.0,e));
        g += vec2(mx-m0, my-m0)/e * 0.012;
        return g;
      }
      vec3 skyCol(vec3 d){
        float el = d.y;
        // mountain silhouettes reflected near the horizon
        float az = atan(d.z, d.x);
        float ridge = 0.035 + 0.05*abs(sin(az*3.0+1.0)) + 0.03*abs(sin(az*7.0+0.3)) + 0.015*sin(az*23.0);
        vec3 sky = mix(uHorizon, uZenith, pow(clamp(el,0.0,1.0),0.55));
        vec3 mtn = mix(vec3(0.07,0.10,0.08), vec3(0.32,0.36,0.42), smoothstep(0.0, ridge, el));
        return el < ridge ? mtn : sky;
      }
      void main(){
        vec3 V = normalize(cameraPosition - vW);
        float dist = length(cameraPosition - vW);
        vec2 g = waveGrad(vW.xz) * mix(1.0, 0.3, smoothstep(80.0, 900.0, dist));
        vec3 N = normalize(vec3(-g.x, 1.0, -g.y));
        float cosT = clamp(dot(N, V), 0.0, 1.0);
        float F = 0.02 + 0.98 * pow(1.0 - cosT, 5.0);
        vec3 R = reflect(-V, N); R.y = abs(R.y);
        vec3 refl = skyCol(R);
        float dd = smoothstep(0.0, 14.0, vDepth);
        vec3 body = mix(uShallow, uDeep, dd) * (0.55 + 0.45*max(uSun.y,0.0));
        vec3 col = mix(body, refl, F);
        float spec = pow(max(dot(R, normalize(uSun)), 0.0), 700.0) * 6.0 + pow(max(dot(R, normalize(uSun)), 0.0), 60.0) * 0.12;
        col += uSunCol * spec;
        float shore = smoothstep(0.0, 0.35, vDepth);
        float foam = (1.0 - smoothstep(0.0, 0.5, vDepth)) * (0.5 + 0.5*sin(uTime*1.5 + vW.x*0.3 + vW.z*0.2));
        col = mix(col, vec3(0.85,0.9,0.92), foam * 0.25);
        gl_FragColor = vec4(col, mix(0.0, 0.94, shore) + F*0.06);
        if (vDepth < -0.3) discard;
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`
  });
  const m = new THREE.Mesh(g, mat); m.name = 'lake'; m.renderOrder = 2;
  return m;
}

// -------------------------------------------------------------------- clouds
function cloudTexture() {
  const S = 512, c = Tex.canvas(S, S), ctx = c.getContext('2d'), img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const v = clamp(0.5 + 0.62 * NOISE2.fbm(x / S * 8, y / S * 8, 5, 2, 0.5, 8), 0, 1) * 255, i = (y * S + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0); return Tex.finish(c, false, true);
}
function buildClouds() {
  const g = new THREE.PlaneGeometry(36000, 36000, 1, 1); g.rotateX(-Math.PI / 2); g.translate(WORLD_C.x, 4600, WORLD_C.z);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 }, uSun: { value: new THREE.Vector3(0, 1, 0) }, uMap: { value: cloudTexture() } },
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.0); vW=w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
    // noise is baked into a tileable texture once; two scrolling taps per pixel instead of 40 hashes
    fragmentShader: `uniform float uTime; uniform vec3 uSun; uniform sampler2D uMap; varying vec3 vW;
      void main(){
        vec2 p = (vW.xz*0.00028 + vec2(uTime*0.004, uTime*0.0015)) / 8.0;
        float c = smoothstep(0.50, 0.76, texture2D(uMap, p).r * 0.85 + texture2D(uMap, p * 3.1 + 0.37).r * 0.25);
        float d = length(vW.xz - cameraPosition.xz);
        float elev = normalize(vW - cameraPosition).y;
        float fade = (1.0 - smoothstep(12000.0, 17500.0, d)) * smoothstep(0.12, 0.32, elev);
        vec3 col = mix(vec3(0.72,0.76,0.82), vec3(1.0), smoothstep(0.3,1.0,c)) * (0.75 + 0.25*uSun.y);
        gl_FragColor = vec4(col, c * 0.78 * fade);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`
  });
  const m = new THREE.Mesh(g, mat); m.renderOrder = -1; m.frustumCulled = false; m.name = 'clouds'; return m;
}

// -------------------------------------------------------------------- vegetation
function windMaterial(params, strength) {
  const mat = new THREE.MeshStandardMaterial(params);
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uWindTime = WIND.uTime;
    sh.vertexShader = 'uniform float uWindTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING
        vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
      #else
        vec3 ip = vec3(0.0);
      #endif
      float hgt = max(position.y, 0.0);
      float sway = (sin(uWindTime*1.3 + ip.x*0.071 + ip.z*0.053) + 0.45*sin(uWindTime*2.9 + ip.z*0.13)) * ${strength.toFixed(4)} * hgt * hgt;
      transformed.x += sway; transformed.z += sway * 0.55;`);
  };
  mat.customProgramCacheKey = () => 'wind' + strength;
  return mat;
}
const VegGeo = {
  jitter(g, amt, seed) {
    const r = mulberry32(seed), p = g.attributes.position;
    const m = new Map();
    for (let i = 0; i < p.count; i++) {
      const k = p.getX(i).toFixed(3) + ',' + p.getY(i).toFixed(3) + ',' + p.getZ(i).toFixed(3);
      if (!m.has(k)) m.set(k, [(r() - .5) * amt, (r() - .5) * amt * 0.5, (r() - .5) * amt]);
      const d = m.get(k); p.setXYZ(i, p.getX(i) + d[0], p.getY(i) + d[1], p.getZ(i) + d[2]);
    }
    g.computeVertexNormals(); return g;
  },
  pine(hi) {
    const parts = [];
    const trunk = new THREE.CylinderGeometry(0.12, 0.28, hi ? 4 : 3, hi ? 7 : 4); trunk.translate(0, hi ? 2 : 1.5, 0); colorGeo(trunk, ...srgb(0.30, 0.2, 0.13)); parts.push(trunk);
    if (hi) {
      const layers = [[2.6, 3.4, 2.0], [2.15, 3.2, 4.0], [1.7, 3.0, 5.9], [1.2, 2.7, 7.6], [0.7, 2.3, 9.0]];
      layers.forEach((l, i) => {
        const c = new THREE.ConeGeometry(l[0], l[1], 9, 1, true); c.translate(0, l[2] + l[1] / 2, 0); c.rotateY(i * 0.7);
        VegGeo.jitter(c, 0.35, 10 + i);
        const s = 0.75 + i * 0.05; colorGeo(c, ...srgb(0.12 * s, 0.25 * s, 0.13 * s)); parts.push(c);
      });
    } else {
      const c = new THREE.ConeGeometry(2.4, 9.5, 6, 1); c.translate(0, 1.8 + 4.75, 0); colorGeo(c, ...srgb(0.11, 0.22, 0.12)); parts.push(c);
    }
    return mergeList(parts, true);
  },
  broadleaf(hi) {
    const parts = [];
    const trunk = new THREE.CylinderGeometry(0.18, 0.32, 4, hi ? 7 : 4); trunk.translate(0, 2, 0); colorGeo(trunk, ...srgb(0.33, 0.24, 0.16)); parts.push(trunk);
    const blobs = hi ? [[0, 5.2, 0, 2.6], [1.3, 4.6, 0.6, 1.8], [-1.1, 4.8, -0.7, 2.0], [0.2, 6.6, -0.3, 1.7]] : [[0, 5.3, 0, 3.0]];
    blobs.forEach((b, i) => { const s = new THREE.IcosahedronGeometry(b[3], hi ? 1 : 0); VegGeo.jitter(s, b[3] * 0.35, 30 + i); s.translate(b[0], b[1], b[2]); colorGeo(s, ...srgb(0.24 + i * 0.02, 0.38 + i * 0.02, 0.15)); parts.push(s); });
    return mergeList(parts, true);
  },
  bush() { const s = new THREE.IcosahedronGeometry(1, 1); VegGeo.jitter(s, 0.45, 77); s.scale(1.2, 0.75, 1.1); s.translate(0, 0.45, 0); colorGeo(s, ...srgb(0.22, 0.34, 0.14)); return mergeList([s], true); },
  rock() { const s = new THREE.IcosahedronGeometry(1, 1); VegGeo.jitter(s, 0.7, 99); s.scale(1.3, 0.8, 1.0); s.translate(0, 0.25, 0); colorGeo(s, ...srgb(0.40, 0.39, 0.37)); return mergeList([s], true); },
  grass() {
    const parts = []; const r = mulberry32(5);
    for (let i = 0; i < 7; i++) { const b = new THREE.PlaneGeometry(0.08, 0.5 + r() * 0.35, 1, 2); b.translate(0, 0.3, 0); b.rotateZ((r() - .5) * 0.5); b.rotateY(r() * Math.PI); b.translate((r() - .5) * 0.35, 0, (r() - .5) * 0.35); colorGeo(b, ...srgb(0.32, 0.47, 0.18)); parts.push(b); }
    return mergeList(parts, true);
  }
};
class Vegetation {
  constructor(terrain, track, exclusions, density) {
    this.group = new THREE.Group(); this.group.name = 'vegetation';
    this.chunks = []; this.terrain = terrain; this.track = track; this.ex = exclusions;
    this.lodDist = 650; this.grassDist = 260; this.density = density;
  }
  excluded(x, z) { for (const e of this.ex) { if (Math.hypot(x - e.x, z - e.z) < e.r) return true; } return false; }
  build() {
    const T = this.terrain, r = mulberry32(2024), size = 1000;
    const types = {
      pine: { hi: VegGeo.pine(true), lo: VegGeo.pine(false), mat: windMaterial({ vertexColors: true, roughness: 0.9 }, 0.0009), list: [] },
      broad: { hi: VegGeo.broadleaf(true), lo: VegGeo.broadleaf(false), mat: windMaterial({ vertexColors: true, roughness: 0.85 }, 0.0012), list: [] },
      bush: { hi: VegGeo.bush(), lo: VegGeo.bush(), mat: windMaterial({ vertexColors: true, roughness: 0.9 }, 0.02), list: [] },
      rock: { hi: VegGeo.rock(), lo: VegGeo.rock(), mat: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true }), list: [] }
    };
    const tryPlace = (x, z) => {
      const h = T.height(x, z); if (h < WATER_LEVEL + 0.8) return null;
      const d = T.trackDist(x, z); const ny = T.normalY(x, z);
      return { h, d, ny };
    };
    const attempts = 150000;
    for (let k = 0; k < attempts; k++) {
      const x = T.x0 + 40 + r() * (T.size - 80), z = T.z0 + 40 + r() * (T.size - 80);
      const f = T.forest(x, z); const rr = r();
      const s = tryPlace(x, z); if (!s) continue;
      if (s.d < 22 || this.excluded(x, z)) continue;
      if (s.h > 1000 + NOISE.noise(x * 0.01, z * 0.01) * 120) continue;
      if (s.ny > 0.78 && f > -0.05 + rr * 0.25 && s.h < 820) {
        const isBroad = s.h < 60 && NOISE.noise(x * 0.004, z * 0.004) > 0.15 && r() < 0.6;
        (isBroad ? types.broad : types.pine).list.push([x, s.h - 0.2, z, 0.75 + r() * 0.65, r() * TAU]);
      } else if (s.ny > 0.7 && r() < 0.06 && s.d > 26) types.broad.list.push([x, s.h - 0.2, z, 0.8 + r() * 0.6, r() * TAU]);
      if (r() < 0.12 && s.ny > 0.75 && s.h < 900) types.bush.list.push([x, s.h - 0.1, z, 0.6 + r() * 1.2, r() * TAU]);
      if (r() < (s.ny < 0.8 ? 0.12 : 0.025)) types.rock.list.push([x, s.h - 0.5, z, 1.2 + r() * (s.ny < 0.8 ? 5.5 : 1.6), r() * TAU]);
    }
    // rocks and bushes along the lake shore
    for (let k = 0; k < 900; k++) {
      const a = r() * TAU, R = 300 + r() * 350; const x = LAKE.x + Math.cos(a) * R, z = LAKE.z + Math.sin(a) * R; const h = T.height(x, z);
      if (h > WATER_LEVEL - 0.6 && h < WATER_LEVEL + 2.5 && T.trackDist(x, z) > 20 && !this.excluded(x, z)) (r() < 0.6 ? types.rock : types.bush).list.push([x, h - 0.25, z, 0.5 + r() * 1.6, r() * TAU]);
    }
    // shuffle so a density prefix is a uniform random subset
    for (const t of Object.values(types)) for (let i = t.list.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [t.list[i], t.list[j]] = [t.list[j], t.list[i]]; }
    this.counts = {};
    const nc = Math.ceil(T.size / size);
    for (const [name, t] of Object.entries(types)) {
      this.counts[name] = t.list.length;
      const buckets = new Map();
      for (const it of t.list) { const cx = Math.floor((it[0] - T.x0) / size), cz = Math.floor((it[2] - T.z0) / size); const key = cx * nc + cz; if (!buckets.has(key)) buckets.set(key, []); buckets.get(key).push(it); }
      for (const [key, items] of buckets) {
        const center = new THREE.Vector3(); items.forEach(it => center.add(_v1.set(it[0], it[1], it[2]))); center.multiplyScalar(1 / items.length);
        const mk = (geo) => {
          const im = new THREE.InstancedMesh(geo, t.mat, items.length);
          const col = new THREE.Color();
          items.forEach((it, i) => {
            const sy = it[3] * (name === 'rock' ? 0.7 + 0.3 * Math.sin(i) : 1);
            _m4.compose(_v1.set(it[0], it[1], it[2]), _q.setFromAxisAngle(_v2.set(0, 1, 0), it[4]), _v3.set(it[3], sy, it[3])); im.setMatrixAt(i, _m4);
            const tint = 0.8 + 0.4 * ((i * 0.618) % 1); im.setColorAt(i, col.setRGB(tint, tint * (0.95 + 0.1 * ((i * 0.37) % 1)), tint));
          });
          im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); im.receiveShadow = true; return im;
        };
        const hi = mk(t.hi), lo = t.hi === t.lo ? null : mk(t.lo);
        hi.castShadow = name !== 'rock'; hi.userData.treeShadow = hi.castShadow;
        this.group.add(hi); if (lo) this.group.add(lo);
        this.chunks.push({ center, hi, lo, n: items.length, name });
      }
    }
    // grass tufts: dense near the circuit verges, LOD-culled by distance
    const grassMat = windMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }, 0.25);
    const gg = VegGeo.grass(); const gl = [];
    for (let k = 0; k < 70000 && gl.length < 26000; k++) {
      const i = Math.floor(r() * this.track.N), side = r() < 0.5 ? 1 : -1;
      const wall = side > 0 ? this.track.wallL[i] : this.track.wallR[i], verge = side > 0 ? this.track.vergeL[i] : this.track.vergeR[i];
      const ty = side > 0 ? this.track.typeL[i] : this.track.typeR[i];
      let u;
      if (r() < 0.55 && ty === SURF.GRASS) u = lerp(this.track.halfW[i] + 3, wall - 1.5, r()); else u = wall + 1 + r() * (verge + 14);
      const f = this.track.frameAt(i * this.track.ds + r() * 2, side * u);
      const x = f.pos.x, z = f.pos.z; if (this.excluded(x, z)) continue;
      let y; if (u < wall) y = f.pos.y; else { y = T.height(x, z); const gy = f.pos.y; if (u < wall + verge + 0.6) y = Math.max(y, gy - 0.4 * (u - wall) / Math.max(verge, 1)); }
      gl.push([x, y - 0.05, z, 0.4 + r() * 0.4, r() * TAU]);
    }
    const gsize = 250, gb = new Map();
    for (const it of gl) { const key = Math.floor(it[0] / gsize) * 10000 + Math.floor(it[2] / gsize); if (!gb.has(key)) gb.set(key, []); gb.get(key).push(it); }
    for (const items of gb.values()) {
      const im = new THREE.InstancedMesh(gg, grassMat, items.length); const center = new THREE.Vector3();
      items.forEach((it, i) => { _m4.compose(_v1.set(it[0], it[1], it[2]), _q.setFromAxisAngle(_v2.set(0, 1, 0), it[4]), _v3.set(it[3], it[3], it[3])); im.setMatrixAt(i, _m4); center.add(_v1); });
      center.multiplyScalar(1 / items.length); im.computeBoundingSphere(); im.receiveShadow = true;
      this.group.add(im); this.chunks.push({ center, hi: im, lo: null, n: items.length, name: 'grass' });
    }
  }
  setShadows(on) { for (const c of this.chunks) if (c.hi.userData.treeShadow) c.hi.castShadow = on; }
  update(camPos) {
    for (const c of this.chunks) {
      const d = Math.hypot(camPos.x - c.center.x, camPos.z - c.center.z);
      const cnt = Math.max(1, Math.floor(c.n * this.density));
      if (c.name === 'grass') { c.hi.visible = d < this.grassDist + 180 && this.density > 0.3; continue; }
      const near = d < this.lodDist + 500 || !c.lo;
      c.hi.visible = near; c.hi.count = cnt;
      if (c.lo) { c.lo.visible = !near && d < 9000; c.lo.count = cnt; }
    }
  }
}
