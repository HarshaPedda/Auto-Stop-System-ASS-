import { useState, useCallback, useRef, useMemo, useEffect } from "react";
import {
  LayoutDashboard, Layers, Package, Settings, Scissors,
  ClipboardList, Tag, BarChart2,
  AlertTriangle, CheckCircle, X, Check, Play, RotateCcw,
  Home, Menu, Sun, Moon, Cable, LogOut,
} from "lucide-react";
import ScrollPane from "./src/ScrollPane.jsx";

// ═══════════════════════════════════════════════════════════════
//  CONSTANTS & CONFIG
// ═══════════════════════════════════════════════════════════════
const ZONES = ["FRAME", "BASE", "GANTRY", "CONVEYOR", "GUARD", "SUPPORT", "BRACKET", "DOOR", "PANEL", "ENCLOSURE", "CUSTOM"];
const PROFILE_CODES = "ABCDEFGHJKLMNPQRSTUVWXYZ".split("");
const COLORS = [
  "#E05A38", "#2E8BC0", "#43B581", "#E8A838", "#9B59B6",
  "#1ABC9C", "#E84393", "#F39C12", "#00B894", "#6C5CE7",
  "#FD79A8", "#00CEC9", "#E17055", "#0984E3", "#D4A03C",
];
export const ZONE_COLORS = {
  FRAME: "#E05A38", BASE: "#2E8BC0", GANTRY: "#43B581", CONVEYOR: "#E8A838",
  GUARD: "#9B59B6", SUPPORT: "#1ABC9C", BRACKET: "#E84393", DOOR: "#F39C12",
  PANEL: "#00B894", ENCLOSURE: "#6C5CE7", CUSTOM: "#FD79A8",
};

// ═══════════════════════════════════════════════════════════════
//  UNIQUE ID SYSTEM
//  Format: [ZONE]-[ProfileCode][SeqNum]
//  e.g. FRAME-A01, BASE-B03
//  Each physical piece: FRAME-A01/1, FRAME-A01/2 (for qty>1)
//  Bar label: BAR-A-01
//  Cut on bar: BAR-A-01 → Pos 3
// ═══════════════════════════════════════════════════════════════
function generatePartIDs(parts, profileCodeMap) {
  return parts.map((p) => {
    if (!profileCodeMap.has(p.profile)) {
      profileCodeMap.set(p.profile, PROFILE_CODES[profileCodeMap.size % PROFILE_CODES.length]);
    }
    const code = profileCodeMap.get(p.profile);
    const zone = p.zone || "FRAME";
    return { ...p, code, displayId: `${zone}-${code}${String(p.seq).padStart(2, "0")}` };
  });
}

// ═══════════════════════════════════════════════════════════════
//  OPTIMIZER - BFD with damaged stock + standard stock fallback
// ═══════════════════════════════════════════════════════════════
export function optimizeAdvanced(parts, stockInventory, standardLength, kerf, algorithm) {
  const profiles = [...new Set(parts.map(p => p.profile))];
  const allBars = [];
  const profileCodeMap = new Map();

  function packScore(bars) {
    const newCount = bars.filter(b => !b.isInventory).length;
    const wastes = bars.map(b => {
      const eff = b.effectiveLength || b.stockLength;
      return eff - b.cuts.reduce((s, c) => s + c.length + kerf, 0);
    });
    const maxWaste = Math.max(...wastes);
    const nonMaxWaste = wastes.reduce((s, w) => s + w, 0) - maxWaste;
    return newCount * 1e9 + nonMaxWaste;
  }

  function tryPack(pieces, invBarTemplates, profileName) {
    const bars = invBarTemplates.map(b => ({ ...b, cuts: [] }));
    for (const piece of pieces) {
      let bestIdx = -1;
      let bestRemaining = Infinity;
      for (let i = 0; i < bars.length; i++) {
        const usable = bars[i].effectiveLength || bars[i].stockLength;
        const used = bars[i].cuts.reduce((s, c) => s + c.length + kerf, 0);
        const remaining = usable - used - piece.length - kerf;
        if (algorithm === "best") {
          if (remaining >= 0 && remaining < bestRemaining) { bestRemaining = remaining; bestIdx = i; }
        } else {
          if (remaining >= 0) { bestIdx = i; break; }
        }
      }
      if (bestIdx >= 0) {
        bars[bestIdx].cuts.push(piece);
      } else {
        bars.push({
          stockLength: standardLength, effectiveLength: standardLength,
          damageStart: 0, damageEnd: 0, profile: profileName,
          isInventory: false, inventoryId: null, totalLength: standardLength,
          cuts: [piece],
        });
      }
    }
    return bars.filter(b => b.cuts.length > 0);
  }

  for (const profile of profiles) {
    const profileParts = parts.filter(p => p.profile === profile);
    // Expand by qty
    const expanded = [];
    profileParts.forEach(p => {
      if (!profileCodeMap.has(p.profile)) {
        profileCodeMap.set(p.profile, PROFILE_CODES[profileCodeMap.size % PROFILE_CODES.length]);
      }
      const code = profileCodeMap.get(p.profile);
      for (let q = 0; q < p.qty; q++) {
        expanded.push({
          ...p,
          code,
          pieceNum: q + 1,
          displayId: `${p.zone || "FRAME"}-${code}${String(p.seq).padStart(2, "0")}`,
          pieceLabel: `${p.zone || "FRAME"}-${code}${String(p.seq).padStart(2, "0")}/${q + 1}`,
        });
      }
    });
    expanded.sort((a, b) => b.length - a.length);

    // Get available inventory bars for this profile
    const invBars = (stockInventory || [])
      .filter(s => s.profile === profile && !s.used)
      .map(s => ({
        stockLength: s.totalLength,
        effectiveLength: s.totalLength - (s.damageStart || 0) - (s.damageEnd || 0),
        damageStart: s.damageStart || 0,
        damageEnd: s.damageEnd || 0,
        profile,
        isInventory: true,
        inventoryId: s.id,
        totalLength: s.totalLength,
        cuts: [],
      }));
    // Sort inventory by effective length descending (use biggest first)
    invBars.sort((a, b) => b.effectiveLength - a.effectiveLength);

    const sorted = [...expanded].sort((a, b) => b.length - a.length);
    let bestBars = tryPack(sorted, invBars, profile);
    let bestScore = packScore(bestBars);
    for (let t = 0; t < 200; t++) {
      const shuffled = [...expanded].sort(() => Math.random() - 0.5);
      const result = tryPack(shuffled, invBars, profile);
      const score = packScore(result);
      if (score < bestScore) { bestScore = score; bestBars = result; }
    }

    // Number bars and assign cut positions
    bestBars.forEach((bar, bi) => {
      const code = profileCodeMap.get(profile) || "X";
      bar.barLabel = `BAR-${code}-${String(bi + 1).padStart(2, "0")}`;
      bar.barNum = bi + 1;
      bar.cuts.forEach((cut, ci) => {
        cut.barLabel = bar.barLabel;
        cut.cutPosition = ci + 1;
        cut.fullLabel = `${cut.pieceLabel} ▸ ${bar.barLabel} Pos${ci + 1}`;
      });
      allBars.push(bar);
    });
  }

  // Compute stats
  const totalStockUsed = allBars.reduce((s, b) => s + (b.effectiveLength || b.stockLength), 0);
  const totalMaterialUsed = allBars.reduce((s, b) => s + b.cuts.reduce((cs, c) => cs + c.length, 0), 0);
  const totalKerf = allBars.reduce((s, b) => s + b.cuts.length * kerf, 0);
  const totalWaste = totalStockUsed - totalMaterialUsed - totalKerf;
  const totalDamage = allBars.filter(b => b.isInventory).reduce((s, b) => s + b.damageStart + b.damageEnd, 0);
  const efficiency = totalStockUsed > 0 ? ((totalMaterialUsed / totalStockUsed) * 100).toFixed(1) : "0";
  const inventoryUsed = allBars.filter(b => b.isInventory).length;
  const newBarsNeeded = allBars.filter(b => !b.isInventory).length;

  // Offcuts > 100mm
  const offcuts = allBars.map(b => {
    const eff = b.effectiveLength || b.stockLength;
    const used = b.cuts.reduce((s, c) => s + c.length + kerf, 0);
    return { barLabel: b.barLabel, profile: b.profile, length: Math.max(0, eff - used), };
  }).filter(o => o.length > 100);

  return {
    bars: allBars, totalStockUsed, totalMaterialUsed, totalKerf,
    totalWaste, totalDamage, efficiency, inventoryUsed, newBarsNeeded,
    barCount: allBars.length, offcuts, profileCodeMap,
  };
}

// ═══════════════════════════════════════════════════════════════
//  STYLES
// ═══════════════════════════════════════════════════════════════
// ── BlackBoxx Factories Brand Tokens ──
const FONT = "'Inter',sans-serif";
const FONT_HEADING = "'Inter',sans-serif";

const THEMES = {
  dark: {
    bg: "#0F0F0F",
    surface: "#1C1C1C",
    surfaceAlt: "#252525",
    surfaceStrong: "rgba(28,28,28,0.95)",
    text: "#F0F0F0",
    textStrong: "#FFFFFF",
    muted: "#999999",
    mutedDim: "#666666",
    accent: "#C8D400",
    border: "#333333",
    borderDim: "#2A2A2A",
    shadow: "0 1px 8px rgba(0,0,0,0.25)",
    scrollTrack: "rgba(30,30,30,0.8)",
    scrollThumb: "rgba(100,100,100,0.4)",
    scrollThumbHover: "rgba(100,100,100,0.6)",
    font: FONT,
    fontHeading: FONT_HEADING,
  },
  light: {
    bg: "#EAEAEA",
    surface: "#FFFFFF",
    surfaceAlt: "#F1F5F9",
    surfaceStrong: "rgba(255,255,255,0.95)",
    text: "#212121",
    textStrong: "#212121",
    muted: "#666666",
    mutedDim: "#94a3b8",
    accent: "#C8D400",
    border: "#CCCCCC",
    borderDim: "#E0E0E0",
    shadow: "0 1px 8px rgba(0,0,0,0.06)",
    scrollTrack: "rgba(241,245,249,0.8)",
    scrollThumb: "rgba(148,163,184,0.4)",
    scrollThumbHover: "rgba(148,163,184,0.6)",
    font: FONT,
    fontHeading: FONT_HEADING,
  },
};

function makeStyles(BB) {
  return {
    app: {
      height: "100vh", background: BB.bg,
      color: BB.text, fontFamily: BB.font,
      transition: "background .3s, color .3s",
      display: "flex", flexDirection: "column",
    },
    header: {
      background: BB.surfaceStrong,
      borderBottom: `1px solid ${BB.border}`, padding: "18px 48px",
      display: "flex", alignItems: "center", justifyContent: "space-between",
      backdropFilter: "blur(12px)",
      boxShadow: BB.shadow,
      position: "sticky", top: 0, zIndex: 1000,
    },
    logo: {
      display: "flex", alignItems: "center", gap: 14,
    },
    tabBar: {
      display: "flex", gap: 0, borderBottom: `1px solid ${BB.borderDim}`,
      background: BB.surface, overflowX: "auto",
    },
    tab: (active) => ({
      padding: "16px 32px", background: active ? BB.surfaceAlt : "transparent",
      color: active ? BB.accent : BB.muted, border: "none", cursor: "pointer",
      borderBottom: active ? `3px solid ${BB.accent}` : "3px solid transparent",
      fontSize: 15, fontWeight: 700, fontFamily: BB.font, letterSpacing: "1.5px",
      textTransform: "uppercase", whiteSpace: "nowrap",
      transition: "all .15s",
    }),
    card: {
      background: BB.surface, borderRadius: 12, border: `1px solid ${BB.border}`,
      padding: 26, marginBottom: 20,
    },
    label: {
      fontSize: 14, color: BB.muted, letterSpacing: "1.5px", fontWeight: 700,
      textTransform: "uppercase", marginBottom: 8, display: "block",
    },
    input: {
      background: BB.surfaceAlt, border: `1px solid ${BB.border}`, borderRadius: 8,
      padding: "12px 16px", color: BB.text, fontSize: 16, fontFamily: BB.font,
      outline: "none", width: "100%", boxSizing: "border-box",
    },
    inputSm: {
      background: BB.surfaceAlt, border: `1px solid ${BB.border}`, borderRadius: 8,
      padding: "10px 14px", color: BB.text, fontSize: 15, fontFamily: BB.font,
      outline: "none", boxSizing: "border-box",
    },
    select: {
      background: BB.surfaceAlt, border: `1px solid ${BB.border}`, borderRadius: 8,
      padding: "10px 14px", color: BB.text, fontSize: 15, fontFamily: BB.font,
      outline: "none", appearance: "none", cursor: "pointer",
    },
    btnPrimary: {
      padding: "16px 32px", background: BB.accent,
      border: "none", borderRadius: 10, color: "#212121", fontSize: 17, fontWeight: 800,
      cursor: "pointer", fontFamily: BB.fontHeading, letterSpacing: "0.5px",
      boxShadow: `0 4px 16px ${BB.accent}40`,
      transition: "all .15s",
    },
    btnSecondary: {
      padding: "11px 20px", background: BB.surfaceAlt, border: `1px solid ${BB.border}`,
      color: BB.muted, borderRadius: 8, cursor: "pointer", fontSize: 14,
      fontFamily: BB.font, fontWeight: 600,
      transition: "all .15s",
    },
    th: {
      padding: "14px 18px", textAlign: "left", fontSize: 14, color: BB.muted,
      fontWeight: 700, letterSpacing: "1.5px", textTransform: "uppercase",
      borderBottom: `1px solid ${BB.border}`, background: BB.bg,
    },
    td: { padding: "14px 18px", fontSize: 15, borderBottom: `1px solid ${BB.borderDim}` },
    statCard: (clr) => ({
      background: BB.surface, borderRadius: 12, border: `1px solid ${BB.border}`,
      padding: "22px 24px", textAlign: "center",
    }),
    zoneBadge: (zone) => ({
      display: "inline-block", padding: "4px 12px", borderRadius: 6, fontSize: 13,
      fontWeight: 700, color: ZONE_COLORS[zone] || "#aaa", letterSpacing: "0.5px",
      background: (ZONE_COLORS[zone] || "#aaa") + "18",
    }),
    idBadge: {
      display: "inline-block", padding: "4px 10px", borderRadius: 5, fontSize: 13,
      fontWeight: 800, background: BB.surfaceAlt, color: BB.accent, letterSpacing: "0.5px",
      fontFamily: BB.font, border: `1px solid ${BB.border}`,
    },
    themeToggle: {
      display: "flex", alignItems: "center", gap: 6,
      padding: "6px 12px", borderRadius: 16,
      border: `1px solid ${BB.accent}`,
      background: "transparent",
      cursor: "pointer", fontSize: 13, fontWeight: 600,
      color: BB.text, transition: "all .2s",
      fontFamily: FONT_HEADING,
    },
  };
}

// ═══════════════════════════════════════════════════════════════
//  MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════
export default function AdvancedCutOptimizer() {
  const [themeMode, setThemeMode] = useState(() => {
    try { return localStorage.getItem("bb-cut-theme") || "dark"; } catch { return "dark"; }
  });
  const toggleTheme = useCallback(() => {
    setThemeMode(prev => {
      const next = prev === "dark" ? "light" : "dark";
      try { localStorage.setItem("bb-cut-theme", next); } catch { }
      return next;
    });
  }, []);
  const BB = useMemo(() => THEMES[themeMode], [themeMode]);
  const S = useMemo(() => makeStyles(BB), [BB]);

  // Sync body background & scrollbar CSS with theme
  useEffect(() => {
    document.body.style.background = BB.bg;
    document.body.style.color = BB.text;
    const id = "bb-cut-theme-vars";
    let style = document.getElementById(id);
    if (!style) { style = document.createElement("style"); style.id = id; document.head.appendChild(style); }
    style.textContent = `
      ::-webkit-scrollbar-track { background: ${BB.scrollTrack} !important; }
      ::-webkit-scrollbar-thumb { background: ${BB.scrollThumb} !important; }
      ::-webkit-scrollbar-thumb:hover { background: ${BB.scrollThumbHover} !important; }
    `;
  }, [BB]);

  const [tab, setTab] = useState("dashboard");
  const [navOpen, setNavOpen] = useState(false);
  const [now, setNow] = useState(new Date());

  // Live clock
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const [parts, setParts] = useState([
    { id: "p1", profile: "40x40 AL 6063", length: 1200, qty: 4, zone: "FRAME", desc: "Top horizontal rail", seq: 1 },
    { id: "p2", profile: "40x40 AL 6063", length: 800, qty: 6, zone: "FRAME", desc: "Vertical upright", seq: 2 },
    { id: "p3", profile: "20x40 AL 6063", length: 600, qty: 8, zone: "BASE", desc: "Base cross member", seq: 3 },
    { id: "p4", profile: "20x40 AL 6063", length: 450, qty: 4, zone: "BASE", desc: "Base side rail", seq: 4 },
    { id: "p5", profile: "40x80 AL 6063", length: 1500, qty: 2, zone: "GANTRY", desc: "Gantry main beam", seq: 5 },
    { id: "p6", profile: "40x80 AL 6063", length: 900, qty: 4, zone: "GANTRY", desc: "Gantry support", seq: 6 },
  ]);
  const [stockInventory, setStockInventory] = useState([
    { id: "s1", profile: "40x40 AL 6063", totalLength: 6000, damageStart: 0, damageEnd: 150, used: false, note: "Dent on right end" },
    { id: "s2", profile: "40x80 AL 6063", totalLength: 6000, damageStart: 80, damageEnd: 0, used: false, note: "Scratch left 80mm" },
  ]);
  const [standardLengths, setStandardLengths] = useState({
    "40x40 AL 6063": 6000,
    "20x40 AL 6063": 6000,
    "40x80 AL 6063": 6000,
  });
  const [kerf, setKerf] = useState(3);
  const [algorithm, setAlgorithm] = useState("best");
  const [costPerMeter, setCostPerMeter] = useState(8.5);
  const [results, setResults] = useState(null);
  const [newPart, setNewPart] = useState({ profile: "", length: "", qty: 1, zone: "FRAME", desc: "" });
  const [newStock, setNewStock] = useState({ profile: "", totalLength: 6000, damageStart: 0, damageEnd: 0, note: "" });
  const fileRef = useRef(null);
  const nextSeq = useRef(parts.length + 1);

  // Profiles derived from parts
  const profiles = useMemo(() => [...new Set(parts.map(p => p.profile))], [parts]);

  // ─── Parts CRUD ──────────────────────────────────────────────
  const addPart = () => {
    if (!newPart.length || parseFloat(newPart.length) <= 0) return;
    const profile = newPart.profile || profiles[0] || "Extrusion";
    setParts(prev => [...prev, {
      id: `p${Date.now()}`, profile,
      length: parseFloat(newPart.length), qty: parseInt(newPart.qty) || 1,
      zone: newPart.zone || "FRAME", desc: newPart.desc || "",
      seq: nextSeq.current++,
    }]);
    if (!standardLengths[profile]) {
      setStandardLengths(prev => ({ ...prev, [profile]: 6000 }));
    }
    setNewPart({ profile: "", length: "", qty: 1, zone: "FRAME", desc: "" });
  };

  const removePart = (id) => setParts(prev => prev.filter(p => p.id !== id));

  // ─── Stock CRUD ──────────────────────────────────────────────
  const addStock = () => {
    if (!newStock.profile) return;
    setStockInventory(prev => [...prev, {
      id: `s${Date.now()}`, ...newStock,
      totalLength: parseInt(newStock.totalLength) || 6000,
      damageStart: parseInt(newStock.damageStart) || 0,
      damageEnd: parseInt(newStock.damageEnd) || 0,
      used: false,
    }]);
    setNewStock({ profile: "", totalLength: 6000, damageStart: 0, damageEnd: 0, note: "" });
  };

  const removeStock = (id) => setStockInventory(prev => prev.filter(s => s.id !== id));

  // ─── Core optimization (shared by button + CSV auto-run) ─────
  const doOptimize = useCallback((partsData, navigateTo = null) => {
    if (!partsData || partsData.length === 0) return;
    const profileGroups = {};
    partsData.forEach(p => { profileGroups[p.profile] = standardLengths[p.profile] || 6000; });
    const allBars = [];
    const profileCodeMap = new Map();

    // Pre-seed profile codes from CSV originalId (e.g. "BASE-B03/1" → code "B")
    // so bar labels like BAR-B-01 are preserved after optimize
    partsData.forEach(p => {
      if (!profileCodeMap.has(p.profile) && p.originalId) {
        const m = p.originalId.match(/^[A-Z]+-([A-Z])\d/);
        if (m) profileCodeMap.set(p.profile, m[1]);
      }
    });
    // Also check csvBarLabel on parts (e.g. "BAR-B-01" → code "B")
    partsData.forEach(p => {
      if (!profileCodeMap.has(p.profile) && p.csvBarLabel) {
        const m = p.csvBarLabel.match(/^BAR-([A-Z])-/);
        if (m) profileCodeMap.set(p.profile, m[1]);
      }
    });

    const profs = [...new Set(partsData.map(p => p.profile))];

    for (const profile of profs) {
      const profParts = partsData.filter(p => p.profile === profile);
      const stdLen = profileGroups[profile] || 6000;
      const expanded = [];
      profParts.forEach(p => {
        if (!profileCodeMap.has(p.profile)) {
          profileCodeMap.set(p.profile, PROFILE_CODES[profileCodeMap.size % PROFILE_CODES.length]);
        }
        const code = profileCodeMap.get(p.profile);
        for (let q = 0; q < p.qty; q++) {
          expanded.push({
            ...p, code, pieceNum: q + 1,
            displayId: `${p.zone || "FRAME"}-${code}${String(p.seq).padStart(2, "0")}`,
            pieceLabel: `${p.zone || "FRAME"}-${code}${String(p.seq).padStart(2, "0")}/${q + 1}`,
          });
        }
      });
      expanded.sort((a, b) => b.length - a.length);

      const invBars = stockInventory
        .filter(s => s.profile === profile && !s.used)
        .map(s => ({
          stockLength: s.totalLength,
          effectiveLength: s.totalLength - (s.damageStart || 0) - (s.damageEnd || 0),
          damageStart: s.damageStart || 0, damageEnd: s.damageEnd || 0,
          profile, isInventory: true, inventoryId: s.id,
          totalLength: s.totalLength, note: s.note || "", cuts: [],
        }));
      invBars.sort((a, b) => b.effectiveLength - a.effectiveLength);

      function tryPackLocal(pieces) {
        const bars = invBars.map(b => ({ ...b, cuts: [] }));
        for (const piece of pieces) {
          let bestIdx = -1, bestRem = Infinity;
          for (let i = 0; i < bars.length; i++) {
            const eff = bars[i].effectiveLength || bars[i].stockLength;
            const used = bars[i].cuts.reduce((s, c) => s + c.length + kerf, 0);
            const rem = eff - used - piece.length - kerf;
            if (algorithm === "best") {
              if (rem >= 0 && rem < bestRem) { bestRem = rem; bestIdx = i; }
            } else {
              if (rem >= 0) { bestIdx = i; break; }
            }
          }
          if (bestIdx >= 0) {
            bars[bestIdx].cuts.push(piece);
          } else {
            bars.push({
              stockLength: stdLen, effectiveLength: stdLen,
              damageStart: 0, damageEnd: 0, profile,
              isInventory: false, inventoryId: null, totalLength: stdLen,
              note: "", cuts: [piece],
            });
          }
        }
        return bars.filter(b => b.cuts.length > 0);
      }

      function packScoreLocal(bars) {
        const newCount = bars.filter(b => !b.isInventory).length;
        const wastes = bars.map(b => {
          const eff = b.effectiveLength || b.stockLength;
          return eff - b.cuts.reduce((s, c) => s + c.length + kerf, 0);
        });
        const maxWaste = Math.max(...wastes);
        const nonMaxWaste = wastes.reduce((s, w) => s + w, 0) - maxWaste;
        return newCount * 1e9 + nonMaxWaste;
      }

      const sortedPieces = [...expanded].sort((a, b) => b.length - a.length);
      let bestBars = tryPackLocal(sortedPieces);
      let bestScore = packScoreLocal(bestBars);
      for (let t = 0; t < 200; t++) {
        const shuffled = [...expanded].sort(() => Math.random() - 0.5);
        const result = tryPackLocal(shuffled);
        const score = packScoreLocal(result);
        if (score < bestScore) { bestScore = score; bestBars = result; }
      }

      const code = profileCodeMap.get(profile) || "X";
      bestBars.forEach((bar, bi) => {
        bar.barLabel = `BAR-${code}-${String(bi + 1).padStart(2, "0")}`;
        bar.barNum = bi + 1;
        bar.profileCode = code;
        bar.cuts.forEach((cut, ci) => {
          cut.barLabel = bar.barLabel;
          cut.cutPosition = ci + 1;
          cut.fullLabel = `${cut.originalId || cut.pieceLabel} ▸ ${bar.barLabel} Pos${ci + 1}`;
        });
        allBars.push(bar);
      });
    }

    const totalStock = allBars.reduce((s, b) => s + (b.effectiveLength || b.stockLength), 0);
    const totalUsed = allBars.reduce((s, b) => s + b.cuts.reduce((cs, c) => cs + c.length, 0), 0);
    const totalKerf = allBars.reduce((s, b) => s + b.cuts.length * kerf, 0);
    const totalWaste = totalStock - totalUsed - totalKerf;
    const totalDamage = allBars.filter(b => b.isInventory).reduce((s, b) => s + b.damageStart + b.damageEnd, 0);
    const efficiency = totalStock > 0 ? ((totalUsed / totalStock) * 100).toFixed(1) : "0";
    const offcuts = allBars.map(b => {
      const eff = b.effectiveLength || b.stockLength;
      const used = b.cuts.reduce((s, c) => s + c.length + kerf, 0);
      return { barLabel: b.barLabel, profile: b.profile, length: Math.max(0, eff - used) };
    }).filter(o => o.length > 100);

    setResults({
      bars: allBars, totalStockUsed: totalStock, totalMaterialUsed: totalUsed,
      totalKerf, totalWaste, totalDamage, efficiency,
      inventoryUsed: allBars.filter(b => b.isInventory).length,
      newBarsNeeded: allBars.filter(b => !b.isInventory).length,
      barCount: allBars.length, offcuts, profileCodeMap,
      costPerMeter,
      totalCost: (allBars.filter(b => !b.isInventory).reduce((s, b) => s + b.stockLength, 0) / 1000 * costPerMeter).toFixed(2),
    });
    setSelectedBarIdx(null);
    setCompletedCuts(new Set());
    if (navigateTo) setTab(navigateTo);
  }, [stockInventory, standardLengths, kerf, algorithm, costPerMeter]);

  const runOptimize = () => {
    if (parts.length === 0) return;
    setAckedBars(0);
    setBarSeqNum(0);
    doOptimize(parts, "results");
  };


  // ─── CSV Import ──────────────────────────────────────────────
  const handleCSV = useCallback((e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const raw = ev.target.result.replace(/^\uFEFF/, "");
      const lines = raw.trim().split("\n");
      if (lines.length < 2) return;
      const hdr = lines[0].split(",").map(h => h.trim().toLowerCase().replace(/"/g, ""));

      // Column indices
      const col = (names) => hdr.findIndex(h => names.some(n => h === n || h.includes(n)));
      const cutLabelIdx = col(["cut label", "cut_label"]);
      const partIdIdx   = col(["part id", "part_id"]);
      const zoneIdx     = col(["zone"]);
      const profileIdx  = col(["profile"]);
      const lengthIdx   = col(["length"]);
      const barLabelIdx = col(["bar label", "bar_label"]);
      const cutPosIdx   = col(["cut position", "cut_position"]);
      const barStockIdx = col(["bar stock", "bar_stock"]);
      const descIdx     = col(["description", "desc", "note"]);
      const qtyIdx      = col(["qty", "quantity", "count"]);

      if (lengthIdx === -1) return;

      // ── FULL CUT LIST (has bar label col) → load directly into results ──
      if (barLabelIdx >= 0) {
        const rows = lines.slice(1).map(l => l.split(",").map(x => x.trim().replace(/"/g, "")));
        const barMap = new Map(); // barLabel → bar object
        nextSeq.current = 1;
        const parsedParts = [];

        rows.forEach((c, i) => {
          const len = parseFloat(c[lengthIdx]);
          if (!len || len <= 0) return;
          const barLabel  = barLabelIdx >= 0 ? c[barLabelIdx] || "BAR-01" : "BAR-01";
          const profile   = profileIdx  >= 0 ? c[profileIdx]  || "Part"   : "Part";
          const zone      = zoneIdx     >= 0 ? (c[zoneIdx] || "FRAME").toUpperCase() : "FRAME";
          const desc      = descIdx     >= 0 ? c[descIdx]  || "" : "";
          const origId    = cutLabelIdx >= 0 ? c[cutLabelIdx] || (partIdIdx >= 0 ? c[partIdIdx] : "") : "";
          const cutPos    = cutPosIdx   >= 0 ? parseInt(c[cutPosIdx]) || (barMap.get(barLabel)?.cuts.length + 1 || 1) : i + 1;
          const stockLen  = barStockIdx >= 0 ? parseFloat(c[barStockIdx]) || 6000 : 6000;

          if (!barMap.has(barLabel)) {
            barMap.set(barLabel, {
              barLabel, profile, totalLength: stockLen, effectiveLength: stockLen,
              stockLength: stockLen, damageStart: 0, damageEnd: 0,
              isInventory: false, inventoryId: null, note: "", cuts: [],
            });
          }
          const bar = barMap.get(barLabel);
          const seq = nextSeq.current++;
          const cut = {
            id: `p${Date.now()}_${i}`, profile, length: len, zone, desc,
            originalId: origId, pieceLabel: origId || `${zone}-${String(seq).padStart(2,"0")}/1`,
            displayId: partIdIdx >= 0 ? c[partIdIdx] : origId,
            barLabel, cutPosition: cutPos, seq,
            fullLabel: `${origId} ▸ ${barLabel} Pos${cutPos}`,
          };
          bar.cuts.push(cut);
          parsedParts.push({
            id: cut.id, profile, length: len, qty: 1, zone, desc,
            originalId: origId, csvBarLabel: barLabel, seq,
          });
          if (!standardLengths[profile]) setStandardLengths(prev => ({ ...prev, [profile]: stockLen }));
        });

        if (barMap.size === 0) return;
        const allBars = [...barMap.values()].filter(b => b.cuts.length > 0);
        const totalUsed  = allBars.reduce((s, b) => s + b.cuts.reduce((cs, c) => cs + c.length, 0), 0);
        const totalStock = allBars.reduce((s, b) => s + b.stockLength, 0);
        const efficiency = totalStock > 0 ? ((totalUsed / totalStock) * 100).toFixed(1) : "0";
        setAckedBars(0);
        setBarSeqNum(0);
        setParts(parsedParts);
        setResults({
          bars: allBars, totalStockUsed: totalStock, totalMaterialUsed: totalUsed,
          totalKerf: 0, totalWaste: totalStock - totalUsed, totalDamage: 0, efficiency,
          inventoryUsed: 0, newBarsNeeded: allBars.length,
          barCount: allBars.length, offcuts: [], profileCodeMap: new Map(),
          costPerMeter, totalCost: (totalStock / 1000 * costPerMeter).toFixed(2),
        });
        setSelectedBarIdx(null);
        setCompletedCuts(new Set());
        return;
      }

      // ── PARTS-ONLY CSV → parse parts and auto-optimise ──
      const pIdx = profileIdx >= 0 ? profileIdx : hdr.findIndex(h => /profile|name/.test(h));
      const origIdx = cutLabelIdx >= 0 ? cutLabelIdx : partIdIdx;
      const parsed = [];
      nextSeq.current = 1;
      lines.slice(1).forEach((line, i) => {
        const c = line.split(",").map(x => x.trim().replace(/"/g, ""));
        const len = parseFloat(c[lengthIdx]);
        if (len > 0) {
          const profile = pIdx >= 0 ? c[pIdx] || "Part" : "Part";
          parsed.push({
            id: `p${Date.now()}_${i}`, profile, length: len,
            qty: qtyIdx >= 0 ? parseInt(c[qtyIdx]) || 1 : 1,
            zone: zoneIdx >= 0 ? (c[zoneIdx] || "FRAME").toUpperCase() : "FRAME",
            desc: descIdx >= 0 ? c[descIdx] || "" : "",
            originalId: origIdx >= 0 ? c[origIdx] || "" : "",
            seq: nextSeq.current++,
          });
          if (!standardLengths[profile]) setStandardLengths(prev => ({ ...prev, [profile]: 6000 }));
        }
      });
      if (parsed.length > 0) {
        setAckedBars(0);
        setBarSeqNum(0);
        setParts(parsed);
        doOptimize(parsed);
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  }, [standardLengths, costPerMeter, doOptimize]);

  // ─── Export full CSV ─────────────────────────────────────────
  const exportCSV = () => {
    if (!results) return;
    let csv = "Cut Label,Part ID,Zone,Profile,Length (mm),Bar Label,Cut Position,Bar Stock (mm),Description\n";
    results.bars.forEach(bar => {
      bar.cuts.forEach(cut => {
        csv += `"${cut.originalId || cut.pieceLabel}","${cut.displayId}","${cut.zone || ""}","${cut.profile}",${cut.length},"${bar.barLabel}",${cut.cutPosition},${bar.stockLength},"${cut.desc || ""}"\n`;
      });
    });
    csv += "\n\nBAR SUMMARY\nBar Label,Profile,Stock (mm),Effective (mm),Damage Start,Damage End,Cuts,Used (mm),Waste (mm),Efficiency,Source\n";
    results.bars.forEach(bar => {
      const used = bar.cuts.reduce((s, c) => s + c.length, 0);
      const eff = bar.effectiveLength || bar.stockLength;
      const waste = eff - used - bar.cuts.length * kerf;
      const pct = ((used / eff) * 100).toFixed(1);
      csv += `"${bar.barLabel}","${bar.profile}",${bar.totalLength},${eff},${bar.damageStart},${bar.damageEnd},${bar.cuts.length},${used},${waste},${pct}%,${bar.isInventory ? "INVENTORY" : "NEW"}\n`;
    });
    csv += `\nOFFCUTS (reusable > 100mm)\nBar,Profile,Length (mm)\n`;
    results.offcuts.forEach(o => { csv += `"${o.barLabel}","${o.profile}",${o.length.toFixed(0)}\n`; });
    csv += `\nTOTALS\nBars,${results.barCount}\nFrom Inventory,${results.inventoryUsed}\nNew Bars Needed,${results.newBarsNeeded}\nEfficiency,${results.efficiency}%\nNew Material Cost,${results.totalCost}\n`;
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = "cut_list_optimized.csv"; a.click();
  };

  // ─── Profile color helper ────────────────────────────────────
  const pColorMap = useMemo(() => {
    const m = new Map();
    profiles.forEach((p, i) => m.set(p, COLORS[i % COLORS.length]));
    return m;
  }, [profiles]);

  // ─── PLC / Bridge State ────────────────────────────────────
  const [machineConnected, setMachineConnected] = useState(false);
  const [bridgeConnected,  setBridgeConnected]  = useState(false);
  const [sequenceRunning, setSequenceRunning] = useState(false);
  const [selectedBarIdx, setSelectedBarIdx] = useState(null);
  const [completedCuts, setCompletedCuts]   = useState(new Set());
  const wsRef    = useRef(null);
  const logEndRef = useRef(null);

  const toggleCutDone = (key) => {
    setCompletedCuts(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };
  const [machineLogs, setMachineLogs] = useState([]);
  const [ackedBars, setAckedBars] = useState(0);
  const [barSeqNum, setBarSeqNum] = useState(0);
  const lastCutProfileRef  = useRef(null);
  const cutProfileListRef  = useRef([]);
  const cutFlatListRef     = useRef([]); // [{cut, bar}] — one entry per WS cut index
  const autoPrintLabelRef  = useRef(null); // stable ref to print fn, avoids stale closure in useCallback

  const addLog = useCallback((msg) => {
    setMachineLogs(prev => [...prev.slice(-200), { ts: new Date().toLocaleTimeString(), msg }]);
  }, []);

  // Auto-scroll logs
  useEffect(() => {
    if (logEndRef.current) logEndRef.current.scrollIntoView({ behavior: "smooth" });
  }, [machineLogs]);

  // ─── Bridge WebSocket ───────────────────────────────────────
  const wsSend = useCallback((obj) => {
    if (wsRef.current && wsRef.current.readyState === 1) {
      wsRef.current.send(JSON.stringify(obj));
      return true;
    }
    addLog("⚠ Not connected to bridge");
    return false;
  }, [addLog]);

  const connectBridge = useCallback(() => {
    if (wsRef.current) { try { wsRef.current.close(); } catch (_) {} }
    const ws = new WebSocket("ws://localhost:8765");
    ws.onopen = () => {
      setBridgeConnected(true);
      addLog("Bridge online");
      ws.send(JSON.stringify({ cmd: "connect", ip: "192.168.1.5", port: 502 }));
    };
    ws.onmessage = (ev) => {
      try {
        const d = JSON.parse(ev.data);
        if (d.type === "log")            addLog(d.message);
        else if (d.type === "plc_response") addLog(`← PLC: ${d.data}`);
        else if (d.type === "error")     addLog(d.message);
        else if (d.type === "welcome")   addLog(`Bridge: ${d.message}`);
        else if (d.type === "status") {
          setMachineConnected(d.connected);
          addLog(d.message);
        }
        else if (d.type === "sequence_progress") {
          const cutProfile = cutProfileListRef.current[d.idx];
          if (cutProfile !== undefined) {
            if (cutProfile !== lastCutProfileRef.current) {
              lastCutProfileRef.current = cutProfile;
              setBarSeqNum(1);
            } else {
              setBarSeqNum(prev => prev + 1);
            }
          }
          setAckedBars(prev => prev + 1);
          addLog(`✓ Bar ${d.idx + 1}/${d.total} acknowledged`);
          if (autoPrintLabelRef.current) autoPrintLabelRef.current(d.idx);
        }
        else if (d.type === "sequence_done") {
          setSequenceRunning(false);
          addLog(`✓ Sequence complete — all ${d.total} bars sent`);
        }
        else if (d.type === "sequence_stopped") {
          setSequenceRunning(false);
        }
      } catch (_) {}
    };
    ws.onclose = () => {
      setBridgeConnected(false);
      setMachineConnected(false);
      setSequenceRunning(false);
      addLog("Bridge offline");
    };
    ws.onerror = () => addLog("⚠ Cannot reach bridge — run: node plc-bridge.js");
    wsRef.current = ws;
  }, [addLog]);

  // Auto-connect bridge on mount with reconnect
  useEffect(() => {
    connectBridge();
  }, []);

  // Keep autoPrintLabelRef current so the stable WS callback can call it
  useEffect(() => {
    autoPrintLabelRef.current = autoPrintLabel;
  });

  const startSequence = useCallback(() => {
    if (!results || !results.bars.length) { addLog("⚠ No bars — run optimizer first"); return; }
    const cuts = [];
    results.bars.forEach(bar => {
      bar.cuts.forEach(cut => {
        cuts.push({ length: cut.length, label: cut.pieceLabel || cut.displayId || "", barLabel: bar.barLabel });
      });
    });
    const cutProfileList = [];
    const cutFlatList = [];
    results.bars.forEach(bar => {
      bar.cuts.forEach(cut => {
        cutProfileList.push(bar.profile);
        cutFlatList.push({ cut, bar });
      });
    });
    cutProfileListRef.current = cutProfileList;
    cutFlatListRef.current    = cutFlatList;
    lastCutProfileRef.current = null;
    setAckedBars(0);
    setBarSeqNum(0);
    setSequenceRunning(true);
    wsSend({ cmd: "start_sequence", cuts });
    addLog(`▶ Sequence started: ${cuts.length} cuts across ${results.bars.length} bars`);
  }, [results, wsSend, addLog]);

  const stopSequence = useCallback(() => {
    wsSend({ cmd: "stop_sequence" });
    wsSend({ cmd: "home" });
    addLog("■ Stopped + 🏠 Homing D1000=1 sent to PLC");
  }, [wsSend, addLog]);

  function autoPrintLabel(idx) {
    const entry = cutFlatListRef.current[idx];
    if (!entry) return;
    const { cut, bar } = entry;
    const zoneColor = ZONE_COLORS[cut.zone] || "#888";
    const html = `<!DOCTYPE html><html><head><style>
      @page { size: 100mm 60mm; margin: 0; }
      body { margin: 0; font-family: Arial, sans-serif; }
      .label {
        width: 100mm; height: 60mm; box-sizing: border-box;
        padding: 8px 10px; background: #fff; color: #000;
        border: 2px dashed #ccc; display: flex; flex-direction: column; justify-content: space-between;
      }
      .top { display: flex; justify-content: space-between; align-items: flex-start; }
      .id { font-size: 18px; font-weight: 900; letter-spacing: -0.5px; }
      .zone { padding: 3px 8px; border-radius: 4px; font-size: 10px; font-weight: 800;
              background: ${zoneColor}; color: #fff; }
      .mid { font-size: 12px; color: #444; margin: 4px 0; }
      .info { font-size: 10px; color: #666; line-height: 1.5; }
      .footer { display: flex; justify-content: space-between; border-top: 1px solid #eee;
                padding-top: 4px; font-size: 9px; color: #999; }
    </style></head><body>
    <div class="label">
      <div class="top">
        <div class="id">${cut.originalId || cut.pieceLabel || cut.displayId || ""}</div>
        <div class="zone">${cut.zone || ""}</div>
      </div>
      <div class="mid"><strong>${cut.profile || ""}</strong> &middot; <strong>${cut.length} mm</strong></div>
      <div class="info">
        ${cut.desc ? `<div>&#128221; ${cut.desc}</div>` : ""}
        <div>&#128230; Cut from: <strong>${bar.barLabel}</strong></div>
        <div>&#128205; Position: <strong>#${cut.cutPosition || (idx + 1)}</strong></div>
      </div>
    </div>
    </body></html>`;
    const iframe = document.createElement("iframe");
    iframe.style.cssText = "position:fixed;width:0;height:0;border:0;opacity:0;";
    document.body.appendChild(iframe);
    iframe.contentDocument.write(html);
    iframe.contentDocument.close();
    iframe.contentWindow.focus();
    iframe.contentWindow.print();
    setTimeout(() => document.body.removeChild(iframe), 2000);
  }

  const errorCount = machineLogs.filter(l => l.msg.includes("⚠")).length;
  const globalSeqNum = ackedBars;
  const totalBars = results ? results.barCount : 0;
  const presentBar = results && results.bars.length > 0
    ? (selectedBarIdx !== null ? results.bars[selectedBarIdx] : results.bars[0])
    : null;

  const TABS = [
    { key: "dashboard", Icon: LayoutDashboard, label: "Dashboard" },
    { key: "parts",     Icon: Layers,          label: "Parts & Assembly" },
    { key: "stock",     Icon: Package,         label: "Stock Inventory" },
    { key: "settings",  Icon: Settings,        label: "Settings" },
    { key: "results",   Icon: Scissors,        label: "Cut Patterns" },
    { key: "guide",     Icon: ClipboardList,   label: "Assembly Guide" },
    { key: "labels",    Icon: Tag,             label: "Print Labels" },
  ];

  return (
    <div style={S.app}>
      {/* ─── HEADER ───────────────────────────────────────────── */}
      {/* ─── NAV SIDEBAR ──────────────────────────────────────── */}
      {navOpen && (
        <div
          onClick={() => setNavOpen(false)}
          style={{
            position: "fixed", inset: 0, zIndex: 2000,
            background: "rgba(0,0,0,0.55)", backdropFilter: "blur(3px)",
          }}
        />
      )}
      <div style={{
        position: "fixed", top: 0, left: 0, height: "100vh", zIndex: 2100,
        width: navOpen ? 360 : 0, overflow: "hidden",
        background: BB.surface, borderRight: `1px solid ${BB.border}`,
        boxShadow: navOpen ? "4px 0 24px rgba(0,0,0,0.4)" : "none",
        transition: "width .25s cubic-bezier(.4,0,.2,1)",
        display: "flex", flexDirection: "column",
      }}>
        <div style={{
          padding: "26px 28px 18px", borderBottom: `1px solid ${BB.border}`,
          display: "flex", alignItems: "center", justifyContent: "space-between",
          whiteSpace: "nowrap",
        }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: BB.accent, letterSpacing: "2px", textTransform: "uppercase" }}>
            Navigation
          </span>
          <button onClick={() => setNavOpen(false)} style={{
            background: "none", border: "none", color: BB.muted,
            cursor: "pointer", lineHeight: 1, padding: 4, display: "flex",
          }}><X size={22} /></button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "10px 0" }}>
          {TABS.map(t => (
            <button key={t.key} onClick={() => { setTab(t.key); setNavOpen(false); }} style={{
              width: "100%", textAlign: "left", background: tab === t.key ? `${BB.accent}15` : "none",
              border: "none", borderLeft: tab === t.key ? `3px solid ${BB.accent}` : "3px solid transparent",
              padding: "18px 28px", cursor: "pointer", display: "flex", alignItems: "center", gap: 16,
              color: tab === t.key ? BB.accent : BB.text, fontSize: 17, fontWeight: tab === t.key ? 700 : 500,
              fontFamily: BB.font, whiteSpace: "nowrap", transition: "all .15s",
            }}>
              <t.Icon size={22} />
              {t.label}
            </button>
          ))}
        </div>
        <div style={{ padding: "14px 20px", borderTop: `1px solid ${BB.border}`, whiteSpace: "nowrap" }}>
          <span style={{ fontSize: 14, color: BB.mutedDim }}>BLACKBOX ASS Software v1.0</span>
        </div>
      </div>

      <div style={S.header}>
        <div style={S.logo}>
          <img
            src={themeMode === "dark" ? "/logo.webp" : "/logo-light.webp"}
            alt="BlackBoxx Factories"
            style={{ height: 56, width: "auto", objectFit: "contain", display: "block" }}
          />
          <div style={{ width: 1, height: 44, background: BB.border, flexShrink: 0 }} />
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontSize: 24, fontWeight: 400, color: BB.textStrong, fontFamily: BB.fontHeading, lineHeight: 1, letterSpacing: "-0.3px" }}>
              {now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>
            <span style={{ fontSize: 13, color: BB.muted, letterSpacing: "0.8px", textTransform: "uppercase", fontWeight: 600 }}>
              {now.toLocaleDateString([], { weekday: "short", year: "numeric", month: "short", day: "numeric" })}
            </span>
          </div>
          <div style={{ width: 1, height: 44, background: BB.border, flexShrink: 0 }} />
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 10, height: 10, borderRadius: "50%", background: BB.accent, boxShadow: `0 0 10px ${BB.accent}66` }} />
            <span style={{ fontSize: 19, fontWeight: 700, color: BB.text, letterSpacing: -0.2, fontFamily: BB.fontHeading }}>
              Cut List Optimizer
            </span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {/* PLC + PI Status */}
          {[
            { label: "PLC", connected: machineConnected },
            { label: "PI",  connected: bridgeConnected },
          ].map(({ label, connected }) => (
            <div key={label} style={{
              display: "flex", alignItems: "center", gap: 8,
              border: `1px solid ${connected ? "#43B58140" : "#f9546340"}`,
              borderRadius: 8, padding: "8px 16px", background: BB.surfaceAlt,
            }}>
              <Cable size={22} color={connected ? "#43B581" : "#f95463"} />
              <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                <span style={{ fontSize: 12, color: BB.mutedDim, fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", lineHeight: 1 }}>{label}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: connected ? "#43B581" : "#f95463", lineHeight: 1.3 }}>
                  {connected ? "ONLINE" : "OFFLINE"}
                </span>
              </div>
            </div>
          ))}
          <button
            onClick={() => { sessionStorage.removeItem("bb-cut-session"); window.location.reload(); }}
            title="Logout"
            style={{
              background: "none", border: "none", cursor: "pointer",
              color: "#f95463", display: "flex", alignItems: "center", padding: "6px 8px",
            }}
          >
            <LogOut size={28} />
          </button>
          <div style={{ width: 1, height: 20, background: BB.border }} />
          <button style={S.btnSecondary} onClick={() => fileRef.current?.click()}>↑ IMPORT CSV</button>
          <input ref={fileRef} type="file" accept=".csv" style={{ display: "none" }} onChange={handleCSV} />
          {results && <button style={S.btnSecondary} onClick={exportCSV}>↓ EXPORT FULL REPORT</button>}
          <button
            onClick={toggleTheme}
            title={themeMode === "dark" ? "Switch to Light" : "Switch to Dark"}
            style={{ ...S.themeToggle, background: themeMode === "dark" ? `${BB.accent}22` : "transparent" }}
          >
            {themeMode === "dark" ? <Sun size={14} /> : <Moon size={14} />}
            {themeMode === "dark" ? "Light" : "Dark"}
          </button>
        </div>
      </div>


      <ScrollPane T={{ surf2: BB.surfaceAlt, text: BB.text, border: BB.border }} FONT={BB.font} showButtons={false} style={{ width: "100%" }} innerStyle={{ padding: "20px 48px", maxWidth: 1900, margin: "0 auto", width: "100%" }}>

        {/* ═══ DASHBOARD TAB ════════════════════════════════════ */}
        {tab === "dashboard" && (
          <div>
            {/* Metric Tiles — row 1 */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 16 }}>
              {[
                {
                  label: "Global Sequence No.",
                  value: globalSeqNum,
                  sub: sequenceRunning ? "Bars acknowledged by machine" : "Reset on sequence start",
                  color: BB.accent,
                  Icon: Scissors,
                },
                {
                  label: "Bar Sequence No.",
                  value: barSeqNum,
                  sub: presentBar ? `Cuts in ${presentBar.barLabel} (${presentBar.stockLength}mm)` : "Select a bar to populate",
                  color: "#2E8BC0",
                  Icon: BarChart2,
                },
                {
                  label: "Total Bars",
                  value: totalBars,
                  sub: results ? `${results.efficiency}% material efficiency` : "Run optimizer to populate",
                  color: "#9B59B6",
                  Icon: Layers,
                },
                {
                  label: "Errors",
                  value: errorCount,
                  sub: errorCount === 0 ? "No errors detected" : `${errorCount} warning(s) in log`,
                  color: errorCount > 0 ? "#f95463" : "#43B581",
                  Icon: errorCount > 0 ? AlertTriangle : CheckCircle,
                },
              ].map(({ label, value, sub, color, Icon: TileIcon }) => (
                <div key={label} style={{
                  background: BB.surface, border: `1px solid ${BB.border}`,
                  borderRadius: 12, padding: "22px 24px",
                  display: "flex", flexDirection: "column", gap: 8,
                }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ fontSize: 14, color: BB.muted, fontWeight: 700, letterSpacing: "1.5px", textTransform: "uppercase" }}>{label}</span>
                    <TileIcon size={26} color={color} opacity={0.7} />
                  </div>
                  <span style={{ fontSize: 48, fontWeight: 900, color: color, fontFamily: BB.fontHeading, lineHeight: 1 }}>{value}</span>
                  <span style={{ fontSize: 13, color: BB.mutedDim }}>{sub}</span>
                </div>
              ))}
            </div>

            {/* Present Bar + Activity Log — 2-column row */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>

              {/* Present Bar — cut sequence list */}
              <div style={{
                background: BB.surface, border: `1px solid ${BB.border}`,
                borderRadius: 12, padding: "22px 24px",
                height: 440, display: "flex", flexDirection: "column",
              }}>
                {/* Header row */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span style={{ fontSize: 15, color: BB.muted, fontWeight: 700, letterSpacing: "1.5px", textTransform: "uppercase" }}>Present Bar</span>
                    {presentBar && (
                      <>
                        <span style={{ ...S.idBadge }}>{presentBar.barLabel}</span>
                        <span style={{ fontSize: 15, color: BB.mutedDim }}>{presentBar.totalLength} mm · {presentBar.profile}</span>
                      </>
                    )}
                    {machineConnected && (
                      <span style={{
                        display: "inline-flex", alignItems: "center", gap: 5,
                        fontSize: 13, fontWeight: 700, color: "#43B581",
                        background: "#43B58118", border: "1px solid #43B58144",
                        borderRadius: 20, padding: "2px 8px", letterSpacing: "1px",
                      }}>
                        <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#43B581", boxShadow: "0 0 6px #43B58199" }} />
                        PLC CONNECTED
                      </span>
                    )}
                  </div>
                  {presentBar && (
                    <span style={{ fontSize: 14, color: BB.mutedDim }}>
                      {completedCuts.size > 0
                        ? `${[...completedCuts].filter(k => k.startsWith(presentBar.barLabel + "—")).length} / ${presentBar.cuts.length} cut`
                        : `${presentBar.cuts.length} sequence${presentBar.cuts.length !== 1 ? "s" : ""}`}
                    </span>
                  )}
                </div>

                {presentBar ? (
                  <div style={{ display: "flex", flexDirection: "column", flex: 1, borderRadius: 8, overflow: "hidden", border: `1px solid ${BB.border}` }}>
                    {/* Column headers */}
                    <div style={{
                      display: "grid", gridTemplateColumns: "48px 1fr 160px 180px 1fr",
                      background: BB.bg, padding: "12px 18px", gap: 14,
                      borderBottom: `1px solid ${BB.border}`, flexShrink: 0,
                    }}>
                      {["", "Part ID", "Length to Cut", "Bar Label", "Description"].map((h, i) => (
                        <span key={i} style={{ fontSize: 13, color: BB.mutedDim, fontWeight: 700, letterSpacing: "1.2px", textTransform: "uppercase" }}>{h}</span>
                      ))}
                    </div>
                    {/* Cut rows — scrollable */}
                    <ScrollPane T={{ surf2: BB.surfaceAlt, text: BB.text, border: BB.border }} FONT={BB.font} showButtons={false}>
                      {presentBar.cuts.map((cut, idx) => {
                      const key = `${presentBar.barLabel}—${cut.originalId || cut.pieceLabel || cut.displayId}`;
                      const done = completedCuts.has(key);
                      return (
                        <div key={idx} style={{
                          display: "grid", gridTemplateColumns: "48px 1fr 160px 180px 1fr",
                          padding: "15px 18px", gap: 14, alignItems: "center",
                          background: done ? "#43B58110" : idx % 2 === 0 ? BB.surface : BB.surfaceAlt,
                          borderBottom: `1px solid ${BB.borderDim}`,
                          transition: "background .2s",
                        }}>
                          {/* Toggle button */}
                          <button
                            onClick={() => toggleCutDone(key)}
                            title={done ? "Mark as pending" : "Mark as cut"}
                            style={{
                              width: 34, height: 34, borderRadius: "50%", border: `2px solid ${done ? "#43B581" : BB.border}`,
                              background: done ? "#43B581" : "transparent",
                              cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                              transition: "all .2s", flexShrink: 0,
                            }}
                          >
                            {done && <Check size={18} color="#fff" strokeWidth={3} />}
                          </button>
                          {/* Part ID */}
                          <span style={{ ...S.idBadge, opacity: done ? 0.5 : 1, textDecoration: done ? "line-through" : "none" }}>
                            {cut.originalId || cut.pieceLabel || cut.displayId}
                          </span>
                          {/* Length */}
                          <span style={{ fontSize: 17, fontWeight: 700, color: done ? BB.mutedDim : "#E8A838", fontFamily: BB.fontHeading }}>
                            {cut.length} mm
                          </span>
                          {/* Bar Label */}
                          <span style={{ fontSize: 15, color: BB.muted }}>{presentBar.barLabel}</span>
                          {/* Description */}
                          <span style={{ fontSize: 15, color: done ? BB.mutedDim : BB.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {cut.desc || cut.profile || "—"}
                          </span>
                        </div>
                      );
                      })}
                    </ScrollPane>
                  </div>
                ) : (
                  <span style={{ fontSize: 17, color: BB.mutedDim }}>Run the optimizer to see cut sequences for the present bar.</span>
                )}
              </div>

              {/* Activity Log */}
              <div style={{
                background: BB.surface, border: `1px solid ${BB.border}`,
                borderRadius: 12,
                display: "flex", flexDirection: "column", height: 440,
              }}>
                <div style={{ padding: "20px 22px 14px", borderBottom: `1px solid ${BB.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 15, color: BB.muted, fontWeight: 700, letterSpacing: "1.5px", textTransform: "uppercase" }}>Activity Log</span>
                  <button onClick={() => setMachineLogs([])} style={{ ...S.btnSecondary, padding: "8px 16px", fontSize: 13 }}>CLEAR</button>
                </div>
                <div style={{ flex: 1, overflowY: "auto", padding: "12px 18px", fontFamily: BB.font, fontSize: 14, lineHeight: 2 }}>
                  {machineLogs.length === 0 && (
                    <div style={{ color: BB.mutedDim, textAlign: "center", padding: 20 }}>No activity yet.</div>
                  )}
                  {machineLogs.map((log, i) => (
                    <div key={i} style={{ color: log.msg.startsWith("⚠") ? "#E8A838" : log.msg.startsWith("✓") ? "#43B581" : log.msg.includes("→ MOVE") ? BB.accent : BB.muted }}>
                      <span style={{ color: BB.mutedDim, marginRight: 6 }}>{log.ts}</span>{log.msg}
                    </div>
                  ))}
                  <div ref={logEndRef} />
                </div>
              </div>

            </div>

            {/* Quick-access nav tiles */}
            <div style={{ marginBottom: 8 }}>
              <span style={{ fontSize: 15, color: BB.muted, fontWeight: 700, letterSpacing: "1.5px", textTransform: "uppercase" }}>Quick Access</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
              {TABS.filter(t => t.key !== "dashboard").map(t => (
                <button key={t.key} onClick={() => setTab(t.key)} style={{
                  background: BB.surface, border: `1px solid ${BB.border}`, borderRadius: 12,
                  padding: "28px 20px", cursor: "pointer", textAlign: "center",
                  display: "flex", flexDirection: "column", alignItems: "center", gap: 12,
                  color: BB.text, transition: "all .15s",
                  fontFamily: BB.font,
                }}>
                  <t.Icon size={32} />
                  <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", color: BB.muted }}>{t.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ═══ PARTS TAB ═══════════════════════════════════════ */}
        {tab === "parts" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 20, color: BB.muted, fontWeight: 700 }}>PART LIST</h2>
                <p style={{ margin: "6px 0 0", fontSize: 15, color: BB.mutedDim }}>
                  Each part gets a unique assembly ID: ZONE-ProfileCode+Seq / PieceNum
                </p>
              </div>
              <button style={{ ...S.btnPrimary, display: "inline-flex", alignItems: "center", gap: 8 }} onClick={runOptimize}><Play size={18} /> OPTIMIZE</button>
            </div>

            <div style={{ ...S.card, padding: 0, overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {["Part ID", "Zone", "Profile", "Length", "Qty", "Description", ""].map((h, i) => (
                      <th key={i} style={S.th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {parts.map(p => {
                    const codeMap = new Map();
                    profiles.forEach((pr, i) => codeMap.set(pr, PROFILE_CODES[i % PROFILE_CODES.length]));
                    const code = codeMap.get(p.profile) || "X";
                    const previewId = `${p.zone || "FRAME"}-${code}${String(p.seq).padStart(2, "0")}`;
                    return (
                      <tr key={p.id}>
                        <td style={S.td}>
                          <span style={S.idBadge}>{p.originalId || previewId}</span>
                          {p.originalId && <span style={{ fontSize: 13, color: BB.mutedDim, marginLeft: 5 }}>{previewId}</span>}
                        </td>
                        <td style={S.td}><span style={S.zoneBadge(p.zone)}>{p.zone}</span></td>
                        <td style={S.td}>
                          <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: pColorMap.get(p.profile) || "#666", marginRight: 6, verticalAlign: "middle" }} />
                          {p.profile}
                        </td>
                        <td style={{ ...S.td, fontWeight: 700, color: BB.textStrong }}>{p.length} mm</td>
                        <td style={S.td}>×{p.qty}</td>
                        <td style={{ ...S.td, color: BB.muted, fontSize: 11 }}>{p.desc}</td>
                        <td style={S.td}>
                          <button onClick={() => removePart(p.id)} style={{ background: "none", border: "none", color: BB.mutedDim, cursor: "pointer", display: "flex" }}><X size={20} /></button>
                        </td>
                      </tr>
                    );
                  })}
                  {/* Add row */}
                  <tr style={{ background: BB.bg }}>
                    <td style={S.td}><span style={{ fontSize: 14, color: BB.mutedDim }}>auto</span></td>
                    <td style={S.td}>
                      <select value={newPart.zone} onChange={e => setNewPart(p => ({ ...p, zone: e.target.value }))} style={{ ...S.select, width: 100 }}>
                        {ZONES.map(z => <option key={z} value={z}>{z}</option>)}
                      </select>
                    </td>
                    <td style={S.td}>
                      <input placeholder="Profile" value={newPart.profile} onChange={e => setNewPart(p => ({ ...p, profile: e.target.value }))}
                        list="profile-list" style={{ ...S.inputSm, width: 140 }} />
                      <datalist id="profile-list">{profiles.map(p => <option key={p} value={p} />)}</datalist>
                    </td>
                    <td style={S.td}>
                      <input type="number" placeholder="mm" value={newPart.length} onChange={e => setNewPart(p => ({ ...p, length: e.target.value }))}
                        onKeyDown={e => e.key === "Enter" && addPart()} style={{ ...S.inputSm, width: 80 }} />
                    </td>
                    <td style={S.td}>
                      <input type="number" min="1" value={newPart.qty} onChange={e => setNewPart(p => ({ ...p, qty: e.target.value }))} style={{ ...S.inputSm, width: 50 }} />
                    </td>
                    <td style={S.td}>
                      <input placeholder="Assembly note" value={newPart.desc} onChange={e => setNewPart(p => ({ ...p, desc: e.target.value }))} style={{ ...S.inputSm, width: 160 }} />
                    </td>
                    <td style={S.td}>
                      <button onClick={addPart} style={{ ...S.btnPrimary, padding: "6px 14px", fontSize: 12 }}>+</button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ═══ STOCK INVENTORY TAB ═════════════════════════════ */}
        {tab === "stock" && (
          <div>
            <h2 style={{ margin: "0 0 6px", fontSize: 20, color: BB.muted, fontWeight: 700 }}>AVAILABLE STOCK INVENTORY</h2>
            <p style={{ margin: "0 0 18px", fontSize: 15, color: BB.mutedDim }}>
              Add existing bars from your warehouse. Damaged ends will be cut off before nesting. Bars here are used first before ordering new stock.
            </p>

            {/* Standard lengths per profile */}
            <div style={{ ...S.card, marginBottom: 18 }}>
              <span style={S.label}>Standard Order Lengths (new stock)</span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 6 }}>
                {profiles.map(p => (
                  <div key={p} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 11, color: pColorMap.get(p), fontWeight: 600 }}>{p}:</span>
                    <input type="number" value={standardLengths[p] || 6000}
                      onChange={e => setStandardLengths(prev => ({ ...prev, [p]: parseInt(e.target.value) || 6000 }))}
                      style={{ ...S.inputSm, width: 80 }} />
                    <span style={{ fontSize: 10, color: BB.mutedDim }}>mm</span>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ ...S.card, padding: 0, overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {["Profile", "Total Length", "Damage Start", "Damage End", "Effective", "Note", ""].map((h, i) => (
                      <th key={i} style={S.th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {stockInventory.map(s => {
                    const eff = s.totalLength - (s.damageStart || 0) - (s.damageEnd || 0);
                    const hasDamage = (s.damageStart || 0) > 0 || (s.damageEnd || 0) > 0;
                    return (
                      <tr key={s.id}>
                        <td style={S.td}>
                          <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: pColorMap.get(s.profile) || "#666", marginRight: 6, verticalAlign: "middle" }} />
                          {s.profile}
                        </td>
                        <td style={{ ...S.td, fontWeight: 700, color: BB.textStrong }}>{s.totalLength} mm</td>
                        <td style={{ ...S.td, color: s.damageStart > 0 ? "#f95463" : BB.mutedDim }}>
                          {s.damageStart || 0} mm {s.damageStart > 0 && <AlertTriangle size={12} color="#f95463" style={{ verticalAlign: "middle" }} />}
                        </td>
                        <td style={{ ...S.td, color: s.damageEnd > 0 ? "#f95463" : BB.mutedDim }}>
                          {s.damageEnd || 0} mm {s.damageEnd > 0 && <AlertTriangle size={12} color="#f95463" style={{ verticalAlign: "middle" }} />}
                        </td>
                        <td style={{ ...S.td, fontWeight: 700, color: hasDamage ? "#E8A838" : "#43B581" }}>{eff} mm</td>
                        <td style={{ ...S.td, fontSize: 11, color: BB.muted }}>{s.note}</td>
                        <td style={S.td}>
                          <button onClick={() => removeStock(s.id)} style={{ background: "none", border: "none", color: BB.mutedDim, cursor: "pointer", display: "flex" }}><X size={14} /></button>
                        </td>
                      </tr>
                    );
                  })}
                  <tr style={{ background: BB.bg }}>
                    <td style={S.td}>
                      <input placeholder="Profile" value={newStock.profile} onChange={e => setNewStock(p => ({ ...p, profile: e.target.value }))}
                        list="stock-profile-list" style={{ ...S.inputSm, width: 140 }} />
                      <datalist id="stock-profile-list">{profiles.map(p => <option key={p} value={p} />)}</datalist>
                    </td>
                    <td style={S.td}><input type="number" value={newStock.totalLength} onChange={e => setNewStock(p => ({ ...p, totalLength: e.target.value }))} style={{ ...S.inputSm, width: 80 }} /></td>
                    <td style={S.td}><input type="number" value={newStock.damageStart} onChange={e => setNewStock(p => ({ ...p, damageStart: e.target.value }))} style={{ ...S.inputSm, width: 70 }} /></td>
                    <td style={S.td}><input type="number" value={newStock.damageEnd} onChange={e => setNewStock(p => ({ ...p, damageEnd: e.target.value }))} style={{ ...S.inputSm, width: 70 }} /></td>
                    <td style={S.td}><span style={{ fontSize: 14, color: BB.mutedDim }}>auto</span></td>
                    <td style={S.td}><input placeholder="Damage note" value={newStock.note} onChange={e => setNewStock(p => ({ ...p, note: e.target.value }))} style={{ ...S.inputSm, width: 140 }} /></td>
                    <td style={S.td}><button onClick={addStock} style={{ ...S.btnPrimary, padding: "6px 14px", fontSize: 12 }}>+</button></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ═══ SETTINGS TAB ════════════════════════════════════ */}
        {tab === "settings" && (
          <div style={{ maxWidth: 500 }}>
            <h2 style={{ margin: "0 0 16px", fontSize: 14, color: BB.muted, fontWeight: 700 }}>OPTIMIZATION SETTINGS</h2>
            <div style={S.card}>
              <span style={S.label}>Blade Kerf (mm)</span>
              <input type="number" step="0.5" min="0" value={kerf} onChange={e => setKerf(parseFloat(e.target.value) || 0)} style={S.input} />

              <span style={{ ...S.label, marginTop: 16 }}>Algorithm</span>
              <div style={{ display: "flex", gap: 8 }}>
                {[["best", "Best Fit (BFD)"], ["first", "First Fit (FFD)"]].map(([v, l]) => (
                  <button key={v} onClick={() => setAlgorithm(v)} style={{
                    flex: 1, padding: 10, borderRadius: 6, fontSize: 11, fontFamily: "inherit",
                    cursor: "pointer", fontWeight: 700,
                    background: algorithm === v ? BB.accent : BB.surfaceAlt,
                    color: algorithm === v ? "#212121" : BB.muted,
                    border: algorithm === v ? `1px solid ${BB.accent}` : `1px solid ${BB.border}`,
                  }}>{l}</button>
                ))}
              </div>

              <span style={{ ...S.label, marginTop: 16 }}>Material Cost ($/meter)</span>
              <input type="number" step="0.5" min="0" value={costPerMeter} onChange={e => setCostPerMeter(parseFloat(e.target.value) || 0)} style={S.input} />

              <div style={{ marginTop: 20, padding: 14, background: BB.bg, borderRadius: 8, border: `1px solid ${BB.border}` }}>
                <span style={{ ...S.label, marginBottom: 8 }}>ID System Explained</span>
                <p style={{ margin: "4px 0", fontSize: 12, color: BB.muted, lineHeight: 1.6 }}>
                  <span style={S.idBadge}>FRAME-A01/2</span> means:
                </p>
                <p style={{ margin: "2px 0 2px 10px", fontSize: 11, color: BB.muted }}>
                  <strong style={{ color: BB.accent }}>FRAME</strong> = Assembly zone where this piece goes
                </p>
                <p style={{ margin: "2px 0 2px 10px", fontSize: 11, color: BB.muted }}>
                  <strong style={{ color: BB.accent }}>A</strong> = Profile type (A=first profile, B=second, etc.)
                </p>
                <p style={{ margin: "2px 0 2px 10px", fontSize: 11, color: BB.muted }}>
                  <strong style={{ color: BB.textStrong }}>01</strong> = Part sequence number
                </p>
                <p style={{ margin: "2px 0 2px 10px", fontSize: 11, color: BB.muted }}>
                  <strong style={{ color: "#43B581" }}>/2</strong> = Piece 2 of that part (when qty &gt; 1)
                </p>
                <p style={{ margin: "10px 0 0", fontSize: 11, color: BB.muted }}>
                  Bar labels: <span style={{ ...S.idBadge, color: "#2E8BC0" }}>BAR-A-02</span> = Bar #2 for profile A
                </p>
                <p style={{ margin: "6px 0 0", fontSize: 11, color: BB.muted }}>
                  Write the label on each cut piece with a marker. The assembly worker matches zone + ID to the drawing.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ═══ RESULTS TAB ═════════════════════════════════════ */}
        {tab === "results" && results && (
          <div>
            {/* Stats */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(6,1fr)", gap: 10, marginBottom: 20 }}>
              {[
                ["Total Bars", results.barCount, "", BB.accent],
                ["Efficiency", results.efficiency, "%", parseFloat(results.efficiency) > 85 ? "#43B581" : "#E8A838"],
                ["From Stock", results.inventoryUsed, "pcs", "#2E8BC0"],
                ["New Bars", results.newBarsNeeded, "pcs", "#FD79A8"],
                ["Waste", (results.totalWaste / 1000).toFixed(1), "m", "#9B59B6"],
                ["New Cost", "$" + results.totalCost, "", "#D4A03C"],
              ].map(([lbl, val, unit, clr], i) => (
                <div key={i} style={S.statCard(clr)}>
                  <div style={{ fontSize: 10, color: BB.muted, letterSpacing: "1px", marginBottom: 4, fontWeight: 700 }}>{lbl}</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: clr }}>{val}<span style={{ fontSize: 10, color: BB.muted }}>{unit}</span></div>
                </div>
              ))}
            </div>

            {/* Profile Wise Cuts */}
            {(() => {
              const summary = {};
              results.bars.forEach(bar => {
                const p = bar.profile;
                if (!summary[p]) summary[p] = { totalQty: 0, totalLength: 0, barCount: 0 };
                summary[p].barCount++;
                bar.cuts.forEach(cut => {
                  summary[p].totalQty++;
                  summary[p].totalLength += cut.length;
                });
              });
              const rows = Object.entries(summary);
              return (
                <div style={{ ...S.card, marginBottom: 16 }}>
                  <div style={{ marginBottom: 12 }}>
                    <span style={S.label}>Profile Wise Cuts</span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1.8fr 1fr", gap: 6, padding: "6px 10px", borderBottom: `1px solid ${BB.border}`, marginBottom: 4 }}>
                    {["Profile", "Qty (pcs)", "Total Length", "6000mm Bars"].map(h => (
                      <span key={h} style={{ fontSize: 10, color: BB.muted, fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase" }}>{h}</span>
                    ))}
                  </div>
                  {rows.map(([profile, s], i) => {
                    const clr = pColorMap.get(profile) || "#888";
                    return (
                      <div key={profile} style={{
                        display: "grid", gridTemplateColumns: "2fr 1fr 1.8fr 1fr", gap: 6,
                        padding: "9px 10px", borderRadius: 6, alignItems: "center",
                        background: i % 2 === 0 ? BB.surfaceAlt : "transparent",
                      }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: clr }}>{profile}</span>
                        <span style={{ fontSize: 13, fontWeight: 700, color: BB.textStrong }}>{s.totalQty} pcs</span>
                        <span style={{ fontSize: 13, fontWeight: 700, color: BB.accent }}>
                          {(s.totalLength / 1000).toFixed(3)} m
                          <span style={{ fontSize: 10, color: BB.muted, marginLeft: 6 }}>({s.totalLength.toFixed(0)} mm)</span>
                        </span>
                        <span style={{ fontSize: 13, fontWeight: 700, color: "#43B581" }}>
                          {s.barCount} bar{s.barCount !== 1 ? "s" : ""}
                        </span>
                      </div>
                    );
                  })}
                </div>
              );
            })()}

            {/* Bars */}
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {results.bars.map((bar, bi) => {
                const eff = bar.effectiveLength || bar.stockLength;
                const used = bar.cuts.reduce((s, c) => s + c.length, 0);
                const kerfTotal = bar.cuts.length * kerf;
                const waste = Math.max(0, eff - used - kerfTotal);
                const pct = ((used / eff) * 100).toFixed(1);
                const clr = pColorMap.get(bar.profile) || "#666";
                return (
                  <div key={bi} style={S.card}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span style={{ ...S.idBadge, color: "#2E8BC0", fontSize: 11 }}>{bar.barLabel}</span>
                        <span style={{ fontSize: 11, color: clr, fontWeight: 700 }}>{bar.profile}</span>
                        {bar.isInventory && <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 3, background: "#43B58120", color: "#43B581", fontWeight: 700 }}>INVENTORY</span>}
                        {(bar.damageStart > 0 || bar.damageEnd > 0) && (
                          <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 3, background: "#f9546320", color: "#f95463", fontWeight: 700 }}>
                            DMG: {bar.damageStart > 0 ? `←${bar.damageStart}mm` : ""}{bar.damageStart > 0 && bar.damageEnd > 0 ? " + " : ""}{bar.damageEnd > 0 ? `${bar.damageEnd}mm→` : ""}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 11, color: BB.muted }}>
                        <span style={{ color: parseFloat(pct) > 85 ? "#43B581" : "#E8A838", fontWeight: 700 }}>{pct}%</span>
                        {" · "}waste: {waste.toFixed(0)}mm
                        {" · "}{eff}mm effective
                      </div>
                    </div>

                    {/* Visual bar */}
                    {(() => {
                      const total = bar.totalLength;
                      const segments = [];
                      if (bar.damageStart > 0) segments.push({ type: "damage", length: bar.damageStart, label: `Damaged: ${bar.damageStart}mm`, end: false });
                      bar.cuts.forEach((cut, ci) => {
                        segments.push({ type: "cut", length: cut.length, cut, zone: cut.zone });
                        segments.push({ type: "kerf", length: kerf });
                      });
                      if (bar.damageEnd > 0) segments.push({ type: "damage", length: bar.damageEnd, label: `Damaged: ${bar.damageEnd}mm`, end: true });
                      const usedLen = segments.reduce((s, seg) => s + seg.length, 0);
                      const wasteLen = Math.max(0, total - usedLen);
                      if (wasteLen > 0) segments.push({ type: "waste", length: wasteLen });

                      return (
                        <div style={{ height: 40, background: BB.surfaceAlt, borderRadius: 6, display: "flex", overflow: "hidden", border: `1px solid ${BB.border}` }}>
                          {segments.map((seg, si) => {
                            const pctW = (seg.length / total) * 100;
                            if (seg.type === "damage") {
                              return <div key={si} style={{ width: `${pctW}%`, flexShrink: 0, background: "repeating-linear-gradient(45deg,#f9546330,#f9546330 4px,transparent 4px,transparent 8px)", ...(seg.end ? { borderLeft: "2px solid #f95463" } : { borderRight: "2px solid #f95463" }) }} title={seg.label} />;
                            }
                            if (seg.type === "kerf") {
                              return <div key={si} style={{ width: pctW > 0.3 ? `${pctW}%` : 1, flexShrink: 0, minWidth: 1, background: `${BB.accent}55` }} />;
                            }
                            if (seg.type === "waste") {
                              return <div key={si} style={{ flex: 1, minWidth: 0, background: BB.bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: pctW > 8 ? 9 : 0, color: BB.mutedDim, fontWeight: 600, overflow: "hidden" }}>{pctW > 8 && `${seg.length.toFixed(0)}mm waste`}</div>;
                            }
                            const cutClr = ZONE_COLORS[seg.zone] || clr;
                            return (
                              <div key={si} style={{
                                width: `${pctW}%`, flexShrink: 0, minWidth: pctW > 0.5 ? undefined : 2,
                                background: `linear-gradient(180deg,${cutClr}DD,${cutClr}88)`,
                                display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column",
                                fontSize: pctW > 8 ? 9 : 0, fontWeight: 700, color: "#fff", overflow: "hidden",
                              }} title={`${seg.cut.originalId || seg.cut.pieceLabel}: ${seg.cut.length}mm — ${seg.cut.desc || ""}`}>
                                {pctW > 8 && <span>{seg.cut.originalId || seg.cut.pieceLabel}</span>}
                                {pctW > 12 && <span style={{ fontSize: 8, opacity: 0.7 }}>{seg.cut.length}mm</span>}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}

                    {/* Cut labels */}
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
                      {bar.cuts.map((cut, ci) => (
                        <span key={ci} style={{ fontSize: 10, padding: "2px 6px", borderRadius: 3, background: ZONE_COLORS[cut.zone] + "18", color: ZONE_COLORS[cut.zone] || "#aaa", fontWeight: 600 }}>
                          Pos{ci + 1}: {cut.originalId || cut.pieceLabel} ({cut.length}mm)
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Reusable offcuts */}
            {results.offcuts.length > 0 && (
              <div style={{ ...S.card, marginTop: 18 }}>
                <span style={S.label}>Reusable Offcuts (&gt;100mm)</span>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                  {results.offcuts.map((o, i) => (
                    <span key={i} style={{ fontSize: 11, padding: "4px 10px", borderRadius: 4, background: "#43B58118", color: "#43B581", fontWeight: 600 }}>
                      {o.barLabel}: {o.length.toFixed(0)}mm ({o.profile})
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        {tab === "results" && !results && (
          <div style={{ textAlign: "center", padding: 60, color: BB.mutedDim }}>
            <p style={{ fontSize: 16 }}>Add parts, then hit OPTIMIZE on the Parts tab.</p>
          </div>
        )}

        {/* ═══ ASSEMBLY GUIDE TAB ══════════════════════════════ */}
        {tab === "guide" && results && (
          <div>
            {(() => {
              // Build zone data
              const zones = {};
              let globalStep = 0;
              results.bars.forEach(bar => {
                bar.cuts.forEach(cut => {
                  const z = cut.zone || "FRAME";
                  if (!zones[z]) zones[z] = [];
                  zones[z].push({ ...cut, barLabel: bar.barLabel, barProfile: bar.profile, barStock: bar.totalLength });
                });
              });
              const zoneEntries = Object.entries(zones).sort(([a], [b]) => a.localeCompare(b));
              const totalPieces = zoneEntries.reduce((s, [, c]) => s + c.length, 0);

              return (<>
                {/* Header */}
                <div style={{ marginBottom: 20 }}>
                  <h2 style={{ margin: 0, fontSize: 18, color: BB.textStrong, fontWeight: 800, fontFamily: BB.fontHeading, letterSpacing: "-0.3px" }}>
                    Step-by-Step Assembly Guide
                  </h2>
                  <p style={{ margin: "6px 0 0", fontSize: 12, color: BB.muted }}>
                    Follow each zone in order. Match the label written on each cut piece to the steps below.
                  </p>
                </div>

                {/* Zone overview nav */}
                <div style={{ display: "flex", gap: 6, marginBottom: 20, flexWrap: "wrap" }}>
                  {zoneEntries.map(([zone, cuts], zi) => {
                    const zClr = ZONE_COLORS[zone] || "#888";
                    return (
                      <div key={zone} style={{
                        display: "flex", alignItems: "center", gap: 8,
                        padding: "8px 14px", borderRadius: 8,
                        background: `${zClr}15`, border: `1.5px solid ${zClr}40`,
                        cursor: "pointer", transition: "all .15s",
                      }} onClick={() => { document.getElementById(`zone-${zone}`)?.scrollIntoView({ behavior: "smooth", block: "start" }) }}>
                        <div style={{
                          width: 26, height: 26, borderRadius: 6, background: zClr,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: 13, fontWeight: 900, color: "#fff", fontFamily: BB.fontHeading,
                        }}>{zi + 1}</div>
                        <div>
                          <div style={{ fontSize: 11, fontWeight: 700, color: zClr }}>{zone}</div>
                          <div style={{ fontSize: 9, color: BB.muted }}>{cuts.length} pieces</div>
                        </div>
                      </div>
                    );
                  })}
                  <div style={{ display: "flex", alignItems: "center", padding: "8px 14px", borderRadius: 8, background: BB.surfaceAlt, border: `1px solid ${BB.border}` }}>
                    <div style={{ fontSize: 11, color: BB.muted }}>Total: <strong style={{ color: BB.textStrong }}>{totalPieces}</strong> pieces across <strong style={{ color: BB.textStrong }}>{zoneEntries.length}</strong> zones</div>
                  </div>
                </div>

                {/* Zone sections */}
                {zoneEntries.map(([zone, cuts], zi) => {
                  const zClr = ZONE_COLORS[zone] || "#888";
                  return (
                    <div key={zone} id={`zone-${zone}`} style={{ marginBottom: 28, scrollMarginTop: 120 }}>
                      {/* Zone header */}
                      <div style={{
                        display: "flex", alignItems: "center", gap: 12, marginBottom: 14,
                        padding: "14px 18px", borderRadius: 10,
                        background: `linear-gradient(135deg,${zClr}18,${zClr}08)`,
                        border: `1px solid ${zClr}30`,
                      }}>
                        <div style={{
                          width: 40, height: 40, borderRadius: 8, background: zClr,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: 20, fontWeight: 900, color: "#fff", fontFamily: BB.fontHeading,
                          boxShadow: `0 2px 8px ${zClr}40`, flexShrink: 0,
                        }}>{zi + 1}</div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 16, fontWeight: 800, color: BB.textStrong, fontFamily: BB.fontHeading, letterSpacing: "-0.2px" }}>{zone}</div>
                          <div style={{ fontSize: 11, color: BB.muted, marginTop: 2 }}>{cuts.length} pieces to assemble in this zone</div>
                        </div>
                        <div style={{ fontSize: 10, color: BB.muted, textAlign: "right" }}>
                          {[...new Set(cuts.map(c => c.profile))].map(p => (
                            <div key={p} style={{ display: "flex", alignItems: "center", gap: 4, justifyContent: "flex-end" }}>
                              <span style={{ width: 6, height: 6, borderRadius: 2, background: pColorMap.get(p) || "#666", display: "inline-block" }} />
                              <span>{p}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Piece step cards */}
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: 10 }}>
                        {cuts.map((cut, ci) => {
                          globalStep++;
                          const cutClr = ZONE_COLORS[cut.zone] || "#888";
                          const profClr = pColorMap.get(cut.profile) || "#666";
                          return (
                            <div key={ci} style={{
                              background: BB.surface, borderRadius: 10, border: `1px solid ${BB.border}`,
                              overflow: "hidden", transition: "all .15s",
                            }}>
                              {/* Step number bar */}
                              <div style={{
                                display: "flex", alignItems: "center", justifyContent: "space-between",
                                padding: "8px 14px",
                                background: `linear-gradient(135deg,${cutClr}DD,${cutClr}99)`,
                              }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                  <span style={{
                                    fontSize: 14, fontWeight: 900, color: "#fff", fontFamily: BB.fontHeading,
                                    background: "rgba(0,0,0,0.2)", width: 28, height: 28, borderRadius: 6,
                                    display: "flex", alignItems: "center", justifyContent: "center",
                                  }}>{ci + 1}</span>
                                  <span style={{ fontSize: 14, fontWeight: 800, color: "#fff", fontFamily: BB.fontHeading }}>{cut.originalId || cut.pieceLabel}</span>
                                </div>
                                <span style={{ fontSize: 9, color: "rgba(255,255,255,0.7)", fontWeight: 600 }}>STEP {ci + 1} of {cuts.length}</span>
                              </div>

                              {/* Card body */}
                              <div style={{ padding: 14 }}>
                                {/* Profile + length */}
                                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                    <span style={{ width: 8, height: 8, borderRadius: 2, background: profClr, display: "inline-block" }} />
                                    <span style={{ fontSize: 11, color: BB.text, fontWeight: 600 }}>{cut.profile}</span>
                                  </div>
                                  <span style={{ fontSize: 16, fontWeight: 800, color: BB.textStrong, fontFamily: BB.fontHeading }}>{cut.length} mm</span>
                                </div>

                                {/* Description */}
                                {cut.desc && (
                                  <div style={{ fontSize: 11, color: BB.muted, marginBottom: 10, padding: "6px 8px", background: BB.surfaceAlt, borderRadius: 4 }}>
                                    {cut.desc}
                                  </div>
                                )}

                                {/* Find on bar - visual */}
                                <div style={{
                                  padding: "8px 10px", borderRadius: 6,
                                  background: BB.bg, border: `1px solid ${BB.borderDim}`,
                                }}>
                                  <div style={{ fontSize: 9, color: BB.muted, fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", marginBottom: 6 }}>Find on bar</div>
                                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                    <span style={{ ...S.idBadge, color: "#2E8BC0", fontSize: 11 }}>{cut.barLabel}</span>
                                    <span style={{ fontSize: 9, color: BB.mutedDim }}>({cut.barStock || "?"}mm stock)</span>
                                    <span style={{
                                      padding: "3px 10px", borderRadius: 4, fontSize: 11, fontWeight: 800,
                                      background: "#E8A83820", color: "#E8A838", fontFamily: BB.fontHeading,
                                    }}>Position #{cut.cutPosition}</span>
                                  </div>
                                  {/* Mini bar diagram */}
                                  <div style={{ marginTop: 6, height: 12, borderRadius: 3, background: BB.surfaceAlt, display: "flex", overflow: "hidden", border: `1px solid ${BB.borderDim}` }}>
                                    {(() => {
                                      const bar = results.bars.find(b => b.barLabel === cut.barLabel);
                                      if (!bar) return null;
                                      return bar.cuts.map((c, i) => {
                                        const w = (c.length / bar.totalLength) * 100;
                                        const isThis = c.pieceLabel === cut.pieceLabel && c.cutPosition === cut.cutPosition;
                                        return <div key={i} style={{
                                          width: `${w}%`, minWidth: 2,
                                          background: isThis ? cutClr : `${BB.muted}30`,
                                          borderRight: `1px solid ${BB.bg}`,
                                          transition: "all .2s",
                                        }} title={`${c.originalId || c.pieceLabel}: ${c.length}mm`} />;
                                      });
                                    })()}
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </>);
            })()}
          </div>
        )}
        {tab === "guide" && !results && (
          <div style={{ textAlign: "center", padding: 60, color: BB.mutedDim }}>Run optimization first.</div>
        )}

        {/* ═══ PRINT LABELS TAB ════════════════════════════════ */}
        {tab === "labels" && results && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 14, color: BB.muted, fontWeight: 700 }}>PRINTABLE LABELS</h2>
                <p style={{ margin: "4px 0 0", fontSize: 11, color: BB.mutedDim }}>
                  Print and stick on each cut piece. Use Ctrl+P to print this page.
                </p>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))", gap: 10 }}>
              {results.bars.flatMap(bar =>
                bar.cuts.map((cut, ci) => (
                  <div key={`${bar.barLabel}-${ci}`} style={{
                    background: "#fff", borderRadius: 8, padding: 14, color: "#000",
                    border: "2px dashed #ccc", fontFamily: "inherit",
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <div style={{ fontSize: 20, fontWeight: 900, color: "#000", letterSpacing: "-0.5px" }}>
                        {cut.originalId || cut.pieceLabel}
                      </div>
                      <div style={{
                        padding: "3px 8px", borderRadius: 4, fontSize: 10, fontWeight: 800,
                        background: ZONE_COLORS[cut.zone] || "#888", color: "#fff",
                      }}>{cut.zone}</div>
                    </div>
                    <div style={{ margin: "8px 0 4px", fontSize: 12, color: "#444" }}>
                      <strong>{cut.profile}</strong> · <strong>{cut.length} mm</strong>
                    </div>
                    <div style={{ fontSize: 11, color: "#666", lineHeight: 1.5 }}>
                      {cut.desc && <div>📝 {cut.desc}</div>}
                      <div>📦 Cut from: <strong>{bar.barLabel}</strong></div>
                      <div>📍 Position: <strong>#{cut.cutPosition}</strong></div>
                    </div>
                    <div style={{ marginTop: 8, paddingTop: 6, borderTop: "1px solid #eee", display: "flex", justifyContent: "space-between" }}>
                      <span style={{ fontSize: 9, color: "#999" }}>BLACKBOX FACTORIES</span>
                      <span style={{ fontSize: 9, color: "#999" }}>CUT LIST OPT.</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
        {tab === "labels" && !results && (
          <div style={{ textAlign: "center", padding: 60, color: BB.mutedDim }}>Run optimization first.</div>
        )}

        {/* ═══ ASS MACHINE TAB ══════════════════════════════════ */}

      </ScrollPane>

      {/* ─── FIXED FOOTER ─────────────────────────────────────── */}
      <div style={{
        position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 1500,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "16px 48px", gap: 16,
        background: BB.surfaceStrong, borderTop: `1px solid ${BB.border}`,
        backdropFilter: "blur(12px)",
        boxShadow: "0 -4px 20px rgba(0,0,0,0.3)",
      }}>
        {/* Bottom-left controls */}
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {/* Hamburger nav button */}
          <button onClick={() => setNavOpen(true)} style={{
            background: "none", border: `1px solid ${BB.border}`, borderRadius: 10,
            color: BB.muted, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            height: 56, width: 56, boxSizing: "border-box",
          }}>
            <Menu size={28} color={BB.muted} />
          </button>
          {/* Home button */}
          <button onClick={() => setTab("dashboard")} style={{
            background: "none", border: `1px solid ${BB.border}`, borderRadius: 10,
            color: BB.muted, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            height: 56, width: 56, boxSizing: "border-box",
          }}>
            <Home size={28} color={BB.muted} />
          </button>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <button
          onClick={() => {
            setResults(null);
            setParts([]);
            setCompletedCuts(new Set());
            setSelectedBarIdx(null);
            setTab("dashboard");
          }}
          style={{
            padding: "16px 28px",
            background: "#E05A38",
            border: "none", borderRadius: 12,
            color: "#fff", fontSize: 20, fontWeight: 700,
            cursor: "pointer", fontFamily: BB.font, letterSpacing: "1px",
            boxShadow: "0 4px 20px #E05A3855",
            transition: "all .2s",
            display: "flex", alignItems: "center", gap: 10,
          }}
        >
          <RotateCcw size={22} /> RESET
        </button>
        <button
          onClick={sequenceRunning ? stopSequence : startSequence}
          style={{
            padding: "16px 28px",
            background: sequenceRunning ? "#f95463" : "#43B581",
            border: "none", borderRadius: 12,
            color: "#fff", fontSize: 20, fontWeight: 700,
            cursor: "pointer", fontFamily: BB.font, letterSpacing: "1px",
            boxShadow: sequenceRunning ? "0 4px 20px #f9546355" : "0 4px 20px #43B58155",
            transition: "all .2s",
            display: "flex", alignItems: "center", gap: 10,
          }}
        >
          <Play size={22} /> {sequenceRunning ? "STOP" : "START"}
        </button>
        </div>{/* end right-buttons */}
      </div>

      {/* Spacer so footer doesn't cover content */}
      <div style={{ height: 96 }} />
    </div>
  );
}