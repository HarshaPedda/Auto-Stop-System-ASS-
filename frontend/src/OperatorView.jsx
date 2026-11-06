import { useState, useEffect, useRef, useCallback } from "react";
import { Cable, Sun, Moon, Check, UserCog, FileDown, CircleX, ChevronDown, ListCheck, UserStar, SlidersHorizontal, Ruler, Package } from "lucide-react";
import { optimizeAdvanced, ZONE_COLORS } from "../app.jsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import ScrollPane, { ScrollBtn, ScrollBtns, useScrollPane } from "./ScrollPane.jsx";

const FONT = "'Inter',sans-serif";
const ACCENT = "#C8D400";
const BG     = "#0F0F0F";
const SURF   = "#1A1A1A";
const SURF2  = "#222222";
const BORDER = "#2E2E2E";
const TEXT   = "#F0F0F0";
const MUTED  = "#888888";

// ── helpers ──────────────────────────────────────────────────────────────────
function Card({ children, style, T: theme }) {
  return (
    <div style={{
      background: theme ? theme.surf : SURF,
      border: `1px solid ${theme ? theme.border : BORDER}`,
      borderRadius: 10, ...style,
    }}>
      {children}
    </div>
  );
}

function BigBtn({ label, color, textColor = "#fff", onClick, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        flex: 1, padding: "32px 0", fontSize: 32, fontWeight: 900,
        letterSpacing: "2px", textTransform: "uppercase",
        background: disabled ? "#333" : color,
        color: disabled ? "#555" : textColor,
        border: "none", borderRadius: 14, cursor: disabled ? "not-allowed" : "pointer",
        fontFamily: FONT, boxShadow: disabled ? "none" : `0 4px 24px ${color}55`,
        transition: "opacity .15s",
      }}
    >
      {label}
    </button>
  );
}

function MetricTile({ label, value, sub, color, T: theme }) {
  const mutedColor = theme ? theme.muted : MUTED;
  const tileBg     = theme?.surf   || SURF;
  const tileBorder = theme?.border || BORDER;
  return (
    <div style={{
      background: tileBg, border: `1px solid ${tileBorder}`,
      borderRadius: 12, padding: "20px 28px", flex: 1,
    }}>
      <div style={{ fontSize: 13, color: mutedColor, fontWeight: 700, letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: 10 }}>
        {label}
      </div>
      <div style={{ fontSize: 52, fontWeight: 900, color, fontFamily: FONT, lineHeight: 1 }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 14, color: mutedColor, marginTop: 8, fontWeight: 600 }}>{sub}</div>}
    </div>
  );
}

function ModeBtn({ label, active, onClick, T: theme }) {
  const [hov, setHov]         = useState(false);
  const [press, setPress]     = useState(false);
  const border = theme ? theme.border : BORDER;
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => { setHov(false); setPress(false); }}
      onMouseDown={() => setPress(true)}
      onMouseUp={() => setPress(false)}
      style={{
        flex: 1, padding: "22px 0", fontSize: 22, fontWeight: 800,
        letterSpacing: "2px", textTransform: "uppercase",
        background: active ? ACCENT : (theme ? theme.surf2 : SURF2),
        color: active ? "#212121" : (theme ? theme.text : TEXT),
        border: `1px solid ${active ? ACCENT : border}`,
        borderBottom: press ? `1px solid ${active ? '#9aa000' : border}` : `3px solid ${active ? '#9aa000' : border}`,
        borderRadius: 12, cursor: "pointer", fontFamily: FONT,
        transform: press ? "translateY(2px)" : hov ? "translateY(-2px)" : "none",
        boxShadow: press ? "none" : active ? `0 6px 20px ${ACCENT}55` : hov ? "0 6px 16px rgba(0,0,0,0.3)" : "0 2px 6px rgba(0,0,0,0.2)",
        filter: hov && !press ? "brightness(1.08)" : "none",
        transition: "transform .1s, box-shadow .1s, filter .1s",
      }}
    >
      {label}
    </button>
  );
}

// ── Basic Job Page ────────────────────────────────────────────────────────────
function BasicJobPage({ T, FONT, ACCENT, onBack, onOptimize, onSingleCut, embedded, invItems, standardLength, onOversize }) {
  const [display,          setDisplay]          = useState("0");
  const [qty,              setQty]              = useState("1");
  const [profile,          setProfile]          = useState("");
  const [activeField,      setActiveField]      = useState("length"); // "length" | "profile" | "qty"
  const [cutList,          setCutList]          = useState([]);
  const [error,            setError]            = useState("");
  const [profileDropdown,  setProfileDropdown]  = useState(false);
  const [showOptConfirm,   setShowOptConfirm]   = useState(false);

  const PROFILE_OPTIONS = ["40x60", "40x80", "20x40", "40x40"];

  function keyPress(k) {
    if (activeField === "qty") {
      setQty(prev => {
        if (k === "C") return "";
        if (k === "⌫") return prev.length > 1 ? prev.slice(0, -1) : "";
        if (k === "." || k === "x") return prev;
        const next = (prev === "" || prev === "0") ? k : prev + k;
        const n = parseInt(next);
        return n > 0 ? String(n) : "";
      });
      return;
    }
    if (activeField === "profile") {
      setProfile(prev => {
        if (k === "C") return "";
        if (k === "⌫") return prev.slice(0, -1);
        if (k === ".") return prev;
        return prev + k;
      });
    } else {
      setDisplay(prev => {
        if (k === "C") return "0";
        if (k === "⌫") return prev.length > 1 ? prev.slice(0, -1) : "0";
        if (k === "x") return prev;
        if (k === "." && prev.includes(".")) return prev;
        if (prev === "0" && k !== ".") return k;
        return prev + k;
      });
    }
  }

  function addToList() {
    const len  = parseFloat(display);
    const q    = Math.max(1, parseInt(qty) || 1);
    if (!len || len <= 0) return;
    const prof = profile.trim() || "Default";
    setCutList(prev => [...prev, { id: `C${prev.length + 1}`, length: len, qty: q, profile: prof }]);
    setDisplay("0");
    setQty("1");
    setError("");
  }

  function handleOptimize() {
    if (!cutList.length) { setError("Add at least one cut to the list first."); return; }
    const oversized = standardLength != null && cutList.find(c => c.length > standardLength);
    if (oversized) { onOversize?.(oversized.length); return; }
    setShowOptConfirm(true);
  }

  function handleSingleCut() {
    const len = parseFloat(display);
    if (!len || len <= 0) return;
    onSingleCut(len);
    setDisplay("0");
  }

  const KEYS = [["7","8","9"],["4","5","6"],["1","2","3"],["C","0","⌫"]];

  const kp = embedded ? "9px 0" : "28px 0";
  const kpGap = embedded ? 8 : 12;

  const inner = (
    <div style={{
      padding: embedded ? "10px 20px" : "32px 40px",
      flex: embedded ? 1 : undefined,
      display: embedded ? "flex" : undefined,
      flexDirection: embedded ? "column" : undefined,
      overflow: embedded ? "hidden" : undefined,
    }}>
      {/* Page sub-header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: embedded ? 8 : 32, flexShrink: 0 }}>
        <span style={{ fontSize: embedded ? 22 : 30, fontWeight: 800, letterSpacing: "2px", textTransform: "uppercase", color: T.muted }}>Basic Job</span>
        <button onClick={onBack} className="bb-back" style={backBtnStyle(T)}>← Back</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: embedded ? "680px 1fr" : "680px 1fr", gap: embedded ? 20 : 32, alignItems: "stretch", flex: embedded ? 1 : undefined, minHeight: embedded ? 0 : undefined }}>

        {/* ── Keypad ── */}
        <div style={{ background: T.surf, border: `1px solid ${T.border}`, borderRadius: 16, padding: embedded ? 14 : 32, display: "flex", flexDirection: "column" }}>
          {/* Displays: Profile | Length (top row), QTY (bottom row) */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: embedded ? 8 : 18 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div style={{ position: "relative" }}>
                <div onClick={() => { setActiveField("profile"); setProfileDropdown(v => !v); }} style={{
                  background: T.bg, borderRadius: 12, padding: embedded ? "7px 12px" : "18px 20px", cursor: "pointer",
                  border: `2px solid ${activeField === "profile" ? ACCENT : T.border}`, transition: "border-color .15s",
                }}>
                  <div style={{ fontSize: 11, color: activeField === "profile" ? ACCENT : T.muted, fontWeight: 700, letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: 3, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span>Profile</span>
                    <span style={{ fontSize: 10, opacity: 0.6 }}>▼</span>
                  </div>
                  <div style={{ fontSize: embedded ? 24 : 36, fontWeight: 900, color: profile ? T.text : T.muted, fontFamily: FONT, letterSpacing: "1px", minHeight: embedded ? 28 : 44, lineHeight: 1 }}>
                    {profile || <span style={{ fontSize: embedded ? 14 : 20, fontWeight: 500 }}>e.g. 40x60</span>}
                  </div>
                </div>
                {profileDropdown && (
                  <div style={{
                    position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0, zIndex: 100,
                    background: T.surf, border: `1px solid ${T.border}`, borderRadius: 10,
                    boxShadow: "0 8px 24px rgba(0,0,0,0.3)", overflow: "hidden",
                  }}>
                    {PROFILE_OPTIONS.map(opt => (
                      <div key={opt} onClick={() => { setProfile(opt); setProfileDropdown(false); setActiveField("length"); }} style={{
                        padding: embedded ? "10px 14px" : "14px 20px", fontSize: embedded ? 18 : 24, fontWeight: 800,
                        fontFamily: FONT, color: profile === opt ? ACCENT : T.text,
                        background: profile === opt ? ACCENT + "18" : "transparent",
                        cursor: "pointer", borderBottom: `1px solid ${T.border}`,
                        transition: "background .1s",
                      }}
                        onMouseEnter={e => e.currentTarget.style.background = ACCENT + "22"}
                        onMouseLeave={e => e.currentTarget.style.background = profile === opt ? ACCENT + "18" : "transparent"}
                      >{opt}</div>
                    ))}
                  </div>
                )}
              </div>
              <div onClick={() => setActiveField("length")} style={{
                background: T.bg, borderRadius: 12, padding: embedded ? "7px 12px" : "18px 20px", cursor: "pointer",
                border: `2px solid ${activeField === "length" ? ACCENT : T.border}`, transition: "border-color .15s", textAlign: "right",
              }}>
                <div style={{ fontSize: 11, color: activeField === "length" ? ACCENT : T.muted, fontWeight: 700, letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: 3 }}>Length</div>
                <div style={{ fontSize: embedded ? 24 : 36, fontWeight: 900, color: ACCENT, fontFamily: FONT, letterSpacing: "1px", minHeight: embedded ? 28 : 44, lineHeight: 1 }}>
                  {display}<span style={{ fontSize: embedded ? 13 : 18, color: T.muted, marginLeft: 6 }}>mm</span>
                </div>
              </div>
            </div>
            {/* QTY — full-width row */}
            <div style={{
              background: T.bg, borderRadius: 12, padding: embedded ? "7px 12px" : "14px 18px",
              border: `2px solid ${activeField === "qty" ? ACCENT : T.border}`, transition: "border-color .15s",
              display: "flex", alignItems: "center", gap: 10,
            }}>
              <div onClick={() => setActiveField("qty")} style={{ flex: 1, cursor: "pointer" }}>
                <div style={{ fontSize: 11, color: activeField === "qty" ? ACCENT : T.muted, fontWeight: 700, letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: 2 }}>QTY</div>
                <div style={{ fontSize: embedded ? 24 : 32, fontWeight: 900, color: activeField === "qty" ? ACCENT : T.text, fontFamily: FONT, lineHeight: 1 }}>
                  {qty || <span style={{ fontSize: embedded ? 14 : 18, fontWeight: 500, color: T.muted }}>tap to enter</span>}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                <button
                  onMouseDown={e => { e.preventDefault(); setQty(prev => String(Math.max(1, (parseInt(prev) || 1) - 1))); }}
                  style={{ width: embedded ? 44 : 54, height: embedded ? 44 : 54, fontSize: embedded ? 22 : 22, fontWeight: 900, background: T.surf2, color: T.text, border: `1px solid ${T.border}`, borderRadius: 8, cursor: "pointer", fontFamily: FONT, lineHeight: 1 }}
                >−</button>
                <button
                  onMouseDown={e => { e.preventDefault(); setQty(prev => String((parseInt(prev) || 0) + 1)); }}
                  style={{ width: embedded ? 44 : 54, height: embedded ? 44 : 54, fontSize: embedded ? 22 : 22, fontWeight: 900, background: T.surf2, color: T.text, border: `1px solid ${T.border}`, borderRadius: 8, cursor: "pointer", fontFamily: FONT, lineHeight: 1 }}
                >+</button>
              </div>
            </div>
          </div>

          {/* Number grid */}
          <div style={{ display: "flex", flexDirection: "column", gap: kpGap, marginBottom: kpGap, flex: 1 }}>
            {KEYS.map((row, ri) => (
              <div key={ri} style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: kpGap, flex: 1 }}>
                {row.map(k => (
                  <button key={k} onClick={() => keyPress(k)} style={{
                    padding: kp, fontSize: k === "⌫" ? (embedded ? 20 : 26) : k === "C" ? (embedded ? 16 : 20) : (embedded ? 26 : 34),
                    fontWeight: 700, borderRadius: 10, cursor: "pointer", fontFamily: FONT,
                    background: k === "C" ? "#f9546322" : T.surf2,
                    color: k === "C" ? "#f95463" : T.text,
                    border: `1px solid ${k === "C" ? "#f9546340" : T.border}`,
                  }}>{k}</button>
                ))}
              </div>
            ))}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: kpGap, flex: 1 }}>
              <button onClick={() => keyPress(".")} style={{
                padding: kp, fontSize: embedded ? 26 : 34, fontWeight: 700, borderRadius: 10,
                cursor: "pointer", fontFamily: FONT, background: T.surf2,
                color: T.text, border: `1px solid ${T.border}`,
              }}>.</button>
              <button onClick={() => keyPress("x")} style={{
                padding: kp, fontSize: embedded ? 22 : 28, fontWeight: 800, borderRadius: 10,
                cursor: activeField === "profile" ? "pointer" : "not-allowed", fontFamily: FONT,
                background: activeField === "profile" ? ACCENT + "22" : T.surf2,
                color: activeField === "profile" ? ACCENT : T.muted,
                border: `1px solid ${activeField === "profile" ? ACCENT + "66" : T.border}`,
                transition: "all .15s",
              }}>x</button>
            </div>
          </div>

          {/* Action buttons */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: embedded ? 8 : 18 }}>
            <button onClick={handleSingleCut} style={{
              width: "100%", padding: embedded ? "11px 0" : "20px 0", fontSize: embedded ? 15 : 18, fontWeight: 800,
              background: "#777777", color: "#ffffff", border: "none", borderRadius: 10,
              cursor: "pointer", fontFamily: FONT, letterSpacing: "0.5px",
            }}>⚡ SINGLE CUT</button>
            <button onClick={addToList} style={{
              width: "100%", padding: embedded ? "11px 0" : "20px 0", fontSize: embedded ? 15 : 18, fontWeight: 800,
              background: ACCENT, color: "#212121", border: "none", borderRadius: 10,
              cursor: "pointer", fontFamily: FONT, letterSpacing: "0.5px",
            }}>+ ADD TO LIST</button>
          </div>
        </div>

        {/* ── Cut List ── */}
        <div style={{ background: T.surf, border: `1px solid ${T.border}`, borderRadius: 16, display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
          <div style={{ padding: "20px 28px", borderBottom: `1px solid ${T.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 14, color: T.muted, fontWeight: 700, letterSpacing: "1.5px", textTransform: "uppercase" }}>
              Cut List{cutList.length > 0 ? ` — ${cutList.length} entries` : ""}
            </span>
            {cutList.length > 0 && (
              <button onClick={() => setCutList([])} style={{
                background: "none", border: `1px solid ${T.border}`, color: T.muted,
                borderRadius: 6, padding: "6px 16px", fontSize: 13, cursor: "pointer", fontFamily: FONT, fontWeight: 600,
              }}>CLEAR ALL</button>
            )}
          </div>

          {cutList.length === 0 ? (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, color: T.muted, fontSize: 17, padding: 40, textAlign: "center" }}>
              <span>Enter a length on the keypad, then press</span>
              <span style={{ color: ACCENT, fontWeight: 700 }}>+ ADD TO LIST</span>
              <span>to build your cut list, or</span>
              <span style={{ color: "#777777", fontWeight: 700 }}>⚡ SINGLE CUT</span>
              <span>to send one cut directly to the machine.</span>
            </div>
          ) : (
            <>
              <ScrollPane T={T} FONT={FONT} showButtons={false}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr 72px 44px", width: "100%", background: T.bg, padding: embedded ? "8px 16px" : "12px 24px", gap: 10, borderBottom: `1px solid ${T.border}`, position: "sticky", top: 0, boxSizing: "border-box" }}>
                  {["Profile", "Length (mm)", "QTY", ""].map((h, idx) => (
                    <span key={idx} style={{ fontSize: 13, color: T.muted, fontWeight: 700, letterSpacing: "1.2px", textTransform: "uppercase", minWidth: 0 }}>{h}</span>
                  ))}
                </div>
                {cutList.map((c, i) => (
                  <div key={i} style={{
                    display: "grid", gridTemplateColumns: "1fr 1.4fr 72px 44px",
                    width: "100%", boxSizing: "border-box",
                    padding: embedded ? "8px 16px" : "18px 24px", gap: 10, alignItems: "center",
                    background: i % 2 === 0 ? T.surf : T.surf2,
                    borderBottom: `1px solid ${T.border}`,
                  }}>
                    <span style={{ fontSize: embedded ? 14 : 17, fontWeight: 700, color: T.text, fontFamily: FONT, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.profile || "—"}</span>
                    <span style={{ fontSize: embedded ? 16 : 22, fontWeight: 900, color: ACCENT, fontFamily: FONT, minWidth: 0 }}>{c.length} mm</span>
                    <span style={{ fontSize: embedded ? 14 : 18, color: T.text, fontWeight: 600, minWidth: 0 }}>× {c.qty}</span>
                    <button onClick={() => setCutList(prev => prev.filter((_, idx) => idx !== i))}
                      style={{ background: "none", border: "none", color: "#f95463", cursor: "pointer", fontSize: 26, lineHeight: 1, padding: 0 }}>×</button>
                  </div>
                ))}
              </ScrollPane>

              {/* Footer */}
              <div style={{ padding: embedded ? "10px 16px" : "20px 28px", borderTop: `1px solid ${T.border}`, display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
                <span style={{ fontSize: embedded ? 13 : 16, color: T.muted, fontWeight: 700 }}>
                  {cutList.reduce((s, c) => s + c.qty, 0)} pcs &nbsp;·&nbsp; {cutList.reduce((s, c) => s + c.length * c.qty, 0).toFixed(0)} mm total
                </span>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  {error && <span style={{ fontSize: 13, color: "#f95463", fontWeight: 600 }}>{error}</span>}
                  <button onClick={handleOptimize} style={{
                    padding: embedded ? "8px 20px" : "18px 40px", fontSize: embedded ? 13 : 17, fontWeight: 800,
                    background: "#43B581", color: "#fff", border: "none", borderRadius: 10,
                    cursor: "pointer", fontFamily: FONT, letterSpacing: "0.5px",
                    boxShadow: "0 4px 16px #43B58144",
                  }}>▶ Optimise Cut List</button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );

  const totalPcs = cutList.reduce((s, c) => s + c.qty, 0);
  const totalMm  = cutList.reduce((s, c) => s + c.length * c.qty, 0);

  const optConfirmPopup = showOptConfirm && (
    <div style={{
      position: "fixed", inset: 0, zIndex: 10002,
      background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div style={{
        background: "#1E1E1E", border: `2px solid ${ACCENT}`, borderRadius: 20,
        padding: "48px 56px", textAlign: "center", maxWidth: 480, width: "90%",
        boxShadow: "0 24px 64px rgba(0,0,0,0.8)",
      }}>
        <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: "2px", textTransform: "uppercase", color: ACCENT, marginBottom: 20 }}>
          Optimise Cut List
        </div>
        <div style={{ fontSize: 26, fontWeight: 900, color: "#F0F0F0", marginBottom: 24, fontFamily: FONT }}>
          Ready to Optimise?
        </div>
        <div style={{ fontSize: 16, color: "#888", marginBottom: 8 }}>
          Cuts: <span style={{ color: "#F0F0F0", fontWeight: 700 }}>{cutList.length} entries · {totalPcs} pcs</span>
        </div>
        <div style={{ fontSize: 16, color: "#888", marginBottom: 36 }}>
          Total length: <span style={{ color: ACCENT, fontWeight: 700 }}>{totalMm.toLocaleString()} mm</span>
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          <button
            onClick={() => { setShowOptConfirm(false); onOptimize(cutList); }}
            style={{
              flex: 1, padding: "18px 0", fontSize: 18, fontWeight: 900,
              background: ACCENT, color: "#212121", border: "none", borderRadius: 12,
              cursor: "pointer", fontFamily: FONT, letterSpacing: "0.5px",
            }}
          >Proceed</button>
          <button
            onClick={() => setShowOptConfirm(false)}
            style={{
              flex: 1, padding: "18px 0", fontSize: 18, fontWeight: 900,
              background: "#2A2A2A", color: "#888", border: "2px solid #333", borderRadius: 12,
              cursor: "pointer", fontFamily: FONT,
            }}
          >Cancel</button>
        </div>
      </div>
    </div>
  );

  if (embedded) return <>{inner}{optConfirmPopup}</>;
  return (
    <div style={{ minHeight: "100vh", background: T.bg, color: T.text, fontFamily: FONT }}>
      {inner}
      {optConfirmPopup}
    </div>
  );
}

// ── Main Operator View ────────────────────────────────────────────────────────
export default function OperatorView({ username }) {
  const [themeMode, setThemeMode] = useState(() => {
    try { return localStorage.getItem("bb-cut-theme") || "dark"; } catch { return "dark"; }
  });
  const toggleTheme = () => setThemeMode(prev => {
    const next = prev === "dark" ? "light" : "dark";
    try { localStorage.setItem("bb-cut-theme", next); } catch {}
    return next;
  });

  const T = themeMode === "dark"
    ? { dark: true,  bg: "#111111", surf: "#2A2A2A", surf2: "#333333", border: "#484848", text: "#F0F0F0", muted: "#999999" }
    : { dark: false, bg: "#EAEAEA", surf: "#FFFFFF",  surf2: "#F1F5F9", border: "#CCCCCC", text: "#212121", muted: "#666666" };

  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // ── WebSocket / PLC state ─────────────────────────────────────
  const [machineConnected, setMachineConnected] = useState(false);
  const [bridgeConnected,  setBridgeConnected]  = useState(false);
  const [printerConnected, setPrinterConnected] = useState(false);
  const [alerts, setAlerts] = useState({});  // key → { message, severity }
  const [sequenceRunning,  setSequenceRunning]  = useState(false);
  const [isHoming,         setIsHoming]         = useState(false);
  const [isReady,          setIsReady]          = useState(false);
  const [isRetracted,      setIsRetracted]      = useState(false);
  const [machinePhase,     setMachinePhase]     = useState("home"); // "home"|"homing"|"feeding"|"cutting"
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [profileModalMode, setProfileModalMode] = useState("change"); // "change" | "scan"
  const [pendingProfile,   setPendingProfile]   = useState({ profile: "", totalLength: 0 });
  const [activeProfileName, setActiveProfileName] = useState("");
  const profileGroupsRef     = useRef([]);  // [{profile, totalLength, globalStart, cuts}]
  const currentGroupIdxRef   = useRef(0);
  const currentGroupStartRef = useRef(0);
  const [d500Feeding,      setD500Feeding]      = useState(false); // true when D500 > 0
  const [d502Cutting,      setD502Cutting]      = useState(false); // true when D502 increases
  const [plcRegs,          setPlcRegs]          = useState({ d300: null });
  const [showUserMenu,     setShowUserMenu]     = useState(false);
  const [ackedBars,  setAckedBars]  = useState(0);
  const [totalBars,  setTotalBars]  = useState(0);
  const [actualLength, setActualLength] = useState(0);
  const [partLength,   setPartLength]   = useState(0);
  const [showBarWarning,      setShowBarWarning]      = useState(false);
  const [barWarningData,      setBarWarningData]      = useState({ scanned: 0, cutlistTotal: 0 });
  const [showOversizeWarning, setShowOversizeWarning] = useState(false);
  const [oversizePartLen,     setOversizePartLen]     = useState(0);
  const partsRef = useRef([]);
  const [logs, setLogs] = useState([]);
  const wsRef = useRef(null);

  const addLog = useCallback((msg) => {
    setLogs(prev => [...prev.slice(-100), { ts: new Date().toLocaleTimeString(), msg }]);
  }, []);

  const wsSend = useCallback((obj) => {
    if (wsRef.current?.readyState === 1) {
      wsRef.current.send(JSON.stringify(obj));
      return true;
    }
    addLog("⚠ Not connected to bridge");
    return false;
  }, [addLog]);

  const connectBridge = useCallback(() => {
    if (wsRef.current) { try { wsRef.current.close(); } catch (_) {} }
    const ws = new WebSocket("ws://localhost:8765");
    ws.onopen = () => { setBridgeConnected(true); addLog("Bridge online"); };
    ws.onmessage = (ev) => {
      try {
        const d = JSON.parse(ev.data);
        if (d.type === "status") {
          setMachineConnected(d.connected);
          addLog(d.message);
        } else if (d.type === "printer_status") {
          setPrinterConnected(d.connected);
        } else if (d.type === "alert") {
          setAlerts(prev => {
            const next = { ...prev };
            if (d.active) next[d.key] = { message: d.message, severity: d.severity };
            else delete next[d.key];
            return next;
          });
        } else if (d.type === "plc_response") {
          addLog(`← PLC: ${d.data}`);
          // Parse actual length if PLC sends it
          const m = String(d.data).match(/(\d+(\.\d+)?)/);
          if (m) setActualLength(parseFloat(m[1]));
        } else if (d.type === "sequence_progress") {
          // d.idx is 0-based within the current profile group — map to global index
          const globalIdx = currentGroupStartRef.current + d.idx;
          const grandTotal = cutFlatListRef.current.length;
          setAckedBars(globalIdx + 1);
          addLog(`✓ Cut ${globalIdx + 1}/${grandTotal} done`);
          const entry = cutMapRef.current[globalIdx];
          if (entry) {
            setCompletedCuts(prev => { const n = new Set(prev); n.add(entry.groupKey); return n; });
          }
          // Advance within group; null when group ends (sequence_done handles what's next)
          setActiveCutIdx(d.idx + 1 < d.total ? globalIdx + 1 : null);
        } else if (d.type === "sequence_done") {
          const nextGroupIdx = currentGroupIdxRef.current + 1;
          if (nextGroupIdx < profileGroupsRef.current.length) {
            // More profile groups — pause and ask operator to load next bar type
            const nextGroup = profileGroupsRef.current[nextGroupIdx];
            currentGroupIdxRef.current = nextGroupIdx;
            currentGroupStartRef.current = nextGroup.globalStart;
            setSequenceRunning(false);
            setActiveCutIdx(null);
            setPendingProfile({ profile: nextGroup.profile, totalLength: nextGroup.totalLength });
            setProfileModalMode("change");
            setShowProfileModal(true);
            addLog(`⏸ Profile change — load: ${nextGroup.profile}`);
          } else {
            // All profile groups done
            setSequenceRunning(false);
            setActiveCutIdx(null);
            setShowDoneModal(true);
            addLog("✓ Sequence complete — labels printed via Brother QL-800");
          }
        } else if (d.type === "sequence_stopped") {
          setSequenceRunning(false);
          setActiveCutIdx(null);
          setShowProfileModal(false);
          addLog("■ Sequence stopped");
        } else if (d.type === "machine_status") {
          if      (d.status === "feeding")   { setD500Feeding(true);  setD502Cutting(false); setIsHoming(false); setIsReady(false); setIsRetracted(false); }
          else if (d.status === "cutting")   { setD502Cutting(true);  setD500Feeding(false); setIsHoming(false); setIsReady(false); setIsRetracted(false); }
          else if (d.status === "homing")    { setIsHoming(true);     setD502Cutting(false); setD500Feeding(false); setIsReady(false); setIsRetracted(false); }
          else if (d.status === "home")      { setIsHoming(false);    setD502Cutting(false); setD500Feeding(false); setIsReady(false); setIsRetracted(false); }
          else if (d.status === "ready")     { setIsReady(true);      setIsHoming(false);    setD502Cutting(false); setD500Feeding(false); setIsRetracted(false); }
          else if (d.status === "retracted") { setIsRetracted(true);  setIsReady(false);     setIsHoming(false);    setD502Cutting(false); setD500Feeding(false); }
        } else if (d.type === "barcode_scan") {
          // Parse "PROFILE - LENGTHmm" e.g. "40X80 - 4000MM"
          const match = d.barcode.match(/^(.+?)\s*-\s*([\d.]+)\s*MM$/i);
          if (match) {
            const profile = match[1].trim();
            const length  = parseFloat(match[2]);
            setStandardLength(length);
            checkBarLengthWarning(length, profile);
            setInvItems(prev => {
              const idx = prev.findIndex(i => i.profile.toLowerCase() === profile.toLowerCase() && i.length === length);
              const next = idx >= 0
                ? prev.map((it, i) => i === idx ? { ...it, qty: it.qty + 1 } : it)
                : [...prev, { id: Date.now(), profile, length, qty: 1 }];
              saveInvToCSV(next);
              return next;
            });
            setPendingProfile({ profile, totalLength: length });
            setProfileModalMode("scan");
            setShowProfileModal(true);
            addLog(`📦 Scanned: ${profile} · ${length} mm`);
          } else {
            addLog(`📦 Scan: ${d.barcode}`);
          }
        } else if (d.type === "plc_registers") {
          setPlcRegs({ d300: d.d300 });
        } else if (d.type === "log" || d.type === "welcome" || d.type === "error") {
          addLog(d.message);
        }
      } catch (_) {}
    };
    ws.onclose = () => {
      setBridgeConnected(false);
      setMachineConnected(false);
      setPrinterConnected(false);
      setAlerts({});
      setSequenceRunning(false);
      addLog("Bridge offline");
    };
    ws.onerror = () => addLog("⚠ Cannot reach bridge");
    wsRef.current = ws;
  }, [addLog]);

  useEffect(() => { connectBridge(); }, []);

  // ── Global button effects ──────────────────────────────────────
  useEffect(() => {
    const s = document.createElement("style");
    s.id = "bb-btn-fx";
    s.textContent = `
      .bb-action { transition: transform .1s, box-shadow .1s, filter .1s !important; }
      .bb-action:hover  { transform: translateY(-2px) !important; filter: brightness(1.1) !important;
                          box-shadow: 0 6px 20px rgba(0,0,0,0.35) !important; }
      .bb-action:active { transform: translateY(2px) !important; box-shadow: none !important; filter: brightness(0.95) !important; }
      .bb-back  { transition: transform .1s, box-shadow .1s !important; }
      .bb-back:hover  { transform: translateY(-1px) !important; box-shadow: 0 4px 12px rgba(0,0,0,0.25) !important; }
      .bb-back:active { transform: translateY(1px) !important; box-shadow: none !important; }
    `;
    document.head.appendChild(s);
    return () => s.remove();
  }, []);

  // ── Bar vs cut-list length mismatch warning ──────────────────────
  // Only triggered on barcode scan. Compares scanned bar length against
  // the total cut length for that profile only.
  // dir "bar_greater"     → bar stock > cut list total for profile
  // dir "cutlist_greater" → cut list total for profile > bar stock
  function checkBarLengthWarning(barLen, profile) {
    const pts = partsRef.current;
    if (!pts.length || !barLen || !profile) return;
    const profileParts = pts.filter(p => p.profile?.toLowerCase() === profile.toLowerCase());
    if (!profileParts.length) return;
    const cutlistTotal = profileParts.reduce((s, p) => s + p.length * (p.qty || 1), 0);
    if (cutlistTotal > barLen) {
      setBarWarningData({ scanned: barLen, cutlistTotal, dir: "cutlist_greater" });
      setShowBarWarning(true);
    } else if (barLen > cutlistTotal) {
      setBarWarningData({ scanned: barLen, cutlistTotal, dir: "bar_greater" });
      setShowBarWarning(true);
    }
  }

  // ── Barcode scanner (USB HID keyboard) listener ───────────────
  useEffect(() => {
    let buffer = "";
    let timer  = null;

    function flush() {
      const barcode = buffer.trim();
      buffer = "";
      if (barcode.length < 4) return;
      // Parse "PROFILE - LENGTHmm" e.g. "20X40 - 4000MM"
      const match = barcode.match(/^(.+?)\s*-\s*([\d.]+)\s*MM$/i);
      if (match) {
        const profile = match[1].trim();
        const length  = parseFloat(match[2]);
        setStandardLength(length);
        checkBarLengthWarning(length, profile);
        setInvItems(prev => {
          const idx = prev.findIndex(i => i.profile.toLowerCase() === profile.toLowerCase() && i.length === length);
          const next = idx >= 0
            ? prev.map((it, i) => i === idx ? { ...it, qty: it.qty + 1 } : it)
            : [...prev, { id: Date.now(), profile, length, qty: 1 }];
          saveInvToCSV(next);
          return next;
        });
        setPendingProfile({ profile, totalLength: length });
        setProfileModalMode("scan");
        setShowProfileModal(true);
        addLog(`📦 Scanned: ${profile} · ${length} mm`);
      } else {
        addLog(`📦 Scan: ${barcode}`);
      }
    }

    function onKey(e) {
      // Ignore if user is typing in an input/textarea
      const tag = e.target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      if (e.key === "Enter") {
        clearTimeout(timer);
        flush();
        return;
      }
      if (e.key.length === 1) {
        buffer += e.key;
        clearTimeout(timer);
        // Auto-flush if scanner doesn't send Enter (fallback after 100ms silence)
        timer = setTimeout(flush, 100);
      }
    }

    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); clearTimeout(timer); };
  }, [addLog]);

  // ── Job / CSV state ───────────────────────────────────────────
  const [jobName, setJobName]   = useState("");
  const [csvFiles,      setCsvFiles]      = useState([]); // [{name, parts}]
  const [expandedCsv,   setExpandedCsv]   = useState(null); // index of expanded CSV tile
  const [parts,         setParts]         = useState([]);
  useEffect(() => { partsRef.current = parts; }, [parts]);
  const [results,       setResults]       = useState(null);
  const [optimized,     setOptimized]     = useState(false);
  const [completedCuts, setCompletedCuts] = useState(new Set());
  const [activeCutIdx,  setActiveCutIdx]  = useState(null);
  const cutMapRef      = useRef([]); // flatIndex → { barIdx, groupKey }
  const cutFlatListRef = useRef([]); // flatIndex → { cut, bar } for label printing
  const autoPrintLabelRef  = useRef(null);
  const printAllLabelsRef  = useRef(null);
  const [printEnabled, setPrintEnabled] = useState(true);
  const [selectedBarIdx, setSelectedBarIdx] = useState(0);
  const [mode, setMode]                   = useState("optimise");
  const [view, setView]                   = useState("main");
  const [jobSource, setJobSource]         = useState("csv"); // "csv" | "basic"
  const [optError, setOptError]           = useState("");
  const [exportToast, setExportToast]     = useState(null);
  const [showDoneModal, setShowDoneModal] = useState(false);
  const [showCalibReminder, setShowCalibReminder] = useState(true);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState(null);
  const [pdfFilename,   setPdfFilename]   = useState("");
  const [basicJobSummaryReady, setBasicJobSummaryReady] = useState(false);
  const [jobsSummaryReady,     setJobsSummaryReady]     = useState(false);
  const [expandedProfileNames, setExpandedProfileNames] = useState(new Set());
  const fileRef    = useRef(null);
  const logEndRef  = useRef(null);
  const iframeRef  = useRef(null);
  const cutsCtrl  = useScrollPane();
  const jobsCtrl  = useScrollPane();
  const invCtrl   = useScrollPane();

  useEffect(() => {
    if (logEndRef.current) logEndRef.current.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  // Auto-advance to next bar when all cuts in current bar are acknowledged
  useEffect(() => {
    if (!results || !sequenceRunning) return;
    const currentBar = results.bars[selectedBarIdx];
    if (!currentBar) return;
    const barGroupKeys = [...new Set(currentBar.cuts.map(c => `${currentBar.barLabel}—${c.id}—${c.length}`))];
    if (barGroupKeys.length > 0 && barGroupKeys.every(k => completedCuts.has(k))) {
      if (selectedBarIdx < results.bars.length - 1) {
        setSelectedBarIdx(prev => prev + 1);
      }
    }
  }, [completedCuts]); // eslint-disable-line

  // Close user-menu on outside click
  useEffect(() => {
    if (!showUserMenu) return;
    const handler = () => setShowUserMenu(false);
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [showUserMenu]);

  function toggleCutDone(key) {
    setCompletedCuts(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
        setAckedBars(a => Math.max(0, a - 1));
      } else {
        next.add(key);
        setAckedBars(a => a + 1);
      }
      return next;
    });
  }

  // ── Optimization settings ─────────────────────────────────────
  const [kerf,          setKerf]          = useState(3);
  const [algorithm,     setAlgorithm]     = useState("best");
  const [costPerMeter,  setCostPerMeter]  = useState(8.5);
  const [standardLength, setStandardLength] = useState(6000);

  // ── Calibration state ─────────────────────────────────────────
  const [calDistMove,    setCalDistMove]    = useState("200");
  const [calDistMeas,    setCalDistMeas]    = useState("");
  const [calSteps,       setCalSteps]       = useState("800");
  const [calRetract,     setCalRetract]     = useState("20");
  const [calActiveField, setCalActiveField] = useState(null); // "distMove"|"distMeas"|"steps"|"retract"
  const [calDisplay,     setCalDisplay]     = useState("0");
  const [setupTile,      setSetupTile]      = useState(null); // "opt"|"cal"|"inv"
  // Inventory
  const [invItems,       setInvItems]       = useState([]);
  const [invProfile,     setInvProfile]     = useState("");
  const [invLength,      setInvLength]      = useState("");
  const [invQty,         setInvQty]         = useState("1");
  const [invProfileDrop, setInvProfileDrop] = useState(false);
  const [invActiveField, setInvActiveField] = useState(null); // "length"|"qty"
  const [invDisplay,     setInvDisplay]     = useState("0");

  const fetchInventory = useCallback(() => {
    fetch("http://localhost:8765/inventory")
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setInvItems(data); })
      .catch(() => {});
  }, []);

  // Save updated list to CSV in background — never blocks state
  const saveInvToCSV = useCallback((items) => {
    fetch("http://localhost:8765/inventory/replace", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(items),
    }).catch(() => {});
  }, []);

  // Load inventory from CSV on boot
  useEffect(() => { fetchInventory(); }, [fetchInventory]);
  // Reload whenever operator opens the Inventory tile
  useEffect(() => { if (setupTile === "inv") fetchInventory(); }, [setupTile, fetchInventory]);

  function calKeyPress(k) {
    setCalDisplay(prev => {
      if (k === "C") return "0";
      if (k === "⌫") return prev.length > 1 ? prev.slice(0, -1) : "0";
      if (k === "." && prev.includes(".")) return prev;
      if (prev === "0" && k !== ".") return k;
      return prev + k;
    });
  }

  function calFieldTap(field) {
    const cur = field === "distMove" ? calDistMove
              : field === "distMeas" ? calDistMeas
              : field === "steps"    ? calSteps
              : calRetract;
    setCalDisplay(cur || "0");
    setCalActiveField(field);
  }

  function calDone() {
    const val = calDisplay;
    if (calActiveField === "distMove") setCalDistMove(val);
    else if (calActiveField === "distMeas") setCalDistMeas(val);
    else if (calActiveField === "steps") setCalSteps(val);
    else if (calActiveField === "retract") setCalRetract(val);
    setCalActiveField(null);
  }

  // returns true on success, false on failure
  const runOptimize = useCallback(() => {
    setOptError("");
    if (!parts.length) {
      setOptError("No parts loaded. Go to Jobs and load a CSV first.");
      return false;
    }
    // Check before optimizing — any single part longer than bar stock is impossible to cut
    const oversized = parts.find(p => p.length > standardLength);
    if (oversized) {
      setOversizePartLen(oversized.length);
      setShowOversizeWarning(true);
      return false;
    }
    try {
      const mapped = parts.map((p, i) => ({
        id: p.id, profile: p.profile || "Default", length: p.length,
        qty: p.qty || 1, zone: "FRAME", desc: p.desc || "", seq: i + 1,
      }));
      const res = optimizeAdvanced(mapped, [], standardLength, kerf, algorithm);
      const totalCuts = res.bars.reduce((s, b) => s + b.cuts.length, 0);
      const barStockLen = res.bars[0]?.totalLength || res.bars[0]?.stockLength || standardLength;
      setResults(res);
      setStandardLength(barStockLen);
      setTotalBars(totalCuts);
      setAckedBars(0);
      setCompletedCuts(new Set());
      setOptimized(true);
      setJobSource("csv");
      addLog(`✓ Optimized: ${res.barCount} bars, ${res.efficiency}% efficiency — bar stock: ${barStockLen} mm`);
      return true;
    } catch (err) {
      setOptError(`Optimization failed: ${err.message}`);
      return false;
    }
  }, [parts, kerf, algorithm, standardLength, addLog]);

  function handleCSV(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const lines = ev.target.result.split("\n").filter(l => l.trim());
      if (lines.length < 2) return;
      const hdr = lines[0].split(",").map(h => h.trim().toLowerCase().replace(/"/g, ""));
      const col = (names) => hdr.findIndex(h => names.some(n => h === n || h.includes(n)));
      const idxLen     = col(["length"]);
      const idxPart    = col(["part id", "part_id", "part"]);
      const idxDesc    = col(["description", "desc"]);
      const idxQty     = col(["qty", "quantity"]);
      const idxProfile = col(["profile", "type", "section"]);
      if (idxLen === -1) return;
      const rows = lines.slice(1).map(l => l.split(",").map(x => x.trim().replace(/"/g, "")));
      const parsed = rows
        .map((c, i) => ({
          id:      idxPart    >= 0 ? c[idxPart]    : `P-${i + 1}`,
          length:  parseFloat(c[idxLen]) || 0,
          profile: idxProfile >= 0 ? c[idxProfile] : "",
          desc:    idxDesc    >= 0 ? c[idxDesc]    : "",
          qty:     idxQty     >= 0 ? parseInt(c[idxQty]) || 1 : 1,
        }))
        .filter(p => p.length > 0);
      setCsvFiles(prev => {
        const next = [...prev, { name: file.name, parts: parsed }];
        const allParts = next.flatMap(f => f.parts);
        setParts(allParts);
        setTotalBars(allParts.length);
        setJobName(next.map(f => f.name).join(" + "));
        setExpandedCsv(next.length - 1);
        return next;
      });
      setAckedBars(0);
      addLog(`Loaded: ${file.name} — ${parsed.length} cuts added`);
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  // ── Derived state ─────────────────────────────────────────────
  const jobPct  = totalBars > 0 ? Math.round((ackedBars / totalBars) * 100) : 0;
  const partPct = `${ackedBars} / ${totalBars}`;

  const machineStatus = !machineConnected
    ? { label: "OFFLINE",   color: "#f95463", bg: "#f9546318" }
    : d502Cutting
    ? { label: "CUTTING",   color: "#f97316", bg: "#f9731618" }
    : isRetracted
    ? { label: "RETRACTED", color: "#a78bfa", bg: "#a78bfa18" }
    : isHoming
    ? { label: "HOMING",    color: "#E8A838", bg: "#E8A83818" }
    : isReady
    ? { label: "READY",     color: "#38bdf8", bg: "#38bdf818" }
    : d500Feeding
    ? { label: "FEEDING",   color: "#38bdf8", bg: "#38bdf818" }
    : { label: "HOME",      color: "#43B581", bg: "#43B58118" };

  function handleBasicJobOptimize(cutList) {
    const oversized = cutList.find(c => c.length > standardLength);
    if (oversized) {
      setOversizePartLen(oversized.length);
      setShowOversizeWarning(true);
      return;
    }
    try {
      const mapped = cutList.map((c, i) => ({
        id: c.id, profile: c.profile || "Default", length: c.length,
        qty: c.qty, zone: "FRAME", desc: "", seq: i + 1,
      }));
      const res = optimizeAdvanced(mapped, [], standardLength, kerf, algorithm);
      const totalCuts = res.bars.reduce((s, b) => s + b.cuts.length, 0);
      const barStockLen = res.bars[0]?.totalLength || res.bars[0]?.stockLength || standardLength;
      // Set parts so START button enables (include profile so re-optimize preserves it)
      setParts(cutList.map((c, i) => ({ id: c.id, length: c.length, qty: c.qty, desc: "", profile: c.profile || "Default" })));
      setResults(res);
      setStandardLength(barStockLen);
      setTotalBars(totalCuts);
      setAckedBars(0);
      setCompletedCuts(new Set());
      setOptimized(true);
      setJobSource("basic");
      setSelectedBarIdx(0);
      addLog(`✓ Basic Job optimized: ${res.barCount} bars, ${res.efficiency}% efficiency — bar stock: ${barStockLen} mm`);
      setExpandedProfileNames(new Set());
      setBasicJobSummaryReady(true);
    } catch (err) {
      addLog(`⚠ Optimization failed: ${err.message}`);
    }
  }

  function handleAutoCut() {
    if (!results?.bars?.length) { addLog("⚠ No optimized cuts — run optimizer first"); return; }

    // Build full flat lists
    const newCutMap = [];
    const newCutFlatList = [];
    results.bars.forEach((bar, barIdx) => {
      bar.cuts.forEach(cut => {
        newCutMap.push({ barIdx, groupKey: `${bar.barLabel}—${cut.id}—${cut.length}` });
        newCutFlatList.push({ cut, bar });
      });
    });
    cutMapRef.current = newCutMap;
    cutFlatListRef.current = newCutFlatList;

    // Group consecutive bars by profile — operator must load a new bar type for each group
    const groups = [];
    let gIdx = 0;
    results.bars.forEach(bar => {
      const last = groups[groups.length - 1];
      if (!last || last.profile !== bar.profile) {
        groups.push({
          profile: bar.profile,
          totalLength: bar.totalLength || bar.stockLength || standardLength,
          globalStart: gIdx,
          cuts: [],
        });
      }
      bar.cuts.forEach(cut => {
        groups[groups.length - 1].cuts.push({
          length:   cut.length,
          label:    cut.pieceLabel || cut.displayId || cut.id || "",
          barLabel: bar.barLabel,
          profile:  bar.profile || "",
          desc:     cut.desc    || "",
        });
        gIdx++;
      });
    });

    profileGroupsRef.current = groups;
    currentGroupIdxRef.current = 0;
    currentGroupStartRef.current = 0;

    const firstGroup = groups[0];
    const totalCuts = newCutFlatList.length;
    setActiveProfileName(firstGroup?.profile || "");
    setTotalBars(totalCuts);
    setAckedBars(0);
    setCompletedCuts(new Set());
    setSelectedBarIdx(0);
    setActiveCutIdx(0);
    setIsHoming(false);
    setSequenceRunning(true);
    wsSend({ cmd: "start_sequence", cuts: firstGroup.cuts });
    addLog(`▶ Sequence: ${totalCuts} cuts — Profile 1/${groups.length}: ${firstGroup.profile} (${firstGroup.totalLength} mm)`);
  }

  function handleProfileModalOk() {
    setShowProfileModal(false);
    if (profileModalMode === "scan") return; // scan popup — just acknowledge, no sequence action
    const group = profileGroupsRef.current[currentGroupIdxRef.current];
    if (!group) return;
    setActiveProfileName(group.profile);
    setActiveCutIdx(group.globalStart);
    setSequenceRunning(true);
    wsSend({ cmd: "start_sequence", cuts: group.cuts });
    addLog(`▶ Profile ${currentGroupIdxRef.current + 1}/${profileGroupsRef.current.length}: ${group.profile} (${group.totalLength} mm)`);
  }

  function handleStop() {
    wsSend({ cmd: "stop_sequence" });
    wsSend({ cmd: "home" });
    setSequenceRunning(false);
    setMachinePhase("homing");
    setIsHoming(true);
    addLog("■ Stopped + 🏠 Homing D1000=1 sent to PLC");
  }

  // ── Code39 barcode — inline SVG, no library needed ───────────────
  function code39svg(text, barH) {
    const C39 = {
      '*':'010010100','0':'000110100','1':'100100001','2':'001100001','3':'101100000',
      '4':'000110001','5':'100110000','6':'001110000','7':'000100101','8':'100100100',
      '9':'001100100','A':'100001001','B':'001001001','C':'101001000','D':'000011001',
      'E':'100011000','F':'001011000','G':'000001101','H':'100001100','I':'001001100',
      'J':'000011100','K':'100000011','L':'001000011','M':'101000010','N':'000010011',
      'O':'100010010','P':'001010010','Q':'000000111','R':'100000110','S':'001000110',
      'T':'000010110','U':'110000001','V':'011000001','W':'111000000','X':'010010001',
      'Y':'110010000','Z':'011010000','-':'010000101','.':'110000100',' ':'011000100',
      '$':'010101000','/':'010100010','+':'010001010','%':'000101010',
    };
    const N = 1, W = 3;
    const safe = ('*' + text.toUpperCase().replace(/[^0-9A-Z\-\. \$\/\+\%]/g, '') + '*');
    let units = 0;
    for (let i = 0; i < safe.length; i++) {
      const p = C39[safe[i]]; if (!p) continue;
      for (let j = 0; j < 9; j++) units += p[j] === '1' ? W : N;
      if (i < safe.length - 1) units += N;
    }
    let rects = '', x = 0;
    for (let i = 0; i < safe.length; i++) {
      const p = C39[safe[i]]; if (!p) continue;
      for (let j = 0; j < 9; j++) {
        const w = p[j] === '1' ? W : N;
        if (j % 2 === 0) rects += `<rect x="${x}" y="0" width="${w}" height="${barH}" fill="#000"/>`;
        x += w;
      }
      if (i < safe.length - 1) x += N;
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${units} ${barH}" width="100%" height="${barH}" style="display:block">${rects}</svg>`;
  }

  // ── Shared label CSS injected at print time ───────────────────────
  const LABEL_CSS = `
    .lbl  { width:60mm; height:40mm; box-sizing:border-box; padding:2px 4px;
            background:#fff; color:#000; display:flex; flex-direction:column;
            justify-content:space-between; border:1.5px dashed #aaa;
            page-break-inside:avoid; break-inside:avoid; }
    .ltop { display:flex; justify-content:space-between; align-items:flex-start; gap:2px; }
    .lid  { font-size:18px; font-weight:900; letter-spacing:-0.5px; line-height:1.05; }
    .lzon { padding:1px 5px; border-radius:3px; font-size:11px; font-weight:800;
            background:#555; color:#fff; white-space:nowrap; flex-shrink:0; }
    .lmid { font-size:14px; font-weight:700; color:#111; line-height:1.1; margin:0; }
    .linf { font-size:12px; color:#333; line-height:1.15; }
    .linf div { margin:0; padding:0; }
    .ldt  { font-size:9px; color:#555; text-align:center; margin:0;
            line-height:1; letter-spacing:0.3px; }
  `;

  function buildLabelHtml(cut, bar, idx) {
    const pid = cut.originalId || cut.pieceLabel || cut.displayId || cut.id || String(idx + 1);
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-GB');
    const timeStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    return `<div class="lbl">
      <div class="ltop">
        <div class="lid">${pid}</div>
        <div class="lzon">${cut.profile || ""}</div>
      </div>
      <div class="lmid"><strong>${cut.profile || ""}</strong> &middot; <strong>${cut.length} mm</strong></div>
      <div class="linf">
        ${cut.desc ? `<div>${cut.desc}</div>` : ""}
        <div>Cut from: <strong>${bar.barLabel}</strong></div>
        <div>Position: <strong>#${cut.cutPosition || (idx + 1)}</strong></div>
      </div>
      <div class="ldt">${dateStr} ${timeStr}</div>
    </div>`;
  }

  function buildLeftoverLabelHtml(offcut) {
    // Barcode encodes "PROFILE - LENGTHmm" e.g. "40x80 - 4000MM"
    // Use only the first token of the profile name (strips material suffix like "AL 6063")
    const lengthMm = Math.round(offcut.length);
    const profileShort = (offcut.profile || "").split(/\s+/)[0];
    const barcodeText = `${profileShort} - ${lengthMm}MM`;
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-GB');
    const timeStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    return `<div class="lbl">
      <div class="ltop">
        <div class="lid" style="font-size:14px">INVENTORY</div>
        <div class="lzon" style="background:#E8A838">${offcut.profile || ""}</div>
      </div>
      <div class="lmid"><strong>${offcut.profile || ""}</strong> &middot; <strong>${lengthMm} mm</strong></div>
      <div class="linf">
        <div>From bar: <strong>${offcut.barLabel}</strong></div>
      </div>
      <div style="margin:2px 0">${code39svg(barcodeText, 28)}</div>
      <div class="ldt">${barcodeText} &nbsp;|&nbsp; ${dateStr} ${timeStr}</div>
    </div>`;
  }

  // ── Root-cause fix: call window.print() on the TOP-LEVEL window ──
  // --kiosk-printing suppresses the dialog only for the top-level context.
  // iframe.contentWindow.print() is a child context → dialog still shows.
  // Fix: inject content into the main DOM, then call window.print() here.
  // We use a single fixed ID so concurrent calls don't stack up and fight
  // each other with competing "body > *:not(#id)" rules (which caused the
  // two empty A4 sheets).
  const KIOSK_PRINT_ID = 'kp_container';
  const KIOSK_STYLE_ID = 'kp_style';

  function kioskPrint(bodyHtml, pageRule) {
    if (!printEnabled) return;
    // Always clean up any leftover print DOM from a previous call first
    document.getElementById(KIOSK_PRINT_ID)?.remove();
    document.getElementById(KIOSK_STYLE_ID)?.remove();

    const styleEl = document.createElement('style');
    styleEl.id = KIOSK_STYLE_ID;
    styleEl.textContent = `
      ${pageRule}
      @media print {
        body > *:not(#${KIOSK_PRINT_ID}) { display:none !important; }
        #${KIOSK_PRINT_ID} { display:block !important; position:static !important;
                  font-family:Arial,sans-serif; margin:0; padding:0; }
        ${LABEL_CSS}
      }`;
    const div = document.createElement('div');
    div.id = KIOSK_PRINT_ID;
    div.style.display = 'none';
    div.innerHTML = bodyHtml;
    document.head.appendChild(styleEl);
    document.body.appendChild(div);
    // Two rAF frames let the browser process new styles before printing
    requestAnimationFrame(() => requestAnimationFrame(() => {
      window.print();
      setTimeout(() => { styleEl.remove(); div.remove(); }, 3000);
    }));
  }

  function autoPrintLabel(idx) {
    const entry = cutFlatListRef.current[idx];
    if (!entry) return;
    kioskPrint(
      buildLabelHtml(entry.cut, entry.bar, idx),
      '@page { size:60mm 40mm; margin:0; }'
    );
  }

  function printAllLabels() {
    const entries = cutFlatListRef.current;
    if (!entries || entries.length === 0) return;
    const offcuts = results?.offcuts ?? [];
    // Map barLabel → offcut so we can interleave inventory labels after each bar's cuts
    const offcutByBar = Object.fromEntries(offcuts.map(o => [o.barLabel, o]));

    let html = '';
    let lastBarLabel = null;
    entries.forEach(({ cut, bar }, i) => {
      // When bar changes, append inventory label for the just-finished bar (if it has an offcut)
      if (lastBarLabel !== null && lastBarLabel !== bar.barLabel) {
        if (offcutByBar[lastBarLabel]) {
          html += buildLeftoverLabelHtml(offcutByBar[lastBarLabel]);
        }
      }
      html += buildLabelHtml(cut, bar, i);
      lastBarLabel = bar.barLabel;
    });
    // Append inventory label for the final bar
    if (lastBarLabel && offcutByBar[lastBarLabel]) {
      html += buildLeftoverLabelHtml(offcutByBar[lastBarLabel]);
    }

    const grid = `<div style="display:flex;flex-wrap:wrap;gap:3mm;">${html}</div>`;
    kioskPrint(grid, '@page { size:A4 landscape; margin:8mm; }');
  }

  useEffect(() => {
    autoPrintLabelRef.current = autoPrintLabel;
    printAllLabelsRef.current = printAllLabels;
  });

  function logout() {
    sessionStorage.removeItem("bb-cut-session");
    window.location.reload();
  }

  function buildPDFDoc() {
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const pageW = doc.internal.pageSize.getWidth();
    const now = new Date();
    const dateStr = now.toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" });
    const timeStr = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

    doc.setFontSize(20); doc.setFont("helvetica", "bold");
    doc.text("BLACKBOX Cut List", 14, 16);
    doc.setFontSize(10); doc.setFont("helvetica", "normal");
    doc.setTextColor(120);
    doc.text(`${dateStr}  ${timeStr}   |   Bars: ${results.barCount}   |   Efficiency: ${results.efficiency}%   |   Source: ${jobSource === "basic" ? "Basic Job" : jobName || "CSV"}`, 14, 23);
    doc.setTextColor(0);
    doc.setDrawColor(200); doc.setLineWidth(0.3);
    doc.line(14, 26, pageW - 14, 26);

    let y = 32;
    const colsCSV   = ["Bar", "Profile", "Length (mm)", "QTY", "Description"];
    const colsBasic = ["Bar", "Profile", "Length (mm)", "QTY"];

    for (const bar of results.bars) {
      const groups = [];
      const seen = new Map();
      for (const cut of bar.cuts) {
        const key = `${bar.barLabel}—${cut.id}—${cut.length}`;
        if (seen.has(key)) { seen.get(key).count++; }
        else { const e = { ...cut, count: 1 }; seen.set(key, e); groups.push(e); }
      }
      const rows = groups.map(c => jobSource === "csv"
        ? [bar.barLabel, c.profile || "—", String(c.length), `× ${c.count}`, c.desc || "—"]
        : [bar.barLabel, c.profile || "—", String(c.length), `× ${c.count}`]
      );
      autoTable(doc, {
        startY: y,
        head: [jobSource === "csv" ? colsCSV : colsBasic],
        body: rows,
        theme: "grid",
        headStyles: { fillColor: [200, 212, 0], textColor: [30, 30, 30], fontStyle: "bold", fontSize: 9 },
        bodyStyles: { fontSize: 9 },
        columnStyles: { 2: { fontStyle: "bold" } },
        margin: { left: 14, right: 14 },
        didDrawPage: (data) => { y = data.cursor.y + 4; },
      });
      y = doc.lastAutoTable.finalY + 6;
      if (y > 180) { doc.addPage(); y = 14; }
    }

    const ts = new Date();
    const filename = `cutlist-${ts.getFullYear()}${String(ts.getMonth()+1).padStart(2,"0")}${String(ts.getDate()).padStart(2,"0")}-${String(ts.getHours()).padStart(2,"0")}${String(ts.getMinutes()).padStart(2,"0")}.pdf`;
    return { doc, filename };
  }

  function openPDFPreview() {
    if (!results) return;
    if (pdfPreviewUrl) URL.revokeObjectURL(pdfPreviewUrl);
    const { doc, filename } = buildPDFDoc();
    const blob = doc.output("blob");
    const url = URL.createObjectURL(blob);
    setPdfPreviewUrl(url);
    setPdfFilename(filename);
    setView("pdfpreview");
  }

  async function savePDF() {
    if (!results) return;
    const { doc, filename } = buildPDFDoc();
    try {
      const pdfBytes = doc.output("arraybuffer");
      const fh = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: "PDF File", accept: { "application/pdf": [".pdf"] } }],
      });
      const writable = await fh.createWritable();
      await writable.write(pdfBytes);
      await writable.close();
      setExportToast({ filename: fh.name || filename, saved: true });
    } catch (err) {
      if (err.name !== "AbortError") {
        doc.save(filename);
        setExportToast({ filename, saved: false });
        setTimeout(() => setExportToast(null), 5000);
      }
      return;
    }
    setTimeout(() => setExportToast(null), 5000);
  }

  function handleSingleCut(len) {
    // Build a fake single-cut result so it shows in the present bar table
    // START button will then send it to PLC
    const singleRes = {
      bars: [{
        barLabel: "SINGLE",
        totalLength: standardLength,
        stockLength: standardLength,
        cuts: [{
          id: "S1", length: len, profile: "—", desc: "",
          pieceLabel: `SINGLE-${len}mm`, displayId: `SINGLE-${len}mm`,
        }],
      }],
      barCount: 1,
      efficiency: ((len / standardLength) * 100).toFixed(1),
      totalWaste: standardLength - len,
      newBarsNeeded: 1,
    };
    setResults(singleRes);
    setTotalBars(1);
    setAckedBars(0);
    setCompletedCuts(new Set());
    setOptimized(true);
    setJobSource("basic");
    setSelectedBarIdx(0);
    setPartLength(len);
    addLog(`⚡ Single cut ready: ${len} mm — press START to send`);
    setView("main");
  }

  // ── Profile Wise Cuts — shared renderer ──────────────────────
  function renderProfileSummary(res, onProceed) {
    const summary = {};
    res.bars.forEach(bar => {
      const p = bar.profile;
      if (!summary[p]) summary[p] = { totalQty: 0, totalLength: 0, barCount: 0, cuts: [] };
      summary[p].barCount++;
      bar.cuts.forEach(cut => {
        summary[p].totalQty++;
        summary[p].totalLength += cut.length;
        summary[p].cuts.push({ ...cut, barLabel: bar.barLabel });
      });
    });
    const rows = Object.entries(summary);

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 0, flex: 1, minHeight: 0 }}>
       <ScrollPane T={T} FONT={FONT} showButtons={false}>
        {/* Column headers */}
        <div style={{
          display: "grid", gridTemplateColumns: "28px 2fr 100px 180px 110px 130px 110px",
          gap: 8, padding: "8px 16px", background: T.bg,
          borderBottom: `1px solid ${T.border}`, flexShrink: 0,
          position: "sticky", top: 0, zIndex: 1,
        }}>
          {["", "Profile", "Qty", "Total Length", "6000mm Bars", "Wastage", "Efficiency"].map((h, i) => (
            <span key={i} style={{ fontSize: 11, color: T.muted, fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase" }}>{h}</span>
          ))}
        </div>

        {rows.map(([profile, s]) => {
          const isOpen = expandedProfileNames.has(profile);
          const toggleOpen = () => setExpandedProfileNames(prev => {
            const next = new Set(prev);
            isOpen ? next.delete(profile) : next.add(profile);
            return next;
          });

          // Group cuts by length for the detail list
          const cutGroups = {};
          s.cuts.forEach(c => {
            const k = c.length;
            if (!cutGroups[k]) cutGroups[k] = { length: k, qty: 0, bars: new Set() };
            cutGroups[k].qty++;
            cutGroups[k].bars.add(c.barLabel);
          });
          const cutRows = Object.values(cutGroups).sort((a, b) => b.length - a.length);

          return (
            <div key={profile} style={{ borderBottom: `1px solid ${T.border}` }}>
              {/* Summary row */}
              <div
                onClick={toggleOpen}
                style={{
                  display: "grid", gridTemplateColumns: "28px 2fr 100px 180px 110px 130px 110px",
                  gap: 8, padding: "14px 16px", alignItems: "center",
                  cursor: "pointer", userSelect: "none",
                  background: isOpen ? ACCENT + "14" : "transparent",
                  transition: "background .15s",
                }}
                onMouseEnter={e => { if (!isOpen) e.currentTarget.style.background = T.surf2; }}
                onMouseLeave={e => { if (!isOpen) e.currentTarget.style.background = "transparent"; }}
              >
                <span style={{
                  fontSize: 16, fontWeight: 700,
                  color: isOpen ? ACCENT : T.muted,
                  display: "inline-block",
                  transform: isOpen ? "rotate(90deg)" : "rotate(0deg)",
                  transition: "transform .18s",
                  lineHeight: 1,
                }}>›</span>
                <span style={{ fontSize: 16, fontWeight: 800, color: isOpen ? ACCENT : T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{profile}</span>
                <span style={{ fontSize: 16, fontWeight: 700, color: T.text }}>{s.totalQty} pcs</span>
                <span style={{ fontSize: 16, fontWeight: 700, color: T.text }}>
                  {s.totalLength.toFixed(0)} mm
                </span>
                <span style={{ fontSize: 16, fontWeight: 700, color: "#43B581" }}>
                  {s.barCount} bar{s.barCount !== 1 ? "s" : ""}
                </span>
                <span style={{ fontSize: 16, fontWeight: 700, color: "#9B59B6" }}>
                  {(s.barCount * standardLength - s.totalLength).toFixed(0)} mm
                </span>
                <span style={{ fontSize: 16, fontWeight: 700, color: "#43B581" }}>
                  {((s.totalLength / (s.barCount * standardLength)) * 100).toFixed(1)}%
                </span>
              </div>

              {/* Expanded detail */}
              {isOpen && (
                <div style={{ background: T.bg, borderTop: `1px solid ${T.border}` }}>
                  {/* Sub-header */}
                  <div style={{ display: "grid", gridTemplateColumns: "28px 1fr 80px 1fr", gap: 8, padding: "7px 16px 7px 44px", borderBottom: `1px solid ${T.border}` }}>
                    {["", "Length", "Qty", "Bars"].map((h, i) => (
                      <span key={i} style={{ fontSize: 10, color: T.muted, fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase" }}>{h}</span>
                    ))}
                  </div>
                  {cutRows.map((row, ri) => (
                    <div key={ri} style={{
                      display: "grid", gridTemplateColumns: "28px 1fr 80px 1fr",
                      gap: 8, padding: "10px 16px 10px 44px", alignItems: "center",
                      background: ri % 2 === 0 ? T.surf : "transparent",
                      borderBottom: `1px solid ${T.border}`,
                    }}>
                      <span />
                      <span style={{ fontSize: 15, fontWeight: 800, color: ACCENT }}>{row.length} mm</span>
                      <span style={{ fontSize: 15, fontWeight: 700, color: T.text }}>× {row.qty}</span>
                      <span style={{ fontSize: 12, color: T.muted }}>{[...row.bars].join(", ")}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
       </ScrollPane>

        {/* Proceed button */}
        <div style={{ padding: "16px 20px", borderTop: `1px solid ${T.border}`, flexShrink: 0, background: T.surf }}>
          <button
            onClick={onProceed}
            className="bb-action"
            style={{
              width: "100%", padding: "18px 0", fontSize: 18, fontWeight: 900,
              letterSpacing: "2px", textTransform: "uppercase",
              background: "#43B581", color: "#fff",
              border: "none", borderRadius: 12, cursor: "pointer",
              fontFamily: FONT, boxShadow: "0 4px 20px #43B58155",
            }}
          >
            Go to Dashboard ›
          </button>
        </div>
      </div>
    );
  }

  // ── Shared header ─────────────────────────────────────────────
  const renderHeader = () => (
    <div style={{
      background: T.surf, borderBottom: `1px solid ${T.border}`,
      padding: "16px 24px 16px 16px", display: "flex", alignItems: "center", justifyContent: "space-between",
      flexShrink: 0,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
        <img src={themeMode === "dark" ? "/logo.webp" : "/logo-light.webp"} alt="BlackBoxx" style={{ height: 52, width: 220, objectFit: "contain", objectPosition: "left" }} />
        <div style={{ width: 1, height: 40, background: T.border }} />
        <div>
          <div style={{ fontSize: 24, fontWeight: 700, color: T.muted, lineHeight: 1 }}>
            {now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </div>
          <div style={{ fontSize: 13, color: T.muted, letterSpacing: "0.8px", textTransform: "uppercase", fontWeight: 600 }}>
            {now.toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" })}
          </div>
        </div>
        <div style={{ width: 1, height: 40, background: T.border }} />
        <div style={{ position: "relative" }}>
          <button onClick={(e) => { e.stopPropagation(); setShowUserMenu(v => !v); }} style={{ display: "flex", alignItems: "center", gap: 8, background: T.surf2, border: `1px solid ${showUserMenu ? ACCENT : T.border}`, borderRadius: 8, padding: "6px 12px", cursor: "pointer", fontFamily: FONT }}>
            <UserCog size={20} color={T.muted} />
            <div style={{ display: "flex", flexDirection: "column", gap: 1, textAlign: "left" }}>
              <span style={{ fontSize: 13, fontWeight: 800, color: T.text, lineHeight: 1, fontFamily: FONT }}>{username}</span>
              <span style={{ fontSize: 10, fontWeight: 700, color: ACCENT, letterSpacing: "1.5px", textTransform: "uppercase", lineHeight: 1 }}>Switch User</span>
            </div>
            <ChevronDown size={14} color={T.muted} style={{ transition: "transform .15s", transform: showUserMenu ? "rotate(180deg)" : "rotate(0deg)" }} />
          </button>
          {showUserMenu && (
            <div onClick={(e) => e.stopPropagation()} style={{
              position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 9999,
              background: T.surf, border: `1px solid ${T.border}`, borderRadius: 10,
              boxShadow: "0 8px 32px rgba(0,0,0,0.4)", minWidth: 180, overflow: "hidden",
            }}>
              <div style={{ padding: "8px 14px", fontSize: 11, color: T.muted, fontWeight: 700, letterSpacing: "1.5px", textTransform: "uppercase", borderBottom: `1px solid ${T.border}` }}>
                Select User
              </div>
              {/* Current user — stays */}
              <button onClick={(e) => { e.stopPropagation(); setShowUserMenu(false); }} style={{
                width: "100%", padding: "12px 16px", textAlign: "left", background: ACCENT + "22",
                border: "none", borderBottom: `1px solid ${T.border}`, cursor: "pointer",
                fontFamily: FONT, fontSize: 14, fontWeight: 700, color: ACCENT, display: "flex", alignItems: "center", gap: 10,
              }}>
                <UserCog size={15} /> {username} <span style={{ fontSize: 10, color: T.muted, marginLeft: "auto" }}>● current</span>
              </button>
              {/* Engineer — triggers logout */}
              <button onClick={(e) => { e.stopPropagation(); setShowUserMenu(false); logout(); }} style={{
                width: "100%", padding: "12px 16px", textAlign: "left", background: "transparent",
                border: "none", cursor: "pointer", fontFamily: FONT, fontSize: 14,
                fontWeight: 600, color: T.text, display: "flex", alignItems: "center", gap: 10,
              }}>
                <UserStar size={15} color={T.muted} /> Engineer
              </button>
            </div>
          )}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {(() => {
          const conns = [
            { label: "PLC",     connected: machineConnected },
            { label: "PRINTER", connected: printerConnected },
          ];
          return (
            <div style={{ display: "flex", alignItems: "center", borderRadius: 10, border: `1px solid #444`, overflow: "hidden" }}>
              {conns.map(({ label, connected }, i) => {
                const bg  = connected ? "#43B581" : "#f95463";
                const bdr = connected ? "#2e9e6a" : "#d94452";
                return (
                  <div key={label} style={{
                    display: "flex", alignItems: "center", gap: 10, padding: "10px 20px",
                    background: bg,
                    borderRight: i < conns.length - 1 ? `1px solid #444` : "none",
                  }}>
                    <Cable size={22} color="#fff" />
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <span style={{ fontSize: 12, color: "#fff", fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", lineHeight: 1 }}>{label}</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: "#fff", lineHeight: 1 }}>
                        {connected ? "CONNECTED" : "DISCONNECTED"}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()}
        {/* Print enable/disable toggle */}
        <button
          onClick={() => setPrintEnabled(v => !v)}
          title={printEnabled ? "Printing ON — click to disable" : "Printing OFF — click to enable"}
          style={{
            display: "flex", alignItems: "center", gap: 8, padding: "8px 14px",
            borderRadius: 10, cursor: "pointer", fontFamily: FONT,
            border: `2px solid ${printEnabled ? "#43B581" : "#f95463"}`,
            background: printEnabled ? "#43B58118" : "#f9546318",
            transition: "all .15s",
          }}>
          {/* Toggle pill */}
          <div style={{
            width: 38, height: 20, borderRadius: 10, position: "relative",
            background: printEnabled ? "#43B581" : "#555", transition: "background .2s",
            flexShrink: 0,
          }}>
            <div style={{
              position: "absolute", top: 3, left: printEnabled ? 20 : 3,
              width: 14, height: 14, borderRadius: "50%", background: "#fff",
              transition: "left .2s",
            }} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 1, textAlign: "left" }}>
            <span style={{ fontSize: 11, fontWeight: 800, color: printEnabled ? "#43B581" : "#f95463", letterSpacing: "1px", textTransform: "uppercase", lineHeight: 1 }}>Print</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: printEnabled ? "#43B581" : "#f95463", lineHeight: 1 }}>{printEnabled ? "ENABLED" : "DISABLED"}</span>
          </div>
        </button>
        <div style={{ width: 1, height: 20, background: T.border }} />
        <button onClick={toggleTheme} title="Toggle theme" style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 16, border: `1px solid ${ACCENT}`, background: "transparent", cursor: "pointer", fontSize: 13, fontWeight: 600, color: T.text, fontFamily: FONT }}>
          {themeMode === "dark" ? <Sun size={14} /> : <Moon size={14} />}
          {themeMode === "dark" ? "Light" : "Dark"}
        </button>
      </div>
    </div>
  );

  // ── Global alerts popup — rendered in every view ──────────────
  // Show only ONE alert at a time. Priority: most critical first.
  const alertsModal = (() => {
    const priority = [
      "emergency_alarm",
      "encoder_comm_error",
      "input_phase_loss",
      "servo_over_current",
      "servo_over_voltage",
      "servo_under_voltage",
      "servo_overload",
      "servo_over_speed",
      "encoder_alarm1",
      "encoder_alarm2",
      "encoder_alarm3",
      "abs_position_overflow",
      "abs_before_homing",
      "end_limit_pos",
      "end_limit_neg",
      "vacuum",
    ];
    const activeKey = priority.find(k => alerts[k]);
    if (!activeKey) return null;
    const a = alerts[activeKey];
    const isWarning = a.severity === "warning";
    const accent    = isWarning ? "#f95463" : "#43B581";
    const showResetBtn = ["emergency_alarm", "end_limit_pos", "end_limit_neg"].includes(activeKey);
    return (
      <div style={{
        position: "fixed", inset: 0, zIndex: 10001,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)",
      }}>
        <div style={{
          background: "#5D5D5D", border: `4px solid ${accent}`, borderRadius: 24,
          padding: "40px 80px", textAlign: "center",
          boxShadow: "0 24px 80px rgba(0,0,0,0.8)",
          display: "flex", flexDirection: "column", alignItems: "center", gap: 20,
          minWidth: 480,
        }}>
          <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: "4px", textTransform: "uppercase", color: accent }}>
            {isWarning ? "ALERT" : "NOTICE"}
          </div>
          <div style={{ fontSize: 28, fontWeight: 800, color: "#fff", fontFamily: FONT, lineHeight: 1.3 }}>
            {a.message}
          </div>
          {showResetBtn && (
            <button
              onClick={() => {
                wsSend({ cmd: "error_reset" });
                addLog("🧯 Error reset pressed — clearing D200.2 and homing");
              }}
              style={{
                marginTop: 12, padding: "18px 48px",
                fontSize: 24, fontWeight: 900, letterSpacing: "4px",
                textTransform: "uppercase",
                background: "#f95463", color: "#fff",
                border: "none", borderRadius: 12, cursor: "pointer",
                fontFamily: FONT, boxShadow: "0 4px 24px #f9546366",
              }}
            >
              RESET
            </button>
          )}
        </div>
      </div>
    );
  })();

  // ── BASIC JOB sub-view ────────────────────────────────────────
  if (view === "basicjob") {
    if (basicJobSummaryReady && results) {
      return (
        <div style={{ height: "100vh", background: T.bg, color: T.text, fontFamily: FONT, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {renderHeader()}
          <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            {/* Page header */}
            <div style={{ padding: "14px 28px 10px", borderBottom: `1px solid ${T.border}`, display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
              <div>
                <span style={{ fontSize: 20, fontWeight: 800, letterSpacing: "2px", textTransform: "uppercase", color: T.muted }}>Basic Job</span>
              </div>
            </div>
            {renderProfileSummary(results, () => { setBasicJobSummaryReady(false); setView("main"); setMode("optimise"); })}
          </div>
          {alertsModal}
        </div>
      );
    }
    return (
      <div style={{ height: "100vh", background: T.bg, color: T.text, fontFamily: FONT, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {renderHeader()}
        <BasicJobPage T={T} FONT={FONT} ACCENT={ACCENT} onBack={() => setView("main")} onOptimize={handleBasicJobOptimize} onSingleCut={handleSingleCut} invItems={invItems} embedded standardLength={standardLength} onOversize={(len) => { setOversizePartLen(len); setShowOversizeWarning(true); }} />
        {alertsModal}
      </div>
    );
  }

  if (view === "setup") {
    const CAL_KEYS = [["7","8","9"],["4","5","6"],["1","2","3"],["C","0","⌫"]];
    const calFieldLabel = { distMove: "Distance to Move (mm)", distMeas: "Distance Measured (mm)", steps: "Steps per Unit", retract: "Retract Position" };
    const TILES = [
      { id: "opt", Icon: SlidersHorizontal, label: "Optimization Settings", color: ACCENT },
      { id: "cal", Icon: Ruler,             label: "Calibrations",           color: "#f59e0b" },
      { id: "inv", Icon: Package,           label: "Inventory",              color: "#10b981" },
    ];

    return (
      <div style={{ height: "100vh", background: T.bg, color: T.text, fontFamily: FONT, display: "flex", flexDirection: "column", overflow: "hidden", position: "relative" }}>
        {renderHeader()}
        <div style={{ flex: 1, overflow: "hidden", padding: "16px 28px", display: "flex", flexDirection: "column", gap: 16 }}>

          {/* Header row */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
            <span style={{ fontSize: 22, fontWeight: 800, letterSpacing: "2px", textTransform: "uppercase", color: T.muted }}>Setup</span>
            <button onClick={() => setView("main")} className="bb-back" style={backBtnStyle(T)}>← Back</button>
          </div>

          {/* 3 horizontal tiles */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, flexShrink: 0 }}>
            {TILES.map(({ id, Icon, label, color }) => {
              const active = setupTile === id;
              return (
                <div key={id} onClick={() => setSetupTile(active ? null : id)} style={{
                  display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "center",
                  gap: 16, padding: "28px 16px", cursor: "pointer", borderRadius: 16,
                  background: active ? color + "22" : T.surf,
                  border: `3px solid ${active ? color : T.border}`,
                  transition: "all .15s",
                  boxShadow: active ? `0 4px 24px ${color}33` : "none",
                  minHeight: 90,
                }}>
                  <Icon size={36} color={color} strokeWidth={active ? 2.5 : 2} flexShrink={0} />
                  <span style={{ fontSize: 22, fontWeight: 900, color: active ? color : T.text, lineHeight: 1.15, letterSpacing: "0.3px" }}>{label}</span>
                </div>
              );
            })}
          </div>

          {/* Panel below — fills remaining space */}
          <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>

            {/* ── Optimization Settings panel ── */}
            {setupTile === "opt" && (
              <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 14 }}>
                <div>
                  <label style={setupLabel(T)}>Blade Kerf (mm)</label>
                  <input type="number" step="0.5" min="0" value={kerf}
                    onChange={e => setKerf(parseFloat(e.target.value) || 0)}
                    style={setupInput(T)} />
                </div>
                <div>
                  <label style={setupLabel(T)}>Standard Bar Length (mm)</label>
                  <input type="number" step="100" min="0" value={standardLength}
                    onChange={e => setStandardLength(parseInt(e.target.value) || 6000)}
                    style={setupInput(T)} />
                </div>
                <div>
                  <label style={setupLabel(T)}>Algorithm</label>
                  <div style={{ ...setupInput(T), color: ACCENT, fontWeight: 700, border: `1px solid ${ACCENT}44` }}>
                    Best Fit Decreasing (BFD)
                  </div>
                </div>
                <div>
                  <label style={setupLabel(T)}>Material Cost ($/meter)</label>
                  <input type="number" step="0.5" min="0" value={costPerMeter}
                    onChange={e => setCostPerMeter(parseFloat(e.target.value) || 0)}
                    style={setupInput(T)} />
                </div>
                {optError && (
                  <div style={{ padding: "10px 13px", background: "#f9546318", border: "1px solid #f9546340", borderRadius: 6, fontSize: 13, color: "#f95463", fontWeight: 600 }}>{optError}</div>
                )}
                <button onClick={() => { if (runOptimize()) setView("main"); }}
                  className="bb-action" style={{ ...actionBtnStyle, width: "100%", padding: "14px 0", fontSize: 15 }}>
                  ▶ Run Optimization
                </button>
              </div>
            )}

            {/* ── Calibrations panel ── */}
            {setupTile === "cal" && (
              <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 14 }}>
                <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 14, paddingRight: 4 }}>
                  {[
                    { key: "distMove", label: "Distance to Move (mm)",    val: calDistMove },
                    { key: "distMeas", label: "Distance Measured (mm)",    val: calDistMeas },
                    { key: "steps",    label: "Steps per Unit (steps/mm)", val: calSteps },
                    { key: "retract",  label: "Retract Position",          val: calRetract },
                  ].map(({ key, label, val }) => (
                    <div key={key}>
                      <label onClick={() => calFieldTap(key)} style={{ ...setupLabel(T), color: calActiveField === key ? ACCENT : T.muted, cursor: "pointer" }}>{label}</label>
                      <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
                        <div onClick={() => calFieldTap(key)} style={{
                          ...setupInput(T),
                          flex: 1,
                          cursor: "pointer",
                          border: `1px solid ${calActiveField === key ? ACCENT : T.border}`,
                          color: calActiveField === key ? ACCENT : (val ? T.text : T.muted),
                          transition: "border-color .15s",
                        }}>
                          {calActiveField === key ? calDisplay : (val || "—")}
                        </div>
                        {key === "steps" && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              const steps = calActiveField === "steps" ? calDisplay : calSteps;
                              if (calActiveField === "steps") {
                                setCalSteps(steps);
                                setCalActiveField(null);
                              }
                              const spu = parseFloat(steps);
                              if (!isFinite(spu)) {
                                addLog("⚠ Steps/unit not saved — must be a number");
                                return;
                              }
                              addLog(`⚙ Saving steps/unit only — ${spu}`);
                              wsSend({ cmd: "save_steps", stepsPerUnit: spu });
                            }}
                            style={{
                              padding: "0 24px",
                              background: ACCENT, color: "#212121",
                              border: "none", borderRadius: 6, cursor: "pointer",
                              fontFamily: FONT, fontSize: 14, fontWeight: 800,
                              letterSpacing: "1.5px", textTransform: "uppercase",
                              flexShrink: 0,
                            }}
                          >
                            ✓ Save
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                  {calDistMove && calDistMeas && parseFloat(calDistMove) > 0 && parseFloat(calDistMeas) > 0 && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      <div style={{ padding: "12px 18px", background: ACCENT + "15", border: `1px solid ${ACCENT}44`, borderRadius: 10 }}>
                        <div style={{ fontSize: 11, color: T.muted, fontWeight: 700, letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: 4 }}>Computed Steps/mm</div>
                        <div style={{ fontSize: 26, fontWeight: 900, color: ACCENT }}>
                          {calSteps && parseFloat(calDistMove) > 0
                            ? (parseFloat(calSteps) / parseFloat(calDistMove) * parseFloat(calDistMeas)).toFixed(2)
                            : "—"} <span style={{ fontSize: 13, color: T.muted }}>steps/mm</span>
                        </div>
                      </div>
                      <div style={{ padding: "12px 18px", background: "#f9533015", border: "1px solid #f9533044", borderRadius: 10 }}>
                        <div style={{ fontSize: 11, color: T.muted, fontWeight: 700, letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: 4 }}>Calibration Offset → D400</div>
                        <div style={{ fontSize: 26, fontWeight: 900, color: "#f95330" }}>
                          {(parseFloat(calDistMove) - parseFloat(calDistMeas)).toFixed(2)} <span style={{ fontSize: 13, color: T.muted }}>mm</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
                <button
                  onClick={() => {
                    // Auto-commit keypad: if a field is still being edited, treat calDisplay as the final value
                    const distMove = calActiveField === "distMove" ? calDisplay : calDistMove;
                    const distMeas = calActiveField === "distMeas" ? calDisplay : calDistMeas;
                    const steps    = calActiveField === "steps"    ? calDisplay : calSteps;
                    const retract  = calActiveField === "retract"  ? calDisplay : calRetract;
                    if (calActiveField) {
                      if (calActiveField === "distMove") setCalDistMove(distMove);
                      else if (calActiveField === "distMeas") setCalDistMeas(distMeas);
                      else if (calActiveField === "steps")    setCalSteps(steps);
                      else if (calActiveField === "retract")  setCalRetract(retract);
                      setCalActiveField(null);
                    }

                    const dm = parseFloat(distMove);
                    const dn = parseFloat(distMeas);
                    if (!isFinite(dm) || !isFinite(dn)) {
                      addLog(`⚠ Calibration not saved — Distance to Move and Distance Measured must be numbers`);
                      return;
                    }
                    const calibValue = dm - dn;
                    if (Math.abs(calibValue) > 1000) {
                      addLog(`⚠ Calibration offset is |${calibValue.toFixed(2)}| mm — looks wrong. Save aborted. Check inputs (Move: ${distMove}, Measured: ${distMeas}).`);
                      return;
                    }

                    addLog(`⚙ Calibration saved — Move: ${distMove}mm, Measured: ${distMeas}mm, Steps: ${steps}, Retract: ${retract}, Offset: ${calibValue.toFixed(2)}mm`);
                    wsSend({ cmd: "set_calibration", distMove: dm, distMeas: dn, stepsPerUnit: parseFloat(steps), retractPosition: parseFloat(retract), calibValue });
                  }}
                  className="bb-action" style={{ ...actionBtnStyle, width: "100%", padding: "14px 0", fontSize: 15, flexShrink: 0 }}
                >
                  ✓ Save Calibration
                </button>
              </div>
            )}

            {/* ── Inventory panel ── */}
            {setupTile === "inv" && (() => {
              const INV_PROFILES = ["40x60", "40x80", "20x40", "40x40"];
              return (
                <div style={{ display: "flex", flexDirection: "column", gap: 14, flex: 1, minHeight: 0 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr auto", gap: 8, alignItems: "end", flexShrink: 0 }}>

                    {/* Profile dropdown */}
                    <div style={{ position: "relative" }}>
                      <label style={setupLabel(T)}>Profile</label>
                      <div onClick={() => setInvProfileDrop(v => !v)} style={{
                        ...setupInput(T), cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center",
                        border: `1px solid ${invProfileDrop ? ACCENT : T.border}`, color: invProfile ? T.text : T.muted,
                      }}>
                        <span>{invProfile || "Select profile"}</span>
                        <span style={{ fontSize: 10, opacity: 0.6 }}>▼</span>
                      </div>
                      {invProfileDrop && (
                        <div style={{
                          position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 100,
                          background: T.surf, border: `1px solid ${T.border}`, borderRadius: 10,
                          boxShadow: "0 8px 24px rgba(0,0,0,0.3)", overflow: "hidden",
                        }}>
                          {INV_PROFILES.map(opt => (
                            <div key={opt} onClick={() => { setInvProfile(opt); setInvProfileDrop(false); }} style={{
                              padding: "11px 16px", fontSize: 18, fontWeight: 800, fontFamily: FONT,
                              color: invProfile === opt ? ACCENT : T.text,
                              background: invProfile === opt ? ACCENT + "18" : "transparent",
                              cursor: "pointer", borderBottom: `1px solid ${T.border}`,
                            }}
                              onMouseEnter={e => e.currentTarget.style.background = ACCENT + "22"}
                              onMouseLeave={e => e.currentTarget.style.background = invProfile === opt ? ACCENT + "18" : "transparent"}
                            >{opt}</div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div>
                      <label style={setupLabel(T)}>Length (mm)</label>
                      <div onClick={() => { setInvDisplay(invLength || "0"); setInvActiveField("length"); }} style={{
                        ...setupInput(T), cursor: "pointer",
                        border: `1px solid ${invActiveField === "length" ? ACCENT : T.border}`,
                        color: invLength ? T.text : T.muted,
                      }}>
                        {invLength || "tap to enter"}
                      </div>
                    </div>
                    <div>
                      <label style={setupLabel(T)}>Qty</label>
                      <div onClick={() => { setInvDisplay(invQty || "1"); setInvActiveField("qty"); }} style={{
                        ...setupInput(T), cursor: "pointer",
                        border: `1px solid ${invActiveField === "qty" ? ACCENT : T.border}`,
                        color: T.text,
                      }}>
                        {invQty || "1"}
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        const len = parseFloat(invLength);
                        if (!invProfile || !len || len <= 0) return;
                        setInvItems(prev => {
                          const qty = parseInt(invQty) || 1;
                          const idx = prev.findIndex(i => i.profile === invProfile && i.length === len);
                          const next = idx >= 0
                            ? prev.map((it, i) => i === idx ? { ...it, qty: it.qty + qty } : it)
                            : [...prev, { id: Date.now(), profile: invProfile, length: len, qty }];
                          saveInvToCSV(next);
                          return next;
                        });
                        setInvLength(""); setInvQty("1");
                      }}
                      className="bb-action" style={{ ...actionBtnStyle, padding: "10px 16px", fontSize: 14, whiteSpace: "nowrap" }}
                    >+ Add</button>
                  </div>

                  {invItems.length === 0 ? (
                    <div style={{ textAlign: "center", padding: "30px 0", color: T.muted, fontSize: 16 }}>No inventory items yet</div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, borderRadius: 10, border: `1px solid ${T.border}`, overflow: "hidden", background: T.surf }}>
                      {/* Header bar with ▲ */}
                      <div style={{ position: "relative", display: "grid", gridTemplateColumns: "2fr 1fr 1fr 44px", gap: 8, padding: "10px 14px", paddingRight: 60, fontSize: 12, fontWeight: 700, color: T.muted, letterSpacing: "1px", textTransform: "uppercase", background: T.bg, borderBottom: `1px solid ${T.border}`, flexShrink: 0, alignItems: "center" }}>
                        <span>Profile</span><span>Length</span><span>Qty</span><span />
                        <div style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)" }}>
                          <ScrollBtn ctrl={invCtrl} dir="up" T={T} FONT={FONT} size={32} />
                        </div>
                      </div>
                      <ScrollPane ctrl={invCtrl} showButtons={false} T={T} FONT={FONT} innerStyle={{ display: "flex", flexDirection: "column", gap: 8, padding: 8 }}>
                        {invItems.map(item => (
                          <div key={item.id} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 44px", gap: 8, alignItems: "center", padding: "14px 16px", background: T.surf2, borderRadius: 12, border: `1px solid ${T.border}` }}>
                            <span style={{ fontSize: 18, fontWeight: 800 }}>{item.profile}</span>
                            <span style={{ fontSize: 17, fontWeight: 700, color: T.muted }}>{item.length} mm</span>
                            <span style={{ fontSize: 18, fontWeight: 800, color: "#10b981" }}>×{item.qty}</span>
                            <button onClick={() => setInvItems(prev => { const next = prev.filter(i => i.id !== item.id); saveInvToCSV(next); return next; })}
                              style={{ background: "none", border: "none", color: "#f95463", cursor: "pointer", fontSize: 24, padding: 0, lineHeight: 1 }}>×</button>
                          </div>
                        ))}
                      </ScrollPane>
                      {/* Footer bar with ▼ */}
                      {invCtrl.overflowing && (
                        <div style={{ display: "flex", justifyContent: "flex-end", padding: "8px 12px", background: T.bg, borderTop: `1px solid ${T.border}`, flexShrink: 0 }}>
                          <ScrollBtn ctrl={invCtrl} dir="down" T={T} FONT={FONT} size={32} />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}

          </div>
        </div>

        {/* ── Slide-up calibration numpad ── */}
        {calActiveField && (
          <div style={{
            position: "absolute", bottom: 0, left: 0, right: 0, zIndex: 500,
            background: T.surf, borderTop: `1px solid ${T.border}`,
            boxShadow: "0 -8px 32px rgba(0,0,0,0.3)",
            padding: "16px 20px 20px",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <span style={{ fontSize: 13, color: T.muted, fontWeight: 700, letterSpacing: "1.5px", textTransform: "uppercase" }}>
                {calFieldLabel[calActiveField]}
              </span>
              <span style={{ fontSize: 28, fontWeight: 900, color: ACCENT, fontFamily: FONT }}>{calDisplay} <span style={{ fontSize: 14, color: T.muted }}>{calActiveField === "steps" ? "steps/mm" : "mm"}</span></span>
            </div>
            <div style={{ display: "flex", gap: 10, maxWidth: 520, margin: "0 auto" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
                {CAL_KEYS.map((row, ri) => (
                  <div key={ri} style={{ display: "flex", gap: 8 }}>
                    {row.map(k => (
                      <button key={k} onClick={() => calKeyPress(k)} style={{
                        flex: 1, padding: "16px 0", fontSize: k === "C" ? 17 : k === "⌫" ? 22 : 28,
                        fontWeight: 700, borderRadius: 10, cursor: "pointer", fontFamily: FONT,
                        background: k === "C" ? "#f9546322" : T.surf2,
                        color: k === "C" ? "#f95463" : T.text,
                        border: `1px solid ${k === "C" ? "#f9546340" : T.border}`,
                      }}>{k}</button>
                    ))}
                  </div>
                ))}
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => calKeyPress(".")} style={{ flex: 1, padding: "16px 0", fontSize: 28, fontWeight: 700, borderRadius: 10, cursor: "pointer", fontFamily: FONT, background: T.surf2, color: T.text, border: `1px solid ${T.border}` }}>.</button>
                  <button onClick={calDone} style={{ flex: 2, padding: "16px 0", fontSize: 18, fontWeight: 800, borderRadius: 10, cursor: "pointer", fontFamily: FONT, background: ACCENT, color: "#212121", border: "none" }}>DONE ✓</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Slide-up inventory numpad ── */}
        {invActiveField && (
          <div style={{
            position: "absolute", bottom: 0, left: 0, right: 0, zIndex: 500,
            background: T.surf, borderTop: `1px solid ${T.border}`,
            boxShadow: "0 -8px 32px rgba(0,0,0,0.3)",
            padding: "16px 20px 20px",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <span style={{ fontSize: 13, color: T.muted, fontWeight: 700, letterSpacing: "1.5px", textTransform: "uppercase" }}>
                {invActiveField === "length" ? "Length (mm)" : "Quantity"}
              </span>
              <span style={{ fontSize: 28, fontWeight: 900, color: ACCENT, fontFamily: FONT }}>
                {invDisplay}
                {invActiveField === "length" && <span style={{ fontSize: 14, color: T.muted, marginLeft: 6 }}>mm</span>}
              </span>
            </div>
            <div style={{ display: "flex", gap: 10, maxWidth: 520, margin: "0 auto" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
                {CAL_KEYS.map((row, ri) => (
                  <div key={ri} style={{ display: "flex", gap: 8 }}>
                    {row.map(k => (
                      <button key={k} onClick={() => {
                        setInvDisplay(prev => {
                          if (k === "C") return "0";
                          if (k === "⌫") return prev.length > 1 ? prev.slice(0, -1) : "0";
                          if (k === "." && (prev.includes(".") || invActiveField === "qty")) return prev;
                          if (prev === "0" && k !== ".") return k;
                          return prev + k;
                        });
                      }} style={{
                        flex: 1, padding: "16px 0", fontSize: k === "C" ? 17 : k === "⌫" ? 22 : 28,
                        fontWeight: 700, borderRadius: 10, cursor: "pointer", fontFamily: FONT,
                        background: k === "C" ? "#f9546322" : T.surf2,
                        color: k === "C" ? "#f95463" : T.text,
                        border: `1px solid ${k === "C" ? "#f9546340" : T.border}`,
                      }}>{k}</button>
                    ))}
                  </div>
                ))}
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => setInvDisplay(prev => prev.includes(".") || invActiveField === "qty" ? prev : prev + ".")}
                    style={{ flex: 1, padding: "16px 0", fontSize: 28, fontWeight: 700, borderRadius: 10, cursor: "pointer", fontFamily: FONT, background: T.surf2, color: T.text, border: `1px solid ${T.border}` }}>.</button>
                  <button onClick={() => {
                    if (invActiveField === "length") setInvLength(invDisplay);
                    else setInvQty(invDisplay);
                    setInvActiveField(null);
                  }} style={{ flex: 2, padding: "16px 0", fontSize: 18, fontWeight: 800, borderRadius: 10, cursor: "pointer", fontFamily: FONT, background: ACCENT, color: "#212121", border: "none" }}>DONE ✓</button>
                </div>
              </div>
            </div>
          </div>
        )}
        {alertsModal}
      </div>
    );
  }

  // ── JOBS sub-view ─────────────────────────────────────────────
  if (view === "jobs") {
    return (
      <div style={{ height: "100vh", background: T.bg, color: T.text, fontFamily: FONT, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {renderHeader()}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", padding: 28 }}>

          {/* Header row */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexShrink: 0 }}>
            <span style={{ fontSize: 24, fontWeight: 800, letterSpacing: "2px", textTransform: "uppercase", color: T.muted }}>Jobs</span>
            <button onClick={() => setView("main")} className="bb-back" style={backBtnStyle(T)}>← Back</button>
          </div>

          {/* Action buttons */}
          <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap", flexShrink: 0, alignItems: "center" }}>
            <button onClick={() => fileRef.current?.click()} className="bb-action" style={actionBtnStyle}>
              ↑ {csvFiles.length > 0 ? "Add Another CSV" : "Load Job CSV"}
            </button>
            {csvFiles.length > 0 && (
              <button
                onClick={() => { setParts([]); setCsvFiles([]); setExpandedCsv(null); setResults(null); setJobName(""); setOptimized(false); setAckedBars(0); setTotalBars(0); }}
                className="bb-action" style={{ ...actionBtnStyle, background: "none", border: `1px solid #f95463`, color: "#f95463", boxShadow: "none" }}
              >✕ Clear All</button>
            )}
            <input ref={fileRef} type="file" accept=".csv" style={{ display: "none" }} onChange={handleCSV} />
          </div>

          {/* CSV file tiles / Profile Summary */}
          {jobsSummaryReady && results ? (
            <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, background: T.surf, border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden" }}>
              {renderProfileSummary(results, () => { setJobsSummaryReady(false); setView("main"); setMode("optimise"); })}
            </div>
          ) : csvFiles.length === 0 ? (
            <Card T={T} style={{ padding: 40, textAlign: "center" }}>
              <div style={{ fontSize: 14, color: T.muted }}>No CSVs loaded. Press <strong style={{ color: ACCENT }}>Load Job CSV</strong> to begin.</div>
            </Card>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, borderRadius: 10, border: `1px solid ${T.border}`, overflow: "hidden", background: T.surf }}>
              {/* Header bar with ▲ */}
              <div style={{ position: "relative", padding: "10px 16px", paddingRight: 60, background: T.bg, borderBottom: `1px solid ${T.border}`, flexShrink: 0, display: "flex", alignItems: "center" }}>
                <span style={{ fontSize: 13, color: T.muted, fontWeight: 700, letterSpacing: "1.2px", textTransform: "uppercase" }}>
                  {csvFiles.length} file{csvFiles.length > 1 ? "s" : ""} loaded
                </span>
                <div style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)" }}>
                  <ScrollBtn ctrl={jobsCtrl} dir="up" T={T} FONT={FONT} size={32} />
                </div>
              </div>
              <ScrollPane ctrl={jobsCtrl} showButtons={false} T={T} FONT={FONT} innerStyle={{ display: "flex", flexDirection: "column", gap: 12, padding: 12 }}>
              {csvFiles.map((csv, fi) => {
                const isOpen = expandedCsv === fi;
                const totalLen = csv.parts.reduce((s, p) => s + p.length * (p.qty || 1), 0);
                return (
                  <Card key={fi} T={T} style={{ overflow: "hidden" }}>
                    {/* Tile header — click to expand */}
                    <div
                      onClick={() => setExpandedCsv(isOpen ? null : fi)}
                      style={{
                        padding: "16px 22px", display: "flex", alignItems: "center", justifyContent: "space-between",
                        cursor: "pointer", userSelect: "none",
                        background: isOpen ? ACCENT + "14" : T.surf,
                        borderBottom: isOpen ? `1px solid ${T.border}` : "none",
                        transition: "background .15s",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                        <div style={{ width: 10, height: 10, borderRadius: "50%", background: isOpen ? ACCENT : T.muted, flexShrink: 0, transition: "background .15s" }} />
                        <div>
                          <div style={{ fontSize: 16, fontWeight: 800, color: T.text, letterSpacing: "0.5px" }}>{csv.name}</div>
                          <div style={{ fontSize: 12, color: T.muted, marginTop: 3, fontWeight: 600 }}>
                            {csv.parts.length} cuts &nbsp;·&nbsp; {totalLen.toFixed(0)} mm total
                          </div>
                        </div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            setCsvFiles(prev => {
                              const next = prev.filter((_, i) => i !== fi);
                              const allParts = next.flatMap(f => f.parts);
                              setParts(allParts);
                              setTotalBars(allParts.length);
                              setJobName(next.map(f => f.name).join(" + "));
                              if (expandedCsv === fi) setExpandedCsv(null);
                              else if (expandedCsv > fi) setExpandedCsv(expandedCsv - 1);
                              return next;
                            });
                          }}
                          style={{ background: "none", border: `1px solid #f9546366`, borderRadius: 6, color: "#f95463", padding: "5px 10px", fontSize: 13, cursor: "pointer", fontFamily: FONT, fontWeight: 700 }}
                        >Remove</button>
                        <span style={{ fontSize: 20, color: isOpen ? ACCENT : T.muted, fontWeight: 700, display: "inline-block", transform: isOpen ? "rotate(90deg)" : "rotate(0deg)", transition: "transform .2s" }}>›</span>
                      </div>
                    </div>

                    {/* Expanded cut list */}
                    {isOpen && (
                      <div style={{ overflowX: "auto", overflowY: "auto", maxHeight: "calc(100vh - 380px)" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse" }}>
                          <thead>
                            <tr>
                              {["Part ID", "Profile", "Length", "Qty", "Description"].map(h => (
                                <th key={h} style={thStyle(T)}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {csv.parts.map((p, i) => (
                              <tr key={i} style={{ background: i % 2 === 0 ? T.surf : T.surf2 }}>
                                <td style={tdStyle(T)}>{p.id}</td>
                                <td style={tdStyle(T)}>{p.profile || "—"}</td>
                                <td style={{ ...tdStyle(T), color: ACCENT, fontWeight: 700 }}>{p.length.toFixed(1)}</td>
                                <td style={tdStyle(T)}>{p.qty}</td>
                                <td style={tdStyle(T)}>{p.desc || "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </Card>
                );
              })}

              </ScrollPane>
              {/* Footer bar with ▼ */}
              {jobsCtrl.overflowing && (
                <div style={{ display: "flex", justifyContent: "flex-end", padding: "8px 12px", background: T.bg, borderTop: `1px solid ${T.border}`, flexShrink: 0 }}>
                  <ScrollBtn ctrl={jobsCtrl} dir="down" T={T} FONT={FONT} size={32} />
                </div>
              )}
            </div>
          )}

          {/* Summary + optimise bar — pinned below the card */}
          {!jobsSummaryReady && csvFiles.length > 0 && (
            <div style={{ marginTop: 12, background: T.surf, border: `1px solid ${T.border}`, borderRadius: 10, padding: "14px 22px", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
              <span style={{ fontSize: 14, color: T.muted, fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase" }}>
                {csvFiles.length} file{csvFiles.length > 1 ? "s" : ""} &nbsp;·&nbsp; {parts.length} cuts &nbsp;·&nbsp; {parts.reduce((s, p) => s + p.length * (p.qty || 1), 0).toFixed(0)} mm total
              </span>
              <button
                onClick={() => {
                  if (runOptimize()) {
                    setExpandedProfileNames(new Set());
                    setJobsSummaryReady(true);
                  }
                }}
                className="bb-action" style={{ ...actionBtnStyle, padding: "10px 24px", fontSize: 14 }}
              >
                ▶ Optimise
              </button>
            </div>
          )}
        </div>
        {alertsModal}
      </div>
    );
  }

  // ── PDF PREVIEW sub-view ─────────────────────────────────────
  if (view === "pdfpreview") {
    return (
      <div style={{ height: "100vh", background: T.bg, color: T.text, fontFamily: FONT, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {renderHeader()}
        <div style={{ flex: 1, padding: "16px 24px", display: "flex", flexDirection: "column", overflow: "hidden" }}>

          {/* Title row */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexShrink: 0 }}>
            <span style={{ fontSize: 22, fontWeight: 800, letterSpacing: "2px", textTransform: "uppercase", color: ACCENT }}>Print / Export PDF</span>
            <button onClick={() => { URL.revokeObjectURL(pdfPreviewUrl); setPdfPreviewUrl(null); setView("main"); }} className="bb-back" style={backBtnStyle(T)}>← Back</button>
          </div>

          {/* Two-column: options | preview */}
          <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 20, flex: 1, minHeight: 0 }}>

            {/* ── Options panel ── */}
            <div style={{ background: T.surf, border: `1px solid ${T.border}`, borderRadius: 14, padding: 24, display: "flex", flexDirection: "column", gap: 18, overflow: "hidden" }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: T.muted, letterSpacing: "2px", textTransform: "uppercase" }}>Options</div>

              {/* Filename */}
              <div>
                <label style={setupLabel(T)}>Filename</label>
                <div style={{ ...setupInput(T), fontSize: 13, color: T.muted, wordBreak: "break-all" }}>{pdfFilename}</div>
              </div>

              {/* Summary */}
              {results && (
                <div style={{ background: T.bg, borderRadius: 10, border: `1px solid ${T.border}`, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
                  {[
                    ["Bars",       results.barCount],
                    ["Efficiency", `${results.efficiency}%`],
                    ["Source",     jobSource === "basic" ? "Basic Job" : (jobName || "CSV")],
                  ].map(([lbl, val]) => (
                    <div key={lbl} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 13, color: T.muted, fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase" }}>{lbl}</span>
                      <span style={{ fontSize: 15, fontWeight: 800, color: T.text }}>{val}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Print button — opens browser print dialog (includes printer selection) */}
              <button
                onClick={() => iframeRef.current?.contentWindow?.print()}
                style={{ width: "100%", padding: "18px 0", fontSize: 16, fontWeight: 800, borderRadius: 10, border: "none", background: ACCENT, color: "#212121", cursor: "pointer", fontFamily: FONT, display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}
              >
                🖨 Print
              </button>

              {/* Save as PDF */}
              <button
                onClick={savePDF}
                style={{ width: "100%", padding: "18px 0", fontSize: 16, fontWeight: 800, borderRadius: 10, border: `1px solid ${T.border}`, background: T.surf2, color: T.text, cursor: "pointer", fontFamily: FONT, display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}
              >
                <FileDown size={18} /> Save as PDF
              </button>

              <p style={{ fontSize: 12, color: T.muted, margin: 0, lineHeight: 1.5 }}>
                Click <strong style={{ color: T.text }}>Print</strong> to open your printer list and select a printer or "Save as PDF".<br /><br />
                Click <strong style={{ color: T.text }}>Save as PDF</strong> to choose where to save the file on this device.
              </p>
            </div>

            {/* ── PDF Preview ── */}
            <div style={{ background: "#525659", borderRadius: 14, overflow: "hidden", border: `1px solid ${T.border}` }}>
              {pdfPreviewUrl ? (
                <iframe
                  ref={iframeRef}
                  src={pdfPreviewUrl}
                  style={{ width: "100%", height: "100%", border: "none", display: "block" }}
                  title="PDF Preview"
                />
              ) : (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#aaa", fontSize: 16 }}>
                  Generating preview…
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Export toast */}
        {exportToast && (
          <div style={{
            position: "fixed", bottom: 28, left: "50%", transform: "translateX(-50%)",
            background: "#43B581", color: "#fff", borderRadius: 12,
            padding: "16px 28px", display: "flex", alignItems: "center", gap: 14,
            boxShadow: "0 8px 32px rgba(0,0,0,0.4)", zIndex: 9999,
            fontFamily: FONT, fontSize: 15, fontWeight: 600,
          }}>
            <FileDown size={20} color="#fff" />
            <div>
              <div style={{ fontSize: 13, opacity: 0.85, marginBottom: 2 }}>
                {exportToast.saved ? "Saved to:" : "Downloaded — check your Downloads folder:"}
              </div>
              <div style={{ fontSize: 16, fontWeight: 800 }}>{exportToast.filename}</div>
            </div>
            <button onClick={() => setExportToast(null)} style={{ background: "none", border: "none", color: "#fff", cursor: "pointer", fontSize: 22, lineHeight: 1, padding: "0 0 0 8px", opacity: 0.8 }}>×</button>
          </div>
        )}
        {alertsModal}
      </div>
    );
  }

  // ── MAIN control view ─────────────────────────────────────────
  return (
    <div style={{ height: "100vh", background: T.bg, color: T.text, fontFamily: FONT, display: "flex", flexDirection: "column", overflow: "hidden" }}>

      {renderHeader()}

      {/* Body */}
      <div style={{ flex: 1, minHeight: 0, padding: "16px 36px", display: "flex", flexDirection: "column", gap: 14, maxWidth: 1900, margin: "0 auto", width: "100%", overflow: "hidden" }}>

        {/* Row 1 — Status + RESET + START — same 4-col grid as Row 2 so widths align */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, flexShrink: 0, height: 150 }}>

          {/* Machine status — spans cols 1-2 */}
          <Card T={T} style={{ gridColumn: "span 2", padding: "12px 28px", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 15, color: T.muted, fontWeight: 700, letterSpacing: "2px", textTransform: "uppercase", marginBottom: 8 }}>Machine Status</div>
              <div style={{ fontSize: 64, fontWeight: 900, color: machineStatus.color, letterSpacing: "4px", lineHeight: 1, fontFamily: FONT }}>
                {machineStatus.label}
              </div>
              <div style={{ fontSize: 14, color: T.muted, marginTop: 8, letterSpacing: "1px", fontWeight: 700, textTransform: "uppercase" }}>
                Position <span style={{ color: ACCENT, fontWeight: 900, fontFamily: FONT }}>{plcRegs.d300 != null ? plcRegs.d300 : "—"}</span>
              </div>
              {jobName && <div style={{ fontSize: 13, color: T.muted, marginTop: 4, letterSpacing: "0.5px" }}>{jobName}</div>}
            </div>
          </Card>

          {/* RESET */}
          <button
            onClick={handleStop}
            style={{
              fontSize: 36, fontWeight: 900, letterSpacing: "4px",
              textTransform: "uppercase", background: "#f95463",
              color: "#fff", border: "none", borderRadius: 12, cursor: "pointer",
              fontFamily: FONT, boxShadow: "0 4px 24px #f9546366",
            }}
          >RESET</button>

          {/* START */}
          <button
            onClick={handleAutoCut}
            disabled={!results?.bars?.length}
            style={{
              fontSize: 36, fontWeight: 900, letterSpacing: "4px",
              textTransform: "uppercase",
              background: results?.bars?.length ? "#43B581" : T.surf2,
              color: results?.bars?.length ? "#fff" : T.text,
              border: `1px solid ${results?.bars?.length ? "transparent" : T.border}`, borderRadius: 12,
              cursor: results?.bars?.length ? "pointer" : "not-allowed",
              fontFamily: FONT, boxShadow: results?.bars?.length ? "0 4px 24px #43B58180" : "none",
            }}
          >START</button>
        </div>

        {/* Row 2 — Metrics — same 4-col grid */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, flexShrink: 0 }}>
          <MetricTile T={T}
            label="Total Bar Length (mm)"
            value={standardLength.toLocaleString("en")}
            color={T.text}
          />
          <MetricTile T={T}
            label="Job Progress (%)"
            value={`${jobPct}%`}
            sub={`${ackedBars} of ${totalBars} cuts`}
            color={ACCENT}
          />
          <MetricTile T={T}
            label={activeProfileName ? `Parts: ${activeProfileName}` : "Part Length (mm)"}
            value={(results
              ? results.bars
                  .filter(b => !activeProfileName || b.profile === activeProfileName)
                  .reduce((s, b) => s + b.cuts.reduce((cs, c) => cs + c.length, 0), 0)
              : parts.length
                  ? parts.reduce((s, p) => s + p.length * (p.qty || 1), 0)
                  : partLength
            ).toFixed(0)}
            sub="mm total"
            color="#9B59B6"
          />
          <MetricTile T={T}
            label="Part Progress"
            value={partPct}
            color="#43B581"
          />
        </div>

        {/* Row 3 — Mode / Nav buttons */}
        <div style={{ display: "flex", gap: 12, flexShrink: 0 }}>
          <ModeBtn T={T} label="Basic Job" active={false} onClick={() => setView("basicjob")} />
          <ModeBtn T={T}
            label={optimized ? "Optimised" : "Optimise"}
            active={mode === "optimise"}
            onClick={() => { setMode("optimise"); runOptimize(); }}
          />
          <ModeBtn T={T} label="Setup" active={false} onClick={() => setView("setup")} />
          <ModeBtn T={T} label="Jobs"  active={false} onClick={() => setView("jobs")}  />
        </div>

        {/* Row 4 — All Cuts table (scrollable, all bars combined) */}
        {(() => {
          const allBars = results?.bars ?? null;
          const cols = jobSource === "csv" ? "44px 1fr 1fr 160px 160px 1fr" : "44px 1fr 1fr 160px 160px";
          const activeGroupKey = cutMapRef.current[activeCutIdx]?.groupKey ?? null;
          let globalRowIdx = 0;
          return (
            <div style={{
              background: T.surf, border: `1px solid ${T.border}`,
              borderRadius: 10, padding: "18px 20px",
              flex: 1, minHeight: 0, display: "flex", flexDirection: "column",
            }}>
              {/* Table header row */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexShrink: 0 }}>
                <span style={{ fontSize: 15, color: T.muted, fontWeight: 700, letterSpacing: "1.5px", textTransform: "uppercase" }}>
                  Present Bar {allBars ? `— ${allBars.length} bar${allBars.length > 1 ? "s" : ""}` : ""}
                </span>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  {results && (
                    <button onClick={() => { setResults(null); setOptimized(false); setTotalBars(0); setAckedBars(0); setCompletedCuts(new Set()); setActiveCutIdx(null); cutMapRef.current = []; setSequenceRunning(false); }} style={{
                      display: "flex", alignItems: "center", gap: 6,
                      padding: "10px 14px", borderRadius: 8, border: `1px solid ${T.border}`,
                      background: T.surf2, color: "#f95463", cursor: "pointer", fontFamily: FONT,
                    }}>
                      <CircleX size={16} />
                    </button>
                  )}
                  {results && (
                    <button onClick={openPDFPreview} style={{
                      display: "flex", alignItems: "center", gap: 7,
                      padding: "10px 18px", borderRadius: 8, border: `1px solid ${T.border}`,
                      background: T.surf2, color: T.text, fontSize: 14, fontWeight: 700,
                      cursor: "pointer", fontFamily: FONT,
                    }}>
                      <FileDown size={16} />Export PDF
                    </button>
                  )}
                </div>
              </div>

              {allBars ? (
                <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, borderRadius: 8, border: `1px solid ${T.border}`, overflow: "hidden" }}>
                  {/* Column headers — sticky */}
                  <div style={{ position: "relative", display: "grid", gridTemplateColumns: cols, background: T.bg, padding: "12px 16px", paddingRight: 60, gap: 10, borderBottom: `1px solid ${T.border}`, flexShrink: 0, alignItems: "center" }}>
                    {["", "Part ID", "Profile", "Length", "Bar", ...(jobSource === "csv" ? ["Description"] : [])].map((h, i) => (
                      <span key={i} style={{ fontSize: 13, color: T.muted, fontWeight: 700, letterSpacing: "1.2px", textTransform: "uppercase" }}>{h}</span>
                    ))}
                    <div style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)" }}>
                      <ScrollBtn ctrl={cutsCtrl} dir="up" T={T} FONT={FONT} size={32} />
                    </div>
                  </div>
                  {/* Scrollable rows — all bars combined */}
                  <ScrollPane ctrl={cutsCtrl} showButtons={false} T={T} FONT={FONT} innerStyle={{ WebkitOverflowScrolling: "touch", touchAction: "pan-y", overscrollBehavior: "contain" }}>
                    {allBars.map((bar) => (
                      bar.cuts.map((cut, cutIdx) => {
                        const groupKey = `${bar.barLabel}—${cut.id}—${cut.length}`;
                        const done   = completedCuts.has(groupKey);
                        const active = !done && sequenceRunning && groupKey === activeGroupKey;
                        const rowIdx = globalRowIdx++;
                        return (
                          <div key={`${bar.barLabel}-${cutIdx}`} style={{
                            display: "grid", gridTemplateColumns: cols,
                            padding: "14px 16px", gap: 10, alignItems: "center",
                            background: done ? "#43B58112" : active ? ACCENT + "18" : rowIdx % 2 === 0 ? T.surf : T.surf2,
                            borderBottom: `1px solid ${T.border}`,
                            borderLeft: active ? `4px solid ${ACCENT}` : "4px solid transparent",
                            transition: "background .2s",
                            touchAction: "pan-y",
                          }}>
                            <div style={{
                              width: 34, height: 34, borderRadius: "50%",
                              border: `2px solid ${done ? "#43B581" : active ? ACCENT : T.border}`,
                              background: done ? "#43B581" : "transparent",
                              display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                            }}>
                              {done && <Check size={18} color="#fff" strokeWidth={3} />}
                            </div>
                            <span style={{ fontSize: 15, fontWeight: 800, color: done ? T.muted : active ? ACCENT : T.text, textDecoration: done ? "line-through" : "none", fontFamily: FONT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {cut.originalId || cut.pieceLabel || cut.displayId || cut.id || "—"}
                            </span>
                            <span style={{ fontSize: 15, fontWeight: 700, color: done ? T.muted : T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {cut.profile || bar.profile || "—"}
                            </span>
                            <span style={{ fontSize: 17, fontWeight: 700, color: done ? T.muted : active ? ACCENT : "#E8A838" }}>{cut.length} mm</span>
                            <span style={{ fontSize: 14, color: T.muted }}>{bar.barLabel}</span>
                            {jobSource === "csv" && <span style={{ fontSize: 14, color: done ? T.muted : T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cut.desc || "—"}</span>}
                          </div>
                        );
                      })
                    ))}
                  </ScrollPane>
                  {cutsCtrl.overflowing && (
                    <div style={{ display: "flex", justifyContent: "flex-end", padding: "8px 12px", background: T.bg, borderTop: `1px solid ${T.border}`, flexShrink: 0 }}>
                      <ScrollBtn ctrl={cutsCtrl} dir="down" T={T} FONT={FONT} size={32} />
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <span style={{ fontSize: 17, color: T.muted }}>
                    {parts.length ? "Click Optimise to see cut sequences." : "Load a job or click Optimise."}
                  </span>
                </div>
              )}
            </div>
          );
        })()}
      </div>

      {/* ── Cutting popup ── */}
      {d502Cutting && sequenceRunning && activeCutIdx !== null && (() => {
        const cuttingEntry = cutFlatListRef.current[activeCutIdx];
        const cuttingLen   = cuttingEntry?.cut?.length ?? "—";
        const cuttingProf  = cuttingEntry?.cut?.profile || cuttingEntry?.bar?.profile || "";
        return (
          <div style={{
            position: "fixed", inset: 0, zIndex: 10000,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)",
          }}>
            <div style={{
              background: "#5D5D5D", border: "4px solid #E8A838", borderRadius: 24,
              padding: "40px 160px", textAlign: "center",
              boxShadow: "0 24px 80px rgba(0,0,0,0.8)",
              display: "flex", flexDirection: "column", alignItems: "center", gap: 24,
            }}>
              <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: "4px", textTransform: "uppercase", color: "#E8A838" }}>
                CUTTING
              </div>
              {cuttingProf && (
                <div style={{ fontSize: 22, fontWeight: 600, color: "#eee", letterSpacing: "1px" }}>{cuttingProf}</div>
              )}
              <div style={{ fontSize: 110, fontWeight: 900, color: "#fff", fontFamily: FONT, lineHeight: 1 }}>
                {cuttingLen}
              </div>
              <div style={{ fontSize: 32, fontWeight: 700, color: "#E8A838" }}>mm</div>
            </div>
          </div>
        );
      })()}

      {/* ── Export toast ── */}
      {exportToast && (
        <div style={{
          position: "fixed", bottom: 28, left: "50%", transform: "translateX(-50%)",
          background: "#43B581", color: "#fff", borderRadius: 12,
          padding: "16px 28px", display: "flex", alignItems: "center", gap: 14,
          boxShadow: "0 8px 32px rgba(0,0,0,0.4)", zIndex: 9999,
          fontFamily: FONT, fontSize: 15, fontWeight: 600,
          animation: "fadeSlideUp .25s ease",
        }}>
          <FileDown size={20} color="#fff" />
          <div>
            <div style={{ fontSize: 13, opacity: 0.85, marginBottom: 2 }}>
              {exportToast.saved ? "Saved to:" : "Downloaded to your browser Downloads folder:"}
            </div>
            <div style={{ fontSize: 16, fontWeight: 800 }}>{exportToast.filename}</div>
          </div>
          <button
            onClick={() => setExportToast(null)}
            style={{ background: "none", border: "none", color: "#fff", cursor: "pointer", fontSize: 22, lineHeight: 1, padding: "0 0 0 8px", opacity: 0.8 }}
          >×</button>
        </div>
      )}

      {/* ── Bar length > cut list warning ── */}
      {showBarWarning && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 10001,
          background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <div style={{
            background: "#1E1E1E", border: `2px solid #333`, borderRadius: 20,
            padding: "48px 56px", textAlign: "center", maxWidth: 500, width: "90%",
            boxShadow: "0 24px 64px rgba(0,0,0,0.8)",
          }}>
            <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: "2px", textTransform: "uppercase", color: "#888", marginBottom: 20 }}>
              Warning
            </div>
            <div style={{ fontSize: 26, fontWeight: 900, color: "#F0F0F0", marginBottom: 10, fontFamily: FONT }}>
              {barWarningData.dir === "cutlist_greater"
                ? "Part Length Greater Than Bar"
                : "Total Length is Greater"}
            </div>
            <div style={{ fontSize: 16, color: "#888", marginBottom: 8 }}>
              Bar stock: <span style={{ color: barWarningData.dir === "cutlist_greater" ? "#f95463" : "#F0F0F0", fontWeight: 700 }}>{barWarningData.scanned.toLocaleString()} mm</span>
            </div>
            <div style={{ fontSize: 16, color: "#888", marginBottom: 36 }}>
              Cut list total: <span style={{ color: "#F0F0F0", fontWeight: 700 }}>{Math.round(barWarningData.cutlistTotal).toLocaleString()} mm</span>
            </div>
            <div style={{ display: "flex", gap: 12 }}>
              <button
                onClick={() => { setStandardLength(6000); setShowBarWarning(false); }}
                style={{
                  flex: 1, padding: "18px 0", fontSize: 18, fontWeight: 900,
                  background: "#43B581", color: "#fff", border: "none", borderRadius: 12,
                  cursor: "pointer", fontFamily: FONT, letterSpacing: "0.5px",
                  boxShadow: "0 4px 20px #43B58155",
                }}
              >Add 6000mm</button>
              <button
                onClick={() => setShowBarWarning(false)}
                style={{
                  flex: 1, padding: "18px 0", fontSize: 18, fontWeight: 900,
                  background: "#2A2A2A", color: "#888", border: "2px solid #333", borderRadius: 12,
                  cursor: "pointer", fontFamily: FONT,
                }}
              >Keep {barWarningData.scanned} mm</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Part oversize warning — shown after optimize if any part > bar length ── */}
      {showOversizeWarning && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 10002,
          background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <div style={{
            background: "#1E1E1E", border: `2px solid #f95463`, borderRadius: 20,
            padding: "48px 56px", textAlign: "center", maxWidth: 480, width: "90%",
            boxShadow: "0 24px 64px rgba(0,0,0,0.8)",
          }}>
            <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: "2px", textTransform: "uppercase", color: "#f95463", marginBottom: 20 }}>
              Warning
            </div>
            <div style={{ fontSize: 26, fontWeight: 900, color: "#F0F0F0", marginBottom: 16, fontFamily: FONT }}>
              Part Length Greater Than Bar
            </div>
            <div style={{ fontSize: 16, color: "#888", marginBottom: 8 }}>
              Part length: <span style={{ color: "#f95463", fontWeight: 700 }}>{oversizePartLen.toLocaleString()} mm</span>
            </div>
            <div style={{ fontSize: 16, color: "#888", marginBottom: 36 }}>
              Bar stock: <span style={{ color: "#F0F0F0", fontWeight: 700 }}>{standardLength.toLocaleString()} mm</span>
            </div>
            <div style={{ display: "flex", gap: 12 }}>
              <button
                onClick={() => { setStandardLength(6000); setShowOversizeWarning(false); }}
                style={{
                  flex: 1, padding: "18px 0", fontSize: 18, fontWeight: 900,
                  background: "#43B581", color: "#fff", border: "none", borderRadius: 12,
                  cursor: "pointer", fontFamily: FONT, letterSpacing: "0.5px",
                  boxShadow: "0 4px 20px #43B58155",
                }}
              >Add 6000 mm</button>
              <button
                onClick={() => setShowOversizeWarning(false)}
                style={{
                  flex: 1, padding: "18px 0", fontSize: 18, fontWeight: 900,
                  background: "#2A2A2A", color: "#888", border: "2px solid #333", borderRadius: 12,
                  cursor: "pointer", fontFamily: FONT,
                }}
              >Keep {standardLength.toLocaleString()} mm</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Profile change modal — operator must load new bar type ── */}
      {showProfileModal && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 10000,
          background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <div style={{
            background: "#1E1E1E", border: `2px solid #333`, borderRadius: 20,
            padding: "52px 60px", textAlign: "center", maxWidth: 520, width: "90%",
            boxShadow: "0 24px 64px rgba(0,0,0,0.8)",
          }}>
            <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: "2px", textTransform: "uppercase", color: "#888", marginBottom: 20 }}>
              {profileModalMode === "scan" ? "Bar Scanned" : "Profile Change"}
            </div>
            <div style={{ fontSize: 32, fontWeight: 900, color: "#F0F0F0", marginBottom: 12, fontFamily: FONT }}>
              {pendingProfile.profile}
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, color: "#888", marginBottom: 40 }}>
              {pendingProfile.totalLength} mm
            </div>
            <button
              onClick={handleProfileModalOk}
              style={{
                width: "100%", padding: "22px 0", fontSize: 22, fontWeight: 900,
                background: "#43B581", color: "#fff", border: "none", borderRadius: 12,
                cursor: "pointer", fontFamily: FONT, letterSpacing: "1px",
                boxShadow: "0 4px 24px #43B58155",
              }}
            >OK</button>
          </div>
        </div>
      )}

      {/* ── Calibration reminder — shown on every power-up until dismissed ── */}
      {showCalibReminder && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 10002,
          background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <div style={{
            background: "#1E1E1E", border: "2px solid #E8A838", borderRadius: 20,
            padding: "48px 80px", textAlign: "center", minWidth: 480,
            boxShadow: "0 24px 64px rgba(0,0,0,0.8)",
            display: "flex", flexDirection: "column", alignItems: "center", gap: 28,
          }}>
            <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "3px", textTransform: "uppercase", color: "#E8A838" }}>
              REMINDER
            </div>
            <div style={{ fontSize: 26, fontWeight: 800, color: "#F0F0F0", fontFamily: FONT, lineHeight: 1.4 }}>
              Calibrate before loading cutlist
            </div>
            <button
              onClick={() => { setShowCalibReminder(false); setView("setup"); setSetupTile("cal"); }}
              style={{
                padding: "18px 64px", fontSize: 20, fontWeight: 900,
                background: "#E8A838", color: "#1a1a1a", border: "none", borderRadius: 12,
                cursor: "pointer", fontFamily: FONT, letterSpacing: "1px",
                boxShadow: "0 4px 24px #E8A83855",
              }}
            >OK</button>
          </div>
        </div>
      )}

      {/* ── Cut list complete modal ── */}
      {showDoneModal && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 10000,
          background: "rgba(0,0,0,0.72)", display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <div style={{
            background: T.surf, border: `1px solid ${T.border}`, borderRadius: 20,
            padding: "48px 56px", textAlign: "center", maxWidth: 500, width: "90%",
            boxShadow: "0 24px 64px rgba(0,0,0,0.6)",
          }}>
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 20 }}>
              <ListCheck size={72} color="#43B581" strokeWidth={1.5} />
            </div>
            <div style={{ fontSize: 28, fontWeight: 900, color: "#43B581", letterSpacing: "1px", marginBottom: 12, fontFamily: FONT }}>
              Sequence Complete!
            </div>
            <div style={{ fontSize: 16, color: T.muted, marginBottom: 36, lineHeight: 1.6 }}>
              All cuts have been sent and acknowledged.
            </div>
            <button
              onClick={() => setShowDoneModal(false)}
              style={{
                width: "100%", padding: "20px 0", fontSize: 20, fontWeight: 900,
                background: ACCENT, color: "#212121", border: "none", borderRadius: 12,
                cursor: "pointer", fontFamily: FONT, letterSpacing: "1px",
              }}
            >OK</button>
          </div>
        </div>
      )}

      {alertsModal}
    </div>
  );
}

// ── Shared micro-styles ───────────────────────────────────────────────────────
const thStyle = (T) => ({
  padding: "14px 18px", textAlign: "left", fontSize: 14, color: T.muted,
  fontWeight: 700, letterSpacing: "1.2px", textTransform: "uppercase",
  borderBottom: `1px solid ${T.border}`, background: T.bg,
  fontFamily: FONT,
});
const tdStyle = (T) => ({
  padding: "14px 18px", fontSize: 16, borderBottom: `1px solid ${T.border}`,
  color: T.text, fontFamily: FONT,
});
const backBtnStyle = (T) => ({
  background: T.surf2, border: `1px solid ${T.border}`,
  borderBottom: `3px solid ${T.border}`,
  borderRadius: 10,
  padding: "10px 22px", color: T.text, fontSize: 15, cursor: "pointer",
  fontFamily: FONT, fontWeight: 700,
  boxShadow: "0 2px 6px rgba(0,0,0,0.2)",
  // className added at call sites: bb-back
});
const actionBtnStyle = {
  background: ACCENT, border: "none", borderRadius: 10,
  padding: "16px 32px", color: "#212121", fontSize: 17, fontWeight: 800,
  cursor: "pointer", fontFamily: FONT,
  boxShadow: `0 3px 0 #9aa000, 0 4px 14px ${ACCENT}44`,
  // className added at call sites: bb-action
};
const navBtnStyle = (T) => ({
  flex: 1, padding: "0", fontSize: 28, fontWeight: 800,
  letterSpacing: "2px", textTransform: "uppercase",
  background: T.surf2, color: T.text,
  border: `1px solid ${T.border}`,
  borderBottom: `3px solid ${T.border}`,
  borderRadius: 12,
  cursor: "pointer", fontFamily: FONT,
  boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
});

const setupLabel = (T) => ({
  display: "block", fontSize: 15, color: T.muted, fontWeight: 700,
  letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: 8,
  fontFamily: FONT,
});
const setupInput = (T) => ({
  width: "100%", boxSizing: "border-box",
  background: T.surf2, border: `1px solid ${T.border}`,
  borderRadius: 8, padding: "14px 16px", color: T.text,
  fontSize: 18, fontFamily: FONT, outline: "none",
});
