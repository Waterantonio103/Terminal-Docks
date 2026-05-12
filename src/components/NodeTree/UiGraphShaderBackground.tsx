import { useEffect, useRef, useState } from 'react';

interface ThemeShaderColors {
  bg: [number, number, number];
  line: [number, number, number];
  pulse: [number, number, number];
}

function parseColor(value: string, fallback: [number, number, number]): [number, number, number] {
  const trimmed = value.trim();
  if (!trimmed) return fallback;

  const hex = trimmed.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const raw = hex[1].length === 3
      ? hex[1].split('').map(char => char + char).join('')
      : hex[1];
    const n = parseInt(raw, 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }

  const rgb = trimmed.match(/rgba?\(([^)]+)\)/i);
  if (rgb) {
    const parts = rgb[1].split(',').map(part => Number.parseFloat(part.trim()));
    if (parts.length >= 3 && parts.every(part => Number.isFinite(part))) {
      return [parts[0] / 255, parts[1] / 255, parts[2] / 255];
    }
  }

  return fallback;
}

function readThemeColors(element: HTMLElement): ThemeShaderColors {
  const styles = getComputedStyle(element);
  return {
    bg: parseColor(styles.getPropertyValue('--bg-app'), [0.03, 0.03, 0.05]),
    line: parseColor(styles.getPropertyValue('--text-muted'), [0.25, 0.28, 0.38]),
    pulse: parseColor(styles.getPropertyValue('--accent-primary'), [0.44, 0.35, 0.96]),
  };
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
  uniform vec3 uBgColor;
  uniform vec3 uLineColor;
  uniform vec3 uPulseColor;
  uniform vec2 uMouse;

  #define R iResolution.xy
  #define PIXEL 5.0/min(R.x,R.y)
  #define S smoothstep
  #define T iTime
  #define L(p,b) length( p - (b) * clamp( dot(p,b)/dot(b,b), 0., 1. ) )

  float aValue(int index) {
    if (index == 0) return 0.0;
    if (index == 1) return 1.0;
    return -1.0;
  }

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float cn(vec2 a, vec2 d) {
    float n = hash(a);

    vec2 c = normalize(a), l = normalize(d);
    float m = abs(dot(c, l));
    float p = S(.7, .98, m) * .75;
    float t = length(a);
    float ce = 1.0 - S(0.0, 2., t);
    p *= S(18.0, 2.0, t);
    p = mix(p, 0.8, ce);

    return mix(1e2, 0., step(n, p));
  }

  void mainImage(out vec4 O, in vec2 F) {
    vec2 uv = (F - 0.5 * R) / R.y;

    float s = 20., d = 1e2;
    vec2 u = uv * s;
    vec2 i = floor(u);
    vec2 f = fract(u) - .5;

    for(int m = 1; m < 9; ++m) {
      int j = int(mod(float(m), 3.0));
      int k = m / 3;
      vec2 q = vec2(aValue(j), aValue(k));
      vec2 p = i + q * .5;
      d = min(d, cn(p, q) + L(f, q * .5));
    }

    float t = 0.05;
    float an = atan(i.y, i.x);
    float di = length(uv) * 5.0;
    float l = S(t + PIXEL, t, d) - S(t, 0., d);
    float cl = S(t * .3 + PIXEL, t * .3, d);
    float g = PIXEL / (d + 1e-3);
    float ro = sin(an * 7.) * 2.5 + cos(an * 3.) * 1.5;
    float rs = 0.22 + sin(an * 5.) * .08;
    float w = fract(di + ro - T * rs);
    float pu = .05 / (1. - w + .015) * hash(uv * 20.);
    pu = max(0., pu - .04) * S(1., .95, w);

    if (uMouse.x >= 0.0) {
      vec2 mouseUv = (uMouse - 0.5 * R) / R.y;
      float mouseDistance = length(uv - mouseUv);
      float pathProximity = S(t * .75 + PIXEL * 2.0, 0.0, d);
      float mouseBoost = S(.34, 0.0, mouseDistance) * pathProximity;
      pu *= 1.0 + mouseBoost * 4.2;
      cl += mouseBoost * .22;
    }

    vec3 bc = uLineColor * l * 0.62;
    vec3 pc = uPulseColor * pu * cl * 2.4;
    pc += uPulseColor * pu * g * 0.65;

    vec3 c = bc + pc;
    c *= exp(-di * .48);
    c = mix(uBgColor, uBgColor + c, 0.9);

    O = vec4(c, 1.0);
  }

  void main() {
    mainImage(gl_FragColor, gl_FragCoord.xy);
  }
`;

export function UiGraphShaderBackground() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [colors, setColors] = useState<ThemeShaderColors>({
    bg: [0.03, 0.03, 0.05],
    line: [0.25, 0.28, 0.38],
    pulse: [0.44, 0.35, 0.96],
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const refresh = () => {
      const next = readThemeColors(canvas);
      setColors(prev =>
        prev.bg.join(',') === next.bg.join(',') &&
        prev.line.join(',') === next.line.join(',') &&
        prev.pulse.join(',') === next.pulse.join(',')
          ? prev
          : next
      );
    };
    refresh();

    const observer = new MutationObserver(refresh);
    observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext('webgl', { alpha: false, antialias: false, powerPreference: 'low-power' });
    if (!gl) return;

    const program = createProgram(gl, VERTEX_SHADER, FRAGMENT_SHADER);
    if (!program) return;

    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);

    const positionLocation = gl.getAttribLocation(program, 'aPosition');
    const resolutionLocation = gl.getUniformLocation(program, 'iResolution');
    const timeLocation = gl.getUniformLocation(program, 'iTime');
    const bgLocation = gl.getUniformLocation(program, 'uBgColor');
    const lineLocation = gl.getUniformLocation(program, 'uLineColor');
    const pulseLocation = gl.getUniformLocation(program, 'uPulseColor');
    const mouseLocation = gl.getUniformLocation(program, 'uMouse');

    let frame = 0;
    let start = performance.now();
    const mouse = { x: -1, y: -1 };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const width = Math.max(1, Math.floor(rect.width * dpr));
      const height = Math.max(1, Math.floor(rect.height * dpr));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      gl.viewport(0, 0, width, height);
    };

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    const handlePointerMove = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      mouse.x = (event.clientX - rect.left) * dpr;
      mouse.y = (rect.height - (event.clientY - rect.top)) * dpr;
    };
    const handlePointerLeave = () => {
      mouse.x = -1;
      mouse.y = -1;
    };
    window.addEventListener('pointermove', handlePointerMove, { passive: true });
    window.addEventListener('pointerleave', handlePointerLeave);

    const render = (now: number) => {
      if (document.hidden) {
        start = now;
        frame = requestAnimationFrame(render);
        return;
      }

      resize();
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
      gl.enableVertexAttribArray(positionLocation);
      gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
      gl.uniform2f(resolutionLocation, canvas.width, canvas.height);
      gl.uniform1f(timeLocation, (now - start) * 0.00065);
      gl.uniform3fv(bgLocation, colors.bg);
      gl.uniform3fv(lineLocation, colors.line);
      gl.uniform3fv(pulseLocation, colors.pulse);
      gl.uniform2f(mouseLocation, mouse.x, mouse.y);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      frame = requestAnimationFrame(render);
    };

    frame = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerleave', handlePointerLeave);
      gl.deleteBuffer(positionBuffer);
      gl.deleteProgram(program);
    };
  }, [colors]);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-0 block h-full w-full"
      aria-hidden="true"
    />
  );
}
