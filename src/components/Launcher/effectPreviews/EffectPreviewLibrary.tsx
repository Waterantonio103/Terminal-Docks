import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { EffectPreviewProps } from './types';

type CssVariant =
  | 'perspective-dashboard'
  | 'agency-grid'
  | 'meditative-dark'
  | 'technical-system'
  | 'webgl-field'
  | 'aura-network-scene'
  | 'aura-isometric-scene'
  | 'd3-globe-scene'
  | 'asset-images'
  | 'beautiful-shadows'
  | 'blue-cloudy'
  | 'book-serif'
  | 'border-gradients'
  | 'minimal-beige'
  | 'company-logos'
  | 'container-lines'
  | 'corner-diagonals'
  | 'corner-lasers'
  | 'cursor-flashlight'
  | 'dither-background'
  | 'editorial-tech'
  | 'framed-grid'
  | 'glass-clock'
  | 'grainy-stepped'
  | 'high-contrast-skeuo'
  | 'image-first-grid'
  | 'interactive-border'
  | 'light-paper-tech'
  | 'magic-rings'
  | 'marquee'
  | 'masked-reveal'
  | 'mesh-gradient'
  | 'nested-agency'
  | 'nested-frames'
  | 'number-details'
  | 'orange-paper-saas'
  | 'premium-gradient-border'
  | 'progressive-blur'
  | 'skeuomorphic'
  | 'solar-duotone'
  | 'split-technical'
  | 'stepped-neon'
  | 'technical-framed'
  | 'wireframe-info';

type CanvasVariant =
  | 'ambient-particles'
  | 'aura-network'
  | 'isometric-3d'
  | 'd3-globe'
  | 'globe-particles'
  | 'gooey-blob'
  | 'kinetic-radial'
  | 'ascii-field'
  | 'tactical-globe'
  | 'webgl-object';

type ShaderVariant =
  | 'grain'
  | 'procedural'
  | 'topographic'
  | 'grid'
  | 'chromatic'
  | 'cyber-field'
  | 'cyber-trail'
  | 'industrial'
  | 'isometric-spatial'
  | 'organic'
  | 'mesh-network'
  | 'technical-shader'
  | 'terminal-grid'
  | 'fluid-nebula';

const SHADER_VARIANT_INDEX: Record<ShaderVariant, number> = {
  grain: 0,
  procedural: 1,
  topographic: 2,
  grid: 3,
  chromatic: 4,
  'cyber-field': 5,
  'cyber-trail': 6,
  industrial: 7,
  'isometric-spatial': 8,
  organic: 9,
  'mesh-network': 10,
  'technical-shader': 11,
  'terminal-grid': 12,
  'fluid-nebula': 13,
};

function parseHexColor(value: string | undefined, fallback: [number, number, number]): [number, number, number] {
  const raw = String(value ?? '').trim();
  const match = raw.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!match) return fallback;
  const hex = match[1].length === 3 ? match[1].split('').map(char => char + char).join('') : match[1];
  const numeric = Number.parseInt(hex, 16);
  return [((numeric >> 16) & 255) / 255, ((numeric >> 8) & 255) / 255, (numeric & 255) / 255];
}

function colorToCss(value: [number, number, number], alpha = 1): string {
  return `rgba(${Math.round(value[0] * 255)}, ${Math.round(value[1] * 255)}, ${Math.round(value[2] * 255)}, ${alpha})`;
}

function colorMix(color: [number, number, number], target: [number, number, number], amount: number): [number, number, number] {
  return [
    color[0] * (1 - amount) + target[0] * amount,
    color[1] * (1 - amount) + target[1] * amount,
    color[2] * (1 - amount) + target[2] * amount,
  ];
}

function rgba(hex: string | undefined, alpha: number, fallback: [number, number, number]): string {
  return colorToCss(parseHexColor(hex, fallback), alpha);
}

function useClock({ mode, reducedMotion }: Pick<EffectPreviewProps, 'mode' | 'reducedMotion'>): number {
  const [time, setTime] = useState(mode === 'poster' || reducedMotion ? 3.4 : 0);

  useEffect(() => {
    if (mode === 'poster' || reducedMotion) {
      setTime(3.4);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      setTime((now - start) / 1000);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [mode, reducedMotion]);

  return time;
}

function seeded(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

const PREVIEW_STYLE = `
@keyframes effect-preview-marquee { from { transform: translateX(0); } to { transform: translateX(-50%); } }
@keyframes effect-preview-mask { from { transform: translateY(60%); opacity: .3; } to { transform: translateY(0); opacity: 1; } }
@keyframes effect-preview-breathe { 0%,100% { transform: scale(.98); opacity: .72; } 50% { transform: scale(1.06); opacity: 1; } }
@keyframes effect-preview-scan { from { transform: translateY(-100%); } to { transform: translateY(100%); } }
`;

function PreviewStyle() {
  return <style>{PREVIEW_STYLE}</style>;
}

function PreviewPanel({
  children,
  style,
  className = '',
}: {
  children?: ReactNode;
  style?: CSSProperties;
  className?: string;
}) {
  return (
    <div className={`absolute inset-0 overflow-hidden ${className}`} style={style}>
      {children}
    </div>
  );
}

function GridLines({ color, opacity = 0.16, size = 44 }: { color: string; opacity?: number; size?: number }) {
  return (
    <div
      className="absolute inset-0"
      style={{
        opacity,
        backgroundImage: `linear-gradient(${color} 1px, transparent 1px), linear-gradient(90deg, ${color} 1px, transparent 1px)`,
        backgroundSize: `${size}px ${size}px`,
      }}
    />
  );
}

function CornerMarks({ color, inset = 18 }: { color: string; inset?: number }) {
  const base: CSSProperties = { borderColor: color, opacity: 0.78 };
  return (
    <>
      <div className="absolute h-5 w-5 border-l border-t" style={{ ...base, left: inset, top: inset }} />
      <div className="absolute h-5 w-5 border-r border-t" style={{ ...base, right: inset, top: inset }} />
      <div className="absolute h-5 w-5 border-b border-l" style={{ ...base, left: inset, bottom: inset }} />
      <div className="absolute h-5 w-5 border-b border-r" style={{ ...base, right: inset, bottom: inset }} />
    </>
  );
}

function ThumbnailEffectOnlyPreview({
  variant,
  colors,
  accent,
  secondary,
  darkBg,
  line,
  panel,
  muted,
  theme,
}: {
  variant: CssVariant;
  colors: string[];
  accent: string;
  secondary: string;
  darkBg: string;
  line: string;
  panel: string;
  muted: string;
  theme: EffectPreviewProps['theme'];
}) {
  if (variant === 'blue-cloudy') {
    return (
      <PreviewPanel style={cssBackground(variant, accent, secondary, darkBg, theme.isLight)}>
        <div className="absolute inset-0 opacity-80 blur-sm" style={{ background: 'radial-gradient(circle at 42% 42%, rgba(255,255,255,.38), transparent 22%), radial-gradient(circle at 72% 32%, rgba(255,255,255,.26), transparent 18%)' }} />
      </PreviewPanel>
    );
  }

  if (variant === 'perspective-dashboard') {
    return (
      <PreviewPanel style={{ background: 'radial-gradient(circle at 48% 52%, rgba(255,90,31,.16), transparent 30%), #090908', perspective: '900px' }}>
        <GridLines color="rgba(255,255,255,.18)" opacity={0.08} size={28} />
        {[0, 1, 2].map(index => (
          <div
            key={index}
            className="absolute h-[56%] w-[48%] rounded-lg border"
            style={{
              left: `${28 + index * 10}%`,
              top: `${16 + index * 8}%`,
              background: index === 0 ? rgba(accent, .18, [1, .35, .12]) : 'rgba(255,255,255,.055)',
              borderColor: rgba(accent, .34 - index * .08, [1, .35, .12]),
              transform: `rotateX(42deg) rotateY(-18deg) rotateZ(${14 - index * 9}deg) scale(${1 - index * .1})`,
              boxShadow: index === 0 ? `0 0 26px ${rgba(accent, .26, [1, .35, .12])}` : undefined,
            }}
          />
        ))}
      </PreviewPanel>
    );
  }

  if (variant === 'technical-system' || variant === 'd3-globe-scene') {
    return (
      <PreviewPanel style={{ background: variant === 'd3-globe-scene' ? 'linear-gradient(90deg, rgba(5,7,7,.70), rgba(59,8,12,.30))' : 'radial-gradient(circle at 58% 42%, rgba(59,46,185,.55), transparent 32%), radial-gradient(circle at 66% 32%, rgba(0,240,255,.18), transparent 38%), rgba(3,3,5,.48)' }}>
        <GridLines color="rgba(255,255,255,.22)" opacity={0.07} size={18} />
        <CornerMarks color="rgba(255,255,255,.26)" inset={10} />
      </PreviewPanel>
    );
  }

  if (variant === 'mesh-gradient' || variant === 'meditative-dark') {
    return (
      <PreviewPanel style={{ background: `radial-gradient(circle at 12% 30%, ${rgba(accent, .62, [.2, .8, 1])}, transparent 28%), radial-gradient(circle at 82% 36%, ${rgba(secondary, .52, [.6, .5, 1])}, transparent 34%), linear-gradient(135deg, #030711, #080915 70%)` }}>
        <div className="absolute -left-[16%] top-[8%] h-[82%] w-[68%] rounded-full blur-2xl" style={{ background: rgba(accent, .28, [.2, .8, 1]) }} />
        <div className="absolute right-[8%] top-[16%] h-[66%] w-[42%] -rotate-12 rounded-[28px] border" style={{ borderColor: rgba(secondary, .24, [.6, .5, 1]), background: 'linear-gradient(145deg, rgba(255,255,255,.07), rgba(255,255,255,.015))', boxShadow: `0 18px 70px ${rgba(accent, .22, [.2, .8, 1])}` }} />
      </PreviewPanel>
    );
  }

  if (variant === 'dither-background' || variant === 'grainy-stepped') {
    return (
      <PreviewPanel style={cssBackground(variant === 'dither-background' ? 'dither-background' : 'mesh-gradient', accent, secondary, darkBg, theme.isLight)}>
        <div className="absolute inset-0 opacity-40" style={{ backgroundImage: 'radial-gradient(circle, rgba(255,255,255,.38) 1px, transparent 1.4px)', backgroundSize: variant === 'grainy-stepped' ? '7px 7px' : '5px 5px' }} />
        {variant === 'grainy-stepped' && [0, 1, 2, 3].map(i => (
          <div key={i} className="absolute h-[18%] w-[46%]" style={{ left: `${12 + i * 10}%`, top: `${20 + i * 12}%`, background: rgba(colors[i % colors.length], .2, [.2, .7, 1]) }} />
        ))}
      </PreviewPanel>
    );
  }

  if (variant === 'webgl-field') {
    return (
      <PreviewPanel style={{ background: 'radial-gradient(circle at 50% 78%, rgba(48,255,148,.24), transparent 28%), rgba(2,4,3,.42)' }}>
        <GridLines color="rgba(88,255,170,.22)" opacity={0.07} size={22} />
        <div className="absolute left-1/2 top-[-12%] h-[130%] w-[2px] -translate-x-1/2 blur-[1px]" style={{ background: `linear-gradient(180deg, transparent, ${accent}, #eafff4, ${accent}, transparent)`, boxShadow: `0 0 28px ${accent}, 0 0 70px ${accent}` }} />
      </PreviewPanel>
    );
  }

  if (variant === 'stepped-neon') {
    return (
      <PreviewPanel style={{ background: 'radial-gradient(circle at 70% 36%, rgba(255,255,255,.10), transparent 24%), #050506' }}>
        {[0, 1, 2, 3, 4].map(i => (
          <div
            key={i}
            className="absolute border"
            style={{
              left: `${18 + i * 7}%`,
              top: `${14 + i * 8}%`,
              width: `${62 - i * 10}%`,
              height: `${62 - i * 8}%`,
              borderColor: i % 2 ? rgba(secondary, .34, [.6, .8, 1]) : rgba(accent, .48, [.2, .8, 1]),
              boxShadow: i === 0 ? `0 0 32px ${rgba(accent, .28, [.2, .8, 1])}` : undefined,
            }}
          />
        ))}
      </PreviewPanel>
    );
  }

  if (variant === 'aura-network-scene' || variant === 'aura-isometric-scene') {
    return (
      <PreviewPanel style={{ background: variant === 'aura-network-scene' ? 'radial-gradient(circle at 50% 48%, rgba(255,255,255,.08), transparent 38%), rgba(5,5,5,.30)' : 'radial-gradient(circle at 70% 52%, rgba(0,229,255,.12), transparent 38%), rgba(5,5,7,.20)' }}>
        <GridLines color={rgba(accent, .3, [.2, .8, 1])} opacity={0.06} size={22} />
      </PreviewPanel>
    );
  }

  if (variant === 'cursor-flashlight') {
    return (
      <PreviewPanel style={{ background: '#06101a' }}>
        <GridLines color="rgba(255,255,255,.14)" opacity={0.05} size={24} />
        <div className="absolute -left-[6%] top-[15%] h-[72%] w-[58%] rounded-full blur-2xl" style={{ background: rgba(accent, .42, [.2, .9, .75]) }} />
        <div className="absolute left-[42%] top-[18%] h-[52%] w-[42%] rounded-full" style={{ background: 'radial-gradient(circle, rgba(255,255,255,.20), transparent 60%)', boxShadow: `0 0 58px ${rgba(accent, .28, [.2, .9, .75])}` }} />
      </PreviewPanel>
    );
  }

  if (variant === 'corner-lasers' || variant === 'corner-diagonals') {
    return (
      <PreviewPanel style={cssBackground(variant, accent, secondary, darkBg, theme.isLight)}>
        <CornerMarks color={accent} inset={10} />
        <div className="absolute left-0 top-0 h-[2px] w-[62%] origin-left blur-[.4px]" style={{ background: `linear-gradient(90deg, ${accent}, transparent)`, boxShadow: `0 0 24px ${accent}`, transform: 'rotate(38deg)' }} />
        <div className="absolute bottom-0 right-0 h-[2px] w-[62%] origin-right blur-[.4px]" style={{ background: `linear-gradient(270deg, ${secondary}, transparent)`, boxShadow: `0 0 24px ${secondary}`, transform: 'rotate(38deg)' }} />
      </PreviewPanel>
    );
  }

  if (variant === 'border-gradients' || variant === 'premium-gradient-border' || variant === 'interactive-border') {
    return (
      <PreviewPanel style={{ background: variant === 'premium-gradient-border' ? '#06150d' : cssBackground(variant, accent, secondary, darkBg, theme.isLight).background }}>
        <div className="absolute inset-[12%] rounded-[18px] p-px" style={{ background: `linear-gradient(135deg, ${accent}, transparent 30%, ${secondary})`, boxShadow: variant === 'interactive-border' ? `0 0 42px ${rgba(accent, .38, [.2, .6, 1])}` : `0 20px 70px ${rgba(accent, .18, [.2, .8, 1])}` }}>
          <div className="relative h-full w-full overflow-hidden rounded-[18px]" style={{ background: theme.isLight ? 'rgba(255,255,255,.72)' : 'rgba(7,8,12,.76)' }}>
            <div className="absolute inset-0 opacity-70" style={{ background: `radial-gradient(circle at 28% 24%, ${rgba(accent, .26, [.2, .8, 1])}, transparent 28%), radial-gradient(circle at 78% 76%, ${rgba(secondary, .18, [.6, .7, 1])}, transparent 32%)` }} />
          </div>
        </div>
      </PreviewPanel>
    );
  }

  if (variant === 'progressive-blur') {
    return (
      <PreviewPanel style={cssBackground(variant, accent, secondary, darkBg, theme.isLight)}>
        <div className="absolute inset-x-0 top-0 h-1/2 backdrop-blur-[2px]" style={{ maskImage: 'linear-gradient(#000, transparent)', WebkitMaskImage: 'linear-gradient(#000, transparent)' }} />
        <div className="absolute inset-x-0 bottom-0 h-1/2 backdrop-blur-md" style={{ maskImage: 'linear-gradient(transparent, #000)', WebkitMaskImage: 'linear-gradient(transparent, #000)' }} />
      </PreviewPanel>
    );
  }

  if (variant === 'minimal-beige' || variant === 'orange-paper-saas' || variant === 'light-paper-tech') {
    return (
      <PreviewPanel style={cssBackground(variant, accent, secondary, darkBg, theme.isLight)}>
        <GridLines color="rgba(92,76,52,.22)" opacity={variant === 'light-paper-tech' ? .18 : .08} size={variant === 'light-paper-tech' ? 24 : 42} />
        <div className="absolute left-[8%] top-[16%] h-[54%] w-[50%] rounded-xl border bg-white/55" style={{ borderColor: 'rgba(80,64,42,.12)', boxShadow: '0 18px 46px rgba(80,48,20,.10)' }} />
        <div className="absolute bottom-[12%] right-[10%] h-[36%] w-[34%] rounded-xl" style={{ background: `linear-gradient(135deg, ${rgba(accent, .38, [1, .45, .12])}, rgba(255,255,255,.18))` }} />
      </PreviewPanel>
    );
  }

  if (variant === 'magic-rings') {
    return (
      <PreviewPanel style={{ background: darkBg }}>
        {[0, 1, 2, 3].map(i => <div key={i} className="absolute left-1/2 top-1/2 rounded-full border" style={{ width: 48 + i * 36, height: 48 + i * 36, marginLeft: -(48 + i * 36) / 2, marginTop: -(48 + i * 36) / 2, borderColor: i % 2 ? rgba(secondary, .28, [.5, .7, 1]) : rgba(accent, .44, [.2, .8, 1]) }} />)}
      </PreviewPanel>
    );
  }

  if (variant === 'marquee') {
    return (
      <PreviewPanel style={{ background: theme.isLight ? '#f8f8f5' : '#08080a' }}>
        <div className="absolute left-[-10%] top-[18%] flex h-[64%] w-[120%] gap-3">
          {[0, 1, 2, 3].map(i => <div key={i} className="h-full flex-1 rounded-lg border" style={{ background: i % 2 ? 'rgba(255,255,255,.05)' : rgba(accent, .12, [.2, .8, 1]), borderColor: line }} />)}
        </div>
      </PreviewPanel>
    );
  }

  if (variant === 'masked-reveal' || variant === 'book-serif') {
    return (
      <PreviewPanel style={{ background: cssBackground(variant, accent, secondary, darkBg, theme.isLight).background }}>
        <div className="absolute left-[10%] top-[25%] text-[32px] font-semibold leading-[.86]" style={{ color: theme.isLight ? '#101010' : '#f8fafc', fontFamily: variant === 'book-serif' ? 'Georgia, serif' : undefined }}>
          {variant === 'book-serif' ? 'Index' : 'Reveal'}
        </div>
        <div className="absolute inset-x-[8%] bottom-[24%] h-10 overflow-hidden">
          <div className="h-full w-full" style={{ background: `linear-gradient(90deg, transparent, ${rgba(accent, .45, [.2, .8, 1])}, transparent)` }} />
        </div>
      </PreviewPanel>
    );
  }

  if (variant === 'glass-clock' || variant === 'beautiful-shadows' || variant === 'skeuomorphic' || variant === 'high-contrast-skeuo') {
    return (
      <PreviewPanel style={{ background: variant === 'beautiful-shadows' ? cssBackground('orange-paper-saas', accent, secondary, darkBg, true).background : (theme.isLight ? '#f3f4f6' : '#09090b') }}>
        <div className="absolute left-[38%] top-[8%] h-[84%] w-[28%] rounded-[24px] border" style={{ background: variant === 'glass-clock' ? 'rgba(255,255,255,.08)' : '#f7f7f4', borderColor: variant === 'high-contrast-skeuo' ? '#111' : 'rgba(0,0,0,.25)', boxShadow: variant === 'beautiful-shadows' ? '0 20px 48px rgba(32,24,16,.24)' : 'inset 0 1px 0 rgba(255,255,255,.55), 0 24px 52px rgba(0,0,0,.34)' }} />
        <div className="absolute bottom-[9%] right-[13%] h-[28%] w-[22%] rounded-[18px] border bg-black" style={{ borderColor: 'rgba(255,255,255,.20)', boxShadow: '0 12px 32px rgba(0,0,0,.32)' }} />
      </PreviewPanel>
    );
  }

  if (variant === 'asset-images' || variant === 'image-first-grid') {
    return (
      <PreviewPanel style={{ background: theme.isLight ? '#f7f7f4' : darkBg }}>
        {variant === 'asset-images' ? (
          <div className="absolute inset-0" style={{ background: `radial-gradient(circle at 46% 26%, rgba(255,230,210,.34), transparent 18%), radial-gradient(circle at 48% 44%, ${rgba(accent, .36, [.9, .55, .35])}, transparent 26%), linear-gradient(140deg, #1c241e, #6f7569 46%, #151817)` }} />
        ) : (
          <div className="absolute inset-0 grid grid-cols-4 gap-1.5 p-3">
            {[0, 1, 2, 3, 4, 5, 6, 7].map(i => <div key={i} className={`${i === 0 || i === 5 ? 'col-span-2 row-span-2' : ''} rounded-md`} style={{ background: `linear-gradient(135deg, ${rgba(colors[i % colors.length], .46, [.3, .5, .9])}, ${rgba(colors[(i + 1) % colors.length], .14, [.8, .8, .8])})` }} />)}
          </div>
        )}
      </PreviewPanel>
    );
  }

  if (variant === 'company-logos' || variant === 'solar-duotone' || variant === 'number-details') {
    return (
      <PreviewPanel style={{ background: variant === 'solar-duotone' ? '#050811' : (theme.isLight ? '#f7f4ec' : darkBg) }}>
        {variant === 'number-details' ? (
          <>
            {[0, 1, 2, 3].map(i => <div key={i} className="absolute rounded-md border" style={{ left: `${14 + i * 8}%`, top: `${18 + i * 13}%`, width: `${54 - i * 7}%`, height: 24, borderColor: line, background: panel }} />)}
            <div className="absolute right-[14%] top-[22%] text-[48px] font-semibold leading-none" style={{ color: accent }}>03</div>
          </>
        ) : (
          <>
            <div className="absolute left-1/2 top-1/2 h-24 w-24 -translate-x-1/2 -translate-y-1/2 rounded-full border" style={{ borderColor: rgba(accent, .35, [.2, .8, 1]) }} />
            <div className="absolute left-1/2 top-1/2 h-10 w-10 -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ background: `linear-gradient(135deg, ${accent}, ${secondary})` }} />
          </>
        )}
      </PreviewPanel>
    );
  }

  if (variant === 'container-lines' || variant === 'framed-grid' || variant === 'technical-framed' || variant === 'split-technical' || variant === 'wireframe-info' || variant === 'agency-grid' || variant === 'editorial-tech' || variant === 'nested-agency' || variant === 'nested-frames') {
    const isTechnical = variant === 'technical-framed' || variant === 'wireframe-info' || variant === 'editorial-tech';
    return (
      <PreviewPanel style={{ background: isTechnical ? 'linear-gradient(135deg, #050608, #0d1218)' : (theme.isLight ? '#f8fafc' : darkBg) }}>
        <GridLines color={line} opacity={isTechnical ? .20 : .14} size={isTechnical ? 18 : 30} />
        <CornerMarks color={accent} inset={10} />
        {variant === 'split-technical' && <div className="absolute bottom-0 left-1/2 top-0 w-px" style={{ background: line }} />}
        {variant === 'nested-agency' || variant === 'nested-frames' ? [0, 1, 2].map(i => <div key={i} className="absolute rounded-lg border" style={{ left: `${14 + i * 10}%`, top: `${18 + i * 8}%`, width: `${64 - i * 12}%`, height: `${54 - i * 10}%`, borderColor: rgba(accent, .18 + i * .08, [.2, .8, 1]) }} />) : null}
        {variant === 'framed-grid' && <div className="absolute left-[38%] top-[8%] h-[84%] w-[28%] rounded-[24px] border border-black/70 bg-white/60" />}
      </PreviewPanel>
    );
  }

  return (
    <PreviewPanel style={cssBackground(variant, accent, secondary, darkBg, theme.isLight)}>
      <GridLines color={line} opacity={0.10} size={30} />
      <div className="absolute inset-[24%] rounded-full blur-2xl" style={{ background: rgba(accent, .28, [.2, .8, 1]) }} />
      <div className="absolute inset-[34%] rounded-full" style={{ background: muted }} />
    </PreviewPanel>
  );
}

function cssBackground(variant: CssVariant, accent: string, secondary: string, bg: string, isLight: boolean): CSSProperties {
  if (variant === 'blue-cloudy') {
    return {
      background:
        'radial-gradient(circle at 20% 74%, rgba(27,181,235,.72), transparent 34%), radial-gradient(circle at 72% 36%, rgba(255,255,255,.56), transparent 30%), linear-gradient(135deg, #1e3a70 0%, #407eaa 48%, #12a3d4 100%)',
    };
  }
  if (variant === 'mesh-gradient') {
    return {
      background:
        `radial-gradient(circle at 22% 22%, ${accent}70, transparent 28%), radial-gradient(circle at 72% 38%, ${secondary}55, transparent 34%), linear-gradient(135deg, #061129, #020617 72%)`,
    };
  }
  if (variant === 'orange-paper-saas') {
    return {
      background:
        `radial-gradient(circle at 74% 22%, ${accent}30, transparent 28%), linear-gradient(135deg, #fff8ed, #f6efe2 62%, #fffaf3)`,
    };
  }
  if (variant === 'minimal-beige') {
    return {
      background: 'linear-gradient(135deg, #faf7f0 0%, #efe8dc 48%, #fffdf7 100%)',
    };
  }
  if (variant === 'light-paper-tech') {
    return {
      background:
        `linear-gradient(90deg, rgba(15,23,42,.08) 1px, transparent 1px), linear-gradient(0deg, rgba(15,23,42,.06) 1px, transparent 1px), linear-gradient(135deg, #fbfaf5, #ece8dd)`,
      backgroundSize: '46px 46px, 46px 46px, auto',
    };
  }
  if (variant === 'dither-background') {
    return {
      background:
        `radial-gradient(circle at 50% 50%, ${accent}33, transparent 34%), radial-gradient(circle, rgba(255,255,255,.24) 1px, transparent 1.2px), ${bg}`,
      backgroundSize: 'auto, 6px 6px, auto',
    };
  }
  return {
    background:
      isLight
        ? `linear-gradient(135deg, ${bg}, ${colorToCss(colorMix(parseHexColor(bg, [1, 1, 1]), parseHexColor(accent, [0.2, 0.5, 1]), 0.08))})`
        : `radial-gradient(circle at 35% 24%, ${accent}28, transparent 32%), radial-gradient(circle at 70% 70%, ${secondary}1f, transparent 28%), ${bg}`,
  };
}

function CssPreview({ variant, colors, theme, mode, quality, reducedMotion }: EffectPreviewProps & { variant: CssVariant }) {
  const t = useClock({ mode, reducedMotion });
  const accent = theme.accent;
  const secondary = theme.secondary;
  const bg = theme.background;
  const live = mode === 'live' && !reducedMotion;
  const drift = live ? Math.sin(t * 0.55) : Math.sin(3.4 * 0.55);
  const panel = theme.isLight ? 'rgba(255,255,255,.72)' : 'rgba(9,12,18,.58)';
  const line = theme.isLight ? 'rgba(15,23,42,.22)' : 'rgba(255,255,255,.16)';
  const muted = theme.isLight ? 'rgba(15,23,42,.16)' : 'rgba(255,255,255,.12)';
  const darkBg = theme.isLight ? colorToCss(colorMix(parseHexColor(bg, [1, 1, 1]), [0, 0, 0], 0.04)) : bg;

  if (quality === 'thumbnail' || quality === 'effect') {
    return <ThumbnailEffectOnlyPreview variant={variant} colors={colors} accent={accent} secondary={secondary} darkBg={darkBg} line={line} panel={panel} muted={muted} theme={theme} />;
  }

  if (variant === 'blue-cloudy') {
    return (
      <PreviewPanel style={cssBackground(variant, accent, secondary, darkBg, theme.isLight)}>
        <div className="absolute inset-0 opacity-70" style={{ background: 'radial-gradient(circle at 42% 46%, rgba(255,255,255,.30), transparent 18%), radial-gradient(circle at 70% 26%, rgba(255,255,255,.22), transparent 16%)', filter: 'blur(10px)' }} />
        <div className="absolute left-[4%] top-[6%] text-sm font-semibold uppercase tracking-wide text-white/88">Aetheria</div>
        <div className="absolute left-[4%] top-[27%] rounded-full border border-white/20 bg-white/16 px-3 py-2 text-[10px] text-white/84 backdrop-blur-md">Luminous Clarity Collection</div>
        <div className="absolute bottom-[27%] left-[4%] max-w-[38%] text-[14px] leading-relaxed text-white/78">Blended from ethereal botanicals and pristine extracts.</div>
        <div className="absolute bottom-[16%] left-[4%] h-10 w-36 rounded-full bg-white" />
        <div className="absolute right-[4%] top-[17%] h-[58%] w-[46%] rounded-[28px] border border-white/30 bg-white/22 backdrop-blur-sm" />
        <div className="absolute bottom-[11%] right-[30%] h-[19%] w-[20%] rounded-2xl border border-white/20 bg-white/18 backdrop-blur-md">
          <div className="absolute left-[10%] top-[18%] h-[42%] w-[80%] rounded-lg" style={{ background: `linear-gradient(135deg, ${accent}, #f4bdd1 55%, #8bd7ff)` }} />
        </div>
      </PreviewPanel>
    );
  }

  if (variant === 'perspective-dashboard') {
    return (
      <PreviewPanel style={{ background: 'radial-gradient(circle at 48% 52%, rgba(255,90,31,.16), transparent 28%), #090908', perspective: '1200px' }}>
        <GridLines color="rgba(255,255,255,.18)" opacity={0.08} size={44} />
        <div className="absolute left-[10%] top-[20%] text-[11px] uppercase tracking-[.36em] text-white/38">scroll system</div>
        <div className="absolute left-[9%] top-[29%] max-w-[48%] text-[52px] font-medium leading-[.88] text-white">
          Tilted<br />product<br />planes
        </div>
        <div className="absolute left-[46%] top-[12%] h-[70%] w-[44%] rounded-xl border p-3 shadow-2xl" style={{
          background: 'rgba(24,24,27,.62)',
          borderColor: rgba(accent, 0.45, [1, 0.35, 0.12]),
          boxShadow: `0 0 34px ${rgba(accent, 0.32, [1, 0.35, 0.12])}`,
          transform: `rotateX(${34 - drift * 4}deg) rotateY(${-14 + drift * 2}deg) rotateZ(${14 - drift * 1.5}deg) scale(.92)`,
          transformStyle: 'preserve-3d',
        }}>
          <div className="mb-3 h-3 w-1/3 rounded-full" style={{ background: accent }} />
          <div className="grid h-[calc(100%-1.5rem)] grid-cols-[.55fr_1fr] gap-2">
            <div className="rounded-lg border" style={{ background: 'rgba(255,255,255,.08)', borderColor: line }} />
            <div className="grid grid-cols-2 gap-2">
              {[0, 1, 2, 3].map(i => <div key={i} className="rounded-lg border" style={{ background: i === 0 ? rgba(accent, .28, [1, .35, .12]) : 'rgba(255,255,255,.07)', borderColor: line }} />)}
            </div>
          </div>
        </div>
        <div className="absolute left-[12%] top-[2%] h-32 w-32 rounded-full blur-3xl" style={{ background: rgba(accent, .22, [1, .35, .12]), mixBlendMode: 'screen' }} />
      </PreviewPanel>
    );
  }

  if (variant === 'technical-system') {
    return (
      <PreviewPanel style={{ background: 'radial-gradient(circle at 58% 42%, rgba(59,46,185,.62), transparent 28%), radial-gradient(circle at 66% 32%, rgba(0,240,255,.20), transparent 36%), rgba(3,3,5,.66)' }}>
        <GridLines color="rgba(255,255,255,.22)" opacity={0.06} size={16} />
        <CornerMarks color="rgba(255,255,255,.42)" inset={18} />
        <div className="absolute inset-y-0 right-0 w-[30%] border-l border-white/10 bg-black/15 backdrop-blur-sm">
          <div className="absolute left-7 top-10 space-y-3 text-[9px] uppercase tracking-[.24em] text-white/42">
            <div>data stream</div><div>quantum core</div><div>mesh state</div><div>main deck</div>
          </div>
        </div>
        <div className="absolute left-[8%] top-[18%] max-w-[56%] text-[50px] font-light leading-[.92] text-white">
          Engineering the<br />infrastructure<br />of tomorrow.
        </div>
        <div className="absolute bottom-[18%] left-[8%] flex overflow-hidden rounded-sm border border-white/20 text-[10px] font-semibold">
          <div className="bg-white px-3 py-2 text-black">Enter System</div>
          <div className="bg-black px-3 py-2 text-white">-&gt;</div>
        </div>
      </PreviewPanel>
    );
  }

  if (variant === 'webgl-field') {
    return (
      <PreviewPanel style={{ background: 'radial-gradient(circle at 50% 78%, rgba(48,255,148,.28), transparent 24%), rgba(2,4,3,.70)' }}>
        <div className="absolute left-1/2 top-[-10%] h-[125%] w-[2px] -translate-x-1/2 blur-[1px]" style={{ background: `linear-gradient(180deg, transparent, ${accent}, #eafff4, ${accent}, transparent)`, boxShadow: `0 0 36px ${accent}, 0 0 90px ${accent}` }} />
        <div className="absolute left-1/2 top-[4%] h-[92%] w-[18%] -translate-x-1/2 rounded-full blur-3xl" style={{ background: rgba(accent, .24, [.2, 1, .5]) }} />
        <GridLines color="rgba(88,255,170,.22)" opacity={0.08} size={34} />
        <div className="absolute left-[6%] top-[27%] max-w-[46%] text-[40px] font-normal leading-[.9] text-white">
          Based in<br />collaborating<br />with teams
        </div>
        <div className="absolute right-[18%] top-[28%] h-14 w-20 overflow-hidden rounded border border-white/20" style={{ background: `linear-gradient(135deg, ${rgba(accent, .35, [.2, 1, .5])}, rgba(255,255,255,.16))` }} />
        <div className="absolute right-[7%] top-[10%] text-[8px] uppercase tracking-[.28em]" style={{ color: accent }}>photo</div>
      </PreviewPanel>
    );
  }

  if (variant === 'aura-network-scene') {
    return (
      <PreviewPanel style={{ background: 'radial-gradient(circle at 50% 42%, rgba(255,255,255,.10), transparent 34%), rgba(5,5,5,.44)' }}>
        <div className="absolute left-[25%] top-[15%] w-[50%] text-center text-[44px] font-light uppercase leading-[.96] text-white/86">
          The Spatial<br />Data Hub
        </div>
        <div className="absolute left-[12%] top-[30%] rounded-full border border-white/10 bg-black/45 px-3 py-2 text-[10px] text-white/80 backdrop-blur-md">24.8 TB/s Node Sync</div>
        <div className="absolute right-[9%] top-[48%] rounded-xl border border-white/10 bg-black/45 px-3 py-3 text-[10px] text-white/74 backdrop-blur-md">
          <div className="uppercase tracking-[.22em] text-white/38">sector alpha</div>
          <div className="mt-1 text-white">Latency: 12ms</div>
        </div>
        <div className="absolute inset-x-[3%] bottom-[4%] h-[28%] rounded-3xl border border-white/10 bg-black/55 backdrop-blur-md">
          <div className="absolute left-8 top-7 text-lg text-white">Aether</div>
          <div className="absolute inset-x-8 bottom-7 grid grid-cols-5 gap-3">
            {[0, 1, 2, 3, 4].map(index => <div key={index} className="h-8 rounded border border-white/10 bg-white/[.035]" />)}
          </div>
        </div>
      </PreviewPanel>
    );
  }

  if (variant === 'aura-isometric-scene') {
    return (
      <PreviewPanel style={{ background: 'radial-gradient(circle at 72% 50%, rgba(0,229,255,.14), transparent 34%), rgba(5,5,7,.34)' }}>
        <GridLines color="rgba(0,229,255,.28)" opacity={0.05} size={28} />
        <CornerMarks color="rgba(255,255,255,.30)" inset={20} />
        <div className="absolute left-[4%] top-[18%] max-w-[42%] text-[46px] font-light leading-[.94] text-white">
          Map the<br />Architecture<br />of Your Data.
        </div>
        <div className="absolute bottom-[14%] left-[4%] grid w-[36%] gap-2">
          {['Stream Integration', 'Graph Syncing', 'Asset Telemetry'].map((label, index) => (
            <div key={label} className="rounded-lg border border-white/10 bg-white/[.055] px-3 py-2 text-[10px] text-white/76">
              <span className="mr-2 inline-block h-2 w-2 rounded-sm" style={{ background: index === 0 ? accent : 'rgba(255,255,255,.18)' }} />
              {label}
            </div>
          ))}
        </div>
        <div className="absolute right-[8%] top-[27%] rounded-lg border px-3 py-2 text-[10px] text-white/80" style={{ borderColor: rgba(accent, .35, [.2,.8,1]), background: 'rgba(0,0,0,.42)' }}>Core Temp<br /><span style={{ color: accent }}>34C</span></div>
      </PreviewPanel>
    );
  }

  if (variant === 'd3-globe-scene') {
    return (
      <PreviewPanel style={{ background: 'linear-gradient(90deg, rgba(5,7,7,.82) 0%, rgba(5,7,7,.68) 50%, rgba(59,8,12,.46) 100%)' }}>
        <div className="absolute inset-[3%] rounded-2xl border border-white/10" />
        <div className="absolute left-[7%] top-[21%] text-[10px] uppercase tracking-[.28em] text-white/45">global point-cloud / v5.1</div>
        <div className="absolute left-[7%] top-[31%] max-w-[35%] text-[44px] font-normal uppercase leading-[.9] text-white">
          Orchestrate<br />Datasets<br /><span style={{ color: accent }}>Seamlessly</span>
        </div>
        <div className="absolute bottom-[8%] left-[3%] right-[3%] grid h-[14%] grid-cols-5 divide-x divide-white/10 border-t border-white/10">
          {['142', '8.2T', '915', '99.9%', '800+'].map(value => <div key={value} className="flex items-center justify-center text-lg" style={{ color: accent }}>{value}</div>)}
        </div>
        <div className="absolute right-[16%] top-[23%] rounded border border-red-400/40 px-4 py-3 text-center text-[10px] text-red-300">Core Server<br /><span className="text-white/60">US-East Region</span></div>
        <div className="absolute bottom-[23%] right-[20%] text-[9px] uppercase tracking-[.3em] text-white/28">drag to rotate</div>
      </PreviewPanel>
    );
  }

  if (variant === 'agency-grid' || variant === 'editorial-tech' || variant === 'nested-agency') {
    return (
      <PreviewPanel style={{ background: theme.isLight ? '#f7f6f1' : darkBg }}>
        <GridLines color={line} opacity={0.22} size={58} />
        <div className="absolute left-[8%] top-[14%] w-[54%] text-[44px] font-semibold leading-[.86]" style={{ color: theme.isLight ? '#111827' : '#f8fafc' }}>
          INDEX<br />SYSTEM
        </div>
        <div className="absolute bottom-[18%] left-[8%] h-[24%] w-[34%] border" style={{ background: muted, borderColor: line }} />
        <div className="absolute right-[10%] top-[18%] space-y-2 text-[9px] uppercase tracking-[.22em]" style={{ color: accent }}>
          <div>01 / Method</div><div>02 / Proof</div><div>03 / Contact</div>
        </div>
      </PreviewPanel>
    );
  }

  if (variant === 'stepped-neon') {
    const bars = Array.from({ length: 23 }, (_, index) => index);
    return (
      <PreviewPanel style={{ background: '#030303' }}>
        <div className="absolute inset-x-[8%] bottom-0 flex h-[86%] items-end justify-center gap-1">
          {bars.map(index => {
            const distance = Math.abs(index - 11);
            const height = 18 + (11 - distance) * 6 + Math.sin(t * 1.4 + index * .55) * (live ? 9 : 4);
            return <div key={index} className="w-[3%] rounded-t-full blur-[.2px]" style={{ height: `${height}%`, opacity: .28 + (11 - distance) * .045, background: `linear-gradient(to top, #020617 0%, ${accent} 28%, #fff 48%, ${secondary} 68%, transparent 96%)` }} />;
          })}
        </div>
        <div className="absolute left-1/2 top-1/2 h-28 w-56 -translate-x-1/2 -translate-y-1/2 rounded-full border backdrop-blur-xl" style={{ background: 'rgba(24,24,27,.68)', borderColor: 'rgba(255,255,255,.13)', boxShadow: '0 0 42px rgba(255,255,255,.22)' }} />
      </PreviewPanel>
    );
  }

  if (variant === 'glass-clock') {
    const seconds = live ? t : 18;
    return (
      <PreviewPanel style={{ background: `radial-gradient(circle at 50% 34%, ${accent}26, transparent 30%), #050505` }}>
        <div className="absolute left-1/2 top-1/2 h-40 w-40 -translate-x-1/2 -translate-y-1/2 rounded-full border backdrop-blur-xl" style={{ background: 'rgba(255,255,255,.06)', borderColor: 'rgba(255,255,255,.18)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,.22), 0 24px 80px rgba(0,0,0,.55)' }}>
          {[0, 1, 2, 3].map(i => <div key={i} className="absolute left-1/2 top-2 h-3 w-px origin-[50%_72px]" style={{ background: 'rgba(255,255,255,.5)', transform: `translateX(-50%) rotate(${i * 90}deg)` }} />)}
          <div className="absolute left-1/2 top-1/2 h-[34%] w-px origin-bottom" style={{ background: '#fff', transform: `translate(-50%,-100%) rotate(${seconds * 6}deg)` }} />
          <div className="absolute left-1/2 top-1/2 h-[26%] w-0.5 origin-bottom" style={{ background: accent, transform: 'translate(-50%,-100%) rotate(126deg)' }} />
        </div>
      </PreviewPanel>
    );
  }

  if (variant === 'corner-lasers' || variant === 'corner-diagonals') {
    return (
      <PreviewPanel style={cssBackground(variant, accent, secondary, darkBg, theme.isLight)}>
        <CornerMarks color={accent} inset={16} />
        <div className="absolute left-0 top-0 h-px w-[42%] origin-left" style={{ background: `linear-gradient(90deg, ${accent}, transparent)`, transform: 'rotate(38deg)' }} />
        <div className="absolute bottom-0 right-0 h-px w-[42%] origin-right" style={{ background: `linear-gradient(270deg, ${secondary}, transparent)`, transform: 'rotate(38deg)' }} />
      </PreviewPanel>
    );
  }

  if (variant === 'marquee') {
    return (
      <PreviewPanel style={{ background: darkBg }}>
        <div className="absolute inset-x-0 top-[42%] border-y py-3" style={{ borderColor: line }}>
          <div className="whitespace-nowrap text-2xl font-semibold uppercase tracking-[.28em]" style={{ color: accent, animation: live ? 'effect-preview-marquee 9s linear infinite' : undefined }}>
            SIGNAL / BUILD / VERIFY / SHIP / SIGNAL / BUILD / VERIFY / SHIP /
          </div>
        </div>
      </PreviewPanel>
    );
  }

  if (variant === 'masked-reveal' || variant === 'book-serif') {
    return (
      <PreviewPanel style={{ background: theme.isLight ? '#fbfaf7' : darkBg }}>
        <div className="absolute left-[10%] top-[20%] overflow-hidden text-[44px] leading-[.88]" style={{ color: theme.isLight ? '#151515' : '#f8fafc', fontFamily: variant === 'book-serif' ? 'Georgia, serif' : undefined }}>
          <div style={{ animation: live ? 'effect-preview-mask 1.8s cubic-bezier(.2,.9,.2,1) infinite alternate' : undefined }}>Measured</div>
          <div style={{ animation: live ? 'effect-preview-mask 1.8s .18s cubic-bezier(.2,.9,.2,1) infinite alternate' : undefined }}>Reveals</div>
        </div>
        <div className="absolute bottom-[20%] left-[10%] h-px w-[42%]" style={{ background: accent }} />
      </PreviewPanel>
    );
  }

  if (variant === 'beautiful-shadows' || variant === 'skeuomorphic' || variant === 'high-contrast-skeuo') {
    const skeuo = variant !== 'beautiful-shadows';
    return (
      <PreviewPanel style={{ background: theme.isLight ? '#f4f5f7' : '#09090b' }}>
        <div className="absolute left-[18%] top-[18%] h-[56%] w-[64%] rounded-2xl border p-4" style={{
          background: skeuo ? `linear-gradient(180deg, ${rgba(accent, .18, [.2, .6, 1])}, ${panel})` : panel,
          borderColor: skeuo ? 'rgba(255,255,255,.38)' : line,
          boxShadow: skeuo
            ? 'inset 0 2px 4px rgba(255,255,255,.35), inset 0 -10px 24px rgba(0,0,0,.18), 0 30px 65px rgba(0,0,0,.22)'
            : '0px 0px 0px 1px rgba(0,0,0,.06), 0px 12px 24px -6px rgba(0,0,0,.18), 0px 32px 70px -28px rgba(0,0,0,.45)',
        }}>
          <div className="h-4 w-1/2 rounded-full" style={{ background: accent, boxShadow: skeuo ? 'inset 0 1px 1px rgba(255,255,255,.65)' : undefined }} />
          <div className="mt-5 grid grid-cols-3 gap-3">
            {[0, 1, 2].map(i => <div key={i} className="h-14 rounded-xl" style={{ background: muted, boxShadow: 'inset 0 1px 0 rgba(255,255,255,.25)' }} />)}
          </div>
        </div>
      </PreviewPanel>
    );
  }

  if (variant === 'border-gradients' || variant === 'premium-gradient-border' || variant === 'interactive-border') {
    return (
      <PreviewPanel style={cssBackground(variant, accent, secondary, darkBg, theme.isLight)}>
        <div className="absolute left-[17%] top-[18%] h-[58%] w-[66%] rounded-xl p-px" style={{ background: `linear-gradient(135deg, ${accent}, transparent 34%, ${secondary})`, boxShadow: variant === 'interactive-border' ? `0 0 46px ${rgba(accent, .36, [.2, .6, 1])}` : undefined }}>
          <div className="h-full w-full rounded-xl" style={{ background: panel }} />
        </div>
      </PreviewPanel>
    );
  }

  if (variant === 'container-lines' || variant === 'framed-grid' || variant === 'technical-framed' || variant === 'split-technical' || variant === 'wireframe-info') {
    return (
      <PreviewPanel style={{ background: theme.isLight ? '#f8fafc' : '#050507' }}>
        <GridLines color={line} opacity={variant === 'technical-framed' ? .22 : .14} size={variant === 'technical-framed' ? 24 : 48} />
        <CornerMarks color={accent} inset={22} />
        {variant === 'split-technical' && <div className="absolute bottom-0 left-1/2 top-0 w-px" style={{ background: line }} />}
        {variant === 'wireframe-info' && (
          <svg className="absolute inset-0 h-full w-full" viewBox="0 0 400 240">
            <g fill="none" stroke={theme.isLight ? '#111827' : '#d4d4d8'} strokeOpacity=".5">
              <path d="M164 72l72 28v72l-72-28z" />
              <path d="M236 100l48-25v72l-48 25z" />
              <path d="M164 72l48-25 72 28-48 25z" />
              <path d="M142 166h-54M270 74h56M236 184h82" strokeDasharray="4 6" />
            </g>
            <g fill={accent}><circle cx="88" cy="166" r="2" /><circle cx="326" cy="74" r="2" /><circle cx="318" cy="184" r="2" /></g>
          </svg>
        )}
      </PreviewPanel>
    );
  }

  if (variant === 'progressive-blur') {
    return (
      <PreviewPanel style={cssBackground(variant, accent, secondary, darkBg, theme.isLight)}>
        <div className="absolute inset-x-0 top-0 h-1/2 backdrop-blur-[2px]" style={{ maskImage: 'linear-gradient(#000, transparent)', WebkitMaskImage: 'linear-gradient(#000, transparent)' }} />
        <div className="absolute inset-x-0 bottom-0 h-1/2 backdrop-blur-md" style={{ maskImage: 'linear-gradient(transparent, #000)', WebkitMaskImage: 'linear-gradient(transparent, #000)' }} />
      </PreviewPanel>
    );
  }

  if (variant === 'company-logos' || variant === 'solar-duotone' || variant === 'number-details') {
    return (
      <PreviewPanel style={{ background: theme.isLight ? '#f8fafc' : darkBg }}>
        <div className="absolute inset-x-[12%] top-[26%] grid grid-cols-4 gap-3">
          {[0, 1, 2, 3].map(i => <div key={i} className="flex h-14 items-center justify-center rounded-xl border text-xl font-bold" style={{ color: i === 0 ? accent : secondary, background: panel, borderColor: line }}>{variant === 'number-details' ? `0${i + 1}` : variant === 'solar-duotone' ? '◐' : 'LOGO'}</div>)}
        </div>
      </PreviewPanel>
    );
  }

  if (variant === 'asset-images' || variant === 'image-first-grid') {
    return (
      <PreviewPanel style={{ background: theme.isLight ? '#f7f7f4' : darkBg }}>
        <div className="absolute inset-0 grid grid-cols-4 gap-2 p-5">
          {[0, 1, 2, 3, 4, 5, 6, 7].map(i => <div key={i} className={`${i === 0 || i === 5 ? 'col-span-2 row-span-2' : ''} rounded-lg border`} style={{ background: `linear-gradient(135deg, ${rgba(colors[i % colors.length], .4, [.3,.5,.9])}, ${rgba(colors[(i + 1) % colors.length], .12, [.8,.8,.8])})`, borderColor: line }} />)}
        </div>
      </PreviewPanel>
    );
  }

  if (variant === 'magic-rings') {
    return (
      <PreviewPanel style={{ background: darkBg }}>
        {[0, 1, 2, 3].map(i => <div key={i} className="absolute left-1/2 top-1/2 rounded-full border" style={{ width: 70 + i * 48, height: 70 + i * 48, marginLeft: -(70 + i * 48) / 2, marginTop: -(70 + i * 48) / 2, borderColor: i % 2 ? rgba(secondary, .28, [.5,.7,1]) : rgba(accent, .44, [.2,.8,1]), transform: `rotate(${t * (i + 1) * 8}deg)`, animation: live ? 'effect-preview-breathe 4s ease-in-out infinite' : undefined }} />)}
        <GridLines color={line} opacity={.1} size={34} />
      </PreviewPanel>
    );
  }

  return (
    <PreviewPanel style={cssBackground(variant, accent, secondary, darkBg, theme.isLight)}>
      <PreviewStyle />
      <GridLines color={line} opacity={0.12} size={42} />
      <div className="absolute left-[16%] top-[20%] h-[46%] w-[68%] rounded-2xl border" style={{ background: panel, borderColor: line }} />
      <div className="absolute left-[22%] top-[28%] h-3 w-32 rounded-full" style={{ background: accent }} />
      <div className="absolute left-[22%] top-[40%] h-20 w-[42%] rounded-xl" style={{ background: muted }} />
    </PreviewPanel>
  );
}

export function createCssPreview(variant: CssVariant) {
  function CssPreviewComponent(props: EffectPreviewProps) {
    return (
      <>
        <PreviewStyle />
        <CssPreview {...props} variant={variant} />
      </>
    );
  }
  return CssPreviewComponent;
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
  void main() { gl_Position = vec4(aPosition, 0.0, 1.0); }
`;

const SHADER_FRAGMENT = `
  precision highp float;
  uniform vec2 iResolution;
  uniform float iTime;
  uniform float uVariant;
  uniform float uIsLight;
  uniform vec3 uBgColor;
  uniform vec3 uAccentColor;
  uniform vec3 uSecondaryColor;

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
      p = p * 2.05 + 17.2;
      amplitude *= 0.52;
    }
    return value;
  }

  float line(float value, float width) {
    return 1.0 - smoothstep(0.0, width, abs(fract(value) - 0.5));
  }

  mat2 rotate2d(float a) {
    float s = sin(a);
    float c = cos(a);
    return mat2(c, -s, s, c);
  }

  void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;
    vec2 st = gl_FragCoord.xy / iResolution.xy;
    float t = iTime;
    vec3 bg = mix(uBgColor, vec3(0.03, 0.035, 0.045), 1.0 - uIsLight);
    vec3 accent = max(uAccentColor, vec3(0.04));
    vec3 secondary = max(uSecondaryColor, vec3(0.04));
    vec3 color = bg;
    float v = uVariant;

    if (v < 0.5) {
      vec2 p = rotate2d(t * 0.08) * uv;
      float grain = hash(gl_FragCoord.xy + floor(t * 8.0));
      float organic = fbm(p * 3.1 + t * 0.08);
      float oct = pow(max(0.0, 0.72 - (abs(p.x * 1.45) + abs(p.y * .82))), 2.4);
      color = mix(vec3(0.03,0.022,0.016), mix(accent, vec3(0.36,0.22,0.13), .55), organic * .42 + oct);
      color += (grain - .5) * .075;
    } else if (v < 1.5) {
      float cloud = fbm(uv * 2.2 + vec2(sin(t * .17), t * .08));
      float core = smoothstep(.72, .18, length(uv - vec2(.0, -.22)));
      color = mix(bg, accent * 1.15, cloud * core);
      color += secondary * pow(core, 3.0) * .38;
    } else if (v < 2.5) {
      float n = fbm(uv * 3.0 + t * .05);
      float ridges = pow(abs(sin((n + uv.y * .15) * 24.0)), 8.0);
      color = bg + accent * ridges * .62 + secondary * n * .16;
    } else if (v < 3.5) {
      vec2 p = uv;
      float perspective = 1.0 / max(.12, p.y + .78);
      float gx = line((p.x * perspective + t * .04) * 8.0, .045);
      float gy = line(perspective * 4.5 - t * .18, .035);
      float fade = smoothstep(-.62, .28, p.y) * (1.0 - smoothstep(.32, .8, p.y));
      color = bg + accent * (gx + gy) * fade * .38 + vec3(hash(gl_FragCoord.xy)) * .025;
    } else if (v < 4.5) {
      float n = fbm(uv * 4.0 + t * .12);
      float wave = sin((uv.x + n * .18) * 18.0 + t);
      color = bg + vec3(accent.r * max(wave,0.0), secondary.g * max(-wave,0.0), accent.b) * .38;
      color += vec3(.55, .1, .9) * pow(n, 4.0) * .4;
    } else if (v < 5.5) {
      float n = fbm(uv * 2.8 + vec2(t * .09, -t * .04));
      float pulse = smoothstep(.55, .82, n);
      float beam = pow(max(0.0, 1.0 - abs(uv.x + sin(uv.y * 4.0 + t) * .05) * 7.0), 5.0);
      color = bg + accent * pulse * .46 + secondary * beam * .7;
    } else if (v < 6.5) {
      float trail = 0.0;
      for (int i = 0; i < 6; i++) {
        float fi = float(i);
        vec2 c = vec2(sin(t * .25 + fi) * .38, fract(t * .12 + fi * .17) * 1.7 - .85);
        trail += exp(-length((uv - c) * vec2(2.5, .55)) * 8.0);
      }
      color = bg + accent * trail * .55 + secondary * fbm(uv * 5.0) * .13;
    } else if (v < 7.5) {
      float columns = step(.62, fbm(vec2(floor((uv.x + .8) * 18.0), uv.y * 3.0 + t * .1)));
      float edges = line((uv.x + .8) * 18.0, .08);
      color = bg + accent * columns * .24 + vec3(.9) * edges * .12;
    } else if (v < 8.5) {
      vec2 p = rotate2d(.72) * uv;
      float iso = line((p.x + p.y) * 5.0 + t * .05, .035) + line((p.x - p.y) * 5.0 - t * .05, .035);
      float core = smoothstep(.42, .05, length(uv));
      color = bg + accent * iso * .25 + secondary * core * .55;
    } else if (v < 9.5) {
      float r = length(uv);
      float organic = fbm(uv * 2.1 + vec2(sin(t*.2), cos(t*.17))) * .24;
      float body = smoothstep(.46 + organic, .26, r);
      float fresnel = smoothstep(.21, .49, r) * body;
      color = bg + mix(accent, secondary, st.x) * fresnel * 1.25 + accent * body * .18;
    } else if (v < 10.5) {
      float n = fbm(uv * 2.4 + t * .06);
      float mesh = line((uv.x + n * .18) * 9.0, .04) + line((uv.y - n * .14) * 7.0, .04);
      color = mix(vec3(.015,.025,.07), bg, uIsLight * .4) + accent * n * .32 + secondary * mesh * .22;
    } else if (v < 11.5) {
      float n = fbm(uv * 2.6 + t * .08);
      float rings = line(length(uv) * 8.0 - t * .2, .035);
      float grid = line(st.x * 30.0, .028) + line(st.y * 30.0, .028);
      color = vec3(.01,.015,.05) + accent * n * .35 + secondary * rings * .35 + vec3(.8) * grid * .055;
    } else if (v < 12.5) {
      vec2 barrel = uv * (1.0 + dot(uv, uv) * .2);
      float dots = step(.78, hash(floor((barrel + 1.0) * 80.0)));
      float scan = sin((st.y + t * .3) * 520.0) * .5 + .5;
      color = bg + accent * dots * .22 + vec3(1.0) * scan * .035;
    } else {
      float n = fbm(uv * 2.1 + vec2(t * .08, -t * .04));
      float neb = pow(n, 2.2);
      float beam = pow(max(0.0, 1.0 - abs(uv.x + uv.y * .45 + sin(t*.25)*.18) * 4.2), 4.0);
      float grid = line((uv.x + uv.y) * 12.0, .025);
      color = vec3(.006,.008,.028) + accent * neb * .42 + secondary * beam * .36 + vec3(1.0) * grid * .035;
    }

    float vignette = smoothstep(1.05, .18, length(uv));
    color = mix(bg * .65, color, vignette);
    if (uIsLight > .5) color = mix(vec3(.96), color, .62);
    gl_FragColor = vec4(color, .96);
  }
`;

function ShaderThumbnailPreview({
  variant,
  theme,
}: Pick<EffectPreviewProps, 'theme'> & { variant: ShaderVariant }) {
  const accent = theme.accent;
  const secondary = theme.secondary;
  const bg = theme.isLight ? colorToCss(colorMix(parseHexColor(theme.background, [1, 1, 1]), [0, 0, 0], .04)) : theme.background;
  const dotGrid = {
    backgroundImage: `radial-gradient(circle, ${rgba(accent, .44, [.2, .8, 1])} 1px, transparent 1.4px)`,
    backgroundSize: '8px 8px',
  } satisfies CSSProperties;

  if (variant === 'grain') {
    return (
      <PreviewPanel style={{ background: `radial-gradient(circle at 52% 46%, ${rgba(accent, .28, [.2, .8, 1])}, transparent 32%), ${bg}` }}>
        <div className="absolute inset-0 opacity-50" style={{ ...dotGrid, backgroundSize: '5px 5px' }} />
      </PreviewPanel>
    );
  }

  if (variant === 'procedural' || variant === 'fluid-nebula' || variant === 'organic') {
    return (
      <PreviewPanel style={{ background: `linear-gradient(135deg, ${bg}, #020504)` }}>
        <div className="absolute left-[6%] top-[12%] h-[64%] w-[52%] rounded-full blur-2xl" style={{ background: rgba(accent, variant === 'organic' ? .44 : .30, [.2, .8, 1]) }} />
        <div className="absolute right-[10%] top-[20%] h-[46%] w-[34%] rounded-full blur-xl" style={{ background: rgba(secondary, .22, [.6, .7, 1]) }} />
      </PreviewPanel>
    );
  }

  if (variant === 'topographic') {
    return (
      <PreviewPanel style={{ background: bg }}>
        {[0, 1, 2, 3, 4].map(index => (
          <div
            key={index}
            className="absolute left-1/2 top-1/2 rounded-full border"
            style={{
              width: 54 + index * 34,
              height: 34 + index * 24,
              marginLeft: -(54 + index * 34) / 2,
              marginTop: -(34 + index * 24) / 2,
              borderColor: rgba(index % 2 ? secondary : accent, .22 + index * .04, [.2, .8, 1]),
            }}
          />
        ))}
      </PreviewPanel>
    );
  }

  if (variant === 'grid' || variant === 'terminal-grid' || variant === 'industrial' || variant === 'technical-shader') {
    return (
      <PreviewPanel style={{ background: `radial-gradient(circle at 55% 48%, ${rgba(accent, .16, [.2, .8, 1])}, transparent 32%), #050608` }}>
        <GridLines color={rgba(accent, variant === 'terminal-grid' ? .26 : .18, [.2, .8, 1])} opacity={variant === 'technical-shader' ? .22 : .14} size={variant === 'terminal-grid' ? 16 : 22} />
        {variant === 'terminal-grid' && <div className="absolute inset-0 opacity-40" style={dotGrid} />}
        {variant === 'industrial' && <div className="absolute left-[-10%] top-[58%] h-[54%] w-[120%] border-t" style={{ borderColor: rgba(accent, .24, [.2, .8, 1]), transform: 'skewY(-10deg)' }} />}
        {variant === 'technical-shader' && <CornerMarks color={rgba(secondary, .36, [.6, .7, 1])} inset={10} />}
      </PreviewPanel>
    );
  }

  if (variant === 'chromatic') {
    return (
      <PreviewPanel style={{ background: '#06070a' }}>
        <div className="absolute left-[28%] top-[22%] h-[50%] w-[42%] rounded-full blur-xl" style={{ background: rgba(accent, .34, [.2, .8, 1]) }} />
        <div className="absolute left-[42%] top-[26%] h-[46%] w-[36%] rounded-full blur-xl" style={{ background: rgba('#ef4444', .24, [1, .1, .1]) }} />
        <div className="absolute left-[36%] top-[20%] h-[48%] w-[38%] rounded-full blur-lg" style={{ background: rgba('#22d3ee', .20, [.1, .8, 1]) }} />
      </PreviewPanel>
    );
  }

  if (variant === 'cyber-field' || variant === 'cyber-trail' || variant === 'mesh-network' || variant === 'isometric-spatial') {
    return (
      <PreviewPanel style={{ background: `radial-gradient(circle at 52% 45%, ${rgba(accent, .20, [.2, .8, 1])}, transparent 34%), ${bg}` }}>
        <GridLines color={rgba(accent, .20, [.2, .8, 1])} opacity={.12} size={18} />
        <div className="absolute inset-0 opacity-50" style={dotGrid} />
        {variant === 'cyber-trail' && [0, 1, 2].map(index => (
          <div key={index} className="absolute h-px w-[72%] origin-left" style={{ left: `${4 + index * 8}%`, top: `${34 + index * 16}%`, background: `linear-gradient(90deg, transparent, ${accent}, transparent)`, transform: `rotate(${-10 - index * 4}deg)`, boxShadow: `0 0 18px ${rgba(accent, .28, [.2, .8, 1])}` }} />
        ))}
        {variant === 'isometric-spatial' && <div className="absolute left-[42%] top-[22%] h-[38%] w-[34%] rotate-[-24deg] border" style={{ borderColor: accent, background: rgba(accent, .14, [.2, .8, 1]) }} />}
      </PreviewPanel>
    );
  }

  return (
    <PreviewPanel style={{ background: `radial-gradient(circle at 50% 50%, ${rgba(accent, .28, [.2, .8, 1])}, transparent 34%), ${bg}` }}>
      <GridLines color={rgba(accent, .18, [.2, .8, 1])} opacity={.12} size={20} />
    </PreviewPanel>
  );
}

function ShaderLivePreview({ variant, theme, mode, quality, reducedMotion }: EffectPreviewProps & { variant: ShaderVariant }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [failed, setFailed] = useState(false);
  const accent = useMemo(() => parseHexColor(theme.accent, [0.13, 0.77, 0.37]), [theme.accent]);
  const secondary = useMemo(() => parseHexColor(theme.secondary, [0.45, 0.6, 0.8]), [theme.secondary]);
  const background = useMemo(() => parseHexColor(theme.background, theme.isLight ? [0.96, 0.97, 0.98] : [0.012, 0.012, 0.016]), [theme.background, theme.isLight]);
  const live = mode === 'live' && !reducedMotion;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext('webgl', { alpha: true, antialias: false, powerPreference: 'low-power', premultipliedAlpha: false });
    if (!gl) {
      setFailed(true);
      return;
    }
    const program = createProgram(gl, VERTEX_SHADER, SHADER_FRAGMENT);
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
    const variantLocation = gl.getUniformLocation(program, 'uVariant');
    const isLightLocation = gl.getUniformLocation(program, 'uIsLight');
    const bgLocation = gl.getUniformLocation(program, 'uBgColor');
    const accentLocation = gl.getUniformLocation(program, 'uAccentColor');
    const secondaryLocation = gl.getUniformLocation(program, 'uSecondaryColor');
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
      gl.uniform1f(timeLocation, live ? now * 0.001 : 4.1);
      gl.uniform1f(variantLocation, SHADER_VARIANT_INDEX[variant]);
      gl.uniform1f(isLightLocation, theme.isLight ? 1 : 0);
      gl.uniform3fv(bgLocation, background);
      gl.uniform3fv(accentLocation, accent);
      gl.uniform3fv(secondaryLocation, secondary);
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

    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      gl.deleteBuffer(positionBuffer);
      gl.deleteProgram(program);
    };
  }, [accent, background, live, quality, secondary, theme.isLight, variant]);

  if (failed) {
    return <CssPreview variant="mesh-gradient" colors={[theme.background, theme.accent, theme.secondary]} theme={theme} mode={mode} quality={quality} reducedMotion={reducedMotion} seed={variant} />;
  }

  return <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden="true" />;
}

function ShaderPreview(props: EffectPreviewProps & { variant: ShaderVariant }) {
  if (props.quality === 'thumbnail') {
    return <ShaderThumbnailPreview variant={props.variant} theme={props.theme} />;
  }
  return <ShaderLivePreview {...props} />;
}

export function createShaderPreview(variant: ShaderVariant) {
  function ShaderPreviewComponent(props: EffectPreviewProps) {
    return <ShaderPreview {...props} variant={variant} />;
  }
  return ShaderPreviewComponent;
}

function CanvasPreview({ variant, theme, mode, quality, reducedMotion }: EffectPreviewProps & { variant: CanvasVariant }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const accentCss = theme.accent;
  const secondaryCss = theme.secondary;
  const bgCss = theme.isLight ? colorToCss(colorMix(parseHexColor(theme.background, [1, 1, 1]), [1, 1, 1], .05)) : theme.background;
  const live = mode === 'live' && !reducedMotion;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let frame = 0;
    const dprLimit = quality === 'thumbnail' ? 1 : 1.5;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, dprLimit);
      const width = Math.max(1, Math.floor(rect.width * dpr));
      const height = Math.max(1, Math.floor(rect.height * dpr));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return { width: rect.width, height: rect.height };
    };

    const projectGlobePoint = (
      lon: number,
      lat: number,
      rotation: number,
      cx: number,
      cy: number,
      r: number,
    ): { x: number; y: number; z: number } => {
      const rotatedLon = lon + rotation;
      const cosLat = Math.cos(lat);
      const x = cosLat * Math.sin(rotatedLon);
      const y = Math.sin(lat);
      const z = cosLat * Math.cos(rotatedLon);
      return { x: cx + x * r, y: cy - y * r, z };
    };

    const landMask = (lon: number, lat: number): number => {
      const centers = [
        [-1.95, 0.55, 0.42, 0.34],
        [-1.55, -0.32, 0.34, 0.36],
        [-0.18, 0.68, 0.32, 0.22],
        [0.25, 0.05, 0.34, 0.46],
        [1.12, 0.48, 0.68, 0.36],
        [1.72, -0.42, 0.26, 0.18],
        [2.38, -0.34, 0.22, 0.16],
      ];
      let value = 0;
      for (const [clon, clat, sx, sy] of centers) {
        const dLon = Math.atan2(Math.sin(lon - clon), Math.cos(lon - clon));
        const dLat = lat - clat;
        value = Math.max(value, Math.exp(-((dLon / sx) ** 2 + (dLat / sy) ** 2)));
      }
      return value + Math.sin(lon * 5.4 + lat * 2.1) * 0.08 + Math.sin(lon * 2.6 - lat * 6.2) * 0.06;
    };

    const drawGraticule = (width: number, height: number, time: number, align: 'center' | 'right', accentAlpha = .22) => {
      const cx = width * (align === 'right' ? .73 : .52);
      const cy = height * .48;
      const r = Math.min(width, height) * (align === 'right' ? .31 : .34);
      const rotation = time * .18;
      ctx.save();
      ctx.strokeStyle = rgba(accentCss, accentAlpha, [.2, .8, 1]);
      ctx.lineWidth = .7;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();

      for (const lat of [-0.78, -0.39, 0, 0.39, 0.78]) {
        ctx.beginPath();
        let started = false;
        for (let i = 0; i <= 120; i++) {
          const lon = -Math.PI + (i / 120) * Math.PI * 2;
          const p = projectGlobePoint(lon, lat, rotation, cx, cy, r);
          if (p.z < -0.05) {
            started = false;
            continue;
          }
          if (!started) {
            ctx.moveTo(p.x, p.y);
            started = true;
          } else {
            ctx.lineTo(p.x, p.y);
          }
        }
        ctx.stroke();
      }

      for (let meridian = 0; meridian < 6; meridian++) {
        const lon = -Math.PI + meridian * (Math.PI / 3);
        ctx.beginPath();
        let started = false;
        for (let i = 0; i <= 80; i++) {
          const lat = -Math.PI / 2 + (i / 80) * Math.PI;
          const p = projectGlobePoint(lon, lat, rotation, cx, cy, r);
          if (p.z < -0.05) {
            started = false;
            continue;
          }
          if (!started) {
            ctx.moveTo(p.x, p.y);
            started = true;
          } else {
            ctx.lineTo(p.x, p.y);
          }
        }
        ctx.stroke();
      }
      ctx.restore();
      return { cx, cy, r, rotation };
    };

    const drawPointCloudGlobe = (width: number, height: number, time: number, align: 'center' | 'right' = 'right') => {
      const { r, rotation } = drawGraticule(width, height, time, align, .16);
      const cx = width * (align === 'right' ? .73 : .52);
      const cy = height * .48;
      ctx.save();
      for (let i = 0; i < 900; i++) {
        const lon = -Math.PI + seeded(i) * Math.PI * 2;
        const lat = Math.asin(seeded(i + 317) * 2 - 1);
        const mask = landMask(lon, lat);
        if (mask < 0.62) continue;
        const p = projectGlobePoint(lon, lat, rotation, cx, cy, r);
        if (p.z < 0.02) continue;
        const alpha = (.22 + p.z * .5) * Math.min(1, (mask - 0.54) * 2.6);
        ctx.fillStyle = i % 13 === 0 ? rgba(secondaryCss, alpha * .75, [.6, .8, 1]) : rgba(accentCss, alpha, [.2, .8, 1]);
        ctx.beginPath();
        ctx.arc(p.x, p.y, quality === 'thumbnail' ? 1 : 1.15 + seeded(i + 51) * 1.1, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.strokeStyle = rgba(secondaryCss, .18, [.6, .8, 1]);
      ctx.lineWidth = .8;
      for (let i = 0; i < 8; i++) {
        const startLon = -Math.PI + seeded(i + 500) * Math.PI * 2;
        const startLat = -0.65 + seeded(i + 540) * 1.3;
        const endLon = startLon + (seeded(i + 570) - .5) * 1.3;
        const endLat = startLat + (seeded(i + 600) - .5) * .7;
        const start = projectGlobePoint(startLon, startLat, rotation, cx, cy, r);
        const end = projectGlobePoint(endLon, endLat, rotation, cx, cy, r);
        if (start.z < .08 || end.z < .08) continue;
        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.quadraticCurveTo((start.x + end.x) / 2, (start.y + end.y) / 2 - r * .16, end.x, end.y);
        ctx.stroke();
      }
      ctx.restore();
    };

    const drawParticleGlobe = (width: number, height: number, time: number) => {
      const cx = width * .52;
      const cy = height * .48;
      const r = Math.min(width, height) * .34;
      const rotation = time * .14;
      ctx.save();
      const halo = ctx.createRadialGradient(cx, cy, r * .08, cx, cy, r * 1.35);
      halo.addColorStop(0, rgba(accentCss, .24, [.2, .8, 1]));
      halo.addColorStop(.55, rgba(accentCss, .08, [.2, .8, 1]));
      halo.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = halo;
      ctx.fillRect(cx - r * 1.5, cy - r * 1.5, r * 3, r * 3);
      ctx.strokeStyle = rgba(secondaryCss, .22, [.6, .8, 1]);
      ctx.lineWidth = .8;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
      for (let i = 0; i < 360; i++) {
        const lon = i * 2.39996323;
        const lat = Math.asin(seeded(i + 130) * 2 - 1);
        const p = projectGlobePoint(lon, lat, rotation, cx, cy, r);
        if (p.z < -0.12) continue;
        const alpha = .16 + Math.max(0, p.z) * .56;
        ctx.fillStyle = i % 9 === 0 ? rgba(secondaryCss, alpha * .8, [.6, .8, 1]) : rgba(accentCss, alpha, [.2, .8, 1]);
        ctx.beginPath();
        ctx.arc(p.x, p.y, .75 + seeded(i + 44) * 1.35, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.strokeStyle = rgba(accentCss, .18, [.2, .8, 1]);
      ctx.beginPath();
      ctx.ellipse(cx, cy + r * .08, r * 1.18, r * .16, -0.1, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    };

    const drawGlobe = (width: number, height: number, time: number, tactical = false, align: 'center' | 'right' = 'center') => {
      const cx = width * (align === 'right' ? .73 : .52);
      const cy = height * .48;
      const r = Math.min(width, height) * (align === 'right' ? .31 : tactical ? .29 : .34);
      ctx.save();
      ctx.strokeStyle = tactical ? 'rgba(255,255,255,.16)' : rgba(accentCss, .45, [.2,.8,1]);
      ctx.lineWidth = tactical ? 1 : .8;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
      for (let i = -3; i <= 3; i++) {
        ctx.beginPath();
        ctx.ellipse(cx, cy, r * Math.cos(i * .18), r * .28, time * .1 + i * .45, 0, Math.PI * 2);
        ctx.stroke();
      }
      for (let i = 0; i < 80; i++) {
        const a = i * 2.399 + time * .15;
        const z = 1 - (i / 80) * 2;
        const rr = Math.sqrt(1 - z * z);
        const x = cx + Math.cos(a) * rr * r;
        const y = cy + z * r * .84;
        const alpha = tactical ? .2 + (z + 1) * .12 : .08 + (z + 1) * .2;
        ctx.fillStyle = tactical ? `rgba(255,0,0,${alpha})` : rgba(accentCss, alpha, [.2,.8,1]);
        ctx.beginPath();
        ctx.arc(x, y, tactical ? 1.4 : 1.2 + seeded(i) * 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    };

    const draw = (now: number) => {
      const { width, height } = resize();
      const time = live ? now * 0.001 : 4.2;
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = bgCss;
      ctx.fillRect(0, 0, width, height);

      const glow = ctx.createRadialGradient(width * .5, height * .45, 0, width * .5, height * .45, Math.max(width, height) * .55);
      glow.addColorStop(0, rgba(accentCss, variant === 'gooey-blob' ? .32 : .18, [.2,.8,1]));
      glow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, width, height);

      if (variant === 'ambient-particles') {
        for (let i = 0; i < 90; i++) {
          const x = (seeded(i) * width + Math.sin(time * .2 + i) * 18) % width;
          const y = (seeded(i + 100) * height + Math.cos(time * .16 + i) * 14) % height;
          ctx.fillStyle = i % 7 === 0 ? rgba(accentCss, .38, [.2,.8,1]) : 'rgba(255,255,255,.18)';
          ctx.beginPath();
          ctx.arc(x, y, .6 + seeded(i + 40) * 1.4, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.strokeStyle = rgba(accentCss, .12, [.2,.8,1]);
        ctx.lineWidth = 1;
        for (let i = 0; i < 4; i++) {
          ctx.beginPath();
          ctx.moveTo(-40, height * (.25 + i * .12));
          ctx.lineTo(width * (.7 + i * .12), height * (.05 + i * .14));
          ctx.stroke();
        }
      } else if (variant === 'aura-network') {
        drawGlobe(width, height, time);
        ctx.strokeStyle = rgba(accentCss, .13, [.2,.8,1]);
        for (let i = 0; i < 42; i++) {
          const a = seeded(i) * Math.PI * 2 + time * .08;
          const b = seeded(i + 9) * Math.PI * 2 - time * .04;
          const r = Math.min(width, height) * (.18 + seeded(i + 3) * .18);
          ctx.beginPath();
          ctx.moveTo(width*.52 + Math.cos(a)*r, height*.48 + Math.sin(a)*r*.75);
          ctx.lineTo(width*.52 + Math.cos(b)*r, height*.48 + Math.sin(b)*r*.75);
          ctx.stroke();
        }
      } else if (variant === 'd3-globe') {
        drawPointCloudGlobe(width, height, time, 'right');
      } else if (variant === 'globe-particles') {
        drawParticleGlobe(width, height, time);
      } else if (variant === 'tactical-globe') {
        drawGlobe(width, height, time, true, 'center');
      } else if (variant === 'ascii-field') {
        ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
        const chars = '01AZ#/<>[]{}';
        for (let i = 0; i < 80; i++) {
          const x = seeded(i) * width;
          const y = (seeded(i + 20) * height - time * (18 + seeded(i + 70) * 40)) % height;
          ctx.fillStyle = i % 6 === 0 ? rgba(accentCss, .7, [.4,.6,1]) : 'rgba(156,163,175,.38)';
          ctx.fillText(chars[Math.floor(seeded(i + 9) * chars.length)], x, y < 0 ? y + height : y);
        }
        for (let i = 0; i < 12; i++) {
          const x = seeded(i + 200) * width;
          const y = (height + seeded(i + 260) * height - time * (80 + seeded(i) * 120)) % height;
          const grad = ctx.createLinearGradient(x, y + 42, x, y - 20);
          grad.addColorStop(0, 'rgba(0,0,0,0)');
          grad.addColorStop(1, rgba(accentCss, .75, [.4,.6,1]));
          ctx.strokeStyle = grad;
          ctx.beginPath();
          ctx.moveTo(x, y + 42);
          ctx.lineTo(x, y - 20);
          ctx.stroke();
        }
      } else if (variant === 'kinetic-radial') {
        ctx.translate(width / 2, height / 2);
        for (let i = 0; i < 34; i++) {
          const a = i / 34 * Math.PI * 2 + time * .25;
          const inner = Math.min(width, height) * .08;
          const outer = Math.min(width, height) * (.24 + Math.sin(time + i) * .05);
          ctx.strokeStyle = i % 2 ? rgba(secondaryCss, .46, [.6,.6,.8]) : rgba(accentCss, .7, [.2,.8,1]);
          ctx.beginPath();
          ctx.moveTo(Math.cos(a) * inner, Math.sin(a) * inner);
          ctx.lineTo(Math.cos(a) * outer, Math.sin(a) * outer);
          ctx.stroke();
        }
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      } else if (variant === 'gooey-blob') {
        ctx.filter = 'blur(14px)';
        for (let i = 0; i < 5; i++) {
          ctx.fillStyle = i % 2 ? rgba(secondaryCss, .42, [.8,.4,.8]) : rgba(accentCss, .5, [.2,.8,1]);
          ctx.beginPath();
          ctx.arc(width * (.28 + seeded(i) * .46) + Math.sin(time * .4 + i) * 24, height * (.28 + seeded(i + 2) * .44) + Math.cos(time * .36 + i) * 18, Math.min(width, height) * (.08 + seeded(i + 8) * .08), 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.filter = 'none';
      } else {
        const cx = width * .52;
        const cy = height * .48;
        const size = Math.min(width, height) * .28;
        ctx.strokeStyle = rgba(accentCss, .76, [.2,.8,1]);
        ctx.fillStyle = rgba(accentCss, .18, [.2,.8,1]);
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        for (let i = 0; i < 8; i++) {
          const a = i / 8 * Math.PI * 2 + time * .25;
          const r = i % 2 ? size * .62 : size;
          const x = cx + Math.cos(a) * r;
          const y = cy + Math.sin(a) * r * .72;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
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

    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
    };
  }, [accentCss, bgCss, live, quality, secondaryCss, theme.isLight, variant]);

  return <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden="true" />;
}

export function createCanvasPreview(variant: CanvasVariant) {
  function CanvasPreviewComponent(props: EffectPreviewProps) {
    return <CanvasPreview {...props} variant={variant} />;
  }
  return CanvasPreviewComponent;
}
