import { useState } from 'react';
import {
  Layout, Save, Trash2, Play,
  TerminalSquare, FileCode2, Kanban, Activity,
  LayoutDashboard,
} from 'lucide-react';
import { useWorkspaceStore, ThemeType, PaneType, selectActivePanes } from '../../store/workspace';

const THEMES_DARK: { id: ThemeType; label: string; dot: string }[] = [
  { id: 'dark',        label: 'BridgeSpace Dark', dot: '#0c0c14' },
  { id: 'void',        label: 'Void',             dot: '#050508' },
  { id: 'ghost',       label: 'Ghost',            dot: '#1a1c20' },
  { id: 'plasma',      label: 'Plasma',           dot: '#080c16' },
  { id: 'carbon',      label: 'Carbon',           dot: '#1a1a1a' },
  { id: 'hex',         label: 'Hex',              dot: '#010d00' },
  { id: 'neon-tokyo',  label: 'Neon Tokyo',       dot: '#1a1b26' },
  { id: 'obsidian',    label: 'Obsidian',         dot: '#0a0a0a' },
  { id: 'nebula',      label: 'Nebula',           dot: '#0c0a14' },
  { id: 'storm',       label: 'Storm',            dot: '#0f1318' },
  { id: 'infrared',    label: 'Infrared',         dot: '#100808' },
  { id: 'nova',        label: 'Nova',             dot: '#030308' },
  { id: 'stealth',     label: 'Stealth',          dot: '#0c0e0c' },
  { id: 'hologram',    label: 'Hologram',         dot: '#020c14' },
  { id: 'dracula',     label: 'Dracula',          dot: '#282a36' },
  { id: 'bridgemind',  label: 'BridgeMind',       dot: '#0d0d1a' },
  { id: 'synthwave',   label: 'Synthwave',        dot: '#0e0421' },
  { id: 'cybernetics', label: 'Cybernetics',      dot: '#080e18' },
  { id: 'quantum',     label: 'Quantum',          dot: '#040c10' },
  { id: 'mecha',       label: 'Mecha',            dot: '#0e0a06' },
  { id: 'abyss',       label: 'Abyss',            dot: '#000000' },
  { id: 'nord',        label: 'Nord',             dot: '#2e3440' },
  { id: 'ocean',       label: 'Ocean',            dot: '#0d1117' },
  { id: 'cyberpunk',   label: 'Cyberpunk',        dot: '#070710' },
  { id: 'solarized',   label: 'Solarized',        dot: '#002b36' },
];

const THEMES_LIGHT: { id: ThemeType; label: string; dot: string }[] = [
  { id: 'light',  label: 'Light',  dot: '#f4f5fb' },
  { id: 'paper',  label: 'Paper',  dot: '#fafafa' },
  { id: 'chalk',  label: 'Chalk',  dot: '#f2f2f0' },
  { id: 'solar',  label: 'Solar',  dot: '#fdf6e3' },
  { id: 'arctic', label: 'Arctic', dot: '#f0f4f8' },
  { id: 'ivory',  label: 'Ivory',  dot: '#f8f5ee' },
];

const PANE_ICONS: Record<PaneType, React.ReactNode> = {
  terminal:     <TerminalSquare size={11} />,
  editor:       <FileCode2 size={11} />,
  taskboard:    <Kanban size={11} />,
  activityfeed: <Activity size={11} />,
};

const PANE_COLORS: Record<PaneType, string> = {
  terminal:     'text-green-400',
  editor:       'text-blue-400',
  taskboard:    'text-yellow-400',
  activityfeed: 'text-purple-400',
};

const TEMPLATES = [
  { id: 'single', label: 'Single', description: '1 terminal',  count: 1 },
  { id: 'split',  label: 'Split',  description: '2 terminals', count: 2 },
  { id: 'quad',   label: 'Quad',   description: '4 terminals', count: 4 },
  { id: 'six',    label: 'Six',    description: '6 terminals', count: 6 },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs font-semibold text-text-muted uppercase tracking-widest px-1">{title}</div>
      {children}
    </div>
  );
}

export function SettingsTab() {
  const { theme, setTheme, savedLayouts, saveLayout, loadLayout, deleteLayout, clearPanes, addPane } =
    useWorkspaceStore();
  const panes = useWorkspaceStore(selectActivePanes);
  const [layoutName, setLayoutName] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const [showAllDark, setShowAllDark] = useState(false);

  function handleSave() {
    const name = layoutName.trim() || `Layout ${savedLayouts.length + 1}`;
    saveLayout(name);
    setLayoutName('');
  }

  function handleClear() {
    if (confirmClear) {
      clearPanes();
      setConfirmClear(false);
    } else {
      setConfirmClear(true);
      setTimeout(() => setConfirmClear(false), 3000);
    }
  }

  function applyTemplate(count: number) {
    clearPanes();
    for (let i = 1; i <= count; i++) {
      addPane('terminal', `Terminal ${i}`);
    }
  }

  const darkThemesToShow = showAllDark ? THEMES_DARK : THEMES_DARK.slice(0, 8);

  return (
    <div className="flex flex-col gap-5 p-3 overflow-y-auto h-full">

      {/* Templates */}
      <Section title="Templates">
        <div className="grid grid-cols-2 gap-1.5">
          {TEMPLATES.map((tpl) => (
            <button
              key={tpl.id}
              onClick={() => applyTemplate(tpl.count)}
              className="flex flex-col items-start gap-0.5 px-2.5 py-2 rounded-md text-xs bg-bg-surface border border-border-panel hover:border-accent-primary/50 transition-all"
            >
              <div className="flex items-center gap-1.5 text-text-primary font-medium">
                <LayoutDashboard size={11} className="text-accent-primary" />
                {tpl.label}
              </div>
              <span className="text-text-muted text-[10px]">{tpl.description}</span>
            </button>
          ))}
        </div>
      </Section>

      {/* Theme */}
      <Section title="Theme">
        <div className="text-xs text-text-muted px-1 mb-0.5">Dark</div>
        <div className="flex flex-col gap-0.5">
          {darkThemesToShow.map((t) => (
            <ThemeButton key={t.id} t={t} active={theme === t.id} onSelect={setTheme} />
          ))}
          <button
            onClick={() => setShowAllDark(!showAllDark)}
            className="text-xs text-text-muted hover:text-text-primary px-2 py-1 text-left transition-colors"
          >
            {showAllDark ? '↑ Show less' : `↓ +${THEMES_DARK.length - 8} more dark themes`}
          </button>
        </div>
        <div className="text-xs text-text-muted px-1 mt-1 mb-0.5">Light</div>
        <div className="flex flex-col gap-0.5">
          {THEMES_LIGHT.map((t) => (
            <ThemeButton key={t.id} t={t} active={theme === t.id} onSelect={setTheme} />
          ))}
        </div>
      </Section>

      {/* Add Pane shortcuts */}
      <Section title="Add Pane">
        <div className="grid grid-cols-2 gap-1.5">
          {([
            ['terminal',     'Terminal',  'Terminal'],
            ['editor',       'Editor',    'Editor'],
            ['taskboard',    'Tasks',     'Task Board'],
            ['activityfeed', 'Swarm',     'Activity Feed'],
          ] as [PaneType, string, string][]).map(([type, short, full]) => (
            <button
              key={type}
              onClick={() => addPane(type, full)}
              className={`flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs bg-bg-surface border border-border-panel hover:border-accent-primary/50 transition-all ${PANE_COLORS[type]}`}
            >
              {PANE_ICONS[type]}
              <span className="text-text-secondary">{short}</span>
            </button>
          ))}
        </div>
      </Section>

      {/* Save Layout */}
      <Section title="Save Layout">
        <div className="text-xs text-text-muted px-1 mb-1">
          {panes.length === 0
            ? 'No panes open to save.'
            : `Current: ${panes.length} pane${panes.length !== 1 ? 's' : ''}`}
        </div>
        {panes.length > 0 && (
          <>
            <div className="flex flex-wrap gap-1 px-1 mb-1">
              {panes.map((p) => (
                <span
                  key={p.id}
                  className={`flex items-center gap-1 text-xs px-1.5 py-0.5 rounded bg-bg-surface border border-border-panel ${PANE_COLORS[p.type]}`}
                >
                  {PANE_ICONS[p.type]}
                  <span className="text-text-muted truncate max-w-[64px]">{p.title}</span>
                </span>
              ))}
            </div>
            <div className="flex gap-1.5">
              <input
                type="text"
                placeholder="Layout name…"
                value={layoutName}
                onChange={(e) => setLayoutName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                className="flex-1 bg-bg-app border border-border-panel text-text-secondary text-xs px-2 py-1.5 rounded-md focus:outline-none focus:border-accent-primary transition-colors min-w-0"
              />
              <button
                onClick={handleSave}
                className="flex items-center gap-1 px-2 py-1.5 text-xs bg-accent-primary text-accent-text rounded-md hover:bg-accent-hover transition-colors shrink-0"
              >
                <Save size={11} />
                Save
              </button>
            </div>
          </>
        )}
      </Section>

      {/* Saved Layouts */}
      {savedLayouts.length > 0 && (
        <Section title="Saved Layouts">
          <div className="flex flex-col gap-1.5">
            {savedLayouts.map((layout) => (
              <div
                key={layout.id}
                className="bg-bg-surface border border-border-panel rounded-lg p-2 flex flex-col gap-1.5"
              >
                <div className="flex items-center justify-between gap-1">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <Layout size={12} className="text-accent-primary shrink-0" />
                    <span className="text-xs font-medium text-text-primary truncate">{layout.name}</span>
                  </div>
                  <button
                    onClick={() => deleteLayout(layout.id)}
                    className="text-text-muted hover:text-red-400 transition-colors shrink-0 p-0.5"
                    title="Delete layout"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
                <div className="flex flex-wrap gap-1">
                  {layout.panes.map((p, i) => (
                    <span
                      key={i}
                      className={`flex items-center gap-1 text-xs px-1.5 py-0.5 rounded bg-bg-app border border-border-panel ${PANE_COLORS[p.type]}`}
                    >
                      {PANE_ICONS[p.type]}
                      <span className="text-text-muted truncate max-w-[56px]">{p.title}</span>
                    </span>
                  ))}
                </div>
                <div className="flex items-center justify-between gap-1">
                  <span className="text-xs text-text-muted opacity-50">
                    {new Date(layout.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  </span>
                  <button
                    onClick={() => loadLayout(layout.id)}
                    className="flex items-center gap-1 px-2 py-1 text-xs bg-accent-primary/15 text-accent-primary hover:bg-accent-primary/25 rounded-md transition-colors"
                  >
                    <Play size={10} />
                    Load
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Workspace */}
      <Section title="Workspace">
        <button
          onClick={handleClear}
          className={`flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs transition-all w-full border
            ${confirmClear
              ? 'bg-red-500/20 border-red-500/50 text-red-400'
              : 'bg-bg-surface border-border-panel text-text-muted hover:text-red-400 hover:border-red-400/30'}`}
        >
          <Trash2 size={11} />
          {confirmClear ? 'Click again to confirm' : 'Clear all panes'}
        </button>
      </Section>
    </div>
  );
}

function ThemeButton({
  t, active, onSelect,
}: { t: { id: ThemeType; label: string; dot: string }; active: boolean; onSelect: (id: ThemeType) => void }) {
  return (
    <button
      onClick={() => onSelect(t.id)}
      className={`flex items-center gap-2.5 px-2 py-1.5 rounded-md text-xs transition-all text-left w-full
        ${active ? 'bg-accent-primary/15 text-accent-primary' : 'text-text-secondary hover:bg-bg-surface'}`}
    >
      <span className="w-3 h-3 rounded-full border border-border-panel shrink-0" style={{ background: t.dot }} />
      {t.label}
      {active && <span className="ml-auto text-accent-primary text-xs">✓</span>}
    </button>
  );
}
