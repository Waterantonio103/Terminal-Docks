import { useState, useRef, useEffect } from "react";

// ── TWEAK THESE ───────────────────────────────────────────────────────────────

/** Grid density. Higher = more dots. 1 = ~1000 dots, 2.5 = ~4000, 3.5 = ~7700. */
const DEFAULT_DENSITY = 3.0;

/** Dot radius as a fraction of grid spacing. Smaller = tinier dots. */
const DOT_RADIUS_FRACTION = 0.10;

/** Animation speed multiplier. 1 = normal. */
const DEFAULT_SPEED = 2.0;

/** Mouse hover brightening strength. 0 = off. */
const DEFAULT_INTERACTION_STRENGTH = 1.1;

// ── Internal constants ────────────────────────────────────────────────────────

const PIN_K            = 0.14;
const PIN_PRESCALE     = 1.14;
const BRIGHT_DOT_FRACTION  = 0.35;
const ACCENT_DOT_FRACTION  = 0.20;
const FLICKER_SPEED_MIN    = 0.004;
const FLICKER_SPEED_MAX    = 0.016;
const FLICKER_INTERVAL_MIN = 40;
const FLICKER_INTERVAL_MAX = 200;
const CURSOR_RADIUS_FRACTION = 0.22;
const CURSOR_BOOST_MAX       = 0.6;
const SHARP_GLOW_RADIUS      = 4.5;

// Sprite canvas: half-size = SHARP_GLOW_RADIUS so the glow fills edge-to-edge.
const SPRITE_SIZE   = 64;
const SPRITE_CORE_R = SPRITE_SIZE / (2 * SHARP_GLOW_RADIUS);

// Target ~30 fps — plenty for slow dot flicker.
const FRAME_MS = 1000 / 30;

// ─────────────────────────────────────────────────────────────────────────────

interface DotTunnelBackgroundProps {
  density?:             number;
  speed?:               number;
  interactionStrength?: number;
}

interface ThemeColors {
  bg:      string;
  primary: string;
  accent:  string;
}

interface Dot {
  gx: number; gy: number;
  brightness: number; targetBright: number;
  flickerSpeed: number;
  isBright: boolean; isAccent: boolean;
  nextFlip: number; frame: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace(/[^0-9a-f]/gi, "").padEnd(6, "0"), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function readThemeColors(el: HTMLElement): ThemeColors {
  const s = getComputedStyle(el);
  return {
    bg:      s.getPropertyValue("--bg-app").trim()       || "#0c0c14",
    primary: s.getPropertyValue("--text-primary").trim() || "#e2e4f0",
    accent:  s.getPropertyValue("--accent-primary").trim()|| "#7059f5",
  };
}

function createDots(density: number): { dots: Dot[]; cols: number; rows: number } {
  const cols = Math.round(32 * density);
  const rows = Math.round(20 * density);
  const dots: Dot[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      dots.push({
        gx:           (col / (cols - 1)) * 2 - 1,
        gy:           (row / (rows - 1)) * 2 - 1,
        brightness:   Math.random(),
        targetBright: Math.random(),
        flickerSpeed: FLICKER_SPEED_MIN + Math.random() * (FLICKER_SPEED_MAX - FLICKER_SPEED_MIN),
        isBright:     Math.random() < BRIGHT_DOT_FRACTION,
        isAccent:     Math.random() < ACCENT_DOT_FRACTION,
        nextFlip:     Math.random() * 300,
        frame:        0,
      });
    }
  }
  return { dots, cols, rows };
}

// Pre-bakes glow + ring + core for one dot type onto a small canvas.
// At draw time: single ctx.drawImage with globalAlpha = brightness.
function buildSprite(
  cR: number, cG: number, cB: number,
  rR: number, rG: number, rB: number,
): HTMLCanvasElement {
  const oc  = document.createElement("canvas");
  oc.width  = SPRITE_SIZE;
  oc.height = SPRITE_SIZE;
  const c   = oc.getContext("2d")!;
  const cx  = SPRITE_SIZE / 2;
  const r   = SPRITE_CORE_R;

  const glow = c.createRadialGradient(cx, cx, r * 0.3, cx, cx, r * SHARP_GLOW_RADIUS);
  glow.addColorStop(0, `rgba(${rR|0},${rG|0},${rB|0},0.22)`);
  glow.addColorStop(1, "rgba(0,0,0,0)");
  c.fillStyle = glow;
  c.beginPath();
  c.arc(cx, cx, r * SHARP_GLOW_RADIUS, 0, Math.PI * 2);
  c.fill();

  c.strokeStyle = `rgba(${rR|0},${rG|0},${rB|0},0.85)`;
  c.lineWidth   = r * 0.35;
  c.beginPath();
  c.arc(cx, cx, r * 2.2, 0, Math.PI * 2);
  c.stroke();

  c.fillStyle = `rgb(${cR|0},${cG|0},${cB|0})`;
  c.beginPath();
  c.arc(cx, cx, r, 0, Math.PI * 2);
  c.fill();

  return oc;
}

function buildVignette(w: number, h: number, bgRgb: [number, number, number]): HTMLCanvasElement {
  const oc  = document.createElement("canvas");
  oc.width  = w; oc.height = h;
  const c   = oc.getContext("2d")!;
  const cx  = w * 0.5, cy = h * 0.5;
  const vig = c.createRadialGradient(
    cx, cy, Math.min(w, h) * 0.3,
    cx, cy, Math.max(w, h) * 0.75,
  );
  vig.addColorStop(0,    "rgba(0,0,0,0)");
  vig.addColorStop(0.65, "rgba(0,0,0,0)");
  vig.addColorStop(1,    `rgba(${bgRgb[0]},${bgRgb[1]},${bgRgb[2]},0.92)`);
  c.fillStyle = vig;
  c.fillRect(0, 0, w, h);
  return oc;
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function DotTunnelBackground({
  density             = DEFAULT_DENSITY,
  speed               = DEFAULT_SPEED,
  interactionStrength = DEFAULT_INTERACTION_STRENGTH,
}: DotTunnelBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Colors read from the canvas itself — it inherits CSS vars from the themed
  // ancestor div. MutationObserver fires after the theme class is applied.
  const [colors, setColors] = useState<ThemeColors>({ bg: "#0c0c14", primary: "#e2e4f0", accent: "#7059f5" });

  useEffect(() => {
    const canvas = canvasRef.current!;

    const refresh = () => {
      const next = readThemeColors(canvas);
      setColors(prev =>
        prev.bg === next.bg && prev.primary === next.primary && prev.accent === next.accent
          ? prev   // identical values → return same ref → no re-render, no effect re-run
          : next
      );
    };
    refresh();

    const mo = new MutationObserver(refresh);
    mo.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["class"] });
    return () => mo.disconnect();
  }, []);

  // ── Mutable render state (outside React state to avoid re-renders) ─────────
  const stateRef = useRef<{
    dots: Dot[]; cols: number; rows: number;
    mouse: { x: number; y: number };
    mouseLerp: { x: number; y: number };
    frame: number; raf: number;
    dpr: number; w: number; h: number;
    lastTime: number;
    normalSprite: HTMLCanvasElement | null;
    accentSprite: HTMLCanvasElement | null;
    vignette:     HTMLCanvasElement | null;
  } | null>(null);

  if (!stateRef.current) {
    stateRef.current = {
      ...createDots(density),
      mouse:        { x: 0.5, y: 0.5 },
      mouseLerp:    { x: 0.5, y: 0.5 },
      frame: 0, raf: 0, dpr: 1, w: 0, h: 0,
      lastTime: 0,
      normalSprite: null, accentSprite: null, vignette: null,
    };
  }

  useEffect(() => {
    Object.assign(stateRef.current!, createDots(density));
  }, [density]);

  // Mouse — relative to canvas, cached to avoid layout thrash
  useEffect(() => {
    const canvas = canvasRef.current!;
    const s = stateRef.current!;
    let cachedRect = canvas.getBoundingClientRect();
    let lastTs = -1;
    const onMove = (e: PointerEvent) => {
      if (e.timeStamp !== lastTs) { cachedRect = canvas.getBoundingClientRect(); lastTs = e.timeStamp; }
      s.mouse.x = (e.clientX - cachedRect.left) / cachedRect.width;
      s.mouse.y = (e.clientY - cachedRect.top)  / cachedRect.height;
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, []);

  // Main render loop — restarts when colors or visual params change
  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx    = canvas.getContext("2d")!;
    const s      = stateRef.current!;

    const bgRgb = hexToRgb(colors.bg);
    const pRgb  = hexToRgb(colors.primary);
    const aRgb  = hexToRgb(colors.accent);

    const normCoreR = lerp(pRgb[0], 255, 0.6), normCoreG = lerp(pRgb[1], 255, 0.6), normCoreB = lerp(pRgb[2], 255, 0.6);
    const normRingR = lerp(aRgb[0], pRgb[0], 0.4), normRingG = lerp(aRgb[1], pRgb[1], 0.4), normRingB = lerp(aRgb[2], pRgb[2], 0.4);
    const acntCoreR = lerp(pRgb[0], aRgb[0], 0.3), acntCoreG = lerp(pRgb[1], aRgb[1], 0.3), acntCoreB = lerp(pRgb[2], aRgb[2], 0.3);

    s.normalSprite = buildSprite(normCoreR, normCoreG, normCoreB, normRingR, normRingG, normRingB);
    s.accentSprite = buildSprite(acntCoreR, acntCoreG, acntCoreB, aRgb[0], aRgb[1], aRgb[2]);
    s.vignette     = null; // rebuilt on next resize

    function resize() {
      const dpr  = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      s.dpr = dpr; s.w = rect.width; s.h = rect.height;
      canvas.width  = rect.width  * dpr;
      canvas.height = rect.height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      s.vignette = null;
    }
    resize();

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const onVisibility = () => { if (!document.hidden) s.raf = requestAnimationFrame(draw); };
    document.addEventListener("visibilitychange", onVisibility);

    function draw(time: number) {
      if (document.hidden) return;
      if (time - s.lastTime < FRAME_MS) { s.raf = requestAnimationFrame(draw); return; }
      s.lastTime = time;

      const { w, h, dots, cols, rows, mouse, mouseLerp } = s;
      if (w === 0 || h === 0) { s.raf = requestAnimationFrame(draw); return; }

      if (!s.vignette) s.vignette = buildVignette(w, h, bgRgb);

      mouseLerp.x = lerp(mouseLerp.x, mouse.x, 0.08);
      mouseLerp.y = lerp(mouseLerp.y, mouse.y, 0.08);

      ctx.fillStyle = colors.bg;
      ctx.fillRect(0, 0, w, h);

      const cx = w * 0.5, cy = h * 0.5;
      const halfW = cx, halfH = cy;
      const halfDiag = Math.sqrt(halfW * halfW + halfH * halfH);

      const spacingX        = w / (cols - 1);
      const spacingY        = h / (rows - 1);
      const baseRadius      = Math.min(spacingX, spacingY) * DOT_RADIUS_FRACTION;
      const mx              = mouseLerp.x * w;
      const my              = mouseLerp.y * h;
      const cursorRadiusSq  = (Math.min(w, h) * CURSOR_RADIUS_FRACTION * interactionStrength) ** 2;

      const normalSprite = s.normalSprite!;
      const accentSprite = s.accentSprite!;

      for (let i = 0; i < dots.length; i++) {
        const d = dots[i];

        d.frame++;
        if (d.frame >= d.nextFlip) {
          d.targetBright = d.isBright
            ? 0.5 + Math.random() * 0.5
            : Math.random() < 0.3 ? 0.6 + Math.random() * 0.4 : Math.random() * 0.25;
          d.nextFlip = d.frame + FLICKER_INTERVAL_MIN + Math.random() * FLICKER_INTERVAL_MAX / speed;
        }
        d.brightness = lerp(d.brightness, d.targetBright, d.flickerSpeed * speed * 3);

        // Pincushion warp — inlined to avoid per-dot array allocation
        const dx0    = d.gx * halfW * PIN_PRESCALE;
        const dy0    = d.gy * halfH * PIN_PRESCALE;
        const r2     = (dx0 * dx0 + dy0 * dy0) / (halfDiag * halfDiag);
        const factor = 1.0 / (1.0 + PIN_K * r2);
        const sx     = cx + dx0 * factor;
        const sy_    = cy + dy0 * factor;

        if (sx < -30 || sx > w + 30 || sy_ < -30 || sy_ > h + 30) continue;

        // Edge falloff — dots shrink and fade toward corners (warp/lens effect)
        const normDist = Math.sqrt((sx - cx) ** 2 + (sy_ - cy) ** 2) / halfDiag;
        const edgeScale = Math.max(0.18, 1 - normDist * normDist * 0.82);

        // Cursor brightness boost
        const ddx = sx - mx, ddy = sy_ - my;
        const distSq = ddx * ddx + ddy * ddy;
        const cursorBoost = distSq < cursorRadiusSq
          ? (1 - Math.sqrt(distSq / cursorRadiusSq)) * CURSOR_BOOST_MAX
          : 0;

        const bright = Math.min(1, d.brightness + cursorBoost);
        if (bright < 0.03) continue;

        const r        = baseRadius * (0.7 + bright * 0.5) * edgeScale;
        const drawHalf = r * SHARP_GLOW_RADIUS;
        const drawSize = drawHalf * 2;

        ctx.globalAlpha = bright * edgeScale;
        ctx.drawImage(
          d.isAccent ? accentSprite : normalSprite,
          sx - drawHalf, sy_ - drawHalf, drawSize, drawSize,
        );
      }
      ctx.globalAlpha = 1;

      ctx.drawImage(s.vignette, 0, 0, w, h);

      s.raf = requestAnimationFrame(draw);
    }

    s.raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(s.raf);
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [colors, speed, interactionStrength]);

  return (
    <canvas
      ref={canvasRef}
      style={{ position: "absolute", inset: 0, display: "block", width: "100%", height: "100%" }}
    />
  );
}
