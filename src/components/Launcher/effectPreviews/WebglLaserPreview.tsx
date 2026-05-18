import { useEffect, useMemo, useRef, useState } from 'react';
import type { EffectPreviewProps } from './types';

function parseHexColor(value: string | undefined, fallback: [number, number, number]): [number, number, number] {
  const raw = String(value ?? '').trim();
  const match = raw.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!match) return fallback;
  const hex = match[1].length === 3
    ? match[1].split('').map(char => char + char).join('')
    : match[1];
  const numeric = Number.parseInt(hex, 16);
  return [((numeric >> 16) & 255) / 255, ((numeric >> 8) & 255) / 255, (numeric & 255) / 255];
}

function softenLightBackground(color: [number, number, number]): [number, number, number] {
  return [
    color[0] * 0.92 + 0.08,
    color[1] * 0.92 + 0.08,
    color[2] * 0.92 + 0.08,
  ];
}

function compileShader(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.warn(gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function createProgram(gl: WebGLRenderingContext, vertexSource: string, fragmentSource: string) {
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  if (!vertexShader || !fragmentShader) return null;

  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn(gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  }
  return program;
}

const VERTEX_SHADER = `
  attribute vec2 aPosition;
  void main() {
    gl_Position = vec4(aPosition, 0.0, 1.0);
  }
`;

const FRAGMENT_SHADER = `
  precision highp float;

  uniform vec2 iResolution;
  uniform float iTime;
  uniform float uIsLight;
  uniform vec3 uBgColor;
  uniform vec3 uAccentColor;

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
  }

  float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;
    for (int i = 0; i < 5; i++) {
      value += amplitude * noise(p);
      p = p * 2.03 + 13.7;
      amplitude *= 0.5;
    }
    return value;
  }

  void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;
    float t = iTime;

    vec3 bg = uBgColor;
    vec2 smokeUv = uv * vec2(2.0, 1.15) + vec2(sin(t * 0.24) * 0.08, t * 0.06);
    float smokeA = fbm(smokeUv * 2.2);
    float smokeB = fbm(smokeUv * 4.0 + vec2(19.4, -7.2));
    float smoke = smoothstep(0.38, 0.86, smokeA * 0.65 + smokeB * 0.45);

    float beamDistance = abs(uv.x + sin(uv.y * 2.2 + t * 0.18) * 0.008);
    float core = exp(-beamDistance * 860.0);
    float hot = exp(-beamDistance * 260.0);
    float halo = exp(-beamDistance * 32.0) * mix(0.50, 0.34, uIsLight);
    float wideHalo = exp(-beamDistance * 10.0) * mix(0.24, 0.14, uIsLight);
    float verticalFocus = smoothstep(0.86, 0.08, abs(uv.y));
    float pulse = 0.82 + sin(t * 1.2) * 0.18;

    float smokyBeam = smoke * (halo + wideHalo) * verticalFocus;
    vec3 accent = max(uAccentColor, vec3(0.06));
    vec3 coreColor = mix(vec3(1.0), vec3(0.08, 0.10, 0.14), uIsLight);
    vec3 laser = coreColor * core * mix(1.55, 0.82, uIsLight);
    laser += mix(accent * 0.75, coreColor, 0.22) * hot * pulse;
    laser += accent * smokyBeam * 1.55;
    laser += accent * wideHalo * verticalFocus * 0.45;

    float dither = step(0.5, sin((gl_FragCoord.x + gl_FragCoord.y) * 1.15) * 0.5 + 0.5);
    laser *= mix(0.94, 1.08, dither * smoke);

    float vignette = smoothstep(1.02, 0.18, length(uv));
    vec3 color = mix(bg, bg + laser, vignette);
    color += accent * smoke * mix(0.055, 0.025, uIsLight) * vignette;
    gl_FragColor = vec4(color, 0.94);
  }
`;

export function WebglLaserPreview({ theme, mode, quality, reducedMotion }: EffectPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [failed, setFailed] = useState(false);
  const accent = useMemo(() => parseHexColor(theme.accent, [0.13, 0.77, 0.37]), [theme.accent]);
  const background = useMemo(() => {
    const parsed = parseHexColor(theme.background, theme.isLight ? [0.96, 0.97, 0.98] : [0.012, 0.012, 0.016]);
    return theme.isLight ? softenLightBackground(parsed) : parsed;
  }, [theme.background, theme.isLight]);
  const live = mode === 'live' && !reducedMotion;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext('webgl', {
      alpha: true,
      antialias: false,
      powerPreference: 'low-power',
      premultipliedAlpha: false,
    });
    if (!gl) {
      setFailed(true);
      return;
    }

    const program = createProgram(gl, VERTEX_SHADER, FRAGMENT_SHADER);
    if (!program) {
      setFailed(true);
      return;
    }

    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);

    const positionLocation = gl.getAttribLocation(program, 'aPosition');
    const resolutionLocation = gl.getUniformLocation(program, 'iResolution');
    const timeLocation = gl.getUniformLocation(program, 'iTime');
    const isLightLocation = gl.getUniformLocation(program, 'uIsLight');
    const bgLocation = gl.getUniformLocation(program, 'uBgColor');
    const accentLocation = gl.getUniformLocation(program, 'uAccentColor');
    let frame = 0;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, quality === 'thumbnail' ? 1 : 1.5);
      const width = Math.max(1, Math.floor(rect.width * dpr));
      const height = Math.max(1, Math.floor(rect.height * dpr));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      gl.viewport(0, 0, width, height);
    };

    const draw = (now: number) => {
      resize();
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
      gl.enableVertexAttribArray(positionLocation);
      gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
      gl.uniform2f(resolutionLocation, canvas.width, canvas.height);
      gl.uniform1f(timeLocation, live ? now * 0.001 : 3.8);
      gl.uniform1f(isLightLocation, theme.isLight ? 1 : 0);
      gl.uniform3fv(bgLocation, background);
      gl.uniform3fv(accentLocation, accent);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    };

    const tick = (now: number) => {
      draw(now);
      frame = requestAnimationFrame(tick);
    };

    const resizeObserver = new ResizeObserver(() => {
      if (!live) draw(performance.now());
    });
    resizeObserver.observe(canvas);
    if (live) frame = requestAnimationFrame(tick);
    else draw(performance.now());

    const handleContextLost = (event: Event) => {
      event.preventDefault();
      setFailed(true);
    };
    canvas.addEventListener('webglcontextlost', handleContextLost);

    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      canvas.removeEventListener('webglcontextlost', handleContextLost);
      gl.deleteBuffer(positionBuffer);
      gl.deleteProgram(program);
    };
  }, [accent, background, live, quality, theme.isLight]);

  if (failed) {
    const accentColor = theme.accent;
    return (
      <div
        className="absolute inset-0 opacity-80"
        style={{
          background: theme.isLight
            ? `radial-gradient(circle at 50% 48%, ${accentColor}33, transparent 24%), linear-gradient(90deg, transparent 49.5%, #111827bb 50%, transparent 50.5%), ${theme.background}`
            : `radial-gradient(circle at 50% 48%, ${accentColor}55, transparent 24%), linear-gradient(90deg, transparent 49.7%, #ffffffdd 50%, transparent 50.3%)`,
        }}
      />
    );
  }

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 h-full w-full"
      aria-hidden="true"
    />
  );
}
