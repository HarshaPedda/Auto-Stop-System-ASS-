import { useState } from "react";
import { UserCog, UserStar, ArrowLeftFromLine } from "lucide-react";
import OperatorView from "./OperatorView.jsx";

const FONT = "'Inter',sans-serif";
const THEMES = {
  dark: {
    bg: "#0F0F0F", surface: "#1C1C1C", surfaceAlt: "#252525",
    text: "#F0F0F0", textStrong: "#FFFFFF", muted: "#999999",
    mutedDim: "#666666", accent: "#C8D400", border: "#333333",
    shadow: "0 8px 40px rgba(0,0,0,0.35)",
  },
  light: {
    bg: "#EAEAEA", surface: "#FFFFFF", surfaceAlt: "#F1F5F9",
    text: "#212121", textStrong: "#212121", muted: "#666666",
    mutedDim: "#94a3b8", accent: "#C8D400", border: "#CCCCCC",
    shadow: "0 8px 40px rgba(0,0,0,0.10)",
  },
};

const ROLES = [
  { id: "operator", label: "Operator", color: "#2E8BC0", icon: UserCog,  desc: "Machine operation & cut sequences" },
  { id: "engineer", label: "Engineer", color: "#C8D400", icon: UserStar, desc: "Full access — settings, parts & programming" },
];

const SESSION_KEY = "bb-cut-session";

// ── AUTO-LOGIN FLAG ───────────────────────────────────────────────────────────
// Set to true to skip the login page and go straight to the operator dashboard.
// Set to false to re-enable the full login/engineer flow.
const AUTO_LOGIN_AS_OPERATOR = true;
const AUTO_LOGIN_USERNAME = "Operator";

// ── On-Screen Keyboard ────────────────────────────────────────────────────────
function OnScreenKeyboard({ onKey, caps, onCaps, BB }) {
  const [numMode, setNumMode] = useState(false);

  const isDark = BB.surface === "#1C1C1C";
  const letterBg  = isDark ? "#4A4A4A" : "#FFFFFF";
  const specialBg = isDark ? "#2D2D2D" : "#C8CDD6";
  const borderCol = isDark ? "#606060" : "#ADB5BD";
  const shadow    = isDark ? "0 4px 0 #111" : "0 4px 0 #9CA3AF";

  const K = (label, handler, flex = 1, bg = letterBg, color = BB.text, fs = 22) => (
    <button
      key={label}
      onMouseDown={e => { e.preventDefault(); handler(); }}
      style={{
        flex, height: 76, minWidth: 0,
        background: bg, color,
        border: `1px solid ${borderCol}`,
        borderRadius: 12, fontSize: fs, fontWeight: 600,
        fontFamily: FONT, cursor: "pointer",
        boxShadow: shadow,
        display: "flex", alignItems: "center", justifyContent: "center",
        userSelect: "none",
      }}
    >{label}</button>
  );

  const GAP = { display: "flex", gap: 8, marginBottom: 8 };
  const letter = k => caps ? k.toUpperCase() : k;

  if (numMode) {
    return (
      <div style={{ padding: "14px 16px 20px" }}>
        <div style={GAP}>
          {["1","2","3","4","5","6","7","8","9","0"].map(k => K(k, () => onKey(k)))}
        </div>
        <div style={GAP}>
          {["-","/",":",";","(",")", "$","&","@",'"'].map(k => K(k, () => onKey(k)))}
        </div>
        <div style={GAP}>
          {K("ABC", () => setNumMode(false), 1.8, specialBg, BB.text, 16)}
          {[".",",","?","!","'"].map(k => K(k, () => onKey(k)))}
          {K("⌫", () => onKey("BACKSPACE"), 1.8, specialBg, BB.text, 26)}
        </div>
        <div style={GAP}>
          {K("", () => onKey(" "), 6)}
          {K("DONE", () => onKey("DONE"), 2, BB.accent, "#212121", 16)}
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: "14px 16px 20px" }}>
      {/* Number strip */}
      <div style={{ ...GAP, marginBottom: 10 }}>
        {["1","2","3","4","5","6","7","8","9","0"].map(k => K(k, () => onKey(k), 1, specialBg, BB.text, 20))}
      </div>
      <div style={{ height: 1, background: borderCol, marginBottom: 10, opacity: 0.4 }} />
      {/* QWERTYUIOP */}
      <div style={GAP}>
        {["q","w","e","r","t","y","u","i","o","p"].map(k => K(letter(k), () => onKey(letter(k))))}
      </div>
      {/* ASDFGHJKL + ⌫ */}
      <div style={{ ...GAP, paddingLeft: "3%" }}>
        {["a","s","d","f","g","h","j","k","l"].map(k => K(letter(k), () => onKey(letter(k))))}
        {K("⌫", () => onKey("BACKSPACE"), 1.5, specialBg, BB.text, 26)}
      </div>
      {/* ⇧ ZXCVBNM ⏎ */}
      <div style={GAP}>
        <button
          onMouseDown={e => { e.preventDefault(); onCaps(); }}
          style={{
            flex: 1.5, height: 76, minWidth: 0, borderRadius: 12, cursor: "pointer",
            fontFamily: FONT, fontSize: 24, fontWeight: 700,
            background: caps ? BB.accent : specialBg,
            color: caps ? "#212121" : BB.text,
            border: `2px solid ${caps ? BB.accent : borderCol}`,
            boxShadow: caps ? `0 4px 0 ${BB.accent}88` : shadow,
            display: "flex", alignItems: "center", justifyContent: "center",
            userSelect: "none",
          }}
        >⇧</button>
        {["z","x","c","v","b","n","m"].map(k => K(letter(k), () => onKey(letter(k))))}
        {K("⏎", () => onKey("DONE"), 1.5, specialBg, BB.text, 24)}
      </div>
      {/* @ - SPACE . _ DONE */}
      <div style={GAP}>
        {K("@", () => onKey("@"), 1, specialBg, BB.text, 20)}
        {K("-", () => onKey("-"), 1, specialBg, BB.text, 20)}
        {K("",  () => onKey(" "), 6)}
        {K(".", () => onKey("."), 1, specialBg, BB.text, 20)}
        {K("_", () => onKey("_"), 1, specialBg, BB.text, 20)}
        {K("DONE", () => onKey("DONE"), 2, BB.accent, "#212121", 16)}
      </div>
    </div>
  );
}

export default function LoginGate({ children }) {
  const [theme] = useState(() => {
    try { return localStorage.getItem("bb-cut-theme") || "dark"; } catch { return "dark"; }
  });
  const BB = THEMES[theme];

  const [session, setSession] = useState(() => {
    if (AUTO_LOGIN_AS_OPERATOR) return { type: "operator", username: AUTO_LOGIN_USERNAME };
    try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null"); } catch { return null; }
  });

  const [step,         setStep]         = useState("role");
  const [selectedRole, setSelectedRole] = useState(null);
  const [username,     setUsername]     = useState("");
  const [password,     setPassword]     = useState("");
  const [error,        setError]        = useState("");
  const [loading,      setLoading]      = useState(false);
  const [activeInput,  setActiveInput]  = useState(null);
  const [caps,         setCaps]         = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  function handleKey(k) {
    if (k === "DONE") { setActiveInput(null); return; }
    const update = prev => k === "BACKSPACE" ? prev.slice(0, -1) : prev + k;
    if (activeInput === "username") setUsername(update);
    else if (activeInput === "password") setPassword(update);
  }

  if (session) {
    if (session.type === "operator") return <OperatorView username={session.username} />;
    return children;
  }

  async function handleLogin(e) {
    e.preventDefault();
    if (!username.trim() || !password) { setError("Enter username and password."); return; }
    setLoading(true); setError("");
    try {
      const res = await fetch(`/users.json?t=${Date.now()}`);
      if (!res.ok) throw new Error("Could not load users.json");
      const users = await res.json();
      const match = users.find(
        u => u.type === selectedRole &&
             u.username.toLowerCase() === username.trim().toLowerCase() &&
             u.password === password
      );
      if (!match) {
        setError("Invalid username or password.");
      } else {
        const sess = { type: selectedRole, username: match.username };
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(sess));
        setSession(sess);
      }
    } catch {
      setError("Could not read users.json. Make sure the file exists in /public.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      minHeight: "100vh", background: BB.bg, color: BB.text,
      fontFamily: FONT, display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      paddingBottom: activeInput ? 460 : 0,
      transition: "padding-bottom .25s cubic-bezier(.32,1,.32,1)",
    }}>
      {/* Logo */}
      <img
        src={theme === "dark" ? "/logo.webp" : "/logo-light.webp"}
        alt="BlackBoxx Factories"
        style={{ height: 72, marginBottom: 40, opacity: 0.9 }}
      />

      <div style={{
        background: BB.surface, border: `1px solid ${BB.border}`,
        borderRadius: 20, padding: "52px 60px", width: "100%", maxWidth: 720,
        boxShadow: BB.shadow,
      }}>

        {/* ── Step 1: Select User ── */}
        {step === "role" && (
          <>
            <h2 style={{
              fontSize: 18, fontWeight: 800, color: BB.muted, letterSpacing: "3px",
              textTransform: "uppercase", margin: "0 0 8px",
            }}>Select User</h2>
            <p style={{ fontSize: 15, color: BB.mutedDim, margin: "0 0 36px" }}>
              Choose your access level to continue
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
              {ROLES.map(r => (
                <button
                  key={r.id}
                  onClick={() => { setSelectedRole(r.id); setStep("login"); setError(""); }}
                  style={{
                    background: BB.surfaceAlt, border: `2px solid ${BB.border}`,
                    borderRadius: 14, padding: "26px 32px", cursor: "pointer",
                    textAlign: "left", display: "flex", alignItems: "center", gap: 24,
                    fontFamily: FONT, transition: "border-color .15s, box-shadow .15s",
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.borderColor = r.color;
                    e.currentTarget.style.boxShadow = `0 0 0 4px ${r.color}22`;
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.borderColor = BB.border;
                    e.currentTarget.style.boxShadow = "none";
                  }}
                >
                  <span style={{
                    width: 72, height: 72, display: "flex",
                    alignItems: "center", justifyContent: "center",
                    background: r.color + "18", borderRadius: 14, flexShrink: 0,
                  }}><r.icon size={38} color={r.color} /></span>
                  <div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: r.color, marginBottom: 5 }}>{r.label}</div>
                    <div style={{ fontSize: 15, color: BB.mutedDim }}>{r.desc}</div>
                  </div>
                </button>
              ))}
            </div>
          </>
        )}

        {/* ── Step 2: Login Form ── */}
        {step === "login" && (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 32 }}>
              <button
                onClick={() => { setStep("role"); setSelectedRole(null); setError(""); setUsername(""); setPassword(""); }}
                style={{
                  background: "none", border: `1px solid ${BB.border}`, borderRadius: 8,
                  padding: "10px 14px", color: BB.muted, cursor: "pointer",
                  display: "flex", alignItems: "center",
                }}
              ><ArrowLeftFromLine size={22} /></button>
              <div>
                <div style={{ fontSize: 18, fontWeight: 800, color: BB.muted, letterSpacing: "2px", textTransform: "uppercase" }}>
                  {selectedRole}
                </div>
                <div style={{ fontSize: 13, color: BB.mutedDim }}>Enter your credentials</div>
              </div>
            </div>

            {error && (
              <div style={{
                background: "#f9546318", border: "1px solid #f9546340",
                borderRadius: 8, padding: "14px 18px", marginBottom: 20,
                fontSize: 15, color: "#f95463", fontWeight: 600,
              }}>{error}</div>
            )}

            <form onSubmit={handleLogin} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <div>
                <label style={labelStyle}>Username</label>
                <input
                  type="text"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  onPointerDown={() => setActiveInput("username")}
                  onFocus={() => setActiveInput("username")}
                  autoComplete="username"
                  style={{ ...inputStyle(BB), border: `1px solid ${activeInput === "username" ? BB.accent : BB.border}` }}
                />
              </div>
              <div>
                <label style={labelStyle}>Password</label>
                <div style={{ position: "relative" }}>
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    onPointerDown={() => setActiveInput("password")}
                    onFocus={() => setActiveInput("password")}
                    autoComplete="current-password"
                    style={{ ...inputStyle(BB), border: `1px solid ${activeInput === "password" ? BB.accent : BB.border}`, paddingRight: 52 }}
                  />
                  <button
                    type="button"
                    onMouseDown={e => { e.preventDefault(); setShowPassword(v => !v); }}
                    style={{ position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: BB.muted, fontSize: 18, padding: 0 }}
                  >{showPassword ? "🙈" : "👁"}</button>
                </div>
              </div>
              <button
                type="submit"
                disabled={loading}
                style={{
                  marginTop: 8, padding: "18px", border: "none", borderRadius: 12,
                  background: ROLES.find(r => r.id === selectedRole)?.color || "#C8D400",
                  color: "#212121", fontSize: 18, fontWeight: 800,
                  cursor: loading ? "not-allowed" : "pointer",
                  fontFamily: FONT, opacity: loading ? 0.7 : 1,
                }}
              >
                {loading ? "Verifying…" : "Sign In"}
              </button>
            </form>
          </>
        )}
      </div>

      <p style={{ fontSize: 13, color: BB.mutedDim, marginTop: 24, letterSpacing: "0.5px" }}>
        Blackbox Auto-Stop Software v1.0
      </p>

      {/* ── Slide-up keyboard ── */}
      <div style={{
        position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 9999,
        background: BB.surface === "#1C1C1C" ? "#1E1E1E" : "#D1D5DB",
        borderTop: `1px solid ${BB.border}`,
        boxShadow: "0 -4px 24px rgba(0,0,0,0.35)",
        transform: activeInput ? "translateY(0)" : "translateY(100%)",
        transition: "transform .25s cubic-bezier(.32,1,.32,1)",
      }}>
        <OnScreenKeyboard
          onKey={handleKey}
          caps={caps}
          onCaps={() => setCaps(v => !v)}
          BB={BB}
        />
      </div>
    </div>
  );
}

const labelStyle = {
  display: "block", fontSize: 14, fontWeight: 700,
  letterSpacing: "1.5px", textTransform: "uppercase",
  marginBottom: 8, fontFamily: FONT, color: "#999",
};

const inputStyle = (BB) => ({
  width: "100%", boxSizing: "border-box",
  background: BB.surfaceAlt, border: `1px solid ${BB.border}`,
  borderRadius: 10, padding: "16px 18px",
  color: BB.text, fontSize: 18, fontFamily: FONT, outline: "none",
});
