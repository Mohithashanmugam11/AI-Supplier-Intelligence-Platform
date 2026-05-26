import { useState, useEffect, useRef, useCallback } from "react";
import PastProjectsApp from "../past/PastProjectsApp.jsx";

// ── CONFIG ────────────────────────────────────────────────
const API = (import.meta.env.VITE_API_BASE || "http://localhost:8000").replace(/\/+$/, "");

// ── TOKENS ───────────────────────────────────────────────
const C = {
  ink: "#1B2D4F", inkSoft: "#2D4567", inkMuted: "#6B7F96",
  rule: "#C8D2E0", ruleLight: "#DDE3EE",
  surface: "#E8EDF5", white: "#FAFCFF", bg: "#E4E8F0",
  copper: "#B8920A", copperPale: "#F5F0DC", copperBright: "#D4AA12",
  pass: "#1E5E3A", passBg: "#E6F4EC",
  warn: "#7A2E0E", warnBg: "#FDF0EB",
  blue: "#1A3D5C", blueMid: "#4A7BAF", bluePale: "#E8EFF8",
};
const mono    = "'IBM Plex Mono', monospace";
const display = "'Syne', sans-serif";
const sans    = "'DM Sans', sans-serif";
const brand   = "'Cormorant Garamond', serif";
const SESSION_KEY = "trustbridge_supplier_session";

function getStoredSession() {
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw);
    if (stored?.zoho_account_id && stored?.company_name) {
      return stored;
    }
  } catch (e) {}
  return null;
}

// ── PRIMITIVES ────────────────────────────────────────────
function useAnimVal(target, delay = 0) {
  const [v, setV] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setV(target), delay + 120);
    return () => clearTimeout(t);
  }, [target]);
  return v;
}

function scoreColor(v) {
  return v >= 88 ? C.copper : v >= 72 ? C.blueMid : C.inkMuted;
}

function toSafeString(v, fallback = "") {
  if (v === null || v === undefined) return fallback;
  return String(v);
}

function toSafeQty(v, fallback = 1) {
  if (typeof v === "number" && Number.isFinite(v)) {
    return Math.max(1, Math.round(v));
  }
  const text = toSafeString(v, "").trim();
  const m = text.match(/\d+/);
  const n = m ? parseInt(m[0], 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function normalizePartsForSubmit(parts) {
  return (parts || []).map((p, i) => ({
    id: toSafeString(p?.id, `P-00${i + 1}`),
    description: toSafeString(p?.description, ""),
    material: toSafeString(p?.material, ""),
    process: toSafeString(p?.process, ""),
    tolerance: toSafeString(p?.tolerance, ""),
    qty: toSafeQty(p?.qty, 1),
    image_b64: p?.image_b64 || null,
  }));
}

function isImageLikeName(value) {
  const v = String(value || "").toLowerCase().trim();
  return /\.(jpg|jpeg|png|webp|bmp|gif|avif)$/.test(v);
}

function isLikelyPartImageJob(job) {
  if (!job?.image_url) return false;
  const name = String(job?.project_name || "").toLowerCase().trim();
  if (name === "part image") return true;
  if (isImageLikeName(job?.job_id)) return true;
  const hasRichMeta =
    Boolean(job?.project_link) ||
    Boolean(job?.material) ||
    Boolean(job?.process_primary) ||
    Boolean(job?.part_family) ||
    Boolean(job?.customer_industry) ||
    Boolean(job?.features) ||
    Boolean(job?.outcome);
  return !hasRichMeta;
}

function Ring({ value, size = 64, delay = 0 }) {
  const v   = useAnimVal(value ?? 0, delay);
  const r   = size / 2 - 5;
  const circ = 2 * Math.PI * r;
  const col  = scoreColor(value ?? 0);
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={C.ruleLight} strokeWidth={4.5} />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={col} strokeWidth={4.5}
          strokeDasharray={circ} strokeDashoffset={circ - (v / 100) * circ}
          strokeLinecap="round" style={{ transition: "stroke-dashoffset 0.7s cubic-bezier(.4,0,.2,1)" }} />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontFamily: mono, fontSize: size > 52 ? 17 : 12, fontWeight: 500, color: col, lineHeight: 1 }}>
          {value ?? "—"}
        </span>
      </div>
    </div>
  );
}

function Bar({ value, delay = 0, h = 4 }) {
  const v = useAnimVal(value ?? 0, delay);
  return (
    <div style={{ height: h, background: C.ruleLight, borderRadius: 2, overflow: "hidden" }}>
      <div style={{ height: "100%", width: `${v}%`, background: scoreColor(value ?? 0), borderRadius: 2, transition: "width 0.6s cubic-bezier(.4,0,.2,1)" }} />
    </div>
  );
}

function Chip({ type, label }) {
  const s = type === "pass"
    ? { bg: C.passBg, color: C.pass, border: "rgba(46,107,79,0.2)" }
    : { bg: C.warnBg, color: C.warn, border: "rgba(184,115,51,0.3)" };
  return (
    <span style={{ fontFamily: mono, fontSize: 9, padding: "2px 7px", borderRadius: 2, background: s.bg, color: s.color, border: `1px solid ${s.border}`, letterSpacing: "0.04em", textTransform: "uppercase" }}>
      {label}
    </span>
  );
}

function Tag({ children, accent }) {
  return (
    <span style={{ fontFamily: mono, fontSize: 9, padding: "2px 7px", borderRadius: 2, background: accent ? C.copperPale : C.surface, color: accent ? C.copper : C.inkSoft, border: `1px solid ${accent ? "rgba(184,115,51,0.25)" : C.rule}`, letterSpacing: "0.04em" }}>
      {children}
    </span>
  );
}

function Card({ children, style: s }) {
  return (
    <div style={{ background: C.white, border: `1px solid ${C.rule}`, borderRadius: 8, overflow: "hidden", boxShadow: "0 1px 4px rgba(20,28,36,0.08), 0 4px 14px rgba(20,28,36,0.05)", ...s }}>
      {children}
    </div>
  );
}

function CardHead({ title, right }) {
  return (
    <div style={{ padding: "11px 18px", background: C.surface, borderBottom: `1px solid ${C.rule}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <span style={{ fontFamily: display, fontSize: 13, fontWeight: 700 }}>{title}</span>
      {right && <span style={{ fontFamily: mono, fontSize: 9, color: C.inkMuted, textTransform: "uppercase", letterSpacing: "0.06em" }}>{right}</span>}
    </div>
  );
}

const Btn = ({ children, variant = "outline", onClick, style: s, disabled }) => {
  const base = { fontFamily: display, fontSize: 12, fontWeight: 600, padding: "7px 15px", borderRadius: 4, cursor: disabled ? "not-allowed" : "pointer", letterSpacing: "0.01em", transition: "filter 0.12s", border: "none", opacity: disabled ? 0.5 : 1 };
  const v = {
    primary: { background: C.ink, color: C.white },
    accent:  { background: C.copper, color: "#fff" },
    outline: { background: "transparent", color: C.ink, border: `1px solid ${C.rule}` },
    ghost:   { background: "transparent", color: C.inkMuted, border: `1px solid ${C.ruleLight}`, fontSize: 11, padding: "5px 11px" },
    green:   { background: C.pass, color: "#fff" },
  };
  return (
    <button style={{ ...base, ...v[variant], ...s }} disabled={disabled}
      onMouseEnter={e => { if (!disabled) e.currentTarget.style.filter = "brightness(0.92)"; }}
      onMouseLeave={e => { e.currentTarget.style.filter = ""; }}
      onClick={onClick}>
      {children}
    </button>
  );
};

function BrandLockup({ dark = false, compact = false }) {
  return (
    <img
      src="/public.png"
      alt="Trustbridge"
      style={{
        display: "block",
        height: compact ? 34 : 56,
        width: "auto",
        objectFit: "contain",
        filter: "none",
      }}
    />
  );
}

function StatusBadge({ status }) {
  const map = {
    new: { label: "New", color: C.blueMid, bg: C.bluePale, border: "rgba(62,95,178,0.25)" },
    in_assessment: { label: "In Assessment", color: C.copper, bg: C.copperPale, border: "rgba(184,115,51,0.28)" },
    quote_submitted: { label: "Quote Sent", color: C.pass, bg: C.passBg, border: "rgba(46,107,79,0.25)" },
    scored: { label: "Scored", color: C.pass, bg: C.passBg, border: "rgba(46,107,79,0.25)" },
    no_bid: { label: "No-bid", color: C.inkMuted, bg: C.surface, border: C.rule },
  };
  const v = map[status] || map.new;
  return (
    <span style={{ fontFamily: mono, fontSize: 8, padding: "2px 7px", borderRadius: 3, background: v.bg, color: v.color, border: `1px solid ${v.border}`, textTransform: "uppercase", letterSpacing: "0.05em" }}>
      {v.label}
    </span>
  );
}

function NoBidModal({ row, onClose, onSubmit }) {
  const [reason, setReason] = useState("");
  const [buyerEmail, setBuyerEmail] = useState("");
  const [note, setNote] = useState("");
  const [savingPath, setSavingPath] = useState("");
  if (!row) return null;

  const submitPath = async (path) => {
    setSavingPath(path);
    try {
      await onSubmit({ path, reason, buyerEmail, note });
    } finally {
      setSavingPath("");
    }
  };
  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(20,28,36,0.55)", zIndex: 900, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ width: "100%", maxWidth: 520, background: C.white, border: `1px solid ${C.rule}`, borderRadius: 10, overflow: "hidden", boxShadow: "0 20px 50px rgba(20,28,36,0.28)" }}>
        <div style={{ background: C.ink, borderBottom: `2px solid ${C.copper}`, padding: "14px 18px", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontFamily: mono, fontSize: 9, letterSpacing: "0.08em", textTransform: "uppercase", color: "rgba(255,255,255,0.45)", marginBottom: 4 }}>No-Bid Decision</div>
            <div style={{ fontFamily: display, fontSize: 16, fontWeight: 700, color: C.white }}>Mark {row.view_id} as No-bid</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.35)", cursor: "pointer", fontSize: 17 }}>✕</button>
        </div>
        <div style={{ padding: "16px 18px" }}>
          <div style={{ fontSize: 12.5, color: C.inkSoft, lineHeight: 1.6, marginBottom: 12 }}>
            Before marking this no-bid, you can route this to BRFP via referral or master engine.
          </div>
          <div style={{ padding: "10px 12px", background: C.surface, border: `1px solid ${C.ruleLight}`, borderRadius: 6, marginBottom: 12 }}>
            <div style={{ fontFamily: mono, fontSize: 9, color: C.inkMuted, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 5 }}>RFP</div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{row.view_id} · {row.buyer}</div>
            <div style={{ fontSize: 12, color: C.inkMuted, marginTop: 2 }}>{row.project}</div>
          </div>
          <label style={{ display: "block", fontFamily: mono, fontSize: 9, color: C.inkMuted, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>No-bid Reason (internal)</label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. process mismatch, capacity full this month, material risk..."
            rows={3}
            style={{ width: "100%", padding: "10px 12px", border: `1px solid ${C.rule}`, borderRadius: 6, fontFamily: sans, fontSize: 13, color: C.ink, resize: "vertical", background: C.white, marginBottom: 14 }}
          />
          <label style={{ display: "block", fontFamily: mono, fontSize: 9, color: C.inkMuted, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>Buyer Contact Email (optional)</label>
          <input
            value={buyerEmail}
            onChange={(e) => setBuyerEmail(e.target.value)}
            placeholder="buyer@company.com"
            style={{ width: "100%", padding: "9px 11px", border: `1px solid ${C.rule}`, borderRadius: 6, fontFamily: sans, fontSize: 13, marginBottom: 10 }}
          />
          <label style={{ display: "block", fontFamily: mono, fontSize: 9, color: C.inkMuted, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>Internal Note (optional)</label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Any extra context for BRFP routing..."
            rows={2}
            style={{ width: "100%", padding: "10px 12px", border: `1px solid ${C.rule}`, borderRadius: 6, fontFamily: sans, fontSize: 13, color: C.ink, resize: "vertical", background: C.white, marginBottom: 14 }}
          />
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Btn variant="outline" onClick={onClose}>Cancel</Btn>
            <Btn variant="ghost" disabled={!!savingPath} onClick={() => submitPath("decline_only")}>{savingPath === "decline_only" ? "Saving…" : "No-bid Only"}</Btn>
            <Btn variant="outline" disabled={!!savingPath} onClick={() => submitPath("master_rfp_engine")}>{savingPath === "master_rfp_engine" ? "Submitting…" : "Master Engine →"}</Btn>
            <Btn variant="accent" disabled={!!savingPath} onClick={() => submitPath("referral_program")}>{savingPath === "referral_program" ? "Submitting…" : "Referral →"}</Btn>
          </div>
        </div>
      </div>
    </div>
  );
}

function DashboardStatStrip({ rows }) {
  const active = rows.filter((r) => r.status !== "no_bid").length;
  const newCount = rows.filter((r) => r.status === "new").length;
  const scores = rows.map((r) => Number(r.score || 0)).filter((v) => Number.isFinite(v));
  const avgScore = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
  const urgent = rows.filter((r) => {
    const daysLeft = Math.round((new Date(r.due) - new Date()) / 86400000);
    return daysLeft >= 0 && daysLeft <= 3;
  }).length;
  const stats = [
    { label: "Active RFPs", value: active, sub: `${newCount} new`, tone: "blue" },
    { label: "Avg Match Score", value: avgScore, sub: "across queue", tone: "copper" },
    { label: "Due ≤ 3 days", value: urgent, sub: urgent > 0 ? "Needs attention" : "No urgent deadlines", tone: urgent > 0 ? "warn" : "muted" },
  ];
  const toneMap = {
    blue: { bg: C.bluePale, color: C.blueMid, border: "rgba(62,95,178,0.25)" },
    copper: { bg: C.copperPale, color: C.copper, border: "rgba(184,115,51,0.25)" },
    warn: { bg: C.warnBg, color: C.warn, border: "rgba(139,69,19,0.25)" },
    muted: { bg: C.surface, color: C.inkMuted, border: C.rule },
  };
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10, marginBottom: 16 }}>
      {stats.map((s) => {
        const t = toneMap[s.tone] || toneMap.muted;
        return (
          <div key={s.label} style={{ background: C.white, border: `1px solid ${C.rule}`, borderRadius: 8, padding: "12px 13px", display: "flex", gap: 10, alignItems: "center" }}>
            <div style={{ minWidth: 38, height: 38, borderRadius: 6, background: t.bg, border: `1px solid ${t.border}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ fontFamily: mono, fontSize: 15, fontWeight: 700, color: t.color }}>{s.value}</span>
            </div>
            <div>
              <div style={{ fontFamily: display, fontSize: 12.5, fontWeight: 700 }}>{s.label}</div>
              <div style={{ fontFamily: mono, fontSize: 9, color: C.inkMuted, marginTop: 2 }}>{s.sub}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AssessmentPreviewDrawer({ row, onClose, onOpenAssessment, onNoBid }) {
  if (!row) return null;
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(20,28,36,0.5)", zIndex: 880, display: "flex", justifyContent: "flex-end" }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 440, maxWidth: "100%", height: "100vh", background: C.white, boxShadow: "-8px 0 34px rgba(20,28,36,0.25)", display: "flex", flexDirection: "column" }}>
        <div style={{ background: C.ink, borderBottom: `2px solid ${C.copper}`, padding: "14px 16px", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontFamily: mono, fontSize: 9, textTransform: "uppercase", letterSpacing: "0.07em", color: "rgba(255,255,255,0.45)", marginBottom: 4 }}>Assessment Preview</div>
            <div style={{ fontFamily: display, fontSize: 16, fontWeight: 700, color: C.white }}>{row.view_id}</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.35)", cursor: "pointer", fontSize: 17 }}>✕</button>
        </div>
        <div style={{ padding: 16, overflowY: "auto" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", background: C.surface, border: `1px solid ${C.rule}`, borderRadius: 6, marginBottom: 12 }}>
            <Ring value={row.score || 0} size={52} />
            <div>
              <div style={{ fontFamily: display, fontSize: 14, fontWeight: 700 }}>{row.buyer}</div>
              <div style={{ fontSize: 12, color: C.inkMuted, marginTop: 2, lineHeight: 1.5 }}>{row.project || "RFP Assessment"}</div>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
            {[
              ["Status", row.status || "new"],
              ["Has Snapshot", row.has_cached ? "Yes" : "No"],
              ["Received", row.received || "—"],
              ["Due", row.due || "—"],
            ].map(([k, v]) => (
              <div key={k} style={{ padding: "8px 10px", background: C.white, border: `1px solid ${C.rule}`, borderRadius: 6 }}>
                <div style={{ fontFamily: mono, fontSize: 8.5, textTransform: "uppercase", letterSpacing: "0.06em", color: C.inkMuted, marginBottom: 4 }}>{k}</div>
                <div style={{ fontSize: 12.5, color: C.ink, fontWeight: 600 }}>{v}</div>
              </div>
            ))}
          </div>
          <div style={{ padding: "10px 12px", background: C.copperPale, borderLeft: `3px solid ${C.copper}`, borderRadius: 5, fontSize: 12, color: C.inkSoft, lineHeight: 1.55 }}>
            {row.has_cached
              ? "This record has a saved CRM snapshot. Open to view the previous assessment directly."
              : "No saved snapshot yet. Opening will start a fresh assessment flow."}
          </div>
        </div>
        <div style={{ padding: 14, borderTop: `1px solid ${C.ruleLight}`, display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Btn variant="ghost" onClick={onNoBid} disabled={row.status === "no_bid"}>Mark No-bid</Btn>
          <Btn variant={row.has_cached ? "accent" : "outline"} onClick={onOpenAssessment}>
            {row.has_cached ? "Open Previous Assessment →" : "Start Assessment →"}
          </Btn>
        </div>
      </div>
    </div>
  );
}

function DashboardScreen({ session, onOpenAssessment, onOpenIngestion, onLogout }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [corpusHealth, setCorpusHealth] = useState({ score: 0, processes: [], total_jobs: 0, top_gap: "" });
  const [noBidRow, setNoBidRow] = useState(null);
  const [previewRow, setPreviewRow] = useState(null);

  const loadRecent = useCallback(async () => {
    try {
      setError("");
      const supplierId = encodeURIComponent(session?.zoho_account_id || "");
      const supplierEmail = encodeURIComponent(session?.email || "");
      const assessRes = await fetch(`${API}/api/assessment/recent?supplier_id=${supplierId}&supplier_email=${supplierEmail}&limit=30&crm_only=true`);
      const assessData = await assessRes.json().catch(() => ({}));
      if (!assessRes.ok) throw new Error(assessData?.detail || "Failed to load CRM assessments");
      const rows = (assessData?.items || []).sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
      setItems(rows);

      const supplierName = encodeURIComponent(session?.company_name || "");
      const healthRes = await fetch(`${API}/api/assessment/corpus-health?supplier_id=${supplierId}&supplier_name=${supplierName}`);
      const healthData = await healthRes.json().catch(() => ({}));
      if (healthRes.ok && healthData) {
        setCorpusHealth({
          score: Number(healthData.score || 0),
          processes: Array.isArray(healthData.processes) ? healthData.processes : [],
          total_jobs: Number(healthData.total_jobs || 0),
          top_gap: healthData.top_gap || "",
        });
      }
    } catch (e) {
      setError(e.message || "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }, [session?.zoho_account_id, session?.email, session?.company_name]);

  useEffect(() => {
    loadRecent();
    const timer = setInterval(loadRecent, 20000);
    return () => clearInterval(timer);
  }, [loadRecent]);

  const queueRows = items.map((item) => {
    const created = new Date(item.created_at || Date.now());
    const due = item.due ? new Date(item.due) : new Date(created.getTime() + 7 * 86400000);
    return {
      ...item,
      view_id: item.rfp_id,
      buyer: item.buyer || "Unknown Buyer",
      project: item.project || "RFP",
      due: due.toISOString().slice(0, 10),
      received: created.toISOString().slice(0, 10),
      score: Number(item.overall_score ?? 0),
      status: item.status || "new",
      has_cached: !!item.has_cached,
    };
  });

  const deadlines = [...queueRows].sort((a, b) => new Date(a.due) - new Date(b.due)).slice(0, 6);
  const totalHistoryJobs = Number(corpusHealth.total_jobs || 0);
  const rawProcessRows = (corpusHealth.processes || []).slice(0, 4);
  const corpusProcesses = rawProcessRows.map((p, idx) => {
    const count = Number(p.count || 0);
    // Use absolute supplier-job coverage for calmer, less misleading bars.
    const pctByJobs = totalHistoryJobs > 0 ? Math.min(100, (count / totalHistoryJobs) * 100) : 0;
    return {
      label: p.label,
      count,
      pct: Math.round(pctByJobs * 10) / 10,
      color: idx === 0 ? C.copper : idx === 1 ? C.blueMid : idx === 2 ? C.warn : C.inkMuted,
    };
  });
  const processCountSet = new Set(corpusProcesses.map((p) => p.count));
  const hasSingleTopGap = processCountSet.size > 1 && !!corpusHealth.top_gap;

  return (
    <div style={{ fontFamily: sans, fontSize: 14, color: C.ink, minHeight: "100vh", background: C.bg }}>
      <div style={{ background: C.ink, borderBottom: `2px solid ${C.copper}`, padding: "0 28px", display: "flex", alignItems: "stretch", position: "sticky", top: 0, zIndex: 200 }}>
        <div style={{ display: "flex", alignItems: "center", padding: "10px 24px 10px 0", borderRight: "1px solid rgba(255,255,255,0.1)", marginRight: 16 }}>
          <BrandLockup dark compact />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1 }}>
          <span style={{ fontFamily: mono, fontSize: 10, letterSpacing: "0.06em", textTransform: "uppercase", color: "rgba(255,255,255,0.35)" }}>Supplier Portal</span>
          <span style={{ color: "rgba(255,255,255,0.2)", fontSize: 12 }}>/</span>
          <span style={{ fontFamily: mono, fontSize: 10, letterSpacing: "0.06em", textTransform: "uppercase", color: "rgba(255,255,255,0.35)" }}>Dashboard</span>
          <span style={{ fontFamily: mono, fontSize: 10, letterSpacing: "0.06em", color: C.copper }}>{session.company_name}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 0" }}>
          <Btn variant="outline" onClick={onOpenIngestion}>Knowledge Base</Btn>
          <Btn variant="ghost" onClick={onLogout}>Sign out</Btn>
        </div>
      </div>

      <div style={{ maxWidth: 1240, margin: "0 auto", padding: "24px 28px", display: "grid", gridTemplateColumns: "1fr 320px", gap: 20, alignItems: "start" }}>
        <div>
          <div style={{ background: C.white, border: `1px solid ${C.rule}`, borderRadius: 8, padding: "14px 16px", marginBottom: 16 }}>
            <div style={{ fontFamily: mono, fontSize: 9, letterSpacing: "0.08em", textTransform: "uppercase", color: C.copper, marginBottom: 4 }}>
              Supplier Portal · Dashboard
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
              <div>
                <h2 style={{ fontFamily: display, fontSize: 22, fontWeight: 700, lineHeight: 1.2, marginBottom: 4 }}>
                  Good morning, {session.company_name}
                </h2>
                <p style={{ fontSize: 12.5, color: C.inkMuted, lineHeight: 1.6 }}>
                  {queueRows.filter((r) => r.status === "new").length} new RFPs are waiting for review.
                </p>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <div style={{ border: `2px dashed ${C.rule}`, borderRadius: 8, padding: "10px 12px", background: C.white, minWidth: 370 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 16, color: C.inkMuted }}>↑</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontFamily: display, fontSize: 13, fontWeight: 700, marginBottom: 2 }}>Upload Inbound RFP</div>
                      <div style={{ fontSize: 11.5, color: C.inkMuted, lineHeight: 1.5 }}>
                        Drag & drop PDF, STEP, or ZIP — or browse. Plugin auto-ingest available.
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                      <Btn variant="ghost" onClick={() => onOpenAssessment(null)}>Browse</Btn>
                      <Btn variant="accent">Connect Plugin</Btn>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <DashboardStatStrip rows={queueRows} />

          <Card>
            <CardHead title="RFP Queue" right={`${queueRows.length} in queue`} />
            <div style={{ padding: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ fontFamily: display, fontSize: 16, fontWeight: 700 }}>Inbound RFP Queue</div>
                  <span style={{ fontFamily: mono, fontSize: 9, padding: "2px 8px", borderRadius: 2, background: C.bluePale, color: C.blueMid, border: "1px solid rgba(62,95,178,0.2)", textTransform: "uppercase" }}>
                    {queueRows.filter((r) => r.status !== "no_bid").length} active
                  </span>
                </div>
                <div style={{ fontFamily: mono, fontSize: 9, color: C.inkMuted }}>Click row to open assessment</div>
              </div>
            {loading ? <div style={{ color: C.inkMuted, fontSize: 12, padding: 8 }}>Loading queue...</div> : null}
            {error ? <div style={{ color: C.warn, fontSize: 12, padding: 8 }}>{error}</div> : null}
            {!loading && !error && queueRows.length === 0 ? <div style={{ color: C.inkMuted, fontSize: 12, padding: 8 }}>No recent RFPs yet.</div> : null}
            {!loading && !error && queueRows.map((row) => (
              <div key={row.view_id} onClick={() => setPreviewRow(row)} style={{ background: C.white, border: `1px solid ${C.rule}`, borderRadius: 8, padding: "13px 16px", marginBottom: 9, cursor: "pointer" }}>
                <div style={{ display: "flex", gap: 13, alignItems: "flex-start" }}>
                  <Ring value={row.score} size={44} />
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
                      <span style={{ fontFamily: mono, fontSize: 10, color: C.copper, fontWeight: 600 }}>{row.view_id}</span>
                      <span style={{ fontFamily: display, fontSize: 14, fontWeight: 700 }}>{row.buyer}</span>
                      <StatusBadge status={row.status} />
                    </div>
                    <div style={{ fontSize: 12.5, color: C.inkMuted, lineHeight: 1.55 }}>{row.project}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontFamily: mono, fontSize: 9, color: C.inkMuted, marginBottom: 4 }}>Rcvd {row.received.slice(5).replace("-", "/")}</div>
                    <div style={{ display: "flex", gap: 7, justifyContent: "flex-end" }}>
                      <Btn variant="ghost" onClick={(e) => { e.stopPropagation(); setNoBidRow(row); }} disabled={row.status === "no_bid"}>Mark No-bid</Btn>
                      <Btn variant={row.has_cached ? "accent" : "outline"} onClick={(e) => { e.stopPropagation(); setPreviewRow(row); }} disabled={row.status === "no_bid"}>
                        {row.status === "no_bid" ? "No-bid" : "Preview →"}
                      </Btn>
                    </div>
                  </div>
                </div>
              </div>
            ))}
            </div>
          </Card>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Card>
            <CardHead title="Upcoming Deadlines" />
            {deadlines.length === 0 ? (
              <div style={{ padding: "16px", fontSize: 12, color: C.inkMuted }}>No deadlines available.</div>
            ) : deadlines.map((d, i) => {
              const daysLeft = Math.round((new Date(d.due) - new Date()) / 86400000);
              return (
                <div key={d.view_id} style={{ padding: "10px 16px", borderBottom: i < deadlines.length - 1 ? `1px solid ${C.ruleLight}` : "none", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontFamily: mono, fontSize: 10, color: C.copper }}>{d.view_id}</div>
                    <div style={{ fontSize: 12 }}>{d.buyer}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <StatusBadge status={d.status} />
                    <div style={{ fontFamily: mono, fontSize: 9, color: C.inkMuted, marginTop: 3 }}>{daysLeft}d</div>
                  </div>
                </div>
              );
            })}
          </Card>

          <Card>
            <CardHead title="Corpus Health" />
            <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 11px", background: C.surface, border: `1px solid ${C.rule}`, borderRadius: 6 }}>
                <Ring value={corpusHealth.score || 0} size={52} />
                <div>
                  <div style={{ fontFamily: display, fontSize: 15, fontWeight: 700, lineHeight: 1 }}>Corpus Score</div>
                  <div style={{ fontFamily: mono, fontSize: 9, color: C.inkMuted, marginTop: 3 }}>{corpusHealth.total_jobs} historical jobs</div>
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {corpusProcesses.length === 0 && (
                  <div style={{ fontSize: 12, color: C.inkMuted }}>No process coverage found for this supplier yet.</div>
                )}
                {corpusProcesses.map((p) => (
                  <div key={p.label}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                      <span style={{ fontFamily: mono, fontSize: 9, textTransform: "uppercase", color: C.inkSoft }}>{p.label}</span>
                      <span style={{ fontFamily: mono, fontSize: 9, color: C.inkMuted }}>
                        {p.count} job{p.count !== 1 ? "s" : ""} · {p.pct}%
                      </span>
                    </div>
                    <Bar value={p.pct} h={4} />
                  </div>
                ))}
              </div>

              <div style={{ padding: "8px 10px", background: C.copperPale, borderLeft: `3px solid ${C.copper}`, borderRadius: 4, fontSize: 11.5, color: C.inkSoft, lineHeight: 1.55 }}>
                {hasSingleTopGap
                  ? `Top gap: ${corpusHealth.top_gap} coverage remains thin. Ingesting more similar jobs should improve match confidence.`
                  : "Coverage is currently evenly distributed across listed processes. Ingest more past projects to improve corpus depth."}
              </div>

              <Btn variant="outline" style={{ width: "100%", textAlign: "center", fontSize: 11 }}>
                View Full Corpus →
              </Btn>
            </div>
          </Card>
        </div>
      </div>
      {noBidRow && (
        <NoBidModal
          row={noBidRow}
          onClose={() => setNoBidRow(null)}
          onSubmit={async ({ path, reason, buyerEmail, note }) => {
            try {
              const res = await fetch(`${API}/api/assessment/no-bid`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  rfp_id: noBidRow.view_id,
                  supplier_id: session?.zoho_account_id || "",
                  supplier_name: session?.company_name || "",
                  path,
                  reason,
                  buyer_contact_email: buyerEmail,
                  note,
                }),
              });
              const data = await res.json().catch(() => ({}));
              if (!res.ok) throw new Error(data?.detail || "No-bid route failed");
              if (data?.assessment_updated === false) {
                setError(data?.assessment_update_message || "No-bid route created, but assessment status field update failed in CRM.");
              }
              setItems((prev) =>
                prev.map((it) =>
                  it.rfp_id === noBidRow.view_id
                    ? { ...it, status: "no_bid" }
                    : it
                )
              );
              setNoBidRow(null);
              await loadRecent();
            } catch (e) {
              setError(e?.message || "Failed to route no-bid");
            }
          }}
        />
      )}
      {previewRow && (
        <AssessmentPreviewDrawer
          row={previewRow}
          onClose={() => setPreviewRow(null)}
          onNoBid={() => { setNoBidRow(previewRow); setPreviewRow(null); }}
          onOpenAssessment={() => { onOpenAssessment(previewRow); setPreviewRow(null); }}
        />
      )}
    </div>
  );
}

// ── LOGIN SCREENS ─────────────────────────────────────────
function LoginShell({ children }) {
  return (
    <div style={{ minHeight: "100vh", background: C.bg, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500&family=IBM+Plex+Mono:wght@300;400;500&family=Cormorant+Garamond:wght@600;700&display=swap');`}</style>
      <div style={{ marginBottom: 28, textAlign: "center" }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 6 }}>
          <BrandLockup />
        </div>
        <span style={{ fontFamily: mono, fontSize: 10, color: C.inkMuted, textTransform: "uppercase", letterSpacing: "0.1em" }}>Supplier Portal · RFP Assessment</span>
      </div>
      <Card style={{ width: "100%", maxWidth: 420, padding: 32 }}>
        {children}
      </Card>
    </div>
  );
}

function EmailStep({ onSuccess }) {
  const [email, setEmail]   = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState("");

  const handleSubmit = async () => {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !trimmed.includes("@")) {
      setError("Please enter a valid email address.");
      return;
    }
    setLoading(true);
    setError("");

    try {
      // Step 1 — check Zoho for this email
      const lookupRes  = await fetch(`${API}/auth/lookup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed }),
      });
      const lookupData = await lookupRes.json();

      if (!lookupData.ok) {
        setError(lookupData.error || "Email not found. Please contact TrustBridge.");
        setLoading(false);
        return;
      }

      // Step 2 — send OTP
      const otpRes  = await fetch(`${API}/auth/send-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email:           trimmed,
          zoho_account_id: lookupData.zoho_account_id,
          company_name:    lookupData.company_name,
        }),
      });
      const otpData = await otpRes.json();

      if (!otpData.ok) {
        setError(otpData.error || "Failed to send OTP. Try again.");
        setLoading(false);
        return;
      }

      onSuccess({
        email:           trimmed,
        zoho_account_id: lookupData.zoho_account_id,
        company_name:    lookupData.company_name,
        masked_email:    otpData.masked_email || trimmed,
        dev_mode:        otpData.dev_mode || false,
      });

    } catch (e) {
      setError("Server error. Make sure the backend is running.");
    }
    setLoading(false);
  };

  return (
    <>
      <div style={{ fontFamily: display, fontSize: 18, fontWeight: 700, marginBottom: 6 }}>Sign in to your account</div>
      <div style={{ fontSize: 13, color: C.inkSoft, marginBottom: 24, lineHeight: 1.6 }}>
        Enter your registered email to receive a one-time access code.
      </div>
      <label style={{ fontFamily: mono, fontSize: 9, textTransform: "uppercase", letterSpacing: "0.08em", color: C.inkMuted, display: "block", marginBottom: 6 }}>Email Address</label>
      <input
        type="email"
        value={email}
        onChange={e => { setEmail(e.target.value); setError(""); }}
        onKeyDown={e => e.key === "Enter" && handleSubmit()}
        placeholder="you@company.com"
        autoFocus
        style={{ width: "100%", padding: "10px 12px", border: `1.5px solid ${error ? C.warn : C.rule}`, borderRadius: 6, fontFamily: sans, fontSize: 14, color: C.ink, outline: "none", marginBottom: error ? 8 : 20, background: C.white }}
      />
      {error && <div style={{ fontSize: 12, color: C.warn, marginBottom: 16, lineHeight: 1.5 }}>{error}</div>}
      <Btn variant="accent" onClick={handleSubmit} disabled={loading} style={{ width: "100%", textAlign: "center", padding: "10px 0", fontSize: 13 }}>
        {loading ? "Checking…" : "Continue →"}
      </Btn>
    </>
  );
}

function OTPStep({ loginData, onSuccess, onBack }) {
  const [otp, setOtp]         = useState(["", "", "", "", "", ""]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");
  const [resending, setResending] = useState(false);
  const inputRefs = useRef([]);

  const handleChange = (i, val) => {
    if (!/^\d?$/.test(val)) return;
    const next = [...otp];
    next[i] = val;
    setOtp(next);
    setError("");
    if (val && i < 5) inputRefs.current[i + 1]?.focus();
  };

  const handleKeyDown = (i, e) => {
    if (e.key === "Backspace" && !otp[i] && i > 0) {
      inputRefs.current[i - 1]?.focus();
    }
  };

  const handlePaste = (e) => {
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (pasted.length === 6) {
      setOtp(pasted.split(""));
      inputRefs.current[5]?.focus();
    }
  };

  const handleVerify = async () => {
    const code = otp.join("");
    if (code.length < 6) { setError("Please enter the full 6-digit code."); return; }
    setLoading(true);
    setError("");

    try {
      const res  = await fetch(`${API}/auth/verify-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: loginData.email, otp: code }),
      });
      const data = await res.json();

      if (!data.ok) {
        setError(data.error || "Invalid code.");
        setOtp(["", "", "", "", "", ""]);
        inputRefs.current[0]?.focus();
        setLoading(false);
        return;
      }

      onSuccess({
        email:           data.email,
        zoho_account_id: data.zoho_account_id,
        company_name:    data.company_name,
      });

    } catch (e) {
      setError("Server error. Try again.");
    }
    setLoading(false);
  };

  const handleResend = async () => {
    setResending(true);
    setOtp(["", "", "", "", "", ""]);
    setError("");
    try {
      await fetch(`${API}/auth/send-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email:           loginData.email,
          zoho_account_id: loginData.zoho_account_id,
          company_name:    loginData.company_name,
        }),
      });
    } catch (e) {}
    setResending(false);
    inputRefs.current[0]?.focus();
  };

  return (
    <>
      <div style={{ fontFamily: display, fontSize: 18, fontWeight: 700, marginBottom: 6 }}>Check your email</div>
      <div style={{ fontSize: 13, color: C.inkSoft, marginBottom: 4, lineHeight: 1.6 }}>
        We sent a 6-digit code to
      </div>
      <div style={{ fontFamily: mono, fontSize: 13, color: C.ink, fontWeight: 500, marginBottom: loginData.dev_mode ? 8 : 24 }}>
        {loginData.masked_email}
      </div>
      {loginData.dev_mode && (
        <div style={{ padding: "8px 12px", background: C.copperPale, borderLeft: `3px solid ${C.copper}`, borderRadius: 4, fontSize: 12, color: C.inkSoft, marginBottom: 20, lineHeight: 1.5 }}>
          ⚠ Dev mode — OTP printed to terminal (no SMTP configured)
        </div>
      )}

      {/* OTP input boxes */}
      <div style={{ display: "flex", gap: 8, justifyContent: "center", marginBottom: error ? 12 : 24 }} onPaste={handlePaste}>
        {otp.map((digit, i) => (
          <input
            key={i}
            ref={el => inputRefs.current[i] = el}
            type="text"
            inputMode="numeric"
            maxLength={1}
            value={digit}
            onChange={e => handleChange(i, e.target.value)}
            onKeyDown={e => handleKeyDown(i, e)}
            autoFocus={i === 0}
            style={{
              width: 48, height: 56, textAlign: "center",
              fontFamily: mono, fontSize: 22, fontWeight: 500, color: C.ink,
              border: `1.5px solid ${error ? C.warn : digit ? C.copper : C.rule}`,
              borderRadius: 6, background: digit ? C.copperPale : C.white, outline: "none",
              transition: "border-color 0.15s, background 0.15s",
            }}
          />
        ))}
      </div>

      {error && <div style={{ fontSize: 12, color: C.warn, textAlign: "center", marginBottom: 16 }}>{error}</div>}

      <Btn variant="accent" onClick={handleVerify} disabled={loading} style={{ width: "100%", textAlign: "center", padding: "10px 0", fontSize: 13, marginBottom: 14 }}>
        {loading ? "Verifying…" : "Verify Code →"}
      </Btn>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <button onClick={onBack} style={{ background: "none", border: "none", fontFamily: mono, fontSize: 10, color: C.inkMuted, cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.06em" }}>
          ← Change email
        </button>
        <button onClick={handleResend} disabled={resending} style={{ background: "none", border: "none", fontFamily: mono, fontSize: 10, color: C.copper, cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.06em", opacity: resending ? 0.5 : 1 }}>
          {resending ? "Sending…" : "Resend code"}
        </button>
      </div>
    </>
  );
}

// ── JOB CARD ──────────────────────────────────────────────
function JobCard({ job, defaultOpen = false, animDelay = 0 }) {
  const [open, setOpen] = useState(defaultOpen);
  const [vis, setVis]   = useState(false);
  useEffect(() => { const t = setTimeout(() => setVis(true), animDelay); return () => clearTimeout(t); }, []);
  const col = scoreColor(job.similarity);
  const bg  = job.similarity >= 88 ? C.copperPale : job.similarity >= 72 ? C.bluePale : C.surface;
  const brd = job.similarity >= 88 ? "rgba(184,115,51,0.3)" : job.similarity >= 72 ? "rgba(91,127,166,0.3)" : C.rule;
  const title = job.project_name || job.part_family || job.job_id;
  const showSecondaryId = title !== job.job_id;
  const showPartFamilyTag = job.part_family && job.part_family !== title;

  return (
    <div style={{ opacity: vis ? 1 : 0, transform: vis ? "none" : "translateY(8px)", transition: "opacity 0.3s ease, transform 0.3s ease" }}>
      <Card>
        <div onClick={() => setOpen(!open)} style={{ padding: "14px 18px", display: "flex", gap: 14, cursor: "pointer", borderBottom: open ? `1px solid ${C.ruleLight}` : "none", alignItems: "flex-start" }}>
          <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center", padding: "9px 13px", background: bg, border: `1px solid ${brd}`, borderRadius: 6, minWidth: 60 }}>
            <span style={{ fontFamily: mono, fontSize: 22, fontWeight: 500, color: col, lineHeight: 1 }}>{job.similarity}</span>
            <span style={{ fontFamily: mono, fontSize: 8, textTransform: "uppercase", letterSpacing: "0.07em", color: C.inkMuted, marginTop: 3 }}>match</span>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: display, fontSize: 14, fontWeight: 700, marginBottom: 3, color: C.ink }}>{title}</div>
            {showSecondaryId && <div style={{ fontFamily: mono, fontSize: 10, color: C.inkMuted, marginBottom: 6, letterSpacing: "0.03em" }}>{job.job_id}</div>}
            <div style={{ fontFamily: mono, fontSize: 10, color: C.inkMuted, letterSpacing: "0.03em", marginBottom: 7 }}>
              {job.part_family || "—"} &nbsp;·&nbsp; {job.material || "—"} &nbsp;·&nbsp; {job.project_date || "—"} &nbsp;·&nbsp; {job.process_primary || "—"}
            </div>
            {job.features && <div style={{ fontSize: 12, color: C.inkSoft, lineHeight: 1.55, marginBottom: 8 }}>{job.features}</div>}
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
              {showPartFamilyTag && <Tag accent>{job.part_family}</Tag>}
              {job.customer_industry && <Tag>{job.customer_industry}</Tag>}
              {job.finish && <Tag>{job.finish}</Tag>}
              {job.outcome && <Tag>{job.outcome}</Tag>}
            </div>
          </div>
          <span style={{ fontFamily: mono, fontSize: 11, color: C.rule, flexShrink: 0, paddingTop: 3 }}>{open ? "▲" : "▼"}</span>
        </div>
        {open && (job.image_url || job.project_link) && (
          <div style={{ padding: "12px 18px", borderTop: `1px solid ${C.ruleLight}` }}>
            {job.project_link && (
              <div style={{ marginBottom: job.image_url ? 10 : 0 }} onClick={e => e.stopPropagation()}>
                <a
                  href={job.project_link}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontFamily: mono, fontSize: 11, letterSpacing: "0.04em", textTransform: "uppercase", color: C.copper }}
                >
                  Open Project Details
                </a>
              </div>
            )}
            {job.image_url && (
              <img src={`${API}${job.image_url}`} alt="Part"
                style={{ width: "100%", maxHeight: 200, objectFit: "contain", borderRadius: 6, border: `1px solid ${C.rule}`, background: C.surface }}
                onError={e => { e.currentTarget.style.display = "none"; }} />
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

// ── MAIN APP ──────────────────────────────────────────────
function RFPAssessmentApp({ session, onLogout, onBackToDashboard, initialResult = null, initialContext = null }) {
  const [tab, setTab]           = useState("overview");
  const [acked, setAcked]       = useState(false);

  // RFP state
  const [rfpText, setRfpText]   = useState("");
  const [rfpFiles, setRfpFiles] = useState([]);
  const [rfpData, setRfpData]   = useState(null);   // parsed RFP
  const [parts, setParts]       = useState([]);

  // Assessment state
  const [result, setResult]     = useState(initialResult);
  const [loading, setLoading]   = useState("");    // "" | "parsing" | "running"
  const [error, setError]       = useState("");
  const [zohoSync, setZohoSync] = useState(null); // { status: "ok"|"failed"|"unknown", recordId?: string, message?: string }

  useEffect(() => {
    if (initialResult) setTab("fit");
  }, [initialResult]);

  const fileInputRef = useRef(null);

  // ── Derived from result ───────────────────────────────
  const overall     = result?.overall_score ?? null;
  const scoredParts = result?.parts ?? [];
  const flags       = result?.flags ?? [];
  const guidance    = result?.guidance ?? [];
  const matchedJobs = result?.matched_jobs_summary ?? [];

  const fitDims = scoredParts.length > 0 ? [
    { key: "B1", label: "B1 · Requested Fit", sub: "Customer-stated material, process, finish and tolerance vs. your registered capability profile", val: scoredParts[0]?.b1 ?? null },
    { key: "B2", label: "B2 · Manufacturability Fit", sub: "What your process history suggests is the right way to make the part, even if the request is imperfect",  val: scoredParts[0]?.b2 ?? null },
    { key: "C",  label: "C · Historical Similarity", sub: "Similarity against your ingested past project corpus across geometry and project specs",          val: scoredParts[0]?.c  ?? null },
  ] : [];
  const snapshotMode = !!initialResult && !rfpData;

  // ── Parse RFP ─────────────────────────────────────────
  const handleParse = async () => {
    if (!rfpFiles.length && !rfpText.trim()) {
      setError("Upload a file or paste RFP text first.");
      return;
    }
    setLoading("parsing");
    setError("");
    try {
      let data;
      if (rfpFiles.length) {
        const fd = new FormData();
        rfpFiles.forEach(f => fd.append("files", f));
        if (rfpText.trim()) {
          fd.append("text", rfpText.trim());
        }
        const res = await fetch(`${API}/api/rfp/parse-file`, { method: "POST", body: fd });
        data = await res.json();
      } else {
        const res = await fetch(`${API}/api/rfp/parse`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: rfpText }),
        });
        data = await res.json();
      }
      setRfpData(data);
      const parsedParts = (data.parts || []).map((p, i) => ({
        id:          toSafeString(p?.id, `P-00${i+1}`),
        description: toSafeString(p?.description, ""),
        material:    toSafeString(p?.material, ""),
        process:     toSafeString(p?.process, ""),
        tolerance:   toSafeString(p?.tolerance, ""),
        qty:         toSafeQty(p?.qty, 1),
        image_b64:   p?.image_b64 || data.uploaded_images_b64?.[i] || data.extracted_images_b64?.[i] || null,
      }));
      setParts(parsedParts);
    } catch (e) {
      setError("Parse failed. Check server connection.");
    }
    setLoading("");
  };

  // ── Run Assessment ────────────────────────────────────
  const handleRunAssessment = async () => {
    if (!parts.length) { setError("No parts to assess."); return; }
    setLoading("running");
    setError("");
    setResult(null);
    setZohoSync(null);
    try {
      const submitParts = normalizePartsForSubmit(parts);
      // Submit RFP
      const submitRes = await fetch(`${API}/api/rfp/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplier_id:    session.zoho_account_id,
          supplier_name:  session.company_name,
          supplier_certs: [],
          buyer:          rfpData?.buyer || "Unknown",
          location:       rfpData?.location || "",
          project:        rfpData?.project || "RFP Assessment",
          certs_required: rfpData?.certs_required || [],
          delivery:       rfpData?.delivery || "",
          priority_note:  rfpData?.priority_note || "",
          parts: submitParts,
          overall_image_b64: rfpData?.overall_image_b64 || rfpData?.uploaded_images_b64?.[0] || rfpData?.extracted_images_b64?.[0] || null,
          extracted_images_b64: rfpData?.extracted_images_b64 || [],
          extracted_image_sources: rfpData?.extracted_image_sources || [],
        }),
      });
      if (!submitRes.ok) {
        const errData = await submitRes.json().catch(() => ({}));
        const detail = errData?.detail;
        const msg = Array.isArray(detail)
          ? detail.map((d) => `${d?.loc?.join(".") || "field"}: ${d?.msg || "invalid"}`).join(" | ")
          : (detail || "RFP submit failed");
        throw new Error(msg);
      }
      const submitData = await submitRes.json();
      const rfpId = submitData.rfp_id || submitData.id;
      if (!rfpId) throw new Error("RFP submit failed");

      // Run assessment
      const assessRes = await fetch(`${API}/api/assessment/run?rfp_id=${rfpId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplier_id:    session.zoho_account_id,
          supplier_name:  session.company_name,
          supplier_certs: [],
          buyer:          rfpData?.buyer || "Unknown",
          location:       rfpData?.location || "",
          geo_preference: rfpData?.geo_preference || rfpData?.location || "USA",
          company_location: session.company_location || "Texas",
          project:        rfpData?.project || "RFP Assessment",
          certs_required: rfpData?.certs_required || [],
          delivery:       rfpData?.delivery || "",
          priority_note:  rfpData?.priority_note || "",
          parts: submitParts,
          overall_image_b64: rfpData?.overall_image_b64 || rfpData?.uploaded_images_b64?.[0] || rfpData?.extracted_images_b64?.[0] || null,
          extracted_images_b64: rfpData?.extracted_images_b64 || [],
          extracted_image_sources: rfpData?.extracted_image_sources || [],
        }),
      });
      const assessData = await assessRes.json();
      if (assessData.detail) throw new Error(assessData.detail?.message || assessData.detail);
      setResult(assessData);
      const saveHeader = (assessRes.headers.get("x-zoho-save") || "").toLowerCase();
      const recordId = assessRes.headers.get("x-zoho-record-id") || "";
      const saveError = assessRes.headers.get("x-zoho-error") || "";
      if (saveHeader === "ok") {
        setZohoSync({ status: "ok", recordId, message: "Assessment saved to Zoho CRM." });
      } else if (saveHeader === "failed") {
        setZohoSync({ status: "failed", recordId: "", message: saveError || "Zoho CRM save failed (assessment still completed)." });
      } else {
        setZohoSync({ status: "unknown", recordId: "", message: "Assessment completed. Zoho save status not reported." });
      }
      setTab("fit");
    } catch (e) {
      setError(e.message || "Assessment failed.");
    }
    setLoading("");
  };

  const TABS = [
    { id: "overview", label: "RFP Overview" },
    { id: "fit",      label: "Fit Assessment",        disabled: !result },
    { id: "history",  label: `Past Project Matches (${matchedJobs.length})`, disabled: !result },
  ];

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500&family=IBM+Plex+Mono:wght@300;400;500&family=Cormorant+Garamond:wght@600;700&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        body{background:${C.bg};}
        ::-webkit-scrollbar{width:5px;}::-webkit-scrollbar-thumb{background:#C8CDD2;border-radius:3px;}
        @keyframes up{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
        a{color:${C.copper};text-decoration:none;}a:hover{text-decoration:underline;}
      `}</style>

      <div style={{ fontFamily: sans, fontSize: 14, color: C.ink, minHeight: "100vh", background: C.bg }}>

        {/* ── TOPBAR ── */}
        <div style={{ background: C.ink, borderBottom: `2px solid ${C.copper}`, padding: "0 28px", display: "flex", alignItems: "stretch", position: "sticky", top: 0, zIndex: 200 }}>
          <div style={{ display: "flex", alignItems: "center", padding: "10px 24px 10px 0", borderRight: "1px solid rgba(255,255,255,0.1)", marginRight: 16 }}>
            <BrandLockup dark compact />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1 }}>
            {["Supplier Portal", "RFP Assessment"].map((s, i) => (
              <span key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontFamily: mono, fontSize: 10, letterSpacing: "0.06em", textTransform: "uppercase", color: "rgba(255,255,255,0.35)" }}>{s}</span>
                <span style={{ color: "rgba(255,255,255,0.2)", fontSize: 12 }}>/</span>
              </span>
            ))}
            <span style={{ fontFamily: mono, fontSize: 10, letterSpacing: "0.06em", color: C.copper }}>{session.company_name}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 0" }}>
            {onBackToDashboard && <Btn variant="ghost" onClick={onBackToDashboard}>← Dashboard</Btn>}
            {result && <Btn variant="ghost">Export PDF</Btn>}
            {result && (
              <Btn variant={acked ? "green" : "accent"} onClick={() => setAcked(true)}>
                {acked ? "✓ Acknowledged" : "Acknowledge RFP →"}
              </Btn>
            )}
            <Btn variant="ghost" onClick={onLogout}>Sign out</Btn>
          </div>
        </div>

        {/* ── PAGE HEAD + TABS ── */}
        <div style={{ background: C.white, borderBottom: `1px solid ${C.rule}` }}>
          <div style={{ maxWidth: 1240, margin: "0 auto", padding: "20px 28px 0" }}>
            <div style={{ fontFamily: mono, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: C.copper, marginBottom: 5 }}>Supplier Intelligence · {session.company_name}</div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 20, marginBottom: 18 }}>
              <div>
                <h1 style={{ fontFamily: display, fontSize: 26, fontWeight: 700, lineHeight: 1.15, marginBottom: 5 }}>RFP Assessment</h1>
                <p style={{ fontSize: 13.5, color: C.inkSoft, maxWidth: 520, lineHeight: 1.65 }}>
                  Cross-reference an incoming RFP against your past project history to surface relevant precedents — helping you quote with confidence.
                </p>
              </div>
              {result && (
                <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 18px", background: C.surface, border: `1px solid ${C.rule}`, borderRadius: 8, flexShrink: 0, animation: "up 0.4s ease 0.1s both" }}>
                  <Ring value={overall} size={60} delay={300} />
                  <div>
                    <div style={{ fontFamily: display, fontSize: 14, fontWeight: 700, marginBottom: 2 }}>Overall Bid Intelligence</div>
                    <div style={{ fontFamily: mono, fontSize: 9, color: C.inkMuted, letterSpacing: "0.04em", marginBottom: 7 }}>requested fit · manufacturability · historical similarity</div>
                    <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                      {flags.slice(0, 2).map((f, i) => <Chip key={i} type={f.type} label={f.title.slice(0, 28)} />)}
                    </div>
                  </div>
                </div>
              )}
            </div>
            <div style={{ display: "flex" }}>
              {TABS.map(t => (
                <button key={t.id} onClick={() => !t.disabled && setTab(t.id)} style={{
                  fontFamily: mono, fontSize: 11, letterSpacing: "0.05em", textTransform: "uppercase",
                  padding: "10px 18px", background: "none", border: "none",
                  borderBottom: tab === t.id ? `2px solid ${C.copper}` : "2px solid transparent",
                  color: t.disabled ? C.ruleLight : tab === t.id ? C.ink : C.inkMuted,
                  cursor: t.disabled ? "default" : "pointer", marginBottom: -1, transition: "color 0.12s",
                }}>{t.label}</button>
              ))}
            </div>
          </div>
        </div>

        {/* ── CONTENT ── */}
        <div style={{ maxWidth: 1240, margin: "0 auto", padding: "24px 28px" }}>

          {/* ─── OVERVIEW ─── */}
          {tab === "overview" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: 20, animation: "up 0.25s ease" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

                {/* CRM snapshot card (opened from dashboard) */}
                {snapshotMode && (
                  <Card>
                    <CardHead title="Saved CRM Assessment" right={initialContext?.view_id || initialContext?.rfp_id || "Zoho"} />
                    <div style={{ padding: "14px 18px", borderBottom: `1px solid ${C.ruleLight}` }}>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
                        {[
                          ["Buyer", initialContext?.buyer || "—"],
                          ["Project", initialContext?.project || "—"],
                          ["Assessment Date", initialContext?.received || "—"],
                          ["Score", overall ?? "—"],
                        ].map(([lbl, val]) => (
                          <div key={lbl} style={{ padding: "10px 12px", background: C.white, border: `1px solid ${C.rule}`, borderRadius: 6 }}>
                            <div style={{ fontFamily: mono, fontSize: 9, textTransform: "uppercase", letterSpacing: "0.08em", color: C.copper, marginBottom: 6 }}>{lbl}</div>
                            <div style={{ fontSize: 13.5, fontWeight: 600, color: C.ink, lineHeight: 1.45 }}>{val}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div style={{ padding: "12px 18px" }}>
                      <div style={{ fontFamily: mono, fontSize: 9, textTransform: "uppercase", letterSpacing: "0.08em", color: C.inkMuted, marginBottom: 8 }}>Parts from saved assessment</div>
                      {scoredParts.length === 0 ? (
                        <div style={{ fontSize: 12, color: C.inkMuted }}>No part rows available in saved record.</div>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                          {scoredParts.map((p, i) => (
                            <div key={p.part_id || i} style={{ padding: "10px 12px", border: `1px solid ${C.rule}`, borderRadius: 6, background: C.white }}>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                  <span style={{ fontFamily: mono, fontSize: 10, color: C.copper }}>{p.part_id}</span>
                                  <span style={{ fontSize: 12.5, fontWeight: 600 }}>{p.description}</span>
                                </div>
                                <span style={{ fontFamily: mono, fontSize: 13, color: scoreColor(p.composite) }}>{p.composite}</span>
                              </div>
                              <div style={{ fontFamily: mono, fontSize: 9.5, color: C.inkMuted }}>
                                B1: {p.b1 ?? "—"} · B2: {p.b2 ?? "—"} · C: {p.c ?? "—"}
                              </div>
                              {Array.isArray(p.image_candidate_indices) && p.image_candidate_indices.length > 0 && (
                                <div style={{ fontFamily: mono, fontSize: 8.5, color: C.inkMuted, marginTop: 4 }}>
                                  Assigned Extracted Image(s): {p.image_candidate_indices.map((idx) => `#${Number(idx) + 1}`).join(", ")}
                                </div>
                              )}
                              {/* Do not display historical matched-job images as uploaded part images in overview. */}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </Card>
                )}

                {/* Upload card */}
                {!snapshotMode && <Card>
                  <CardHead title="Upload RFP" right="PDF · STEP · DXF · or paste text" />
                  <div style={{ padding: 16 }}>
                    <div
                      onClick={() => fileInputRef.current?.click()}
                      onDragOver={e => e.preventDefault()}
                      onDrop={e => {
                        e.preventDefault();
                        const files = Array.from(e.dataTransfer.files || []);
                        if (files.length) setRfpFiles(files);
                      }}
                      style={{ border: `2px dashed ${rfpFiles.length ? C.copper : C.rule}`, borderRadius: 8, padding: "28px 24px", textAlign: "center", background: rfpFiles.length ? C.copperPale : C.surface, cursor: "pointer", transition: "all 0.15s" }}>
                      <div style={{ fontSize: 26, opacity: 0.4, marginBottom: 8 }}>{rfpFiles.length ? "📄" : "⬆"}</div>
                      <div style={{ fontFamily: display, fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                        {rfpFiles.length ? (rfpFiles.length === 1 ? rfpFiles[0].name : `${rfpFiles.length} files selected`) : "Drop RFP file(s) here"}
                      </div>
                      <div style={{ fontSize: 12, color: C.inkMuted, marginBottom: rfpFiles.length ? 0 : 12 }}>
                        {rfpFiles.length ? `${rfpFiles.length} file${rfpFiles.length > 1 ? "s" : ""} selected` : "PDF, STEP, DXF, images, or CAD files accepted"}
                      </div>
                      {!rfpFiles.length && (
                        <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
                          <Btn variant="outline" onClick={e => { e.stopPropagation(); fileInputRef.current?.click(); }}>Browse Files</Btn>
                        </div>
                      )}
                    </div>
                    <input ref={fileInputRef} type="file" style={{ display: "none" }} multiple
                      accept=".pdf,.txt,.docx,.jpg,.jpeg,.png,.step,.stp,.stl,.obj"
                      onChange={e => {
                        const selected = Array.from(e.target.files || []);
                        if (selected.length) {
                          setRfpFiles(selected);
                        }
                      }} />

                    <div style={{ margin: "12px 0", display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ flex: 1, height: 1, background: C.ruleLight }} />
                      <span style={{ fontFamily: mono, fontSize: 9, color: C.inkMuted, textTransform: "uppercase" }}>or paste text</span>
                      <div style={{ flex: 1, height: 1, background: C.ruleLight }} />
                    </div>

                    <textarea
                      value={rfpText}
                      onChange={e => { setRfpText(e.target.value); }}
                      placeholder="Paste RFP text, part descriptions, or requirements here…"
                      rows={9}
                      style={{ width: "100%", minHeight: 220, padding: "14px 16px", border: `1.5px solid ${C.rule}`, borderRadius: 6, fontFamily: sans, fontSize: 14, lineHeight: 1.55, color: C.ink, resize: "vertical", outline: "none", background: C.white }} />

                    {error && <div style={{ marginTop: 8, fontSize: 12, color: C.warn }}>{error}</div>}

                    <div style={{ marginTop: 12, display: "flex", gap: 8, justifyContent: "flex-end" }}>
                      {rfpFiles.length > 0 && <Btn variant="ghost" onClick={() => setRfpFiles([])}>Clear file(s)</Btn>}
                      <Btn variant="accent" onClick={handleParse} disabled={loading === "parsing"}>
                        {loading === "parsing" ? "Extracting…" : "Extract Details →"}
                      </Btn>
                    </div>
                  </div>
                </Card>}

                {/* RFP Summary — shown after parse */}
                {rfpData && (
                  <Card>
                    <div style={{ padding: "11px 18px", background: C.surface, borderBottom: `1px solid ${C.rule}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ fontFamily: display, fontSize: 13, fontWeight: 700 }}>Parsed RFP</span>
                      </div>
                      <span style={{ fontFamily: mono, fontSize: 9, padding: "2px 8px", borderRadius: 2, background: C.passBg, color: C.pass, border: "1px solid rgba(46,107,79,0.2)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Ready</span>
                    </div>
                    <div style={{ padding: "16px 18px", borderBottom: `1px solid ${C.ruleLight}` }}>
                      <div style={{ fontFamily: mono, fontSize: 9, textTransform: "uppercase", letterSpacing: "0.08em", color: C.inkMuted, marginBottom: 10 }}>
                        RFP Summary
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
                        {[
                          ["Buyer", rfpData.buyer || "—"],
                          ["Project", rfpData.project || "—"],
                          ["Delivery", rfpData.delivery || "—"],
                        ].map(([lbl, val]) => (
                          <div key={lbl} style={{ padding: "12px 14px", background: C.white, border: `1px solid ${C.rule}`, borderRadius: 6 }}>
                            <div style={{ fontFamily: mono, fontSize: 9, textTransform: "uppercase", letterSpacing: "0.08em", color: C.copper, marginBottom: 6 }}>
                              {lbl}
                            </div>
                            <div style={{ fontSize: 14, fontWeight: 600, color: C.ink, lineHeight: 1.45 }}>
                              {val}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                    {(rfpData.uploaded_images_b64?.length ?? 0) > 0 && (
                      <div style={{ padding: "12px 18px", borderBottom: `1px solid ${C.ruleLight}` }}>
                        <div style={{ fontFamily: mono, fontSize: 9, textTransform: "uppercase", letterSpacing: "0.08em", color: C.inkMuted, marginBottom: 10 }}>
                          Uploaded Part Images ({rfpData.uploaded_images_b64.length})
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
                          {rfpData.uploaded_images_b64.map((img, i) => (
                            <div key={i} style={{ border: `1px solid ${C.rule}`, borderRadius: 6, overflow: "hidden", background: C.surface }}>
                              <img
                                src={`data:image/jpeg;base64,${img}`}
                                alt={`Uploaded RFP part visual ${i + 1}`}
                                style={{ width: "100%", height: 120, objectFit: "contain", display: "block", background: C.white }}
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {(rfpData.extracted_images_b64?.length ?? 0) > 0 && (
                      <div style={{ padding: "12px 18px", borderBottom: `1px solid ${C.ruleLight}` }}>
                        <div style={{ fontFamily: mono, fontSize: 9, textTransform: "uppercase", letterSpacing: "0.08em", color: C.inkMuted, marginBottom: 10 }}>
                          Document Extracted Images ({rfpData.extracted_images_b64.length})
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
                          {rfpData.extracted_images_b64.map((img, i) => (
                            <div key={i} style={{ border: `1px solid ${C.rule}`, borderRadius: 6, overflow: "hidden", background: C.surface }}>
                              <img
                                src={`data:image/jpeg;base64,${img}`}
                                alt={`Extracted RFP visual ${i + 1}`}
                                style={{ width: "100%", height: 120, objectFit: "contain", display: "block", background: C.white }}
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {/* Editable parts table */}
                    <div style={{ padding: "12px 18px 8px" }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 10 }}>
                        <div style={{ fontFamily: mono, fontSize: 9, textTransform: "uppercase", letterSpacing: "0.08em", color: C.inkMuted }}>Parsed Parts ({parts.length})</div>
                        <div style={{ fontSize: 12, color: C.inkSoft }}>Review and adjust extracted values before scoring</div>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {parts.map((p, i) => (
                          <div key={i} style={{ padding: "12px 14px", background: C.white, border: `1px solid ${C.rule}`, borderRadius: 6 }}>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 10 }}>
                              <div style={{ fontFamily: mono, fontSize: 10, color: C.copper }}>{p.id}</div>
                              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <div style={{ fontFamily: mono, fontSize: 9, textTransform: "uppercase", letterSpacing: "0.08em", color: C.inkMuted }}>Qty</div>
                                <input
                                  value={p.qty}
                                  type="number"
                                  onChange={e => { const n = [...parts]; n[i].qty = parseInt(e.target.value) || 1; setParts(n); }}
                                  style={{ width: 90, padding: "8px 10px", border: `1px solid ${C.rule}`, borderRadius: 4, fontSize: 12.5, fontFamily: sans, color: C.ink, background: C.white }}
                                />
                              </div>
                            </div>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 10, marginBottom: 10 }}>
                              <div>
                                <div style={{ fontFamily: mono, fontSize: 9, textTransform: "uppercase", letterSpacing: "0.08em", color: C.inkMuted, marginBottom: 6 }}>Description</div>
                                <textarea
                                  value={p.description}
                                  onChange={e => { const n = [...parts]; n[i].description = e.target.value; setParts(n); }}
                                  rows={3}
                                  style={{ width: "100%", padding: "8px 10px", border: `1px solid ${C.rule}`, borderRadius: 4, fontSize: 12.5, fontFamily: sans, color: C.ink, resize: "vertical", background: C.white }}
                                />
                              </div>
                              <div>
                                <div style={{ fontFamily: mono, fontSize: 9, textTransform: "uppercase", letterSpacing: "0.08em", color: C.inkMuted, marginBottom: 6 }}>Material</div>
                                <textarea
                                  value={p.material}
                                  onChange={e => { const n = [...parts]; n[i].material = e.target.value; setParts(n); }}
                                  rows={2}
                                  placeholder="Material"
                                  style={{ width: "100%", padding: "8px 10px", border: `1px solid ${C.rule}`, borderRadius: 4, fontSize: 12.5, fontFamily: sans, color: C.ink, resize: "vertical", background: C.white }}
                                />
                              </div>
                              <div>
                                <div style={{ fontFamily: mono, fontSize: 9, textTransform: "uppercase", letterSpacing: "0.08em", color: C.inkMuted, marginBottom: 6 }}>Process</div>
                                <textarea
                                  value={p.process}
                                  onChange={e => { const n = [...parts]; n[i].process = e.target.value; setParts(n); }}
                                  rows={2}
                                  placeholder="Process"
                                  style={{ width: "100%", padding: "8px 10px", border: `1px solid ${C.rule}`, borderRadius: 4, fontSize: 12.5, fontFamily: sans, color: C.ink, resize: "vertical", background: C.white }}
                                />
                              </div>
                            </div>
                            <div style={{ display: "grid", gridTemplateColumns: "minmax(220px, 1fr) 120px", gap: 10 }}>
                              <div>
                                <div style={{ fontFamily: mono, fontSize: 9, textTransform: "uppercase", letterSpacing: "0.08em", color: C.inkMuted, marginBottom: 6 }}>Tolerance</div>
                                <input value={p.tolerance} onChange={e => { const n = [...parts]; n[i].tolerance = e.target.value; setParts(n); }}
                                  placeholder="Tolerance"
                                  style={{ width: "100%", padding: "8px 10px", border: `1px solid ${C.rule}`, borderRadius: 4, fontSize: 12.5, fontFamily: sans, color: C.ink, background: C.white }} />
                              </div>
                              <div>
                                <div style={{ fontFamily: mono, fontSize: 9, textTransform: "uppercase", letterSpacing: "0.08em", color: C.inkMuted, marginBottom: 6 }}>Status</div>
                                <div style={{ padding: "8px 10px", border: `1px dashed ${C.rule}`, borderRadius: 4, fontSize: 12, color: C.inkSoft, background: C.surface, minHeight: 38, display: "flex", alignItems: "center", justifyContent: "center" }}>
                                  Editable
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div style={{ padding: "12px 18px", display: "flex", justifyContent: "flex-end" }}>
                      <Btn variant="primary" onClick={handleRunAssessment} disabled={loading === "running"}>
                        {loading === "running" ? "Running Assessment…" : "Run Assessment →"}
                      </Btn>
                    </div>
                    {zohoSync && (
                      <div style={{ padding: "0 18px 14px" }}>
                        <div style={{
                          padding: "10px 12px",
                          borderRadius: 6,
                          fontSize: 12,
                          lineHeight: 1.55,
                          background: zohoSync.status === "ok" ? C.passBg : zohoSync.status === "failed" ? C.warnBg : C.surface,
                          color: zohoSync.status === "ok" ? C.pass : zohoSync.status === "failed" ? C.warn : C.inkSoft,
                          border: `1px solid ${zohoSync.status === "ok" ? "rgba(46,107,79,0.2)" : zohoSync.status === "failed" ? "rgba(184,115,51,0.28)" : C.rule}`,
                        }}>
                          {zohoSync.message}
                          {zohoSync.recordId ? ` Record ID: ${zohoSync.recordId}` : ""}
                        </div>
                      </div>
                    )}
                  </Card>
                )}
              </div>

              {/* Right sidebar */}
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <Card style={{ animation: "up 0.35s ease 0.15s both" }}>
                  <CardHead title="Quick Score Summary" />
                  <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
                    {result ? (
                      <>
                        <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 14px", background: C.surface, borderRadius: 6, border: `1px solid ${C.rule}` }}>
                          <Ring value={overall} size={52} delay={300} />
                          <div>
                            <div style={{ fontFamily: display, fontSize: 14, fontWeight: 700, marginBottom: 2 }}>Overall Bid Intelligence</div>
                            <div style={{ fontFamily: mono, fontSize: 9, color: C.inkMuted, letterSpacing: "0.04em" }}>requested fit · manufacturability · historical similarity</div>
                          </div>
                        </div>
                        {fitDims.map((d, i) => (
                          <div key={d.key}>
                            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                              <span style={{ fontFamily: mono, fontSize: 9, textTransform: "uppercase", letterSpacing: "0.07em", color: C.inkMuted }}>{d.label}</span>
                              <span style={{ fontFamily: mono, fontSize: 11, fontWeight: 500 }}>{d.val ?? "—"}</span>
                            </div>
                            <Bar value={d.val ?? 0} delay={i * 80 + 300} />
                          </div>
                        ))}
                        <div style={{ borderTop: `1px solid ${C.ruleLight}`, paddingTop: 12, display: "flex", flexDirection: "column", gap: 5 }}>
                          {flags.slice(0, 3).map((f, i) => <Chip key={i} type={f.type} label={f.title.slice(0, 32)} />)}
                        </div>
                        <Btn variant="primary" onClick={() => setTab("fit")} style={{ width: "100%", textAlign: "center" }}>View Full Assessment →</Btn>
                      </>
                    ) : (
                      <div style={{ textAlign: "center", padding: "24px 0", color: C.inkMuted, fontSize: 13 }}>
                        Upload an RFP and run the assessment to see your fit score.
                      </div>
                    )}
                  </div>
                </Card>

                {result && (
                  <Card style={{ animation: "up 0.35s ease 0.25s both" }}>
                    <CardHead title="Per-Part Score" />
                    {scoredParts.map((p, i) => {
                      const col        = scoreColor(p.composite);
                      const labelColor = p.composite >= 88 ? C.pass : p.composite >= 72 ? C.blueMid : C.warn;
                      const labelBg    = p.composite >= 88 ? C.passBg : p.composite >= 72 ? C.bluePale : C.warnBg;
                      const label      = p.composite >= 88 ? "Strong" : p.composite >= 72 ? "Good" : "Thin";
                      return (
                        <div key={p.part_id} style={{ padding: "11px 16px", borderBottom: i < scoredParts.length - 1 ? `1px solid ${C.ruleLight}` : "none" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                              <span style={{ fontFamily: mono, fontSize: 10, color: C.copper, fontWeight: 500 }}>{p.part_id}</span>
                              <span style={{ fontFamily: mono, fontSize: 9, padding: "1px 6px", borderRadius: 2, background: labelBg, color: labelColor, textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</span>
                              {p.match_confidence && (
                                <span style={{ fontFamily: mono, fontSize: 8.5, padding: "1px 6px", borderRadius: 2, background: C.surface, color: C.inkMuted, border: `1px solid ${C.rule}`, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                                  {p.match_confidence} confidence
                                </span>
                              )}
                            </div>
                            <span style={{ fontFamily: mono, fontSize: 15, fontWeight: 500, color: col }}>{p.composite}</span>
                          </div>
                          {(p.c_text != null || p.c_img != null) && (
                            <div style={{ fontFamily: mono, fontSize: 8.5, color: C.inkMuted, marginBottom: 5 }}>
                              C(text): {p.c_text ?? "—"} · C(img): {p.c_img ?? "—"} · w_img: {p.image_weight ?? "—"}
                            </div>
                          )}
                          {Array.isArray(p.image_candidate_indices) && p.image_candidate_indices.length > 0 && (
                            <div style={{ fontFamily: mono, fontSize: 8.5, color: C.inkMuted, marginBottom: 5 }}>
                              Image candidates: {p.image_candidate_indices.map((idx) => `#${Number(idx) + 1}`).join(", ")}
                            </div>
                          )}
                          <Bar value={p.composite} delay={i * 80 + 500} h={3} />
                        </div>
                      );
                    })}
                    <div style={{ padding: 12 }}>
                      <Btn variant="outline" onClick={() => setTab("history")} style={{ width: "100%", textAlign: "center", fontSize: 11 }}>View Matched Projects →</Btn>
                    </div>
                  </Card>
                )}
              </div>
            </div>
          )}

          {/* ─── FIT ASSESSMENT ─── */}
          {tab === "fit" && result && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, animation: "up 0.25s ease" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <Card>
                  <div style={{ padding: "13px 18px", background: C.surface, borderBottom: `1px solid ${C.rule}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ fontFamily: display, fontSize: 13, fontWeight: 700 }}>Bid Intelligence Detail</span>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <Ring value={overall} size={38} delay={0} />
                      <span style={{ fontFamily: mono, fontSize: 9, color: C.inkMuted, textTransform: "uppercase", letterSpacing: "0.06em" }}>Overall</span>
                    </div>
                  </div>
                  <div style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
                    {fitDims.filter(d => d.val != null).map((d, i) => (
                      <div key={d.key} style={{ padding: "12px 14px", background: C.surface, borderRadius: 6, border: `1px solid ${C.ruleLight}` }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 7 }}>
                          <div style={{ paddingRight: 12 }}>
                            <div style={{ fontFamily: display, fontSize: 13, fontWeight: 600, marginBottom: 2 }}>{d.label}</div>
                            <div style={{ fontSize: 11.5, color: C.inkMuted, lineHeight: 1.5 }}>{d.sub}</div>
                          </div>
                          <span style={{ fontFamily: mono, fontSize: 22, fontWeight: 500, color: scoreColor(d.val), flexShrink: 0 }}>{d.val}</span>
                        </div>
                        <Bar value={d.val} delay={i * 100} />
                      </div>
                    ))}
                  </div>
                </Card>

                <Card>
                  <CardHead title="Assessment Flags" />
                  <div style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
                    {flags.map((f, i) => {
                      const s = f.type === "pass"
                        ? { border: C.pass, bg: "#F4FCF7", titleColor: C.pass }
                        : { border: C.copper, bg: "#FEF9F3", titleColor: C.warn };
                      return (
                        <div key={i} style={{ padding: "10px 13px", background: s.bg, borderLeft: `3px solid ${s.border}`, borderRadius: 4 }}>
                          <div style={{ fontFamily: display, fontSize: 12.5, fontWeight: 600, color: s.titleColor, marginBottom: 4 }}>{f.title}</div>
                          <div style={{ fontSize: 12, color: C.inkSoft, lineHeight: 1.6 }}>{f.body}</div>
                        </div>
                      );
                    })}
                  </div>
                </Card>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <Card>
                  <CardHead title="Per-Part Breakdown" />
                  {scoredParts.map((p, i) => {
                    const borderColor = p.composite >= 72 ? C.pass : C.copper;
                    const col         = scoreColor(p.composite);
                    const note        = p.scoring_mode === "partial"
                      ? "Partial score — limited data available for this part."
                      : `Requested Fit: ${p.b1 ?? "—"} · Manufacturability Fit: ${p.b2 ?? "—"} · Historical Similarity: ${p.c ?? "—"}`;
                    return (
                      <div key={p.part_id} style={{ padding: "14px 18px", borderBottom: i < scoredParts.length - 1 ? `1px solid ${C.ruleLight}` : "none" }}>
                        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                              <span style={{ fontFamily: mono, fontSize: 10, color: C.copper, fontWeight: 500 }}>{p.part_id}</span>
                              <span style={{ fontFamily: display, fontSize: 13, fontWeight: 600 }}>{p.description}</span>
                            </div>
                            <div style={{ fontSize: 12, color: C.inkSoft, lineHeight: 1.55, padding: "8px 10px", background: p.composite >= 72 ? "#F4FCF7" : "#FEF9F3", borderLeft: `2px solid ${borderColor}`, borderRadius: 3 }}>{note}</div>
                            {p.gate_status && (
                              <div style={{ fontFamily: mono, fontSize: 8.5, color: C.inkMuted, marginTop: 5 }}>
                                Gate: {String(p.gate_status).replaceAll("_", " ")}
                                {p.geometry_basis ? ` · Geometry: ${String(p.geometry_basis).replaceAll("_", " ")}` : ""}
                              </div>
                            )}
                            {Array.isArray(p.dependency_tags) && p.dependency_tags.length > 0 && (
                              <div style={{ fontFamily: mono, fontSize: 8.5, color: C.warn, marginTop: 5 }}>
                                Dependencies: {p.dependency_tags.join(", ")}
                              </div>
                            )}
                            {Array.isArray(p.gate_reasons) && p.gate_reasons.length > 0 && (
                              <div style={{ fontFamily: mono, fontSize: 8.5, color: C.inkMuted, marginTop: 5 }}>
                                Gate reason(s): {p.gate_reasons.join(" | ")}
                              </div>
                            )}
                            {(p.c_text != null || p.c_img != null || p.match_confidence) && (
                              <div style={{ fontFamily: mono, fontSize: 8.5, color: C.inkMuted, marginTop: 5 }}>
                                C(text): {p.c_text ?? "—"} · C(img): {p.c_img ?? "—"} · w_img: {p.image_weight ?? "—"} · confidence: {p.match_confidence || "—"} ({p.match_confidence_score ?? "—"})
                              </div>
                            )}
                            {Array.isArray(p.image_candidate_indices) && p.image_candidate_indices.length > 0 && (
                              <div style={{ fontFamily: mono, fontSize: 8.5, color: C.inkMuted, marginTop: 5 }}>
                                Assigned image candidate(s): {p.image_candidate_indices.map((idx) => `#${Number(idx) + 1}`).join(", ")}
                              </div>
                            )}
                            {Array.isArray(p.image_candidate_indices) && p.image_candidate_indices.length > 0 && Array.isArray(rfpData?.extracted_images_b64) && rfpData.extracted_images_b64.length > 0 && (
                              <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap" }}>
                                {p.image_candidate_indices.map((idxRaw, imgIdx) => {
                                  const idx = Number(idxRaw);
                                  const img = rfpData.extracted_images_b64[idx];
                                  if (!img) return null;
                                  return (
                                    <a
                                      key={`${p.part_id}-cand-${idx}-${imgIdx}`}
                                      href={`data:image/jpeg;base64,${img}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      title={`Candidate #${idx + 1}`}
                                      style={{ display: "block", border: `1px solid ${C.ruleLight}`, borderRadius: 4, overflow: "hidden", background: C.surface }}
                                    >
                                      <img
                                        src={`data:image/jpeg;base64,${img}`}
                                        alt={`Candidate ${idx + 1}`}
                                        style={{ width: 68, height: 52, objectFit: "cover", display: "block" }}
                                      />
                                    </a>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                          <div style={{ textAlign: "right", flexShrink: 0 }}>
                            <div style={{ fontFamily: mono, fontSize: 24, fontWeight: 500, color: col, lineHeight: 1 }}>{p.composite}</div>
                            <div style={{ fontFamily: mono, fontSize: 8, textTransform: "uppercase", letterSpacing: "0.07em", color: C.inkMuted, marginTop: 2 }}>Composite Score</div>
                          </div>
                        </div>
                        <Bar value={p.composite} delay={i * 100 + 200} h={3} />
                      </div>
                    );
                  })}
                </Card>

                <Card>
                  <CardHead title="Quote Strategy" />
                  <div style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 9 }}>
                    {guidance.length > 0 ? guidance.map((g, i) => (
                      <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                        <span style={{ fontFamily: mono, fontSize: 12, color: C.copper, flexShrink: 0, marginTop: 1 }}>✦</span>
                        <span style={{ fontSize: 12.5, color: C.inkSoft, lineHeight: 1.6 }}>{g}</span>
                      </div>
                    )) : (
                      <div style={{ fontSize: 12, color: C.inkMuted }}>No guidance generated.</div>
                    )}
                  </div>
                </Card>
              </div>
            </div>
          )}

          {/* ─── HISTORY ─── */}
          {tab === "history" && result && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 290px", gap: 20, animation: "up 0.25s ease" }}>
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 14 }}>
                  <div>
                    <div style={{ fontFamily: display, fontSize: 16, fontWeight: 700, marginBottom: 2 }}>Similar Past Projects</div>
                    <div style={{ fontFamily: mono, fontSize: 10, color: C.inkMuted, letterSpacing: "0.04em" }}>from your ingested corpus · {matchedJobs.length} matches found · sorted by similarity</div>
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {matchedJobs.length > 0
                    ? matchedJobs.map((j, i) => <JobCard key={j.job_id || i} job={j} defaultOpen={i === 0} animDelay={i * 90} />)
                    : <div style={{ padding: 24, textAlign: "center", color: C.inkMuted, fontSize: 13 }}>No past project matches found. Upload past projects via the ingestion tool to improve results.</div>
                  }
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <Card>
                  <CardHead title="Coverage by Part" />
                  {scoredParts.map((p, i) => {
                    const jobCount = p.matched_jobs?.length ?? 0;
                    const ok       = jobCount >= 2;
                    return (
                      <div key={p.part_id} style={{ padding: "10px 16px", borderBottom: i < scoredParts.length - 1 ? `1px solid ${C.ruleLight}` : "none", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <div>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                            <span style={{ fontFamily: mono, fontSize: 10, color: C.copper, fontWeight: 500 }}>{p.part_id}</span>
                            <span style={{ fontSize: 12 }}>{p.description?.slice(0, 20)}</span>
                          </div>
                          <div style={{ fontFamily: mono, fontSize: 9, color: C.inkMuted }}>{jobCount} corpus job{jobCount !== 1 ? "s" : ""} matched</div>
                        </div>
                        <Chip type={ok ? "pass" : "warn"} label={ok ? "Strong" : "Thin"} />
                      </div>
                    );
                  })}
                </Card>

                <Card>
                  <CardHead title="Match Score Guide" />
                  <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 7 }}>
                    {[
                      ["88–100", "Highly similar job",   C.copper],
                      ["72–87",  "Moderate precedent",   C.blueMid],
                      ["< 72",   "Weak / partial match", C.inkMuted],
                    ].map(([range, label, col]) => (
                      <div key={range} style={{ display: "flex", alignItems: "center", gap: 9 }}>
                        <span style={{ fontFamily: mono, fontSize: 12, fontWeight: 500, color: col, width: 46 }}>{range}</span>
                        <span style={{ fontFamily: mono, fontSize: 10, color: C.inkMuted }}>{label}</span>
                      </div>
                    ))}
                  </div>
                </Card>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ── ROOT — controls which screen is shown ─────────────────
function App() {
  const [session, setSession] = useState(() => getStoredSession());
  const [step, setStep]       = useState(() => (getStoredSession() ? "app" : "email"));   // "email" | "otp" | "app"
  const [loginData, setLoginData] = useState(null);
  const [screen, setScreen] = useState("dashboard"); // "dashboard" | "assessment" | "ingestion"
  const [activeAssessment, setActiveAssessment] = useState(null);
  const [activeAssessmentContext, setActiveAssessmentContext] = useState(null);

  useEffect(() => {
    if (!session) {
      window.localStorage.removeItem(SESSION_KEY);
      return;
    }
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    // Keep ingestion module session in sync so Knowledge Base opens directly.
    window.localStorage.setItem(
      "tb_supplier_session_v1",
      JSON.stringify({
        email: session.email,
        zoho_account_id: session.zoho_account_id,
        company_name: session.company_name,
      })
    );
  }, [session]);

  const openAssessment = async (queueItem = null) => {
    if (!queueItem) {
      setActiveAssessment(null);
      setActiveAssessmentContext(null);
      setScreen("assessment");
      return;
    }

    setActiveAssessmentContext(queueItem);
    if (!queueItem.has_cached) {
      setActiveAssessment(null);
      setScreen("assessment");
      return;
    }

    try {
      const rfpId = queueItem.view_id || queueItem.rfp_id || queueItem.id;
      const supplierId = encodeURIComponent(session?.zoho_account_id || "");
      const supplierEmail = encodeURIComponent(session?.email || "");
      const res = await fetch(
        `${API}/api/assessment/result?rfp_id=${encodeURIComponent(rfpId)}&supplier_id=${supplierId}&supplier_email=${supplierEmail}`
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || "Failed to load assessment snapshot");
      setActiveAssessment(data);
    } catch (_) {
      setActiveAssessment(null);
    }
    setScreen("assessment");
  };

  if (step === "email") {
    return (
      <LoginShell>
        <EmailStep onSuccess={data => { setLoginData(data); setStep("otp"); }} />
      </LoginShell>
    );
  }

  if (step === "otp") {
    return (
      <LoginShell>
        <OTPStep
          loginData={loginData}
          onSuccess={sess => { setSession(sess); setStep("app"); setScreen("dashboard"); }}
          onBack={() => setStep("email")}
        />
      </LoginShell>
    );
  }

  if (screen === "dashboard") {
    return (
      <DashboardScreen
        session={session}
        onOpenAssessment={openAssessment}
        onOpenIngestion={() => setScreen("ingestion")}
        onLogout={() => {
          window.localStorage.removeItem(SESSION_KEY);
          setSession(null);
          setLoginData(null);
          setStep("email");
          setScreen("dashboard");
          setActiveAssessment(null);
          setActiveAssessmentContext(null);
        }}
      />
    );
  }

  if (screen === "ingestion") {
    return <PastProjectsApp session={session} />;
  }

  return (
    <RFPAssessmentApp
      session={session}
      initialResult={activeAssessment}
      initialContext={activeAssessmentContext}
      onBackToDashboard={() => setScreen("dashboard")}
      onLogout={() => {
        window.localStorage.removeItem(SESSION_KEY);
        setSession(null);
        setLoginData(null);
        setStep("email");
        setScreen("dashboard");
        setActiveAssessment(null);
        setActiveAssessmentContext(null);
      }}
    />
  );
}

export default App;

