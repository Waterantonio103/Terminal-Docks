export const FRONTEND_DIRECTION_KIND = 'app_site_frontend_direction' as const;
export const FRONTEND_DIRECTION_VERSION = 1 as const;

export type FrontendDirectionDelegatedValue = 'agent_decides';

export type FrontendDirectionLayout =
  | FrontendDirectionDelegatedValue
  | 'dashboard'
  | 'single_screen_tool'
  | 'workbench_editor'
  | 'landing_page'
  | 'portfolio'
  | 'product_commerce'
  | 'docs_knowledge_base'
  | 'game_interactive'
  | 'content_first_site';

export type FrontendDirectionDensity = FrontendDirectionDelegatedValue | 'compact' | 'balanced' | 'spacious';
export interface FrontendDirectionPaletteChoice {
  kind: 'preset' | 'custom' | 'agent_decides';
  id: string;
  label: string;
  colors: string[];
}
export type FrontendDirectionPalette = FrontendDirectionDelegatedValue | FrontendDirectionPaletteChoice;
export type FrontendDirectionShape =
  | FrontendDirectionDelegatedValue
  | 'boxy'
  | 'slightly_rounded'
  | 'soft'
  | 'pill_heavy'
  | 'sharp_editorial';
export type FrontendDirectionEffect = FrontendDirectionDelegatedValue | 'none' | string;
export type FrontendDirectionAssets =
  | FrontendDirectionDelegatedValue
  | 'icons_only'
  | 'real_product_imagery'
  | 'stock_photography'
  | 'generated_bitmap'
  | 'illustration'
  | 'data_visualization'
  | 'no_imagery';
export type FrontendDirectionInteraction =
  | FrontendDirectionDelegatedValue
  | 'static'
  | 'basic_navigation'
  | 'forms'
  | 'filtering_and_search'
  | 'drag_and_drop'
  | 'realtime_state'
  | 'canvas_or_editor'
  | 'game_controls';
export type FrontendDirectionTone =
  | FrontendDirectionDelegatedValue
  | 'technical'
  | 'executive'
  | 'consumer'
  | 'playful'
  | 'minimal'
  | 'luxury'
  | 'developer_tool'
  | 'educational';

export interface FrontendDirectionAgentGuidance {
  do: string[];
  avoid: string[];
}

export interface FrontendDirectionPreviewDescriptor {
  label: string;
  note: string;
  lowFidelity: true;
  nonAuthoritative: true;
}

export interface FrontendDirectionSpec {
  kind: typeof FRONTEND_DIRECTION_KIND;
  version: typeof FRONTEND_DIRECTION_VERSION;
  layout: FrontendDirectionLayout;
  density: FrontendDirectionDensity;
  palette: FrontendDirectionPalette;
  shape: FrontendDirectionShape;
  effects: FrontendDirectionEffect[];
  assets: FrontendDirectionAssets;
  interaction: FrontendDirectionInteraction[];
  tone: FrontendDirectionTone;
  notes?: string;
  agentGuidance: FrontendDirectionAgentGuidance;
  delegatedSections: string[];
  summary: string;
  preview?: FrontendDirectionPreviewDescriptor;
}

export const APP_SITE_PRESET_IDS = new Set(['app_site_small', 'frontend_ui_delivery', 'app_site_expanded']);

export function isAppSitePresetId(presetId: string | null | undefined): boolean {
  return typeof presetId === 'string' && APP_SITE_PRESET_IDS.has(presetId);
}

const LABELS: Record<string, string> = {
  agent_decides: 'Let agents decide',
  dashboard: 'Dashboard',
  single_screen_tool: 'Single-screen tool',
  workbench_editor: 'Workbench/editor',
  landing_page: 'Landing page',
  portfolio: 'Portfolio',
  product_commerce: 'Product or commerce',
  docs_knowledge_base: 'Documentation or knowledge base',
  game_interactive: 'Game or interactive experience',
  content_first_site: 'Content-first site',
  compact: 'Compact',
  balanced: 'Balanced',
  spacious: 'Spacious',
  neutral_professional: 'Neutral professional',
  high_contrast_dark: 'High contrast dark',
  editorial_light: 'Editorial light',
  playful_saturated: 'Playful saturated',
  brand_led: 'Brand-led',
  monochrome: 'Monochrome',
  technical_terminal: 'Technical terminal',
  warm_natural: 'Warm natural',
  luxury_minimal: 'Luxury minimal',
  boxy: 'Boxy',
  slightly_rounded: 'Slightly rounded',
  soft: 'Soft',
  pill_heavy: 'Pill-heavy',
  sharp_editorial: 'Sharp editorial',
  none: 'No effects',
  subtle_hover_motion: 'Subtle hover motion',
  glass_surfaces: 'Glass surfaces',
  animated_background: 'Animated background',
  particle_or_grid_field: 'Particle or grid field',
  shader_canvas: 'Shader canvas',
  three_dimensional: '3D',
  scroll_storytelling: 'Scroll storytelling',
  microinteractions: 'Microinteractions',
  depth_soft_shadows: 'Soft shadows',
  depth_layered_cards: 'Layered cards',
  depth_floating_toolbar: 'Floating toolbar',
  depth_elevated_modals: 'Elevated modals',
  depth_inner_glow: 'Inner glow',
  surface_frosted_sidebar: 'Frosted sidebar',
  surface_translucent_nav: 'Translucent navigation',
  surface_noise_texture: 'Noise texture',
  surface_gradient_border: 'Gradient border',
  surface_material_panels: 'Material panels',
  motion_page_fade: 'Page fade',
  motion_slide_panels: 'Slide panels',
  motion_staggered_lists: 'Staggered lists',
  motion_count_up_metrics: 'Count-up metrics',
  motion_spring_controls: 'Spring controls',
  scroll_snap_sections: 'Snap sections',
  scroll_progress_indicator: 'Scroll progress',
  scroll_reveal_blocks: 'Scroll reveal',
  scroll_sticky_context: 'Sticky context',
  scroll_parallax_media: 'Parallax media',
  background_subtle_grid: 'Subtle grid',
  background_radial_vignette: 'Radial vignette',
  background_mesh_gradient: 'Mesh gradient',
  background_code_rain: 'Code rain',
  background_canvas_noise: 'Canvas noise',
  feedback_button_press: 'Button press feedback',
  feedback_focus_rings: 'Focus rings',
  feedback_toasts: 'Toasts',
  feedback_loading_skeletons: 'Loading skeletons',
  feedback_success_states: 'Success states',
  data_animated_charts: 'Animated charts',
  data_heatmap_surface: 'Heatmap surface',
  data_timeline_motion: 'Timeline motion',
  data_status_pulses: 'Status pulses',
  data_live_activity: 'Live activity',
  nav_command_palette: 'Command palette',
  nav_collapsible_sidebar: 'Collapsible sidebar',
  nav_tab_underline: 'Tab underline',
  nav_breadcrumb_motion: 'Breadcrumb motion',
  nav_context_drawer: 'Context drawer',
  icons_only: 'Icons only',
  real_product_imagery: 'Real product imagery',
  stock_photography: 'Stock photography',
  generated_bitmap: 'Generated bitmap',
  illustration: 'Illustration',
  data_visualization: 'Data visualization',
  no_imagery: 'No imagery',
  static: 'Static',
  basic_navigation: 'Basic navigation',
  forms: 'Forms',
  filtering_and_search: 'Filtering and search',
  drag_and_drop: 'Drag and drop',
  realtime_state: 'Realtime state',
  canvas_or_editor: 'Canvas or editor',
  game_controls: 'Game controls',
  technical: 'Technical',
  executive: 'Executive',
  consumer: 'Consumer',
  playful: 'Playful',
  minimal: 'Minimal',
  luxury: 'Luxury',
  developer_tool: 'Developer tool',
  educational: 'Educational',
};

export function frontendDirectionLabel(value: string): string {
  return LABELS[value] ?? value
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase());
}

function paletteLabel(value: FrontendDirectionPalette): string {
  return typeof value === 'string' ? frontendDirectionLabel(value) : value.label;
}

function isDelegated(value: string | string[] | FrontendDirectionPalette): boolean {
  if (Array.isArray(value)) return value.includes('agent_decides');
  if (typeof value === 'object' && value) return value.kind === 'agent_decides';
  return value === 'agent_decides';
}

export function delegatedFrontendDirectionSections(spec: Pick<FrontendDirectionSpec, 'layout' | 'density' | 'palette' | 'shape' | 'effects' | 'assets' | 'interaction' | 'tone'>): string[] {
  return [
    ['Layout', spec.layout],
    ['Density', spec.density],
    ['Palette', spec.palette],
    ['Shape', spec.shape],
    ['Effects', spec.effects],
    ['Assets', spec.assets],
    ['Interaction', spec.interaction],
    ['Tone', spec.tone],
  ]
    .filter(([, value]) => isDelegated(value as string | string[] | FrontendDirectionPalette))
    .map(([label]) => label as string);
}

export function summarizeFrontendDirection(spec: Pick<FrontendDirectionSpec, 'layout' | 'density' | 'palette' | 'shape' | 'effects' | 'assets' | 'interaction' | 'tone'>): string {
  const effects = spec.effects.map(frontendDirectionLabel).join(', ');
  const interaction = spec.interaction.map(frontendDirectionLabel).join(', ');
  const palette = paletteLabel(spec.palette);
  const paletteColors = typeof spec.palette === 'object' && spec.palette.colors.length > 0
    ? ` (${spec.palette.colors.join(', ')})`
    : '';
  return [
    `Layout: ${frontendDirectionLabel(spec.layout)}`,
    `Density: ${frontendDirectionLabel(spec.density)}`,
    `Palette: ${palette}${paletteColors}`,
    `Shape: ${frontendDirectionLabel(spec.shape)}`,
    `Effects: ${effects}`,
    `Assets: ${frontendDirectionLabel(spec.assets)}`,
    `Interaction: ${interaction}`,
    `Tone: ${frontendDirectionLabel(spec.tone)}`,
  ].join('; ');
}

export function buildFrontendDirectionGuidance(spec: Pick<FrontendDirectionSpec, 'layout' | 'density' | 'palette' | 'shape' | 'effects' | 'assets' | 'interaction' | 'tone'>): FrontendDirectionAgentGuidance {
  const delegated = delegatedFrontendDirectionSections(spec);
  const doList = [
    `Treat the App/Site theme picker as binding user intent: ${summarizeFrontendDirection(spec)}.`,
    'Translate concrete choices into PRD.md, DESIGN.md, structure.md, frontendSpecs, or frontendPlan as appropriate for the role.',
    'Compare QA and review output against every picker section.',
  ];
  const avoid = [
    'Do not replace delegated sections with hidden defaults; record the agent decision and a short reason.',
    'Do not treat the preview as final content, copy, or a pixel-perfect mockup.',
  ];

  if (delegated.length > 0) {
    doList.push(`For delegated sections (${delegated.join(', ')}), choose values that fit the concrete selections and record short reasons for the final README Agent Decisions section.`);
  }
  if (spec.layout === 'dashboard' || spec.layout === 'single_screen_tool' || spec.layout === 'workbench_editor') {
    avoid.push('Do not drift into marketing-page composition for operational software.');
  }
  if (spec.density === 'compact') {
    doList.push('Use a tighter spacing and type scale suitable for scanning and repeated work.');
  }
  if (spec.effects.includes('none')) {
    avoid.push('Do not add decorative effects beyond necessary interaction feedback.');
  }

  return { do: doList, avoid };
}

export function normalizeFrontendDirectionSpec(
  input: Omit<FrontendDirectionSpec, 'kind' | 'version' | 'agentGuidance' | 'delegatedSections' | 'summary' | 'preview'> & {
    preview?: FrontendDirectionPreviewDescriptor;
    agentGuidance?: FrontendDirectionAgentGuidance;
    delegatedSections?: string[];
    summary?: string;
  },
): FrontendDirectionSpec {
  const base = {
    layout: input.layout,
    density: input.density,
    palette: input.palette,
    shape: input.shape,
    effects: input.effects,
    assets: input.assets,
    interaction: input.interaction,
    tone: input.tone,
  };
  return {
    kind: FRONTEND_DIRECTION_KIND,
    version: FRONTEND_DIRECTION_VERSION,
    ...base,
    notes: input.notes?.trim() || undefined,
    agentGuidance: input.agentGuidance ?? buildFrontendDirectionGuidance(base),
    delegatedSections: input.delegatedSections ?? delegatedFrontendDirectionSections(base),
    summary: input.summary ?? summarizeFrontendDirection(base),
    preview: input.preview ?? {
      label: `${frontendDirectionLabel(input.layout)} low-fidelity preview`,
      note: 'Preview is a broad layout, density, and composition reference only.',
      lowFidelity: true,
      nonAuthoritative: true,
    },
  };
}
