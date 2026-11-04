// A tiny WebGL renderer for soap bubbles.
//
// Each bubble is a screen-aligned quad whose fragment shader ray-traces a sphere analytically
// and shades *both* film layers (the near wall and the far wall seen through it) with real
// thin-film interference: film thickness comes from a gravity drainage gradient plus a slowly
// swirling noise field, reflectance from the exact Airy formula for a symmetric film, converted
// to RGB through CIE colour-matching samples. What the film reflects is a little procedural
// photo studio (a window with mullions, a cool fill, a dim sky) so you get the familiar
// window-shaped glints and their upside-down twins from the back wall.
//
// Popping is a hole that opens at the touch point and sweeps around the sphere at constant
// speed (the Taylor–Culick retraction), with a thickened wet lip and a ragged, fingering edge;
// the film is simply gone behind it. Droplets and mist are CPU particles drawn as points.

export interface BubbleDraw {
  /** centre and radius in canvas pixels */
  x: number
  y: number
  r: number
  seed: number
  /** 0..1 theme colour */
  tint: [number, number, number]
  alpha: number
  /** relative amplitude of the surface wobble */
  wob: number
  /** 0..1: how much the top of the film has drained to black */
  thin: number
  /** brightness of the wet lip while popping */
  glow: number
  /** unit vector (view space, y up) of where it was pierced, and the angular radius of the hole; w < 0 = intact */
  hole: [number, number, number, number]
}

export interface ParticleDraw {
  x: number
  y: number
  /** diameter in canvas pixels */
  size: number
  alpha: number
  /** 0 = mist, 1 = droplet */
  kind: number
}

const VS = `
attribute vec2 aQ;
uniform vec2 uC;
uniform float uR;
uniform vec2 uRes;
varying vec2 vUv;
void main() {
  float pad = 1.16;
  vec2 px = uC + aQ * uR * pad;
  vUv = vec2(aQ.x, -aQ.y) * pad;
  gl_Position = vec4(px.x / uRes.x * 2.0 - 1.0, 1.0 - px.y / uRes.y * 2.0, 0.0, 1.0);
}`

const FS = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 vUv;
uniform float uTime;
uniform float uSeed;
uniform float uAlpha;
uniform float uWob;
uniform float uThin;
uniform float uGlow;
uniform float uPx;
uniform vec3 uTint;
uniform vec3 uCmf[12];
uniform vec4 uHole;

const float PI = 3.14159265;
const float NF = 1.33;

float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float vnoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}
float fbm(vec3 p) {
  float a = 0.5;
  float s = 0.0;
  for (int i = 0; i < 3; i++) {
    s += a * vnoise(p);
    p = p * 2.03 + vec3(1.7, 9.2, 3.1);
    a *= 0.5;
  }
  return s / 0.875;
}

// film thickness in nm at a point on the unit sphere
float thickness(vec3 P) {
  float g = 0.5 - 0.5 * P.y;
  float s = uSeed * 17.0;
  float cr = cos(uTime * 0.05 + s);
  float sr = sin(uTime * 0.05 + s);
  float freq = mix(0.4, 0.62, clamp(uPx / 170.0, 0.0, 1.0));
  vec3 Q = vec3(cr * P.x + sr * P.z, P.y, -sr * P.x + cr * P.z) * 1.7 * freq;
  vec3 w = vec3(vnoise(Q * 1.3 + s), vnoise(Q * 1.3 + s + 5.2), vnoise(Q * 1.3 + s + 9.7)) - 0.5;
  float nz = fbm(Q * 1.4 + w * 2.2 + vec3(0.0, -uTime * 0.045, 0.0));
  float h = mix(130.0, 520.0, pow(g, 1.2)) + (nz - 0.5) * 460.0;
  float cap = smoothstep(-0.1, 0.7, g);
  h *= mix(1.0, 0.15 + 0.85 * cap, uThin);
  return clamp(h, 4.0, 1150.0);
}

// reflectance spectrum of a thin soap film -> linear RGB (Airy, symmetric film)
vec3 film(float h, float cosI) {
  float sinT2 = (1.0 - cosI * cosI) / (NF * NF);
  float cosT = sqrt(1.0 - sinT2);
  float F = 0.02 + 0.98 * pow(1.0 - cosI, 5.0);
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 12; i++) {
    float lam = 400.0 + float(i) * (300.0 / 11.0);
    float d = 4.0 * PI * NF * h * cosT / lam;
    float s = sin(d * 0.5);
    s *= s;
    float R = 4.0 * F * s / ((1.0 - F) * (1.0 - F) + 4.0 * F * s);
    acc += R * uCmf[i];
  }
  return acc;
}

// a little photo studio for the film to reflect
vec3 env(vec3 r) {
  float up = r.y * 0.5 + 0.5;
  vec3 col = vec3(0.06, 0.075, 0.11) * (0.5 + 0.9 * up) + vec3(0.02, 0.025, 0.035);
  float front = step(0.0, r.z);
  // key light: a window with a cross of mullions
  vec2 k = (r.xy - vec2(-0.5, 0.56)) / vec2(0.36, 0.25);
  float big = clamp((uPx - 50.0) / 80.0, 0.0, 1.0);
  float e0 = mix(0.2, 0.78, big);
  float kb = (1.0 - smoothstep(e0, 1.0, abs(k.x))) * (1.0 - smoothstep(e0, 1.0, abs(k.y)));
  float bars = mix(1.0, smoothstep(0.0, 0.07, abs(k.x)) * smoothstep(0.0, 0.09, abs(k.y)), clamp((uPx - 60.0) / 60.0, 0.0, 1.0));
  col += vec3(5.5, 5.5, 5.9) * kb * mix(0.12, 1.0, bars) * front;
  // cool fill, lower right
  vec2 f = (r.xy - vec2(0.64, -0.4)) / vec2(0.2, 0.38);
  float fb = (1.0 - smoothstep(0.6, 1.0, abs(f.x))) * (1.0 - smoothstep(0.6, 1.0, abs(f.y)));
  col += vec3(1.2, 1.9, 3.0) * fb * front;
  // warm kicker low left
  float kk = 1.0 - smoothstep(0.0, 0.34, length(r.xy - vec2(-0.55, -0.62)));
  col += vec3(2.4, 1.5, 0.8) * kk * kk * front;
  return col;
}

vec3 layer(vec3 P, float cosI, vec3 r, float k) {
  float mask = 1.0;
  float rim = 0.0;
  if (uHole.w >= 0.0) {
    float a = acos(clamp(dot(P, uHole.xyz), -1.0, 1.0));
    float j = (vnoise(P * 4.0 + uSeed * 13.0) - 0.5) * 0.55 * min(1.0, uHole.w * 2.5)
            + (vnoise(P * 11.0 + uSeed * 5.0) - 0.5) * 0.14;
    float e = a - (uHole.w + j);
    mask = smoothstep(0.0, 0.012, e);
    rim = (1.0 - smoothstep(0.0, 0.09, e)) * mask;
  }
  if (mask <= 0.0) return vec3(0.0);
  float h = thickness(P) * (1.0 + rim * 5.0);
  vec3 c = film(h, cosI) * env(r) * k;
  c += uTint * pow(1.0 - cosI, 3.0) * 0.03 * k;
  c += rim * vec3(1.0, 0.96, 0.88) * 0.55 * uGlow;
  return c * mask;
}

void main() {
  vec2 p = vUv;
  float ang = atan(p.y, p.x);
  float wob = uWob * (0.5 * sin(2.0 * ang + uTime * 1.1 + uSeed * 6.3)
                    + 0.3 * sin(3.0 * ang - uTime * 1.5 + uSeed * 9.1)
                    + 0.2 * sin(5.0 * ang + uTime * 2.3 + uSeed * 3.7));
  vec2 q = p / (1.0 + wob);
  float d = length(q);
  float aa = 1.6 / uPx;
  float edge = 1.0 - smoothstep(1.0 - aa, 1.0, d);
  if (edge <= 0.002) discard;
  float z = sqrt(max(1.0 - d * d, 0.0004));
  float cosI = z;
  vec3 Pf = vec3(q, z);
  vec3 Pb = vec3(q, -z);
  vec3 rf = vec3(2.0 * z * q, 2.0 * z * z - 1.0);
  vec3 rb = vec3(-2.0 * z * q, 2.0 * z * z - 1.0);

  vec3 col = layer(Pf, cosI, rf, 1.0) + layer(Pb, cosI, rb, 0.5);
  float lum = dot(col, vec3(0.3, 0.59, 0.11));
  col = max(mix(vec3(lum), col, mix(1.05, 1.35, clamp((uPx - 50.0) / 80.0, 0.0, 1.0))), 0.0);
  col = mix(col, col * (0.5 + 1.3 * uTint), 0.22);
  col = 1.0 - exp(-col * 1.25);
  col = pow(col, vec3(1.0 / 2.2));
  float s = uAlpha * edge;
  float a = clamp(max(col.r, max(col.g, col.b)), 0.0, 1.0) * s;
  gl_FragColor = vec4(col * s, a);
}`

const PVS = `
attribute vec4 aP;
attribute float aK;
uniform vec2 uRes;
varying float vA;
varying float vK;
void main() {
  gl_Position = vec4(aP.x / uRes.x * 2.0 - 1.0, 1.0 - aP.y / uRes.y * 2.0, 0.0, 1.0);
  gl_PointSize = max(aP.z, 1.0);
  vA = aP.w;
  vK = aK;
}`

const PFS = `
precision mediump float;
varying float vA;
varying float vK;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float d = length(c);
  if (d > 1.0) discard;
  float a;
  if (vK < 0.5) {
    a = (1.0 - d * d) * 0.85;
  } else {
    // a water drop: clear middle, bright refracting rim, one specular glint
    a = 0.12 * (1.0 - d) + 0.8 * smoothstep(0.5, 0.88, d) * (1.0 - smoothstep(0.92, 1.0, d));
    a += 0.9 * (1.0 - smoothstep(0.0, 0.3, length(c - vec2(-0.38, -0.4))));
  }
  float v = a * vA;
  gl_FragColor = vec4(vec3(0.88, 0.94, 1.0) * v, v);
}`

// CIE 1931 colour-matching functions (Wyman, Sloan & Shirley 2013, multi-lobe Gaussian fit),
// sampled at the 12 wavelengths the shader integrates over and normalised so a flat spectrum
// comes out neutral grey.
function g(l: number, mu: number, s1: number, s2: number) {
  const t = (l - mu) / (l < mu ? s1 : s2)
  return Math.exp(-0.5 * t * t)
}
function buildCmf(): Float32Array {
  const out: number[][] = []
  for (let i = 0; i < 12; i++) {
    const l = 400 + (i * 300) / 11
    const X = 1.056 * g(l, 599.8, 37.9, 31.0) + 0.362 * g(l, 442.0, 16.0, 26.7) - 0.065 * g(l, 501.1, 20.4, 26.2)
    const Y = 0.821 * g(l, 568.8, 46.9, 40.5) + 0.286 * g(l, 530.9, 16.3, 31.1)
    const Z = 1.217 * g(l, 437.0, 11.8, 36.0) + 0.681 * g(l, 459.0, 26.0, 13.8)
    out.push([3.2406 * X - 1.5372 * Y - 0.4986 * Z, -0.9689 * X + 1.8758 * Y + 0.0415 * Z, 0.0557 * X - 0.204 * Y + 1.057 * Z])
  }
  const w = [0, 0, 0]
  out.forEach((c) => c.forEach((v, k) => (w[k] += v)))
  const flat = new Float32Array(36)
  out.forEach((c, i) => c.forEach((v, k) => (flat[i * 3 + k] = v / w[k])))
  return flat
}

const MAX_PARTS = 400

export class BubbleGL {
  private gl: WebGLRenderingContext
  private canvas: HTMLCanvasElement
  private bubbleProg: WebGLProgram
  private partProg: WebGLProgram
  private quad: WebGLBuffer
  private partBuf: WebGLBuffer
  private partData = new Float32Array(MAX_PARTS * 5)
  private cmf = buildCmf()
  private bu: Record<string, WebGLUniformLocation | null> = {}
  private pu: Record<string, WebGLUniformLocation | null> = {}
  private w = 1
  private h = 1
  lost = false
  onLost?: () => void

  static create(canvas: HTMLCanvasElement): BubbleGL | null {
    try {
      const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, powerPreference: 'low-power' })
      if (!gl) return null
      return new BubbleGL(canvas, gl)
    } catch {
      return null
    }
  }

  private constructor(canvas: HTMLCanvasElement, gl: WebGLRenderingContext) {
    this.canvas = canvas
    this.gl = gl
    this.bubbleProg = this.program(VS, FS)
    this.partProg = this.program(PVS, PFS)
    this.quad = gl.createBuffer() as WebGLBuffer
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    this.partBuf = gl.createBuffer() as WebGLBuffer
    for (const n of ['uC', 'uR', 'uRes', 'uTime', 'uSeed', 'uAlpha', 'uWob', 'uThin', 'uGlow', 'uPx', 'uTint', 'uCmf', 'uHole']) this.bu[n] = gl.getUniformLocation(this.bubbleProg, n)
    this.pu.uRes = gl.getUniformLocation(this.partProg, 'uRes')
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault()
      this.lost = true
      this.onLost?.()
    })
  }

  private program(vs: string, fs: string): WebGLProgram {
    const gl = this.gl
    const mk = (type: number, src: string) => {
      const s = gl.createShader(type) as WebGLShader
      gl.shaderSource(s, src)
      gl.compileShader(s)
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader')
      return s
    }
    const p = gl.createProgram() as WebGLProgram
    gl.attachShader(p, mk(gl.VERTEX_SHADER, vs))
    gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs))
    gl.linkProgram(p)
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link')
    return p
  }

  resize(pxW: number, pxH: number) {
    const w = Math.max(1, Math.round(pxW))
    const h = Math.max(1, Math.round(pxH))
    if (w === this.w && h === this.h && this.canvas.width === w) return
    this.w = w
    this.h = h
    this.canvas.width = w
    this.canvas.height = h
  }

  draw(time: number, bubbles: BubbleDraw[], parts: ParticleDraw[]) {
    if (this.lost) return
    const gl = this.gl
    gl.viewport(0, 0, this.w, this.h)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.enable(gl.BLEND)

    if (bubbles.length) {
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
      gl.useProgram(this.bubbleProg)
      const aQ = gl.getAttribLocation(this.bubbleProg, 'aQ')
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quad)
      gl.enableVertexAttribArray(aQ)
      gl.vertexAttribPointer(aQ, 2, gl.FLOAT, false, 0, 0)
      gl.uniform2f(this.bu.uRes, this.w, this.h)
      gl.uniform1f(this.bu.uTime, time)
      gl.uniform3fv(this.bu.uCmf, this.cmf)
      for (const b of bubbles) {
        gl.uniform2f(this.bu.uC, b.x, b.y)
        gl.uniform1f(this.bu.uR, b.r)
        gl.uniform1f(this.bu.uPx, b.r)
        gl.uniform1f(this.bu.uSeed, b.seed)
        gl.uniform1f(this.bu.uAlpha, b.alpha)
        gl.uniform1f(this.bu.uWob, b.wob)
        gl.uniform1f(this.bu.uThin, b.thin)
        gl.uniform1f(this.bu.uGlow, b.glow)
        gl.uniform3f(this.bu.uTint, b.tint[0], b.tint[1], b.tint[2])
        gl.uniform4f(this.bu.uHole, b.hole[0], b.hole[1], b.hole[2], b.hole[3])
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
      }
    }

    const n = Math.min(parts.length, MAX_PARTS)
    if (n) {
      gl.blendFunc(gl.ONE, gl.ONE)
      gl.useProgram(this.partProg)
      for (let i = 0; i < n; i++) {
        const p = parts[i]
        const o = i * 5
        this.partData[o] = p.x
        this.partData[o + 1] = p.y
        this.partData[o + 2] = p.size
        this.partData[o + 3] = p.alpha
        this.partData[o + 4] = p.kind
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, this.partBuf)
      gl.bufferData(gl.ARRAY_BUFFER, this.partData.subarray(0, n * 5), gl.DYNAMIC_DRAW)
      const aP = gl.getAttribLocation(this.partProg, 'aP')
      const aK = gl.getAttribLocation(this.partProg, 'aK')
      gl.enableVertexAttribArray(aP)
      gl.vertexAttribPointer(aP, 4, gl.FLOAT, false, 20, 0)
      gl.enableVertexAttribArray(aK)
      gl.vertexAttribPointer(aK, 1, gl.FLOAT, false, 20, 16)
      gl.uniform2f(this.pu.uRes, this.w, this.h)
      gl.drawArrays(gl.POINTS, 0, n)
    }
  }
}
