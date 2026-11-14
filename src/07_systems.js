
// =====================================================================
// EFFECTS — pooled particles (smoke, dust, sparks) and skid marks
// =====================================================================
class Particles {
  constructor(max, additive) {
    this.max = max; this.i = 0; this.alive = 0;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 3); this.alpha = new Float32Array(max); this.size = new Float32Array(max);
    this.vel = new Float32Array(max * 3); this.life = new Float32Array(max); this.age = new Float32Array(max);
    this.s0 = new Float32Array(max); this.s1 = new Float32Array(max); this.a0 = new Float32Array(max); this.drag = new Float32Array(max); this.grav = new Float32Array(max);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.uniforms = { uScale: { value: 800 }, uMap: { value: Tex.softDot() } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexShader: `attribute float alpha; attribute float size; varying float vA; varying vec3 vC; uniform float uScale;
        void main(){ vA = alpha; vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = size * uScale / max(-mv.z, 0.1); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D uMap; varying float vA; varying vec3 vC;
        void main(){ vec4 t = texture2D(uMap, gl_PointCoord); float a = t.a * vA; if (a < 0.003) discard; gl_FragColor = vec4(vC, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        }`,
      vertexColors: true
    });
    this.points = new THREE.Points(g, mat); this.points.frustumCulled = false; this.points.renderOrder = 5;
  }
  spawn(x, y, z, vx, vy, vz, life, s0, s1, r, g, b, a0, drag = 1, grav = 0) {
    const i = this.i; this.i = (this.i + 1) % this.max;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.col[i * 3] = r; this.col[i * 3 + 1] = g; this.col[i * 3 + 2] = b;
    this._spawned = true;
    this.life[i] = life; this.age[i] = 0; this.s0[i] = s0; this.s1[i] = s1; this.a0[i] = a0; this.drag[i] = drag; this.grav[i] = grav;
  }
  update(dt) {
    if (!this._spawned && this.alive === 0) return; // idle pool: no CPU loop, no GPU upload
    this._spawned = false;
    let alive = 0;
    for (let i = 0; i < this.max; i++) {
      if (this.age[i] >= this.life[i]) { this.alpha[i] = 0; continue; }
      alive++;
      this.age[i] += dt; const t = this.age[i] / this.life[i];
      const d = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= d; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d - this.grav[i] * dt; this.vel[i * 3 + 2] *= d;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] = lerp(this.s0[i], this.s1[i], Math.sqrt(t));
      this.alpha[i] = this.a0[i] * (1 - t) * Math.min(1, t * 8);
    }
    this.alive = alive;
    const a = this.points.geometry.attributes; a.position.needsUpdate = true; a.color.needsUpdate = true; a.alpha.needsUpdate = true; a.size.needsUpdate = true;
  }
  clear() { this.age.fill(1); this.life.fill(0); }
}
class SkidMarks {
  constructor(max = 3000) {
    this.max = max; this.i = 0; this.last = new Map();
    this.pos = new Float32Array(max * 4 * 3); this.col = new Float32Array(max * 4 * 4);
    const idx = new Uint32Array(max * 6);
    for (let k = 0; k < max; k++) { const a = k * 4; idx.set([a, a + 2, a + 1, a + 1, a + 2, a + 3], k * 6); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    this.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, side: THREE.DoubleSide }));
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 1; this.dirty = false;
  }
  // p: contact point, n: ground normal, side: lateral unit vector, w: width
  add(key, p, n, side, w, rgb, a) {
    const L = this.last.get(key);
    const lx = p.x + side.x * w / 2 + n.x * 0.02, ly = p.y + side.y * w / 2 + n.y * 0.02, lz = p.z + side.z * w / 2 + n.z * 0.02;
    const rx = p.x - side.x * w / 2 + n.x * 0.02, ry = p.y - side.y * w / 2 + n.y * 0.02, rz = p.z - side.z * w / 2 + n.z * 0.02;
    if (L && Math.hypot(p.x - L.x, p.z - L.z) < 0.4) return;
    if (L && Math.hypot(p.x - L.x, p.z - L.z) < 3) {
      const k = this.i; this.i = (this.i + 1) % this.max;
      this.pos.set([L.lx, L.ly, L.lz, L.rx, L.ry, L.rz, lx, ly, lz, rx, ry, rz], k * 12);
      for (let v = 0; v < 4; v++) this.col.set([rgb[0], rgb[1], rgb[2], v < 2 ? L.a : a], k * 16 + v * 4);
      this.dirty = true;
    }
    this.last.set(key, { x: p.x, z: p.z, lx, ly, lz, rx, ry, rz, a });
  }
  lift(key) { this.last.delete(key); }
  update() { if (!this.dirty) return; this.dirty = false; const a = this.mesh.geometry.attributes; a.position.needsUpdate = true; a.color.needsUpdate = true; }
  clear() { this.pos.fill(0); this.col.fill(0); this.last.clear(); this.dirty = true; }
}

// =====================================================================
// RACE MANAGER — grid, start lights, checkpoints, laps, sectors, DRS
// =====================================================================
class RaceManager {
  constructor(game, mode, laps) {
    this.g = game; this.track = game.track; this.mode = mode; this.totalLaps = laps;
    this.entries = []; this.time = 0; this.raceTime = 0; this.state = mode === 'race' ? 'grid' : 'running';
    this.lights = 0; this.lightT = 0; this.holdT = 0.6 + Math.random() * 2.2; this.bestLapAll = null; this.bestSecAll = [null, null, null];
    this.messages = []; this.finishOrder = []; this.resultsShown = false;
    this.cps = [0, ...this.track.checkpoints];
  }
  add(car, info) {
    const e = { car, ...info, lapsDone: -1, lastS: null, cpNext: 1, lapStart: null, lastLap: null, bestLap: null, laps: [],
      sector: 0, secStart: null, curSec: [null, null, null], lastSec: [null, null, null], bestSec: [null, null, null], secState: ['', '', ''],
      finished: false, finishTime: null, penalty: 0, progress: 0, cpTimes: new Map(), cpIdx: -1, drsElig: [false, false], detTime: [-99, -99], falseStart: false,
      trace: [], valid: true };
    this.entries.push(e); this.order = [...this.entries]; this.order.forEach((x, i) => x.pos = i + 1); return e;
  }
  get running() { return this.state === 'running' || this.state === 'finishing'; }
  startLights() { this.state = 'lights'; this.lightT = 0; this.lights = 0; }
  sRel(s) { return this.track.wrapS(s); }
  update(dt) {
    this.time += dt;
    const L = this.track.length;
    if (this.state === 'grid') { this.lightT += dt; if (this.lightT > 1.8) this.startLights(); }
    else if (this.state === 'lights') {
      this.lightT += dt;
      const n = Math.min(5, Math.floor(this.lightT / 1.0));
      if (n > this.lights) { this.lights = n; this.g.audio.oneshot('beep', 1); }
      if (this.lightT > 5 + this.holdT) { this.lights = 0; this.state = 'running'; this.raceTime = 0; this.g.audio.oneshot('go', 1); this.g.flash('LIGHTS OUT', 'GO GO GO'); }
    }
    if (this.running) this.raceTime += dt;
    for (const e of this.entries) {
      const s = e.car.q.s;
      if (e.lastS == null) { e.lastS = s; continue; }
      // false start detection (player only): car moved off its grid box before lights out
      if (e.isPlayer && (this.state === 'grid' || this.state === 'lights') && !e.falseStart && e.gridPos && e.car.pos.distanceTo(e.gridPos) > 1.0) {
        e.falseStart = true; e.penalty += 5; this.g.flash('JUMP START', '+5 SECOND PENALTY');
      }
      const prev = e.lastS; e.lastS = s;
      const fwdCross = prev > L * 0.8 && s < L * 0.2, backCross = prev < L * 0.2 && s > L * 0.8;
      if (!this.running && this.mode === 'race') continue;
      if (e.finished) continue;
      // ordered checkpoints (must be passed in sequence)
      if (!fwdCross && !backCross && e.cpNext < this.cps.length) {
        const cp = this.cps[e.cpNext];
        if (prev < cp && s >= cp && s - prev < 60) { this._cp(e, e.lapsDone * 16 + e.cpNext); e.cpNext++; }
      }
      // sectors
      for (let k = 1; k < 3; k++) {
        const b = this.track.sectorS[k];
        if (!fwdCross && prev < b && s >= b && e.sector === k - 1 && e.secStart != null) this._sector(e, k - 1);
      }
      // DRS detection points
      this.track.drsZones.forEach((z, zi) => {
        if (this.track.inRange(s, z.detect, z.detect + 40) && !this.track.inRange(prev, z.detect, z.detect + 40)) {
          e.detTime[zi] = this.time;
          if (this.mode !== 'race') e.drsElig[zi] = true;
          else {
            const ahead = this.order ? this.order[this.order.indexOf(e) - 1] : null;
            e.drsElig[zi] = !!(ahead && e.lapsDone >= 1 && this.time - ahead.detTime[zi] < 1.0 && this.time - ahead.detTime[zi] >= 0);
          }
        }
      });
      if (backCross) { e.lapsDone -= 1; e.cpNext = this.cps.length; e.valid = false; continue; }
      if (fwdCross) this._line(e);
      if (e.isPlayer && this.mode === 'tt' && e.lapStart != null) { const k = Math.floor(s / 10); if (e.trace.length <= k) e.trace[k] = this.time - e.lapStart; }
    }
    // progress & order
    for (const e of this.entries) { const s = e.car.q.s; e.progress = e.lapsDone < 0 ? s - L : e.lapsDone * L + s; if (e.lapsDone < 0 && s < L * 0.3) e.progress = s; }
    const order = [...this.entries].sort((a, b) => {
      if (a.finished && b.finished) return a.finishRank - b.finishRank;
      if (a.finished) return -1; if (b.finished) return 1;
      return b.progress - a.progress;
    });
    this.order = order; order.forEach((e, i) => e.pos = i + 1);
    // results
    const pl = this.player;
    if (this.mode === 'race' && pl && pl.finished && !this.resultsShown) { this.resultsT = (this.resultsT || 0) + dt; if (this.resultsT > 4) { this.resultsShown = true; this.g.showResults(); } }
  }
  _cp(e, idx) { e.cpTimes.set(idx, this.time); e.cpIdx = idx; }
  _sector(e, k) {
    const t = this.time - e.secStart; e.curSec[k] = t; e.secStart = this.time; e.sector = k + 1;
    const pb = e.bestSec[k] == null || t < e.bestSec[k]; const ob = this.bestSecAll[k] == null || t < this.bestSecAll[k];
    e.secState[k] = ob ? 'purple' : pb ? 'green' : 'yellow';
    if (pb) e.bestSec[k] = t; if (ob) this.bestSecAll[k] = t;
  }
  _line(e) {
    const now = this.time;
    if (e.lapsDone < 0) { // first crossing: race start / timed lap begins
      e.lapsDone = 0; e.lapStart = now; e.secStart = now; e.sector = 0; e.cpNext = 1; e.valid = true; e.trace = []; this._cp(e, 0);
      e.curSec = [null, null, null]; e.secState = ['', '', ''];
      return;
    }
    if (e.secStart != null && e.sector === 2) this._sector(e, 2);
    const lap = now - e.lapStart;
    const valid = e.cpNext >= this.cps.length && e.valid;
    if (valid) {
      e.lapsDone++; e.lastLap = lap; e.laps.push(lap); e.lastSec = [...e.curSec];
      if (e.bestLap == null || lap < e.bestLap) {
        e.bestLap = lap;
        if (e.isPlayer && this.mode === 'tt') this.g.savePB(lap, e.trace);
        if (e.isPlayer && this.mode !== 'race') this.g.flash('PERSONAL BEST', fmtTime(lap));
      }
      if (this.bestLapAll == null || lap < this.bestLapAll) this.bestLapAll = lap;
      this._cp(e, e.lapsDone * 16);
    } else if (e.isPlayer) this.g.flash('LAP INVALID', 'CHECKPOINT MISSED');
    e.lapStart = now; e.secStart = now; e.sector = 0; e.cpNext = 1; e.valid = true; e.trace = []; e.curSec = [null, null, null]; e.secState = ['', '', ''];
    if (this.mode === 'race' && e.lapsDone >= this.totalLaps) {
      e.finished = true; e.finishTime = this.raceTime + e.penalty; e.finishRank = this.finishOrder.length; this.finishOrder.push(e);
      if (this.state === 'running') this.state = 'finishing';
      if (e.isPlayer) this.g.flash('CHEQUERED FLAG', 'P' + (this.finishOrder.length));
    } else if (this.mode === 'race' && e.isPlayer && e.lapsDone === this.totalLaps - 1) this.g.flash('FINAL LAP', '');
  }
  gapToLeader(e) {
    const leader = this.order[0]; if (leader === e) return 'LEADER';
    if (e.finished && leader.finished) return '+' + (e.finishTime - leader.finishTime).toFixed(3);
    const lapDiff = Math.floor((leader.progress - e.progress) / this.track.length);
    if (lapDiff >= 1) return '+' + lapDiff + ' LAP' + (lapDiff > 1 ? 'S' : '');
    const t0 = leader.cpTimes.get(e.cpIdx); if (t0 == null || e.cpIdx < 1) return '-';
    return '+' + Math.max(0, e.cpTimes.get(e.cpIdx) - t0).toFixed(1);
  }
}

// =====================================================================
// CAMERA RIG — spring-damper chase camera and cockpit camera
// =====================================================================
class CameraRig {
  constructor(camera, track) {
    this.cam = camera; this.track = track; this.mode = 'chase';
    this.p = new THREE.Vector3(); this.v = new THREE.Vector3(); this.look = new THREE.Vector3(); this.init = false; this.fov = 60; this.q = { i: -1 };
    this.upV = new THREE.Vector3(0, 1, 0); this.prevVel = new THREE.Vector3(); this.acc = new THREE.Vector3(); this.roll = 0; this.pitchOff = 0;
    this._s = { eye: new THREE.Vector3(), target: new THREE.Vector3(), left: new THREE.Vector3(), tmp: new THREE.Vector3(), lookQ: new THREE.Quaternion(), lookE: new THREE.Euler(0, 0, 0, 'YXZ') };
  }
  toggle() { this.mode = this.mode === 'chase' ? 'cockpit' : 'chase'; this.init = false; }
  update(dt, pos, quat, vel, steer) {
    const cam = this.cam;
    const fwd = _v1.set(0, 0, 1).applyQuaternion(quat), up = _v2.set(0, 1, 0).applyQuaternion(quat);
    // smoothed acceleration in car frame for g-force cues
    if (dt > 0) { this.acc.lerp(_v3.subVectors(vel, this.prevVel).multiplyScalar(1 / dt), 1 - Math.exp(-dt * 6)); }
    this.prevVel.copy(vel);
    const speed = vel.length(), longA = this.acc.dot(fwd), latA = this.acc.dot(_v3.set(0, 1, 0).applyQuaternion(quat).cross(fwd));
    if (this.mode === 'cockpit') {
      const S = this._s, eye = S.eye.copy(CAR.eye); eye.y -= CAR.cgH;
      cam.position.copy(eye.applyQuaternion(quat).add(pos));
      const look = S.lookQ.setFromEuler(S.lookE.set(-0.03 + clamp(longA * 0.0012, -0.02, 0.02), Math.PI + steer * 0.10, 0, 'YXZ'));
      this.roll = lerp(this.roll, clamp(-latA * 0.0025, -0.04, 0.04), 1 - Math.exp(-dt * 5));
      cam.quaternion.copy(quat).multiply(look).multiply(_q.setFromAxisAngle(_v3.set(0, 0, 1), this.roll));
      cam.near = 0.03; this.fov = lerp(this.fov, 74 + 6 * smoothstep(20, 90, speed), 1 - Math.exp(-dt * 3));
    } else {
      const ff = _v3.set(fwd.x, 0, fwd.z).normalize();
      this.pitchOff = lerp(this.pitchOff, clamp(-longA * 0.02, -0.25, 0.45), 1 - Math.exp(-dt * 4));
      const S = this._s, target = S.target.copy(pos).addScaledVector(ff, -5.4); target.y += 1.6 + this.pitchOff;
      const left = S.left.set(ff.z, 0, -ff.x); target.addScaledVector(left, -steer * 0.35);
      if (!this.init) { this.p.copy(target); this.v.set(0, 0, 0); this.init = true; this.look.copy(pos); }
      // critically-damped spring, sub-stepped so behaviour is frame-rate independent
      const k = 110, c = 2 * Math.sqrt(k) * 0.92; let rem = Math.min(dt, 0.1);
      while (rem > 1e-5) { const h = Math.min(rem, 1 / 240); rem -= h; const ax = (target.x - this.p.x) * k - this.v.x * c, ay = (target.y - this.p.y) * k * 1.4 - this.v.y * c, az = (target.z - this.p.z) * k - this.v.z * c; this.v.x += ax * h; this.v.y += ay * h; this.v.z += az * h; this.p.addScaledVector(this.v, h); }
      // keep the camera at a sensible distance (no runaway at high speed)
      const d = this.p.distanceTo(pos); if (d > 8.0) this.p.sub(pos).setLength(8.0).add(pos);
      // collision resistance: stay above ground and inside the barriers
      this.track.query(this.p.x, this.p.z, this.q.i, this.q);
      const lh = Math.hypot(this.q.lx, this.q.lz);
      const maxL = this.q.wallL - 0.5, maxR = this.q.wallR - 0.5;
      if (this.q.u > maxL) { const pen = (this.q.u - maxL) * lh; this.p.x -= this.q.lx / lh * pen; this.p.z -= this.q.lz / lh * pen; }
      if (this.q.u < -maxR) { const pen = (-maxR - this.q.u) * lh; this.p.x += this.q.lx / lh * pen; this.p.z += this.q.lz / lh * pen; }
      const gy = this.q.y + 0.6; if (this.p.y < gy) { this.p.y = gy; this.v.y = Math.max(0, this.v.y); }
      cam.position.copy(this.p);
      this.look.lerp(S.tmp.copy(pos).addScaledVector(fwd, 3.2).addScaledVector(up, 0.65), 1 - Math.exp(-dt * 18));
      this.upV.lerp(S.tmp.set(0, 1, 0).lerp(up, 0.35), 1 - Math.exp(-dt * 4)).normalize();
      this.roll = lerp(this.roll, clamp(latA * 0.002, -0.03, 0.03), 1 - Math.exp(-dt * 3));
      cam.up.copy(this.upV); cam.lookAt(this.look); cam.rotateZ(this.roll);
      cam.near = 0.1; this.fov = lerp(this.fov, 58 + 16 * smoothstep(10, 92, speed), 1 - Math.exp(-dt * 2.5));
    }
    cam.fov = this.fov; cam.updateProjectionMatrix();
  }
}

// =====================================================================
// INPUT — keyboard + gamepad, progressive pedals, stuck-key protection
// =====================================================================
class Input {
  constructor(onAction) {
    this.keys = new Set(); this.onAction = onAction;
    this.throttle = 0; this.brake = 0; this.steer = 0; this.padPrev = []; this.pad = null;
    const typing = (e) => { const t = e.target; return t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable); };
    const actions = { KeyF: 'drs', KeyQ: 'gearDown', KeyE: 'gearUp', KeyM: 'trans', KeyC: 'camera', KeyR: 'reset', Escape: 'pause', KeyN: 'mute', F3: 'debug', Backquote: 'debug' };
    window.addEventListener('keydown', (e) => {
      if (typing(e) && e.code !== 'Escape') return;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'F3'].includes(e.code)) e.preventDefault();
      if (!e.repeat && actions[e.code]) this.onAction(actions[e.code]);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => { this.keys.delete(e.code); });
    window.addEventListener('blur', () => this.keys.clear());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.keys.clear(); });
  }
  k(...c) { return c.some(x => this.keys.has(x)); }
  update(dt) {
    let tT = this.k('KeyW', 'ArrowUp') ? 1 : 0, bT = this.k('KeyS', 'ArrowDown') ? 1 : 0;
    let sT = (this.k('KeyA', 'ArrowLeft') ? 1 : 0) - (this.k('KeyD', 'ArrowRight') ? 1 : 0);
    let analog = false;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const p = pads && [...pads].find(x => x && x.connected);
    if (p) {
      const ax = p.axes[0] || 0; const dz = Math.abs(ax) < 0.08 ? 0 : ax;
      const rt = p.buttons[7] ? p.buttons[7].value : 0, lt = p.buttons[6] ? p.buttons[6].value : 0;
      if (Math.abs(dz) > 0 || rt > 0.02 || lt > 0.02) { analog = true; tT = Math.max(tT, rt); bT = Math.max(bT, lt); if (Math.abs(dz) > 0) sT = -Math.sign(dz) * Math.pow(Math.abs(dz), 1.4); }
      const map = { 5: 'gearUp', 4: 'gearDown', 0: 'drs', 3: 'camera', 9: 'pause', 1: 'reset', 2: 'trans' };
      for (const [b, a] of Object.entries(map)) { const pressed = p.buttons[b] && p.buttons[b].pressed; if (pressed && !this.padPrev[b]) this.onAction(a); this.padPrev[b] = pressed; }
    }
    const ramp = (cur, tgt, up, down) => tgt > cur ? Math.min(tgt, cur + up * dt) : Math.max(tgt, cur - down * dt);
    this.throttle = analog ? tT : ramp(this.throttle, tT, 4.0, 7.0);
    this.brake = analog ? bT : ramp(this.brake, bT, 5.5, 9.0);
    if (analog) this.steer = lerp(this.steer, sT, 1 - Math.exp(-dt * 20));
    else { const centring = sT === 0 || Math.sign(sT) !== Math.sign(this.steer); this.steer = ramp(this.steer, sT, centring ? 5.0 : 2.6, centring ? 5.0 : 2.6); }
  }
  reset() { this.keys.clear(); this.throttle = this.brake = this.steer = 0; }
}

// =====================================================================
// AUDIO — synthesised layered engine, tyres, surfaces, wind, one-shots
// =====================================================================
class AudioSys {
  constructor() { this.ctx = null; this.vol = { master: 0.8, engine: 0.8, fx: 0.8, mute: false }; this.active = 0; this.lastShot = {}; }
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp); comp.connect(ctx.destination);
    this.engBus = ctx.createGain(); this.engBus.connect(this.master); this.fxBus = ctx.createGain(); this.fxBus.connect(this.master);
    const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
    const noiseSrc = () => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.start(0, Math.random() * 1.5); return s; };
    // engine: harmonic oscillator stack -> soft clip -> low-pass
    const shaper = ctx.createWaveShaper(); const curve = new Float32Array(1024); for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; curve[i] = Math.tanh(x * 2.2); } shaper.curve = curve;
    this.engLP = ctx.createBiquadFilter(); this.engLP.type = 'lowpass'; this.engLP.Q.value = 1.4;
    this.engGain = ctx.createGain(); this.engGain.gain.value = 0;
    shaper.connect(this.engLP); this.engLP.connect(this.engGain); this.engGain.connect(this.engBus);
    this.oscs = [[1, 'sawtooth', 0.42], [0.5, 'sawtooth', 0.30], [2, 'square', 0.12], [3, 'triangle', 0.10], [4, 'sine', 0.06], [1.5, 'sine', 0.08]].map(([m, t, g]) => {
      const o = ctx.createOscillator(); o.type = t; const gn = ctx.createGain(); gn.gain.value = g; o.connect(gn); gn.connect(shaper); o.start(); return { o, m, gn, g };
    });
    const intake = noiseSrc(); this.intakeBP = ctx.createBiquadFilter(); this.intakeBP.type = 'bandpass'; this.intakeBP.Q.value = 2.5; this.intakeG = ctx.createGain(); this.intakeG.gain.value = 0;
    intake.connect(this.intakeBP); this.intakeBP.connect(this.intakeG); this.intakeG.connect(this.engBus);
    // tyre squeal: band-passed noise + tonal component
    const tn = noiseSrc(); const tbp = ctx.createBiquadFilter(); tbp.type = 'bandpass'; tbp.frequency.value = 1300; tbp.Q.value = 4;
    this.squealOsc = ctx.createOscillator(); this.squealOsc.type = 'triangle'; this.squealOsc.frequency.value = 780; const sqg = ctx.createGain(); sqg.gain.value = 0.25; this.squealOsc.connect(sqg); this.squealOsc.start();
    this.tireG = ctx.createGain(); this.tireG.gain.value = 0; tn.connect(tbp); tbp.connect(this.tireG); sqg.connect(this.tireG); this.tireG.connect(this.fxBus);
    const mk = (type, f, q, g0) => { const s = noiseSrc(); const f1 = ctx.createBiquadFilter(); f1.type = type; f1.frequency.value = f; f1.Q.value = q; const g = ctx.createGain(); g.gain.value = g0; s.connect(f1); f1.connect(g); g.connect(this.fxBus); return { g, f: f1 }; };
    this.gravel = mk('lowpass', 1100, 0.8, 0); this.grass = mk('lowpass', 280, 0.7, 0); this.wind = mk('bandpass', 420, 0.35, 0); this.amb = mk('lowpass', 240, 0.5, 0.025);
    this.kerb = mk('lowpass', 160, 1.5, 0);
    // nearest opponent engine
    this.oppO = ctx.createOscillator(); this.oppO.type = 'sawtooth'; const oLP = ctx.createBiquadFilter(); oLP.type = 'lowpass'; oLP.frequency.value = 1500; this.oppG = ctx.createGain(); this.oppG.gain.value = 0;
    this.oppO.connect(oLP); oLP.connect(this.oppG); this.oppG.connect(this.engBus); this.oppO.start();
    this.applyVolume();
    this._birds();
  }
  _birds() {
    const ctx = this.ctx; if (!ctx) return;
    const chirp = () => {
      if (ctx.state === 'running' && this.active < 10 && this.ambOn) {
        const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime, f = 2400 + Math.random() * 1800;
        o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 1.4, t + 0.08); o.frequency.exponentialRampToValueAtTime(f * 0.9, t + 0.16);
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.012, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
        o.connect(g); g.connect(this.fxBus); o.start(t); o.stop(t + 0.22); this.active++; o.onended = () => { this.active--; o.disconnect(); g.disconnect(); };
      }
      this.birdTimer = setTimeout(chirp, 1500 + Math.random() * 5000);
    };
    chirp();
  }
  applyVolume() {
    if (!this.ctx) return; const t = this.ctx.currentTime, v = this.vol;
    this.master.gain.setTargetAtTime(v.mute ? 0 : v.master, t, 0.05); this.engBus.gain.setTargetAtTime(v.engine, t, 0.05); this.fxBus.gain.setTargetAtTime(v.fx, t, 0.05);
  }
  suspend() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend(); }
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }
  update(st) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime, tc = 0.03;
    const f0 = Math.max(st.rpm, 1500) / 60 * 3; // V6 firing frequency
    for (const o of this.oscs) o.o.frequency.setTargetAtTime(f0 * o.m, t, 0.012);
    const load = st.throttle;
    this.engLP.frequency.setTargetAtTime(500 + load * 4200 + st.rpm * 0.25, t, tc);
    const overrun = (1 - load) * clamp((st.rpm - 6000) / 5000, 0, 1);
    this.engGain.gain.setTargetAtTime(st.running ? (0.10 + load * 0.20 + overrun * 0.05) * (st.limiter ? 0.6 + 0.4 * Math.random() : 1) : 0, t, tc);
    this.intakeBP.frequency.setTargetAtTime(f0 * 5, t, tc); this.intakeG.gain.setTargetAtTime(load * 0.06 * clamp(st.rpm / 12000, 0, 1), t, tc);
    this.tireG.gain.setTargetAtTime(clamp(st.squeal, 0, 1) * 0.22, t, 0.05); this.squealOsc.frequency.setTargetAtTime(700 + st.squeal * 260, t, 0.1);
    this.gravel.g.gain.setTargetAtTime(st.gravel * 0.35 * (0.7 + 0.3 * Math.random()), t, 0.03);
    this.grass.g.gain.setTargetAtTime(st.grass * 0.28, t, 0.05);
    this.kerb.g.gain.setTargetAtTime(st.kerb * 0.5, t, 0.02);
    this.wind.g.gain.setTargetAtTime(clamp(st.speed / 90, 0, 1) ** 2 * 0.22, t, 0.1); this.wind.f.frequency.setTargetAtTime(300 + st.speed * 6, t, 0.2);
    this.oppO.frequency.setTargetAtTime(Math.max(st.oppRpm, 1500) / 60 * 3, t, 0.03); this.oppG.gain.setTargetAtTime(st.oppGain * 0.07, t, 0.05);
    this.ambOn = true;
  }
  silence() { if (!this.ctx) return; const t = this.ctx.currentTime; [this.engGain, this.intakeG, this.tireG, this.gravel.g, this.grass.g, this.wind.g, this.oppG, this.kerb.g].forEach(g => g.gain.setTargetAtTime(0, t, 0.05)); }
  oneshot(kind, intensity = 1) {
    const ctx = this.ctx; if (!ctx || ctx.state !== 'running') return;
    const now = performance.now(); if (this.lastShot[kind] && now - this.lastShot[kind] < (kind === 'impact' ? 90 : 40)) return; this.lastShot[kind] = now;
    if (this.active > 14) return;
    const t = ctx.currentTime, g = ctx.createGain(); g.connect(this.fxBus); let src;
    if (kind === 'beep' || kind === 'go') {
      src = ctx.createOscillator(); src.type = 'sine'; src.frequency.value = kind === 'go' ? 1320 : 880; src.connect(g);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + (kind === 'go' ? 0.6 : 0.25)); src.start(t); src.stop(t + 0.65);
    } else if (kind === 'shift' || kind === 'denied') {
      src = ctx.createOscillator(); src.type = 'square'; src.frequency.setValueAtTime(kind === 'denied' ? 160 : 90, t); src.frequency.exponentialRampToValueAtTime(40, t + 0.05); src.connect(g);
      g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07); src.start(t); src.stop(t + 0.08);
    } else {
      src = ctx.createBufferSource(); src.buffer = this.noise; const f = ctx.createBiquadFilter();
      if (kind === 'impact') { f.type = 'lowpass'; f.frequency.value = 500 + intensity * 1800; g.gain.setValueAtTime(clamp(0.15 + intensity * 0.5, 0, 0.9), t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35); }
      else if (kind === 'backfire') { f.type = 'bandpass'; f.frequency.value = 260; f.Q.value = 1.2; g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09); }
      else { f.type = 'highpass'; f.frequency.value = 2000; g.gain.setValueAtTime(0.1 * intensity, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15); }
      src.connect(f); f.connect(g); src.start(t, Math.random()); src.stop(t + 0.4);
    }
    this.active++; src.onended = () => { this.active--; try { src.disconnect(); g.disconnect(); } catch (e) { } };
  }
}

// =====================================================================
// HUD — broadcast-style telemetry overlay and minimap
// =====================================================================
class HUD {
  constructor(track) {
    this.track = track; const $ = (id) => document.getElementById(id); this.$ = $;
    this.el = { root: $('hud'), pos: $('hpos'), lap: $('hlap'), session: $('session'), standings: $('standings'), s: [$('s1'), $('s2'), $('s3')], laptime: $('laptime'), delta: $('delta'), lights: $('lights'),
      tcur: $('t-cur'), tlast: $('t-last'), tbest: $('t-best'), ts: [$('t-s1'), $('t-s2'), $('t-s3')], ttotal: $('t-total'), tpen: $('t-pen'),
      spd: $('hspd'), gear: $('hgear'), rpm: $('hrpm'), rpmbar: $('rpmbar').firstElementChild, shift: $('shift'), drs: $('drs'), trans: $('trans'), assist: $('assist'), thr: $('thr').firstElementChild, brk: $('brk').firstElementChild,
      msg: $('msg'), debug: $('debug'), map: $('minimap') };
    for (let i = 0; i < 15; i++) this.el.shift.appendChild(document.createElement('i'));
    this.shiftLeds = [...this.el.shift.children];
    this.lightEls = [...this.el.lights.children];
    this.t = 0; this.msgT = 0;
    // minimap pre-render
    const P = track.P; let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    for (const p of P) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); }
    const W = this.el.map.width, pad = 26, sc = Math.min((W - pad * 2) / (maxX - minX), (W - pad * 2) / (maxZ - minZ));
    this.mm = { sc, cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2, W };
    this.mmBase = document.createElement('canvas'); this.mmBase.width = this.mmBase.height = W;
    const c = this.mmBase.getContext('2d'); const tp = (x, z) => this.toMap(x, z);
    c.lineJoin = 'round'; c.lineCap = 'round';
    const path = () => { c.beginPath(); P.forEach((p, i) => { const [x, y] = tp(p.x, p.z); i ? c.lineTo(x, y) : c.moveTo(x, y); }); c.closePath(); };
    path(); c.strokeStyle = 'rgba(0,0,0,0.6)'; c.lineWidth = 16; c.stroke();
    path(); c.strokeStyle = '#d9dee6'; c.lineWidth = 8; c.stroke();
    // sector tints
    const secCols = ['#ff4d4d', '#3fd0ff', '#ffd23f'];
    for (let k = 0; k < 3; k++) { c.beginPath(); const a = Math.floor(track.sectorS[k] / track.ds), b = Math.floor((k < 2 ? track.sectorS[k + 1] : track.length) / track.ds); for (let i = a; i <= b; i++) { const p = P[i % track.N]; const [x, y] = tp(p.x, p.z); i === a ? c.moveTo(x, y) : c.lineTo(x, y); } c.strokeStyle = secCols[k]; c.globalAlpha = 0.5; c.lineWidth = 3; c.stroke(); c.globalAlpha = 1; }
    // DRS zones
    for (const z of track.drsZones) { c.beginPath(); let s = z.start; let first = true; while (track.inRange(s, z.start, z.end)) { const f = track.frameAt(s, 0); const [x, y] = tp(f.pos.x, f.pos.z); first ? c.moveTo(x, y) : c.lineTo(x, y); first = false; s += 10; if (s - z.start > 2000) break; } c.strokeStyle = '#25e05d'; c.lineWidth = 3; c.stroke(); }
    // start line + corner numbers
    const f0 = track.frameAt(0, 0); const [sx, sy] = tp(f0.pos.x, f0.pos.z); c.fillStyle = '#fff'; c.fillRect(sx - 9, sy - 2, 18, 4);
    c.font = '700 15px Arial'; c.fillStyle = 'rgba(255,255,255,0.75)'; c.textAlign = 'center'; c.textBaseline = 'middle';
    for (const cn of track.corners) { const i = cn.apex, p = P[i], L = track.L[i]; const side = cn.sign > 0 ? -1 : 1; const [x, y] = tp(p.x + L.x * side * 34, p.z + L.z * side * 34); c.fillText(String(cn.num), x, y); }
  }
  toMap(x, z) { const m = this.mm; return [m.W / 2 - (x - m.cx) * m.sc, m.W / 2 - (z - m.cz) * m.sc]; }
  show(v) { this.el.root.classList.toggle('hidden', !v); }
  message(title, sub, dur = 2.2) { this.el.msg.innerHTML = title + (sub ? '<small>' + sub + '</small>' : ''); this.el.msg.classList.add('show'); this.msgT = dur; }
  update(dt, G) {
    const r = G.race, p = G.player, ph = p.phys, e = p.entry, el = this.el;
    this.msgT -= dt; if (this.msgT <= 0) el.msg.classList.remove('show');
    // minimap at up to 60 Hz (no need to redraw a 2D canvas at 240 Hz)
    this.mmT = (this.mmT || 0) - dt;
    if (this.mmT <= 0) { this.mmT = 1 / 60; this.drawMap(G); }
    this.fastHud(G, ph);
    this.t -= dt; if (this.t > 0) return; this.t = 0.05;
    this.slowHud(G, r, p, ph, e, el);
  }
  drawMap(G) {
    const el = this.el, p = G.player, ph = p.phys;
    const ctx = el.map.getContext('2d'); ctx.clearRect(0, 0, el.map.width, el.map.height); ctx.drawImage(this.mmBase, 0, 0);
    for (const c of G.cars) {
      if (c === p) continue; const [x, y] = this.toMap(c.phys.pos.x, c.phys.pos.z);
      ctx.beginPath(); ctx.arc(x, y, 7, 0, TAU); ctx.fillStyle = c.colorCss; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#000'; ctx.stroke();
    }
    { const [x, y] = this.toMap(ph.pos.x, ph.pos.z); const f = ph.forward; const a = Math.atan2(-f.x, -f.z);
      ctx.save(); ctx.translate(x, y); ctx.rotate(a); ctx.beginPath(); ctx.moveTo(0, -14); ctx.lineTo(9, 9); ctx.lineTo(0, 4); ctx.lineTo(-9, 9); ctx.closePath(); ctx.fillStyle = '#ffd23f'; ctx.fill(); ctx.lineWidth = 2.5; ctx.strokeStyle = '#000'; ctx.stroke(); ctx.restore(); }
  }
  fastHud(G, ph) {
    const el = this.el;
    const rpm = ph.engine.rpm;
    el.rpmbar.style.width = clamp(rpm / VP.maxRPM * 100, 0, 100) + '%';
    const lit = Math.round(clamp((rpm - 9000) / 3000, 0, 1) * 15);
    const flash = rpm > 12150;
    this.shiftLeds.forEach((l, i) => { l.className = i < lit ? (i < 5 ? 'g' : i < 10 ? 'r' : 'b') : ''; });
    el.shift.classList.toggle('flash', flash && (performance.now() % 140 < 70));
    el.thr.style.height = (ph.input.throttle * 100) + '%'; el.brk.style.height = (ph.input.brake * 100) + '%';
  }
  slowHud(G, r, p, ph, e, el) {
    const rpm = ph.engine.rpm, kmh = ph.speed * 3.6;
    el.spd.textContent = Math.round(kmh); el.rpm.textContent = Math.round(rpm / 10) * 10;
    el.gear.textContent = ph.engine.gear === -1 ? 'R' : ph.engine.shiftT > 0 ? '-' : ph.engine.gear;
    el.gear.style.color = ph.pitLimiter ? '#3fd0ff' : '';
    el.trans.textContent = ph.engine.auto ? 'AUTO' : 'MANUAL'; el.assist.textContent = 'ABS ' + (ph.assist.abs ? 'ON' : 'OFF') + ' · TC ' + (ph.assist.tc ? 'ON' : 'OFF') + ' · BB ' + Math.round(ph.assist.bias * 100) + (ph.pitLimiter ? ' · PIT LIMITER' : '');
    const drsState = G.drsState();
    el.drs.className = 'badge ' + (drsState === 'ACTIVE' ? 'active' : drsState === 'AVAILABLE' ? 'avail' : '');
    el.drs.textContent = 'DRS ' + drsState;
    // session / position / lap
    const n = r.entries.length;
    el.pos.textContent = r.mode === 'race' ? 'P' + e.pos : r.mode === 'tt' ? 'TT' : 'FP';
    el.lap.textContent = r.mode === 'race' ? Math.max(1, Math.min(r.totalLaps, e.lapsDone + 1)) + ' / ' + r.totalLaps : String(Math.max(1, e.lapsDone + 1));
    const st = { grid: 'Formation', lights: 'Start procedure', running: r.mode === 'race' ? 'Race · ' + n + ' cars' : r.mode === 'tt' ? 'Time trial' : 'Free practice', finishing: 'Chequered flag' }[r.state] || '';
    el.session.textContent = e.finished ? 'Finished · P' + e.pos : st;
    el.lights.classList.toggle('hidden', !(r.state === 'grid' || r.state === 'lights'));
    this.lightEls.forEach((l, i) => l.classList.toggle('on', r.state === 'lights' && i < r.lights));
    // timing
    const cur = e.lapStart != null ? r.time - e.lapStart : null;
    el.laptime.textContent = cur != null ? fmtTime(cur) : (r.mode === 'race' ? fmtTime(0) : 'OUT LAP');
    for (let k = 0; k < 3; k++) {
      const s = el.s[k]; s.className = 'sec' + (e.sector === k && e.lapStart != null ? ' cur' : '') + (e.secState[k] ? ' ' + e.secState[k] : '');
      el.ts[k].textContent = e.curSec[k] != null ? fmtTime(e.curSec[k]) : (e.lastSec[k] != null ? fmtTime(e.lastSec[k]) : '-');
      el.ts[k].className = e.secState[k] === 'purple' ? 'ob' : e.secState[k] === 'green' ? 'pb' : '';
    }
    el.tcur.textContent = fmtTime(cur); el.tlast.textContent = fmtTime(e.lastLap); el.tbest.textContent = fmtTime(e.bestLap);
    el.tbest.className = e.bestLap != null && e.bestLap === r.bestLapAll ? 'ob' : '';
    el.ttotal.textContent = r.mode === 'race' ? fmtTime(r.raceTime) : fmtTime(r.time); el.tpen.textContent = e.penalty ? '+' + e.penalty + 's' : '-';
    // time-trial delta to personal best
    const d = G.delta();
    el.delta.classList.toggle('hidden', d == null);
    if (d != null) { el.delta.textContent = (d >= 0 ? '+' : '-') + Math.abs(d).toFixed(3); el.delta.className = 'num ' + (d < 0 ? 'neg' : 'pos'); }
    // standings
    if (r.mode === 'race') {
      el.standings.classList.remove('hidden');
      const html = r.order.map((x, i) => `<div class="${x.isPlayer ? 'me' : ''}"><span class="p">${i + 1}</span><span class="sw" style="background:${x.colorCss}"></span><span class="n">${x.code}</span><span class="g num">${i === 0 ? (x.finished ? 'FIN' : 'LEAD') : r.gapToLeader(x)}</span></div>`).join('');
      if (html !== this._stHtml) { this._stHtml = html; el.standings.innerHTML = html; } // avoid relayout when nothing changed
    } else el.standings.classList.add('hidden');
    if (G.debug) {
      const w = ph.wheels;
      el.debug.textContent =
        `FPS ${G.fps.toFixed(0)}  frame ${G.frameMs.toFixed(2)} ms  display ${G.perf.refreshHz} Hz  res x${G.resScale.toFixed(2)}\n` +
        `CPU sim ${G.perf.cpu.sim.toFixed(2)}  visuals ${G.perf.cpu.vis.toFixed(2)}  render ${G.perf.cpu.render.toFixed(2)}  total ${G.perf.cpu.total.toFixed(2)} ms\n` +
        `GPU ${G.perf.gpuMs == null ? 'n/a (timer query unavailable)' : G.perf.gpuMs.toFixed(2) + ' ms'}  physics ${Math.round(1 / G.h)} Hz\n` +
        `draw calls ${G.drawCalls || 0}  tris ${((G.drawTris || 0) / 1000).toFixed(0)}k  quality ${G.quality}\n` +
        `speed ${kmh.toFixed(1)} km/h  rpm ${rpm.toFixed(0)}  gear ${ph.engine.gear}\n` +
        `steer ${(w[0].steer * 180 / Math.PI).toFixed(1)}°  thr ${ph.input.throttle.toFixed(2)} brk ${ph.input.brake.toFixed(2)} TC ${ph.tcFactor.toFixed(2)}\n` +
        `downforce ${(ph.downforce / 1000).toFixed(2)} kN  drag ${(ph.dragF / 1000).toFixed(2)} kN  ride ${(ph.rideH * 1000).toFixed(0)} mm\n` +
        `slip κ  ${w.map(x => x.kappa.toFixed(2)).join(' ')}\n` +
        `slip α° ${w.map(x => (x.alpha * 57.3).toFixed(1)).join(' ')}\n` +
        `Fz kN   ${w.map(x => (x.Fz / 1000).toFixed(2)).join(' ')}\n` +
        `brake°C ${w.map(x => x.brakeTemp.toFixed(0)).join(' ')}\n` +
        `surface ${w.map(x => SURF_PROPS[x.surf].name).join(', ')}\n` +
        `track s ${ph.q.s.toFixed(1)} m  lateral ${ph.q.u.toFixed(2)} m  lap ${e.lapsDone + 1}  cp ${e.cpNext}\n` +
        `particles ${G.smoke.alive + G.sparks.alive}  physics steps/frame ${G.stepsLast}`;
    }
  }
}
