import { useEffect, useMemo, useState } from 'react';
import {
  Accessibility,
  ArrowRight,
  BadgeCheck,
  BookOpenText,
  Braces,
  Bug,
  CheckCircle2,
  Code2,
  Eye,
  FileText,
  GitBranch,
  Layers3,
  LockKeyhole,
  PenTool,
  Search,
  ShieldCheck,
  Sparkles,
  TestTube2,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import agentsConfig from '../../config/agents';
import {
  getRecommendedWorkflowPreset,
  getPresetReadmeDefault,
  groupWorkflowPresetsBySubMode,
  listWorkflowPresetModes,
  listWorkflowPresetsByMode,
  type PresetDefinition,
  type PresetSize,
  type WorkflowPresetMode,
} from '../../lib/workflowPresets';

interface WorkflowPresetPickerProps {
  open: boolean;
  initialMode?: WorkflowPresetMode;
  onClose: () => void;
  onApply: (preset: PresetDefinition, options: { finalReadmeEnabled: boolean }) => void;
}

const MODE_ICONS: Record<WorkflowPresetMode, LucideIcon> = {
  build: Code2,
  research: Search,
  plan: GitBranch,
  review: BadgeCheck,
  verify: TestTube2,
  secure: ShieldCheck,
  document: FileText,
};

const SIZE_LABELS: Record<PresetSize, string> = {
  small: 'Small',
  standard: 'Standard',
  expanded: 'Expanded',
};

const ROLE_ICONS: Record<string, LucideIcon> = {
  scout: Search,
  coordinator: Users,
  builder: Code2,
  tester: TestTube2,
  security: LockKeyhole,
  reviewer: Eye,
  frontend_product: Sparkles,
  frontend_designer: PenTool,
  frontend_architect: Layers3,
  frontend_builder: Braces,
  interaction_qa: Bug,
  accessibility_reviewer: Accessibility,
  visual_polish_reviewer: CheckCircle2,
};

const ROLE_SHORT_NAMES: Record<string, string> = Object.fromEntries(
  agentsConfig.agents.map(agent => [agent.id, agent.name.replace(/\s+Agent$/i, '')])
);

function roleInitials(roleId: string): string {
  const source = ROLE_SHORT_NAMES[roleId] ?? roleId;
  return source
    .split(/[\s_/]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase() ?? '')
    .join('');
}

function roleName(roleId: string): string {
  return ROLE_SHORT_NAMES[roleId] ?? roleId.replace(/_/g, ' ');
}

function friendlyMetadata(preset: PresetDefinition): string[] {
  const labels = [...preset.tags];
  if (preset.frontendMode === 'strict_ui' && !labels.includes('Visual QA')) labels.push('Visual QA');
  if (preset.specProfile === 'frontend_three_file' && !labels.includes('Spec docs')) labels.push('Spec docs');
  return labels.slice(0, 2);
}

function getPreviewLayers(preset: PresetDefinition, nodeIds: Set<string>): string[][] {
  const order = new Map(preset.nodes.map((node, index) => [node.id, index]));
  const layerByNode = new Map<string, number>();

  for (const node of preset.nodes) {
    if (nodeIds.has(node.id)) layerByNode.set(node.id, 0);
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of preset.edges) {
      if (!nodeIds.has(edge.fromNodeId) || !nodeIds.has(edge.toNodeId)) continue;
      const nextLayer = (layerByNode.get(edge.fromNodeId) ?? 0) + 1;
      if (nextLayer > (layerByNode.get(edge.toNodeId) ?? 0)) {
        layerByNode.set(edge.toNodeId, nextLayer);
        changed = true;
      }
    }
  }

  const layers = new Map<number, string[]>();
  for (const nodeId of nodeIds) {
    const layer = layerByNode.get(nodeId) ?? 0;
    layers.set(layer, [...(layers.get(layer) ?? []), nodeId]);
  }

  return [...layers.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, ids]) => ids.sort((left, right) => (order.get(left) ?? 0) - (order.get(right) ?? 0)));
}

function RoleChip({ roleId, compact = false }: { roleId: string; compact?: boolean }) {
  const Icon = ROLE_ICONS[roleId] ?? Users;
  return (
    <div
      className={`${compact ? 'h-8 min-w-8' : 'h-9 min-w-9'} group/role flex items-center justify-center overflow-hidden rounded-full border border-border-panel bg-bg-surface px-2 text-[10px] text-text-secondary transition-all duration-300 hover:min-w-28 hover:border-accent-primary/50 hover:text-text-primary`}
      title={roleName(roleId)}
    >
      <Icon size={compact ? 12 : 13} className="shrink-0 text-accent-primary" />
      <span className="ml-1.5 font-semibold transition-all duration-300 group-hover/role:hidden">
        {roleInitials(roleId)}
      </span>
      <span className="ml-1.5 hidden max-w-20 truncate text-[10px] font-semibold group-hover/role:inline">
        {roleName(roleId)}
      </span>
    </div>
  );
}

function TopologyPreview({ preset }: { preset: PresetDefinition }) {
  const visibleNodes = preset.nodes.slice(0, 6);
  const hiddenNodes = preset.nodes.slice(6);
  const hiddenCount = Math.max(0, preset.nodes.length - visibleNodes.length);
  const isFanout = preset.previewShape === 'fanout' || preset.previewShape === 'parallel_review' || preset.previewShape === 'gate';
  const visibleNodeById = new Map(visibleNodes.map(node => [node.id, node]));
  const visibleLayers = getPreviewLayers(preset, new Set(visibleNodes.map(node => node.id)));

  return (
    <div className="flex min-h-[72px] flex-col items-center justify-center px-4 pt-3">
      {isFanout ? (
        <div className="flex max-w-[470px] items-center justify-center gap-2">
          {visibleLayers.map((layer, layerIndex) => (
            <div key={`${preset.id}:layer:${layerIndex}`} className="flex items-center gap-2">
              {layerIndex > 0 && <ArrowRight size={13} className="text-text-muted/60" />}
              <div className="flex flex-col items-center justify-center gap-1.5">
                {layer.map(nodeId => {
                  const node = visibleNodeById.get(nodeId);
                  if (!node) return null;
                  return <RoleChip key={node.id} roleId={node.roleId} />;
                })}
              </div>
            </div>
          ))}
          {hiddenCount > 0 && (
            <div className="rounded-full border border-border-panel bg-bg-surface px-2.5 py-1 text-[10px] font-semibold text-text-muted transition-opacity duration-200 group-hover/card:opacity-0">
              +{hiddenCount}
            </div>
          )}
        </div>
      ) : (
        <div className="flex items-center justify-center gap-2">
          {visibleNodes.map((node, index) => (
            <div key={node.id} className="flex items-center gap-2">
              {index > 0 && <ArrowRight size={13} className="text-text-muted/60" />}
              <RoleChip roleId={node.roleId} />
            </div>
          ))}
          {hiddenCount > 0 && (
            <div className="rounded-full border border-border-panel bg-bg-surface px-2.5 py-1 text-[10px] font-semibold text-text-muted transition-opacity duration-200 group-hover/card:opacity-0">
              +{hiddenCount}
            </div>
          )}
        </div>
      )}
      {hiddenNodes.length > 0 && (
        <div className="mt-0 flex max-h-0 max-w-[460px] flex-wrap items-center justify-center gap-x-1.5 gap-y-1 overflow-hidden opacity-0 transition-all duration-300 group-hover/card:mt-1 group-hover/card:max-h-24 group-hover/card:opacity-100">
          {hiddenNodes.map((node, index) => (
            <div key={node.id} className="flex items-center gap-1.5">
              {(index > 0 || visibleNodes.length > 0) && <ArrowRight size={12} className="text-text-muted/60" />}
              <RoleChip roleId={node.roleId} compact />
            </div>
          ))}
          </div>
      )}
    </div>
  );
}

function PresetCard({
  preset,
  selected,
  recommended,
  onSelect,
}: {
  preset: PresetDefinition;
  selected: boolean;
  recommended: boolean;
  onSelect: () => void;
}) {
  const metadata = friendlyMetadata(preset);

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`group/card w-full rounded-lg border p-3 text-left transition-all duration-200 ${
        selected
          ? 'border-accent-primary bg-accent-primary/10 shadow-[0_0_0_1px_color-mix(in_srgb,var(--color-accent-primary)_45%,transparent)]'
          : 'border-border-panel bg-bg-panel hover:border-accent-primary/45 hover:bg-bg-surface'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-primary">
              {SIZE_LABELS[preset.size]}
            </span>
            <span className="rounded border border-border-panel px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-text-muted">
              {preset.agentCount} agents
            </span>
            {recommended && (
              <span className="rounded bg-accent-primary/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-accent-primary">
                Recommended
              </span>
            )}
          </div>
          <div className="mt-1 truncate text-[12px] font-semibold text-text-secondary">{preset.name}</div>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1">
          {metadata.map(label => (
            <span key={label} className="rounded border border-border-panel bg-bg-app px-1.5 py-0.5 text-[9px] text-text-muted">
              {label}
            </span>
          ))}
        </div>
      </div>

      <TopologyPreview preset={preset} />

      <p className="mt-2 line-clamp-2 text-[11px] leading-relaxed text-text-muted">{preset.description}</p>
    </button>
  );
}

export function WorkflowPresetPicker({ open, initialMode = 'build', onClose, onApply }: WorkflowPresetPickerProps) {
  const modes = useMemo(() => listWorkflowPresetModes(), []);
  const [activeMode, setActiveMode] = useState<WorkflowPresetMode>(initialMode);
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const [finalReadmeEnabled, setFinalReadmeEnabled] = useState(false);

  const presets = useMemo(() => listWorkflowPresetsByMode(activeMode), [activeMode]);
  const grouped = useMemo(() => Array.from(groupWorkflowPresetsBySubMode(presets).entries()), [presets]);
  const selectedPreset = presets.find(preset => preset.id === selectedPresetId) ?? null;

  useEffect(() => {
    if (!open) return;
    setActiveMode(initialMode);
  }, [initialMode, open]);

  useEffect(() => {
    const nextPreset = grouped
      .map(([, values]) => getRecommendedWorkflowPreset(values))
      .find((preset): preset is PresetDefinition => Boolean(preset));
    setSelectedPresetId(current => {
      if (current && presets.some(preset => preset.id === current)) return current;
      return nextPreset?.id ?? null;
    });
  }, [grouped, presets]);

  useEffect(() => {
    if (!selectedPreset) return;
    setFinalReadmeEnabled(getPresetReadmeDefault(selectedPreset));
  }, [selectedPreset?.id]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="flex h-[72vh] w-[92vw] max-w-[980px] flex-col rounded-xl border border-border-panel bg-bg-app shadow-2xl lg:w-[50vw]">
        <div className="flex items-center justify-between gap-3 border-b border-border-panel bg-bg-titlebar px-4 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-accent-primary">
              <Sparkles size={14} />
              Workflow Presets
            </div>
            <div className="mt-1 truncate text-[11px] text-text-muted">Choose a fixed topology, then inspect or edit the graph before running.</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-border-panel text-text-muted hover:bg-bg-surface hover:text-text-primary"
            aria-label="Close workflow presets"
          >
            <X size={14} />
          </button>
        </div>

        <div className="border-b border-border-panel bg-bg-panel px-3 py-2">
          <div className="flex gap-1 overflow-x-auto">
            {modes.map(mode => {
              const Icon = MODE_ICONS[mode.value];
              const active = mode.value === activeMode;
              return (
                <button
                  key={mode.value}
                  type="button"
                  onClick={() => setActiveMode(mode.value)}
                  title={mode.description}
                  className={`flex h-8 shrink-0 items-center gap-1.5 rounded px-2.5 text-[11px] font-semibold transition-colors ${
                    active
                      ? 'bg-accent-primary text-accent-text'
                      : 'text-text-muted hover:bg-bg-surface hover:text-text-primary'
                  }`}
                >
                  <Icon size={12} />
                  {mode.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4 custom-scrollbar">
          {grouped.map(([subMode, values]) => {
            const recommended = getRecommendedWorkflowPreset(values);
            return (
              <section key={subMode} className="space-y-2">
                <div className="group/title">
                  <div className="flex items-center gap-2">
                    <BookOpenText size={12} className="text-accent-primary" />
                    <h3 className="text-[12px] font-semibold uppercase tracking-[0.18em] text-text-secondary">{subMode}</h3>
                  </div>
                  <div className="h-5 overflow-hidden">
                    <p className="inline-block max-w-0 overflow-hidden whitespace-nowrap text-[10px] leading-5 text-text-muted opacity-0 transition-all duration-500 group-hover/title:max-w-[760px] group-hover/title:opacity-100">
                      {values[0]?.description ?? 'Choose a fixed preset size for this workflow type.'}
                    </p>
                  </div>
                </div>
                <div className="space-y-2">
                  {values.map(preset => (
                    <PresetCard
                      key={preset.id}
                      preset={preset}
                      selected={preset.id === selectedPresetId}
                      recommended={preset.id === recommended?.id}
                      onSelect={() => setSelectedPresetId(preset.id)}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border-panel bg-bg-titlebar px-4 py-3">
          <label className="flex max-w-[320px] items-center gap-2 text-left">
            <input
              type="checkbox"
              checked={finalReadmeEnabled}
              onChange={event => setFinalReadmeEnabled(event.target.checked)}
              className="h-4 w-4 shrink-0 accent-accent-primary"
            />
            <span className="min-w-0">
              <span className="block text-[11px] font-semibold text-text-secondary">Create README</span>
              <span className="block truncate text-[10px] text-text-muted">Final responsible agent writes short usage guidance.</span>
            </span>
          </label>
          <div className="flex min-w-0 items-center justify-end gap-3">
          {selectedPreset && (
            <div className="min-w-0 truncate text-right text-[11px] text-text-muted">
              <span className="text-text-secondary">{selectedPreset.subMode}</span>
              <span className="px-1.5">/</span>
              <span>{SIZE_LABELS[selectedPreset.size]}</span>
              <span className="px-1.5">/</span>
              <span>{selectedPreset.agentCount} agents</span>
            </div>
          )}
          <button
            type="button"
            onClick={() => selectedPreset && onApply(selectedPreset, { finalReadmeEnabled })}
            disabled={!selectedPreset}
            className="rounded border border-accent-primary bg-accent-primary px-3 py-1.5 text-[12px] font-semibold text-accent-text transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Apply
          </button>
          </div>
        </div>
      </div>
    </div>
  );
}
