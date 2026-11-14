
// =====================================================================
// CAR LINE-UP — four road cars, all shifting automatically
// Public figures (power, torque, kerb mass, dimensions, gearbox, drivetrain,
// top speed) plus engineering estimates where nothing is published (aero
// coefficients, spring rates, tyre grip). Model space: y up from the ground,
// z forward from the centre of gravity, +x = the car's left.
// No manufacturer logos or badges are reproduced.
// =====================================================================
const CAR_SPECS = {
  i30n: {
    id: 'i30n', name: 'Hyundai i30 N DCT', short: 'i30 N', code: 'I30',
    blurb: '2.0 turbo I4 · 280 PS · 392 Nm · 8-speed wet DCT · front-wheel drive with e-LSD',
    stats: { ps: 280, nm: 392, kg: 1480, drive: 'FWD', gearbox: '8-speed DCT', top: 250, zero100: 5.4 },
    color: 0x86afd9, accent: 0xe0102b, trim: 0x111214, lamp: 0xf4f8ff, helmet: 0xffffff, rimColor: 0x2c2e33, caliper: 0xd2112b,
    mass: 1480, cyl: 4, driveFront: 1.0, vmaxKmh: 250, gearboxLabel: '8-SPD DCT', drs: false,
    dims: { wb: 2.65, frontWeight: 0.61, cgH: 0.53, trackF: 1.572, trackR: 1.586, rF: 0.323, rR: 0.323, tireF: 0.235, tireR: 0.235, rimIn: 19, fo: 0.90, ro: 0.785, width: 1.795, height: 1.447 },
    engine: { idle: 850, max: 6750, cut: 6650, up: 6450, torque: [[0, 180], [1000, 250], [1500, 330], [1950, 392], [4600, 392], [5200, 372], [6000, 328], [6600, 290], [7000, 150]] },
    gears: [14.6, 9.5, 6.9, 5.4, 4.4, 3.65, 3.05, 2.55], shiftTime: 0.09,
    tyre: { mu: 1.07, kappa: 0.12, alpha: 0.15 }, aero: { ClA: 0.04, CdA: 0.70, bal: 0.5 }, susHz: [1.65, 1.55], brakeBias: 0.66,
    body: 'hatch'
  },
  rally: {
    id: 'rally', name: 'Hyundai i20 N Rally1', short: 'i20 N Rally1', code: 'I20',
    blurb: 'WRC Rally1 (tarmac set-up): 1.6 turbo I4 + hybrid boost · about 500 PS · 5-speed sequential, shifted automatically · all-wheel drive · big swan-neck wing',
    stats: { ps: 500, nm: 500, kg: 1260, drive: 'AWD', gearbox: '5-speed sequential (auto)', top: 200, zero100: 3.0 },
    color: 0xffffff, swatch: 0xaec3d6, livery: 'rally1', accent: 0xd9001b, trim: 0x1a2442, lamp: 0xf4f8ff, helmet: 0xffffff, rimColor: 0xe6e8ea, caliper: 0xd9001b, offroad: 1.5,
    mass: 1260, cyl: 4, driveFront: 0.5, vmaxKmh: 200, gearboxLabel: '5-SPD SEQ AUTO', drs: false,
    dims: { wb: 2.6, frontWeight: 0.54, cgH: 0.45, trackF: 1.62, trackR: 1.62, rF: 0.325, rR: 0.325, tireF: 0.235, tireR: 0.235, rimIn: 18, fo: 0.82, ro: 0.68, width: 1.875, height: 1.43 },
    engine: { idle: 1500, max: 7600, cut: 7500, up: 7300, torque: [[0, 250], [2500, 420], [3500, 500], [6000, 500], [7000, 440], [7600, 350], [8000, 150]] },
    gears: [14.0, 9.9, 7.6, 5.9, 4.6], shiftTime: 0.04,
    tyre: { mu: 1.25, kappa: 0.11, alpha: 0.14 }, aero: { ClA: 1.2, CdA: 0.95, bal: 0.45 }, susHz: [2.0, 1.9], brakeBias: 0.6,
    body: 'rally'
  },
  gtr: {
    id: 'gtr', name: 'Nissan GT-R NISMO (R35)', short: 'GT-R R35 NISMO', code: 'GTR',
    blurb: '3.8 twin-turbo V6 · 600 PS · 652 Nm · 6-speed dual-clutch · ATTESA all-wheel drive',
    stats: { ps: 600, nm: 652, kg: 1725, drive: 'AWD', gearbox: '6-speed DCT', top: 315, zero100: 2.7 },
    color: 0xeef0f2, accent: 0xc8102e, trim: 0x1c1d20, lamp: 0xeaf2ff, helmet: 0xc8102e, rimColor: 0x1c1d20, caliper: 0xc8102e,
    mass: 1725, cyl: 6, driveFront: 0.30, vmaxKmh: 315, gearboxLabel: '6-SPD DCT', drs: false,
    dims: { wb: 2.78, frontWeight: 0.54, cgH: 0.47, trackF: 1.60, trackR: 1.60, rF: 0.356, rR: 0.36, tireF: 0.255, tireR: 0.285, rimIn: 20, fo: 0.99, ro: 0.92, width: 1.895, height: 1.37 },
    engine: { idle: 750, max: 7100, cut: 7000, up: 6900, torque: [[0, 250], [1000, 330], [2000, 470], [3000, 610], [3600, 652], [5600, 652], [6800, 619], [7100, 585], [7500, 300]] },
    gears: [12.7, 7.9, 5.6, 4.3, 3.55, 3.02], shiftTime: 0.07,
    tyre: { mu: 1.13, kappa: 0.11, alpha: 0.14 }, aero: { ClA: 0.38, CdA: 0.80, bal: 0.45 }, susHz: [1.9, 1.85], brakeBias: 0.62,
    body: 'fastback'
  },
  m3cs: {
    id: 'm3cs', name: 'BMW M3 CS', short: 'M3 CS', code: 'M3C',
    blurb: '3.0 twin-turbo I6 · 550 PS · 650 Nm · 8-speed automatic · rear-biased all-wheel drive',
    stats: { ps: 550, nm: 650, kg: 1765, drive: 'AWD', gearbox: '8-speed auto', top: 302, zero100: 3.4 },
    color: 0x3c5a4a, accent: 0x1a1a1a, lamp: 0xffc21a, helmet: 0x111111, rimColor: 0xb08d57, caliper: 0xc8102e,
    mass: 1765, cyl: 6, driveFront: 0.22, vmaxKmh: 302, gearboxLabel: '8-SPD AUTO', drs: false,
    dims: { wb: 2.857, frontWeight: 0.52, cgH: 0.48, trackF: 1.62, trackR: 1.62, rF: 0.337, rR: 0.346, tireF: 0.275, tireR: 0.285, rimIn: 19.5, fo: 0.87, ro: 1.06, width: 1.903, height: 1.436 },
    engine: { idle: 750, max: 7200, cut: 7100, up: 6950, torque: [[0, 260], [1000, 380], [2000, 560], [2750, 650], [5950, 650], [6250, 619], [7000, 520], [7200, 480], [7600, 250]] },
    gears: [14.9, 9.6, 6.6, 5.0, 4.0, 3.35, 2.85, 2.45], shiftTime: 0.12,
    tyre: { mu: 1.21, kappa: 0.11, alpha: 0.14 }, aero: { ClA: 0.12, CdA: 0.78, bal: 0.5 }, susHz: [1.85, 1.8], brakeBias: 0.62,
    body: 'sedan'
  },
  gt3rs: {
    id: 'gt3rs', name: 'Porsche 911 GT3 RS', short: '911 GT3 RS', code: 'RS',
    blurb: '4.0 flat-six · 525 PS · 465 Nm · 7-speed PDK · rear-wheel drive · active DRS wing',
    stats: { ps: 525, nm: 465, kg: 1450, drive: 'RWD', gearbox: '7-speed PDK', top: 296, zero100: 3.2 },
    color: 0xf2f2f0, accent: 0x111111, lamp: 0xf4f8ff, helmet: 0x111111, rimColor: 0x1a1a1c, caliper: 0xffcf00,
    mass: 1450, cyl: 6, driveFront: 0.0, vmaxKmh: 300, gearboxLabel: '7-SPD PDK', drs: true,
    dims: { wb: 2.457, frontWeight: 0.39, cgH: 0.43, trackF: 1.63, trackR: 1.60, rF: 0.35, rR: 0.367, tireF: 0.275, tireR: 0.335, rimIn: 20.5, fo: 1.06, ro: 1.05, width: 1.90, height: 1.32 },
    engine: { idle: 900, max: 9000, cut: 9000, up: 8850, torque: [[0, 200], [1000, 250], [2000, 300], [3000, 350], [4000, 390], [5000, 420], [6300, 465], [7500, 452], [8500, 434], [9000, 410], [9500, 200]] },
    gears: [17.5, 11.3, 8.3, 6.5, 5.3, 4.55, 4.03], shiftTime: 0.06,
    tyre: { mu: 1.31, kappa: 0.11, alpha: 0.13 }, aero: { ClA: 2.2, CdA: 0.98, bal: 0.40, drsCd: 0.20, drsCl: 0.45 }, susHz: [2.4, 2.3], brakeBias: 0.56,
    body: 'rs911'
  }
};
const CAR_ORDER = ['i30n', 'rally', 'gtr', 'm3cs', 'gt3rs'];

// Derive the physics + geometry parameter set used by the simulation.
function carPhys(spec) {
  const d = spec.dims, m = spec.mass, g = 9.81;
  const frontAxle = d.wb * (1 - d.frontWeight), rearAxle = -d.wb * d.frontWeight;
  const length = d.wb + d.fo + d.ro, width = d.width;
  const cornerF = m * d.frontWeight / 2, cornerR = m * (1 - d.frontWeight) / 2;
  const kF = cornerF * (TAU * spec.susHz[0]) ** 2, kR = cornerR * (TAU * spec.susHz[1]) ** 2;
  const restLen = 0.24, compF = cornerF * g / kF, compR = cornerR * g / kR;
  const P = {
    spec, id: spec.id, mass: m,
    I: new THREE.Vector3(m * (length * length + d.height * d.height) / 14, m * (length * length + width * width) / 15, m * (width * width + d.height * d.height) / 14),
    cgH: d.cgH, frontAxle, rearAxle, xF: d.trackF / 2, xR: d.trackR / 2, length, width, height: d.height,
    zFront: frontAxle + d.fo, zRear: rearAxle - d.ro,
    restLen, maxLen: restLen + 0.08, bumpStop: 500000,
    k: [kF, kF, kR, kR], cBump: 2 * 0.42 * Math.sqrt(kF * cornerF), cReb: 2 * 0.6 * Math.sqrt(kF * cornerF),
    arbF: kF * 0.45, arbR: kR * 0.28,
    wheelI: [1.3, 1.3, 1.45, 1.45],
    mu: [spec.tyre.mu, spec.tyre.mu, spec.tyre.mu * 1.01, spec.tyre.mu * 1.01], kappaPeak: spec.tyre.kappa, alphaPeak: spec.tyre.alpha, C: 1.45,
    Fz0: m * g / 4, loadSens: 0.11,
    rho: 1.225, ClA: spec.aero.ClA, CdA: spec.aero.CdA, aeroBal: spec.aero.bal, drsCd: spec.aero.drsCd || 0, drsCl: spec.aero.drsCl || 0, hasDRS: !!spec.drs,
    maxSteer: 0.52, bias: spec.brakeBias,
    gears: spec.gears, reverse: spec.gears[0] * 0.9,
    idle: spec.engine.idle, maxRPM: spec.engine.max, cutRPM: spec.engine.cut, upRPM: spec.engine.up, torque: spec.engine.torque,
    eff: 0.88, upShiftT: spec.shiftTime, downShiftT: spec.shiftTime * 1.4,
    driveFront: spec.driveFront, vmax: spec.vmaxKmh / 3.6,
    floorClear: 0.11, cyl: spec.cyl, offroad: spec.offroad || 1
  };
  // wheels: per-corner radius and suspension anchor so the static ride height matches the model
  P.wheels = [
    { x: P.xF, z: frontAxle, front: true, R: d.rF, comp: compF }, { x: -P.xF, z: frontAxle, front: true, R: d.rF, comp: compF },
    { x: P.xR, z: rearAxle, front: false, R: d.rR, comp: compR }, { x: -P.xR, z: rearAxle, front: false, R: d.rR, comp: compR }];
  for (const w of P.wheels) w.anchorY = (w.R - d.cgH) + (restLen - w.comp);
  // brakes: enough torque to lock the wheels near the grip limit (ABS keeps them turning)
  const rAvg = (d.rF + d.rR) / 2;
  P.brakeTotal = 1.7 * spec.tyre.mu * m * g * rAvg;
  // peak power for AI estimates
  let pk = 0; for (const [rpm, nm] of spec.engine.torque) if (rpm <= spec.engine.cut) pk = Math.max(pk, nm * rpm * TAU / 60);
  P.peakPower = pk * P.eff;
  return P;
}
function engineTorqueOf(table, rpm) {
  for (let i = 1; i < table.length; i++) if (rpm <= table[i][0]) { const a = table[i - 1], b = table[i]; return lerp(a[1], b[1], (rpm - a[0]) / (b[0] - a[0])); }
  return table[table.length - 1][1];
}
