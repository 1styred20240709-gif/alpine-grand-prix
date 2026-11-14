import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/* =====================================================================
   ALPINE GRAND PRIX
   Conventions: Y up, X lateral, Z forward. 1 unit = 1 metre. SI units.
   A vehicle's local frame: +Z forward, +Y up, +X = left side of the car.
   ===================================================================== */

// ---------------------------------------------------------------- utils
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const TAU = Math.PI * 2;
const fin = (v) => Number.isFinite(v);
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const nextFrame = () => new Promise(r => setTimeout(r, 0));
function fmtTime(t, plus) {
  if (t == null || !fin(t)) return '-';
  const neg = t < 0; t = Math.abs(t);
  const m = Math.floor(t / 60), s = t - m * 60;
  const str = (m > 0 ? m + ':' + (s < 10 ? '0' : '') : '') + s.toFixed(3);
  return (neg ? '-' : (plus ? '+' : '')) + str;
}

// ---------------------------------------------------------------- noise
// Seeded gradient noise (2D) with optional lattice period (for seamless tiles).
class Noise2D {
  constructor(seed = 1) {
    const r = mulberry32(seed);
    this.p = new Uint16Array(512);
    const perm = Array.from({ length: 256 }, (_, i) => i);
    for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
    for (let i = 0; i < 512; i++) this.p[i] = perm[i & 255];
    this.gx = new Float32Array(256); this.gy = new Float32Array(256);
    for (let i = 0; i < 256; i++) { const a = r() * TAU; this.gx[i] = Math.cos(a); this.gy[i] = Math.sin(a); }
  }
  grad(ix, iy, x, y, period) {
    if (period) { ix = ((ix % period) + period) % period; iy = ((iy % period) + period) % period; }
    const h = this.p[(this.p[ix & 255] + iy) & 511] & 255;
    return this.gx[h] * x + this.gy[h] * y;
  }
  noise(x, y, period = 0) {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10), v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
    const a = this.grad(ix, iy, fx, fy, period), b = this.grad(ix + 1, iy, fx - 1, fy, period);
    const c = this.grad(ix, iy + 1, fx, fy - 1, period), d = this.grad(ix + 1, iy + 1, fx - 1, fy - 1, period);
    return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 1.41;
  }
  fbm(x, y, oct = 5, lac = 2, gain = 0.5, period = 0) {
    let s = 0, a = 1, f = 1, n = 0;
    for (let i = 0; i < oct; i++) { s += a * this.noise(x * f, y * f, period ? period * f : 0); n += a; a *= gain; f *= lac; }
    return s / n;
  }
  ridged(x, y, oct = 5) {
    let s = 0, a = 0.5, f = 1, w = 1;
    for (let i = 0; i < oct; i++) {
      let n = 1 - Math.abs(this.noise(x * f, y * f)); n *= n; n *= w; w = clamp(n * 1.6, 0, 1);
      s += n * a; f *= 2.03; a *= 0.5;
    }
    return s;
  }
}
const NOISE = new Noise2D(1337);
const NOISE2 = new Noise2D(4242);

// ---------------------------------------------------------------- texture factory
const Tex = {
  anisotropy: 4,
  detail: 1, // 0.5 on low-tier devices: generated textures are half size (4x less CPU at load)
  canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; },
  finish(canvas, srgb = true, repeat = true) {
    const t = new THREE.CanvasTexture(canvas);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = Tex.anisotropy;
    t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
    t.needsUpdate = true;
    return t;
  },
  // Build a normal map from a height field (Float32Array w*h, wraps)
  normalFromHeight(h, w, hh, strength = 2) {
    const c = Tex.canvas(w, hh); const ctx = c.getContext('2d'); const img = ctx.createImageData(w, hh); const d = img.data;
    for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) {
      const xl = h[y * w + ((x - 1 + w) % w)], xr = h[y * w + ((x + 1) % w)];
      const yu = h[((y - 1 + hh) % hh) * w + x], yd = h[((y + 1) % hh) * w + x];
      let nx = (xl - xr) * strength, ny = (yu - yd) * strength, nz = 1;
      const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
      const i = (y * w + x) * 4; d[i] = (nx * .5 + .5) * 255; d[i + 1] = (ny * .5 + .5) * 255; d[i + 2] = (nz * .5 + .5) * 255; d[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0); return Tex.finish(c, false);
  },
  // Generic tileable surface: returns {map, roughnessMap, normalMap}
  surface(opt) {
    const S = Math.max(128, Math.round((opt.size || 512) * (Tex.detail || 1))), n = new Noise2D(opt.seed || 7), r = mulberry32(opt.seed || 7);
    const col = Tex.canvas(S, S), rough = Tex.canvas(S, S);
    const cctx = col.getContext('2d'), rctx = rough.getContext('2d');
    const ci = cctx.createImageData(S, S), ri = rctx.createImageData(S, S);
    const H = new Float32Array(S * S);
    const P = opt.period || 8;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const u = x / S * P, v = y / S * P;
      const big = n.fbm(u * 0.5, v * 0.5, 4, 2, 0.5, P * 0.5);
      const mid = n.fbm(u * 4, v * 4, 3, 2, 0.5, P * 4);
      const grain = r();
      const res = opt.fn(x / S, y / S, big, mid, grain, r);
      const i = (y * S + x);
      ci.data[i * 4] = clamp(res.c[0], 0, 1) * 255; ci.data[i * 4 + 1] = clamp(res.c[1], 0, 1) * 255; ci.data[i * 4 + 2] = clamp(res.c[2], 0, 1) * 255; ci.data[i * 4 + 3] = 255;
      const rr = clamp(res.r, 0, 1) * 255; ri.data[i * 4] = rr; ri.data[i * 4 + 1] = rr; ri.data[i * 4 + 2] = rr; ri.data[i * 4 + 3] = 255;
      H[i] = res.h;
    }
    cctx.putImageData(ci, 0, 0); rctx.putImageData(ri, 0, 0);
    if (opt.post) opt.post(cctx, S);
    return { map: Tex.finish(col), roughnessMap: Tex.finish(rough, false), normalMap: Tex.normalFromHeight(H, S, S, opt.normalStrength || 3) };
  },
  asphalt(lines, seed = 11, tone = 0) {
    return Tex.surface({
      size: 1024, seed, period: 8, normalStrength: 4,
      fn: (u, v, big, mid, g) => {
        let b = 0.215 + tone + big * 0.035 + mid * 0.02;
        let h = g * 0.5 + mid * 0.3;
        if (g > 0.985) { b += 0.12; h += 0.6; } else if (g < 0.02) { b -= 0.07; h -= 0.3; }
        else b += (g - 0.5) * 0.045;
        let c = [b * 0.98, b, b * 1.04];
        let rr = 0.82 + (g - 0.5) * 0.12 - big * 0.08;
        if (lines) {
          const edgeA = u > 0.012 && u < 0.040, edgeB = u > 0.960 && u < 0.988;
          if (edgeA || edgeB) { const w = 0.86 + mid * 0.05 + (g - .5) * .05; c = [w, w, w * 0.98]; rr = 0.6; h = 0.2; }
        }
        return { c, r: rr, h };
      }
    });
  },
  grass(seed = 21) {
    return Tex.surface({
      size: 512, seed, period: 8, normalStrength: 2,
      fn: (u, v, big, mid, g) => {
        const blade = g * 0.18;
        const c = [0.20 + big * 0.05 + blade * 0.3, 0.36 + big * 0.07 + mid * 0.05 + blade, 0.12 + big * 0.03];
        return { c, r: 0.92, h: g * 0.6 + mid * 0.4 };
      },
      post: (ctx, S) => { // mowing stripes
        ctx.globalAlpha = 0.06; ctx.fillStyle = '#fff';
        for (let i = 0; i < 4; i++) ctx.fillRect(0, i * S / 4, S, S / 8);
        ctx.globalAlpha = 1;
      }
    });
  },
  gravel(seed = 31) {
    return Tex.surface({
      size: 512, seed, period: 8, normalStrength: 6,
      fn: (u, v, big, mid, g, r) => {
        const peb = Math.pow(Math.abs(mid), 0.5);
        const b = 0.56 + big * 0.06 + (g - 0.5) * 0.25;
        return { c: [b * 1.02, b * 0.95, b * 0.82], r: 0.95, h: peb + g * 0.5 };
      }
    });
  },
  concrete(seed = 41) {
    return Tex.surface({
      size: 512, seed, period: 4, normalStrength: 1.5,
      fn: (u, v, big, mid, g) => {
        let b = 0.62 + big * 0.06 + (g - .5) * 0.05;
        if ((u * 4) % 1 < 0.008 || (v * 4) % 1 < 0.008) b -= 0.18;
        return { c: [b, b * 0.99, b * 0.96], r: 0.85, h: g * 0.3 };
      }
    });
  },
  terrainDetail(seed = 51) {
    return Tex.surface({
      size: 512, seed, period: 8, normalStrength: 3.5,
      fn: (u, v, big, mid, g) => {
        const b = 0.80 + big * 0.12 + mid * 0.08 + (g - .5) * 0.12;
        return { c: [b, b, b], r: 0.95, h: mid * 0.7 + g * 0.3 + big };
      }
    });
  },
  carbon() {
    const S = 256, c = Tex.canvas(S, S), ctx = c.getContext('2d'), img = ctx.createImageData(S, S); const H = new Float32Array(S * S);
    const cell = 16;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
      const fx = (x % cell) / cell, fy = (y % cell) / cell;
      const twill = ((cx + cy) & 1) === 0; // 2x2 twill approximation
      const t = twill ? fx : fy;
      const shade = 0.5 + 0.5 * Math.sin(t * Math.PI);
      const b = 0.05 + shade * 0.10 + (twill ? 0.02 : 0);
      const i = (y * S + x) * 4; img.data[i] = b * 255; img.data[i + 1] = b * 255; img.data[i + 2] = b * 1.1 * 255; img.data[i + 3] = 255;
      H[y * S + x] = shade * (twill ? 1 : 0.8);
    }
    ctx.putImageData(img, 0, 0);
    return { map: Tex.finish(c), normalMap: Tex.normalFromHeight(H, S, S, 1.2) };
  },
  tire(compound = '#ffd23f') {
    const W = 1024, Hh = 128, c = Tex.canvas(W, Hh), ctx = c.getContext('2d');
    const r = mulberry32(9);
    ctx.fillStyle = '#1b1b1d'; ctx.fillRect(0, 0, W, Hh);
    for (let i = 0; i < 9000; i++) { const g = 20 + r() * 18; ctx.fillStyle = `rgb(${g},${g},${g + 2})`; ctx.fillRect(r() * W, r() * Hh, 1.5, 1.5); }
    // tread band (middle of profile) slightly lighter & scuffed
    ctx.fillStyle = 'rgba(70,70,74,0.35)'; ctx.fillRect(0, Hh * 0.36, W, Hh * 0.28);
    // sidewalls: v in [0.08,0.3] and [0.7,0.92]
    const sidewall = (y0, flip) => {
      ctx.save(); ctx.translate(0, y0); if (flip) { ctx.scale(1, -1); }
      ctx.fillStyle = compound; ctx.fillRect(0, flip ? -6 : 2, W, 4);
      ctx.font = 'bold 15px Arial'; ctx.fillStyle = '#d9d9d9'; ctx.textBaseline = 'middle';
      for (let k = 0; k < 4; k++) { ctx.fillText('ALPINA', k * 256 + 40, flip ? -16 : 16); ctx.fillText('RACING SLICK', k * 256 + 128, flip ? -16 : 16); }
      ctx.restore();
    };
    sidewall(Hh * 0.10, false); sidewall(Hh * 0.90, true);
    const t = Tex.finish(c); t.wrapT = THREE.ClampToEdgeWrapping; return t;
  },
  kerb() {
    const c = Tex.canvas(64, 256), ctx = c.getContext('2d');
    ctx.fillStyle = '#c8102e'; ctx.fillRect(0, 0, 64, 128); ctx.fillStyle = '#f2f2f2'; ctx.fillRect(0, 128, 64, 128);
    const r = mulberry32(3); for (let i = 0; i < 1400; i++) { ctx.fillStyle = `rgba(0,0,0,${r() * 0.12})`; ctx.fillRect(r() * 64, r() * 256, 2, 2); }
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(0, 0, 4, 256);
    return Tex.finish(c);
  },
  fence() {
    const S = 128, c = Tex.canvas(S, S), ctx = c.getContext('2d');
    ctx.clearRect(0, 0, S, S); ctx.strokeStyle = 'rgba(190,195,200,1)'; ctx.lineWidth = 3;
    for (let i = -S; i < S * 2; i += 32) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + S, S); ctx.stroke(); ctx.beginPath(); ctx.moveTo(i + S, 0); ctx.lineTo(i, S); ctx.stroke(); }
    const t = Tex.finish(c); return t;
  },
  checker() {
    const c = Tex.canvas(256, 64), ctx = c.getContext('2d');
    for (let y = 0; y < 4; y++) for (let x = 0; x < 16; x++) { ctx.fillStyle = (x + y) % 2 ? '#111' : '#f4f4f4'; ctx.fillRect(x * 16, y * 16, 16, 16); }
    return Tex.finish(c, true, false);
  },
  ads() {
    // 8 rows atlas of original fictional sponsors
    const W = 1024, R = 8, H = 128 * R, c = Tex.canvas(W, H), ctx = c.getContext('2d');
    const brands = [
      ['VELOXA', 'FUEL SYSTEMS', '#0b1f4a', '#ffcc00'], ['GLACIERA', 'MOUNTAIN WATER', '#e8f4fb', '#0a6bb0'],
      ['KESTREL', 'TELECOM', '#141414', '#ff5a1f'], ['SUMMIT AIR', 'FLY HIGHER', '#0a6bb0', '#ffffff'],
      ['ARCLINE', 'PRECISION TECH', '#c8102e', '#ffffff'], ['ORBEX', 'LUBRICANTS', '#1d1d1d', '#39d353'],
      ['LAC DES CIMES', 'GRAND PRIX', '#ffffff', '#c8102e'], ['NORVANE', 'TIMEPIECES', '#20150b', '#d4af37']];
    brands.forEach((b, i) => {
      const y = i * 128; ctx.fillStyle = b[2]; ctx.fillRect(0, y, W, 128);
      ctx.fillStyle = b[3]; ctx.font = 'italic 900 70px Arial'; ctx.textBaseline = 'middle';
      ctx.fillText(b[0], 40, y + 60); const w = ctx.measureText(b[0]).width;
      ctx.font = '700 28px Arial'; ctx.fillText(b[1], 70 + w, y + 70);
      ctx.fillRect(0, y + 116, W, 6);
    });
    const t = Tex.finish(c, true, false); return t;
  },
  label(text, opts = {}) {
    const W = opts.w || 256, H = opts.h || 256, c = Tex.canvas(W, H), ctx = c.getContext('2d');
    ctx.fillStyle = opts.bg || '#ffffff'; ctx.fillRect(0, 0, W, H);
    if (opts.border) { ctx.strokeStyle = opts.border; ctx.lineWidth = W * 0.06; ctx.strokeRect(W * .03, H * .03, W * .94, H * .94); }
    ctx.fillStyle = opts.fg || '#111'; ctx.font = `900 ${opts.size || H * 0.6}px Arial`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, W / 2, H / 2 + (opts.dy || 0));
    return Tex.finish(c, true, false);
  },
  garageDoor() {
    const c = Tex.canvas(128, 128), ctx = c.getContext('2d');
    for (let y = 0; y < 128; y += 8) { ctx.fillStyle = '#9aa3ad'; ctx.fillRect(0, y, 128, 7); ctx.fillStyle = '#6c737b'; ctx.fillRect(0, y + 7, 128, 1); }
    return Tex.finish(c);
  },
  softDot() {
    const c = Tex.canvas(64, 64), ctx = c.getContext('2d'), g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.4, 'rgba(255,255,255,.6)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64); return Tex.finish(c, false, false);
  },
  blob() {
    const c = Tex.canvas(128, 128), ctx = c.getContext('2d'), g = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
    g.addColorStop(0, 'rgba(0,0,0,0.75)'); g.addColorStop(0.6, 'rgba(0,0,0,0.35)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128); return Tex.finish(c, false, false);
  }
};

// Geometry helpers ---------------------------------------------------------
function cleanGeo(g) { // normalise attributes so geometries can be merged
  let ng = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(ng.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) ng.deleteAttribute(k);
  if (!ng.attributes.uv) ng.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(ng.attributes.position.count * 2), 2));
  if (!ng.attributes.normal) ng.computeVertexNormals();
  return ng;
}
function mergeList(list, withColor = false) {
  const arr = list.map(g => { const c = cleanGeo(g); if (withColor && !c.attributes.color) { const n = c.attributes.position.count; const a = new Float32Array(n * 3).fill(1); c.setAttribute('color', new THREE.BufferAttribute(a, 3)); } if (!withColor && c.attributes.color) c.deleteAttribute('color'); return c; });
  const m = mergeGeometries(arr, false);
  if (!m) throw new Error('Geometry merge failed');
  return m;
}
function colorGeo(g, r, gg, b) { const n = g.attributes.position.count; const a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = r; a[i * 3 + 1] = gg; a[i * 3 + 2] = b; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; }
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _e = new THREE.Euler();
function xform(g, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  _m4.compose(_v1.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _v2.set(sx, sy, sz)); g.applyMatrix4(_m4); return g;
}
// Merge static sibling meshes that share a material (and shadow flags) into one draw call.
function mergeStaticByMaterial(group) {
  const buckets = new Map();
  for (const o of [...group.children]) {
    if (!o.isMesh || o.isInstancedMesh || o.children.length || Array.isArray(o.material)) continue;
    const key = o.material.uuid + '|' + o.castShadow + '|' + o.receiveShadow + '|' + o.renderOrder;
    if (!buckets.has(key)) buckets.set(key, []); buckets.get(key).push(o);
  }
  let removed = 0;
  for (const list of buckets.values()) {
    if (list.length < 2) continue;
    const hasColor = !!list[0].geometry.attributes.color;
    const geos = [];
    for (const o of list) {
      const g = o.geometry; const cnt = g.index ? g.index.count : g.attributes.position.count;
      if (cnt > 0 && (!!g.attributes.color) === hasColor) { const c = g.clone(); o.updateMatrix(); c.applyMatrix4(o.matrix); geos.push(c); }
    }
    if (geos.length < 2) continue;
    const m = new THREE.Mesh(mergeList(geos, hasColor), list[0].material);
    m.castShadow = list[0].castShadow; m.receiveShadow = list[0].receiveShadow; m.renderOrder = list[0].renderOrder; m.name = list[0].name;
    for (const o of list) { group.remove(o); o.geometry.dispose(); removed++; }
    group.add(m); removed--;
  }
  return removed;
}
// Box from two points (oriented strut) for static geometry
function strutGeo(a, b, r, seg = 6) {
  const len = a.distanceTo(b); const g = new THREE.CylinderGeometry(r, r, len, seg, 1, false);
  const mid = a.clone().add(b).multiplyScalar(0.5); const dir = b.clone().sub(a).normalize();
  _q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir); _m4.compose(mid, _q, _v2.set(1, 1, 1)); g.applyMatrix4(_m4); return g;
}
