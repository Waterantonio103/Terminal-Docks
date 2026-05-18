import { useEffect, useMemo, useState } from 'react';
import type { FrontendDirectionEffect, FrontendDirectionPalette } from '../../../lib/frontendDirection';
import { resolveFrontendPaletteColors } from '../../../lib/frontendPaletteColors';
import { activeEffectPreviewDefinitions } from './registry';
import type { EffectPreviewMode, EffectPreviewQuality, EffectPreviewTheme } from './types';

function paletteColors(value: FrontendDirectionPalette): string[] {
  return resolveFrontendPaletteColors(value, ['#050505', '#22C55E', '#94A3B8']);
}

function hexLuminance(color: string): number {
  const match = color.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!match) return 0;
  const hex = match[1].length === 3
    ? match[1].split('').map(char => char + char).join('')
    : match[1];
  const values = [0, 2, 4].map(index => Number.parseInt(hex.slice(index, index + 2), 16) / 255)
    .map(value => value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
}

function effectTheme(colors: string[]): EffectPreviewTheme {
  const background = colors[0] ?? '#050505';
  const isLight = hexLuminance(background) > 0.62;
  const candidates = colors.slice(1).filter(color => hexLuminance(color) < 0.94);
  return {
    background,
    accent: candidates[0] ?? (isLight ? '#2563EB' : '#22C55E'),
    secondary: candidates[1] ?? colors[2] ?? (isLight ? '#0F172A' : '#94A3B8'),
    isLight,
  };
}

function useReducedMotion(): boolean {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  return reducedMotion;
}

export function EffectPreviewStage({
  effects,
  mode,
  palette,
  quality,
}: {
  effects: FrontendDirectionEffect[];
  mode: EffectPreviewMode;
  palette: FrontendDirectionPalette;
  quality: EffectPreviewQuality;
}) {
  const definitions = useMemo(() => activeEffectPreviewDefinitions(effects.map(effect => String(effect))), [effects]);
  const reducedMotion = useReducedMotion();

  if (definitions.length === 0) return null;

  const colors = paletteColors(palette);
  const theme = effectTheme(colors);
  return (
    <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden" data-effect-preview-engine={definitions.map(definition => definition.engine).join(',')}>
      {definitions.map((definition, index) => {
        const Component = definition.component;
        return (
          <div key={definition.id} className="absolute inset-0 overflow-hidden" style={{ zIndex: index }}>
            <Component
              colors={colors}
              theme={theme}
              mode={mode}
              quality={quality}
              reducedMotion={reducedMotion}
              seed={definition.id}
            />
          </div>
        );
      })}
    </div>
  );
}
