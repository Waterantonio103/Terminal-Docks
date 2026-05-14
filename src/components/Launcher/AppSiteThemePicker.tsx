import { useMemo, useState } from 'react';
import { Bot, Check, ChevronLeft, ChevronRight, Image as ImageIcon, Layers, Sparkles, X } from 'lucide-react';
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

const PALETTE_CHOICES: Choice[] = [
  { value: { kind: 'agent_decides', id: 'agent_decides', label: 'Let agents decide', colors: [] }, label: 'Let agents decide', description: 'Agents choose tokens that fit the build type.' },
  { value: paletteChoice('slate_cyan', 'Slate / Cyan', ['#0F172A', '#22D3EE']), label: 'Slate / Cyan', description: 'Technical, focused, cool accent.' },
  { value: paletteChoice('ink_lime', 'Ink / Lime', ['#111827', '#A3E635']), label: 'Ink / Lime', description: 'Sharp product UI contrast.' },
  { value: paletteChoice('navy_coral', 'Navy / Coral', ['#1E3A8A', '#FB7185']), label: 'Navy / Coral', description: 'Confident SaaS with warm action.' },
  { value: paletteChoice('charcoal_gold', 'Charcoal / Gold', ['#18181B', '#FBBF24']), label: 'Charcoal / Gold', description: 'Premium contrast without beige drift.' },
  { value: paletteChoice('forest_mint', 'Forest / Mint', ['#14532D', '#6EE7B7']), label: 'Forest / Mint', description: 'Calm, natural, modern.' },
  { value: paletteChoice('plum_sky', 'Plum / Sky', ['#581C87', '#38BDF8']), label: 'Plum / Sky', description: 'Expressive but still crisp.' },
  { value: paletteChoice('graphite_blue', 'Graphite / Blue', ['#27272A', '#3B82F6']), label: 'Graphite / Blue', description: 'Utility app default.' },
  { value: paletteChoice('white_emerald', 'White / Emerald', ['#F8FAFC', '#10B981']), label: 'White / Emerald', description: 'Clean light interface.' },
  { value: paletteChoice('black_rose', 'Black / Rose', ['#020617', '#F43F5E']), label: 'Black / Rose', description: 'High contrast and direct.' },
  { value: paletteChoice('indigo_amber', 'Indigo / Amber', ['#312E81', '#F59E0B']), label: 'Indigo / Amber', description: 'Decision-heavy dashboard feel.' },
  { value: paletteChoice('teal_orange', 'Teal / Orange', ['#0F766E', '#F97316']), label: 'Teal / Orange', description: 'Balanced analytical warmth.' },
  { value: paletteChoice('zinc_violet', 'Zinc / Violet', ['#3F3F46', '#8B5CF6']), label: 'Zinc / Violet', description: 'Modern creative tooling.' },
  { value: paletteChoice('blue_red', 'Blue / Red', ['#2563EB', '#EF4444']), label: 'Blue / Red', description: 'Clear primary and alert contrast.' },
  { value: paletteChoice('stone_green', 'Stone / Green', ['#44403C', '#22C55E']), label: 'Stone / Green', description: 'Grounded operations palette.' },
  { value: paletteChoice('black_white', 'Black / White', ['#020617', '#F8FAFC']), label: 'Black / White', description: 'Monochrome with strict contrast.' },
  { value: paletteChoice('slate_cyan_orange', 'Slate / Cyan / Orange', ['#0F172A', '#06B6D4', '#F97316']), label: 'Slate / Cyan / Orange', description: 'App shell plus warm action color.' },
  { value: paletteChoice('navy_sky_lime', 'Navy / Sky / Lime', ['#172554', '#38BDF8', '#A3E635']), label: 'Navy / Sky / Lime', description: 'Technical and active.' },
  { value: paletteChoice('ink_violet_pink', 'Ink / Violet / Pink', ['#111827', '#8B5CF6', '#EC4899']), label: 'Ink / Violet / Pink', description: 'Creative product energy.' },
  { value: paletteChoice('white_blue_emerald', 'White / Blue / Emerald', ['#F8FAFC', '#2563EB', '#10B981']), label: 'White / Blue / Emerald', description: 'Readable light SaaS.' },
  { value: paletteChoice('charcoal_amber_red', 'Charcoal / Amber / Red', ['#18181B', '#F59E0B', '#EF4444']), label: 'Charcoal / Amber / Red', description: 'Monitoring and urgency.' },
  { value: paletteChoice('forest_mint_sky', 'Forest / Mint / Sky', ['#14532D', '#6EE7B7', '#38BDF8']), label: 'Forest / Mint / Sky', description: 'Fresh environmental/product tone.' },
  { value: paletteChoice('plum_lilac_gold', 'Plum / Lilac / Gold', ['#581C87', '#C084FC', '#FBBF24']), label: 'Plum / Lilac / Gold', description: 'Premium expressive palette.' },
  { value: paletteChoice('graphite_blue_cyan', 'Graphite / Blue / Cyan', ['#27272A', '#3B82F6', '#22D3EE']), label: 'Graphite / Blue / Cyan', description: 'Builder/editor friendly.' },
  { value: paletteChoice('black_green_cyan', 'Black / Green / Cyan', ['#020617', '#22C55E', '#06B6D4']), label: 'Black / Green / Cyan', description: 'Terminal-like but polished.' },
  { value: paletteChoice('aubergine_coral_mint', 'Aubergine / Coral / Mint', ['#3B0764', '#FB7185', '#6EE7B7']), label: 'Aubergine / Coral / Mint', description: 'Consumer-friendly contrast.' },
  { value: paletteChoice('blue_amber_slate', 'Blue / Amber / Slate', ['#1D4ED8', '#F59E0B', '#475569']), label: 'Blue / Amber / Slate', description: 'Business dashboard balance.' },
  { value: paletteChoice('red_cyan_zinc', 'Red / Cyan / Zinc', ['#DC2626', '#06B6D4', '#3F3F46']), label: 'Red / Cyan / Zinc', description: 'Sharp event/status UI.' },
  { value: paletteChoice('emerald_indigo_rose', 'Emerald / Indigo / Rose', ['#059669', '#4F46E5', '#E11D48']), label: 'Emerald / Indigo / Rose', description: 'Distinct sections and actions.' },
  { value: paletteChoice('orange_blue_lime', 'Orange / Blue / Lime', ['#EA580C', '#2563EB', '#84CC16']), label: 'Orange / Blue / Lime', description: 'Bright, functional energy.' },
  { value: paletteChoice('white_black_cyan', 'White / Black / Cyan', ['#F8FAFC', '#020617', '#0891B2']), label: 'White / Black / Cyan', description: 'Editorial clarity with accent.' },
];

const CUSTOM_PALETTE_ID = 'custom_palette';
const DEFAULT_CUSTOM_COLORS = ['#2563EB', '#14B8A6', '#F97316'];

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

const MULTI_STEPS = new Set<StepId>(['effects', 'interaction']);

function paletteKey(value: FrontendDirectionPalette): string {
  return typeof value === 'string' ? value : value.id;
}

function paletteLabel(value: FrontendDirectionPalette): string {
  return typeof value === 'string' ? frontendDirectionLabel(value) : value.label;
}

function paletteColors(value: FrontendDirectionPalette): string[] {
  if (typeof value === 'object' && value.colors.length > 0) return value.colors;
  return ['#0F172A', '#22D3EE', '#F97316'];
}

function isPaletteDelegated(value?: FrontendDirectionPalette): boolean {
  return value === 'agent_decides' || (typeof value === 'object' && value.kind === 'agent_decides');
}

function customPalette(colors: string[]): FrontendDirectionPaletteChoice {
  return { kind: 'custom', id: CUSTOM_PALETTE_ID, label: 'Custom palette', colors };
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

function previewState(state: PickerState, hover: { step: StepId; value: ChoiceValue } | null): Required<PickerState> {
  const next: PickerState = { ...state };
  if (hover && hover.step !== 'review') {
    if (MULTI_STEPS.has(hover.step)) next[hover.step as 'effects' | 'interaction'] = [hover.value as never];
    else (next as Record<string, ChoiceValue>)[hover.step] = hover.value;
  }
  return {
    layout: next.layout ?? 'agent_decides',
    density: next.density ?? 'balanced',
    palette: next.palette ?? paletteChoice('slate_cyan', 'Slate / Cyan', ['#0F172A', '#22D3EE']),
    shape: next.shape ?? 'slightly_rounded',
    effects: next.effects?.length ? next.effects : ['subtle_hover_motion'],
    assets: next.assets ?? 'icons_only',
    interaction: next.interaction?.length ? next.interaction : ['basic_navigation'],
    tone: next.tone ?? 'technical',
  };
}

function PaletteCircle({ colors, className = 'h-10 w-10' }: { colors: string[]; className?: string }) {
  const safeColors = colors.length > 0 ? colors : ['#64748B', '#94A3B8'];
  const background = safeColors.length === 2
    ? `linear-gradient(90deg, ${safeColors[0]} 0 50%, ${safeColors[1]} 50% 100%)`
    : `conic-gradient(${safeColors[0]} 0 33%, ${safeColors[1] ?? safeColors[0]} 33% 66%, ${safeColors[2] ?? safeColors[1] ?? safeColors[0]} 66% 100%)`;
  return <span className={`${className} shrink-0 rounded-full border border-white/20 shadow-inner`} style={{ background }} />;
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

function WireframePreview({ state, emptyLayout, review }: { state: Required<PickerState>; emptyLayout: boolean; review: boolean }) {
  const compact = state.density === 'compact';
  const spacious = state.density === 'spacious';
  const radius = state.shape === 'boxy' || state.shape === 'sharp_editorial' ? 'rounded-[2px]' : state.shape === 'soft' || state.shape === 'pill_heavy' ? 'rounded-xl' : 'rounded-md';
  const gap = compact ? 'gap-1.5' : spacious ? 'gap-4' : 'gap-2.5';
  const padding = compact ? 'p-3' : spacious ? 'p-6' : 'p-4';
  const colors = paletteColors(state.palette);
  const base = colors[0] ?? '#0F172A';
  const accent = colors[1] ?? '#22D3EE';
  const secondary = colors[2] ?? accent;
  const light = base.toLowerCase() === '#f8fafc' || base.toLowerCase() === '#ffffff';
  const muted = light ? 'rgba(71,85,105,.22)' : 'rgba(148,163,184,.24)';
  const block = light ? 'rgba(71,85,105,.35)' : 'rgba(148,163,184,.45)';
  const effectIds = state.effects.map(effect => String(effect).replace(/_/g, '-'));
  const glass = effectIds.some(effect => effect.includes('glass') || effect.includes('frosted') || effect.includes('translucent') || effect.includes('blur'));
  const depth = effectIds.some(effect => effect.includes('depth') || effect.includes('shadow') || effect.includes('floating') || effect.includes('elevated') || effect.includes('3d') || effect.includes('isometric'));
  const motion = effectIds.some(effect => effect.includes('motion') || effect.includes('gsap') || effect.includes('kinetic') || effect.includes('marquee') || effect.includes('reveal') || effect.includes('interactive') || effect === 'subtle-hover-motion' || effect === 'microinteractions');
  const grid = effectIds.some(effect => effect.includes('grid') || effect.includes('particle') || effect.includes('background') || effect.includes('webgl') || effect.includes('field') || effect.includes('terminal'));
  const borderEffect = effectIds.some(effect => effect.includes('gradient-border') || effect.includes('border-gradient') || effect.includes('border-glow'));
  const shellStyle = {
    background: grid
      ? `linear-gradient(rgba(15,23,42,.25), rgba(15,23,42,.25)), ${base}`
      : base,
    borderColor: borderEffect ? accent : light ? '#CBD5E1' : '#334155',
    boxShadow: depth ? `0 24px 60px ${accent}24` : undefined,
  };

  if (emptyLayout) {
    return <div className="h-full w-full border transition-colors duration-300" style={shellStyle} />;
  }

  const layout = state.layout === 'agent_decides' ? 'dashboard' : state.layout;
  const panelClass = `${radius} ${glass ? 'backdrop-blur bg-white/12 border border-white/15' : ''}`;
  const motionClass = motion ? 'transition-all duration-300 ease-out hover:scale-[1.01]' : 'transition-opacity duration-300';

  return (
    <div className={`relative h-full w-full overflow-hidden border ${padding} ${motionClass}`} style={shellStyle}>
      {grid && <div className="absolute inset-0 opacity-25 [background-image:linear-gradient(rgba(148,163,184,.25)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,.25)_1px,transparent_1px)] [background-size:22px_22px]" />}
      {effectIds.some(effect => effect.includes('mesh') || effect.includes('vignette') || effect.includes('cloudy') || effect.includes('aura') || effect.includes('nebula') || effect.includes('blob')) && <div className="absolute inset-0 opacity-35" style={{ background: `radial-gradient(circle at 80% 10%, ${secondary}, transparent 28%), radial-gradient(circle at 15% 80%, ${accent}, transparent 26%)` }} />}
      <div className={`relative flex h-full ${gap} ${layout === 'landing_page' || layout === 'portfolio' || layout === 'content_first_site' || layout === 'product_commerce' ? 'flex-col' : ''}`}>
        {layout === 'dashboard' && (
          <>
            <div className={`${panelClass} w-[18%] p-2`} style={{ backgroundColor: glass ? undefined : muted }}>
              <ShapeBlock className="mb-3 h-3 w-2/3" color={accent} />
              <ShapeBlock className="mb-1.5 h-2.5 w-full" color={block} />
              <ShapeBlock className="mb-1.5 h-2.5 w-4/5" color={block} />
              <ShapeBlock className="h-2.5 w-5/6" color={block} />
            </div>
            <div className={`flex flex-1 flex-col ${gap}`}>
              <div className={panelClass} style={{ height: '12%', backgroundColor: glass ? undefined : muted }} />
              <div className={`grid grid-cols-4 ${gap} h-[20%]`}>
                {[0, 1, 2, 3].map(i => <div key={i} className={panelClass} style={{ backgroundColor: i === 0 ? accent : muted }} />)}
              </div>
              <div className={`grid flex-1 grid-cols-[1.4fr_.9fr] ${gap}`}>
                <div className={`${panelClass} p-3`} style={{ backgroundColor: glass ? undefined : muted }}><ShapeBlock className="h-full w-full opacity-70" color={secondary} /></div>
                <div className={panelClass} style={{ backgroundColor: glass ? undefined : muted }} />
              </div>
              <div className={panelClass} style={{ height: '18%', backgroundColor: glass ? undefined : muted }} />
            </div>
          </>
        )}
        {layout === 'single_screen_tool' && (
          <div className={`flex h-full w-full flex-col ${gap}`}>
            <div className={`${panelClass} flex h-[14%] items-center gap-2 p-2`} style={{ backgroundColor: glass ? undefined : muted }}>
              <ShapeBlock className="h-3 w-20" color={block} />
              <ShapeBlock className={`h-5 w-16 ${state.shape === 'pill_heavy' ? 'rounded-full' : ''}`} color={accent} />
              <ShapeBlock className="ml-auto h-5 w-20" color={block} />
            </div>
            <div className={`grid flex-1 grid-cols-[.7fr_1.3fr] ${gap}`}>
              <div className={`${panelClass} p-3`} style={{ backgroundColor: glass ? undefined : muted }}><ShapeBlock className="mb-2 h-3 w-4/5" color={block} /><ShapeBlock className="mb-2 h-16 w-full" color={secondary} /><ShapeBlock className="h-10 w-2/3" color={accent} /></div>
              <div className={`${panelClass} p-4`} style={{ backgroundColor: glass ? undefined : muted }}><ShapeBlock className="h-full w-full opacity-70" color={block} /></div>
            </div>
          </div>
        )}
        {layout === 'workbench_editor' && (
          <>
            <div className={panelClass} style={{ width: '18%', backgroundColor: glass ? undefined : muted }} />
            <div className={`${panelClass} flex-1 p-3`} style={{ backgroundColor: glass ? undefined : muted }}><ShapeBlock className="h-full w-full opacity-70" color={secondary} /></div>
            <div className={panelClass} style={{ width: '22%', backgroundColor: glass ? undefined : muted }} />
          </>
        )}
        {(layout === 'landing_page' || layout === 'portfolio' || layout === 'product_commerce' || layout === 'content_first_site') && (
          <>
            <div className={`${panelClass} h-[50%] p-5`} style={{ backgroundColor: glass ? undefined : muted }}>
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
            <div className={panelClass} style={{ width: '20%', backgroundColor: glass ? undefined : muted }} />
            <div className={`${panelClass} flex-1 p-4`} style={{ backgroundColor: glass ? undefined : muted }}>
              <ShapeBlock className="mb-3 h-5 w-1/2" color={accent} />
              <ShapeBlock className="mb-2 h-2.5 w-full" color={block} />
              <ShapeBlock className="mb-2 h-2.5 w-5/6" color={block} />
              <ShapeBlock className="mt-5 h-20 w-full" color={secondary} />
            </div>
            <div className={panelClass} style={{ width: '18%', backgroundColor: glass ? undefined : muted }} />
          </>
        )}
        {layout === 'game_interactive' && (
          <div className={`flex h-full w-full flex-col ${gap}`}>
            <div className={`${panelClass} flex-1 p-5`} style={{ backgroundColor: glass ? undefined : muted }}><ShapeBlock className="h-full w-full" color={accent} /></div>
            <div className={panelClass} style={{ height: '18%', backgroundColor: glass ? undefined : muted }} />
          </div>
        )}
      </div>
      <AssetHints asset={state.assets} radius={radius} accent={accent} muted={secondary} />
      {review && <div className="pointer-events-none absolute bottom-2 right-2 rounded border border-slate-500/50 bg-black/20 px-2 py-1 text-[9px] font-semibold uppercase tracking-wide text-slate-300">Low-fidelity preview</div>}
    </div>
  );
}

export function AppSiteThemePicker({ open, onClose, onApply }: AppSiteThemePickerProps) {
  const [activeStep, setActiveStep] = useState<StepId>('layout');
  const [state, setState] = useState<PickerState>({});
  const [completed, setCompleted] = useState<Set<StepId>>(new Set());
  const [hover, setHover] = useState<{ step: StepId; value: ChoiceValue } | null>(null);
  const [showMissing, setShowMissing] = useState(false);
  const [customColors, setCustomColors] = useState(DEFAULT_CUSTOM_COLORS);
  const [effectCategory, setEffectCategory] = useState(EFFECT_CATEGORIES[0].id);

  const stepIndex = STEPS.findIndex(step => step.id === activeStep);
  const preview = useMemo(() => previewState(state, hover), [state, hover]);
  const missingSteps = STEPS.filter(step => step.id !== 'review' && !stepHasSelection(state, step.id)).map(step => step.id);
  const emptyLayout = activeStep === 'layout' && !state.layout && hover?.step !== 'layout';
  const activeEffectCategory = EFFECT_CATEGORIES.find(category => category.id === effectCategory) ?? EFFECT_CATEGORIES[0];

  if (!open) return null;

  function selectChoice(step: Exclude<StepId, 'review'>, value: ChoiceValue) {
    setShowMissing(false);
    setState(current => {
      if (step === 'effects') {
        const nextValue = value as FrontendDirectionEffect;
        if (nextValue === 'agent_decides' || nextValue === 'none') return { ...current, effects: [nextValue] };
        const currentValues = (current.effects ?? []).filter(item => item !== 'agent_decides' && item !== 'none');
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
    setActiveStep(STEPS[Math.min(STEPS.length - 1, stepIndex + 1)].id);
    setHover(null);
  }

  function goBack() {
    setActiveStep(STEPS[Math.max(0, stepIndex - 1)].id);
    setHover(null);
  }

  function apply() {
    if (missingSteps.length > 0) {
      setShowMissing(true);
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
        {PALETTE_CHOICES.map(choice => {
          const value = choice.value as FrontendDirectionPalette;
          const selected = currentKey === paletteKey(value);
          const delegated = isPaletteDelegated(value);
          return (
            <button
              key={paletteKey(value)}
              type="button"
              onMouseEnter={() => setHover({ step: 'palette', value })}
              onMouseLeave={() => setHover(null)}
              onClick={() => selectChoice('palette', value)}
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
        })}
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
    const baseChoices: Choice[] = [
      { value: 'agent_decides', label: 'Let agents decide', description: 'Agents select restrained effects that fit the workflow.' },
      { value: 'none', label: 'No effects', description: 'Static, functional presentation only.' },
    ];
    const current = state.effects ?? [];
    return (
      <div className="col-span-full grid grid-cols-[160px_1fr] gap-3">
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
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
          {[...baseChoices, ...activeEffectCategory.choices].map(choice => {
            const selected = current.includes(choice.value as FrontendDirectionEffect);
            const delegated = choice.value === 'agent_decides';
            return (
              <button
                key={String(choice.value)}
                type="button"
                onMouseEnter={() => setHover({ step: 'effects', value: choice.value })}
                onMouseLeave={() => setHover(null)}
                onClick={() => selectChoice('effects', choice.value)}
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
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/65 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="flex h-[82vh] w-[92vw] max-w-[1180px] overflow-hidden rounded-xl border border-border-panel bg-bg-app shadow-2xl">
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

            <div className={`${activeStep === 'review' ? 'h-full' : 'h-[calc(65%-1rem)]'} min-h-0 rounded-xl border border-border-panel bg-bg-panel p-3`}>
              <WireframePreview state={preview} emptyLayout={emptyLayout} review={activeStep === 'review'} />
            </div>
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
