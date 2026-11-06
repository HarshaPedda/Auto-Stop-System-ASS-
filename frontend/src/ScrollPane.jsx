import { useRef, useCallback, useState, useEffect, useLayoutEffect } from "react";

// ── Hook: returns { ref (callback), overflowing, scrollUp, scrollDown } ──
export function useScrollPane() {
  const [overflowing, setOverflowing] = useState(false);
  const elRef = useRef(null);
  const obsRef = useRef(null);

  const recheck = useCallback(() => {
    const el = elRef.current;
    if (!el) return;
    const next = el.scrollHeight > el.clientHeight + 1;
    setOverflowing(prev => (prev === next ? prev : next));
  }, []);

  const setEl = useCallback((el) => {
    if (obsRef.current) {
      obsRef.current.ro?.disconnect();
      obsRef.current.mo?.disconnect();
      obsRef.current = null;
    }
    elRef.current = el;
    if (!el) {
      setOverflowing(false);
      return;
    }
    recheck();
    const ro = new ResizeObserver(recheck);
    ro.observe(el);
    const mo = new MutationObserver(recheck);
    mo.observe(el, { childList: true, subtree: true, characterData: true });
    obsRef.current = { ro, mo };
  }, [recheck]);

  useEffect(() => () => {
    if (obsRef.current) {
      obsRef.current.ro?.disconnect();
      obsRef.current.mo?.disconnect();
    }
  }, []);

  const scrollUp = useCallback(() => {
    const el = elRef.current;
    if (!el) return;
    el.scrollBy({ top: -(el.clientHeight || 200) * 0.85, behavior: "smooth" });
  }, []);

  const scrollDown = useCallback(() => {
    const el = elRef.current;
    if (!el) return;
    el.scrollBy({ top: (el.clientHeight || 200) * 0.85, behavior: "smooth" });
  }, []);

  return { ref: setEl, overflowing, scrollUp, scrollDown, recheck };
}

// ── ScrollPane wrapper. Pass `ctrl={useScrollPane()}` to share, or omit ──
export default function ScrollPane({
  children,
  style,
  innerStyle,
  T,
  FONT,
  ctrl,
  showButtons = true,
  btnSize = 48,
  btnTopOffset = 10,
  btnDownOffset = 80,
}) {
  const internal = useScrollPane();
  const c = ctrl || internal;

  // Re-probe overflow after every render so newly-loaded content
  // (e.g., CSV tiles expanding, inventory items appended) flips the buttons on.
  useLayoutEffect(() => { c.recheck?.(); });

  const surf2  = T?.surf2  ?? "#2A2A2A";
  const text   = T?.text   ?? "#F0F0F0";
  const border = T?.border ?? "#3A3A3A";
  const family = FONT || "'JetBrains Mono', 'SF Mono', 'Fira Code', monospace";

  const floatBtn = {
    position: "absolute",
    right: 10,
    width: btnSize,
    height: btnSize,
    fontSize: 22,
    fontWeight: 900,
    background: surf2,
    color: text,
    border: `1px solid ${border}`,
    borderRadius: 10,
    cursor: "pointer",
    fontFamily: family,
    userSelect: "none",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    lineHeight: 1,
    boxShadow: "0 4px 14px rgba(0,0,0,0.45)",
    zIndex: 5,
    opacity: 0.92,
  };

  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minHeight: 0,
        ...style,
      }}
    >
      <div
        ref={c.ref}
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          scrollbarWidth: "none",
          msOverflowStyle: "none",
          ...innerStyle,
        }}
      >
        {children}
      </div>
      {showButtons && c.overflowing && (
        <>
          <button
            type="button"
            onClick={c.scrollUp}
            style={{ ...floatBtn, top: btnTopOffset }}
            aria-label="Scroll up"
          >▲</button>
          <button
            type="button"
            onClick={c.scrollDown}
            style={{ ...floatBtn, bottom: btnDownOffset }}
            aria-label="Scroll down"
          >▼</button>
        </>
      )}
    </div>
  );
}

// ── Inline button(s). Hides itself when content doesn't overflow. ──

function btnBaseStyle({ T, FONT, size }) {
  const surf2  = T?.surf2  ?? "#2A2A2A";
  const text   = T?.text   ?? "#F0F0F0";
  const border = T?.border ?? "#3A3A3A";
  const family = FONT || "'JetBrains Mono', 'SF Mono', 'Fira Code', monospace";
  return {
    width: size,
    height: size,
    fontSize: 18,
    fontWeight: 900,
    background: surf2,
    color: text,
    border: `1px solid ${border}`,
    borderRadius: 8,
    cursor: "pointer",
    fontFamily: family,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    lineHeight: 1,
    userSelect: "none",
  };
}

export function ScrollBtn({ ctrl, dir, T, FONT, size = 36, style }) {
  if (!ctrl?.overflowing) return null;
  const handler = dir === "up" ? ctrl.scrollUp : ctrl.scrollDown;
  return (
    <button
      type="button"
      onClick={handler}
      style={{ ...btnBaseStyle({ T, FONT, size }), ...style }}
      aria-label={dir === "up" ? "Scroll up" : "Scroll down"}
    >
      {dir === "up" ? "▲" : "▼"}
    </button>
  );
}

export function ScrollBtns({ ctrl, T, FONT, size = 36, gap = 6, style }) {
  if (!ctrl?.overflowing) return null;
  return (
    <div style={{ display: "inline-flex", gap, alignItems: "center", ...style }}>
      <ScrollBtn ctrl={ctrl} dir="up"   T={T} FONT={FONT} size={size} />
      <ScrollBtn ctrl={ctrl} dir="down" T={T} FONT={FONT} size={size} />
    </div>
  );
}
