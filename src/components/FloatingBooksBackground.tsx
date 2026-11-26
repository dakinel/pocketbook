import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

interface CoverTheme {
  top: string;
  bot: string;
  fg: string;
  ac: string;
}

interface CoverDesign {
  theme: CoverTheme;
  variant: number;
  face: THREE.MeshPhysicalMaterial | null;
  edge: THREE.MeshStandardMaterial | null;
  tex: THREE.CanvasTexture | null;
}

interface FloatingBookEntry {
  mesh: THREE.Group;
  r: number;
  base: THREE.Euler;
  baseY: number;
  amp: number;
  bob: number;
  speed: number;
  phase: number;
  foilMaterial: THREE.ShaderMaterial;
}

const THEMES: CoverTheme[] = [
  { top: '#2b363b', bot: '#12181b', fg: '#e8f1f0', ac: '#8fe0cf' },
  { top: '#f7f9f9', bot: '#d6dfe0', fg: '#17302d', ac: '#2e8f86' },
  { top: '#1a6064', bot: '#0a2b2e', fg: '#e2f6f1', ac: '#a8f0dc' },
  { top: '#d3e3f0', bot: '#9ab5cc', fg: '#14283a', ac: '#3b6f9e' },
  { top: '#232c52', bot: '#0b0f25', fg: '#e6e9ff', ac: '#9aa8ff' },
  { top: '#f3ae93', bot: '#d4623f', fg: '#2a120b', ac: '#fff1e8' },
  { top: '#c3d5c1', bot: '#8ba68b', fg: '#142418', ac: '#2f5d3e' },
];

function hexToRgba(hex: string, alpha: number): string {
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function drawCover(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  th: CoverTheme,
  variant: number
) {
  const grd = ctx.createLinearGradient(0, 0, 0, h);
  grd.addColorStop(0, th.top);
  grd.addColorStop(1, th.bot);
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, w, h);

  const cx = w / 2;

  if (variant === 0) {
    const cy = h * 0.42;
    const sph = ctx.createRadialGradient(cx - 14, cy - 14, 4, cx, cy, 78);
    sph.addColorStop(0, hexToRgba(th.ac, 1));
    sph.addColorStop(1, hexToRgba(th.ac, 0));
    ctx.fillStyle = sph;
    ctx.beginPath();
    ctx.arc(cx, cy, 78, 0, Math.PI * 2);
    ctx.fill();
    for (let k = 0; k < 6; k++) {
      ctx.strokeStyle = hexToRgba(th.fg, 0.38 - k * 0.05);
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.arc(cx, cy, 70 + k * 34, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = hexToRgba(th.fg, 0.9);
    ctx.beginPath();
    ctx.arc(cx + Math.cos(0.9) * 138, cy + Math.sin(0.9) * 138, 5, 0, Math.PI * 2);
    ctx.fill();
  } else if (variant === 1) {
    const hy = h * 0.52;
    const sun = ctx.createLinearGradient(0, hy - 130, 0, hy);
    sun.addColorStop(0, hexToRgba(th.ac, 0.95));
    sun.addColorStop(1, hexToRgba(th.ac, 0.05));
    ctx.fillStyle = sun;
    ctx.beginPath();
    ctx.arc(cx, hy, 130, Math.PI, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = hexToRgba(th.fg, 0.6);
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(40, hy);
    ctx.lineTo(w - 40, hy);
    ctx.stroke();
    ctx.lineWidth = 1;
    for (let i = -10; i <= 10; i++) {
      ctx.strokeStyle = hexToRgba(th.fg, 0.22);
      ctx.beginPath();
      ctx.moveTo(cx + i * 10, hy);
      ctx.lineTo(cx + i * 70, h * 0.92);
      ctx.stroke();
    }
    for (let k = 1; k <= 9; k++) {
      const yy = hy + Math.pow(k / 9, 2) * (h * 0.4);
      ctx.strokeStyle = hexToRgba(th.fg, 0.2);
      ctx.beginPath();
      ctx.moveTo(0, yy);
      ctx.lineTo(w, yy);
      ctx.stroke();
    }
  } else if (variant === 2) {
    for (let k = 0; k < 31; k++) {
      ctx.strokeStyle = hexToRgba(
        k % 6 === 0 ? th.ac : th.fg,
        0.16 + (1 - Math.abs(k - 15) / 15) * 0.5
      );
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 60; x <= w - 60; x += 4) {
        const y =
          h * 0.45 +
          (k - 15) * 7 +
          Math.sin(x * 0.018 + k * 0.22) * 40 * (1 - Math.abs(k - 15) / 22);
        if (x === 60) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  } else if (variant === 3) {
    const blobs: Array<[number, number, number, string, number]> = [
      [w * 0.3, h * 0.35, 190, th.ac, 0.6],
      [w * 0.72, h * 0.5, 210, th.fg, 0.2],
      [w * 0.45, h * 0.72, 160, th.ac, 0.38],
    ];
    for (const b of blobs) {
      const rg = ctx.createRadialGradient(b[0], b[1], 0, b[0], b[1], b[2]);
      rg.addColorStop(0, hexToRgba(b[3], b[4]));
      rg.addColorStop(1, hexToRgba(b[3], 0));
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.strokeStyle = hexToRgba(th.fg, 0.6);
    ctx.lineWidth = 1.5;
    ctx.strokeRect(56, 56, w - 112, h - 112);
  } else if (variant === 4) {
    for (let gx = 40; gx < w - 30; gx += 16) {
      for (let gy = 40; gy < h * 0.82; gy += 16) {
        const dd = Math.hypot(gx - w * 0.7, gy - h * 0.3);
        const rr = Math.max(0, 1 - dd / 380) * 6.2;
        if (rr < 0.4) continue;
        ctx.fillStyle = hexToRgba(th.ac, 0.95);
        ctx.beginPath();
        ctx.arc(gx, gy, rr, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  } else {
    for (let i = 0; i < 44; i++) {
      const bh = 30 + Math.abs(Math.sin(i * 0.5) * Math.cos(i * 0.17)) * 200;
      ctx.fillStyle = i % 7 === 0 ? hexToRgba(th.ac, 1) : hexToRgba(th.fg, 0.8);
      ctx.fillRect(36 + i * 10, h * 0.42 - bh / 2, 5, bh);
    }
  }

  ctx.strokeStyle = hexToRgba(th.fg, 0.5);
  ctx.lineWidth = 1.5;
  const corners: Array<[number, number, number, number]> = [
    [24, 24, 1, 1],
    [w - 24, 24, -1, 1],
    [24, h - 24, 1, -1],
    [w - 24, h - 24, -1, -1],
  ];
  for (const c of corners) {
    ctx.beginPath();
    ctx.moveTo(c[0] + c[2] * 16, c[1]);
    ctx.lineTo(c[0], c[1]);
    ctx.lineTo(c[0], c[1] + c[3] * 16);
    ctx.stroke();
  }

  ctx.fillStyle = hexToRgba(th.ac, 1);
  ctx.fillRect(48, h - 100, 70, 6);
  ctx.fillStyle = hexToRgba(th.fg, 0.55);
  ctx.fillRect(48, h - 82, 150, 2);
  ctx.fillStyle = hexToRgba(th.fg, 0.35);
  ctx.fillRect(48, h - 72, 110, 2);
  ctx.strokeStyle = hexToRgba(th.ac, 0.9);
  ctx.lineWidth = 1.5;
  ctx.strokeRect(w - 74, h - 84, 24, 24);

  for (let i = 0; i < 6000; i++) {
    ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.05})`;
    ctx.fillRect(Math.random() * w, Math.random() * h, 1, 1);
  }
}

const FOIL_VS = [
  'varying vec2 vUv; varying vec3 vN; varying vec3 vP;',
  'void main(){',
  '  vUv = uv;',
  '  vN = normalize(mat3(modelMatrix) * normal);',
  '  vec4 wp = modelMatrix * vec4(position, 1.0);',
  '  vP = wp.xyz;',
  '  gl_Position = projectionMatrix * viewMatrix * wp;',
  '}',
].join('\n');

const FOIL_FS = [
  'uniform float uTime; uniform float uShape; uniform float uSeed;',
  'uniform vec3 uFogColor; uniform float uFogNear; uniform float uFogFar;',
  'varying vec2 vUv; varying vec3 vN; varying vec3 vP;',
  'vec3 iri(float t){ return 0.5 + 0.5*cos(6.28318*(t + vec3(0.0,0.33,0.67))); }',
  'float ln(float d, float w, float aa){ float ww = max(w, aa); return 1.0 - smoothstep(ww*0.5, ww, abs(d)); }',
  'void main(){',
  '  vec2 p = (vUv - 0.5) * vec2(1.0, 1.25);',
  '  float aa = fwidth(vUv.y) * 1.3;',
  '  float m = 0.0;',
  '  if (uShape < 0.5) {',
  '    float r = length(p - vec2(0.0, 0.1));',
  '    m = ln(r-0.30,0.004,aa) + 0.6*ln(r-0.38,0.003,aa) + 0.4*ln(r-0.22,0.003,aa);',
  '  } else if (uShape < 1.5) {',
  '    vec2 q = p - vec2(0.0, -0.025);',
  '    m = ln(length(q)-0.26,0.004,aa) * step(0.0,q.y);',
  '    m += ln(q.y,0.004,aa) * step(abs(q.x),0.36);',
  '  } else if (uShape < 2.5) {',
  '    float s = 0.08*sin(p.x*9.2 + uSeed*6.0);',
  '    float inX = step(abs(p.x),0.34);',
  '    m = ln(p.y-0.0625-s,0.004,aa)*inX + 0.5*ln(p.y+0.0125-s,0.003,aa)*inX;',
  '  } else if (uShape < 3.5) {',
  '    float d = max(abs(p.x)-0.39, abs(p.y)-0.516);',
  '    m = ln(d,0.005,aa);',
  '  } else if (uShape < 4.5) {',
  '    float d = p.x*0.8 + p.y*0.6 + 0.15;',
  '    m = ln(d,0.004,aa)*step(abs(p.x),0.4)*step(abs(p.y),0.55);',
  '    m += ln(length(p-vec2(0.2,0.25))-0.06,0.003,aa);',
  '  } else {',
  '    m = ln(p.y+0.17,0.005,aa)*step(abs(p.x),0.43) + ln(p.y-0.37,0.003,aa)*step(abs(p.x),0.43)*0.6;',
  '  }',
  '  m += ln(length(p-vec2(0.34,0.54))-0.025,0.003,aa);',
  '  vec3 N = normalize(vN);',
  '  vec3 V = normalize(cameraPosition - vP);',
  '  float f = pow(1.0 - abs(dot(N,V)), 1.5);',
  '  float hue = f*1.1 + p.x*0.5 + p.y*0.35 + uTime*0.05 + uSeed;',
  '  vec3 col = mix(iri(hue), vec3(1.0), 0.2);',
  '  col = pow(col, vec3(2.2));',
  '  float a = clamp(m,0.0,1.0) * (0.7 + 0.3*f);',
  '  a *= 1.0 - smoothstep(uFogNear, uFogFar, length(cameraPosition - vP));',
  '  gl_FragColor = vec4(col, a);',
  '  #include <tonemapping_fragment>',
  '  #include <colorspace_fragment>',
  '}',
].join('\n');

const _lookTarget = new THREE.Vector3(0, 0, 0);
const _drawSize = new THREE.Vector2();

function detectSoftwareWebGL(): boolean {
  try {
    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl2') || probe.getContext('webgl');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) || '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return false;
  }
}

export function FloatingBooksBackground({ paused = false }: { paused?: boolean } = {}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(paused);
  const resumeLoopRef = useRef<(() => void) | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    pausedRef.current = paused;
    if (!paused) {
      resumeLoopRef.current?.();
    }
  }, [paused]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const lowPower =
      Math.min(window.innerWidth, window.innerHeight) < 700 ||
      /Mobi|Android/i.test(navigator.userAgent);
    const isSoftwareGl = detectSoftwareWebGL();

    const fogColor = new THREE.Color(0x0d191c);
    const fogNear = 8;
    const fogFar = 15;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: !isSoftwareGl,
        alpha: true,
        powerPreference: 'high-performance',
      });
    } catch {
      return;
    }

    renderer.setPixelRatio(
      isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, lowPower ? 1.5 : 2)
    );
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.autoClear = false;
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(fogColor, fogNear, fogFar);

    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    camera.position.set(0, 0, 10);

    // Full-screen WebGL shader backdrop
    const bgScene = new THREE.Scene();
    const bgCam = new THREE.Camera();
    const bgMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uRes: { value: new THREE.Vector2(1, 1) },
        uMouse: { value: new THREE.Vector2(0, 0) },
      },
      vertexShader: 'void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: [
        'uniform float uTime; uniform vec2 uRes; uniform vec2 uMouse;',
        'float hash(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }',
        'float noise(vec2 p){',
        '  vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);',
        '  return mix(mix(hash(i),hash(i+vec2(1.0,0.0)),f.x), mix(hash(i+vec2(0.0,1.0)),hash(i+vec2(1.0,1.0)),f.x), f.y);',
        '}',
        'void main(){',
        '  vec2 uv = gl_FragCoord.xy / uRes;',
        '  float asp = uRes.x / uRes.y;',
        '  vec2 p = vec2(uv.x*asp, uv.y);',
        '  vec3 edge = vec3(0.024,0.047,0.055);',
        '  vec3 mid  = vec3(0.051,0.098,0.110);',
        '  vec3 hi   = vec3(0.094,0.165,0.180);',
        '  float d = length((uv - vec2(0.68,0.5)) * vec2(asp,1.0));',
        '  vec3 col = mix(hi, mid, smoothstep(0.0,0.58,d));',
        '  col = mix(col, edge, smoothstep(0.45,1.25,d));',
        '  float n1 = noise(p*1.5 + vec2(uTime*0.02,-uTime*0.015) + uMouse*0.3);',
        '  float n2 = noise(p*2.8 - vec2(uTime*0.018, uTime*0.010));',
        '  col = mix(col, vec3(0.07,0.23,0.22), smoothstep(0.46,0.86,n1)*0.36);',
        '  col = mix(col, vec3(0.08,0.15,0.27), smoothstep(0.52,0.88,n2)*0.28);',
        '  col *= 1.0 - 0.22*smoothstep(0.45,1.2,length((uv-0.5)*vec2(asp,1.0)));',
        '  col += (hash(gl_FragCoord.xy) - 0.5) * 0.022;',
        '  gl_FragColor = vec4(col, 1.0);',
        '}',
      ].join('\n'),
      depthTest: false,
      depthWrite: false,
    });
    const bgGeo = new THREE.PlaneGeometry(2, 2);
    const bgQuad = new THREE.Mesh(bgGeo, bgMat);
    bgQuad.frustumCulled = false;
    bgScene.add(bgQuad);

    // Procedural studio environment via PMREM
    const envScene = new THREE.Scene();
    const skyGeo = new THREE.SphereGeometry(30, 32, 16);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      vertexShader:
        'varying float vY; void main(){ vY = normalize(position).y; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: [
        'varying float vY;',
        'void main(){',
        '  vec3 top = vec3(0.75,0.88,0.89);',
        '  vec3 hor = vec3(0.22,0.32,0.34);',
        '  vec3 bot = vec3(0.04,0.06,0.08);',
        '  vec3 c = vY > 0.0 ? mix(hor, top, pow(vY,0.65)) : mix(hor, bot, pow(-vY,0.65));',
        '  gl_FragColor = vec4(c, 1.0);',
        '}',
      ].join('\n'),
    });
    envScene.add(new THREE.Mesh(skyGeo, skyMat));

    const softboxDisposables: Array<{ geo: THREE.PlaneGeometry; mat: THREE.MeshBasicMaterial }> = [];
    const addSoftbox = (
      w: number,
      h: number,
      x: number,
      y: number,
      z: number,
      r: number,
      g: number,
      b: number
    ) => {
      const geo = new THREE.PlaneGeometry(w, h);
      const mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(r, g, b),
        side: THREE.DoubleSide,
      });
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.lookAt(0, 0, 0);
      envScene.add(m);
      softboxDisposables.push({ geo, mat });
    };
    addSoftbox(16, 7, 0, 16, 6, 4.0, 4.0, 4.0);
    addSoftbox(7, 12, 16, 4, 8, 2.2, 3.4, 3.2);
    addSoftbox(5, 14, -16, 2, -6, 2.6, 2.6, 3.0);
    addSoftbox(18, 3, 0, -12, 4, 1.2, 1.3, 1.3);

    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTarget = pmrem.fromScene(envScene, 0.02);
    scene.environment = envTarget.texture;
    pmrem.dispose();
    skyGeo.dispose();
    skyMat.dispose();
    for (const s of softboxDisposables) {
      s.geo.dispose();
      s.mat.dispose();
    }

    // Lights
    scene.add(new THREE.HemisphereLight(0xdaf0ef, 0x0d191c, 0.36));

    const key = new THREE.DirectionalLight(0xfff1dc, 1.18);
    key.position.set(8, 12, 14);
    key.castShadow = !isSoftwareGl;
    const sm = lowPower ? 1024 : 2048;
    key.shadow.mapSize.set(sm, sm);
    key.shadow.camera.left = -9;
    key.shadow.camera.right = 9;
    key.shadow.camera.top = 9;
    key.shadow.camera.bottom = -9;
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 50;
    key.shadow.bias = -0.0004;
    key.shadow.radius = 4;
    scene.add(key);

    const maxAniso = renderer.capabilities.getMaxAnisotropy();

    function canvasTexture(
      w: number,
      h: number,
      draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void
    ): THREE.CanvasTexture {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d');
      if (ctx) {
        draw(ctx, w, h);
      }
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = Math.min(8, maxAniso);
      return tex;
    }

    function pagesTexture(vertical: boolean): THREE.CanvasTexture {
      return canvasTexture(256, 256, (g, w, h) => {
        g.fillStyle = '#f3eee2';
        g.fillRect(0, 0, w, h);
        for (let i = 0; i < 90; i++) {
          const p = Math.random() * (vertical ? w : h);
          g.fillStyle = `rgba(120,105,80,${0.05 + Math.random() * 0.1})`;
          if (vertical) g.fillRect(p, 0, 1, h);
          else g.fillRect(0, p, w, 1);
        }
        const sh = g.createLinearGradient(0, 0, vertical ? w : 0, vertical ? 0 : h);
        sh.addColorStop(0, 'rgba(0,0,0,0.12)');
        sh.addColorStop(0.5, 'rgba(0,0,0,0)');
        sh.addColorStop(1, 'rgba(0,0,0,0.12)');
        g.fillStyle = sh;
        g.fillRect(0, 0, w, h);
      });
    }

    const CW = 512;
    const CH = 640;
    const designs: CoverDesign[] = [];
    for (let di = 0; di < 12; di++) {
      designs.push({
        theme: THEMES[di % THEMES.length],
        variant: (di * 5 + Math.floor(di / 7) * 2) % 6,
        face: null,
        edge: null,
        tex: null,
      });
    }

    function ensureDesign(d: CoverDesign) {
      if (d.face && d.edge) return d;
      const tex = canvasTexture(CW, CH, (g, w, h) => drawCover(g, w, h, d.theme, d.variant));
      d.tex = tex;
      d.face = new THREE.MeshPhysicalMaterial({
        map: tex,
        roughness: 0.38,
        metalness: 0.0,
        clearcoat: 0.85,
        clearcoatRoughness: 0.18,
        envMapIntensity: 0.9,
      });
      d.edge = new THREE.MeshStandardMaterial({
        color: Number.parseInt(d.theme.bot.slice(1), 16),
        roughness: 0.45,
        metalness: 0.15,
        envMapIntensity: 0.8,
      });
      return d;
    }

    const sharedTimeUniform = { value: 0 };
    const sharedFogColorUniform = { value: fogColor };
    const sharedFogNearUniform = { value: fogNear };
    const sharedFogFarUniform = { value: fogFar };

    function foilMaterial(shape: number, seed: number): THREE.ShaderMaterial {
      return new THREE.ShaderMaterial({
        uniforms: {
          uTime: sharedTimeUniform,
          uShape: { value: shape },
          uSeed: { value: seed },
          uFogColor: sharedFogColorUniform,
          uFogNear: sharedFogNearUniform,
          uFogFar: sharedFogFarUniform,
        },
        vertexShader: FOIL_VS,
        fragmentShader: FOIL_FS,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });
    }

    const W = 2.4;
    const H = 3;
    const D = 0.72;

    const chromeMat = new THREE.MeshStandardMaterial({
      color: 0xdfe6e6,
      roughness: 0.22,
      metalness: 1.0,
      envMapIntensity: 1.1,
    });
    const pageTexV = pagesTexture(true);
    const pageTexH = pagesTexture(false);
    const pageEdge = new THREE.MeshStandardMaterial({
      color: 0xece6d8,
      roughness: 0.95,
      envMapIntensity: 0.4,
    });
    const pageV = new THREE.MeshStandardMaterial({
      map: pageTexV,
      roughness: 0.95,
      envMapIntensity: 0.4,
    });
    const pageH = new THREE.MeshStandardMaterial({
      map: pageTexH,
      roughness: 0.95,
      envMapIntensity: 0.4,
    });
    const pageMats = [pageEdge, pageV, pageH, pageH, pageEdge, pageEdge];

    const coverGeo = new THREE.BoxGeometry(W, H, 0.06);
    const spineGeo = new THREE.BoxGeometry(0.07, H, D + 0.06);
    const pagesGeo = new THREE.BoxGeometry(W - 0.12, H - 0.18, D - 0.04);
    const bandGeo = new THREE.BoxGeometry(0.085, 0.045, D + 0.07);
    const foilGeo = new THREE.PlaneGeometry(W, H);

    function createBook(design: CoverDesign): { group: THREE.Group; foilMat: THREE.ShaderMaterial } {
      const d = ensureDesign(design);
      const group = new THREE.Group();
      const faceMat = d.face!;
      const edgeMat = d.edge!;

      const front = new THREE.Mesh(coverGeo, [edgeMat, edgeMat, edgeMat, edgeMat, faceMat, edgeMat]);
      const back = new THREE.Mesh(coverGeo, [edgeMat, edgeMat, edgeMat, edgeMat, edgeMat, faceMat]);
      front.position.z = D / 2;
      back.position.z = -D / 2;

      const spine = new THREE.Mesh(spineGeo, edgeMat);
      spine.position.x = W / 2;

      const pages = new THREE.Mesh(pagesGeo, pageMats);
      pages.position.x = -0.03;

      group.add(front, back, spine, pages);

      for (const y of [0.98, -0.98]) {
        const band = new THREE.Mesh(bandGeo, chromeMat);
        band.position.set(W / 2 + 0.01, y, 0);
        group.add(band);
      }

      group.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          o.castShadow = !isSoftwareGl;
          o.receiveShadow = !isSoftwareGl;
        }
      });

      const seed = Math.random();
      const fm = foilMaterial(d.variant, seed);
      const foilF = new THREE.Mesh(foilGeo, fm);
      foilF.position.z = D / 2 + 0.034;
      const foilB = new THREE.Mesh(foilGeo, fm);
      foilB.position.z = -(D / 2 + 0.034);
      foilB.rotation.y = Math.PI;
      group.add(foilF, foilB);

      return { group, foilMat: fm };
    }

    const cluster = new THREE.Group();
    scene.add(cluster);

    const books: FloatingBookEntry[] = [];
    const COUNT = lowPower ? 22 : 38;

    function tooClose(pos: THREE.Vector3, r: number): boolean {
      for (let i = 0; i < books.length; i++) {
        if (pos.distanceTo(books[i].mesh.position) < (r + books[i].r) * 1.7) {
          return true;
        }
      }
      return false;
    }

    const candidatePos = new THREE.Vector3();
    for (let n = 0; n < COUNT; n++) {
      const { group: mesh, foilMat } = createBook(
        designs[Math.floor(Math.random() * designs.length)]
      );
      const s = 0.12 + Math.pow(Math.random(), 1.4) * 0.32;
      mesh.scale.set(s, s, s * (0.8 + Math.random() * 0.7));

      const r = s * 1.9;
      let tries = 0;
      do {
        candidatePos.set(
          (Math.random() - 0.5) * 13,
          (Math.random() - 0.5) * 7.4,
          (Math.random() - 0.5) * 6.4
        );
        tries++;
      } while (tooClose(candidatePos, r) && tries < 100);

      mesh.position.copy(candidatePos);
      mesh.rotation.set(
        Math.random() * Math.PI * 2,
        Math.random() * Math.PI * 2,
        Math.random() * Math.PI * 2
      );

      cluster.add(mesh);
      books.push({
        mesh,
        r,
        base: mesh.rotation.clone(),
        baseY: candidatePos.y,
        amp: 0.15 + Math.random() * 0.35,
        bob: 0.05 + Math.random() * 0.12,
        speed: 0.15 + Math.random() * 0.25,
        phase: Math.random() * Math.PI * 2,
        foilMaterial: foilMat,
      });
    }

    function layout() {
      const w = window.innerWidth;
      const h = window.innerHeight;
      renderer.setSize(w, h, false);
      renderer.getDrawingBufferSize(_drawSize);
      bgMat.uniforms.uRes.value.copy(_drawSize);
      camera.aspect = w / Math.max(1, h);
      const wide = camera.aspect > 1.15;
      cluster.position.x = wide ? 2.0 : 0;
      camera.position.z = wide ? 10 : 13;
      camera.updateProjectionMatrix();
    }
    window.addEventListener('resize', layout);
    layout();

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    const mouse = { x: 0, y: 0 };
    const smooth = { x: 0, y: 0 };
    const onPointerMove = (e: PointerEvent) => {
      mouse.x = e.clientX / Math.max(1, window.innerWidth) - 0.5;
      mouse.y = e.clientY / Math.max(1, window.innerHeight) - 0.5;
    };
    window.addEventListener('pointermove', onPointerMove, { passive: true });

    let disposed = false;
    let contextLost = false;
    let frameId = 0;
    let loopActive = false;
    let elapsedTime = 0;

    const onContextLost = (e: Event) => {
      e.preventDefault();
      contextLost = true;
    };
    const onContextRestored = () => {
      contextLost = false;
      layout();
      resumeLoop();
    };
    renderer.domElement.addEventListener('webglcontextlost', onContextLost);
    renderer.domElement.addEventListener('webglcontextrestored', onContextRestored);

    const clock = new THREE.Clock();

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      if (typeof gl.fenceSync !== 'function') {
        frameId = window.setTimeout(cb, 80);
        return;
      }
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (disposed || pausedRef.current || document.hidden) {
          loopActive = false;
          if (sync) gl.deleteSync(sync);
          return;
        }
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    function renderFrame() {
      if (disposed) {
        loopActive = false;
        return;
      }
      if (pausedRef.current || document.hidden) {
        loopActive = false;
        return;
      }
      if (!contextLost) {
        const dt = Math.min(0.05, clock.getDelta());
        if (!reduceMotion) {
          elapsedTime += dt;
        }
        const t = reduceMotion ? 0 : elapsedTime;

        smooth.x += (mouse.x - smooth.x) * 0.04;
        smooth.y += (mouse.y - smooth.y) * 0.04;

        sharedTimeUniform.value = t;
        bgMat.uniforms.uTime.value = t;
        bgMat.uniforms.uMouse.value.set(smooth.x, smooth.y);

        camera.position.x = smooth.x * 1.2;
        camera.position.y = -smooth.y * 0.8;
        camera.lookAt(_lookTarget);

        cluster.rotation.y = Math.sin(t * 0.05) * 0.35 + smooth.x * 0.25;
        cluster.rotation.x = Math.sin(t * 0.08) * 0.05 - smooth.y * 0.15;
        cluster.position.y = (window.pageYOffset || 0) * 0.0016;

        for (let i = 0; i < books.length; i++) {
          const b = books[i];
          const m = b.mesh;
          const k = t * b.speed + b.phase;
          m.rotation.x = b.base.x + Math.sin(k) * b.amp;
          m.rotation.y = b.base.y + Math.cos(k * 0.8) * b.amp;
          m.rotation.z = b.base.z + Math.sin(k * 0.6) * b.amp * 0.6;
          m.position.y = b.baseY + Math.sin(k * 1.1) * b.bob;
        }

        renderer.clear();
        renderer.render(bgScene, bgCam);
        renderer.clearDepth();
        renderer.render(scene, camera);
      }

      if (isSoftwareGl) {
        afterDraw(renderFrame);
      } else {
        frameId = window.requestAnimationFrame(renderFrame);
      }
    }

    function resumeLoop() {
      if (disposed || loopActive || pausedRef.current || document.hidden) return;
      loopActive = true;
      clock.getDelta();
      renderFrame();
    }

    resumeLoopRef.current = resumeLoop;

    const onVisibilityChange = () => {
      if (!document.hidden && !pausedRef.current) {
        resumeLoop();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    resumeLoop();
    const readyRaf = window.requestAnimationFrame(() => setReady(true));

    return () => {
      disposed = true;
      loopActive = false;
      resumeLoopRef.current = null;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.cancelAnimationFrame(readyRaf);
      window.cancelAnimationFrame(frameId);
      window.clearTimeout(frameId);
      window.removeEventListener('resize', layout);
      window.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
      renderer.domElement.removeEventListener('webglcontextrestored', onContextRestored);

      coverGeo.dispose();
      spineGeo.dispose();
      pagesGeo.dispose();
      bandGeo.dispose();
      foilGeo.dispose();
      bgGeo.dispose();
      bgMat.dispose();
      chromeMat.dispose();
      pageEdge.dispose();
      pageV.dispose();
      pageH.dispose();
      pageTexV.dispose();
      pageTexH.dispose();
      envTarget.dispose();

      for (const d of designs) {
        d.face?.dispose();
        d.edge?.dispose();
        d.tex?.dispose();
      }
      for (const b of books) {
        b.foilMaterial.dispose();
      }

      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  return (
    <div
      ref={containerRef}
      id="bg"
      aria-hidden="true"
      className={`floating-books-bg ${ready ? 'ready' : ''}`}
    />
  );
}
