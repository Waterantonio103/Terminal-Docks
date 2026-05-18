import type { FrontendDirectionPalette } from './frontendDirection.js';

export const FRONTEND_PRESET_PALETTE_COLORS: Record<string, string[]> = {
  light_saas_blue: ['#F8FAFC', '#2563EB', '#0F172A'],
  light_finance_emerald: ['#F7FAF8', '#047857', '#111827'],
  light_health_teal: ['#F6FEFC', '#0F766E', '#134E4A'],
  light_editorial_ink: ['#FAFAF9', '#1F2937', '#B45309'],
  light_agency_indigo: ['#F9FAFB', '#4F46E5', '#111827'],
  light_commerce_rose: ['#FFF7F9', '#E11D48', '#1F2937'],
  light_ops_slate_cyan: ['#F8FAFC', '#0891B2', '#334155'],
  light_warm_product: ['#FFFBF5', '#EA580C', '#1E293B'],
  light_luxury_graphite: ['#F6F5F2', '#27272A', '#A16207'],
  light_mono_blue: ['#FFFFFF', '#0F172A', '#2563EB'],
  dark_neutral_contrast: ['#050505', '#F4F4F5', '#71717A'],
  dark_product_blue: ['#0B1220', '#60A5FA', '#94A3B8'],
  dark_terminal_green: ['#050A07', '#34D399', '#9CA3AF'],
  dark_graphite_violet: ['#111113', '#8B5CF6', '#A1A1AA'],
  dark_navy_cyan: ['#08111F', '#22D3EE', '#CBD5E1'],
  dark_security_amber: ['#0F0F0B', '#F59E0B', '#D4D4D8'],
  dark_ink_rose: ['#09090B', '#FB7185', '#A1A1AA'],
  dark_forest_mint: ['#07130D', '#6EE7B7', '#A7F3D0'],
  dark_aubergine_sky: ['#16091F', '#38BDF8', '#C4B5FD'],
  dark_contrast_white: ['#020617', '#F8FAFC', '#64748B'],
  dark_red_status: ['#0A0A0A', '#EF4444', '#CBD5E1'],
};

export function resolveFrontendPaletteColors(value: FrontendDirectionPalette, fallback: string[]): string[] {
  if (typeof value === 'object' && value.colors.length > 0) return value.colors;
  if (typeof value === 'string') return FRONTEND_PRESET_PALETTE_COLORS[value] ?? fallback;
  return fallback;
}
