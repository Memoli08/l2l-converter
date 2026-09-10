"use client";

import { useState, useCallback } from "react";
import { HEX_COLOR_RE } from "@/shared/ipc";

/** Curated palette of popular neon / retro / terminal colors for ASCII art. */
const PALETTE: { name: string; hex: string }[] = [
  { name: "Classic Green",  hex: "#00ff41" },
  { name: "Matrix",         hex: "#008f11" },
  { name: "Amber Terminal", hex: "#ffb000" },
  { name: "Hot Pink",       hex: "#ff2d95" },
  { name: "Cyan Neon",      hex: "#00fff7" },
  { name: "Electric Blue",  hex: "#3d5aff" },
  { name: "Laser Purple",   hex: "#b967ff" },
  { name: "Sunset Orange",  hex: "#ff6e26" },
  { name: "Lime Punch",     hex: "#a6ff00" },
  { name: "Ice White",      hex: "#e0e0e0" },
  { name: "Blood Red",      hex: "#ff003c" },
  { name: "Gold",           hex: "#ffd700" },
];

function isValidHex(v: string): boolean {
  return HEX_COLOR_RE.test(v);
}

interface Props {
  value: string | null;
  onChange: (hex: string | null) => void;
}

export default function AsciiColorPicker({ value, onChange }: Props) {
  const [customHex, setCustomHex] = useState(value ?? "");
  const [expanded, setExpanded] = useState(false);

  const selectPreset = useCallback(
    (hex: string) => {
      setCustomHex(hex);
      onChange(hex);
    },
    [onChange],
  );

  const handleHexInput = useCallback(
    (raw: string) => {
      let v = raw;
      if (v.length > 0 && !v.startsWith("#")) v = "#" + v;
      setCustomHex(v);
      if (isValidHex(v)) {
        onChange(v);
      }
    },
    [onChange],
  );

  const clearColor = useCallback(() => {
    setCustomHex("");
    onChange(null);
  }, [onChange]);

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="inline-flex items-center gap-2 self-start rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] font-medium text-slate-300 transition hover:border-cyan-400/40 hover:text-cyan-300"
      >
        <span
          className="h-3 w-3 rounded-full border border-white/20"
          style={{ backgroundColor: value ?? "#ffffff" }}
        />
        {value ? "Color selected" : "Choose ASCII color"}
        <span className="text-slate-500">{expanded ? "▲" : "▼"}</span>
      </button>

      {expanded && (
        <div className="glass animate-slide-up flex flex-col gap-3 rounded-xl p-3">
          {/* Preset palette grid */}
          <div className="flex flex-wrap gap-1.5">
            {PALETTE.map((c) => (
              <button
                key={c.hex}
                type="button"
                title={`${c.name} (${c.hex})`}
                onClick={() => selectPreset(c.hex)}
                className={`group relative h-7 w-7 rounded-lg border-2 transition-all duration-200 hover:scale-110 ${
                  value?.toLowerCase() === c.hex.toLowerCase()
                    ? "border-white/80 shadow-[0_0_8px_rgba(255,255,255,0.25)]"
                    : "border-white/10 hover:border-white/30"
                }`}
                style={{ backgroundColor: c.hex }}
              >
                {value?.toLowerCase() === c.hex.toLowerCase() && (
                  <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-black/80">
                    ✓
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Divider */}
          <div className="h-px bg-white/10" />

          {/* Custom hex input */}
          <div className="flex items-center gap-2">
            <label className="text-[11px] font-medium text-slate-400">
              Hex:
            </label>
            <div className="flex flex-1 items-center gap-1 rounded-lg border border-white/10 bg-black/30 px-2 py-1">
              <span className="text-xs text-slate-500">#</span>
              <input
                type="text"
                value={customHex.replace(/^#/, "")}
                onChange={(e) => handleHexInput(e.target.value)}
                placeholder="e.g. 00ff88"
                maxLength={8}
                className="w-full bg-transparent font-mono text-xs text-slate-100 outline-none placeholder:text-slate-600"
              />
            </div>
            {customHex && isValidHex(customHex) && (
              <span
                className="h-6 w-6 shrink-0 rounded-md border border-white/20"
                style={{ backgroundColor: customHex }}
              />
            )}
          </div>

          {/* Clear */}
          {value && (
            <button
              type="button"
              onClick={clearColor}
              className="self-start rounded-lg px-2 py-1 text-[10px] font-medium text-slate-500 transition hover:bg-white/[0.05] hover:text-slate-300"
            >
              Reset to default (white)
            </button>
          )}
        </div>
      )}
    </div>
  );
}
