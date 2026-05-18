import type { ComponentType } from 'react';

export type EffectPreviewEngine =
  | 'css'
  | 'dom-motion'
  | 'gsap'
  | 'canvas2d'
  | 'raw-webgl'
  | 'glsl'
  | 'three'
  | 'svg-filter'
  | 'd3'
  | 'external-image'
  | 'icon';

export type EffectPreviewMode = 'poster' | 'live';
export type EffectPreviewQuality = 'thumbnail' | 'preview' | 'effect';

export interface EffectPreviewTheme {
  background: string;
  accent: string;
  secondary: string;
  isLight: boolean;
}

export interface EffectPreviewProps {
  colors: string[];
  theme: EffectPreviewTheme;
  mode: EffectPreviewMode;
  quality: EffectPreviewQuality;
  reducedMotion: boolean;
  seed: string;
}

export interface EffectPreviewDefinition {
  id: string;
  engine: EffectPreviewEngine;
  stacks: EffectPreviewEngine[];
  slot: 'background' | 'foreground-overlay' | 'surface-material' | 'layout-system' | 'motion' | 'typography' | 'asset';
  cost: 'low' | 'medium' | 'high';
  exclusiveGroup?: 'scene-background';
  presentation?: 'default' | 'full-scene';
  component: ComponentType<EffectPreviewProps>;
}
