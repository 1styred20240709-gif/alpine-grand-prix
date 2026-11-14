
// =====================================================================
// VEHICLE DYNAMICS — 6-DOF rigid body, 4 spring-damper corners,
// combined-slip Pacejka-style tyres, engine, automatic gearbox, FWD/AWD/RWD
// drivetrains, aero (incl. active DRS wing), brakes.
// Fixed 120 Hz step, SI units throughout.
// =====================================================================
// Per-car parameters come from carPhys(spec) in 05a_cars.js (this.P).
const _tq = { s: {} };

class VehiclePhysics {
  constructor(track, P) {
    this.track = track; this.P = P;
    this.pos = new THREE.Vector3(); this.quat = new THREE.Quaternion(); this.vel = new THREE.Vector3(); this.angVel = new THREE.Vector3();
    this.prevPos = new THREE.Vector3(); this.prevQuat = new THREE.Quaternion();
    this.wheels = P.wheels.map((w, i) => ({
      ...w, i, len: P.restLen, omega: 0, spin: 0, steer: 0, Fz: 0, comp: 0, kappa: 0, alpha: 0, Fx: 0, Fy: 0, slip: 0, contact: false,
      surf: SURF.ROAD, hint: -1, brakeTemp: 120, absF: 1, locked: false, contactPt: new THREE.Vector3(), skid: 0
    }));
    this.input = { throttle: 0, brake: 0, steer: 0 };
    this.engine = { rpm: P.idle, gear: 1, shiftT: 0, shiftCool: 0, auto: true, torque: 0, limiter: false, clutch: 1, revFlag: 0 };
    this.assist = { abs: true, tc: true, bias: P.bias };
    this.tcFactor = 1; this.drs = false; this.drsAnim = 0; this.pitLimiter = false;
    this.events = []; this.sparks = []; this.collisions = [];
    this.q = { s: 0, u: 0, i: -1, y: 0 }; this.hint = -1;
    this.downforce = 0; this.dragF = 0; this.rideH = 0.06; this.floorContact = 0;
    this.time = 0; this.flipT = 0; this.lastSafe = null; this.reverseT = 0;
    this._tmp = { a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3(), d: new THREE.Vector3(), F: new THREE.Vector3(), T: new THREE.Vector3() };
    // preallocated scratch vectors: the 120-240 Hz step must not allocate (avoids GC stutter at high frame rates)
    this._s = { anchor: new THREE.Vector3(), vC: new THREE.Vector3(), force: new THREE.Vector3(), fn: new THREE.Vector3(), pa: new THREE.Vector3(), pr: new THREE.Vector3(), pv: new THREE.Vector3(), pf: new THREE.Vector3(), gyro: new THREE.Vector3() };
  }
  get speed() { return this.vel.length(); }
  get forward() { return _v1.set(0, 0, 1).applyQuaternion(this.quat); }
  placeAt(s, u, speed = 0) {
    const f = this.track.frameAt(s, u);
    // body orientation from track frame
    const m = new THREE.Matrix4().makeBasis(f.L, f.U, f.T);
    this.quat.setFromRotationMatrix(m);
    const P = this.P, w0 = this.wheels[0];
    this.pos.copy(f.pos).addScaledVector(f.U, P.cgH);
    this.vel.copy(f.T).multiplyScalar(speed); this.angVel.set(0, 0, 0);
    this.prevPos.copy(this.pos); this.prevQuat.copy(this.quat);
    this.wheels.forEach(w => { w.len = P.restLen - w.comp; w.omega = speed / w.R; w.hint = f.i; w.Fz = P.mass * 9.81 / 4; });
    this.engine.gear = 1; this.engine.rpm = P.idle; this.engine.shiftT = 0; this.hint = f.i;
    this.drs = false; this.drsAnim = 0; this.flipT = 0;
    this.track.query(this.pos.x, this.pos.z, this.hint, this.q);
  }
  // tyre model: combined-slip magic formula on normalised slip, friction ellipse
  tire(w, vx, vy, omega, Fz, mu, out) {
    const VP = this.P;
    const den = Math.max(Math.abs(vx), 3.0);
    const kappa = (omega * w.R - vx) / den;
    const alpha = Math.atan2(vy, den);
    const sx = kappa / VP.kappaPeak, sy = alpha / VP.alphaPeak, rho = Math.hypot(sx, sy);
    out.kappa = kappa; out.alpha = alpha;
    if (rho < 1e-7 || Fz <= 0) { out.Fx = 0; out.Fy = 0; out.rho = rho; return out; }
    const B = Math.tan(Math.PI / (2 * VP.C));
    const f = Math.sin(VP.C * Math.atan(B * rho));
    const sens = clamp(1 - VP.loadSens * (Fz / VP.Fz0 - 1), 0.68, 1.12);
    const F = mu * sens * Fz * f;
    out.Fx = F * (sx / rho) * 1.04; out.Fy = -F * (sy / rho); out.rho = rho;
    return out;
  }
  shift(dir) {
    const e = this.engine, VP = this.P;
    if (e.shiftCool > 0) return false;
    const g = e.gear + dir;
    if (g > VP.gears.length) return false;
    if (e.gear === 1 && dir < 0) { if (this.speedFwd() < 1.0) { e.gear = -1; this.events.push('shift'); return true; } return false; }
    if (e.gear === -1 && dir > 0) { if (this.speedFwd() > -1.0) { e.gear = 1; this.events.push('shift'); return true; } return false; }
    if (g < 1) return false;
    if (dir < 0) { // over-rev protection
      const rpmNew = this.drivenOmega() * VP.gears[g - 1] * 60 / TAU;
      if (rpmNew > VP.cutRPM - 150) { this.events.push('denied'); return false; }
    }
    e.gear = g; e.shiftT = dir > 0 ? VP.upShiftT : VP.downShiftT; e.shiftCool = 0.22;
    this.events.push(dir > 0 ? 'upshift' : 'downshift');
    if (dir < 0 && this.input.throttle < 0.2) this.events.push('backfire');
    return true;
  }
  rearOmega() { return (this.wheels[2].omega + this.wheels[3].omega) / 2; }
  // gearbox-side wheel speed, weighted by the front/rear torque split
  drivenOmega() { const f = this.P.driveFront; return f * (this.wheels[0].omega + this.wheels[1].omega) / 2 + (1 - f) * this.rearOmega(); }
  speedFwd() { return this.vel.dot(this.forward); }
  step(dt) {
    if (!this.lastSafe || this.time % 1 < dt) this.lastSafe = { s: this.q.s, u: clamp(this.q.u, -this.q.halfW + 2, this.q.halfW - 2) };
    this.time += dt;
    this.prevPos.copy(this.pos); this.prevQuat.copy(this.quat);
    const T = this._tmp, inp = this.input, e = this.engine, VP = this.P, CAR = this.P;
    const X = T.a.set(1, 0, 0).applyQuaternion(this.quat), Y = T.b.set(0, 1, 0).applyQuaternion(this.quat), Z = T.c.set(0, 0, 1).applyQuaternion(this.quat), SC = this._s;
    const F = T.F.set(0, -9.81 * VP.mass, 0), Tq = T.T.set(0, 0, 0);
    const vFwd = this.vel.dot(Z), speed = this.vel.length();
    const addForce = (f, p) => { F.add(f); _v3.subVectors(p, this.pos); Tq.add(_v2.crossVectors(_v3, f)); };
    // ---------------- steering (Ackermann)
    const steer = inp.steer * VP.maxSteer;
    const wb = CAR.frontAxle - CAR.rearAxle;
    const ack = (x) => { if (Math.abs(steer) < 1e-4) return steer; const R = wb / Math.tan(Math.abs(steer)); return Math.sign(steer) * Math.atan(wb / Math.max(0.5, R - Math.sign(steer) * x)); };
    this.wheels[0].steer = ack(CAR.xF); this.wheels[1].steer = ack(-CAR.xF); this.wheels[2].steer = 0; this.wheels[3].steer = 0;
    // ---------------- suspension
    const anchor = SC.anchor, gq = _tq.s;
    for (const w of this.wheels) {
      anchor.set(w.x, w.anchorY, w.z).applyQuaternion(this.quat).add(this.pos);
      this.track.query(anchor.x, anchor.z, w.hint, gq); w.hint = gq.i;
      const sp = SURF_PROPS[gq.surf];
      let gy = gq.y;
      if (sp.bump > 0) gy += sp.bump * NOISE.noise(anchor.x * 1.7, anchor.z * 1.7);
      w.surf = gq.surf; w.n = w.n || new THREE.Vector3(); w.n.set(gq.nx, gq.ny, gq.nz);
      const denom = Y.dot(w.n);
      const dist = denom > 0.3 ? (anchor.y - gy) * w.n.y / denom : 99;
      let L = dist - w.R;
      const prevLen = w.len;
      if (L > VP.maxLen) { w.contact = false; w.len = Math.min(VP.maxLen, prevLen + 1.5 * dt); w.Fs = 0; w.comp = 0; }
      else {
        w.contact = true;
        let bump = 0; if (L < 0.0) { bump = -L * VP.bumpStop; L = 0; }
        const comp = VP.restLen - L, cv = (prevLen - L) / dt;
        let Fs = VP.k[w.i] * comp + (cv > 0 ? VP.cBump : VP.cReb) * cv + bump;
        w.Fs = Math.max(0, Fs); w.len = L; w.comp = comp;
      }
      w.anchor = (w.anchor || new THREE.Vector3()).copy(anchor);
      w.contactPt.copy(anchor).addScaledVector(Y, -(w.len + w.R));
    }
    // anti-roll bars
    const arb = (a, b, k) => { if (!a.contact || !b.contact) return; const f = (a.comp - b.comp) * k; a.Fs = Math.max(0, a.Fs + f); b.Fs = Math.max(0, b.Fs - f); };
    arb(this.wheels[0], this.wheels[1], VP.arbF); arb(this.wheels[2], this.wheels[3], VP.arbR);
    // ---------------- engine & drivetrain torque
    if (e.shiftT > 0) e.shiftT -= dt; if (e.shiftCool > 0) e.shiftCool -= dt;
    // reverse request: brake held at standstill
    {
      if (e.gear >= 1 && inp.brake > 0.5 && inp.throttle < 0.05 && Math.abs(vFwd) < 0.4) { this.reverseT += dt; if (this.reverseT > 0.6 && this.allowReverse) { e.gear = -1; this.reverseT = 0; this.events.push('shift'); } }
      else if (e.gear === -1 && inp.throttle > 0.1 && vFwd > -1.0) { e.gear = 1; this.events.push('shift'); this.reverseT = 0; }
      else this.reverseT = 0;
    }
    const rev = e.gear === -1;
    const thr = rev ? inp.brake : inp.throttle, brk = rev ? inp.throttle : inp.brake;
    const ratio = rev ? -VP.reverse : VP.gears[e.gear - 1];
    const rpmWheel = this.drivenOmega() * ratio * 60 / TAU;
    // clutch: slips below ~6000 rpm equivalent so the car can launch
    let rpm;
    const launchRPM = VP.idle + thr * 0.42 * VP.cutRPM; // torque-converter / launch-control style slip
    if (rpmWheel < launchRPM && thr > 0.02) { rpm = lerp(e.rpm, Math.max(rpmWheel, launchRPM), 1 - Math.exp(-12 * dt)); e.clutch = clamp(rpmWheel / launchRPM, 0, 1); }
    else { rpm = Math.max(rpmWheel, thr > 0.02 ? 0 : VP.idle * 0.95); e.clutch = 1; }
    if (rpmWheel < VP.idle * 0.95 && thr <= 0.02) rpm = lerp(e.rpm, VP.idle, 1 - Math.exp(-8 * dt));
    e.rpm = clamp(rpm, 0, 14000);
    // pit lane speed limiter + traction control
    let thrEff = thr;
    if (this.pitLimiter && speed > PIT.limit) thrEff = Math.min(thrEff, clamp(1 - (speed - PIT.limit) * 0.8, 0, 1));
    if (this.assist.tc && !rev) thrEff *= this.tcFactor;
    if (speed > VP.vmax) thrEff = Math.min(thrEff, clamp(1 - (speed - VP.vmax) * 0.6, 0, 1)); // electronic top-speed limiter
    let Te = engineTorqueOf(VP.torque, e.rpm) * thrEff - (1 - thr) * (10 + e.rpm * 0.006);
    e.limiter = e.rpm >= VP.cutRPM;
    if (e.limiter) Te = Math.min(Te, -20);
    if (e.shiftT > 0) Te = 0;
    if (rpmWheel < VP.idle * 0.95 && thr <= 0.02) Te = 0; // clutch open at very low speed
    e.torque = Te;
    const driveTotal = Te * ratio * VP.eff;
    // ---------------- brakes
    const bias = this.assist.bias;
    const bf = brk * VP.brakeTotal * bias / 2, br = brk * VP.brakeTotal * (1 - bias) / 2;
    // ---------------- per-wheel tyre forces + wheel spin integration
    const tout = { Fx: 0, Fy: 0, kappa: 0, alpha: 0, rho: 0 }, tout2 = { Fx: 0, Fy: 0, kappa: 0, alpha: 0, rho: 0 };
    let rearSlip = 0;
    const mEff = VP.mass / 4 * 0.85;
    for (const w of this.wheels) {
      const I = VP.wheelI[w.i];
      let Tdrive = 0;
      // torque split front/rear, then left/right through a limited-slip coupling
      const share = w.front ? VP.driveFront : 1 - VP.driveFront;
      if (share > 0) {
        const a = w.front ? this.wheels[0] : this.wheels[2], b = w.front ? this.wheels[1] : this.wheels[3];
        const diffLock = (a.omega - b.omega) * 30;
        Tdrive = driveTotal * share / 2 + (w === a ? -diffLock : diffLock);
      }
      w.absF = Math.min(1, w.absF + dt * 7);
      const Tb = (w.front ? bf : br) * (this.assist.abs ? w.absF : 1) + (this.holdBrake ? 3000 : 0);
      if (!w.contact) {
        let om = w.omega + dt * Tdrive / I;
        const bi = Tb * dt / I; om = Math.abs(om) <= bi ? 0 : om - Math.sign(om) * bi;
        w.omega = om * (1 - 0.2 * dt); w.Fx = w.Fy = 0; w.Fz = 0; w.slip = 0; w.kappa = 0; w.alpha = 0; w.spin += w.omega * dt; continue;
      }
      const n = w.n;
      // wheel heading projected on the ground plane
      const cs = Math.cos(w.steer), sn = Math.sin(w.steer);
      const fdir = _v1.copy(Z).multiplyScalar(cs).addScaledVector(X, sn); fdir.addScaledVector(n, -fdir.dot(n)).normalize();
      const sdir = _v2.crossVectors(n, fdir).normalize();
      const r = _v3.subVectors(w.contactPt, this.pos);
      const vC = SC.vC.crossVectors(this.angVel, r).add(this.vel);
      const vx = vC.dot(fdir), vy = vC.dot(sdir);
      const sp = SURF_PROPS[w.surf];
      let mu = VP.mu[w.i] * (sp.mu < 0.6 ? Math.min(0.8, sp.mu * VP.offroad) : sp.mu); // rally car: gravel/grass grip
      if (sp.noise > 0) mu *= 1 + sp.noise * NOISE.noise(this.time * 2.3 + w.i * 13.1, w.contactPt.x * 0.3);
      const Fz = w.Fs; w.Fz = Fz;
      this.tire(w, vx, vy, w.omega, Fz, mu, tout);
      // ABS: release pressure when the tyre goes past the slip peak
      if (this.assist.abs && brk > 0.05 && tout.kappa < -VP.kappaPeak * 1.25 && Math.abs(vx) > 3) w.absF = Math.max(0.25, w.absF - dt * 35);
      // fully implicit wheel spin: solve I(w'-w)/dt = Tdrive + Tbrake - R*Fx(w') by bisection.
      // r(w') is monotonic, so this is unconditionally stable even with very stiff tyres.
      const solve = (Tbr) => {
        let lo = w.omega - 320, hi = w.omega + 320;
        for (let it = 0; it < 26; it++) {
          const mid = (lo + hi) * 0.5; this.tire(w, vx, vy, mid, Fz, mu, tout2);
          const r = I * (mid - w.omega) / dt - Tdrive - Tbr + w.R * tout2.Fx;
          if (r > 0) hi = mid; else lo = mid;
        }
        return (lo + hi) * 0.5;
      };
      let om;
      if (Tb <= 0) om = solve(0);
      else {
        const sg = Math.sign(w.omega);
        om = sg !== 0 ? solve(-sg * Tb) : NaN;
        if (!(sg !== 0 && Math.sign(om) === sg)) {
          // crossed (or sitting at) zero: can the brake hold the wheel locked this step?
          this.tire(w, vx, vy, 0, Fz, mu, tout2);
          const Treq = I * (0 - w.omega) / dt - Tdrive + w.R * tout2.Fx;
          om = Treq > Tb ? solve(Tb) : Treq < -Tb ? solve(-Tb) : 0;
        }
      }
      w.omega = clamp(om, -400, 600); w.locked = Tb > 0 && Math.abs(w.omega) < 0.5 && Math.abs(vx) > 2;
      w.spin += w.omega * dt;
      this.tire(w, vx, vy, w.omega, Fz, mu, tout); // forces consistent with the new wheel speed
      // impulse clamp at low speed (prevents jitter when parked)
      let Fx = tout.Fx, Fy = tout.Fy;
      const capY = Math.abs(vy) * mEff / dt; if (Math.abs(Fy) > capY && speed < 6) Fy = Math.sign(Fy) * capY;
      const capX = Math.abs(w.omega * w.R - vx) * mEff / dt; if (Math.abs(Fx) > capX && speed < 6) Fx = Math.sign(Fx) * capX;
      // rolling resistance and surface drag
      const rr = (sp.rr * Fz + sp.drag * Fz * clamp(Math.abs(vx) / 4, 0, 1)) * Math.sign(vx) * clamp(Math.abs(vx) * 4, 0, 1);
      Fx -= rr;
      w.Fx = Fx; w.Fy = Fy; w.kappa = tout.kappa; w.alpha = tout.alpha; w.slip = tout.rho;
      if ((w.front ? VP.driveFront : 1 - VP.driveFront) > 0.05) rearSlip = Math.max(rearSlip, tout.kappa); // driven-wheel slip for TC
      const app = _v3.copy(w.contactPt).addScaledVector(Y, 0.06);
      const force = SC.force.copy(fdir).multiplyScalar(Fx).addScaledVector(sdir, Fy);
      addForce(force, app);
      addForce(SC.fn.copy(n).multiplyScalar(w.Fs), w.anchor); // normal load acts along the contact normal
      // skid intensity for effects
      const slideV = Math.hypot(vy, (w.omega * w.R - vx));
      w.skid = clamp((tout.rho - 1.15) * 0.8, 0, 1) * clamp(slideV / 4, 0, 1);
      // brake heat
      const P = Tb * Math.abs(w.omega);
      w.brakeTemp += (P / 900 - (w.brakeTemp - 25) * (0.06 + 0.0042 * speed)) * dt;
    }
    // stability control (ESC, on with TC): when the body slip angle grows, apply a yaw moment that
    // opposes the slide (individual-wheel braking in the real system) and trim the throttle
    this.escActive = false;
    if (this.assist.tc && speed > 6) {
      const vLat = this.vel.dot(X), beta = Math.atan2(vLat, Math.max(Math.abs(vFwd), 1));
      const yawRate = this.angVel.dot(Y), over = Math.abs(beta) - 0.07;
      if (over > 0 && Math.sign(yawRate) === -Math.sign(beta)) { // oversteer: the yaw rotation is growing the slide
        Tq.addScaledVector(Y, -Math.sign(yawRate) * Math.min(over * 9, 1) * VP.mass * 4.5);
        this.tcFactor = Math.min(this.tcFactor, clamp(1 - over * 6, 0.2, 1)); this.escActive = true;
      }
    }
    // traction control
    if (this.assist.tc) { if (rearSlip > VP.kappaPeak * 1.15) this.tcFactor = Math.max(0.15, this.tcFactor - dt * 9); else this.tcFactor = Math.min(1, this.tcFactor + dt * 3); }
    else this.tcFactor = 1;
    // ---------------- aerodynamics
    this.drsAnim = clamp(this.drsAnim + (this.drs ? dt : -dt) * 5, 0, 1);
    const v2 = vFwd * Math.abs(vFwd) > 0 ? vFwd * vFwd : 0;
    const w0 = this.wheels[0], w2 = this.wheels[2];
    this.rideH = ((w0.len + w0.R - w0.anchorY) + (w2.len + w2.R - w2.anchorY)) / 2 - (CAR.cgH - VP.floorClear); // floor clearance
    const geF = 1;
    const q = 0.5 * VP.rho * v2;
    const ClRear = VP.ClA * (1 - VP.aeroBal) * (1 - VP.drsCl * this.drsAnim); // DRS flattens the wing: less rear downforce
    const DfF = q * VP.ClA * VP.aeroBal * geF, DfR = q * ClRear * geF;
    this.downforce = DfF + DfR;
    addForce(_v1.copy(Y).multiplyScalar(-DfF), SC.pa.set(0, 0, CAR.frontAxle).applyQuaternion(this.quat).add(this.pos));
    addForce(_v1.copy(Y).multiplyScalar(-DfR), SC.pa.set(0, 0, CAR.rearAxle).applyQuaternion(this.quat).add(this.pos));
    const CdA = VP.CdA - VP.drsCd * this.drsAnim;
    if (speed > 0.01) { const drag = 0.5 * VP.rho * CdA * speed * speed; this.dragF = drag; F.addScaledVector(this.vel, -drag / speed); }
    // aerodynamic damping of rotations
    Tq.addScaledVector(this.angVel, -(60 + speed * 6));
    // ---------------- underfloor contact (plank) -> sparks
    this.floorContact = 0;
    if (!this._plank) this._plank = [[0, VP.frontAxle - 0.25], [0, 0], [0, VP.rearAxle + 0.25], [0.6, 0], [-0.6, 0]];
    for (const [px, pz] of this._plank) {
      const p = _v1.set(px, -CAR.cgH + VP.floorClear, pz).applyQuaternion(this.quat).add(this.pos);
      this.track.query(p.x, p.z, this.hint, gq);
      const pen = gq.y - p.y;
      if (pen > 0) {
        const n = _v2.set(gq.nx, gq.ny, gq.nz);
        const r = SC.pr.subVectors(p, this.pos);
        const vp = SC.pv.crossVectors(this.angVel, r).add(this.vel);
        const vn = vp.dot(n);
        const fN = pen * 260000 + Math.max(0, -vn) * 9000;
        const fv = SC.pf.copy(n).multiplyScalar(fN);
        const vt = vp.addScaledVector(n, -vn); const vtl = vt.length();
        if (vtl > 0.1) fv.addScaledVector(vt, -0.35 * fN / vtl);
        addForce(fv, p);
        this.floorContact = Math.max(this.floorContact, pen);
        if (vtl > 8) this.sparks.push({ p: p.clone(), v: this.vel.clone(), n: 1 });
      }
    }
    // ---------------- integrate (semi-implicit Euler)
    this.vel.addScaledVector(F, dt / VP.mass);
    const qi = _q.copy(this.quat).invert();
    const tb = _v1.copy(Tq).applyQuaternion(qi);
    const wb_ = _v2.copy(this.angVel).applyQuaternion(qi);
    const Iw = _v3.set(VP.I.x * wb_.x, VP.I.y * wb_.y, VP.I.z * wb_.z);
    const gyro = SC.gyro.crossVectors(wb_, Iw);
    wb_.x += dt * (tb.x - gyro.x) / VP.I.x; wb_.y += dt * (tb.y - gyro.y) / VP.I.y; wb_.z += dt * (tb.z - gyro.z) / VP.I.z;
    this.angVel.copy(wb_).applyQuaternion(this.quat);
    if (this.angVel.length() > 12) this.angVel.setLength(12);
    this.pos.addScaledVector(this.vel, dt);
    const w = this.angVel, dq = _q.set(w.x * dt * 0.5, w.y * dt * 0.5, w.z * dt * 0.5, 0).multiply(this.quat);
    this.quat.x += dq.x; this.quat.y += dq.y; this.quat.z += dq.z; this.quat.w += dq.w; this.quat.normalize();
    // ---------------- track position + barriers
    this.track.query(this.pos.x, this.pos.z, this.hint, this.q); this.hint = this.q.i;
    this.pitLimiter = this.q.u > PIT.laneIn - 0.5 && this.track.inRange(this.q.s, this.track.pit.limitStart, this.track.pit.limitEnd) && this.track.mainStraight[this.q.i];
    this._barriers(dt);
    // ---------------- gearbox automation
    if (e.auto && e.shiftT <= 0 && e.shiftCool <= 0 && e.gear >= 1) {
      const up = e.gear < VP.gears.length && e.rpm > VP.upRPM && thr > 0.1 && this.drivenOmega() * w2.R > 4;
      const lowerRpm = e.gear > 1 ? this.drivenOmega() * VP.gears[e.gear - 2] * 60 / TAU : 99999;
      // automatic: kick down when the driver asks for power, hold revs for engine braking under braking
      const downThresh = (brk > 0.1 ? 0.62 : thr > 0.6 ? 0.72 : 0.45) * VP.upRPM;
      const rpmNow = Math.max(e.rpm * (e.clutch < 1 ? 0 : 1), this.drivenOmega() * VP.gears[e.gear - 1] * 60 / TAU);
      if (up) this.shift(1);
      else if (e.gear > 1 && rpmNow < downThresh && lowerRpm < VP.upRPM - 250) this.shift(-1);
    }
    // ---------------- safety: NaN guard, flip detection
    if (!fin(this.pos.x) || !fin(this.vel.x) || !fin(this.quat.w) || !fin(this.angVel.x)) { this.reset(); this.events.push('nan'); }
    const upY = _v1.set(0, 1, 0).applyQuaternion(this.quat).y;
    if (upY < 0.35) { this.flipT += dt; if (this.flipT > 1.5) this.reset(); } else this.flipT = 0;
    if (this.pos.y < this.q.y - 3) this.reset();
  }
  _barriers(dt) {
    const VP = this.P;
    if (!this._outline) { const h = VP.width / 2; this._outline = [[h, VP.frontAxle], [-h, VP.frontAxle], [h, VP.rearAxle], [-h, VP.rearAxle], [h * 0.9, VP.zFront - 0.15], [-h * 0.9, VP.zFront - 0.15], [h * 0.9, VP.zRear + 0.12], [-h * 0.9, VP.zRear + 0.12], [h, 0], [-h, 0], [0, VP.zFront]]; }
    const pts = this._outline;
    const centreU = this.q.u, gq = _tq.s;
    if (!this._bh) this._bh = new Array(pts.length).fill(-1);
    for (let k = 0; k < pts.length; k++) {
      const p = _v1.set(pts[k][0], 0, pts[k][1]).applyQuaternion(this.quat).add(this.pos);
      this.track.query(p.x, p.z, this._bh[k] >= 0 ? this._bh[k] : this.hint, gq); this._bh[k] = gq.i;
      const lh = Math.hypot(gq.lx, gq.lz), lx = gq.lx / lh, lz = gq.lz / lh;
      let pen = 0, nx = 0, nz = 0;
      if (gq.u > gq.wallL) { pen = (gq.u - gq.wallL) * lh; nx = -lx; nz = -lz; }
      else if (gq.u < -gq.wallR) { pen = (-gq.wallR - gq.u) * lh; nx = lx; nz = lz; }
      else if (gq.pitWall) {
        if (centreU < PIT.wallU + 0.25 && gq.u > PIT.wallU) { pen = (gq.u - PIT.wallU) * lh; nx = -lx; nz = -lz; }
        else if (centreU >= PIT.wallU + 0.25 && gq.u < PIT.wallU + 0.5) { pen = (PIT.wallU + 0.5 - gq.u) * lh; nx = lx; nz = lz; }
      }
      if (pen <= 0) continue;
      const n = new THREE.Vector3(nx, 0, nz);
      const r = new THREE.Vector3().subVectors(p, this.pos);
      const vp = new THREE.Vector3().crossVectors(this.angVel, r).add(this.vel);
      const vn = vp.dot(n);
      this.pos.addScaledVector(n, Math.min(pen, 0.5) * 0.9);
      if (vn < 0) {
        const rn = new THREE.Vector3().crossVectors(r, n);
        const qi = _q.copy(this.quat).invert();
        const rnb = rn.clone().applyQuaternion(qi); rnb.set(rnb.x / VP.I.x, rnb.y / VP.I.y, rnb.z / VP.I.z).applyQuaternion(this.quat);
        const k = 1 / VP.mass + new THREE.Vector3().crossVectors(rnb, r).dot(n);
        const j = -(1 + 0.25) * vn / k;
        const vt = vp.clone().addScaledVector(n, -vn); const vtl = vt.length();
        const imp = n.clone().multiplyScalar(j); if (vtl > 0.01) imp.addScaledVector(vt, -Math.min(0.3 * j, vtl * VP.mass * 0.5) / vtl);
        this.applyImpulse(imp, p);
        if (-vn > 1.5) this.collisions.push({ p: p.clone(), v: -vn, n: n.clone() });
      }
    }
  }
  applyImpulse(imp, p) {
    const VP = this.P;
    this.vel.addScaledVector(imp, 1 / VP.mass);
    const r = _v3.subVectors(p, this.pos); const ang = new THREE.Vector3().crossVectors(r, imp);
    const qi = _q.copy(this.quat).invert(); ang.applyQuaternion(qi); ang.set(ang.x / VP.I.x, ang.y / VP.I.y, ang.z / VP.I.z).applyQuaternion(this.quat);
    this.angVel.add(ang);
  }
  reset() {
    const s = this.lastSafe ? this.lastSafe.s : this.q.s;
    this.placeAt(s, this.lastSafe ? this.lastSafe.u : 0, 0);
    this.events.push('reset');
  }
  resetToTrack() {
    this.track.query(this.pos.x, this.pos.z, this.hint, this.q);
    const u = clamp(this.q.u, -this.q.halfW + 2.5, this.q.halfW - 2.5);
    this.placeAt(this.q.s, u, 0); this.events.push('reset');
  }
  modelState(alpha, out) {
    out.hubY = out.hubY || [0, 0, 0, 0]; out.steer = out.steer || [0, 0, 0, 0]; out.spin = out.spin || [0, 0, 0, 0]; out.brakeTemp = out.brakeTemp || [0, 0, 0, 0];
    const VP = this.P; this.wheels.forEach((w, i) => { out.hubY[i] = VP.cgH + w.anchorY - w.len; out.steer[i] = w.steer; out.spin[i] = w.spin; out.brakeTemp[i] = w.brakeTemp; });
    out.steerWheel = -this.input.steer * 2.6; out.drs = this.drsAnim; out.braking = this.input.brake > 0.1;
    out.rpm = this.engine.rpm; out.gear = this.engine.gear === -1 ? 'R' : String(this.engine.gear); out.speedKmh = this.speed * 3.6;
    return out;
  }
}

// =====================================================================
// AI DRIVER — kinematic bicycle model with grip limits, racing line,
// braking points from a speed profile, overtaking and avoidance.
// =====================================================================
const AI_PROFILES = new Map();
class AICar {
  constructor(track, opts) {
    this.track = track; this.opts = opts; this.P = opts.P;
    this.skill = opts.skill;
    const mu = Math.round(this.P.mu[2] * 0.97 * this.skill * 100) / 100, key = this.P.id + ':' + mu;
    if (!AI_PROFILES.has(key)) AI_PROFILES.set(key, track.speedProfile(mu, this.P));
    this.profile = AI_PROFILES.get(key); this.mu = mu;
    this.pos = new THREE.Vector3(); this.prevPos = new THREE.Vector3(); this.quat = new THREE.Quaternion(); this.prevQuat = new THREE.Quaternion();
    this.heading = 0; this.v = 0; this.latV = 0; this.steer = 0; this.acc = 0; this.yawRate = 0;
    this.q = { i: -1 }; this.hint = -1; this.offset = 0; this.offsetTarget = 0; this.spin = 0;
    this.reaction = 0.18 + Math.random() * 0.3; this.stuckT = 0; this.drs = false; this.drsAnim = 0;
    this.throttle = 0; this.brake = 0; this.rpm = this.P.idle; this.gear = 1; this.brakeTemp = [120, 120, 120, 120];
    this.hubY = this.P.wheels.map(w => w.R);
    this.mass = this.P.mass; this.events = []; this.radius = 1.0; this.mistakeT = 0;
  }
  get speed() { return Math.abs(this.v); }
  placeAt(s, u) {
    const f = this.track.frameAt(s, u);
    this.pos.copy(f.pos).addScaledVector(f.U, this.P.cgH); this.heading = f.heading; this.v = 0; this.latV = 0;
    this.offset = u - this.track.sampleVal(this.track.rl, s); this.offsetTarget = this.offset;
    this.hint = f.i; this.track.query(this.pos.x, this.pos.z, this.hint, this.q); this._orient(0, 0);
    this.prevPos.copy(this.pos); this.prevQuat.copy(this.quat);
  }
  _orient(longAcc, latAcc) {
    const q = this.q;
    const n = _v1.set(q.nx, q.ny, q.nz);
    const f = _v2.set(Math.sin(this.heading), 0, Math.cos(this.heading)); f.addScaledVector(n, -f.dot(n)).normalize();
    const l = _v3.crossVectors(n, f).normalize();
    _m4.makeBasis(l, n, f); this.quat.setFromRotationMatrix(_m4);
    const pitch = clamp(-longAcc * 0.0035, -0.03, 0.03), roll = clamp(latAcc * 0.0028, -0.035, 0.035);
    this.quat.multiply(_q.setFromEuler(_e.set(pitch, 0, roll)));
  }
  step(dt, ctx) {
    const tr = this.track, VP = this.P, CAR = this.P; this.prevPos.copy(this.pos); this.prevQuat.copy(this.quat);
    tr.query(this.pos.x, this.pos.z, this.hint, this.q); this.hint = this.q.i;
    const q = this.q, s = q.s, L = tr.length;
    const running = ctx.running && ctx.raceTime > this.reaction;
    // ---- lane choice: racing line + offset for overtaking / avoidance
    let want = 0, block = Infinity, blockV = 0;
    for (const o of ctx.cars) {
      if (o === this) continue;
      let ds = o.q.s - s; if (ds > L / 2) ds -= L; if (ds < -L / 2) ds += L;
      const du = o.q.u - q.u;
      if (ds > 0 && ds < 32 && Math.abs(du) < 2.6) {
        if (ds < block) { block = ds; blockV = o.speed; }
        const hw = q.halfW - 1.6;
        const roomL = hw - o.q.u, roomR = o.q.u + hw;
        const nextK = tr.kappaS[(q.i + 60) % tr.N];
        const prefer = Math.abs(nextK) > 1 / 300 ? Math.sign(nextK) : (roomL > roomR ? 1 : -1);
        const side = (prefer > 0 && roomL > 3.2) || (prefer < 0 && roomR < 3.2) ? 1 : -1;
        want = clamp(o.q.u + side * 3.3, -hw, hw) - tr.sampleVal(tr.rl, s + 25);
      }
      if (Math.abs(ds) < 6 && Math.abs(du) < 2.4) want += (du > 0 ? -1 : 1) * (2.4 - Math.abs(du));
    }
    this.offsetTarget = lerp(this.offsetTarget, want, 1 - Math.exp(-dt * 1.2));
    this.offset = lerp(this.offset, this.offsetTarget, 1 - Math.exp(-dt * 2.0));
    // ---- pure pursuit steering
    const look = 9 + this.speed * 0.42;
    const ts = s + look, ti = tr.idxAt(ts);
    const hw = tr.sampleVal(tr.halfW, ts) - 1.3;
    const offTrack = Math.abs(q.u) > q.halfW + 0.8;
    const lane = clamp(tr.sampleVal(tr.rl, ts) + this.offset, -hw, hw);
    const tf = tr.frameAt(ts, offTrack ? clamp(lane, -2, 2) : lane, this._tf || (this._tf = { reuse: true }));
    const dx = tf.pos.x - this.pos.x, dz = tf.pos.z - this.pos.z;
    let ang = Math.atan2(dx, dz) - this.heading; while (ang > Math.PI) ang -= TAU; while (ang < -Math.PI) ang += TAU;
    const wb = CAR.frontAxle - CAR.rearAxle;
    let steer = Math.atan(2 * wb * Math.sin(ang) / Math.max(look, 1));
    steer = clamp(steer, -0.5, 0.5);
    this.steer = lerp(this.steer, steer, 1 - Math.exp(-dt * 10));
    // ---- speed target from the braking profile
    const pi = tr.idxAt(s + this.speed * 0.12 + 4);
    let vt = this.profile[pi];
    const inDrs = ctx.drsZoneAt && ctx.drsZoneAt(s) >= 0 && this.drsEligible;
    this.drs = inDrs && this.brake < 0.1; this.drsAnim = clamp(this.drsAnim + (this.drs ? dt : -dt) * 5, 0, 1);
    if (this.drs) vt *= 1.035;
    if (block < 14 && blockV < vt) vt = Math.min(vt, blockV + (block - 6) * 0.5);
    const surf = SURF_PROPS[q.surf];
    if (offTrack) vt = Math.min(vt, 24);
    if (ctx.pitLimit && q.u > PIT.laneIn && tr.inRange(s, tr.pit.limitStart, tr.pit.limitEnd)) vt = Math.min(vt, PIT.limit - 1);
    if (!running) vt = 0;
    // ---- longitudinal dynamics
    const g = 9.81, ka = 0.5 * VP.rho * VP.ClA / VP.mass, drag = 0.5 * VP.rho * (VP.CdA - (this.drs ? VP.drsCd : 0)) * this.v * this.v / VP.mass;
    const muS = this.mu * (surf.mu < 0.6 ? Math.min(0.8, surf.mu * (VP.offroad || 1)) : surf.mu);
    const brakeMax = muS * 0.95 * (g + ka * this.v * this.v) + drag;
    const tractionShare = VP.driveFront >= 0.99 ? 0.6 : VP.driveFront > 0.05 ? 0.95 : 0.62; // FWD / AWD / RWD launch grip
    const accMax = Math.min(muS * g * tractionShare, VP.peakPower / (VP.mass * Math.max(this.v, 4))) - drag - surf.drag * g * 0.5;
    vt = Math.min(vt, VP.vmax);
    let a = clamp((vt - this.v) * 3.0, -brakeMax, accMax);
    if (!running && this.v < 0.5) { a = 0; this.v = 0; }
    this.throttle = a > 0 ? clamp(a / Math.max(accMax, 0.1), 0, 1) : 0; this.brake = a < 0 ? clamp(-a / brakeMax, 0, 1) : 0;
    this.v = Math.max(0, this.v + a * dt); this.acc = a;
    // ---- lateral dynamics with grip limit (understeer when exceeded)
    const yawWanted = this.v * Math.tan(this.steer) / wb;
    const latMax = muS * (g + ka * this.v * this.v);
    const yawMax = latMax / Math.max(this.v, 1);
    this.yawRate = clamp(yawWanted, -yawMax, yawMax);
    this.heading += this.yawRate * dt;
    this.latV *= Math.exp(-dt * 3.5);
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    this.pos.x += (fx * this.v + fz * this.latV) * dt; this.pos.z += (fz * this.v - fx * this.latV) * dt;
    // ---- barriers (same lateral collision model as the player)
    tr.query(this.pos.x, this.pos.z, this.hint, this.q);
    const lim = this.q.u > 0 ? this.q.wallL - 1.0 : this.q.wallR - 1.0;
    if (Math.abs(this.q.u) > lim) {
      const lh = Math.hypot(this.q.lx, this.q.lz), sg = Math.sign(this.q.u), pen = (Math.abs(this.q.u) - lim) * lh;
      this.pos.x -= sg * this.q.lx / lh * pen; this.pos.z -= sg * this.q.lz / lh * pen; this.v *= 0.97;
    }
    // height follows the road surface
    this.pos.y = this.q.y + CAR.cgH;
    this._orient(a, this.v * this.yawRate);
    // ---- visual / audio state
    const Rw = VP.wheels[2].R;
    this.spin += this.v / Rw * dt;
    const wheelRpm = this.v / Rw * 60 / TAU, ng = VP.gears.length;
    let g8 = 1; for (let k = 0; k < ng; k++) { if (wheelRpm * VP.gears[k] < VP.upRPM * 0.97) { g8 = k + 1; break; } g8 = ng; }
    if (this.v < 2) g8 = 1;
    if (g8 < this.gear && this.throttle < 0.1) this.events.push('backfire');
    this.gear = g8; this.rpm = Math.max(VP.idle, wheelRpm * VP.gears[g8 - 1]);
    for (let k = 0; k < 4; k++) {
      const P = this.brake * VP.brakeTotal * (k < 2 ? VP.bias : 1 - VP.bias) / 2 * this.v / VP.wheels[k].R;
      this.brakeTemp[k] += (P / 900 - (this.brakeTemp[k] - 25) * (0.06 + 0.0042 * this.v)) * dt;
      this.hubY[k] = VP.wheels[k].R + clamp(-a * 0.0006 * (k < 2 ? 1 : -1), -0.01, 0.01) + (SURF_PROPS[this.q.surf].bump * 0.6) * Math.sin(this.spin * 3 + k);
    }
    // ---- stuck / recovery
    if (running && this.v < 2) { this.stuckT += dt; if (this.stuckT > 3.5) { this.placeAt(this.q.s + 5, tr.sampleVal(tr.rl, this.q.s + 5)); this.v = 8; this.stuckT = 0; } }
    else this.stuckT = 0;
  }
  // impulse from collisions (world space horizontal vector, N*s)
  applyImpulse(imp) {
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    const dvF = (imp.x * fx + imp.z * fz) / this.mass, dvL = (imp.x * fz - imp.z * fx) / this.mass;
    this.v = Math.max(0, this.v + dvF); this.latV += dvL;
  }
  velocity(out) { const fx = Math.sin(this.heading), fz = Math.cos(this.heading); return out.set(fx * this.v + fz * this.latV, 0, fz * this.v - fx * this.latV); }
  modelState(out) {
    out.hubY = this.hubY; out.steer = out.steer || [0, 0, 0, 0]; out.spin = out.spin || [0, 0, 0, 0];
    for (let k = 0; k < 4; k++) { out.steer[k] = k < 2 ? this.steer : 0; out.spin[k] = this.spin; }
    out.brakeTemp = this.brakeTemp; out.steerWheel = -this.steer * 2.6; out.drs = this.drsAnim; out.braking = this.brake > 0.1;
    out.rpm = this.rpm; out.gear = String(this.gear); out.speedKmh = this.v * 3.6;
    return out;
  }
}
