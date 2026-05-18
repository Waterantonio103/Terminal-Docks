import { useEffect, useMemo, useState } from 'react';
import { Bot, Check, ChevronLeft, ChevronRight, Eye, Image as ImageIcon, Layers, Sparkles, X } from 'lucide-react';
import { useWorkspaceStore, type ThemeType } from '../../store/workspace';
import {
  frontendDirectionLabel,
  normalizeFrontendDirectionSpec,
  type FrontendDirectionAssets,
  type FrontendDirectionDensity,
  type FrontendDirectionEffect,
  type FrontendDirectionInteraction,
  type FrontendDirectionLayout,
  type FrontendDirectionPalette,
  type FrontendDirectionPaletteChoice,
  type FrontendDirectionShape,
  type FrontendDirectionSpec,
  type FrontendDirectionTone,
} from '../../lib/frontendDirection';
import { resolveFrontendPaletteColors } from '../../lib/frontendPaletteColors';
import { EffectPreviewStage } from './effectPreviews/EffectPreviewStage';
import { effectPreviewConflictReason, resolveEffectPreview } from './effectPreviews/registry';
import neuformIndex from '../../../mcp-server/src/resources/frontend-patterns/neuform/index.json';

const NEUFORM_EFFECT_DOCS = import.meta.glob('../../../mcp-server/src/resources/frontend-patterns/neuform/effects/*.md', {
  eager: true,
  import: 'default',
  query: '?raw',
}) as Record<string, string>;

type StepId = 'layout' | 'density' | 'palette' | 'shape' | 'effects' | 'assets' | 'interaction' | 'tone' | 'review';
type ChoiceValue =
  | FrontendDirectionLayout
  | FrontendDirectionDensity
  | FrontendDirectionPalette
  | FrontendDirectionShape
  | FrontendDirectionEffect
  | FrontendDirectionAssets
  | FrontendDirectionInteraction
  | FrontendDirectionTone;

interface Choice {
  value: ChoiceValue;
  label: string;
  description: string;
}

interface NeuformIndexEntry {
  id?: string;
  title?: string;
  path?: string;
  source?: {
    originId?: string;
    url?: string;
  };
}

interface PaletteChoiceGroup {
  id: 'light' | 'dark';
  label: string;
  choices: Choice[];
}

interface PickerState {
  layout?: FrontendDirectionLayout;
  density?: FrontendDirectionDensity;
  palette?: FrontendDirectionPalette;
  shape?: FrontendDirectionShape;
  effects?: FrontendDirectionEffect[];
  assets?: FrontendDirectionAssets;
  interaction?: FrontendDirectionInteraction[];
  tone?: FrontendDirectionTone;
}

interface AppSiteThemePickerProps {
  open: boolean;
  onClose: () => void;
  onApply: (spec: FrontendDirectionSpec) => void;
}

const STEPS: Array<{ id: StepId; label: string }> = [
  { id: 'layout', label: 'Layout' },
  { id: 'density', label: 'Density' },
  { id: 'palette', label: 'Palette' },
  { id: 'shape', label: 'Shape' },
  { id: 'effects', label: 'Effects' },
  { id: 'assets', label: 'Assets' },
  { id: 'interaction', label: 'Interaction' },
  { id: 'tone', label: 'Tone' },
  { id: 'review', label: 'Review' },
];

const paletteChoice = (id: string, label: string, colors: string[]): FrontendDirectionPaletteChoice => ({
  kind: 'preset',
  id,
  label,
  colors,
});

const AGENT_PALETTE_CHOICE: Choice = {
  value: { kind: 'agent_decides', id: 'agent_decides', label: 'Let agents decide', colors: [] },
  label: 'Let agents decide',
  description: 'Agents choose production-ready tokens that fit the build type.',
};

const PALETTE_GROUPS: PaletteChoiceGroup[] = [
  {
    id: 'light',
    label: 'Light palettes',
    choices: [
      { value: paletteChoice('light_saas_blue', 'SaaS blue', ['#F8FAFC', '#2563EB', '#0F172A']), label: 'SaaS blue', description: 'Clean product default with readable navy text.' },
      { value: paletteChoice('light_finance_emerald', 'Finance emerald', ['#F7FAF8', '#047857', '#111827']), label: 'Finance emerald', description: 'Trustworthy, data-friendly green with neutral surfaces.' },
      { value: paletteChoice('light_health_teal', 'Health teal', ['#F6FEFC', '#0F766E', '#134E4A']), label: 'Health teal', description: 'Calm app and service palette with restrained contrast.' },
      { value: paletteChoice('light_editorial_ink', 'Editorial ink', ['#FAFAF9', '#1F2937', '#B45309']), label: 'Editorial ink', description: 'Publication-like neutral base with a measured amber accent.' },
      { value: paletteChoice('light_agency_indigo', 'Agency indigo', ['#F9FAFB', '#4F46E5', '#111827']), label: 'Agency indigo', description: 'Modern portfolio or services tone without purple overload.' },
      { value: paletteChoice('light_commerce_rose', 'Commerce rose', ['#FFF7F9', '#E11D48', '#1F2937']), label: 'Commerce rose', description: 'Consumer-facing accent with practical dark text.' },
      { value: paletteChoice('light_ops_slate_cyan', 'Ops slate/cyan', ['#F8FAFC', '#0891B2', '#334155']), label: 'Ops slate/cyan', description: 'Technical dashboards and admin surfaces.' },
      { value: paletteChoice('light_warm_product', 'Warm product', ['#FFFBF5', '#EA580C', '#1E293B']), label: 'Warm product', description: 'Friendly product UI with restrained orange action color.' },
      { value: paletteChoice('light_luxury_graphite', 'Luxury graphite', ['#F6F5F2', '#27272A', '#A16207']), label: 'Luxury graphite', description: 'Premium light surfaces with low-noise gold detail.' },
      { value: paletteChoice('light_mono_blue', 'Mono blue', ['#FFFFFF', '#0F172A', '#2563EB']), label: 'Mono blue', description: 'Highly readable monochrome system with one proven accent.' },
    ],
  },
  {
    id: 'dark',
    label: 'Dark palettes',
    choices: [
      { value: paletteChoice('dark_neutral_contrast', 'Neutral contrast', ['#050505', '#F4F4F5', '#71717A']), label: 'Neutral contrast', description: 'Default black, white, and zinc for serious dark UI.' },
      { value: paletteChoice('dark_product_blue', 'Product blue', ['#0B1220', '#60A5FA', '#94A3B8']), label: 'Product blue', description: 'Dark SaaS with accessible blue accent.' },
      { value: paletteChoice('dark_terminal_green', 'Terminal green', ['#050A07', '#34D399', '#9CA3AF']), label: 'Terminal green', description: 'Developer-tool dark mode without neon excess.' },
      { value: paletteChoice('dark_graphite_violet', 'Graphite violet', ['#111113', '#8B5CF6', '#A1A1AA']), label: 'Graphite violet', description: 'Creative tooling with neutral graphite support.' },
      { value: paletteChoice('dark_navy_cyan', 'Navy cyan', ['#08111F', '#22D3EE', '#CBD5E1']), label: 'Navy cyan', description: 'Technical, crisp, and familiar for dashboards.' },
      { value: paletteChoice('dark_security_amber', 'Security amber', ['#0F0F0B', '#F59E0B', '#D4D4D8']), label: 'Security amber', description: 'Monitoring and alert systems with careful warmth.' },
      { value: paletteChoice('dark_ink_rose', 'Ink rose', ['#09090B', '#FB7185', '#A1A1AA']), label: 'Ink rose', description: 'Sharp consumer or media accent on blackened ink.' },
      { value: paletteChoice('dark_forest_mint', 'Forest mint', ['#07130D', '#6EE7B7', '#A7F3D0']), label: 'Forest mint', description: 'Calm sustainability, wellness, and data products.' },
      { value: paletteChoice('dark_aubergine_sky', 'Aubergine sky', ['#16091F', '#38BDF8', '#C4B5FD']), label: 'Aubergine sky', description: 'Expressive dark brand palette that stays legible.' },
      { value: paletteChoice('dark_contrast_white', 'Contrast white', ['#020617', '#F8FAFC', '#64748B']), label: 'Contrast white', description: 'Minimal high-contrast product or editorial UI.' },
      { value: paletteChoice('dark_red_status', 'Red status', ['#0A0A0A', '#EF4444', '#CBD5E1']), label: 'Red status', description: 'Incident, security, and high-priority workflow accents.' },
    ],
  },
];

const CUSTOM_PALETTE_ID = 'custom_palette';
const DEFAULT_CUSTOM_COLORS = ['#2563EB', '#14B8A6', '#F97316'];
const DEFAULT_LIGHT_PALETTE = PALETTE_GROUPS[0].choices[0].value as FrontendDirectionPaletteChoice;
const DEFAULT_DARK_PALETTE = PALETTE_GROUPS[1].choices[0].value as FrontendDirectionPaletteChoice;
const LIGHT_APP_THEMES = new Set<ThemeType>(['light', 'paper', 'starlink-light', 'solar', 'arctic', 'ivory']);

const CHOICES: Record<Exclude<StepId, 'review' | 'palette' | 'effects'>, Choice[]> = {
  layout: [
    { value: 'agent_decides', label: 'Let agents decide', description: 'Delegates the build type while preserving later choices.' },
    { value: 'dashboard', label: 'Dashboard', description: 'App shell with metrics, charts, tables, and filters.' },
    { value: 'single_screen_tool', label: 'Single-screen tool', description: 'One focused surface with controls and output.' },
    { value: 'workbench_editor', label: 'Workbench/editor', description: 'Sidebar, main canvas/editor, and inspector areas.' },
    { value: 'landing_page', label: 'Landing page', description: 'Hero-led page with visible next-section rhythm.' },
    { value: 'portfolio', label: 'Portfolio', description: 'Showcase grid with detail and proof areas.' },
    { value: 'product_commerce', label: 'Product or commerce', description: 'Product-first page with buying or comparison areas.' },
    { value: 'docs_knowledge_base', label: 'Docs or knowledge base', description: 'Navigation, article, reference, and support blocks.' },
    { value: 'game_interactive', label: 'Game or interactive', description: 'Canvas-like primary area with controls and feedback.' },
    { value: 'content_first_site', label: 'Content-first site', description: 'Editorial flow with readable sections and media rhythm.' },
  ],
  density: [
    { value: 'agent_decides', label: 'Let agents decide', description: 'Agents choose spacing to match the selected layout.' },
    { value: 'compact', label: 'Compact', description: 'Tight spacing for dense, repeated workflows.' },
    { value: 'balanced', label: 'Balanced', description: 'Moderate spacing for most apps and sites.' },
    { value: 'spacious', label: 'Spacious', description: 'Roomier sections and larger content rhythm.' },
  ],
  shape: [
    { value: 'agent_decides', label: 'Let agents decide', description: 'Agents choose radius rules that fit the direction.' },
    { value: 'boxy', label: 'Boxy', description: 'Low radius and utility-first panels.' },
    { value: 'slightly_rounded', label: 'Slightly rounded', description: 'Small consistent radius for panels and controls.' },
    { value: 'soft', label: 'Soft', description: 'More approachable rounded surfaces.' },
    { value: 'pill_heavy', label: 'Pill-heavy', description: 'Pills for chips, filters, and primary actions.' },
    { value: 'sharp_editorial', label: 'Sharp editorial', description: 'Crisp edges and high-layout precision.' },
  ],
  assets: [
    { value: 'agent_decides', label: 'Let agents decide', description: 'Agents choose asset strategy from the selected layout.' },
    { value: 'icons_only', label: 'Icons only', description: 'Use icons and UI primitives, no large imagery.' },
    { value: 'real_product_imagery', label: 'Real product imagery', description: 'Use actual supplied product or app images.' },
    { value: 'stock_photography', label: 'Stock photography', description: 'Use carefully selected photography.' },
    { value: 'generated_bitmap', label: 'Generated bitmap', description: 'Create bitmap visuals when a subject needs imagery.' },
    { value: 'illustration', label: 'Illustration', description: 'Use drawn/graphic assets for personality.' },
    { value: 'data_visualization', label: 'Data visualization', description: 'Charts, graphs, and analytical visuals.' },
    { value: 'no_imagery', label: 'No imagery', description: 'Pure UI, type, color, and layout.' },
  ],
  interaction: [
    { value: 'agent_decides', label: 'Let agents decide', description: 'Agents choose interactions that fit the task.' },
    { value: 'static', label: 'Static', description: 'Mostly presentational output.' },
    { value: 'basic_navigation', label: 'Basic navigation', description: 'Routes, tabs, links, or section navigation.' },
    { value: 'forms', label: 'Forms', description: 'Inputs, validation, and submission states.' },
    { value: 'filtering_and_search', label: 'Filtering and search', description: 'Find, sort, and narrow data.' },
    { value: 'drag_and_drop', label: 'Drag and drop', description: 'Move or reorder user-facing items.' },
    { value: 'realtime_state', label: 'Realtime state', description: 'Live updates, status, or streaming feedback.' },
    { value: 'canvas_or_editor', label: 'Canvas or editor', description: 'Direct manipulation surface or editing model.' },
    { value: 'game_controls', label: 'Game controls', description: 'Input loops and gameplay feedback.' },
  ],
  tone: [
    { value: 'agent_decides', label: 'Let agents decide', description: 'Agents pick copy tone based on product context.' },
    { value: 'technical', label: 'Technical', description: 'Precise, system-oriented language.' },
    { value: 'executive', label: 'Executive', description: 'Clear, summary-led business language.' },
    { value: 'consumer', label: 'Consumer', description: 'Approachable product language.' },
    { value: 'playful', label: 'Playful', description: 'Lighter voice for expressive experiences.' },
    { value: 'minimal', label: 'Minimal', description: 'Sparse labels and reduced copy.' },
    { value: 'luxury', label: 'Luxury', description: 'Measured, premium, low-noise copy.' },
    { value: 'developer_tool', label: 'Developer tool', description: 'Command-aware, API-friendly wording.' },
    { value: 'educational', label: 'Educational', description: 'Explanatory but still concise.' },
  ],
};

const BASE_EFFECT_CHOICES: Choice[] = [
  { value: 'agent_decides', label: 'Let agents decide', description: 'Agents select restrained effects that fit the workflow.' },
  { value: 'none', label: 'No effects', description: 'Static, functional presentation only.' },
];

const EFFECT_CATEGORIES = [
  {
    id: 'background-effects',
    label: 'Background Effects',
    choices: [
      { value: '3d-perspective-scroll-dashboard', label: '3D Perspective Scroll Dashboard', description: 'Neuform effect resource for background, WebGL, or immersive treatment.' },
      { value: 'atmospheric-ambient-ray-and-particle-system', label: 'Atmospheric Ambient Ray & Particle System', description: 'Neuform effect resource for background, WebGL, or immersive treatment.' },
      { value: 'atmospheric-grain-webgl-background', label: 'Atmospheric Grain WebGL Background', description: 'Neuform effect resource for background, WebGL, or immersive treatment.' },
      { value: 'atmospheric-laser-and-webgl-design-system', label: 'Atmospheric Laser & WebGL Design System', description: 'Neuform effect resource for background, WebGL, or immersive treatment.' },
      { value: 'atmospheric-procedural-webgl-background', label: 'Atmospheric Procedural WebGL Background', description: 'Neuform effect resource for background, WebGL, or immersive treatment.' },
      { value: 'atmospheric-technical-design-system', label: 'Atmospheric Technical Design System', description: 'Neuform effect resource for background, WebGL, or immersive treatment.' },
      { value: 'atmospheric-topographic-webgl', label: 'Atmospheric Topographic WebGL', description: 'Neuform effect resource for background, WebGL, or immersive treatment.' },
      { value: 'atmospheric-webgl-field-system', label: 'Atmospheric WebGL Field System', description: 'Neuform effect resource for background, WebGL, or immersive treatment.' },
      { value: 'aura-3d-network-system', label: 'Aura 3D Network System', description: 'Neuform effect resource for background, WebGL, or immersive treatment.' },
      { value: 'aura-isometric-3d-visualization-system', label: 'Aura Isometric 3D Visualization System', description: 'Neuform effect resource for background, WebGL, or immersive treatment.' },
      { value: 'background-grid-webgl', label: 'Background Grid WebGL', description: 'Neuform effect resource for background, WebGL, or immersive treatment.' },
      { value: 'blue-cloudy-clean-modern', label: 'Blue Cloudy Clean Modern', description: 'Neuform effect resource for background, WebGL, or immersive treatment.' },
      { value: 'chromatic-dispersion-webgl-system', label: 'Chromatic Dispersion WebGL System', description: 'Neuform effect resource for background, WebGL, or immersive treatment.' },
      { value: 'corner-lasers', label: 'Corner Lasers', description: 'Neuform effect resource for background, WebGL, or immersive treatment.' },
      { value: 'cyber-kinetic-background-field', label: 'Cyber Kinetic Background Field', description: 'Neuform effect resource for background, WebGL, or immersive treatment.' },
      { value: 'cyber-trail-webgl-background-system', label: 'Cyber-Trail WebGL Background System', description: 'Neuform effect resource for background, WebGL, or immersive treatment.' },
      { value: 'd3-interactive-point-cloud-globe', label: 'D3 Interactive Point-Cloud Globe', description: 'Neuform effect resource for background, WebGL, or immersive treatment.' },
      { value: 'dither-background', label: 'Dither Background', description: 'Neuform effect resource for background, WebGL, or immersive treatment.' },
      { value: 'dither-laser-dark-mode', label: 'Dither Laser Dark Mode', description: 'Neuform effect resource for background, WebGL, or immersive treatment.' },
      { value: 'globe-particles', label: 'Globe Particles', description: 'Neuform effect resource for background, WebGL, or immersive treatment.' },
      { value: 'grainy-stepped-gradient-noise', label: 'Grainy Stepped Gradient Noise', description: 'Neuform effect resource for background, WebGL, or immersive treatment.' },
      { value: 'high-contrast-skeuomorphic-clean', label: 'High Contrast Skeuomorphic Clean', description: 'Neuform effect resource for background, WebGL, or immersive treatment.' },
      { value: 'image-first-grid-layout', label: 'Image First Grid Layout', description: 'Neuform effect resource for background, WebGL, or immersive treatment.' },
      { value: 'industrial-webgl-minimalist-system', label: 'Industrial WebGL Minimalist System', description: 'Neuform effect resource for background, WebGL, or immersive treatment.' },
      { value: 'isometric-spatial-3d-system', label: 'Isometric Spatial 3D System', description: 'Neuform effect resource for background, WebGL, or immersive treatment.' },
      { value: 'magic-rings-telemetry-aesthetic', label: 'Magic Rings Telemetry Aesthetic', description: 'Neuform effect resource for background, WebGL, or immersive treatment.' },
      { value: 'mesh-gradient-dark-blue-clean', label: 'Mesh Gradient Dark Blue Clean', description: 'Neuform effect resource for background, WebGL, or immersive treatment.' },
      { value: 'organic-aetherial-webgl-background', label: 'Organic Aetherial WebGL Background', description: 'Neuform effect resource for background, WebGL, or immersive treatment.' },
      { value: 'procedural-mesh-network-background', label: 'Procedural Mesh Network Background', description: 'Neuform effect resource for background, WebGL, or immersive treatment.' },
      { value: 'split-layout-technical', label: 'Split Layout Technical', description: 'Neuform effect resource for background, WebGL, or immersive treatment.' },
      { value: 'technical-ascii-particle-field', label: 'Technical ASCII Particle Field', description: 'Neuform effect resource for background, WebGL, or immersive treatment.' },
      { value: 'technical-framed-grid-design-system', label: 'Technical Framed Grid Design System', description: 'Neuform effect resource for background, WebGL, or immersive treatment.' },
      { value: 'technical-shader-surface-webgl', label: 'Technical Shader Surface (WebGL)', description: 'Neuform effect resource for background, WebGL, or immersive treatment.' },
      { value: 'technical-tactical-globe-ui', label: 'Technical Tactical Globe UI', description: 'Neuform effect resource for background, WebGL, or immersive treatment.' },
      { value: 'technical-terminal-and-webgl-grid-system', label: 'Technical Terminal & WebGL Grid System', description: 'Neuform effect resource for background, WebGL, or immersive treatment.' },
      { value: 'technical-webgl-fluid-nebula-background', label: 'Technical WebGL Fluid Nebula Background', description: 'Neuform effect resource for background, WebGL, or immersive treatment.' },
      { value: 'technical-wireframe-info-layout', label: 'Technical Wireframe Info Layout', description: 'Neuform effect resource for background, WebGL, or immersive treatment.' },
      { value: 'webgl-3d-object', label: 'WebGL 3D Object', description: 'Neuform effect resource for background, WebGL, or immersive treatment.' },
      { value: 'webgl-laser', label: 'WebGL Laser', description: 'Neuform effect resource for background, WebGL, or immersive treatment.' },
    ],
  },
  {
    id: 'layout-systems',
    label: 'Layout Systems',
    choices: [
      { value: 'aura-asset-images', label: 'Aura Asset Images', description: 'Neuform layout/resource pattern for composition and framing.' },
      { value: 'container-lines', label: 'Container Lines', description: 'Neuform layout/resource pattern for composition and framing.' },
      { value: 'framed-grid-layout', label: 'Framed Grid Layout', description: 'Neuform layout/resource pattern for composition and framing.' },
      { value: 'nested-container-frames', label: 'Nested Container Frames', description: 'Neuform layout/resource pattern for composition and framing.' },
    ],
  },
  {
    id: 'motion-effects',
    label: 'Motion Effects',
    choices: [
      { value: 'agency-grid-layout-minimal', label: 'Agency Grid Layout Minimal', description: 'Neuform motion or transition resource.' },
      { value: 'atmospheric-meditative-dark-system', label: 'Atmospheric Meditative Dark System', description: 'Neuform motion or transition resource.' },
      { value: 'book-serif-index', label: 'Book Serif Index', description: 'Neuform motion or transition resource.' },
      { value: 'clean-minimal-beige-light-mode', label: 'Clean Minimal Beige Light Mode', description: 'Neuform motion or transition resource.' },
      { value: 'corner-diagonals', label: 'Corner Diagonals', description: 'Neuform motion or transition resource.' },
      { value: 'cursor-reactive-flashlight-glow-border', label: 'Cursor-Reactive Flashlight Glow Border', description: 'Neuform motion or transition resource.' },
      { value: 'editorial-tech', label: 'Editorial Tech', description: 'Neuform motion or transition resource.' },
      { value: 'glass-dark-mode-clock', label: 'Glass Dark Mode Clock', description: 'Neuform motion or transition resource.' },
      { value: 'gooey-blob-system', label: 'Gooey Blob System', description: 'Neuform motion or transition resource.' },
      { value: 'gsap-motion', label: 'GSAP Motion', description: 'Neuform motion or transition resource.' },
      { value: 'interactive-border-gradient-glow', label: 'Interactive Border Gradient Glow', description: 'Neuform motion or transition resource.' },
      { value: 'kinetic-radial-sculpture-system', label: 'Kinetic Radial Sculpture System', description: 'Neuform motion or transition resource.' },
      { value: 'light-mode-paper-technical', label: 'Light Mode Paper Technical', description: 'Neuform motion or transition resource.' },
      { value: 'marquee', label: 'Marquee', description: 'Neuform motion or transition resource.' },
      { value: 'masked-reveal', label: 'Masked Reveal', description: 'Neuform motion or transition resource.' },
      { value: 'nested-container-clean-agency', label: 'Nested Container Clean Agency', description: 'Neuform motion or transition resource.' },
      { value: 'orange-clean-paper-saas', label: 'Orange Clean Paper SaaS', description: 'Neuform motion or transition resource.' },
      { value: 'premium-gradient-border-system', label: 'Premium Gradient Border System', description: 'Neuform motion or transition resource.' },
      { value: 'stepped-neon-v-curve-glass-system', label: 'Stepped Neon V-Curve Glass System', description: 'Neuform motion or transition resource.' },
    ],
  },
  {
    id: 'surface-material-effects',
    label: 'Surface & Material',
    choices: [
      { value: 'beautiful-shadows', label: 'Beautiful Shadows', description: 'Neuform surface/material resource.' },
      { value: 'border-gradients', label: 'Border Gradients', description: 'Neuform surface/material resource.' },
      { value: 'number-details', label: 'Number Details', description: 'Neuform surface/material resource.' },
      { value: 'progressive-blur', label: 'Progressive Blur', description: 'Neuform surface/material resource.' },
      { value: 'skeuomorphic-ui', label: 'Skeuomorphic UI', description: 'Neuform surface/material resource.' },
      { value: 'solar-duotone-bold', label: 'Solar Duotone Bold', description: 'Neuform surface/material resource.' },
    ],
  },
  {
    id: 'typography-effects',
    label: 'Typography',
    choices: [
      { value: 'company-logos', label: 'Company Logos', description: 'Neuform typography/resource treatment.' },
    ],
  },
] satisfies Array<{ id: string; label: string; choices: Choice[] }>;

const EFFECT_CHOICES_BY_ID = new Map(
  [...BASE_EFFECT_CHOICES, ...EFFECT_CATEGORIES.flatMap(category => category.choices)]
    .map(choice => [String(choice.value), choice]),
);

const MULTI_STEPS = new Set<StepId>(['effects', 'interaction']);

function paletteKey(value: FrontendDirectionPalette): string {
  return typeof value === 'string' ? value : value.id;
}

function paletteLabel(value: FrontendDirectionPalette): string {
  return typeof value === 'string' ? frontendDirectionLabel(value) : value.label;
}

function paletteColors(value: FrontendDirectionPalette): string[] {
  return resolveFrontendPaletteColors(value, ['#0F172A', '#22D3EE', '#F97316']);
}

function isPaletteDelegated(value?: FrontendDirectionPalette): boolean {
  return value === 'agent_decides' || (typeof value === 'object' && value.kind === 'agent_decides');
}

function customPalette(colors: string[]): FrontendDirectionPaletteChoice {
  return { kind: 'custom', id: CUSTOM_PALETTE_ID, label: 'Custom palette', colors };
}

function defaultPaletteForTheme(theme: ThemeType): FrontendDirectionPaletteChoice {
  return LIGHT_APP_THEMES.has(theme) ? DEFAULT_LIGHT_PALETTE : DEFAULT_DARK_PALETTE;
}

function orderedPaletteGroups(theme: ThemeType): PaletteChoiceGroup[] {
  const preferred = LIGHT_APP_THEMES.has(theme) ? 'light' : 'dark';
  return [...PALETTE_GROUPS].sort((left, right) => {
    if (left.id === preferred) return -1;
    if (right.id === preferred) return 1;
    return 0;
  });
}

function stepHasSelection(state: PickerState, step: StepId): boolean {
  if (step === 'review') return true;
  const value = state[step];
  return Array.isArray(value) ? value.length > 0 : Boolean(value);
}

function stepIsDelegated(state: PickerState, step: StepId): boolean {
  if (step === 'review') return false;
  const value = state[step];
  if (step === 'palette') return isPaletteDelegated(value as FrontendDirectionPalette | undefined);
  return Array.isArray(value) ? value.includes('agent_decides' as never) : value === 'agent_decides';
}

function previewableEffects(state: PickerState, hover: { step: StepId; value: ChoiceValue } | null): FrontendDirectionEffect[] {
  if (hover?.step === 'effects' && resolveEffectPreview(String(hover.value))) {
    return [hover.value as FrontendDirectionEffect];
  }
  return (state.effects ?? []).filter(effect => resolveEffectPreview(String(effect)));
}

function previewState(state: PickerState, hover: { step: StepId; value: ChoiceValue } | null, defaultPalette: FrontendDirectionPaletteChoice): Required<PickerState> {
  const next: PickerState = { ...state };
  if (hover && hover.step !== 'review') {
    if (hover.step === 'effects') {
      next.effects = previewableEffects(state, hover);
    } else if (MULTI_STEPS.has(hover.step)) next[hover.step as 'effects' | 'interaction'] = [hover.value as never];
    else (next as Record<string, ChoiceValue>)[hover.step] = hover.value;
  }
  return {
    layout: next.layout ?? 'agent_decides',
    density: next.density ?? 'balanced',
    palette: next.palette ?? defaultPalette,
    shape: next.shape ?? 'slightly_rounded',
    effects: previewableEffects(next, hover),
    assets: next.assets ?? 'icons_only',
    interaction: next.interaction?.length ? next.interaction : ['basic_navigation'],
    tone: next.tone ?? 'technical',
  };
}

function PaletteCircle({ colors, className = 'h-10 w-10' }: { colors: string[]; className?: string }) {
  const safeColors = colors.length > 0 ? colors : ['#64748B', '#94A3B8'];
  const background = safeColors.length === 2
    ? `linear-gradient(90deg, ${safeColors[0]} 0% 50%, ${safeColors[1]} 50% 100%)`
    : `conic-gradient(from -90deg, ${safeColors[0]} 0deg 120deg, ${safeColors[1] ?? safeColors[0]} 120deg 240deg, ${safeColors[2] ?? safeColors[1] ?? safeColors[0]} 240deg 360deg)`;
  return <span className={`${className} shrink-0 rounded-full border border-border-panel`} style={{ background }} />;
}

function PaletteButton({
  choice,
  currentKey,
  onHover,
  onSelect,
}: {
  choice: Choice;
  currentKey: string | null;
  onHover: (hover: { step: StepId; value: ChoiceValue } | null) => void;
  onSelect: (value: FrontendDirectionPalette) => void;
}) {
  const value = choice.value as FrontendDirectionPalette;
  const selected = currentKey === paletteKey(value);
  const delegated = isPaletteDelegated(value);
  return (
    <button
      type="button"
      onMouseEnter={() => onHover({ step: 'palette', value })}
      onMouseLeave={() => onHover(null)}
      onClick={() => onSelect(value)}
      className={`flex items-center gap-3 rounded-lg border p-3 text-left transition-colors ${
        selected
          ? delegated
            ? 'border-blue-400/70 bg-blue-500/10 text-blue-100'
            : 'border-accent-primary bg-accent-primary/10 text-text-primary'
          : 'border-border-panel bg-bg-panel text-text-secondary hover:border-accent-primary/50 hover:bg-bg-surface'
      }`}
    >
      {delegated ? <span className="flex h-10 w-10 items-center justify-center rounded-full border border-blue-300/40 bg-blue-500/10"><Bot size={16} className="text-blue-300" /></span> : <PaletteCircle colors={paletteColors(value)} />}
      <span className="min-w-0">
        <span className="block truncate text-[12px] font-semibold">{choice.label}</span>
        <span className="mt-1 block text-[10px] leading-relaxed text-text-muted">{choice.description}</span>
      </span>
    </button>
  );
}

function ShapeBlock({ className = '', color = 'rgba(148,163,184,.45)' }: { className?: string; color?: string }) {
  return <div className={`rounded-[inherit] ${className}`} style={{ backgroundColor: color }} />;
}

function AssetHints({ asset, radius, accent, muted }: { asset: FrontendDirectionAssets; radius: string; accent: string; muted: string }) {
  if (asset === 'no_imagery') return null;
  if (asset === 'data_visualization') {
    return (
      <div className="absolute bottom-5 right-5 flex h-16 w-28 items-end gap-1.5 opacity-80">
        {[35, 58, 45, 78, 62, 90].map((height, index) => (
          <span key={index} className={`${radius} flex-1`} style={{ height: `${height}%`, backgroundColor: index % 2 ? accent : muted }} />
        ))}
      </div>
    );
  }
  if (asset === 'icons_only') {
    return (
      <div className="absolute right-5 top-5 grid grid-cols-3 gap-1.5 opacity-80">
        {[0, 1, 2, 3, 4, 5].map(index => <span key={index} className="h-4 w-4 rounded-sm border" style={{ borderColor: accent }} />)}
      </div>
    );
  }
  if (asset === 'illustration' || asset === 'generated_bitmap') {
    return <div className={`absolute right-5 top-5 h-20 w-28 ${radius} opacity-80`} style={{ background: `radial-gradient(circle at 30% 30%, ${accent}, transparent 32%), linear-gradient(135deg, ${muted}, transparent)` }} />;
  }
  if (asset === 'stock_photography' || asset === 'real_product_imagery') {
    return (
      <div className={`absolute right-5 top-5 h-20 w-28 overflow-hidden ${radius} border border-white/10 opacity-85`} style={{ background: `linear-gradient(135deg, ${muted}, ${accent})` }}>
        <ImageIcon className="absolute left-3 top-3 text-white/60" size={18} />
        <span className="absolute bottom-0 left-0 h-8 w-full bg-black/25" />
      </div>
    );
  }
  return null;
}

function effectPathSlug(path?: string): string {
  return String(path ?? '').split('/').pop()?.replace(/\.md$/, '') ?? '';
}

function effectAlias(id?: string): string {
  return String(id ?? '').replace(/^neuform[_-]/, '').replace(/_/g, '-').replace(/-[a-z0-9]{6}$/, '');
}

function firstParagraphAfterHeading(markdown: string, heading: string): string | null {
  const lines = markdown.split(/\r?\n/);
  const headingIndex = lines.findIndex(line => line.trim().toLowerCase() === heading.toLowerCase());
  if (headingIndex < 0) return null;
  const paragraph: string[] = [];
  for (const line of lines.slice(headingIndex + 1)) {
    const trimmed = line.trim();
    if (trimmed.startsWith('## ')) break;
    if (!trimmed && paragraph.length === 0) continue;
    if (!trimmed) break;
    paragraph.push(trimmed.replace(/^- /, ''));
  }
  return paragraph.length > 0 ? paragraph.join(' ') : null;
}

const NEUFORM_SKILL_DESCRIPTIONS = (() => {
  const descriptions = new Map<string, string>();
  const docsBySlug = new Map<string, string>();
  for (const [path, content] of Object.entries(NEUFORM_EFFECT_DOCS)) {
    docsBySlug.set(effectPathSlug(path.replace(/\\/g, '/')), content);
  }
  const entries = (neuformIndex.entries ?? []) as NeuformIndexEntry[];
  for (const entry of entries) {
    const slug = effectPathSlug(entry.path);
    const intent = firstParagraphAfterHeading(docsBySlug.get(slug) ?? '', '## Intent');
    if (!intent) continue;
    const aliases = [
      entry.id,
      entry.id?.replace(/^neuform_/, ''),
      entry.source?.originId,
      slug,
      effectAlias(entry.id),
      effectAlias(entry.source?.originId),
      effectAlias(slug),
    ];
    for (const alias of aliases) {
      if (!alias) continue;
      descriptions.set(String(alias), intent);
      descriptions.set(String(alias).replace(/_/g, '-'), intent);
    }
  }
  return descriptions;
})();

function neuformEffectDescription(effectId: ChoiceValue): string | null {
  const id = String(effectId);
  return NEUFORM_SKILL_DESCRIPTIONS.get(id) ?? NEUFORM_SKILL_DESCRIPTIONS.get(id.replace(/_/g, '-')) ?? null;
}

function effectChoiceDescription(effectId: ChoiceValue): string | null {
  const id = String(effectId);
  const choice = EFFECT_CHOICES_BY_ID.get(id);
  return neuformEffectDescription(effectId) ?? choice?.description ?? null;
}

function WireframePreview({
  state,
  emptyLayout,
  review,
  isolatedEffect,
}: {
  state: Required<PickerState>;
  emptyLayout: boolean;
  review: boolean;
  isolatedEffect?: FrontendDirectionEffect | null;
}) {
  const compact = state.density === 'compact';
  const spacious = state.density === 'spacious';
  const panelRadius = state.shape === 'sharp_editorial'
    ? 'rounded-none'
    : state.shape === 'boxy'
      ? 'rounded-[2px]'
      : state.shape === 'soft'
        ? 'rounded-2xl'
        : state.shape === 'pill_heavy'
          ? 'rounded-lg'
          : 'rounded-md';
  const controlRadius = state.shape === 'pill_heavy'
    ? 'rounded-full'
    : state.shape === 'soft'
      ? 'rounded-xl'
      : panelRadius;
  const gap = compact ? 'gap-1.5' : spacious ? 'gap-4' : 'gap-2.5';
  const padding = compact ? 'p-3' : spacious ? 'p-6' : 'p-4';
  const colors = paletteColors(state.palette);
  const base = colors[0] ?? '#0F172A';
  const accent = colors[1] ?? '#22D3EE';
  const secondary = colors[2] ?? accent;
  const light = ['#f8fafc', '#ffffff', '#f9fafb', '#fafaf9', '#f7faf8', '#f6fefc', '#fff7f9', '#fffbf5', '#f6f5f2'].includes(base.toLowerCase());
  const muted = light ? 'rgba(71,85,105,.22)' : 'rgba(148,163,184,.24)';
  const block = light ? 'rgba(71,85,105,.35)' : 'rgba(148,163,184,.45)';
  const shellStyle = {
    background: base,
    borderColor: light ? '#CBD5E1' : '#334155',
  };

  if (isolatedEffect && resolveEffectPreview(String(isolatedEffect))) {
    return (
      <div className="relative h-full w-full overflow-hidden border transition-opacity duration-300" style={shellStyle}>
        <EffectPreviewStage effects={[isolatedEffect]} mode="live" palette={state.palette} quality="effect" />
      </div>
    );
  }

  if (emptyLayout) {
    return <div className="h-full w-full border transition-colors duration-300" style={shellStyle} />;
  }

  const layout = state.layout === 'agent_decides' ? 'dashboard' : state.layout;
  const shapeBorder = state.shape === 'sharp_editorial'
    ? 'border border-current/30'
    : state.shape === 'boxy'
      ? 'border-2 border-current/20'
      : 'border border-white/10';
  const panelClass = `${panelRadius} ${shapeBorder}`;

  return (
    <div className={`relative h-full w-full overflow-hidden border ${padding} transition-opacity duration-300`} style={shellStyle}>
      {state.shape === 'sharp_editorial' && <div className="pointer-events-none absolute inset-0 opacity-50 [background-image:linear-gradient(90deg,rgba(148,163,184,.24)_1px,transparent_1px)] [background-size:64px_100%]" />}
      {state.shape === 'boxy' && <div className="pointer-events-none absolute left-4 top-4 h-3 w-12 border-t-2 border-l-2 opacity-70" style={{ borderColor: accent }} />}
      <div className={`relative z-10 flex h-full ${gap} ${layout === 'landing_page' || layout === 'portfolio' || layout === 'content_first_site' || layout === 'product_commerce' ? 'flex-col' : ''}`}>
        {layout === 'dashboard' && (
          <>
            <div className={`${panelClass} w-[18%] p-2`} style={{ backgroundColor: muted }}>
              <ShapeBlock className="mb-3 h-3 w-2/3" color={accent} />
              <ShapeBlock className="mb-1.5 h-2.5 w-full" color={block} />
              <ShapeBlock className="mb-1.5 h-2.5 w-4/5" color={block} />
              <ShapeBlock className="h-2.5 w-5/6" color={block} />
            </div>
            <div className={`flex flex-1 flex-col ${gap}`}>
              <div className={panelClass} style={{ height: '12%', backgroundColor: muted }} />
              <div className={`grid grid-cols-4 ${gap} h-[20%]`}>
                {[0, 1, 2, 3].map(i => <div key={i} className={i === 0 && state.shape === 'pill_heavy' ? controlRadius : panelClass} style={{ backgroundColor: i === 0 ? accent : muted }} />)}
              </div>
              <div className={`grid flex-1 grid-cols-[1.4fr_.9fr] ${gap}`}>
                <div className={`${panelClass} p-3`} style={{ backgroundColor: muted }}><ShapeBlock className="h-full w-full opacity-70" color={secondary} /></div>
                <div className={panelClass} style={{ backgroundColor: muted }} />
              </div>
              <div className={panelClass} style={{ height: '18%', backgroundColor: muted }} />
            </div>
          </>
        )}
        {layout === 'single_screen_tool' && (
          <div className={`flex h-full w-full flex-col ${gap}`}>
            <div className={`${panelClass} flex h-[14%] items-center gap-2 p-2`} style={{ backgroundColor: muted }}>
              <ShapeBlock className="h-3 w-20" color={block} />
              <ShapeBlock className={`h-5 w-16 ${controlRadius}`} color={accent} />
              <ShapeBlock className="ml-auto h-5 w-20" color={block} />
            </div>
            <div className={`grid flex-1 grid-cols-[.7fr_1.3fr] ${gap}`}>
              <div className={`${panelClass} p-3`} style={{ backgroundColor: muted }}><ShapeBlock className="mb-2 h-3 w-4/5" color={block} /><ShapeBlock className="mb-2 h-16 w-full" color={secondary} /><ShapeBlock className="h-10 w-2/3" color={accent} /></div>
              <div className={`${panelClass} p-4`} style={{ backgroundColor: muted }}><ShapeBlock className="h-full w-full opacity-70" color={block} /></div>
            </div>
          </div>
        )}
        {layout === 'workbench_editor' && (
          <>
            <div className={panelClass} style={{ width: '18%', backgroundColor: muted }} />
            <div className={`${panelClass} flex-1 p-3`} style={{ backgroundColor: muted }}><ShapeBlock className="h-full w-full opacity-70" color={secondary} /></div>
            <div className={panelClass} style={{ width: '22%', backgroundColor: muted }} />
          </>
        )}
        {(layout === 'landing_page' || layout === 'portfolio' || layout === 'product_commerce' || layout === 'content_first_site') && (
          <>
            <div className={`${panelClass} h-[50%] p-5`} style={{ backgroundColor: muted }}>
              <ShapeBlock className="mb-3 h-5 w-2/5" color={accent} />
              <ShapeBlock className="mb-2 h-3 w-3/5" color={block} />
              <ShapeBlock className="h-3 w-2/5" color={block} />
            </div>
            <div className={`grid flex-1 grid-cols-3 ${gap}`}>
              {[0, 1, 2].map(i => <div key={i} className={panelClass} style={{ backgroundColor: i === 1 ? secondary : muted }} />)}
            </div>
          </>
        )}
        {layout === 'docs_knowledge_base' && (
          <>
            <div className={panelClass} style={{ width: '20%', backgroundColor: muted }} />
            <div className={`${panelClass} flex-1 p-4`} style={{ backgroundColor: muted }}>
              <ShapeBlock className="mb-3 h-5 w-1/2" color={accent} />
              <ShapeBlock className="mb-2 h-2.5 w-full" color={block} />
              <ShapeBlock className="mb-2 h-2.5 w-5/6" color={block} />
              <ShapeBlock className="mt-5 h-20 w-full" color={secondary} />
            </div>
            <div className={panelClass} style={{ width: '18%', backgroundColor: muted }} />
          </>
        )}
        {layout === 'game_interactive' && (
          <div className={`flex h-full w-full flex-col ${gap}`}>
            <div className={`${panelClass} flex-1 p-5`} style={{ backgroundColor: muted }}><ShapeBlock className="h-full w-full" color={accent} /></div>
            <div className={panelClass} style={{ height: '18%', backgroundColor: muted }} />
          </div>
        )}
      </div>
      <AssetHints asset={state.assets} radius={controlRadius} accent={accent} muted={secondary} />
      {review && <div className="pointer-events-none absolute bottom-2 right-2 rounded border border-slate-500/50 bg-black/20 px-2 py-1 text-[9px] font-semibold uppercase tracking-wide text-slate-300">Low-fidelity preview</div>}
    </div>
  );
}

export function AppSiteThemePicker({ open, onClose, onApply }: AppSiteThemePickerProps) {
  const appTheme = useWorkspaceStore(s => s.theme);
  const defaultPalette = useMemo(() => defaultPaletteForTheme(appTheme), [appTheme]);
  const paletteGroups = useMemo(() => orderedPaletteGroups(appTheme), [appTheme]);
  const [activeStep, setActiveStep] = useState<StepId>('layout');
  const [state, setState] = useState<PickerState>(() => ({ palette: defaultPaletteForTheme(useWorkspaceStore.getState().theme) }));
  const [completed, setCompleted] = useState<Set<StepId>>(new Set());
  const [hover, setHover] = useState<{ step: StepId; value: ChoiceValue } | null>(null);
  const [showMissing, setShowMissing] = useState(false);
  const [customColors, setCustomColors] = useState(DEFAULT_CUSTOM_COLORS);
  const [effectCategory, setEffectCategory] = useState(EFFECT_CATEGORIES[0].id);
  const [isolatedEffect, setIsolatedEffect] = useState<FrontendDirectionEffect | null>(null);

  const stepIndex = STEPS.findIndex(step => step.id === activeStep);
  const preview = useMemo(() => previewState(state, hover, defaultPalette), [state, hover, defaultPalette]);
  const missingSteps = STEPS.filter(step => step.id !== 'review' && !stepHasSelection(state, step.id)).map(step => step.id);
  const emptyLayout = activeStep === 'layout' && !state.layout && hover?.step !== 'layout';
  const activeEffectCategory = EFFECT_CATEGORIES.find(category => category.id === effectCategory) ?? EFFECT_CATEGORIES[0];

  useEffect(() => {
    setState(current => {
      const currentKey = current.palette ? paletteKey(current.palette) : null;
      const selectedDefault = currentKey === DEFAULT_LIGHT_PALETTE.id || currentKey === DEFAULT_DARK_PALETTE.id || currentKey === null;
      return selectedDefault ? { ...current, palette: defaultPalette } : current;
    });
  }, [defaultPalette]);

  if (!open) return null;

  function selectChoice(step: Exclude<StepId, 'review'>, value: ChoiceValue) {
    setShowMissing(false);
    setState(current => {
      if (step === 'effects') {
        const nextValue = value as FrontendDirectionEffect;
        if (nextValue === 'agent_decides' || nextValue === 'none') return { ...current, effects: [nextValue] };
        const currentValues = (current.effects ?? []).filter(item => item !== 'agent_decides' && item !== 'none');
        if (!currentValues.includes(nextValue) && effectPreviewConflictReason(currentValues.map(String), String(nextValue))) return current;
        return { ...current, effects: currentValues.includes(nextValue) ? currentValues.filter(item => item !== nextValue) : [...currentValues, nextValue] };
      }
      if (step === 'interaction') {
        const nextValue = value as FrontendDirectionInteraction;
        if (nextValue === 'agent_decides' || nextValue === 'static') return { ...current, interaction: [nextValue] };
        const currentValues = (current.interaction ?? []).filter(item => item !== 'agent_decides' && item !== 'static');
        return { ...current, interaction: currentValues.includes(nextValue) ? currentValues.filter(item => item !== nextValue) : [...currentValues, nextValue] };
      }
      return { ...current, [step]: value };
    });
  }

  function selectCustomPalette(colors = customColors) {
    setShowMissing(false);
    setState(current => ({ ...current, palette: customPalette(colors) }));
  }

  function updateCustomColor(index: number, color: string) {
    const next = customColors.map((item, itemIndex) => (itemIndex === index ? color : item));
    setCustomColors(next);
    selectCustomPalette(next);
    setHover({ step: 'palette', value: customPalette(next) });
  }

  function goNext() {
    if (activeStep !== 'review' && stepHasSelection(state, activeStep)) {
      setCompleted(current => new Set(current).add(activeStep));
    }
    setIsolatedEffect(null);
    setActiveStep(STEPS[Math.min(STEPS.length - 1, stepIndex + 1)].id);
    setHover(null);
  }

  function goBack() {
    setIsolatedEffect(null);
    setActiveStep(STEPS[Math.max(0, stepIndex - 1)].id);
    setHover(null);
  }

  function apply() {
    if (missingSteps.length > 0) {
      setShowMissing(true);
      setIsolatedEffect(null);
      setActiveStep(missingSteps[0]);
      return;
    }
    onApply(normalizeFrontendDirectionSpec({
      layout: state.layout!,
      density: state.density!,
      palette: state.palette!,
      shape: state.shape!,
      effects: state.effects!,
      assets: state.assets!,
      interaction: state.interaction!,
      tone: state.tone!,
    }));
  }

  function renderGenericChoices(step: Exclude<StepId, 'review' | 'palette' | 'effects'>) {
    return CHOICES[step].map(choice => {
      const current = state[step];
      const selected = Array.isArray(current) ? current.includes(choice.value as never) : current === choice.value;
      const delegated = choice.value === 'agent_decides';
      return (
        <button
          key={String(choice.value)}
          type="button"
          onMouseEnter={() => setHover({ step, value: choice.value })}
          onMouseLeave={() => setHover(null)}
          onClick={() => selectChoice(step, choice.value)}
          className={`rounded-lg border p-3 text-left transition-colors ${
            selected
              ? delegated
                ? 'border-blue-400/70 bg-blue-500/10 text-blue-100'
                : 'border-accent-primary bg-accent-primary/10 text-text-primary'
              : 'border-border-panel bg-bg-panel text-text-secondary hover:border-accent-primary/50 hover:bg-bg-surface'
          }`}
        >
          <div className="flex items-center gap-2 text-[12px] font-semibold">
            {delegated && <Bot size={13} className="text-blue-300" />}
            {choice.label}
          </div>
          <p className="mt-1 text-[10px] leading-relaxed text-text-muted">{choice.description}</p>
        </button>
      );
    });
  }

  function renderPaletteChoices() {
    const currentKey = state.palette ? paletteKey(state.palette) : null;
    return (
      <>
        <PaletteButton choice={AGENT_PALETTE_CHOICE} currentKey={currentKey} onHover={setHover} onSelect={value => selectChoice('palette', value)} />
        {paletteGroups.map(group => (
          <div key={group.id} className="col-span-full grid grid-cols-2 gap-2 lg:grid-cols-3">
            <div className="col-span-full flex items-center justify-between pt-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-text-muted">
              <span>{group.label}</span>
              {group.choices[0]?.value === defaultPalette && <span className="normal-case tracking-normal text-accent-primary">Default for current app theme</span>}
            </div>
            {group.choices.map(choice => (
              <PaletteButton key={paletteKey(choice.value as FrontendDirectionPalette)} choice={choice} currentKey={currentKey} onHover={setHover} onSelect={value => selectChoice('palette', value)} />
            ))}
          </div>
        ))}
        <div
          onMouseEnter={() => setHover({ step: 'palette', value: customPalette(customColors) })}
          onMouseLeave={() => setHover(null)}
          className={`rounded-lg border p-3 transition-colors ${
            currentKey === CUSTOM_PALETTE_ID
              ? 'border-accent-primary bg-accent-primary/10'
              : 'border-border-panel bg-bg-panel hover:border-accent-primary/50 hover:bg-bg-surface'
          }`}
        >
          <button type="button" onClick={() => selectCustomPalette()} className="flex w-full items-center gap-3 text-left">
            <PaletteCircle colors={customColors} />
            <span className="min-w-0">
              <span className="block truncate text-[12px] font-semibold text-text-primary">Custom palette</span>
              <span className="mt-1 block text-[10px] leading-relaxed text-text-muted">Pick three colors and preview the circle live.</span>
            </span>
          </button>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {customColors.map((color, index) => (
              <label key={index} className="flex items-center gap-2 rounded border border-border-panel bg-bg-app px-2 py-1.5 text-[10px] text-text-muted">
                <input type="color" value={color} onChange={event => updateCustomColor(index, event.target.value)} className="h-6 w-7 border-0 bg-transparent p-0" />
                <span className="truncate">{color.toUpperCase()}</span>
              </label>
            ))}
          </div>
        </div>
      </>
    );
  }

  function renderEffectsChoices() {
    const current = state.effects ?? [];
    const hoveredEffectDescription = hover?.step === 'effects' ? effectChoiceDescription(hover.value) : null;
    return (
      <div className="relative col-span-full grid grid-cols-[150px_1fr] gap-3">
        <div className="space-y-1.5">
          {EFFECT_CATEGORIES.map(category => (
            <button
              key={category.id}
              type="button"
              onClick={() => setEffectCategory(category.id)}
              className={`flex w-full items-center gap-2 rounded-md border px-2.5 py-2 text-left text-[11px] font-semibold transition-colors ${
                category.id === activeEffectCategory.id
                  ? 'border-accent-primary bg-accent-primary/10 text-text-primary'
                  : 'border-border-panel bg-bg-panel text-text-muted hover:text-text-primary'
              }`}
            >
              <Layers size={13} />
              {category.label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 items-start gap-2 lg:grid-cols-3 xl:grid-cols-4">
          {[...BASE_EFFECT_CHOICES, ...activeEffectCategory.choices].map(choice => {
            const selected = current.includes(choice.value as FrontendDirectionEffect);
            const delegated = choice.value === 'agent_decides';
            const specialChoice = choice.value === 'agent_decides' || choice.value === 'none';
            const hasCardPreview = Boolean(resolveEffectPreview(String(choice.value)));
            const conflictReason = !selected && !specialChoice ? effectPreviewConflictReason(current.map(String), String(choice.value)) : null;
            const disabled = Boolean(conflictReason);
            return (
              <div
                key={String(choice.value)}
                role="button"
                tabIndex={disabled ? -1 : 0}
                onMouseEnter={() => setHover({ step: 'effects', value: choice.value })}
                onMouseLeave={() => setHover(null)}
                onClick={() => {
                  if (!disabled) selectChoice('effects', choice.value);
                }}
                onKeyDown={event => {
                  if (!disabled && (event.key === 'Enter' || event.key === ' ')) {
                    event.preventDefault();
                    selectChoice('effects', choice.value);
                  }
                }}
                title={conflictReason ?? choice.label}
                aria-disabled={disabled}
                className={`relative flex min-h-[70px] cursor-pointer flex-col overflow-hidden rounded-lg border p-2.5 text-left transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-accent-primary/60 ${
                  disabled
                    ? 'cursor-not-allowed border-border-panel bg-bg-panel/50 text-text-muted opacity-45'
                    : selected
                    ? delegated
                      ? 'border-blue-400/70 bg-blue-500/10 text-blue-100'
                      : 'border-accent-primary bg-accent-primary/10 text-text-primary'
                    : 'border-border-panel bg-bg-panel text-text-secondary hover:border-accent-primary/50 hover:bg-bg-surface'
                }`}
              >
                {hasCardPreview && (
                  <>
                    <EffectPreviewStage effects={[choice.value as FrontendDirectionEffect]} mode="poster" palette={preview.palette} quality="thumbnail" />
                    <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-bg-panel/10 via-bg-panel/25 to-bg-panel/80" />
                  </>
                )}
                <div className="relative z-10 flex w-full items-start gap-2">
                  <span className="min-w-0 flex-1 text-[11px] font-semibold leading-snug text-text-primary">
                    {choice.label}
                  </span>
                  {!specialChoice && hasCardPreview && (
                    <button
                      type="button"
                      onClick={event => {
                        event.stopPropagation();
                        setHover(null);
                        setIsolatedEffect(choice.value as FrontendDirectionEffect);
                      }}
                      onMouseDown={event => event.stopPropagation()}
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded border transition-colors ${
                        isolatedEffect === choice.value
                          ? 'border-accent-primary bg-accent-primary/15 text-accent-primary'
                          : 'border-border-panel text-text-muted hover:border-accent-primary hover:text-accent-primary'
                      }`}
                      aria-label={`Preview ${choice.label}`}
                      aria-pressed={isolatedEffect === choice.value}
                    >
                      <Eye size={12} />
                    </button>
                  )}
                </div>
                {selected && <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-accent-primary text-accent-text"><Check size={10} /></span>}
              </div>
            );
          })}
        </div>
        {hoveredEffectDescription && (
          <div className="pointer-events-none fixed left-1/2 top-24 z-[140] w-[360px] max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-xl border border-border-panel bg-bg-app/90 p-3 text-[11px] leading-relaxed text-text-secondary shadow-2xl backdrop-blur-md">
            {hoveredEffectDescription}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/65 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className={`flex overflow-hidden rounded-xl border border-border-panel bg-bg-app shadow-2xl ${
        activeStep === 'review'
          ? 'h-[94vh] w-[98vw] max-w-[1760px]'
          : 'h-[82vh] w-[92vw] max-w-[1180px]'
      }`}>
        <aside className="w-52 shrink-0 border-r border-border-panel bg-bg-titlebar p-3">
          <div className="mb-4 flex items-center gap-2 px-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-accent-primary">
            <Sparkles size={14} />
            Theme Picker
          </div>
          <div className="space-y-1.5">
            {STEPS.map((step, index) => {
              const selected = step.id === activeStep;
              const missing = showMissing && missingSteps.includes(step.id);
              const done = completed.has(step.id) && stepHasSelection(state, step.id);
              const delegated = done && stepIsDelegated(state, step.id);
              return (
                <button
                  key={step.id}
                  type="button"
                  onClick={() => {
                    setIsolatedEffect(null);
                    setActiveStep(step.id);
                    setHover(null);
                  }}
                  className={`flex w-full items-center gap-2 rounded-md border px-2.5 py-2 text-left text-[11px] transition-all ${
                    missing
                      ? 'animate-pulse border-red-400 bg-red-500/10 text-red-200 shadow-[0_0_14px_rgba(248,113,113,.45)]'
                      : delegated
                        ? 'border-blue-400/60 bg-blue-500/10 text-blue-200'
                        : done
                          ? 'border-green-400/60 bg-green-500/10 text-green-200'
                          : selected
                            ? 'border-accent-primary bg-accent-primary/10 text-text-primary'
                            : 'border-border-panel bg-bg-panel text-text-muted hover:text-text-secondary'
                  }`}
                >
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-current/30 text-[10px]">{index + 1}</span>
                  <span className="min-w-0 flex-1 truncate font-semibold">{step.label}</span>
                  {delegated ? <Bot size={12} /> : done ? <Check size={12} /> : null}
                </button>
              );
            })}
          </div>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center justify-between gap-3 border-b border-border-panel bg-bg-titlebar px-4 py-3">
            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-text-muted">App/Site direction</div>
              <h2 className="mt-1 truncate text-sm font-semibold text-text-primary">
                {activeStep === 'layout' ? 'What would you like to build?' : STEPS[stepIndex].label}
              </h2>
            </div>
            <button type="button" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded border border-border-panel text-text-muted hover:bg-bg-surface hover:text-text-primary" aria-label="Close theme picker">
              <X size={14} />
            </button>
          </header>

          <div className={`flex-1 overflow-hidden p-4 ${activeStep === 'review' ? '' : 'space-y-4'}`}>
            {activeStep !== 'review' && (
              <div className={`grid max-h-[35%] gap-2 overflow-y-auto pr-1 ${activeStep === 'effects' ? 'grid-cols-1' : 'grid-cols-2 lg:grid-cols-3'}`}>
                {activeStep === 'palette'
                  ? renderPaletteChoices()
                  : activeStep === 'effects'
                    ? renderEffectsChoices()
                    : renderGenericChoices(activeStep)}
              </div>
            )}

            {activeStep === 'review' ? (
              <div className="flex h-full min-h-0 items-center justify-center">
                <div className="aspect-video h-full max-h-full w-auto max-w-full rounded-xl border border-border-panel bg-bg-panel p-3">
                  <WireframePreview state={preview} emptyLayout={emptyLayout} review isolatedEffect={isolatedEffect} />
                </div>
              </div>
            ) : (
              <div className="h-[calc(65%-1rem)] min-h-0 rounded-xl border border-border-panel bg-bg-panel p-3">
                <WireframePreview state={preview} emptyLayout={emptyLayout} review={false} isolatedEffect={isolatedEffect} />
              </div>
            )}
          </div>

          <footer className="flex items-center justify-between gap-3 border-t border-border-panel bg-bg-titlebar px-4 py-3">
            <div className="min-w-0 truncate text-[11px] text-text-muted">
              {showMissing && missingSteps.length > 0
                ? `Missing: ${missingSteps.map(step => frontendDirectionLabel(step)).join(', ')}`
                : activeStep === 'review'
                  ? 'Review the broad direction before launching the workflow.'
                  : activeStep === 'palette'
                    ? `Hover previews direction. Selected palette: ${state.palette ? paletteLabel(state.palette) : 'None'}`
                    : 'Hover previews direction. Click commits the section choice.'}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button type="button" onClick={goBack} disabled={stepIndex === 0} className="flex items-center gap-1 rounded border border-border-panel px-3 py-1.5 text-[12px] font-semibold text-text-secondary hover:bg-bg-surface disabled:opacity-40">
                <ChevronLeft size={13} />
                Back
              </button>
              {activeStep === 'review' ? (
                <button type="button" onClick={apply} className="rounded bg-accent-primary px-4 py-1.5 text-[12px] font-semibold text-accent-text hover:opacity-90">
                  Apply & Launch
                </button>
              ) : (
                <button type="button" onClick={goNext} className="flex items-center gap-1 rounded bg-accent-primary px-4 py-1.5 text-[12px] font-semibold text-accent-text hover:opacity-90">
                  Next
                  <ChevronRight size={13} />
                </button>
              )}
            </div>
          </footer>
        </section>
      </div>
    </div>
  );
}
