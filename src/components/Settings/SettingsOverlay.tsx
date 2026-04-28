import React, { useState, useRef, useEffect } from 'react';
import { X, Palette, Monitor, RotateCcw, Check, Sun, Moon, Sparkles, ChevronDown, Trash2, Edit2, Save } from 'lucide-react';
import { useWorkspaceStore, ThemeType, CustomThemeColors, ThemePreset } from '../../store/workspace';
import { ColorPicker } from '../ColorPicker/ColorPicker';

const THEMES_DARK: { value: ThemeType; label: string }[] = [
// ... (rest of themes)
  { value: 'dark',        label: 'Starlink Dark' },
  { value: 'void',        label: 'Void' },
  { value: 'ghost',       label: 'Ghost' },
  { value: 'plasma',      label: 'Plasma' },
  { value: 'hex',         label: 'Hex' },
  { value: 'neon-tokyo',  label: 'Neon Tokyo' },
  { value: 'obsidian',    label: 'Obsidian' },
  { value: 'nebula',      label: 'Nebula' },
  { value: 'storm',       label: 'Storm' },
  { value: 'infrared',    label: 'Infrared' },
  { value: 'nova',        label: 'Nova' },
  { value: 'stealth',     label: 'Stealth' },
  { value: 'hologram',    label: 'Hologram' },
  { value: 'dracula',     label: 'Dracula' },
  { value: 'cometmind',   label: 'CometMind' },
  { value: 'synthwave',   label: 'Synthwave' },
  { value: 'cybernetics', label: 'Cybernetics' },
  { value: 'quantum',     label: 'Quantum' },
  { value: 'mecha',       label: 'Mecha' },
  { value: 'abyss',       label: 'Abyss' },
  { value: 'nord',        label: 'Nord' },
  { value: 'ocean',       label: 'Ocean' },
  { value: 'cyberpunk',   label: 'Cyberpunk' },
  { value: 'solarized',   label: 'Solarized' },
];

const THEMES_LIGHT: { value: ThemeType; label: string }[] = [
  { value: 'starlink-light', label: 'Starlink Light' },
  { value: 'light',       label: 'Solar' },
  { value: 'paper',       label: 'Paper' },
  { value: 'arctic',      label: 'Arctic' },
  { value: 'ivory',       label: 'Ivory' },
];

const UI_VARS: { label: string; var: keyof CustomThemeColors }[] = [
  { label: 'App Background', var: '--bg-app' },
  { label: 'Panel Background', var: '--bg-panel' },
  { label: 'Surface Background', var: '--bg-surface' },
  { label: 'Primary Accent', var: '--accent-primary' },
  { label: 'Highlighting', var: '--accent-subtle' },
  { label: 'Primary Text', var: '--text-primary' },
];

const SYNTAX_VARS: { label: string; var: keyof CustomThemeColors }[] = [
  { label: 'Keywords', var: '--syntax-keyword' },
  { label: 'Strings', var: '--syntax-string' },
  { label: 'Functions', var: '--syntax-function' },
  { label: 'Variables', var: '--syntax-variable' },
  { label: 'Numbers', var: '--syntax-number' },
  { label: 'Comments', var: '--syntax-comment' },
];

function parseColorToHex(color: string): string {
  if (color.startsWith('#')) return color;
  if (!color.startsWith('rgb')) return color;
  
  // Handle rgb(r, g, b) or rgba(r, g, b, a)
  const matches = color.match(/[\d.]+/g);
  if (!matches || matches.length < 3) return color;
  
  const r = Math.round(parseFloat(matches[0]));
  const g = Math.round(parseFloat(matches[1]));
  const b = Math.round(parseFloat(matches[2]));
  
  return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

export function SettingsOverlay() {
  const { 
    theme, setTheme, setShowSettings, customTheme, setCustomThemeColor, resetCustomTheme,
    themePresets, activePresetId, applyThemePreset, deleteThemePreset, renameThemePreset
  } = useWorkspaceStore();
  const [activePicker, setActivePicker] = useState<keyof CustomThemeColors | null>(null);
  const [editingPresetId, setEditingPresetId] = useState<string | null>(null);
  const [editingPresetName, setEditingPresetName] = useState('');
  const pickerRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    // Force a re-render once containerRef is available or theme changes 
    // to get correct computed styles from the themed container.
    setTick(t => t + 1);
  }, [theme]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) {
        setActivePicker(null);
      }
    };
    if (activePicker) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [activePicker]);

  const handleStartRename = (e: React.MouseEvent, preset: ThemePreset) => {
    e.stopPropagation();
    setEditingPresetId(preset.id);
    setEditingPresetName(preset.name);
  };

  const handleSaveRename = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (editingPresetId && editingPresetName.trim()) {
      renameThemePreset(editingPresetId, editingPresetName.trim());
    }
    setEditingPresetId(null);
  };

  const renderColorCard = (v: { label: string; var: keyof CustomThemeColors }) => {
    // Attempt to read the variable from the actual themed wrapper or document root
    const el = containerRef.current || document.documentElement;
    const computedValue = getComputedStyle(el).getPropertyValue(v.var).trim();
    const defaultColor = parseColorToHex(computedValue) || '#000000';
    
    const currentColor = customTheme[v.var] || defaultColor;
    const isOpen = activePicker === v.var;
    const isSyntaxVar = v.var.startsWith('--syntax-');

    return (
      <div key={v.var} className="relative">
        <button 
          onClick={() => setActivePicker(isOpen ? null : v.var)}
          className={`w-full flex items-center justify-between p-3 background-bg-panel border rounded-lg group transition-all text-left ${isOpen ? 'border-accent-primary ring-1 ring-accent-primary/30' : 'border-border-panel hover:border-accent-primary/50'}`}
        >
          <span className="text-xs text-text-secondary">{v.label}</span>
          <div className="flex items-center gap-3">
             <div 
               className="w-6 h-6 rounded border border-white/10 shadow-sm"
               style={{ background: currentColor }}
             />
             <div className="flex items-center gap-1.5">
               <span className="text-[10px] font-mono text-text-muted transition-opacity uppercase">
                 {currentColor.includes('gradient') ? 'Gradient' : (currentColor || 'Default')}
               </span>
               <ChevronDown size={10} className={`text-text-muted transition-transform ${isOpen ? 'rotate-180' : ''}`} />
             </div>
          </div>
        </button>

        {isOpen && (
          <div 
            ref={pickerRef}
            className="absolute top-full left-0 mt-2 z-[110]"
          >
            <ColorPicker 
              color={currentColor} 
              onChange={(color) => setCustomThemeColor(v.var, color)} 
              allowGradient={!isSyntaxVar}
            />
          </div>
        )}
      </div>
    );
  };

  return (
    <div ref={containerRef} className="absolute inset-0 background-bg-app z-[100] flex flex-col animate-fade-in text-text-primary">
      {/* Header */}
      <div className="h-12 border-b border-border-panel flex items-center justify-between px-6 background-bg-titlebar shrink-0">
        <div className="flex items-center gap-2">
          <Palette size={18} className="text-accent-primary" />
          <h1 className="text-sm font-bold uppercase tracking-widest">Settings & Theme</h1>
        </div>
        
        <button 
          onClick={() => setShowSettings(false)}
          className="w-8 h-8 flex items-center justify-center rounded-md hover:background-bg-surface text-text-muted hover:text-text-primary transition-colors"
        >
          <X size={20} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-8">
        <div className="max-w-6xl mx-auto w-full space-y-16 pb-20">
          
          {/* Preset Selection Section */}
          <section className="space-y-8">
            <div className="flex items-center gap-2 border-b border-border-panel pb-2">
              <Sparkles size={16} className="text-text-muted" />
              <h2 className="text-xs font-bold uppercase text-text-secondary">Theme Library</h2>
            </div>
            
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-12">
               {/* Built-in Themes */}
               <div className="lg:col-span-3 space-y-8">
                  {/* User Presets */}
                  {themePresets.length > 0 && (
                    <div className="animate-in fade-in slide-in-from-top-4 duration-500">
                      <div className="flex items-center gap-2 mb-4">
                         <Palette size={12} className="text-accent-primary" />
                         <h3 className="text-[10px] font-bold text-text-muted uppercase tracking-wider">User Presets</h3>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                        {themePresets.map(p => (
                          <div
                            key={p.id}
                            onClick={() => applyThemePreset(p.id)}
                            className={`group flex flex-col p-2.5 rounded-xl border transition-all cursor-pointer relative ${activePresetId === p.id ? 'bg-accent-primary/10 border-accent-primary shadow-sm' : 'background-bg-panel border-border-panel hover:border-text-muted hover:bg-bg-surface/30'}`}
                          >
                            <div className="flex items-center justify-between gap-2 min-h-[20px]">
                              {editingPresetId === p.id ? (
                                <form onSubmit={handleSaveRename} className="flex-1 flex items-center gap-1" onClick={e => e.stopPropagation()}>
                                  <input 
                                    autoFocus
                                    className="bg-bg-surface border border-accent-primary rounded px-1.5 py-0.5 text-[11px] w-full outline-none text-text-primary"
                                    value={editingPresetName}
                                    onChange={e => setEditingPresetName(e.target.value)}
                                    onBlur={() => handleSaveRename()}
                                  />
                                </form>
                              ) : (
                                <span className={`text-[11px] font-medium truncate flex-1 ${activePresetId === p.id ? 'text-accent-primary font-bold' : 'text-text-secondary'}`}>{p.name}</span>
                              )}
                              <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button 
                                  onClick={(e) => handleStartRename(e, p)}
                                  className="p-1 hover:bg-bg-surface rounded text-text-muted hover:text-text-primary transition-colors"
                                  title="Rename preset"
                                >
                                  <Edit2 size={10} />
                                </button>
                                <button 
                                  onClick={(e) => { e.stopPropagation(); deleteThemePreset(p.id); }}
                                  className="p-1 hover:bg-red-400/10 rounded text-text-muted hover:text-red-400 transition-colors"
                                  title="Delete preset"
                                >
                                  <Trash2 size={10} />
                                </button>
                              </div>
                            </div>
                            <div className="flex gap-1 mt-3">
                              {/* Show a curated selection of colors for the preview dots */}
                              {['--bg-app', '--accent-primary', '--syntax-keyword', '--syntax-string', '--syntax-function'].map((varName) => {
                                const color = p.colors[varName as keyof CustomThemeColors];
                                if (!color) return null;
                                return (
                                  <div 
                                    key={varName} 
                                    className="w-2.5 h-2.5 rounded-full border border-white/5 shadow-inner" 
                                    style={{ backgroundColor: color }} 
                                    title={varName}
                                  />
                                );
                              })}
                            </div>
                            {activePresetId === p.id && (
                              <div className="absolute top-1 right-1">
                                <div className="bg-accent-primary rounded-full p-0.5 shadow-lg shadow-accent-primary/20">
                                  <Check size={8} className="text-white" />
                                </div>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div>
                    <div className="flex items-center gap-2 mb-4">
                       <Moon size={12} className="text-blue-400" />
                       <h3 className="text-[10px] font-bold text-text-muted uppercase tracking-wider">Dark Foundations</h3>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                      {THEMES_DARK.map(t => (
                        <button
                          key={t.value}
                          onClick={() => { applyThemePreset(null); setTheme(t.value); }}
                          className={`flex items-center justify-between px-3 py-2.5 rounded-xl border text-[11px] transition-all ${theme === t.value && !activePresetId ? 'bg-accent-primary/10 border-accent-primary text-accent-primary font-bold shadow-sm' : 'background-bg-panel border-border-panel text-text-muted hover:border-text-muted hover:text-text-secondary hover:bg-bg-surface/30'}`}
                        >
                          <span className="truncate">{t.label}</span>
                          {theme === t.value && !activePresetId && <Check size={12} />}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center gap-2 mb-4">
                       <Sun size={12} className="text-yellow-500" />
                       <h3 className="text-[10px] font-bold text-text-muted uppercase tracking-wider">Light Foundations</h3>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                      {THEMES_LIGHT.map(t => (
                        <button
                          key={t.value}
                          onClick={() => { applyThemePreset(null); setTheme(t.value); }}
                          className={`flex items-center justify-between px-3 py-2.5 rounded-xl border text-[11px] transition-all ${theme === t.value && !activePresetId ? 'bg-accent-primary/10 border-accent-primary text-accent-primary font-bold shadow-sm' : 'background-bg-panel border-border-panel text-text-muted hover:border-text-muted hover:text-text-secondary hover:bg-bg-surface/30'}`}
                        >
                          <span className="truncate">{t.label}</span>
                          {theme === t.value && !activePresetId && <Check size={12} />}
                        </button>
                      ))}
                    </div>
                  </div>
               </div>

               {/* Active Status Card */}
               <div className="space-y-4">
                  <div className="background-bg-panel border border-border-panel rounded-2xl p-8 flex flex-col justify-center items-center text-center space-y-4 shadow-xl sticky top-8">
                     <div className={`w-20 h-20 rounded-3xl shadow-2xl flex items-center justify-center theme-${theme} background-bg-app border border-border-panel transform hover:scale-105 transition-transform duration-500`}>
                        <div className="w-10 h-10 rounded-xl bg-accent-primary animate-pulse" />
                     </div>
                     <div>
                       {activePresetId ? (
                         <>
                           <h3 className="text-sm font-bold text-text-primary">{themePresets.find(p => p.id === activePresetId)?.name}</h3>
                           <p className="text-[10px] text-accent-primary mt-2 uppercase tracking-widest font-bold">Custom Preset Active</p>
                         </>
                       ) : (
                         <>
                           <h3 className="text-sm font-bold text-text-primary">{[...THEMES_DARK, ...THEMES_LIGHT].find(t => t.value === theme)?.label}</h3>
                           <p className="text-[10px] text-text-muted mt-2 uppercase tracking-widest font-medium">Built-in Active</p>
                         </>
                       )}
                     </div>
                     <div className="w-full h-px bg-border-divider mt-2" />
                     <p className="text-[10px] text-text-muted opacity-60 leading-relaxed">
                        {activePresetId 
                          ? "You are currently editing this custom preset. Changes are saved automatically."
                          : "Adjust colors below to automatically fork this foundation into a new custom preset."}
                     </p>
                  </div>
               </div>
            </div>
          </section>

          {/* Custom Theme Section */}
          <section className="space-y-8">
            <div className="flex items-center justify-between border-b border-border-panel pb-2">
              <div className="flex items-center gap-2">
                <Monitor size={16} className="text-text-muted" />
                <h2 className="text-xs font-bold uppercase text-text-secondary">Custom Theme Engine</h2>
              </div>
              <button 
                onClick={resetCustomTheme}
                className="flex items-center gap-1.5 px-3 py-1 text-[10px] uppercase font-bold text-red-400 hover:bg-red-400/10 rounded-md transition-colors"
              >
                <RotateCcw size={12} />
                Reset To Foundation
              </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
              {/* UI Colors */}
              <div className="space-y-4">
                <h3 className="text-[11px] font-bold text-text-muted uppercase tracking-wider">UI Palette</h3>
                <div className="space-y-2">
                  {UI_VARS.map(v => renderColorCard(v))}
                </div>
              </div>

              {/* Syntax Colors */}
              <div className="space-y-4">
                <h3 className="text-[11px] font-bold text-text-muted uppercase tracking-wider">Syntax Palette</h3>
                <div className="space-y-2">
                  {SYNTAX_VARS.map(v => renderColorCard(v))}
                </div>
              </div>

              {/* Live Preview */}
              <div className="space-y-4">
                <h3 className="text-[11px] font-bold text-text-muted uppercase tracking-wider">Live Preview</h3>
                <div className="sticky top-8 space-y-4">
                  <div className="p-6 background-bg-panel border border-border-panel rounded-2xl space-y-4 shadow-2xl relative overflow-hidden">
                     {/* Fake UI chrome */}
                     <div className="flex items-center gap-2 mb-2">
                        <div className="w-2.5 h-2.5 rounded-full bg-accent-primary" />
                        <div className="h-1.5 w-16 bg-border-divider rounded-full" />
                     </div>
                     
                     <div className="space-y-2">
                        <div className="h-2 w-full background-bg-surface rounded" />
                        <div className="h-2 w-4/5 background-bg-surface rounded" />
                        <div className="h-8 w-full bg-accent-primary/20 border border-accent-primary/30 rounded flex items-center px-3">
                           <div className="h-1.5 w-12 bg-accent-primary rounded-full" />
                        </div>
                     </div>

                     <div className="mt-6 p-4 background-bg-app border border-border-panel rounded-xl font-mono text-[11px] leading-relaxed shadow-inner">
                        <div><span style={{ color: 'var(--syntax-keyword)' }}>import</span> {'{'} <span style={{ color: 'var(--syntax-variable)' }}>Comet</span> {'}'} <span style={{ color: 'var(--syntax-keyword)' }}>from</span> <span style={{ color: 'var(--syntax-string)' }}>"ai"</span>;</div>
                        <div className="mt-1"><span style={{ color: 'var(--syntax-keyword)' }}>const</span> <span style={{ color: 'var(--syntax-variable)' }}>app</span> = <span style={{ color: 'var(--syntax-function)' }}>init</span>();</div>
                        <div className="mt-1 text-text-muted opacity-40"><span style={{ color: 'var(--syntax-comment)' }}>// Adjust colors in real-time</span></div>
                        <div className="mt-1"><span style={{ color: 'var(--syntax-variable)' }}>app</span>.<span style={{ color: 'var(--syntax-function)' }}>run</span>(<span style={{ color: 'var(--syntax-number)' }}>2026</span>);</div>
                     </div>

                     <div className="pt-2 flex justify-end">
                        <div className="px-3 py-1.5 rounded bg-accent-primary text-[10px] font-bold uppercase text-white shadow-lg shadow-accent-primary/20">
                           Action Button
                        </div>
                     </div>
                  </div>
                  <p className="text-[10px] text-text-muted italic px-2 leading-relaxed">
                    The colors you pick here are applied globally using CSS variables and persist in your workspace profile.
                  </p>
                </div>
              </div>
            </div>
          </section>

        </div>
      </div>
    </div>
  );
}
