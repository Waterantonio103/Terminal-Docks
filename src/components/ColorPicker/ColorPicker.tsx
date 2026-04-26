import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Pipette, Type, Layers, Grid, ChevronDown, AlertCircle } from 'lucide-react';

interface ColorPickerProps {
  color: string;
  onChange: (color: string) => void;
  allowGradient?: boolean;
}

// --- Color Utils ---
function hexToRgb(hex: string) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : { r: 0, g: 0, b: 0 };
}

function rgbToHex(r: number, g: number, b: number) {
  return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

function rgbToHsv(r: number, g: number, b: number) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s, v = max;
  const d = max - min;
  s = max === 0 ? 0 : d / max;
  if (max !== min) {
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return { h: h * 360, s: s * 100, v: v * 100 };
}

function hsvToRgb(h: number, s: number, v: number) {
  h /= 360; s /= 100; v /= 100;
  let r = 0, g = 0, b = 0;
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  switch (i % 6) {
    case 0: r = v; g = t; b = p; break;
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break;
    case 5: r = v; g = p; b = q; break;
  }
  return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
}

export function ColorPicker({ color, onChange, allowGradient = true }: ColorPickerProps) {
  const [activeTab, setActiveTab] = useState<'solid' | 'gradient'>(color.includes('gradient') && allowGradient ? 'gradient' : 'solid');
  const [hsv, setHsv] = useState({ h: 210, s: 50, v: 50 });
  const [inputValue, setInputValue] = useState(color.startsWith('#') ? color : '');

  useEffect(() => {
    if (color.startsWith('#')) {
      const rgb = hexToRgb(color);
      setHsv(rgbToHsv(rgb.r, rgb.g, rgb.b));
      setInputValue(color);
    }
  }, [color]);

  const handleHsvChange = (newHsv: Partial<{h:number, s:number, v:number}>) => {
    const next = { ...hsv, ...newHsv };
    setHsv(next);
    const rgb = hsvToRgb(next.h, next.s, next.v);
    const hex = rgbToHex(rgb.r, rgb.g, rgb.b);
    onChange(hex);
  };

  const swatches = [
    '#7059f5', '#f43f5e', '#10b981', '#f59e0b', '#3b82f6', '#8b5cf6',
    '#ffffff', '#a1a1aa', '#3f3f46', '#18181b', '#09090b', '#000000'
  ];

  return (
    <div className="w-64 bg-bg-panel border border-border-panel rounded-xl shadow-2xl overflow-hidden flex flex-col animate-in fade-in zoom-in duration-200">
      {/* Tabs */}
      {allowGradient && (
        <div className="flex border-b border-border-panel bg-bg-app/50 p-1 gap-1">
          <button
            onClick={() => setActiveTab('solid')}
            className={`flex-1 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-md transition-all ${activeTab === 'solid' ? 'text-accent-primary bg-bg-panel shadow-sm' : 'text-text-muted hover:text-text-primary'}`}
          >
            Solid
          </button>
          <button
            onClick={() => setActiveTab('gradient')}
            className={`flex-1 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-md transition-all ${activeTab === 'gradient' ? 'text-accent-primary bg-bg-panel shadow-sm' : 'text-text-muted hover:text-text-primary'}`}
          >
            Gradient
          </button>
        </div>
      )}

      <div className="p-4 space-y-4">
        {activeTab === 'solid' ? (
          <>
            {/* Saturation/Value Area */}
            <div className="relative">
              <SaturationPicker hsv={hsv} onChange={handleHsvChange} />
              {color.includes('gradient') && (
                <div className="absolute inset-0 bg-bg-panel/80 backdrop-blur-sm flex flex-col items-center justify-center text-center p-4 rounded-lg">
                  <AlertCircle size={20} className="text-accent-primary mb-2" />
                  <p className="text-[10px] font-bold text-text-primary uppercase tracking-tight">Active Gradient</p>
                  <p className="text-[9px] text-text-muted mt-1 leading-tight">Pick a solid color or switch back to the Gradient tab.</p>
                </div>
              )}
            </div>
            
            {/* Hue Slider */}
            <HueSlider h={hsv.h} onChange={(h) => handleHsvChange({ h })} />

            {/* Hex Input */}
            <div className="flex items-center gap-2 bg-bg-app border border-border-panel rounded-lg px-2.5 py-2">
              <span className="text-[10px] font-bold text-text-muted">HEX</span>
              <input
                type="text"
                value={inputValue}
                onChange={(e) => {
                  setInputValue(e.target.value);
                  if (/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/.test(e.target.value)) {
                    onChange(e.target.value);
                  }
                }}
                className="bg-transparent border-none text-[11px] font-mono text-text-primary focus:outline-none w-full uppercase"
                placeholder="#000000"
              />
            </div>

            {/* Swatches */}
            <div className="grid grid-cols-6 gap-2">
              {swatches.map(s => (
                <button
                  key={s}
                  onClick={() => onChange(s)}
                  className={`w-full aspect-square rounded-md border border-white/5 hover:scale-110 transition-transform ${color.toLowerCase() === s.toLowerCase() ? 'ring-2 ring-accent-primary shadow-lg shadow-accent-primary/20' : ''}`}
                  style={{ backgroundColor: s }}
                />
              ))}
            </div>
          </>
        ) : (
          <GradientControls color={color} onChange={onChange} />
        )}
      </div>
    </div>
  );
}

function SaturationPicker({ hsv, onChange }: { hsv: {h:number, s:number, v:number}, onChange: (val: Partial<{h:number, s:number, v:number}>) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMove = useCallback((e: MouseEvent | TouchEvent) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    
    let x = (clientX - rect.left) / rect.width;
    let y = (clientY - rect.top) / rect.height;
    
    x = Math.max(0, Math.min(1, x));
    y = Math.max(0, Math.min(1, y));
    
    onChange({ s: x * 100, v: (1 - y) * 100 });
  }, [onChange]);

  const handleMouseDown = (e: React.MouseEvent | React.TouchEvent) => {
    handleMove(e.nativeEvent);
    const onMouseMove = (moveEvent: MouseEvent) => handleMove(moveEvent);
    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  return (
    <div 
      ref={containerRef}
      onMouseDown={handleMouseDown}
      onTouchStart={handleMouseDown}
      className="h-32 rounded-lg relative cursor-crosshair overflow-hidden"
      style={{ backgroundColor: `hsl(${hsv.h}, 100%, 50%)` }}
    >
      <div className="absolute inset-0 bg-gradient-to-r from-white to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-t from-black to-transparent" />
      <div 
        className="absolute w-3 h-3 border-2 border-white rounded-full shadow-md -translate-x-1/2 -translate-y-1/2 pointer-events-none"
        style={{ left: `${hsv.s}%`, top: `${100 - hsv.v}%` }}
      />
    </div>
  );
}

function HueSlider({ h, onChange }: { h: number, onChange: (h: number) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMove = useCallback((e: MouseEvent | TouchEvent) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    let x = (clientX - rect.left) / rect.width;
    x = Math.max(0, Math.min(1, x));
    onChange(x * 360);
  }, [onChange]);

  const handleMouseDown = (e: React.MouseEvent | React.TouchEvent) => {
    handleMove(e.nativeEvent);
    const onMouseMove = (moveEvent: MouseEvent) => handleMove(moveEvent);
    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  return (
    <div 
      ref={containerRef}
      onMouseDown={handleMouseDown}
      className="h-3 rounded-full relative cursor-pointer"
      style={{ background: 'linear-gradient(to right, #ff0000 0%, #ffff00 17%, #00ff00 33%, #00ffff 50%, #0000ff 67%, #ff00ff 83%, #ff0000 100%)' }}
    >
      <div 
        className="absolute w-4 h-4 bg-white border-2 border-accent-primary rounded-full shadow-md top-1/2 -translate-y-1/2 -translate-x-1/2"
        style={{ left: `${(h / 360) * 100}%` }}
      />
    </div>
  );
}

function GradientControls({ color, onChange }: { color: string, onChange: (val: string) => void }) {
  const isGradient = color.includes('gradient');
  const [type, setType] = useState<'linear' | 'radial'>(color.includes('radial') ? 'radial' : 'linear');
  
  // Helper to parse existing stops if any
  const [stops, setStops] = useState<{ color: string, pos: number }[]>(() => {
    if (isGradient) {
      // Dummy parser for common formats
      return [
        { color: '#7059f5', pos: 0 },
        { color: '#3b82f6', pos: 100 }
      ];
    }
    return [
      { color: color.startsWith('#') ? color : '#7059f5', pos: 0 },
      { color: '#000000', pos: 100 }
    ];
  });

  const updateGradient = (newStops = stops, newType = type) => {
    const stopStr = [...newStops].sort((a, b) => a.pos - b.pos).map(s => `${s.color} ${s.pos}%`).join(', ');
    const newColor = newType === 'linear' 
      ? `linear-gradient(135deg, ${stopStr})` 
      : `radial-gradient(circle, ${stopStr})`;
    onChange(newColor);
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2 p-1 bg-bg-app rounded-lg">
        <button 
          onClick={() => { setType('linear'); updateGradient(stops, 'linear'); }}
          className={`flex-1 py-1.5 rounded-md text-[10px] font-bold transition-all ${type === 'linear' ? 'bg-bg-panel shadow-sm text-accent-primary' : 'text-text-muted hover:text-text-secondary'}`}
        >
          Linear
        </button>
        <button 
          onClick={() => { setType('radial'); updateGradient(stops, 'radial'); }}
          className={`flex-1 py-1.5 rounded-md text-[10px] font-bold transition-all ${type === 'radial' ? 'bg-bg-panel shadow-sm text-accent-primary' : 'text-text-muted hover:text-text-secondary'}`}
        >
          Radial
        </button>
      </div>

      <div 
        className="h-24 rounded-lg border border-border-panel shadow-inner relative overflow-hidden group"
        style={{ background: color.includes('gradient') ? color : `linear-gradient(135deg, ${color} 0%, #000 100%)` }}
      >
         <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/20 backdrop-blur-[1px]">
            <Pipette size={16} className="text-white" />
         </div>
      </div>

      <div className="space-y-3">
        {stops.map((stop, i) => (
          <div key={i} className="space-y-1.5">
            <div className="flex items-center justify-between px-1">
               <span className="text-[9px] font-bold text-text-muted uppercase tracking-tighter">Stop {i + 1}</span>
               <span className="text-[9px] font-mono text-text-muted uppercase">{stop.color}</span>
            </div>
            <div className="flex items-center gap-3">
              <input 
                type="color" 
                value={stop.color.startsWith('#') ? stop.color : '#000000'} 
                onChange={(e) => {
                  const newStops = [...stops];
                  newStops[i].color = e.target.value;
                  setStops(newStops);
                  updateGradient(newStops);
                }}
                className="w-6 h-6 rounded border border-white/10 bg-transparent cursor-pointer shrink-0"
              />
              <input 
                type="range" 
                min="0" 
                max="100" 
                value={stop.pos}
                onChange={(e) => {
                  const newStops = [...stops];
                  newStops[i].pos = parseInt(e.target.value);
                  setStops(newStops);
                  updateGradient(newStops);
                }}
                className="flex-1 accent-accent-primary h-1 bg-bg-app rounded-lg appearance-none cursor-pointer"
              />
              <span className="text-[10px] font-mono text-text-muted w-8 text-right font-bold">{stop.pos}%</span>
            </div>
          </div>
        ))}
      </div>

      <button 
        onClick={() => {
          const newStops = [...stops, { color: '#ffffff', pos: 50 }];
          setStops(newStops);
          updateGradient(newStops);
        }}
        className="w-full py-2 border border-dashed border-border-panel rounded-lg text-[10px] text-text-muted hover:text-accent-primary hover:border-accent-primary/50 transition-colors font-bold uppercase tracking-wider"
      >
        + Add Color Stop
      </button>
    </div>
  );
}
