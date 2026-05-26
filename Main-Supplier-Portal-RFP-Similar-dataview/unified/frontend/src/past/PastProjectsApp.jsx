import { useState, useCallback, useEffect, useRef } from "react";
import ProjectsTab from "./components/ProjectsTab";
import CorpusDashboard from "./components/CorpusDashboard";
import MfgLessons from "./components/MfgLessons";
import QuotingLessons from "./components/QuotingLessons";
import CapabilitiesTab from "./components/CapabilitiesTab";
import AnalyticsTab from "./components/AnalyticsTab";

const C = {
  ink: "#1B2D4F",
  copper: "#B8920A",
  copperPale: "#F5F0DC",
  white: "#FAFCFF",
  bg: "#E4E8F0",
  rule: "#CBD3DF",
  surface: "#F2F4F8",
  inkMuted: "#6B7F96",
  inkSoft: "#2D4567",
};
const mono = "'IBM Plex Mono', monospace";
const display = "'Syne', sans-serif";
const sans = "'DM Sans', sans-serif";
const serif = "'Playfair Display', Georgia, serif";
const API = (import.meta.env.VITE_API_BASE || "http://localhost:8000").replace(
  /\/+$/,
  "",
);

const TABS = [
  { id: "dashboard", label: "Corpus Dashboard" },
  { id: "analytics", label: "Analytics" },
  { id: "capabilities", label: "Capabilities" },
  { id: "projects", label: "Projects" },
  { id: "mfg", label: "MFG Lessons" },
  { id: "quoting", label: "Quoting Lessons" },
];
const STORAGE_KEY = "tb_demo_workspace_v1";
const SESSION_KEY = "tb_supplier_session_v1";

function getStoredSession() {
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.zoho_account_id && parsed?.company_name && parsed?.email) {
      return parsed;
    }
  } catch (_) {}
  return null;
}

function LoginShell({ children }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: C.bg,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Sans:opsz,wght@9..40,400;9..40,500&family=IBM+Plex+Mono:wght@400;500&family=Playfair+Display:wght@600;700&display=swap');`}</style>
      <div style={{ marginBottom: 20, textAlign: "center" }}>
        <div
          style={{
            fontFamily: serif,
            fontSize: 28,
            fontWeight: 700,
            color: C.ink,
            letterSpacing: "0.02em",
          }}
        >
          TrustBridge
        </div>
        <div
          style={{
            fontFamily: mono,
            fontSize: 10,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: C.inkMuted,
          }}
        >
          Supplier Portal · Knowledge Base
        </div>
      </div>
      <div
        style={{
          width: "100%",
          maxWidth: 420,
          background: C.white,
          border: `1px solid ${C.rule}`,
          borderRadius: 8,
          padding: 28,
        }}
      >
        {children}
      </div>
    </div>
  );
}

function EmailStep({ onSuccess }) {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async () => {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !trimmed.includes("@")) {
      setError("Please enter a valid email address.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const lookupRes = await fetch(`${API}/auth/lookup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed }),
      });
      const lookupData = await lookupRes.json().catch(() => ({}));
      if (!lookupRes.ok || !lookupData?.ok) {
        setError(lookupData?.error || "Email not authorized.");
        setLoading(false);
        return;
      }

      const otpRes = await fetch(`${API}/auth/send-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: trimmed,
          zoho_account_id: lookupData.zoho_account_id,
          company_name: lookupData.company_name,
        }),
      });
      const otpData = await otpRes.json().catch(() => ({}));
      if (!otpRes.ok || !otpData?.ok) {
        setError(otpData?.error || "Failed to send OTP.");
        setLoading(false);
        return;
      }

      onSuccess({
        email: trimmed,
        zoho_account_id: lookupData.zoho_account_id,
        company_name: lookupData.company_name,
        masked_email: otpData.masked_email || trimmed,
        dev_mode: !!otpData.dev_mode,
      });
    } catch (_) {
      setError("Server error. Check API server.");
    }
    setLoading(false);
  };

  return (
    <>
      <div style={{ fontFamily: display, fontSize: 20, fontWeight: 700, marginBottom: 6 }}>
        Sign in to your workspace
      </div>
      <div style={{ fontSize: 13, color: C.inkSoft, marginBottom: 18, lineHeight: 1.6 }}>
        Enter your registered supplier email to continue.
      </div>
      <label
        style={{
          fontFamily: mono,
          fontSize: 9,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: C.inkMuted,
          display: "block",
          marginBottom: 6,
        }}
      >
        Email Address
      </label>
      <input
        type="email"
        value={email}
        autoFocus
        onChange={(e) => {
          setEmail(e.target.value);
          setError("");
        }}
        onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
        placeholder="you@company.com"
        style={{
          width: "100%",
          padding: "10px 12px",
          borderRadius: 6,
          border: `1.5px solid ${error ? "#B3261E" : C.rule}`,
          background: C.white,
          fontFamily: sans,
          fontSize: 14,
          color: C.ink,
          caretColor: C.ink,
          WebkitTextFillColor: C.ink,
          marginBottom: error ? 8 : 16,
          outline: "none",
        }}
      />
      {error ? (
        <div style={{ fontSize: 12, color: "#B3261E", marginBottom: 12 }}>
          {error}
        </div>
      ) : null}
      <button
        onClick={handleSubmit}
        disabled={loading}
        style={{
          width: "100%",
          border: "none",
          background: C.copper,
          color: "#fff",
          borderRadius: 6,
          padding: "10px 0",
          cursor: loading ? "not-allowed" : "pointer",
          fontFamily: display,
          fontWeight: 700,
          fontSize: 13,
          opacity: loading ? 0.6 : 1,
        }}
      >
        {loading ? "Checking..." : "Continue ->"}
      </button>
    </>
  );
}

function OTPStep({ loginData, onSuccess, onBack }) {
  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [resending, setResending] = useState(false);
  const inputRefs = useRef([]);

  const handleChange = (index, value) => {
    if (!/^\d?$/.test(value)) return;
    const next = [...otp];
    next[index] = value;
    setOtp(next);
    setError("");
    if (value && index < 5) inputRefs.current[index + 1]?.focus();
  };

  const handleKeyDown = (index, event) => {
    if (event.key === "Backspace" && !otp[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handleVerify = async () => {
    const code = otp.join("");
    if (code.length !== 6) {
      setError("Please enter the full 6-digit code.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API}/auth/verify-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: loginData.email, otp: code }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Invalid OTP.");
        setOtp(["", "", "", "", "", ""]);
        inputRefs.current[0]?.focus();
        setLoading(false);
        return;
      }
      onSuccess({
        email: data.email,
        zoho_account_id: data.zoho_account_id,
        company_name: data.company_name,
      });
    } catch (_) {
      setError("Server error. Try again.");
    }
    setLoading(false);
  };

  const handleResend = async () => {
    setResending(true);
    setError("");
    setOtp(["", "", "", "", "", ""]);
    try {
      await fetch(`${API}/auth/send-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: loginData.email,
          zoho_account_id: loginData.zoho_account_id,
          company_name: loginData.company_name,
        }),
      });
    } catch (_) {}
    setResending(false);
    inputRefs.current[0]?.focus();
  };

  return (
    <>
      <div style={{ fontFamily: display, fontSize: 20, fontWeight: 700, marginBottom: 6 }}>
        Verify your email
      </div>
      <div style={{ fontSize: 13, color: C.inkSoft, marginBottom: 4, lineHeight: 1.6 }}>
        We sent a code to
      </div>
      <div style={{ fontFamily: mono, fontSize: 13, color: C.ink, marginBottom: loginData.dev_mode ? 8 : 18 }}>
        {loginData.masked_email}
      </div>
      {loginData.dev_mode ? (
        <div
          style={{
            fontSize: 12,
            background: C.copperPale,
            color: C.inkSoft,
            borderLeft: `3px solid ${C.copper}`,
            padding: "8px 10px",
            marginBottom: 12,
          }}
        >
          Dev mode active: OTP is printed in the backend terminal.
        </div>
      ) : null}
      <div style={{ display: "flex", gap: 8, justifyContent: "center", marginBottom: error ? 10 : 18 }}>
        {otp.map((digit, index) => (
          <input
            key={index}
            ref={(el) => {
              inputRefs.current[index] = el;
            }}
            type="text"
            inputMode="numeric"
            maxLength={1}
            value={digit}
            onChange={(e) => handleChange(index, e.target.value)}
            onKeyDown={(e) => handleKeyDown(index, e)}
            style={{
              width: 42,
              height: 52,
              textAlign: "center",
              borderRadius: 6,
              border: `1.5px solid ${error ? "#B3261E" : digit ? C.copper : C.rule}`,
              background: C.white,
              color: C.ink,
              caretColor: C.ink,
              WebkitTextFillColor: C.ink,
              fontFamily: mono,
              fontSize: 22,
              outline: "none",
            }}
          />
        ))}
      </div>
      {error ? (
        <div style={{ fontSize: 12, color: "#B3261E", textAlign: "center", marginBottom: 12 }}>
          {error}
        </div>
      ) : null}
      <button
        onClick={handleVerify}
        disabled={loading}
        style={{
          width: "100%",
          border: "none",
          background: C.copper,
          color: "#fff",
          borderRadius: 6,
          padding: "10px 0",
          cursor: loading ? "not-allowed" : "pointer",
          fontFamily: display,
          fontWeight: 700,
          fontSize: 13,
          opacity: loading ? 0.6 : 1,
          marginBottom: 12,
        }}
      >
        {loading ? "Verifying..." : "Verify Code ->"}
      </button>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <button
          onClick={onBack}
          style={{
            border: "none",
            background: "transparent",
            fontFamily: mono,
            fontSize: 10,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: C.inkMuted,
            cursor: "pointer",
          }}
        >
          {"<- Change email"}
        </button>
        <button
          onClick={handleResend}
          disabled={resending}
          style={{
            border: "none",
            background: "transparent",
            fontFamily: mono,
            fontSize: 10,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: C.copper,
            cursor: resending ? "not-allowed" : "pointer",
            opacity: resending ? 0.6 : 1,
          }}
        >
          {resending ? "Sending..." : "Resend code"}
        </button>
      </div>
    </>
  );
}

function computeCorpusScore(saved) {
  const totalProjects = saved.length;
  const totalParts = saved.reduce(
    (sum, project) => sum + (project.parts?.length || 0),
    0,
  );
  const attributed = saved.filter(
    (project) => project.sharing_tier === "Attributed",
  ).length;
  const anonymized = saved.filter(
    (project) => project.sharing_tier === "Anonymized",
  ).length;
  const allParts = saved.flatMap((project) => project.parts || []);
  const partsWithOutcome = allParts.filter((part) => part.outcome).length;
  const processSet = new Set();
  allParts.forEach((part) => {
    const process =
      part.process?.split(".")?.[0]?.trim() || part.process_primary || "";
    if (process) processSet.add(process);
  });
  const processDiversity = processSet.size;
  const fullyAnnotated = allParts.filter(
    (part) => part.outcome && part.what_worked && part.quoting_lesson,
  ).length;

  if (totalProjects === 0) return 0;

  return Math.min(
    100,
    10 +
      Math.min(24, totalParts * 4) +
      Math.min(20, attributed * 10) +
      Math.min(6, anonymized * 3) +
      Math.min(16, partsWithOutcome * 4) +
      Math.min(12, fullyAnnotated * 6) +
      Math.min(12, processDiversity * 3),
  );
}

export default function App({ session: propSession }) {
  const [session, setSession] = useState(() => propSession || getStoredSession());
  const [step, setStep] = useState(() => (session ? "app" : "email"));
  const [loginData, setLoginData] = useState(null);
  const [activeTab, setActiveTab] = useState("dashboard");
  const [corpusSaved, setCorpusSaved] = useState([]);
  const [processProfiles, setProcessProfiles] = useState([]);
  const [mfgLessons, setMfgLessons] = useState([]);
  const [manualQuotingLessons, setManualQuotingLessons] = useState([]);
  const didHydrateWorkspace = useRef(false);
  const didHydrateLessons = useRef(false);

  const companyName = (propSession || session)?.company_name || "";
  const zohoId = (propSession || session)?.zoho_account_id || "";
  const supplierEmail = (propSession || session)?.email || "";
  const corpusScore = computeCorpusScore(corpusSaved);
  const workspaceLabel = companyName || "Supplier Workspace";

  useEffect(() => {
    if (propSession) {
      setSession(propSession);
      setStep("app");
      return;
    }
    if (!session) {
      localStorage.removeItem(SESSION_KEY);
      localStorage.removeItem("tb_company_name");
      localStorage.removeItem("tb_zoho_id");
      return;
    }
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    localStorage.setItem("tb_company_name", session.company_name || "");
    localStorage.setItem("tb_zoho_id", session.zoho_account_id || "");
  }, [session, propSession]);

  const handleSaveToCorpus = useCallback((project) => {
    setCorpusSaved((prev) => {
      const exists = prev.find((p) => p.id === project.id);
      if (exists) return prev.map((p) => (p.id === project.id ? project : p));
      return [...prev, project];
    });
  }, []);

  const refreshFromZoho = useCallback(async () => {
    const sess = propSession || session;
    if (!sess?.zoho_account_id && !sess?.email) return;
    try {
      const sid = encodeURIComponent(sess?.zoho_account_id || "");
      const semail = encodeURIComponent(sess?.email || "");
      const res = await fetch(`${API}/projects?supplier_id=${sid}&supplier_email=${semail}&limit=200`);
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.ok && Array.isArray(data?.projects)) {
        setCorpusSaved(data.projects);
      }
    } catch (_) {}
  }, [propSession, session]);

  const refreshProcessProfilesFromZoho = useCallback(async () => {
    const sess = propSession || session;
    if (!sess?.zoho_account_id && !sess?.email) return;
    try {
      const sid = encodeURIComponent(sess?.zoho_account_id || "");
      const semail = encodeURIComponent(sess?.email || "");
      const res = await fetch(`${API}/process-profiles?supplier_id=${sid}&supplier_email=${semail}&limit=200`);
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.ok && Array.isArray(data?.profiles)) {
        setProcessProfiles(data.profiles);
      }
    } catch (_) {}
  }, [propSession, session]);

  const refreshLessonsFromZoho = useCallback(async () => {
    const sess = propSession || session;
    if (!sess?.zoho_account_id && !sess?.email) return;
    try {
      const sid = encodeURIComponent(sess?.zoho_account_id || "");
      const semail = encodeURIComponent(sess?.email || "");
      const res = await fetch(`${API}/zoho-lessons?supplier_id=${sid}&supplier_email=${semail}&limit=300`);
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.ok) {
        setMfgLessons(Array.isArray(data?.mfg_lessons) ? data.mfg_lessons : []);
        setManualQuotingLessons(
          Array.isArray(data?.quoting_lessons) ? data.quoting_lessons : [],
        );
      }
    } catch (_) {
    } finally {
      didHydrateLessons.current = true;
    }
  }, [propSession, session]);

  const syncLessonsToZoho = useCallback(async () => {
    const sess = propSession || session;
    if (!sess?.zoho_account_id && !sess?.email) return;
    try {
      await fetch(`${API}/zoho-sync-lessons`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplier_id: sess?.zoho_account_id || "",
          supplier_email: sess?.email || "",
          mfg_lessons: mfgLessons || [],
          quoting_lessons: manualQuotingLessons || [],
        }),
      });
    } catch (_) {}
  }, [
    propSession,
    session,
    mfgLessons,
    manualQuotingLessons,
  ]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      setActiveTab(parsed.activeTab || "dashboard");
      setCorpusSaved(parsed.corpusSaved || []);
      setProcessProfiles(parsed.processProfiles || []);
      setMfgLessons(parsed.mfgLessons || []);
      setManualQuotingLessons(parsed.manualQuotingLessons || []);
    } catch (_) {
    } finally {
      didHydrateWorkspace.current = true;
    }
  }, []);

  useEffect(() => {
    if (!didHydrateWorkspace.current) return;
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          activeTab,
          corpusSaved,
          processProfiles,
          mfgLessons,
          manualQuotingLessons,
        }),
      );
    } catch (_) {}
  }, [activeTab, corpusSaved, processProfiles, mfgLessons, manualQuotingLessons]);

  useEffect(() => {
    refreshFromZoho();
    refreshProcessProfilesFromZoho();
    refreshLessonsFromZoho();
  }, [refreshFromZoho, refreshProcessProfilesFromZoho, refreshLessonsFromZoho]);

  useEffect(() => {
    if (!didHydrateLessons.current) return;
    const t = setTimeout(() => {
      syncLessonsToZoho();
    }, 900);
    return () => clearTimeout(t);
  }, [syncLessonsToZoho]);

  if (step !== "app" || !session) {
    if (step === "otp" && loginData) {
      return (
        <LoginShell>
          <OTPStep
            loginData={loginData}
            onBack={() => setStep("email")}
            onSuccess={(sess) => {
              setSession(sess);
              setStep("app");
            }}
          />
        </LoginShell>
      );
    }
    return (
      <LoginShell>
        <EmailStep
          onSuccess={(data) => {
            setLoginData(data);
            setStep("otp");
          }}
        />
      </LoginShell>
    );
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Sans:opsz,wght@9..40,400;9..40,500&family=IBM+Plex+Mono:wght@400;500&family=Playfair+Display:wght@600;700&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: ${C.bg}; font-family: ${sans}; }
        ::-webkit-scrollbar { width: 5px; }
        ::-webkit-scrollbar-thumb { background: #9BAAC0; border-radius: 3px; }
      `}</style>

      <div
        style={{
          background: C.ink,
          borderBottom: `2px solid ${C.copper}`,
          padding: "0 28px",
          display: "flex",
          alignItems: "stretch",
          position: "sticky",
          top: 0,
          zIndex: 200,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "11px 24px 11px 0",
            borderRight: "1px solid rgba(255,255,255,0.12)",
            marginRight: 16,
          }}
        >
          <svg
            width="26"
            height="22"
            viewBox="0 0 26 22"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <rect
              x="12.2"
              y="1"
              width="1.6"
              height="13"
              fill="white"
              opacity="0.9"
            />
            <path
              d="M10.5 14 L12.2 14 L12.2 21 L10.5 21 Z"
              fill="white"
              opacity="0.9"
              transform="skewX(-8)"
            />
            <path
              d="M13.8 14 L15.5 14 L15.5 21 L13.8 21 Z"
              fill="white"
              opacity="0.9"
              transform="skewX(8)"
            />
            <path
              d="M1 13 Q13 10.5 25 13"
              stroke="white"
              strokeWidth="1.6"
              fill="none"
              opacity="0.9"
              strokeLinecap="round"
            />
            <line
              x1="13"
              y1="1.5"
              x2="3"
              y2="12.4"
              stroke="white"
              strokeWidth="0.6"
              opacity="0.65"
            />
            <line
              x1="13"
              y1="1.5"
              x2="5"
              y2="11.8"
              stroke="white"
              strokeWidth="0.6"
              opacity="0.65"
            />
            <line
              x1="13"
              y1="1.5"
              x2="7"
              y2="11.4"
              stroke="white"
              strokeWidth="0.6"
              opacity="0.65"
            />
            <line
              x1="13"
              y1="1.5"
              x2="9"
              y2="11.1"
              stroke="white"
              strokeWidth="0.6"
              opacity="0.65"
            />
            <line
              x1="13"
              y1="1.5"
              x2="11"
              y2="10.9"
              stroke="white"
              strokeWidth="0.6"
              opacity="0.65"
            />
            <line
              x1="13"
              y1="1.5"
              x2="23"
              y2="12.4"
              stroke="white"
              strokeWidth="0.6"
              opacity="0.65"
            />
            <line
              x1="13"
              y1="1.5"
              x2="21"
              y2="11.8"
              stroke="white"
              strokeWidth="0.6"
              opacity="0.65"
            />
            <line
              x1="13"
              y1="1.5"
              x2="19"
              y2="11.4"
              stroke="white"
              strokeWidth="0.6"
              opacity="0.65"
            />
            <line
              x1="13"
              y1="1.5"
              x2="17"
              y2="11.1"
              stroke="white"
              strokeWidth="0.6"
              opacity="0.65"
            />
            <line
              x1="13"
              y1="1.5"
              x2="15"
              y2="10.9"
              stroke="white"
              strokeWidth="0.6"
              opacity="0.65"
            />
          </svg>

          <span
            style={{
              fontFamily: serif,
              fontSize: 18,
              fontWeight: 700,
              color: C.white,
              letterSpacing: "0.02em",
            }}
          >
            TrustBridge
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1 }}>
          {["Supplier Portal", "Knowledge Base"].map((section, index) => (
            <span
              key={index}
              style={{ display: "flex", alignItems: "center", gap: 6 }}
            >
              <span
                style={{
                  fontFamily: mono,
                  fontSize: 10,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: "rgba(255,255,255,0.35)",
                }}
              >
                {section}
              </span>
              <span style={{ color: "rgba(255,255,255,0.2)", fontSize: 12 }}>
                /
              </span>
            </span>
          ))}
          <span
            style={{
              fontFamily: mono,
              fontSize: 10,
              letterSpacing: "0.06em",
              color: C.copper,
            }}
          >
            {workspaceLabel}
          </span>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 0",
            marginLeft: 16,
          }}
        >
          <span
            style={{
              fontFamily: mono,
              fontSize: 9,
              color: "rgba(255,255,255,0.35)",
              letterSpacing: "0.04em",
            }}
          >
            Corpus Score:
          </span>
          <span
            style={{
              fontFamily: mono,
              fontSize: 13,
              fontWeight: 600,
              color: C.copper,
            }}
          >
            {corpusScore}
          </span>
          <div
            style={{
              width: 1,
              height: 22,
              background: "rgba(255,255,255,0.1)",
              margin: "0 6px",
            }}
          />
          <button
            onClick={() => setActiveTab("projects")}
            style={{
              fontFamily: display,
              fontSize: 12,
              fontWeight: 600,
              background: C.copper,
              color: "#fff",
              border: "none",
              borderRadius: 5,
              padding: "8px 16px",
              cursor: "pointer",
            }}
          >
            + Add Project
          </button>
          <button
            onClick={() => {
              setSession(null);
              setLoginData(null);
              setStep("email");
            }}
            style={{
              fontFamily: mono,
              fontSize: 10,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: "rgba(255,255,255,0.75)",
              background: "transparent",
              border: "1px solid rgba(255,255,255,0.25)",
              borderRadius: 5,
              padding: "8px 12px",
              cursor: "pointer",
            }}
          >
            Sign Out
          </button>
        </div>
      </div>

      <div
        style={{
          background: C.white,
          borderBottom: `1px solid ${C.rule}`,
          padding: "22px 28px 0",
        }}
      >
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <div
            style={{
              fontFamily: mono,
              fontSize: 10,
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              color: C.copper,
              marginBottom: 5,
              textAlign: "center",
            }}
          >
            Supplier Portal · Knowledge Base
          </div>

          <div
            style={{
              position: "relative",
              minHeight: 110,
              marginBottom: 18,
              paddingRight: 220,
            }}
          >
            <div
              style={{
                width: "100%",
                textAlign: "center",
                paddingTop: 8,
              }}
            >
              <h1
                style={{
                  fontFamily: display,
                  fontSize: 28,
                  fontWeight: 700,
                  color: C.ink,
                  marginBottom: 6,
                }}
              >
                Project & Knowledge Ingestion
              </h1>
              <p
                style={{
                  fontFamily: sans,
                  fontSize: 13.5,
                  color: C.inkMuted,
                  lineHeight: 1.65,
                }}
              >
                Build your manufacturing corpus. Past projects, process lessons, and
                quoting knowledge all improve your match standing and give your
                estimators richer context when quoting similar work.
              </p>
            </div>

            <button
              onClick={() => setActiveTab("projects")}
              style={{
                position: "absolute",
                right: 0,
                top: "50%",
                transform: "translateY(-30%)",
                fontFamily: display,
                fontSize: 12,
                fontWeight: 600,
                background: C.copper,
                color: "#fff",
                border: "none",
                borderRadius: 5,
                padding: "8px 16px",
                cursor: "pointer",
              }}
            >
              + Add Project
            </button>
          </div>

          <div style={{ display: "flex" }}>
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  fontFamily: mono,
                  fontSize: 10,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  padding: "10px 20px",
                  background: "transparent",
                  border: "none",
                  borderBottom:
                    activeTab === tab.id
                      ? `2px solid ${C.copper}`
                      : "2px solid transparent",
                  color: activeTab === tab.id ? C.ink : C.inkMuted,
                  cursor: "pointer",
                  fontWeight: activeTab === tab.id ? 500 : 400,
                  marginBottom: -1,
                  whiteSpace: "nowrap",
                }}
              >
                {tab.label}
                {tab.id === "projects" && corpusSaved.length > 0 && (
                  <span style={{ marginLeft: 5, fontSize: 10 }}>
                    ({corpusSaved.length})
                  </span>
                )}
                {tab.id === "capabilities" && processProfiles.length > 0 && (
                  <span style={{ marginLeft: 5, fontSize: 10 }}>
                    ({processProfiles.length})
                  </span>
                )}
                {tab.id === "analytics" && (
                  <span style={{ marginLeft: 5, fontSize: 10 }}>
                    ({corpusScore})
                  </span>
                )}
                {tab.id === "mfg" && mfgLessons.length > 0 && (
                  <span style={{ marginLeft: 5, fontSize: 10 }}>
                    ({mfgLessons.length})
                  </span>
                )}
                {tab.id === "quoting" && manualQuotingLessons.length > 0 && (
                  <span style={{ marginLeft: 5, fontSize: 10 }}>
                    ({manualQuotingLessons.length})
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ width: "100%", padding: "28px 28px" }}>
        <div style={{ display: activeTab === "dashboard" ? "block" : "none" }}>
          <div style={{ padding: "50px", background: "lightblue", fontSize: "24px" }}>
            Knowledge Base Dashboard - Session: {companyName} ({zohoId})
          </div>
        </div>

        <div style={{ display: activeTab === "projects" ? "block" : "none" }}>
          <div style={{ padding: "50px", background: "lightgreen", fontSize: "24px" }}>
            Projects Tab - Add and manage your past projects
          </div>
        </div>

        <div style={{ display: activeTab === "capabilities" ? "block" : "none" }}>
          <div style={{ padding: "50px", background: "lightyellow", fontSize: "24px" }}>
            Capabilities Tab - Process profiles and capabilities
          </div>
        </div>

        <div style={{ display: activeTab === "analytics" ? "block" : "none" }}>
          <div style={{ padding: "50px", background: "lightpink", fontSize: "24px" }}>
            Analytics Tab - View corpus analytics
          </div>
        </div>

        <div style={{ display: activeTab === "mfg" ? "block" : "none" }}>
          <div style={{ padding: "50px", background: "lightcyan", fontSize: "24px" }}>
            Mfg Lessons Tab - Manufacturing lessons learned
          </div>
        </div>

        <div style={{ display: activeTab === "quoting" ? "block" : "none" }}>
          <div style={{ padding: "50px", background: "lightcoral", fontSize: "24px" }}>
            Quoting Lessons Tab - Quoting lessons and manual lessons
          </div>
        </div>
      </div>
    </>
  );
}
