import { useState } from 'react';
import {
  Layout, Save, Trash2, Play,
  Activity, Monitor, Sparkles,
} from 'lucide-react';
import { useWorkspaceStore, selectActivePanes } from '../../store/workspace';

export function SettingsTab() {
  const { savedLayouts, saveLayout, loadLayout, deleteLayout, clearPanes } =
    useWorkspaceStore();
  const panes = useWorkspaceStore(selectActivePanes);
  const canvasEffectsEnabled = useWorkspaceStore(state => state.canvasEffectsEnabled);
  const setCanvasEffectsEnabled = useWorkspaceStore(state => state.setCanvasEffectsEnabled);
  const [layoutName, setLayoutName] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);

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

  return (
    <div className="flex flex-col gap-5 p-3 overflow-y-auto h-full animate-in fade-in slide-in-from-left-2 duration-300">
      {/* Save Layout */}
      <section className="space-y-3">
        <div className="flex items-center gap-2 border-b border-border-panel pb-2 px-1">
          <Save size={14} className="text-text-muted" />
          <h2 className="text-[10px] font-bold uppercase text-text-secondary tracking-widest">Save Layout</h2>
        </div>
        
        {panes.length > 0 ? (
          <div className="space-y-3 px-1">
            <div className="flex gap-1.5">
              <input
                type="text"
                placeholder="Layout name…"
                value={layoutName}
                onChange={(e) => setLayoutName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                className="flex-1 background-bg-app border border-border-panel text-text-secondary text-xs px-2 py-1.5 rounded-md focus:outline-none focus:border-accent-primary transition-colors min-w-0"
              />
              <button
                onClick={handleSave}
                className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-accent-primary text-accent-text rounded-md hover:opacity-90 transition-colors shrink-0 font-bold"
              >
                Save
              </button>
            </div>
            <p className="text-[10px] text-text-muted italic leading-relaxed">
              Captures all {panes.length} currently open panels and their arrangements.
            </p>
          </div>
        ) : (
          <div className="text-[10px] text-text-muted italic px-1">No panels open to save.</div>
        )}
      </section>

      {/* Saved Layouts */}
      {savedLayouts.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center gap-2 border-b border-border-panel pb-2 px-1">
            <Layout size={14} className="text-text-muted" />
            <h2 className="text-[10px] font-bold uppercase text-text-secondary tracking-widest">Library</h2>
          </div>
          
          <div className="flex flex-col gap-1.5">
            {savedLayouts.map((layout) => (
              <div
                key={layout.id}
                className="group background-bg-panel border border-border-panel rounded-lg p-2.5 flex flex-col gap-2 hover:border-text-muted/30 transition-all shadow-sm"
              >
                <div className="flex items-center justify-between gap-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <Monitor size={12} className="text-accent-primary shrink-0 opacity-70" />
                    <span className="text-xs font-bold text-text-primary truncate">{layout.name}</span>
                  </div>
                  <button
                    onClick={() => deleteLayout(layout.id)}
                    className="text-text-muted hover:text-red-400 transition-colors shrink-0 p-1 opacity-0 group-hover:opacity-100"
                    title="Delete layout"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
                
                <div className="flex items-center justify-between gap-1 pt-1">
                  <span className="text-[10px] text-text-muted uppercase font-medium tracking-tighter opacity-50">
                    {new Date(layout.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  </span>
                  <button
                    onClick={() => loadLayout(layout.id)}
                    className="flex items-center gap-1.5 px-3 py-1 text-[10px] bg-accent-primary/10 text-accent-primary hover:bg-accent-primary/20 rounded-md transition-colors font-bold uppercase"
                  >
                    <Play size={10} fill="currentColor" />
                    Restore
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Canvas */}
      <section className="space-y-3">
        <div className="flex items-center gap-2 border-b border-border-panel pb-2 px-1">
          <Sparkles size={14} className="text-text-muted" />
          <h2 className="text-[10px] font-bold uppercase text-text-secondary tracking-widest">Canvas</h2>
        </div>

        <label className="flex items-center justify-between gap-3 px-1 py-1.5 cursor-pointer">
          <div className="min-w-0">
            <div className="text-xs font-bold text-text-primary">Canvas effects</div>
            <div className="text-[10px] text-text-muted leading-relaxed">Animated Node Graph backgrounds.</div>
          </div>
          <input
            type="checkbox"
            checked={canvasEffectsEnabled}
            onChange={(event) => setCanvasEffectsEnabled(event.target.checked)}
            className="h-4 w-4 accent-accent-primary shrink-0"
          />
        </label>
      </section>

      {/* Workspace Controls */}
      <section className="mt-auto pt-4 border-t border-border-panel space-y-4">
        <button
          onClick={handleClear}
          className={`flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs transition-all w-full border font-bold
            ${confirmClear
              ? 'bg-red-500/20 border-red-500/50 text-red-400'
              : 'background-bg-surface border-border-panel text-text-muted hover:text-red-400 hover:border-red-400/30 shadow-inner'}`}
        >
          <Trash2 size={12} />
          {confirmClear ? 'Confirm Reset' : 'Clear Workspace'}
        </button>

        <div className="p-3 background-bg-panel rounded-lg border border-border-panel space-y-2 opacity-60 shadow-inner">
           <div className="flex items-center gap-2 text-[10px] font-bold text-text-muted uppercase tracking-widest">
              <Activity size={12} />
              Session Info
           </div>
           <div className="flex items-center justify-between text-[11px]">
              <span className="text-text-muted">Starlink Link</span>
              <span className="text-emerald-400 font-bold uppercase tracking-tighter">Active</span>
           </div>
        </div>
      </section>
    </div>
  );
}
