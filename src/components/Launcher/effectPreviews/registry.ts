import {
  createCanvasPreview,
  createCssPreview,
  createShaderPreview,
} from './EffectPreviewLibrary';
import { createLayeredPreview, createThreePreview } from './ThreePreview';
import { WebglLaserPreview } from './WebglLaserPreview';
import type { EffectPreviewDefinition, EffectPreviewEngine } from './types';

export const SUPPORTED_EFFECT_PREVIEW_STACKS: EffectPreviewEngine[] = [
  'css',
  'dom-motion',
  'gsap',
  'canvas2d',
  'raw-webgl',
  'glsl',
  'three',
  'svg-filter',
  'd3',
  'external-image',
  'icon',
];

type EffectPreviewDefinitionInput = Omit<EffectPreviewDefinition, 'id'>;

function defineEffect(id: string, definition: EffectPreviewDefinitionInput): EffectPreviewDefinition {
  return { id, ...definition };
}

function sceneBackground(
  id: string,
  engine: EffectPreviewEngine,
  stacks: EffectPreviewEngine[],
  component: EffectPreviewDefinition['component'],
  cost: EffectPreviewDefinition['cost'] = 'high',
  presentation: EffectPreviewDefinition['presentation'] = 'default',
): EffectPreviewDefinition {
  return defineEffect(id, {
    engine,
    stacks,
    slot: 'background',
    cost,
    exclusiveGroup: 'scene-background',
    presentation,
    component,
  });
}

function layeredEffect(
  id: string,
  engine: EffectPreviewEngine,
  stacks: EffectPreviewEngine[],
  slot: EffectPreviewDefinition['slot'],
  component: EffectPreviewDefinition['component'],
  cost: EffectPreviewDefinition['cost'] = 'medium',
): EffectPreviewDefinition {
  return defineEffect(id, {
    engine,
    stacks,
    slot,
    cost,
    component,
  });
}

export const EFFECT_PREVIEW_REGISTRY: Record<string, EffectPreviewDefinition> = {
  '3d-perspective-scroll-dashboard': sceneBackground('3d-perspective-scroll-dashboard', 'three', ['three', 'raw-webgl', 'glsl', 'css', 'dom-motion'], createLayeredPreview(createThreePreview('wire-terrain'), createCssPreview('perspective-dashboard')), 'high', 'full-scene'),
  'agency-grid-layout-minimal': layeredEffect('agency-grid-layout-minimal', 'css', ['css', 'dom-motion'], 'layout-system', createCssPreview('agency-grid'), 'low'),
  'atmospheric-ambient-ray-and-particle-system': sceneBackground('atmospheric-ambient-ray-and-particle-system', 'canvas2d', ['canvas2d', 'css'], createCanvasPreview('ambient-particles')),
  'atmospheric-grain-webgl-background': sceneBackground('atmospheric-grain-webgl-background', 'raw-webgl', ['raw-webgl', 'glsl'], createShaderPreview('grain')),
  'atmospheric-laser-and-webgl-design-system': sceneBackground('atmospheric-laser-and-webgl-design-system', 'raw-webgl', ['raw-webgl', 'glsl', 'css'], WebglLaserPreview),
  'atmospheric-meditative-dark-system': layeredEffect('atmospheric-meditative-dark-system', 'gsap', ['gsap', 'dom-motion', 'css'], 'motion', createCssPreview('meditative-dark')),
  'atmospheric-procedural-webgl-background': sceneBackground('atmospheric-procedural-webgl-background', 'three', ['three', 'raw-webgl', 'glsl'], createLayeredPreview(createThreePreview('shader-plane'), createShaderPreview('procedural'))),
  'atmospheric-technical-design-system': sceneBackground('atmospheric-technical-design-system', 'three', ['three', 'raw-webgl', 'glsl', 'svg-filter', 'css'], createLayeredPreview(createThreePreview('shader-plane'), createCssPreview('technical-system')), 'high', 'full-scene'),
  'atmospheric-topographic-webgl': sceneBackground('atmospheric-topographic-webgl', 'raw-webgl', ['raw-webgl', 'glsl'], createShaderPreview('topographic')),
  'atmospheric-webgl-field-system': sceneBackground('atmospheric-webgl-field-system', 'raw-webgl', ['raw-webgl', 'glsl', 'css'], createLayeredPreview(createShaderPreview('cyber-field'), createCssPreview('webgl-field')), 'high', 'full-scene'),
  'aura-3d-network-system': sceneBackground('aura-3d-network-system', 'three', ['three', 'raw-webgl', 'canvas2d'], createLayeredPreview(createThreePreview('network-globe'), createCssPreview('aura-network-scene')), 'high', 'full-scene'),
  'aura-asset-images': layeredEffect('aura-asset-images', 'external-image', ['external-image', 'css'], 'asset', createCssPreview('asset-images'), 'low'),
  'aura-isometric-3d-visualization-system': sceneBackground('aura-isometric-3d-visualization-system', 'three', ['three', 'raw-webgl', 'canvas2d'], createLayeredPreview(createThreePreview('isometric-blocks'), createCssPreview('aura-isometric-scene')), 'high', 'full-scene'),
  'background-grid-webgl': sceneBackground('background-grid-webgl', 'three', ['three', 'raw-webgl', 'glsl'], createLayeredPreview(createThreePreview('wire-terrain'), createShaderPreview('grid'))),
  'beautiful-shadows': layeredEffect('beautiful-shadows', 'css', ['css'], 'surface-material', createCssPreview('beautiful-shadows'), 'low'),
  'blue-cloudy-clean-modern': sceneBackground('blue-cloudy-clean-modern', 'css', ['css', 'dom-motion'], createCssPreview('blue-cloudy'), 'medium', 'full-scene'),
  'book-serif-index': layeredEffect('book-serif-index', 'dom-motion', ['dom-motion', 'css'], 'typography', createCssPreview('book-serif'), 'low'),
  'border-gradients': layeredEffect('border-gradients', 'css', ['css'], 'surface-material', createCssPreview('border-gradients'), 'low'),
  'chromatic-dispersion-webgl-system': sceneBackground('chromatic-dispersion-webgl-system', 'three', ['three', 'raw-webgl', 'glsl'], createLayeredPreview(createThreePreview('shader-plane'), createShaderPreview('chromatic'))),
  'clean-minimal-beige-light-mode': layeredEffect('clean-minimal-beige-light-mode', 'css', ['css'], 'layout-system', createCssPreview('minimal-beige'), 'low'),
  'company-logos': layeredEffect('company-logos', 'icon', ['icon', 'css'], 'typography', createCssPreview('company-logos'), 'low'),
  'container-lines': layeredEffect('container-lines', 'css', ['css'], 'layout-system', createCssPreview('container-lines'), 'low'),
  'corner-diagonals': layeredEffect('corner-diagonals', 'css', ['css', 'dom-motion'], 'layout-system', createCssPreview('corner-diagonals'), 'low'),
  'corner-lasers': sceneBackground('corner-lasers', 'css', ['css', 'dom-motion'], createCssPreview('corner-lasers'), 'medium'),
  'cursor-reactive-flashlight-glow-border': layeredEffect('cursor-reactive-flashlight-glow-border', 'dom-motion', ['dom-motion', 'css'], 'foreground-overlay', createCssPreview('cursor-flashlight'), 'medium'),
  'cyber-kinetic-background-field': sceneBackground('cyber-kinetic-background-field', 'raw-webgl', ['raw-webgl', 'glsl', 'dom-motion'], createShaderPreview('cyber-field')),
  'cyber-trail-webgl-background-system': sceneBackground('cyber-trail-webgl-background-system', 'three', ['three', 'raw-webgl', 'glsl'], createLayeredPreview(createThreePreview('shader-plane'), createShaderPreview('cyber-trail'))),
  'd3-interactive-point-cloud-globe': sceneBackground('d3-interactive-point-cloud-globe', 'd3', ['d3', 'canvas2d', 'css'], createLayeredPreview(createCanvasPreview('d3-globe'), createCssPreview('d3-globe-scene')), 'high', 'full-scene'),
  'dither-background': sceneBackground('dither-background', 'css', ['css'], createCssPreview('dither-background'), 'medium'),
  'dither-laser-dark-mode': sceneBackground('dither-laser-dark-mode', 'raw-webgl', ['raw-webgl', 'glsl', 'css'], WebglLaserPreview),
  'editorial-tech': layeredEffect('editorial-tech', 'css', ['css', 'dom-motion'], 'layout-system', createCssPreview('editorial-tech'), 'low'),
  'framed-grid-layout': layeredEffect('framed-grid-layout', 'css', ['css'], 'layout-system', createCssPreview('framed-grid'), 'low'),
  'glass-dark-mode-clock': layeredEffect('glass-dark-mode-clock', 'dom-motion', ['dom-motion', 'css'], 'surface-material', createCssPreview('glass-clock'), 'medium'),
  'globe-particles': sceneBackground('globe-particles', 'three', ['three', 'raw-webgl', 'canvas2d'], createLayeredPreview(createThreePreview('network-globe'), createCanvasPreview('globe-particles'))),
  'gooey-blob-system': layeredEffect('gooey-blob-system', 'svg-filter', ['svg-filter', 'css', 'dom-motion'], 'foreground-overlay', createCanvasPreview('gooey-blob'), 'medium'),
  'grainy-stepped-gradient-noise': sceneBackground('grainy-stepped-gradient-noise', 'three', ['three', 'raw-webgl', 'glsl', 'css'], createLayeredPreview(createThreePreview('shader-plane'), createCssPreview('grainy-stepped')), 'medium'),
  'gsap-motion': layeredEffect('gsap-motion', 'gsap', ['gsap', 'dom-motion', 'css'], 'motion', createCssPreview('masked-reveal'), 'low'),
  'high-contrast-skeuomorphic-clean': layeredEffect('high-contrast-skeuomorphic-clean', 'css', ['css'], 'surface-material', createCssPreview('high-contrast-skeuo'), 'low'),
  'image-first-grid-layout': layeredEffect('image-first-grid-layout', 'external-image', ['external-image', 'css'], 'asset', createCssPreview('image-first-grid'), 'low'),
  'industrial-webgl-minimalist-system': sceneBackground('industrial-webgl-minimalist-system', 'three', ['three', 'raw-webgl', 'glsl'], createLayeredPreview(createThreePreview('wire-terrain'), createShaderPreview('industrial'))),
  'interactive-border-gradient-glow': layeredEffect('interactive-border-gradient-glow', 'dom-motion', ['dom-motion', 'css'], 'surface-material', createCssPreview('interactive-border'), 'low'),
  'isometric-spatial-3d-system': sceneBackground('isometric-spatial-3d-system', 'three', ['three', 'raw-webgl', 'glsl'], createLayeredPreview(createThreePreview('isometric-blocks'), createShaderPreview('isometric-spatial'))),
  'kinetic-radial-sculpture-system': layeredEffect('kinetic-radial-sculpture-system', 'canvas2d', ['canvas2d', 'dom-motion'], 'foreground-overlay', createCanvasPreview('kinetic-radial'), 'medium'),
  'light-mode-paper-technical': layeredEffect('light-mode-paper-technical', 'css', ['css'], 'layout-system', createCssPreview('light-paper-tech'), 'low'),
  'magic-rings-telemetry-aesthetic': sceneBackground('magic-rings-telemetry-aesthetic', 'css', ['css', 'dom-motion', 'raw-webgl'], createCssPreview('magic-rings'), 'medium'),
  marquee: layeredEffect('marquee', 'dom-motion', ['dom-motion', 'css'], 'motion', createCssPreview('marquee'), 'low'),
  'masked-reveal': layeredEffect('masked-reveal', 'dom-motion', ['dom-motion', 'css'], 'motion', createCssPreview('masked-reveal'), 'low'),
  'mesh-gradient-dark-blue-clean': sceneBackground('mesh-gradient-dark-blue-clean', 'css', ['css', 'raw-webgl'], createCssPreview('mesh-gradient'), 'medium'),
  'nested-container-clean-agency': layeredEffect('nested-container-clean-agency', 'css', ['css'], 'layout-system', createCssPreview('nested-agency'), 'low'),
  'nested-container-frames': layeredEffect('nested-container-frames', 'css', ['css'], 'layout-system', createCssPreview('nested-frames'), 'low'),
  'number-details': layeredEffect('number-details', 'css', ['css'], 'typography', createCssPreview('number-details'), 'low'),
  'orange-clean-paper-saas': layeredEffect('orange-clean-paper-saas', 'css', ['css'], 'layout-system', createCssPreview('orange-paper-saas'), 'low'),
  'organic-aetherial-webgl-background': sceneBackground('organic-aetherial-webgl-background', 'three', ['three', 'raw-webgl', 'glsl'], createLayeredPreview(createThreePreview('organic-sphere'), createShaderPreview('organic'))),
  'premium-gradient-border-system': layeredEffect('premium-gradient-border-system', 'css', ['css'], 'surface-material', createCssPreview('premium-gradient-border'), 'low'),
  'procedural-mesh-network-background': sceneBackground('procedural-mesh-network-background', 'three', ['three', 'raw-webgl', 'glsl'], createLayeredPreview(createThreePreview('shader-plane'), createShaderPreview('mesh-network'))),
  'progressive-blur': layeredEffect('progressive-blur', 'css', ['css'], 'foreground-overlay', createCssPreview('progressive-blur'), 'low'),
  'skeuomorphic-ui': layeredEffect('skeuomorphic-ui', 'css', ['css'], 'surface-material', createCssPreview('skeuomorphic'), 'low'),
  'solar-duotone-bold': layeredEffect('solar-duotone-bold', 'icon', ['icon', 'css'], 'typography', createCssPreview('solar-duotone'), 'low'),
  'split-layout-technical': layeredEffect('split-layout-technical', 'css', ['css'], 'layout-system', createCssPreview('split-technical'), 'low'),
  'stepped-neon-v-curve-glass-system': sceneBackground('stepped-neon-v-curve-glass-system', 'dom-motion', ['dom-motion', 'css'], createCssPreview('stepped-neon'), 'medium'),
  'technical-ascii-particle-field': sceneBackground('technical-ascii-particle-field', 'canvas2d', ['canvas2d', 'dom-motion'], createCanvasPreview('ascii-field')),
  'technical-framed-grid-design-system': sceneBackground('technical-framed-grid-design-system', 'three', ['three', 'raw-webgl', 'glsl', 'gsap', 'css'], createLayeredPreview(createThreePreview('wire-terrain'), createCssPreview('technical-framed')), 'medium'),
  'technical-shader-surface-webgl': sceneBackground('technical-shader-surface-webgl', 'three', ['three', 'raw-webgl', 'glsl'], createLayeredPreview(createThreePreview('shader-plane'), createShaderPreview('technical-shader'))),
  'technical-tactical-globe-ui': sceneBackground('technical-tactical-globe-ui', 'canvas2d', ['canvas2d', 'raw-webgl'], createCanvasPreview('tactical-globe')),
  'technical-terminal-and-webgl-grid-system': sceneBackground('technical-terminal-and-webgl-grid-system', 'raw-webgl', ['raw-webgl', 'glsl', 'gsap', 'css'], createShaderPreview('terminal-grid')),
  'technical-webgl-fluid-nebula-background': sceneBackground('technical-webgl-fluid-nebula-background', 'three', ['three', 'raw-webgl', 'glsl', 'svg-filter'], createLayeredPreview(createThreePreview('shader-plane'), createShaderPreview('fluid-nebula'))),
  'technical-wireframe-info-layout': sceneBackground('technical-wireframe-info-layout', 'canvas2d', ['canvas2d', 'css'], createCssPreview('wireframe-info'), 'medium'),
  'webgl-3d-object': sceneBackground('webgl-3d-object', 'three', ['three', 'raw-webgl'], createLayeredPreview(createThreePreview('faceted-object'), createCanvasPreview('webgl-object'))),
  'webgl-laser': sceneBackground('webgl-laser', 'raw-webgl', ['raw-webgl', 'glsl'], WebglLaserPreview),
};

export function normalizeEffectPreviewId(effectId: string): string {
  return effectId
    .replace(/^neuform[_-]/, '')
    .replace(/_/g, '-')
    .replace(/^css-border-gradient$/, 'border-gradients')
    .replace(/^gsap$/, 'gsap-motion')
    .replace(/^marquee-loop$/, 'marquee')
    .replace(/-(?=[a-z0-9]{6}$)(?=[a-z0-9]*\d)[a-z0-9]+$/, '')
    .toLowerCase();
}

export function resolveEffectPreview(effectId: string): EffectPreviewDefinition | null {
  const normalized = normalizeEffectPreviewId(effectId);
  const exact = EFFECT_PREVIEW_REGISTRY[normalized];
  if (exact) return exact;

  const suffixed = normalized.replace(/-[a-z0-9]{6}$/i, '');
  return EFFECT_PREVIEW_REGISTRY[suffixed] ?? null;
}

export function activeEffectPreviewDefinitions(effectIds: string[]): EffectPreviewDefinition[] {
  const definitions: EffectPreviewDefinition[] = [];
  const exclusiveGroups = new Set<string>();

  for (const effectId of effectIds) {
    const definition = resolveEffectPreview(effectId);
    if (!definition) continue;
    if (definition.exclusiveGroup) {
      if (exclusiveGroups.has(definition.exclusiveGroup)) continue;
      exclusiveGroups.add(definition.exclusiveGroup);
    }
    definitions.push(definition);
  }

  return definitions;
}

export function effectsUseFullScenePresentation(effectIds: string[]): boolean {
  return activeEffectPreviewDefinitions(effectIds).some(definition => definition.presentation === 'full-scene');
}

export function effectPreviewConflictReason(selectedEffectIds: string[], candidateEffectId: string): string | null {
  const candidate = resolveEffectPreview(candidateEffectId);
  if (!candidate?.exclusiveGroup) return null;

  const normalizedCandidate = normalizeEffectPreviewId(candidateEffectId);
  const conflicting = selectedEffectIds
    .filter(effectId => normalizeEffectPreviewId(effectId) !== normalizedCandidate)
    .map(effectId => resolveEffectPreview(effectId))
    .find(definition => definition?.exclusiveGroup === candidate.exclusiveGroup);

  if (!conflicting) return null;
  return `Only one full-scene background renderer can be previewed at a time. Deselect ${conflicting.id.replace(/-/g, ' ')} first.`;
}
