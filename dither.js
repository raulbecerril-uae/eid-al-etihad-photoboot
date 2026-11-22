/*!
 * Dither — vanilla JavaScript port of the React Bits "Dither" component (WebGL2).
 *
 * Usage:
 *   var d = new Dither(document.getElementById('box'), {
 *     waveColor: '#bcbcbc', backgroundColor: '#120f17',   // or 'transparent'
 *     ditherMode: 'bayer', colorNum: 4, pixelSize: 2,
 *     mouseEffect: 'erase', mouseRadius: .3, trail: .5, clickRipple: true, intro: true
 *   });
 *   d.update({ waveSpeed: .1 });   // change any option live
 *   d.setActive(false);            // pause rendering (e.g. screen hidden)
 *   d.destroy();                   // remove listeners + free GPU resources
 *
 * The container must have a size (the canvas fills it).
 */
(function (global) {
  'use strict';

  var MODES = { bayer: 0, bayer4: 1, bayer2: 2, halftone: 3, lines: 4, crosshatch: 5, noise: 6, none: 7 };
  var EFFECTS = { erase: 0, reveal: 1, ripple: 2 };
  var MAX_TRAIL = 16;
  var MAX_RIPPLES = 4;
  var MAX_PALETTE = 8;
  var INTRO_SECONDS = 1.8;
  var RIPPLE_SECONDS = 1.6;

  var DEFAULTS = {
    waveSpeed: 0.05,
    waveFrequency: 3,
    waveAmplitude: 0.3,
    waveColor: [0.5, 0.5, 0.5],
    backgroundColor: [0, 0, 0],
    colorNum: 4,
    pixelSize: 2,
    disableAnimation: false,
    enableMouseInteraction: true,
    mouseRadius: 1,
    ditherMode: 'bayer',
    palette: undefined,
    scale: 1,
    contrast: 1,
    brightness: 0,
    mouseEffect: 'erase',
    mouseStrength: 1,
    trail: 0.5,
    clickRipple: true,
    intro: true,
    dpr: undefined,
    className: '',
    active: true
  };

  var VERTEX = `#version 300 es
in vec2 aPosition;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`;

  var WAVE_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
uniform vec2 uResolution;
uniform float uCell;
uniform float uTime;
uniform float uWaveSpeed;
uniform float uWaveFrequency;
uniform float uWaveAmplitude;
uniform float uScale;
uniform float uContrast;
uniform float uBrightness;
uniform int uEffect;
uniform float uRadius;
uniform float uStrength;
uniform vec3 uTrail[${MAX_TRAIL}];
uniform int uTrailCount;
uniform vec4 uRipples[${MAX_RIPPLES}];
uniform int uRippleCount;
uniform float uIntro;
uniform float uReach;
out vec4 outColor;

vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
vec2 fade(vec2 t) { return t * t * t * (t * (t * 6.0 - 15.0) + 10.0); }

float cnoise(vec2 P) {
  vec4 Pi = floor(P.xyxy) + vec4(0.0, 0.0, 1.0, 1.0);
  vec4 Pf = fract(P.xyxy) - vec4(0.0, 0.0, 1.0, 1.0);
  Pi = mod289(Pi);
  vec4 ix = Pi.xzxz;
  vec4 iy = Pi.yyww;
  vec4 fx = Pf.xzxz;
  vec4 fy = Pf.yyww;
  vec4 i = permute(permute(ix) + iy);
  vec4 gx = fract(i * (1.0 / 41.0)) * 2.0 - 1.0;
  vec4 gy = abs(gx) - 0.5;
  vec4 tx = floor(gx + 0.5);
  gx = gx - tx;
  vec2 g00 = vec2(gx.x, gy.x);
  vec2 g10 = vec2(gx.y, gy.y);
  vec2 g01 = vec2(gx.z, gy.z);
  vec2 g11 = vec2(gx.w, gy.w);
  vec4 norm = taylorInvSqrt(vec4(dot(g00, g00), dot(g01, g01), dot(g10, g10), dot(g11, g11)));
  g00 *= norm.x;
  g01 *= norm.y;
  g10 *= norm.z;
  g11 *= norm.w;
  float n00 = dot(g00, vec2(fx.x, fy.x));
  float n10 = dot(g10, vec2(fx.y, fy.y));
  float n01 = dot(g01, vec2(fx.z, fy.z));
  float n11 = dot(g11, vec2(fx.w, fy.w));
  vec2 fadeXY = fade(Pf.xy);
  vec2 nx = mix(vec2(n00, n01), vec2(n10, n11), fadeXY.x);
  return 2.3 * mix(nx.x, nx.y, fadeXY.y);
}

float fbm(vec2 p) {
  float value = 0.0;
  float amp = 1.0;
  for (int i = 0; i < 4; i++) {
    value += amp * abs(cnoise(p));
    p *= uWaveFrequency;
    amp *= uWaveAmplitude;
  }
  return value;
}

float pattern(vec2 p) {
  vec2 p2 = p - uTime * uWaveSpeed;
  return fbm(p + fbm(p2));
}

void main() {
  vec2 corner = (gl_FragCoord.xy - 0.5) * uCell;
  vec2 uv = corner / uResolution - 0.5;
  uv.x *= uResolution.x / uResolution.y;

  float touch = 0.0;
  for (int i = 0; i < ${MAX_TRAIL}; i++) {
    if (i >= uTrailCount) break;
    vec3 point = uTrail[i];
    float reach = uRadius * mix(0.55, 1.0, point.z);
    touch = max(touch, point.z * (1.0 - smoothstep(0.0, reach, length(uv - point.xy))));
  }

  vec2 warp = vec2(0.0);
  float ring = 0.0;
  for (int i = 0; i < ${MAX_RIPPLES}; i++) {
    if (i >= uRippleCount) break;
    vec4 ripple = uRipples[i];
    vec2 delta = uv - ripple.xy;
    float dist = length(delta);
    float life = clamp(ripple.z / ${RIPPLE_SECONDS.toFixed(2)}, 0.0, 1.0);
    float wave = exp(-pow((dist - ripple.z * 0.9) / 0.07, 2.0)) * (1.0 - life) * (1.0 - life) * ripple.w;
    warp += (dist > 0.0001 ? delta / dist : vec2(0.0)) * wave * 0.035;
    ring += wave;
  }

  if (uEffect == 2 && touch > 0.0) {
    vec3 head = uTrail[0];
    vec2 delta = uv - head.xy;
    float dist = length(delta);
    warp += (dist > 0.0001 ? delta / dist : vec2(0.0)) * sin(dist / max(uRadius, 0.001) * 16.0 - uTime * 7.0) * 0.04 * touch * uStrength;
  }

  float f = pattern((uv + warp) / uScale);
  if (uEffect == 0) f -= 0.5 * touch * uStrength;
  if (uEffect == 1) f += 0.5 * touch * uStrength;
  f += ring * 0.55;
  f = (f - 0.5) * uContrast + 0.5 + uBrightness;
  float show = clamp((uIntro * uReach - length(uv)) / 0.45, 0.0, 1.0);
  float v = clamp(f, 0.0, 1.0) * show * show * (3.0 - 2.0 * show);
  outColor = vec4(floor(v * 255.0) / 255.0, fract(v * 255.0), 0.0, 1.0);
}`;

  var DITHER_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uField;
uniform ivec2 uFieldSize;
uniform float uCellDevice;
uniform int uMode;
uniform float uColorNum;
uniform vec3 uWave;
uniform vec3 uBackground;
uniform vec3 uPalette[${MAX_PALETTE}];
uniform int uPaletteCount;
uniform float uTransparent;
out vec4 outColor;

const float bayer8[64] = float[64](
  0.0 / 64.0, 48.0 / 64.0, 12.0 / 64.0, 60.0 / 64.0, 3.0 / 64.0, 51.0 / 64.0, 15.0 / 64.0, 63.0 / 64.0,
  32.0 / 64.0, 16.0 / 64.0, 44.0 / 64.0, 28.0 / 64.0, 35.0 / 64.0, 19.0 / 64.0, 47.0 / 64.0, 31.0 / 64.0,
  8.0 / 64.0, 56.0 / 64.0, 4.0 / 64.0, 52.0 / 64.0, 11.0 / 64.0, 59.0 / 64.0, 7.0 / 64.0, 55.0 / 64.0,
  40.0 / 64.0, 24.0 / 64.0, 36.0 / 64.0, 20.0 / 64.0, 43.0 / 64.0, 27.0 / 64.0, 39.0 / 64.0, 23.0 / 64.0,
  2.0 / 64.0, 50.0 / 64.0, 14.0 / 64.0, 62.0 / 64.0, 1.0 / 64.0, 49.0 / 64.0, 13.0 / 64.0, 61.0 / 64.0,
  34.0 / 64.0, 18.0 / 64.0, 46.0 / 64.0, 30.0 / 64.0, 33.0 / 64.0, 17.0 / 64.0, 45.0 / 64.0, 29.0 / 64.0,
  10.0 / 64.0, 58.0 / 64.0, 6.0 / 64.0, 54.0 / 64.0, 9.0 / 64.0, 57.0 / 64.0, 5.0 / 64.0, 53.0 / 64.0,
  42.0 / 64.0, 26.0 / 64.0, 38.0 / 64.0, 22.0 / 64.0, 41.0 / 64.0, 25.0 / 64.0, 37.0 / 64.0, 21.0 / 64.0
);

const float bayer4[16] = float[16](
  0.0 / 16.0, 8.0 / 16.0, 2.0 / 16.0, 10.0 / 16.0,
  12.0 / 16.0, 4.0 / 16.0, 14.0 / 16.0, 6.0 / 16.0,
  3.0 / 16.0, 11.0 / 16.0, 1.0 / 16.0, 9.0 / 16.0,
  15.0 / 16.0, 7.0 / 16.0, 13.0 / 16.0, 5.0 / 16.0
);

const float bayer2[4] = float[4](0.0 / 4.0, 2.0 / 4.0, 3.0 / 4.0, 1.0 / 4.0);

float threshold(vec2 cell) {
  if (uMode == 1) {
    ivec2 c = ivec2(mod(cell, 4.0));
    return bayer4[c.y * 4 + c.x];
  }
  if (uMode == 2) {
    ivec2 c = ivec2(mod(cell, 2.0));
    return bayer2[c.y * 2 + c.x];
  }
  if (uMode == 3) {
    vec2 r = vec2(cell.x + cell.y, cell.x - cell.y) * 0.70710678 / 4.0;
    return clamp(length(fract(r) - 0.5) * 1.41421356, 0.0, 0.999);
  }
  if (uMode == 4) {
    return abs(fract(cell.y / 4.0) - 0.5) * 2.0 * 0.999;
  }
  if (uMode == 5) {
    float a = abs(fract((cell.x + cell.y) / 6.0) - 0.5) * 2.0;
    float b = abs(fract((cell.x - cell.y) / 6.0) - 0.5) * 2.0;
    return min(a, b) * 0.999;
  }
  if (uMode == 6) {
    return fract(52.9829189 * fract(dot(cell, vec2(0.06711056, 0.00583715))));
  }
  if (uMode == 7) {
    return 0.25;
  }
  ivec2 c = ivec2(mod(cell, 8.0));
  return bayer8[c.y * 8 + c.x];
}

vec3 toSrgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

void main() {
  vec2 cell = floor(gl_FragCoord.xy / uCellDevice);
  vec4 sampleValue = texelFetch(uField, clamp(ivec2(cell), ivec2(0), uFieldSize - 1), 0);
  float f = sampleValue.r + sampleValue.g / 255.0;
  float t = threshold(cell) - 0.25;

  if (uPaletteCount > 1) {
    float n = float(uPaletteCount);
    float v = f + t / (n - 1.0);
    v = clamp(v - mix(0.2, 0.0, smoothstep(0.45, 0.8, v)), 0.0, 1.0);
    int index = int(floor(v * (n - 1.0) + 0.5));
    outColor = vec4(toSrgb(uPalette[index]), 1.0);
    return;
  }

  float levels = max(uColorNum, 1.01) - 1.0;
  if (uTransparent > 0.5) {
    float v = f + t / levels;
    v = clamp(v - mix(0.2, 0.0, smoothstep(0.45, 0.8, v)), 0.0, 1.0);
    float a = floor(v * levels + 0.5) / levels;
    outColor = vec4(toSrgb(uWave) * a, a);
    return;
  }

  float base = dot(uBackground, vec3(0.2126, 0.7152, 0.0722));
  vec3 offset = (uWave - vec3(base)) * f + t / levels;
  float luminance = dot(uBackground + offset, vec3(0.2126, 0.7152, 0.0722));
  offset -= mix(0.2, 0.0, smoothstep(0.45, 0.8, luminance));
  bool rising = dot(uWave, vec3(0.2126, 0.7152, 0.0722)) >= base;
  float lower = rising ? 0.0 : -max(uBackground.r, max(uBackground.g, uBackground.b));
  float upper = rising ? 1.0 - min(uBackground.r, min(uBackground.g, uBackground.b)) : 0.0;
  offset = floor(clamp(offset, lower, upper) * levels + 0.5) / levels;
  outColor = vec4(toSrgb(uBackground + offset), 1.0);
}`;

  var clamp = function (value, min, max) { return Math.min(max, Math.max(min, value)); };

  function compile(gl, type, source) {
    var shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
    gl.deleteShader(shader);
    return null;
  }

  function link(gl, fragmentSource) {
    var vertex = compile(gl, gl.VERTEX_SHADER, VERTEX);
    var fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
    var program = gl.createProgram();
    if (!vertex || !fragment || !program) return null;
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.bindAttribLocation(program, 0, 'aPosition');
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      gl.deleteProgram(program);
      return null;
    }
    var uniforms = {};
    var count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
    for (var i = 0; i < count; i++) {
      var info = gl.getActiveUniform(program, i);
      if (info) uniforms[info.name.replace('[0]', '')] = gl.getUniformLocation(program, info.name);
    }
    return { program: program, uniforms: uniforms };
  }

  var toLinear = function (value) {
    return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
  };

  function normalize(o) {
    return {
      waveSpeed: o.waveSpeed,
      waveFrequency: o.waveFrequency,
      waveAmplitude: o.waveAmplitude,
      waveColor: o.waveColor,
      backgroundColor: o.backgroundColor,
      colorNum: Math.max(2, o.colorNum),
      pixelSize: Math.max(1, o.pixelSize),
      disableAnimation: o.disableAnimation,
      enableMouseInteraction: o.enableMouseInteraction,
      mouseRadius: Math.max(0.001, o.mouseRadius),
      mode: MODES[o.ditherMode] !== undefined ? MODES[o.ditherMode] : 0,
      palette: Array.isArray(o.palette) ? o.palette.filter(Boolean).slice(0, MAX_PALETTE) : [],
      scale: Math.max(0.05, o.scale),
      contrast: o.contrast,
      brightness: o.brightness,
      effect: EFFECTS[o.mouseEffect] !== undefined ? EFFECTS[o.mouseEffect] : 0,
      mouseStrength: Math.max(0, o.mouseStrength),
      trail: clamp(o.trail, 0, 1),
      clickRipple: o.clickRipple,
      intro: o.intro,
      dpr: o.dpr
    };
  }

  function injectCSS() {
    if (document.getElementById('dither-css')) return;
    var st = document.createElement('style');
    st.id = 'dither-css';
    st.textContent =
      '.dither-container{position:relative;width:100%;height:100%;overflow:hidden}' +
      '.dither-canvas{position:absolute;inset:0;display:block;width:100%;height:100%}';
    document.head.appendChild(st);
  }

  var NOOP = { update: function () {}, setActive: function () {}, destroy: function () {}, supported: false };

  function Dither(container, options) {
    if (!(this instanceof Dither)) return new Dither(container, options);
    injectCSS();

    var opts = Object.assign({}, DEFAULTS, options || {});
    var settings = normalize(opts);
    var active = opts.active !== false;

    container.classList.add('dither-container');
    if (opts.className) opts.className.split(/\s+/).forEach(function (c) { if (c) container.classList.add(c); });

    var canvas = document.createElement('canvas');
    canvas.className = 'dither-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    container.appendChild(canvas);

    var gl = canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false
    });
    var wave = gl && link(gl, WAVE_FRAGMENT);
    var dither = gl && link(gl, DITHER_FRAGMENT);
    if (!gl || !wave || !dither) {
      canvas.remove();
      Object.assign(this, NOOP);
      return;
    }
    this.supported = true;

    var buffer = gl.createBuffer();
    var vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    var field = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, field);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    var framebuffer = gl.createFramebuffer();

    var probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    var reduce = (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) || false;
    var cache = new Map();

    function toColor(value) {
      if (Array.isArray(value)) return [0, 1, 2].map(function (i) { return clamp(Number(value[i]) || 0, 0, 1); });
      var key = String(value);
      if (cache.has(key)) return cache.get(key);
      var rgb = [0, 0, 0];
      if (probe) {
        probe.clearRect(0, 0, 1, 1);
        probe.fillStyle = '#000000';
        probe.fillStyle = key;
        probe.fillRect(0, 0, 1, 1);
        var d = probe.getImageData(0, 0, 1, 1).data;
        rgb = [d[0], d[1], d[2]].map(function (ch) { return toLinear(ch / 255); });
      }
      cache.set(key, rgb);
      return rgb;
    }

    var view = { width: 1, height: 1, ratio: 1, cell: 1, cellCss: 1, cols: 1, rows: 1 };
    var pointer = { x: 0, y: 0, inside: false, set: false };
    var trailPoints = [];
    var ripples = [];
    var trailData = new Float32Array(MAX_TRAIL * 3);
    var rippleData = new Float32Array(MAX_RIPPLES * 4);
    var paletteData = new Float32Array(MAX_PALETTE * 3);
    var state = {
      time: 0,
      hx: 0,
      hy: 0,
      presence: 0,
      reveal: settings.intro && !reduce ? 0 : 1
    };
    var raf = 0;
    var last = 0;
    var visible = true;
    var lastDpr = settings.dpr;

    function allocate() {
      view.cell = Math.max(1, Math.round(settings.pixelSize * view.ratio));
      view.cellCss = view.cell / view.ratio;
      view.cols = Math.max(1, Math.ceil(canvas.width / view.cell));
      view.rows = Math.max(1, Math.ceil(canvas.height / view.cell));
      gl.bindTexture(gl.TEXTURE_2D, field);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, view.cols, view.rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, field, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    function toUv(x, y) {
      var aspect = view.width / view.height;
      return [(x / view.width - 0.5) * aspect, -(y / view.height - 0.5)];
    }

    function render() {
      var s = settings;
      var expected = Math.max(1, Math.round(s.pixelSize * view.ratio));
      if (expected !== view.cell) allocate();

      var trailCount = 0;
      for (var i = 0; i < trailPoints.length && trailCount < MAX_TRAIL; i++) {
        var point = trailPoints[i];
        if (point.weight <= 0.01) continue;
        trailData.set([point.x, point.y, point.weight], trailCount * 3);
        trailCount++;
      }
      var rippleCount = 0;
      for (var j = ripples.length - 1; j >= 0 && rippleCount < MAX_RIPPLES; j--) {
        rippleData.set([ripples[j].x, ripples[j].y, ripples[j].age, 1], rippleCount * 4);
        rippleCount++;
      }

      var eased = s.intro && !reduce ? state.reveal * state.reveal * (3 - 2 * state.reveal) : 1;

      gl.bindVertexArray(vao);
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.viewport(0, 0, view.cols, view.rows);
      gl.useProgram(wave.program);
      var w = wave.uniforms;
      gl.uniform2f(w.uResolution, canvas.width / view.ratio, canvas.height / view.ratio);
      gl.uniform1f(w.uCell, view.cellCss);
      gl.uniform1f(w.uTime, state.time);
      gl.uniform1f(w.uWaveSpeed, s.waveSpeed);
      gl.uniform1f(w.uWaveFrequency, s.waveFrequency);
      gl.uniform1f(w.uWaveAmplitude, s.waveAmplitude);
      gl.uniform1f(w.uScale, s.scale);
      gl.uniform1f(w.uContrast, s.contrast);
      gl.uniform1f(w.uBrightness, s.brightness);
      gl.uniform1i(w.uEffect, s.effect);
      gl.uniform1f(w.uRadius, s.mouseRadius);
      gl.uniform1f(w.uStrength, s.mouseStrength);
      gl.uniform3fv(w.uTrail, trailData);
      gl.uniform1i(w.uTrailCount, trailCount);
      gl.uniform4fv(w.uRipples, rippleData);
      gl.uniform1i(w.uRippleCount, rippleCount);
      gl.uniform1f(w.uIntro, eased);
      gl.uniform1f(w.uReach, 0.5 * Math.hypot(view.width / view.height, 1) + 0.45);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(dither.program);
      var d = dither.uniforms;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, field);
      gl.uniform1i(d.uField, 0);
      gl.uniform2i(d.uFieldSize, view.cols, view.rows);
      gl.uniform1f(d.uCellDevice, view.cell);
      gl.uniform1i(d.uMode, s.mode);
      gl.uniform1f(d.uColorNum, s.colorNum);
      gl.uniform3fv(d.uWave, toColor(s.waveColor));
      var transparent = s.backgroundColor === 'transparent';
      gl.uniform3fv(d.uBackground, transparent ? [0, 0, 0] : toColor(s.backgroundColor));
      gl.uniform1f(d.uTransparent, transparent ? 1 : 0);
      s.palette.forEach(function (value, index) { paletteData.set(toColor(value), index * 3); });
      gl.uniform3fv(d.uPalette, paletteData);
      gl.uniform1i(d.uPaletteCount, s.palette.length);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    function frame(now) {
      raf = 0;
      if (!active || !visible || document.hidden) return;
      var s = settings;
      var dt = last ? clamp((now - last) / 1000, 0.0005, 0.05) : 1 / 60;
      last = now;
      if (!s.disableAnimation && !reduce) state.time += dt;

      var engaged = s.enableMouseInteraction && pointer.inside && !reduce;
      state.presence += ((engaged ? 1 : 0) - state.presence) * (1 - Math.exp(-dt / (engaged ? 0.12 : 0.35)));
      if (pointer.set) {
        var t = toUv(pointer.x, pointer.y);
        var follow = 1 - Math.exp(-dt / 0.06);
        var moved = Math.hypot(t[0] - state.hx, t[1] - state.hy);
        state.hx += (t[0] - state.hx) * follow;
        state.hy += (t[1] - state.hy) * follow;
        var decay = Math.exp(-dt / (0.08 + s.trail * 0.7));
        trailPoints.forEach(function (p) { p.weight *= decay; });
        var head = trailPoints[0];
        if (!head || Math.hypot(head.x - state.hx, head.y - state.hy) > 0.012 || moved > 0.012) {
          trailPoints.unshift({ x: state.hx, y: state.hy, weight: state.presence });
        } else {
          head.x = state.hx;
          head.y = state.hy;
          head.weight = state.presence;
        }
        if (s.trail <= 0.001) trailPoints.length = Math.min(trailPoints.length, 1);
        while (
          trailPoints.length > MAX_TRAIL ||
          (trailPoints.length > 1 && trailPoints[trailPoints.length - 1].weight < 0.01)
        ) {
          trailPoints.pop();
        }
      }

      for (var i = ripples.length - 1; i >= 0; i--) {
        ripples[i].age += dt;
        if (ripples[i].age >= RIPPLE_SECONDS) ripples.splice(i, 1);
      }

      if (!s.intro || reduce) state.reveal = 1;
      else if (state.reveal < 1) state.reveal = Math.min(1, state.reveal + dt / INTRO_SECONDS);

      render();
      var busy =
        !s.disableAnimation ||
        state.reveal < 1 ||
        ripples.length > 0 ||
        state.presence > 0.002 ||
        trailPoints.some(function (p) { return p.weight > 0.01; });
      if (busy && !reduce) raf = requestAnimationFrame(frame);
      else last = 0;
    }

    function wake() {
      if (!raf && active && visible && !document.hidden) raf = requestAnimationFrame(frame);
    }

    function resize() {
      var width = Math.max(1, container.clientWidth);
      var height = Math.max(1, container.clientHeight);
      var ratio = Math.min(settings.dpr || window.devicePixelRatio || 1, 2);
      view.width = width;
      view.height = height;
      canvas.width = Math.max(1, Math.round(width * ratio));
      canvas.height = Math.max(1, Math.round(height * ratio));
      view.ratio = canvas.width / width;
      allocate();
      render();
      wake();
    }

    function locate(event) {
      var rect = container.getBoundingClientRect();
      pointer.x = event.clientX - rect.left;
      pointer.y = event.clientY - rect.top;
      pointer.inside = pointer.x >= 0 && pointer.y >= 0 && pointer.x <= rect.width && pointer.y <= rect.height;
      if (pointer.inside && !pointer.set) {
        var p = toUv(pointer.x, pointer.y);
        state.hx = p[0];
        state.hy = p[1];
        pointer.set = true;
      }
    }

    function onPointerMove(event) {
      if (!active) return;
      locate(event);
      wake();
    }

    function onPointerDown(event) {
      if (!active) return;
      locate(event);
      if (!pointer.inside || !settings.clickRipple || reduce) return;
      var p = toUv(pointer.x, pointer.y);
      ripples.push({ x: p[0], y: p[1], age: 0 });
      if (ripples.length > MAX_RIPPLES) ripples.shift();
      wake();
    }

    function onPointerUp(event) {
      if (event.pointerType !== 'mouse') pointer.inside = false;
    }

    function onPointerLeave() {
      pointer.inside = false;
    }

    function onVisibility() {
      last = 0;
      wake();
    }

    var resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);
    var intersection = new IntersectionObserver(function (entries) {
      visible = entries.some(function (e) { return e.isIntersecting; });
      if (visible) {
        last = 0;
        wake();
      }
    });
    intersection.observe(container);
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerdown', onPointerDown, { passive: true });
    window.addEventListener('pointerup', onPointerUp, { passive: true });
    window.addEventListener('pointercancel', onPointerUp, { passive: true });
    document.documentElement.addEventListener('pointerleave', onPointerLeave);
    document.addEventListener('visibilitychange', onVisibility);
    resize();

    // public API ------------------------------------------------------------
    this.update = function (partial) {
      Object.assign(opts, partial || {});
      settings = normalize(opts);
      if (settings.dpr !== lastDpr) {
        lastDpr = settings.dpr;
        resize();
        return;
      }
      if (!raf) render();
      wake();
    };

    this.setActive = function (value) {
      active = !!value;
      if (!active) {
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        last = 0;
        pointer.inside = false;
      } else {
        last = 0;
        resize();
      }
    };

    this.destroy = function () {
      cancelAnimationFrame(raf);
      raf = 0;
      resizeObserver.disconnect();
      intersection.disconnect();
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      document.documentElement.removeEventListener('pointerleave', onPointerLeave);
      document.removeEventListener('visibilitychange', onVisibility);
      gl.deleteProgram(wave.program);
      gl.deleteProgram(dither.program);
      gl.deleteBuffer(buffer);
      gl.deleteVertexArray(vao);
      gl.deleteTexture(field);
      gl.deleteFramebuffer(framebuffer);
      var ext = gl.getExtension('WEBGL_lose_context');
      if (ext) ext.loseContext();
      canvas.remove();
    };
  }

  global.Dither = Dither;
})(window);
