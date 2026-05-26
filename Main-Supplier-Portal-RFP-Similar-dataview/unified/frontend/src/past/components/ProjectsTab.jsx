import React, { useState, useCallback, useRef, useEffect } from "react";

const C = {
  ink: "#1B2D4F",
  inkSoft: "#2D4567",
  inkMuted: "#6B7F96",
  rule: "#CBD3DF",
  ruleLight: "#E2E8F0",
  surface: "#F2F4F8",
  offWhite: "#F0F3F8",
  white: "#FAFCFF",
  bg: "#E4E8F0",
  // gold / copper aliases â€” same hue, RFP names
  gold: "#B8920A",
  goldPale: "#F5F0DC",
  goldBright: "#D4AA12",
  copper: "#B8920A",
  copperPale: "#F5F0DC",
  copperBright: "#D4AA12",
  // navy scale
  navy: "#1B2D4F",
  navyDeep: "#111E33",
  navyMid: "#243754",
  navyLight: "#2D4567",
  pass: "#1E5E3A",
  passBg: "#E6F4EC",
  passRule: "rgba(30,94,58,0.2)",
  warn: "#7A2E0E",
  warnBg: "#FDF0EB",
  warnRule: "rgba(122,46,14,0.25)",
  blue: "#1A3D5C",
  bluePale: "#E8EFF8",
  blueMid: "#4A7BAF",
  zoho: "#E42527",
  zohoPale: "#FFF0F0",
};

const mono = "'IBM Plex Mono', monospace";
const display = "'Syne', sans-serif";
const sans = "'DM Sans', sans-serif";
const API_BASE = (import.meta.env.VITE_API_BASE || "http://127.0.0.1:8000").replace(/\/+$/, "");
const ANALYZE_API = `${API_BASE}/analyze`;
const ANALYZE_CAD_API = `${API_BASE}/analyze-cad`;
const EXTRACT_PDF_API = `${API_BASE}/extract-pdf`;
const PUSH_API = `${API_BASE}/push`;
const ZOHO_SYNC_API = `${API_BASE}/zoho-sync`;
const RENAME_PROJECT_API = `${API_BASE}/projects/rename`;
const PROJECT_SLOTS_KEY = "tb_demo_project_slots_v1";
const DELETED_PROJECT_IDS_KEY = "tb_demo_deleted_project_ids_v1";
const CAD_EXTENSIONS = [".stl", ".obj", ".ply", ".glb", ".gltf", ".step", ".stp", ".iges", ".igs"];
const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif", ".avif", ".tif", ".tiff"];
const resolveImageSrc = (src) => {
  if (!src) return "";
  const first = String(src).split(/[\r\n,;]+/).map((s) => s.trim()).find(Boolean) || "";
  if (!first) return "";
  if (first.startsWith("http://") || first.startsWith("https://") || first.startsWith("blob:") || first.startsWith("data:")) {
    if (first.includes("zohoapis.") || first.includes("zoho.")) {
      return `${API_BASE}/zoho-proxy-image?src=${encodeURIComponent(first)}`;
    }
    return first;
  }
  if (first.startsWith("/")) return `${API_BASE}${first}`;
  return `${API_BASE}/${first}`;
};

const resolveCadViewSrc = (view) => {
  if (!view) return "";
  if (view.data_url) return view.data_url;
  if (view.b64) return `data:image/jpeg;base64,${view.b64}`;
  return "";
};
const MATERIAL_OPTIONS = [
  "Al 6061",
  "Al 7075",
  "Al 2024",
  "SS 304",
  "SS 316",
  "SS 316L",
  "Titanium 6Al-4V",
  "Inconel 625",
  "4140 Steel",
  "H13 Steel",
  "Brass",
  "Copper",
  "PEEK",
  "Delrin",
  "Other / Custom",
];

function normalizeMaterialLabel(input) {
  const value = (input || "").toLowerCase().trim();
  if (!value) return "";
  if (value.includes("7075")) return "Al 7075";
  if (value.includes("6061")) return "Al 6061";
  if (value.includes("2024")) return "Al 2024";
  if (value.includes("316l")) return "SS 316L";
  if (value.includes("316")) return "SS 316";
  if (value.includes("304")) return "SS 304";
  if (value.includes("6al-4v") || value.includes("ti-6al-4v"))
    return "Titanium 6Al-4V";
  if (value.includes("inconel")) return "Inconel 625";
  if (value.includes("4140")) return "4140 Steel";
  if (value.includes("h13")) return "H13 Steel";
  if (value.includes("brass")) return "Brass";
  if (value.includes("copper")) return "Copper";
  if (value.includes("peek")) return "PEEK";
  if (value.includes("delrin")) return "Delrin";
  return "Other / Custom";
}

function makeAssetRecord(file, kind) {
  if (!file) return null;
  return {
    id: `${kind}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    kind,
    name: file.name,
    size: file.size,
    type: file.type,
    uploaded_at: new Date().toISOString(),
  };
}

function normalizeProjectAssets(assets) {
  const a = assets || {};
  return {
    rfp: a.rfp || null,
    quote: a.quote || null,
    workOrder: a.workOrder || null,
    files: Array.isArray(a.files) ? a.files : [],
  };
}

function mergeProjectAssets(existingRaw, incomingRaw) {
  const existing = normalizeProjectAssets(existingRaw);
  const incoming = normalizeProjectAssets(incomingRaw);
  const toKey = (asset) =>
    `${asset?.id || ""}|${asset?.name || ""}|${asset?.size || 0}|${asset?.kind || ""}|${asset?.uploaded_at || ""}`;
  const mergedFiles = [];
  const seen = new Set();
  [...(existing.files || []), ...(incoming.files || [])].forEach((asset) => {
    if (!asset) return;
    const k = toKey(asset);
    if (seen.has(k)) return;
    seen.add(k);
    mergedFiles.push(asset);
  });
  return {
    rfp: incoming.rfp || existing.rfp || null,
    quote: incoming.quote || existing.quote || null,
    workOrder: incoming.workOrder || existing.workOrder || null,
    files: mergedFiles,
  };
}

function inferAssetKind(fileName) {
  const n = String(fileName || "").toLowerCase();
  if (n.includes("rfp") || n.includes("rfq") || n.includes("request for proposal")) return "RFP";
  if (n.includes("quote") || n.includes("quotation")) return "Quote";
  if (n.includes("work order") || n.includes("workorder") || n.includes("wo_")) return "Work Order";
  return "Attachment";
}

function isCadFileName(name) {
  const n = String(name || "").toLowerCase();
  return CAD_EXTENSIONS.some((ext) => n.endsWith(ext));
}

function isCadFile(file) {
  const name = String(file?.name || "").toLowerCase();
  const type = String(file?.type || "").toLowerCase();
  return (
    isCadFileName(name) ||
    type.includes("model/") ||
    type.includes("step") ||
    type.includes("stl") ||
    type.includes("iges") ||
    type.includes("octet-stream")
  );
}

function isImageFile(file) {
  const n = String(file?.name || "").toLowerCase();
  return String(file?.type || "").startsWith("image/") || IMAGE_EXTENSIONS.some((ext) => n.endsWith(ext));
}

function formatBytes(bytes) {
  if (!bytes) return "0 KB";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const full = String(r.result || "");
      const base64 = full.includes(",") ? full.split(",")[1] : full;
      resolve(base64);
    };
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

// â”€â”€ primitives â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function FieldLabel({ children, badge }) {
  return (
    <label
      style={{
        display: "block",
        fontFamily: mono,
        fontSize: 9,
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        color: C.inkMuted,
        marginBottom: 6,
      }}
    >
      {children}
      {badge === "ai" && (
        <span
          style={{
            marginLeft: 6,
            fontFamily: mono,
            fontSize: 8,
            padding: "1px 5px",
            borderRadius: 2,
            background: C.gold,
            color: "#fff",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            verticalAlign: "middle",
          }}
        >
          Auto
        </span>
      )}
      {badge === "manual" && (
        <span
          style={{
            marginLeft: 6,
            fontFamily: mono,
            fontSize: 8,
            padding: "1px 5px",
            borderRadius: 2,
            background: "#2C3E50",
            color: "rgba(255,255,255,0.7)",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            verticalAlign: "middle",
          }}
        >
          Supplier
        </span>
      )}
    </label>
  );
}

function FieldInput({
  value,
  onChange,
  placeholder,
  multiline,
  rows = 3,
  aiPrefilled,
  disabled,
}) {
  const base = {
    width: "100%",
    fontFamily: sans,
    fontSize: 13,
    color: value ? C.inkSoft : C.inkMuted,
    background: aiPrefilled ? C.goldPale : C.surface,
    border: `1px solid ${aiPrefilled ? "rgba(184,115,51,0.4)" : C.rule}`,
    borderRadius: 4,
    padding: "9px 12px",
    lineHeight: 1.55,
    resize: "vertical",
    outline: "none",
    boxSizing: "border-box",
    opacity: disabled ? 0.5 : 1,
  };
  const h = {
    onFocus: (e) => {
      e.target.style.borderColor = C.gold;
    },
    onBlur: (e) => {
      e.target.style.borderColor = aiPrefilled
        ? "rgba(184,115,51,0.4)"
        : C.rule;
    },
  };
  if (multiline)
    return (
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        disabled={disabled}
        style={{ ...base, display: "block" }}
        {...h}
      />
    );
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      style={{ ...base, display: "block", minHeight: 36 }}
      {...h}
    />
  );
}

function SelectInput({ value, onChange, options, placeholder, disabled }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      style={{
        width: "100%",
        fontFamily: sans,
        fontSize: 13,
        color: value ? C.inkSoft : C.inkMuted,
        background: value ? C.goldPale : C.surface,
        border: `1px solid ${value ? "rgba(184,115,51,0.4)" : C.rule}`,
        borderRadius: 4,
        padding: "9px 12px",
        minHeight: 36,
        outline: "none",
        cursor: "pointer",
        opacity: disabled ? 0.6 : 1,
      }}
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

function Cell({ children, span, noBorderRight, noBorderBottom }) {
  return (
    <div
      style={{
        padding: "15px 20px",
        borderBottom: noBorderBottom ? "none" : `1px solid ${C.ruleLight}`,
        borderRight: noBorderRight ? "none" : `1px solid ${C.ruleLight}`,
        gridColumn: span === "full" ? "1 / -1" : undefined,
      }}
    >
      {children}
    </div>
  );
}

// â”€â”€ RFP-STYLE PRIMITIVES â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const Btn = ({ children, variant = "outline", onClick, style: s, sm, disabled }) => {
  const base = { fontFamily: display, fontSize: sm ? 11 : 12, fontWeight: 600, padding: sm ? "5px 11px" : "8px 16px", borderRadius: 4, cursor: disabled ? "not-allowed" : "pointer", letterSpacing: "0.01em", border: "none", transition: "filter 0.12s", opacity: disabled ? 0.4 : 1 };
  const v = {
    primary:  { background: C.navy,   color: C.white },
    accent:   { background: C.gold,   color: "#fff" },
    outline:  { background: "transparent", color: C.ink, border: `1px solid ${C.rule}` },
    ghost:    { background: "transparent", color: C.inkMuted, border: `1px solid ${C.ruleLight}`, fontSize: 11, padding: "5px 12px" },
    green:    { background: C.pass,   color: "#fff" },
    navy:     { background: C.navyMid, color: "rgba(255,255,255,0.85)", border: "1px solid rgba(255,255,255,0.12)" },
  };
  return (
    <button
      style={{ ...base, ...v[variant], ...s }}
      onMouseEnter={e => { if (!disabled) e.currentTarget.style.filter = "brightness(0.88)"; }}
      onMouseLeave={e => e.currentTarget.style.filter = ""}
      onClick={disabled ? undefined : onClick}
    >
      {children}
    </button>
  );
};

const Card = ({ children, style: s, ...rest }) => (
  <div {...rest} style={{ background: C.white, border: `1px solid ${C.rule}`, borderRadius: 8, overflow: "hidden", boxShadow: "0 1px 4px rgba(20,28,36,0.08)", ...s }}>
    {children}
  </div>
);

const CardHead = ({ title, sub, right }) => (
  <div style={{ padding: "11px 18px", background: C.surface, borderBottom: `1px solid ${C.rule}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ fontFamily: display, fontSize: 13, fontWeight: 700, color: C.ink }}>{title}</span>
      {sub && <span style={{ fontFamily: mono, fontSize: 9, color: C.inkMuted, textTransform: "uppercase", letterSpacing: "0.06em" }}>{sub}</span>}
    </div>
    {right && <div>{right}</div>}
  </div>
);

function OutcomeRadios({ value, onChange }) {
  const opts = [
    { label: "First article accepted", id: "Successful" },
    { label: "Rework required", id: "Rework Required" },
    { label: "NCR issued", id: "NCR Issued" },
    { label: "Scrapped", id: "Scrapped" },
  ];
  return (
    <div>
      <FieldLabel badge="manual">Outcome</FieldLabel>
      <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
        {opts.map((opt) => {
          const active = value === opt.id;
          return (
            <label
              key={opt.id}
              onClick={() => onChange(opt.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                cursor: "pointer",
                fontFamily: sans,
                fontSize: 13,
                color: active ? C.pass : C.inkSoft,
                userSelect: "none",
              }}
            >
              <span
                style={{
                  width: 15,
                  height: 15,
                  borderRadius: "50%",
                  flexShrink: 0,
                  border: `1.5px solid ${active ? C.pass : C.rule}`,
                  background: active ? C.passBg : "transparent",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {active && (
                  <span
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: "50%",
                      background: C.pass,
                      display: "block",
                    }}
                  />
                )}
              </span>
              {opt.label}
            </label>
          );
        })}
      </div>
    </div>
  );
}

function AiSpinner({ mode = "image" }) {
  const isCad = mode === "cad";
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 14,
        padding: "36px 20px",
      }}
    >
      <div style={{ position: "relative", width: 44, height: 44 }}>
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: "50%",
            border: `3px solid ${C.goldPale}`,
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: "50%",
            border: "3px solid transparent",
            borderTopColor: C.gold,
            animation: "spin 0.9s linear infinite",
          }}
        />
      </div>
      <div
        style={{
          fontFamily: mono,
          fontSize: 10,
          color: C.gold,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
        }}
      >
        {isCad ? "Converting CAD + field extraction..." : "Processing image..."}
      </div>
      <div
        style={{
          fontFamily: sans,
          fontSize: 12,
          color: C.inkMuted,
          textAlign: "center",
          maxWidth: 260,
          lineHeight: 1.6,
        }}
      >
        {isCad
          ? "Generating readable CAD preview, then extracting material, process, family, finish and project details."
          : "Detecting part family, material, process, finish, complexity and tolerance class."}
      </div>
    </div>
  );
}

function ConfBar({ pct }) {
  const color = pct >= 0.85 ? C.pass : pct >= 0.65 ? C.gold : C.warn;
  return (
    <div
      style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3 }}
    >
      <div
        style={{
          flex: 1,
          height: 3,
          background: C.ruleLight,
          borderRadius: 2,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${Math.round(pct * 100)}%`,
            background: color,
            borderRadius: 2,
            transition: "width 0.5s ease",
          }}
        />
      </div>
      <span
        style={{
          fontFamily: mono,
          fontSize: 9,
          color,
          letterSpacing: "0.04em",
          width: 28,
          textAlign: "right",
        }}
      >
        {Math.round(pct * 100)}%
      </span>
    </div>
  );
}

// â”€â”€ ZOHO SYNC BUTTON â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function ZohoSyncButton({ snapshot, supplierEmail }) {
  const [status, setStatus] = useState("idle"); // idle | syncing | ok | error
  const [errorMsg, setError] = useState("");

  const handleSync = async () => {
    setStatus("syncing");
    setError("");

    const { projectFields, parts } = snapshot;
    const companyName = parts[0]?.company_name || projectFields.customer || "";

    try {
      const syncParts = await Promise.all(
        parts.map(async (part) => {
          let img_b64 = "";
          let img_ext = ".jpg";
          if ((part.image_preview || "").startsWith("blob:")) {
            try {
              const resp = await fetch(part.image_preview);
              const blob = await resp.blob();
              img_ext = blob.type === "image/png" ? ".png" : ".jpg";
              img_b64 = await new Promise((resolve) => {
                const r = new FileReader();
                r.onload = () => resolve(String(r.result || "").split(",")[1] || "");
                r.readAsDataURL(blob);
              });
            } catch (_) {}
          } else if ((part.image_preview || "").startsWith("data:")) {
            img_b64 = String(part.image_preview).split(",")[1] || "";
          }

          return {
            part_id: part.part_id || "",
            company_name: companyName,
            zoho_id: part.zoho_id || "",
            supplier_email: (supplierEmail || "").toLowerCase(),
            project_name: projectFields.project_name || part.part_name || "",
            part_family: part.part_family || "",
            material: part.material || "",
            process_primary: part.process_primary || "",
            process_secondary: part.process_secondary || "",
            complexity_class: part.complexity_class || "",
            tolerance_class: part.tolerance_class || "",
            outcome: part.outcome || "",
            ncr_description: part.ncr_description || "",
            what_worked: part.what_worked || "",
            what_didnt: part.what_didnt || "",
            customer_industry: projectFields.customer_industry || "",
            project_date: part.project_date || "",
            image_url: part.image_url || "",
            image_b64: img_b64,
            image_ext: img_ext,
            cad_filename: part.cad_filename || "",
            cad_file_b64: part.cad_file_b64 || "",
            cad_preview_b64: part.cad_preview_b64 || "",
            cad_preview_filename: part.cad_preview_filename || "",
            cad_extra_views: part.cad_extra_views || [],
          };
        }),
      );

      const res = await fetch(ZOHO_SYNC_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parts: syncParts }),
      });
      const data = await res.json();
      if (data.ok) {
        setStatus("ok");
      } else {
        setStatus("error");
        setError(data.error || data.results?.[0]?.error || "Sync failed");
      }
    } catch (e) {
      setStatus("error");
      setError(e.message);
    }
  };

  if (status === "ok") {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "7px 14px",
          background: C.passBg,
          border: `1px solid ${C.passRule}`,
          borderRadius: 5,
          fontFamily: mono,
          fontSize: 9,
          color: C.pass,
          letterSpacing: "0.04em",
        }}
      >
        âœ“ Synced to Zoho CRM
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <button
        onClick={handleSync}
        disabled={status === "syncing"}
        style={{
          fontFamily: mono,
          fontSize: 10,
          letterSpacing: "0.05em",
          textTransform: "uppercase",
          padding: "7px 16px",
          borderRadius: 5,
          border: `1.5px solid ${status === "error" ? C.warn : "rgba(228,37,39,0.35)"}`,
          background: status === "error" ? C.warnBg : C.zohoPale,
          color: status === "error" ? C.warn : C.zoho,
          cursor: status === "syncing" ? "not-allowed" : "pointer",
          opacity: status === "syncing" ? 0.6 : 1,
          display: "flex",
          alignItems: "center",
          gap: 6,
          transition: "all 0.15s",
          whiteSpace: "nowrap",
        }}
      >
        {status === "syncing" ? (
          <>
            <span
              style={{
                display: "inline-block",
                width: 8,
                height: 8,
                borderRadius: "50%",
                border: "1.5px solid transparent",
                borderTopColor: C.zoho,
                animation: "spin 0.8s linear infinite",
              }}
            />
            Syncingâ€¦
          </>
        ) : (
          <>
            <span style={{ fontSize: 11 }}>â‡ª</span>
            {status === "error" ? "Retry Zoho Sync" : "Sync to Zoho CRM"}
          </>
        )}
      </button>
      {status === "error" && (
        <div
          style={{
            fontFamily: mono,
            fontSize: 9,
            color: C.warn,
            letterSpacing: "0.03em",
            maxWidth: 240,
          }}
        >
          âœ• {errorMsg}
        </div>
      )}
    </div>
  );
}

// â”€â”€ IMAGE DROP ZONE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function UnifiedUploadDropZone({ onFilesSelected, compact = false }) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef();
  const handle = (fileList) => {
    const files = Array.from(fileList || []);
    if (files.length) onFilesSelected(files);
  };
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); handle(e.dataTransfer.files); }}
      style={{
        border: `2px dashed ${dragging ? C.gold : C.rule}`,
        borderRadius: 8,
        padding: "14px 16px",
        background: dragging ? C.goldPale : C.surface,
        transition: "all 0.15s",
        marginBottom: 10,
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept="*/*"
        multiple
        style={{ display: "none" }}
        onChange={(e) => handle(e.target.files)}
      />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontFamily: display, fontSize: 14, fontWeight: 700, color: C.ink, marginBottom: 4 }}>
            {compact ? "Add More Project Files" : "Upload Project Files"}
          </div>
          <div style={{ fontSize: 12.5, color: C.inkMuted, lineHeight: 1.5 }}>
            {compact
              ? "Drag additional files or click Browse."
              : "RFP, quote, work order, images, CAD, PDFs â€” drop or browse. Max 3 at a time."}
          </div>
        </div>
        <Btn sm variant="ghost" onClick={() => inputRef.current?.click()}>Browse</Btn>
      </div>
    </div>
  );
}

function DocumentUploadTile({ title, sub, icon, accept, onSelect, asset }) {
  const inputRef = useRef();
  return (
    <div
      onClick={() => inputRef.current?.click()}
      style={{
        border: `1px dashed ${asset ? "rgba(30,94,58,0.35)" : C.rule}`,
        borderRadius: 8,
        padding: "16px 14px",
        background: asset ? C.passBg : C.surface,
        cursor: "pointer",
        minHeight: 118,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        style={{ display: "none" }}
        onChange={(e) => onSelect(e.target.files?.[0] || null)}
      />
      <div>
        <div style={{ fontSize: 22, marginBottom: 8 }}>{icon}</div>
        <div
          style={{
            fontFamily: display,
            fontSize: 13,
            fontWeight: 700,
            color: C.ink,
            marginBottom: 4,
          }}
        >
          {title}
        </div>
        <div
          style={{
            fontFamily: sans,
            fontSize: 11.5,
            color: C.inkMuted,
            lineHeight: 1.5,
          }}
        >
          {sub}
        </div>
      </div>
      <div
        style={{
          marginTop: 10,
          fontFamily: mono,
          fontSize: 9,
          color: asset ? C.pass : C.gold,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
        }}
      >
        {asset
          ? `${asset.name} Â· ${formatBytes(asset.size)}`
          : "Click to upload"}
      </div>
    </div>
  );
}

function ImageLightbox({ src, open, onClose }) {
  if (!open || !src) return null;
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(15,20,28,0.78)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <img
        src={src}
        alt="part expanded"
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: "92vw",
          maxHeight: "90vh",
          objectFit: "contain",
          borderRadius: 8,
          border: `1px solid ${C.rule}`,
          background: C.white,
          boxShadow: "0 16px 40px rgba(0,0,0,0.35)",
        }}
      />
      <button
        onClick={onClose}
        style={{
          position: "fixed",
          top: 18,
          right: 20,
          width: 34,
          height: 34,
          borderRadius: "50%",
          border: "1px solid rgba(255,255,255,0.35)",
          background: "rgba(0,0,0,0.35)",
          color: "#fff",
          cursor: "pointer",
          fontSize: 18,
          lineHeight: 1,
        }}
      >
        Ã—
      </button>
    </div>
  );
}

// â”€â”€ ANALYSED PART FORM â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const AnalysedPartForm = React.memo(function AnalysedPartForm({ partData, onUpdate, onRemove, partId, imagePreview }) {
  const set = (k) => (v) => onUpdate({ ...partData, [k]: v });
  const handleRemove = useCallback(() => onRemove(partId), [onRemove, partId]);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const imageSrc = resolveImageSrc(imagePreview || partData.image_url || "");
  return (
    <div
      style={{
        border: `1px solid ${C.rule}`,
        borderRadius: 8,
        overflow: "hidden",
        background: C.white,
        boxShadow: "0 1px 4px rgba(20,28,36,0.08)",
        marginBottom: 16,
      }}
    >
      {/* Part header â€” RFP-style light CardHead */}
      <div
        style={{
          background: C.surface,
          padding: "10px 16px",
          borderBottom: `1px solid ${C.rule}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontFamily: mono, fontSize: 10, color: C.gold, fontWeight: 600, letterSpacing: "0.05em" }}>
            {partData.part_label}
          </span>
          <span style={{ fontFamily: mono, fontSize: 10, color: C.inkSoft }}>
            {partData.part_family} Â· {partData.material}
          </span>
          <span
            style={{
              fontFamily: mono,
              fontSize: 8,
              padding: "2px 7px",
              borderRadius: 3,
              background: partData.source === "gemini" ? C.goldPale : C.warnBg,
              color: partData.source === "gemini" ? C.gold : C.warn,
              border: `1px solid ${partData.source === "gemini" ? "rgba(184,146,10,0.3)" : C.warnRule}`,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            {partData.source === "gemini" ? "Auto" : "Fallback"}
          </span>
        </div>
        <button
          onClick={handleRemove}
          style={{
            fontFamily: mono,
            fontSize: 9,
            background: "none",
            border: `1px solid ${C.rule}`,
            borderRadius: 4,
            padding: "3px 8px",
            color: C.inkMuted,
            cursor: "pointer",
            textTransform: "uppercase",
            letterSpacing: "0.04em",
          }}
        >
          Remove
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "260px 1fr" }}>
        <div
          style={{
            borderRight: `1px solid ${C.ruleLight}`,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            style={{
              padding: "14px 16px",
              borderBottom: `1px solid ${C.ruleLight}`,
            }}
          >
            <FieldLabel>Part Image</FieldLabel>
            <div
              style={{
                width: "100%",
                aspectRatio: "4/3",
                borderRadius: 6,
                overflow: "hidden",
                background: C.surface,
                border: `1px solid ${C.rule}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {imagePreview ? (
                <img
                  src={imageSrc}
                  alt="part"
                  onClick={() => setLightboxOpen(true)}
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "contain",
                    cursor: "zoom-in",
                  }}
                />
              ) : (
                <span
                  style={{ fontFamily: mono, fontSize: 10, color: C.inkMuted }}
                >
                  No image
                </span>
              )}
            </div>
          </div>
          <div style={{ padding: "14px 16px", flex: 1 }}>
            <FieldLabel>Detection Confidence</FieldLabel>
            <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
              {[
                {
                  label: "Part Family",
                  val: partData.part_family,
                  conf: partData.part_family_conf,
                },
                {
                  label: "Material",
                  val: partData.material,
                  conf: partData.material_conf,
                },
                {
                  label: "Process",
                  val: partData.process_primary,
                  conf: partData.process_conf,
                },
                {
                  label: "Finish",
                  val: partData.finish,
                  conf: partData.finish_conf,
                },
              ].map(({ label, val, conf }) => (
                <div key={label}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      marginBottom: 1,
                    }}
                  >
                    <span
                      style={{
                        fontFamily: mono,
                        fontSize: 9,
                        color: C.inkMuted,
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                      }}
                    >
                      {label}
                    </span>
                    <span
                      style={{
                        fontFamily: sans,
                        fontSize: 11,
                        color: C.inkSoft,
                        maxWidth: 110,
                        textAlign: "right",
                        overflow: "hidden",
                        whiteSpace: "nowrap",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {val || "â€”"}
                    </span>
                  </div>
                  <ConfBar pct={conf || 0} />
                </div>
              ))}
            </div>
            {partData.features?.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <FieldLabel>Detected Features</FieldLabel>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {partData.features.map((f) => (
                    <span
                      key={f}
                      style={{
                        fontFamily: mono,
                        fontSize: 9,
                        padding: "2px 6px",
                        borderRadius: 2,
                        background: C.bluePale,
                        color: C.blue,
                        border: "1px solid rgba(26,61,92,0.15)",
                      }}
                    >
                      {f}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {partData.notes && (
              <div
                style={{
                  marginTop: 10,
                  padding: "8px 10px",
                  background: C.warnBg,
                  border: `1px solid ${C.warnRule}`,
                  borderRadius: 4,
                }}
              >
                <div
                  style={{
                    fontFamily: mono,
                    fontSize: 9,
                    color: C.warn,
                    marginBottom: 2,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                  }}
                >
                  Note
                </div>
                <div
                  style={{
                    fontFamily: sans,
                    fontSize: 11,
                    color: C.inkSoft,
                    lineHeight: 1.5,
                  }}
                >
                  {partData.notes}
                </div>
              </div>
            )}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>
          <Cell>
            <FieldLabel badge="manual">Part Name / Label</FieldLabel>
            <FieldInput
              value={partData.part_name}
              onChange={set("part_name")}
              placeholder="e.g. Actuator Jaw, Drive Shaft..."
            />
          </Cell>
          <Cell noBorderRight>
            <FieldLabel badge="manual">Project Date</FieldLabel>
            <FieldInput
              value={partData.project_date}
              onChange={set("project_date")}
              placeholder="e.g. 2025-03"
            />
          </Cell>
          <Cell>
            <FieldLabel badge="ai">Material</FieldLabel>
            <input
              list="material-suggestions"
              value={partData.material}
              onChange={(e) => set("material")(e.target.value)}
              placeholder="Type material (e.g. Plastic, Al 7075, SS 316)"
              style={{
                width: "100%",
                fontFamily: sans,
                fontSize: 13,
                color: C.inkSoft,
                background: C.surface,
                border: `1px solid ${C.rule}`,
                borderRadius: 4,
                padding: "9px 12px",
                minHeight: 36,
                outline: "none",
              }}
            />
            <datalist id="material-suggestions">
              {[
                "Plastic",
                "Nylon",
                "ABS",
                "POM / Delrin",
                "PEEK",
                "Polycarbonate",
                ...MATERIAL_OPTIONS,
              ].map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
            {partData.material_raw &&
              partData.material_raw !== partData.material && (
              <div
                style={{
                  marginTop: 4,
                  fontFamily: sans,
                  fontSize: 11,
                  color: C.inkMuted,
                  fontStyle: "italic",
                  lineHeight: 1.5,
                }}
              >
                Detected: {partData.material_raw}
              </div>
            )}
            {partData.material_reasoning && (
              <div
                style={{
                  marginTop: 4,
                  fontFamily: sans,
                  fontSize: 11,
                  color: C.inkMuted,
                  fontStyle: "italic",
                  lineHeight: 1.5,
                }}
              >
                {partData.material_reasoning}
              </div>
            )}
          </Cell>
          <Cell noBorderRight>
            <FieldLabel badge="ai">Manufacturing Process</FieldLabel>
            <FieldInput
              value={partData.process_primary}
              onChange={set("process_primary")}
              multiline
              rows={2}
              aiPrefilled={!!partData.process_primary}
              placeholder="Auto-detected from uploaded file..."
            />
          </Cell>
          <Cell>
            <FieldLabel badge="ai">Finish / Surface Treatment</FieldLabel>
            <FieldInput
              value={partData.finish}
              onChange={set("finish")}
              multiline
              rows={2}
              aiPrefilled={!!partData.finish}
              placeholder="Auto-detected from uploaded file..."
            />
            {partData.finish_ra && partData.finish_ra !== "â€”" && (
              <div
                style={{
                  marginTop: 3,
                  fontFamily: mono,
                  fontSize: 10,
                  color: C.inkMuted,
                }}
              >
                Ra: {partData.finish_ra}
              </div>
            )}
          </Cell>
          {/* Part Family, Part Family Detail, and Complexity Class are hidden from UI â€” used internally for matching only */}
          <Cell noBorderRight>
            <FieldLabel badge="ai">Tolerance Class</FieldLabel>
            <SelectInput
              value={partData.tolerance_class}
              onChange={set("tolerance_class")}
              options={["STANDARD", "PRECISION", "HIGH_PRECISION"]}
              placeholder="â€” select â€”"
            />
          </Cell>
          <Cell span="full" noBorderRight>
            <OutcomeRadios value={partData.outcome} onChange={set("outcome")} />
          </Cell>
          <Cell span="full" noBorderRight>
            <FieldLabel badge="manual">What Worked â€” Manufacturing</FieldLabel>
            <FieldInput
              value={partData.what_worked}
              onChange={set("what_worked")}
              multiline
              rows={3}
              placeholder="Fixturing, toolpath, inspection setup â€” what you'd repeat next time."
            />
          </Cell>
          <Cell span="full" noBorderRight>
            <FieldLabel badge="manual">
              What Didn't Work / Lessons Learned
            </FieldLabel>
            <FieldInput
              value={partData.what_didnt}
              onChange={set("what_didnt")}
              multiline
              rows={3}
              placeholder="First-article deviations, rework triggers, thermal surprises. Stays private."
            />
            <div
              style={{
                marginTop: 5,
                fontFamily: sans,
                fontSize: 11,
                color: C.inkMuted,
                fontStyle: "italic",
              }}
            >
              Private by default. Never shared with buyers.
            </div>
          </Cell>
        </div>
      </div>
      <ImageLightbox
        src={imageSrc}
        open={lightboxOpen}
        onClose={() => setLightboxOpen(false)}
      />
    </div>
  );
}

function ProjectMeta({ fields, onChange }) {
  const set = (k) => (v) => onChange({ ...fields, [k]: v });
  const inputSt = { width: "100%", padding: "8px 9px", border: `1px solid ${C.rule}`, borderRadius: 5, background: C.white, color: C.ink, fontSize: 12, boxSizing: "border-box" };
  const labelSt = { fontFamily: mono, fontSize: 8, color: C.inkMuted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 };
  return (
    <Card style={{ marginBottom: 14 }}>
      <CardHead title="Project Details" sub="Job Â· Customer Â· Industry Â· Overview" />
      <div style={{ padding: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div>
          <div style={labelSt}>Job / Internal ID</div>
          <input value={fields.job_id} onChange={e => set("job_id")(e.target.value)} placeholder="JOB-1234" style={inputSt} />
        </div>
        <div>
          <div style={labelSt}>Customer Name</div>
          <input value={fields.customer} onChange={e => set("customer")(e.target.value)} placeholder="Customer name (anonymized in sharing)" style={inputSt} />
        </div>
        <div>
          <div style={labelSt}>Project Name</div>
          <input value={fields.project_name} onChange={e => set("project_name")(e.target.value)} placeholder="e.g. Aerospace Actuator Assembly" style={inputSt} />
        </div>
        <div>
          <div style={labelSt}>Customer Industry</div>
          <select value={fields.customer_industry} onChange={e => set("customer_industry")(e.target.value)} style={{ ...inputSt, cursor: "pointer" }}>
            <option value="">â€” select industry â€”</option>
            {["Aerospace","Medical","Automotive","Robotics","Defence","Industrial","Energy","Consumer","Other"].map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <div style={labelSt}>Project Overview <span style={{ fontFamily: mono, fontSize: 8, padding: "1px 5px", borderRadius: 2, background: C.gold, color: "#fff", textTransform: "uppercase", letterSpacing: "0.05em", marginLeft: 4, verticalAlign: "middle" }}>Auto</span></div>
          <textarea
            value={fields.overview}
            onChange={e => set("overview")(e.target.value)}
            rows={3}
            placeholder="Auto-filled after first image analysis â€” or describe the job yourself."
            style={{ ...inputSt, resize: "vertical", background: fields.overview ? C.goldPale : C.white, border: `1px solid ${fields.overview ? "rgba(184,146,10,0.35)" : C.rule}` }}
          />
        </div>
      </div>
    </Card>
  );
}

function SharingTier({ value, onChange }) {
  const tiers = [
    { key: "Private",    icon: "âŠ˜", desc: "Your team only",                                 pts: 0 },
    { key: "Anonymized", icon: "~", desc: "TrustBridge patterns only â€” no attribution",      pts: 6 },
    { key: "Attributed", icon: "âœ¦", desc: "Boosts match standing â€” referenced with your name", pts: 12 },
  ];
  return (
    <Card style={{ marginBottom: 14 }}>
      <CardHead title="Data Sharing Tier" sub="Controls corpus visibility" />
      <div style={{ padding: 12, display: "flex", gap: 8 }}>
        {tiers.map((t) => {
          const active = value === t.key;
          return (
            <div
              key={t.key}
              onClick={() => onChange(t.key)}
              style={{
                flex: 1,
                padding: "10px 12px",
                borderRadius: 6,
                border: `1.5px solid ${active ? C.gold : C.rule}`,
                background: active ? C.goldPale : "transparent",
                cursor: "pointer",
                transition: "all 0.12s",
              }}
            >
              <div style={{ fontFamily: mono, fontSize: 10, color: active ? C.gold : C.inkMuted, letterSpacing: "0.04em", marginBottom: 3 }}>
                {t.icon} {t.key}
              </div>
              <div style={{ fontFamily: sans, fontSize: 11, color: C.inkMuted, lineHeight: 1.4 }}>
                {t.desc}
              </div>
              {active && t.pts > 0 && (
                <div style={{ marginTop: 4, fontFamily: mono, fontSize: 9, color: C.pass }}>
                  +{t.pts} pts match
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
};

// â”€â”€ SAVED PROJECT CARD â€” with Zoho Sync button â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const SavedProjectCard = React.memo(function SavedProjectCard({
  slotId,
  snapshot,
  onEditProject,
  onDeleteProject,
  onRenameProject,
  supplierEmail,
}) {
  const [expanded, setExpanded] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [nameVal, setNameVal] = useState("");
  const { projectFields, parts, sharingTier, assets = {} } = snapshot;
  const handleEditClick = useCallback((event) => {
    event.stopPropagation();
    onEditProject?.(slotId);
  }, [onEditProject, slotId]);
  const handleDeleteClick = useCallback((event) => {
    event.stopPropagation();
    onDeleteProject?.(slotId);
  }, [onDeleteProject, slotId]);
  const normalizedAssets = normalizeProjectAssets(assets);
  const uploadedAssets = normalizedAssets.files.length
    ? normalizedAssets.files
    : [normalizedAssets.rfp, normalizedAssets.quote, normalizedAssets.workOrder].filter(Boolean);
  const tierColor = {
    Attributed: C.gold,
    Anonymized: C.blue,
    Private: C.inkMuted,
  };

  return (
    <Card
      style={{
        marginBottom: 12,
        animation: "up 0.25s ease",
      }}
    >
      <div
        onClick={() => setExpanded((e) => !e)}
        style={{
          padding: "14px 20px",
          background: C.white,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          borderBottom: expanded ? `1px solid ${C.rule}` : "none",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 5,
            minWidth: 0,
            flex: 1,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            {projectFields.job_id && (
              <span
                style={{
                  fontFamily: mono,
                  fontSize: 10,
                  color: C.gold,
                  letterSpacing: "0.05em",
                  flexShrink: 0,
                }}
              >
                {projectFields.job_id}
              </span>
            )}
            {editingName ? (
              <input
                autoFocus
                value={nameVal}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setNameVal(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter" && nameVal.trim()) {
                    onRenameProject?.(slotId, nameVal.trim());
                    setEditingName(false);
                  } else if (e.key === "Escape") {
                    setEditingName(false);
                  }
                }}
                onBlur={() => {
                  if (nameVal.trim()) onRenameProject?.(slotId, nameVal.trim());
                  setEditingName(false);
                }}
                style={{
                  fontFamily: sans,
                  fontSize: 15,
                  fontWeight: 600,
                  color: C.ink,
                  border: `1px solid ${C.gold}`,
                  borderRadius: 4,
                  padding: "2px 6px",
                  outline: "none",
                  background: C.goldPale,
                  minWidth: 180,
                  flex: 1,
                }}
              />
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                <span
                  style={{
                    fontFamily: sans,
                    fontSize: 15,
                    fontWeight: 600,
                    color: C.ink,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {projectFields.project_name || "Untitled Project"}
                </span>
                <span
                  onClick={(e) => {
                    e.stopPropagation();
                    setNameVal(projectFields.project_name || "");
                    setEditingName(true);
                  }}
                  title="Rename project"
                  style={{
                    cursor: "pointer",
                    fontSize: 13,
                    color: C.gold,
                    flexShrink: 0,
                    lineHeight: 1,
                    padding: "2px 4px",
                    borderRadius: 3,
                    border: `1px solid ${C.gold}`,
                    opacity: 0.75,
                  }}
                >
                  âœŽ
                </span>
              </div>
            )}
          </div>
          <div
            style={{
              fontFamily: mono,
              fontSize: 9,
              color: C.inkMuted,
              letterSpacing: "0.03em",
              display: "flex",
              gap: 6,
              flexWrap: "wrap",
            }}
          >
            {[
              projectFields.project_name,
              parts[0]?.project_date,
              parts[0]?.process_primary,
              parts[0]?.material,
            ]
              .filter(Boolean)
              .map((item, i, arr) => (
                <span key={i}>
                  {item}
                  {i < arr.length - 1 && (
                    <span style={{ marginLeft: 6, opacity: 0.4 }}>Â·</span>
                  )}
                </span>
              ))}
          </div>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexShrink: 0,
          }}
        >
          {sharingTier !== "Private" && (
            <span
              style={{
                fontFamily: mono,
                fontSize: 9,
                padding: "3px 9px",
                borderRadius: 3,
                background: C.passBg,
                color: C.pass,
                border: `1px solid ${C.passRule}`,
                letterSpacing: "0.04em",
                whiteSpace: "nowrap",
              }}
            >
              +{sharingTier === "Attributed" ? 12 : 6} pts match
            </span>
          )}
          <span
            style={{
              fontFamily: mono,
              fontSize: 9,
              padding: "3px 9px",
              borderRadius: 3,
              color: tierColor[sharingTier] || C.inkMuted,
              border: `1px solid ${tierColor[sharingTier] || C.rule}`,
              letterSpacing: "0.04em",
              whiteSpace: "nowrap",
            }}
          >
            {sharingTier === "Attributed"
              ? "âœ¦ Attributed"
              : sharingTier === "Anonymized"
                ? "~ Anonymized"
                : "âŠ˜ Private"}
          </span>
          <span style={{ fontFamily: mono, fontSize: 11, color: C.inkMuted }}>
            {expanded ? "â–²" : "â–¾"}
          </span>
        </div>
      </div>

      {expanded && (
        <div style={{ borderTop: `1px solid ${C.ruleLight}` }}>
          <div
            style={{
              padding: "16px 18px",
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gap: "10px 20px",
              borderBottom: `1px solid ${C.ruleLight}`,
            }}
          >
            {[
              { label: "Job ID", val: projectFields.job_id },
              { label: "Customer", val: projectFields.customer },
              { label: "Industry", val: projectFields.customer_industry },
            ].map(({ label, val }) =>
              val ? (
                <div key={label}>
                  <div
                    style={{
                      fontFamily: mono,
                      fontSize: 9,
                      color: C.inkMuted,
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                      marginBottom: 3,
                    }}
                  >
                    {label}
                  </div>
                  <div
                    style={{ fontFamily: sans, fontSize: 12, color: C.inkSoft }}
                  >
                    {val}
                  </div>
                </div>
              ) : null,
            )}
          </div>
          {projectFields.overview && (
            <div
              style={{
                padding: "12px 18px",
                borderBottom: `1px solid ${C.ruleLight}`,
              }}
            >
              <div
                style={{
                  fontFamily: mono,
                  fontSize: 9,
                  color: C.inkMuted,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  marginBottom: 4,
                }}
              >
                Overview
              </div>
              <div
                style={{
                  fontFamily: sans,
                  fontSize: 12,
                  color: C.inkSoft,
                  lineHeight: 1.6,
                }}
              >
                {projectFields.overview}
              </div>
            </div>
          )}
          {uploadedAssets.length > 0 && (
            <div
              style={{
                padding: "12px 18px",
                borderBottom: `1px solid ${C.ruleLight}`,
              }}
            >
              <div
                style={{
                  fontFamily: mono,
                  fontSize: 9,
                  color: C.inkMuted,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  marginBottom: 8,
                }}
              >
                Uploaded Project Files
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {uploadedAssets.map((asset) => (
                    <span
                      key={asset.id}
                      style={{
                        fontFamily: mono,
                        fontSize: 9,
                        padding: "5px 8px",
                        borderRadius: 4,
                        background: C.surface,
                        border: `1px solid ${C.rule}`,
                        color: C.inkSoft,
                      }}
                    >
                      {asset.kind}: {asset.name}
                    </span>
                  ))}
              </div>
            </div>
          )}
          <div style={{ padding: "14px 18px" }}>
            <div
              style={{
                fontFamily: mono,
                fontSize: 9,
                color: C.inkMuted,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                marginBottom: 10,
              }}
            >
              Parts ({parts.length})
            </div>
            {parts.map((part) => (
              <div
                key={part.part_id}
                style={{
                  border: `1px solid ${C.rule}`,
                  borderRadius: 6,
                  overflow: "hidden",
                  marginBottom: 10,
                }}
              >
                <div
                  style={{
                    padding: "9px 14px",
                    background: C.surface,
                    borderBottom: `1px solid ${C.ruleLight}`,
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                  }}
                >
                  <span
                    style={{ fontFamily: mono, fontSize: 10, color: C.gold }}
                  >
                    {part.part_label}
                  </span>
                  <span
                    style={{
                      fontFamily: sans,
                      fontSize: 12,
                      color: C.ink,
                      fontWeight: 600,
                    }}
                  >
                    {part.part_name || part.part_family || "â€”"}
                  </span>
                  <span
                    style={{ fontFamily: mono, fontSize: 9, color: C.inkMuted }}
                  >
                    Â· {part.material}
                  </span>
                  <span
                    style={{
                      fontFamily: mono,
                      fontSize: 8,
                      padding: "1px 5px",
                      borderRadius: 2,
                      background: part.source === "gemini" ? C.gold : C.warn,
                      color: "#fff",
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                    }}
                  >
                    {part.source === "gemini" ? "Auto" : "Fallback"}
                  </span>
                  {(part.image_preview || part.image_url) && (
                    <img
                      src={resolveImageSrc(part.image_preview || part.image_url)}
                      alt=""
                      onClick={() =>
                        setLightboxSrc(
                          resolveImageSrc(part.image_preview || part.image_url),
                        )
                      }
                      style={{
                        marginLeft: "auto",
                        width: 86,
                        height: 62,
                        objectFit: "cover",
                        borderRadius: 4,
                        border: `1px solid ${C.rule}`,
                        cursor: "zoom-in",
                      }}
                    />
                  )}
                </div>
                <div
                  style={{
                    padding: "10px 14px",
                    borderBottom: `1px solid ${C.ruleLight}`,
                  }}
                >
                  {(part.cad_extra_views || []).length > 0 && (
                    <div style={{ marginBottom: 10 }}>
                      <div
                        style={{
                          fontFamily: mono,
                          fontSize: 8,
                          color: C.inkMuted,
                          textTransform: "uppercase",
                          letterSpacing: "0.06em",
                          marginBottom: 6,
                        }}
                      >
                        Saved Images
                      </div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {(part.cad_extra_views || []).map((view, i) => {
                          const src = resolveCadViewSrc(view);
                          if (!src) return null;
                          return (
                            <img
                              key={`${part.part_id || "part"}_cad_view_${i}`}
                              src={src}
                              alt={view.name || `view ${i + 1}`}
                              onClick={() => setLightboxSrc(src)}
                              style={{
                                width: 128,
                                height: 92,
                                objectFit: "cover",
                                borderRadius: 4,
                                border: `1px solid ${C.rule}`,
                                cursor: "zoom-in",
                                background: C.white,
                              }}
                            />
                          );
                        })}
                      </div>
                    </div>
                  )}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: "8px 20px",
                    }}
                  >
                    {[
                      {
                        label: "Part Family",
                        val: part.part_family,
                        conf: part.part_family_conf,
                      },
                      {
                        label: "Material",
                        val: part.material,
                        conf: part.material_conf,
                      },
                      {
                        label: "Process",
                        val: part.process_primary,
                        conf: part.process_conf,
                      },
                      {
                        label: "Finish",
                        val: part.finish,
                        conf: part.finish_conf,
                      },
                    ].map(({ label, val, conf }) => (
                      <div key={label}>
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            marginBottom: 1,
                          }}
                        >
                          <span
                            style={{
                              fontFamily: mono,
                              fontSize: 9,
                              color: C.inkMuted,
                              textTransform: "uppercase",
                              letterSpacing: "0.05em",
                            }}
                          >
                            {label}
                          </span>
                          <span
                            style={{
                              fontFamily: sans,
                              fontSize: 10,
                              color: C.inkSoft,
                            }}
                          >
                            {val || "â€”"}
                          </span>
                        </div>
                        <ConfBar pct={conf || 0} />
                      </div>
                    ))}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      gap: 16,
                      marginTop: 8,
                      flexWrap: "wrap",
                    }}
                  >
                    {[
                      { label: "Complexity", val: part.complexity_class },
                      { label: "Tolerance", val: part.tolerance_class },
                      { label: "Outcome", val: part.outcome },
                      { label: "Date", val: part.project_date },
                    ].map(({ label, val }) =>
                      val ? (
                        <div key={label}>
                          <div
                            style={{
                              fontFamily: mono,
                              fontSize: 8,
                              color: C.inkMuted,
                              textTransform: "uppercase",
                              letterSpacing: "0.06em",
                              marginBottom: 2,
                            }}
                          >
                            {label}
                          </div>
                          <div
                            style={{
                              fontFamily: sans,
                              fontSize: 11,
                              color: C.inkSoft,
                            }}
                          >
                            {val}
                          </div>
                        </div>
                      ) : null,
                    )}
                  </div>
                </div>
                {(part.what_worked ||
                  part.what_didnt ||
                  part.quoting_lesson) && (
                  <div
                    style={{
                      padding: "10px 14px",
                      display: "flex",
                      flexDirection: "column",
                      gap: 10,
                    }}
                  >
                    {part.what_worked && (
                      <div>
                        <div
                          style={{
                            fontFamily: mono,
                            fontSize: 8,
                            color: C.pass,
                            textTransform: "uppercase",
                            letterSpacing: "0.06em",
                            marginBottom: 3,
                          }}
                        >
                          What Worked
                        </div>
                        <div
                          style={{
                            fontFamily: sans,
                            fontSize: 12,
                            color: C.inkSoft,
                            lineHeight: 1.55,
                          }}
                        >
                          {part.what_worked}
                        </div>
                      </div>
                    )}
                    {part.what_didnt && (
                      <div>
                        <div
                          style={{
                            fontFamily: mono,
                            fontSize: 8,
                            color: C.warn,
                            textTransform: "uppercase",
                            letterSpacing: "0.06em",
                            marginBottom: 3,
                          }}
                        >
                          What Didn't Work
                        </div>
                        <div
                          style={{
                            fontFamily: sans,
                            fontSize: 12,
                            color: C.inkSoft,
                            lineHeight: 1.55,
                          }}
                        >
                          {part.what_didnt}
                        </div>
                      </div>
                    )}
                    {part.quoting_lesson && (
                      <div>
                        <div
                          style={{
                            fontFamily: mono,
                            fontSize: 8,
                            color: C.blue,
                            textTransform: "uppercase",
                            letterSpacing: "0.06em",
                            marginBottom: 3,
                          }}
                        >
                          Quoting Lesson
                        </div>
                        <div
                          style={{
                            fontFamily: sans,
                            fontSize: 12,
                            color: C.inkSoft,
                            lineHeight: 1.55,
                          }}
                        >
                          {part.quoting_lesson}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* â”€â”€ Zoho Sync footer â”€â”€ */}
          <div
            style={{
              padding: "12px 18px 16px",
              borderTop: `1px solid ${C.ruleLight}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <div
              style={{
                padding: "8px 12px",
                background: C.passBg,
                border: `1px solid ${C.passRule}`,
                borderRadius: 5,
                fontFamily: mono,
                fontSize: 9,
                color: C.pass,
                letterSpacing: "0.04em",
              }}
            >
              âœ“ Saved to Pinecone corpus
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button
                onClick={handleEditClick}
                style={{
                  fontFamily: mono,
                  fontSize: 10,
                  letterSpacing: "0.05em",
                  textTransform: "uppercase",
                  padding: "7px 14px",
                  borderRadius: 5,
                  border: `1px solid ${C.rule}`,
                  background: C.white,
                  color: C.ink,
                  cursor: "pointer",
                }}
              >
                Edit Project
              </button>
              <button
                onClick={handleDeleteClick}
                style={{
                  fontFamily: mono,
                  fontSize: 10,
                  letterSpacing: "0.05em",
                  textTransform: "uppercase",
                  padding: "7px 14px",
                  borderRadius: 5,
                  border: `1px solid ${C.warn}`,
                  background: C.white,
                  color: C.warn,
                  cursor: "pointer",
                }}
              >
                Delete Project
              </button>
            </div>
          </div>
        </div>
      )}
      <ImageLightbox
        src={lightboxSrc}
        open={!!lightboxSrc}
        onClose={() => setLightboxSrc("")}
      />
    </Card>
  );
});

// â”€â”€ ACTIVE PROJECT FORM â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function ActiveProjectForm({
  companyName,
  zohoId,
  supplierEmail,
  onSaveToCorpus,
  onSaved,
  onRefreshFromZoho,
  onPushSuccess,
  initialSnapshot,
  onCancelEdit,
}) {
  const MAX_UPLOAD_FILES = 3;
  const projectIdRef = useRef(
    initialSnapshot?.projectId ||
      initialSnapshot?.projectFields?.job_id ||
      `proj_${Date.now()}`,
  );
  const [parts, setParts] = useState(initialSnapshot?.parts || []);
  const [projectFields, setProjectFields] = useState(
    initialSnapshot?.projectFields || {
      job_id: "",
      customer: "",
      project_name: "",
      customer_industry: "",
      overview: "",
    },
  );
  const [sharingTier, setSharingTier] = useState(
    initialSnapshot?.sharingTier || "Anonymized",
  );
  const [projectAssets, setProjectAssets] = useState(
    normalizeProjectAssets(initialSnapshot?.assets),
  );
  const [documentContext, setDocumentContext] = useState(
    initialSnapshot?.document_context || "",
  );
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzePreview, setAnalyzePreview] = useState(null);
  const [analyzeMode, setAnalyzeMode] = useState("image");
  const [analyzeError, setAnalyzeError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState(null);
  const [saveError, setSaveError] = useState("");

  const partsRef = useRef(parts);
  partsRef.current = parts;

  const addPart = useCallback(
    (part) => setParts((prev) => [...prev, part]),
    [],
  );
  const updatePart = useCallback(
    (updated) =>
      setParts((prev) =>
        prev.map((p) => (p.part_id === updated.part_id ? updated : p)),
      ),
    [],
  );
  const removePart = useCallback(
    (pid) => setParts((prev) => prev.filter((p) => p.part_id !== pid)),
    [],
  );

  const handleImage = useCallback(
    async (file, previewUrl) => {
      const isCad = isCadFile(file);
      setAnalyzePreview(isCad ? null : previewUrl);
      setAnalyzing(true);
      setAnalyzeError("");
      try {
        setAnalyzeMode(isCad ? "cad" : "image");
        const form = new FormData();
        form.append("file", file);
        form.append("company_name", companyName || "Unknown");
        form.append("zoho_id", zohoId || "");
        if (documentContext) form.append("context_text", documentContext);
        const res = await fetch(isCad ? ANALYZE_CAD_API : ANALYZE_API, { method: "POST", body: form });
        if (!res.ok) throw new Error(`Server ${res.status}`);
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || "Analysis failed");
        const inf = data.inference;
        const mainPreview = isCad ? (data.preview_data_url || previewUrl) : previewUrl;
        const cadFileB64 = isCad ? await fileToBase64(file) : "";
        const cadPreviewB64 = isCad ? (data.preview_b64 || "") : "";
        const cadPreviewFilename = isCad
          ? `${(file?.name || "cad_model").replace(/\.[^/.]+$/, "")}_preview.jpg`
          : "";
        const cadExtraViews = isCad && Array.isArray(data.extra_view_images)
          ? data.extra_view_images.map((v) => ({
              filename: v.filename || "",
              b64: v.b64 || "",
              name: v.name || "",
            }))
          : [];

        addPart({
          part_id: data.part_id,
          part_label: `PART-${String.fromCharCode(65 + partsRef.current.length)}`,
          filename: data.filename,
          image_preview: mainPreview,
          clip_vector: data.clip_vector,
          geo_scores: data.geo_scores,
          raw_scores: data.scores || {},
          source: data.source,
          part_family: inf.part_family || "",
          part_family_detail: inf.part_family_detail || "",
          part_family_conf: inf.part_family_conf || 0,
          material: inf.material || "",
          material_raw: inf.material || "",
          material_reasoning: inf.material_reasoning || "",
          material_conf: inf.material_conf || 0,
          material_match_source: normalizeMaterialLabel(inf.material || ""),
          process_primary: inf.process_primary || "",
          process_secondary: inf.process_secondary || "",
          process_conf: inf.process_conf || 0,
          finish: inf.finish || "",
          finish_ra: inf.finish_ra || "",
          finish_conf: inf.finish_conf || 0,
          complexity_class: inf.complexity_class || "",
          tolerance_class: inf.tolerance_class || "",
          features: inf.features || [],
          notes: inf.notes || "",
          part_envelope: inf.part_envelope || "",
          part_name: "",
          project_date: "",
          outcome: "",
          what_worked: "",
          what_didnt: "",
          quoting_lesson: "",
          cad_filename: isCad ? (file?.name || data.filename || "") : "",
          cad_file_b64: cadFileB64,
          cad_preview_b64: cadPreviewB64,
          cad_preview_filename: cadPreviewFilename,
          cad_extra_views: cadExtraViews,
        });

        if (isCad && data?.project_details) {
          setProjectFields((prev) => ({
            ...prev,
            project_name: prev.project_name || data.project_details.project_name || "",
            overview: prev.overview || data.project_details.overview || "",
            customer_industry: prev.customer_industry || data.project_details.customer_industry || "",
          }));
        }
      } catch (e) {
        setAnalyzeError(e.message);
      } finally {
        setAnalyzing(false);
        setAnalyzePreview(null);
        setAnalyzeMode("image");
      }
    },
    [companyName, zohoId, addPart, documentContext],
  );

  const handleUploads = useCallback(
    async (files) => {
      const selected = Array.from(files || []);
      const list = selected.slice(0, MAX_UPLOAD_FILES);
      if (list.length === 0) return;
      if (selected.length > MAX_UPLOAD_FILES) {
        setAnalyzeError(`Only first ${MAX_UPLOAD_FILES} files were processed.`);
      }

      const assetRecords = list.map((file) =>
        makeAssetRecord(file, inferAssetKind(file.name)),
      );
      setProjectAssets((prevRaw) => {
        const prev = normalizeProjectAssets(prevRaw);
        const mergedFiles = [...prev.files, ...assetRecords];
        const next = { ...prev, files: mergedFiles };

        for (const record of assetRecords) {
          const k = (record.kind || "").toLowerCase();
          if (!next.rfp && k === "rfp") next.rfp = record;
          if (!next.quote && k === "quote") next.quote = record;
          if (!next.workOrder && k === "work order") next.workOrder = record;
        }
        return next;
      });

      for (const file of list) {
        const n = String(file?.name || "").toLowerCase();
        if (n.endsWith(".pdf")) {
          try {
            const pdfForm = new FormData();
            pdfForm.append("file", file);
            const pdfRes = await fetch(EXTRACT_PDF_API, { method: "POST", body: pdfForm });
            const pdfData = await pdfRes.json().catch(() => ({}));
            if (pdfRes.ok && pdfData?.ok) {
              const extractedText = String(pdfData.text || "").trim();
              if (extractedText) {
                setDocumentContext((prev) => {
                  if (!prev) return extractedText;
                  const merged = `${prev}\n\n${extractedText}`.slice(0, 120000);
                  return merged;
                });
              }
              const details = pdfData.project_details || {};
              setProjectFields((prev) => ({
                ...prev,
                project_name: prev.project_name || details.project_name || "",
                overview: prev.overview || details.overview || "",
                customer_industry: prev.customer_industry || details.customer_industry || "",
              }));
            }
          } catch (_) {}
        }
      }

      for (const file of list) {
        if (isImageFile(file) || isCadFile(file)) {
          const preview = URL.createObjectURL(file);
          await handleImage(file, preview);
        }
      }
    },
    [handleImage],
  );

  const handleSave = useCallback(async () => {
    if (parts.length === 0) return;
    setSaving(true);
    setSaveResult(null);
    setSaveError("");
    try {
      const partsPayload = await Promise.all(
        parts.map(async (part) => {
          let img_b64 = null,
            img_ext = ".jpg";
          if (part.image_preview?.startsWith("blob:")) {
            try {
              const resp = await fetch(part.image_preview);
              const blob = await resp.blob();
              img_ext = blob.type === "image/png" ? ".png" : ".jpg";
              img_b64 = await new Promise((res) => {
                const r = new FileReader();
                r.onload = () => res(r.result.split(",")[1]);
                r.readAsDataURL(blob);
              });
            } catch (_) {}
          }
          return {
            part_id: part.part_id,
            company_name: companyName || projectFields.customer || "",
            zoho_id: zohoId || "",
            supplier_email: (supplierEmail || "").toLowerCase(),
            filename: part.filename || "",
            image_b64: img_b64,
            image_ext: img_ext,
            inference_source: part.source || "ai",
            part_family: part.part_family,
            part_family_detail: part.part_family_detail,
            part_family_conf: part.part_family_conf,
            material: part.material,
            material_raw: part.material_raw,
            material_reasoning: part.material_reasoning,
            material_conf: part.material_conf,
            process: part.process_primary,
            process_secondary: part.process_secondary,
            process_conf: part.process_conf,
            finish: part.finish,
            finish_ra: part.finish_ra,
            finish_conf: part.finish_conf,
            complexity_class: part.complexity_class,
            tolerance_class: part.tolerance_class,
            features: part.features,
            notes: part.notes,
            circularity:
              Number(part?.raw_scores?.circularity ?? (part.geo_scores || [])[1] ?? 0.0) || 0.0,
            symmetry:
              Number(part?.raw_scores?.symmetry_score ?? (part.geo_scores || [])[4] ?? 0.0) || 0.0,
            hole_count:
              Number(
                part?.raw_scores?.hole_count ??
                Math.round(((part.geo_scores || [])[9] || 0) * 10)
              ) || 0,
            complexity:
              Number(part?.raw_scores?.feature_complexity ?? (part.geo_scores || [])[6] ?? 0.0) || 0.0,
            aspect_ratio:
              Number(part?.raw_scores?.aspect_ratio ?? (part.geo_scores || [])[0] ?? 0.0) || 0.0,
            project_id: projectIdRef.current,
            project_name: projectFields.project_name || part.part_name || "",
            outcome: part.outcome,
            what_worked: part.what_worked,
            what_didnt: part.what_didnt,
            ncr_description: "",
            customer_industry: projectFields.customer_industry,
            project_date: part.project_date,
            overview: projectFields.overview,
            share_with_tb: sharingTier !== "Private",
            clip_vector:
              part.clip_vector || Array.from({ length: 512 }, () => 0.0),
            cad_filename: part.cad_filename || "",
            cad_file_b64: part.cad_file_b64 || "",
            cad_preview_b64: part.cad_preview_b64 || "",
            cad_preview_filename: part.cad_preview_filename || "",
            cad_extra_views: part.cad_extra_views || [],
          };
        }),
      );

      const res = await fetch(PUSH_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parts: partsPayload }),
      });
      if (!res.ok) throw new Error(`Server ${res.status}`);
      const data = await res.json();
      const success = data.ok || data.pushed > 0;

      if (success) {
        setSaveResult("ok");
        onPushSuccess?.();
        let finalOverview = projectFields.overview;
        if (!finalOverview && parts[0]) {
          const first = parts[0];
          finalOverview =
            `${first.part_family} component â€” ${first.material}. ${first.process_primary}. ${first.part_family_detail || ""}`.trim();
        }
        const finalProjectFields = {
          ...projectFields,
          overview: finalOverview,
        };
        setProjectFields(finalProjectFields);

        const _savedSnapshot = {
          projectId: projectIdRef.current,
          projectFields: finalProjectFields,
          parts,
          sharingTier,
          assets: projectAssets,
          document_context: documentContext,
        };

        onSaveToCorpus?.({
          id: projectIdRef.current,
          job_id: finalProjectFields.job_id || "",
          project_name:
            finalProjectFields.project_name ||
            parts[0]?.part_name ||
            "Untitled Project",
          sharing_tier: sharingTier,
          assets: projectAssets,
          document_context: documentContext,
          parts: parts.map((p) => ({
            part_id: p.part_id,
            part_label: p.part_label,
            part_name: p.part_name,
            process: p.process_primary,
            material: p.material,
            material_raw: p.material_raw,
            outcome: p.outcome,
            what_worked: p.what_worked,
            what_didnt: p.what_didnt,
            quoting_lesson: p.quoting_lesson,
          })),
        });
        onSaved(_savedSnapshot);
        onCancelEdit?.();
        onRefreshFromZoho?.();
      } else {
        throw new Error(
          data.results?.[0]?.error || "Push failed â€” check server logs",
        );
      }
    } catch (e) {
      setSaveResult("error");
      setSaveError(e.message);
    }
    setSaving(false);
  }, [
    parts,
    projectFields,
    sharingTier,
    companyName,
    zohoId,
    supplierEmail,
    onSaveToCorpus,
    onSaved,
    onCancelEdit,
    onRefreshFromZoho,
    projectAssets,
    documentContext,
  ]);

  return (
    <Card
      style={{
        marginBottom: 20,
        animation: "up 0.22s ease",
      }}
    >
      {/* Card header â€” RFP ingestion style */}
      <div style={{ padding: "11px 18px", background: C.surface, borderBottom: `1px solid ${C.rule}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: C.gold, animation: "pulse 2s infinite", flexShrink: 0 }} />
          <span style={{ fontFamily: display, fontSize: 13, fontWeight: 700, color: C.ink }}>
            {initialSnapshot ? "Edit Project" : "New Project"}
          </span>
          <span style={{ fontFamily: mono, fontSize: 9, color: C.inkMuted, textTransform: "uppercase", letterSpacing: "0.06em" }}>In Progress</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {[{ badge: "Auto", bg: C.gold, desc: "AI-filled" }, { badge: "Supplier", bg: C.navy, desc: "You fill" }].map(({ badge, bg, desc }) => (
            <div key={badge} style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ fontFamily: mono, fontSize: 8, padding: "1px 5px", borderRadius: 2, background: bg, color: "#fff", textTransform: "uppercase", letterSpacing: "0.05em" }}>{badge}</span>
              <span style={{ fontFamily: sans, fontSize: 11, color: C.inkMuted }}>{desc}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ padding: "14px 18px 0" }}>
        {/* Upload section â€” RFP compact style */}
        <div style={{ padding: "9px 13px", background: C.goldPale, borderLeft: `3px solid ${C.gold}`, borderRadius: 4, fontSize: 12.5, color: C.inkSoft, lineHeight: 1.65, marginBottom: 14 }}>
          <strong>Upload project files</strong> â€” RFP, quote, work order, images, CAD and PDFs. AI auto-populates part fields from image/CAD files. Max 3 files at a time.
        </div>
        <UnifiedUploadDropZone onFilesSelected={handleUploads} compact={parts.length > 0} />
        {normalizeProjectAssets(projectAssets).files.length > 0 && (
          <div style={{ marginBottom: 12, display: "flex", flexWrap: "wrap", gap: 6 }}>
            {normalizeProjectAssets(projectAssets).files.map((asset) => (
              <span
                key={asset.id}
                style={{ display: "inline-flex", alignItems: "center", gap: 5, fontFamily: mono, fontSize: 9, padding: "3px 8px", borderRadius: 3, border: `1px solid ${C.rule}`, background: C.white, color: C.inkSoft }}
              >
                {asset.kind}: {asset.name} Â· {formatBytes(asset.size)}
              </span>
            ))}
          </div>
        )}

        <ProjectMeta fields={projectFields} onChange={setProjectFields} />

        {parts.map((part) => (
          <AnalysedPartForm
            key={part.part_id}
            partData={part}
            onUpdate={updatePart}
            onRemove={removePart}
            partId={part.part_id}
            imagePreview={part.image_preview}
          />
        ))}

        {analyzing && (
          <div
            style={{
              border: `2px solid ${C.gold}`,
              borderRadius: 8,
              background: C.white,
              overflow: "hidden",
              marginBottom: 16,
            }}
          >
            <div style={{ display: "grid", gridTemplateColumns: "220px 1fr" }}>
              <div
                style={{
                  borderRight: `1px solid ${C.ruleLight}`,
                  padding: 16,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {analyzePreview && (
                  <img
                    src={analyzePreview}
                    alt="uploading"
                    style={{
                      width: "100%",
                      aspectRatio: "4/3",
                      objectFit: "contain",
                      borderRadius: 6,
                      border: `1px solid ${C.rule}`,
                    }}
                  />
                )}
              </div>
              <AiSpinner mode={analyzeMode} />
            </div>
          </div>
        )}

        {analyzeError && (
          <div
            style={{
              marginBottom: 14,
              padding: "9px 13px",
              background: C.warnBg,
              border: `1px solid ${C.warnRule}`,
              borderLeft: `3px solid ${C.warn}`,
              borderRadius: 4,
              fontFamily: mono,
              fontSize: 11,
              color: C.warn,
            }}
          >
            Analysis failed: {analyzeError}
            <div style={{ marginTop: 3, color: C.inkMuted, fontFamily: sans, fontSize: 12 }}>
              Make sure <code>uvicorn server:app --port 8000</code> is running.
            </div>
          </div>
        )}

        <SharingTier value={sharingTier} onChange={setSharingTier} />

        {saveResult === "error" && (
          <div
            style={{
              marginBottom: 16,
              padding: "9px 13px",
              background: C.warnBg,
              border: `1px solid ${C.warnRule}`,
              borderLeft: `3px solid ${C.warn}`,
              borderRadius: 4,
              fontFamily: mono,
              fontSize: 11,
              color: C.warn,
            }}
          >
            Push failed: {saveError}
            <div style={{ marginTop: 3, color: C.inkMuted, fontFamily: sans, fontSize: 12 }}>
              Check that both servers are running (ports 5000 and 8000).
            </div>
          </div>
        )}
      </div>

      <div
        style={{
          padding: "12px 18px",
          borderTop: `1px solid ${C.rule}`,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 10,
          background: C.surface,
          flexWrap: "wrap",
        }}
      >
        {onCancelEdit && (
          <Btn variant="outline" onClick={onCancelEdit}>Cancel Edit</Btn>
        )}
        {saveResult === "ok" && (
          <div style={{ fontFamily: mono, fontSize: 9, color: C.pass, letterSpacing: "0.04em", display: "flex", alignItems: "center", gap: 4 }}>
            âœ“ Saved to corpus â€” closingâ€¦
          </div>
        )}
        <Btn
          variant="green"
          onClick={handleSave}
          disabled={saving || parts.length === 0}
          style={{ marginLeft: "auto" }}
        >
          {saving
            ? "Savingâ€¦"
            : saveResult === "ok"
              ? `âœ“ Re-save (${parts.length} part${parts.length !== 1 ? "s" : ""}) â†’`
              : `${initialSnapshot ? "Update" : "Push"} to Corpus${parts.length > 0 ? ` (${parts.length})` : ""} â†’`}
        </Btn>
      </div>

      {parts.length > 0 && (
        <div
          style={{
            padding: "8px 18px",
            background: C.offWhite,
            borderTop: `1px solid ${C.ruleLight}`,
            fontFamily: mono,
            fontSize: 9,
            color: C.inkMuted,
            lineHeight: 1.8,
            letterSpacing: "0.02em",
          }}
        >
          What Didn't Work and Quoting Lessons are Private â€” never shared with buyers. Customer names are anonymized in Anonymized + Attributed tiers.
        </div>
      )}
    </Card>
  );
}

// â”€â”€ MAIN EXPORT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export default function ProjectsTab({
  onSaveToCorpus,
  onRefreshFromZoho,
  corpusSaved = [],
  companyName,
  zohoId,
  supplierEmail,
}) {
  const [slots, setSlots] = useState([]);
  const [deletedProjectIds, setDeletedProjectIds] = useState(() => {
    try {
      const raw = localStorage.getItem(DELETED_PROJECT_IDS_KEY);
      const parsed = JSON.parse(raw || "[]");
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch (_) {
      return [];
    }
  });
  const didHydrateSlots = useRef(false);
  const [showToast, setShowToast] = useState(false);

  const handlePushSuccess = useCallback(() => {
    setShowToast(true);
    setTimeout(() => setShowToast(false), 3500);
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(PROJECT_SLOTS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      setSlots(Array.isArray(parsed) ? parsed : []);
    } catch (_) {
    } finally {
      didHydrateSlots.current = true;
    }
  }, []);

  useEffect(() => {
    if (!didHydrateSlots.current) return;
    try {
      localStorage.setItem(
        PROJECT_SLOTS_KEY,
        JSON.stringify(slots.filter((slot) => slot.type === "saved")),
      );
    } catch (_) {}
  }, [slots]);

  useEffect(() => {
    try {
      localStorage.setItem(DELETED_PROJECT_IDS_KEY, JSON.stringify(deletedProjectIds));
    } catch (_) {}
  }, [deletedProjectIds]);

  useEffect(() => {
    if (!Array.isArray(corpusSaved) || corpusSaved.length === 0) return;
    setSlots((prev) => {
      const deletedSet = new Set(deletedProjectIds);
      const active = prev.filter((slot) => slot.type === "active");
      const prevSavedByProjectId = new Map(
        prev
          .filter((slot) => slot.type === "saved")
          .map((slot) => {
            const pid = slot?.snapshot?.projectId || slot?.snapshot?.projectFields?.job_id || "";
            return [String(pid), slot?.snapshot];
          }),
      );
      const savedFromZoho = corpusSaved
        .filter((project, index) => !deletedSet.has(String(project.id || `crm_${index}`)))
        .map((project, index) => {
        const normalizedParts = (project.parts || []).map((p, pIndex) => ({
          part_id: p.part_id || `part_${index}_${pIndex}`,
          source_record_id: p.source_record_id || "",
          part_label: p.part_label || `PART-${String.fromCharCode(65 + pIndex)}`,
          part_name: p.part_name || project.project_name || "",
          source: p.source || "gemini",
          part_family: p.part_family || "",
          part_family_conf: p.part_family_conf || (p.part_family ? 0.8 : 0),
          process_primary: p.process_primary || p.process || "",
          process_conf: p.process_conf || ((p.process_primary || p.process) ? 0.8 : 0),
          process_secondary: p.process_secondary || "",
          material: p.material || "",
          material_conf: p.material_conf || (p.material ? 0.8 : 0),
          finish: p.finish || "",
          finish_conf: p.finish_conf || (p.finish ? 0.8 : 0),
          image_url: p.image_url || "",
          image_preview: p.image_preview || p.image_url || "",
          outcome: p.outcome || "",
          what_worked: p.what_worked || "",
          what_didnt: p.what_didnt || "",
          quoting_lesson: p.quoting_lesson || "",
          project_date: p.project_date || "",
          zoho_id: zohoId || "",
          company_name: companyName || "",
        }));

        return {
          id: `crm_${project.id || index}`,
          type: "saved",
          snapshot: {
            projectId: project.id || `crm_${index}`,
            projectFields: {
              job_id: project.job_id || "",
              customer: companyName || "",
              project_name: project.project_name || "Untitled Project",
              customer_industry: project.customer_industry || "",
              overview: project.overview || "",
            },
            parts: normalizedParts,
            sharingTier: project.sharing_tier || "Attributed",
            assets: mergeProjectAssets(
              prevSavedByProjectId.get(String(project.id || `crm_${index}`))?.assets,
              project.assets,
            ),
          },
        };
      });
      return [...active, ...savedFromZoho];
    });
  }, [corpusSaved, companyName, zohoId, deletedProjectIds]);

  function addNewProject() {
    setSlots((prev) => [{ id: Date.now(), type: "active" }, ...prev]);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function handleSaved(id, snapshot) {
    setSlots((prev) =>
      prev.map((s) => (s.id === id ? { id, type: "saved", snapshot } : s)),
    );
  }

  const handleEdit = useCallback((id) => {
    setSlots((prev) =>
      prev.map((slot) =>
        slot.id === id
          ? {
              id,
              type: "active",
              snapshot: slot.snapshot,
              mode: "edit",
            }
          : slot,
      ),
    );
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const handleDeleteProject = useCallback((id) => {
    setSlots((prev) => {
      const target = prev.find((slot) => slot.id === id);
      const projectId = target?.snapshot?.projectId || target?.snapshot?.projectFields?.job_id || id;
      setDeletedProjectIds((deleted) =>
        deleted.includes(String(projectId)) ? deleted : [...deleted, String(projectId)],
      );
      return prev.filter((slot) => slot.id !== id);
    });
  }, []);

  const handleRenameProject = useCallback((slotId, newName) => {
    setSlots((prev) =>
      prev.map((s) =>
        s.id === slotId
          ? { ...s, snapshot: { ...s.snapshot, projectFields: { ...s.snapshot.projectFields, project_name: newName } } }
          : s,
      ),
    );
    setSlots((prev) => {
      const slot = prev.find((s) => s.id === slotId);
      const recordIds = (slot?.snapshot?.parts || []).map((p) => p.source_record_id).filter(Boolean);
      if (recordIds.length) {
        fetch(RENAME_PROJECT_API, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ record_ids: recordIds, new_name: newName }),
        }).catch(() => {});
      }
      return prev;
    });
  }, []);

  const hasActive = slots.some((s) => s.type === "active");

  return (
    <>
      <style>{`
        @keyframes spin  { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        @keyframes up    { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:none} }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        textarea,input,select { box-sizing:border-box; }
        input::placeholder,textarea::placeholder { color:${C.inkMuted}; }
      `}</style>

      {showToast && (
        <div
          style={{
            position: "fixed",
            top: 28,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 9999,
            background: C.ink,
            color: "#fff",
            fontFamily: mono,
            fontSize: 13,
            fontWeight: 500,
            letterSpacing: "0.03em",
            padding: "14px 28px",
            borderRadius: 8,
            boxShadow: "0 6px 24px rgba(0,0,0,0.22)",
            display: "flex",
            alignItems: "center",
            gap: 10,
            pointerEvents: "none",
            animation: "up 0.2s ease",
          }}
        >
          <span style={{ color: C.goldBright, fontSize: 16 }}>âœ“</span>
          Successfully pushed to corpus
        </div>
      )}

      {slots
        .filter((s) => s.type === "saved")
        .map((s) => (
          <SavedProjectCard
            key={s.id}
            slotId={s.id}
            snapshot={s.snapshot}
            onEditProject={handleEdit}
            onDeleteProject={handleDeleteProject}
            onRenameProject={handleRenameProject}
            supplierEmail={supplierEmail}
          />
        ))}

      {slots
        .filter((s) => s.type === "active")
        .map((s) => (
          <ActiveProjectForm
            key={s.id}
            companyName={companyName}
            zohoId={zohoId}
            supplierEmail={supplierEmail}
            onSaveToCorpus={onSaveToCorpus}
            onRefreshFromZoho={onRefreshFromZoho}
            onPushSuccess={handlePushSuccess}
            onSaved={(snapshot) => handleSaved(s.id, snapshot)}
            initialSnapshot={s.snapshot}
            onCancelEdit={
              s.mode === "edit"
                ? () =>
                    setSlots((prev) =>
                      prev.map((slot) =>
                        slot.id === s.id
                          ? { id: s.id, type: "saved", snapshot: slot.snapshot }
                          : slot,
                      ),
                    )
                : undefined
            }
          />
        ))}

      {slots.length === 0 && (
        <Card style={{ textAlign: "center", padding: "60px 20px" }}>
          <div
            style={{
              width: 52,
              height: 52,
              borderRadius: "50%",
              background: C.goldPale,
              border: `1px solid rgba(184,146,10,0.2)`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 16px",
              fontSize: 26,
            }}
          >
            ðŸ­
          </div>
          <div style={{ fontFamily: display, fontSize: 17, fontWeight: 700, color: C.ink, marginBottom: 8 }}>
            No projects yet
          </div>
          <div style={{ fontFamily: sans, fontSize: 13, color: C.inkMuted, maxWidth: 400, margin: "0 auto 24px", lineHeight: 1.65 }}>
            Add past manufacturing projects to build your corpus. Upload part photos, fill in process details, and save. Each project can have multiple parts.
          </div>
          <Btn variant="accent" onClick={addNewProject}>+ Add Project</Btn>
        </Card>
      )}

      {slots.length > 0 && !hasActive && (
        <button
          onClick={addNewProject}
          style={{
            border: `2px dashed ${C.rule}`,
            borderRadius: 8,
            padding: 16,
            width: "100%",
            textAlign: "center",
            cursor: "pointer",
            color: C.inkMuted,
            fontFamily: mono,
            fontSize: 10,
            textTransform: "uppercase",
            letterSpacing: "0.07em",
            background: "transparent",
            transition: "all 0.15s",
            display: "block",
            marginTop: 4,
            boxSizing: "border-box",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = C.gold;
            e.currentTarget.style.color = C.gold;
            e.currentTarget.style.background = C.goldPale;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = C.rule;
            e.currentTarget.style.color = C.inkMuted;
            e.currentTarget.style.background = "transparent";
          }}
        >
          + Add Another Project
        </button>
      )}
    </>
  );
}


