
// =====================================================================
// GAME — renderer, quality presets, world assembly, session flow, loop
// =====================================================================
const QUALITY = {
  high: { pixel: 1.75, shadow: 2048, shadowR: 70, ao: true, bloom: true, msaa: 4, veg: 1.0, lod: 900, grass: 300, aniso: 8, treeShadow: true, fpsTarget: 120 },
  medium: { pixel: 1.25, shadow: 2048, shadowR: 60, ao: false, bloom: true, msaa: 4, veg: 0.7, lod: 600, grass: 220, aniso: 4, fpsTarget: 60 },
  performance: { pixel: 1.0, shadow: 1024, shadowR: 45, ao: false, bloom: false, msaa: 0, veg: 0.4, lod: 350, grass: 0, aniso: 2, hardShadows: true, minScale: 0.6, fpsTarget: 60 },
  // Ultra Low: old CPUs, integrated / mobile GPUs and software renderers. No shadow map, no
  // post-processing (tone mapping happens in each material, straight to the screen), sparse
  // vegetation, no clouds, and a render scale that may drop to 50%.
  minimal: { pixel: 1.0, shadow: 512, shadowR: 40, ao: false, bloom: false, msaa: 0, veg: 0.18, lod: 160, grass: 0, aniso: 1, noShadows: true, noPost: true, noClouds: true, startScale: 0.85, minScale: 0.5, fpsTarget: 45 },
  // Tuned for i9-9900K + RTX 2080 Ti class PCs on 240 Hz displays: every effect whose cost does not
  // scale well at 4.17 ms/frame is cut (GTAO, bloom chain, tree shadow casting), physics runs at 240 Hz for the
  // lowest input latency, and spare GPU time is spent on supersampling (render scale up to 1.5x).
  competitive: { pixel: 1.0, shadow: 2048, shadowR: 55, ao: false, bloom: false, msaa: 4, veg: 0.85, lod: 520, grass: 200, aniso: 16, treeShadow: false, physHz: 240, maxScale: 1.5, minScale: 0.7, hardShadows: true }
};
// ladder used by automatic downgrades
const QUALITY_DOWN = { competitive: 'medium', high: 'medium', medium: 'performance', performance: 'minimal', minimal: null };
const QUALITY_NAME = { competitive: '240 FPS Competitive', high: 'High', medium: 'Medium', performance: 'Low', minimal: 'Ultra Low' };

// ---------------------------------------------------------------- device profiling
// Classifies the machine into tiers 0..4 from the GPU name, CPU core count, device memory and
// form factor. The tier picks the starting preset and how much detail is generated at load
// time (which is the slow part on weak CPUs). URL overrides: ?tier=0..4 ?quality=<preset> ?webgl1
function detectDevice(gl) {
  const q = new URLSearchParams(location.search);
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const gpu = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  const cores = navigator.hardwareConcurrency || 4, mem = navigator.deviceMemory || 8;
  const ua = navigator.userAgent || '';
  const iPadOS = /Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1;
  const mobileUA = /iPhone|iPad|iPod|Android|Mobile|Silk|Kindle|Opera Mini|IEMobile/i.test(ua) || iPadOS;
  const coarse = !!(window.matchMedia && matchMedia('(pointer: coarse)').matches);
  const touch = (mobileUA && (coarse || 'ontouchstart' in window || (navigator.maxTouchPoints || 0) > 0)) || ((navigator.maxTouchPoints || 0) > 0 && coarse);
  const mobile = touch && Math.min(screen.width, screen.height) < 900;
  const software = /swiftshader|llvmpipe|softpipe|lavapipe|basic render|microsoft basic|mesa offscreen/i.test(gpu);
  const highEnd = /RTX\s?[2-9]0|RTX\s?A\d|GTX\s?10[78]0|GTX\s?1660|RX\s?(5[67]|6[789]|7[6-9])\d\d|Radeon\s?(Pro|VII)|Arc\s?A7|Apple M\d (Max|Ultra)/i.test(gpu);
  const midDiscrete = /GTX|Quadro|RTX|Radeon\s?(RX|R9|HD 7[89])|RX\s?\d{3,4}|Arc|Apple M\d Pro/i.test(gpu);
  const modernMobile = /Adreno.{0,12}(6[4-9]\d|7\d\d)|Mali-G7[1-9]|Mali-G[6-9]\d\d|Immortalis|Apple GPU|Xclipse/i.test(gpu);
  const decentIntegrated = /Apple M\d|Iris\s?Xe|Radeon\s?(\d{3}M|Graphics)|Vega\s?(8|10|11)/i.test(gpu);
  let tier;
  if (software) tier = 0;
  else if (mobile) tier = modernMobile ? 2 : 1;
  else if (highEnd) tier = 4;
  else if (midDiscrete) tier = 3;
  else if (decentIntegrated) tier = 2;
  else if (/Intel|UHD|HD Graphics|Iris|Mali|Adreno|PowerVR|GMA/i.test(gpu)) tier = 1;
  else tier = 2; // unknown GPU: start in the middle and let auto-adjust correct it
  if (cores <= 2 || mem <= 2) tier = Math.min(tier, 1); else if (cores <= 4 && mem <= 4) tier = Math.min(tier, 2);
  if (q.has('tier')) tier = clamp(parseInt(q.get('tier')) || 0, 0, 4);
  return { gpu, cores, mem, touch, mobile, software, tier, forcedQuality: q.get('quality') };
}

const TEAMS = [
  { name: 'Alpine Works', code: 'YOU', color: 0x1f5fff, accent: 0xff2d55, number: 7, helmet: 0xffd23f, css: '#ffd23f' },
  { name: 'Scuderia Vetta', code: 'VET', color: 0xd4131b, accent: 0xffd200, number: 11, helmet: 0xffd200, css: '#e01b22' },
  { name: 'Argento Motorsport', code: 'ARG', color: 0xbfc5cc, accent: 0x00c2b2, number: 23, helmet: 0x7c4dff, css: '#00c2b2' },
  { name: 'Arancia Racing', code: 'ARA', color: 0xff8000, accent: 0x1c1c1c, number: 31, helmet: 0xffffff, css: '#ff8000' },
  { name: 'Verde Racing', code: 'VRD', color: 0x00594f, accent: 0xcedc00, number: 5, helmet: 0xcedc00, css: '#1c9e6b' },
  { name: 'Cobalt GP', code: 'COB', color: 0x14213d, accent: 0xe10600, number: 9, helmet: 0x1e41ff, css: '#3a63ff' },
  { name: 'Azure Team', code: 'AZR', color: 0x2aa6e0, accent: 0xffffff, number: 18, helmet: 0xff7ac6, css: '#2aa6e0' },
  { name: 'Nordhaven F1', code: 'NRD', color: 0xf0f0f0, accent: 0xb6babd, number: 26, helmet: 0x111111, css: '#e8e8e8' },
  { name: 'Kestrel Racing', code: 'KES', color: 0x52e252, accent: 0x111111, number: 33, helmet: 0x52e252, css: '#52e252' },
  { name: 'Lionfield Racing', code: 'LIO', color: 0x6692ff, accent: 0xffffff, number: 41, helmet: 0xffffff, css: '#6692ff' }
];

// ---------------------------------------------------------------- profiler
// CPU section timers, GPU time via EXT_disjoint_timer_query_webgl2 (when the browser exposes it),
// and display refresh detection from the requestAnimationFrame cadence.
class Perf {
  constructor(renderer) {
    this.gl = renderer.getContext();
    this.ext = typeof this.gl.createQuery === 'function' ? this.gl.getExtension('EXT_disjoint_timer_query_webgl2') : null; // WebGL2 only
    this.pool = []; this.pending = []; this.active = null; this.gpuMs = null;
    this.cpu = { sim: 0, vis: 0, render: 0, total: 0 }; this.t0 = 0;
    this.intervals = new Float32Array(240); this.ii = 0; this.n = 0; this.refreshMs = 1000 / 60; this.refreshHz = 60; this._rt = 0;
  }
  mark() { return performance.now(); }
  add(k, ms) { this.cpu[k] = this.cpu[k] * 0.95 + ms * 0.05; }
  interval(ms) {
    if (ms <= 0 || ms > 100) return;
    this.intervals[this.ii] = ms; this.ii = (this.ii + 1) % this.intervals.length; this.n = Math.min(this.n + 1, this.intervals.length);
    if (++this._rt >= 60 && this.n >= 60) {
      this._rt = 0; const a = Array.from(this.intervals.subarray(0, this.n)).sort((x, y) => x - y);
      this.refreshMs = a[Math.floor(a.length * 0.1)]; // the vsync floor
      const hz = 1000 / this.refreshMs, known = [60, 75, 90, 100, 120, 144, 165, 170, 180, 200, 240, 280, 300, 360, 480];
      this.refreshHz = known.reduce((b, k) => Math.abs(k - hz) < Math.abs(b - hz) ? k : b, 60);
    }
  }
  beginGPU() {
    if (!this.ext || this.active) return; const gl = this.gl;
    const q = this.pool.pop() || gl.createQuery(); gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q); this.active = q;
  }
  endGPU() { if (!this.active) return; this.gl.endQuery(this.ext.TIME_ELAPSED_EXT); this.pending.push(this.active); this.active = null; }
  poll() {
    if (!this.ext) return; const gl = this.gl;
    while (this.pending.length) {
      const q = this.pending[0];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      const disjoint = gl.getParameter(this.ext.GPU_DISJOINT_EXT);
      if (!disjoint) { const ms = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6; this.gpuMs = this.gpuMs == null ? ms : this.gpuMs * 0.9 + ms * 0.1; }
      this.pending.shift(); this.pool.push(q);
    }
    if (this.pending.length > 8) { this.pool.push(...this.pending.splice(0, this.pending.length - 8)); }
  }
}

class Game {
  constructor() {
    this.debug = false; this.paused = false; this.inSession = false; this.fps = 60; this.frameMs = 16; this.resScale = 1; this.dynRes = true; this.stepsLast = 0;
    this.quality = 'medium'; this.cars = []; this.acc = 0; this.h = 1 / 120; this.fpsCap = 0; this._lastFrame = 0; this._carPhys = [];
    this._col = { a: new THREE.Vector3(), b: new THREE.Vector3(), va: new THREE.Vector3(), vb: new THREE.Vector3(), imp: new THREE.Vector3() };
    this._ctx = { running: false, raceTime: 0, cars: this._carPhys, drsZoneAt: (s) => this.drsZone(s), pitLimit: true };
    this.settings = { mode: 'race', laps: 1, ai: 7, diff: 0.95, abs: true, tc: true, car: 'gt3rs', field: 'same' };
    this.carP = {}; for (const id of CAR_ORDER) this.carP[id] = carPhys(CAR_SPECS[id]); // shared, read-only per car type
    this.audio = new AudioSys();
    this.ms = { st: {} };
  }
  setLoad(f, txt) { document.getElementById('loadbar').style.width = (f * 100).toFixed(0) + '%'; if (txt) document.getElementById('loadtxt').textContent = txt; }
  async init() {
    const tLoad = performance.now();
    if (window.__agpNoGL) throw new Error('WebGL unavailable');
    this.setLoad(0.02, 'Creating renderer…');
    const app = document.getElementById('app');
    // WebGL2 first, WebGL1 as a fallback for old GPUs / browsers (?webgl1 forces it for testing)
    const canvas = document.createElement('canvas');
    const attrs = { alpha: false, antialias: false, depth: true, stencil: false, powerPreference: 'high-performance', premultipliedAlpha: true, preserveDrawingBuffer: false };
    let gl = null;
    if (!new URLSearchParams(location.search).has('webgl1')) { try { gl = canvas.getContext('webgl2', attrs); } catch (e) { gl = null; } }
    const gl2 = !!gl;
    if (!gl) { try { gl = canvas.getContext('webgl', attrs) || canvas.getContext('experimental-webgl', attrs); } catch (e) { gl = null; } }
    if (!gl) throw new Error('WebGL could not be initialised. Enable hardware acceleration or update the graphics driver.');
    let renderer;
    try { renderer = new THREE.WebGLRenderer({ canvas, context: gl, antialias: false, powerPreference: 'high-performance', stencil: false }); }
    catch (err) { throw new Error('WebGL renderer could not be created: ' + err.message); }
    this.renderer = renderer;
    // capability probe: float render targets drive HDR post-processing and the environment map
    const floatRT = !new URLSearchParams(location.search).has('nofloat') && (gl2 ? !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'))
      : !!(gl.getExtension('OES_texture_half_float') && gl.getExtension('EXT_color_buffer_half_float')));
    this.caps = { gl2, floatRT, maxSamples: gl2 ? (renderer.capabilities.maxSamples || 0) : 0, maxTex: renderer.capabilities.maxTextureSize };
    this.device = detectDevice(gl);
    if (this.caps.maxTex < 4096) this.device.tier = Math.min(this.device.tier, 1);
    // phones get low build detail regardless of GPU: mobile browsers (iOS Safari especially) kill tabs that use too much memory
    this.buildDetail = (this.device.tier <= 1 || this.device.mobile) ? 'low' : 'normal';
    Tex.detail = this.buildDetail === 'low' ? 0.5 : 1;
    this.perf = new Perf(renderer);
    renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.62;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setSize(window.innerWidth, window.innerHeight); renderer.info.autoReset = false;
    this._w = window.innerWidth; this._h = window.innerHeight;
    app.appendChild(renderer.domElement);
    renderer.domElement.addEventListener('webglcontextlost', (e) => { e.preventDefault(); window.__agpFail('The WebGL context was lost (GPU reset or driver issue). Reload the page to continue.'); });
    Tex.anisotropy = Math.min(16, renderer.capabilities.getMaxAnisotropy());
    // GPU identification (used to pre-select the best preset)
    this.gpuName = this.device.gpu;
    this.quality = ['minimal', 'performance', 'medium', 'high', 'competitive'][this.device.tier];
    if (this.device.forcedQuality && QUALITY[this.device.forcedQuality]) this.quality = this.device.forcedQuality;
    this.autoQuality = true; this.userPickedQuality = !!this.device.forcedQuality;
    if (this.device.touch) document.body.classList.add('touch');
    // a touch-screen laptop or an unusual browser that was not detected: switch to touch mode on the first real touch
    window.addEventListener('touchstart', () => {
      if (this.device.touch) return; this.device.touch = true; document.body.classList.add('touch');
      if (this.inSession) document.getElementById('touch').classList.remove('hidden');
    }, { passive: true });
    const scene = this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 26000);
    // ---------------- sky, sun, fog, environment
    const sunEl = 34 * Math.PI / 180, sunAz = 215 * Math.PI / 180;
    this.sunDir = new THREE.Vector3().setFromSphericalCoords(1, Math.PI / 2 - sunEl, sunAz);
    const mkSky = () => { const s = new Sky(); s.scale.setScalar(22000); const u = s.material.uniforms; u.turbidity.value = 3.2; u.rayleigh.value = 1.15; u.mieCoefficient.value = 0.004; u.mieDirectionalG.value = 0.82; u.sunPosition.value.copy(this.sunDir); return s; };
    // the sun never moves, so the atmospheric-scattering sky is rendered once into a cubemap
    // and drawn as a background (one texture fetch per pixel instead of the full scattering shader)
    { const skyScene = new THREE.Scene(); skyScene.add(mkSky());
      this.skyRT = new THREE.WebGLCubeRenderTarget(this.buildDetail === 'low' ? 512 : 1024, { type: floatRT ? THREE.HalfFloatType : THREE.UnsignedByteType, generateMipmaps: false });
      const cc = new THREE.CubeCamera(1, 30000, this.skyRT); cc.update(renderer, skyScene); scene.background = this.skyRT.texture; }
    scene.fog = new THREE.FogExp2(new THREE.Color(0x9fb8d2), 0.000105);
    if (floatRT) { // image-based lighting needs half-float render targets
      const pmrem = new THREE.PMREMGenerator(renderer); const envScene = new THREE.Scene(); envScene.add(mkSky());
      const hemiEnv = new THREE.Mesh(new THREE.SphereGeometry(100, 16, 8, 0, TAU, Math.PI / 2 + 0.05, Math.PI / 2 - 0.05), new THREE.MeshBasicMaterial({ color: 0x3a4a33, side: THREE.BackSide })); envScene.add(hemiEnv);
      this.envRT = pmrem.fromScene(envScene, 0.02, 1, 30000); scene.environment = this.envRT.texture; pmrem.dispose();
    }
    this.sun = new THREE.DirectionalLight(0xfff0dc, 3.1); this.sun.castShadow = true; scene.add(this.sun); scene.add(this.sun.target);
    this.sun.shadow.bias = -0.00025; this.sun.shadow.normalBias = 0.03;
    this.hemi = new THREE.HemisphereLight(0xc4dcff, 0x46553a, floatRT ? 0.55 : 1.4); scene.add(this.hemi); // brighter fill when there is no environment map
    await nextFrame();
    // ---------------- materials
    this.setLoad(0.06, 'Generating asphalt, kerb and terrain textures…'); await nextFrame();
    const road = Tex.asphalt(true, 11), run = Tex.asphalt(false, 13, 0.035), grass = Tex.grass(), gravel = Tex.gravel(), conc = Tex.concrete(), det = Tex.terrainDetail();
    await nextFrame();
    const std = (o) => new THREE.MeshStandardMaterial(o);
    const M = this.M = {
      road: std({ map: road.map, roughnessMap: road.roughnessMap, normalMap: road.normalMap, normalScale: new THREE.Vector2(0.6, 0.6), vertexColors: true, roughness: 1, envMapIntensity: 0.6 }),
      runoff: std({ map: run.map, roughnessMap: run.roughnessMap, normalMap: run.normalMap, roughness: 1, envMapIntensity: 0.5 }),
      grass: std({ map: grass.map, normalMap: grass.normalMap, roughness: 0.95, envMapIntensity: 0.4 }),
      gravel: std({ map: gravel.map, normalMap: gravel.normalMap, normalScale: new THREE.Vector2(1.4, 1.4), roughness: 0.97 }),
      concrete: std({ map: conc.map, normalMap: conc.normalMap, roughness: 0.85 }),
      kerb: std({ map: Tex.kerb(), roughness: 0.55, polygonOffset: true, polygonOffsetFactor: -1 }),
      paint: std({ color: 0xf2f2f2, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
      paintY: std({ color: 0xffd23f, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
      checker: std({ map: Tex.checker(), roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
      wall: std({ map: conc.map, normalMap: conc.normalMap, color: 0xe8e8e8, roughness: 0.8 }),
      armco: std({ color: 0xc7ccd2, roughness: 0.35, metalness: 0.85 }),
      fence: std({ map: Tex.fence(), alphaTest: 0.4, transparent: false, side: THREE.DoubleSide, color: 0xbfc4ca, roughness: 0.5, metalness: 0.6 }),
      metal: std({ color: 0x9aa0a6, roughness: 0.45, metalness: 0.8 }),
      steel: std({ color: 0x6e757d, roughness: 0.5, metalness: 0.7 }),
      building: std({ color: 0xeef0f2, roughness: 0.7 }), dark: std({ color: 0x15181d, roughness: 0.8 }),
      glass: new THREE.MeshPhysicalMaterial({ color: 0x1a2a38, roughness: 0.05, metalness: 0.6, clearcoat: 1 }),
      door: std({ map: Tex.garageDoor(), roughness: 0.6, metalness: 0.4 }), accent: std({ color: 0xc8102e, roughness: 0.5 }),
      redPaint: std({ color: 0xc8102e, roughness: 0.5 }), orange: std({ color: 0xff7a00, roughness: 0.6 }), seat: std({ vertexColors: true, roughness: 0.7 }),
      ads: std({ map: Tex.ads(), roughness: 0.55 }),
      terrain: std({ vertexColors: true, map: det.map, normalMap: det.normalMap, normalScale: new THREE.Vector2(0.3, 0.3), roughness: 0.96, envMapIntensity: 0.35 }),
      mountain: std({ vertexColors: true, roughness: 1.0, envMapIntensity: 0.3 })
    };
    // triplanar albedo detail on terrain so steep cliffs don't show stretched texels
    M.terrain.onBeforeCompile = (sh) => {
      sh.vertexShader = 'varying vec3 vTriPos; varying vec3 vTriNor;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vTriPos = (modelMatrix * vec4(transformed, 1.0)).xyz; vTriNor = normalize(mat3(modelMatrix) * objectNormal);');
      sh.fragmentShader = 'varying vec3 vTriPos; varying vec3 vTriNor;\n' + sh.fragmentShader.replace('#include <map_fragment>', `
        vec3 bw = pow(abs(vTriNor), vec3(4.0)); bw /= (bw.x + bw.y + bw.z);
        vec4 sampledDiffuseColor = texture2D(map, vTriPos.zy / 22.0) * bw.x + texture2D(map, vTriPos.xz / 22.0) * bw.y + texture2D(map, vTriPos.xy / 22.0) * bw.z;
        diffuseColor *= sampledDiffuseColor;`);
    };
    M.terrain.customProgramCacheKey = () => 'terrain-triplanar';
    // ---------------- track
    this.setLoad(0.18, 'Building the 20.8 km Nordschleife from map data…'); await nextFrame();
    const track = this.track = new Track();
    this.trackGroup = track.buildMeshes(M, this.buildDetail === 'low'); scene.add(this.trackGroup);
    // low-detail devices: hide track chunks that are far away (the Nordschleife is 20 km of road)
    this.trackCull = [];
    if (this.buildDetail === 'low') this.trackGroup.traverse(o => { if (o.isMesh && o.parent && o.parent.name === 'track-chunk') { o.geometry.computeBoundingSphere(); this.trackCull.push(o); } });
    // ---------------- terrain & lake
    this.setLoad(0.30, 'Shaping the Eifel terrain (EU-DEM)…'); await nextFrame();
    this.terrain = new Terrain(track, this.buildDetail === 'low' ? 300 : 480); // 9.6 km square: 32 m / 20 m cells
    await this.terrain.build((f) => this.setLoad(0.30 + f * 0.30, 'Shaping the Eifel terrain (EU-DEM)… ' + Math.round(f * 100) + '%'));
    scene.add(this.terrain.mesh(M.terrain));
    this.setLoad(0.62, 'Raising the Eifel hills…'); await nextFrame();
    this.mountains = buildMountains(M.mountain); scene.add(this.mountains);
    this.lake = null; // the Nordschleife has no lake (buildLake() is kept for other venues)
    this.clouds = buildClouds(); this.clouds.material.uniforms.uSun.value.copy(this.sunDir); scene.add(this.clouds);
    // ---------------- facilities
    this.setLoad(0.70, 'Building pit complex, grandstands and gantries…'); await nextFrame();
    this.fac = new Facilities(track, this.terrain, M); scene.add(this.fac.build());
    // ---------------- vegetation
    this.setLoad(0.78, 'Planting forests…'); await nextFrame();
    this.veg = new Vegetation(this.terrain, track, [...this.fac.exclusions, { x: LAKE.x, z: LAKE.z, r: 0 }], 1);
    this.veg.budget = this.buildDetail === 'low' ? 0.4 : 1;
    this.veg.build(); scene.add(this.veg.group);
    // ---------------- effects
    this.setLoad(0.90, 'Preparing cars and effects…'); await nextFrame();
    this.smoke = new Particles(900, false); this.sparks = new Particles(500, true); scene.add(this.smoke.points, this.sparks.points);
    this.skids = new SkidMarks(4000); scene.add(this.skids.mesh);
    this.blobMat = new THREE.MeshBasicMaterial({ map: Tex.blob(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 });
    CarAssets.build();
    this.fleets = {}; for (const id of CAR_ORDER) { const f = this.fleets[id] = new CarFleet(this.carP[id], 12, this.blobMat); scene.add(f.group); }
    this.rig = new CameraRig(this.camera, track);
    this.hud = new HUD(track);
    this.input = new Input((a) => this.action(a));
    this.setQuality(this.quality);
    // compile shaders once with a temporary car so the first frame doesn't hitch
    const tmps = CAR_ORDER.map(id => { const m = new CarModel({ P: this.carP[id], code: 'TMP', color: 0xffffff, accent: 0xffffff, number: 0, player: true }); scene.add(m.root); this.fleets[id].sync([{ model: m }]); return m; });
    this.camera.position.set(0, 20, -200); this.camera.lookAt(0, 0, 0);
    renderer.compile(scene, this.camera); tmps.forEach(m => scene.remove(m.root)); for (const id of CAR_ORDER) this.fleets[id].sync([]);
    this.setLoad(1, 'Ready');
    this.loadMs = performance.now() - tLoad;
    document.querySelector('#menu .sub').textContent = `Nürburgring Nordschleife · ${(track.length / 1000).toFixed(2)} km · ${track.corners.length} corners · ${Math.round(Math.max(...track.P.map(p => p.y)) - Math.min(...track.P.map(p => p.y)))} m elevation change`;
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => { if (document.hidden) { if (this.inSession && !this.paused) this.pause(true); this.audio.suspend(); } });
    this.bindUI();
    document.getElementById('loading').classList.add('hidden');
    document.getElementById('menu').classList.remove('hidden');
    window.__agpBooted = true;
    this.menuCam = 0;
    this.clock = new THREE.Clock();
    renderer.setAnimationLoop(() => this.frame());
  }
  // ---------------------------------------------------------------- quality / post-processing
  setQuality(q) {
    this.quality = q; const Q = this.Q = QUALITY[q];
    const r = this.renderer;
    this.h = 1 / (Q.physHz || 120); this.acc = 0;
    this.minScale = Q.minScale || 0.6; this.maxScale = Q.maxScale || 1.0; this._drCool = 0;
    this.basePixel = Math.min(window.devicePixelRatio || 1, Q.pixel); this.resScale = Q.startScale || 1;
    r.setPixelRatio(this.basePixel * this.resScale);
    // shadow map can be switched off entirely (Ultra Low)
    const shadowsOn = !Q.noShadows;
    if (r.shadowMap.enabled !== shadowsOn) { r.shadowMap.enabled = shadowsOn; this.sun.castShadow = shadowsOn; this.scene.traverse(o => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.needsUpdate = true); }); }
    if (this.clouds) this.clouds.visible = !Q.noClouds;
    this.sun.shadow.mapSize.set(Q.shadow, Q.shadow);
    // PCF (hardware 2x2) instead of PCFSoft: ~25% of total GPU frame time saved in profiling
    const st = Q.hardShadows ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
    if (r.shadowMap.type !== st) { r.shadowMap.type = st; this.scene.traverse(o => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.needsUpdate = true); }); }
    if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    const sc = this.sun.shadow.camera; sc.left = -Q.shadowR; sc.right = Q.shadowR; sc.top = Q.shadowR; sc.bottom = -Q.shadowR; sc.near = 1; sc.far = 900; sc.updateProjectionMatrix();
    this.veg.density = Q.veg; this.veg.lodDist = Q.lod; this.veg.grassDist = Q.grass; this.veg.setShadows(!!Q.treeShadow);
    if (this.composer) { this.composer.renderTarget1.dispose(); this.composer.renderTarget2.dispose(); this.composer.passes.forEach(p => p.dispose && p.dispose()); this.composer = null; }
    this.aoPass = null; this.bloom = null; this.grade = null;
    // Without float render targets an 8-bit HDR buffer would clip before tone mapping, so those
    // GPUs (and Ultra Low) render straight to the screen with tone mapping done in each material.
    this.usePost = this.caps.floatRT && !Q.noPost;
    this.updateParticleScale();
    ['o-quality', 'p-quality'].forEach(id => { const el = document.getElementById(id); if (el) el.value = q; });
    if (!this.usePost) return;
    const w = window.innerWidth, h = window.innerHeight, pr = this.basePixel * this.resScale;
    const rt = new THREE.WebGLRenderTarget(w * pr, h * pr, { type: THREE.HalfFloatType, samples: Math.min(Q.msaa, this.caps.maxSamples) });
    const comp = this.composer = new EffectComposer(r, rt);
    comp.setPixelRatio(pr); comp.setSize(w, h);
    comp.addPass(new RenderPass(this.scene, this.camera));
    if (Q.ao && this.GTAOPass && this.caps.gl2) {
      try { const ao = new this.GTAOPass(this.scene, this.camera, w, h); ao.blendIntensity = 0.85; ao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 1.0, scale: 1.0, samples: 12, distanceFallOff: 0.4 }); comp.addPass(ao); this.aoPass = ao; }
      catch (err) { console.warn('GTAO unavailable', err); }
    }
    if (Q.bloom) { this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.22, 0.45, 0.92); comp.addPass(this.bloom); }
    // Tone mapping, sRGB encode and colour grading in ONE full-screen pass (saves a whole
    // read+write of the frame compared with a separate grading pass).
    const out = new OutputPass();
    Object.assign(out.uniforms, { uSat: { value: 1.07 }, uCon: { value: 1.05 }, uVig: { value: 0.22 }, uWarm: { value: 0.015 } });
    out.material.fragmentShader = out.material.fragmentShader
      .replace('varying vec2 vUv;', 'varying vec2 vUv; uniform float uSat, uCon, uVig, uWarm;')
      .replace(/\}\s*$/, `
        vec3 col = gl_FragColor.rgb; float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
        col = mix(vec3(l), col, uSat); col = (col - 0.5) * uCon + 0.5; col.r += uWarm; col.b -= uWarm * 0.5;
        float vg = smoothstep(0.85, 0.25, length(vUv - 0.5) * 1.15); col *= mix(1.0 - uVig, 1.0, vg);
        gl_FragColor.rgb = clamp(col, 0.0, 1.0);
      }`);
    out.material.needsUpdate = true;
    comp.addPass(out); this.grade = out;
  }
  updateParticleScale() {
    const h = window.innerHeight * this.renderer.getPixelRatio();
    const s = h / (2 * Math.tan(this.camera.fov * Math.PI / 360));
    this.smoke.uniforms.uScale.value = s; this.sparks.uniforms.uScale.value = s;
  }
  resize() {
    const w = window.innerWidth, h = window.innerHeight; this._w = w; this._h = h;
    if (this.device.touch) document.getElementById('rotate').classList.toggle('hidden', !(this.inSession && h > w));
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h); if (this.composer) this.composer.setSize(w, h);
    if (this.bloom) this.bloom.resolution.set(w, h);
    this.updateParticleScale();
  }
  // ---------------------------------------------------------------- UI
  bindUI() {
    const $ = (id) => document.getElementById(id);
    document.querySelectorAll('.mode').forEach(b => b.addEventListener('click', () => { document.querySelectorAll('.mode').forEach(x => x.classList.remove('sel')); b.classList.add('sel'); this.settings.mode = b.dataset.mode; }));
    // car picker
    const cars = $('cars');
    cars.innerHTML = CAR_ORDER.map(id => { const c = CAR_SPECS[id], st = c.stats; return `<button class="carcard${id === this.settings.car ? ' sel' : ''}" data-car="${id}"><span class="swatch" style="background:#${(c.swatch || c.color).toString(16).padStart(6, '0')}"></span><b>${c.name}</b><span>${st.ps} PS · ${st.nm} Nm · ${st.kg} kg</span><span>${st.drive} · ${st.gearbox} · ${st.top} km/h</span></button>`; }).join('');
    cars.querySelectorAll('.carcard').forEach(b => b.addEventListener('click', () => { cars.querySelectorAll('.carcard').forEach(x => x.classList.remove('sel')); b.classList.add('sel'); this.settings.car = b.dataset.car; }));
    const vol = () => { this.audio.vol.master = $('o-master').value / 100; this.audio.vol.engine = $('o-engine').value / 100; this.audio.vol.fx = $('o-fx').value / 100; this.audio.vol.mute = $('o-mute').value === '1'; this.audio.applyVolume(); this.syncPause(); };
    ['o-master', 'o-engine', 'o-fx', 'o-mute'].forEach(id => $(id).addEventListener('input', vol));
    $('o-quality').addEventListener('change', (e) => { this.userPickedQuality = true; this.setQuality(e.target.value); });
    const auto = (v) => { this.autoQuality = v === '1'; $('o-auto').value = $('p-auto').value = v; };
    $('o-auto').addEventListener('change', (e) => auto(e.target.value)); $('p-auto').addEventListener('change', (e) => auto(e.target.value));
    const cap = (v) => { this.fpsCap = parseInt(v) || 0; $('o-cap').value = $('p-cap').value = String(this.fpsCap); };
    $('o-cap').addEventListener('change', (e) => cap(e.target.value)); $('p-cap').addEventListener('change', (e) => cap(e.target.value));
    const de = document.documentElement, fsEl = () => document.fullscreenElement || document.webkitFullscreenElement;
    const canFS = !!(de.requestFullscreen || de.webkitRequestFullscreen);
    const fullscreen = (on) => {
      try {
        if (on && !fsEl()) { const r = de.requestFullscreen ? de.requestFullscreen({ navigationUI: 'hide' }) : de.webkitRequestFullscreen(); if (r && r.catch) r.catch(() => {}); }
        else if (!on && fsEl()) { const r = document.exitFullscreen ? document.exitFullscreen() : document.webkitExitFullscreen(); if (r && r.catch) r.catch(() => {}); }
      } catch (e) { /* fullscreen not permitted */ }
    };
    // iPhone Safari has no element fullscreen: hide the option and suggest installing to the Home Screen instead
    if (!canFS) { $('o-fs').closest('label').style.display = 'none'; $('b-fs').style.display = 'none'; }
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
    const standalone = navigator.standalone || (window.matchMedia && matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches);
    if (this.device.touch && !standalone) $('mobilehelp').innerHTML += ios ? '<br><b>Fullscreen on iPhone/iPad:</b> tap Share &#8594; <b>Add to Home Screen</b>, then open Alpine GP from the Home Screen.' : '<br>Tip: browser menu &#8594; <b>Add to Home screen / Install app</b> to play fullscreen.';
    $('b-fs').addEventListener('click', () => fullscreen(!document.fullscreenElement));
    $('b-start').addEventListener('click', () => {
      this.audio.init(); vol();
      if ($('o-fs').value === '1') fullscreen(true); // exclusive-style fullscreen gives the browser's best frame pacing
      if (this.device.touch) { try { screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape').catch(() => {}); } catch (e) { /* not supported */ } }
      const S = this.settings;
      S.laps = clamp(parseInt($('o-laps').value) || 3, 1, 30); S.ai = parseInt($('o-ai').value); S.diff = parseFloat($('o-diff').value);
      S.abs = $('o-abs').value === '1'; S.tc = $('o-tc').value === '1'; S.field = $('o-field').value;
      this.startSession();
    });
    // pause menu
    $('b-resume').addEventListener('click', () => this.pause(false));
    $('b-restart').addEventListener('click', () => { this.pause(false); this.startSession(); });
    $('b-menu').addEventListener('click', () => this.toMenu());
    $('b-again').addEventListener('click', () => { $('results').classList.add('hidden'); this.startSession(); });
    $('b-menu2').addEventListener('click', () => { $('results').classList.add('hidden'); this.toMenu(); });
    $('p-quality').addEventListener('change', (e) => { this.userPickedQuality = true; this.setQuality(e.target.value); });
    $('p-dynres').addEventListener('change', (e) => { this.dynRes = e.target.value === '1'; if (!this.dynRes) this.applyRes(1); });
    $('p-abs').addEventListener('change', (e) => { this.settings.abs = e.target.value === '1'; if (this.player) this.player.phys.assist.abs = this.settings.abs; });
    $('p-tc').addEventListener('change', (e) => { this.settings.tc = e.target.value === '1'; if (this.player) this.player.phys.assist.tc = this.settings.tc; });
    const pvol = () => { this.audio.vol.master = $('p-master').value / 100; this.audio.vol.engine = $('p-engine').value / 100; this.audio.vol.fx = $('p-fx').value / 100; this.audio.vol.mute = $('p-mute').value === '1'; this.audio.applyVolume();
      $('o-master').value = $('p-master').value; $('o-engine').value = $('p-engine').value; $('o-fx').value = $('p-fx').value; $('o-mute').value = $('p-mute').value; };
    ['p-master', 'p-engine', 'p-fx', 'p-mute'].forEach(id => $(id).addEventListener('input', pvol));
  }
  syncPause() {
    const $ = (id) => document.getElementById(id), v = this.audio.vol;
    $('p-master').value = Math.round(v.master * 100); $('p-engine').value = Math.round(v.engine * 100); $('p-fx').value = Math.round(v.fx * 100); $('p-mute').value = v.mute ? '1' : '0';
    $('p-auto').value = this.autoQuality ? '1' : '0';
    $('p-abs').value = this.settings.abs ? '1' : '0'; $('p-tc').value = this.settings.tc ? '1' : '0'; $('p-quality').value = this.quality; $('p-dynres').value = this.dynRes ? '1' : '0';
  }
  flash(t, s) { this.hud.message(t, s); }
  // vibration on impacts (Android browsers; iOS Safari has no Vibration API, so this is a no-op there)
  haptic(v) { const now = performance.now(); if (!this.device.touch || !navigator.vibrate || now - (this._hapT || 0) < 150) return; this._hapT = now; try { navigator.vibrate(Math.round(clamp(v * 4, 15, 90))); } catch (e) { /* blocked */ } }
  pause(on) {
    if (!this.inSession) return;
    this.paused = on; this.syncPause();
    document.getElementById('pause').classList.toggle('hidden', !on);
    this.input.reset();
    if (on) this.audio.suspend(); else { this.audio.init(); this.audio.resume(); this.clock.getDelta(); }
  }
  toMenu() {
    this.inSession = false; this.paused = false; this.audio.silence();
    document.getElementById('pause').classList.add('hidden'); document.getElementById('menu').classList.remove('hidden'); this.hud.show(false);
    document.getElementById('touch').classList.add('hidden'); document.getElementById('rotate').classList.add('hidden');
    this.clearCars();
  }
  action(a) {
    if (a === 'pause') { if (this.inSession && document.getElementById('results').classList.contains('hidden')) this.pause(!this.paused); return; }
    if (a === 'debug') { this.debug = !this.debug; document.getElementById('debug').classList.toggle('hidden', !this.debug); return; }
    if (a === 'mute') { this.audio.vol.mute = !this.audio.vol.mute; document.getElementById('o-mute').value = this.audio.vol.mute ? '1' : '0'; this.audio.applyVolume(); this.flash(this.audio.vol.mute ? 'AUDIO MUTED' : 'AUDIO ON', ''); return; }
    if (!this.inSession || this.paused || !this.player) return;
    const ph = this.player.phys;
    if (a === 'camera') this.rig.toggle();
    // all four cars shift automatically: gear and transmission keys are intentionally ignored
    else if (a === 'reset') { ph.resetToTrack(); this.skids.lift('p0'); }
    else if (a === 'drs') {
      const st = this.drsState();
      if (st === 'ACTIVE') ph.drs = false; else if (st === 'AVAILABLE') ph.drs = true;
    }
  }
  drsZone(s) { const zs = this.track.drsZones; for (let i = 0; i < zs.length; i++) if (this.track.inRange(s, zs[i].start, zs[i].end)) return i; return -1; }
  drsState() {
    if (!this.player) return 'DISABLED';
    const ph = this.player.phys; const z = this.drsZone(ph.q.s);
    if (!ph.P.hasDRS) return 'DISABLED';
    if (ph.drs) return 'ACTIVE';
    if (z >= 0 && this.player.entry.drsElig[z] && this.race.running) return 'AVAILABLE';
    return 'DISABLED';
  }
  delta() {
    if (!this.race || this.race.mode !== 'tt' || !this.pb || !this.pb.trace) return null;
    const e = this.player.entry; if (e.lapStart == null) return null;
    const s = this.player.phys.q.s, k = Math.floor(s / 10), f = s / 10 - k, t = this.pb.trace;
    if (t[k] == null || t[k + 1] == null) return null;
    return (this.race.time - e.lapStart) - lerp(t[k], t[k + 1], f);
  }
  savePB(lap, trace) {
    if (this.pb && this.pb.lap <= lap) return;
    this.pb = { lap, trace: trace.slice() };
    try { localStorage.setItem(this.pbKey(), JSON.stringify(this.pb)); } catch (e) { /* storage unavailable: PB lives for this session */ }
  }
  pbKey() { return 'agp.pb.nords.' + this.settings.car; } // personal best per car on the Nordschleife
  loadPB() { this.pb = null; try { const v = JSON.parse(localStorage.getItem(this.pbKey()) || 'null'); if (v && fin(v.lap) && Array.isArray(v.trace)) this.pb = v; } catch (e) { this.pb = null; } }
  // ---------------------------------------------------------------- session
  clearCars() {
    for (const c of this.cars) this.scene.remove(c.model.root);
    this.cars = []; this.player = null; for (const id in this.fleets) this.fleets[id].sync([]); this.smoke.clear(); this.sparks.clear(); this.skids.clear();
  }
  makeCar(team, isPlayer, phys) {
    const P = phys.P, spec = P.spec;
    // the player's car wears its factory colours; AI cars wear their team colours
    const look = (isPlayer || spec.livery) ? { color: spec.color, accent: spec.accent, helmet: spec.helmet } : { color: team.color, accent: team.accent, helmet: team.helmet };
    const model = new CarModel({ P, code: team.code, ...look, number: team.number, player: isPlayer });
    this.scene.add(model.root);
    const car = { model, phys, isPlayer, colorCss: team.css, team, st: {}, spec: P.id };
    this.cars.push(car); return car;
  }
  startSession() {
    const S = this.settings, tr = this.track;
    document.getElementById('menu').classList.add('hidden'); document.getElementById('results').classList.add('hidden');
    this.clearCars(); this.loadPB();
    const race = this.race = new RaceManager(this, S.mode, S.laps);
    // player
    const myP = this.carP[S.car];
    const pPhys = new VehiclePhysics(tr, myP); pPhys.assist.abs = S.abs; pPhys.assist.tc = S.tc; pPhys.engine.auto = true;
    const player = this.player = this.makeCar(TEAMS[0], true, pPhys);
    const nAI = S.mode === 'race' ? S.ai : 0;
    const gridSlots = tr.grid;
    const playerSlot = S.mode === 'race' ? Math.min(nAI, Math.floor(nAI * 0.6)) : 0;
    if (S.mode === 'race') pPhys.placeAt(gridSlots[playerSlot].s, gridSlots[playerSlot].u, 0); else pPhys.placeAt(-260, -3.5, 0);
    player.entry = race.add(player.phys, { isPlayer: true, name: 'You', code: 'YOU', colorCss: TEAMS[0].css, gridPos: pPhys.pos.clone() });
    race.player = player.entry;
    // AI field
    let slot = 0;
    for (let k = 0; k < nAI; k++) {
      if (slot === playerSlot) slot++;
      const team = TEAMS[1 + (k % (TEAMS.length - 1))];
      const skill = S.diff * (1.0 - k * 0.006 + (k % 3) * 0.004);
      const aiP = S.field === 'mixed' ? this.carP[CAR_ORDER[(k + CAR_ORDER.indexOf(S.car) + 1) % CAR_ORDER.length]] : myP;
      const ai = new AICar(tr, { skill, P: aiP });
      ai.placeAt(gridSlots[slot].s, gridSlots[slot].u);
      const car = this.makeCar(team, false, ai);
      car.entry = race.add(ai, { isPlayer: false, name: team.name, code: team.code, colorCss: team.css });
      slot++;
    }
    pPhys.allowReverse = S.mode !== 'race';
    this._carPhys.length = 0; for (const c of this.cars) this._carPhys.push(c.phys);
    this.rig.init = false; this.rig.mode = 'chase'; this.rig.P = myP;
    this.fleetCars = {}; for (const id of CAR_ORDER) this.fleetCars[id] = this.cars.filter(c => c.spec === id);
    this.inSession = true; this.paused = false; this.acc = 0; this.input.reset();
    this.hud.show(true);
    document.getElementById('touch').classList.toggle('hidden', !this.device.touch);
    document.getElementById('rotate').classList.toggle('hidden', !(this.device.touch && window.innerHeight > window.innerWidth));
    if (S.mode !== 'race') this.flash(S.mode === 'tt' ? 'TIME TRIAL' : 'FREE DRIVE', S.mode === 'tt' ? (this.pb ? 'PERSONAL BEST ' + fmtTime(this.pb.lap) : 'SET A LAP TIME') : 'EXPLORE THE CIRCUIT');
    else this.flash('GRID', 'HOLD STILL UNTIL LIGHTS OUT');
    this.towerT = 0;
    this.clock.getDelta();
  }
  showResults() {
    const r = this.race, $ = (id) => document.getElementById(id);
    const rows = r.order.map((e, i) => {
      let time;
      if (e.finished) time = i === 0 || !r.order[0].finished ? fmtTime(e.finishTime) : '+' + (e.finishTime - r.order[0].finishTime).toFixed(3);
      else { const laps = r.totalLaps - e.lapsDone; time = laps > 1 ? '+' + (laps - 1) + ' lap' + (laps > 2 ? 's' : '') + ' (running)' : 'Running'; }
      return `<tr class="${e.isPlayer ? 'me' : ''}"><td>${i + 1}</td><td><span style="display:inline-block;width:4px;height:12px;background:${e.colorCss};margin-right:8px"></span>${e.isPlayer ? 'You' : e.name}</td><td>${Math.max(0, e.lapsDone)}</td><td class="num">${time}</td><td class="num">${fmtTime(e.bestLap)}</td><td>${e.penalty ? '+' + e.penalty + 's' : ''}</td></tr>`;
    }).join('');
    $('res-table').innerHTML = '<tr><th>Pos</th><th>Driver</th><th>Laps</th><th>Time / Gap</th><th>Best lap</th><th>Pen.</th></tr>' + rows;
    $('res-title').textContent = 'RACE RESULT · P' + r.player.pos;
    $('res-sub').textContent = `${r.totalLaps} lap${r.totalLaps > 1 ? 's' : ''} · Nürburgring Nordschleife · fastest lap ${fmtTime(r.bestLapAll)}`;
    $('results').classList.remove('hidden');
  }
  // ---------------------------------------------------------------- simulation
  physicsStep(h) {
    const race = this.race, ph = this.player.phys, inp = this.input;
    const pre = race.mode === 'race' && (race.state === 'grid' || race.state === 'lights');
    const v = ph.speed;
    ph.input.throttle = inp.throttle; ph.input.brake = inp.brake;
    ph.input.steer = inp.steer * lerp(1, 0.24, smoothstep(5, 70, v)); // speed-sensitive steering (keyboard)
    ph.holdBrake = pre && inp.throttle < 0.05;
    if (this.player.entry.finished && race.resultsShown) { ph.input.throttle = 0; ph.input.brake = 0.4; }
    // DRS legality: closes on braking or when leaving the zone
    const z = this.drsZone(ph.q.s);
    if (ph.drs && (z < 0 || ph.input.brake > 0.15 || !this.player.entry.drsElig[z])) ph.drs = false;
    ph.step(h);
    const ctx = this._ctx; ctx.running = race.running; ctx.raceTime = race.raceTime;
    for (const c of this.cars) {
      if (c.isPlayer) continue;
      const zz = this.drsZone(c.phys.q.s || 0); c.phys.drsEligible = c.phys.P.hasDRS && zz >= 0 && c.entry.drsElig[zz] && race.running;
      c.phys.step(h, ctx);
    }
    this.carCollisions();
    race.update(h);
  }
  carCollisions() {
    const cars = this.cars, R = 0.95;
    const P = (c, k, out) => { const ph = c.phys, off = ph.P.length / 2 - R; const f = _v1.set(0, 0, k ? -off : off).applyQuaternion(ph.quat); return out.set(ph.pos.x + f.x, ph.pos.y, ph.pos.z + f.z); };
    const { a, b, va, vb } = this._col;
    for (let i = 0; i < cars.length; i++) for (let j = i + 1; j < cars.length; j++) {
      const A = cars[i], B = cars[j];
      if (Math.abs(A.phys.pos.x - B.phys.pos.x) > 7 || Math.abs(A.phys.pos.z - B.phys.pos.z) > 7) continue;
      for (let ka = 0; ka < 2; ka++) for (let kb = 0; kb < 2; kb++) {
        P(A, ka, a); P(B, kb, b);
        const dx = a.x - b.x, dz = a.z - b.z, d = Math.hypot(dx, dz);
        if (d >= 2 * R || d < 1e-4) continue;
        const nx = dx / d, nz = dz / d, pen = 2 * R - d;
        const vA = A.isPlayer ? va.copy(A.phys.vel) : A.phys.velocity(va), vB = B.isPlayer ? vb.copy(B.phys.vel) : B.phys.velocity(vb);
        const vn = (vA.x - vB.x) * nx + (vA.z - vB.z) * nz;
        // positional separation
        const sA = 0.5, sB = 0.5;
        A.phys.pos.x += nx * pen * sA; A.phys.pos.z += nz * pen * sA; B.phys.pos.x -= nx * pen * sB; B.phys.pos.z -= nz * pen * sB;
        if (vn < 0) {
          const j = -(1 + 0.3) * vn / (1 / A.phys.P.mass + 1 / B.phys.P.mass);
          const imp = this._col.imp.set(nx * j, 0, nz * j);
          if (A.isPlayer) A.phys.applyImpulse(imp, a); else A.phys.applyImpulse(imp);
          imp.multiplyScalar(-1);
          if (B.isPlayer) B.phys.applyImpulse(imp, b); else B.phys.applyImpulse(imp);
          if (A.isPlayer || B.isPlayer) {
            if (-vn > 1.5) { this.audio.oneshot('impact', clamp(-vn / 15, 0, 1)); this.haptic(-vn); const m = a.clone().add(b).multiplyScalar(0.5); for (let k = 0; k < 12; k++) this.sparks.spawn(m.x, m.y + 0.2, m.z, (Math.random() - .5) * 8, Math.random() * 4, (Math.random() - .5) * 8, 0.35, 0.05, 0.02, 1, 0.7, 0.3, 1, 1.5, 9.8); }
          }
        }
      }
    }
  }
  // ---------------------------------------------------------------- frame
  frame() {
    const tStart = performance.now();
    // optional frame-rate cap (rAF already caps at the display refresh rate)
    if (this.fpsCap > 0 && tStart - this._lastFrame < 1000 / this.fpsCap - 0.6) return;
    this._lastFrame = tStart;
    const dtRaw = this.clock.getDelta(); const dt = Math.min(dtRaw, 0.1);
    this.perf.interval(dtRaw * 1000); this.perf.poll();
    if (window.innerWidth !== this._w || window.innerHeight !== this._h) this.resize();
    this.renderer.info.reset();
    this.frameMs = lerp(this.frameMs, Math.min(dtRaw, 0.25) * 1000, 0.05); this.fps = 1000 / Math.max(this.frameMs, 1);
    WIND.uTime.value += dt; if (this.lake) this.lake.material.uniforms.uTime.value += dt; this.clouds.material.uniforms.uTime.value += dt;
    if (!this.inSession) { this.menuOrbit(dt); this.render(dt); this.menuInfo(dt); return; }
    if (this.paused) { this.render(0); return; }
    this.input.update(dt);
    // fixed-step physics with accumulator
    this.acc += dt; let steps = 0;
    const tSim = performance.now();
    while (this.acc >= this.h && steps < 12) { this.physicsStep(this.h); this.acc -= this.h; steps++; }
    this.perf.add('sim', performance.now() - tSim);
    const tVis = performance.now();
    if (steps >= 12) this.acc = 0;
    this.stepsLast = steps;
    const alpha = this.acc / this.h;
    // visual sync with interpolation
    for (const c of this.cars) {
      const ph = c.phys;
      c.model.root.position.lerpVectors(ph.prevPos, ph.pos, alpha);
      c.model.root.quaternion.slerpQuaternions(ph.prevQuat, ph.quat, alpha);
      const st = c.isPlayer ? ph.modelState(alpha, c.st) : ph.modelState(c.st);
      st.cockpit = c.isPlayer && this.rig.mode === 'cockpit';
      st.backfire = ph.events.includes('backfire');
      if (c.isPlayer) { const d = this.delta(); st.delta = d == null ? '' : (d >= 0 ? '+' : '-') + Math.abs(d).toFixed(2); }
      // distant cars skip suspension-link solving (they are a few pixels tall)
      const near = c.isPlayer || c.model.root.position.distanceToSquared(this.camera.position) < 140 * 140;
      c.model.update(st, dt, near);
      // contact shadow (instanced blob)
      const q = ph.q, rp = c.model.root.position;
      _v2.set(q.nx, q.ny, q.nz); const fw = _v1.set(0, 0, 1).applyQuaternion(c.model.root.quaternion); fw.addScaledVector(_v2, -fw.dot(_v2)).normalize();
      _m4.makeBasis(_v3.crossVectors(_v2, fw).normalize(), fw, _v2); _m4.setPosition(rp.x, q.y + 0.03, rp.z); c.model.blobMatrix.copy(_m4);
    }
    for (const id in this.fleets) this.fleets[id].sync(this.fleetCars[id] || []);
    this.effects(dt);
    // camera
    const p = this.player, pr = p.model.root;
    this.rig.update(dt, pr.position, pr.quaternion, p.phys.vel, p.phys.input.steer);
    this._audT = (this._audT || 0) - dt; if (this._audT <= 0) { this._audT = 1 / 60; this.audioUpdate(); } // Web Audio automation at 60 Hz is plenty
    for (const c of this.cars) c.phys.events.length = 0;
    this.player.phys.sparks.length = 0; this.player.phys.collisions.length = 0;
    // timing tower
    const nl = this.race.state === 'lights' ? this.race.lights : 0;
    if (nl !== this._gantry) { this._gantry = nl; this.fac.startLightMats.forEach((m, k) => m.emissiveIntensity = k < nl ? 5 : 0); }
    this.towerT -= dt; if (this.towerT <= 0 && this.race.order) { this.towerT = 1; this.fac.updateTower(this.race.order.map(e => ({ code: e.code, color: e.colorCss, gap: this.race.mode === 'race' ? (e.pos === 1 ? 'LEAD' : this.race.gapToLeader(e)) : fmtTime(e.bestLap) }))); }
    this.hud.update(dt, this);
    this.perf.add('vis', performance.now() - tVis);
    this.render(dt);
    this.perf.add('total', performance.now() - tStart);
  }
  effects(dt) {
    const ph = this.player.phys;
    // physics-driven events
    for (const ev of ph.events) { if (ev === 'upshift' || ev === 'downshift') this.audio.oneshot('shift'); if (ev === 'backfire') this.audio.oneshot('backfire'); if (ev === 'denied') this.audio.oneshot('denied'); if (ev === 'reset') this.flash('CAR RESET', ''); }
    for (const sp of ph.sparks) for (let k = 0; k < 3; k++) this.sparks.spawn(sp.p.x, sp.p.y + 0.02, sp.p.z, sp.v.x * 0.6 + (Math.random() - .5) * 4, Math.random() * 2.5, sp.v.z * 0.6 + (Math.random() - .5) * 4, 0.25 + Math.random() * 0.25, 0.045, 0.02, 1, 0.75, 0.35, 1, 1.2, 9.8);
    for (const c of ph.collisions) { this.audio.oneshot('impact', clamp(c.v / 15, 0, 1)); this.haptic(c.v); for (let k = 0; k < 10; k++) this.sparks.spawn(c.p.x, c.p.y + 0.3, c.p.z, (c.n.x + (Math.random() - .5)) * 6, Math.random() * 3, (c.n.z + (Math.random() - .5)) * 6, 0.4, 0.05, 0.02, 1, 0.75, 0.35, 1, 1.2, 9.8); }
    // tyre smoke, dust and skid marks for every car
    for (const c of this.cars) {
      const P = c.phys;
      if (c.isPlayer) {
        P.wheels.forEach((w, i) => {
          const key = 'p' + i; if (!w.contact) { this.skids.lift(key); return; }
          const sp = SURF_PROPS[w.surf], soft = w.surf === SURF.GRASS || w.surf === SURF.GRAVEL;
          const side = _v3.set(1, 0, 0).applyQuaternion(P.quat);
          const fast = P.speed > 4;
          if ((w.skid > 0.25 || w.locked) && fast && !soft) this.skids.add(key, w.contactPt, w.n, side, w.front ? 0.3 : 0.4, [0.03, 0.03, 0.03], clamp(w.skid + (w.locked ? 0.5 : 0), 0.2, 0.75));
          else if (soft && fast) this.skids.add(key, w.contactPt, w.n, side, w.front ? 0.3 : 0.4, w.surf === SURF.GRAVEL ? [0.32, 0.27, 0.2] : [0.18, 0.14, 0.08], 0.55);
          else this.skids.lift(key);
          if (w.skid > 0.45 && fast && !soft && Math.random() < w.skid * 0.9) this.smoke.spawn(w.contactPt.x, w.contactPt.y + 0.2, w.contactPt.z, P.vel.x * 0.25 + (Math.random() - .5), 0.6 + Math.random(), P.vel.z * 0.25 + (Math.random() - .5), 1.4 + Math.random(), 0.5, 3.5, 0.78, 0.78, 0.8, 0.28 * w.skid, 1.4, -0.3);
          if (soft && fast && Math.random() < 0.5) { const col = w.surf === SURF.GRAVEL ? [0.62, 0.55, 0.44] : [0.36, 0.32, 0.2]; this.smoke.spawn(w.contactPt.x, w.contactPt.y + 0.15, w.contactPt.z, P.vel.x * 0.15 + (Math.random() - .5) * 2, 0.8 + Math.random() * 1.5, P.vel.z * 0.15 + (Math.random() - .5) * 2, 1.0 + Math.random(), 0.4, 2.8, col[0], col[1], col[2], 0.35, 1.8, 1.0); }
        });
      } else {
        const off = Math.abs(P.q.u) > P.q.halfW + 1;
        if (off && P.speed > 6 && Math.random() < 0.6) { const f = _v1.set(0, 0, -1.6).applyQuaternion(P.quat).add(P.pos); this.smoke.spawn(f.x, f.y - 0.1, f.z, (Math.random() - .5) * 2, 1 + Math.random(), (Math.random() - .5) * 2, 1.2, 0.5, 3, 0.45, 0.4, 0.3, 0.3, 1.8, 0.8); }
      }
    }
    this.smoke.update(dt); this.sparks.update(dt); this.skids.update();
  }
  audioUpdate() {
    const ph = this.player.phys;
    let squeal = 0, gravel = 0, grass = 0, kerb = 0;
    for (const w of ph.wheels) { if (!w.contact) continue; if (w.surf === SURF.GRAVEL) gravel += 0.25; else if (w.surf === SURF.GRASS) grass += 0.25; else { squeal = Math.max(squeal, w.skid * 1.2 + (w.locked ? 0.6 : 0)); if (w.surf === SURF.KERB) kerb += 0.25; } }
    const sp = ph.speed;
    let oppRpm = 0, oppGain = 0;
    for (const c of this.cars) { if (c.isPlayer) continue; const d = c.phys.pos.distanceTo(ph.pos); const g = clamp(1 - d / 80, 0, 1); if (g > oppGain) { oppGain = g; oppRpm = c.phys.rpm; } }
    this.audio.update({ cyl: ph.P.cyl, rpm: ph.engine.rpm, throttle: ph.input.throttle * (ph.engine.shiftT > 0 ? 0.3 : 1), running: true, limiter: ph.engine.limiter, squeal: squeal * clamp(sp / 8, 0, 1), gravel: gravel * clamp(sp / 10, 0, 1), grass: grass * clamp(sp / 10, 0, 1), kerb: kerb * clamp(sp / 20, 0, 1), speed: sp, oppRpm, oppGain });
  }
  menuInfo(dt) {
    this._miT = (this._miT || 0) - dt; if (this._miT > 0) return; this._miT = 1;
    const P = this.perf, el = document.getElementById('perfinfo'); if (!el) return;
    // high-end GPU on a 60 Hz screen: the High preset looks better than the 240 FPS one
    if (P.n >= 120 && !this.userPickedQuality && this.device.tier === 4 && !this._tierChecked) { this._tierChecked = true; const want = P.refreshHz >= 120 ? 'competitive' : 'high'; if (want !== this.quality) this.setQuality(want); }
    const d = this.device, c = this.caps;
    el.textContent = `Detected: ${this.gpuName.replace(/^ANGLE \(|\)$/g, '')} · ${d.cores} CPU threads · ${c.gl2 ? 'WebGL2' : 'WebGL1'}${c.floatRT ? '' : ' (no HDR targets)'} · display ${P.refreshHz} Hz · tier ${d.tier}/4 → ${QUALITY_NAME[this.quality]}${d.software ? ' · Software rendering: enable hardware acceleration for much better speed' : ''}`;
  }
  menuOrbit(dt) {
    this.menuCam += dt * 0.04;
    const f = this.track.frameAt(this.track.length * 0.02 + Math.sin(this.menuCam) * 40, 0);
    const a = this.menuCam * 2.2;
    this.camera.position.set(f.pos.x + Math.cos(a) * 160, f.pos.y + 55, f.pos.z + Math.sin(a) * 160);
    this.camera.up.set(0, 1, 0); this.camera.lookAt(f.pos.x + 150, f.pos.y + 10, f.pos.z + 120);
    this.camera.fov = 55; this.camera.near = 0.1; this.camera.updateProjectionMatrix();
    this.veg.update(this.camera.position);
  }
  // Refresh-aware dynamic resolution. The budget is the display interval (or the user's cap), so a
  // vsync-limited frame is never mistaken for a slow one. With GPU timer queries available, spare GPU
  // time is converted into supersampling up to the preset's maxScale.
  dynamicResolution(dt) {
    this._drT = (this._drT || 0) + dt; this._drCool = Math.max(0, (this._drCool || 0) - dt);
    if (!this.dynRes || this._drT < 0.5 || !this.inSession || this.paused) return;
    this._drT = 0;
    const P = this.perf;
    const target = Math.min(this.fpsCap > 0 ? this.fpsCap : 1000, P.refreshHz, this.Q.fpsTarget || 1000);
    const budget = 1000 / target, frame = this.frameMs, gpu = P.gpuMs, cpu = P.cpu.total;
    let s = this.resScale;
    // Automatic preset step-down: if the machine cannot reach a playable rate even at the lowest
    // render scale (GPU-bound) or the CPU alone exceeds the budget, switch to the next lower preset.
    const floorMs = 1000 / Math.min(target, 50);
    const stuck = frame > floorMs * 1.15 && (s <= this.minScale + 0.001 || cpu > floorMs * 0.85);
    this._slowT = stuck ? (this._slowT || 0) + 0.5 : 0;
    if (this.autoQuality && this._slowT >= 4 && QUALITY_DOWN[this.quality]) {
      const next = QUALITY_DOWN[this.quality]; this._slowT = 0;
      this.setQuality(next); this.flash('GRAPHICS ADJUSTED', QUALITY_NAME[next].toUpperCase() + ' FOR SMOOTHER FRAMES');
      return;
    }
    if (frame > budget * 1.08 && (gpu == null || gpu > budget * 0.8 || cpu < budget * 0.6)) { s -= frame > budget * 1.4 ? 0.12 : 0.06; this._drCool = 2.5; }
    else if (this._drCool <= 0) {
      if (gpu != null && gpu < budget * 0.68 && cpu < budget * 0.85) s += 0.05;
      else if (gpu == null && frame <= budget * 1.03 && s < 1) s += 0.04;
    }
    s = clamp(s, this.minScale, gpu != null ? this.maxScale : Math.min(1, this.maxScale));
    if (Math.abs(s - this.resScale) > 0.001) this.applyRes(s);
  }
  applyRes(s) { this.resScale = s; const pr = this.basePixel * s; this.renderer.setPixelRatio(pr); if (this.composer) { this.composer.setPixelRatio(pr); this.composer.setSize(window.innerWidth, window.innerHeight); } this.updateParticleScale(); }
  render(dt) {
    // shadow camera follows the viewer
    const focus = this.inSession && this.player ? this.player.model.root.position : this.camera.position;
    this.sun.target.position.copy(focus); this.sun.position.copy(focus).addScaledVector(this.sunDir, 400);
    this._vegT = (this._vegT || 0) - dt; if (this._vegT <= 0) { this._vegT = 0.1; this.veg.update(this.camera.position);
      const cp = this.camera.position; for (const o of this.trackCull) { const b = o.geometry.boundingSphere; o.visible = cp.distanceTo(b.center) - b.radius < 1800; } }
    this.dynamicResolution(dt);
    const tR = performance.now(); this.perf.beginGPU();
    if (this.composer) this.composer.render(dt); else this.renderer.render(this.scene, this.camera);
    this.perf.endGPU(); this.perf.add('render', performance.now() - tR);
    this.drawCalls = this.renderer.info.render.calls; this.drawTris = this.renderer.info.render.triangles;
  }
}

// ---------------------------------------------------------------- boot
(async () => {
  try {
    const game = new Game();
    window.__agpGame = game;
    try { const m = await import('three/addons/postprocessing/GTAOPass.js'); game.GTAOPass = m.GTAOPass; } catch (e) { console.warn('GTAOPass not loaded; ambient occlusion disabled', e); }
    await game.init();
  } catch (err) {
    console.error(err);
    window.__agpFail((err && err.stack) || String(err));
  }
})();
</script>
</body>
</html>
