import type { ComponentType } from 'react';
import type { EffectPreviewProps } from './types';

type ThreeVariant =
  | 'faceted-object'
  | 'wire-terrain'
  | 'isometric-blocks'
  | 'organic-sphere'
  | 'network-globe'
  | 'shader-plane';

function rgba(hex: string | undefined, alpha: number, fallback: string): string {
  const raw = String(hex ?? '').trim();
  const match = raw.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!match) return fallback;
  const normalized = match[1].length === 3
    ? match[1].split('').map(char => char + char).join('')
    : match[1];
  const value = Number.parseInt(normalized, 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function ThreeThumbnailPreview({ variant, theme }: Pick<EffectPreviewProps, 'theme'> & { variant: ThreeVariant }) {
  const accent = theme.accent;
  const secondary = theme.secondary;
  const bg = theme.isLight ? '#f8fafc' : theme.background;

  if (variant === 'wire-terrain') {
    return (
      <div className="absolute inset-0 overflow-hidden" style={{ background: `radial-gradient(circle at 52% 72%, ${rgba(accent, .24, 'rgba(34,197,94,.24)')}, transparent 30%), ${bg}`, perspective: '520px' }}>
        <div
          className="absolute left-[-12%] top-[42%] h-[72%] w-[124%] border-t"
          style={{
            borderColor: rgba(accent, .26, 'rgba(34,197,94,.26)'),
            backgroundImage: `linear-gradient(${rgba(accent, .18, 'rgba(34,197,94,.18)')} 1px, transparent 1px), linear-gradient(90deg, ${rgba(accent, .20, 'rgba(34,197,94,.20)')} 1px, transparent 1px)`,
            backgroundSize: '22px 18px',
            transform: 'rotateX(62deg)',
            transformOrigin: 'center top',
          }}
        />
      </div>
    );
  }

  if (variant === 'shader-plane') {
    return (
      <div
        className="absolute inset-0 overflow-hidden"
        style={{
          background:
            `radial-gradient(circle at 35% 28%, ${rgba(accent, .28, 'rgba(34,197,94,.28)')}, transparent 28%), radial-gradient(circle at 70% 70%, ${rgba(secondary, .20, 'rgba(148,163,184,.20)')}, transparent 32%), linear-gradient(135deg, ${bg}, #050711)`,
        }}
      >
        <div className="absolute inset-0 opacity-25" style={{ backgroundImage: `linear-gradient(${rgba(accent, .20, 'rgba(34,197,94,.20)')} 1px, transparent 1px), linear-gradient(90deg, ${rgba(accent, .18, 'rgba(34,197,94,.18)')} 1px, transparent 1px)`, backgroundSize: '18px 18px' }} />
      </div>
    );
  }

  if (variant === 'organic-sphere') {
    return (
      <div className="absolute inset-0 overflow-hidden" style={{ background: `radial-gradient(circle at 28% 30%, ${rgba(accent, .26, 'rgba(34,197,94,.26)')}, transparent 28%), ${bg}` }}>
        <div className="absolute left-[42%] top-[18%] h-[52%] w-[42%] rounded-full blur-[1px]" style={{ background: `radial-gradient(circle at 52% 42%, ${rgba(secondary, .22, 'rgba(148,163,184,.22)')}, rgba(7,19,13,.72) 56%, transparent 72%)`, boxShadow: `0 0 46px ${rgba(accent, .20, 'rgba(34,197,94,.20)')}` }} />
      </div>
    );
  }

  if (variant === 'network-globe') {
    return (
      <div className="absolute inset-0 overflow-hidden" style={{ background: '#020504' }}>
        <div className="absolute left-1/2 top-1/2 h-[70%] w-[54%] -translate-x-1/2 -translate-y-1/2 rounded-full border" style={{ borderColor: rgba(accent, .26, 'rgba(34,197,94,.26)'), boxShadow: `inset 0 0 28px ${rgba(accent, .16, 'rgba(34,197,94,.16)')}, 0 0 34px ${rgba(accent, .12, 'rgba(34,197,94,.12)')}` }} />
        <div className="absolute inset-[18%] opacity-45" style={{ backgroundImage: `radial-gradient(circle, ${rgba(accent, .75, 'rgba(34,197,94,.75)')} 1px, transparent 1.5px)`, backgroundSize: '10px 10px', borderRadius: '50%' }} />
      </div>
    );
  }

  if (variant === 'isometric-blocks') {
    return (
      <div className="absolute inset-0 overflow-hidden" style={{ background: `linear-gradient(135deg, ${bg}, #06100b)` }}>
        <div className="absolute left-[38%] top-[24%] grid grid-cols-3 gap-1.5" style={{ transform: 'rotateX(58deg) rotateZ(-36deg)' }}>
          {Array.from({ length: 9 }).map((_, index) => (
            <div key={index} className="h-7 w-7" style={{ background: index % 2 ? rgba(accent, .62, 'rgba(34,197,94,.62)') : rgba(secondary, .36, 'rgba(148,163,184,.36)'), boxShadow: `0 ${4 + (index % 3) * 3}px 0 ${rgba(accent, .18, 'rgba(34,197,94,.18)')}` }} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 overflow-hidden" style={{ background: `radial-gradient(circle at 50% 46%, ${rgba(accent, .36, 'rgba(34,197,94,.36)')}, transparent 30%), ${bg}` }}>
      <div className="absolute left-1/2 top-1/2 h-[34%] w-[34%] -translate-x-1/2 -translate-y-1/2 rotate-12 border" style={{ borderColor: rgba(accent, .72, 'rgba(34,197,94,.72)'), background: rgba(accent, .18, 'rgba(34,197,94,.18)') }} />
    </div>
  );
}

function ThreePreview(props: EffectPreviewProps & { variant: ThreeVariant }) {
  return <ThreeThumbnailPreview variant={props.variant} theme={props.theme} />;
}

export function createThreePreview(variant: ThreeVariant) {
  function ThreePreviewComponent(props: EffectPreviewProps) {
    return <ThreePreview {...props} variant={variant} />;
  }
  return ThreePreviewComponent;
}

export function createLayeredPreview(...components: Array<ComponentType<EffectPreviewProps>>) {
  function LayeredPreviewComponent(props: EffectPreviewProps) {
    return (
      <>
        {components.map((Component, index) => (
          <div key={index} className="absolute inset-0 overflow-hidden" style={{ zIndex: index }}>
            <Component {...props} />
          </div>
        ))}
      </>
    );
  }
  return LayeredPreviewComponent;
}
