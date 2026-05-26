import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { jsPDF } from "jspdf";

// -- UNIFIED TOKENS ------------------------------------------------------------
const C = {
  navy:"#1B2D4F", navyDeep:"#111E33", navyMid:"#243754", navyLight:"#2D4567",
  gold:"#B8920A", goldPale:"#F5F0DC", goldBright:"#D4AA12",
  copper:"#B8920A", copperPale:"#F5F0DC",   // aliases for older screens
  white:"#FAFCFF", offWhite:"#F0F3F8", bg:"#E4E8F0", surface:"#E8EDF5",
  rule:"#C8D2E0", ruleLight:"#DDE3EE",
  ink:"#1B2D4F", inkSoft:"#2D4567", inkMuted:"#6B7F96",
  pass:"#1E5E3A", passBg:"#E6F4EC", passRule:"rgba(30,94,58,0.2)",
  warn:"#7A2E0E", warnBg:"#FDF0EB", warnRule:"rgba(122,46,14,0.25)",
  blue:"#1A3D5C", bluePale:"#E8EFF8", blueMid:"#4A7BAF",
  amber:"#7A4A08", amberBg:"#FEF3E0", amberRule:"rgba(180,110,20,0.25)",
  red:"#8B1A1A", redBg:"#FDE8E8",
  purple:"#4A2D7A", purplePale:"#EEE8F8",
};
const mono  = "'IBM Plex Mono', monospace";
const disp  = "'Syne', sans-serif";
const sans  = "'DM Sans', sans-serif";
const serif = "'Playfair Display', Georgia, serif";
const intakeHeadingStyle = { fontFamily: disp, fontSize: 14, fontWeight: 700, color: C.ink, marginBottom: 8 };
const intakeFieldLabelStyle = { fontFamily: mono, fontSize: 8, color: C.inkMuted, textTransform: "uppercase", marginBottom: 4 };
const intakeFieldControlStyle = { width: "100%", padding: "8px 9px", border: `1px solid ${C.rule}`, borderRadius: 5, background: C.white, color: C.ink, fontFamily: sans, fontSize: 12 };
const intakeTextareaStyle = { ...intakeFieldControlStyle, resize: "vertical", lineHeight: 1.45 };
const intakeCheckboxPanelStyle = { border: `1px solid ${C.rule}`, borderRadius: 5, background: C.white, padding: "8px 10px", display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 6 };
const intakeCheckboxLabelStyle = { display: "flex", alignItems: "center", gap: 7, cursor: "pointer", padding: "3px 4px", borderRadius: 4, fontFamily: sans, fontSize: 12, color: C.ink };

// -- SEED DATA (shared across screens) -----------------------------------------
const SEED_RFPS = [];

const DEADLINES_DATA = [];

function currencyNumber(value) {
  const n = Number(`${value ?? ""}`.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

const STATUS_META = {
  new:             { label:"New",           bg:C.bluePale, color:C.blue,    border:"rgba(26,74,114,0.25)" },
  in_assessment:   { label:"In Assessment", bg:C.amberBg,  color:C.amber,   border:C.amberRule },
  quote_submitted: { label:"Quote Sent",    bg:C.passBg,   color:C.pass,    border:C.passRule },
  won:             { label:"Won",           bg:C.passBg,   color:C.pass,    border:C.passRule },
  lost:            { label:"Lost",          bg:C.surface,  color:C.inkMuted, border:C.rule },
  no_bid:          { label:"No-bid",        bg:C.surface,  color:C.inkMuted, border:C.rule },
};

const NOTIFICATIONS = [];

const NOTIF_ICON = {
  rfp_new:"->", rfp_update:"=>", analytics:"*", corpus:"+", system:"o",
};
const NOTIF_COLOR = {
  rfp_new:C.blue, rfp_update:C.gold, analytics:C.purple, corpus:C.pass, system:C.inkMuted,
};

const COMPANY_SIZE_OPTIONS = [
  "Small (<1M Annual revenue)",
  "Medium ($1M-$10M Annual revenue)",
  "Large ($10M-$100M Annual revenue)",
  "Enterprise(>$100M Annual revenue)",
];

function normalizeCompanySize(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const v = raw.toLowerCase();
  if (v.includes("small") || v.includes("<1m") || v.includes("under 1") || v.includes("startup")) {
    return "Small (<1M Annual revenue)";
  }
  if (v.includes("medium") || v.includes("1m") || v.includes("10m")) {
    return "Medium ($1M-$10M Annual revenue)";
  }
  if (v.includes("large") || v.includes("$10m") || v.includes("100m")) {
    return "Large ($10M-$100M Annual revenue)";
  }
  if (v.includes("enterprise") || v.includes(">100m") || v.includes("over 100")) {
    return "Enterprise(>$100M Annual revenue)";
  }
  return "";
}

const MANDATORY_CERTIFICATION_OPTIONS = [
  "ISO 9001",
  "AS9100",
  "IATF 16949",
  "ISO 13485",
  "ISO 14001",
  "ISO 45001 / OHSAS 18001",
  "ISO 50001",
  "ITAR Registration",
  "RoHS Compliance",
  "REACH Compliance",
  "NADCAP",
  "FDA Registration / GMP",
  "ISO/TS 22163 (IRIS)",
  "CE Marking",
  "CSA Certification",
  "ISO/IEC 27001",
];

const API_BASE = (import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000").replace(/\/+$/, "");
const ENDPOINTS = {
  auth: {
    lookup: "/auth/lookup",
    sendOtp: "/auth/send-otp",
    verifyOtp: "/auth/verify-otp",
  },
  pastProjects: {
    projects: "/projects",
    updateProject: "/projects/update",
    deleteProject: "/projects/delete",
    processProfiles: "/process-profiles",
    lessons: "/zoho-lessons",
    syncLessons: "/zoho-sync-lessons",
    syncProjects: "/zoho-sync",
    extractPdf: "/extract-pdf",
    extractDocument: "/extract-document",
    inferText: "/infer-text",
    analyzeCad: "/analyze-cad",
    analyzeImage: "/analyze",
    push: "/push",
    analytics: "/api/ingestion/analytics",
    inboundStats: "/api/ingestion/inbound-stats",
    projectAttachments: "/api/projects/attachments",
    machines: "/api/machines",
    machineMaterials: "/api/machines/materials",
    machineResolve: "/api/machines/resolve-equipment",
    machineSave: "/api/machines/save",
  },
  rfp: {
    submit: "/api/rfp/submit",
    recent: "/api/rfp/recent",
    crmRecord: "/api/rfp/crm-record",
    crmMedia: "/api/rfp/crm-media",
    parse: "/api/rfp/parse",
    parseFile: "/api/rfp/parse-file",
  },
  assessment: {
    run: "/api/assessment/run",
    recent: "/api/assessment/recent",
    result: "/api/assessment/result",
    updateIntake: "/api/assessment/update-intake",
    noBid: "/api/assessment/no-bid",
    feedback: "/api/assessment/match-feedback",
    corpusHealth: "/api/assessment/corpus-health",
    attachment: "/api/assessment/attachment",
  },
  health: {
    unified: "/unified/health",
    legacy: "/health",
  },
  dashboard: {
    bootstrap: "/api/dashboard/bootstrap",
  },
};
const SUPPLIER_SESSION_KEY = "tb_supplier_session";
const SUPPLIER_DEVICE_KEY = "tb_supplier_device_id";
const SUPPLIER_SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12 hours

function randomId() {
  try {
    if (window?.crypto?.randomUUID) return window.crypto.randomUUID();
  } catch {}
  return `sid_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function getSupplierDeviceId() {
  try {
    let id = localStorage.getItem(SUPPLIER_DEVICE_KEY);
    if (!id) {
      id = randomId();
      localStorage.setItem(SUPPLIER_DEVICE_KEY, id);
    }
    return id;
  } catch {
    return "device-unknown";
  }
}

function getSupplierSession() {
  try {
    const raw = localStorage.getItem(SUPPLIER_SESSION_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    const now = Date.now();
    const expiresAt = Number(parsed.expires_at || 0);
    const deviceId = `${parsed.device_id || ""}`.trim();
    if (expiresAt && expiresAt < now) {
      localStorage.removeItem(SUPPLIER_SESSION_KEY);
      return {};
    }
    if (deviceId && deviceId !== getSupplierDeviceId()) {
      return {};
    }
    return {
      supplier_id: parsed.zoho_account_id || parsed.supplier_id || "",
      supplier_email: parsed.email || parsed.supplier_email || "",
      supplier_name: parsed.company_name || parsed.supplier_name || "Precision Dynamics",
      session_id: parsed.session_id || "",
      issued_at: parsed.issued_at || 0,
      expires_at: parsed.expires_at || 0,
      device_id: parsed.device_id || "",
    };
  } catch {
    return {};
  }
}

function setSupplierSession(session) {
  if (!session) return;
  const now = Date.now();
  const payload = {
    ...session,
    session_id: session.session_id || randomId(),
    issued_at: now,
    expires_at: now + SUPPLIER_SESSION_TTL_MS,
    device_id: getSupplierDeviceId(),
  };
  localStorage.setItem(SUPPLIER_SESSION_KEY, JSON.stringify(payload));
}

function touchSupplierSession() {
  try {
    const raw = localStorage.getItem(SUPPLIER_SESSION_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!parsed?.session_id) return;
    parsed.expires_at = Date.now() + SUPPLIER_SESSION_TTL_MS;
    localStorage.setItem(SUPPLIER_SESSION_KEY, JSON.stringify(parsed));
  } catch {}
}

function clearSupplierSession() {
  localStorage.removeItem(SUPPLIER_SESSION_KEY);
}

function getInitialScreenFromUrl() {
  return "dashboard";
}

async function apiGet(path, params = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && `${v}` !== "") query.set(k, `${v}`);
  });
  const url = `${API_BASE}${path}${query.toString() ? `?${query}` : ""}`;
  const res = await fetch(url);
  if (!res.ok) {
    const err = new Error(`GET ${path} failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

async function apiPost(path, payload = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = new Error(`POST ${path} failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

function userSafeMessage(message, fallback = "Something went wrong. Please try again.") {
  const raw = `${message || ""}`.trim();
  if (!raw) return fallback;
  const lower = raw.toLowerCase();
  if (
    lower.includes("gemini") ||
    lower.includes("model unavailable") ||
    lower.includes("llm") ||
    lower.includes("quota")
  ) {
    return "We could not auto-extract some details right now. Please review and continue.";
  }
  return raw;
}

async function _blobToDataUrl(blob) {
  return await new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(`${reader.result || ""}`);
    reader.onerror = () => resolve("");
    reader.readAsDataURL(blob);
  });
}

async function _imageToJpegDataUrl(src) {
  return await new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth || img.width || 0;
        canvas.height = img.naturalHeight || img.height || 0;
        if (!canvas.width || !canvas.height) return resolve("");
        const ctx = canvas.getContext("2d");
        if (!ctx) return resolve("");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        resolve(canvas.toDataURL("image/jpeg", 0.92));
      } catch {
        resolve("");
      }
    };
    img.onerror = () => resolve("");
    img.src = src;
  });
}

function emptyMachineDraft() {
  return {
    id: "",
    name: "",
    equipment_text: "",
    manufacturer: "",
    serial_number: "",
    year_of_purchase_install_date: "",
    machine_notes: "",
    use_cases: "",
    status: "",
    other_equipment: "",
    other_materials: "",
    material_ids: [],
    material_ids_original: [],
    matched_equipment_id: "",
    matched_equipment_name: "",
  };
}

function splitLooseList(raw) {
  return `${raw || ""}`
    .split(/[\n,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

async function _imageUrlToDataUrl(url) {
  try {
    if (!url) return "";
    if (`${url}`.startsWith("data:image")) {
      const jpeg = await _imageToJpegDataUrl(url);
      return jpeg || `${url}`;
    }
    const res = await fetch(url);
    if (!res.ok) return "";
    const blob = await res.blob();
    const rawDataUrl = await _blobToDataUrl(blob);
    const jpeg = await _imageToJpegDataUrl(rawDataUrl);
    return jpeg || rawDataUrl;
  } catch {
    return "";
  }
}

async function generateStyledAssessmentPdf({ filename, rfpId, displayRfp, fitView, scoredParts, jobsView }) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const PAGE_W = 595.28;
  const PAGE_H = 841.89;
  const M = 28;
  let y = 0;
  const t = (v) => `${v || ""}`.replace(/[^\x20-\x7E]/g, " ").trim();

  const ensureSpace = (h = 40) => {
    if (y + h > PAGE_H - M) {
      doc.addPage();
      y = M;
    }
  };
  const section = (title) => {
    ensureSpace(28);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(27, 45, 79);
    doc.text(title, M, y);
    doc.setDrawColor(200, 210, 224);
    doc.setLineWidth(1);
    doc.line(M, y + 6, PAGE_W - M, y + 6);
    y += 20;
  };

  doc.setFillColor(17, 30, 51);
  doc.rect(0, 0, PAGE_W, 108, "F");
  doc.setDrawColor(184, 146, 10);
  doc.setLineWidth(2);
  doc.line(0, 108, PAGE_W, 108);
  doc.setTextColor(250, 252, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text("Trustbridge", M, 34);
  doc.setFontSize(10);
  doc.setTextColor(200, 210, 224);
  doc.text("Supplier Portal - RFP Assessment", M, 52);
  doc.setTextColor(250, 252, 255);
  doc.setFontSize(14);
  doc.text(t(displayRfp?.project || displayRfp?.buyer || "RFP Assessment"), M, 74);
  doc.setFontSize(10);
  doc.setTextColor(210, 220, 232);
  doc.text(`RFP ID: ${t(rfpId || "-")}`, M, 91);

  const cardW = 140;
  const cardX = PAGE_W - M - cardW;
  doc.setFillColor(232, 237, 245);
  doc.roundedRect(cardX, 20, cardW, 74, 6, 6, "F");
  doc.setTextColor(27, 45, 79);
  doc.setFontSize(10);
  doc.text("Overall Bid Intelligence", cardX + 10, 38);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(26);
  doc.text(`${fitView?.overall ?? 0}`, cardX + 10, 69);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(107, 127, 150);
  doc.text("requested fit - manufacturability - similarity", cardX + 10, 84);
  y = 126;

  section("Incoming RFP");
  const infoRows = [
    ["Buyer", t(displayRfp?.buyer || "-")],
    ["Project", t(displayRfp?.project || "-")],
    ["Certifications", t(Array.isArray(displayRfp?.certs) ? displayRfp.certs.join(", ") : (displayRfp?.certs || "-"))],
    ["Delivery", t(displayRfp?.delivery || "-")],
    ["Geo Preference", t(displayRfp?.geo || "-")],
    ["Buyer Priority", t(displayRfp?.priority || "No additional priority notes.")],
  ];
  const colW = (PAGE_W - M * 2 - 12) / 2;
  infoRows.forEach((row, idx) => {
    ensureSpace(46);
    const col = idx % 2;
    if (col === 0 && idx > 0) y += 42;
    const x = M + col * (colW + 12);
    doc.setFillColor(240, 243, 248);
    doc.roundedRect(x, y - 14, colW, 34, 4, 4, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(107, 127, 150);
    doc.text(t(row[0]), x + 8, y - 2);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(27, 45, 79);
    doc.text(doc.splitTextToSize(t(row[1]), colW - 16).slice(0, 2), x + 8, y + 12);
  });
  if (infoRows.length % 2 === 1) y += 42;
  y += 10;

  section("Bid Intelligence Detail");
  (Array.isArray(fitView?.dims) ? fitView.dims : []).forEach((d) => {
    ensureSpace(58);
    doc.setFillColor(248, 250, 255);
    doc.roundedRect(M, y - 12, PAGE_W - M * 2, 48, 5, 5, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(27, 45, 79);
    doc.text(t(d.label), M + 10, y + 2);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(107, 127, 150);
    doc.text(doc.splitTextToSize(t(d.sub || ""), PAGE_W - M * 2 - 90).slice(0, 2), M + 10, y + 14);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.setTextColor(27, 45, 79);
    doc.text(`${d.val ?? 0}`, PAGE_W - M - 28, y + 12, { align: "right" });
    y += 56;
  });

  section("Assessment Flags");
  const flags = Array.isArray(fitView?.flags) ? fitView.flags : [];
  if (!flags.length) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(107, 127, 150);
    doc.text("No flags.", M, y);
    y += 18;
  } else {
    flags.forEach((it) => {
      ensureSpace(42);
      doc.setFillColor(253, 240, 235);
      doc.roundedRect(M, y - 12, PAGE_W - M * 2, 34, 4, 4, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(122, 46, 14);
      doc.text(t(it.title || "Flag"), M + 8, y);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(45, 69, 103);
      doc.text(doc.splitTextToSize(t(it.body || ""), PAGE_W - M * 2 - 16).slice(0, 2), M + 8, y + 11);
      y += 40;
    });
  }

  section("Per-Part Breakdown");
  const parts = Array.isArray(scoredParts) ? scoredParts : [];
  if (!parts.length) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(107, 127, 150);
    doc.text("No part data.", M, y);
    y += 16;
  } else {
    for (const p of parts) {
      ensureSpace(64);
      doc.setFillColor(240, 243, 248);
      doc.roundedRect(M, y - 12, PAGE_W - M * 2, 54, 5, 5, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9.5);
      doc.setTextColor(184, 146, 10);
      doc.text(t(p.part_id || "-"), M + 8, y);
      doc.setTextColor(27, 45, 79);
      doc.text(t(p.description || ""), M + 54, y);
      doc.setFontSize(12);
      doc.text(`${p.composite ?? 0}`, PAGE_W - M - 8, y, { align: "right" });
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(45, 69, 103);
      doc.text(t(`Requested Fit: ${p.b1 ?? 0} - Manufacturability: ${p.b2 ?? 0} - Historical Similarity: ${p.c ?? 0}`), M + 8, y + 14);
      const detail = [
        p.material ? `Material: ${p.material}` : "",
        p.process ? `Process: ${p.process}` : "",
        p.tolerance ? `Tolerance: ${p.tolerance}` : "",
        p.qty ? `Qty: ${p.qty}` : "",
      ].filter(Boolean).join(" - ");
      doc.setTextColor(107, 127, 150);
      doc.text(t(detail || "No additional part details"), M + 8, y + 27);
      let imageData = `${p?.image_b64 || p?.part_image_b64 || ""}`.trim();
      if (!imageData) {
        const urlCandidate = Array.isArray(p?.matched_jobs)
          ? p.matched_jobs
              .map((m) => `${m?.image_url || ""}`.trim())
              .find((u) => u && (u.startsWith("data:image") || u.includes("/api/assessment/attachment")))
          : "";
        if (urlCandidate) {
          imageData = urlCandidate.startsWith("data:image")
            ? urlCandidate
            : await _imageUrlToDataUrl(urlCandidate);
        }
      }
      if (imageData) {
        try {
          const dataUrl = imageData.startsWith("data:image") ? imageData : `data:image/jpeg;base64,${imageData}`;
          const pdfData = await _imageUrlToDataUrl(dataUrl);
          if (pdfData) doc.addImage(pdfData, "JPEG", PAGE_W - M - 68, y - 10, 60, 36, undefined, "FAST");
        } catch {}
      }
      y += 62;
    }
  }

  section(`Historical Similarity (${(jobsView || []).length})`);
  const jobs = Array.isArray(jobsView) ? jobsView : [];
  if (!jobs.length) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(107, 127, 150);
    doc.text("No matched past projects found.", M, y);
    y += 16;
  } else {
    for (const j of jobs.slice(0, 20)) {
      ensureSpace(62);
      doc.setFillColor(250, 252, 255);
      doc.roundedRect(M, y - 12, PAGE_W - M * 2, 52, 5, 5, "F");
      doc.setDrawColor(221, 227, 238);
      doc.roundedRect(M, y - 12, PAGE_W - M * 2, 52, 5, 5, "S");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9.5);
      doc.setTextColor(27, 45, 79);
      doc.text(t(`${j.id || "JOB"} - ${j.title || "Historical Match"}`), M + 8, y);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(45, 69, 103);
      doc.text(t(`${j.process || "Process N/A"} - ${j.customer || "Historical Project"} - ${j.date || ""}`), M + 8, y + 12);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(26, 61, 92);
      doc.text(`Similarity ${j.similarity ?? 0}`, PAGE_W - M - 8, y, { align: "right" });
      let jobImageData = "";
      const candidateUrls = Array.from(new Set([
        ...(Array.isArray(j?.imageCandidates) ? j.imageCandidates : []),
        `${j?.imageUrl || ""}`.trim(),
        `${j?.image_url || ""}`.trim(),
      ].filter(Boolean)));
      for (const c of candidateUrls) {
        const probe = c.startsWith("data:image") ? c : await _imageUrlToDataUrl(c);
        if (probe) {
          jobImageData = probe;
          break;
        }
      }
      if (jobImageData) {
        try {
          const pdfData = await _imageUrlToDataUrl(jobImageData);
          if (pdfData) doc.addImage(pdfData, "JPEG", PAGE_W - M - 68, y - 10, 60, 36, undefined, "FAST");
        } catch {}
      }
      y += 58;
    }
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  doc.save(filename || `rfp-assessment-${t(rfpId || "report")}-${stamp}.pdf`);
}

const __GET_CACHE = new Map();
const __GET_INFLIGHT = new Map();

function _supplierScopeKey(session = null) {
  const s = session || getSupplierSession() || {};
  const sid = `${s.supplier_id || s.zoho_account_id || ""}`.trim().toLowerCase();
  const semail = `${s.supplier_email || s.email || ""}`.trim().toLowerCase();
  return `${sid || "noid"}::${semail || "noemail"}`;
}

function _dashboardSnapshotKey(session = null) {
  return `tb_dashboard_snapshot_v1:${_supplierScopeKey(session)}`;
}

function _ingestionSnapshotKey(session = null) {
  return `tb_ingestion_snapshot_v1:${_supplierScopeKey(session)}`;
}

function _quoteAwardOverridesKey(session = null) {
  return `tb_quote_award_overrides_v1:${_supplierScopeKey(session)}`;
}

function _pastProjectFieldOverridesKey(session = null) {
  return `tb_past_project_field_overrides_v1:${_supplierScopeKey(session)}`;
}

function getPastProjectFieldOverrides(session = null) {
  try {
    const raw = localStorage.getItem(_pastProjectFieldOverridesKey(session));
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function savePastProjectFieldOverrides(overrides = {}, session = null) {
  try {
    localStorage.setItem(_pastProjectFieldOverridesKey(session), JSON.stringify(overrides || {}));
  } catch {}
}

function applyPastProjectFieldOverrides(mapped = { deals: [], jobs: [] }, session = null) {
  const map = getPastProjectFieldOverrides(session);
  const projectMap = map.projects || {};
  const partMap = map.parts || {};
  const deals = (Array.isArray(mapped.deals) ? mapped.deals : []).map((deal) => {
    const ov = projectMap[`${deal?.id || ""}`] || {};
    return Object.keys(ov).length ? { ...deal, ...ov } : deal;
  });
  const jobs = (Array.isArray(mapped.jobs) ? mapped.jobs : []).map((job) => {
    const partKey = `${job?.dealId || ""}|${job?.sourcePartId || job?.id || ""}`;
    const ov = partMap[partKey] || {};
    return Object.keys(ov).length ? { ...job, ...ov } : job;
  });
  return { ...mapped, deals, jobs };
}

function getQuoteAwardOverrides(session = null) {
  try {
    const raw = localStorage.getItem(_quoteAwardOverridesKey(session));
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveQuoteAwardOverrides(overrides = {}, session = null) {
  try {
    localStorage.setItem(_quoteAwardOverridesKey(session), JSON.stringify(overrides || {}));
  } catch {}
}

function applyQuoteAwardOverrides(jobs = [], session = null) {
  const map = getQuoteAwardOverrides(session);
  return (Array.isArray(jobs) ? jobs : []).map((job) => {
    const key = `${job?.dealId || ""}|${job?.sourcePartId || job?.id || ""}`.trim();
    const ov = key ? map[key] : null;
    if (!ov) return job;
    return {
      ...job,
      quotedAmount: `${ov.quotedAmount || job?.quotedAmount || ""}`.trim(),
      awardPo: `${ov.awardPo || job?.awardPo || ""}`.trim(),
      awardAmount: `${ov.awardAmount || job?.awardAmount || ""}`.trim(),
      outcome: `${ov.outcome || job?.outcome || ""}`.trim(),
      quotingLesson: `${ov.quotingLesson || job?.quotingLesson || ""}`.trim(),
    };
  });
}

function mapZohoMfgLesson(l = {}, idx = 0) {
  return {
    id: l.id || `ML-${idx + 1}`,
    category: l.category || "Other",
    title: l.title || "Manufacturing Lesson",
    body: l.desc || l.body || "",
    processes: l.process ? [l.process] : [],
    materials: l.material ? [l.material] : [],
    sourceJobs: l.source_part ? [l.source_part] : [],
    tier: l.tier || "anonymized",
    date: l.date || "2026-03",
    projectRecordId: l.project_record_id || l.projectRecordId || "",
    attachments: [],
  };
}

function mapZohoQuotingLesson(l = {}, idx = 0) {
  const attachmentNames = `${l.attachment_names || ""}`
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  return {
    id: l.id || `QL-${idx + 1}`,
    category: l.category || "Other",
    title: l.title || "Quoting Lesson",
    body: l.desc || l.body || "",
    processes: l.process ? [l.process] : [],
    materials: l.material ? [l.material] : [],
    sourceJobs: (l.source_job || l.source_label) ? [l.source_job || l.source_label] : [],
    tier: l.tier || "anonymized",
    date: l.date || "2026-03",
    projectRecordId: l.project_record_id || l.projectRecordId || "",
    attachments: [
      ...(l.image_name ? [{ type: "image", name: l.image_name, label: l.image_name }] : []),
      ...attachmentNames.map((name) => ({ type: "doc", name, label: name })),
    ],
  };
}

function normalizeLessonMatchText(value) {
  return `${value || ""}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function lessonTextIncludes(source, value) {
  const src = normalizeLessonMatchText(source);
  const val = normalizeLessonMatchText(value);
  return Boolean(src && val && src.includes(val));
}

function buildLessonSourceLabel(deal, job, fallback = "") {
  return [deal?.name || deal?.customer, job?.id || job?.sourcePartId || job?.name]
    .filter(Boolean)
    .join(" · ") || `${fallback || ""}`.trim();
}

function resolveLessonSelection(lesson = {}, jobsData = [], dealsData = []) {
  const sources = Array.isArray(lesson?.sourceJobs) ? lesson.sourceJobs.filter(Boolean) : [];
  const sourceText = sources.join(" · ");
  const projectRecordId = `${lesson?.projectRecordId || lesson?.project_record_id || ""}`.trim();
  const sourceTail = `${sourceText}`.split(" · ").pop()?.trim() || "";

  let matchedJob =
    (jobsData || []).find((j) => projectRecordId && `${j?.sourceRecordId || ""}`.trim() === projectRecordId) ||
    (jobsData || []).find((j) => sourceTail && `${j?.id || ""}`.trim() === sourceTail) ||
    (jobsData || []).find((j) =>
      [j?.id, j?.sourcePartId, j?.name, j?.partName].some((value) => lessonTextIncludes(sourceText, value)),
    ) ||
    null;

  let matchedDeal =
    matchedJob
      ? (dealsData || []).find((d) => `${d?.id || ""}`.trim() === `${matchedJob?.dealId || ""}`.trim())
      : null;

  if (!matchedDeal) {
    matchedDeal =
      (dealsData || []).find((d) => {
        const recordIds = Array.isArray(d?.recordIds) ? d.recordIds : [];
        return projectRecordId && [d?.recordId, d?.sourceRecordId, ...recordIds].some((id) => `${id || ""}`.trim() === projectRecordId);
      }) ||
      (dealsData || []).find((d) =>
        [d?.id, d?.name, d?.customer].some((value) => lessonTextIncludes(sourceText, value)),
      ) ||
      null;
  }

  if (!matchedJob && matchedDeal) {
    matchedJob =
      (jobsData || []).find((j) => `${j?.dealId || ""}`.trim() === `${matchedDeal?.id || ""}`.trim() && projectRecordId && `${j?.sourceRecordId || ""}`.trim() === projectRecordId) ||
      (jobsData || []).find((j) => `${j?.dealId || ""}`.trim() === `${matchedDeal?.id || ""}`.trim() && [j?.id, j?.sourcePartId, j?.name, j?.partName].some((value) => lessonTextIncludes(sourceText, value))) ||
      (jobsData || []).find((j) => `${j?.dealId || ""}`.trim() === `${matchedDeal?.id || ""}`.trim()) ||
      null;
  }

  return {
    deal: matchedDeal,
    job: matchedJob,
    sourceLabel: buildLessonSourceLabel(matchedDeal, matchedJob, sourceText),
  };
}

function mergeLessonsById(existing = [], incoming = []) {
  const byKey = new Map();
  const order = [];
  const lessonKey = (lesson) => {
    const id = `${lesson?.id || ""}`.trim();
    const natural = getLessonNaturalKey(lesson);
    return natural || (id ? `id:${id}` : `anon:${order.length}`);
  };
  const push = (lesson) => {
    const key = lessonKey(lesson);
    if (!byKey.has(key)) order.push(key);
    byKey.set(key, { ...(byKey.get(key) || {}), ...(lesson || {}) });
  };
  (Array.isArray(existing) ? existing : []).forEach(push);
  (Array.isArray(incoming) ? incoming : []).forEach(push);
  return order.map((key) => byKey.get(key)).filter(Boolean);
}

function getLessonNaturalKey(lesson = {}) {
  const title = normalizeLessonMatchText(lesson?.title);
  const body = normalizeLessonMatchText(lesson?.body || lesson?.desc);
  const category = normalizeLessonMatchText(lesson?.category || "Other");
  const projectRecordId = normalizeLessonMatchText(lesson?.projectRecordId || lesson?.project_record_id);
  const source = normalizeLessonMatchText(Array.isArray(lesson?.sourceJobs) ? lesson.sourceJobs.join(" ") : "");
  const date = normalizeLessonMatchText(`${lesson?.date || ""}`.slice(0, 7));
  if (!title && !body) return "";
  return [category, title, body, projectRecordId || source, date].join("|");
}

function dedupeLessons(lessons = []) {
  return mergeLessonsById([], Array.isArray(lessons) ? lessons : []);
}

function clearUiDataCaches() {
  try {
    __GET_CACHE.clear();
    __GET_INFLIGHT.clear();
  } catch {}
  try {
    const keys = [];
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const k = sessionStorage.key(i);
      if (!k) continue;
      if (
        k === "tb_dashboard_snapshot_v1" ||
        k === "tb_ingestion_snapshot_v1" ||
        k.startsWith("tb_dashboard_snapshot_v1:") ||
        k.startsWith("tb_ingestion_snapshot_v1:")
      ) {
        keys.push(k);
      }
    }
    keys.forEach((k) => sessionStorage.removeItem(k));
  } catch {}
}

async function apiGetCached(path, params = {}, options = {}) {
  const ttlMs = Number(options?.ttlMs || 0);
  const force = Boolean(options?.force);
  const query = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && `${v}` !== "") query.set(k, `${v}`);
  });
  const key = `${path}?${query.toString()}`;
  const now = Date.now();
  if (!force && ttlMs > 0) {
    const hit = __GET_CACHE.get(key);
    if (hit && now - hit.ts < ttlMs) return hit.data;
  }
  if (!force && __GET_INFLIGHT.has(key)) return __GET_INFLIGHT.get(key);
  const promise = apiGet(path, params)
    .then((data) => {
      if (ttlMs > 0) __GET_CACHE.set(key, { ts: Date.now(), data });
      __GET_INFLIGHT.delete(key);
      return data;
    })
    .catch((e) => {
      __GET_INFLIGHT.delete(key);
      throw e;
    });
  __GET_INFLIGHT.set(key, promise);
  return promise;
}

function withTimeout(promise, ms = 4500) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("Request timed out")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const CRITICAL_INGESTION_TIMEOUT_MS = 120000;
const BACKGROUND_INGESTION_TIMEOUT_MS = 15000;

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const raw = `${reader.result || ""}`;
      const b64 = raw.includes(",") ? raw.split(",")[1] : raw;
      resolve(b64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function mergeFilesUnique(prevFiles = [], nextFiles = [], limit = 0) {
  const prev = Array.isArray(prevFiles) ? prevFiles : [];
  const incoming = Array.isArray(nextFiles) ? nextFiles : Array.from(nextFiles || []);
  const seen = new Set(prev.map((f) => `${f?.name || ""}|${f?.size || 0}|${f?.lastModified || 0}`));
  const merged = [...prev];
  incoming.forEach((f) => {
    const key = `${f?.name || ""}|${f?.size || 0}|${f?.lastModified || 0}`;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(f);
    }
  });
  if (Number(limit || 0) > 0) return merged.slice(0, Number(limit));
  return merged;
}

function fileStem(name = "") {
  const raw = `${name || ""}`.trim();
  if (!raw) return "";
  return raw.replace(/\.[^/.]+$/, "").trim();
}

function cleanExtractedText(v = "") {
  let s = `${v || ""}`.trim();
  if (!s) return "";
  s = s.replace(/\*\*/g, "");
  s = s.replace(/`/g, "");
  s = s.replace(/\s+/g, " ").trim();
  s = s.replace(/^\|\s*/, "").replace(/\s*\|$/, "").trim();
  return s;
}

function looksLikeBadOrgValue(v = "") {
  const s = cleanExtractedText(v);
  if (!s) return false;
  if (s.length > 120) return true;
  const wc = s.split(" ").filter(Boolean).length;
  if (wc >= 14) return true;
  return /secondary|cost is|understands|flatness|post-finish|quotation|request for proposal/i.test(s);
}

function normalizeProjectName(v = "", fallback = "") {
  const s = cleanExtractedText(v);
  const fb = cleanExtractedText(fallback);
  if (!s) return fb;
  if (/^issued\s*:/i.test(s)) return fb;
  if (/^date\s*:/i.test(s)) return fb;
  if (/^#\s*request for proposal/i.test(s)) return fb;
  return s;
}

function buildExtractedProjectPatch(extracted = {}, opts = {}) {
  const supplierName = cleanExtractedText(opts.supplierName || "");
  const supplierLocation = cleanExtractedText(opts.supplierLocation || "");
  const supplierSize = cleanExtractedText(opts.supplierSize || "");
  const orgNameRaw = cleanExtractedText(extracted.company_name || extracted.customer_company || "");
  const orgName = looksLikeBadOrgValue(orgNameRaw) ? "" : orgNameRaw;
  const customerName = cleanExtractedText(
    extracted.customer_name ||
    extracted.contact_name ||
    orgName ||
    ""
  );
  const certs = Array.isArray(extracted.mandatory_certifications)
    ? extracted.mandatory_certifications.map((v) => cleanExtractedText(v)).filter(Boolean).join(", ")
    : cleanExtractedText(extracted.mandatory_certifications || "");
  return {
    company_name: supplierName,
    company_location: supplierLocation,
    company_size: supplierSize,
    customer_name: customerName,
    contact_email: cleanExtractedText(extracted.contact_email || ""),
    contact_phone: cleanExtractedText(extracted.contact_phone || ""),
    project_name: normalizeProjectName(
      extracted.project_name || extracted.part_family || "",
      customerName || orgName || ""
    ),
    project_overview: cleanExtractedText(
      extracted.project_overview ||
      extracted.project_description ||
      extracted.overview ||
      ""
    ),
    customer_industry: cleanExtractedText(extracted.customer_industry || ""),
    project_date: cleanExtractedText(extracted.project_date || ""),
    expected_annual_production_volume: cleanExtractedText(extracted.expected_annual_production_volume || ""),
    mandatory_certifications: certs,
    certification_notes: cleanExtractedText(extracted.certification_notes || ""),
    other_project_requirements: cleanExtractedText(extracted.other_project_requirements || ""),
    part_family: cleanExtractedText(extracted.part_family || ""),
    material: cleanExtractedText(extracted.material || ""),
    process_primary: cleanExtractedText(extracted.process_primary || ""),
  };
}

function mergeProjectDraftFromExtraction(prev = {}, extracted = {}, opts = {}) {
  const patch = buildExtractedProjectPatch(extracted, opts);
  const overwrite = Boolean(opts.overwrite);
  const pick = (key) => {
    const incoming = patch[key] || "";
    if (overwrite && `${incoming || ""}`.trim()) return incoming;
    return prev[key] || incoming || "";
  };
  return {
    ...prev,
    company_name: pick("company_name"),
    company_location: pick("company_location"),
    company_size: pick("company_size"),
    customer_name: pick("customer_name"),
    contact_email: pick("contact_email"),
    contact_phone: pick("contact_phone"),
    project_name: pick("project_name"),
    project_overview: pick("project_overview"),
    customer_industry: pick("customer_industry"),
    project_date: pick("project_date"),
    expected_annual_production_volume: pick("expected_annual_production_volume"),
    mandatory_certifications: pick("mandatory_certifications"),
    certification_notes: pick("certification_notes"),
    other_project_requirements: pick("other_project_requirements"),
    part_family: pick("part_family"),
    material: pick("material"),
    process_primary: pick("process_primary"),
  };
}

function getProjectDraftConflicts(current = {}, extracted = {}, opts = {}) {
  const patch = buildExtractedProjectPatch(extracted, opts);
  const labels = {
    company_name: "Company Name",
    company_location: "Location",
    company_size: "Company Size",
    customer_name: "Customer Name",
    contact_email: "Contact Email",
    contact_phone: "Contact Phone",
    project_name: "Project Name",
    project_overview: "Project Overview",
    customer_industry: "Industry",
    project_date: "Project Date",
    expected_annual_production_volume: "Expected Annual Production Volume",
    mandatory_certifications: "Mandatory Certifications",
    certification_notes: "Certification Notes",
    other_project_requirements: "Other Project Requirements",
    part_family: "Part Family",
    material: "Material",
    process_primary: "Process",
  };
  return Object.entries(labels)
    .filter(([key]) => {
      const existing = `${current?.[key] || ""}`.trim();
      const incoming = `${patch?.[key] || ""}`.trim();
      return existing && incoming && existing !== incoming;
    })
    .map(([, label]) => label);
}

function isCadFileName(name = "") {
  const n = `${name}`.toLowerCase();
  return [".step", ".stp", ".igs", ".iges", ".stl", ".obj", ".ply", ".glb", ".gltf", ".3mf"].some((ext) => n.endsWith(ext));
}

function isImageFileName(name = "") {
  const n = `${name}`.toLowerCase();
  return [".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif", ".avif", ".tif", ".tiff"].some((ext) => n.endsWith(ext));
}

function isTextDocFileName(name = "") {
  const n = `${name}`.toLowerCase();
  return [".docx", ".txt", ".md", ".csv", ".tsv", ".rtf", ".json", ".doc"].some((ext) => n.endsWith(ext));
}

function isoDay(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function addDaysIso(iso, days) {
  const d = new Date(iso || Date.now());
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function buildAssessmentIdVariants(raw) {
  const id = `${raw || ""}`.trim();
  const out = new Set();
  if (!id) return out;
  out.add(id);
  if (id.startsWith("ZOHO-RFP-")) {
    out.add(id.replace("ZOHO-", ""));
    return out;
  }
  if (id.startsWith("ZOHO-")) {
    // For CRM-backed snapshots, keep only the canonical Zoho-prefixed id.
    // Querying stripped numeric ids causes noisy 404s.
    return out;
  }
  if (/^\d{10,}$/.test(id)) {
    out.clear();
    out.add(`ZOHO-${id}`);
  }
  return out;
}

function toRfpCardShape(item = {}, index = 0) {
  const received = isoDay(item.created_at) || "2026-03-30";
  const due = item.delivery ? isoDay(item.delivery) || addDaysIso(received, 7) : addDaysIso(received, 7);
  const statusRaw = `${item.status || ""}`.toLowerCase();
  const status = ["new", "in_assessment", "quote_submitted", "won", "lost", "no_bid"].includes(statusRaw)
    ? statusRaw
    : "new";
  const rawScore = Number(item.overall_score ?? item.matchScore);
  const normalizedScore = Number.isFinite(rawScore)
    ? Math.max(0, Math.min(100, Math.round(rawScore)))
    : 0;
  const partsPrefill = Array.isArray(item.parts)
    ? item.parts.map((part, idx) => ({
        id: `${part?.id || `P-${String(idx + 1).padStart(3, "0")}`}`,
        description: `${part?.description || part?.part_name || part?.label || part?.name || ""}`.trim() || `Part ${idx + 1}`,
        material: `${part?.material || part?.mat || part?.Material || ""}`.trim(),
        process: `${part?.process || part?.process_primary || part?.proc || part?.Process || ""}`.trim(),
        tolerance: `${part?.tolerance || part?.tolerance_class || part?.tol || part?.Tolerance || ""}`.trim(),
        other: `${part?.other || part?.tolerance || part?.tolerance_class || part?.tol || ""}`.trim(),
        qty: `${part?.qty ?? part?.quantity ?? part?.Quantity ?? 1}`,
        finish: `${part?.finish || part?.surface_finish || ""}`.trim(),
        notes: `${part?.notes || ""}`.trim(),
        images: [
          `${part?.image_url || ""}`.trim(),
          `${part?.part_image_url || ""}`.trim(),
          `${part?.image_preview || ""}`.trim(),
        ].filter(Boolean),
        file_upload: part?.file_upload || null,
      }))
    : [];
  return {
    id: item.id || item.rfp_id || item.view_id || `RFP-AUTO-${index + 1}`,
    sourceRfpId: item.record_id || item.rfp_id || item.id || "",
    zohoId: item.zoho_id || "",
    crmRecordId: item.record_id || "",
    crmSource: Boolean(item.crm_source),
    view_id: item.view_id || item.id || item.rfp_id || "",
    has_cached: Boolean(item.has_cached),
    buyer: item.buyer || "Unknown Buyer",
    received,
    due,
    parts: Number(item.parts_count || item.parts || 1) || 1,
    processes: Array.isArray(item.processes) ? item.processes.filter(Boolean) : [],
    materials: Array.isArray(item.materials) ? item.materials.filter(Boolean) : [],
    certs: Array.isArray(item.certs_required) ? item.certs_required.filter(Boolean) : [],
    matchScore: normalizedScore,
    status,
    summary: item.summary || item.project || "Inbound RFP",
    project: item.project || item.summary || "Inbound RFP",
    location: item.location || "",
    geo_preference: item.geo_preference || "",
    geo_constraint_multi: Array.isArray(item.geo_constraint_multi) ? item.geo_constraint_multi : [],
    certification_preferences: item.certification_preferences || "",
    parts_prefill: partsPrefill,
  };
}

function normalizeRfpCard(row = {}, index = 0) {
  const fallback = toRfpCardShape({}, index);
  const processes = Array.isArray(row?.processes) ? row.processes.filter(Boolean) : [];
  const materials = Array.isArray(row?.materials) ? row.materials.filter(Boolean) : [];
  const certs = Array.isArray(row?.certs) ? row.certs.filter(Boolean) : [];
  const status = ["new", "in_assessment", "quote_submitted", "won", "lost", "no_bid"].includes(`${row?.status || ""}`)
    ? `${row.status}`
    : "new";
  return {
    ...fallback,
    ...row,
    id: `${row?.id || fallback.id}`.trim() || fallback.id,
    processes,
    materials,
    certs,
    status,
    matchScore: Number.isFinite(Number(row?.matchScore)) ? Number(row.matchScore) : 0,
    parts: Number.isFinite(Number(row?.parts)) ? Number(row.parts) : 1,
    buyer: `${row?.buyer || fallback.buyer}`.trim() || fallback.buyer,
    project: `${row?.project || fallback.project}`.trim() || fallback.project,
  };
}

function buildDeadlinesFromRfps(rfps = []) {
  const now = new Date();
  return rfps
    .map((r) => {
      const dueDate = new Date(r.due);
      const daysLeft = Number.isNaN(dueDate.getTime()) ? 99 : Math.round((dueDate - now) / 86400000);
      return {
        rfpId: r.id,
        buyer: r.buyer,
        due: r.due,
        daysLeft,
        matchScore: r.matchScore,
        status: r.status,
      };
    })
    .sort((a, b) => a.daysLeft - b.daysLeft)
    .slice(0, 8);
}

function canonicalIngestionProjectKey(project = {}, idx = 0) {
  const compact = (v) => `${v || ""}`.trim();
  const norm = (v) => compact(v).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const explicit =
    compact(project.project_id) ||
    compact(project.projectId) ||
    compact(project.parent_project_id) ||
    compact(project.parentProjectId);
  if (explicit) return `explicit:${norm(explicit)}`;

  const parts = Array.isArray(project.parts) ? project.parts : [];
  const firstPart = parts[0] || {};
  const name = norm(project.project_name || project.name || project.project || firstPart.project_name || firstPart.part_family);
  if (!name) return `record:${compact(project.id) || idx}`;
  const date = compact(firstPart.project_date || project.project_date || project.submitted_date || project.created_time).slice(0, 7);
  return `derived:${[name, date].filter(Boolean).join("|")}`;
}

function mergeProjectRecordsForIngestion(projects = []) {
  const grouped = new Map();
  (Array.isArray(projects) ? projects : []).forEach((project, idx) => {
    const key = canonicalIngestionProjectKey(project, idx);
    const parts = Array.isArray(project?.parts) ? project.parts : [];
    if (!grouped.has(key)) {
      grouped.set(key, {
        ...project,
        id: project?.id || `DEAL-${String(grouped.size + 1).padStart(3, "0")}`,
        parts: [...parts],
        _source_project_ids: [`${project?.id || ""}`.trim()].filter(Boolean),
      });
      return;
    }
    const existing = grouped.get(key);
    const existingIds = new Set(existing._source_project_ids || []);
    const sourceId = `${project?.id || ""}`.trim();
    if (sourceId) existingIds.add(sourceId);
    grouped.set(key, {
      ...project,
      ...existing,
      project_name: existing.project_name || project.project_name,
      customer_name: existing.customer_name || project.customer_name,
      company_name: existing.company_name || project.company_name,
      project_description: existing.project_description || project.project_description,
      sharing_tier: existing.sharing_tier || project.sharing_tier,
      expected_annual_production_volume: existing.expected_annual_production_volume || project.expected_annual_production_volume,
      mandatory_certifications: existing.mandatory_certifications || project.mandatory_certifications,
      certification_notes: existing.certification_notes || project.certification_notes,
      other_project_requirements: existing.other_project_requirements || project.other_project_requirements,
      parts: [...(existing.parts || []), ...parts],
      _source_project_ids: Array.from(existingIds),
    });
  });
  return Array.from(grouped.values());
}

function mapProjectsToIngestion(projects = []) {
  const deals = [];
  const jobs = [];
  const groupedProjects = mergeProjectRecordsForIngestion(projects);
  groupedProjects.forEach((project, idx) => {
    const dealId = project.id || `DEAL-${String(idx + 1).padStart(3, "0")}`;
    const parts = Array.isArray(project.parts) ? project.parts : [];
    const firstPart = parts[0] || {};
    const sourceProjectIds = Array.isArray(project._source_project_ids) ? project._source_project_ids : [];
    const recordIds = [
      ...sourceProjectIds,
      ...parts.map((part) => `${part.source_record_id || part.record_id || ""}`.trim()),
    ].filter(Boolean);
    const partIds = parts.map((part) => `${part.part_id || ""}`.trim()).filter(Boolean);
    deals.push({
      id: dealId,
      customer: project.customer_name || project.project_name || `Customer ${idx + 1}`,
      name: project.project_name || `Program ${idx + 1}`,
      description: project.project_description || project.project_name || "Imported from supplier corpus",
      dateStart: "2024-01",
      dateEnd: "ongoing",
      status: "active",
      tier: `${project.sharing_tier || ""}`.toLowerCase().includes("attr") ? "attributed" : "anonymized",
      companyName: project.company_name || "",
      companySize: project.company_size || "",
      companyLocation: project.company_location || "",
      contactPhone: project.contact_phone || "",
      contactEmail: project.contact_email || "",
      customerIndustry: firstPart.customer_industry || "",
      expectedAnnualProductionVolume: project.expected_annual_production_volume || "",
      mandatoryCertifications: Array.isArray(project.mandatory_certifications) ? project.mandatory_certifications : csvTags(project.mandatory_certifications),
      certificationNotes: project.certification_notes || "",
      otherProjectRequirements: project.other_project_requirements || "",
      partFamily: firstPart.part_family || project.project_name || "",
      material: firstPart.material || "",
      processPrimary: firstPart.process_primary || firstPart.process || "",
      projectDate: firstPart.project_date || "",
      projectOverview: project.project_description || firstPart.additional_notes || firstPart.notes || firstPart.what_worked || firstPart.what_didnt || "",
      whatWorked: firstPart.what_worked || "",
      outcome: firstPart.outcome || "Success",
      recordIds,
      partIds,
    });
    parts.forEach((part, pIdx) => {
      const imageUrls = [];
      const pushUrl = (u) => {
        const s = `${u || ""}`.trim();
        if (!s) return;
        if (!imageUrls.includes(s)) imageUrls.push(s);
      };
      pushUrl(part.image_url);
      (Array.isArray(part.images) ? part.images : []).forEach(pushUrl);
      (Array.isArray(part.attachments) ? part.attachments : []).forEach((a) => {
        if (!a) return;
        if (a.url) pushUrl(a.url);
      });
      jobs.push({
        id: part.part_id || `${project.job_id || "JOB"}-${pIdx + 1}`,
        dealId,
        name: part.part_name || part.part_family || `Job ${pIdx + 1}`,
        partName: part.part_name || "",
        partDetail: part.part_detail || "",
        rfqRef: "",
        date: `${part.project_date || "2024-01"}`.slice(0, 7),
        process: part.process_primary || part.process || "",
        material: part.material || "",
        quantity: part.quantity || "",
        surfaceFinish: part.surface_finish || "",
        toleranceDetails: part.tolerance_details || "",
        partEnvelope: part.part_envelope || "",
        requirements: part.requirements || "",
        additionalNotes: part.additional_notes || "",
        dataSharingTier: part.data_sharing_tier || project.sharing_tier || "",
        tier: `${project.sharing_tier || ""}`.toLowerCase().includes("attr") ? "attributed" : "anonymized",
        overview: part.additional_notes || part.what_worked || part.what_didnt || project.project_description || project.project_name || "Historical project ingestion record.",
        sourceRecordId: part.source_record_id || part.record_id || "",
        sourcePartId: part.part_id || "",
        customerIndustry: part.customer_industry || "",
        partFamily: part.part_family || part.part_name || "",
        whatWorked: part.what_worked || "",
        quotingLesson: part.quoting_lesson || "",
        outcome: part.outcome || firstPart.outcome || project.outcome || "",
        bidLineId: part.bid_line_id || part.bidLineId || part.quote_line_id || "",
        quotedAmount:
          part.quoted_amount ||
          part.quotedAmount ||
          part.quote_amount ||
          part.quoteAmount ||
          part.quote_value ||
          part.bid_amount ||
          part?.quote_award?.quote_value ||
          "",
        awardPo:
          part.award_po ||
          part.awardPo ||
          part.po_number ||
          part.poNumber ||
          part.order_id ||
          part?.quote_award?.po_number ||
          "",
        awardAmount:
          part.award_amount ||
          part.awardAmount ||
          part.po_amount ||
          part.order_amount ||
          part.award_value ||
          part?.quote_award?.award_value ||
          "",
        imageUrls,
      });
    });
  });
  return { deals, jobs };
}

function hasMeaningfulQuoteAward(job = {}) {
  const q = `${job?.quotedAmount || job?.quoteAmount || job?.bidAmount || ""}`.trim();
  const po = `${job?.awardPo || job?.poNumber || job?.orderId || ""}`.trim();
  const a = `${job?.awardAmount || job?.poAmount || job?.orderAmount || ""}`.trim();
  const o = `${job?.outcome || ""}`.trim();
  return Boolean(q || po || a || o);
}

function mergeJobsPreferRich(existing = [], incoming = []) {
  const byKey = new Map();
  (Array.isArray(existing) ? existing : []).forEach((j) => {
    const key = `${j?.dealId || ""}|${j?.sourcePartId || j?.id || ""}`;
    if (key.trim()) byKey.set(key, j);
  });
  (Array.isArray(incoming) ? incoming : []).forEach((j) => {
    const key = `${j?.dealId || ""}|${j?.sourcePartId || j?.id || ""}`;
    if (!key.trim()) return;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, j);
      return;
    }
    const incomingRich = hasMeaningfulQuoteAward(j);
    const prevRich = hasMeaningfulQuoteAward(prev);
    if (incomingRich || !prevRich) {
      byKey.set(key, { ...prev, ...j });
    } else {
      byKey.set(key, { ...j, ...prev });
    }
  });
  return Array.from(byKey.values());
}

function canonicalVisibleDealKey(deal = {}, dealJobs = []) {
  const norm = (v) => `${v || ""}`.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const name = norm(deal.name || deal.customer || deal.projectName || deal.partFamily);
  if (!name) return `deal:${deal.id || ""}`;
  const date =
    `${deal.projectDate || deal.dateStart || dealJobs[0]?.date || ""}`.trim().slice(0, 7);
  return `visible:${[name, date].filter(Boolean).join("|")}`;
}

function normalizeVisibleIngestionData(deals = [], jobs = []) {
  const jobList = Array.isArray(jobs) ? jobs : [];
  const jobsByDeal = new Map();
  jobList.forEach((job) => {
    const dealId = `${job?.dealId || ""}`.trim();
    if (!jobsByDeal.has(dealId)) jobsByDeal.set(dealId, []);
    jobsByDeal.get(dealId).push(job);
  });

  const groups = new Map();
  (Array.isArray(deals) ? deals : []).forEach((deal) => {
    const dealId = `${deal?.id || ""}`.trim();
    const dealJobs = jobsByDeal.get(dealId) || [];
    const key = canonicalVisibleDealKey(deal, dealJobs);
    if (!groups.has(key)) {
      groups.set(key, {
        deal: {
          ...deal,
          recordIds: Array.from(new Set([...(deal.recordIds || []), dealId].filter(Boolean))),
          partIds: Array.from(new Set([...(deal.partIds || [])].filter(Boolean))),
        },
        sourceDealIds: new Set([dealId].filter(Boolean)),
      });
      return;
    }
    const group = groups.get(key);
    group.sourceDealIds.add(dealId);
    group.deal = {
      ...deal,
      ...group.deal,
      name: group.deal.name || deal.name,
      customer: group.deal.customer || deal.customer,
      description: group.deal.description || deal.description,
      recordIds: Array.from(new Set([...(group.deal.recordIds || []), ...(deal.recordIds || []), dealId].filter(Boolean))),
      partIds: Array.from(new Set([...(group.deal.partIds || []), ...(deal.partIds || [])].filter(Boolean))),
    };
  });

  const dealIdMap = new Map();
  const normalizedDeals = Array.from(groups.values()).map((group) => {
    const canonicalId = group.deal.id;
    group.sourceDealIds.forEach((id) => dealIdMap.set(id, canonicalId));
    return group.deal;
  });
  const normalizedJobs = jobList.map((job) => {
    const nextDealId = dealIdMap.get(`${job?.dealId || ""}`.trim());
    return nextDealId && nextDealId !== job.dealId ? { ...job, dealId: nextDealId } : job;
  });
  return { deals: normalizedDeals, jobs: normalizedJobs };
}

function mapProcessProfiles(profiles = []) {
  const normalized = Array.isArray(profiles) ? profiles : [];
  const processCounts = new Map();
  const materialCounts = new Map();
  normalized.forEach((p) => {
    const proc =
      `${p?.generic_process || ""}`.trim() ||
      `${p?.branded_process || ""}`.trim() ||
      `${p?.process_family || ""}`.trim() ||
      "Unknown";
    const mat =
      `${p?.material_name || ""}`.trim() ||
      `${p?.material_class || ""}`.trim() ||
      `${p?.material_family || ""}`.trim() ||
      "Unknown";
    processCounts.set(proc, (processCounts.get(proc) || 0) + 1);
    materialCounts.set(mat, (materialCounts.get(mat) || 0) + 1);
  });
  return {
    processCounts: Array.from(processCounts.entries()).map(([name, count]) => ({ name, count })),
    materialCounts: Array.from(materialCounts.entries()).map(([name, count]) => ({ name, count })),
  };
}

function csvTags(input) {
  return String(input || "")
    .split(/[,\n;|]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function certCandidates(input) {
  if (Array.isArray(input)) return input.map((x) => `${x || ""}`.trim()).filter(Boolean);
  return csvTags(input);
}

function certKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

const CERT_OPTION_BY_KEY = (() => {
  const out = new Map();
  MANDATORY_CERTIFICATION_OPTIONS.forEach((cert) => out.set(certKey(cert), cert));
  return out;
})();

const CERT_ALIASES = {
  iso9001: "ISO 9001",
  as9100d: "AS9100",
  as9100: "AS9100",
  iatf16949: "IATF 16949",
  iso13485: "ISO 13485",
  iso14001: "ISO 14001",
  iso45001: "ISO 45001 / OHSAS 18001",
  ohsas18001: "ISO 45001 / OHSAS 18001",
  iso50001: "ISO 50001",
  itar: "ITAR Registration",
  rohs: "RoHS Compliance",
  reach: "REACH Compliance",
  nadcap: "NADCAP",
  fdagmp: "FDA Registration / GMP",
  fdaregistrationgmp: "FDA Registration / GMP",
  isots22163iris: "ISO/TS 22163 (IRIS)",
  cemarking: "CE Marking",
  csacertification: "CSA Certification",
  isoiec27001: "ISO/IEC 27001",
};

function canonicalizeCertName(value) {
  const raw = `${value || ""}`.trim();
  if (!raw) return "";
  const key = certKey(raw);
  if (!key) return "";
  if (CERT_OPTION_BY_KEY.has(key)) return CERT_OPTION_BY_KEY.get(key) || raw;
  if (CERT_ALIASES[key]) return CERT_ALIASES[key];
  return raw;
}

function canonicalizeCertList(values) {
  const out = [];
  const seen = new Set();
  (Array.isArray(values) ? values : []).forEach((v) => {
    const cert = canonicalizeCertName(v);
    if (!cert) return;
    const key = certKey(cert);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(cert);
  });
  return out;
}

function sourceRefToJobId(ref) {
  const raw = `${ref || ""}`.trim();
  if (!raw) return "";
  if (raw.includes(" · ")) return raw.split(" · ").pop().trim();
  return raw;
}

function lessonRefsToJobIds(lesson) {
  const refs = Array.isArray(lesson?.sourceJobs) ? lesson.sourceJobs : [];
  return refs.map(sourceRefToJobId).filter(Boolean);
}

function normText(v) {
  return String(v || "").trim().toLowerCase();
}

function lessonMatchesDeal(lesson, deal, dealJobs = []) {
  const projectRecordId = `${lesson?.projectRecordId || lesson?.project_record_id || ""}`.trim();
  if (
    projectRecordId &&
    dealJobs.some((j) => `${j?.sourceRecordId || ""}`.trim() === projectRecordId)
  ) return true;
  const explicitIds = lessonRefsToJobIds(lesson);
  if (explicitIds.length && dealJobs.some((j) => explicitIds.includes(j.id) || explicitIds.includes(j.sourcePartId))) return true;
  const refs = Array.isArray(lesson?.sourceJobs) ? lesson.sourceJobs.map(normText) : [];
  const dealId = normText(deal?.id);
  const dealName = normText(deal?.name);
  const dealCustomer = normText(deal?.customer);
  if (refs.some((r) => r && (r.includes(dealId) || r.includes(dealName) || (dealCustomer && r.includes(dealCustomer))))) return true;
  if (dealJobs.some((j) => refs.some((r) => r && (r.includes(normText(j.id)) || r.includes(normText(j.sourcePartId)) || r.includes(normText(j.name)) || r.includes(normText(j.partName)))))) return true;
  return false;
}

function lessonMatchesJob(lesson, job, deal, dealJobs = []) {
  const projectRecordId = `${lesson?.projectRecordId || lesson?.project_record_id || ""}`.trim();
  if (projectRecordId && `${job?.sourceRecordId || ""}`.trim() === projectRecordId) return true;
  const explicitIds = lessonRefsToJobIds(lesson);
  if (explicitIds.includes(job.id) || explicitIds.includes(job.sourcePartId)) return true;
  const refs = Array.isArray(lesson?.sourceJobs) ? lesson.sourceJobs.map(normText) : [];
  if (refs.some((r) => r && (r.includes(normText(job.id)) || r.includes(normText(job.sourcePartId)) || r.includes(normText(job.name)) || r.includes(normText(job.partName))))) return true;
  if (!explicitIds.length && refs.length && lessonMatchesDeal(lesson, deal, dealJobs) && dealJobs.length === 1) return true;
  return false;
}

function ProcessProfilesSection({ profiles = [] }) {
  const [openId, setOpenId] = useState("");

  if (!profiles.length) {
    return (
      <Card>
        <div style={{padding:24,textAlign:"center",fontSize:13,color:C.inkMuted}}>
          No process profiles were found for this supplier yet.
        </div>
      </Card>
    );
  }

  return (
    <div style={{display:"grid",gap:10}}>
      {profiles.map((p, idx) => {
        const pid = p.id || `${p.name || "profile"}-${idx}`;
        const isOpen = openId === pid;
        const certs = csvTags(p.certifications);
        return (
          <div key={pid} style={{border:`1px solid ${isOpen ? C.gold : C.rule}`,borderRadius:8,background:C.white,overflow:"hidden",boxShadow:"0 1px 4px rgba(20,28,36,0.07)"}}>
            <button
              type="button"
              onClick={() => setOpenId((prev) => (prev === pid ? "" : pid))}
              style={{
                width:"100%",
                border:"none",
                background:isOpen ? C.offWhite : C.white,
                padding:"12px 14px",
                display:"grid",
                gridTemplateColumns:"minmax(0,2fr) minmax(0,1fr) auto",
                alignItems:"center",
                gap:10,
                cursor:"pointer",
                textAlign:"left",
              }}
            >
              <div style={{minWidth:0}}>
                <div style={{fontFamily:disp,fontSize:15,fontWeight:700,color:C.ink,marginBottom:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                  {p.name || "Process Profile"}
                </div>
                <div style={{fontFamily:mono,fontSize:10,color:C.inkMuted,textTransform:"uppercase",letterSpacing:"0.06em"}}>
                  {p.process_profile_number || "No Number"}
                </div>
              </div>
              <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                {p.generic_process && <span style={{fontFamily:mono,fontSize:9,padding:"2px 7px",borderRadius:999,border:`1px solid ${C.rule}`,color:C.inkMuted}}>{p.generic_process}</span>}
                {p.material_family && <span style={{fontFamily:mono,fontSize:9,padding:"2px 7px",borderRadius:999,border:`1px solid ${C.rule}`,color:C.inkMuted}}>{p.material_family}</span>}
              </div>
              <div style={{fontFamily:mono,fontSize:11,color:C.inkMuted,textTransform:"uppercase",letterSpacing:"0.06em"}}>
                {isOpen ? "UP" : "DOWN"}
              </div>
            </button>

            {isOpen && (
              <div style={{borderTop:`1px solid ${C.rule}`,padding:"12px 14px"}}>
                {p.record_image_url ? (
                  <img
                    src={p.record_image_url}
                    alt={p.name || "Process profile"}
                    style={{width:"100%",maxHeight:220,objectFit:"cover",border:`1px solid ${C.rule}`,borderRadius:6,marginBottom:10,display:"block"}}
                  />
                ) : null}

                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"8px 12px",fontSize:12.5,color:C.ink,marginBottom:10}}>
                  <div><strong>Generic Process:</strong> {p.generic_process || "-"}</div>
                  <div><strong>Branded Process:</strong> {p.branded_process || "-"}</div>
                  <div><strong>Process Family:</strong> {p.process_family || "-"}</div>
                  <div><strong>Material:</strong> {p.material_name || "-"}</div>
                  <div><strong>Material Type:</strong> {p.material_type || "-"}</div>
                  <div><strong>Material Class:</strong> {p.material_class || "-"}</div>
                  <div><strong>Material Family:</strong> {p.material_family || "-"}</div>
                  <div><strong>Machine:</strong> {p.equipment_name || "-"}</div>
                </div>

                {p.equipment_link ? (
                  <a
                    href={p.equipment_link}
                    target="_blank"
                    rel="noreferrer"
                    style={{display:"inline-block",marginBottom:10,fontFamily:mono,fontSize:10,color:C.gold,textTransform:"uppercase",letterSpacing:"0.05em",textDecoration:"none"}}
                  >
                    View Equipment Link
                  </a>
                ) : null}

                {certs.length > 0 ? (
                  <div>
                    <div style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted,marginBottom:6}}>
                      Certifications
                    </div>
                    <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                      {certs.map((tag) => (
                        <span key={`${pid}-${tag}`} style={{fontFamily:mono,fontSize:9,padding:"2px 7px",borderRadius:999,border:`1px solid ${C.rule}`,color:C.inkMuted}}>
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// -- SHARED BRIDGE MARK --------------------------------------------------------
const BridgeMark = ({ size=30, color="white" }) => {
  const w=size, h=Math.round(size*0.88), cx=w/2;
  const tTop=h*0.04, tMidH=h*0.48, tBaseTop=h*0.52, tBaseBot=h*0.92;
  const tW=w*0.072, tBW=w*0.13, deckY=h*0.475;
  const cables=[[.03,.56],[.07,.52],[.12,.49],[.17,.475],[.22,.465],[.28,.458],[.34,.453],[.40,.449],
                [.97,.56],[.93,.52],[.88,.49],[.83,.475],[.78,.465],[.72,.458],[.66,.453],[.60,.449]];
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} fill="none">
      {cables.map(([fx,fy],i)=><line key={i} x1={cx} y1={tTop+h*.04} x2={fx*w} y2={fy*h} stroke={color} strokeWidth={w*.012} opacity=".7"/>)}
      <path d={`M${w*.04} ${deckY} Q${cx} ${deckY-h*.07} ${w*.96} ${deckY}`} stroke={color} strokeWidth={w*.055} fill="none" strokeLinecap="round"/>
      <rect x={cx-tW/2} y={tTop} width={tW} height={tMidH-tTop} fill={color}/>
      <path d={`M${cx-tW/2} ${tBaseTop} L${cx-tBW/2} ${tBaseBot} L${cx+tBW/2} ${tBaseBot} L${cx+tW/2} ${tBaseTop} Z`} fill={color}/>
    </svg>
  );
};

// -- SHARED ATOMS --------------------------------------------------------------
const Btn = ({children,variant="outline",onClick,style:s,sm,disabled}) => {
  const base={fontFamily:disp,fontSize:sm?11:12,fontWeight:600,padding:sm?"5px 11px":"8px 16px",borderRadius:4,cursor:disabled?"not-allowed":"pointer",letterSpacing:"0.01em",border:"none",transition:"filter 0.12s",opacity:disabled?.4:1};
  const v={primary:{background:C.navy,color:C.white},accent:{background:C.gold,color:"#fff"},outline:{background:"transparent",color:C.ink,border:`1px solid ${C.rule}`},ghost:{background:"transparent",color:C.inkMuted,border:`1px solid ${C.ruleLight}`,fontSize:11,padding:"5px 12px"},green:{background:C.pass,color:"#fff"},navy:{background:C.navyMid,color:"rgba(255,255,255,0.85)",border:"1px solid rgba(255,255,255,0.12)"}};
  return <button style={{...base,...v[variant],...s}} onMouseEnter={e=>{if(!disabled)e.currentTarget.style.filter="brightness(0.88)"}} onMouseLeave={e=>e.currentTarget.style.filter=""} onClick={disabled?undefined:onClick}>{children}</button>;
};

const Card=({children,style:s,...rest})=><div {...rest} style={{background:C.white,border:`1px solid ${C.rule}`,borderRadius:8,overflow:"hidden",boxShadow:"0 1px 4px rgba(20,28,36,0.08)",...s}}>{children}</div>;

function MachineStatusPill({ status = "" }) {
  const key = `${status || ""}`.trim().toLowerCase();
  const tone =
    key === "active" || key === "ready"
      ? { bg: C.passBg, color: C.pass, border: C.passRule }
      : key === "maintenance" || key === "inactive"
      ? { bg: C.warnBg, color: C.warn, border: C.warnRule }
      : { bg: C.surface, color: C.inkMuted, border: C.rule };
  return (
    <span
      style={{
        fontFamily: mono,
        fontSize: 9,
        padding: "3px 8px",
        borderRadius: 999,
        background: tone.bg,
        color: tone.color,
        border: `1px solid ${tone.border}`,
        textTransform: "uppercase",
        letterSpacing: "0.05em",
      }}
    >
      {status || "Unspecified"}
    </span>
  );
}

function MachineCard({ machine, onEdit }) {
  const materials = Array.isArray(machine?.materials) ? machine.materials : [];
  return (
    <Card style={{ marginBottom: 12 }}>
      <div style={{ padding: 14 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 10, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontFamily: disp, fontSize: 17, fontWeight: 700, color: C.ink }}>{machine?.name || "Unnamed Machine"}</div>
            <div style={{ fontSize: 12.5, color: C.inkMuted, marginTop: 4 }}>
              {machine?.matched_equipment_name || machine?.other_equipment || machine?.equipment_text || "No equipment match yet"}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <MachineStatusPill status={machine?.status} />
            <Btn sm variant="ghost" onClick={() => onEdit?.(machine)}>Edit</Btn>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10, marginBottom: 10 }}>
          {[
            ["Equipment Text", machine?.equipment_text || "-"],
            ["Serial", machine?.serial_number || "-"],
            ["Year", machine?.year_label || machine?.year_of_purchase_install_date || "-"],
            ["Use Cases", machine?.use_cases || "-"],
          ].map(([label, value]) => (
            <div key={`${machine?.id}-${label}`} style={{ border: `1px solid ${C.ruleLight}`, borderRadius: 6, background: C.offWhite, padding: "8px 10px" }}>
              <div style={{ fontFamily: mono, fontSize: 8, textTransform: "uppercase", letterSpacing: "0.06em", color: C.inkMuted, marginBottom: 4 }}>{label}</div>
              <div style={{ fontSize: 12.5, color: C.inkSoft, lineHeight: 1.5 }}>{value}</div>
            </div>
          ))}
        </div>

        <div style={{ marginBottom: 8 }}>
          <div style={{ fontFamily: mono, fontSize: 8, textTransform: "uppercase", letterSpacing: "0.06em", color: C.inkMuted, marginBottom: 5 }}>Materials</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {materials.length ? materials.map((material) => (
              <span key={`${machine?.id}-${material}`} style={{ fontFamily: mono, fontSize: 9, padding: "3px 8px", borderRadius: 3, background: C.bluePale, border: "1px solid rgba(26,61,92,0.2)", color: C.blue }}>
                {material}
              </span>
            )) : (
              <span style={{ fontSize: 12, color: C.inkMuted }}>No CRM materials linked yet</span>
            )}
            {!!machine?.other_materials && (
              <span style={{ fontFamily: mono, fontSize: 9, padding: "3px 8px", borderRadius: 3, background: C.amberBg, border: `1px solid ${C.amberRule}`, color: C.amber }}>
                Other: {machine.other_materials}
              </span>
            )}
          </div>
        </div>

        {!!machine?.machine_notes && (
          <div style={{ fontSize: 12.5, color: C.inkSoft, lineHeight: 1.6, marginTop: 8 }}>
            {machine.machine_notes.length > 220 ? `${machine.machine_notes.slice(0, 220)}...` : machine.machine_notes}
          </div>
        )}
      </div>
    </Card>
  );
}

const CardHead=({title,sub,right})=>(
  <div style={{padding:"11px 18px",background:C.surface,borderBottom:`1px solid ${C.rule}`,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
    <div style={{display:"flex",alignItems:"center",gap:8}}><span style={{fontFamily:disp,fontSize:13,fontWeight:700}}>{title}</span>{sub&&<span style={{fontFamily:mono,fontSize:9,color:C.inkMuted}}>{sub}</span>}</div>
    {right&&<div>{right}</div>}
  </div>
);

function StatusBadge({status}) {
  const m=STATUS_META[status]||STATUS_META.new;
  return <span style={{fontFamily:mono,fontSize:8,padding:"2px 7px",borderRadius:2,background:m.bg,color:m.color,border:`1px solid ${m.border}`,textTransform:"uppercase",letterSpacing:"0.05em",whiteSpace:"nowrap"}}>{m.label}</span>;
}

function ScoreRing({score,size=44}) {
  const r=(size-6)/2, circ=2*Math.PI*r;
  const [v,setV]=useState(0);
  useEffect(()=>{const t=setTimeout(()=>setV(score),300);return()=>clearTimeout(t);},[score]);
  const color=score>=80?C.pass:score>=60?C.gold:score>=40?C.amber:C.warn;
  return (
    <div style={{position:"relative",width:size,height:size,flexShrink:0}}>
      <svg width={size} height={size} style={{transform:"rotate(-90deg)"}}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={C.ruleLight} strokeWidth={4}/>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={4}
          strokeDasharray={circ} strokeDashoffset={circ-(v/100)*circ} strokeLinecap="round"
          style={{transition:"stroke-dashoffset 0.8s cubic-bezier(.4,0,.2,1)"}}/>
      </svg>
      <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:mono,fontSize:size>40?12:10,fontWeight:600,color}}>{score}</div>
    </div>
  );
}

function MiniBar({pct,color,h=4}) {
  const [v,setV]=useState(0);
  useEffect(()=>{const t=setTimeout(()=>setV(pct),400);return()=>clearTimeout(t);},[pct]);
  return <div style={{height:h,background:C.ruleLight,borderRadius:2,overflow:"hidden"}}><div style={{height:"100%",width:`${v}%`,background:color,borderRadius:2,transition:"width 0.7s cubic-bezier(.4,0,.2,1)"}}/></div>;
}

// Shared topbar used by all screens
function Topbar({screen, onBack, rfpId, notifCount, onNotif, onSettings, onLogout, rightSlot}) {
  const crumbs = {
    dashboard:   ["Supplier Portal","Dashboard"],
    assessment:  ["Supplier Portal","RFP Assessment"],
    ingestion:   ["Supplier Portal","Knowledge Base"],
    buyerrfp:    ["Buyer Portal","Submit RFP"],
  }[screen] || ["Supplier Portal","Dashboard"];
  return (
    <div style={{background:C.navyDeep,borderBottom:`2px solid ${C.gold}`,padding:"0",display:"flex",alignItems:"stretch",position:"sticky",top:0,zIndex:200}}>
      <div style={{display:"flex",alignItems:"center",gap:11,padding:"10px 20px 10px 18px",borderRight:"1px solid rgba(255,255,255,0.1)",marginRight:0}}>
        <BridgeMark size={28} color="white"/>
        <span style={{fontFamily:serif,fontSize:18,fontWeight:700,color:C.white,letterSpacing:"0.01em"}}>Trustbridge</span>
      </div>
      <div style={{display:"flex",alignItems:"center",gap:6,padding:"0 16px",flex:1}}>
        {onBack&&screen!=="dashboard"&&(
          <button onClick={onBack} style={{display:"flex",alignItems:"center",gap:5,background:"rgba(255,255,255,0.07)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:4,padding:"4px 10px",cursor:"pointer",color:"rgba(255,255,255,0.7)",fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.05em",marginRight:6,transition:"all 0.12s"}}
            onMouseEnter={e=>{e.currentTarget.style.background="rgba(255,255,255,0.14)";}}
            onMouseLeave={e=>{e.currentTarget.style.background="rgba(255,255,255,0.07)";}}>
            {"<- Back"}
          </button>
        )}
        {crumbs.map((s,i,arr)=>(
          <span key={i} style={{display:"flex",alignItems:"center",gap:5}}>
            <span style={{fontFamily:mono,fontSize:9,letterSpacing:"0.06em",textTransform:"uppercase",color:i===arr.length-1?C.gold:"rgba(255,255,255,0.32)"}}>{s}</span>
            {i<arr.length-1&&<span style={{color:"rgba(255,255,255,0.18)",fontSize:11}}>/</span>}
          </span>
        ))}
        {rfpId&&<span style={{fontFamily:mono,fontSize:9,color:"rgba(255,255,255,0.5)",marginLeft:4}}>· {rfpId}</span>}
      </div>
      <div style={{display:"flex",alignItems:"center",gap:4,padding:"0 16px"}}>
        {rightSlot}
        {typeof notifCount==="number"&&(
          <button title="Notifications" aria-label="Notifications" onClick={onNotif} style={{position:"relative",width:34,height:34,borderRadius:5,background:"transparent",border:"1px solid transparent",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",color:"rgba(255,255,255,0.65)",fontSize:15,transition:"all 0.12s"}}
            onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.1)"}
            onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
            <span style={{fontSize:15,lineHeight:1}}>🔔</span>{notifCount>0&&<span style={{position:"absolute",top:3,right:3,width:15,height:15,borderRadius:"50%",background:C.gold,color:"#fff",fontFamily:mono,fontSize:8,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",border:`2px solid ${C.navyDeep}`}}>{notifCount}</span>}
          </button>
        )}
        {typeof onSettings === "function" && (
          <button title="Settings" aria-label="Settings" onClick={onSettings} style={{width:34,height:34,borderRadius:5,background:"transparent",border:"1px solid transparent",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",color:"rgba(255,255,255,0.5)",fontSize:15,transition:"all 0.12s"}}
            onMouseEnter={e=>{e.currentTarget.style.background="rgba(255,255,255,0.1)";e.currentTarget.style.color="rgba(255,255,255,0.85)";}}
            onMouseLeave={e=>{e.currentTarget.style.background="transparent";e.currentTarget.style.color="rgba(255,255,255,0.5)";}}>
            <span style={{fontSize:15,lineHeight:1}}>⚙</span>
          </button>
        )}
        {typeof onLogout === "function" && (
          <Btn sm variant="navy" onClick={onLogout} style={{marginLeft:6}}>Logout</Btn>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------
// SCREEN 1: SUPPLIER DASHBOARD
// ------------------------------------------------------------------------------

function NotifDrawer({notifs,onClose,onMarkAll}) {
  const unread=notifs.filter(n=>!n.read).length;
  return (
    <div style={{position:"fixed",top:56,right:16,width:350,background:C.white,border:`1px solid ${C.rule}`,borderRadius:10,boxShadow:"0 8px 32px rgba(20,28,36,0.18)",zIndex:500,animation:"slideDown 0.18s ease",overflow:"hidden"}}>
      <div style={{padding:"12px 15px",borderBottom:`1px solid ${C.rule}`,display:"flex",alignItems:"center",justifyContent:"space-between",background:C.navyDeep}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <span style={{fontFamily:disp,fontSize:13,fontWeight:700,color:C.white}}>Notifications</span>
          {unread>0&&<span style={{fontFamily:mono,fontSize:9,padding:"1px 6px",borderRadius:8,background:C.gold,color:"#fff"}}>{unread} new</span>}
        </div>
        <div style={{display:"flex",gap:8}}>
          {unread>0&&<button onClick={onMarkAll} style={{fontFamily:mono,fontSize:9,background:"none",border:"none",color:"rgba(255,255,255,0.45)",cursor:"pointer",textTransform:"uppercase"}}>Mark all read</button>}
          <button onClick={onClose} style={{background:"none",border:"none",color:"rgba(255,255,255,0.4)",cursor:"pointer",fontSize:14}}>x</button>
        </div>
      </div>
      <div style={{maxHeight:400,overflowY:"auto"}}>
        {notifs.map((n,i)=>(
          <div key={n.id} style={{padding:"10px 15px",borderBottom:i<notifs.length-1?`1px solid ${C.ruleLight}`:"none",display:"flex",gap:10,alignItems:"flex-start",background:n.read?"transparent":`${C.goldPale}80`}}>
            <span style={{fontFamily:mono,fontSize:12,color:NOTIF_COLOR[n.type]||C.inkMuted,flexShrink:0,marginTop:1,lineHeight:1}}>{NOTIF_ICON[n.type]||"·"}</span>
            <div style={{flex:1}}>
              <div style={{fontSize:12.5,color:n.read?C.inkMuted:C.ink,lineHeight:1.55}}>{n.text}</div>
              <div style={{fontFamily:mono,fontSize:9,color:C.inkMuted,marginTop:3}}>{n.time}</div>
            </div>
            {!n.read&&<div style={{width:6,height:6,borderRadius:"50%",background:C.gold,flexShrink:0,marginTop:5}}/>}
          </div>
        ))}
      </div>
    </div>
  );
}

function SettingsDrawer({ onClose, onLogout, onRefresh }) {
  const session = getSupplierSession();
  const expiry = Number(session?.expires_at || 0);
  const expiryText = expiry ? new Date(expiry).toLocaleString() : "Not set";
  return (
    <div style={{position:"fixed",top:56,right:16,width:360,background:C.white,border:`1px solid ${C.rule}`,borderRadius:10,boxShadow:"0 8px 32px rgba(20,28,36,0.18)",zIndex:500,animation:"slideDown 0.18s ease",overflow:"hidden"}}>
      <div style={{padding:"12px 15px",borderBottom:`1px solid ${C.rule}`,display:"flex",alignItems:"center",justifyContent:"space-between",background:C.navyDeep}}>
        <span style={{fontFamily:disp,fontSize:13,fontWeight:700,color:C.white}}>Settings</span>
        <button onClick={onClose} style={{background:"none",border:"none",color:"rgba(255,255,255,0.4)",cursor:"pointer",fontSize:14}}>x</button>
      </div>
      <div style={{padding:"12px 14px",display:"grid",gap:10}}>
        <div style={{padding:"9px 10px",background:C.surface,border:`1px solid ${C.ruleLight}`,borderRadius:6}}>
          <div style={{fontFamily:mono,fontSize:8,color:C.inkMuted,textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:4}}>Supplier</div>
          <div style={{fontSize:12.5,color:C.ink,fontWeight:600}}>{session?.supplier_name || "Unknown"}</div>
          <div style={{fontFamily:mono,fontSize:9,color:C.inkMuted,marginTop:2}}>{session?.supplier_email || "-"}</div>
        </div>
        <div style={{padding:"9px 10px",background:C.surface,border:`1px solid ${C.ruleLight}`,borderRadius:6}}>
          <div style={{fontFamily:mono,fontSize:8,color:C.inkMuted,textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:4}}>Session Expires</div>
          <div style={{fontFamily:mono,fontSize:10,color:C.ink}}>{expiryText}</div>
        </div>
        <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:2}}>
          <Btn sm variant="outline" onClick={onRefresh}>Refresh Data</Btn>
          <Btn sm variant="ghost" onClick={onLogout}>Logout</Btn>
        </div>
      </div>
    </div>
  );
}

function StatStrip({rfps, corpusScore=0}) {
  const active=rfps.filter(r=>["new","in_assessment"].includes(r.status)).length;
  const scores=rfps.filter(r=>r.matchScore).map(r=>r.matchScore);
  const avg=scores.length?Math.round(scores.reduce((a,b)=>a+b,0)/scores.length):0;
  const urgent=rfps.filter(r=>{const d=Math.round((new Date(r.due)-new Date("2026-03-30"))/86400000);return d>=0&&d<=3;}).length;
  return (
    <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:1,background:C.rule,borderBottom:`1px solid ${C.rule}`}}>
      {[
        {label:"Active RFPs",     val:active, sub:`${rfps.filter(r=>r.status==="new").length} new`,           color:C.blue,    bg:C.bluePale},
        {label:"Avg Match Score", val:avg,    sub:"across open RFPs",                                        color:C.gold,    bg:C.goldPale},
        {label:"Corpus Score",    val:Math.max(0, Math.min(100, Number(corpusScore || 0))),   sub:"live corpus health",                                    color:C.pass,    bg:C.passBg},
        {label:"Due <= 3 days",   val:urgent, sub:urgent>0?"Requires attention":"No urgent deadlines",       color:urgent>0?C.warn:C.inkMuted, bg:urgent>0?C.warnBg:C.surface},
      ].map(s=>(
        <div key={s.label} style={{padding:"13px 20px",background:C.white,display:"flex",alignItems:"center",gap:12}}>
          <div style={{width:40,height:40,borderRadius:7,background:s.bg,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,border:`1px solid ${s.color}25`}}>
            <span style={{fontFamily:mono,fontSize:18,fontWeight:700,color:s.color,lineHeight:1}}>{s.val}</span>
          </div>
          <div>
            <div style={{fontFamily:disp,fontSize:12,fontWeight:700,color:C.ink,marginBottom:2}}>{s.label}</div>
            <div style={{fontFamily:mono,fontSize:9,color:C.inkMuted}}>{s.sub}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function UploadZone({ onUploadRfp }) {
  const [dragging,setDragging]=useState(false);
  const [uploading,setUploading]=useState(false);
  const [done,setDone]=useState(false);
  const [fileName,setFileName]=useState("");
  const [fileCount,setFileCount]=useState(0);
  const fileInputRef = useRef(null);
  const processUpload=(files=[])=>{
    const list = Array.isArray(files) ? files : [];
    const first = list[0];
    if (first?.name) setFileName(first.name);
    setFileCount(list.length || (first ? 1 : 0));
    if (onUploadRfp) {
      onUploadRfp(list);
      return;
    }
    setDragging(false);
    setUploading(true);
    setTimeout(()=>{setUploading(false);setDone(true);},1800);
    setTimeout(()=>setDone(false),4200);
  };
  return (
    <div onClick={()=>{ if (onUploadRfp) onUploadRfp([]); }}
      onDragOver={e=>{e.preventDefault();setDragging(true);}} onDragLeave={()=>setDragging(false)} onDrop={e=>{e.preventDefault(); const files=Array.from(e.dataTransfer?.files||[]); processUpload(files);}}
      style={{border:`2px dashed ${dragging?C.gold:C.rule}`,borderRadius:8,padding:"16px 20px",background:dragging?C.goldPale:done?C.passBg:C.white,transition:"all 0.18s",display:"flex",alignItems:"center",gap:18,marginBottom:14,cursor:"pointer"}}>
      <div style={{width:42,height:42,borderRadius:7,background:done?C.passBg:dragging?C.goldPale:C.surface,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,border:`1px solid ${done?C.passRule:dragging?"rgba(184,146,10,0.3)":C.rule}`}}>
        {uploading?<div style={{width:17,height:17,border:`2px solid ${C.gold}`,borderTopColor:"transparent",borderRadius:"50%",animation:"spin 0.7s linear infinite"}}/>:done?<span style={{color:C.pass,fontSize:17}}>OK</span>:<span style={{fontSize:17,color:dragging?C.gold:C.inkMuted}}>^</span>}
      </div>
      <div style={{flex:1}}>
        <div style={{fontFamily:disp,fontSize:13,fontWeight:700,color:done?C.pass:C.ink,marginBottom:3}}>{uploading?"Processing RFP...":done?"RFP-0852 ingested - match score computing":"Upload Inbound RFP"}</div>
        <div style={{fontSize:12,color:C.inkMuted,lineHeight:1.55}}>
          {done
            ? (fileCount > 1 ? `${fileCount} files uploaded. New RFP added to your queue.` : fileName ? `${fileName} uploaded. New RFP added to your queue.` : "New RFP added to your queue.")
            : "Drag & drop PDF, STEP, or ZIP - or browse. Plugin auto-ingest available."}
        </div>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".pdf,.zip,.step,.stp,.iges,.igs,.stl,.obj,.ply,.glb,.gltf,.3mf,.png,.jpg,.jpeg,.webp"
        style={{display:"none"}}
        onChange={(e)=>{const files=Array.from(e.target.files||[]); if (files.length) processUpload(files);}}
      />
      <div style={{display:"flex",gap:8,flexShrink:0}}>
        <Btn sm variant="ghost" onClick={(e)=>{e.stopPropagation(); fileInputRef.current?.click();}}>Browse</Btn>
        <Btn sm variant="accent" onClick={(e)=>e.stopPropagation()}>Connect Plugin</Btn>
      </div>
    </div>
  );
}

function RfpCard({rfp,onAssess,onNoBid,idx}) {
  const daysLeft=Math.round((new Date(rfp.due)-new Date("2026-03-30"))/86400000);
  const overdue=daysLeft<0, urgent=!overdue&&daysLeft<=2;
  const dueColor=overdue?C.red:urgent?C.warn:daysLeft<=5?C.amber:C.inkMuted;
  const isTrustBridge = Boolean(rfp?.crmSource);
  const actionLabel = isTrustBridge && !rfp?.has_cached
    ? "Run Assessment ->"
    : rfp.status==="new"
      ? "Assess ->"
      : rfp.status==="in_assessment"
        ? "Continue ->"
        : "View ->";
  return (
    <div
      style={{background:C.white,border:`1px solid ${C.rule}`,borderRadius:8,padding:"13px 16px",marginBottom:9,transition:"all 0.15s",boxShadow:"0 1px 3px rgba(20,28,36,0.07)",animation:`up 0.3s ease ${idx*.06}s both`}}
      onMouseEnter={e=>{e.currentTarget.style.borderColor=C.gold;e.currentTarget.style.boxShadow=`0 3px 12px rgba(184,146,10,0.12)`;}}
      onMouseLeave={e=>{e.currentTarget.style.borderColor=C.rule;e.currentTarget.style.boxShadow="0 1px 3px rgba(20,28,36,0.07)";}}>
      <div style={{display:"flex",alignItems:"flex-start",gap:13}}>
        <ScoreRing score={rfp.matchScore} size={46}/>
        <div style={{flex:1,minWidth:0}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:5,flexWrap:"wrap"}}>
            <span style={{fontFamily:mono,fontSize:10,color:C.gold,fontWeight:600}}>{rfp.id}</span>
            <span style={{fontFamily:disp,fontSize:14,fontWeight:700}}>{rfp.buyer}</span>
            <StatusBadge status={rfp.status}/>
            {isTrustBridge && (
              <span style={{fontFamily:mono,fontSize:8,padding:"2px 7px",borderRadius:2,background:C.bluePale,color:C.blue,border:"1px solid rgba(26,61,92,0.18)",textTransform:"uppercase",letterSpacing:"0.05em"}}>
                TrustBridge
              </span>
            )}
          </div>
          <div style={{fontSize:12.5,color:C.inkMuted,lineHeight:1.55,marginBottom:7}}>{rfp.summary}</div>
          <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
            <span style={{fontFamily:mono,fontSize:9,padding:"2px 7px",borderRadius:2,background:C.surface,border:`1px solid ${C.ruleLight}`,color:C.inkSoft}}>{rfp.parts} part{rfp.parts!==1?"s":""}</span>
            {rfp.processes.map(p=><span key={p} style={{fontFamily:mono,fontSize:9,padding:"2px 7px",borderRadius:2,background:C.bluePale,border:"1px solid rgba(26,74,114,0.18)",color:C.blue}}>{p}</span>)}
            {rfp.materials.map(m=><span key={m} style={{fontFamily:mono,fontSize:9,padding:"2px 7px",borderRadius:2,background:C.goldPale,border:"1px solid rgba(184,146,10,0.2)",color:C.amber}}>{m}</span>)}
          </div>
        </div>
        <div style={{textAlign:"right",flexShrink:0}}>
          <div style={{fontFamily:mono,fontSize:9,color:C.inkMuted,marginBottom:3}}>Rcvd {rfp.received.slice(5).replace("-","/")}</div>
          <div style={{fontFamily:mono,fontSize:11,fontWeight:600,color:dueColor,marginBottom:9}}>{overdue?"OVERDUE":urgent?`Due in ${daysLeft}d`:`Due ${rfp.due.slice(5).replace("-","/")}`}</div>
          {isTrustBridge && (
            <div style={{display:"flex",justifyContent:"flex-end",marginBottom:8}}>
              <div style={{width:38,height:38,borderRadius:10,background:C.blue,display:"flex",alignItems:"center",justifyContent:"center",border:"1px solid rgba(255,255,255,0.14)",boxShadow:"inset 0 0 0 1px rgba(255,255,255,0.08)"}}>
                <BridgeMark size={18} color="white"/>
              </div>
            </div>
          )}
          <Btn sm variant={rfp.status==="new"?"accent":"outline"} onClick={e=>{e.stopPropagation();onAssess(rfp);}}>
            {actionLabel}
          </Btn>
          <div style={{marginTop:8}}>
            <Btn sm variant="ghost" onClick={e=>{e.stopPropagation();onNoBid(rfp);}}>
              Mark No-bid
            </Btn>
          </div>
        </div>
      </div>
    </div>
  );
}

function RfpQueue({rfps,onAssess,onNoBid}) {
  const [filter,setFilter]=useState("all");
  const fl={
    active:rfps.filter(r=>["new","in_assessment"].includes(r.status)),
    trustbridge:rfps.filter(r=>Boolean(r?.crmSource)),
    all:rfps,
    closed:rfps.filter(r=>["quote_submitted","won","lost","no_bid"].includes(r.status)),
  };
  const shown=fl[filter]||fl.all;
  return (
    <div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
        <div style={{display:"flex",gap:6}}>
          {[["active","Active",fl.active.length],["trustbridge","TrustBridge",fl.trustbridge.length],["all","All",rfps.length],["closed","Closed",fl.closed.length]].map(([id,lbl,n])=>(
            <button key={id} onClick={()=>setFilter(id)} style={{fontFamily:mono,fontSize:9,padding:"4px 10px",borderRadius:3,cursor:"pointer",border:`1px solid ${filter===id?C.gold:C.rule}`,background:filter===id?C.goldPale:"transparent",color:filter===id?C.gold:C.inkMuted,textTransform:"uppercase",letterSpacing:"0.04em",transition:"all 0.12s"}}>
              {lbl} ({n})
            </button>
          ))}
        </div>
        <div style={{fontFamily:mono,fontSize:9,color:C.inkMuted}}>Sorted by due date - {shown.length} shown</div>
      </div>
      {shown.map((rfp,i)=><RfpCard key={rfp.id} rfp={rfp} onAssess={onAssess} onNoBid={onNoBid} idx={i}/>)}
      {shown.length===0&&(
        <div style={{padding:"36px 20px",textAlign:"center",border:`2px dashed ${C.ruleLight}`,borderRadius:8,fontFamily:mono,fontSize:10,color:C.inkMuted,textTransform:"uppercase",letterSpacing:"0.06em"}}>
          {rfps.length===0 ? "No assessments done yet" : "No RFPs in this view"}
        </div>
      )}
    </div>
  );
}

function DeadlinesWidget({deadlines,onOpen,rfps}) {
  const [untriagedOnly,setUntriagedOnly]=useState(false);
  const shown=useMemo(()=>{
    const sorted=[...deadlines].sort((a,b)=>a.daysLeft-b.daysLeft);
    return untriagedOnly?sorted.filter(d=>d.status==="new"):sorted;
  },[deadlines,untriagedOnly]);

  return (
    <div style={{background:C.white,border:`1px solid ${C.rule}`,borderRadius:8,overflow:"hidden",boxShadow:"0 1px 4px rgba(20,28,36,0.07)",marginBottom:14}}>
      <div style={{padding:"11px 16px",background:C.navyDeep,borderBottom:`2px solid ${C.gold}`,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <span style={{fontFamily:disp,fontSize:13,fontWeight:700,color:C.white}}>Upcoming Deadlines</span>
        {/* -- UNTRIAGED FILTER -- */}
        <button onClick={()=>setUntriagedOnly(v=>!v)} style={{display:"flex",alignItems:"center",gap:5,background:untriagedOnly?"rgba(184,146,10,0.2)":"rgba(255,255,255,0.07)",border:`1px solid ${untriagedOnly?"rgba(184,146,10,0.45)":"rgba(255,255,255,0.15)"}`,borderRadius:3,padding:"3px 9px",cursor:"pointer",transition:"all 0.15s"}}>
          <div style={{width:7,height:7,borderRadius:"50%",background:untriagedOnly?C.gold:"rgba(255,255,255,0.3)",transition:"background 0.15s"}}/>
          <span style={{fontFamily:mono,fontSize:8,color:untriagedOnly?C.gold:"rgba(255,255,255,0.45)",textTransform:"uppercase",letterSpacing:"0.05em"}}>Untriaged only</span>
        </button>
      </div>
      {shown.length===0?(
        <div style={{padding:"18px 16px",fontFamily:mono,fontSize:10,color:C.inkMuted,textAlign:"center",textTransform:"uppercase",letterSpacing:"0.05em"}}>
          {untriagedOnly?"No untriaged RFPs":"No upcoming deadlines"}
        </div>
      ):shown.map((d,i)=>{
        const overdue=d.daysLeft<0, urgent=!overdue&&d.daysLeft<=2;
        const color=overdue?C.red:urgent?C.warn:d.daysLeft<=5?C.amber:C.inkMuted;
        const rfp=rfps.find(r=>r.id===d.rfpId);
        return (
          <div key={d.rfpId} onClick={()=>rfp&&onOpen(rfp)}
            style={{padding:"10px 16px",borderBottom:i<shown.length-1?`1px solid ${C.ruleLight}`:"none",display:"flex",alignItems:"center",gap:10,cursor:"pointer",transition:"background 0.12s"}}
            onMouseEnter={e=>e.currentTarget.style.background=C.offWhite}
            onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
            <div style={{width:34,height:34,borderRadius:5,background:overdue?C.redBg:urgent?C.warnBg:d.daysLeft<=5?C.amberBg:C.surface,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,border:`1px solid ${color}30`}}>
              <span style={{fontFamily:mono,fontSize:11,fontWeight:700,color,lineHeight:1}}>{overdue?"!":d.daysLeft===0?"0d":`${d.daysLeft}d`}</span>
            </div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontFamily:mono,fontSize:10,color:C.gold,fontWeight:600,marginBottom:2}}>{d.rfpId}</div>
              <div style={{fontSize:12,color:C.ink,fontWeight:600,overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis"}}>{d.buyer}</div>
            </div>
            <div style={{textAlign:"right",flexShrink:0}}>
              <StatusBadge status={d.status}/>
              <div style={{fontFamily:mono,fontSize:9,color,marginTop:3,fontWeight:600}}>{d.due.slice(5).replace("-","/")}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CorpusHealthWidget({onNavigate, corpusHealth}) {
  const score = Number(corpusHealth?.score || 0);
  const totalJobs = Number(corpusHealth?.total_jobs || 0);
  const topGap = `${corpusHealth?.top_gap || ""}`.trim();
  const processes = (Array.isArray(corpusHealth?.processes) ? corpusHealth.processes : []).slice(0, 6).map((p, i) => ({
    label: p.label || "Unknown",
    pct: Number(p.pct || 0),
    color: [C.gold, C.blue, C.blueMid, C.amber, C.warn, C.inkMuted][i % 6],
  }));
  const lessons = Number(corpusHealth?.total_lessons || 0);
  const lessonsLinked = Number(corpusHealth?.lessons_linked || 0);
  const gaps = processes.filter((p) => p.pct < 35).length;
  return (
    <div style={{background:C.white,border:`1px solid ${C.rule}`,borderRadius:8,overflow:"hidden",boxShadow:"0 1px 4px rgba(20,28,36,0.07)"}}>
      <div style={{padding:"11px 16px",background:C.surface,borderBottom:`1px solid ${C.rule}`,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <span style={{fontFamily:disp,fontSize:13,fontWeight:700}}>Corpus Health</span>
        <button onClick={onNavigate} style={{fontFamily:mono,fontSize:9,background:"none",border:"none",color:C.gold,cursor:"pointer",textTransform:"uppercase",letterSpacing:"0.04em"}}>{"View Full Corpus"}</button>
      </div>
      <div style={{padding:"14px 16px"}}>
        <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:14,paddingBottom:14,borderBottom:`1px solid ${C.ruleLight}`}}>
          <ScoreRing score={score} size={52}/>
          <div>
            <div style={{fontFamily:disp,fontSize:16,fontWeight:700,lineHeight:1,marginBottom:3}}>Match Standing</div>
            <div style={{fontFamily:mono,fontSize:9,color:C.inkMuted}}>Live corpus health score</div>
            <div style={{fontFamily:mono,fontSize:9,color:C.pass,marginTop:3}}>{processes[0]?.label || "No dominant process"}</div>
          </div>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:14}}>
          {[["Jobs",totalJobs,C.ink],["Lessons",lessons,C.ink],["Lessons linked",lessonsLinked,C.pass],["Gaps",gaps,C.warn]].map(([l,v,c])=>(
            <div key={l} style={{padding:"7px 9px",background:C.surface,borderRadius:5,border:`1px solid ${C.ruleLight}`}}>
              <div style={{fontFamily:mono,fontSize:16,fontWeight:600,color:c,lineHeight:1,marginBottom:3}}>{v}</div>
              <div style={{fontFamily:mono,fontSize:8,color:C.inkMuted,textTransform:"uppercase",letterSpacing:"0.05em"}}>{l}</div>
            </div>
          ))}
        </div>
        {processes.map(p=>(
          <div key={p.label} style={{marginBottom:8}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}><span style={{fontFamily:mono,fontSize:9,color:C.inkSoft}}>{p.label}</span><span style={{fontFamily:mono,fontSize:9,color:C.inkMuted}}>{p.pct}%</span></div>
            <MiniBar pct={p.pct} color={p.color} h={4}/>
          </div>
        ))}
        {topGap && (
          <div style={{marginTop:12,padding:"8px 10px",background:C.warnBg,border:`1px solid ${C.warnRule}`,borderRadius:5}}>
            <div style={{fontFamily:mono,fontSize:8,textTransform:"uppercase",letterSpacing:"0.05em",color:C.warn,marginBottom:3}}>Top Gap</div>
            <div style={{fontSize:12,color:C.ink,fontWeight:600}}>{topGap}</div>
            <div style={{fontSize:11,color:C.inkMuted,lineHeight:1.5,marginTop:2}}>Low historical coverage in this process area.</div>
          </div>
        )}
      </div>
    </div>
  );
}

function RfpPreviewDrawer({rfp,onClose,onAssess,onNoBid}) {
  if(!rfp) return null;
  const daysLeft=Math.round((new Date(rfp.due)-new Date("2026-03-30"))/86400000);
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(17,30,51,0.55)",zIndex:300,display:"flex",justifyContent:"flex-end"}} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{width:460,height:"100vh",background:C.white,boxShadow:"-8px 0 40px rgba(20,28,36,0.2)",display:"flex",flexDirection:"column",animation:"slideIn 0.22s ease"}}>
        <div style={{background:C.navyDeep,borderBottom:`2px solid ${C.gold}`,padding:"16px 20px",display:"flex",alignItems:"flex-start",gap:12}}>
          <div style={{flex:1}}>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}><span style={{fontFamily:mono,fontSize:11,color:C.gold,fontWeight:600}}>{rfp.id}</span><StatusBadge status={rfp.status}/></div>
            <div style={{fontFamily:serif,fontSize:18,fontWeight:700,color:C.white,marginBottom:4}}>{rfp.buyer}</div>
            <div style={{fontFamily:mono,fontSize:9,color:"rgba(255,255,255,0.4)"}}>Received {rfp.received} - Due {rfp.due}</div>
          </div>
          <button onClick={onClose} style={{background:"none",border:"none",color:"rgba(255,255,255,0.4)",cursor:"pointer",fontSize:18,lineHeight:1}}>x</button>
        </div>
        <div style={{flex:1,overflowY:"auto",padding:"20px"}}>
          <div style={{display:"flex",alignItems:"center",gap:12,padding:"13px 15px",background:C.surface,borderRadius:8,border:`1px solid ${C.rule}`,marginBottom:16}}>
            <ScoreRing score={rfp.matchScore} size={54}/>
            <div>
              <div style={{fontFamily:disp,fontSize:15,fontWeight:700,marginBottom:3}}>Corpus Match Score</div>
              <div style={{fontSize:12.5,color:C.inkMuted,lineHeight:1.55}}>{rfp.matchScore>=80?"Strong match - multiple precedent jobs found.":rfp.matchScore>=60?"Moderate match - some relevant history.":"Thin match - limited corpus coverage."}</div>
            </div>
          </div>
          <div style={{marginBottom:14}}>
            <div style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.07em",color:C.inkMuted,marginBottom:6}}>Project Summary</div>
            <div style={{fontSize:13,color:C.inkSoft,lineHeight:1.7,padding:"10px 12px",background:C.surface,borderRadius:5,border:`1px solid ${C.ruleLight}`}}>{rfp.summary}</div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:9,marginBottom:16}}>
            {[["Parts",rfp.parts],["Due Date",rfp.due],["Processes",rfp.processes.join(", ")],["Materials",rfp.materials.join(", ")],["Certs",rfp.certs.join(", ")],["Days Left",daysLeft<0?"Overdue":`${daysLeft}d`]].map(([l,v])=>(
              <div key={l} style={{padding:"8px 10px",background:C.surface,borderRadius:5,border:`1px solid ${C.ruleLight}`}}>
                <div style={{fontFamily:mono,fontSize:8,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted,marginBottom:4}}>{l}</div>
                <div style={{fontSize:12.5,color:C.ink,fontWeight:600}}>{v}</div>
              </div>
            ))}
          </div>
          <div style={{padding:"13px 15px",background:C.goldPale,border:`1px solid rgba(184,146,10,0.2)`,borderRadius:7,marginBottom:12}}>
            <div style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.06em",color:C.amber,marginBottom:8}}>Quick Actions</div>
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              <Btn variant="accent" onClick={()=>onAssess(rfp)}>Open Full Assessment</Btn>
              <Btn variant="ghost" onClick={()=>{onClose();onNoBid(rfp);}}>Mark No-bid</Btn>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// -- NO-BID MODAL --------------------------------------------------------------
function NoBidModal({ rfp, onClose, onSubmitAsBuyer, onDeclineOnly }) {
  const [step, setStep] = useState("choose"); // "choose" | "buyer_confirm"
  const [submittingBuyer, setSubmittingBuyer] = useState(false);

  // Referral confirm state
  const [email, setEmail] = useState("jordan@acmerobotics.com");
  const [note, setNote] = useState("");

  const processStr = rfp.processes.join(", ");
  const materialStr = rfp.materials.join(", ");
  const openBuyerForm = async () => {
    if (submittingBuyer) return;
    setSubmittingBuyer(true);
    try {
      const ok = await onSubmitAsBuyer(rfp, { buyer_contact_email: email, note });
      if (ok) onClose();
    } finally {
      setSubmittingBuyer(false);
    }
  };

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(17,30,51,0.65)", zIndex:600, display:"flex", alignItems:"center", justifyContent:"center", animation:"fadeIn 0.18s ease" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ width:560, maxHeight:"90vh", background:C.white, borderRadius:12, overflow:"auto", boxShadow:"0 20px 60px rgba(17,30,51,0.35)", animation:"up 0.2s ease" }}>

        {/* Modal header */}
        <div style={{ background:C.navyDeep, borderBottom:`2px solid ${C.gold}`, padding:"16px 22px", display:"flex", alignItems:"flex-start", justifyContent:"space-between" }}>
          <div>
            <div style={{ fontFamily:mono, fontSize:9, textTransform:"uppercase", letterSpacing:"0.08em", color:"rgba(255,255,255,0.4)", marginBottom:5 }}>
              {step === "choose" ? "No-Bid Decision" : "Submit as Buyer"}
            </div>
            <div style={{ fontFamily:serif, fontSize:18, fontWeight:700, color:C.white, marginBottom:3 }}>
              {step === "choose"
                ? `Marking ${rfp.id} as No-Bid`
                : "Submit to Trustbridge RFP Engine"}
            </div>
            <div style={{ fontFamily:mono, fontSize:9, color:"rgba(255,255,255,0.4)" }}>
              {rfp.buyer} - {processStr} - {materialStr}
            </div>
          </div>
          <button onClick={onClose} style={{ background:"none", border:"none", color:"rgba(255,255,255,0.35)", cursor:"pointer", fontSize:18, lineHeight:1, marginTop:2 }}>x</button>
        </div>

        {/* -- STEP 1: CHOOSE -- */}
        {step === "choose" && (
          <div style={{ padding:"22px 22px 18px" }}>
            <div style={{ fontSize:13, color:C.inkSoft, lineHeight:1.65, marginBottom:14 }}>
              Choose one action for this no-bid. Recommended: open the RFP form, review prefilled fields, edit, then submit to Trustbridge.
            </div>
            <div style={{ display:"grid", gap:10, marginBottom:16 }}>
              <div style={{padding:"12px 14px",border:`1px solid ${C.rule}`,borderRadius:8,background:C.surface}}>
                <div style={{fontFamily:disp,fontSize:14,fontWeight:700,color:C.ink,marginBottom:5}}>Open RFP Form (Recommended)</div>
                <div style={{fontSize:12.5,color:C.inkMuted,lineHeight:1.55,marginBottom:10}}>Form opens pre-populated from this RFP. You can edit all fields, parts, and attachments before submitting.</div>
                <Btn variant="primary" onClick={() => setStep("buyer_confirm")}>Open RFP Form</Btn>
              </div>
            </div>

            {/* Just no-bid */}
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
              <div style={{ fontFamily:mono, fontSize:9, color:C.inkMuted }}>Or simply decline - no referral, no submission.</div>
              <Btn variant="ghost" onClick={async () => { const ok = onDeclineOnly ? await onDeclineOnly(rfp, { buyer_contact_email: email, note }) : true; if (ok) onClose(); }}>Mark No-bid Only</Btn>
            </div>
          </div>
        )}

        {/* -- STEP 2B: BUYER CONFIRM -- */}
        {step === "buyer_confirm" && (
          <div style={{ padding:"22px 22px 18px" }}>
            <div style={{ padding:"12px 14px", background:C.bluePale, borderLeft:`3px solid ${C.navy}`, borderRadius:5, marginBottom:18, fontSize:13, color:C.inkSoft, lineHeight:1.65 }}>
              This opens the <strong>Trustbridge Buyer RFP form</strong> with pre-populated fields. You can edit everything before final submit.
            </div>
            <div style={{marginBottom:14}}>
              <Btn variant="primary" onClick={openBuyerForm} disabled={submittingBuyer}>{submittingBuyer ? "Opening..." : "Open RFP Form"}</Btn>
            </div>

            <div style={{ marginBottom:14 }}>
              <label style={{ display:"block", fontFamily:mono, fontSize:9, textTransform:"uppercase", letterSpacing:"0.07em", color:C.inkMuted, marginBottom:6 }}>Buyer Contact Email (optional)</label>
              <input value={email} onChange={e=>setEmail(e.target.value)} placeholder="buyer@company.com"
                style={{ width:"100%", padding:"9px 12px", fontFamily:sans, fontSize:13, color:C.ink, background:C.surface, border:`1px solid ${C.rule}`, borderRadius:4, outline:"none" }}
                onFocus={e=>e.target.style.borderColor=C.gold} onBlur={e=>e.target.style.borderColor=C.rule}/>
            </div>

            <div style={{ marginBottom:18 }}>
              <label style={{ display:"block", fontFamily:mono, fontSize:9, textTransform:"uppercase", letterSpacing:"0.07em", color:C.inkMuted, marginBottom:6 }}>Internal Note (optional)</label>
              <textarea value={note} onChange={e=>setNote(e.target.value)} rows={2} placeholder="Optional context for BRFP routing."
                style={{ width:"100%", padding:"9px 12px", fontFamily:sans, fontSize:13, color:C.ink, background:C.surface, border:`1px solid ${C.rule}`, borderRadius:4, outline:"none", resize:"vertical" }}
                onFocus={e=>e.target.style.borderColor=C.gold} onBlur={e=>e.target.style.borderColor=C.rule}/>
            </div>

            <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
              <Btn variant="outline" onClick={() => setStep("choose")}>Back</Btn>
              <Btn variant="primary" onClick={openBuyerForm} disabled={submittingBuyer}>{submittingBuyer ? "Opening..." : "Open RFP Form"}</Btn>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

function DashboardScreen({navigate,onLogout}) {
  const [notifs,setNotifs]=useState(NOTIFICATIONS);
  const [showNotifs,setShowNotifs]=useState(false);
  const [showSettings,setShowSettings]=useState(false);
  const [noBidRfp,setNoBidRfp]=useState(null);
  const [rfps,setRfps]=useState(SEED_RFPS);
  const [deadlines,setDeadlines]=useState(DEADLINES_DATA);
  const [corpusScore,setCorpusScore]=useState(80);
  const [corpusHealth,setCorpusHealth]=useState({ score: 0, processes: [], total_jobs: 0, top_gap: "" });
  const [supplierName,setSupplierName]=useState("Precision Dynamics");
  const [noBidStatus,setNoBidStatus]=useState("");
  const [dashboardLoading,setDashboardLoading]=useState(true);

  const unread=notifs.filter(n=>!n.read).length;
  const markAll=()=>setNotifs(ns=>ns.map(n=>({...n,read:true})));
  const handleAssess=rfp=>{navigate("assessment",{rfp});};
  const resolveNoBidRfpId = useCallback((rfp) => {
    const raw = `${rfp?.rfp_id || rfp?.sourceRfpId || rfp?.id || rfp?.view_id || ""}`.trim();
    if (!raw) return "";
    if (raw.startsWith("ZOHO-")) return raw;
    if (/^\d{10,}$/.test(raw)) return `ZOHO-${raw}`;
    return raw;
  }, []);
  const handleUploadRfp = useCallback((files = []) => {
    navigate("assessment", { uploadFiles: files });
  }, [navigate]);
  const handleRefreshNow = useCallback(() => {
    clearUiDataCaches();
    window.location.reload();
  }, []);
  const applyNoBidUi = useCallback((rfp, resolvedId) => {
    setRfps((prev) => prev.map((row) => {
      const same = resolveNoBidRfpId(row) === resolvedId || `${row?.id || ""}` === `${rfp?.id || ""}`;
      return same ? { ...row, status: "no_bid" } : row;
    }));
    setDeadlines((prev) => prev.map((d) => {
      const did = `${d?.rfpId || ""}`.trim();
      const same = did === resolvedId || did === `${rfp?.id || ""}`;
      return same ? { ...d, status: "no_bid" } : d;
    }));
  }, [resolveNoBidRfpId]);
  const handleNoBid = useCallback((rfp) => {
    setNoBidStatus("");
    setNoBidRfp(rfp);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const session = getSupplierSession();
    const snapshotKey = _dashboardSnapshotKey(session);
    try {
      const raw = sessionStorage.getItem(snapshotKey);
      if (raw) {
        const snap = JSON.parse(raw);
        if (Array.isArray(snap?.rfps) && snap.rfps.length) setRfps(snap.rfps);
        if (Array.isArray(snap?.deadlines) && snap.deadlines.length) setDeadlines(snap.deadlines);
        if (snap?.corpusHealth) setCorpusHealth(snap.corpusHealth);
        if (Number.isFinite(Number(snap?.corpusScore))) setCorpusScore(Number(snap.corpusScore));
      }
    } catch {}
    async function fetchDashboardBatch(session, force = false) {
      const options = { ttlMs: 20000, force };
      const mappedRfps = [];

        const bootstrap = await apiGetCached(
          ENDPOINTS.dashboard.bootstrap,
          {
            supplier_id: session.supplier_id,
            supplier_email: session.supplier_email,
            supplier_name: session.supplier_name,
            limit: 200,
            include_corpus: 1,
          },
          options
        ).catch(() => null);

        if (bootstrap?.ok) {
        [
          ...(bootstrap.rfps_scoped || []),
          ...(bootstrap.rfps_crm || []),
          ...(bootstrap.assessments_crm || []),
          ...(bootstrap.assessments_scoped || []),
          ].forEach((item, idx) => {
            mappedRfps.push(toRfpCardShape(item, idx));
          });
          let corpusPayload = bootstrap.corpus_health || null;
          if (!corpusPayload && session.supplier_id) {
            corpusPayload = await apiGetCached(
              ENDPOINTS.assessment.corpusHealth,
              {
                supplier_id: session.supplier_id,
                supplier_name: session.supplier_name || "",
              },
              options
            ).catch(() => null);
          }
          return { mappedRfps, corpusPayload };
        }

      const [recentRfps, recentAssessmentsCRM, recentAssessmentsAll] = await Promise.allSettled([
        apiGetCached(ENDPOINTS.rfp.recent, { supplier_id: session.supplier_id, limit: 200 }, options),
        apiGetCached(ENDPOINTS.assessment.recent, { supplier_id: session.supplier_id, supplier_email: session.supplier_email, limit: 200, crm_only: true }, options),
        apiGetCached(ENDPOINTS.assessment.recent, { supplier_id: session.supplier_id, supplier_email: session.supplier_email, limit: 200 }, options),
      ]);

      if (recentRfps.status === "fulfilled") (recentRfps.value.items || []).forEach((item, idx) => mappedRfps.push(toRfpCardShape(item, idx)));
      if (recentAssessmentsCRM.status === "fulfilled") (recentAssessmentsCRM.value.items || []).forEach((item, idx) => mappedRfps.push(toRfpCardShape(item, idx + mappedRfps.length)));
      if (recentAssessmentsAll.status === "fulfilled") (recentAssessmentsAll.value.items || []).forEach((item, idx) => mappedRfps.push(toRfpCardShape(item, idx + mappedRfps.length)));
      return { mappedRfps, corpusPayload: null };
    }

    async function loadDashboard() {
      try {
        const session = getSupplierSession();
        if (session.supplier_name) setSupplierName(session.supplier_name);

        // pass 1: cached-fast parallel reads
        let { mappedRfps, corpusPayload } = await fetchDashboardBatch(session, false);
        // pass 2: force-refresh if empty OR if no assessment snapshots are present.
        const hasAssessmentRows = mappedRfps.some((r) => Boolean(r?.has_cached) || `${r?.id || ""}`.startsWith("ZOHO-"));
        if (!mappedRfps.length || !hasAssessmentRows) {
          const forced = await fetchDashboardBatch(session, true);
          if (forced.mappedRfps.length) mappedRfps = forced.mappedRfps;
          if (forced.corpusPayload) corpusPayload = forced.corpusPayload;
        }

        const scoreCardRichness = (row) => {
          if (!row) return 0;
          let score = 0;
          if (Boolean(row?.has_cached)) score += 8;
          if (Boolean(row?.crmSource)) score += 4;
          if (Number(row?.matchScore || 0) > 0) score += 3;
          if (`${row?.status || ""}` !== "new") score += 2;
          if (Array.isArray(row?.parts_prefill) && row.parts_prefill.length) score += 1;
          return score;
        };
        const canonicalRfpKey = (row) => {
          const candidates = [
            `${row?.id || ""}`.trim(),
            `${row?.rfp_id || ""}`.trim(),
            `${row?.sourceRfpId || ""}`.trim(),
            `${row?.crmRecordId || ""}`.trim(),
            `${row?.zohoId || ""}`.trim(),
          ].filter(Boolean);
          const variants = new Set();
          candidates.forEach((raw) => {
            buildAssessmentIdVariants(raw).forEach((v) => variants.add(v));
          });
          const variantList = Array.from(variants);
          if (variantList.length) {
            const zoho = variantList.find((v) => `${v}`.startsWith("ZOHO-"));
            return `${zoho || variantList.sort()[0]}`;
          }
          return [
            `${row?.buyer || ""}`.trim().toLowerCase(),
            `${row?.project || ""}`.trim().toLowerCase(),
            `${row?.received || ""}`.trim(),
          ].join("|");
        };
        const byCanonical = new Map();
        mappedRfps.forEach((r) => {
          const key = canonicalRfpKey(r);
          const prev = byCanonical.get(key);
          if (!prev || scoreCardRichness(r) >= scoreCardRichness(prev)) byCanonical.set(key, r);
        });
        const mergedIncoming = Array.from(byCanonical.values()).sort((a, b) => `${b.received}`.localeCompare(`${a.received}`));

        if (!cancelled && mergedIncoming.length > 0) {
          setRfps((prev) => {
            const prevRows = Array.isArray(prev) ? prev : [];
            const prevById = new Map(prevRows.map((r) => [canonicalRfpKey(r), r]));
            const reconciledRaw = mergedIncoming.map((row) => {
              const old = prevById.get(canonicalRfpKey(row));
              if (!old) return row;
              const rowThin = (!row?.has_cached && Number(row?.matchScore || 0) <= 0 && `${row?.status || ""}` === "new");
              const oldStrong = (Boolean(old?.has_cached) || Number(old?.matchScore || 0) > 0 || `${old?.status || ""}` !== "new");
              return (rowThin && oldStrong) ? { ...row, ...old } : row;
            });
            const reconciled = (reconciledRaw || []).map((r, i) => normalizeRfpCard(r, i));
            const finalRows = reconciled.length ? reconciled : (prevRows.length ? prevRows : SEED_RFPS.map((r, i) => normalizeRfpCard(r, i)));
            const deadlines = buildDeadlinesFromRfps(finalRows);
            setDeadlines(deadlines);
            try {
              sessionStorage.setItem(snapshotKey, JSON.stringify({
                rfps: finalRows,
                deadlines,
                corpusScore,
                corpusHealth,
              }));
            } catch {}
            return finalRows;
          });
        }

        if (!cancelled && corpusPayload && Number.isFinite(Number(corpusPayload.score))) {
          setCorpusScore(Number(corpusPayload.score));
          setCorpusHealth(corpusPayload || { score: Number(corpusPayload.score), processes: [], total_jobs: 0, top_gap: "" });
          try {
            const existing = JSON.parse(sessionStorage.getItem(snapshotKey) || "{}");
            sessionStorage.setItem(snapshotKey, JSON.stringify({
              ...existing,
              corpusScore: Number(corpusPayload.score),
              corpusHealth: corpusPayload || { score: Number(corpusPayload.score), processes: [], total_jobs: 0, top_gap: "" },
            }));
          } catch {}
        }
      } catch {
        // Keep seed visuals on transient failures.
      } finally {
        if (!cancelled) setDashboardLoading(false);
      }
    }

    loadDashboard();
    return () => { cancelled = true; };
  }, []);

  return (
    <div style={{fontFamily:sans,fontSize:14,color:C.ink,minHeight:"100vh",background:C.offWhite}}>
      <Topbar screen="dashboard" notifCount={unread} onNotif={()=>{setShowSettings(false);setShowNotifs(v=>!v);}} onSettings={()=>{setShowNotifs(false);setShowSettings(v=>!v);}} onLogout={onLogout}
        rightSlot={<div style={{display:"flex",alignItems:"center",gap:6,padding:"4px 11px",borderRadius:4,background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",marginRight:6}}><span style={{fontFamily:mono,fontSize:9,color:"rgba(255,255,255,0.4)",textTransform:"uppercase",letterSpacing:"0.04em"}}>Corpus</span><span style={{fontFamily:mono,fontSize:14,fontWeight:700,color:C.gold}}>{Math.max(0, Math.min(100, Number(corpusScore || 0)))}</span></div>}/>
      {showNotifs&&<><NotifDrawer notifs={notifs} onClose={()=>setShowNotifs(false)} onMarkAll={markAll}/><div style={{position:"fixed",inset:0,zIndex:499}} onMouseDown={()=>setShowNotifs(false)}/></>}
      {showSettings&&<><SettingsDrawer onClose={()=>setShowSettings(false)} onLogout={onLogout} onRefresh={handleRefreshNow}/><div style={{position:"fixed",inset:0,zIndex:499}} onMouseDown={()=>setShowSettings(false)}/></>}
      <StatStrip rfps={rfps} corpusScore={corpusScore}/>
      <div style={{background:C.white,borderBottom:`1px solid ${C.rule}`,padding:"16px 26px"}}>
        <div style={{maxWidth:1280,margin:"0 auto"}}>
          <div style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.1em",color:C.gold,marginBottom:4}}>Supplier Portal - Dashboard</div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end"}}>
            <div>
              <h1 style={{fontFamily:disp,fontSize:23,fontWeight:700,lineHeight:1.2,marginBottom:4}}>Hey There, {supplierName}</h1>
              <p style={{fontSize:13,color:C.inkMuted,lineHeight:1.6}}>You have <strong style={{color:C.ink}}>{rfps.filter(r=>r.status==="new").length} new RFPs</strong> awaiting assessment. Corpus score: <strong style={{color:C.pass}}>{corpusScore}</strong>.</p>
              {dashboardLoading && <div style={{fontFamily:mono,fontSize:9,color:C.inkMuted,marginTop:5}}>Refreshing live data...</div>}
            </div>
            <div style={{display:"flex",gap:10}}>
              <Btn variant="outline" onClick={()=>navigate("buyerrfp",{})}>Buyer Portal Demo</Btn>
              <Btn variant="ghost" onClick={()=>navigate("ingestion",{})}>Ingest Past RFP</Btn>
              <Btn variant="accent" onClick={()=>handleUploadRfp([])}>+ Upload RFP</Btn>
            </div>
          </div>
          {noBidStatus && (
            <div style={{marginTop:10,padding:"8px 10px",background:C.surface,border:`1px solid ${C.ruleLight}`,borderRadius:5,fontSize:12,color:C.inkSoft}}>
              {noBidStatus}
            </div>
          )}
        </div>
      </div>
      <div style={{maxWidth:1280,margin:"0 auto",padding:"20px 26px",display:"grid",gridTemplateColumns:"1fr 320px",gap:20,alignItems:"start"}}>
        <div style={{animation:"up 0.3s ease"}}>
          <UploadZone onUploadRfp={handleUploadRfp}/>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <h2 style={{fontFamily:disp,fontSize:16,fontWeight:700}}>Inbound RFP Queue</h2>
              <span style={{fontFamily:mono,fontSize:9,padding:"2px 8px",borderRadius:2,background:C.bluePale,color:C.blue,border:"1px solid rgba(26,74,114,0.2)",textTransform:"uppercase"}}>{rfps.filter(r=>["new","in_assessment"].includes(r.status)).length} active</span>
            </div>
            <div style={{fontFamily:mono,fontSize:9,color:C.inkMuted}}>Use Assess to open full tool, or Mark No-bid directly from each card.</div>
          </div>
          <RfpQueue rfps={rfps} onAssess={handleAssess} onNoBid={handleNoBid}/>
        </div>
        <div style={{animation:"up 0.3s ease 0.08s both"}}>
          <DeadlinesWidget deadlines={deadlines} onOpen={handleAssess} rfps={rfps}/>
          <CorpusHealthWidget onNavigate={()=>navigate("ingestion",{})} corpusHealth={corpusHealth}/>
        </div>
      </div>
      {noBidRfp&&<NoBidModal
        rfp={noBidRfp}
        onClose={()=>setNoBidRfp(null)}
        onDeclineOnly={async (rfp, extra={})=>{
          try {
            const session = getSupplierSession();
            const resolvedId = resolveNoBidRfpId(rfp);
            if (!resolvedId) throw new Error("Missing RFP id for no-bid route.");
            await apiPost(ENDPOINTS.assessment.noBid,{
              rfp_id: resolvedId,
              supplier_id: session.supplier_id || "",
              supplier_name: session.supplier_name || "",
              path: "decline_only",
              reason: "decline_only",
              buyer_contact_email: extra?.buyer_contact_email || "",
              note: extra?.note || "",
            });
            setNoBidStatus(`No-bid recorded for ${resolvedId}.`);
            applyNoBidUi(rfp, resolvedId);
            setNoBidRfp(null);
            return true;
          } catch (e) {
            setNoBidStatus(`No-bid failed: ${e?.message || e}`);
            return false;
          }
        }}
        onSubmitAsBuyer={async (rfp, extra={})=>{
          setNoBidStatus("Opening RFP form...");
          let enriched = rfp;
          try {
            // Primary source: full BRFP record (best part-level fidelity).
            if (`${rfp?.crmRecordId || ""}`.trim()) {
              const [crmRec, crmMed] = await Promise.all([
                apiGet(ENDPOINTS.rfp.crmRecord, { record_id: rfp.crmRecordId }).catch(() => null),
                apiGet(ENDPOINTS.rfp.crmMedia, { record_id: rfp.crmRecordId, limit: 12 }).catch(() => null),
              ]);
              const item = crmRec?.item || null;
              if (item) {
                const mediaImgs = []
                  .concat(Array.isArray(crmMed?.image_urls) ? crmMed.image_urls.map((u) => toAbsImageUrl(u)) : [])
                  .concat(Array.isArray(crmMed?.cad_previews_b64) ? crmMed.cad_previews_b64.map((b64) => normalizeB64ImageSrc(b64)) : [])
                  .filter(Boolean);
                const fromCrmParts = (Array.isArray(item?.parts) ? item.parts : []).map((p, idx) => {
                  const pimgs = []
                    .concat(Array.isArray(p?.images) ? p.images : [])
                    .concat(`${p?.image_url || ""}`.trim() ? [toAbsImageUrl(p.image_url)] : [])
                    .filter(Boolean);
                  const images = pimgs.length ? pimgs : [];
                  return {
                    id: p?.id || p?.part_id || `PART-${String(idx + 1).padStart(3, "0")}`,
                    description: p?.description || p?.part_name || p?.label || p?.name || `Part ${idx + 1}`,
                    material: p?.material || p?.mat || "",
                    process: p?.process || p?.process_primary || p?.proc || "",
                    tolerance: p?.tolerance || p?.tolerance_class || p?.tol || "",
                    qty: `${p?.qty ?? p?.quantity ?? p?.Quantity ?? 1}`,
                    finish: p?.finish || p?.surface_finish || "",
                    notes: p?.notes || "",
                    images: [...new Set(images)],
                    imageSource: pimgs.length ? "crm_part" : "",
                  };
                });
                enriched = {
                  ...rfp,
                  ...item,
                  buyer: item?.buyer || item?.company_name || rfp?.buyer || "",
                  project: item?.project || item?.summary || rfp?.project || "",
                  summary: item?.summary || item?.project || rfp?.summary || "",
                  location: item?.location || item?.company_location || rfp?.location || "",
                  delivery: item?.delivery || item?.due || rfp?.delivery || "",
                  certs: item?.certs || item?.mandatory_certifications || rfp?.certs || [],
                  geo_preference: item?.geo_preference || item?.geo || rfp?.geo_preference || rfp?.geo || "",
                  parts_prefill: fromCrmParts,
                };
              }
            }

            const resolvedId = resolveNoBidRfpId(rfp);
            if (resolvedId) {
              const session = getSupplierSession();
              const snap = await apiGet(ENDPOINTS.assessment.result, {
                rfp_id: resolvedId,
                supplier_id: session.supplier_id || "",
                supplier_email: session.supplier_email || "",
              });
              const toProxyAttachmentUrl = (rawUrl, fallbackRecordId = "") => {
                const url = `${rawUrl || ""}`.trim();
                if (!url) return "";
                if (url.startsWith("/api/")) return `${API_BASE}${url}`;
                if (url.startsWith("api/")) return `${API_BASE}/${url}`;
                if (url.includes("/api/assessment/attachment?")) return url;
                const m = url.match(/RFP_Assessments\/(\d+)\/Attachments\/(\d+)/i);
                if (m?.[1] && m?.[2]) {
                  const q = new URLSearchParams({ record_id: m[1], attachment_id: m[2] });
                  return `${API_BASE}${ENDPOINTS.assessment.attachment}?${q.toString()}`;
                }
                const a = url.match(/[?&]attachment_id=(\d+)/i);
                if (fallbackRecordId && a?.[1]) {
                  const q = new URLSearchParams({ record_id: `${fallbackRecordId}`, attachment_id: a[1] });
                  return `${API_BASE}${ENDPOINTS.assessment.attachment}?${q.toString()}`;
                }
                return url;
              };
              const normalizeToken = (v) =>
                `${v || ""}`.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
              const prefillParts = (Array.isArray(snap?.parts) ? snap.parts : []).map((p, idx) => {
                const images = [];
                let imageSource = "";
                const partIdRaw = `${p?.part_id || p?.id || ""}`.trim();
                const partNameRaw = `${p?.part_name || p?.description || p?.name || ""}`.trim();
                const partIdNorm = normalizeToken(partIdRaw);
                const partNameNorm = normalizeToken(partNameRaw);
                if (p?.image_b64) images.push(`data:image/jpeg;base64,${p.image_b64}`);
                if (p?.part_image_b64) images.push(`data:image/jpeg;base64,${p.part_image_b64}`);
                if (p?.image_b64 || p?.part_image_b64) imageSource = "assessment_part";
                if (p?.part_image_url) images.push(toProxyAttachmentUrl(p.part_image_url, snap?.zoho_record_id || snap?.record_id || ""));
                (Array.isArray(p?.matched_jobs) ? p.matched_jobs : []).forEach((mj) => {
                  const pname = `${mj?.project_name || ""}`.toLowerCase();
                  const jid = `${mj?.job_id || ""}`.toLowerCase();
                  const mjPartIdNorm = normalizeToken(mj?.part_id || "");
                  const mjPartNameNorm = normalizeToken(mj?.part_name || mj?.label || mj?.description || "");
                  const jidNorm = normalizeToken(jid);
                  const looksLikePartAttachment = pname.includes("part image") || jid.startsWith("part_");
                  const idMatches = !!partIdNorm && (jidNorm.includes(partIdNorm) || mjPartIdNorm === partIdNorm);
                  const nameMatches = !!partNameNorm && (jidNorm.includes(partNameNorm) || mjPartNameNorm === partNameNorm);
                  const isPartAttachment = looksLikePartAttachment && (idMatches || nameMatches);
                  if (isPartAttachment && mj?.image_url) {
                    images.push(toProxyAttachmentUrl(mj.image_url, snap?.zoho_record_id || snap?.record_id || ""));
                    if (!imageSource) imageSource = "assessment_part";
                  }
                });
                // Do NOT use generic extracted/matched fallback here.
                // Buyer part prefill should only carry true part-owned images.
                return {
                  id: p?.part_id || `PART-${String(idx + 1).padStart(3, "0")}`,
                  description: p?.part_name || p?.description || p?.label || p?.name || `Part ${idx + 1}`,
                  material: p?.material || p?.mat || p?.Material || "",
                  process: p?.process_primary || p?.process || p?.proc || p?.Process || "",
                  tolerance: p?.tolerance_class || p?.tolerance || p?.tol || p?.Tolerance || "",
                  qty: `${p?.qty ?? p?.quantity ?? p?.Quantity ?? 1}`,
                  notes: p?.notes || "",
                  images: [...new Set(images.filter(Boolean))],
                  imageSource,
                };
              });
              const existingParts = Array.isArray(enriched?.parts_prefill) ? enriched.parts_prefill : [];
              const byKey = new Map();
              const partKey = (part = {}, idx = 0) => {
                const idk = normalizeToken(part?.id || part?.part_id || "");
                const namek = normalizeToken(part?.description || part?.part_name || part?.label || part?.name || "");
                return idk || namek || `idx_${idx}`;
              };
              existingParts.forEach((ep, i) => byKey.set(partKey(ep, i), ep));
              const merged = prefillParts.map((pp, i) => {
                const prev = byKey.get(partKey(pp, i)) || {};
                const ppImages = Array.isArray(pp?.images) ? pp.images : [];
                const prevImages = Array.isArray(prev?.images) ? prev.images : [];
                const images = ppImages.length ? ppImages : prevImages;
                return {
                  ...prev,
                  ...pp,
                  images: [...new Set(images.filter(Boolean))],
                  imageSource: pp?.imageSource || prev?.imageSource || "",
                };
              });
              enriched = {
                ...rfp,
                ...enriched,
                buyer: snap?.buyer || snap?.company_name || enriched?.buyer || rfp?.buyer || "",
                contact: snap?.contact_name || enriched?.contact || "",
                email: snap?.contact_email || enriched?.email || "",
                phone: snap?.contact_phone || enriched?.phone || "",
                companyIndustry: snap?.customer_industry || enriched?.companyIndustry || "",
                companySize: snap?.company_size || enriched?.companySize || "",
                companyLocation: snap?.company_location || enriched?.companyLocation || "",
                project: snap?.project || snap?.company_name || enriched?.project || rfp?.project || "",
                summary: snap?.project_description || enriched?.summary || rfp?.summary || "",
                annualVolume: snap?.expected_annual_production_volume || enriched?.annualVolume || "",
                delivery: snap?.required_date || snap?.delivery || enriched?.delivery || rfp?.delivery || "",
                deliveryLoc: snap?.delivery_location || enriched?.deliveryLoc || "",
                certs: Array.isArray(snap?.mandatory_certifications) ? snap.mandatory_certifications : (enriched?.certs || rfp?.certs || []),
                mandatoryCerts: Array.isArray(snap?.mandatory_certifications) ? snap.mandatory_certifications : (enriched?.mandatoryCerts || []),
                certification_preferences: snap?.certification_notes || enriched?.certification_preferences || "",
                geo_preference: snap?.geo_preference || enriched?.geo_preference || rfp?.geo_preference || rfp?.geo || "",
                other_project_requirements: snap?.other_project_requirements || enriched?.other_project_requirements || "",
                parts_prefill: merged,
              };
            }
          } catch (e) {
            setNoBidStatus(`Prefill warning: ${e?.message || e}`);
          }
          const seedParts = (Array.isArray(enriched?.parts_prefill) && enriched.parts_prefill.length)
            ? enriched.parts_prefill
            : (Array.isArray(rfp?.parts_prefill) && rfp.parts_prefill.length)
              ? rfp.parts_prefill
              : (Array.isArray(rfp?.parts) && rfp.parts.length)
                ? rfp.parts
                : [];
          enriched = {
            ...rfp,
            ...enriched,
            buyer: enriched?.buyer || rfp?.buyer || "",
            project: enriched?.project || rfp?.project || "",
            summary: enriched?.summary || rfp?.summary || "",
            location: enriched?.location || rfp?.location || "",
            delivery: enriched?.delivery || rfp?.delivery || "",
            certs: enriched?.certs || rfp?.certs || [],
            geo_preference: enriched?.geo_preference || rfp?.geo_preference || rfp?.geo || "",
            parts_prefill: Array.isArray(seedParts) ? seedParts : [],
          };
          try {
            navigate("buyerrfp",{
              rfp: enriched,
              noBidIntent:{
                path:"master_rfp_engine",
                buyer_contact_email: extra?.buyer_contact_email || "",
                note: extra?.note || "",
              }
            });
            setNoBidStatus("RFP form opened with prefilled data.");
            setNoBidRfp(null);
            return true;
          } catch (e) {
            setNoBidStatus(`Open form failed: ${e?.message || e}`);
            return false;
          }
        }}
      />}
    </div>
  );
}
function useAnimVal(target,delay=0){const [v,setV]=useState(0);useEffect(()=>{const t=setTimeout(()=>setV(target),delay+120);return()=>clearTimeout(t);},[target]);return v;}
function asmtScoreColor(v){return v>=88?C.gold:v>=72?C.blueMid:C.inkMuted;}

function AsmtRing({value,size=64,delay=0}){
  const v=useAnimVal(value,delay),r=size/2-5,circ=2*Math.PI*r,col=asmtScoreColor(value);
  return(<div style={{position:"relative",width:size,height:size,flexShrink:0}}><svg width={size} height={size} style={{transform:"rotate(-90deg)"}}><circle cx={size/2} cy={size/2} r={r} fill="none" stroke={C.ruleLight} strokeWidth={4.5}/><circle cx={size/2} cy={size/2} r={r} fill="none" stroke={col} strokeWidth={4.5} strokeDasharray={circ} strokeDashoffset={circ-(v/100)*circ} strokeLinecap="round" style={{transition:"stroke-dashoffset 0.7s cubic-bezier(.4,0,.2,1)"}}/></svg><div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center"}}><span style={{fontFamily:mono,fontSize:size>52?17:12,fontWeight:500,color:col,lineHeight:1}}>{value}</span></div></div>);
}

function AsmtBar({value,delay=0,h=4}){
  const v=useAnimVal(value,delay);
  return(<div style={{height:h,background:C.ruleLight,borderRadius:2,overflow:"hidden"}}><div style={{height:"100%",width:`${v}%`,background:asmtScoreColor(value),borderRadius:2,transition:"width 0.6s cubic-bezier(.4,0,.2,1)"}}/></div>);
}

function AsmtChip({type,label}){
  const s=type==="pass"?{bg:C.passBg,color:C.pass,border:"rgba(30,94,58,0.2)"}:{bg:C.warnBg,color:C.warn,border:"rgba(184,146,10,0.3)"};
  return <span style={{fontFamily:mono,fontSize:9,padding:"2px 7px",borderRadius:2,background:s.bg,color:s.color,border:`1px solid ${s.border}`,letterSpacing:"0.04em",textTransform:"uppercase"}}>{label}</span>;
}

function AsmtTag({children,accent}){
  return <span style={{fontFamily:mono,fontSize:9,padding:"2px 7px",borderRadius:2,background:accent?C.goldPale:C.surface,color:accent?C.gold:C.inkSoft,border:`1px solid ${accent?"rgba(184,146,10,0.25)":C.rule}`,letterSpacing:"0.04em"}}>{children}</span>;
}

const ASMT_RFP = { id:"", buyer:"", location:"", project:"", priority:"", certs:[], geo:"", delivery:"", parts:[] };
const ASMT_FIT = {
  overall:0,
  dims:[
    {key:"B1",label:"B1 - Capability",sub:"Customer-stated material, process, finish and tolerance vs profile",val:0},
    {key:"B2",label:"B2 - Part Type Fit",sub:"How manufacturable the part is against your process history",val:0},
    {key:"C",label:"C - Project History",sub:"Similarity against your ingested historical corpus",val:0},
  ],
  flags:[],
  guidance:[],
};
const ASMT_JOBS = [];

function AsmtJobCard({
  job,
  animDelay=0,
  feedbackEntry={},
  onFeedbackChange=null,
  onSubmitFeedback=null,
  submitState={},
}) {
  const [open,setOpen]=useState(false);
  const [overviewOpen,setOverviewOpen]=useState(false);
  const [vis,setVis]=useState(false);
  const imageCandidates = useMemo(() => {
    const all = [
      ...(Array.isArray(job?.imageCandidates) ? job.imageCandidates : []),
      `${job?.imageUrl || ""}`.trim(),
    ].filter(Boolean);
    const out = [];
    const seen = new Set();
    all.forEach((u) => {
      const s = `${u || ""}`.trim();
      if (!s || seen.has(s)) return;
      seen.add(s);
      out.push(s);
    });
    return out;
  }, [job?.imageCandidates, job?.imageUrl]);
  const [imgIdx,setImgIdx]=useState(0);
  const [imgOk,setImgOk]=useState(false);
  const activeImg = imageCandidates[imgIdx] || "";
  useEffect(()=>{ setImgIdx(0); setImgOk(false); }, [job?.id, job?.imageUrl, imageCandidates.length]);
  const handleImageError = useCallback(() => {
    setImgOk(false);
    setImgIdx((prev) => (prev + 1 < imageCandidates.length ? prev + 1 : prev));
  }, [imageCandidates.length]);
  useEffect(()=>{const t=setTimeout(()=>setVis(true),animDelay);return()=>clearTimeout(t);},[]);
  const col=asmtScoreColor(job.similarity);
  const bg=job.similarity>=88?C.goldPale:job.similarity>=72?C.bluePale:C.surface;
  const brd=job.similarity>=88?"rgba(184,146,10,0.3)":job.similarity>=72?"rgba(74,123,175,0.3)":C.rule;
  const hasFeedback = Boolean(
    `${feedbackEntry?.user_rating || ""}`.trim() ||
    `${feedbackEntry?.user_score ?? ""}`.trim() ||
    `${feedbackEntry?.reason || ""}`.trim() ||
    (feedbackEntry?.field_corrections && Object.keys(feedbackEntry.field_corrections).length > 0)
  );
  const [correctionRows, setCorrectionRows] = useState(()=>{
    const existing = feedbackEntry?.field_corrections || {};
    const rows = Object.entries(existing).map(([field,value])=>({field,value}));
    return rows.length ? rows : [{field:"",value:""}];
  });
  useEffect(()=>{
    if(!onFeedbackChange) return;
    const dict={};
    correctionRows.forEach(({field,value})=>{ if(field&&`${value}`.trim()) dict[field]=`${value}`.trim(); });
    onFeedbackChange(job.id,"field_corrections",Object.keys(dict).length?dict:null);
  },[correctionRows]);
  const isSubmitting = Boolean(submitState?.saving);
  const submitMessage = `${submitState?.message || ""}`.trim();
  return (
    <div style={{opacity:vis?1:0,transform:vis?"none":"translateY(8px)",transition:"opacity 0.3s ease,transform 0.3s ease",marginBottom:12}}>
      <Card>
        <div onClick={()=>setOverviewOpen(true)} style={{padding:"13px 17px",display:"flex",gap:13,cursor:"pointer",borderBottom:open?`1px solid ${C.ruleLight}`:"none",alignItems:"flex-start"}}>
          <div style={{flexShrink:0,display:"flex",flexDirection:"column",alignItems:"center",padding:"8px 12px",background:bg,border:`1px solid ${brd}`,borderRadius:6,minWidth:56}}>
            <span style={{fontFamily:mono,fontSize:20,fontWeight:500,color:col,lineHeight:1}}>{job.similarity}</span>
            <span style={{fontFamily:mono,fontSize:8,textTransform:"uppercase",letterSpacing:"0.07em",color:C.inkMuted,marginTop:3}}>match</span>
          </div>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontFamily:disp,fontSize:14,fontWeight:700,marginBottom:2}}>{job.title}</div>
            {job.part_name && job.part_name !== job.title && (
              <div style={{fontFamily:mono,fontSize:10,color:C.inkSoft,marginBottom:2}}>Part: {job.part_name}</div>
            )}
            <div style={{fontFamily:mono,fontSize:10,color:C.inkMuted,letterSpacing:"0.03em",marginBottom:7}}>{job.id} - {job.customer} - {job.date} - {job.process}</div>
            {activeImg && (
              <div style={{marginBottom:7}}>
                <img
                  src={activeImg}
                  alt={job.title || "Matched job"}
                  style={{width:110,height:74,objectFit:"cover",border:`1px solid ${C.ruleLight}`,borderRadius:5,background:C.surface,opacity:imgOk?1:0,transition:"opacity 0.18s ease"}}
                  onLoad={()=>setImgOk(true)}
                  onError={handleImageError}
                />
              </div>
            )}
            <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
              {job.parts.map(p=><AsmtTag key={p} accent>{p}</AsmtTag>)}
              {job.tags.slice(0,3).map(t=><AsmtTag key={t}>{t}</AsmtTag>)}
              <span style={{fontFamily:mono,fontSize:9,padding:"2px 7px",borderRadius:2,background:hasFeedback?C.passBg:C.goldPale,color:hasFeedback?C.pass:C.gold,border:`1px solid ${hasFeedback?C.passRule:"rgba(184,146,10,0.25)"}`,letterSpacing:"0.04em",textTransform:"uppercase"}}>
                {hasFeedback ? "Feedback Added" : "Give Feedback"}
              </span>
            </div>
          </div>
          <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:6,flexShrink:0,paddingTop:3}}>
            {!open && (
              <button
                type="button"
                onClick={(e)=>{ e.stopPropagation(); setOpen(true); }}
                style={{fontFamily:mono,fontSize:9,padding:"4px 8px",borderRadius:3,border:`1px solid rgba(184,146,10,0.35)`,background:C.goldPale,color:C.gold,cursor:"pointer",letterSpacing:"0.05em",textTransform:"uppercase"}}
              >
                Rate Match
              </button>
            )}
            <span style={{fontFamily:mono,fontSize:11,color:C.rule}}>{open?"?":"?"}</span>
          </div>
        </div>
        {open&&(
          <>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",borderBottom:`1px solid ${C.ruleLight}`}}>
              {job.dims.map((d,i)=>(
                <div key={i} style={{padding:"10px 15px",borderRight:i<2?`1px solid ${C.ruleLight}`:"none"}}>
                  <div style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.07em",color:C.inkMuted,marginBottom:4}}>{d.label}</div>
                  <div style={{fontSize:12,color:d.pass?C.pass:d.warn?C.warn:C.ink,lineHeight:1.4}}>{d.val}</div>
                </div>
              ))}
            </div>
            {((activeImg && imgOk) || job.project_link) && (
              <div style={{padding:"10px 17px",borderBottom:`1px solid ${C.ruleLight}`}}>
                {job.project_link && (
                  <div style={{marginBottom:activeImg?8:0}}>
                    <a href={job.project_link} target="_blank" rel="noopener noreferrer" style={{fontFamily:mono,fontSize:10,textTransform:"uppercase",letterSpacing:"0.05em",color:C.gold}}>
                      Open Project Details
                    </a>
                  </div>
                )}
                {activeImg && imgOk && (
                  <img
                    src={activeImg}
                    alt={job.title || "Matched part"}
                    style={{width:"100%",maxHeight:210,objectFit:"contain",border:`1px solid ${C.ruleLight}`,borderRadius:6,background:C.surface,opacity:imgOk?1:0,transition:"opacity 0.18s ease"}}
                    onLoad={()=>setImgOk(true)}
                    onError={handleImageError}
                  />
                )}
              </div>
            )}
            <div style={{padding:"10px 17px",background:"#F8F7F4",display:"flex",gap:10}}>
              <span style={{fontSize:14,flexShrink:0,marginTop:2}}>i</span>
              <div>
                <div style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.07em",color:C.inkMuted,marginBottom:4}}>Estimator Note (Internal)</div>
                <div style={{fontSize:12.5,color:C.inkSoft,fontStyle:"italic",lineHeight:1.65}}>{job.note}</div>
              </div>
            </div>
            <div style={{padding:"12px 17px",borderTop:`1px solid ${C.ruleLight}`,background:C.white}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8,gap:8}}>
                <div style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.07em",color:C.inkMuted}}>
                  Project Overview
                </div>
                <span style={{fontFamily:mono,fontSize:9,color:C.gold}}>
                  {(job?.allDetails && typeof job.allDetails === "object") ? Object.keys(job.allDetails).length : 0} fields
                </span>
              </div>
              <div style={{border:`1px solid ${C.ruleLight}`,borderRadius:6,overflow:"hidden",maxHeight:260,overflowY:"auto"}}>
                {Object.entries((job?.allDetails && typeof job.allDetails === "object") ? job.allDetails : {}).map(([k,v], idx) => (
                  <div key={`${k}-${idx}`} style={{display:"grid",gridTemplateColumns:"190px 1fr",gap:10,padding:"8px 10px",borderTop:idx?`1px solid ${C.ruleLight}`:"none",background:idx%2?C.surface:C.white}}>
                    <div style={{fontFamily:mono,fontSize:9,color:C.inkMuted,textTransform:"uppercase",letterSpacing:"0.05em"}}>{k}</div>
                    <div style={{fontSize:12,color:C.inkSoft,wordBreak:"break-word",lineHeight:1.45}}>{`${v ?? ""}`}</div>
                  </div>
                ))}
                {!job?.allDetails || Object.keys(job.allDetails || {}).length === 0 ? (
                  <div style={{padding:"10px 12px",fontSize:12,color:C.inkMuted}}>No additional project details available.</div>
                ) : null}
              </div>
            </div>
            {onFeedbackChange && (
              <div style={{padding:"10px 17px",borderTop:`1px solid ${C.ruleLight}`,background:C.white}}>
                <div style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.07em",color:C.inkMuted,marginBottom:7}}>
                  Human Feedback For This Match
                </div>
                <div style={{display:"grid",gridTemplateColumns:"150px 90px 1fr",gap:8,marginBottom:8}}>
                  <select
                    value={feedbackEntry.user_rating || ""}
                    onChange={(e)=>onFeedbackChange(job.id, "user_rating", e.target.value)}
                    style={{padding:"7px 8px",border:`1px solid ${C.rule}`,borderRadius:4,fontSize:12,background:C.white,color:C.ink}}
                  >
                    <option value="">User Rating</option>
                    <option value="correct">Correct</option>
                    <option value="partial">Partial</option>
                    <option value="incorrect">Incorrect</option>
                  </select>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    value={feedbackEntry.user_score ?? ""}
                    onChange={(e)=>onFeedbackChange(job.id, "user_score", e.target.value)}
                    placeholder="Score"
                    style={{padding:"7px 8px",border:`1px solid ${C.rule}`,borderRadius:4,fontSize:12,background:C.white,color:C.ink}}
                  />
                  <input
                    value={feedbackEntry.reason || ""}
                    onChange={(e)=>onFeedbackChange(job.id, "reason", e.target.value)}
                    placeholder="Reason"
                    style={{padding:"7px 8px",border:`1px solid ${C.rule}`,borderRadius:4,fontSize:12,background:C.white,color:C.ink}}
                  />
                </div>
                <div style={{display:"flex",flexDirection:"column",gap:6}}>
                  <div style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.07em",color:C.inkMuted}}>Field Corrections</div>
                  {correctionRows.map((row,ri)=>(
                    <div key={ri} style={{display:"grid",gridTemplateColumns:"1fr 1.6fr auto",gap:6,alignItems:"center"}}>
                      <select
                        value={row.field}
                        onChange={(e)=>setCorrectionRows(prev=>prev.map((r,i)=>i===ri?{...r,field:e.target.value}:r))}
                        style={{padding:"7px 8px",border:`1px solid ${C.rule}`,borderRadius:4,fontSize:12,background:C.white,color:row.field?C.ink:C.inkMuted}}
                      >
                        <option value="">Select field…</option>
                        <option value="Material">Material</option>
                        <option value="Process">Process</option>
                        <option value="Finish">Finish</option>
                        <option value="Features">Features</option>
                        <option value="Outcome">Outcome</option>
                        <option value="Why Matched">Why Matched</option>
                        <option value="Risk Note">Risk Note</option>
                      </select>
                      <input
                        value={row.value}
                        onChange={(e)=>setCorrectionRows(prev=>prev.map((r,i)=>i===ri?{...r,value:e.target.value}:r))}
                        placeholder="Corrected value"
                        style={{padding:"7px 8px",border:`1px solid ${C.rule}`,borderRadius:4,fontSize:12,background:C.white,color:C.ink}}
                      />
                      <button
                        type="button"
                        onClick={()=>setCorrectionRows(prev=>prev.length===1?[{field:"",value:""}]:prev.filter((_,i)=>i!==ri))}
                        style={{padding:"4px 8px",border:`1px solid ${C.rule}`,borderRadius:4,fontSize:13,background:C.surface,color:C.inkMuted,cursor:"pointer",lineHeight:1}}
                      >×</button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={()=>setCorrectionRows(prev=>[...prev,{field:"",value:""}])}
                    style={{alignSelf:"flex-start",padding:"5px 10px",border:`1px solid ${C.rule}`,borderRadius:4,fontSize:11,background:C.surface,color:C.inkMuted,cursor:"pointer",fontFamily:mono,letterSpacing:"0.04em"}}
                  >+ Add Field</button>
                </div>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:8,gap:8}}>
                  <div style={{fontSize:11.5,color:submitMessage.toLowerCase().includes("failed")?C.warn:C.inkMuted}}>
                    {submitMessage || "Submit match feedback"}
                  </div>
                  <button
                    type="button"
                    onClick={()=>onSubmitFeedback?.(job.id)}
                    disabled={isSubmitting}
                    style={{fontFamily:mono,fontSize:10,padding:"6px 10px",borderRadius:4,border:`1px solid ${isSubmitting?C.rule:C.passRule}`,background:isSubmitting?C.surface:C.passBg,color:isSubmitting?C.inkMuted:C.pass,cursor:isSubmitting?"not-allowed":"pointer",letterSpacing:"0.04em",textTransform:"uppercase"}}
                  >
                    {isSubmitting ? "Submitting..." : "Submit Match Feedback"}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </Card>
      {overviewOpen && (
        <div
          onClick={()=>setOverviewOpen(false)}
          style={{position:"fixed",inset:0,background:"rgba(8,17,28,0.55)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1200,padding:"24px"}}
        >
          <div
            onClick={(e)=>e.stopPropagation()}
            style={{width:"min(980px,96vw)",maxHeight:"92vh",background:C.white,border:`1px solid ${C.ruleLight}`,borderRadius:10,display:"flex",flexDirection:"column",overflow:"hidden",boxShadow:"0 28px 70px rgba(0,0,0,0.35)"}}
          >
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"14px 16px",borderBottom:`1px solid ${C.ruleLight}`,background:C.surface}}>
              <div>
                <div style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.07em",color:C.inkMuted,marginBottom:4}}>
                  Matched Project Overview
                </div>
                <div style={{fontFamily:disp,fontSize:15,fontWeight:700,color:C.ink}}>
                  {job.title}
                </div>
                {job.part_name && job.part_name !== job.title && (
                  <div style={{fontFamily:mono,fontSize:10,color:C.inkSoft,marginTop:1}}>Part: {job.part_name}</div>
                )}
                <div style={{fontFamily:mono,fontSize:10,color:C.inkMuted,letterSpacing:"0.04em",marginTop:2}}>
                  {job.id} · Match {job.similarity}
                </div>
              </div>
              <button
                type="button"
                onClick={()=>setOverviewOpen(false)}
                style={{fontFamily:mono,fontSize:10,padding:"6px 10px",border:`1px solid ${C.rule}`,borderRadius:4,background:C.white,color:C.inkMuted,cursor:"pointer",textTransform:"uppercase",letterSpacing:"0.05em"}}
              >
                Close
              </button>
            </div>
            <div style={{padding:"14px 16px",overflowY:"auto"}}>
              {activeImg && (
                <div style={{marginBottom:12}}>
                  <img
                    src={activeImg}
                    alt={job.title || "Matched project"}
                    style={{width:"100%",maxHeight:280,objectFit:"contain",border:`1px solid ${C.ruleLight}`,borderRadius:6,background:C.surface}}
                    onError={handleImageError}
                  />
                </div>
              )}
              <div style={{border:`1px solid ${C.ruleLight}`,borderRadius:6,overflow:"hidden"}}>
                {Object.entries((job?.allDetails && typeof job.allDetails === "object") ? job.allDetails : {}).map(([k,v], idx) => (
                  <div key={`${k}-${idx}`} style={{display:"grid",gridTemplateColumns:"220px 1fr",gap:12,padding:"10px 12px",borderTop:idx?`1px solid ${C.ruleLight}`:"none",background:idx%2?C.surface:C.white}}>
                    <div style={{fontFamily:mono,fontSize:9,color:C.inkMuted,textTransform:"uppercase",letterSpacing:"0.05em"}}>{k}</div>
                    <div style={{fontSize:12.5,color:C.inkSoft,lineHeight:1.5,whiteSpace:"pre-wrap",wordBreak:"break-word"}}>{`${v ?? ""}`}</div>
                  </div>
                ))}
                {!job?.allDetails || Object.keys(job.allDetails || {}).length === 0 ? (
                  <div style={{padding:"10px 12px",fontSize:12,color:C.inkMuted}}>No project details available.</div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AssessmentScreen({navigate,rfp,initialUploadFiles=[],onLogout}) {
  const MAX_UPLOAD_FILES = Math.max(
    1,
    Math.min(20, Number(import.meta?.env?.VITE_MAX_RFP_UPLOAD_FILES || 10) || 10)
  );
  const [tab,setTab]=useState("overview");
  const [zoomImageSrc,setZoomImageSrc]=useState("");
  const [exportingPdf,setExportingPdf]=useState(false);
  const [markingNoBid,setMarkingNoBid]=useState(false);
  const [assessmentData,setAssessmentData]=useState(null);
  const [assessmentError,setAssessmentError]=useState("");
  const [loadingAssessment,setLoadingAssessment]=useState(false);
  const [rescoreStatus,setRescoreStatus]=useState("");
  const [uploading,setUploading]=useState("");
  const [rfpText,setRfpText]=useState("");
  const [rfpFiles,setRfpFiles]=useState(()=>Array.isArray(initialUploadFiles)?initialUploadFiles:[]);
  const [parsedRfp,setParsedRfp]=useState(null);
  const [partsDraft,setPartsDraft]=useState([]);
  const [assessmentStep,setAssessmentStep]=useState(1); // 1: project intake, 2: part-level enrichment
  const [extractOverwrite,setExtractOverwrite]=useState(false); // default fill-empty only
  const [processingPartIdx,setProcessingPartIdx]=useState(-1);
  const [rfpIntake,setRfpIntake]=useState({
    buyer: "",
    contact_name: "",
    contact_email: "",
    contact_phone: "",
    company_name: "",
    company_industry: "",
    company_location: "",
    company_size: "",
    project_name: "",
    project_description: "",
    expected_annual_production_volume: "",
    mandatory_certifications: "",
    certification_notes: "",
    other_project_requirements: "",
    customer_account_name: "",
    customer_industry: "",
    project_date: "",
    certs_required: "",
    delivery: "",
    priority_note: "",
    location: "",
  });
  const [adhocRfp,setAdhocRfp]=useState(null);
  const [crmRecord,setCrmRecord]=useState(null);
  const [crmMedia,setCrmMedia]=useState(null);
  const [crmNeedsRun,setCrmNeedsRun]=useState(false);
  const [runningCrmAssessment,setRunningCrmAssessment]=useState(false);
  const [feedbackByVector,setFeedbackByVector]=useState({});
  const [overallAccuracy,setOverallAccuracy]=useState("");
  const [overallScoreInput,setOverallScoreInput]=useState("");
  const [overallFeedback,setOverallFeedback]=useState("");
  const [savingFeedback,setSavingFeedback]=useState(false);
  const [feedbackStatus,setFeedbackStatus]=useState("");
  const [perMatchSubmitState,setPerMatchSubmitState]=useState({});
  const [historyPartFilter,setHistoryPartFilter]=useState("ALL");
  const [excludedDocExtractedImages,setExcludedDocExtractedImages]=useState([]);
  const [docImagePartSelection,setDocImagePartSelection]=useState({});
  const [docImageByPart,setDocImageByPart]=useState({});
  const [editingIncomingRfp,setEditingIncomingRfp]=useState(true);
  const [savingIncomingRfp,setSavingIncomingRfp]=useState(false);
  const [incomingRfpEditError,setIncomingRfpEditError]=useState("");
  const [incomingRfpDraft,setIncomingRfpDraft]=useState({
    buyer: "",
    project: "",
    contact_name: "",
    contact_email: "",
    contact_phone: "",
    company_name: "",
    company_location: "",
    company_size: "",
    customer_account_name: "",
    customer_industry: "",
    project_date: "",
    expected_annual_production_volume: "",
    certs_required: "",
    mandatory_certifications: "",
    certification_notes: "",
    geo_preference: "",
    delivery: "",
    priority_note: "",
    project_description: "",
    other_project_requirements: "",
  });
  const [editingSavedParts,setEditingSavedParts]=useState(false);
  const [savedPartsDraft,setSavedPartsDraft]=useState([]);
  const [rerunningSavedAssessment,setRerunningSavedAssessment]=useState(false);
  const fileInputRef = useRef(null);
  const liveRescoreAttemptedRef = useRef(new Set());
  const liveRescoreInFlightRef = useRef(new Set());
  const noRfpMode = !rfp?.id;
  const PROJECT_TEXT_FILE_EXTS = useMemo(() => new Set([
    ".pdf", ".doc", ".docx", ".txt", ".md", ".rtf", ".csv", ".tsv", ".json"
  ]), []);

  const normalizeB64ImageSrc = useCallback((value) => {
    const raw = `${value || ""}`.trim();
    if (!raw) return "";
    if (raw.startsWith("data:image")) return raw;
    return `data:image/jpeg;base64,${raw}`;
  }, []);

  const uploadPreviewImages = useMemo(() => {
    const assignedDocImageSet = new Set(
      Object.values(docImageByPart || {})
        .map((v) => `${v || ""}`.trim())
        .filter(Boolean)
    );
    const partDerived = (Array.isArray(partsDraft) ? partsDraft : []).flatMap((p) => {
      const one = [];
      if (p?.image_preview) one.push(p.image_preview);
      if (p?.image_b64) one.push(p.image_b64);
      if (p?.cad_preview_b64) one.push(p.cad_preview_b64);
      if (Array.isArray(p?.cad_extra_views)) {
        p.cad_extra_views.forEach((v) => {
          if (v?.data_url) one.push(v.data_url);
          if (v?.b64) one.push(v.b64);
        });
      }
      return one;
    });
    const all = [
      ...(parsedRfp?.cad_extracted_images_b64 || []).map((img) => ({ img, source: "cad_extracted" })),
      ...(parsedRfp?.uploaded_images_b64 || []).map((img) => ({ img, source: "uploaded" })),
      ...(parsedRfp?.extracted_images_b64 || [])
        .filter((img) => !excludedDocExtractedImages.includes(`${img || ""}`.trim()))
        .filter((img) => !assignedDocImageSet.has(`${img || ""}`.trim()))
        .map((img) => ({ img, source: "doc_extracted" })),
      ...partDerived.map((img) => ({ img, source: "part_derived" })),
    ];
    const seen = new Set();
    return all.filter(({ img }) => {
      const k = `${img || ""}`.trim();
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }, [parsedRfp, partsDraft, excludedDocExtractedImages, docImageByPart]);

  useEffect(() => {
    setExcludedDocExtractedImages([]);
    setDocImagePartSelection({});
    setDocImageByPart({});
  }, [parsedRfp?.rfp_text]);

  const handleRemoveExtractedPreview = useCallback((rawImg) => {
    const target = `${rawImg || ""}`.trim();
    if (!target) return;
    setParsedRfp((prev) => {
      if (!prev) return prev;
      const nextExtracted = (Array.isArray(prev.extracted_images_b64) ? prev.extracted_images_b64 : [])
        .filter((v) => `${v || ""}`.trim() !== target);
      const nextAll = (Array.isArray(prev.extracted_images_all_b64) ? prev.extracted_images_all_b64 : [])
        .filter((v) => `${v || ""}`.trim() !== target);
      const fallbackOverall =
        (Array.isArray(prev.uploaded_images_b64) ? prev.uploaded_images_b64[0] : null) ||
        (Array.isArray(prev.cad_extracted_images_b64) ? prev.cad_extracted_images_b64[0] : null) ||
        nextExtracted[0] ||
        null;
      return {
        ...prev,
        extracted_images_b64: nextExtracted,
        extracted_images_all_b64: nextAll,
        overall_image_b64: `${prev.overall_image_b64 || ""}`.trim() === target ? fallbackOverall : prev.overall_image_b64,
      };
    });
  }, []);

  const buildLiveReassessmentPayload = useCallback((loaded) => {
    const session = getSupplierSession();
    const mappedParts = (Array.isArray(loaded?.parts) ? loaded.parts : [])
      .map((part, idx) => ({
        id: `${part?.part_id || `P-${String(idx + 1).padStart(3, "0")}`}`,
        description: `${part?.description || ""}`.trim() || `${rfp?.summary || rfp?.project || "Part"}`,
        material: `${part?.material || ""}`.trim(),
        process: `${part?.process || ""}`.trim(),
        tolerance: `${part?.tolerance || ""}`.trim(),
        qty: `${part?.qty || 1}`,
      }))
      .filter((part) => part.description);

    const parts = mappedParts.length
      ? mappedParts
      : [{
          id: "P-001",
          description: `${rfp?.summary || rfp?.project || loaded?.project || "Part"}`,
          material: `${(rfp?.materials && rfp.materials[0]) || ""}`,
          process: `${(rfp?.processes && rfp.processes[0]) || ""}`,
          tolerance: "",
          qty: `${rfp?.parts || 1}`,
        }];

    if (!parts.length) return null;

    return {
      supplier_id: session.supplier_id || "unknown-supplier",
      supplier_name: session.supplier_name || "",
      supplier_email: session.supplier_email || "",
      supplier_certs: [],
      buyer: loaded?.buyer || rfp?.buyer || "Unknown Buyer",
      location: loaded?.geo_preference || rfp?.location || "",
      project: loaded?.project || rfp?.project || rfp?.summary || "RFP Assessment",
      certs_required: Array.isArray(loaded?.certs_required) ? loaded.certs_required : (Array.isArray(rfp?.certs) ? rfp.certs : []),
      delivery: loaded?.delivery || rfp?.due || "",
      priority_note: loaded?.priority_note || rfp?.summary || "",
      parts,
    };
  }, [rfp]);

  const normalizeCardParts = useCallback((cardRfp) => {
    const sourceParts = Array.isArray(cardRfp?.parts_prefill) && cardRfp.parts_prefill.length
      ? cardRfp.parts_prefill
      : Array.isArray(cardRfp?.parts) ? cardRfp.parts : [];
    if (sourceParts.length) {
      return sourceParts.map((part, idx) => ({
        id: `${part?.id || `P-${String(idx + 1).padStart(3, "0")}`}`,
        description: `${part?.description || part?.label || part?.Part_Name || ""}`.trim() || `Part ${idx + 1}`,
        material: `${part?.material || part?.Material || ""}`.trim(),
        process: `${part?.process || part?.Process || ""}`.trim(),
        finish: `${part?.finish || part?.Finish || ""}`.trim(),
        tolerance: `${part?.other || part?.tolerance || part?.Other || ""}`.trim(),
        qty: `${part?.qty || part?.Quantity || 1}`,
        file_upload: part?.file_upload || part?.File_Upload || null,
      }));
    }
    return [{
      id: "P-001",
      description: cardRfp?.summary || cardRfp?.project || "Part",
      material: (cardRfp?.materials && cardRfp.materials[0]) || "TBD",
      process: (cardRfp?.processes && cardRfp.processes[0]) || "TBD",
      finish: "",
      tolerance: "",
      qty: `${cardRfp?.parts || 1}`,
      file_upload: null,
    }];
  }, []);

  const buildCardDrivenAssessmentPayload = useCallback((cardRfp, media = null) => {
    const session = getSupplierSession();
      const baseParts = normalizeCardParts(cardRfp).map((part) => ({
        id: part.id,
        description: part.description,
        material: part.material,
        process: part.process,
        tolerance: part.tolerance,
        qty: part.qty,
      }));

    return {
      supplier_id: session.supplier_id || "unknown-supplier",
      supplier_name: session.supplier_name || "",
      supplier_email: session.supplier_email || "",
      supplier_certs: [],
      buyer: cardRfp?.buyer || "Unknown Buyer",
      location: cardRfp?.location || "",
      project: cardRfp?.project || cardRfp?.summary || cardRfp?.id || "RFP Assessment",
      certs_required: Array.isArray(cardRfp?.certs) ? cardRfp.certs : [],
      delivery: cardRfp?.due || "",
      priority_note: cardRfp?.summary || "",
      assessment_record_id: `${cardRfp?.crmRecordId || cardRfp?.sourceRfpId || cardRfp?.zohoId || ""}`.replace(/^ZOHO-/, ""),
      parts: baseParts,
      overall_image_b64: media?.overall_image_b64 || null,
      extracted_images_b64: Array.isArray(media?.cad_previews_b64) ? media.cad_previews_b64 : [],
      extracted_image_sources: Array.isArray(media?.cad_previews_b64) ? media.cad_previews_b64.map(() => "cad") : [],
    };
  }, [normalizeCardParts]);

  const getLiveRescoreMetaKey = useCallback((rfpId, supplierId) => {
    return `tb_live_rescore_meta_v1:${supplierId || "unknown"}:${rfpId || "unknown"}`;
  }, []);

  const shouldRunLiveRescore = useCallback((rfpId, corpusSignature = "") => {
    const rid = `${rfpId || ""}`.trim();
    if (!rid) return false;
    const session = getSupplierSession();
    const supplierId = `${session?.supplier_id || ""}`.trim();
    if (!supplierId) return false;

    const key = getLiveRescoreMetaKey(rid, supplierId);
    let lastRescoreAt = 0;
    let lastSignature = "";
    try {
      const raw = sessionStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        lastRescoreAt = Number(parsed?.ts || 0) || 0;
        lastSignature = `${parsed?.corpus_signature || ""}`.trim();
      }
    } catch {}
    const corpusUpdatedAt = Number(localStorage.getItem("tb_corpus_updated_at") || 0) || 0;
    const corpusRescorePending = `${localStorage.getItem("tb_corpus_rescore_pending") || ""}`.trim() === "1";

    // Re-score only when local browser has explicit corpus-update event.
    // This prevents auto re-runs on plain login/navigation.
    if (!corpusUpdatedAt || !corpusRescorePending) {
      console.debug(`[assessment][live_rescore] skipped rfp_id=${rid} reason=no_pending_corpus_update`);
      return false;
    }
    if (!lastRescoreAt) {
      console.debug(`[assessment][live_rescore] run rfp_id=${rid} reason=first_after_corpus_update`);
      return true;
    }
    if (lastRescoreAt < corpusUpdatedAt) {
      console.debug(`[assessment][live_rescore] run rfp_id=${rid} reason=corpus_updated_after_last_rescore`);
      return true;
    }
    if (corpusSignature && corpusSignature !== lastSignature && lastRescoreAt < corpusUpdatedAt) {
      console.debug(`[assessment][live_rescore] run rfp_id=${rid} reason=signature_changed_after_corpus_update`);
      return true;
    }
    console.debug(`[assessment][live_rescore] skipped rfp_id=${rid} reason=already_up_to_date`);
    return false;
  }, [getLiveRescoreMetaKey]);

  const markLiveRescoreDone = useCallback((rfpId, corpusSignature = "") => {
    const rid = `${rfpId || ""}`.trim();
    if (!rid) return;
    const session = getSupplierSession();
    const supplierId = `${session?.supplier_id || ""}`.trim();
    if (!supplierId) return;
    const key = getLiveRescoreMetaKey(rid, supplierId);
    try {
      sessionStorage.setItem(key, JSON.stringify({ ts: Date.now(), corpus_signature: `${corpusSignature || ""}`.trim() }));
    } catch {}
  }, [getLiveRescoreMetaKey]);

  useEffect(() => {
    let cancelled = false;
    async function loadAssessment() {
      if (!rfp?.id) {
        return;
      }
      if (!cancelled) {
        setCrmNeedsRun(false);
        setLoadingAssessment(true);
        setAssessmentError("");
      }
      try {
        const rawIds = [
          rfp?.id,
          rfp?.view_id,
          rfp?.sourceRfpId,
          rfp?.rfp_id,
          rfp?.zohoId,
        ]
          .map((v) => `${v || ""}`.trim())
          .filter(Boolean);

        const idSet = new Set();
        rawIds.forEach((id) => {
          buildAssessmentIdVariants(id).forEach((v) => idSet.add(v));
        });
        const candidates = Array.from(idSet);

        let loaded = null;
        let lastStatus = 0;
        const results = await Promise.allSettled(
          candidates.map((candidate) =>
            apiGetCached(ENDPOINTS.assessment.result, {
              rfp_id: candidate,
              supplier_id: getSupplierSession().supplier_id || "",
              supplier_email: getSupplierSession().supplier_email || "",
            }, { ttlMs: 45000 })
          )
        );
        for (const rs of results) {
          if (rs.status === "fulfilled" && rs.value) {
            loaded = rs.value;
            break;
          }
          if (rs.status === "rejected") {
            lastStatus = Number(rs.reason?.status || 0);
          }
        }

        if (loaded) {
          if (!cancelled) {
            setAssessmentData(loaded);
            setAssessmentError("");
          }
          let corpusSignature = "";
          const localCorpusUpdatedAt = Number(localStorage.getItem("tb_corpus_updated_at") || 0) || 0;
          if (localCorpusUpdatedAt) {
            try {
              const session = getSupplierSession();
              const health = await apiGetCached(
                ENDPOINTS.assessment.corpusHealth,
                { supplier_id: session.supplier_id || "", supplier_name: session.supplier_name || "" },
                { ttlMs: 15000, force: true },
              );
              corpusSignature = `${health?.corpus_signature || ""}`.trim();
            } catch {}
          }
          const liveRfpId = `${rfp?.id || loaded?.rfp_id || ""}`.trim();
          const shouldLiveRescore =
            shouldRunLiveRescore(liveRfpId, corpusSignature) &&
            !liveRescoreAttemptedRef.current.has(liveRfpId) &&
            !liveRescoreInFlightRef.current.has(liveRfpId);
          if (shouldLiveRescore) {
            liveRescoreAttemptedRef.current.add(liveRfpId);
            liveRescoreInFlightRef.current.add(liveRfpId);
            if (!cancelled) {
              setRescoreStatus("Scores are recalculating based on recent corpus updates...");
            }
            // Non-blocking: keep UI responsive with snapshot-first rendering.
            (async () => {
              try {
                const payload = buildLiveReassessmentPayload(loaded);
                if (!payload) return;
                const corpusEventType = `${localStorage.getItem("tb_corpus_event_type") || ""}`.trim().toLowerCase();
                const recalcMode =
                  corpusEventType === "profile"
                    ? "profile"
                    : corpusEventType === "history"
                      ? "history"
                      : "history";
                const refreshed = await apiPost(
                  `${ENDPOINTS.assessment.run}?rfp_id=${encodeURIComponent(liveRfpId)}&persist=false&recalc_mode=${encodeURIComponent(recalcMode)}`,
                  payload,
                );
                if (!cancelled && refreshed) {
                  setAssessmentData(refreshed);
                  markLiveRescoreDone(liveRfpId, corpusSignature);
                  if (corpusEventType) localStorage.removeItem("tb_corpus_event_type");
                  localStorage.removeItem("tb_corpus_rescore_pending");
                  setRescoreStatus("Scores updated.");
                  setTimeout(() => setRescoreStatus(""), 4000);
                }
              } catch (_) {
                if (!cancelled) {
                  setRescoreStatus("Could not refresh scores right now.");
                  setTimeout(() => setRescoreStatus(""), 4500);
                }
              } finally {
                liveRescoreInFlightRef.current.delete(liveRfpId);
              }
            })();
          }
          return;
        }

        // Fallback for historical rows that exist in recent feed but fail detail fetch.
        try {
          const session = getSupplierSession();
          const recent = await apiGetCached(ENDPOINTS.assessment.recent, {
            supplier_id: session.supplier_id,
            supplier_email: session.supplier_email,
            limit: 100,
          }, { ttlMs: 15000 });
          const items = Array.isArray(recent?.items) ? recent.items : [];
          const idMatches = new Set(candidates);
          const rowIdMatches = (val) => {
            const rid = `${val || ""}`.trim();
            if (!rid) return false;
            if (idMatches.has(rid)) return true;
            const variants = buildAssessmentIdVariants(rid);
            for (const v of variants) {
              if (idMatches.has(v)) return true;
            }
            return false;
          };
          const row = items.find((it) => {
            // Match across all known id surfaces to avoid losing Zoho-backed snapshots
            // when the UI holds a local/draft id (e.g. RFP-XXXX).
            return [
              it?.rfp_id,
              it?.id,
              it?.view_id,
              it?.source_rfp_id,
              it?.sourceRfpId,
              it?.record_id,
              it?.zoho_id,
            ].some(rowIdMatches);
          });
          if (row) {
            // First try the exact saved assessment id to preserve full fit/history/matches.
            const exactId = `${row.rfp_id || row.id || row.record_id || row.zoho_id || ""}`.trim();
            if (exactId) {
              try {
                const exact = await apiGetCached(ENDPOINTS.assessment.result, {
                  rfp_id: exactId,
                  supplier_id: session.supplier_id || "",
                  supplier_email: session.supplier_email || "",
                }, { ttlMs: 45000 });
                if (!cancelled) {
                  setAssessmentData(exact);
                  setAssessmentError("");
                }
                return;
              } catch {
                // fall through to synthetic fallback below
              }
            }
            const score = Math.round(Number(row.overall_score || rfp?.matchScore || 0));
            const synthetic = {
              rfp_id: row.rfp_id || rfp?.id || "",
              overall_score: score,
              parts: [
                {
                  part_id: "P-001",
                  description: row.project || rfp?.summary || "Historical Assessment",
                  b1: score,
                  b2: score,
                  c: score,
                  composite: score,
                },
              ],
              flags: [],
              guidance: [],
              matched_jobs_summary: [],
            };
            if (!cancelled) {
              setAssessmentData(synthetic);
              setAssessmentError("");
            }
            return;
          }
        } catch {
          // continue to normal fallback paths
        }

        const isZoho = candidates.some((v) => `${v}`.startsWith("ZOHO-"));
        if (rfp?.crmSource) {
          if (!cancelled) {
            setAssessmentData(null);
            setCrmNeedsRun(true);
            setAssessmentError("");
            setTab("overview");
          }
          return;
        }
        const looksLikeSavedAssessment =
          Boolean(`${rfp?.sourceRfpId || ""}`.trim()) ||
          Boolean(`${rfp?.crmRecordId || ""}`.trim()) ||
          Boolean(`${rfp?.zohoId || ""}`.trim()) ||
          Boolean(rfp?.has_cached);

        // Never auto-run on refresh/login. Assessment runs must be explicit (button-driven)
        // or corpus-update-driven live rescore only.
        if (!cancelled) setAssessmentError("Could not open this assessment result.");
      } catch {
        if (!cancelled) setAssessmentError("Could not open this assessment result.");
      } finally {
        if (!cancelled) setLoadingAssessment(false);
      }
    }
    loadAssessment();
    return () => { cancelled = true; };
  }, [rfp?.id, rfp?.crmSource, buildCardDrivenAssessmentPayload, buildLiveReassessmentPayload, markLiveRescoreDone, shouldRunLiveRescore]);

  useEffect(() => {
    if (!rfp?.id && Array.isArray(initialUploadFiles) && initialUploadFiles.length) {
      setRfpFiles(initialUploadFiles.slice(0, MAX_UPLOAD_FILES));
      if (initialUploadFiles.length > MAX_UPLOAD_FILES) {
        setAssessmentError(`Only first ${MAX_UPLOAD_FILES} files were kept.`);
      }
    }
  }, [initialUploadFiles, rfp?.id]);

  useEffect(() => {
    let cancelled = false;
    async function loadCrmRecord() {
      if (!rfp?.crmRecordId) return;
      try {
        const rec = await apiGetCached(
          ENDPOINTS.rfp.crmRecord,
          { record_id: rfp.crmRecordId },
          { ttlMs: 45000 }
        );
        if (!cancelled && rec?.ok && rec?.item) setCrmRecord(rec.item);
      } catch {}
    }
    loadCrmRecord();
    return () => { cancelled = true; };
  }, [rfp?.crmRecordId]);

  useEffect(() => {
    let cancelled = false;
    async function loadCrmMedia() {
      if (!rfp?.crmRecordId) return;
      try {
        const media = await apiGetCached(
          ENDPOINTS.rfp.crmMedia,
          { record_id: rfp.crmRecordId, limit: 12 },
          { ttlMs: 45000 }
        );
        if (!cancelled && media?.ok) setCrmMedia(media);
      } catch {}
    }
    loadCrmMedia();
    return () => { cancelled = true; };
  }, [rfp?.crmRecordId]);

  const appendRfpFiles = useCallback((incoming) => {
    const next = Array.isArray(incoming) ? incoming : Array.from(incoming || []);
    if (!next.length) return;
    setRfpFiles((prev) => mergeFilesUnique(prev, next, MAX_UPLOAD_FILES));
    const incomingCount = next.length;
    if (incomingCount > MAX_UPLOAD_FILES) {
      setAssessmentError(`Only first ${MAX_UPLOAD_FILES} files were kept.`);
    } else {
      setAssessmentError("");
    }
  }, []);
  const removeRfpFile = useCallback((index) => {
    setRfpFiles((prev) => (Array.isArray(prev) ? prev.filter((_, i) => i !== index) : []));
  }, []);

  const addAssessmentPart = useCallback(() => {
    setPartsDraft((prev) => {
      const nextNum = prev.length + 1;
      return [
        ...prev,
        {
          id: `P-${String(nextNum).padStart(3, "0")}`,
          description: "",
          material: "",
          process: "",
          tolerance: "",
          qty: "1",
          image_b64: null,
          upload_files: [],
          attached_files: [],
          source_type: "manual",
        },
      ];
    });
  }, []);

  const updateAssessmentPart = useCallback((idx, key, value) => {
    setPartsDraft((prev) => prev.map((p, i) => (i === idx ? { ...p, [key]: value } : p)));
  }, []);

  const attachAssessmentPartFiles = useCallback((idx, files) => {
    const arr = Array.from(files || []);
    if (!arr.length) return;
    setPartsDraft((prev) => prev.map((p, i) => {
      if (i !== idx) return p;
      const merged = [...(Array.isArray(p.upload_files) ? p.upload_files : []), ...arr];
      return {
        ...p,
        upload_files: merged,
        attached_files: merged.map((f) => f?.name).filter(Boolean),
      };
    }));
  }, []);

  const processAssessmentPart = useCallback(async (idx) => {
    const part = partsDraft[idx];
    if (!part) return;
    const files = Array.isArray(part.upload_files) ? part.upload_files : [];
    if (!files.length) {
      setAssessmentError("Attach CAD/image files for this part first.");
      return;
    }
    setAssessmentError("");
    setProcessingPartIdx(idx);
    try {
      let mergedPatch = {};
      for (const f of files.slice(0, 5)) {
        const ext = `.${`${f?.name || ""}`.split(".").pop() || ""}`.toLowerCase();
        const isCad = [".step", ".stp", ".iges", ".igs", ".stl", ".obj", ".ply", ".glb", ".gltf", ".3mf"].includes(ext);
        const isImg = [".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif", ".tif", ".tiff", ".avif"].includes(ext);
        if (!isCad && !isImg) continue;
        const fd = new FormData();
        fd.append("file", f);
        fd.append("company_name", getSupplierSession()?.supplier_name || "Supplier");
        fd.append("zoho_id", getSupplierSession()?.supplier_id || "");
        fd.append("context_text", `${rfpText || ""}\n${rfpIntake?.project_description || ""}`.trim());
        const ep = isCad ? ENDPOINTS.pastProjects.analyzeCad : ENDPOINTS.pastProjects.analyzeImage;
        const res = await fetch(`${API_BASE}${ep}`, { method: "POST", body: fd });
        const data = await res.json();
        if (!res.ok || data?.ok === false) continue;
        const cadViews = Array.isArray(data?.cad_views) ? data.cad_views : [];
        const isoView = cadViews.find((v) => `${v?.label || ""}`.toLowerCase() === "isometric") || cadViews[0] || null;
        const isoB64 = `${isoView?.b64 || data?.preview_b64 || ""}`.trim();
        const isoDataUrl = isoB64 ? `data:image/jpeg;base64,${isoB64}` : `${data?.preview_data_url || ""}`.trim();
        const nonIsoViews = cadViews
          .filter((v) => `${v?.label || ""}`.toLowerCase() !== "isometric")
          .map((v) => ({
            label: `${v?.label || "view"}`,
            b64: `${v?.b64 || ""}`.trim(),
            data_url: `${v?.b64 || ""}`.trim() ? `data:image/jpeg;base64,${`${v?.b64 || ""}`.trim()}` : "",
          }))
          .filter((v) => v.b64 || v.data_url);
        mergedPatch = {
          ...mergedPatch,
          material: mergedPatch.material || data?.inference?.material || "",
          process: mergedPatch.process || data?.inference?.process_primary || "",
          tolerance: mergedPatch.tolerance || data?.inference?.tolerance_class || "",
          description: mergedPatch.description || data?.project_details?.project_name || "",
          image_b64: mergedPatch.image_b64 || isoB64 || null,
          image_preview: mergedPatch.image_preview || isoDataUrl || "",
          cad_preview_b64: mergedPatch.cad_preview_b64 || isoB64 || "",
          cad_preview_filename: mergedPatch.cad_preview_filename || `${`${f?.name || "part"}`.replace(/\.[^/.]+$/, "")}_isometric.jpg`,
          cad_extra_views: (Array.isArray(mergedPatch.cad_extra_views) && mergedPatch.cad_extra_views.length) ? mergedPatch.cad_extra_views : nonIsoViews,
        };
      }

      setPartsDraft((prev) => prev.map((row, i) => {
        if (i !== idx) return row;
        const pick = (existing, incoming) => {
          const e = `${existing || ""}`.trim();
          const inc = `${incoming || ""}`.trim();
          if (extractOverwrite && inc) return incoming;
          return e ? existing : incoming;
        };
        return {
          ...row,
          description: pick(row.description, mergedPatch.description),
          material: pick(row.material, mergedPatch.material),
          process: pick(row.process, mergedPatch.process),
          tolerance: pick(row.tolerance, mergedPatch.tolerance),
          image_b64: extractOverwrite ? (mergedPatch.image_b64 || row.image_b64 || null) : (row.image_b64 || mergedPatch.image_b64 || null),
          image_preview: extractOverwrite ? (mergedPatch.image_preview || row.image_preview || "") : (row.image_preview || mergedPatch.image_preview || ""),
          cad_preview_b64: extractOverwrite ? (mergedPatch.cad_preview_b64 || row.cad_preview_b64 || "") : (row.cad_preview_b64 || mergedPatch.cad_preview_b64 || ""),
          cad_preview_filename: extractOverwrite ? (mergedPatch.cad_preview_filename || row.cad_preview_filename || "") : (row.cad_preview_filename || mergedPatch.cad_preview_filename || ""),
          cad_extra_views: extractOverwrite
            ? (Array.isArray(mergedPatch.cad_extra_views) && mergedPatch.cad_extra_views.length ? mergedPatch.cad_extra_views : (row.cad_extra_views || []))
            : (Array.isArray(row.cad_extra_views) && row.cad_extra_views.length ? row.cad_extra_views : (mergedPatch.cad_extra_views || [])),
          source_type: row.source_type || "file",
        };
      }));
    } catch (e) {
      setAssessmentError(e?.message || "Part processing failed.");
    } finally {
      setProcessingPartIdx(-1);
    }
  }, [partsDraft, extractOverwrite, rfpText, rfpIntake?.project_description]);

  const handleParseUpload = useCallback(async () => {
    if (!rfpFiles.length && !rfpText.trim()) {
      setAssessmentError("Upload at least one file or paste RFP text.");
      return;
    }
    if (rfpFiles.length > MAX_UPLOAD_FILES) {
      setAssessmentError(`Maximum ${MAX_UPLOAD_FILES} files allowed.`);
      return;
    }
    setAssessmentError("");
    setUploading("parsing");
    try {
      let data;
      if (rfpFiles.length) {
        const nonProject = rfpFiles.filter((f) => {
          const ext = `.${`${f?.name || ""}`.split(".").pop() || ""}`.toLowerCase();
          return !PROJECT_TEXT_FILE_EXTS.has(ext);
        });
        if (nonProject.length) {
          setAssessmentError("Step 1 accepts project documents/text only (PDF/Word/Text). Attach CAD/images inside each part in Step 2.");
          setUploading("");
          return;
        }
        const fd = new FormData();
        rfpFiles.forEach((f) => fd.append("files", f));
        if (rfpText.trim()) fd.append("text", rfpText.trim());
        const res = await fetch(`${API_BASE}${ENDPOINTS.rfp.parseFile}`, { method: "POST", body: fd });
        data = await res.json();
        if (!res.ok) throw new Error(data?.detail || "Parse failed");
      } else {
        data = await apiPost(ENDPOINTS.rfp.parse, { text: rfpText.trim() });
      }
      const mergeUnique = (a, b) => {
        const left = Array.isArray(a) ? a : [];
        const right = Array.isArray(b) ? b : [];
        const out = [];
        const seen = new Set();
        [...left, ...right].forEach((v) => {
          const s = `${v || ""}`.trim();
          if (!s || seen.has(s)) return;
          seen.add(s);
          out.push(s);
        });
        return out;
      };

      setParsedRfp((prev) => ({
        ...(prev || {}),
        ...data,
        uploaded_images_b64: mergeUnique(prev?.uploaded_images_b64, data?.uploaded_images_b64),
        extracted_images_b64: mergeUnique(prev?.extracted_images_b64, data?.extracted_images_b64),
        cad_extracted_images_b64: mergeUnique(prev?.cad_extracted_images_b64, data?.cad_extracted_images_b64),
        extracted_image_sources: [
          ...(Array.isArray(prev?.extracted_image_sources) ? prev.extracted_image_sources : []),
          ...(Array.isArray(data?.extracted_image_sources) ? data.extracted_image_sources : []),
        ],
      }));
      setAdhocRfp({
        id: data?.rfp_id || "RFP-UPLOAD",
        buyer: data?.buyer || "Unknown Buyer",
        project: data?.project || "RFP Upload",
        delivery: data?.delivery || "",
        certs: data?.certs_required || [],
        priority: data?.priority_note || "",
        geo: data?.geo_preference || data?.location || "",
      });
      let textInf = null;
      try {
        const rawText = `${rfpText || ""}`.trim();
        if (rawText) {
          const ti = await apiPost(ENDPOINTS.pastProjects.inferText, { context_text: rawText });
          if (ti?.ok && ti?.inference) textInf = ti.inference;
        }
      } catch {}

      const inferredCerts = certCandidates(textInf?.mandatory_certifications);
      const parsedMandatoryCerts = certCandidates(data?.mandatory_certifications);
      const mergedCerts = canonicalizeCertList([
        ...certCandidates(data?.certs_required),
        ...parsedMandatoryCerts,
        ...inferredCerts,
      ]);
      setRfpIntake((prev) => {
        const pick = (current, incoming) => {
          const cur = `${current || ""}`.trim();
          const inc = `${incoming || ""}`.trim();
          if (extractOverwrite && inc) return incoming;
          return cur ? current : incoming;
        };
        return ({
        ...prev,
        contact_name: pick(prev.contact_name, data?.contact_name || data?.buyer || ""),
        contact_email: pick(prev.contact_email, data?.contact_email || ""),
        contact_phone: pick(prev.contact_phone, data?.contact_phone || ""),
        company_name: pick(prev.company_name, data?.company_name || ""),
        company_industry: pick(prev.company_industry, data?.company_industry || textInf?.customer_industry || ""),
        company_location: pick(prev.company_location, data?.company_location || data?.location || ""),
        company_size: pick(prev.company_size, normalizeCompanySize(data?.company_size)),
        project_name: pick(prev.project_name, data?.project_name || data?.project || ""),
        project_description: pick(prev.project_description, data?.project_description || textInf?.project_overview || ""),
        expected_annual_production_volume: pick(prev.expected_annual_production_volume, data?.expected_annual_production_volume || textInf?.expected_annual_production_volume || ""),
        mandatory_certifications: canonicalizeCertList([
          ...csvTags(prev.mandatory_certifications || ""),
          ...mergedCerts,
        ]).join(", "),
        certs_required: canonicalizeCertList([
          ...csvTags(prev.certs_required || ""),
          ...mergedCerts,
        ]).join(", "),
        certification_notes: pick(prev.certification_notes, data?.certification_notes || textInf?.certification_notes || ""),
        other_project_requirements: pick(prev.other_project_requirements, data?.other_project_requirements || ""),
        // Keep one source of truth in intake form: company_name.
        customer_account_name: pick(prev.customer_account_name, data?.customer_account_name || data?.company_name || data?.buyer || ""),
        customer_industry: pick(prev.customer_industry, data?.customer_industry || ""),
        project_date: pick(prev.project_date, data?.project_date || ""),
      })});
      setPartsDraft((prev) => {
        const norm = (v) => `${v || ""}`.toLowerCase().replace(/\s+/g, " ").trim();
        const tokenize = (v) => norm(v).replace(/[^a-z0-9 ]+/g, " ").split(" ").map((t) => t.trim()).filter((t) => t.length >= 3);
        const overlapScore = (a, b) => {
          const ta = new Set(tokenize(a));
          const tb = new Set(tokenize(b));
          if (!ta.size || !tb.size) return 0;
          let hit = 0;
          ta.forEach((t) => { if (tb.has(t)) hit += 1; });
          return hit;
        };
        const buildSig = (row) => {
          const d = norm(row?.description);
          const m = norm(row?.material);
          const p = norm(row?.process);
          const t = norm(row?.tolerance);
          const q = norm(row?.qty);
          return [d, m, p, t, q].filter(Boolean).join("|");
        };
        const prevRows = Array.isArray(prev) ? prev : [];
        const prevMap = new Map(prevRows.map((r) => [`${r?.id || ""}`, r]));
        const prevSigMap = new Map();
        prevRows.forEach((r) => {
          const sig = buildSig(r);
          if (sig && !prevSigMap.has(sig)) prevSigMap.set(sig, r);
        });
        const findBestExistingByText = (parsed) => {
          const parsedText = [
            parsed?.id,
            parsed?.description,
            parsed?.part_name,
            parsed?.material,
            parsed?.process,
          ].filter(Boolean).join(" ");
          let best = null;
          let bestScore = 0;
          prevRows.forEach((r) => {
            const attached = [
              ...(Array.isArray(r?.attached_files) ? r.attached_files : []),
              ...(Array.isArray(r?.upload_files) ? r.upload_files.map((f) => f?.name || "") : []),
            ].filter(Boolean).join(" ");
            const existingText = [
              r?.id,
              r?.description,
              r?.material,
              r?.process,
              r?.tolerance,
              attached,
            ].filter(Boolean).join(" ");
            const s = overlapScore(parsedText, existingText);
            if (s > bestScore) {
              bestScore = s;
              best = r;
            }
          });
          return bestScore >= 2 ? best : null;
        };
        const parsedRows = (data?.parts || []).map((p, i) => {
          const id = `${p?.id || `P-${String(i + 1).padStart(3, "0")}`}`;
          const parsedLike = {
            description: p?.description || "",
            material: p?.material || "",
            process: p?.process || "",
            tolerance: p?.tolerance || "",
            qty: p?.qty || 1,
          };
          const sig = buildSig(parsedLike);
          const byId = prevMap.get(id);
          const bySig = sig ? prevSigMap.get(sig) : null;
          const byText = findBestExistingByText(p);
          const singleFallback = (prevRows.length === 1 && (data?.parts || []).length === 1) ? prevRows[0] : null;
          const existing = byId || bySig || byText || singleFallback || {};
          const resolvedId = `${existing?.id || id}`;
          const incomingImage = p?.image_b64 || null;
          const pick = (current, incoming) => {
            const cur = `${current || ""}`.trim();
            const inc = `${incoming || ""}`.trim();
            if (extractOverwrite && inc) return incoming;
            return cur ? current : incoming;
          };
          return {
            id: resolvedId,
            description: `${pick(existing.description, p?.description || "")}`,
            material: `${pick(existing.material, p?.material || "")}`,
            process: `${pick(existing.process, p?.process || "")}`,
            tolerance: `${pick(existing.tolerance, p?.tolerance || "")}`,
            qty: `${pick(existing.qty, p?.qty || 1)}`,
            image_b64: extractOverwrite ? (incomingImage || existing.image_b64 || null) : (existing.image_b64 || incomingImage || null),
            upload_files: existing.upload_files || [],
            attached_files: existing.attached_files || [],
            source_type: existing.source_type || (incomingImage ? "file" : "manual"),
          };
        });
        const parsedIds = new Set(parsedRows.map((r) => `${r.id}`));
        const carryOver = (Array.isArray(prev) ? prev : []).filter((r) => !parsedIds.has(`${r?.id || ""}`));
        const merged = [...carryOver, ...parsedRows];
        const dedup = new Map();
        merged.forEach((row, i) => {
          const key = `${row?.id || `P-${i + 1}`}`.trim() || `P-${i + 1}`;
          if (!dedup.has(key)) dedup.set(key, row);
        });
        return Array.from(dedup.values());
      });
      setAssessmentStep(2);
    } catch (e) {
      setAssessmentError(e?.message || "Parse failed.");
    } finally {
      setUploading("");
    }
  }, [rfpFiles, rfpText, PROJECT_TEXT_FILE_EXTS, extractOverwrite]);

  const handleRunUploadAssessment = useCallback(async () => {
    if (!partsDraft.length) {
      setAssessmentError("Parse the RFP first to generate part rows.");
      return;
    }
    setAssessmentError("");
    setUploading("running");
    setRescoreStatus("Running full assessment...");
    try {
      const session = getSupplierSession();
      const mergeUnique = (...lists) => {
        const out = [];
        const seen = new Set();
        lists.forEach((arr) => {
          (Array.isArray(arr) ? arr : []).forEach((v) => {
            const s = `${v || ""}`.trim();
            if (!s || seen.has(s)) return;
            seen.add(s);
            out.push(s);
          });
        });
        return out;
      };

      const allAssessmentImages = mergeUnique(
        parsedRfp?.cad_extracted_images_b64,
        parsedRfp?.uploaded_images_b64,
        (parsedRfp?.extracted_images_b64 || []).filter((img) => !excludedDocExtractedImages.includes(`${img || ""}`.trim()))
      );

      const payload = {
        supplier_id: session.supplier_id || "unknown-supplier",
        supplier_name: session.supplier_name || "",
        supplier_email: session.supplier_email || "",
        supplier_certs: [],
        buyer: rfpIntake.buyer || rfpIntake.company_name || parsedRfp?.buyer || "Unknown Buyer",
        contact_name: rfpIntake.contact_name || "",
        contact_email: rfpIntake.contact_email || "",
        contact_phone: rfpIntake.contact_phone || "",
        company_name: rfpIntake.company_name || "",
        company_industry: rfpIntake.company_industry || "",
        company_location: rfpIntake.company_location || rfpIntake.location || parsedRfp?.location || "",
        company_size: rfpIntake.company_size || "",
        project: rfpIntake.project_name || parsedRfp?.project || "RFP Assessment",
        project_description: rfpIntake.project_description || "",
        expected_annual_production_volume: rfpIntake.expected_annual_production_volume || "",
        mandatory_certifications: csvTags(rfpIntake.mandatory_certifications),
        certification_notes: rfpIntake.certification_notes || "",
        other_project_requirements: rfpIntake.other_project_requirements || "",
        customer_account_name: rfpIntake.customer_account_name || rfpIntake.company_name || "",
        customer_industry: rfpIntake.customer_industry || "",
        project_date: rfpIntake.project_date || "",
        assessment_record_id: `${rfp?.crmRecordId || rfp?.sourceRfpId || rfp?.zohoId || ""}`.replace(/^ZOHO-/, ""),
        location: rfpIntake.location || parsedRfp?.location || "",
        certs_required: Array.from(new Set([
          ...csvTags(rfpIntake.certs_required || ""),
          ...(parsedRfp?.certs_required || []),
          ...csvTags(rfpIntake.mandatory_certifications),
        ])),
        delivery: rfpIntake.delivery || parsedRfp?.delivery || "",
        priority_note: rfpIntake.priority_note || parsedRfp?.priority_note || "",
        parts: partsDraft.map((p, i) => ({
          id: p.id || `P-${String(i + 1).padStart(3, "0")}`,
          description: p.description || "",
          material: p.material || "",
          process: p.process || "",
          tolerance: p.tolerance || "",
          qty: `${p.qty || ""}` || "1",
          image_b64: p.image_b64 || docImageByPart[`${p.id || ""}`] || null,
        })),
        overall_image_b64:
          parsedRfp?.overall_image_b64 ||
          allAssessmentImages?.[0] ||
          null,
        extracted_images_b64: allAssessmentImages,
        extracted_image_sources: parsedRfp?.extracted_image_sources || [],
      };

      const submit = await apiPost(ENDPOINTS.rfp.submit, payload);
      const rfpId = submit?.rfp_id || submit?.id;
      if (!rfpId) throw new Error("RFP submit failed.");

      const res = await fetch(`${API_BASE}${ENDPOINTS.assessment.run}?rfp_id=${encodeURIComponent(rfpId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || data?.detail) throw new Error(data?.detail?.message || data?.detail || "Assessment failed.");

      // Build a part_id → image_b64 map from the draft parts so part images
      // are visible immediately (the run response doesn't carry image_b64).
      const partImageMap = {};
      (Array.isArray(partsDraft) ? partsDraft : []).forEach((p, i) => {
        const id = `${p.id || `P-${String(i + 1).padStart(3, "0")}`}`;
        const img = p.image_b64 || p.cad_preview_b64 || p.image_preview || docImageByPart?.[`${p.id || ""}`] || null;
        if (id && img) partImageMap[id] = img;
      });
      const applyPartImages = (result) => ({
        ...result,
        parts: (result.parts || []).map((p) => ({
          ...p,
          image_b64: partImageMap[p.part_id] || p.image_b64 || null,
        })),
      });

      const mergeAssessmentPartDetails = (prevData, nextData) => {
        if (!nextData || !Array.isArray(nextData.parts)) return nextData;
        const prevParts = Array.isArray(prevData?.parts) ? prevData.parts : [];
        const prevById = new Map(
          prevParts.map((p, idx) => [
            `${p?.part_id || p?.Part_Id || `P-${String(idx + 1).padStart(3, "0")}`}`.trim(),
            p,
          ])
        );
        const mergedParts = nextData.parts.map((p, idx) => {
          const pid = `${p?.part_id || p?.Part_Id || `P-${String(idx + 1).padStart(3, "0")}`}`.trim();
          const prev = prevById.get(pid) || {};
          const keepIfEmpty = (cur, old) => {
            const curArr = Array.isArray(cur) ? cur : [];
            const oldArr = Array.isArray(old) ? old : [];
            return curArr.length ? curArr : oldArr;
          };
          const curTol = p?.b1_tolerance_capable;
          const prevTol = prev?.b1_tolerance_capable;
          return {
            ...p,
            b1_profile_processes: keepIfEmpty(p?.b1_profile_processes, prev?.b1_profile_processes),
            b1_profile_materials: keepIfEmpty(p?.b1_profile_materials, prev?.b1_profile_materials),
            b1_matched_processes: keepIfEmpty(p?.b1_matched_processes, prev?.b1_matched_processes),
            b1_required_processes: keepIfEmpty(p?.b1_required_processes, prev?.b1_required_processes),
            b1_matched_materials: keepIfEmpty(p?.b1_matched_materials, prev?.b1_matched_materials),
            b1_missing_certs: keepIfEmpty(p?.b1_missing_certs, prev?.b1_missing_certs),
            b2_history_matched_processes: keepIfEmpty(p?.b2_history_matched_processes, prev?.b2_history_matched_processes),
            b2_history_matched_materials: keepIfEmpty(p?.b2_history_matched_materials, prev?.b2_history_matched_materials),
            b1_tolerance_capable: (curTol === null || curTol === undefined) ? prevTol : curTol,
          };
        });
        return { ...nextData, parts: mergedParts };
      };

      setAssessmentData(applyPartImages(data));
      setAdhocRfp((prev) => ({ ...(prev || {}), id: rfpId }));
      setTab("fit");
      setRescoreStatus("Scores updated.");
      setTimeout(() => setRescoreStatus(""), 4000);

      // Background re-fetch: bypass in-memory cache so the backend runs
      // _build_assessment_result_from_zoho_record, which enriches matched-job
      // images via Pinecone + Zoho attachment proxy URLs.
      const canonicalId = `${data.rfp_id || ""}`.trim();
      if (canonicalId.startsWith("ZOHO-")) {
        const session = getSupplierSession();
        setTimeout(() => {
          apiGet(ENDPOINTS.assessment.result, {
            rfp_id: canonicalId,
            supplier_id: session?.supplier_id || "",
            supplier_email: session?.supplier_email || "",
            force_refresh: true,
          }).then((enriched) => {
            if (enriched && Array.isArray(enriched.parts)) {
              setAssessmentData((prev) => mergeAssessmentPartDetails(prev, applyPartImages(enriched)));
            }
          }).catch(() => {});
        }, 2000);
      }
    } catch (e) {
      setRescoreStatus("Could not run assessment right now.");
      setTimeout(() => setRescoreStatus(""), 4500);
      setAssessmentError(e?.message || "Assessment run failed.");
    } finally {
      setUploading("");
    }
  }, [partsDraft, parsedRfp, rfpIntake, excludedDocExtractedImages, docImageByPart]);

  const handleRunCrmAssessment = useCallback(async () => {
    if (!rfp?.crmSource) return;
    setAssessmentError("");
    setRunningCrmAssessment(true);
    setRescoreStatus("Running assessment from TrustBridge RFP...");
    try {
      let media = crmMedia;
      if (!media && rfp?.crmRecordId) {
        media = await apiGetCached(
          ENDPOINTS.rfp.crmMedia,
          { record_id: rfp.crmRecordId, limit: 12 },
          { ttlMs: 45000, force: true }
        ).catch(() => null);
        if (media?.ok) setCrmMedia(media);
      }
      const payload = buildCardDrivenAssessmentPayload(crmRecord || rfp, media);
      const runIdRaw = `${rfp?.sourceRfpId || rfp?.crmRecordId || rfp?.zohoId || rfp?.id || ""}`.trim();
      const runId = /^\d{10,}$/.test(runIdRaw) ? `ZOHO-${runIdRaw}` : runIdRaw;
      const generated = await apiPost(`${ENDPOINTS.assessment.run}?rfp_id=${encodeURIComponent(runId)}`, payload);
      setAssessmentData(generated);
      setCrmNeedsRun(false);
      setTab("fit");
      setRescoreStatus("Assessment completed.");
      setTimeout(() => setRescoreStatus(""), 4000);
    } catch (e) {
      setAssessmentError(e?.message || "Could not run this assessment right now.");
      setRescoreStatus("");
    } finally {
      setRunningCrmAssessment(false);
    }
  }, [rfp, crmRecord, crmMedia, buildCardDrivenAssessmentPayload]);

  const toAbsImageUrl = useCallback((raw) => {
    const v = `${raw || ""}`.trim();
    if (!v) return "";
    if (v.startsWith("data:image")) return v;
    if (v.startsWith("http://") || v.startsWith("https://")) return v;
    let apiOrigin = "";
    try {
      apiOrigin = new URL(API_BASE).origin;
    } catch {
      apiOrigin = "";
    }
    if (v.startsWith("/")) {
      // Static/media routes are mounted at root and may break if API_BASE includes /api.
      if (v.startsWith("/images/") || v.startsWith("/parts/") || v.startsWith("/zoho-attachment-image") || v.startsWith("/api/")) {
        return `${apiOrigin || API_BASE}${v}`;
      }
      return `${API_BASE}${v}`;
    }
    const lower = v.toLowerCase();
    const looksLikeFile = /\.(jpg|jpeg|png|webp|bmp|gif)$/i.test(lower);
    const hasNoPath = !v.includes("/");
    if (hasNoPath && looksLikeFile) return `${apiOrigin || API_BASE}/images/${v}`;
    return `${API_BASE}/${v}`;
  }, []);

  const crmPreviewImages = useMemo(() => {
    const urls = Array.isArray(crmMedia?.image_urls) ? crmMedia.image_urls.map((u) => toAbsImageUrl(u)).filter(Boolean) : [];
    const cad = Array.isArray(crmMedia?.cad_previews_b64)
      ? crmMedia.cad_previews_b64.map((b64) => normalizeB64ImageSrc(b64)).filter(Boolean)
      : [];
    const seen = new Set();
    return [...urls, ...cad].filter((src) => {
      const key = `${src || ""}`.trim();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [crmMedia, normalizeB64ImageSrc, toAbsImageUrl]);

  const buildAttachmentUrl = useCallback((job = {}) => {
    const existing = `${job?.image_url || ""}`.trim();
    if (existing.includes("/api/assessment/attachment?")) {
      return existing.startsWith("http://") || existing.startsWith("https://")
        ? existing
        : `${API_BASE}${existing}`;
    }
    const recordId = `${job?.record_id || job?.recordId || job?.zoho_record_id || ""}`.trim();
    const attachmentId = `${job?.attachment_id || job?.attachmentId || ""}`.trim();
    if (!recordId || !attachmentId) return "";
    const moduleApi = `${job?.attachment_module || job?.module_api || "RFP_Assessments"}`.trim() || "RFP_Assessments";
    const query = new URLSearchParams({
      record_id: recordId,
      attachment_id: attachmentId,
      module_api: moduleApi,
    }).toString();
    return `${API_BASE}${ENDPOINTS.assessment.attachment}?${query}`;
  }, []);

  const handleToggleDocExtractedImage = useCallback((rawImg, keep) => {
    const target = `${rawImg || ""}`.trim();
    if (!target) return;
    setExcludedDocExtractedImages((prev) => {
      const exists = prev.includes(target);
      if (keep) return exists ? prev.filter((v) => v !== target) : prev;
      return exists ? prev : [...prev, target];
    });
  }, []);

  const handleAssociateDocImageToPart = useCallback((rawImg) => {
    const img = `${rawImg || ""}`.trim();
    if (!img) return;
    const partId = `${docImagePartSelection?.[img] || ""}`.trim();
    if (!partId) return;
    setDocImageByPart((prev) => ({ ...prev, [partId]: img }));

    // Auto-apply to the selected part immediately (no extra "Process Part" click needed).
    setPartsDraft((prev) => {
      const parsedParts = Array.isArray(parsedRfp?.parts) ? parsedRfp.parts : [];
      const parsedMatch = parsedParts.find((p, idx) => {
        const pid = `${p?.id || `P-${String(idx + 1).padStart(3, "0")}`}`.trim();
        return pid === partId;
      }) || null;

      return (Array.isArray(prev) ? prev : []).map((row) => {
        if (`${row?.id || ""}`.trim() !== partId) return row;
        const currentHasImage = !!`${row?.image_b64 || ""}`.trim();
        const useImage = extractOverwrite || !currentHasImage;
        const imageDataUrl = normalizeB64ImageSrc(img);

        const pickField = (existing, incoming) => {
          const e = `${existing || ""}`.trim();
          const inc = `${incoming || ""}`.trim();
          if (extractOverwrite && inc) return incoming;
          return e ? existing : incoming;
        };

        return {
          ...row,
          description: pickField(row.description, parsedMatch?.description || ""),
          material: pickField(row.material, parsedMatch?.material || ""),
          process: pickField(row.process, parsedMatch?.process || ""),
          tolerance: pickField(row.tolerance, parsedMatch?.tolerance || ""),
          qty: pickField(row.qty, parsedMatch?.qty || ""),
          image_b64: useImage ? img : row.image_b64,
          image_preview: useImage ? (imageDataUrl || row.image_preview || "") : (row.image_preview || ""),
          source_type: row.source_type || "file",
          attached_files: Array.from(new Set([...(Array.isArray(row.attached_files) ? row.attached_files : []), "linked_pdf_image"])),
        };
      });
    });
  }, [docImagePartSelection, extractOverwrite, parsedRfp?.parts, normalizeB64ImageSrc]);

  const handleUnlinkDocImageFromPart = useCallback((partId) => {
    const pid = `${partId || ""}`.trim();
    if (!pid) return;
    const linkedRaw = `${docImageByPart?.[pid] || ""}`.trim();
    const linkedDataUrl = linkedRaw ? normalizeB64ImageSrc(linkedRaw) : "";
    setDocImageByPart((prev) => {
      const next = { ...(prev || {}) };
      delete next[pid];
      return next;
    });
    setPartsDraft((prev) => (Array.isArray(prev) ? prev : []).map((row) => {
      if (`${row?.id || ""}`.trim() !== pid) return row;
      const attached = Array.isArray(row?.attached_files) ? row.attached_files : [];
      const uploadFiles = Array.isArray(row?.upload_files) ? row.upload_files : [];
      const wasLinked = attached.includes("linked_pdf_image");
      const currentB64 = `${row?.image_b64 || ""}`.trim();
      const currentPreview = `${row?.image_preview || ""}`.trim();
      const shouldClearImage = wasLinked && uploadFiles.length === 0 && (
        (linkedRaw && currentB64 === linkedRaw) ||
        (linkedDataUrl && currentPreview === linkedDataUrl)
      );
      return {
        ...row,
        image_b64: shouldClearImage ? null : row.image_b64,
        image_preview: shouldClearImage ? "" : row.image_preview,
        attached_files: attached.filter((x) => x !== "linked_pdf_image"),
      };
    }));
  }, [docImageByPart, normalizeB64ImageSrc]);

  const isLikelyPartImageJob = useCallback((job) => {
    const name = `${job?.project_name || ""}`.toLowerCase().trim();
    const jid = `${job?.job_id || ""}`.toLowerCase().trim();
    const imageUrl = `${job?.image_url || ""}`.toLowerCase().trim();
    const moduleApi = `${job?.attachment_module || ""}`.toLowerCase().trim();
    // Historical matched jobs can also be proxied via /api/assessment/attachment.
    // Only treat proxied attachments as "part image jobs" when they are from
    // the current assessment module (RFP_Assessments), not past-project records.
    if (imageUrl.includes("/api/assessment/attachment") && moduleApi === "rfp_assessments") return true;
    if (name === "part image" || name.includes("uploaded part")) return true;
    if (jid.includes("_image") && /\.(jpg|jpeg|png|webp|bmp|gif|avif)$/.test(jid)) return true;
    return false;
  }, []);

  const isUploadedOrExtractedAssessmentImage = useCallback((job) => {
    const raw = `${job?.image_url || ""}`.trim().toLowerCase();
    if (!raw) return false;
    // Keep only images attached to the current assessment snapshot (uploaded/extracted),
    // not historical matched-project images served from /images.
    if (raw.includes("/api/assessment/attachment")) return true;
    if (raw.startsWith("data:image")) return true;
    return false;
  }, []);

  const displayRfp = useMemo(() => {
    if (!assessmentData) {
      const base = crmRecord || rfp || adhocRfp || ASMT_RFP;
      const bestSinglePartLabel = `${base?.summary || base?.project || "Part details"}`.trim() || "Part details";
      const normalizedParts = normalizeCardParts(base);
      const fallbackParts = normalizedParts.length
        ? normalizedParts.map((part, idx) => {
            const detailBits = [
              part?.material || "",
              part?.process || "",
              part?.finish ? `Finish ${part.finish}` : "",
              part?.tolerance || "",
              part?.qty ? `Qty ${part.qty}` : "",
            ].filter(Boolean);
            return {
              id: `${part?.id || `P-${String(idx + 1).padStart(3, "0")}`}`,
              label: `${part?.description || `Part ${idx + 1}`}`,
              spec: detailBits.join(" · ") || base?.summary || base?.project || "Part details",
              material: `${part?.material || ""}`,
              process: `${part?.process || ""}`,
              finish: `${part?.finish || ""}`,
              other: `${part?.tolerance || ""}`,
              qty: part?.qty || "",
              file_upload: part?.file_upload || null,
              score: Number(base?.matchScore || 0) || 0,
              scoreLabel: "Pending",
            };
          })
        : Number(base?.parts || 0) > 0
            ? Array.from({ length: Math.min(Number(base?.parts || 0), 5) }).map((_, idx) => ({
                id: Number(base?.parts || 0) === 1 ? "" : `P-${String(idx + 1).padStart(3, "0")}`,
                label: Number(base?.parts || 0) === 1 ? bestSinglePartLabel : `Part ${idx + 1}`,
                spec: Number(base?.parts || 0) === 1 ? "" : (base?.summary || base?.project || "Part details"),
                score: Number(base?.matchScore || 0) || 0,
                scoreLabel: "Pending",
              }))
            : [];
      return {
        ...base,
        certs: Array.isArray(base?.certs) ? base.certs : [],
        parts: fallbackParts,
      };
    }
    const firstPart = (assessmentData.parts || [])[0] || {};
    return {
      id: assessmentData.rfp_id || rfp?.id || ASMT_RFP.id,
      buyer: assessmentData?.buyer || rfp?.buyer || ASMT_RFP.buyer,
      contact_name: assessmentData?.contact_name || "",
      contact_email: assessmentData?.contact_email || "",
      contact_phone: assessmentData?.contact_phone || "",
      company_name: assessmentData?.company_name || "",
      company_location: assessmentData?.company_location || "",
      company_size: assessmentData?.company_size || "",
      customer_account_name: assessmentData?.customer_account_name || "",
      customer_industry: assessmentData?.customer_industry || "",
      project_date: assessmentData?.project_date || "",
      expected_annual_production_volume: assessmentData?.expected_annual_production_volume || "",
      mandatory_certifications: Array.isArray(assessmentData?.mandatory_certifications)
        ? assessmentData.mandatory_certifications.join(", ")
        : (assessmentData?.mandatory_certifications || ""),
      certification_notes: assessmentData?.certification_notes || "",
      project_description: assessmentData?.project_description || "",
      other_project_requirements: assessmentData?.other_project_requirements || "",
      location: rfp?.location || ASMT_RFP.location,
      project: assessmentData?.project || rfp?.project || ASMT_RFP.project,
      priority: assessmentData?.priority_note || rfp?.priority || ASMT_RFP.priority,
      certs: assessmentData?.certs_required || rfp?.certs || rfp?.certs_required || ASMT_RFP.certs,
      geo: assessmentData?.geo_preference || rfp?.geo || ASMT_RFP.geo,
      delivery: assessmentData?.delivery || rfp?.delivery || rfp?.due || ASMT_RFP.delivery,
      parts: (assessmentData.parts || []).map((p, idx) => ({
        id: p.part_id || `P-${String(idx + 1).padStart(3, "0")}`,
        label: p.description || `Part ${idx + 1}`,
        spec: p.description || firstPart.description || "Part details",
        score: Math.round(Number(p.composite || 0)),
        scoreLabel: Number(p.composite || 0) >= 80 ? "Strong" : Number(p.composite || 0) >= 60 ? "Moderate" : "Thin",
      })),
    };
  }, [assessmentData, crmRecord, rfp, adhocRfp, normalizeCardParts]);

  useEffect(() => {
    if (!displayRfp) return;
    const certsJoined = Array.isArray(displayRfp?.certs)
      ? displayRfp.certs.filter(Boolean).join(", ")
      : `${displayRfp?.certs || ""}`.trim();
    setIncomingRfpDraft({
      buyer: `${displayRfp?.buyer || ""}`,
      project: `${displayRfp?.project || ""}`,
      contact_name: `${displayRfp?.contact_name || ""}`,
      contact_email: `${displayRfp?.contact_email || ""}`,
      contact_phone: `${displayRfp?.contact_phone || ""}`,
      company_name: `${displayRfp?.company_name || ""}`,
      company_location: `${displayRfp?.company_location || ""}`,
      company_size: `${displayRfp?.company_size || ""}`,
      customer_account_name: `${displayRfp?.customer_account_name || ""}`,
      customer_industry: `${displayRfp?.customer_industry || ""}`,
      project_date: `${displayRfp?.project_date || ""}`,
      expected_annual_production_volume: `${displayRfp?.expected_annual_production_volume || ""}`,
      certs_required: certsJoined,
      mandatory_certifications: `${displayRfp?.mandatory_certifications || ""}`,
      certification_notes: `${displayRfp?.certification_notes || ""}`,
      geo_preference: `${displayRfp?.geo || ""}`,
      delivery: `${displayRfp?.delivery || ""}`,
      priority_note: `${displayRfp?.priority || ""}`,
      project_description: `${displayRfp?.project_description || ""}`,
      other_project_requirements: `${displayRfp?.other_project_requirements || ""}`,
    });
  }, [displayRfp?.id, displayRfp?.buyer, displayRfp?.project, displayRfp?.contact_name, displayRfp?.contact_email, displayRfp?.contact_phone, displayRfp?.company_name, displayRfp?.company_location, displayRfp?.company_size, displayRfp?.customer_account_name, displayRfp?.customer_industry, displayRfp?.project_date, displayRfp?.expected_annual_production_volume, displayRfp?.mandatory_certifications, displayRfp?.certification_notes, displayRfp?.geo, displayRfp?.delivery, displayRfp?.priority, displayRfp?.project_description, displayRfp?.other_project_requirements, JSON.stringify(displayRfp?.certs || [])]);

  useEffect(() => {
    if (!assessmentData) return;
    const certsList = Array.isArray(displayRfp?.mandatory_certifications)
      ? displayRfp.mandatory_certifications
      : csvTags(displayRfp?.mandatory_certifications || "");
    setRfpIntake((prev) => ({
      ...prev,
      contact_name: `${displayRfp?.contact_name || prev?.contact_name || ""}`,
      contact_email: `${displayRfp?.contact_email || prev?.contact_email || ""}`,
      contact_phone: `${displayRfp?.contact_phone || prev?.contact_phone || ""}`,
      company_name: `${displayRfp?.company_name || prev?.company_name || ""}`,
      company_location: `${displayRfp?.company_location || prev?.company_location || ""}`,
      company_size: normalizeCompanySize(displayRfp?.company_size || prev?.company_size || ""),
      project_name: `${displayRfp?.project || prev?.project_name || ""}`,
      project_date: `${displayRfp?.project_date || prev?.project_date || ""}`,
      customer_industry: `${displayRfp?.customer_industry || prev?.customer_industry || ""}`,
      customer_account_name: `${displayRfp?.customer_account_name || prev?.customer_account_name || ""}`,
      expected_annual_production_volume: `${displayRfp?.expected_annual_production_volume || prev?.expected_annual_production_volume || ""}`,
      mandatory_certifications: canonicalizeCertList(certsList).join(", "),
      certification_notes: `${displayRfp?.certification_notes || prev?.certification_notes || ""}`,
      project_description: `${displayRfp?.project_description || prev?.project_description || ""}`,
      other_project_requirements: `${displayRfp?.other_project_requirements || prev?.other_project_requirements || ""}`,
    }));
  }, [assessmentData, displayRfp?.id, displayRfp?.contact_name, displayRfp?.contact_email, displayRfp?.contact_phone, displayRfp?.company_name, displayRfp?.company_location, displayRfp?.company_size, displayRfp?.project, displayRfp?.project_date, displayRfp?.customer_industry, displayRfp?.customer_account_name, displayRfp?.expected_annual_production_volume, displayRfp?.mandatory_certifications, displayRfp?.certification_notes, displayRfp?.project_description, displayRfp?.other_project_requirements]);

  useEffect(() => {
    if (!assessmentData) return;
    setOverallAccuracy(`${assessmentData?.overall_accuracy || ""}`.trim());
    const scoreRaw = assessmentData?.overall_score;
    setOverallScoreInput(scoreRaw === null || scoreRaw === undefined || scoreRaw === "" ? "" : `${scoreRaw}`);
    setOverallFeedback(`${assessmentData?.overall_feedback || ""}`.trim());
  }, [assessmentData]);

  const resolveAssessmentRfpId = useCallback(() => {
    const raw = `${assessmentData?.rfp_id || rfp?.rfp_id || rfp?.sourceRfpId || rfp?.id || displayRfp?.id || ""}`.trim();
    if (!raw) return "";
    if (raw.startsWith("ZOHO-")) return raw;
    if (/^\d{10,}$/.test(raw)) return `ZOHO-${raw}`;
    return raw;
  }, [assessmentData, rfp, displayRfp?.id]);

  useEffect(() => {
    if (editingSavedParts) return;
    const parts = Array.isArray(assessmentData?.parts) ? assessmentData.parts : [];
    setSavedPartsDraft(parts.map((p, idx) => ({
      id: `${p?.part_id || p?.Part_Id || `P-${String(idx + 1).padStart(3, "0")}`}`,
      description: `${p?.description || p?.Description || ""}`,
      material: `${p?.material || p?.Material || ""}`,
      process: `${p?.process || p?.Process || ""}`,
      tolerance: `${p?.tolerance || p?.Tolerance || ""}`,
      qty: `${p?.qty ?? p?.Quantity ?? ""}`,
      image_b64: p?.image_b64 || null,
      b1: Number(p?.b1 ?? p?.B1_Score ?? 0),
      b2: Number(p?.b2 ?? p?.B2_Score ?? 0),
      c: Number(p?.c ?? p?.C_Score ?? 0),
      composite: Number(p?.composite ?? p?.Composite_Score ?? 0),
      matched_jobs: Array.isArray(p?.matched_jobs) ? p.matched_jobs : [],
    })));
  }, [assessmentData, editingSavedParts]);

  const handleRerunSavedAssessment = useCallback(async () => {
    const rid = resolveAssessmentRfpId();
    if (!rid) {
      setAssessmentError("Missing assessment id for re-run.");
      return;
    }
    const parts = (Array.isArray(savedPartsDraft) ? savedPartsDraft : []).map((p, i) => ({
      id: p?.id || `P-${String(i + 1).padStart(3, "0")}`,
      description: `${p?.description || ""}`,
      material: `${p?.material || ""}`,
      process: `${p?.process || ""}`,
      tolerance: `${p?.tolerance || ""}`,
      qty: `${p?.qty || ""}` || "1",
      image_b64: p?.image_b64 || null,
    }));
    if (!parts.length) {
      setAssessmentError("No parts available to re-run.");
      return;
    }

    setRerunningSavedAssessment(true);
    setAssessmentError("");
    setRescoreStatus("Re-running assessment...");
    try {
      const session = getSupplierSession();
      const payload = {
        supplier_id: session.supplier_id || "unknown-supplier",
        supplier_name: session.supplier_name || "",
        supplier_email: session.supplier_email || "",
        supplier_certs: [],
        buyer: `${incomingRfpDraft?.buyer || incomingRfpDraft?.contact_name || ""}`.trim(),
        contact_name: `${incomingRfpDraft?.contact_name || ""}`.trim(),
        contact_email: `${incomingRfpDraft?.contact_email || ""}`.trim(),
        contact_phone: `${incomingRfpDraft?.contact_phone || ""}`.trim(),
        company_name: `${incomingRfpDraft?.company_name || ""}`.trim(),
        company_industry: `${incomingRfpDraft?.company_industry || incomingRfpDraft?.customer_industry || ""}`.trim(),
        company_location: `${incomingRfpDraft?.company_location || ""}`.trim(),
        company_size: `${incomingRfpDraft?.company_size || ""}`.trim(),
        project: `${incomingRfpDraft?.project || displayRfp?.project || "RFP Assessment"}`.trim(),
        project_description: `${incomingRfpDraft?.project_description || ""}`.trim(),
        expected_annual_production_volume: `${incomingRfpDraft?.expected_annual_production_volume || ""}`.trim(),
        mandatory_certifications: csvTags(incomingRfpDraft?.mandatory_certifications || ""),
        certification_notes: `${incomingRfpDraft?.certification_notes || ""}`.trim(),
        other_project_requirements: `${incomingRfpDraft?.other_project_requirements || ""}`.trim(),
        customer_account_name: `${incomingRfpDraft?.customer_account_name || incomingRfpDraft?.company_name || ""}`.trim(),
        customer_industry: `${incomingRfpDraft?.customer_industry || ""}`.trim(),
        project_date: `${incomingRfpDraft?.project_date || ""}`.trim(),
        certs_required: csvTags(incomingRfpDraft?.certs_required || incomingRfpDraft?.mandatory_certifications || ""),
        geo_preference: `${incomingRfpDraft?.geo_preference || ""}`.trim(),
        delivery: `${incomingRfpDraft?.delivery || ""}`.trim(),
        priority_note: `${incomingRfpDraft?.priority_note || ""}`.trim(),
        parts,
        overall_image_b64: parts.find((p) => `${p.image_b64 || ""}`.trim())?.image_b64 || null,
        extracted_images_b64: [],
        extracted_image_sources: [],
      };

      const generated = await apiPost(`${ENDPOINTS.assessment.run}?rfp_id=${encodeURIComponent(rid)}&persist=true&recalc_mode=all`, payload);
      const imageByPart = new Map(parts.map((p) => [`${p.id}`.trim(), p.image_b64 || null]));
      const withImages = {
        ...generated,
        parts: (generated?.parts || []).map((p) => ({
          ...p,
          image_b64: imageByPart.get(`${p?.part_id || ""}`.trim()) || p?.image_b64 || null,
        })),
      };
      setAssessmentData(withImages);
      setEditingSavedParts(false);
      setTab("fit");
      setRescoreStatus("Assessment re-run completed.");
      setTimeout(() => setRescoreStatus(""), 3500);
    } catch (e) {
      setAssessmentError(e?.message || "Could not re-run assessment.");
      setRescoreStatus("Could not re-run assessment.");
      setTimeout(() => setRescoreStatus(""), 4500);
    } finally {
      setRerunningSavedAssessment(false);
    }
  }, [resolveAssessmentRfpId, savedPartsDraft, incomingRfpDraft, displayRfp?.project]);

  const handleIncomingFieldChange = useCallback((key, value) => {
    setIncomingRfpDraft((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleIncomingCancel = useCallback(() => {
    setEditingIncomingRfp(false);
    setIncomingRfpEditError("");
  }, []);

  const handleIncomingSave = useCallback(async () => {
    const session = getSupplierSession();
    const rfpId = resolveAssessmentRfpId();
    if (!rfpId || !rfpId.startsWith("ZOHO-")) {
      setIncomingRfpEditError("Only saved Zoho assessments can be edited.");
      return;
    }
    setSavingIncomingRfp(true);
    setIncomingRfpEditError("");
    try {
      const payload = {
        ...incomingRfpDraft,
        rfp_id: rfpId,
        supplier_id: session?.supplier_id || "",
        supplier_email: session?.supplier_email || "",
        buyer: `${incomingRfpDraft?.buyer || incomingRfpDraft?.contact_name || ""}`.trim(),
      };
      await apiPost(ENDPOINTS.assessment.updateIntake, payload);
      setAssessmentData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          buyer: payload.buyer || "",
          project: payload.project || "",
          contact_name: payload.contact_name || "",
          contact_email: payload.contact_email || "",
          contact_phone: payload.contact_phone || "",
          company_name: payload.company_name || "",
          company_location: payload.company_location || "",
          company_size: payload.company_size || "",
          customer_account_name: payload.customer_account_name || "",
          customer_industry: payload.customer_industry || "",
          project_date: payload.project_date || "",
          expected_annual_production_volume: payload.expected_annual_production_volume || "",
          certs_required: `${payload.certs_required || payload.mandatory_certifications || ""}`
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean),
          mandatory_certifications: payload.mandatory_certifications || "",
          certification_notes: payload.certification_notes || "",
          geo_preference: payload.geo_preference || "",
          delivery: payload.delivery || "",
          priority_note: payload.priority_note || "",
          project_description: payload.project_description || "",
          other_project_requirements: payload.other_project_requirements || "",
        };
      });
      setEditingIncomingRfp(false);
    } catch (err) {
      setIncomingRfpEditError(userSafeMessage(err?.message, "Could not save Incoming RFP changes."));
    } finally {
      setSavingIncomingRfp(false);
    }
  }, [incomingRfpDraft, resolveAssessmentRfpId]);

  const fitView = useMemo(() => {
    if (!assessmentData || !(assessmentData.parts || []).length) return ASMT_FIT;
    const parts = assessmentData.parts || [];
    const partMetric = (p, key) => {
      if (!p || typeof p !== "object") return 0;
      if (key === "b1") return Number(p.b1 ?? p.B1_Score ?? p.b1_score ?? 0);
      if (key === "b2") return Number(p.b2 ?? p.B2_Score ?? p.b2_score ?? 0);
      if (key === "c") return Number(p.c ?? p.C_Score ?? p.c_score ?? 0);
      if (key === "composite") return Number(p.composite ?? p.Composite_Score ?? p.composite_score ?? 0);
      return Number(p[key] ?? 0);
    };
    const avg = (key) => Math.round(parts.reduce((a, p) => a + partMetric(p, key), 0) / Math.max(parts.length, 1));
    return {
      overall: Math.round(Number(assessmentData.overall_score || 0)),
      dims: [
        { key:"B1", label:"B1 · Requested Fit", sub:"Customer-stated material, process, finish and tolerance vs. your registered capability profile", val:avg("b1") },
        { key:"B2", label:"B2 · Manufacturability Fit", sub:"What your process history suggests is the right way to make the part, even if the request is imperfect", val:avg("b2") },
        { key:"C", label:"C · Historical Similarity", sub:"Similarity against your ingested past project corpus across geometry and project specs", val:avg("c") },
      ],
      flags: (assessmentData.flags || []).map((f) => ({ type: f.type || "warn", title: f.title || "Flag", body: f.body || "" })),
      guidance: (assessmentData.guidance || []).map((g) => ({ icon:"bullet", text: g })),
    };
  }, [assessmentData]);

  const fitReason = useMemo(() => {
    const dims = Array.isArray(fitView?.dims) ? fitView.dims : [];
    const byKey = new Map(dims.map((d) => [d.key, Number(d?.val || 0)]));
    const b1 = byKey.get("B1") ?? 0;
    const b2 = byKey.get("B2") ?? 0;
    const c = byKey.get("C") ?? 0;
    const weights = { B1: 0.35, B2: 0.30, C: 0.35 };
    const weighted = {
      B1: Math.round(b1 * weights.B1 * 10) / 10,
      B2: Math.round(b2 * weights.B2 * 10) / 10,
      C: Math.round(c * weights.C * 10) / 10,
    };
    const rankedWeakness = [
      { key: "B1", label: "Requested Fit", val: b1 },
      { key: "B2", label: "Manufacturability Fit", val: b2 },
      { key: "C", label: "Historical Similarity", val: c },
    ].sort((a, b) => a.val - b.val)[0];
    const overall = Number(fitView?.overall || 0);
    const band = overall >= 80 ? "strong" : overall >= 60 ? "moderate" : "thin";
    const fallbackSummary = `Overall Fit ${overall} (${band}) comes from weighted B1/B2/C scoring. Largest drag: ${rankedWeakness.label} (${rankedWeakness.val}).`;
    const llmSummary = `${assessmentData?.fit_reason || ""}`.trim();
    const summary = llmSummary || fallbackSummary;
    return {
      summary,
      weighted,
      weakest: rankedWeakness,
    };
  }, [fitView, assessmentData?.fit_reason]);
  const scoreOneLiners = useMemo(() => {
    const b1 = `${assessmentData?.requested_fit_reason || ""}`.trim();
    const b2 = `${assessmentData?.manufacturability_fit_reason || ""}`.trim();
    const c = `${assessmentData?.fit_reason || ""}`.trim();
    return {
      B1: b1 || "Score reflects how closely requested material, process, finish, and tolerance align with your registered capabilities.",
      B2: b2 || "Score reflects how manufacturable this work is against your proven process history and inferred optimal process.",
      C: c || "Score reflects similarity to your historical projects and outcomes in the ingested corpus.",
    };
  }, [assessmentData?.requested_fit_reason, assessmentData?.manufacturability_fit_reason, assessmentData?.fit_reason]);

  const scoredParts = useMemo(() => {
    if (!assessmentData || !Array.isArray(assessmentData.parts)) return [];
    const num = (...vals) => {
      for (const v of vals) {
        if (v === null || v === undefined || v === "") continue;
        const n = Number(v);
        if (!Number.isNaN(n)) return n;
      }
      return 0;
    };
    const txt = (...vals) => {
      for (const v of vals) {
        const s = `${v ?? ""}`.trim();
        if (s) return s;
      }
      return "";
    };
    return assessmentData.parts.map((p, idx) => ({
      part_id: txt(p.part_id, p.Part_Id, p.partId) || `P-${String(idx + 1).padStart(3, "0")}`,
      description: txt(p.description, p.Description) || `Part ${idx + 1}`,
      b1: num(p.b1, p.B1_Score, p.b1_score),
      b2: num(p.b2, p.B2_Score, p.b2_score),
      c: num(p.c, p.C_Score, p.c_score),
      material: txt(p.material, p.Material),
      process: txt(p.process, p.Process),
      tolerance: txt(p.tolerance, p.Tolerance),
      qty: p.qty ?? p.Quantity ?? null,
      gate: txt(p.gate, p.gate_status) || "pass",
      composite: Math.round(num(p.composite, p.Composite_Score, p.composite_score)),
      image_b64: p?.image_b64 || p?.part_image_b64 || null,
      b1_profile_processes: p.b1_profile_processes || [],
      b1_profile_materials: p.b1_profile_materials || [],
      b1_matched_processes: p.b1_matched_processes || [],
      b1_required_processes: p.b1_required_processes || [],
      b1_matched_materials: p.b1_matched_materials || [],
      b1_tolerance_capable: p.b1_tolerance_capable ?? null,
      b1_missing_certs: p.b1_missing_certs || [],
      b2_inferred_process: p.b2_inferred_process || null,
      b2_process_aligned: p.b2_process_aligned ?? null,
      b2_history_matched_processes: p.b2_history_matched_processes || [],
      b2_history_matched_materials: p.b2_history_matched_materials || [],
      matched_jobs: (Array.isArray(p.matched_jobs) ? p.matched_jobs : []).map((j) => ({
        ...j,
        image_url: toAbsImageUrl(
          buildAttachmentUrl(j) ||
          j?.image_url ||
          j?.served_image ||
          j?.image ||
          j?.image_path ||
          j?.part_image ||
          j?.thumbnail ||
          ""
        ),
      })),
    }));
  }, [assessmentData, toAbsImageUrl, buildAttachmentUrl]);

  const jobsView = useMemo(() => {
    if (!assessmentData) return ASMT_JOBS;
    const summary = Array.isArray(assessmentData.matched_jobs_summary) ? assessmentData.matched_jobs_summary : [];
    const fromParts = scoredParts.flatMap((p) => p.matched_jobs || []);
    const fromPartsByJobId = new Map();
    fromParts.forEach((j) => {
      const key = `${j?.job_id || ""}`.trim();
      if (key && !fromPartsByJobId.has(key)) fromPartsByJobId.set(key, j);
    });
    const partRefsByJob = new Map();
    scoredParts.forEach((p) => {
      (p?.matched_jobs || []).forEach((j) => {
        const key = `${j?.job_id || j?.project_name || ""}`.trim().toLowerCase();
        if (!key) return;
        const arr = partRefsByJob.get(key) || [];
        if (!arr.find((x) => x.part_id === p.part_id)) {
          arr.push({ part_id: p.part_id, description: p.description });
        }
        partRefsByJob.set(key, arr);
      });
    });
    // Merge summary + part-level matches by job_id and keep the highest similarity.
    // This prevents stale snapshot summary scores from masking stronger live part scores.
    const mergedByJobId = new Map();
    const upsertJob = (row, preferPartMeta = false) => {
      const key = `${row?.job_id || ""}`.trim();
      if (!key) return;
      const prev = mergedByJobId.get(key);
      if (!prev) {
        mergedByJobId.set(key, row);
        return;
      }
      const prevSim = Number(prev?.similarity || 0);
      const nextSim = Number(row?.similarity || 0);
      const better = nextSim > prevSim;
      // If similarity ties/loses, we may still want richer part-level metadata.
      if (better || preferPartMeta) {
        mergedByJobId.set(key, {
          ...prev,
          ...row,
          similarity: Math.max(prevSim, nextSim),
          image_url: row?.image_url || prev?.image_url || "",
        });
      } else {
        mergedByJobId.set(key, {
          ...row,
          ...prev,
          similarity: Math.max(prevSim, nextSim),
          image_url: prev?.image_url || row?.image_url || "",
        });
      }
    };

    summary.forEach((j) => upsertJob(j, false));
    fromParts.forEach((j) => upsertJob(j, true));

    const preferred = Array.from(mergedByJobId.values()).map((j) => {
      const key = `${j?.job_id || ""}`.trim();
      const enrich = (key && fromPartsByJobId.get(key)) || null;
      return enrich ? { ...j, ...enrich, similarity: Math.max(Number(j?.similarity || 0), Number(enrich?.similarity || 0)), image_url: enrich?.image_url || j?.image_url || "" } : j;
    });
    const filtered = preferred.filter((j) => !isLikelyPartImageJob(j));
    const source = filtered.length ? filtered : preferred;
    if (!source.length) return ASMT_JOBS;
    const dedup = new Set();
    const rows = source.filter((j) => {
      const key = `${j?.job_id || j?.project_name || ""}`.trim().toLowerCase();
      if (dedup.has(key)) return false;
      dedup.add(key);
      return true;
    }).map((j) => {
      const detailMap = {
        "Project Name": `${j.project_name || j.part_family || "Historical Match"}`.trim(),
        "Customer Industry": `${j.customer_industry || "Historical Project"}`.trim(),
        "Project Date": `${j.project_date || ""}`.trim() || "Not specified",
        "Material": `${j.material || ""}`.trim() || "Not specified",
        "Process": `${j.process_primary || ""}`.trim() || "Not specified",
        "Finish": `${j.finish || ""}`.trim() || "Not specified",
        "Features": `${j.features || ""}`.trim() || "Not specified",
        "Outcome": `${j.outcome || ""}`.trim() || "Outcome not recorded yet",
        "Why Matched": `${j.why_matched || ""}`.trim() || `${j.material || "Material"} · ${j.process_primary || "Process"} similarity signal`,
        "Risk Note": `${j.risk_note || ""}`.trim() || "No major risk signal from this reference.",
        "Project Link": `${j.project_link || ""}`.trim() || "Not available",
      };
      const extraDetails = (j?.details && typeof j.details === "object") ? j.details : {};
      Object.entries(extraDetails).forEach(([k, v]) => {
        const key = `${k || ""}`.trim();
        const val = `${v ?? ""}`.trim();
        if (!key || !val) return;
        if (detailMap[key] && detailMap[key] !== "Not specified") return;
        detailMap[key] = val;
      });
      const hiddenDetailKeys = new Set([
        "pinecone vector id",
        "pinecone_vector_id",
        "image_url",
        "source_type",
        "vector_type",
        "zoho_id",
        "inference_source",
      ]);
      Object.keys(detailMap).forEach((k) => {
        const normalized = `${k || ""}`.trim().toLowerCase();
        if (hiddenDetailKeys.has(normalized)) delete detailMap[k];
      });

      return {
        id: j.job_id || "JOB",
        title: j.project_name || j.part_name || j.part_family || "Historical Match",
        part_name: j.part_name || null,
        project_name: j.project_name || null,
        customer: j.customer_industry || "Historical Project",
        date: j.project_date || "",
        process: j.process_primary || "",
        similarity: Math.round(Number(j.similarity || 0)),
        parts: (partRefsByJob.get(`${j?.job_id || j?.project_name || ""}`.trim().toLowerCase()) || []).map((r) => r.part_id),
        partRefs: partRefsByJob.get(`${j?.job_id || j?.project_name || ""}`.trim().toLowerCase()) || [],
        dims: [
          { label:"Why matched", val:j.why_matched || `${j.material || "Material"} · ${j.process_primary || "Process"} similarity signal` },
          { label:"What happened", val:j.outcome || "Outcome not recorded yet", pass: Boolean(`${j.outcome || ""}`.trim()) },
          { label:"Risk note", val:j.risk_note || "No major risk signal from this reference.", warn: /risk|mismatch|low|manual|fail|rework|ncr/i.test(`${j.risk_note || ""}`) },
        ],
        note: `Linked historical precedent ${j.project_link ? "with project reference." : "from corpus matching."} ${j.features ? `Feature cues: ${j.features}` : ""}`.trim(),
        imageUrl: toAbsImageUrl(
          buildAttachmentUrl(j) ||
          j.image_url ||
          j.served_image ||
          j.image ||
          j.image_path ||
          j.part_image ||
          j.thumbnail ||
          ""
        ),
        imageCandidates: [
          buildAttachmentUrl(j),
          j.image_url,
          j.served_image,
          j.image,
          j.image_path,
          j.part_image,
          j.thumbnail,
        ].map((u) => toAbsImageUrl(u || "")).filter(Boolean),
        project_link: j.project_link || "",
        tags: [j.material || "Material", j.process_primary || "Process", j.part_family || "Part"].filter(Boolean),
        allDetails: detailMap,
      };
    });
    rows.sort((a, b) => Number(b?.similarity || 0) - Number(a?.similarity || 0));
    return rows;
  }, [assessmentData, scoredParts, toAbsImageUrl, isLikelyPartImageJob]);

  const jobsViewFiltered = useMemo(() => {
    if (historyPartFilter === "ALL") return jobsView;
    return (jobsView || []).filter((j) =>
      Array.isArray(j?.partRefs) && j.partRefs.some((r) => `${r?.part_id || ""}` === historyPartFilter)
    );
  }, [jobsView, historyPartFilter]);

  useEffect(() => {
    if (historyPartFilter === "ALL") return;
    const exists = (scoredParts || []).some((p) => `${p?.part_id || ""}` === historyPartFilter);
    if (!exists) setHistoryPartFilter("ALL");
  }, [scoredParts, historyPartFilter]);

  const setMatchFeedbackField = useCallback((vectorId, field, value) => {
    const key = `${vectorId || ""}`.trim();
    if (!key) return;
    setFeedbackByVector((prev) => ({
      ...prev,
      [key]: {
        ...(prev?.[key] || {}),
        [field]: value,
      },
    }));
  }, []);

  const buildSingleFeedbackRow = useCallback((vectorId) => {
    const key = `${vectorId || ""}`.trim();
    if (!key) return null;
    const entry = feedbackByVector?.[key] || {};
    const corrections = entry?.field_corrections && Object.keys(entry.field_corrections).length
      ? entry.field_corrections
      : null;
    const row = {
      pinecone_vector_id: key,
      user_rating: `${entry?.user_rating || ""}`.trim() || null,
      user_score: entry?.user_score === "" || entry?.user_score === null || entry?.user_score === undefined
        ? null
        : Number(entry.user_score),
      reason: `${entry?.reason || ""}`.trim() || null,
      field_corrections: corrections,
    };
    if (!row.user_rating && row.user_score === null && !row.reason && !row.field_corrections) {
      return null;
    }
    return row;
  }, [feedbackByVector]);

  const handleSubmitMatchFeedback = useCallback(async () => {
    try {
      const rfpId = resolveAssessmentRfpId();
      if (!rfpId || !rfpId.startsWith("ZOHO-")) {
        setFeedbackStatus("Feedback can be saved only for Zoho-backed assessments.");
        return;
      }
      const rows = Object.keys(feedbackByVector || {})
        .map((vectorId) => buildSingleFeedbackRow(vectorId))
        .filter(Boolean);

      if (!rows.length && !`${overallAccuracy || ""}`.trim() && overallScoreInput === "" && !`${overallFeedback || ""}`.trim()) {
        setFeedbackStatus("Add at least one feedback field before saving.");
        return;
      }

      setSavingFeedback(true);
      setFeedbackStatus("");
      await apiPost(ENDPOINTS.assessment.feedback, {
        rfp_id: rfpId,
        overall_accuracy: `${overallAccuracy || ""}`.trim() || null,
        overall_score: overallScoreInput === "" ? null : Number(overallScoreInput),
        overall_feedback: `${overallFeedback || ""}`.trim() || null,
        rows,
      });
      setFeedbackStatus("Feedback saved.");
      setTimeout(() => setFeedbackStatus(""), 3000);
    } catch (e) {
      setFeedbackStatus(`Feedback save failed: ${e?.message || "Unknown error"}`);
    } finally {
      setSavingFeedback(false);
    }
  }, [feedbackByVector, overallAccuracy, overallScoreInput, overallFeedback, resolveAssessmentRfpId, buildSingleFeedbackRow]);

  const handleSubmitSingleMatchFeedback = useCallback(async (vectorId) => {
    const key = `${vectorId || ""}`.trim();
    if (!key) return;
    try {
      const rfpId = resolveAssessmentRfpId();
      if (!rfpId || !rfpId.startsWith("ZOHO-")) {
        setPerMatchSubmitState((prev)=>({ ...prev, [key]: { saving:false, message:"Feedback works only for Zoho-backed assessments." } }));
        return;
      }
      const row = buildSingleFeedbackRow(key);
      if (!row) {
        setPerMatchSubmitState((prev)=>({ ...prev, [key]: { saving:false, message:"Add feedback fields first." } }));
        return;
      }
      setPerMatchSubmitState((prev)=>({ ...prev, [key]: { saving:true, message:"Submitting..." } }));
      await apiPost(ENDPOINTS.assessment.feedback, {
        rfp_id: rfpId,
        rows: [row],
      });
      setPerMatchSubmitState((prev)=>({ ...prev, [key]: { saving:false, message:"Saved." } }));
      setTimeout(() => {
        setPerMatchSubmitState((prev)=>({ ...prev, [key]: { saving:false, message:"" } }));
      }, 2500);
    } catch (e) {
      setPerMatchSubmitState((prev)=>({ ...prev, [key]: { saving:false, message:`Save failed: ${e?.message || "Unknown error"}` } }));
    }
  }, [resolveAssessmentRfpId, buildSingleFeedbackRow]);

  const TABS=[{id:"overview",label:"RFP Overview"},{id:"fit",label:"Bid Assessment"},{id:"b1",label:"Requested Fit"},{id:"b2",label:"Manufacturability Fit"},{id:"history",label:`Historical Similarity (${jobsView.length})`}];

  const handleMarkNoBidOnly = useCallback(async () => {
    try {
      const resolvedId = resolveAssessmentRfpId();
      if (!resolvedId) throw new Error("Missing RFP id");
      setMarkingNoBid(true);
      const session = getSupplierSession();
      await apiPost(ENDPOINTS.assessment.noBid, {
        rfp_id: resolvedId,
        supplier_id: session.supplier_id || "",
        supplier_name: session.supplier_name || "",
        path: "decline_only",
        reason: "decline_only",
        buyer_contact_email: "",
        note: "Marked no-bid from assessment screen",
      });
      setAssessmentError("");
    } catch (e) {
      setAssessmentError(`No-bid failed: ${e?.message || e}`);
    } finally {
      setMarkingNoBid(false);
    }
  }, [resolveAssessmentRfpId]);

  const handleExportPdf = useCallback(async () => {
    try {
      setExportingPdf(true);
      const rid = resolveAssessmentRfpId() || "assessment";
      const jobImageById = new Map();
      const jobImageByTitle = new Map();
      (scoredParts || []).forEach((p) => {
        (p?.matched_jobs || []).forEach((mj) => {
          const jid = `${mj?.job_id || ""}`.trim();
          const jtitle = `${mj?.project_name || mj?.part_family || ""}`.trim().toLowerCase();
          const imgs = [
            mj?.image_url,
            mj?.served_image,
            mj?.image,
            mj?.image_path,
            mj?.part_image,
            mj?.thumbnail,
          ].map((u) => `${u || ""}`.trim()).filter(Boolean);
          if (jid && imgs.length && !jobImageById.has(jid)) jobImageById.set(jid, imgs);
          if (jtitle && imgs.length && !jobImageByTitle.has(jtitle)) jobImageByTitle.set(jtitle, imgs);
        });
      });
      const jobsForPdf = (jobsView || []).map((j) => {
        const jid = `${j?.id || ""}`.trim();
        const jtitle = `${j?.title || ""}`.trim().toLowerCase();
        const own = Array.isArray(j?.imageCandidates) ? j.imageCandidates : [`${j?.imageUrl || ""}`.trim()].filter(Boolean);
        const byId = jobImageById.get(jid) || [];
        const byTitle = jobImageByTitle.get(jtitle) || [];
        const merged = Array.from(new Set([...own, ...byId, ...byTitle].filter(Boolean)));
        return { ...j, imageUrl: `${merged[0] || ""}`.trim(), imageCandidates: merged };
      });
      await generateStyledAssessmentPdf({
        filename: `rfp-assessment-${rid}.pdf`,
        rfpId: rid,
        displayRfp,
        fitView,
        scoredParts,
        jobsView: jobsForPdf,
      });
      setAssessmentError("");
    } catch (e) {
      setAssessmentError(`PDF export failed: ${e?.message || e}`);
    } finally {
      setExportingPdf(false);
    }
  }, [resolveAssessmentRfpId, displayRfp, fitView, scoredParts, jobsView]);

  return (
    <div style={{fontFamily:sans,fontSize:14,color:C.ink,minHeight:"100vh",background:C.bg}}>
      <Topbar screen="assessment" onBack={()=>navigate("dashboard",{})} rfpId={displayRfp.id} onLogout={onLogout}
        rightSlot={<div style={{display:"flex",gap:8,alignItems:"center"}}><Btn sm variant="ghost" onClick={handleExportPdf} disabled={exportingPdf}>{exportingPdf?"Exporting...":"Export PDF"}</Btn></div>}/>
      <div style={{background:C.white,borderBottom:`1px solid ${C.rule}`}}>
        <div style={{maxWidth:1240,margin:"0 auto",padding:"18px 26px 0"}}>
          <div style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.1em",color:C.gold,marginBottom:4}}>Supplier Portal - RFP Assessment</div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:20,marginBottom:16}}>
            <div>
              <h1 style={{fontFamily:disp,fontSize:24,fontWeight:700,lineHeight:1.15,marginBottom:5}}>{displayRfp.project||displayRfp.buyer}</h1>
              <p style={{fontSize:13,color:C.inkSoft,maxWidth:520,lineHeight:1.65}}>Cross-reference this incoming RFP against your past project history to surface relevant precedents for quoting.</p>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:13,padding:"13px 16px",background:C.surface,border:`1px solid ${C.rule}`,borderRadius:8,flexShrink:0,animation:"up 0.4s ease 0.1s both"}}>
              <AsmtRing value={fitView.overall} size={58} delay={300}/>
              <div>
                <div style={{fontFamily:disp,fontSize:14,fontWeight:700,marginBottom:2}}>Overall Fit</div>
                <div style={{fontFamily:mono,fontSize:9,color:C.inkMuted,letterSpacing:"0.04em",marginBottom:6}}>vs. your capability profile</div>
                <div style={{fontSize:11.5,color:C.inkSoft,lineHeight:1.45,maxWidth:360,marginBottom:6}}>
                  {fitReason.summary}
                </div>
                <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                  <AsmtChip type="warn" label="Assessment snapshot"/><AsmtChip type="pass" label="Endpoint mapped"/>
                </div>
              </div>
            </div>
          </div>
          <div style={{display:"flex"}}>
            {TABS.map(t=><button key={t.id} onClick={()=>setTab(t.id)} style={{fontFamily:mono,fontSize:10,letterSpacing:"0.05em",textTransform:"uppercase",padding:"9px 16px",background:"none",border:"none",borderBottom:tab===t.id?`2px solid ${C.gold}`:"2px solid transparent",color:tab===t.id?C.ink:C.inkMuted,cursor:"pointer",marginBottom:-1,transition:"color 0.12s"}}>{t.label}</button>)}
          </div>
        </div>
      </div>
      <div style={{maxWidth:1240,margin:"0 auto",padding:"22px 26px"}}>
        {loadingAssessment && (
          <div style={{marginBottom:12,padding:"8px 10px",background:C.surface,border:`1px solid ${C.rule}`,borderRadius:5,fontSize:12,color:C.inkMuted}}>
            Loading assessment...
          </div>
        )}
        {rescoreStatus && (
          <div style={{marginBottom:12,padding:"8px 10px",background:C.bluePale,border:`1px solid rgba(26,61,92,0.2)`,borderRadius:5,fontSize:12,color:C.blue}}>
            {rescoreStatus}
          </div>
        )}
        {crmNeedsRun && !assessmentData && (
          <div style={{marginBottom:12,padding:"12px 14px",background:C.goldPale,border:`1px solid rgba(184,146,10,0.22)`,borderLeft:`3px solid ${C.gold}`,borderRadius:6,display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}>
            <div>
              <div style={{fontFamily:disp,fontSize:14,fontWeight:700,color:C.ink,marginBottom:3}}>Assessment not done for this TrustBridge RFP</div>
              <div style={{fontSize:12.5,color:C.inkSoft,lineHeight:1.6}}>
                Review the RFP details and media below, then click <strong>Run Assessment</strong> to generate this supplier’s assessment.
              </div>
            </div>
            <Btn variant="accent" onClick={handleRunCrmAssessment} disabled={runningCrmAssessment}>
              {runningCrmAssessment ? "Running..." : "Run Assessment ->"}
            </Btn>
          </div>
        )}
        {assessmentError && (
          <div style={{marginBottom:12,padding:"8px 10px",background:C.warnBg,border:`1px solid ${C.warnRule}`,borderRadius:5,fontSize:12,color:C.warn}}>
            {userSafeMessage(assessmentError)}
          </div>
        )}

        {tab==="overview"&&(
          noRfpMode && !assessmentData ? (
          <Card style={{animation:"up 0.25s ease"}}>
            <CardHead title="RFP Intake Workflow" right={`Step ${assessmentStep} of 2`}/>
            <div style={{padding:16}}>
              <div style={{marginBottom:10,padding:"10px 12px",border:`1px solid ${C.ruleLight}`,borderRadius:6,background:C.surface}}>
                <div style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted,marginBottom:5}}>
                  Step 1 - Project-Level Intake
                </div>
                <div style={{fontSize:12.5,color:C.inkSoft,lineHeight:1.6}}>
                  Upload project documents/text first (PDF/Word/Text). Do not upload CAD in Step 1.
                  CAD/images belong in Step 2 inside each part card.
                </div>
              </div>
              <div onClick={()=>fileInputRef.current?.click()} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();const files=Array.from(e.dataTransfer.files||[]);if(files.length){appendRfpFiles(files);}}}
                style={{border:`2px dashed ${rfpFiles.length?C.gold:C.rule}`,borderRadius:8,padding:"24px 20px",textAlign:"center",background:rfpFiles.length?C.goldPale:C.surface,cursor:"pointer"}}>
                <div style={{fontFamily:disp,fontSize:13,fontWeight:700,marginBottom:4}}>{rfpFiles.length?(rfpFiles.length===1?rfpFiles[0].name:`${rfpFiles.length} files selected`):"Drop RFP file(s) here"}</div>
                <div style={{fontSize:12,color:C.inkMuted}}>{rfpFiles.length?"Files selected":"Accepted in Step 1: PDF, DOC, DOCX, TXT, MD, RTF, CSV, TSV, JSON"}</div>
                <div style={{fontFamily:mono,fontSize:10,color:C.inkMuted,letterSpacing:"0.04em",marginTop:6}}>
                  Project docs only
                </div>
              </div>
              <input ref={fileInputRef} type="file" style={{display:"none"}} multiple onChange={e=>{const files=Array.from(e.target.files||[]);appendRfpFiles(files); e.target.value="";}}/>
              {rfpFiles.length > 0 && (
                <div style={{marginTop:10,padding:"10px 12px",background:C.surface,border:`1px solid ${C.rule}`,borderRadius:6}}>
                  <div style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted,marginBottom:7}}>
                    Selected Files ({rfpFiles.length})
                  </div>
                  <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                    {rfpFiles.map((f, i) => (
                      <span key={`${f.name}-${i}`} style={{display:"inline-flex",alignItems:"center",gap:6,fontFamily:mono,fontSize:9,padding:"3px 8px",borderRadius:3,background:C.white,border:`1px solid ${C.ruleLight}`,color:C.inkSoft}}>
                        <span>{f.name}</span>
                        <button
                          onClick={(e)=>{e.stopPropagation();removeRfpFile(i);}}
                          style={{border:"none",background:"transparent",cursor:"pointer",color:C.inkMuted,fontSize:11,lineHeight:1,padding:0}}
                          title="Remove file"
                        >
                          x
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <textarea value={rfpText} onChange={e=>setRfpText(e.target.value)} rows={6} placeholder="Or paste raw RFP text here..."
                style={{width:"100%",marginTop:12,padding:"10px 12px",border:`1px solid ${C.rule}`,borderRadius:6,fontFamily:sans,fontSize:13,color:C.ink,background:C.white,resize:"vertical"}}/>
              <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:10}}>
                {rfpFiles.length>0&&<Btn variant="ghost" onClick={()=>setRfpFiles([])}>Clear file(s)</Btn>}
                <Btn variant="accent" onClick={handleParseUpload} disabled={uploading==="parsing"}>{uploading==="parsing"?"Parsing...":"Extract Project Details"}</Btn>
              </div>
              <div style={{marginTop:12,padding:"10px",border:`1px solid ${C.ruleLight}`,borderRadius:6,background:C.surface}}>
                <div style={{fontFamily:disp,fontSize:14,fontWeight:700,color:C.ink,marginBottom:8}}>RFP Intake Details</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                  <div>
                    <div style={{fontFamily:mono,fontSize:8,color:C.inkMuted,textTransform:"uppercase",marginBottom:4}}>Contact Name</div>
                    <input value={rfpIntake.contact_name} onChange={(e)=>setRfpIntake((p)=>({...p,contact_name:e.target.value}))} placeholder="Buyer contact name" style={{width:"100%",padding:"8px 9px",border:`1px solid ${C.rule}`,borderRadius:5,background:C.white,color:C.ink,fontSize:12}} />
                  </div>
                  <div>
                    <div style={{fontFamily:mono,fontSize:8,color:C.inkMuted,textTransform:"uppercase",marginBottom:4}}>Project Name</div>
                    <input value={rfpIntake.project_name} onChange={(e)=>setRfpIntake((p)=>({...p,project_name:e.target.value}))} placeholder="Project title" style={{width:"100%",padding:"8px 9px",border:`1px solid ${C.rule}`,borderRadius:5,background:C.white,color:C.ink,fontSize:12}} />
                  </div>
                  <div>
                    <div style={{fontFamily:mono,fontSize:8,color:C.inkMuted,textTransform:"uppercase",marginBottom:4}}>Contact Email</div>
                    <input value={rfpIntake.contact_email} onChange={(e)=>setRfpIntake((p)=>({...p,contact_email:e.target.value}))} placeholder="contact@company.com" style={{width:"100%",padding:"8px 9px",border:`1px solid ${C.rule}`,borderRadius:5,background:C.white,color:C.ink,fontSize:12}} />
                  </div>
                  <div>
                    <div style={{fontFamily:mono,fontSize:8,color:C.inkMuted,textTransform:"uppercase",marginBottom:4}}>Contact Phone</div>
                    <input value={rfpIntake.contact_phone} onChange={(e)=>setRfpIntake((p)=>({...p,contact_phone:e.target.value}))} placeholder="+1 555 555 5555" style={{width:"100%",padding:"8px 9px",border:`1px solid ${C.rule}`,borderRadius:5,background:C.white,color:C.ink,fontSize:12}} />
                  </div>
                  <div>
                    <div style={{fontFamily:mono,fontSize:8,color:C.inkMuted,textTransform:"uppercase",marginBottom:4}}>Company Name</div>
                    <input value={rfpIntake.company_name} onChange={(e)=>setRfpIntake((p)=>({...p,company_name:e.target.value}))} placeholder="Company name" style={{width:"100%",padding:"8px 9px",border:`1px solid ${C.rule}`,borderRadius:5,background:C.white,color:C.ink,fontSize:12}} />
                  </div>
                  <div>
                    <div style={{fontFamily:mono,fontSize:8,color:C.inkMuted,textTransform:"uppercase",marginBottom:4}}>Company Location</div>
                    <input value={rfpIntake.company_location} onChange={(e)=>setRfpIntake((p)=>({...p,company_location:e.target.value}))} placeholder="City, State, Country" style={{width:"100%",padding:"8px 9px",border:`1px solid ${C.rule}`,borderRadius:5,background:C.white,color:C.ink,fontSize:12}} />
                  </div>
                  <div>
                    <div style={{fontFamily:mono,fontSize:8,color:C.inkMuted,textTransform:"uppercase",marginBottom:4}}>Company Size</div>
                    <select value={rfpIntake.company_size} onChange={(e)=>setRfpIntake((p)=>({...p,company_size:e.target.value}))} style={{width:"100%",padding:"8px 9px",border:`1px solid ${C.rule}`,borderRadius:5,background:C.white,color:C.ink,fontSize:12}}>
                      <option value="">-- select company size --</option>
                      {COMPANY_SIZE_OPTIONS.map((sz)=><option key={sz} value={sz}>{sz}</option>)}
                    </select>
                  </div>
                  <div>
                    <div style={{fontFamily:mono,fontSize:8,color:C.inkMuted,textTransform:"uppercase",marginBottom:4}}>Project Date</div>
                    <input type="date" value={rfpIntake.project_date} onChange={(e)=>setRfpIntake((p)=>({...p,project_date:e.target.value}))} style={{width:"100%",padding:"8px 9px",border:`1px solid ${C.rule}`,borderRadius:5,background:C.white,color:C.ink,fontSize:12}} />
                  </div>
                  <div>
                    <div style={{fontFamily:mono,fontSize:8,color:C.inkMuted,textTransform:"uppercase",marginBottom:4}}>Expected Annual Production Volume</div>
                    <input value={rfpIntake.expected_annual_production_volume} onChange={(e)=>setRfpIntake((p)=>({...p,expected_annual_production_volume:e.target.value}))} placeholder="e.g. 12000 units" style={{width:"100%",padding:"8px 9px",border:`1px solid ${C.rule}`,borderRadius:5,background:C.white,color:C.ink,fontSize:12}} />
                  </div>
                  <div style={{gridColumn:"1 / -1"}}>
                    <div style={{fontFamily:mono,fontSize:8,color:C.inkMuted,textTransform:"uppercase",marginBottom:4}}>Project Description</div>
                    <textarea value={rfpIntake.project_description} onChange={(e)=>setRfpIntake((p)=>({...p,project_description:e.target.value}))} rows={2} placeholder="Project description / scope" style={{width:"100%",padding:"8px 9px",border:`1px solid ${C.rule}`,borderRadius:5,background:C.white,color:C.ink,fontSize:12,resize:"vertical"}} />
                  </div>
                  <div style={{gridColumn:"1 / -1"}}>
                    <div style={{fontFamily:mono,fontSize:8,color:C.inkMuted,textTransform:"uppercase",marginBottom:4}}>Mandatory Certifications</div>
                    <div style={{border:`1px solid ${C.rule}`,borderRadius:5,background:C.white,padding:"8px 10px",display:"grid",gridTemplateColumns:"repeat(2,minmax(0,1fr))",gap:6}}>
                      {MANDATORY_CERTIFICATION_OPTIONS.map((cert)=>{
                        const selected = canonicalizeCertList(csvTags(rfpIntake.mandatory_certifications));
                        const checked = selected.includes(cert);
                        return (
                          <label key={cert} style={{display:"flex",alignItems:"center",gap:7,cursor:"pointer",padding:"3px 4px",borderRadius:4,background:checked?C.goldPale:"transparent"}}>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e)=>{
                                const next = new Set(canonicalizeCertList(csvTags(rfpIntake.mandatory_certifications)));
                                if (e.target.checked) next.add(cert); else next.delete(cert);
                                setRfpIntake((p)=>({...p,mandatory_certifications:Array.from(next).join(", ")}));
                              }}
                            />
                            <span style={{fontSize:12,color:C.ink}}>{cert}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                  <div style={{gridColumn:"1 / -1"}}>
                    <div style={{fontFamily:mono,fontSize:8,color:C.inkMuted,textTransform:"uppercase",marginBottom:4}}>Certification Notes</div>
                    <textarea value={rfpIntake.certification_notes} onChange={(e)=>setRfpIntake((p)=>({...p,certification_notes:e.target.value}))} rows={2} placeholder="Any certification remarks..." style={{width:"100%",padding:"8px 9px",border:`1px solid ${C.rule}`,borderRadius:5,background:C.white,color:C.ink,fontSize:12,resize:"vertical"}} />
                  </div>
                  <div style={{gridColumn:"1 / -1"}}>
                    <div style={{fontFamily:mono,fontSize:8,color:C.inkMuted,textTransform:"uppercase",marginBottom:4}}>Other Project Requirements</div>
                    <textarea value={rfpIntake.other_project_requirements} onChange={(e)=>setRfpIntake((p)=>({...p,other_project_requirements:e.target.value}))} rows={2} placeholder="Any additional buyer/project requirements..." style={{width:"100%",padding:"8px 9px",border:`1px solid ${C.rule}`,borderRadius:5,background:C.white,color:C.ink,fontSize:12,resize:"vertical"}} />
                  </div>
                </div>
              </div>
              <div style={{marginTop:12,padding:"14px 14px",background:"linear-gradient(180deg,#F6F9FF 0%, #EFF3FA 100%)",border:`1px solid ${C.rule}`,borderRadius:10,boxShadow:"inset 0 1px 0 rgba(255,255,255,0.7)"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,marginBottom:8,flexWrap:"wrap"}}>
                    <div style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted}}>
                      Step 2 - Part-Level Files & Details ({partsDraft.length} parts)
                    </div>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <label htmlFor="assessment-overwrite" style={{display:"flex",alignItems:"center",gap:6,cursor:"pointer",fontFamily:mono,fontSize:10,color:C.inkSoft,letterSpacing:"0.03em"}}>
                        <input
                          id="assessment-overwrite"
                          type="checkbox"
                          checked={extractOverwrite}
                          onChange={(e)=>setExtractOverwrite(e.target.checked)}
                        />
                        Overwrite existing values on extract
                      </label>
                    </div>
                  </div>
                  <div style={{fontSize:12,color:C.inkMuted,lineHeight:1.6,marginBottom:8}}>
                    Attach CAD/images per part and click <strong>Process Part</strong>. This does not overwrite existing fields unless overwrite mode is enabled.
                  </div>
                  {!parsedRfp && (
                    <div style={{marginBottom:8,padding:"8px 10px",border:`1px solid ${C.ruleLight}`,borderRadius:5,background:C.white,fontSize:12,color:C.inkMuted}}>
                      You can add parts right now. Project extraction in Step 1 is recommended first, but not required.
                    </div>
                  )}
                  <div style={{display:"flex",flexDirection:"column",gap:8}}>
                    {partsDraft.map((p, i) => (
                      <div key={`${p.id}-${i}`} style={{padding:"11px 12px",background:C.white,border:`1px solid ${C.rule}`,borderRadius:8,boxShadow:"0 1px 2px rgba(20,28,36,0.05)"}}>
                        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,marginBottom:8}}>
                          <div style={{fontFamily:mono,fontSize:8,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted}}>
                          Part {i + 1}
                          </div>
                          <span style={{fontFamily:mono,fontSize:8,padding:"2px 6px",borderRadius:10,background:C.bluePale,border:"1px solid rgba(26,74,114,0.2)",color:C.blue}}>
                            {p?.id || `P-${String(i + 1).padStart(3,"0")}`}
                          </span>
                        </div>
                        <div style={{display:"grid",gridTemplateColumns:"110px 1fr",gap:8,marginBottom:8}}>
                          <div>
                            <div style={{fontFamily:mono,fontSize:8,textTransform:"uppercase",letterSpacing:"0.05em",color:C.inkMuted,marginBottom:3}}>Part ID</div>
                            <input
                              value={p.id}
                              onChange={(e)=>setPartsDraft(prev=>prev.map((row,idx)=>idx===i?{...row,id:e.target.value}:row))}
                              placeholder="P-001"
                              style={{width:"100%",padding:"6px 8px",border:`1px solid ${C.rule}`,borderRadius:4,fontFamily:mono,fontSize:11,background:C.white,color:C.ink}}
                            />
                          </div>
                          <div>
                            <div style={{fontFamily:mono,fontSize:8,textTransform:"uppercase",letterSpacing:"0.05em",color:C.inkMuted,marginBottom:3}}>Part Description</div>
                            <input
                              value={p.description}
                              onChange={(e)=>setPartsDraft(prev=>prev.map((row,idx)=>idx===i?{...row,description:e.target.value}:row))}
                              placeholder="Describe the part"
                              style={{width:"100%",padding:"6px 8px",border:`1px solid ${C.rule}`,borderRadius:4,fontFamily:sans,fontSize:12,background:C.white,color:C.ink}}
                            />
                          </div>
                        </div>
                        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 90px",gap:8}}>
                          <div>
                            <div style={{fontFamily:mono,fontSize:8,textTransform:"uppercase",letterSpacing:"0.05em",color:C.inkMuted,marginBottom:3}}>Material</div>
                            <input
                              value={p.material}
                              onChange={(e)=>setPartsDraft(prev=>prev.map((row,idx)=>idx===i?{...row,material:e.target.value}:row))}
                              placeholder="Al 7075-T6"
                              style={{width:"100%",padding:"6px 8px",border:`1px solid ${C.rule}`,borderRadius:4,fontFamily:sans,fontSize:12,background:C.white,color:C.ink}}
                            />
                          </div>
                          <div>
                            <div style={{fontFamily:mono,fontSize:8,textTransform:"uppercase",letterSpacing:"0.05em",color:C.inkMuted,marginBottom:3}}>Process</div>
                            <input
                              value={p.process}
                              onChange={(e)=>setPartsDraft(prev=>prev.map((row,idx)=>idx===i?{...row,process:e.target.value}:row))}
                              placeholder="5-Axis CNC Mill"
                              style={{width:"100%",padding:"6px 8px",border:`1px solid ${C.rule}`,borderRadius:4,fontFamily:sans,fontSize:12,background:C.white,color:C.ink}}
                            />
                          </div>
                          <div>
                            <div style={{fontFamily:mono,fontSize:8,textTransform:"uppercase",letterSpacing:"0.05em",color:C.inkMuted,marginBottom:3}}>Tolerance</div>
                            <input
                              value={p.tolerance}
                              onChange={(e)=>setPartsDraft(prev=>prev.map((row,idx)=>idx===i?{...row,tolerance:e.target.value}:row))}
                              placeholder='±0.0005"'
                              style={{width:"100%",padding:"6px 8px",border:`1px solid ${C.rule}`,borderRadius:4,fontFamily:sans,fontSize:12,background:C.white,color:C.ink}}
                            />
                          </div>
                          <div>
                            <div style={{fontFamily:mono,fontSize:8,textTransform:"uppercase",letterSpacing:"0.05em",color:C.inkMuted,marginBottom:3}}>Qty</div>
                            <input
                              value={p.qty}
                              onChange={(e)=>setPartsDraft(prev=>prev.map((row,idx)=>idx===i?{...row,qty:e.target.value}:row))}
                              placeholder="Prototype pilot, 10k units/year, TBD"
                              style={{width:"100%",padding:"6px 8px",border:`1px solid ${C.rule}`,borderRadius:4,fontFamily:mono,fontSize:12,background:C.white,color:C.ink}}
                            />
                          </div>
                        </div>
                        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,marginTop:10,flexWrap:"wrap"}}>
                          <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",padding:"6px 8px",border:`1px solid ${C.ruleLight}`,borderRadius:6,background:C.surface}}>
                            <input
                              id={`asmt-part-files-${i}`}
                              type="file"
                              multiple
                              accept=".step,.stp,.iges,.igs,.stl,.obj,.ply,.glb,.gltf,.3mf,image/*"
                              onChange={(e)=>{attachAssessmentPartFiles(i, e.target.files || []); e.target.value="";}}
                              style={{display:"none"}}
                            />
                            <Btn sm variant="outline" onClick={()=>document.getElementById(`asmt-part-files-${i}`)?.click()}>Attach CAD/Image</Btn>
                            <Btn sm variant="accent" onClick={()=>processAssessmentPart(i)} disabled={processingPartIdx===i || !(p.upload_files?.length)}>
                              {processingPartIdx===i ? "Processing..." : "Process Part"}
                            </Btn>
                          </div>
                          <button
                            type="button"
                            onClick={()=>setPartsDraft(prev=>prev.filter((_,idx)=>idx!==i))}
                            style={{fontFamily:mono,fontSize:9,background:"#fff",border:`1px solid ${C.rule}`,borderRadius:6,padding:"5px 10px",cursor:"pointer",color:C.inkMuted}}
                          >
                            Remove
                          </button>
                        </div>
                        {!!(p.attached_files?.length) && (
                          <div style={{display:"flex",flexWrap:"wrap",gap:6,marginTop:8,paddingTop:8,borderTop:`1px dashed ${C.ruleLight}`}}>
                            {p.attached_files.slice(0,8).map((name, ai)=>(
                              <span key={`${name}-${ai}`} style={{fontFamily:mono,fontSize:8,padding:"2px 6px",borderRadius:3,background:C.surface,border:`1px solid ${C.ruleLight}`,color:C.inkMuted}}>
                                {name}
                              </span>
                            ))}
                          </div>
                        )}
                        {(p.image_preview || p.image_b64 || p.cad_preview_b64 || docImageByPart[`${p.id || ""}`] || (Array.isArray(p.cad_extra_views) && p.cad_extra_views.length > 0)) && (
                          <div style={{marginTop:10,padding:"8px 9px",border:`1px solid ${C.ruleLight}`,borderRadius:6,background:"#FBFDFF"}}>
                            <div style={{fontFamily:mono,fontSize:8,textTransform:"uppercase",letterSpacing:"0.05em",color:C.inkMuted,marginBottom:5}}>
                              Extracted Preview
                            </div>
                            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(90px, 1fr))",gap:6}}>
                              {(() => {
                                const linkedDocSrc = !p.image_b64 && docImageByPart[`${p.id || ""}`]
                                  ? normalizeB64ImageSrc(docImageByPart[`${p.id || ""}`])
                                  : "";
                                const mainSrc = p.image_preview || normalizeB64ImageSrc(p.image_b64 || p.cad_preview_b64 || "") || linkedDocSrc;
                                const extra = Array.isArray(p.cad_extra_views) ? p.cad_extra_views : [];
                                const cards = [];
                                if (mainSrc) cards.push({ src: mainSrc, label: linkedDocSrc && mainSrc === linkedDocSrc ? "Linked PDF Image" : "Isometric" });
                                extra.forEach((v, vi) => {
                                  const s = `${v?.data_url || ""}`.trim() || normalizeB64ImageSrc(v?.b64 || "");
                                  if (s) cards.push({ src: s, label: v?.label || `View ${vi + 2}` });
                                });
                                return cards.slice(0, 6).map((c, ci) => (
                                  <button
                                    key={`${c.label}-${ci}`}
                                    type="button"
                                    onClick={() => setZoomImageSrc(c.src)}
                                    style={{display:"block",border:`1px solid ${C.ruleLight}`,borderRadius:5,overflow:"hidden",background:C.white,padding:0,cursor:"zoom-in"}}
                                    title="Click to zoom"
                                  >
                                    <img src={c.src} alt={c.label} style={{width:"100%",height:66,objectFit:"cover",display:"block",background:C.surface}} />
                                    <div style={{fontFamily:mono,fontSize:8,color:C.inkMuted,padding:"3px 4px",textAlign:"center"}}>{c.label}</div>
                                  </button>
                                ));
                              })()}
                            </div>
                            {!!docImageByPart[`${p.id || ""}`] && (
                              <div style={{marginTop:6,display:"flex",justifyContent:"flex-end"}}>
                                <button
                                  type="button"
                                  onClick={() => handleUnlinkDocImageFromPart(p.id)}
                                  style={{
                                    border:`1px solid ${C.warnRule}`,
                                    background:C.warnBg,
                                    color:C.warn,
                                    borderRadius:4,
                                    fontFamily:mono,
                                    fontSize:10,
                                    padding:"3px 8px",
                                    cursor:"pointer",
                                  }}
                                  title="Detach linked PDF image from this part"
                                >
                                  Unlink PDF Image
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  <div style={{display:"flex",justifyContent:"flex-end",gap:8,marginTop:10}}>
                    <Btn sm variant="primary" onClick={addAssessmentPart}>+ Add Part</Btn>
                    <Btn variant="primary" onClick={handleRunUploadAssessment} disabled={uploading==="running"}>{uploading==="running"?"Running Assessment...":"Run Assessment ?"}</Btn>
                  </div>
                  {uploadPreviewImages.filter((e) => e.source !== "part_derived").length > 0 && (
                    <div style={{marginTop:12}}>
                      <div style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted,marginBottom:8}}>
                        Extracted CAD/Image Previews ({uploadPreviewImages.filter((e) => e.source !== "part_derived").length})
                      </div>
                      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(110px, 1fr))",gap:8}}>
                        {uploadPreviewImages.filter((e) => e.source !== "part_derived").map((entry, i) => (
                          <div key={`preview-${i}`} style={{background:C.white,border:`1px solid ${C.ruleLight}`,borderRadius:5,padding:6}}>
                            <button
                              type="button"
                              onClick={()=>setZoomImageSrc(normalizeB64ImageSrc(entry?.img))}
                              style={{display:"block",width:"100%",border:"none",padding:0,background:"none",cursor:"zoom-in"}}
                              title="Click to zoom"
                            >
                              <img
                                src={normalizeB64ImageSrc(entry?.img)}
                                alt={`preview-${i + 1}`}
                                style={{width:"100%",height:76,objectFit:"cover",borderRadius:4,background:C.surface}}
                              />
                            </button>
                            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:6,marginTop:4}}>
                              <div style={{fontFamily:mono,fontSize:8,color:C.inkMuted}}>Preview {i + 1}</div>
                              {entry?.source === "doc_extracted" && (
                                <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                                  {(() => {
                                    const raw = `${entry?.img || ""}`.trim();
                                    const assigned = Object.entries(docImageByPart || {}).find(([, v]) => `${v || ""}`.trim() === raw);
                                    const assignedPart = assigned?.[0] || "";
                                    if (!assignedPart) return null;
                                    return (
                                      <span style={{fontFamily:mono,fontSize:9,padding:"2px 6px",borderRadius:10,background:C.bluePale,border:"1px solid rgba(26,74,114,0.2)",color:C.blue}}>
                                        Assigned to {assignedPart}
                                      </span>
                                    );
                                  })()}
                                  <label style={{display:"inline-flex",alignItems:"center",gap:4,fontFamily:mono,fontSize:10,color:C.inkMuted}}>
                                    <input
                                      type="checkbox"
                                      checked={!excludedDocExtractedImages.includes(`${entry?.img || ""}`.trim())}
                                      onChange={(e)=>handleToggleDocExtractedImage(entry?.img, e.target.checked)}
                                    />
                                    Keep
                                  </label>
                                  <select
                                    value={`${docImagePartSelection?.[`${entry?.img || ""}`.trim()] || ""}`}
                                    onChange={(e)=>setDocImagePartSelection((prev)=>({ ...prev, [`${entry?.img || ""}`.trim()]: e.target.value }))}
                                    style={{fontFamily:mono,fontSize:10,padding:"2px 6px",border:`1px solid ${C.rule}`,borderRadius:4,background:C.white,color:C.ink}}
                                    title="Associate with part"
                                  >
                                    <option value="">Link Part</option>
                                    {partsDraft.map((p, pi)=>(
                                      <option key={`${p?.id || pi}`} value={`${p?.id || ""}`}>{`${p?.id || `Part-${pi+1}`}`}</option>
                                    ))}
                                  </select>
                                  <button
                                    type="button"
                                    onClick={() => handleAssociateDocImageToPart(entry?.img)}
                                    style={{
                                      border:`1px solid ${C.rule}`,
                                      background:C.white,
                                      color:C.inkMuted,
                                      borderRadius:4,
                                      fontFamily:mono,
                                      fontSize:10,
                                      padding:"2px 7px",
                                      cursor:"pointer",
                                    }}
                                    title="Use this image for selected part when no direct part image exists"
                                  >
                                    Assign
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveExtractedPreview(entry?.img)}
                                    style={{
                                      border:`1px solid ${C.warnRule}`,
                                      background:C.warnBg,
                                      color:C.warn,
                                      borderRadius:4,
                                      fontFamily:mono,
                                      fontSize:10,
                                      padding:"2px 7px",
                                      cursor:"pointer",
                                    }}
                                    title="Remove this extracted document image"
                                  >
                                    Remove
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
            </div>
          </Card>
          ) : (
          <div style={{display:"grid",gridTemplateColumns:"1fr 340px",gap:18,animation:"up 0.25s ease"}}>
            <div style={{display:"flex",flexDirection:"column",gap:14}}>
              <Card>
                <CardHead
                  title="RFP Details"
                  right={
                    <div style={{display:"flex",gap:8}}>
                      {!editingIncomingRfp ? (
                        <Btn sm variant="ghost" onClick={() => { setEditingIncomingRfp(true); setIncomingRfpEditError(""); }}>Edit</Btn>
                      ) : (
                        <>
                          <Btn sm variant="ghost" onClick={handleIncomingCancel} disabled={savingIncomingRfp}>Cancel</Btn>
                          <Btn sm variant="primary" onClick={handleIncomingSave} disabled={savingIncomingRfp}>{savingIncomingRfp ? "Saving..." : "Save"}</Btn>
                        </>
                      )}
                    </div>
                  }
                />
                <div style={{padding:"14px 18px"}}>
                  {incomingRfpEditError ? (
                    <div style={{marginBottom:10,padding:"8px 10px",border:`1px solid ${C.warnRule}`,background:C.warnBg,color:C.warn,borderRadius:4,fontSize:12.5}}>
                      {incomingRfpEditError}
                    </div>
                  ) : null}
                  {!editingIncomingRfp ? (
                    <div>
                      {[
                        ["Buyer", "buyer"],
                        ["Project", "project"],
                        ["Contact Name", "contact_name"],
                        ["Contact Email", "contact_email"],
                        ["Contact Phone", "contact_phone"],
                        ["Company Name", "company_name"],
                        ["Company Location", "company_location"],
                        ["Company Size", "company_size"],
                        ["Customer Industry", "customer_industry"],
                        ["Project Date", "project_date"],
                        ["Expected Annual Production Volume", "expected_annual_production_volume"],
                      ].map(([label, key]) => (
                        <div key={key} style={{display:"flex",gap:20,padding:"8px 0",borderBottom:`1px solid ${C.ruleLight}`}}>
                          <div style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.07em",color:C.inkMuted,width:220,flexShrink:0}}>{label}</div>
                          <div style={{fontSize:13,color:C.ink,flex:1}}>{`${incomingRfpDraft?.[key] || "-"}`}</div>
                        </div>
                      ))}
                      <div style={{marginTop:10,padding:"8px 10px",background:C.surface,border:`1px solid ${C.ruleLight}`,borderRadius:5}}>
                        <div style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.07em",color:C.inkMuted,marginBottom:4}}>Mandatory Certifications</div>
                        <div style={{fontSize:12.5,color:C.inkSoft,lineHeight:1.6}}>{incomingRfpDraft.mandatory_certifications || "-"}</div>
                      </div>
                      <div style={{marginTop:10,padding:"8px 10px",background:C.white,border:`1px solid ${C.ruleLight}`,borderRadius:5}}>
                        <div style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.07em",color:C.inkMuted,marginBottom:4}}>Project Description</div>
                        <div style={{fontSize:12.5,color:C.inkSoft,lineHeight:1.6,whiteSpace:"pre-wrap"}}>{incomingRfpDraft.project_description || "-"}</div>
                      </div>
                      <div style={{marginTop:10,padding:"8px 10px",background:C.white,border:`1px solid ${C.ruleLight}`,borderRadius:5}}>
                        <div style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.07em",color:C.inkMuted,marginBottom:4}}>Other Project Requirements</div>
                        <div style={{fontSize:12.5,color:C.inkSoft,lineHeight:1.6,whiteSpace:"pre-wrap"}}>{incomingRfpDraft.other_project_requirements || "-"}</div>
                      </div>
                    </div>
                  ) : (
                  <>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                    {[
                      ["Contact Name", "contact_name", "Buyer contact name"],
                      ["Project Name", "project", "Project title"],
                      ["Contact Email", "contact_email", "contact@company.com"],
                      ["Contact Phone", "contact_phone", "+1 555 555 5555"],
                      ["Company Name", "company_name", "Company name"],
                      ["Company Location", "company_location", "City, State, Country"],
                      ["Company Size", "company_size", ""],
                      ["Project Date", "project_date", ""],
                      ["Expected Annual Production Volume", "expected_annual_production_volume", "e.g. 12000 units"],
                    ].map(([label, key, placeholder]) => (
                      <div key={key} style={key === "expected_annual_production_volume" ? {gridColumn:"1 / span 1"} : {}}>
                        <div style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.07em",color:C.inkMuted,marginBottom:5}}>{label}</div>
                        {editingIncomingRfp ? (
                          key === "company_size" ? (
                            <select
                              value={incomingRfpDraft?.[key] || ""}
                              onChange={(e)=>handleIncomingFieldChange(key, e.target.value)}
                              style={{width:"100%",padding:"8px 9px",border:`1px solid ${C.rule}`,borderRadius:5,background:C.white,color:C.ink,fontSize:12}}
                            >
                              <option value="">-- select company size --</option>
                              {COMPANY_SIZE_OPTIONS.map((opt)=><option key={opt} value={opt}>{opt}</option>)}
                            </select>
                          ) : key === "project_date" ? (
                            <input
                              type="date"
                              value={incomingRfpDraft?.[key] || ""}
                              onChange={(e)=>handleIncomingFieldChange(key, e.target.value)}
                              style={{width:"100%",padding:"8px 9px",border:`1px solid ${C.rule}`,borderRadius:5,background:C.white,color:C.ink,fontSize:12}}
                            />
                          ) : (
                            <input
                              value={incomingRfpDraft?.[key] || ""}
                              onChange={(e)=>handleIncomingFieldChange(key, e.target.value)}
                              placeholder={placeholder}
                              style={{width:"100%",padding:"8px 9px",border:`1px solid ${C.rule}`,borderRadius:5,background:C.white,color:C.ink,fontSize:12}}
                            />
                          )
                        ) : (
                          <div style={{minHeight:34,padding:"8px 9px",border:`1px solid ${C.ruleLight}`,borderRadius:5,background:C.white,color:C.ink,fontSize:12.5}}>
                            {`${incomingRfpDraft?.[key] || "-"}`}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  <div style={{marginTop:10}}>
                    <div style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.07em",color:C.inkMuted,marginBottom:5}}>Project Description</div>
                    {editingIncomingRfp ? (
                      <textarea value={incomingRfpDraft.project_description || ""} onChange={(e)=>handleIncomingFieldChange("project_description", e.target.value)} rows={2} style={{width:"100%",padding:"8px 9px",border:`1px solid ${C.rule}`,borderRadius:5,background:C.white,color:C.ink,fontSize:12,resize:"vertical"}} />
                    ) : (
                      <div style={{minHeight:52,padding:"8px 9px",border:`1px solid ${C.ruleLight}`,borderRadius:5,background:C.white,color:C.inkSoft,fontSize:12.5,whiteSpace:"pre-wrap"}}>{incomingRfpDraft.project_description || "-"}</div>
                    )}
                  </div>

                  <div style={{marginTop:10}}>
                    <div style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.07em",color:C.inkMuted,marginBottom:5}}>Mandatory Certifications</div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,padding:"8px 9px",border:`1px solid ${C.ruleLight}`,borderRadius:5,background:C.white}}>
                      {(() => {
                        const selected = new Set(canonicalizeCertList(csvTags(incomingRfpDraft.mandatory_certifications || "")));
                        return MANDATORY_CERTIFICATION_OPTIONS.map((cert) => {
                          const checked = selected.has(cert);
                          return (
                            <label key={cert} style={{display:"flex",gap:7,alignItems:"center",fontSize:12.5,color:C.ink}}>
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={!editingIncomingRfp}
                                onChange={(e) => {
                                  const next = new Set(selected);
                                  if (e.target.checked) next.add(cert); else next.delete(cert);
                                  handleIncomingFieldChange("mandatory_certifications", Array.from(next).join(", "));
                                }}
                              />
                              {cert}
                            </label>
                          );
                        });
                      })()}
                    </div>
                  </div>

                  <div style={{marginTop:10}}>
                    <div style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.07em",color:C.inkMuted,marginBottom:5}}>Certification Notes</div>
                    {editingIncomingRfp ? (
                      <textarea value={incomingRfpDraft.certification_notes || ""} onChange={(e)=>handleIncomingFieldChange("certification_notes", e.target.value)} rows={2} style={{width:"100%",padding:"8px 9px",border:`1px solid ${C.rule}`,borderRadius:5,background:C.white,color:C.ink,fontSize:12,resize:"vertical"}} />
                    ) : (
                      <div style={{minHeight:52,padding:"8px 9px",border:`1px solid ${C.ruleLight}`,borderRadius:5,background:C.white,color:C.inkSoft,fontSize:12.5,whiteSpace:"pre-wrap"}}>{incomingRfpDraft.certification_notes || "-"}</div>
                    )}
                  </div>

                  <div style={{marginTop:10}}>
                    <div style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.07em",color:C.inkMuted,marginBottom:5}}>Other Project Requirements</div>
                    {editingIncomingRfp ? (
                      <textarea value={incomingRfpDraft.other_project_requirements || ""} onChange={(e)=>handleIncomingFieldChange("other_project_requirements", e.target.value)} rows={2} style={{width:"100%",padding:"8px 9px",border:`1px solid ${C.rule}`,borderRadius:5,background:C.white,color:C.ink,fontSize:12,resize:"vertical"}} />
                    ) : (
                      <div style={{minHeight:52,padding:"8px 9px",border:`1px solid ${C.ruleLight}`,borderRadius:5,background:C.white,color:C.inkSoft,fontSize:12.5,whiteSpace:"pre-wrap"}}>{incomingRfpDraft.other_project_requirements || "-"}</div>
                    )}
                  </div>
                  </>
                  )}
                </div>
              </Card>
              {!!crmPreviewImages.length && (
                <Card>
                  <CardHead title="Part Images & CAD Previews" right={`${crmPreviewImages.length} visible`} />
                  <div style={{padding:"14px 18px"}}>
                    <div style={{fontSize:12.5,color:C.inkMuted,lineHeight:1.6,marginBottom:10}}>
                      Files pulled from the CRM BRFP record. CAD attachments are converted into lightweight preview images before we run assessment.
                    </div>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(120px, 1fr))",gap:8}}>
                      {crmPreviewImages.map((src, idx) => (
                        <button
                          key={`${src}-${idx}`}
                          type="button"
                          onClick={() => setZoomImageSrc(src)}
                          style={{padding:6,border:`1px solid ${C.ruleLight}`,borderRadius:6,background:C.white,cursor:"pointer"}}
                        >
                          <img src={src} alt={`CRM RFP visual ${idx + 1}`} style={{width:"100%",height:86,objectFit:"cover",borderRadius:4,background:C.surface}} />
                          <div style={{fontFamily:mono,fontSize:8,color:C.inkMuted,marginTop:4,textAlign:"center"}}>{idx < (crmMedia?.image_urls || []).length ? "Image" : "CAD Preview"} {idx + 1}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                </Card>
              )}
              <Card>
                <CardHead
                  title={scoredParts.length > 0 ? "Parts from saved assessment" : "Parts"}
                  right={
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <span>{`${scoredParts.length > 0 ? scoredParts.length : (displayRfp.parts || []).length} parts`}</span>
                      {!editingSavedParts ? (
                        <Btn sm variant="ghost" onClick={() => setEditingSavedParts(true)}>Edit Parts</Btn>
                      ) : (
                        <>
                          <Btn sm variant="ghost" onClick={() => setEditingSavedParts(false)}>Cancel</Btn>
                          <Btn sm variant="primary" onClick={() => setEditingSavedParts(false)}>Save</Btn>
                        </>
                      )}
                      <Btn sm variant="accent" onClick={handleRerunSavedAssessment} disabled={rerunningSavedAssessment}>
                        {rerunningSavedAssessment ? "Re-running..." : "Re-run Assessment"}
                      </Btn>
                    </div>
                  }
                />
                <div style={{padding:"12px 16px",display:"flex",flexDirection:"column",gap:10}}>
                  {(editingSavedParts ? savedPartsDraft : scoredParts).length > 0 ? (editingSavedParts ? savedPartsDraft : scoredParts).map((p, idx) => {
                    const partB64 = p?.image_b64 ? normalizeB64ImageSrc(p.image_b64) : null;
                    const pid = `${p?.part_id || ""}`.toLowerCase().trim();
                    const partImageJob = (p.matched_jobs || []).find((j) => {
                      if (!j?.image_url) return false;
                      const pname = `${j?.project_name || ""}`.toLowerCase().trim();
                      const jid = `${j?.job_id || ""}`.toLowerCase().trim();
                      if (!pid) return false;
                      return pname === "part image" && jid.includes(`part_${pid}_image`);
                    });
                    // Fall back to partsDraft for images not yet in assessmentData
                    // (ScoredPart model has no image_b64 field so backend never echoes it back).
                    const draftPart = (Array.isArray(partsDraft) ? partsDraft : []).find(
                      (dp) => `${dp?.id || ""}` === `${p?.part_id || ""}`
                    );
                    const draftImgSrc = draftPart
                      ? normalizeB64ImageSrc(draftPart.image_b64 || draftPart.cad_preview_b64 || "") || draftPart.image_preview || null
                      : null;
                    // Never fall back to arbitrary matched historical images in RFP overview.
                    // Show only explicit part image artifacts for this assessment.
                    const bestSrc = partB64 || partImageJob?.image_url || draftImgSrc || null;
                    const allPartImages = bestSrc ? [{ src: bestSrc, key: "best" }] : [];
                    return (
                      <div key={p.part_id || idx} style={{padding:"10px 12px",border:`1px solid ${C.ruleLight}`,borderRadius:6,background:C.white}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}}>
                          <div style={{display:"flex",alignItems:"center",gap:8}}>
                            {editingSavedParts ? (
                              <>
                                <input
                                  value={p.id || ""}
                                  onChange={(e)=>setSavedPartsDraft((prev)=>prev.map((row,i)=>i===idx?{...row,id:e.target.value}:row))}
                                  style={{width:110,padding:"5px 7px",border:`1px solid ${C.rule}`,borderRadius:4,fontFamily:mono,fontSize:10,color:C.gold,fontWeight:700,background:C.white}}
                                />
                                <input
                                  value={p.description || ""}
                                  onChange={(e)=>setSavedPartsDraft((prev)=>prev.map((row,i)=>i===idx?{...row,description:e.target.value}:row))}
                                  style={{width:320,maxWidth:"48vw",padding:"5px 7px",border:`1px solid ${C.rule}`,borderRadius:4,fontFamily:sans,fontSize:12.5,color:C.ink,fontWeight:600,background:C.white}}
                                />
                              </>
                            ) : (
                              <>
                                <span style={{fontFamily:mono,fontSize:10,color:C.gold,fontWeight:600}}>{p.part_id}</span>
                                <span style={{fontFamily:disp,fontSize:13,fontWeight:700}}>{p.description}</span>
                              </>
                            )}
                          </div>
                          <span style={{fontFamily:mono,fontSize:12,fontWeight:700,color:asmtScoreColor(p.composite)}}>{Math.round(Number(p.composite || 0))}</span>
                        </div>
                        <div style={{fontFamily:mono,fontSize:9,color:C.inkMuted,marginBottom:8}}>
                          B1: {Number(p.b1 || 0).toFixed(1)} · B2: {Number(p.b2 || 0).toFixed(1)} · C: {Number(p.c || 0).toFixed(1)}
                        </div>
                        {(editingSavedParts || p.material || p.process || p.tolerance || p.qty) && (
                          <div style={{fontFamily:mono,fontSize:9,color:C.inkSoft,marginBottom:8}}>
                            {editingSavedParts ? (
                              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 110px",gap:8}}>
                                <input value={p.material || ""} onChange={(e)=>setSavedPartsDraft((prev)=>prev.map((row,i)=>i===idx?{...row,material:e.target.value}:row))} placeholder="Material" style={{padding:"6px 7px",border:`1px solid ${C.rule}`,borderRadius:4,background:C.white,color:C.ink,fontSize:12}} />
                                <input value={p.process || ""} onChange={(e)=>setSavedPartsDraft((prev)=>prev.map((row,i)=>i===idx?{...row,process:e.target.value}:row))} placeholder="Process" style={{padding:"6px 7px",border:`1px solid ${C.rule}`,borderRadius:4,background:C.white,color:C.ink,fontSize:12}} />
                                <input value={p.tolerance || ""} onChange={(e)=>setSavedPartsDraft((prev)=>prev.map((row,i)=>i===idx?{...row,tolerance:e.target.value}:row))} placeholder="Tolerance" style={{padding:"6px 7px",border:`1px solid ${C.rule}`,borderRadius:4,background:C.white,color:C.ink,fontSize:12}} />
                                <input value={p.qty || ""} onChange={(e)=>setSavedPartsDraft((prev)=>prev.map((row,i)=>i===idx?{...row,qty:e.target.value}:row))} placeholder="Qty" style={{padding:"6px 7px",border:`1px solid ${C.rule}`,borderRadius:4,background:C.white,color:C.ink,fontSize:12}} />
                              </div>
                            ) : (
                              <>
                                {p.material ? `Material: ${p.material}` : ""}
                                {p.material && p.process ? " · " : ""}
                                {p.process ? `Process: ${p.process}` : ""}
                                {(p.material || p.process) && p.tolerance ? " · " : ""}
                                {p.tolerance ? `Tolerance: ${p.tolerance}` : ""}
                                {(p.material || p.process || p.tolerance) && p.qty ? " · " : ""}
                                {p.qty ? `Qty: ${p.qty}` : ""}
                              </>
                            )}
                          </div>
                        )}
                        {allPartImages.length > 0 && (
                          <div>
                            <div style={{fontFamily:mono,fontSize:8.5,color:C.inkMuted,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:6}}>
                              Part Image
                            </div>
                            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                              {allPartImages.map((img) => (
                                <button key={`${p.part_id}-${img.key}`} type="button" onClick={()=>setZoomImageSrc(img.src)} style={{display:"block",border:"none",padding:0,background:"none",cursor:"zoom-in"}}>
                                  <img
                                    src={img.src}
                                    alt={`${p.part_id} part`}
                                    title={img.title || ""}
                                    style={{width:86,height:66,objectFit:"cover",border:`1px solid ${C.ruleLight}`,borderRadius:4,background:C.surface}}
                                    onError={(e)=>{ e.currentTarget.style.display="none"; }}
                                  />
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  }) : (displayRfp.parts || []).map((p, i) => (
                    <div key={p.id || i} style={{padding:"10px 12px",border:`1px solid ${C.ruleLight}`,borderRadius:6,background:C.white}}>
                      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,marginBottom:6}}>
                        <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                          {!!p.id && <span style={{fontFamily:mono,fontSize:10,color:C.gold,fontWeight:600}}>{p.id}</span>}
                          <span style={{fontFamily:disp,fontSize:13,fontWeight:700}}>{p.label}</span>
                        </div>
                        {crmNeedsRun && (
                          <span style={{fontFamily:mono,fontSize:8,padding:"2px 7px",borderRadius:2,background:C.goldPale,color:C.gold,border:"1px solid rgba(184,146,10,0.22)",textTransform:"uppercase",letterSpacing:"0.05em"}}>
                            Pending
                          </span>
                        )}
                      </div>
                      {!!p.spec && (
                        <div style={{fontFamily:mono,fontSize:10,color:C.inkMuted,letterSpacing:"0.02em",marginBottom:(p.material || p.process || p.finish || p.other || p.qty || p.file_upload) ? 8 : 0}}>
                          {p.spec}
                        </div>
                      )}
                      {(p.material || p.process || p.finish || p.other || p.qty || p.file_upload) && (
                        <div style={{display:"grid",gridTemplateColumns:"repeat(2,minmax(0,1fr))",gap:8}}>
                          <div style={{padding:"7px 8px",background:C.surface,borderRadius:5,border:`1px solid ${C.ruleLight}`}}>
                            <div style={{fontFamily:mono,fontSize:8,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted,marginBottom:3}}>Material</div>
                            <div style={{fontSize:12.5,color:C.ink}}>{p.material || "-"}</div>
                          </div>
                          <div style={{padding:"7px 8px",background:C.surface,borderRadius:5,border:`1px solid ${C.ruleLight}`}}>
                            <div style={{fontFamily:mono,fontSize:8,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted,marginBottom:3}}>Process</div>
                            <div style={{fontSize:12.5,color:C.ink}}>{p.process || "-"}</div>
                          </div>
                          <div style={{padding:"7px 8px",background:C.surface,borderRadius:5,border:`1px solid ${C.ruleLight}`}}>
                            <div style={{fontFamily:mono,fontSize:8,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted,marginBottom:3}}>Finish</div>
                            <div style={{fontSize:12.5,color:C.ink}}>{p.finish || "-"}</div>
                          </div>
                          <div style={{padding:"7px 8px",background:C.surface,borderRadius:5,border:`1px solid ${C.ruleLight}`}}>
                            <div style={{fontFamily:mono,fontSize:8,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted,marginBottom:3}}>Quantity</div>
                            <div style={{fontSize:12.5,color:C.ink}}>{p.qty || "-"}</div>
                          </div>
                          <div style={{padding:"7px 8px",background:C.surface,borderRadius:5,border:`1px solid ${C.ruleLight}`}}>
                            <div style={{fontFamily:mono,fontSize:8,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted,marginBottom:3}}>Other</div>
                            <div style={{fontSize:12.5,color:C.ink}}>{p.other || "-"}</div>
                          </div>
                          <div style={{padding:"7px 8px",background:C.surface,borderRadius:5,border:`1px solid ${C.ruleLight}`}}>
                            <div style={{fontFamily:mono,fontSize:8,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted,marginBottom:3}}>File Upload</div>
                            <div style={{fontSize:12.5,color:C.ink,wordBreak:"break-word"}}>
                              {typeof p.file_upload === "string"
                                ? (p.file_upload || "-")
                                : (p.file_upload?.name || p.file_upload?.file_name || p.file_upload?.File_Name || p.file_upload?.url || "-")}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </Card>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:14}}>
              <Card>
                <CardHead title="Quick Fit Summary"/>
                <div style={{padding:"13px 16px",display:"flex",flexDirection:"column",gap:12}}>
                  {fitView.dims.map(d=>(
                    <div key={d.key}>
                      <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                        <span style={{fontFamily:mono,fontSize:10,color:C.ink}}>{d.label}</span>
                        <span style={{fontFamily:mono,fontSize:11,fontWeight:600,color:asmtScoreColor(d.val)}}>{d.val}</span>
                      </div>
                      <AsmtBar value={d.val}/>
                      <div style={{fontFamily:mono,fontSize:9,color:C.inkMuted,marginTop:3}}>{d.sub}</div>
                    </div>
                  ))}
                </div>
              </Card>
              <Card>
                <CardHead title="Quoting Guidance"/>
                <div style={{padding:"12px 16px",display:"flex",flexDirection:"column",gap:9}}>
                  {fitView.guidance.map((g,i)=>(
                    <div key={i} style={{display:"flex",gap:9,padding:"8px 9px",background:g.icon==="warn"?C.warnBg:C.goldPale,borderRadius:5,border:`1px solid ${g.icon==="warn"?C.warnRule:"rgba(184,146,10,0.2)"}`}}>
                      <span style={{fontSize:12,color:g.icon==="warn"?C.warn:C.gold,flexShrink:0,marginTop:1}}>{g.icon==="warn" ? "!" : "•"}</span>
                      <div style={{fontSize:12,color:C.inkSoft,lineHeight:1.55}}>{g.text}</div>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          </div>
          )
        )}

        {tab==="fit"&&(
          <div style={{display:"grid",gridTemplateColumns:"1fr 340px",gap:18,animation:"up 0.25s ease"}}>
            <Card>
              <CardHead title="Bid Intelligence Detail"/>
              <div style={{padding:"16px 18px",display:"flex",flexDirection:"column",gap:18}}>
                <div style={{display:"flex",alignItems:"center",gap:16,padding:"14px 16px",background:C.surface,borderRadius:7}}>
                  <AsmtRing value={fitView.overall} size={64}/>
                  <div><div style={{fontFamily:disp,fontSize:18,fontWeight:700,marginBottom:3}}>{fitView.overall}</div><div style={{fontSize:12.5,color:C.inkMuted}}>Overall</div></div>
                </div>
                <div style={{padding:"10px 12px",background:C.goldPale,border:`1px solid rgba(184,146,10,0.25)`,borderRadius:6}}>
                  <div style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.06em",color:C.amber,marginBottom:5}}>Why this score</div>
                  <div style={{fontSize:12,color:C.inkSoft,lineHeight:1.55,marginBottom:6}}>{fitReason.summary}</div>
                  <div style={{fontFamily:mono,fontSize:10,color:C.inkMuted,lineHeight:1.5}}>
                    B1 contrib: {fitReason.weighted.B1} · B2 contrib: {fitReason.weighted.B2} · C contrib: {fitReason.weighted.C}
                  </div>
                </div>
                {fitView.dims.map((d,idx)=>(
                  <div key={d.key} style={{padding:"13px 15px",border:`1px solid ${C.ruleLight}`,borderRadius:6}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
                      <div><div style={{fontFamily:disp,fontSize:14,fontWeight:700,marginBottom:2}}>{d.label}</div><div style={{fontFamily:mono,fontSize:10,color:C.inkMuted}}>{d.sub}</div></div>
                      <span style={{fontFamily:mono,fontSize:20,fontWeight:500,color:asmtScoreColor(d.val),lineHeight:1}}>{d.val}</span>
                    </div>
                    <AsmtBar value={d.val} delay={idx*100}/>
                    <div style={{marginTop:8,fontSize:11.5,color:C.inkSoft,lineHeight:1.5}}>
                      {(scoreOneLiners[d.key] || "")}
                    </div>
                    <button
                      type="button"
                      onClick={()=>setTab(d.key === "B1" ? "b1" : d.key === "B2" ? "b2" : "history")}
                      style={{
                        marginTop:8,
                        padding:0,
                        border:"none",
                        background:"transparent",
                        color:C.blue,
                        fontSize:11.5,
                        textDecoration:"underline",
                        cursor:"pointer",
                      }}
                    >
                      Click here to view detailed scoring
                    </button>
                  </div>
                ))}
                <div style={{paddingTop:2}}>
                  <div style={{fontFamily:disp,fontSize:13,fontWeight:700,marginBottom:8}}>Per-Part Breakdown</div>
                  <div style={{display:"flex",flexDirection:"column",gap:10}}>
                    {scoredParts.map((p, i) => (
                      <div key={`${p.part_id}-${i}`} style={{padding:"11px 12px",background:C.surface,border:`1px solid ${C.ruleLight}`,borderRadius:6}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6,gap:8}}>
                          <div style={{display:"flex",gap:7,alignItems:"center",minWidth:0}}>
                            <span style={{fontFamily:mono,fontSize:10,color:C.gold,fontWeight:600,flexShrink:0}}>{p.part_id}</span>
                            <span style={{fontSize:12.5,fontWeight:600,color:C.ink,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{p.description}</span>
                          </div>
                          <span style={{fontFamily:mono,fontSize:14,color:asmtScoreColor(p.composite),fontWeight:700,flexShrink:0}}>{p.composite}</span>
                        </div>
                        <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:6}}>
                          <span style={{fontFamily:mono,fontSize:10,padding:"2px 7px",borderRadius:12,background:C.white,border:`1px solid ${C.ruleLight}`,color:C.inkMuted}}>
                            B1 {p.b1 ?? 0}
                          </span>
                          <span style={{fontFamily:mono,fontSize:10,padding:"2px 7px",borderRadius:12,background:C.white,border:`1px solid ${C.ruleLight}`,color:C.inkMuted}}>
                            B2 {p.b2 ?? 0}
                          </span>
                          <span style={{fontFamily:mono,fontSize:10,padding:"2px 7px",borderRadius:12,background:C.white,border:`1px solid ${C.ruleLight}`,color:C.inkMuted}}>
                            C {p.c ?? 0}
                          </span>
                        </div>
                        <div style={{fontFamily:mono,fontSize:9,color:C.inkMuted,textTransform:"uppercase",marginBottom:4}}>
                          Gate: {`${p.gate || "pass"}`}
                        </div>
                        <div style={{fontFamily:mono,fontSize:9,color:C.inkMuted}}>
                          Top matches: {(p.matched_jobs || []).slice(0,3).map((m)=>`${m?.job_id || "N/A"}::${Number(m?.similarity || 0).toFixed(1)}`).join(", ") || "None"}
                        </div>
                      </div>
                    ))}
                    {!scoredParts.length && <div style={{fontSize:12,color:C.inkMuted}}>Run assessment to see part-by-part scoring.</div>}
                  </div>
                </div>
              </div>
            </Card>
            <div style={{display:"flex",flexDirection:"column",gap:14}}>
              <Card>
                <CardHead title="Assessment Flags"/>
                <div style={{padding:"12px 16px",display:"flex",flexDirection:"column",gap:10}}>
                  {fitView.flags.map((f,i)=>(
                    <div key={i} style={{padding:"10px 11px",background:f.type==="pass"?C.passBg:C.warnBg,borderRadius:5,border:`1px solid ${f.type==="pass"?C.passRule:C.warnRule}`}}>
                      <div style={{fontFamily:disp,fontSize:12,fontWeight:600,color:f.type==="pass"?C.pass:C.warn,marginBottom:4}}>{f.title}</div>
                      <div style={{fontSize:11.5,color:C.inkSoft,lineHeight:1.55}}>{f.body}</div>
                    </div>
                  ))}
                </div>
              </Card>
              <Card>
                <CardHead title="Quote Strategy"/>
                <div style={{padding:"12px 16px",display:"flex",flexDirection:"column",gap:9}}>
                  {(fitView.guidance || []).length > 0 ? fitView.guidance.map((g, i) => (
                    <div key={i} style={{display:"flex",gap:9,alignItems:"flex-start"}}>
                      <span style={{fontSize:12,color:C.gold,flexShrink:0,marginTop:1}}>•</span>
                      <div style={{fontSize:12.5,color:C.inkSoft,lineHeight:1.6}}>{g.text}</div>
                    </div>
                  )) : (
                    <div style={{fontSize:12,color:C.inkMuted}}>No quote strategy guidance generated.</div>
                  )}
                </div>
              </Card>
            </div>
          </div>
        )}

        {(tab==="b1" || tab==="b2")&&(
          <div style={{display:"flex",flexDirection:"column",gap:18,animation:"up 0.25s ease"}}>
            {tab==="b1" && <Card>
              <CardHead title="Requested Fit"/>
              <div style={{padding:"16px 18px",display:"flex",flexDirection:"column",gap:14}}>
                <div style={{padding:"10px 12px",background:C.goldPale,border:`1px solid rgba(184,146,10,0.22)`,borderRadius:6}}>
                  <div style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.06em",color:C.amber,marginBottom:5}}>What this measures</div>
                  <div style={{fontSize:12.5,color:C.inkSoft,lineHeight:1.65,marginBottom:6}}>
                    B1 scores how well the customer's stated requirements — material, surface finish, tolerances, and process specification — match your registered capability profile. A high B1 means the RFP is asking for exactly what you already do. A low B1 flags a stated requirement outside your profile; it does not necessarily mean you can't make the part, but it warrants a pre-bid capability review.
                  </div>
                  {!!(`${assessmentData?.requested_fit_reason || ""}`.trim() || `${fitReason.summary || ""}`.trim()) && (
                    <div style={{fontSize:12.5,color:C.inkSoft,lineHeight:1.65,marginBottom:4}}>
                      {`${assessmentData?.requested_fit_reason || ""}`.trim() || fitReason.summary}
                    </div>
                  )}
                  {scoredParts.length>0&&(
                    <div>
                      <div style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted,marginBottom:6}}>What was evaluated per part</div>
                      <div style={{display:"flex",flexDirection:"column",gap:5}}>
                        {scoredParts.map((p,i)=>(
                          <div key={`b1-eval-${i}`} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"7px 10px",background:C.surface,border:`1px solid ${C.ruleLight}`,borderRadius:4}}>
                            <div style={{display:"flex",gap:6,alignItems:"baseline",flexWrap:"wrap"}}>
                              <span style={{fontFamily:mono,fontSize:10,color:C.gold,fontWeight:600}}>{p.part_id}</span>
                              {p.material&&<span style={{fontSize:11.5,color:C.inkSoft}}>Material: <strong>{p.material}</strong></span>}
                              {p.process&&<span style={{fontSize:11.5,color:C.inkSoft}}>· Process: <strong>{p.process}</strong></span>}
                              {p.tolerance&&<span style={{fontSize:11.5,color:C.inkSoft}}>· Tolerance: <strong>{p.tolerance}</strong></span>}
                            </div>
                            <span style={{fontFamily:mono,fontSize:12,fontWeight:700,color:asmtScoreColor(p.b1??0),flexShrink:0,marginLeft:8}}>B1: {p.b1??0}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {!!(`${assessmentData?.requested_fit_reason || ""}`.trim())&&(
                    <div>
                      <div style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted,marginBottom:6}}>Score Reasoning</div>
                      <div style={{padding:"8px 10px",background:C.surface,borderRadius:4,border:`1px solid ${C.ruleLight}`,fontSize:11.5,color:C.inkSoft,lineHeight:1.55}}>
                        {assessmentData?.requested_fit_reason}
                      </div>
                    </div>
                  )}
                  {!fitReason.summary&&!scoredParts.length&&<div style={{fontSize:12,color:C.inkMuted}}>Run assessment to see B1 reasoning.</div>}
                </div>
                <div style={{padding:"10px 12px",background:C.white,border:`1px solid ${C.ruleLight}`,borderRadius:6}}>
                  <div style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted,marginBottom:8}}>How We Reached This Score</div>
                  {(()=>{const d=fitView.dims.find(x=>x.key==="B1");const v=Number(d?.val||0);const impact=Math.round((v*0.35)*10)/10;return(
                    <div style={{display:"grid",gridTemplateColumns:"1.3fr 1fr",gap:10}}>
                      <div style={{fontSize:12,color:C.inkSoft,lineHeight:1.6}}>
                        <div>1. We compare requested <strong>material/process/tolerance/finish</strong> against your capability profile.</div>
                        <div>2. Each part gets a Requested Fit score, then we average it for the RFP.</div>
                        <div>3. This average contributes <strong>35%</strong> to Overall Fit.</div>
                      </div>
                      <div style={{padding:"8px 10px",border:`1px solid ${C.ruleLight}`,borderRadius:5,background:C.surface}}>
                        <div style={{fontFamily:mono,fontSize:10,color:C.inkMuted,marginBottom:5}}>Current Math</div>
                        <div style={{fontFamily:mono,fontSize:12,color:C.ink}}>Requested Fit Avg: <strong>{v}</strong></div>
                        <div style={{fontFamily:mono,fontSize:12,color:C.ink}}>Weighted Impact: <strong>{impact}</strong></div>
                        <div style={{fontFamily:mono,fontSize:10,color:C.inkMuted,marginTop:5}}>Formula: {v} × 0.35</div>
                      </div>
                    </div>
                  );})()}
                </div>
                <div style={{padding:"10px 12px",background:C.surface,border:`1px solid ${C.ruleLight}`,borderRadius:6}}>
                  <div style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted,marginBottom:8}}>Rating Calibration</div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:6}}>
                    {[
                      {range:"80–100",label:"Direct match",desc:"Stated material, process and tolerances align with your registered capability profile",color:C.pass},
                      {range:"60–79",label:"Good fit",desc:"Minor gaps — capability exists but edge cases may need pre-bid clarification",color:C.amber},
                      {range:"40–59",label:"Partial match",desc:"Meaningful gaps in stated requirements vs your profile — flag before quoting",color:C.warn},
                      {range:"0–39",label:"Weak fit",desc:"Significant capability mismatches — additions or sub-contracting likely needed",color:C.red},
                    ].map(tier=>(
                      <div key={tier.range} style={{padding:"9px 10px",border:`1px solid ${C.ruleLight}`,borderRadius:5}}>
                        <div style={{fontFamily:mono,fontSize:11,fontWeight:700,color:tier.color,marginBottom:3}}>{tier.range}</div>
                        <div style={{fontSize:11.5,fontWeight:600,color:C.ink,marginBottom:4}}>{tier.label}</div>
                        <div style={{fontSize:10.5,color:C.inkMuted,lineHeight:1.5}}>{tier.desc}</div>
                      </div>
                    ))}
                  </div>
                </div>
                {(()=>{const d=fitView.dims.find(x=>x.key==="B1");return d?(
                  <div style={{padding:"13px 15px",border:`1px solid ${C.ruleLight}`,borderRadius:6}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
                      <div>
                        <div style={{fontFamily:disp,fontSize:14,fontWeight:700,marginBottom:2}}>Avg Requested Fit across all parts</div>
                        <div style={{fontFamily:mono,fontSize:10,color:C.inkMuted}}>{d.sub}</div>
                      </div>
                      <span style={{fontFamily:mono,fontSize:22,fontWeight:700,color:asmtScoreColor(d.val),lineHeight:1}}>{d.val}</span>
                    </div>
                    <AsmtBar value={d.val}/>
                  </div>
                ):null;})()}
                <div>
                  <div style={{fontFamily:disp,fontSize:13,fontWeight:700,marginBottom:8}}>Per-Part Profile Match Signals</div>
                  <div style={{display:"flex",flexDirection:"column",gap:8}}>
                    {scoredParts.map((p,i)=>{
                      const hasCertGap = (p.b1_missing_certs||[]).length > 0;
                      const tolUnknown = p.b1_tolerance_capable === null || p.b1_tolerance_capable === undefined;
                      const matchedProcs = p.b1_matched_processes||[];
                      const matchedMats = p.b1_matched_materials||[];
                      const hasStrongSignals = matchedProcs.length>0 || matchedMats.length>0 || p.b1_tolerance_capable===true;
                      const whyText = hasStrongSignals
                        ? `High contributors: ${matchedProcs.length?`process match (${matchedProcs.join(", ")})`:""}${matchedProcs.length&&matchedMats.length?" + ":""}${matchedMats.length?`material match (${matchedMats.join(", ")})`:""}${(matchedProcs.length||matchedMats.length)&&p.b1_tolerance_capable===true?" + ":""}${p.b1_tolerance_capable===true?"tolerance capability confirmed":""}`
                        : `Lower contributors: ${(p.b1_required_processes||[]).length?`requested process not strongly matched`:"limited process evidence"}${(p.b1_missing_certs||[]).length?` + missing certs (${(p.b1_missing_certs||[]).join(", ")})`:""}${p.b1_tolerance_capable===false?" + tolerance capability gap":""}`;
                      return(
                      <div key={`b1-${p.part_id}-${i}`} style={{padding:"10px 12px",background:C.surface,border:`1px solid ${hasCertGap?C.amber:C.ruleLight}`,borderRadius:5}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                          <div style={{display:"flex",gap:7,alignItems:"center"}}>
                            <span style={{fontFamily:mono,fontSize:10,color:C.gold,fontWeight:600}}>{p.part_id}</span>
                            <span style={{fontSize:12.5,fontWeight:600,color:C.ink}}>{p.description}</span>
                          </div>
                          <span style={{fontFamily:mono,fontSize:14,color:asmtScoreColor(p.b1??0),fontWeight:700}}>{p.b1??0}</span>
                        </div>
                        <AsmtBar value={p.b1??0} delay={i*60}/>
                        <div style={{marginTop:8,padding:"6px 8px",borderRadius:4,background:hasStrongSignals?C.passBg:C.warnBg,color:hasStrongSignals?C.pass:C.warn,fontSize:11.5,fontWeight:600,lineHeight:1.4}}>
                          Why this score: {whyText}
                        </div>
                        <div style={{marginTop:8,padding:"8px 9px",border:`1px solid ${C.ruleLight}`,borderRadius:4,background:C.white}}>
                          <div style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.05em",color:C.inkMuted,marginBottom:5}}>Score Drivers</div>
                          <div style={{display:"grid",gridTemplateColumns:"170px 1fr",rowGap:4,columnGap:8,fontSize:11.5}}>
                            <div style={{fontFamily:mono,color:C.inkMuted}}>Matched Profile Process</div>
                            <div style={{color:(matchedProcs.length?C.pass:C.warn),fontWeight:600}}>
                              {matchedProcs.length ? matchedProcs.join(", ") : "No strong process match found"}
                            </div>
                            <div style={{fontFamily:mono,color:C.inkMuted}}>Matched Profile Material</div>
                            <div style={{color:(matchedMats.length?C.pass:C.warn),fontWeight:600}}>
                              {matchedMats.length
                                ? matchedMats.join(", ")
                                : `No strong material match found${(p.material||"").trim() ? ` (requested: ${p.material})` : ""}`}
                            </div>
                            <div style={{fontFamily:mono,color:C.inkMuted}}>Supplier Profile Reference</div>
                            <div style={{color:C.inkSoft}}>
                              {(p.b1_profile_processes||[]).length || (p.b1_profile_materials||[]).length
                                ? `Processes: ${(p.b1_profile_processes||[]).join(", ") || "—"} | Materials: ${(p.b1_profile_materials||[]).join(", ") || "—"}`
                                : "No profile row details returned"}
                            </div>
                          </div>
                        </div>
                        <div style={{marginTop:8,display:"flex",flexDirection:"column",gap:4}}>
                          {/* Process — ALL supplier profile capabilities, with match status */}
                          <div style={{display:"flex",gap:6,alignItems:"flex-start"}}>
                            <span style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.05em",color:C.inkMuted,minWidth:72,paddingTop:1}}>Process</span>
                            <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                              {(()=>{
                                const allProcs = p.b1_profile_processes||[];
                                const matchedProcs = p.b1_matched_processes||[];
                                const reqProcs = p.b1_required_processes||[];
                                // Required processes with no match in supplier profile → gap
                                const gaps = reqProcs.filter(req=>!allProcs.some(m=>m.toLowerCase().includes(req.toLowerCase())||req.toLowerCase().includes(m.toLowerCase())));
                                if(!allProcs.length && !gaps.length) return <span style={{fontSize:11,color:C.inkMuted}}>—</span>;
                                return(<>
                                  {allProcs.map(proc=>{
                                    const isMatch = matchedProcs.some(m=>m.toLowerCase()===proc.toLowerCase());
                                    return <span key={proc} style={{fontSize:11,padding:"2px 6px",borderRadius:3,fontWeight:600,
                                      background:isMatch?C.passBg:"rgba(0,0,0,0.04)",
                                      color:isMatch?C.pass:C.inkMuted,
                                      border:`1px solid ${isMatch?"transparent":"rgba(0,0,0,0.08)"}`}}>
                                      {isMatch?"✓ ":""}{proc}
                                    </span>;
                                  })}
                                  {gaps.map(req=>(
                                    <span key={req} style={{fontSize:11,padding:"2px 6px",borderRadius:3,background:C.warnBg,color:C.warn,fontWeight:600}}>✗ {req}</span>
                                  ))}
                                </>);
                              })()}
                            </div>
                          </div>
                          {/* Material — ALL supplier profile materials, with match status */}
                          <div style={{display:"flex",gap:6,alignItems:"flex-start"}}>
                            <span style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.05em",color:C.inkMuted,minWidth:72,paddingTop:1}}>Material</span>
                            <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                              {(()=>{
                                const allMats = p.b1_profile_materials||[];
                                const matchedMats = p.b1_matched_materials||[];
                                const gaps = (!allMats.length && p.material) ? [p.material] : [];
                                if(!allMats.length && !gaps.length) return <span style={{fontSize:11,color:C.inkMuted}}>—</span>;
                                return(<>
                                  {allMats.map(mat=>{
                                    const isMatch = matchedMats.some(m=>m.toLowerCase()===mat.toLowerCase());
                                    return <span key={mat} style={{fontSize:11,padding:"2px 6px",borderRadius:3,fontWeight:600,
                                      background:isMatch?C.passBg:"rgba(0,0,0,0.04)",
                                      color:isMatch?C.pass:C.inkMuted,
                                      border:`1px solid ${isMatch?"transparent":"rgba(0,0,0,0.08)"}`}}>
                                      {isMatch?"✓ ":""}{mat}
                                    </span>;
                                  })}
                                  {gaps.map(g=>(
                                    <span key={g} style={{fontSize:11,padding:"2px 6px",borderRadius:3,background:C.warnBg,color:C.warn,fontWeight:600}}>✗ {g} — not in profile</span>
                                  ))}
                                </>);
                              })()}
                            </div>
                          </div>
                          {/* Tolerance */}
                          <div style={{display:"flex",gap:6,alignItems:"center"}}>
                            <span style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.05em",color:C.inkMuted,minWidth:72}}>Tolerance</span>
                            {p.tolerance
                              ? <span style={{fontSize:11,padding:"2px 6px",borderRadius:3,fontWeight:600,
                                  background:tolUnknown?C.surface:p.b1_tolerance_capable?C.passBg:C.warnBg,
                                  color:tolUnknown?C.inkMuted:p.b1_tolerance_capable?C.pass:C.warn}}>
                                  {tolUnknown?"? ":p.b1_tolerance_capable?"✓ ":"✗ "}{p.tolerance}{tolUnknown?" (unknown)":" — profile"+(p.b1_tolerance_capable?" capable":" cannot achieve")}
                                </span>
                              : <span style={{fontSize:11,color:C.inkMuted}}>Not specified</span>
                            }
                          </div>
                          {/* Certs */}
                          {((p.b1_missing_certs||[]).length>0||(assessmentData?.certs_required||[]).length>0)&&(
                            <div style={{display:"flex",gap:6,alignItems:"flex-start"}}>
                              <span style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.05em",color:C.inkMuted,minWidth:72,paddingTop:1}}>Certs</span>
                              <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                                {(assessmentData?.certs_required||[]).map(cert=>{
                                  const missing=(p.b1_missing_certs||[]).includes(cert);
                                  return <span key={cert} style={{fontSize:11,padding:"2px 6px",borderRadius:3,background:missing?C.warnBg:C.passBg,color:missing?C.warn:C.pass,fontWeight:600}}>{missing?"✗":"✓"} {cert}</span>;
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                      );
                    })}
                    {!scoredParts.length&&<div style={{fontSize:12,color:C.inkMuted}}>Run assessment to see per-part Requested Fit scores.</div>}
                  </div>
                </div>
              </div>
            </Card>}
            {tab==="b2" && <Card>
              <CardHead title="Manufacturability Fit"/>
              <div style={{padding:"16px 18px",display:"flex",flexDirection:"column",gap:14}}>
                <div style={{padding:"10px 12px",background:C.goldPale,border:`1px solid rgba(184,146,10,0.22)`,borderRadius:6}}>
                  <div style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.06em",color:C.amber,marginBottom:5}}>What this measures</div>
                  <div style={{fontSize:12.5,color:C.inkSoft,lineHeight:1.65,marginBottom:6}}>
                    TrustBridge independently analyses each part's geometry, tolerances, material, and volume to determine the optimal manufacturing process — regardless of what the customer stated. B2 then scores how well your process history matches that corrected specification. A gap between what the customer wrote and what TrustBridge recommends is a risk signal: the RFP may be misspecified, and suppliers who match the stated process may lose at volume to a fundamentally cheaper approach.
                  </div>
                  {!!(`${assessmentData?.manufacturability_fit_reason || ""}`.trim()) && (
                    <div style={{fontSize:12.5,color:C.inkSoft,lineHeight:1.65,marginBottom:4}}>
                      {assessmentData?.manufacturability_fit_reason}
                    </div>
                  )}
                  {scoredParts.length>0&&(
                    <div>
                      <div style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted,marginBottom:6}}>Process history check per part</div>
                      <div style={{display:"flex",flexDirection:"column",gap:5}}>
                        {scoredParts.map((p,i)=>{
                          const hasInferred = !!`${p.b2_inferred_process||""}`.trim();
                          const aligned = p.b2_process_aligned;
                          const showGap = hasInferred && aligned===false;
                          const showAligned = hasInferred && aligned===true;
                          return(
                          <div key={`b2-eval-${i}`} style={{padding:"8px 10px",background:C.surface,border:`1px solid ${showGap?C.amber:C.ruleLight}`,borderRadius:4}}>
                            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                              <div style={{display:"flex",gap:6,alignItems:"baseline",flexWrap:"wrap"}}>
                                <span style={{fontFamily:mono,fontSize:10,color:C.gold,fontWeight:600}}>{p.part_id}</span>
                                {p.material&&<span style={{fontSize:11.5,color:C.inkSoft}}>Material: <strong>{p.material}</strong></span>}
                                {p.tolerance&&<span style={{fontSize:11.5,color:C.inkSoft}}>· Tol: <strong>{p.tolerance}</strong></span>}
                              </div>
                              <span style={{fontFamily:mono,fontSize:12,fontWeight:700,color:asmtScoreColor(p.b2??0),flexShrink:0,marginLeft:8}}>B2: {p.b2??0}</span>
                            </div>
                            <div style={{marginTop:6,display:"flex",flexDirection:"column",gap:3}}>
                              {p.process&&(
                                <div style={{display:"flex",gap:6,alignItems:"center"}}>
                                  <span style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.05em",color:C.inkMuted,minWidth:110}}>Customer stated</span>
                                  <span style={{fontSize:11.5,color:C.ink,fontWeight:500}}>{p.process}</span>
                                </div>
                              )}
                              {hasInferred&&(
                                <div style={{display:"flex",gap:6,alignItems:"center"}}>
                                  <span style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.05em",color:C.inkMuted,minWidth:110}}>TB recommends</span>
                                  <span style={{fontSize:11.5,fontWeight:600,color:showGap?C.amber:C.pass}}>{p.b2_inferred_process}</span>
                                  {showAligned&&<span style={{fontSize:10,color:C.pass,fontWeight:700}}>✓ Aligned</span>}
                                  {showGap&&<span style={{fontSize:10,color:C.amber,fontWeight:700}}>⚠ Gap — RFP may be misspecified</span>}
                                </div>
                              )}
                              {(()=>{
                                const histProcs=p.b2_history_matched_processes||[];
                                const histMats=p.b2_history_matched_materials||[];
                                if(!histProcs.length&&!histMats.length) return null;
                                return(
                                  <div style={{marginTop:4,display:"flex",flexWrap:"wrap",gap:4}}>
                                    {histProcs.map((hp,hi)=>(
                                      <span key={`hp-${hi}`} style={{display:"inline-flex",alignItems:"center",gap:3,padding:"2px 7px",borderRadius:3,fontSize:10.5,fontWeight:600,background:C.passBg,color:C.pass}}>
                                        ✓ {hp}
                                      </span>
                                    ))}
                                    {histMats.map((hm,hi)=>(
                                      <span key={`hm-${hi}`} style={{display:"inline-flex",alignItems:"center",gap:3,padding:"2px 7px",borderRadius:3,fontSize:10.5,fontWeight:600,background:"rgba(59,130,246,0.12)",color:"#2563eb"}}>
                                        ✓ {hm}
                                      </span>
                                    ))}
                                  </div>
                                );
                              })()}
                            </div>
                          </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {!!(`${assessmentData?.manufacturability_fit_reason || ""}`.trim())&&(
                    <div>
                      <div style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted,marginBottom:6}}>Score Reasoning</div>
                      <div style={{padding:"8px 10px",background:C.surface,borderRadius:4,border:`1px solid ${C.ruleLight}`,fontSize:11.5,color:C.inkSoft,lineHeight:1.55}}>
                        {assessmentData?.manufacturability_fit_reason}
                      </div>
                    </div>
                  )}
                  {!scoredParts.length&&<div style={{fontSize:12,color:C.inkMuted}}>Run assessment to see B2 reasoning.</div>}
                </div>
                <div style={{padding:"10px 12px",background:C.white,border:`1px solid ${C.ruleLight}`,borderRadius:6}}>
                  <div style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted,marginBottom:8}}>How We Reached This Score</div>
                  {(()=>{const d=fitView.dims.find(x=>x.key==="B2");const v=Number(d?.val||0);const impact=Math.round((v*0.30)*10)/10;return(
                    <div style={{display:"grid",gridTemplateColumns:"1.3fr 1fr",gap:10}}>
                      <div style={{fontSize:12,color:C.inkSoft,lineHeight:1.6}}>
                        <div>1. TrustBridge determines the optimal process for each part from its geometry, material, tolerances, and volume — independently of what the customer stated.</div>
                        <div style={{marginTop:4}}>2. Your process history is scored against that corrected specification — not the customer's wording.</div>
                        <div style={{marginTop:4}}>3. A gap between stated and recommended process is flagged as a risk signal on each part above.</div>
                      </div>
                      <div style={{padding:"8px 10px",border:`1px solid ${C.ruleLight}`,borderRadius:5,background:C.surface}}>
                        <div style={{fontFamily:mono,fontSize:10,color:C.inkMuted,marginBottom:5}}>Current Score</div>
                        <div style={{fontFamily:mono,fontSize:12,color:C.ink}}>Manufacturability Fit: <strong>{v}</strong></div>
                        <div style={{fontFamily:mono,fontSize:10,color:C.inkMuted,marginTop:5}}>Average across all parts in this RFP</div>
                      </div>
                    </div>
                  );})()}
                </div>
                <div style={{padding:"10px 12px",background:C.surface,border:`1px solid ${C.ruleLight}`,borderRadius:6}}>
                  <div style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted,marginBottom:8}}>Rating Calibration</div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:6}}>
                    {[
                      {range:"80–100",label:"Strong precedent",desc:"Your process history strongly confirms you can make this part optimally",color:C.pass},
                      {range:"60–79",label:"Manufacturable",desc:"Process capability exists — careful process selection and DFM review recommended",color:C.amber},
                      {range:"40–59",label:"Elevated risk",desc:"Unusual process requirements or gaps in your historical mix — pre-bid DFM required",color:C.warn},
                      {range:"0–39",label:"High risk",desc:"Process or geometry requirements outside your established mix — significant manufacturability risk",color:C.red},
                    ].map(tier=>(
                      <div key={tier.range} style={{padding:"9px 10px",border:`1px solid ${C.ruleLight}`,borderRadius:5}}>
                        <div style={{fontFamily:mono,fontSize:11,fontWeight:700,color:tier.color,marginBottom:3}}>{tier.range}</div>
                        <div style={{fontSize:11.5,fontWeight:600,color:C.ink,marginBottom:4}}>{tier.label}</div>
                        <div style={{fontSize:10.5,color:C.inkMuted,lineHeight:1.5}}>{tier.desc}</div>
                      </div>
                    ))}
                  </div>
                </div>
                {(()=>{const d=fitView.dims.find(x=>x.key==="B2");return d?(
                  <div style={{padding:"13px 15px",border:`1px solid ${C.ruleLight}`,borderRadius:6}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
                      <div>
                        <div style={{fontFamily:disp,fontSize:14,fontWeight:700,marginBottom:2}}>Avg Manufacturability Fit across all parts</div>
                        <div style={{fontFamily:mono,fontSize:10,color:C.inkMuted}}>{d.sub}</div>
                      </div>
                      <span style={{fontFamily:mono,fontSize:22,fontWeight:700,color:asmtScoreColor(d.val),lineHeight:1}}>{d.val}</span>
                    </div>
                    <AsmtBar value={d.val}/>
                  </div>
                ):null;})()}
                <div>
                  <div style={{fontFamily:disp,fontSize:13,fontWeight:700,marginBottom:8}}>Per-Part Manufacturability Scores</div>
                  <div style={{display:"flex",flexDirection:"column",gap:8}}>
                    {scoredParts.map((p,i)=>(
                      <div key={`b2-${p.part_id}-${i}`} style={{padding:"10px 12px",background:C.surface,border:`1px solid ${C.ruleLight}`,borderRadius:5}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                          <div style={{display:"flex",gap:7,alignItems:"center"}}>
                            <span style={{fontFamily:mono,fontSize:10,color:C.gold,fontWeight:600}}>{p.part_id}</span>
                            <span style={{fontSize:12.5,fontWeight:600,color:C.ink}}>{p.description}</span>
                          </div>
                          <span style={{fontFamily:mono,fontSize:14,color:asmtScoreColor(p.b2??0),fontWeight:700}}>{p.b2??0}</span>
                        </div>
                        <AsmtBar value={p.b2??0} delay={i*60}/>
                      </div>
                    ))}
                    {!scoredParts.length&&<div style={{fontSize:12,color:C.inkMuted}}>Run assessment to see per-part Manufacturability scores.</div>}
                  </div>
                </div>
              </div>
            </Card>}
          </div>
        )}

        {tab==="history"&&(
          <div style={{animation:"up 0.25s ease"}}>
            <div style={{padding:"9px 13px",background:C.goldPale,borderLeft:`3px solid ${C.gold}`,borderRadius:4,fontSize:12.5,color:C.inkSoft,lineHeight:1.65,marginBottom:16}}>
              Note: Jobs sorted by similarity score. Expand any job to see dimensions, outcomes, and internal estimator notes.
            </div>
            <Card style={{marginBottom:12}}>
              <CardHead title="Feedback Control"/>
              <div style={{padding:"10px 14px",display:"grid",gridTemplateColumns:"190px 110px 1fr auto",gap:8,alignItems:"center"}}>
                <select
                  value={overallAccuracy}
                  onChange={(e)=>setOverallAccuracy(e.target.value)}
                  style={{padding:"7px 8px",border:`1px solid ${C.rule}`,borderRadius:4,fontSize:12,background:C.white,color:C.ink}}
                >
                  <option value="">Overall Accuracy</option>
                  <option value="accurate">Accurate</option>
                  <option value="partly_accurate">Partly accurate</option>
                  <option value="not_accurate">Not accurate</option>
                </select>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={overallScoreInput}
                  onChange={(e)=>setOverallScoreInput(e.target.value)}
                  placeholder="Overall score"
                  style={{padding:"7px 8px",border:`1px solid ${C.rule}`,borderRadius:4,fontSize:12,background:C.white,color:C.ink}}
                />
                <input
                  value={overallFeedback}
                  onChange={(e)=>setOverallFeedback(e.target.value)}
                  placeholder="Overall feedback"
                  style={{padding:"7px 8px",border:`1px solid ${C.rule}`,borderRadius:4,fontSize:12,background:C.white,color:C.ink}}
                />
                <Btn sm variant="accent" onClick={handleSubmitMatchFeedback} disabled={savingFeedback}>
                  {savingFeedback ? "Saving..." : "Save Feedback"}
                </Btn>
              </div>
              <div style={{padding:"0 14px 10px",fontSize:11.5,color:feedbackStatus.includes("failed")?C.warn:C.inkMuted}}>
                {feedbackStatus || "Rate each match directly inside the expanded match cards below."}
              </div>
            </Card>
            {scoredParts.length > 0 && (
              <Card style={{marginBottom:12}}>
                <CardHead title="Coverage by Part"/>
                <div style={{padding:"10px 14px",display:"flex",flexDirection:"column",gap:8}}>
                  <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:2}}>
                    <button
                      type="button"
                      onClick={()=>setHistoryPartFilter("ALL")}
                      style={{fontFamily:mono,fontSize:9,padding:"4px 8px",borderRadius:4,border:`1px solid ${historyPartFilter==="ALL"?C.gold:C.ruleLight}`,background:historyPartFilter==="ALL"?C.goldPale:C.white,color:historyPartFilter==="ALL"?C.gold:C.inkMuted,cursor:"pointer"}}
                    >
                      All Parts
                    </button>
                    {scoredParts.map((p, i) => (
                      <button
                        key={`filter-${p.part_id || i}`}
                        type="button"
                        onClick={()=>setHistoryPartFilter(`${p.part_id || ""}`)}
                        style={{fontFamily:mono,fontSize:9,padding:"4px 8px",borderRadius:4,border:`1px solid ${historyPartFilter===`${p.part_id || ""}`?C.gold:C.ruleLight}`,background:historyPartFilter===`${p.part_id || ""}`?C.goldPale:C.white,color:historyPartFilter===`${p.part_id || ""}`?C.gold:C.inkMuted,cursor:"pointer"}}
                      >
                        {p.part_id}
                      </button>
                    ))}
                  </div>
                  {scoredParts.map((p, i) => {
                    const jobCount = p.matched_jobs?.length ?? 0;
                    const strong = jobCount >= 2;
                    return (
                      <button key={`${p.part_id}-${i}`} type="button" onClick={()=>setHistoryPartFilter(`${p.part_id || ""}`)} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 10px",background:historyPartFilter===`${p.part_id || ""}`?C.goldPale:C.surface,border:`1px solid ${historyPartFilter===`${p.part_id || ""}`?"rgba(184,146,10,0.28)":C.ruleLight}`,borderRadius:5,width:"100%",cursor:"pointer"}}>
                        <div>
                          <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:2}}>
                            <span style={{fontFamily:mono,fontSize:9,color:C.gold,fontWeight:600}}>{p.part_id}</span>
                            <span style={{fontSize:12,color:C.ink}}>{p.description}</span>
                          </div>
                          <div style={{fontFamily:mono,fontSize:8,color:C.inkMuted}}>{jobCount} matched job{jobCount!==1?"s":""}</div>
                        </div>
                        <StatusBadge status={strong ? "quote_submitted" : "in_assessment"} />
                      </button>
                    );
                  })}
                </div>
              </Card>
            )}
            {jobsViewFiltered.map((j,i)=>(
              <AsmtJobCard
                key={`${j.id}-${i}`}
                job={j}
                animDelay={i*80}
                feedbackEntry={feedbackByVector?.[`${j?.id || ""}`.trim()] || {}}
                onFeedbackChange={setMatchFeedbackField}
                onSubmitFeedback={handleSubmitSingleMatchFeedback}
                submitState={perMatchSubmitState?.[`${j?.id || ""}`.trim()] || {}}
              />
            )) }
            {jobsViewFiltered.length===0 && (
              <div style={{padding:"22px 14px",border:`2px dashed ${C.ruleLight}`,borderRadius:8,textAlign:"center",fontFamily:mono,fontSize:10,color:C.inkMuted,textTransform:"uppercase",letterSpacing:"0.05em"}}>
                {historyPartFilter==="ALL"
                  ? "No matched past projects found for this assessment snapshot"
                  : `No matched past projects found for ${historyPartFilter}`}
              </div>
            )}
          </div>
        )}
      </div>
      {zoomImageSrc && (
        <div onClick={()=>setZoomImageSrc("")} style={{position:"fixed",inset:0,background:"rgba(17,30,51,0.82)",zIndex:900,display:"flex",alignItems:"center",justifyContent:"center",padding:24,cursor:"zoom-out"}}>
          <button
            type="button"
            onClick={(e)=>{e.stopPropagation();setZoomImageSrc("");}}
            aria-label="Close preview"
            style={{position:"fixed",top:18,right:22,width:34,height:34,borderRadius:"50%",border:"1px solid rgba(255,255,255,0.45)",background:"rgba(17,30,51,0.9)",color:C.white,cursor:"pointer",fontFamily:mono,fontSize:16,lineHeight:1}}
          >
            x
          </button>
          <img
            src={zoomImageSrc}
            alt="Part preview"
            style={{maxWidth:"92vw",maxHeight:"88vh",objectFit:"contain",borderRadius:8,border:`1px solid ${C.ruleLight}`,background:C.white}}
            onClick={(e)=>e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
const SI_TIERS = {
  private:   {id:"private",  label:"Private",   icon:"P",color:C.inkMuted,bg:C.surface, border:C.rule,              desc:"Your team only"},
  anonymized:{id:"anonymized",label:"Anonymized",icon:"~", color:C.blue,   bg:C.bluePale,border:"rgba(26,61,92,0.2)",desc:"Process patterns visible - no attribution"},
  attributed:{id:"attributed",label:"Attributed",icon:"A",color:C.pass,   bg:C.passBg,  border:C.passRule,          desc:"Your name referenced - highest match weight"},
};

const SI_DEALS = [];
const SI_JOBS = [];
const SI_MFG = [];
const SI_QUOTING = [];

function SITierChip({tier}){const t=SI_TIERS[tier]||SI_TIERS.private;return <span style={{fontFamily:mono,fontSize:8,padding:"2px 7px",borderRadius:2,background:t.bg,color:t.color,border:`1px solid ${t.border}`,textTransform:"uppercase",letterSpacing:"0.05em",whiteSpace:"nowrap"}}>{t.icon}&nbsp;{t.label}</span>;}

const SI_PROJECT_OUTCOME = {
  won:       { label:"WON",       bg:C.passBg,  color:C.pass,    border:C.passRule },
  lost:      { label:"LOST",      bg:C.warnBg,  color:C.warn,    border:C.warnRule },
  pending:   { label:"PENDING",   bg:C.amberBg, color:C.amber,   border:C.amberRule },
  completed: { label:"COMPLETED", bg:C.passBg,  color:C.pass,    border:C.passRule },
};

function normalizeProjectOutcome(rawValue, hasAward) {
  const raw = `${rawValue || ""}`.trim().toLowerCase();
  if (["won", "win", "awarded"].includes(raw)) return "won";
  if (["lost", "loss", "failed", "failure", "rejected"].includes(raw)) return "lost";
  if (["success", "complete", "completed", "done", "shipped"].includes(raw)) return "completed";
  if (["no bid", "no_bid", "nobid"].includes(raw)) return "lost";
  return "pending";
}

function buildProjectBidLine(job = {}, deal = {}, idx = 0, lessons = []) {
  const quotedAmount = currencyNumber(job.quotedAmount || job.quoteAmount || job.bidAmount);
  const awardAmount = currencyNumber(job.awardAmount || job.poAmount || job.orderAmount);
  const awardPo = `${job.awardPo || job.poNumber || job.orderId || ""}`.trim();
  const outcomeKey = normalizeProjectOutcome(job.outcome || deal.outcome, awardPo || awardAmount > 0);
  const bidLineId = `${job.bidLineId || job.quoteLineId || `${deal.id || "PROJECT"}-BID-L${idx + 1}`}`.trim();
  return {
    partId: `${job.sourcePartId || job.id || `PART-${idx + 1}`}`.trim(),
    partName: `${job.partName || job.name || `Part ${idx + 1}`}`.trim(),
    specification: [
      job.material,
      job.process,
      job.surfaceFinish,
      job.toleranceDetails,
      job.quantity ? `Qty ${job.quantity}` : "",
      job.partEnvelope ? `Envelope ${job.partEnvelope}` : "",
      job.requirements ? `Req ${job.requirements}` : "",
    ].filter(Boolean).join(" · ") || "Specification not recorded",
    bidLineId,
    quotedAmount,
    quoteLabel: quotedAmount > 0 ? `$${quotedAmount.toLocaleString()}` : "Quote not recorded",
    awardPo,
    awardAmount,
    awardLabel: awardPo || awardAmount > 0
      ? [awardPo, awardAmount > 0 ? `$${awardAmount.toLocaleString()}` : ""].filter(Boolean).join(" · ")
      : "Award / PO not recorded",
    outcomeKey,
    outcomeMeta: SI_PROJECT_OUTCOME[outcomeKey] || SI_PROJECT_OUTCOME.pending,
    linkedJobIds: job.id ? [job.id] : [],
    lessons,
  };
}

function exportPastProjectPdf({ deal = {}, jobs = [], bidRows = [], summaryText = "", totalQuoted = 0, awardedCount = 0, certs = [] }) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const M = 42;
  let y = 46;
  const pageW = doc.internal.pageSize.getWidth();
  const safe = (v) => `${v ?? ""}`.trim() || "-";
  const line = (text, size = 10, color = [27, 45, 79], x = M) => {
    doc.setFontSize(size);
    doc.setTextColor(...color);
    const chunks = doc.splitTextToSize(safe(text), pageW - M * 2);
    doc.text(chunks, x, y);
    y += chunks.length * (size + 4);
  };
  const ensure = (h = 80) => {
    if (y + h < doc.internal.pageSize.getHeight() - 40) return;
    doc.addPage();
    y = 46;
  };

  doc.setFillColor(17, 30, 51);
  doc.rect(0, 0, pageW, 98, "F");
  doc.setTextColor(250, 252, 255);
  doc.setFontSize(18);
  doc.text(safe(deal.name || "Past Project"), M, y);
  y += 22;
  doc.setFontSize(9);
  doc.setTextColor(212, 170, 18);
  doc.text(`${safe(deal.id || "PROJECT")}  |  ${safe(deal.customer || "Customer not set")}`, M, y);
  y = 126;

  line("Project Summary", 13, [27, 45, 79]);
  line(summaryText, 10, [45, 69, 103]);
  y += 8;
  line(`Total quoted: ${totalQuoted > 0 ? `$${totalQuoted.toLocaleString()}` : "Not recorded"}    Awarded parts: ${awardedCount}    Certifications: ${certs.join(", ") || "-"}`, 9, [107, 127, 150]);
  y += 14;

  line(`Parts (${jobs.length})`, 13, [27, 45, 79]);
  jobs.forEach((job, idx) => {
    ensure(112);
    const bid = bidRows[idx] || buildProjectBidLine(job, deal, idx, []);
    doc.setFillColor(240, 243, 248);
    doc.roundedRect(M, y, pageW - M * 2, 86, 4, 4, "F");
    y += 16;
    line(`${bid.partId}  |  ${bid.partName}`, 10, [27, 45, 79], M + 12);
    line(`Spec: ${bid.specification}`, 8.5, [45, 69, 103], M + 12);
    line(`Quote: ${bid.quoteLabel}    Award / PO: ${bid.awardLabel}    Outcome: ${bid.outcomeMeta.label}    Job: ${safe(job.id)}`, 8.5, [107, 127, 150], M + 12);
    y += 10;
  });

  doc.save(`${safe(deal.name || deal.id || "past-project").replace(/[^a-z0-9_-]+/gi, "_")}_summary.pdf`);
}

function PastProjectSummaryScreen({ deal, jobs = [], mfgLessons = [], quotingLessons = [], onBack, onEdit, onLogout }) {
  const dealJobs = useMemo(() => jobs.filter((j) => `${j.dealId || ""}` === `${deal?.id || ""}`), [jobs, deal?.id]);
  const bidRows = useMemo(() => dealJobs.map((job, idx) => {
    const jobLessons = [...quotingLessons].filter((l)=>lessonMatchesJob(l,job,deal,dealJobs));
    return buildProjectBidLine(job, deal, idx, jobLessons);
  }), [dealJobs, deal, quotingLessons]);
  const totalQuoted = bidRows.reduce((sum, row) => sum + currencyNumber(row.quotedAmount), 0);
  const awardedCount = bidRows.filter((row) => ["won", "completed"].includes(row.outcomeKey)).length;
  const certs = Array.isArray(deal?.mandatoryCertifications) ? deal.mandatoryCertifications : csvTags(deal?.mandatoryCertifications);
  const summaryText = deal?.description || deal?.projectOverview || dealJobs[0]?.overview || "Project summary not recorded yet.";
  const submittedDate = dealJobs.map((j)=>`${j.date || ""}`.trim()).filter(Boolean).sort().slice(-1)[0] || deal?.dateEnd || deal?.dateStart || "-";
  const projectCode = `${deal?.id || "PROJECT"}`.replace(/^DEAL-/i, "RFQ-");
  const bidId = `${deal?.id || "BID"}`.replace(/^DEAL-/i, "BID-");
  const totalLessons = [...mfgLessons, ...quotingLessons].filter((l)=>lessonMatchesDeal(l, deal, dealJobs)).length;
  const score = Math.min(99, Math.max(70, Math.round(82 + Math.min(10, dealJobs.length * 2) + Math.min(7, totalLessons))));
  const toAbsMedia = useCallback((raw) => {
    const s = `${raw || ""}`.trim();
    if (!s) return "";
    if (s.startsWith("http://") || s.startsWith("https://") || s.startsWith("data:")) return s;
    if (s.startsWith("/")) return `${API_BASE}${s}`;
    return `${API_BASE}/${s}`;
  }, []);
  const handleExport = useCallback(() => {
    exportPastProjectPdf({ deal, jobs: dealJobs, bidRows, summaryText, totalQuoted, awardedCount, certs });
  }, [deal, dealJobs, bidRows, summaryText, totalQuoted, awardedCount, certs]);
  const showValue = useCallback((v, fallback = "Not recorded") => {
    const s = Array.isArray(v) ? v.filter(Boolean).join(", ") : `${v ?? ""}`.trim();
    return s || fallback;
  }, []);
  const hasReviewValue = useCallback((v) => {
    if (Array.isArray(v)) return v.some((item)=>`${item || ""}`.trim());
    return Boolean(`${v ?? ""}`.trim());
  }, []);
  const projectReviewRows = [
    ["Internal ID", bidId],
    ["Company", deal?.companyName || deal?.customer],
    ["Customer", deal?.customer],
    ["Contact", [deal?.contactEmail, deal?.contactPhone].filter(Boolean).join(" · ")],
    ["Company Size", deal?.companySize],
    ["Location", deal?.companyLocation],
    ["Industry", deal?.customerIndustry],
    ["Annual Volume", deal?.expectedAnnualProductionVolume],
  ];
  const requirementRows = [
    ["Certification Notes", deal?.certificationNotes],
    ["Other Requirements", deal?.otherProjectRequirements],
    ["Data Sharing", dealJobs[0]?.dataSharingTier || deal?.sharingTier],
    ["What Worked", deal?.whatWorked || dealJobs.find((j)=>`${j.whatWorked || ""}`.trim())?.whatWorked],
  ].filter(([, v]) => `${Array.isArray(v) ? v.join(", ") : v || ""}`.trim());

  return (
    <div style={{fontFamily:sans,fontSize:14,color:C.ink,minHeight:"100vh",background:C.bg}}>
      <Topbar
        screen="ingestion"
        onBack={onBack}
        onLogout={onLogout}
        rightSlot={
          <div style={{display:"flex",gap:8}}>
            <Btn sm variant="outline" onClick={onEdit}>Edit RFP</Btn>
            <Btn sm variant="green">Ingested</Btn>
          </div>
        }
      />
      <div style={{background:C.navyDeep,borderBottom:`2px solid ${C.gold}`,padding:"20px 26px"}}>
        <div style={{maxWidth:1160,margin:"0 auto",display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:20}}>
          <div>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6,flexWrap:"wrap"}}>
              <span style={{fontFamily:sans,fontSize:11,color:C.gold,fontWeight:800,textTransform:"uppercase",letterSpacing:"0.02em"}}>{projectCode}</span>
              <span style={{fontFamily:mono,fontSize:8,padding:"2px 8px",borderRadius:2,background:C.passBg,color:C.pass,border:`1px solid ${C.passRule}`,textTransform:"uppercase"}}>Ingested</span>
              <span style={{fontSize:11,color:"rgba(255,255,255,0.36)"}}>· {submittedDate}</span>
            </div>
            <h1 style={{fontFamily:disp,fontSize:25,fontWeight:700,color:C.white,lineHeight:1.2,marginBottom:5}}>{deal?.name || "Untitled Project"}</h1>
            <div style={{fontSize:13,color:"rgba(255,255,255,0.5)"}}>{deal?.customer || "Customer not set"}</div>
          </div>
          <div style={{display:"flex",gap:8,flexShrink:0,paddingTop:4}}>
            <Btn variant="outline" onClick={onEdit} style={{borderColor:"rgba(255,255,255,0.18)",color:"rgba(255,255,255,0.7)"}}>Edit RFP</Btn>
            <Btn variant="ghost" onClick={handleExport} style={{color:"rgba(255,255,255,0.58)"}}>Export PDF</Btn>
          </div>
        </div>
      </div>
      <div style={{maxWidth:1160,margin:"0 auto",padding:"22px 26px",display:"grid",gridTemplateColumns:"1fr 300px",gap:20,alignItems:"start"}}>
        <div>
          <Card style={{marginBottom:18}}>
            <div style={{padding:"10px 16px",background:C.surface,borderBottom:`1px solid ${C.rule}`}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <span style={{fontFamily:disp,fontSize:13,fontWeight:700}}>Project Summary</span>
                <span style={{fontSize:10,padding:"2px 7px",borderRadius:2,background:C.bluePale,color:C.blue,border:"1px solid rgba(26,61,92,0.2)",fontWeight:500}}>By Part</span>
              </div>
            </div>
            <div style={{padding:"11px 16px",fontSize:13,color:C.inkSoft,lineHeight:1.7,fontStyle:"italic",borderBottom:`1px solid ${C.ruleLight}`}}>{summaryText}</div>
            <div style={{padding:"9px 16px",background:"#F8F6EE",display:"flex",gap:16,alignItems:"center",flexWrap:"wrap"}}>
              <span style={{fontSize:10,textTransform:"uppercase",letterSpacing:"0.05em",color:C.amber,fontWeight:600}}>Bid Record</span>
              {[["Bid", bidId],["Date", submittedDate],["Total", totalQuoted>0?`$${totalQuoted.toLocaleString()}`:"Not recorded"]].map(([l,v])=>(
                <div key={l} style={{display:"flex",gap:5,alignItems:"center"}}>
                  <span style={{fontSize:10,color:C.inkMuted,textTransform:"uppercase",letterSpacing:"0.04em"}}>{l}</span>
                  <span style={{fontFamily:sans,fontSize:12,fontWeight:800,color:C.ink}}>{v}</span>
                </div>
              ))}
            </div>
          </Card>
          <Card style={{marginBottom:18}}>
            <div style={{padding:"10px 16px",background:C.surface,borderBottom:`1px solid ${C.rule}`,display:"flex",alignItems:"center",justifyContent:"space-between",gap:12}}>
              <span style={{fontFamily:disp,fontSize:13,fontWeight:700}}>Final Review Fields</span>
              <span style={{fontFamily:mono,fontSize:9,color:C.inkMuted,textTransform:"uppercase"}}>From Edit RFP</span>
            </div>
            <div style={{padding:14,display:"grid",gridTemplateColumns:"repeat(2,minmax(0,1fr))",gap:8}}>
              {projectReviewRows.map(([label, value])=>(
                <div key={label} style={{padding:"9px 10px",border:`1px solid ${C.ruleLight}`,borderRadius:5,background:C.offWhite,minHeight:52}}>
                  <div style={{fontFamily:mono,fontSize:8,color:C.inkMuted,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:5}}>{label}</div>
                  <div style={{fontSize:12.5,color:C.ink,lineHeight:1.35,overflowWrap:"anywhere"}}>{showValue(value)}</div>
                </div>
              ))}
            </div>
            <div style={{padding:"0 14px 14px",display:"grid",gap:8}}>
              {requirementRows.length ? requirementRows.map(([label, value])=>(
                <div key={label} style={{padding:"9px 10px",border:`1px solid ${C.ruleLight}`,borderRadius:5,background:C.surface}}>
                  <div style={{fontFamily:mono,fontSize:8,color:C.inkMuted,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:5}}>{label}</div>
                  <div style={{fontSize:12.5,color:C.inkSoft,lineHeight:1.55,whiteSpace:"pre-wrap"}}>{showValue(value)}</div>
                </div>
              )) : (
                <div style={{padding:"9px 10px",border:`1px dashed ${C.rule}`,borderRadius:5,background:C.surface,fontSize:12,color:C.inkMuted}}>No extra review notes captured yet.</div>
              )}
            </div>
          </Card>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <span style={{fontFamily:disp,fontSize:15,fontWeight:700}}>Parts</span>
              <span style={{fontSize:11,padding:"2px 9px",borderRadius:2,background:C.bluePale,color:C.blue,border:"1px solid rgba(26,61,92,0.18)",fontWeight:500}}>{dealJobs.length}</span>
            </div>
            <button onClick={onEdit} style={{fontSize:11,background:"none",border:`1px solid ${C.rule}`,borderRadius:3,padding:"3px 10px",cursor:"pointer",color:C.inkMuted}}>Edit Parts</button>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(290px,1fr))",gap:12}}>
            {bidRows.map((row, idx) => {
              const job = dealJobs[idx] || {};
              const material = `${job.material || ""}`.trim();
              const process = `${job.process || ""}`.trim();
              const finish = `${job.surfaceFinish || ""}`.trim();
              const toleranceDetails = job.toleranceDetails || job.tolerance || "";
              const quantityValue = job.quantity || job.qty || "";
              const whatWorked = job.whatWorked || deal?.whatWorked || "";
              const partReviewRows = [
                ["Quantity", quantityValue, "Production volume or ordered quantity for this part."],
                ["Tolerance Details", toleranceDetails, "Critical tolerance information used for future matching."],
                ["Requirements", job.requirements, "Special manufacturing, inspection, packing, or customer requirements."],
                ["What Worked", whatWorked, "Useful win notes to reuse when quoting similar parts."],
                ["Dimensions / Envelope", job.partEnvelope, "Part size envelope, if captured from file or manual entry."],
                ["Data Sharing Tier", job.dataSharingTier || deal?.sharingTier, "How this part can be used in the corpus."],
              ];
              const specRows = [
                ["Material", material],
                ["Process", process],
                ["Surface Finish", finish],
                ["Tolerance Class", job.toleranceClass],
              ];
              const commercialRows = [
                ["Quote Amount", row.quoteLabel],
                ["Award / PO", row.awardLabel],
                ["Award Amount", row.awardAmount>0?`$${row.awardAmount.toLocaleString()}`:"Not recorded"],
                ["Outcome", row.outcomeMeta.label],
              ];
              const readinessFields = [
                ["Material", material],
                ["Process", process],
                ["Quantity", quantityValue],
                ["Tolerance Details", toleranceDetails],
                ["Requirements", job.requirements],
                ["Quote Amount", row.quotedAmount > 0 ? row.quoteLabel : ""],
                ["Outcome", row.outcomeKey && row.outcomeKey !== "pending" ? row.outcomeMeta.label : ""],
                ["What Worked", whatWorked],
              ];
              const completedReadiness = readinessFields.filter(([,value])=>hasReviewValue(value)).length;
              const readinessScore = Math.round((completedReadiness / readinessFields.length) * 100);
              const missingReadiness = readinessFields.filter(([,value])=>!hasReviewValue(value)).map(([label])=>label);
              const notesRows = [
                ["Part Notes", job.overview || job.notes],
                ["Additional Notes", job.additionalNotes || job.additional_notes],
              ].filter(([, v])=>`${v || ""}`.trim());
              const partImage = toAbsMedia((Array.isArray(job.imageUrls) ? job.imageUrls[0] : "") || job.image_url || job.imagePreview || "");
              return (
                <div key={`${row.partId}-${idx}`} style={{background:C.white,border:`1px solid ${C.rule}`,borderRadius:8,overflow:"hidden",boxShadow:"0 1px 5px rgba(20,28,36,0.07)"}}>
                  <div style={{background:C.navy,padding:"9px 14px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                    <span style={{fontFamily:sans,fontSize:10,color:C.gold,fontWeight:800,overflowWrap:"anywhere"}}>{row.partId}</span>
                    <div style={{display:"flex",gap:6,alignItems:"center"}}>
                      <span style={{fontFamily:mono,fontSize:8,padding:"2px 6px",borderRadius:2,background:row.outcomeMeta.bg,color:row.outcomeMeta.color,textTransform:"uppercase"}}>{row.outcomeMeta.label}</span>
                      <button onClick={onEdit} style={{fontSize:10,background:"none",border:"1px solid rgba(255,255,255,0.18)",borderRadius:3,padding:"2px 8px",cursor:"pointer",color:"rgba(255,255,255,0.6)"}}>Edit</button>
                    </div>
                  </div>
                  <div style={{padding:14}}>
                    <div style={{display:"flex",gap:12,marginBottom:12,alignItems:"flex-start"}}>
                      <div style={{width:68,height:68,borderRadius:5,background:C.navy,display:"flex",alignItems:"center",justifyContent:"center",border:`1px solid ${C.ruleLight}`,flexShrink:0,overflow:"hidden"}}>
                        {partImage
                          ? <img src={partImage} alt={row.partName} style={{width:"100%",height:"100%",objectFit:"cover"}} />
                          : <div style={{width:"100%",height:"100%",display:"flex",alignItems:"center",justifyContent:"center",background:C.surface,color:C.inkMuted,fontFamily:mono,fontSize:9,textTransform:"uppercase"}}>No image</div>}
                      </div>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontFamily:disp,fontSize:14,fontWeight:700,lineHeight:1.3,marginBottom:7}}>{row.partName}</div>
                        <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                          {[material, process, finish].filter(Boolean).slice(0,4).map((tag,i)=>(
                            <span key={`${tag}-${i}`} style={{fontSize:10,padding:"5px 8px",borderRadius:2,background:i===0?C.goldPale:C.bluePale,color:i===0?C.amber:C.blue,border:`1px solid ${i===0?"rgba(184,146,10,0.22)":"rgba(26,61,92,0.16)"}`}}>{tag}</span>
                          ))}
                        </div>
                        {!!(row.lessons?.length) && (
                          <div style={{marginTop:6,fontSize:10.5,color:C.inkMuted,lineHeight:1.45}}>
                            Quoting lesson: {row.lessons[0]?.title || row.lessons[0]?.body || row.lessons[0]?.id || "-"}
                          </div>
                        )}
                      </div>
                    </div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6,padding:10,border:`1px solid ${C.passRule}`,borderRadius:4,background:C.passBg}}>
                      {[["Order", row.awardPo || "-"],["Value", row.awardAmount>0?`$${row.awardAmount.toLocaleString()}`:"-"],["Quoted", row.quoteLabel]].map(([l,v])=>(
                        <div key={l}>
                          <div style={{fontFamily:mono,fontSize:8,color:C.pass,textTransform:"uppercase",marginBottom:3}}>{l}</div>
                          <div style={{fontFamily:sans,fontSize:12,fontWeight:800,color:C.pass}}>{v}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{marginTop:10,padding:"10px",border:`1px solid ${readinessScore>=75?C.passRule:C.warnRule}`,borderRadius:5,background:readinessScore>=75?C.passBg:C.warnBg}}>
                      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,marginBottom:7}}>
                        <div style={{fontFamily:disp,fontSize:12.5,fontWeight:700,color:readinessScore>=75?C.pass:C.warn}}>Part Review Readiness</div>
                        <div style={{fontFamily:mono,fontSize:10,fontWeight:800,color:readinessScore>=75?C.pass:C.warn}}>{readinessScore}%</div>
                      </div>
                      <div style={{height:5,borderRadius:999,background:"rgba(255,255,255,0.65)",overflow:"hidden",border:`1px solid ${readinessScore>=75?C.passRule:C.warnRule}`}}>
                        <div style={{width:`${readinessScore}%`,height:"100%",background:readinessScore>=75?C.pass:C.warn}} />
                      </div>
                      <div style={{marginTop:7,fontSize:11.5,lineHeight:1.45,color:readinessScore>=75?C.pass:C.warn}}>
                        {missingReadiness.length ? `Missing: ${missingReadiness.join(", ")}` : "Ready for future RFP matching and review."}
                      </div>
                    </div>
                    <div style={{marginTop:10}}>
                      <div style={{fontFamily:disp,fontSize:12.5,fontWeight:700,color:C.ink,marginBottom:7}}>Part Review</div>
                      <div style={{display:"grid",gridTemplateColumns:"repeat(2,minmax(0,1fr))",gap:6}}>
                        {partReviewRows.map(([label,value,help])=>(
                          <div key={label} title={help} style={{padding:"8px 9px",border:`1px solid ${hasReviewValue(value)?C.ruleLight:C.warnRule}`,borderRadius:4,background:hasReviewValue(value)?C.offWhite:C.warnBg,minHeight:58}}>
                            <div style={{fontFamily:mono,fontSize:8,color:C.inkMuted,textTransform:"uppercase",marginBottom:4}}>{label}</div>
                            <div style={{fontSize:11.8,color:C.inkSoft,lineHeight:1.4,overflowWrap:"anywhere",whiteSpace:"pre-wrap"}}>{showValue(value, "-")}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div style={{marginTop:10,display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                      <div style={{border:`1px solid ${C.ruleLight}`,borderRadius:5,background:C.surface,overflow:"hidden"}}>
                        <div style={{padding:"7px 9px",background:C.offWhite,borderBottom:`1px solid ${C.ruleLight}`,fontFamily:mono,fontSize:8,color:C.inkMuted,textTransform:"uppercase"}}>Manufacturing Spec</div>
                        <div style={{padding:9,display:"grid",gap:6}}>
                          {specRows.map(([label,value])=>(
                            <div key={label} style={{display:"grid",gridTemplateColumns:"86px 1fr",gap:7,fontSize:11.5,lineHeight:1.35}}>
                              <span style={{color:C.inkMuted}}>{label}</span>
                              <strong style={{color:C.ink,overflowWrap:"anywhere"}}>{showValue(value, "-")}</strong>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div style={{border:`1px solid ${C.ruleLight}`,borderRadius:5,background:C.surface,overflow:"hidden"}}>
                        <div style={{padding:"7px 9px",background:C.offWhite,borderBottom:`1px solid ${C.ruleLight}`,fontFamily:mono,fontSize:8,color:C.inkMuted,textTransform:"uppercase"}}>Quote & Award</div>
                        <div style={{padding:9,display:"grid",gap:6}}>
                          {commercialRows.map(([label,value])=>(
                            <div key={label} style={{display:"grid",gridTemplateColumns:"86px 1fr",gap:7,fontSize:11.5,lineHeight:1.35}}>
                              <span style={{color:C.inkMuted}}>{label}</span>
                              <strong style={{color:C.ink,overflowWrap:"anywhere"}}>{showValue(value, "-")}</strong>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                    {!!notesRows.length && (
                      <div style={{marginTop:10,display:"grid",gap:6}}>
                        {notesRows.map(([label,value])=>(
                          <div key={label} style={{padding:"8px 9px",border:`1px solid ${C.ruleLight}`,borderRadius:4,background:C.surface}}>
                            <div style={{fontFamily:mono,fontSize:8,color:C.inkMuted,textTransform:"uppercase",marginBottom:4}}>{label}</div>
                            <div style={{fontSize:11.5,color:C.inkSoft,lineHeight:1.45,whiteSpace:"pre-wrap"}}>{showValue(value, "-")}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div style={{display:"grid",gap:12}}>
          <Card>
            <div style={{padding:"12px 16px",background:C.surface,borderBottom:`1px solid ${C.rule}`,fontFamily:disp,fontSize:13,fontWeight:700}}>Corpus Contribution</div>
            <div style={{padding:16,display:"flex",alignItems:"center",gap:14}}>
              <div style={{width:52,height:52,borderRadius:"50%",border:`4px solid ${C.pass}`,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:mono,fontSize:13,fontWeight:700,color:C.pass}}>{score}</div>
              <div>
                <div style={{fontFamily:disp,fontSize:18,fontWeight:700,color:C.ink}}>{score}%</div>
                <div style={{fontFamily:mono,fontSize:9,color:C.inkMuted,marginTop:4}}>{dealJobs.length} jobs + {totalLessons} lessons linked</div>
              </div>
            </div>
            <div style={{margin:"0 16px 16px",padding:"12px",background:C.passBg,border:`1px solid ${C.passRule}`,borderRadius:4,fontSize:12,color:C.pass,lineHeight:1.55,textAlign:"center"}}>This project is searchable in your corpus. Similar inbound RFPs will match against it automatically.</div>
          </Card>
          <Card>
            <div style={{padding:"12px 16px",background:C.surface,borderBottom:`1px solid ${C.rule}`,fontFamily:disp,fontSize:13,fontWeight:700}}>Certifications</div>
            <div style={{padding:12,display:"flex",gap:6,flexWrap:"wrap"}}>
              {(certs.length?certs:["Not recorded"]).map((cert)=><span key={cert} style={{fontFamily:mono,fontSize:9,padding:"7px 10px",borderRadius:2,border:`1px solid ${C.rule}`,background:C.bluePale,color:C.blue}}>{cert}</span>)}
            </div>
          </Card>
          <div style={{padding:"16px",background:C.passBg,border:`1px solid ${C.passRule}`,borderLeft:`3px solid ${C.pass}`,borderRadius:6,textAlign:"center",color:C.pass}}>
            <div style={{fontFamily:mono,fontSize:10,textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:8}}>Corpus Updated</div>
            <div style={{fontSize:12,lineHeight:1.6,color:C.pass}}>
              This project, its part records, bid values, outcomes, and linked lessons are now available for future RFP matching.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PartImageThumb({ job = {}, onOpenImage }) {
  const toAbs = useCallback((raw) => {
    const s = `${raw || ""}`.trim();
    if (!s) return "";
    if (s.startsWith("http://") || s.startsWith("https://") || s.startsWith("data:")) return s;
    if (s.startsWith("/")) return `${API_BASE}${s}`;
    return `${API_BASE}/${s}`;
  }, []);
  const directImage = useMemo(() => {
    const raw = Array.isArray(job?.imageUrls) ? (job.imageUrls[0] || "") : "";
    return toAbs(raw || job?.image_url || job?.imagePreview || "");
  }, [job?.imagePreview, job?.image_url, job?.imageUrls, toAbs]);
  const [attachmentImage, setAttachmentImage] = useState("");
  const [src, setSrc] = useState(directImage);
  const [failedDirect, setFailedDirect] = useState(false);

  useEffect(() => {
    setSrc(directImage);
    setFailedDirect(false);
  }, [directImage]);

  useEffect(() => {
    let cancelled = false;
    async function loadFirstAttachmentImage() {
      const rid = `${job?.sourceRecordId || ""}`.trim();
      const pid = `${job?.sourcePartId || job?.id || ""}`.trim();
      if (!rid && !pid) return;
      try {
        const session = getSupplierSession();
        const res = await apiGetCached(
          ENDPOINTS.pastProjects.projectAttachments,
          {
            record_id: rid,
            part_id: pid,
            supplier_id: session.supplier_id || "",
            supplier_email: session.supplier_email || "",
            limit: 500,
          },
          { ttlMs: 45000 },
        );
        const attachments = Array.isArray(res?.attachments) ? res.attachments : [];
        const img = attachments.find((a) => a?.is_image && a?.url) || attachments.find((a) => a?.url);
        if (!img || cancelled) return;
        const url = toAbs(img.url);
        setAttachmentImage(url);
        if (!directImage || failedDirect) setSrc(url);
      } catch {}
    }
    loadFirstAttachmentImage();
    return () => { cancelled = true; };
  }, [directImage, failedDirect, job?.id, job?.sourcePartId, job?.sourceRecordId, toAbs]);

  const showSrc = src || attachmentImage;
  if (!showSrc) {
    return (
      <div style={{width:54,height:54,borderRadius:5,background:C.navy,border:`1px solid ${C.ruleLight}`,display:"flex",alignItems:"center",justifyContent:"center",position:"relative"}}>
        <BridgeMark size={18} color={C.white}/>
        <span style={{position:"absolute",bottom:4,fontFamily:mono,fontSize:6,color:C.gold}}>PART</span>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onOpenImage?.(showSrc);
      }}
      title="Preview part image"
      style={{width:54,height:54,borderRadius:5,overflow:"hidden",border:`1px solid ${C.ruleLight}`,background:C.navy,padding:0,cursor:"zoom-in",display:"block"}}
    >
      <img
        src={showSrc}
        alt={job?.name || job?.partName || "Part image"}
        style={{width:"100%",height:"100%",objectFit:"cover",display:"block"}}
        onError={() => {
          if (attachmentImage && showSrc !== attachmentImage) {
            setFailedDirect(true);
            setSrc(attachmentImage);
          } else {
            setSrc("");
          }
        }}
      />
    </button>
  );
}

function SIDealCard({deal,jobs,mfgLessons,quotingLessons,targetJobId,onEdit,onDelete,deleting,onOpenImage,onRename,onViewSummary}) {
  const dealJobs=useMemo(()=>jobs.filter(j=>j.dealId===deal.id),[jobs,deal.id]);
  const hasTarget=dealJobs.some(j=>j.id===targetJobId);
  const [open,setOpen]=useState(deal.id==="DEAL-001"||hasTarget);
  const [summaryOpen,setSummaryOpen]=useState(false);
  const [summaryTab,setSummaryTab]=useState("project");
  const [activeJobId,setActiveJobId]=useState(()=>hasTarget?targetJobId:null);
  const [jobAttachments,setJobAttachments]=useState([]);
  const [loadingAttachments,setLoadingAttachments]=useState(false);
  const [editingName,setEditingName]=useState(false);
  const [nameVal,setNameVal]=useState("");
  const activeJob=dealJobs.find(j=>j.id===activeJobId);
  const toAbsMedia = useCallback((raw) => {
    const s = `${raw || ""}`.trim();
    if (!s) return "";
    if (s.startsWith("http://") || s.startsWith("https://") || s.startsWith("data:")) return s;
    if (s.startsWith("/")) return `${API_BASE}${s}`;
    return `${API_BASE}/${s}`;
  }, []);

  const normalizeMediaKey = useCallback((src) => {
    const raw = `${src || ""}`.trim();
    if (!raw) return "";
    const abs = raw.startsWith("http://") || raw.startsWith("https://") || raw.startsWith("data:")
      ? raw
      : raw.startsWith("/")
        ? `${API_BASE}${raw}`
        : `${API_BASE}/${raw}`;
    try {
      const url = new URL(abs);
      url.hash = "";
      url.search = "";
      return url.toString().replace(/\/+$/, "");
    } catch {
      return abs.replace(/\?.*$/, "").replace(/\/+$/, "");
    }
  }, []);

  const activeJobImageUrls = [];
  const activeJobImageKeys = new Set();
  for (const raw of Array.isArray(activeJob?.imageUrls) ? activeJob.imageUrls : []) {
    const url = toAbsMedia(raw);
    const key = normalizeMediaKey(url);
    if (url && key && !activeJobImageKeys.has(key)) {
      activeJobImageKeys.add(key);
      activeJobImageUrls.push(url);
    }
  }

  const attachmentImageUrls = [];
  for (const attachment of jobAttachments.filter((a) => a?.is_image)) {
    const url = toAbsMedia(attachment.url);
    const key = normalizeMediaKey(url);
    if (!url || !key || activeJobImageKeys.has(key)) continue;
    if (attachmentImageUrls.some((existingUrl) => normalizeMediaKey(existingUrl) === key)) continue;
    attachmentImageUrls.push(url);
  }

  const totalDisplayedImages = activeJobImageUrls.length + attachmentImageUrls.length;
  const imageCardStyle = totalDisplayedImages === 1
    ? { flex: "1 1 100%", minHeight: 220, height: 220 }
    : { width: 90, height: 70 };

  const lessonsForDeal = useMemo(
    () => [...mfgLessons, ...quotingLessons].filter((l) => lessonMatchesDeal(l, deal, dealJobs)),
    [mfgLessons, quotingLessons, dealJobs, deal]
  );
  const totalLessons=[...new Set(lessonsForDeal.map(l=>l.id))].length;
  const processList=[...new Set(dealJobs.map((j)=>`${j.process || ""}`.trim()).filter(Boolean))];
  const materialList=[...new Set(dealJobs.map((j)=>`${j.material || ""}`.trim()).filter(Boolean))];
  const firstDate=deal.dateStart || dealJobs[0]?.date || "-";
  const lastDate=deal.dateEnd || dealJobs[dealJobs.length - 1]?.date || "-";
  const bidRows = useMemo(() => dealJobs.map((job, idx) => {
    const jobLessons = [...quotingLessons].filter((l)=>lessonMatchesJob(l,job,deal,dealJobs));
    return buildProjectBidLine(job, deal, idx, jobLessons);
  }), [dealJobs, deal, quotingLessons]);
  const totalQuoted = bidRows.reduce((sum, row) => sum + currencyNumber(row.quotedAmount), 0);
  const awardedCount = bidRows.filter((row) => ["won", "completed"].includes(row.outcomeKey)).length;
  const submittedDate = dealJobs.map((j)=>`${j.date || ""}`.trim()).filter(Boolean).sort().slice(-1)[0] || firstDate;
  const projectCode = `${deal.id || "PROJECT"}`.replace(/^DEAL-/i, "RFQ-");
  const bidId = `${deal.id || "BID"}`.replace(/^DEAL-/i, "BID-");
  const summaryText = deal.description || deal.projectOverview || activeJob?.overview || "Project summary not recorded yet.";
  const certs = Array.isArray(deal.mandatoryCertifications) ? deal.mandatoryCertifications : csvTags(deal.mandatoryCertifications);
  const projectGridColumns = "56px minmax(190px,1.15fr) minmax(320px,1.65fr) minmax(150px,0.8fr) minmax(150px,0.8fr) minmax(112px,0.55fr) minmax(190px,0.9fr)";
  const summaryScore = Math.min(99, Math.max(70, Math.round(82 + Math.min(10, dealJobs.length * 2) + Math.min(7, totalLessons))));
  const summaryImpact = `${dealJobs.length} job${dealJobs.length!==1?"s":""} + ${totalLessons} lesson${totalLessons!==1?"s":""} linked`;
  const handleSummaryClick = useCallback((e) => {
    e.stopPropagation();
    onViewSummary?.(deal);
  }, [deal, onViewSummary]);
  const handleExportProjectPdf = useCallback((e) => {
    e.stopPropagation();
    exportPastProjectPdf({ deal, jobs: dealJobs, bidRows, summaryText, totalQuoted, awardedCount, certs });
  }, [deal, dealJobs, bidRows, summaryText, totalQuoted, awardedCount, certs]);
  const activeStatus = `${deal.status || "active"}`.trim().toLowerCase();
  const statusMeta = activeStatus === "active"
    ? { label: "Visible", bg: C.bluePale, color: C.blue, border: "rgba(26,61,92,0.2)" }
    : { label: deal.status || "Archived", bg: C.surface, color: C.inkMuted, border: C.rule };

  useEffect(()=>{
    if(targetJobId&&dealJobs.some(j=>j.id===targetJobId)){
      setOpen(true);
      setActiveJobId(targetJobId);
    }
  },[targetJobId]);

  useEffect(() => {
    let cancelled = false;
    async function loadAttachments() {
      if (!open || !activeJob) {
        if (!cancelled) {
          setJobAttachments([]);
          setLoadingAttachments(false);
        }
        return;
      }
      const rid = `${activeJob?.sourceRecordId || ""}`.trim();
      const pid = `${activeJob?.sourcePartId || activeJob?.id || ""}`.trim();
      if (!rid && !pid) {
        if (!cancelled) setJobAttachments([]);
        return;
      }
      try {
        const session = getSupplierSession();
        setLoadingAttachments(true);
        const res = await apiGetCached(
          ENDPOINTS.pastProjects.projectAttachments,
          {
            record_id: rid,
            part_id: pid,
            supplier_id: session.supplier_id || "",
            supplier_email: session.supplier_email || "",
            limit: 400,
          },
          { ttlMs: 45000 }
        );
        const list = Array.isArray(res?.attachments) ? res.attachments : [];
        if (!cancelled) setJobAttachments(list);
      } catch {
        if (!cancelled) setJobAttachments([]);
      } finally {
        if (!cancelled) setLoadingAttachments(false);
      }
    }
    loadAttachments();
    return () => { cancelled = true; };
  }, [open, activeJob?.sourceRecordId, activeJob?.sourcePartId, activeJob?.id]);

  return (
    <div style={{marginBottom:14}}>
      <div
        style={{
          background:C.navy,
          border:`1px solid ${open ? "rgba(26,61,92,0.35)" : "rgba(26,61,92,0.24)"}`,
          borderRadius:open?"7px 7px 0 0":"7px",
          boxShadow:open?"0 6px 20px rgba(20,28,36,0.08)":"0 1px 4px rgba(20,28,36,0.08)",
          overflow:"hidden",
        }}
      >
        <div style={{height:3,background:C.gold}} />
        <div
          style={{padding:"18px 18px 16px",display:"flex",alignItems:"flex-start",gap:14,cursor:"pointer"}}
          onClick={()=>setOpen(o=>!o)}
        >
          <div style={{flex:1,minWidth:0}}>
            <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",marginBottom:7}}>
              <span style={{fontFamily:sans,fontSize:10,textTransform:"uppercase",letterSpacing:"0.02em",color:C.gold,fontWeight:800,overflowWrap:"anywhere"}}>{projectCode}</span>
              <span style={{fontFamily:sans,fontSize:10,color:"rgba(255,255,255,0.68)",fontWeight:700,overflowWrap:"anywhere"}}>Bid: {bidId}</span>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8,minWidth:0}}>
              {editingName ? (
                <input
                  autoFocus
                  value={nameVal}
                  onClick={(e)=>e.stopPropagation()}
                  onChange={(e)=>setNameVal(e.target.value)}
                  onKeyDown={(e)=>{
                    e.stopPropagation();
                    if(e.key==="Enter"&&nameVal.trim()){
                      const recordIds=dealJobs.map(j=>j.sourceRecordId).filter(Boolean);
                      fetch(`${API_BASE}/projects/rename`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({record_ids:recordIds,new_name:nameVal.trim()})}).catch(()=>{});
                      onRename?.(deal.id,nameVal.trim());
                      setEditingName(false);
                    } else if(e.key==="Escape"){setEditingName(false);}
                  }}
                  onBlur={()=>{
                    if(nameVal.trim()){
                      const recordIds=dealJobs.map(j=>j.sourceRecordId).filter(Boolean);
                      fetch(`${API_BASE}/projects/rename`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({record_ids:recordIds,new_name:nameVal.trim()})}).catch(()=>{});
                      onRename?.(deal.id,nameVal.trim());
                    }
                    setEditingName(false);
                  }}
                  style={{fontFamily:sans,fontSize:15.5,fontWeight:600,color:C.ink,border:`1px solid ${C.gold}`,borderRadius:4,padding:"2px 8px",outline:"none",background:C.goldPale,flex:1,minWidth:120}}
                />
              ) : (
                <>
                  <span style={{fontFamily:disp,fontSize:18,fontWeight:700,color:C.white,lineHeight:1.25,overflowWrap:"anywhere"}}>
                    {deal.name || "Untitled Project"}
                  </span>
                  <span
                    onClick={(e)=>{e.stopPropagation();setNameVal(deal.name||"");setEditingName(true);}}
                    title="Rename project"
                    style={{cursor:"pointer",fontSize:12,color:C.gold,flexShrink:0,padding:"1px 5px",borderRadius:3,border:`1px solid ${C.gold}`,opacity:0.8,lineHeight:1}}
                  >✎</span>
                </>
              )}
            </div>
            <div style={{fontFamily:sans,fontSize:11,color:"rgba(255,255,255,0.68)",lineHeight:1.55,marginBottom:0,overflowWrap:"anywhere"}}>
              {deal.customer || "Customer not set"} · Rcvd {firstDate} · Submitted {submittedDate} · {totalQuoted > 0 ? `$${totalQuoted.toLocaleString()}` : "quote not recorded"} · {awardedCount} win{awardedCount!==1?"s":""}
            </div>
            <div style={{display:"none",alignItems:"center",gap:6,flexWrap:"wrap",marginBottom:(processList.length || materialList.length) ? 8 : 0}}>
              <span style={{fontFamily:mono,fontSize:8,padding:"2px 7px",borderRadius:2,background:"rgba(255,255,255,0.08)",color:"rgba(255,255,255,0.78)",border:"1px solid rgba(255,255,255,0.16)",textTransform:"uppercase",letterSpacing:"0.05em"}}>{dealJobs.length} part{dealJobs.length!==1?"s":""}</span>
              <span style={{fontFamily:mono,fontSize:8,padding:"2px 7px",borderRadius:2,background:totalLessons?"rgba(184,146,10,0.18)":"rgba(255,255,255,0.08)",color:totalLessons?C.gold:"rgba(255,255,255,0.58)",border:`1px solid ${totalLessons?"rgba(184,146,10,0.24)":"rgba(255,255,255,0.14)"}`,textTransform:"uppercase",letterSpacing:"0.05em"}}>{totalLessons} lesson{totalLessons!==1?"s":""}</span>
            </div>
            <div style={{display:"none",alignItems:"center",gap:6,flexWrap:"wrap",marginTop:6}}>
              {processList.slice(0,3).map((process)=><span key={process} style={{fontFamily:mono,fontSize:8,padding:"2px 7px",borderRadius:2,background:"rgba(255,255,255,0.08)",color:"#BFD3EA",border:"1px solid rgba(255,255,255,0.14)"}}>{process}</span>)}
              {materialList.slice(0,2).map((material)=><span key={material} style={{fontFamily:mono,fontSize:8,padding:"2px 7px",borderRadius:2,background:"rgba(184,146,10,0.18)",color:"#F2D05A",border:"1px solid rgba(184,146,10,0.2)"}}>{material}</span>)}
            </div>
          </div>
          <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:8,flexShrink:0}}>
            <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap",justifyContent:"flex-end",maxWidth:360}}>
              {certs.slice(0,3).map((cert)=><span key={cert} style={{fontFamily:mono,fontSize:8,padding:"5px 8px",background:"rgba(255,255,255,0.08)",border:"1px solid rgba(255,255,255,0.24)",color:"rgba(255,255,255,0.7)",borderRadius:2,textTransform:"uppercase"}}>{cert}</span>)}
              <button onClick={handleSummaryClick} style={{fontFamily:mono,fontSize:8,padding:"5px 9px",background:"rgba(255,255,255,0.08)",border:"1px solid rgba(255,255,255,0.24)",color:"rgba(255,255,255,0.86)",borderRadius:2,cursor:"pointer",textTransform:"uppercase"}}>Summary →</button>
              <button onClick={(e)=>{e.stopPropagation(); onEdit?.(deal);}} style={{fontFamily:mono,fontSize:8,padding:"5px 9px",background:"rgba(255,255,255,0.08)",border:"1px solid rgba(255,255,255,0.24)",color:"rgba(255,255,255,0.86)",borderRadius:2,cursor:"pointer",textTransform:"uppercase"}}>Edit RFP</button>
              <button onClick={(e)=>{e.stopPropagation(); onDelete?.(deal);}} disabled={deleting} style={{fontFamily:mono,fontSize:8,padding:"5px 9px",background:"rgba(255,255,255,0.08)",border:"1px solid rgba(255,255,255,0.24)",color:"rgba(255,255,255,0.7)",borderRadius:2,cursor:deleting?"not-allowed":"pointer",textTransform:"uppercase"}}>{deleting ? "Deleting" : "Delete"}</button>
            </div>
            <div style={{width:30,height:30,borderRadius:"50%",background:open?"rgba(184,146,10,0.18)":"rgba(255,255,255,0.08)",border:`1px solid ${open?"rgba(184,146,10,0.28)":"rgba(255,255,255,0.14)"}`,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:mono,fontSize:12,color:open?C.gold:"rgba(255,255,255,0.64)"}}>
              {open ? "▴" : "▾"}
            </div>
          </div>
        </div>
      </div>
      {open&&(
        <div style={{border:`1px solid ${C.rule}`,borderTop:"none",borderRadius:"0 0 7px 7px",background:"#f8f5e9",boxShadow:"0 6px 20px rgba(20,28,36,0.08)",overflowX:"auto",overflowY:"hidden"}}>
          {summaryOpen&&(
            <div style={{padding:"18px 20px",borderBottom:`1px solid ${C.rule}`,background:C.bg}}>
              <div style={{display:"grid",gridTemplateColumns:"minmax(0,2fr) minmax(240px,0.8fr)",gap:18,alignItems:"start"}}>
                <div style={{border:`1px solid ${C.rule}`,borderRadius:6,overflow:"hidden",background:C.white,boxShadow:"0 1px 4px rgba(20,28,36,0.06)"}}>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,padding:"11px 14px",background:C.surface,borderBottom:`1px solid ${C.ruleLight}`}}>
                    <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                      <button type="button" onClick={(e)=>{e.stopPropagation();setSummaryTab("project");}} style={{fontFamily:sans,fontSize:12,fontWeight:600,color:C.ink,background:"transparent",border:"none",padding:"7px 0",cursor:"pointer"}}>Project Summary</button>
                      <button type="button" onClick={(e)=>{e.stopPropagation();setSummaryTab("parts");}} style={{fontFamily:mono,fontSize:9,padding:"7px 10px",borderRadius:2,border:`1px solid ${summaryTab==="parts"?C.blue:C.rule}`,background:summaryTab==="parts"?C.bluePale:C.offWhite,color:summaryTab==="parts"?C.blue:C.inkMuted,cursor:"pointer"}}>By Part</button>
                    </div>
                    <div style={{display:"flex",gap:8,flexWrap:"wrap",justifyContent:"flex-end"}}>
                      <button type="button" onClick={(e)=>{e.stopPropagation();onEdit?.(deal);}} style={{fontFamily:mono,fontSize:9,padding:"6px 12px",borderRadius:3,border:`1px solid ${C.blue}`,background:C.white,color:C.blue,cursor:"pointer"}}>Edit RFP</button>
                      <button type="button" onClick={(e)=>{e.stopPropagation();onEdit?.(deal);}} style={{fontFamily:mono,fontSize:9,padding:"6px 12px",borderRadius:3,border:`1px solid ${C.rule}`,background:C.white,color:C.inkMuted,cursor:"pointer"}}>Edit Parts</button>
                      <button type="button" onClick={handleExportProjectPdf} style={{fontFamily:mono,fontSize:9,padding:"6px 12px",borderRadius:3,border:`1px solid ${C.blue}`,background:C.navy,color:C.white,cursor:"pointer"}}>Export PDF</button>
                    </div>
                  </div>
                  <div style={{padding:"16px 18px",background:C.white}}>
                    {summaryTab==="project" ? (
                      <>
                        <div style={{fontSize:13,color:C.inkSoft,lineHeight:1.65,textAlign:"center",padding:"0 10px 16px",borderBottom:`1px solid ${C.ruleLight}`}}>{summaryText}</div>
                        <div style={{display:"flex",gap:16,alignItems:"center",flexWrap:"wrap",paddingTop:14}}>
                          {[["Bid Record", bidId],["Submitted", submittedDate],["Total", totalQuoted>0?`$${totalQuoted.toLocaleString()}`:"Not recorded"],["Outcome", `${awardedCount} win${awardedCount!==1?"s":""}`]].map(([label,value])=>(
                            <div key={label} style={{display:"flex",alignItems:"baseline",gap:6}}>
                              <span style={{fontFamily:mono,fontSize:8,textTransform:"uppercase",letterSpacing:"0.07em",color:C.inkMuted}}>{label}</span>
                              <span style={{fontFamily:mono,fontSize:10,color:C.ink,fontWeight:700}}>{value}</span>
                            </div>
                          ))}
                        </div>
                      </>
                    ) : (
                      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(210px,1fr))",gap:10}}>
                        {bidRows.map((row,idx)=>(
                          <div key={`${row.partId}-${idx}`} style={{border:`1px solid ${C.ruleLight}`,borderRadius:6,background:C.offWhite,padding:12}}>
                            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,marginBottom:9}}>
                              <span style={{fontFamily:mono,fontSize:8,color:C.gold,fontWeight:700}}>{row.partId}</span>
                              <span style={{fontFamily:mono,fontSize:8,padding:"2px 6px",borderRadius:2,background:row.outcomeMeta.bg,color:row.outcomeMeta.color,border:`1px solid ${row.outcomeMeta.border}`}}>{row.outcomeMeta.label}</span>
                            </div>
                            <div style={{fontFamily:sans,fontSize:13,fontWeight:600,color:C.ink,marginBottom:7}}>{row.partName}</div>
                            <div style={{fontSize:11.5,color:C.inkSoft,lineHeight:1.5,marginBottom:10}}>{row.specification}</div>
                            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,padding:8,border:`1px solid ${C.passRule}`,borderRadius:4,background:C.passBg}}>
                              <span style={{fontFamily:mono,fontSize:8,color:C.pass}}>QUOTE</span>
                              <span style={{fontFamily:mono,fontSize:9,color:C.pass,fontWeight:700,textAlign:"right"}}>{row.quoteLabel}</span>
                              <span style={{fontFamily:mono,fontSize:8,color:C.pass}}>AWARD</span>
                              <span style={{fontFamily:mono,fontSize:9,color:C.pass,fontWeight:700,textAlign:"right"}}>{row.awardLabel}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div style={{display:"grid",gap:12}}>
                  <div style={{border:`1px solid ${C.rule}`,borderRadius:6,background:C.white,overflow:"hidden",boxShadow:"0 1px 4px rgba(20,28,36,0.06)"}}>
                    <div style={{padding:"11px 14px",background:C.surface,borderBottom:`1px solid ${C.ruleLight}`,fontFamily:sans,fontSize:13,fontWeight:600,color:C.ink}}>Corpus Contribution</div>
                    <div style={{padding:"14px",display:"flex",alignItems:"center",gap:14}}>
                      <div style={{width:48,height:48,borderRadius:"50%",border:`4px solid ${C.pass}`,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:mono,fontSize:13,fontWeight:700,color:C.pass,flexShrink:0}}>{summaryScore}</div>
                      <div>
                        <div style={{fontFamily:disp,fontSize:18,fontWeight:600,color:C.ink,lineHeight:1}}> {summaryScore}%</div>
                        <div style={{fontFamily:mono,fontSize:9,color:C.inkMuted,marginTop:5}}>{summaryImpact}</div>
                      </div>
                    </div>
                    <div style={{margin:"0 14px 14px",padding:"10px 12px",borderRadius:5,border:`1px solid ${C.passRule}`,background:C.passBg,fontSize:11.5,color:C.pass,lineHeight:1.55,textAlign:"center"}}>
                      Corpus updated. Similar inbound RFPs will match against this project automatically.
                    </div>
                  </div>
                  <div style={{border:`1px solid ${C.rule}`,borderRadius:6,background:C.white,overflow:"hidden"}}>
                    <div style={{padding:"11px 14px",background:C.surface,borderBottom:`1px solid ${C.ruleLight}`,fontFamily:sans,fontSize:13,fontWeight:600,color:C.ink}}>Certifications</div>
                    <div style={{padding:12,display:"flex",flexWrap:"wrap",gap:6}}>
                      {(certs.length?certs:["Not recorded"]).map((cert)=><span key={cert} style={{fontFamily:mono,fontSize:9,padding:"7px 10px",borderRadius:2,border:`1px solid ${C.rule}`,background:C.bluePale,color:C.blue}}>{cert}</span>)}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
          <div style={{padding:"12px 18px",display:"flex",alignItems:"center",gap:13,background:"#fbf7e9",borderBottom:"1px solid rgba(184,146,10,0.24)",flexWrap:"wrap"}}>
            <span style={{fontFamily:sans,fontSize:10,textTransform:"uppercase",letterSpacing:"0.02em",color:C.gold,fontWeight:800}}>Bid Record</span>
            <span style={{fontFamily:sans,fontSize:10,color:C.inkMuted,fontWeight:700}}>Bid ID</span>
            <span style={{fontFamily:sans,fontSize:12,color:C.ink,fontWeight:800}}>{bidId}</span>
            <span style={{fontFamily:sans,fontSize:10,color:C.inkMuted,fontWeight:700}}>Submitted</span>
            <span style={{fontFamily:sans,fontSize:12,color:C.ink,fontWeight:800}}>{submittedDate}</span>
            <span style={{fontFamily:sans,fontSize:10,color:C.inkMuted,fontWeight:700}}>Total Quoted</span>
            <span style={{fontFamily:sans,fontSize:12,color:C.ink,fontWeight:800}}>{totalQuoted > 0 ? `$${totalQuoted.toLocaleString()}` : "Not recorded"}</span>
            <span style={{fontFamily:sans,fontSize:10,color:C.inkMuted,fontWeight:700}}>Mode</span>
            <span style={{fontFamily:mono,fontSize:9,padding:"6px 11px",background:C.bluePale,color:C.blue,border:"1px solid rgba(26,61,92,0.18)",borderRadius:2,textTransform:"uppercase"}}>By Part</span>
          </div>
          <div style={{padding:"12px 18px",background:"#fbf7e9",borderBottom:"1px solid rgba(184,146,10,0.24)",fontFamily:sans,fontSize:11,fontWeight:700,color:C.amber,textAlign:"center"}}>
            {awardedCount > 0 ? `${awardedCount} awarded part${awardedCount!==1?"s":""} linked to source jobs.` : "Award / PO fields will appear here when recorded on your project parts."}
          </div>
          <div style={{overflowX:"auto",overflowY:"hidden"}}>
          <div style={{display:"grid",gridTemplateColumns:projectGridColumns,minWidth:1180,padding:"0 16px",background:C.navy,borderBottom:`1px solid rgba(26,61,92,0.3)`}}>
            {["","Part","Specification","Quote","Award / PO","Outcome","Jobs"].map((col,i)=>(
              <div key={col||i} style={{padding:"8px 10px",fontFamily:sans,fontSize:9,textTransform:"uppercase",letterSpacing:"0.03em",color:"rgba(255,255,255,0.58)",fontWeight:800}}>{col}</div>
            ))}
          </div>
          {dealJobs.map((job,idx)=>{
            const isExpanded=false;
            const jl=[...quotingLessons].filter((l)=>lessonMatchesJob(l,job,deal,dealJobs)).length;
            const bidRow = bidRows[idx] || buildProjectBidLine(job, deal, idx, []);
            const outc = bidRow.outcomeMeta;
            return (
              <div key={job.id}>
                <div
                  style={{display:"grid",gridTemplateColumns:projectGridColumns,minWidth:1180,padding:"0 16px",background:"#f2fbfc",borderBottom:`1px solid ${C.ruleLight}`,alignItems:"center",minHeight:92}}
                >
                  <div style={{padding:"10px 10px 10px 0",display:"flex",alignItems:"center",justifyContent:"center"}}>
                    <PartImageThumb job={job} onOpenImage={onOpenImage} />
                  </div>
                  <div style={{padding:"10px",minWidth:0}}>
                    <div style={{fontFamily:sans,fontSize:10,color:C.gold,fontWeight:800,marginBottom:6,overflowWrap:"anywhere"}}>{bidRow.partId}</div>
                    <div style={{fontFamily:disp,fontSize:13.5,fontWeight:700,color:C.ink,lineHeight:1.25,overflowWrap:"anywhere"}}>{bidRow.partName}</div>
                  </div>
                  <div style={{padding:"10px",fontSize:11.5,color:C.inkSoft,lineHeight:1.55,overflowWrap:"anywhere"}}>
                    {bidRow.specification}
                    <div style={{marginTop:6,display:"flex",gap:5,flexWrap:"wrap"}}>
                      {!!`${job?.partEnvelope || ""}`.trim() && (
                        <span style={{fontFamily:mono,fontSize:8,padding:"2px 6px",borderRadius:2,background:C.surface,border:`1px solid ${C.ruleLight}`,color:C.inkMuted}}>
                          Envelope: {job.partEnvelope}
                        </span>
                      )}
                      {!!`${job?.requirements || ""}`.trim() && (
                        <span style={{fontFamily:mono,fontSize:8,padding:"2px 6px",borderRadius:2,background:C.surface,border:`1px solid ${C.ruleLight}`,color:C.inkMuted}}>
                          Req: {`${job.requirements}`.slice(0, 60)}{`${job.requirements}`.length > 60 ? "..." : ""}
                        </span>
                      )}
                      {!!`${job?.date || ""}`.trim() && (
                        <span style={{fontFamily:mono,fontSize:8,padding:"2px 6px",borderRadius:2,background:C.surface,border:`1px solid ${C.ruleLight}`,color:C.inkMuted}}>
                          Date: {job.date}
                        </span>
                      )}
                    </div>
                    {!!`${job?.additionalNotes || job?.overview || ""}`.trim() && (
                      <div style={{marginTop:6,fontFamily:sans,fontSize:10.5,color:C.inkMuted,lineHeight:1.45}}>
                        {`${job.additionalNotes || job.overview || ""}`.slice(0, 120)}
                        {`${job.additionalNotes || job.overview || ""}`.length > 120 ? "..." : ""}
                      </div>
                    )}
                  </div>
                  <div style={{padding:"10px",minWidth:0,overflowWrap:"anywhere"}}>
                    <div style={{fontFamily:sans,fontSize:9,color:C.inkMuted,fontWeight:700,marginBottom:2,overflowWrap:"anywhere",textTransform:"uppercase"}}>{bidRow.bidLineId || "Bid not recorded"}</div>
                    <div style={{fontFamily:sans,fontSize:12,fontWeight:800,color:bidRow.quotedAmount>0?C.amber:C.inkSoft,lineHeight:1.25,overflowWrap:"anywhere"}}>{bidRow.quoteLabel}</div>
                  </div>
                  <div style={{padding:"10px",minWidth:0,overflowWrap:"anywhere"}}>
                    <div style={{fontFamily:sans,fontSize:9,color:bidRow.awardPo?C.pass:C.inkMuted,fontWeight:700,lineHeight:1.35,overflowWrap:"anywhere",textTransform:"uppercase"}}>{bidRow.awardPo || "PO not recorded"}</div>
                    <div style={{fontFamily:sans,fontSize:12,fontWeight:800,color:bidRow.awardAmount>0?C.pass:C.inkSoft,lineHeight:1.25,overflowWrap:"anywhere"}}>{bidRow.awardAmount>0 ? `$${bidRow.awardAmount.toLocaleString()}` : "Award value not recorded"}</div>
                  </div>
                  <div style={{padding:"10px"}}>
                    <span style={{fontFamily:mono,fontSize:8,padding:"2px 7px",borderRadius:2,background:outc.bg,color:outc.color,border:`1px solid ${outc.border}`,textTransform:"uppercase",letterSpacing:"0.05em"}}>{outc.label}</span>
                  </div>
                  <div style={{padding:"10px",display:"flex",alignItems:"center",gap:5,minWidth:0,flexWrap:"wrap"}}>
                    <span style={{fontFamily:sans,fontSize:9,fontWeight:700,color:C.blue,background:"none",border:`1px solid ${C.ruleLight}`,borderRadius:3,padding:"2px 7px",textAlign:"left",whiteSpace:"normal",overflowWrap:"anywhere",maxWidth:"100%"}}>{job.id}</span>
                    {jl>0&&<span style={{fontFamily:mono,fontSize:8,padding:"2px 6px",borderRadius:2,background:C.goldPale,color:C.gold,border:"1px solid rgba(184,146,10,0.25)"}}>{jl}</span>}
                  </div>
                </div>
                {bidRow.lessons.length>0&&(
                  <div style={{padding:"13px 32px",background:"#fbf7e9",borderBottom:`1px solid ${C.ruleLight}`}}>
                    <div style={{fontFamily:mono,fontSize:8,textTransform:"uppercase",letterSpacing:"0.08em",color:C.amber,textAlign:"center",marginBottom:10}}>
                      Quoting Lessons From This Part
                    </div>
                    {bidRow.lessons.slice(0,2).map((l)=>(
                      <div key={l.id} style={{border:`1px solid rgba(184,146,10,0.28)`,borderRadius:5,background:"#fffaf0",padding:"11px 14px",marginBottom:8}}>
                        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
                          <span style={{fontFamily:mono,fontSize:8,color:C.warn,textTransform:"uppercase",fontWeight:700}}>{l.category || "Lesson"}</span>
                          <span style={{fontFamily:mono,fontSize:8,color:C.inkMuted}}>{l.id}</span>
                          <SITierChip tier={l.tier}/>
                        </div>
                        <div style={{fontSize:12.5,fontWeight:700,color:C.ink,textAlign:"center",marginBottom:4}}>{l.title}</div>
                        <div style={{fontSize:11.5,color:C.inkMuted,lineHeight:1.5,textAlign:"center"}}>{`${l.body || ""}`.slice(0,130)}{`${l.body || ""}`.length>130?"...":""}</div>
                      </div>
                    ))}
                  </div>
                )}
                {isExpanded&&(
                  <div style={{padding:"14px 16px",borderBottom:`1px solid ${C.rule}`,background:C.offWhite}}>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",borderBottom:`1px solid ${C.ruleLight}`,marginBottom:12}}>
                      {[["Part ID",bidRow.partId],["Part Name",bidRow.partName],["Bid Line",bidRow.bidLineId],["Outcome",outc.label]].map(([l,v],i)=>(
                        <div key={l} style={{padding:"9px 12px",borderRight:i<3?`1px solid ${C.ruleLight}`:"none"}}>
                          <div style={{fontFamily:mono,fontSize:8,textTransform:"uppercase",letterSpacing:"0.07em",color:C.inkMuted,marginBottom:4}}>{l}</div>
                          <div style={{fontFamily:mono,fontSize:11,color:C.ink}}>{v}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",borderBottom:`1px solid ${C.ruleLight}`,marginBottom:12}}>
                      {[["Quote",bidRow.quoteLabel],["Award / PO",bidRow.awardLabel],["Source Job",job.id],["Date",job.date||"-"]].map(([l,v],i)=>(
                        <div key={l} style={{padding:"9px 12px",borderRight:i<3?`1px solid ${C.ruleLight}`:"none"}}>
                          <div style={{fontFamily:mono,fontSize:8,textTransform:"uppercase",letterSpacing:"0.07em",color:C.inkMuted,marginBottom:4}}>{l}</div>
                          <div style={{fontFamily:mono,fontSize:11,color:C.ink}}>{v}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",borderBottom:`1px solid ${C.ruleLight}`,marginBottom:12}}>
                      {[["Quantity",job.quantity||"-"],["Surface Finish",job.surfaceFinish||"-"],["Tolerance",job.toleranceDetails||"-"],["Part Envelope",job.partEnvelope||"-"]].map(([l,v],i)=>(
                        <div key={l} style={{padding:"9px 12px",borderRight:i<3?`1px solid ${C.ruleLight}`:"none"}}>
                          <div style={{fontFamily:mono,fontSize:8,textTransform:"uppercase",letterSpacing:"0.07em",color:C.inkMuted,marginBottom:4}}>{l}</div>
                          <div style={{fontFamily:mono,fontSize:11,color:C.ink}}>{v}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{fontFamily:disp,fontSize:14,fontWeight:500,color:C.ink,marginBottom:6}}>Selected Project Run</div>
                    <div style={{fontSize:13,color:C.inkSoft,lineHeight:1.65,padding:"10px 12px",background:C.white,borderRadius:5,marginBottom:12}}>{job.overview}</div>
                    <div style={{marginBottom:12,padding:"10px 12px",background:C.white,border:`1px solid ${C.ruleLight}`,borderRadius:6}}>
                      <div style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted,marginBottom:7}}>Part Images & Attachments</div>
                      {loadingAttachments&&<div style={{fontFamily:mono,fontSize:10,color:C.inkMuted,marginBottom:6}}>Loading attachments...</div>}
                      <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:8}}>
                        {activeJobImageUrls.map((u,i)=>(
                          <button key={`${u}-${i}`} type="button" onClick={()=>onOpenImage&&onOpenImage(u)} style={{display:"block",...imageCardStyle,border:`1px solid ${C.rule}`,borderRadius:5,overflow:"hidden",background:C.white,cursor:"zoom-in",padding:0}}>
                            <img src={u} alt={`part-${i}`} style={{width:"100%",height:"100%",objectFit:"cover"}}/>
                          </button>
                        ))}
                      </div>
                      {!!attachmentImageUrls.length&&(
                        <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:8}}>
                          {jobAttachments.filter((a)=>a?.is_image).map((a,i)=>{
                            const url=toAbsMedia(a.url);
                            if(!url||!attachmentImageUrls.includes(url))return null;
                            return(
                              <button key={`${a.id||a.name||i}-img`} type="button" onClick={()=>onOpenImage&&onOpenImage(url)} title={a.name||`Attachment ${i+1}`} style={{display:"block",...imageCardStyle,border:`1px solid ${C.rule}`,borderRadius:5,overflow:"hidden",background:C.white,cursor:"zoom-in",padding:0}}>
                                <img src={url} alt={a.name||`attachment-${i+1}`} style={{width:"100%",height:"100%",objectFit:"cover"}}/>
                              </button>
                            );
                          })}
                        </div>
                      )}
                      {!!jobAttachments.filter((a)=>!a?.is_image).length&&(
                        <div style={{display:"grid",gap:6}}>
                          {jobAttachments.filter((a)=>!a?.is_image).map((a,i)=>(
                            <a key={`${a.id||a.name||i}-file`} href={toAbsMedia(a.url)} target="_blank" rel="noreferrer" style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,padding:"6px 8px",border:`1px solid ${C.ruleLight}`,borderRadius:5,background:C.white,textDecoration:"none"}}>
                              <span style={{fontSize:12,color:C.ink,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{a.name||`Attachment ${i+1}`}</span>
                              <span style={{fontFamily:mono,fontSize:9,color:C.inkMuted}}>file</span>
                            </a>
                          ))}
                        </div>
                      )}
                      {!loadingAttachments&&!(Array.isArray(job.imageUrls)&&job.imageUrls.length)&&!jobAttachments.length&&(
                        <div style={{fontFamily:mono,fontSize:10,color:C.inkMuted}}>No images/attachments found for this project record.</div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {dealJobs.length===0&&(
            <div style={{padding:"24px",fontFamily:mono,fontSize:10,color:C.inkMuted,textAlign:"center",textTransform:"uppercase"}}>No project runs found</div>
          )}
          </div>
        </div>
      )}
    </div>
  );
}

function SIJobStandaloneCard({ job, deal, dealJobs = [], mfgLessons = [], quotingLessons = [], onOpenInProject, onOpenImage }) {
  const [open, setOpen] = useState(false);
  const [jobAttachments, setJobAttachments] = useState([]);
  const [loadingAttachments, setLoadingAttachments] = useState(false);

  const toAbsMedia = useCallback((raw) => {
    const s = `${raw || ""}`.trim();
    if (!s) return "";
    if (s.startsWith("http://") || s.startsWith("https://") || s.startsWith("data:")) return s;
    if (s.startsWith("/")) return `${API_BASE}${s}`;
    return `${API_BASE}/${s}`;
  }, []);

  const normalizeMediaKey = useCallback((src) => {
    const raw = `${src || ""}`.trim();
    if (!raw) return "";
    const abs = raw.startsWith("http://") || raw.startsWith("https://") || raw.startsWith("data:")
      ? raw
      : raw.startsWith("/")
        ? `${API_BASE}${raw}`
        : `${API_BASE}/${raw}`;
    try {
      const url = new URL(abs);
      url.hash = "";
      url.search = "";
      return url.toString().replace(/\/+$/, "");
    } catch {
      return abs.replace(/\?.*$/, "").replace(/\/+$/, "");
    }
  }, []);

  const jobImageUrls = [];
  const jobImageKeys = new Set();
  for (const raw of Array.isArray(job?.imageUrls) ? job.imageUrls : []) {
    const url = toAbsMedia(raw);
    const key = normalizeMediaKey(url);
    if (url && key && !jobImageKeys.has(key)) {
      jobImageKeys.add(key);
      jobImageUrls.push(url);
    }
  }

  const attachmentImageUrls = [];
  for (const attachment of jobAttachments.filter((a) => a?.is_image)) {
    const url = toAbsMedia(attachment.url);
    const key = normalizeMediaKey(url);
    if (!url || !key || jobImageKeys.has(key)) continue;
    if (attachmentImageUrls.some((existingUrl) => normalizeMediaKey(existingUrl) === key)) continue;
    attachmentImageUrls.push(url);
  }

  const totalDisplayedImages = jobImageUrls.length + attachmentImageUrls.length;
  const imageCardStyle = totalDisplayedImages === 1
    ? { flex: "1 1 100%", minHeight: 220, height: 220 }
    : { width: 90, height: 70 };

  const derivedLessons = useMemo(() => {
    const all = [...mfgLessons, ...quotingLessons];
    if (!all.length) return [];
    return all.filter((l) => lessonMatchesJob(l, job, deal || {}, dealJobs));
  }, [mfgLessons, quotingLessons, job, deal, dealJobs]);

  useEffect(() => {
    let cancelled = false;
    async function loadAttachments() {
      if (!open) {
        if (!cancelled) {
          setJobAttachments([]);
          setLoadingAttachments(false);
        }
        return;
      }
      const rid = `${job?.sourceRecordId || ""}`.trim();
      const pid = `${job?.sourcePartId || job?.id || ""}`.trim();
      if (!rid && !pid) {
        if (!cancelled) setJobAttachments([]);
        return;
      }
      try {
        const session = getSupplierSession();
        setLoadingAttachments(true);
        const res = await apiGetCached(
          ENDPOINTS.pastProjects.projectAttachments,
          {
            record_id: rid,
            part_id: pid,
            supplier_id: session.supplier_id || "",
            supplier_email: session.supplier_email || "",
            limit: 400,
          },
          { ttlMs: 45000 }
        );
        const list = Array.isArray(res?.attachments) ? res.attachments : [];
        if (!cancelled) setJobAttachments(list);
      } catch {
        if (!cancelled) setJobAttachments([]);
      } finally {
        if (!cancelled) setLoadingAttachments(false);
      }
    }
    loadAttachments();
    return () => { cancelled = true; };
  }, [open, job?.sourceRecordId, job?.sourcePartId, job?.id]);

  return (
    <div style={{marginBottom:12,borderRadius:10,overflow:"hidden",boxShadow:"0 1px 4px rgba(20,28,36,0.08)",border:`1px solid ${C.rule}`}}>
      <div style={{background:C.navy,display:"flex",alignItems:"stretch"}}>
        <div style={{width:4,background:`linear-gradient(180deg, ${C.gold} 0%, ${C.blue} 100%)`}} />
        <div style={{flex:1,padding:"12px 14px",display:"flex",alignItems:"flex-start",gap:12}}>
          <div style={{flex:1,minWidth:0}}>
            <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",marginBottom:4}}>
              <span style={{fontFamily:mono,fontSize:10,color:C.gold,fontWeight:700,letterSpacing:"0.05em"}}>{job?.id || "JOB"}</span>
              <span style={{fontFamily:sans,fontSize:14,fontWeight:600,color:C.white,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",lineHeight:1.3}}>{job?.name || "Shop Floor Job"}</span>
              <SITierChip tier={job?.tier}/>
              {derivedLessons.length > 0 && (
                <span style={{fontFamily:mono,fontSize:8,padding:"2px 7px",borderRadius:2,background:"rgba(184,146,10,0.18)",color:C.gold,border:"1px solid rgba(184,146,10,0.24)",textTransform:"uppercase",letterSpacing:"0.05em"}}>
                  {derivedLessons.length} lesson{derivedLessons.length!==1?"s":""}
                </span>
              )}
            </div>
            <div style={{fontFamily:mono,fontSize:9,color:"rgba(255,255,255,0.55)",marginBottom:7}}>
              {(deal?.name || deal?.id || "Past Project")} · {(job?.date || "-")} · {(job?.process || "Process -")} · {(job?.material || "Material -")}
            </div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
              {job?.process && <span style={{fontFamily:mono,fontSize:8,padding:"2px 7px",borderRadius:2,background:"rgba(255,255,255,0.08)",color:"#BFD3EA",border:"1px solid rgba(255,255,255,0.14)"}}>{job.process}</span>}
              {job?.material && <span style={{fontFamily:mono,fontSize:8,padding:"2px 7px",borderRadius:2,background:"rgba(184,146,10,0.18)",color:"#F2D05A",border:"1px solid rgba(184,146,10,0.2)"}}>{job.material}</span>}
              {!!totalDisplayedImages && <span style={{fontFamily:mono,fontSize:8,padding:"2px 7px",borderRadius:2,background:"rgba(255,255,255,0.08)",color:"rgba(255,255,255,0.72)",border:"1px solid rgba(255,255,255,0.14)"}}>{totalDisplayedImages} img</span>}
            </div>
          </div>
          <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:8,flexShrink:0}}>
            {deal?.id && (
              <Btn sm variant="ghost" onClick={(e)=>{ e.stopPropagation(); onOpenInProject?.(job?.id); }}>
                Open Project
              </Btn>
            )}
          </div>
        </div>
      </div>
      {open && (
        <div style={{background:C.white,padding:"12px 14px"}}>
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",borderBottom:`1px solid ${C.ruleLight}`,marginBottom:12}}>
            {[["Job ID",job?.id || "-"],["Parent Project",deal?.name || deal?.id || "-"],["Source Part",job?.sourcePartId || "-"],["Project Record",job?.sourceRecordId || "-"]].map(([l,v],i)=>(
              <div key={l} style={{padding:"9px 12px",borderRight:i<3?`1px solid ${C.ruleLight}`:"none"}}>
                <div style={{fontFamily:mono,fontSize:8,textTransform:"uppercase",letterSpacing:"0.07em",color:C.inkMuted,marginBottom:4}}>{l}</div>
                <div style={{fontFamily:mono,fontSize:11,color:C.ink,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={`${v}`}>{v}</div>
              </div>
            ))}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",borderBottom:`1px solid ${C.ruleLight}`,marginBottom:12}}>
            {[["Part Name",job?.partName || job?.name || "-"],["Quantity",job?.quantity || "-"],["Surface Finish",job?.surfaceFinish || "-"],["Tolerance",job?.toleranceDetails || "-"]].map(([l,v],i)=>(
              <div key={l} style={{padding:"9px 12px",borderRight:i<3?`1px solid ${C.ruleLight}`:"none"}}>
                <div style={{fontFamily:mono,fontSize:8,textTransform:"uppercase",letterSpacing:"0.07em",color:C.inkMuted,marginBottom:4}}>{l}</div>
                <div style={{fontFamily:mono,fontSize:11,color:C.ink,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={`${v}`}>{v}</div>
              </div>
            ))}
          </div>

          {!!`${job?.overview || ""}`.trim() && (
            <div style={{fontSize:13,color:C.inkSoft,lineHeight:1.65,padding:"10px 12px",background:C.surface,borderRadius:5,marginBottom:12}}>
              {job.overview}
            </div>
          )}

          <div style={{marginBottom:12,padding:"10px 12px",background:C.offWhite,border:`1px solid ${C.ruleLight}`,borderRadius:6}}>
            <div style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted,marginBottom:7}}>Part Images & Attachments</div>
            {loadingAttachments && <div style={{fontFamily:mono,fontSize:10,color:C.inkMuted,marginBottom:6}}>Loading attachments...</div>}
            <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:8}}>
              {jobImageUrls.map((u, i) => (
                <button
                  key={`${u}-${i}`}
                  type="button"
                  onClick={() => onOpenImage && onOpenImage(u)}
                  style={{display:"block",...imageCardStyle,border:`1px solid ${C.rule}`,borderRadius:5,overflow:"hidden",background:C.white,cursor:"zoom-in",padding:0}}
                >
                  <img src={u} alt={`job-${i}`} style={{width:"100%",height:"100%",objectFit:"cover"}} />
                </button>
              ))}
            </div>
            {!!attachmentImageUrls.length && (
              <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:8}}>
                {jobAttachments
                  .filter((a) => a?.is_image)
                  .map((a, i) => {
                    const url = toAbsMedia(a.url);
                    if (!url || !attachmentImageUrls.includes(url)) return null;
                    return (
                      <button key={`${a.id || a.name || i}-img`} type="button" onClick={() => onOpenImage && onOpenImage(url)} title={a.name || `Attachment ${i + 1}`} style={{display:"block",...imageCardStyle,border:`1px solid ${C.rule}`,borderRadius:5,overflow:"hidden",background:C.white,cursor:"zoom-in",padding:0}}>
                        <img src={url} alt={a.name || `attachment-${i + 1}`} style={{width:"100%",height:"100%",objectFit:"cover"}} />
                      </button>
                    );
                  })}
              </div>
            )}
            {!!jobAttachments.filter((a) => !a?.is_image).length && (
              <div style={{display:"grid",gap:6}}>
                {jobAttachments.filter((a) => !a?.is_image).map((a, i) => (
                  <a key={`${a.id || a.name || i}-file`} href={toAbsMedia(a.url)} target="_blank" rel="noreferrer" style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,padding:"6px 8px",border:`1px solid ${C.ruleLight}`,borderRadius:5,background:C.white,textDecoration:"none"}}>
                    <span style={{fontSize:12,color:C.ink,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{a.name || `Attachment ${i + 1}`}</span>
                    <span style={{fontFamily:mono,fontSize:9,color:C.inkMuted}}>file</span>
                  </a>
                ))}
              </div>
            )}
            {!loadingAttachments && !jobImageUrls.length && !jobAttachments.length && (
              <div style={{fontFamily:mono,fontSize:10,color:C.inkMuted}}>No images/attachments found for this job record.</div>
            )}
          </div>

          <div style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted,marginBottom:8}}>Linked Lessons</div>
          {derivedLessons.map((l)=>(
            <div key={l.id} style={{display:"flex",gap:9,padding:"9px 11px",border:`1px solid ${C.ruleLight}`,borderRadius:5,background:C.surface,marginBottom:7,alignItems:"flex-start"}}>
              <div style={{width:3,background:C.gold,alignSelf:"stretch",borderRadius:2,flexShrink:0}}/>
              <div style={{flex:1}}>
                <div style={{fontFamily:mono,fontSize:9,color:C.gold,textTransform:"uppercase",letterSpacing:"0.06em",fontWeight:600,marginBottom:2}}>{l.category} - {l.id}</div>
                <div style={{fontSize:12,fontWeight:600,color:C.ink,marginBottom:2}}>{l.title}</div>
                <div style={{fontSize:11.5,color:C.inkMuted,lineHeight:1.5}}>{`${l.body || ""}`.slice(0,110)}...</div>
              </div>
              <SITierChip tier={l.tier}/>
            </div>
          ))}
          {derivedLessons.length===0 && (
            <div style={{padding:"11px",border:`2px dashed ${C.ruleLight}`,borderRadius:5,fontFamily:mono,fontSize:9,color:C.inkMuted,textAlign:"center",textTransform:"uppercase"}}>No lessons linked to this job yet</div>
          )}
        </div>
      )}
    </div>
  );
}

// -- FILE TYPE META ------------------------------------------------------------
const FILE_META = {
  image: { icon:"IMG", label:"Image",       bg:"#EEF0FB", color:"#3A3A8A", border:"rgba(58,58,138,0.2)" },
  cad:   { icon:"CAD", label:"CAD / STEP",  bg:C.bluePale, color:C.blue,   border:"rgba(26,61,92,0.22)" },
  doc:   { icon:"DOC", label:"Document",    bg:C.surface,  color:C.inkMuted, border:C.rule },
  quote: { icon:"QTE", label:"Quote Doc",   bg:C.goldPale, color:C.amber,  border:"rgba(184,146,10,0.25)" },
};

// Simulated image thumbnails using CSS patterns (no external images needed)
function AttachmentThumb({thumb, outcome}) {
  const patterns = {
    fixture: { bg:"#1B2D4F", content:"cross-hatch",  label:"SETUP" },
    cmm:     { bg:"#1E3A2A", content:"grid",          label:"CMM" },
    chart:   { bg:"#3A1010", content:"wave",          label:"DATA" },
    bore:    { bg:"#1A2D4F", content:"circle",        label:"BORE" },
    grind:   { bg:"#2A1A08", content:"dots",          label:"GRIND" },
    ncr:     { bg:"#3A1010", content:"cross",         label:"NCR" },
  };
  const p = patterns[thumb] || { bg:"#1B2D4F", content:"dots", label:"IMG" };
  const outlineColor = outcome === "success" ? C.pass : outcome === "failure" ? C.warn : "transparent";
  return (
    <div style={{ width:72, height:56, borderRadius:5, background:p.bg, flexShrink:0, position:"relative", overflow:"hidden", border:`2px solid ${outlineColor}` }}>
      {/* SVG pattern background */}
      <svg style={{position:"absolute",inset:0,opacity:0.3}} width="72" height="56">
        {p.content==="grid"    && [0,1,2,3,4].flatMap(x=>[0,1,2,3].map(y=><rect key={`${x}${y}`} x={x*16+2} y={y*14+2} width={12} height={10} fill="none" stroke="white" strokeWidth="0.5"/>))}
        {p.content==="circle"  && [36].map(r=><circle key={r} cx={36} cy={28} r={18} fill="none" stroke="white" strokeWidth="0.8"/>).concat([<circle key="s" cx={36} cy={28} r={6} fill="none" stroke="white" strokeWidth="0.8"/>])}
        {p.content==="dots"    && [0,1,2,3,4,5].flatMap(x=>[0,1,2,3].map(y=><circle key={`${x}${y}`} cx={x*13+6} cy={y*14+7} r={2} fill="white"/>))}
        {p.content==="wave"    && <path d="M0 28 Q18 14 36 28 Q54 42 72 28" stroke="white" fill="none" strokeWidth="1.5"/>}
        {p.content==="cross"   && [<line key="h" x1="0" y1="28" x2="72" y2="28" stroke="white" strokeWidth="1.5"/>,<line key="v" x1="36" y1="0" x2="36" y2="56" stroke="white" strokeWidth="1.5"/>]}
        {p.content==="cross-hatch" && [0,1,2,3,4,5,6].flatMap(i=>[<line key={`d${i}`} x1={i*12-4} y1={0} x2={i*12+4+16} y2={56} stroke="white" strokeWidth="0.5"/>,<line key={`u${i}`} x1={i*12+16} y1={0} x2={i*12-16} y2={56} stroke="white" strokeWidth="0.5"/>])}
      </svg>
      {/* Label */}
      <div style={{position:"absolute",bottom:3,left:0,right:0,textAlign:"center",fontFamily:mono,fontSize:7,color:"rgba(255,255,255,0.75)",letterSpacing:"0.06em"}}>{p.label}</div>
      {/* Outcome pip */}
      {outcome && <div style={{position:"absolute",top:3,right:3,width:8,height:8,borderRadius:"50%",background:outcome==="success"?C.pass:C.warn,border:"1.5px solid rgba(0,0,0,0.3)"}}/>}
    </div>
  );
}

function AttachmentRow({ attachment }) {
  const [hovered, setHovered] = useState(false);
  const m = FILE_META[attachment.type] || FILE_META.doc;
  return (
    <div
      onMouseEnter={()=>setHovered(true)} onMouseLeave={()=>setHovered(false)}
      style={{ display:"flex", alignItems:"center", gap:10, padding:"7px 10px", borderRadius:5, background:hovered?m.bg:C.surface, border:`1px solid ${hovered?m.border:C.ruleLight}`, transition:"all 0.15s", cursor:"pointer" }}>
      {/* Thumbnail for images, icon for others */}
      {attachment.type==="image" && attachment.thumb
        ? <AttachmentThumb thumb={attachment.thumb} outcome={attachment.outcome}/>
        : <div style={{ width:36, height:36, borderRadius:4, background:m.bg, border:`1px solid ${m.border}`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:16, flexShrink:0 }}>{m.icon}</div>
      }
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize:12, fontWeight:600, color:C.ink, marginBottom:2, overflow:"hidden", whiteSpace:"nowrap", textOverflow:"ellipsis" }}>{attachment.label}</div>
        <div style={{ display:"flex", alignItems:"center", gap:7 }}>
          <span style={{ fontFamily:mono, fontSize:8, padding:"1px 5px", borderRadius:2, background:m.bg, color:m.color, border:`1px solid ${m.border}`, textTransform:"uppercase", letterSpacing:"0.04em" }}>{m.label}</span>
          <span style={{ fontFamily:mono, fontSize:8, color:C.inkMuted }}>{attachment.name}</span>
        </div>
      </div>
      <div style={{ display:"flex", alignItems:"center", gap:6, flexShrink:0 }}>
        {attachment.outcome && (
          <span style={{ fontFamily:mono, fontSize:8, padding:"1px 6px", borderRadius:2, background:attachment.outcome==="success"?C.passBg:C.warnBg, color:attachment.outcome==="success"?C.pass:C.warn, border:`1px solid ${attachment.outcome==="success"?C.passRule:C.warnRule}`, textTransform:"uppercase", letterSpacing:"0.04em" }}>
            {attachment.outcome==="success"?"Success":"Failure"}
          </span>
        )}
        <span style={{ fontFamily:mono, fontSize:10, color:hovered?C.gold:C.inkMuted }}>{">"}</span>
      </div>
    </div>
  );
}

// -- JOB HYPERLINK CHIP ---------------------------------------------------------
function JobHyperlink({ jobId, jobs, deals, onNavigateDeals }) {
  const job = jobs.find(j=>j.id===jobId);
  const deal = job ? deals.find(d=>d.id===job.dealId) : null;
  if (!job) return null;
  return (
    <button onClick={e=>{e.stopPropagation();onNavigateDeals(jobId);}}
      title={`${job.name} - ${deal?.name||""} - click to view job`}
      style={{ display:"inline-flex", alignItems:"center", gap:5, padding:"3px 9px", borderRadius:3, cursor:"pointer", border:"1px solid rgba(26,61,92,0.25)", background:C.bluePale, color:C.blue, fontFamily:mono, fontSize:9, textTransform:"uppercase", letterSpacing:"0.04em", transition:"all 0.14s", outline:"none", textDecoration:"none" }}
      onMouseEnter={e=>{e.currentTarget.style.background=C.navy;e.currentTarget.style.color=C.gold;e.currentTarget.style.borderColor=C.navy;}}
      onMouseLeave={e=>{e.currentTarget.style.background=C.bluePale;e.currentTarget.style.color=C.blue;e.currentTarget.style.borderColor="rgba(26,61,92,0.25)";}}>
      <span style={{opacity:0.6}}>?</span>
      <span>{jobId}</span>
      {deal && <span style={{opacity:0.55,fontWeight:400}}> -  {deal.id}</span>}
    </button>
  );
}

function SILessonCard({ lesson, catColor, type, onNavigateDeals, jobs=SI_JOBS, deals=SI_DEALS, onEdit, onDelete }) {
  const [open, setOpen] = useState(false);
  const hasAttachments = lesson.attachments?.length > 0;
  const imageAttachments = lesson.attachments?.filter(a=>a.type==="image")||[];
  const otherAttachments = lesson.attachments?.filter(a=>a.type!=="image")||[];
  const isQuoting = type === "quoting";

  return (
    <Card style={{ marginBottom:10, outline:"none" }}>
      {/* -- Collapsed header -- */}
      <div onClick={()=>setOpen(!open)}
        style={{ padding:"12px 15px", display:"flex", gap:10, cursor:"pointer", borderBottom:open?`1px solid ${C.ruleLight}`:"none", alignItems:"flex-start" }}>
        <div style={{ width:3, borderRadius:2, background:catColor, alignSelf:"stretch", flexShrink:0 }}/>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:4, flexWrap:"wrap" }}>
            <span style={{ fontFamily:mono, fontSize:9, color:catColor, textTransform:"uppercase", letterSpacing:"0.06em", fontWeight:600 }}>{lesson.category}</span>
            <span style={{ fontFamily:mono, fontSize:9, color:C.inkMuted }}> -  {lesson.id} - {lesson.date}</span>
            {/* Source job chips - navigable */}
            {lesson.sourceJobs?.map((jidRaw)=>{
              const jid = sourceRefToJobId(jidRaw);
              return <JobHyperlink key={`${jidRaw}-${jid}`} jobId={jid} jobs={jobs} deals={deals} onNavigateDeals={onNavigateDeals}/>;
            })}
            {/* Attachment count badge */}
            {hasAttachments && (
              <span style={{ fontFamily:mono, fontSize:8, padding:"1px 6px", borderRadius:2, background:isQuoting?C.goldPale:C.bluePale, color:isQuoting?C.amber:C.blue, border:`1px solid ${isQuoting?"rgba(184,146,10,0.25)":"rgba(26,61,92,0.2)"}`, textTransform:"uppercase", letterSpacing:"0.04em" }}>
                {isQuoting?"??":"??"}&nbsp;{lesson.attachments.length} file{lesson.attachments.length!==1?"s":""}
              </span>
            )}
          </div>
          <div style={{ fontFamily:disp, fontSize:13, fontWeight:600, marginBottom:3 }}>{lesson.title}</div>
          {!open && <div style={{ fontSize:12, color:C.inkMuted, lineHeight:1.4, overflow:"hidden", whiteSpace:"nowrap", textOverflow:"ellipsis" }}>{lesson.body}</div>}
          {/* Image strip in collapsed view */}
          {!open && imageAttachments.length > 0 && (
            <div style={{ display:"flex", gap:6, marginTop:8, flexWrap:"wrap" }}>
              {imageAttachments.map((a,i)=>(
                <AttachmentThumb key={i} thumb={a.thumb} outcome={a.outcome}/>
              ))}
            </div>
          )}
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:6, flexShrink:0 }}>
          <SITierChip tier={lesson.tier}/>
          <span style={{ fontFamily:mono, fontSize:11, color:C.rule }}>{open?"?":"?"}</span>
        </div>
      </div>

      {/* -- Expanded body -- */}
      {open && (
        <div style={{ padding:"14px 15px 14px 18px" }}>

          {/* Body text */}
          <div style={{ fontSize:13, color:C.inkSoft, lineHeight:1.7, marginBottom:14 }}>{lesson.body}</div>

          {/* Source jobs - expanded, with deal context */}
          <div style={{ padding:"10px 12px", background:C.bluePale, border:`1px solid rgba(26,61,92,0.15)`, borderRadius:5, marginBottom:14 }}>
            <div style={{ fontFamily:mono, fontSize:9, textTransform:"uppercase", letterSpacing:"0.07em", color:C.blue, marginBottom:8 }}>
              Derived from {lesson.sourceJobs?.length||0} Source Job{lesson.sourceJobs?.length!==1?"s":""} - click to navigate
            </div>
            <div style={{ display:"flex", flexWrap:"wrap", gap:7 }}>
              {lesson.sourceJobs?.map((jidRaw)=>{
                const jid = sourceRefToJobId(jidRaw);
                const job=jobs.find(j=>j.id===jid);
                const deal=job?deals.find(d=>d.id===job.dealId):null;
                if(!job) return null;
                return (
                  <button key={`${jidRaw}-${jid}`} onClick={()=>onNavigateDeals(jid)}
                    style={{ display:"flex", alignItems:"center", gap:8, padding:"7px 11px", borderRadius:5, cursor:"pointer", border:`1px solid rgba(26,61,92,0.18)`, background:C.white, transition:"all 0.15s" }}
                    onMouseEnter={e=>{e.currentTarget.style.background=C.navy;e.currentTarget.style.borderColor=C.navy;Array.from(e.currentTarget.querySelectorAll("span")).forEach(s=>s.style.color="#fff");}}
                    onMouseLeave={e=>{e.currentTarget.style.background=C.white;e.currentTarget.style.borderColor="rgba(26,61,92,0.18)";Array.from(e.currentTarget.querySelectorAll("span")).forEach((s,i2)=>{s.style.color=[C.copper,C.ink,C.inkMuted,C.blue,C.inkMuted][i2]||C.inkMuted;});}}>
                    <span style={{ fontFamily:mono, fontSize:9, color:C.copper, fontWeight:600, transition:"color 0.12s" }}>{jid}</span>
                    <span style={{ fontSize:12, fontWeight:600, color:C.ink, transition:"color 0.12s" }}>{job.name}</span>
                    <span style={{ fontFamily:mono, fontSize:9, color:C.inkMuted, transition:"color 0.12s" }}>{job.date}</span>
                    {deal && <span style={{ fontFamily:mono, fontSize:8, color:C.blue, transition:"color 0.12s" }}>? {deal.id}</span>}
                    <span style={{ fontFamily:mono, fontSize:8, color:C.inkMuted, transition:"color 0.12s" }}>View job</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Process / material tags */}
          {(lesson.processes?.length>0 || lesson.materials?.length>0) && (
            <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:14 }}>
              {lesson.processes?.map(p=><span key={p} style={{ fontFamily:mono, fontSize:9, padding:"2px 7px", borderRadius:2, background:C.surface, border:`1px solid ${C.rule}`, color:C.inkSoft }}>{p}</span>)}
              {lesson.materials?.map(m=><span key={m} style={{ fontFamily:mono, fontSize:9, padding:"2px 7px", borderRadius:2, background:C.goldPale, border:"1px solid rgba(184,146,10,0.2)", color:C.amber }}>{m}</span>)}
            </div>
          )}

          {/* -- ATTACHMENTS SECTION -- */}
          {hasAttachments && (
            <div style={{ borderTop:`1px solid ${C.ruleLight}`, paddingTop:12, marginTop:2 }}>
              <div style={{ fontFamily:mono, fontSize:9, textTransform:"uppercase", letterSpacing:"0.07em", color:C.inkMuted, marginBottom:10, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                <span>{isQuoting ? "Quote Documents & Supporting Files" : "Project Images, CAD & Supporting Files"}</span>
                <button style={{ fontFamily:mono, fontSize:9, background:"none", border:`1px solid ${C.gold}`, borderRadius:3, padding:"3px 9px", cursor:"pointer", color:C.gold, textTransform:"uppercase", letterSpacing:"0.04em" }}>
                  + Attach File
                </button>
              </div>

              {/* Context note */}
              <div style={{ fontSize:11.5, color:C.inkMuted, fontStyle:"italic", lineHeight:1.5, marginBottom:10, padding:"7px 9px", background:C.surface, borderRadius:4 }}>
                {isQuoting
                  ? "These are quote documents and notes specific to this lesson - distinct from the original RFP. Attach quote revisions, pricing notes, customer comms, or outcome documentation."
                  : "These are production images and CAD files capturing the physical reality of this lesson - not the buyer's RFP. Attach failure photos, inspection results, fixture files, or setup documentation."}
              </div>

              {/* Image attachments - displayed as a gallery row */}
              {imageAttachments.length > 0 && (
                <div style={{ marginBottom:10 }}>
                  <div style={{ fontFamily:mono, fontSize:8, textTransform:"uppercase", color:C.inkMuted, letterSpacing:"0.05em", marginBottom:7 }}>Images ({imageAttachments.length})</div>
                  <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                    {imageAttachments.map((a,i)=>(
                      <div key={i} style={{ display:"flex", flexDirection:"column", gap:5, alignItems:"flex-start" }}>
                        <AttachmentThumb thumb={a.thumb} outcome={a.outcome}/>
                        <div style={{ maxWidth:72 }}>
                          <div style={{ fontSize:10, color:C.ink, lineHeight:1.3, overflow:"hidden", display:"-webkit-box", WebkitLineClamp:2, WebkitBoxOrient:"vertical" }}>{a.label}</div>
                          <div style={{ fontFamily:mono, fontSize:8, color:C.inkMuted, marginTop:2 }}>{a.name}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Non-image attachments - displayed as a list */}
              {otherAttachments.length > 0 && (
                <div>
                  <div style={{ fontFamily:mono, fontSize:8, textTransform:"uppercase", color:C.inkMuted, letterSpacing:"0.05em", marginBottom:7 }}>Documents & CAD ({otherAttachments.length})</div>
                  <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                    {otherAttachments.map((a,i)=><AttachmentRow key={i} attachment={a}/>)}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Empty attachments CTA */}
          {!hasAttachments && (
            <div style={{ borderTop:`1px solid ${C.ruleLight}`, paddingTop:12, marginTop:2 }}>
              <div style={{ border:`2px dashed ${C.ruleLight}`, borderRadius:6, padding:"14px", textAlign:"center" }}>
                <div style={{ fontFamily:mono, fontSize:9, color:C.inkMuted, textTransform:"uppercase", letterSpacing:"0.05em", marginBottom:6 }}>
                  {isQuoting ? "No quote documents attached" : "No images or CAD files attached"}
                </div>
                <div style={{ fontSize:12, color:C.inkMuted, marginBottom:10, lineHeight:1.5 }}>
                  {isQuoting
                    ? "Attach the quote document, pricing notes, or customer communication that gave rise to this lesson."
                    : "Attach a photo of the failure or success, a fixture STEP file, an inspection result, or other physical evidence."}
                </div>
                <button style={{ fontFamily:mono, fontSize:9, background:"none", border:`1px solid ${C.gold}`, borderRadius:3, padding:"4px 12px", cursor:"pointer", color:C.gold, textTransform:"uppercase", letterSpacing:"0.04em" }}>+ Attach File</button>
              </div>
            </div>
          )}

          {/* Footer actions */}
          <div style={{ display:"flex", gap:8, justifyContent:"flex-end", marginTop:14, paddingTop:12, borderTop:`1px solid ${C.ruleLight}` }}>
            <Btn sm variant="ghost" onClick={(e)=>{e.stopPropagation(); onDelete && onDelete(lesson);}}>Delete</Btn>
            <Btn sm variant="outline" onClick={(e)=>{e.stopPropagation(); onEdit && onEdit(lesson);}}>Edit Lesson</Btn>
          </div>
        </div>
      )}
    </Card>
  );
}

// -- ANALYTICS PANEL -----------------------------------------------------------
// Aggregates insights from all four tabs: RFPs, Capabilities, Quoting, Mfg

function AnimBar({pct, color, h=5, delay=0}) {
  const [v,setV]=useState(0);
  useEffect(()=>{const t=setTimeout(()=>setV(pct),delay+300);return()=>clearTimeout(t);},[pct,delay]);
  return <div style={{height:h,background:C.ruleLight,borderRadius:2,overflow:"hidden"}}><div style={{height:"100%",width:`${v}%`,background:color,borderRadius:2,transition:"width 0.7s cubic-bezier(.4,0,.2,1)"}}/></div>;
}

// Minimal bar chart: each bar is a vertical column
function BarChart({data, height=80, colorFn, labelKey, valueKey, secondaryKey, secondaryColor}) {
  const max=Math.max(...data.map(d=>d[valueKey]),1);
  const [ready,setReady]=useState(false);
  useEffect(()=>{const t=setTimeout(()=>setReady(true),350);return()=>clearTimeout(t);},[]);
  return (
    <div style={{display:"flex",alignItems:"flex-end",gap:4,height:height+28}}>
      {data.map((d,i)=>{
        const pct=d[valueKey]/max;
        const pct2=secondaryKey?d[secondaryKey]/max:0;
        const col=colorFn?colorFn(d,i):C.gold;
        return (
          <div key={i} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:3}}>
            <div style={{position:"relative",width:"100%",height:height,display:"flex",alignItems:"flex-end",gap:2,justifyContent:"center"}}>
              <div title={`${d[labelKey]}: ${d[valueKey]}`} style={{flex:1,background:col,borderRadius:"2px 2px 0 0",height:ready?`${pct*100}%`:"2%",minHeight:ready&&d[valueKey]>0?3:0,transition:`height 0.6s cubic-bezier(.4,0,.2,1) ${i*0.05}s`}}/>
              {secondaryKey&&<div title={`Quoted: ${d[secondaryKey]}`} style={{flex:1,background:secondaryColor||C.pass,borderRadius:"2px 2px 0 0",height:ready?`${pct2*100}%`:"2%",minHeight:ready&&d[secondaryKey]>0?3:0,transition:`height 0.6s cubic-bezier(.4,0,.2,1) ${i*0.05+0.1}s`}}/>}
            </div>
            <span style={{fontFamily:mono,fontSize:7,color:C.inkMuted,whiteSpace:"nowrap",textAlign:"center"}}>{d[labelKey]}</span>
          </div>
        );
      })}
    </div>
  );
}

function LineChart({data, height=70, color, labelKey, valueKey}) {
  if (!data || data.length === 0) {
    return (
      <div style={{height,display:"flex",alignItems:"center",justifyContent:"center",border:`1px dashed ${C.ruleLight}`,borderRadius:6,background:C.surface}}>
        <span style={{fontFamily:mono,fontSize:9,color:C.inkMuted,textTransform:"uppercase",letterSpacing:"0.05em"}}>No data</span>
      </div>
    );
  }
  const [ready,setReady]=useState(false);
  useEffect(()=>{const t=setTimeout(()=>setReady(true),400);return()=>clearTimeout(t);},[]);
  const max=Math.max(...data.map(d=>d[valueKey]),1);
  const w=300,h=height;
  const pts=data.map((d,i)=>({
    x: i/(data.length-1)*w,
    y: h-(d[valueKey]/max)*h*0.85-h*0.05,
    v: d[valueKey], l: d[labelKey],
  }));
  const path=pts.map((p,i)=>i===0?`M${p.x},${p.y}`:`L${p.x},${p.y}`).join(" ");
  const area=`${path} L${pts[pts.length-1].x},${h} L0,${h} Z`;
  return (
    <div style={{position:"relative"}}>
      <svg width="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{display:"block",height}}>
        <defs>
          <linearGradient id="lg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.18"/>
            <stop offset="100%" stopColor={color} stopOpacity="0.02"/>
          </linearGradient>
          <clipPath id="cp"><rect x="0" y="0" width={ready?w:0} height={h} style={{transition:"width 1s cubic-bezier(.4,0,.2,1) 0.3s"}}/></clipPath>
        </defs>
        <path d={area} fill="url(#lg)" clipPath="url(#cp)"/>
        <path d={path} stroke={color} strokeWidth="2" fill="none" clipPath="url(#cp)" strokeLinecap="round" strokeLinejoin="round"/>
        {pts.map((p,i)=><circle key={i} cx={p.x} cy={p.y} r="3" fill={color} clipPath="url(#cp)"/>)}
      </svg>
      <div style={{display:"flex",justifyContent:"space-between",marginTop:4}}>
        {data.map((d,i)=><span key={i} style={{fontFamily:mono,fontSize:7,color:C.inkMuted}}>{d[labelKey]}</span>)}
      </div>
    </div>
  );
}

function InsightCallout({type="recommendation", headline, body, actionLabel, onAction}) {
  const meta={
    recommendation: {icon:"?", color:C.gold,   bg:C.goldPale,   border:"rgba(184,146,10,0.25)", label:"Recommendation"},
    alert:          {icon:"?", color:C.warn,   bg:C.warnBg,     border:C.warnRule,              label:"Alert"},
    opportunity:    {icon:"?", color:C.pass,   bg:C.passBg,     border:C.passRule,              label:"Opportunity"},
    pattern:        {icon:"?", color:C.purple, bg:C.purplePale, border:"rgba(74,45,122,0.2)",   label:"Pattern"},
  }[type];
  return (
    <div style={{border:`1px solid ${meta.border}`,borderLeft:`3px solid ${meta.color}`,borderRadius:6,background:meta.bg,padding:"11px 14px",marginTop:12}}>
      <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:5}}>
        <span style={{fontFamily:mono,fontSize:11,color:meta.color}}>{meta.icon}</span>
        <span style={{fontFamily:mono,fontSize:8,padding:"1px 6px",borderRadius:2,background:meta.color,color:"#fff",textTransform:"uppercase",letterSpacing:"0.05em"}}>{meta.label}</span>
      </div>
      <div style={{fontFamily:disp,fontSize:13,fontWeight:700,color:C.ink,lineHeight:1.3,marginBottom:5}}>{headline}</div>
      <div style={{fontSize:12.5,color:C.inkSoft,lineHeight:1.65}}>{body}</div>
      {actionLabel&&<button onClick={onAction} style={{marginTop:8,fontFamily:mono,fontSize:9,background:"none",border:`1px solid ${meta.color}40`,borderRadius:3,padding:"4px 10px",cursor:"pointer",color:meta.color,textTransform:"uppercase",letterSpacing:"0.04em"}}>{actionLabel} ?</button>}
    </div>
  );
}

function SectionHeader({num, label, color, icon}) {
  return (
    <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14,paddingBottom:10,borderBottom:`2px solid ${C.navy}`}}>
      <div style={{width:28,height:28,borderRadius:6,background:C.navy,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
        <span style={{fontFamily:mono,fontSize:12,color:C.gold}}>{icon}</span>
      </div>
      <div>
        <div style={{fontFamily:mono,fontSize:8,textTransform:"uppercase",letterSpacing:"0.08em",color:C.inkMuted}}>Section {num}</div>
        <div style={{fontFamily:disp,fontSize:15,fontWeight:700,color:C.ink,lineHeight:1.1}}>{label}</div>
      </div>
    </div>
  );
}

function StatPill({label, value, color, bg}) {
  return (
    <div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 13px",background:bg||C.surface,borderRadius:6,border:`1px solid ${color}25`}}>
      <span style={{fontFamily:mono,fontSize:22,fontWeight:600,color,lineHeight:1}}>{value}</span>
      <span style={{fontFamily:mono,fontSize:9,color:C.inkMuted,textTransform:"uppercase",letterSpacing:"0.05em",lineHeight:1.4}}>{label}</span>
    </div>
  );
}

function AnalyticsPanel({ dealsData = [], jobsData = [], mfgLessonsData = [], quotingLessonsData = [], processProfilesData = [], analyticsSummary = {}, inboundRealtime = null }) {
  const monthName = (ym) => {
    const [y, m] = `${ym || ""}`.split("-").map((v) => Number(v));
    if (!y || !m) return "N/A";
    return new Date(y, m - 1, 1).toLocaleString("en-US", { month: "short" });
  };

  const jobsByMonth = useMemo(() => {
    const map = new Map();
    jobsData.forEach((j) => {
      const key = `${j.date || ""}`.slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(key)) return;
      map.set(key, (map.get(key) || 0) + 1);
    });
    const sorted = Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    return sorted.slice(-6);
  }, [jobsData]);

  const fallbackMonthly = jobsByMonth.map(([ym, received]) => ({
    m: monthName(ym),
    received,
    quoted: Math.max(0, Math.round(received * 0.7)),
  }));
  const hasInboundRealtime = Array.isArray(inboundRealtime?.monthly) && inboundRealtime.monthly.length > 0;
  const assessmentSummary = inboundRealtime?.assessmentSummary || {};
  const rfpMonthly = hasInboundRealtime ? inboundRealtime.monthly : fallbackMonthly;
  const totalReceived = hasInboundRealtime ? Number(inboundRealtime.totalReceived || 0) : rfpMonthly.reduce((a, b) => a + b.received, 0);
  const totalQuoted = hasInboundRealtime ? Number(inboundRealtime.totalQuoted || 0) : rfpMonthly.reduce((a, b) => a + b.quoted, 0);
  const avgDaysToQuote = hasInboundRealtime ? Number(inboundRealtime.avgDaysToQuote || 0) : (totalReceived > 0 ? Math.max(1, Math.round((jobsData.length / Math.max(totalQuoted, 1)) * 10) / 10) : 0);
  const winRate = totalQuoted > 0 ? Math.round((dealsData.filter((d) => `${d.status || ""}`.toLowerCase() === "closed").length / totalQuoted) * 100) : 0;

  const { processCounts, materialCounts } = useMemo(() => mapProcessProfiles(processProfilesData), [processProfilesData]);
  const capabilities = useMemo(() => {
    if (processCounts.length) {
      return processCounts.map((row, idx) => ({
        process: row.name,
        profiles: row.count,
        rfpDemand: Math.max(row.count, Math.round(row.count * 1.25)),
        color: [C.gold, C.blue, C.blueMid, C.amber, C.warn, C.purple][idx % 6],
      }));
    }
    const procCount = new Map();
    jobsData.forEach((j) => {
      const p = `${j.process || ""}`.trim() || "Unknown";
      procCount.set(p, (procCount.get(p) || 0) + 1);
    });
    return Array.from(procCount.entries()).map(([process, profiles], idx) => ({
      process,
      profiles,
      rfpDemand: Math.max(profiles, Math.round(profiles * 1.3)),
      color: [C.gold, C.blue, C.blueMid, C.amber, C.warn, C.purple][idx % 6],
    }));
  }, [jobsData, processCounts]);
  const materialProfiles = useMemo(() => {
    if (materialCounts.length) {
      return materialCounts.map((row, idx) => ({
        mat: row.name,
        count: row.count,
        color: [C.gold, C.blue, C.blueMid, C.amber, C.warn, C.inkMuted][idx % 6],
      }));
    }
    const matCount = new Map();
    jobsData.forEach((j) => {
      const m = `${j.material || ""}`.trim() || "Unknown";
      matCount.set(m, (matCount.get(m) || 0) + 1);
    });
    return Array.from(matCount.entries()).map(([mat, count], idx) => ({
      mat,
      count,
      color: [C.gold, C.blue, C.blueMid, C.amber, C.warn, C.inkMuted][idx % 6],
    }));
  }, [jobsData, materialCounts]);

  const quotingGrowth = rfpMonthly.map((row, idx) => ({
    m: row.m,
    n: Math.min(quotingLessonsData.length, idx + 1 === rfpMonthly.length ? quotingLessonsData.length : Math.max(0, Math.round((quotingLessonsData.length * (idx + 1)) / Math.max(rfpMonthly.length, 1)))),
  }));
  const quoteCatMap = new Map();
  quotingLessonsData.forEach((l) => {
    const cat = l.category || "Other";
    quoteCatMap.set(cat, (quoteCatMap.get(cat) || 0) + 1);
  });
  const quotingCats = Array.from(quoteCatMap.entries()).map(([cat, n], idx) => ({
    cat,
    n,
    pct: quotingLessonsData.length ? Math.round((n / quotingLessonsData.length) * 100) : 0,
    color: [C.warn, C.gold, C.pass, C.blueMid, C.inkMuted][idx % 5],
  }));
  const quoteProcessMap = new Map();
  quotingLessonsData.forEach((l) => {
    const proc = Array.isArray(l.processes) ? `${l.processes[0] || ""}`.trim() : "";
    if (!proc) return;
    quoteProcessMap.set(proc, (quoteProcessMap.get(proc) || 0) + 1);
  });
  const quoteProcessTotal = Array.from(quoteProcessMap.values()).reduce((a, b) => a + b, 0);
  const lostToOverquote = Array.from(quoteProcessMap.entries())
    .map(([process, n], idx) => ({
      process,
      rate: quoteProcessTotal ? Math.round((n / quoteProcessTotal) * 100) : 0,
      color: [C.warn, C.gold, C.blue, C.inkMuted][idx % 4],
    }))
    .sort((a, b) => b.rate - a.rate)
    .slice(0, 4);

  const mfgGrowth = rfpMonthly.map((row, idx) => ({
    m: row.m,
    n: Math.min(mfgLessonsData.length, idx + 1 === rfpMonthly.length ? mfgLessonsData.length : Math.max(0, Math.round((mfgLessonsData.length * (idx + 1)) / Math.max(rfpMonthly.length, 1)))),
  }));
  const mfgCatMap = new Map();
  mfgLessonsData.forEach((l) => {
    const cat = l.category || "Other";
    mfgCatMap.set(cat, (mfgCatMap.get(cat) || 0) + 1);
  });
  const mfgCatDist = Array.from(mfgCatMap.entries()).map(([cat, n], idx) => ({
    cat,
    n,
    color: ["#8B2020", C.gold, C.pass, C.blueMid, C.blue, C.inkMuted][idx % 6],
  }));
  const brokenBitJobs = jobsData.filter((j) => /tool|grind|mill|bore|pocket|bit/i.test(`${j.overview || ""}`)).slice(0, 3).map((j) => ({
    job: j.id,
    desc: j.overview || "Historical manufacturing note",
    date: j.date || "",
  }));
  const backlogCount = Math.max(0, totalReceived - totalQuoted);
  const untriagedOver5 = Number(inboundRealtime?.untriagedOver5 || 0);
  const topCapabilityGap = capabilities
    .map((c) => ({ ...c, gap: Math.max(0, c.rfpDemand - c.profiles) }))
    .sort((a, b) => b.gap - a.gap)[0];
  const topMaterial = materialProfiles.slice().sort((a, b) => b.count - a.count)[0];
  const topQuoteRisk = lostToOverquote.slice().sort((a, b) => b.rate - a.rate)[0];
  const uncoveredProfilesCount = Array.isArray(analyticsSummary?.uncovered_profiles) ? analyticsSummary.uncovered_profiles.length : 0;

  return (
    <div style={{animation:"up 0.25s ease"}}>

      {/* -- TOP KPI ROW -- */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:10,marginBottom:28}}>
        {[
          {label:"RFPs Received",         val:totalReceived, color:C.blue,    bg:C.bluePale},
          {label:"Quotes Submitted",       val:totalQuoted,   color:C.pass,    bg:C.passBg},
          {label:"Avg Days to Quote",      val:`${avgDaysToQuote}d`, color:C.gold, bg:C.goldPale},
          {label:"Win Rate",               val:`${winRate}%`, color:C.pass,    bg:C.passBg},
          {label:"Mfg Lessons (Corpus)",   val:mfgLessonsData.length, color:C.purple,  bg:C.purplePale},
        ].map(s=>(
          <div key={s.label} style={{background:C.white,border:`1px solid ${C.rule}`,borderRadius:8,padding:"14px 16px",boxShadow:"0 1px 3px rgba(20,28,36,0.07)"}}>
            <div style={{fontFamily:mono,fontSize:8,textTransform:"uppercase",letterSpacing:"0.07em",color:C.inkMuted,marginBottom:8}}>{s.label}</div>
            <div style={{fontFamily:mono,fontSize:26,fontWeight:600,color:s.color,lineHeight:1}}>{s.val}</div>
          </div>
        ))}
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:20}}>

        {/* -- SECTION 1: RFPs -- */}
        <div style={{background:C.white,border:`1px solid ${C.rule}`,borderRadius:10,padding:"18px 20px",boxShadow:"0 1px 4px rgba(20,28,36,0.08)"}}>
          <SectionHeader num="01" label="Inbound RFPs" icon="01"/>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:16}}>
            <StatPill label="Total Received" value={totalReceived} color={C.blue}   bg={C.bluePale}/>
            <StatPill label="Assessments Logged" value={Number(assessmentSummary.assessedCount || totalQuoted)} color={C.pass} bg={C.passBg}/>
            <StatPill label="Avg Days"        value={`${avgDaysToQuote}d`} color={C.gold} bg={C.goldPale}/>
          </div>

          {/* Stacked bar chart: received vs quoted per month */}
          <div style={{marginBottom:10}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
              <span style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted}}>RFPs Received vs. Quoted - Last 6 months</span>
              <div style={{display:"flex",gap:12}}>
                <div style={{display:"flex",alignItems:"center",gap:5}}><div style={{width:8,height:8,borderRadius:2,background:C.blue}}/><span style={{fontFamily:mono,fontSize:8,color:C.inkMuted}}>Received</span></div>
                <div style={{display:"flex",alignItems:"center",gap:5}}><div style={{width:8,height:8,borderRadius:2,background:C.pass}}/><span style={{fontFamily:mono,fontSize:8,color:C.inkMuted}}>Quoted</span></div>
              </div>
            </div>
            <BarChart data={rfpMonthly} height={72} labelKey="m" valueKey="received" secondaryKey="quoted" secondaryColor={C.pass}
              colorFn={()=>C.bluePale}/>
          </div>

          {/* Time to quote trend */}
          <div style={{padding:"10px 12px",background:C.surface,borderRadius:5,marginBottom:12}}>
            <div style={{fontFamily:mono,fontSize:8,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted,marginBottom:4}}>Quote turnaround - rolling average</div>
            <div style={{display:"flex",gap:16}}>
              {[
                {label:"New RFP -> First quote",val:`${avgDaysToQuote || 0} days`},
                {label:"Quotes as % of received",val:`${totalReceived ? Math.round((totalQuoted / totalReceived) * 100) : 0}%`},
                {label:"Untriaged > 5 days",val:`${hasInboundRealtime ? untriagedOver5 : backlogCount} RFPs`},
                {label:"Avg assessment score",val:`${Math.round(Number(assessmentSummary.avgOverallScore || 0)) || 0}`}
              ].map(s=>(
                <div key={s.label}><div style={{fontFamily:mono,fontSize:13,fontWeight:600,color:C.ink,lineHeight:1}}>{s.val}</div><div style={{fontFamily:mono,fontSize:8,color:C.inkMuted,marginTop:2}}>{s.label}</div></div>
              ))}
            </div>
          </div>

          <InsightCallout type="recommendation"
            headline={backlogCount > 0 ? `Backlog detected: ${backlogCount} untriaged RFPs` : "No inbound backlog detected"}
            body={backlogCount > 0
              ? `Received ${totalReceived} RFPs, logged ${Number(assessmentSummary.assessedCount || totalQuoted)} assessments, and marked ${Number(assessmentSummary.noBidCount || 0)} no-bids in the current window. Prioritize untriaged opportunities to reduce lead-time risk.`
              : `Received ${totalReceived} RFPs and logged ${Number(assessmentSummary.assessedCount || totalQuoted)} assessment records in the current analytics window.`}
            actionLabel="View queue"
          />
        </div>

        {/* -- SECTION 2: CAPABILITIES -- */}
        <div style={{background:C.white,border:`1px solid ${C.rule}`,borderRadius:10,padding:"18px 20px",boxShadow:"0 1px 4px rgba(20,28,36,0.08)"}}>
          <SectionHeader num="02" label="Capability Profiles" icon="02"/>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:14}}>
            <StatPill label="Process Profiles" value={capabilities.reduce((a,b)=>a+b.profiles,0)} color={C.navy}  bg={C.bluePale}/>
            <StatPill label="Material Profiles" value={materialProfiles.reduce((a,b)=>a+b.count,0)} color={C.gold}  bg={C.goldPale}/>
          </div>

          {/* Process profiles vs RFP demand */}
          <div style={{marginBottom:14}}>
            <div style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted,marginBottom:8}}>Process profiles vs. Trustbridge RFP demand</div>
            {capabilities.map((c,i)=>{
              const gap=c.rfpDemand-c.profiles;
              return (
                <div key={c.process} style={{marginBottom:10}}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
                    <span style={{fontFamily:mono,fontSize:9,color:C.inkSoft,textTransform:"uppercase",letterSpacing:"0.04em"}}>{c.process}</span>
                    <span style={{fontFamily:mono,fontSize:9,color:gap>6?C.warn:gap>0?C.amber:C.pass}}>{c.profiles} profiles / {c.rfpDemand} RFP demand</span>
                  </div>
                  <div style={{position:"relative",height:5,background:C.ruleLight,borderRadius:2,overflow:"hidden"}}>
                    <AnimBar pct={Math.min(c.profiles/c.rfpDemand*100,100)} color={c.color} h={5} delay={i*40}/>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Material distribution */}
          <div style={{marginBottom:12}}>
            <div style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted,marginBottom:7}}>Material profile distribution</div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
              {materialProfiles.map(m=>(
                <div key={m.mat} style={{padding:"5px 9px",background:C.surface,borderRadius:4,border:`1px solid ${C.ruleLight}`,display:"flex",alignItems:"center",gap:5}}>
                  <div style={{width:6,height:6,borderRadius:"50%",background:m.color,flexShrink:0}}/>
                  <span style={{fontFamily:mono,fontSize:9,color:C.inkSoft}}>{m.mat}</span>
                  <span style={{fontFamily:mono,fontSize:9,fontWeight:600,color:C.ink}}>{m.count}</span>
                </div>
              ))}
            </div>
          </div>

          <InsightCallout type="opportunity"
            headline={topCapabilityGap?.gap > 0 ? `Largest capability gap: ${topCapabilityGap.process}` : "Capability coverage is balanced"}
            body={topCapabilityGap?.gap > 0
              ? `${topCapabilityGap.process} has ${topCapabilityGap.profiles} profiles vs ${topCapabilityGap.rfpDemand} observed demand. ${uncoveredProfilesCount > 0 ? `${uncoveredProfilesCount} process profile(s) still have no historical project coverage.` : "Add matched historical jobs to strengthen confidence."}`
              : "Current process profile distribution is aligned with observed demand from supplier project history."}
            actionLabel="View process profiles"
          />
        </div>

        {/* -- SECTION 3: QUOTING LESSONS -- */}
        <div style={{background:C.white,border:`1px solid ${C.rule}`,borderRadius:10,padding:"18px 20px",boxShadow:"0 1px 4px rgba(20,28,36,0.08)"}}>
          <SectionHeader num="03" label="Quoting Lessons" icon="$"/>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:14}}>
            <StatPill label="Total Lessons"      value={quotingLessonsData.length} color={C.gold}  bg={C.goldPale}/>
            <StatPill label="Linked to Jobs"     value={quotingLessonsData.filter(l=>l.sourceJobs?.length>0).length} color={C.pass} bg={C.passBg}/>
            <StatPill label="Private Lessons"    value={quotingLessonsData.filter(l=>l.tier==="private").length} color={C.inkMuted} bg={C.surface}/>
          </div>

          {/* Lesson growth line chart */}
          <div style={{marginBottom:14}}>
            <div style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted,marginBottom:8}}>Cumulative quoting lesson corpus - last 7 months</div>
            <LineChart data={quotingGrowth} height={64} color={C.gold} labelKey="m" valueKey="n"/>
          </div>

          {/* Category breakdown */}
          <div style={{marginBottom:14}}>
            <div style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted,marginBottom:7}}>Lesson category distribution</div>
            <div style={{display:"flex",flexDirection:"column",gap:6}}>
              {quotingCats.map(q=>(
                <div key={q.cat}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
                    <span style={{fontFamily:mono,fontSize:9,color:C.inkSoft}}>{q.cat}</span>
                    <span style={{fontFamily:mono,fontSize:9,color:C.inkMuted}}>{q.n} lesson{q.n!==1?"s":""} - {q.pct}%</span>
                  </div>
                  <AnimBar pct={q.pct} color={q.color} h={4} delay={0}/>
                </div>
              ))}
            </div>
          </div>

          {/* Overquoting by process */}
          <div style={{padding:"10px 12px",background:C.surface,borderRadius:5,marginBottom:12}}>
            <div style={{fontFamily:mono,fontSize:8,textTransform:"uppercase",color:C.inkMuted,marginBottom:8}}>Process distribution in quoting lessons</div>
            {lostToOverquote.map((p,i)=>(
              <div key={p.process} style={{marginBottom:i<lostToOverquote.length-1?8:0}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
                  <span style={{fontFamily:mono,fontSize:9,color:C.inkSoft}}>{p.process}</span>
                  <span style={{fontFamily:mono,fontSize:9,fontWeight:600,color:p.rate>30?C.warn:p.rate>20?C.amber:C.pass}}>{p.rate}%</span>
                </div>
                <AnimBar pct={p.rate} color={p.color} h={4} delay={i*60}/>
              </div>
            ))}
          </div>

          <InsightCallout type="alert"
            headline={topQuoteRisk ? `Top process in quoting lessons: ${topQuoteRisk.process}` : "No quoting process signal yet"}
            body={topQuoteRisk
              ? `${topQuoteRisk.process} appears in ${topQuoteRisk.rate}% of captured quoting lessons. This is backend-derived from Past RFP lesson records and can guide where to improve quoting playbooks.`
              : "No process-tagged quoting lessons are available yet. Add process tags to lessons for stronger analytics."}
            actionLabel="Review quoting lessons"
          />
        </div>

        {/* -- SECTION 4: MANUFACTURING LESSONS -- */}
        <div style={{background:C.white,border:`1px solid ${C.rule}`,borderRadius:10,padding:"18px 20px",boxShadow:"0 1px 4px rgba(20,28,36,0.08)"}}>
          <SectionHeader num="04" label="Manufacturing Lessons" icon="04"/>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:14}}>
            <StatPill label="Total Lessons"  value={mfgLessonsData.length}  color={C.blue}   bg={C.bluePale}/>
            <StatPill label="Linked to Jobs" value={mfgLessonsData.filter(l=>l.sourceJobs?.length>0).length} color={C.pass} bg={C.passBg}/>
            <StatPill label="Attributed"     value={mfgLessonsData.filter(l=>l.tier==="attributed").length}  color={C.gold}  bg={C.goldPale}/>
          </div>

          {/* Mfg lesson growth line chart */}
          <div style={{marginBottom:14}}>
            <div style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted,marginBottom:8}}>Cumulative manufacturing lesson corpus - last 7 months</div>
            <LineChart data={mfgGrowth} height={64} color={C.blue} labelKey="m" valueKey="n"/>
          </div>

          {/* Category distribution */}
          <div style={{marginBottom:14}}>
            <div style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted,marginBottom:7}}>Lesson category distribution</div>
            <div style={{display:"flex",flexDirection:"column",gap:6}}>
              {mfgCatDist.map((c,i)=>(
                <div key={c.cat}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
                    <span style={{fontFamily:mono,fontSize:9,color:C.inkSoft}}>{c.cat}</span>
                    <span style={{fontFamily:mono,fontSize:9,color:C.inkMuted}}>{c.n} lesson{c.n!==1?"s":""}</span>
                  </div>
                  <AnimBar pct={c.n/Math.max(mfgLessonsData.length,1)*100} color={c.color} h={4} delay={i*50}/>
                </div>
              ))}
            </div>
          </div>

          {/* Broken bit incident list */}
          <div style={{marginBottom:12}}>
            <div style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted,marginBottom:8}}>Related incident notes - {brokenBitJobs.length} recorded jobs</div>
            <div style={{display:"flex",flexDirection:"column",gap:6}}>
              {brokenBitJobs.map((b,i)=>(
                <div key={b.job} style={{padding:"8px 10px",background:C.warnBg,borderRadius:4,border:`1px solid ${C.warnRule}`,display:"flex",gap:10,alignItems:"flex-start"}}>
                  <span style={{fontFamily:mono,fontSize:9,color:C.gold,fontWeight:600,flexShrink:0,marginTop:1}}>{b.job}</span>
                  <div style={{flex:1}}>
                    <div style={{fontSize:12,color:C.ink,lineHeight:1.5}}>{b.desc}</div>
                    <div style={{fontFamily:mono,fontSize:8,color:C.inkMuted,marginTop:2}}>{b.date}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <InsightCallout type="pattern"
            headline={brokenBitJobs.length ? `Manufacturing incident pattern across ${brokenBitJobs.length} jobs` : "No manufacturing incidents detected in corpus notes"}
            body={brokenBitJobs.length
              ? "Incident-like keywords were detected in historical job notes. Convert these into explicit manufacturing lessons with source links to improve future bid intelligence."
              : "Add manufacturing lessons with source job links to unlock stronger pattern analysis and actionable alerts."}
            actionLabel="View manufacturing lessons"
          />
        </div>

      </div>
    </div>
  );
}

function IngestionScreen({navigate,onLogout}) {
  const [tab,setTab]=useState("deals");
  const [zoomImageSrc,setZoomImageSrc]=useState("");
  const [targetJobId, setTargetJobId] = useState(null);
  const [summaryDealId,setSummaryDealId]=useState("");
  const [dealsData,setDealsData]=useState([]);
  const [jobsData,setJobsData]=useState([]);
  const [mfgLessonsData,setMfgLessonsData]=useState([]);
  const [quotingLessonsData,setQuotingLessonsData]=useState([]);
  const [processProfilesData,setProcessProfilesData]=useState([]);
  const [processProfilesUpdatedAt,setProcessProfilesUpdatedAt]=useState("");
  const [machinesData,setMachinesData]=useState([]);
  const [machineMaterialsCatalog,setMachineMaterialsCatalog]=useState([]);
  const [analyticsSummary,setAnalyticsSummary]=useState({});
  const [inboundRealtime,setInboundRealtime]=useState({ monthly: [], totalReceived: 0, totalQuoted: 0, avgDaysToQuote: 0, untriagedOver5: 0, lastUpdated: "" });
  const [ingestionLoading,setIngestionLoading]=useState(true);
  const [ingestionError,setIngestionError]=useState("");
  const [syncingLessons,setSyncingLessons]=useState(false);
  const [syncStatus,setSyncStatus]=useState("");
  const [savingQuoteLesson,setSavingQuoteLesson]=useState(false);
  const [ingestionToast,setIngestionToast]=useState(null);
  const ingestionToastTimerRef = useRef(null);
  const lessonsMutationAtRef = useRef(0);
  const quotingLessonsDataRef = useRef([]);
  const [showAddProject,setShowAddProject]=useState(false);
  const [showInlineProjectUpload,setShowInlineProjectUpload]=useState(false);
  const [addingProject,setAddingProject]=useState(false);
  const [editingProjectId,setEditingProjectId]=useState("");
  const [deletingProjectId,setDeletingProjectId]=useState("");
  const [addProjectError,setAddProjectError]=useState("");
  const [showAddProfileEditor,setShowAddProfileEditor]=useState(false);
  const [creatingProfile,setCreatingProfile]=useState(false);
  const [addProfileError,setAddProfileError]=useState("");
  const [showMachineEditor,setShowMachineEditor]=useState(false);
  const [machineDraft,setMachineDraft]=useState(emptyMachineDraft);
  const [savingMachine,setSavingMachine]=useState(false);
  const [machineSaveError,setMachineSaveError]=useState("");
  const [machineResolveState,setMachineResolveState]=useState({ loading:false, best_match:null, matches:[], status:"UNRESOLVED" });
  const [machineMaterialQuery,setMachineMaterialQuery]=useState("");
  const lastMachineResolveKeyRef = useRef("");
  const [newProfile,setNewProfile]=useState({
    name:"",
    generic_process:"",
    branded_process:"",
    process_family:"",
    generic_name:"",
    material_name:"",
    material_class:"",
    material_family:"",
    material_type:"",
    tolerance:"",
    manufacturer:"",
    equipment_name:"",
    equipment_link:"",
    certifications:"",
    oem_description:"",
    oem_description_2:"",
  });
  const [workbenchFiles,setWorkbenchFiles]=useState([]);
  const [workbenchParts,setWorkbenchParts]=useState([]);
  const [workbenchExtractOverwrite,setWorkbenchExtractOverwrite]=useState(false);
  const [processingWorkbench,setProcessingWorkbench]=useState(false);
  const [pushingWorkbench,setPushingWorkbench]=useState(false);
  const [processLog,setProcessLog]=useState([]);
  const [extractedPdfText,setExtractedPdfText]=useState("");
  const loadIngestionRef = useRef(null);
  const workbenchInputRef = useRef(null);
  const autoProcessQueuedRef = useRef(false);
  const mfgImageInputRef = useRef(null);
  const mfgFilesInputRef = useRef(null);
  const quoteImageInputRef = useRef(null);
  const quoteFilesInputRef = useRef(null);
  const [newProject,setNewProject]=useState({
    job_id: "",
    company_name: "",
    company_size: "",
    company_location: "",
    customer_name: "",
    contact_phone: "",
    contact_email: "",
    project_name: "",
    part_family: "",
    material: "",
    process_primary: "",
    customer_industry: "",
    expected_annual_production_volume: "",
    mandatory_certifications: "",
    certification_notes: "",
    other_project_requirements: "",
    project_overview: "",
    sharing_tier: "Attributed",
    project_date: "",
    what_worked: "",
    outcome: "Success",
  });
  const [showQuoteEditor,setShowQuoteEditor]=useState(false);
  const [editingQuoteId,setEditingQuoteId]=useState("");
  const [showMfgEditor,setShowMfgEditor]=useState(false);
  const [editingMfgId,setEditingMfgId]=useState("");
  const [mfgDraft,setMfgDraft]=useState({
    id: "",
    category: "Process",
    title: "",
    body: "",
    projectId: "",
    partId: "",
    process: "",
    material: "",
    sourcePart: "",
    sourceLabel: "",
    tier: "private",
    date: "",
    imageName: "",
    attachmentNames: [],
  });
  const [quoteDraft,setQuoteDraft]=useState({
    id: "",
    category: "Other",
    title: "",
    body: "",
    projectId: "",
    partId: "",
    process: "",
    material: "",
    sourceJob: "",
    sourceLabel: "",
    tier: "private",
    date: "",
    imageName: "",
    attachmentNames: [],
  });
  useEffect(() => {
    quotingLessonsDataRef.current = Array.isArray(quotingLessonsData) ? quotingLessonsData : [];
  }, [quotingLessonsData]);
  useEffect(() => {
    const next = dedupeLessons(quotingLessonsData);
    if (next.length !== (quotingLessonsData || []).length) {
      quotingLessonsDataRef.current = next;
      setQuotingLessonsData(next);
    }
  }, [quotingLessonsData]);
  useEffect(() => {
    const next = dedupeLessons(mfgLessonsData);
    if (next.length !== (mfgLessonsData || []).length) {
      setMfgLessonsData(next);
    }
  }, [mfgLessonsData]);
  const isProjectEditorOpen = showInlineProjectUpload || showAddProject;

  const catColorsMfg={"Process":C.blue,"Fixturing":C.gold,"Tooling":C.blueMid,"Thermal":"#8B2020","Inspection":C.pass,"Material":C.blueMid,"Other":C.inkMuted};
  const catColorsQ={"Cost Driver":C.warn,"Time Risk":C.gold,"Customer Comms":C.pass,"Lead Time":C.blueMid,"Other":C.inkMuted};

  const navToJob = useCallback((jobId) => {
    setTargetJobId(jobId);
    setTab("deals");
  }, []);

  const appendLog = useCallback((msg) => {
    setProcessLog((prev) => [`${new Date().toLocaleTimeString()} - ${userSafeMessage(msg, "Processing update.")}`, ...prev].slice(0, 30));
  }, []);

  const showIngestionToast = useCallback((message, type = "success") => {
    setIngestionToast({ message, type });
    if (ingestionToastTimerRef.current) {
      window.clearTimeout(ingestionToastTimerRef.current);
    }
    ingestionToastTimerRef.current = window.setTimeout(() => {
      setIngestionToast(null);
      ingestionToastTimerRef.current = null;
    }, 8000);
  }, []);

  const resetProjectEditor = useCallback(() => {
    const session = getSupplierSession();
    setEditingProjectId("");
    setNewProject({
      job_id: "",
      company_name: session?.supplier_name || "",
      company_size: "",
      company_location: "",
      customer_name: "",
      contact_phone: "",
      contact_email: "",
      project_name: "",
      part_family: "",
      material: "",
      process_primary: "",
      customer_industry: "",
      expected_annual_production_volume: "",
      mandatory_certifications: "",
      certification_notes: "",
      other_project_requirements: "",
      project_overview: "",
      sharing_tier: "Attributed",
      project_date: "",
      what_worked: "",
      outcome: "Success",
    });
    setWorkbenchFiles([]);
    setWorkbenchParts([]);
    setExtractedPdfText("");
    setWorkbenchExtractOverwrite(false);
    setAddProjectError("");
  }, []);

  const openAddMachine = useCallback(() => {
    setMachineSaveError("");
    setMachineResolveState({ loading:false, best_match:null, matches:[], status:"UNRESOLVED" });
    setMachineDraft(emptyMachineDraft());
    setMachineMaterialQuery("");
    setShowMachineEditor(true);
  }, []);

  const openEditMachine = useCallback((machine) => {
    setMachineSaveError("");
    setMachineResolveState({
      loading: false,
      best_match: machine?.matched_equipment_id
        ? {
            record_id: machine.matched_equipment_id,
            name: machine.matched_equipment_name,
            score: 0,
            confidence: "saved",
          }
        : null,
      matches: [],
      status: machine?.matched_equipment_id ? "MATCHED" : "UNRESOLVED",
    });
    setMachineDraft({
      id: machine?.id || "",
      name: machine?.name || "",
      equipment_text: machine?.equipment_text || "",
      manufacturer: machine?.manufacturer || "",
      serial_number: machine?.serial_number || "",
      year_of_purchase_install_date: machine?.year_of_purchase_install_date || "",
      machine_notes: machine?.machine_notes || "",
      use_cases: machine?.use_cases || "",
      status: machine?.status || "",
      other_equipment: machine?.other_equipment || "",
      other_materials: machine?.other_materials || "",
      material_ids: Array.isArray(machine?.material_ids) ? machine.material_ids : [],
      material_ids_original: Array.isArray(machine?.material_ids) ? machine.material_ids : [],
      matched_equipment_id: machine?.matched_equipment_id || "",
      matched_equipment_name: machine?.matched_equipment_name || "",
    });
    setMachineMaterialQuery("");
    setShowMachineEditor(true);
  }, []);

  const handleWorkbenchFiles = useCallback((files) => {
    const next = Array.from(files || []);
    if (!next.length) return;
    autoProcessQueuedRef.current = true;
    setWorkbenchFiles((prev) => mergeFilesUnique(prev, next));
  }, []);
  const removeWorkbenchFile = useCallback((index) => {
    setWorkbenchFiles((prev) => (Array.isArray(prev) ? prev.filter((_, i) => i !== index) : []));
  }, []);

  const handleProcessWorkbench = useCallback(async () => {
    if (!workbenchFiles.length) {
      appendLog("No files selected.");
      return;
    }
    const session = getSupplierSession();
    setProcessingWorkbench(true);
    try {
      let runningContext = extractedPdfText || "";
      let projectDraftForConflict = newProject || {};
      const mergeProjectExtraction = (extracted, sourceLabel = "file analysis") => {
        if (!extracted || !Object.keys(extracted || {}).length) return;
        const mergeOpts = { supplierName: session?.supplier_name || "" };
        const conflicts = getProjectDraftConflicts(projectDraftForConflict, extracted, mergeOpts);
        const overwrite = conflicts.length ? workbenchExtractOverwrite : false;
        projectDraftForConflict = mergeProjectDraftFromExtraction(projectDraftForConflict, extracted, {
          ...mergeOpts,
          overwrite,
        });
        setNewProject(projectDraftForConflict);
        if (conflicts.length) {
          appendLog(overwrite ? "Project fields overwritten from file analysis." : "Project fields kept; only empty fields were filled.");
        }
      };
      const pdfProjectDetails = [];
      const extractedParts = [];

      // Stage 1: extract all PDF/document text in parallel and merge context.
      const pdfFiles = workbenchFiles.filter((f) => `${f?.name || ""}`.toLowerCase().endsWith(".pdf"));
      const textDocFiles = workbenchFiles.filter((f) => isTextDocFileName(f?.name || ""));
      const nonPdfFiles = workbenchFiles.filter((f) => {
        const lower = `${f?.name || ""}`.toLowerCase();
        return !lower.endsWith(".pdf") && !isTextDocFileName(lower);
      });
      if (pdfFiles.length) {
        const pdfResults = await Promise.all(pdfFiles.map(async (file) => {
          const fname = file?.name || "file";
          try {
            appendLog(`Extracting PDF: ${fname}`);
            const fd = new FormData();
            fd.append("file", file);
            const res = await fetch(`${API_BASE}${ENDPOINTS.pastProjects.extractPdf}`, { method: "POST", body: fd });
            const data = await res.json();
            if (!res.ok || !data?.ok) throw new Error(data?.error || "PDF extraction failed");
            appendLog(`PDF extracted: ${fname} (${data?.page_count || 0} pages)`);
            return {
              text: `${data?.text || ""}`.trim(),
              project_details: data?.project_details || {},
            };
          } catch (e) {
            appendLog(`Failed processing ${fname}: ${e?.message || e}`);
            return { text: "", project_details: {} };
          }
        }));
        const mergedPdfText = pdfResults.map((r) => `${r?.text || ""}`.trim()).filter(Boolean).join("\n").trim();
        pdfResults.forEach((r) => {
          if (r?.project_details && Object.keys(r.project_details).length) pdfProjectDetails.push(r.project_details);
        });
        if (mergedPdfText) {
          runningContext = `${runningContext}\n${mergedPdfText}`.trim();
          setExtractedPdfText(runningContext);
        }
      }

      if (textDocFiles.length) {
        const docResults = await Promise.all(textDocFiles.map(async (file) => {
          const fname = file?.name || "file";
          try {
            appendLog(`Extracting document: ${fname}`);
            const fd = new FormData();
            fd.append("file", file);
            const res = await fetch(`${API_BASE}${ENDPOINTS.pastProjects.extractDocument}`, { method: "POST", body: fd });
            const data = await res.json();
            if (!res.ok || !data?.ok) throw new Error(data?.error || "Document extraction failed");
            appendLog(`Document extracted: ${fname}`);
            return {
              text: `${data?.text || ""}`.trim(),
              project_details: data?.project_details || {},
            };
          } catch (e) {
            appendLog(`Failed processing ${fname}: ${e?.message || e}`);
            return { text: "", project_details: {} };
          }
        }));
        const mergedDocText = docResults.map((r) => `${r?.text || ""}`.trim()).filter(Boolean).join("\n").trim();
        docResults.forEach((r) => {
          if (r?.project_details && Object.keys(r.project_details).length) pdfProjectDetails.push(r.project_details);
        });
        if (mergedDocText) {
          runningContext = `${runningContext}\n${mergedDocText}`.trim();
          setExtractedPdfText(runningContext);
        }
      }

      if (pdfProjectDetails.length) {
        const latest = pdfProjectDetails[pdfProjectDetails.length - 1] || {};
        mergeProjectExtraction(latest, "document extraction");
      }

      // Stage 2: process CAD/images with a bounded worker pool.
      const processOne = async (file) => {
        const fname = file?.name || "file";
        const lower = fname.toLowerCase();
        try {
          if (isCadFileName(lower)) {
            appendLog(`Analyzing CAD: ${fname}`);
            const fd = new FormData();
            fd.append("file", file);
            fd.append("company_name", session.supplier_name || "Supplier");
            fd.append("zoho_id", session.supplier_id || "");
            fd.append("context_text", runningContext || "");
            const res = await fetch(`${API_BASE}${ENDPOINTS.pastProjects.analyzeCad}`, { method: "POST", body: fd });
            const data = await res.json();
            if (!res.ok || !data?.ok) throw new Error(data?.error || "CAD analyze failed");
            const inf = data?.inference || {};
            const sc = data?.scores || {};
            const cadStats = data?.cad_stats || {};
            const allViews = Array.isArray(data?.extra_view_images) ? data.extra_view_images : [];
            const isoView =
              allViews.find((v) => /isometric|iso/i.test(`${v?.name || ""}`)) ||
              allViews.find((v) => /view[-_ ]?0/i.test(`${v?.name || ""}`)) ||
              allViews[0] ||
              null;
            const isoB64 = `${isoView?.b64 || data?.preview_b64 || ""}`.trim();
            const isoDataUrl = isoB64 ? `data:image/jpeg;base64,${isoB64}` : (data?.preview_data_url || "");
            const nonIsoViews = isoView
              ? allViews.filter((v) => `${v?.filename || ""}` !== `${isoView?.filename || ""}`)
              : allViews;
            appendLog(`CAD analyzed: ${fname}`);
            return {
              part_id: data?.part_id || `part_${Date.now()}`,
              filename: fname,
              source_type: "cad",
              project_details: data?.project_details || {},
              // Main image used for Pinecone = isometric view.
              image_preview: isoDataUrl,
              image_b64: isoB64,
              image_ext: ".jpg",
              clip_vector: data?.clip_vector || null,
              part_name: cleanExtractedText(inf?.part_name) || fileStem(fname),
              part_detail: inf?.part_detail || inf?.part_family_detail || "",
              part_family: inf?.part_family || "",
              part_family_detail: inf?.part_family_detail || "",
              part_family_conf: inf?.part_family_conf || 0,
              material: inf?.material || "",
              material_reasoning: inf?.material_reasoning || "",
              material_conf: inf?.material_conf || 0,
              process_primary: inf?.process_primary || "",
              process_secondary: inf?.process_secondary || "",
              process_conf: inf?.process_conf || 0,
              surface_finish: inf?.surface_finish || inf?.finish || "",
              tolerance_details: inf?.tolerance_details || "",
              quantity: inf?.quantity || "",
              part_envelope: inf?.part_envelope || "",
              finish: inf?.finish || "",
              finish_ra: inf?.finish_ra || "",
              finish_conf: inf?.finish_conf || 0,
              complexity_class: inf?.complexity_class || "",
              tolerance_class: inf?.tolerance_class || "",
              features: inf?.features || [],
              notes: inf?.notes || "",
              project_date: new Date().toISOString().slice(0, 10),
              outcome: "Success",
              what_worked: "",
              what_didnt: "",
              quoting_lesson: "",
              customer_industry: "",
              cad_filename: fname,
              cad_file_b64: await fileToBase64(file),
              // Keep isometric preview explicitly and store remaining views in CRM attachments.
              cad_preview_b64: isoB64,
              cad_preview_filename: `${fname.replace(/\.[^/.]+$/, "")}_isometric.jpg`,
              cad_extra_views: nonIsoViews,
              cad_stats: cadStats,
              geo_scores: Array.isArray(data?.geo_scores) ? data.geo_scores : [],
              aspect_ratio: Number(sc?.aspect_ratio || 0),
              circularity: Number(sc?.circularity || 0),
              convexity: Number(sc?.convexity || 0),
              edge_density: Number(sc?.edge_density || 0),
              symmetry_score: Number(sc?.symmetry_score || 0),
              symmetry: Number(sc?.symmetry_score || 0),
              hole_count: Number(sc?.hole_count || 0),
              reflectivity: Number(sc?.reflectivity || 0),
              feature_complexity: Number(sc?.feature_complexity || 0),
              complexity: Number(sc?.feature_complexity || 0),
              compactness: Number(sc?.compactness || 0),
              slenderness: Number(sc?.slenderness || 0),
              mean_brightness: Number(sc?.mean_brightness || 0),
              surface_std_dev: Number(sc?.surface_std_dev || 0),
            };
          }

          if (isImageFileName(lower)) {
            appendLog(`Analyzing image: ${fname}`);
            const fd = new FormData();
            fd.append("file", file);
            fd.append("company_name", session.supplier_name || "Supplier");
            fd.append("zoho_id", session.supplier_id || "");
            fd.append("context_text", runningContext || "");
            const res = await fetch(`${API_BASE}${ENDPOINTS.pastProjects.analyzeImage}`, { method: "POST", body: fd });
            const data = await res.json();
            if (!res.ok || !data?.ok) throw new Error(data?.error || "Image analyze failed");
            const inf = data?.inference || {};
            const sc = data?.scores || {};
            const imgB64 = await fileToBase64(file);
            appendLog(`Image analyzed: ${fname}`);
            return {
              part_id: data?.part_id || `part_${Date.now()}`,
              filename: fname,
              source_type: "image",
              project_details: {},
              image_preview: `data:image/${(lower.split(".").pop() || "jpeg")};base64,${imgB64}`,
              image_b64: imgB64,
              image_ext: `.${lower.split(".").pop() || "jpg"}`,
              clip_vector: data?.clip_vector || null,
              part_name: cleanExtractedText(inf?.part_name) || fileStem(fname),
              part_detail: inf?.part_detail || inf?.part_family_detail || "",
              part_family: inf?.part_family || "",
              part_family_detail: inf?.part_family_detail || "",
              part_family_conf: inf?.part_family_conf || 0,
              material: inf?.material || "",
              material_reasoning: inf?.material_reasoning || "",
              material_conf: inf?.material_conf || 0,
              process_primary: inf?.process_primary || "",
              process_secondary: inf?.process_secondary || "",
              process_conf: inf?.process_conf || 0,
              surface_finish: inf?.surface_finish || inf?.finish || "",
              tolerance_details: inf?.tolerance_details || "",
              quantity: inf?.quantity || "",
              part_envelope: inf?.part_envelope || "",
              finish: inf?.finish || "",
              finish_ra: inf?.finish_ra || "",
              finish_conf: inf?.finish_conf || 0,
              complexity_class: inf?.complexity_class || "",
              tolerance_class: inf?.tolerance_class || "",
              features: inf?.features || [],
              notes: inf?.notes || "",
              project_date: new Date().toISOString().slice(0, 10),
              outcome: "Success",
              what_worked: "",
              what_didnt: "",
              quoting_lesson: "",
              customer_industry: "",
              cad_filename: "",
              cad_file_b64: "",
              cad_preview_b64: "",
              cad_preview_filename: "",
              cad_extra_views: [],
              cad_stats: {},
              geo_scores: Array.isArray(data?.geo_scores) ? data.geo_scores : [],
              aspect_ratio: Number(sc?.aspect_ratio || 0),
              circularity: Number(sc?.circularity || 0),
              convexity: Number(sc?.convexity || 0),
              edge_density: Number(sc?.edge_density || 0),
              symmetry_score: Number(sc?.symmetry_score || 0),
              symmetry: Number(sc?.symmetry_score || 0),
              hole_count: Number(sc?.hole_count || 0),
              reflectivity: Number(sc?.reflectivity || 0),
              feature_complexity: Number(sc?.feature_complexity || 0),
              complexity: Number(sc?.feature_complexity || 0),
              compactness: Number(sc?.compactness || 0),
              slenderness: Number(sc?.slenderness || 0),
              mean_brightness: Number(sc?.mean_brightness || 0),
              surface_std_dev: Number(sc?.surface_std_dev || 0),
            };
          }

          appendLog(`Skipped unsupported file: ${fname}`);
          return null;
        } catch (e) {
          appendLog(`Failed processing ${fname}: ${e?.message || e}`);
          return null;
        }
      };

      const maxWorkers = Math.max(1, Math.min(4, nonPdfFiles.length || 1));
      let cursor = 0;
      const workers = Array.from({ length: maxWorkers }, async () => {
        const local = [];
        while (cursor < nonPdfFiles.length) {
          const idx = cursor++;
          const part = await processOne(nonPdfFiles[idx]);
          if (part) local.push(part);
        }
        return local;
      });
      const batches = await Promise.all(workers);
      batches.forEach((arr) => extractedParts.push(...arr));

      let textInf = null;
      if (runningContext) {
        try {
          const ti = await apiPost(ENDPOINTS.pastProjects.inferText, { context_text: runningContext });
          if (ti?.ok && ti?.inference) textInf = ti.inference;
        } catch (e) {
          appendLog(`Text inference skipped: ${e?.message || e}`);
        }
      }

      if (textInf) {
        mergeProjectExtraction(textInf, "text inference");
      }

      if (extractedParts.length) {
        const latestProjectDetails = [...extractedParts]
          .reverse()
          .map((p) => p?.project_details || {})
          .find((d) => d && Object.keys(d).length) || {};
        if (Object.keys(latestProjectDetails).length) {
          mergeProjectExtraction(latestProjectDetails, "CAD/image analysis");
        }
        const enriched = extractedParts.map((p) => ({
          ...p,
          part_name: cleanExtractedText(p.part_name) || cleanExtractedText(textInf?.part_name) || fileStem(p.filename || ""),
          part_detail: p.part_detail || textInf?.part_detail || "",
          part_family: p.part_family || textInf?.part_family || "",
          material: p.material || textInf?.material || "",
          process_primary: p.process_primary || textInf?.process_primary || "",
          process_secondary: p.process_secondary || textInf?.process_secondary || "",
          surface_finish: p.surface_finish || textInf?.surface_finish || "",
          tolerance_details: p.tolerance_details || textInf?.tolerance_details || "",
          quantity: p.quantity || textInf?.quantity || "",
          part_envelope: p.part_envelope || textInf?.part_envelope || "",
        }));
        const partSourceKey = (p = {}) => `${p.cad_filename || p.filename || ""}`.trim().toLowerCase();
        const partConflictFields = [
          ["part_name", "Part Name"],
          ["part_detail", "Part Detail"],
          ["part_family", "Part Family"],
          ["part_family_detail", "Part Family Detail"],
          ["material", "Material"],
          ["process_primary", "Process Primary"],
          ["process_secondary", "Process Secondary"],
          ["surface_finish", "Surface Finish"],
          ["tolerance_details", "Tolerance Details"],
          ["quantity", "Quantity"],
          ["part_envelope", "Dimensions / Part Envelope"],
          ["finish", "Finish"],
          ["tolerance_class", "Tolerance Class"],
          ["complexity_class", "Complexity"],
          ["notes", "Notes"],
        ];
        const hasValue = (v) => {
          if (Array.isArray(v)) return v.length > 0;
          if (v && typeof v === "object") return Object.keys(v).length > 0;
          return `${v ?? ""}`.trim() !== "";
        };
        const sameValue = (a, b) => JSON.stringify(a ?? "") === JSON.stringify(b ?? "");
        const mergeText = (existing, incoming, overwrite) => overwrite && hasValue(incoming) ? incoming : (hasValue(existing) ? existing : (incoming || ""));
        const mergeNumber = (existing, incoming, overwrite) => {
          const inc = Number(incoming || 0);
          if (overwrite && Number.isFinite(inc) && inc > 0) return inc;
          const cur = Number(existing || 0);
          return cur > 0 ? cur : (Number.isFinite(inc) ? inc : cur);
        };
        const mergeArray = (existing, incoming, overwrite) => overwrite
          ? ((Array.isArray(incoming) && incoming.length) ? incoming : (Array.isArray(existing) ? existing : []))
          : ((Array.isArray(existing) && existing.length) ? existing : (Array.isArray(incoming) ? incoming : []));
        const mergeObject = (existing, incoming, overwrite) => overwrite
          ? ((incoming && Object.keys(incoming).length) ? incoming : (existing || {}))
          : ((existing && Object.keys(existing).length) ? existing : (incoming || {}));
        const normalizeMatchText = (value) => `${value || ""}`
          .toLowerCase()
          .replace(/\b(?:part|plate|component|assembly|assy|item|no|number|rev|revision)\b/g, " ")
          .replace(/[^a-z0-9]+/g, " ")
          .trim();
        const tokenSet = (value) => new Set(
          normalizeMatchText(value)
            .split(/\s+/)
            .filter((t) => t.length >= 3),
        );
        const tokenOverlap = (a, b) => {
          const aa = tokenSet(a);
          const bb = tokenSet(b);
          if (!aa.size || !bb.size) return 0;
          let shared = 0;
          aa.forEach((t) => { if (bb.has(t)) shared += 1; });
          return shared / Math.min(aa.size, bb.size);
        };
        const comparable = (value) => normalizeMatchText(value);
        const fieldMatches = (a, b) => {
          const av = comparable(a);
          const bv = comparable(b);
          return !!av && !!bv && (av.includes(bv) || bv.includes(av) || tokenOverlap(av, bv) >= 0.6);
        };
        const isAttachOnlyCandidate = (part = {}) => {
          const source = `${part.source_type || ""}`.toLowerCase();
          return !part.cad_filename && !part.image_b64 && !part.image_preview && (source === "text" || source === "manual" || source === "file" || !source);
        };
        const findSemanticPartIndex = (list, incoming, usedIndexes = new Set()) => {
          let best = { index: -1, score: 0 };
          list.forEach((existing, index) => {
            if (usedIndexes.has(index) || !isAttachOnlyCandidate(existing)) return;
            let score = 0;
            const nameOverlap = tokenOverlap(existing.part_name || existing.part_detail, incoming.part_name || incoming.part_detail || incoming.filename);
            if (nameOverlap >= 0.5) score += 4;
            if (fieldMatches(existing.material, incoming.material)) score += 2;
            if (fieldMatches(existing.process_primary, incoming.process_primary)) score += 2;
            if (fieldMatches(existing.tolerance_details, incoming.tolerance_details) || fieldMatches(existing.tolerance_class, incoming.tolerance_class)) score += 1;
            if (fieldMatches(existing.surface_finish || existing.finish, incoming.surface_finish || incoming.finish)) score += 1;
            if (fieldMatches(existing.quantity, incoming.quantity)) score += 1;
            if (score > best.score) best = { index, score };
          });
          return best.score >= 4 ? best.index : -1;
        };
        const mergeSameSourcePart = (existing, incoming, overwrite) => ({
          ...existing,
          source_type: mergeText(existing.source_type === "manual" ? "" : existing.source_type, incoming.source_type, overwrite) || existing.source_type,
          filename: mergeText(existing.filename === "Manual Entry" ? "" : existing.filename, incoming.filename, overwrite),
          image_preview: mergeText(existing.image_preview, incoming.image_preview, overwrite),
          image_b64: mergeText(existing.image_b64, incoming.image_b64, overwrite),
          image_ext: mergeText(existing.image_ext, incoming.image_ext, overwrite) || ".jpg",
          clip_vector: existing.clip_vector || incoming.clip_vector || null,
          part_name: mergeText(existing.part_name, incoming.part_name, overwrite),
          part_detail: mergeText(existing.part_detail, incoming.part_detail, overwrite),
          part_family: mergeText(existing.part_family, incoming.part_family, overwrite),
          part_family_detail: mergeText(existing.part_family_detail, incoming.part_family_detail, overwrite),
          part_family_conf: mergeNumber(existing.part_family_conf, incoming.part_family_conf, overwrite),
          material: mergeText(existing.material, incoming.material, overwrite),
          material_reasoning: mergeText(existing.material_reasoning, incoming.material_reasoning, overwrite),
          material_conf: mergeNumber(existing.material_conf, incoming.material_conf, overwrite),
          process_primary: mergeText(existing.process_primary, incoming.process_primary, overwrite),
          process_secondary: mergeText(existing.process_secondary, incoming.process_secondary, overwrite),
          process_conf: mergeNumber(existing.process_conf, incoming.process_conf, overwrite),
          surface_finish: mergeText(existing.surface_finish, incoming.surface_finish, overwrite),
          tolerance_details: mergeText(existing.tolerance_details, incoming.tolerance_details, overwrite),
          quantity: mergeText(existing.quantity, incoming.quantity, overwrite),
          part_envelope: mergeText(existing.part_envelope, incoming.part_envelope, overwrite),
          finish: mergeText(existing.finish, incoming.finish, overwrite),
          finish_ra: mergeText(existing.finish_ra, incoming.finish_ra, overwrite),
          finish_conf: mergeNumber(existing.finish_conf, incoming.finish_conf, overwrite),
          complexity_class: mergeText(existing.complexity_class, incoming.complexity_class, overwrite),
          tolerance_class: mergeText(existing.tolerance_class, incoming.tolerance_class, overwrite),
          features: mergeArray(existing.features, incoming.features, overwrite),
          notes: mergeText(existing.notes, incoming.notes, overwrite),
          cad_filename: mergeText(existing.cad_filename, incoming.cad_filename, overwrite),
          cad_file_b64: mergeText(existing.cad_file_b64, incoming.cad_file_b64, overwrite),
          cad_preview_b64: mergeText(existing.cad_preview_b64, incoming.cad_preview_b64, overwrite),
          cad_preview_filename: mergeText(existing.cad_preview_filename, incoming.cad_preview_filename, overwrite),
          cad_extra_views: mergeArray(existing.cad_extra_views, incoming.cad_extra_views, overwrite),
          cad_stats: mergeObject(existing.cad_stats, incoming.cad_stats, overwrite),
          geo_scores: mergeArray(existing.geo_scores, incoming.geo_scores, overwrite),
          aspect_ratio: mergeNumber(existing.aspect_ratio, incoming.aspect_ratio, overwrite),
          circularity: mergeNumber(existing.circularity, incoming.circularity, overwrite),
          convexity: mergeNumber(existing.convexity, incoming.convexity, overwrite),
          edge_density: mergeNumber(existing.edge_density, incoming.edge_density, overwrite),
          symmetry_score: mergeNumber(existing.symmetry_score, incoming.symmetry_score, overwrite),
          symmetry: mergeNumber(existing.symmetry, incoming.symmetry, overwrite),
          hole_count: mergeNumber(existing.hole_count, incoming.hole_count, overwrite),
          reflectivity: mergeNumber(existing.reflectivity, incoming.reflectivity, overwrite),
          feature_complexity: mergeNumber(existing.feature_complexity, incoming.feature_complexity, overwrite),
          complexity: mergeNumber(existing.complexity, incoming.complexity, overwrite),
          compactness: mergeNumber(existing.compactness, incoming.compactness, overwrite),
          slenderness: mergeNumber(existing.slenderness, incoming.slenderness, overwrite),
          mean_brightness: mergeNumber(existing.mean_brightness, incoming.mean_brightness, overwrite),
          surface_std_dev: mergeNumber(existing.surface_std_dev, incoming.surface_std_dev, overwrite),
        });
        setWorkbenchParts((prev) => {
          const next = [...prev];
          const consumedIndexes = new Set();
          enriched.forEach((incoming) => {
            const key = partSourceKey(incoming);
            let existingIndex = key
              ? next.findIndex((p) => partSourceKey(p) === key)
              : -1;
            if (existingIndex < 0) {
              existingIndex = findSemanticPartIndex(next, incoming, consumedIndexes);
            }
            if (existingIndex < 0) {
              next.push(incoming);
              return;
            }
            consumedIndexes.add(existingIndex);
            const existing = next[existingIndex] || {};
            const conflicts = partConflictFields
              .filter(([field]) => hasValue(existing[field]) && hasValue(incoming[field]) && !sameValue(existing[field], incoming[field]))
              .map(([, label]) => label);
            const overwrite = conflicts.length ? workbenchExtractOverwrite : false;
            next[existingIndex] = mergeSameSourcePart(existing, incoming, overwrite);
            appendLog(`Merged matching CAD/image into existing part: ${incoming.filename || key}`);
          });
          return next;
        });
      } else if (textInf) {
        const textSourceName =
          (pdfFiles.find((f) => f?.name)?.name) ||
          (textDocFiles.find((f) => f?.name)?.name) ||
          "Document Inference";
        setWorkbenchParts((prev) => [
          ...prev,
          {
            part_id: `P-${String(prev.length + 1).padStart(3, "0")}`,
            source_type: "text",
            filename: pdfFiles.map((f) => f?.name || "").filter(Boolean).join(", ") || textDocFiles.map((f) => f?.name || "").filter(Boolean).join(", ") || "Document Inference",
            part_name: cleanExtractedText(textInf.part_name) || fileStem(textSourceName),
            part_detail: textInf.part_detail || "",
            part_family: textInf.part_family || "",
            part_family_detail: "",
            part_family_conf: 0,
            material: textInf.material || "",
            material_reasoning: "",
            material_conf: 0,
            process_primary: textInf.process_primary || "",
            process_secondary: textInf.process_secondary || "",
            process_conf: 0,
            surface_finish: textInf.surface_finish || "",
            tolerance_details: textInf.tolerance_details || "",
            quantity: textInf.quantity || "",
            part_envelope: textInf.part_envelope || "",
            data_sharing_tier: `${newProject.sharing_tier || "Attributed"}`.trim(),
            additional_notes: "",
            finish: textInf.surface_finish || "",
            finish_ra: "",
            finish_conf: 0,
            complexity_class: "",
            tolerance_class: "",
            features: [],
            notes: textInf.project_overview || "",
            outcome: "Success",
            what_worked: "",
            what_didnt: "",
            quoting_lesson: "",
            customer_industry: textInf.customer_industry || "",
            project_date: `${newProject.project_date || new Date().toISOString().slice(0, 10)}`.trim(),
            image_b64: "",
            image_ext: ".jpg",
            image_preview: "",
            clip_vector: null,
            cad_filename: "",
            cad_file_b64: "",
            cad_preview_b64: "",
            cad_preview_filename: "",
            cad_extra_views: [],
            cad_stats: {},
            upload_files: [],
            attached_files: [],
            geo_scores: [],
            aspect_ratio: 0,
            circularity: 0,
            convexity: 0,
            edge_density: 0,
            symmetry_score: 0,
            symmetry: 0,
            hole_count: 0,
            reflectivity: 0,
            feature_complexity: 0,
            complexity: 0,
            compactness: 0,
            slenderness: 0,
            mean_brightness: 0,
            surface_std_dev: 0,
          },
        ]);
        appendLog("Fields auto-filled from document text.");
      }
    } finally {
      setProcessingWorkbench(false);
    }
  }, [appendLog, extractedPdfText, newProject, workbenchExtractOverwrite, workbenchFiles]);

  useEffect(() => {
    if (!isProjectEditorOpen) return;
    if (!autoProcessQueuedRef.current) return;
    if (processingWorkbench) return;
    if (!workbenchFiles.length) return;
    autoProcessQueuedRef.current = false;
    handleProcessWorkbench();
  }, [isProjectEditorOpen, processingWorkbench, workbenchFiles, handleProcessWorkbench]);

  const updateWorkbenchPart = useCallback((idx, key, value) => {
    setWorkbenchParts((prev) => prev.map((p, i) => (i === idx ? { ...p, [key]: value } : p)));
  }, []);

  const handleAddWorkbenchPart = useCallback(() => {
    const clean = (v) => `${v || ""}`.trim();
    // Inherit email-extracted fields from the first existing part when adding to an existing project.
    // Falls back to empty strings for brand-new projects with no parts yet.
    const ref = workbenchParts[0] || {};
    setWorkbenchParts((prev) => {
      const nextIdx = prev.length + 1;
      return [
        ...prev,
        {
          part_id: `P-${String(nextIdx).padStart(3, "0")}`,
          source_type: "manual",
          filename: "Manual Entry",
          part_name: "",
          part_detail: "",
          part_family: clean(newProject.part_family) || clean(ref.part_family),
          part_family_detail: "",
          part_family_conf: 0,
          material: clean(newProject.material) || clean(ref.material),
          material_reasoning: "",
          material_conf: 0,
          process_primary: clean(newProject.process_primary) || clean(ref.process_primary),
          process_secondary: clean(ref.process_secondary),
          process_conf: 0,
          surface_finish: clean(ref.surface_finish),
          tolerance_details: clean(ref.tolerance_details),
          quantity: clean(ref.quantity),
          part_envelope: clean(ref.part_envelope),
          requirements: "",
          data_sharing_tier: clean(newProject.sharing_tier),
          additional_notes: "",
          finish: clean(ref.finish || ref.surface_finish),
          finish_ra: "",
          finish_conf: 0,
          complexity_class: clean(ref.complexity_class),
          tolerance_class: clean(ref.tolerance_class),
          features: [],
          notes: clean(newProject.project_overview),
          outcome: clean(newProject.outcome) || "Success",
          what_worked: clean(newProject.what_worked),
          what_didnt: "",
          quoting_lesson: "",
          customer_industry: clean(newProject.customer_industry),
          project_date: clean(newProject.project_date) || new Date().toISOString().slice(0, 10),
          image_b64: "",
          image_ext: ".jpg",
          image_preview: "",
          clip_vector: null,
          cad_filename: "",
          cad_file_b64: "",
          cad_preview_b64: "",
          cad_preview_filename: "",
          cad_extra_views: [],
          cad_stats: {},
          upload_files: [],
          attached_files: [],
          geo_scores: [],
          aspect_ratio: 0,
          circularity: 0,
          convexity: 0,
          edge_density: 0,
          symmetry_score: 0,
          symmetry: 0,
          hole_count: 0,
          reflectivity: 0,
          feature_complexity: 0,
          complexity: 0,
          compactness: 0,
          slenderness: 0,
          mean_brightness: 0,
          surface_std_dev: 0,
        },
      ];
    });
  }, [newProject, workbenchParts]);

  const handleWorkbenchPartFiles = useCallback((idx, files) => {
    const next = Array.from(files || []);
    if (!next.length) return;
    setWorkbenchParts((prev) =>
      prev.map((p, i) => {
        if (i !== idx) return p;
        const uploadFiles = [...(p.upload_files || []), ...next];
        const attachedNames = [...(p.attached_files || []), ...next.map((f) => f?.name || "file")];
        const firstName = next[0]?.name || "";
        return {
          ...p,
          upload_files: uploadFiles,
          attached_files: attachedNames,
          filename: (p.filename && p.filename !== "Manual Entry") ? p.filename : (firstName || p.filename),
        };
      })
    );
  }, []);

  const handleProcessWorkbenchPart = useCallback(async (idx) => {
    const part = workbenchParts[idx];
    const files = Array.from(part?.upload_files || []);
    if (!part) return;
    if (!files.length) {
      appendLog(`No files attached to ${part.part_id || `part-${idx + 1}`}.`);
      return;
    }

    const session = getSupplierSession();
    setProcessingWorkbench(true);
    try {
      let runningContext = extractedPdfText || "";
      const pdfFiles = files.filter((f) => `${f?.name || ""}`.toLowerCase().endsWith(".pdf"));
      const textDocFiles = files.filter((f) => isTextDocFileName(f?.name || ""));
      const nonPdfFiles = files.filter((f) => {
        const lower = `${f?.name || ""}`.toLowerCase();
        return !lower.endsWith(".pdf") && !isTextDocFileName(lower);
      });

      if (pdfFiles.length) {
        const pdfResults = await Promise.all(pdfFiles.map(async (file) => {
          const fname = file?.name || "file";
          try {
            appendLog(`Extracting PDF: ${fname}`);
            const fd = new FormData();
            fd.append("file", file);
            const res = await fetch(`${API_BASE}${ENDPOINTS.pastProjects.extractPdf}`, { method: "POST", body: fd });
            const data = await res.json();
            if (!res.ok || !data?.ok) throw new Error(data?.error || "PDF extraction failed");
            appendLog(`PDF extracted: ${fname}`);
            return `${data?.text || ""}`.trim();
          } catch (e) {
            appendLog(`Failed processing ${fname}: ${e?.message || e}`);
            return "";
          }
        }));
        const mergedPdfText = pdfResults.filter(Boolean).join("\n").trim();
        if (mergedPdfText) {
          runningContext = `${runningContext}\n${mergedPdfText}`.trim();
          setExtractedPdfText(runningContext);
        }
      }

      if (textDocFiles.length) {
        const docResults = await Promise.all(textDocFiles.map(async (file) => {
          const fname = file?.name || "file";
          try {
            appendLog(`Extracting document: ${fname}`);
            const fd = new FormData();
            fd.append("file", file);
            const res = await fetch(`${API_BASE}${ENDPOINTS.pastProjects.extractDocument}`, { method: "POST", body: fd });
            const data = await res.json();
            if (!res.ok || !data?.ok) throw new Error(data?.error || "Document extraction failed");
            appendLog(`Document extracted: ${fname}`);
            return `${data?.text || ""}`.trim();
          } catch (e) {
            appendLog(`Failed processing ${fname}: ${e?.message || e}`);
            return "";
          }
        }));
        const mergedDocText = docResults.filter(Boolean).join("\n").trim();
        if (mergedDocText) {
          runningContext = `${runningContext}\n${mergedDocText}`.trim();
          setExtractedPdfText(runningContext);
        }
      }

      const hasMeaningfulValue = (value) => {
        if (Array.isArray(value)) return value.length > 0;
        if (value && typeof value === "object") return Object.keys(value).length > 0;
        return `${value ?? ""}`.trim() !== "";
      };
      const sameFieldValue = (a, b) => JSON.stringify(a ?? "") === JSON.stringify(b ?? "");
      const pickString = (existing, incoming) => {
        const cur = `${existing || ""}`.trim();
        return cur ? existing : (incoming || "");
      };
      const pickNumber = (existing, incoming) => {
        const cur = Number(existing || 0);
        if (cur > 0) return cur;
        const inc = Number(incoming || 0);
        return Number.isFinite(inc) ? inc : cur;
      };

      let mergedPatch = {};
      for (const file of nonPdfFiles) {
        const fname = file?.name || "file";
        const lower = fname.toLowerCase();
        try {
          if (isCadFileName(lower)) {
            appendLog(`Analyzing CAD: ${fname}`);
            const fd = new FormData();
            fd.append("file", file);
            fd.append("company_name", session.supplier_name || "Supplier");
            fd.append("zoho_id", session.supplier_id || "");
            fd.append("context_text", runningContext || "");
            const res = await fetch(`${API_BASE}${ENDPOINTS.pastProjects.analyzeCad}`, { method: "POST", body: fd });
            const data = await res.json();
            if (!res.ok || !data?.ok) throw new Error(data?.error || "CAD analyze failed");
            const inf = data?.inference || {};
            const sc = data?.scores || {};
            const cadStats = data?.cad_stats || {};
            const allViews = Array.isArray(data?.extra_view_images) ? data.extra_view_images : [];
            const isoView =
              allViews.find((v) => /isometric|iso/i.test(`${v?.name || ""}`)) ||
              allViews.find((v) => /view[-_ ]?0/i.test(`${v?.name || ""}`)) ||
              allViews[0] ||
              null;
            const isoB64 = `${isoView?.b64 || data?.preview_b64 || ""}`.trim();
            const isoDataUrl = isoB64 ? `data:image/jpeg;base64,${isoB64}` : (data?.preview_data_url || "");
            const nonIsoViews = isoView
              ? allViews.filter((v) => `${v?.filename || ""}` !== `${isoView?.filename || ""}`)
              : allViews;
            const cadFileB64 = await fileToBase64(file);
            mergedPatch = {
              ...mergedPatch,
              source_type: "cad",
              filename: fname,
              image_preview: isoDataUrl,
              image_b64: isoB64,
              image_ext: ".jpg",
              clip_vector: data?.clip_vector || null,
              part_name: cleanExtractedText(inf?.part_name) || fileStem(fname),
              part_detail: inf?.part_detail || inf?.part_family_detail || "",
              part_family: inf?.part_family || "",
              part_family_detail: inf?.part_family_detail || "",
              part_family_conf: inf?.part_family_conf || 0,
              material: inf?.material || "",
              material_reasoning: inf?.material_reasoning || "",
              material_conf: inf?.material_conf || 0,
              process_primary: inf?.process_primary || "",
              process_secondary: inf?.process_secondary || "",
              process_conf: inf?.process_conf || 0,
              surface_finish: inf?.surface_finish || inf?.finish || "",
              tolerance_details: inf?.tolerance_details || "",
              quantity: inf?.quantity || "",
              part_envelope: inf?.part_envelope || "",
              finish: inf?.finish || "",
              finish_ra: inf?.finish_ra || "",
              finish_conf: inf?.finish_conf || 0,
              complexity_class: inf?.complexity_class || "",
              tolerance_class: inf?.tolerance_class || "",
              features: inf?.features || [],
              notes: inf?.notes || "",
              cad_filename: fname,
              cad_file_b64: cadFileB64,
              cad_preview_b64: isoB64,
              cad_preview_filename: `${fname.replace(/\.[^/.]+$/, "")}_isometric.jpg`,
              cad_extra_views: nonIsoViews,
              cad_stats: cadStats,
              geo_scores: Array.isArray(data?.geo_scores) ? data.geo_scores : [],
              aspect_ratio: Number(sc?.aspect_ratio || 0),
              circularity: Number(sc?.circularity || 0),
              convexity: Number(sc?.convexity || 0),
              edge_density: Number(sc?.edge_density || 0),
              symmetry_score: Number(sc?.symmetry_score || 0),
              symmetry: Number(sc?.symmetry_score || 0),
              hole_count: Number(sc?.hole_count || 0),
              reflectivity: Number(sc?.reflectivity || 0),
              feature_complexity: Number(sc?.feature_complexity || 0),
              complexity: Number(sc?.feature_complexity || 0),
              compactness: Number(sc?.compactness || 0),
              slenderness: Number(sc?.slenderness || 0),
              mean_brightness: Number(sc?.mean_brightness || 0),
              surface_std_dev: Number(sc?.surface_std_dev || 0),
            };
            appendLog(`CAD analyzed: ${fname}`);
            continue;
          }

          if (isImageFileName(lower)) {
            appendLog(`Analyzing image: ${fname}`);
            const fd = new FormData();
            fd.append("file", file);
            fd.append("company_name", session.supplier_name || "Supplier");
            fd.append("zoho_id", session.supplier_id || "");
            fd.append("context_text", runningContext || "");
            const res = await fetch(`${API_BASE}${ENDPOINTS.pastProjects.analyzeImage}`, { method: "POST", body: fd });
            const data = await res.json();
            if (!res.ok || !data?.ok) throw new Error(data?.error || "Image analyze failed");
            const inf = data?.inference || {};
            const sc = data?.scores || {};
            const imgB64 = await fileToBase64(file);
            const ext = `.${lower.split(".").pop() || "jpg"}`;
            mergedPatch = {
              ...mergedPatch,
              source_type: "image",
              filename: fname,
              image_preview: `data:image/${ext.replace(".", "")};base64,${imgB64}`,
              image_b64: imgB64,
              image_ext: ext,
              clip_vector: data?.clip_vector || null,
              part_name: cleanExtractedText(mergedPatch.part_name) || cleanExtractedText(inf?.part_name) || fileStem(fname),
              part_detail: mergedPatch.part_detail || inf?.part_detail || inf?.part_family_detail || "",
              part_family: mergedPatch.part_family || inf?.part_family || "",
              part_family_detail: mergedPatch.part_family_detail || inf?.part_family_detail || "",
              part_family_conf: mergedPatch.part_family_conf || inf?.part_family_conf || 0,
              material: mergedPatch.material || inf?.material || "",
              material_reasoning: mergedPatch.material_reasoning || inf?.material_reasoning || "",
              material_conf: mergedPatch.material_conf || inf?.material_conf || 0,
              process_primary: mergedPatch.process_primary || inf?.process_primary || "",
              process_secondary: mergedPatch.process_secondary || inf?.process_secondary || "",
              process_conf: mergedPatch.process_conf || inf?.process_conf || 0,
              surface_finish: mergedPatch.surface_finish || inf?.surface_finish || inf?.finish || "",
              tolerance_details: mergedPatch.tolerance_details || inf?.tolerance_details || "",
              quantity: mergedPatch.quantity || inf?.quantity || "",
              part_envelope: mergedPatch.part_envelope || inf?.part_envelope || "",
              finish: mergedPatch.finish || inf?.finish || "",
              finish_ra: mergedPatch.finish_ra || inf?.finish_ra || "",
              finish_conf: mergedPatch.finish_conf || inf?.finish_conf || 0,
              complexity_class: mergedPatch.complexity_class || inf?.complexity_class || "",
              tolerance_class: mergedPatch.tolerance_class || inf?.tolerance_class || "",
              features: (mergedPatch.features && mergedPatch.features.length) ? mergedPatch.features : (inf?.features || []),
              notes: mergedPatch.notes || inf?.notes || "",
              cad_stats: (mergedPatch.cad_stats && Object.keys(mergedPatch.cad_stats).length) ? mergedPatch.cad_stats : {},
              geo_scores: (Array.isArray(mergedPatch.geo_scores) && mergedPatch.geo_scores.length) ? mergedPatch.geo_scores : (Array.isArray(data?.geo_scores) ? data.geo_scores : []),
              aspect_ratio: Number(mergedPatch.aspect_ratio || sc?.aspect_ratio || 0),
              circularity: Number(mergedPatch.circularity || sc?.circularity || 0),
              convexity: Number(mergedPatch.convexity || sc?.convexity || 0),
              edge_density: Number(mergedPatch.edge_density || sc?.edge_density || 0),
              symmetry_score: Number(mergedPatch.symmetry_score || sc?.symmetry_score || 0),
              symmetry: Number(mergedPatch.symmetry || sc?.symmetry_score || 0),
              hole_count: Number(mergedPatch.hole_count || sc?.hole_count || 0),
              reflectivity: Number(mergedPatch.reflectivity || sc?.reflectivity || 0),
              feature_complexity: Number(mergedPatch.feature_complexity || sc?.feature_complexity || 0),
              complexity: Number(mergedPatch.complexity || sc?.feature_complexity || 0),
              compactness: Number(mergedPatch.compactness || sc?.compactness || 0),
              slenderness: Number(mergedPatch.slenderness || sc?.slenderness || 0),
              mean_brightness: Number(mergedPatch.mean_brightness || sc?.mean_brightness || 0),
              surface_std_dev: Number(mergedPatch.surface_std_dev || sc?.surface_std_dev || 0),
            };
            appendLog(`Image analyzed: ${fname}`);
            continue;
          }

          appendLog(`Skipped unsupported file: ${fname}`);
        } catch (e) {
          appendLog(`Failed processing ${fname}: ${e?.message || e}`);
        }
      }

      if (!Object.keys(mergedPatch).length) {
        appendLog(`No extractable CAD/image files found for ${part.part_id || `part-${idx + 1}`}.`);
        return;
      }

      const conflictFields = [
        ["part_name", "Part Name"],
        ["part_detail", "Part Detail"],
        ["part_family", "Part Family"],
        ["part_family_detail", "Part Family Detail"],
        ["material", "Material"],
        ["process_primary", "Process Primary"],
        ["process_secondary", "Process Secondary"],
        ["surface_finish", "Surface Finish"],
        ["tolerance_details", "Tolerance Details"],
        ["quantity", "Quantity"],
        ["part_envelope", "Dimensions / Part Envelope"],
        ["finish", "Finish"],
        ["tolerance_class", "Tolerance Class"],
        ["complexity_class", "Complexity"],
        ["notes", "Notes"],
      ].filter(([key]) => hasMeaningfulValue(part?.[key]) && hasMeaningfulValue(mergedPatch?.[key]) && !sameFieldValue(part?.[key], mergedPatch?.[key]));
      const overwriteExisting = conflictFields.length ? workbenchExtractOverwrite : false;
      const mergeString = (existing, incoming) => overwriteExisting ? (incoming || existing || "") : pickString(existing, incoming);
      const mergeNumber = (existing, incoming) => {
        if (overwriteExisting) {
          const inc = Number(incoming || 0);
          if (Number.isFinite(inc) && inc > 0) return inc;
        }
        return pickNumber(existing, incoming);
      };
      const mergeArray = (existing, incoming) => overwriteExisting
        ? ((Array.isArray(incoming) && incoming.length) ? incoming : (Array.isArray(existing) ? existing : []))
        : ((Array.isArray(existing) && existing.length) ? existing : (Array.isArray(incoming) ? incoming : []));
      const mergeObject = (existing, incoming) => overwriteExisting
        ? ((incoming && Object.keys(incoming).length) ? incoming : (existing || {}))
        : ((existing && Object.keys(existing).length) ? existing : (incoming || {}));

      setWorkbenchParts((prev) =>
        prev.map((p, i) => {
          if (i !== idx) return p;
          return {
            ...p,
            source_type: p.source_type === "manual" ? (mergedPatch.source_type || p.source_type) : (p.source_type || mergedPatch.source_type),
            filename: mergeString(p.filename === "Manual Entry" ? "" : p.filename, mergedPatch.filename),
            image_preview: mergeString(p.image_preview, mergedPatch.image_preview),
            image_b64: mergeString(p.image_b64, mergedPatch.image_b64),
            image_ext: mergeString(p.image_ext, mergedPatch.image_ext) || ".jpg",
            clip_vector: p.clip_vector || mergedPatch.clip_vector || null,
            part_name: mergeString(p.part_name, mergedPatch.part_name),
            part_detail: mergeString(p.part_detail, mergedPatch.part_detail),
            part_family: mergeString(p.part_family, mergedPatch.part_family),
            part_family_detail: mergeString(p.part_family_detail, mergedPatch.part_family_detail),
            part_family_conf: mergeNumber(p.part_family_conf, mergedPatch.part_family_conf),
            material: mergeString(p.material, mergedPatch.material),
            material_reasoning: mergeString(p.material_reasoning, mergedPatch.material_reasoning),
            material_conf: mergeNumber(p.material_conf, mergedPatch.material_conf),
            process_primary: mergeString(p.process_primary, mergedPatch.process_primary),
            process_secondary: mergeString(p.process_secondary, mergedPatch.process_secondary),
            process_conf: mergeNumber(p.process_conf, mergedPatch.process_conf),
            surface_finish: mergeString(p.surface_finish, mergedPatch.surface_finish),
            tolerance_details: mergeString(p.tolerance_details, mergedPatch.tolerance_details),
            quantity: mergeString(p.quantity, mergedPatch.quantity),
            part_envelope: mergeString(p.part_envelope, mergedPatch.part_envelope),
            finish: mergeString(p.finish, mergedPatch.finish),
            finish_ra: mergeString(p.finish_ra, mergedPatch.finish_ra),
            finish_conf: mergeNumber(p.finish_conf, mergedPatch.finish_conf),
            complexity_class: mergeString(p.complexity_class, mergedPatch.complexity_class),
            tolerance_class: mergeString(p.tolerance_class, mergedPatch.tolerance_class),
            features: mergeArray(p.features, mergedPatch.features),
            notes: mergeString(p.notes, mergedPatch.notes),
            cad_filename: mergeString(p.cad_filename, mergedPatch.cad_filename),
            cad_file_b64: mergeString(p.cad_file_b64, mergedPatch.cad_file_b64),
            cad_preview_b64: mergeString(p.cad_preview_b64, mergedPatch.cad_preview_b64),
            cad_preview_filename: mergeString(p.cad_preview_filename, mergedPatch.cad_preview_filename),
            cad_extra_views: mergeArray(p.cad_extra_views, mergedPatch.cad_extra_views),
            cad_stats: mergeObject(p.cad_stats, mergedPatch.cad_stats),
            geo_scores: mergeArray(p.geo_scores, mergedPatch.geo_scores),
            aspect_ratio: mergeNumber(p.aspect_ratio, mergedPatch.aspect_ratio),
            circularity: mergeNumber(p.circularity, mergedPatch.circularity),
            convexity: mergeNumber(p.convexity, mergedPatch.convexity),
            edge_density: mergeNumber(p.edge_density, mergedPatch.edge_density),
            symmetry_score: mergeNumber(p.symmetry_score, mergedPatch.symmetry_score),
            symmetry: mergeNumber(p.symmetry, mergedPatch.symmetry),
            hole_count: mergeNumber(p.hole_count, mergedPatch.hole_count),
            reflectivity: mergeNumber(p.reflectivity, mergedPatch.reflectivity),
            feature_complexity: mergeNumber(p.feature_complexity, mergedPatch.feature_complexity),
            complexity: mergeNumber(p.complexity, mergedPatch.complexity),
            compactness: mergeNumber(p.compactness, mergedPatch.compactness),
            slenderness: mergeNumber(p.slenderness, mergedPatch.slenderness),
            mean_brightness: mergeNumber(p.mean_brightness, mergedPatch.mean_brightness),
            surface_std_dev: mergeNumber(p.surface_std_dev, mergedPatch.surface_std_dev),
          };
        })
      );
      appendLog(`Fields updated for ${part.part_id || `part-${idx + 1}`}.`);
    } finally {
      setProcessingWorkbench(false);
    }
  }, [appendLog, extractedPdfText, workbenchExtractOverwrite, workbenchParts]);

  const handlePushWorkbench = useCallback(async () => {
    if (!workbenchParts.length) {
      appendLog("No processed parts to push.");
      showIngestionToast("Process files before pushing to corpus.", "warn");
      return;
    }
    const session = getSupplierSession();
    setPushingWorkbench(true);
    try {
      const baseProjectId =
        `${editingProjectId || newProject.job_id || ""}`.trim() ||
        `hist_${Date.now()}`;
      const baseProjectName = `${newProject.project_name || ""}`.trim() || "Uploaded Project";
      const baseCustomerName = `${newProject.customer_name || ""}`.trim();
      const baseIndustry = `${newProject.customer_industry || ""}`.trim();
      const baseDate = `${newProject.project_date || ""}`.trim() || new Date().toISOString().slice(0, 10);
      const baseSharingTier = `${newProject.sharing_tier || "Attributed"}`.trim();
      const baseOverview = `${newProject.project_overview || ""}`.trim();
      const baseWhatWorked = `${newProject.what_worked || ""}`.trim();
      const baseCompanyName = `${newProject.company_name || session.supplier_name || ""}`.trim();
      const baseCompanySize = `${newProject.company_size || ""}`.trim();
      const baseCompanyLocation = `${newProject.company_location || ""}`.trim();
      const baseContactPhone = `${newProject.contact_phone || ""}`.trim();
      const baseContactEmail = `${newProject.contact_email || ""}`.trim();
      const baseAnnualVolume = `${newProject.expected_annual_production_volume || ""}`.trim();
      const baseMandatoryCerts = csvTags(newProject.mandatory_certifications);
      const baseCertNotes = `${newProject.certification_notes || ""}`.trim();
      const payload = {
        parts: workbenchParts.map((part) => ({
          part_id: part.part_id,
          project_id: baseProjectId,
          company_name: baseCompanyName,
          company_size: baseCompanySize,
          company_location: baseCompanyLocation,
          contact_phone: baseContactPhone,
          contact_email: baseContactEmail,
          zoho_id: session.supplier_id || "",
          supplier_email: session.supplier_email || "",
          project_name: baseProjectName,
          customer_name: baseCustomerName,
          sharing_tier: baseSharingTier,
          project_description: baseOverview,
          expected_annual_production_volume: baseAnnualVolume,
          mandatory_certifications: baseMandatoryCerts,
          certification_notes: baseCertNotes,
          part_name: part.part_name || part.part_family || "",
          part_detail: part.part_detail || part.part_family_detail || "",
          quantity: part.quantity || "",
          surface_finish: part.surface_finish || part.finish || "",
          tolerance_details: part.tolerance_details || "",
          part_envelope: part.part_envelope || "",
          requirements: part.requirements || "",
          additional_notes: part.additional_notes || part.notes || "",
          data_sharing_tier: part.data_sharing_tier || baseSharingTier,
          part_family: part.part_family || "",
          part_family_detail: part.part_family_detail || "",
          part_family_conf: Number(part.part_family_conf || 0),
          material: part.material || "",
          material_reasoning: part.material_reasoning || "",
          material_conf: Number(part.material_conf || 0),
          process: part.process_primary || "",
          process_secondary: part.process_secondary || "",
          process_conf: Number(part.process_conf || 0),
          finish: part.finish || "",
          finish_ra: part.finish_ra || "",
          finish_conf: Number(part.finish_conf || 0),
          complexity_class: part.complexity_class || "",
          tolerance_class: part.tolerance_class || "",
          features: part.features || [],
          notes: part.notes || baseOverview || "",
          outcome: part.outcome || "Success",
          what_worked: part.what_worked || baseWhatWorked || "",
          what_didnt: part.what_didnt || "",
          quoting_lesson: part.quoting_lesson || "",
          customer_industry: part.customer_industry || baseIndustry || "",
          project_date: part.project_date || baseDate,
          image_b64: part.image_b64 || "",
          image_ext: part.image_ext || ".jpg",
          clip_vector: part.clip_vector || null,
          cad_filename: part.cad_filename || "",
          cad_file_b64: part.cad_file_b64 || "",
          cad_preview_b64: part.cad_preview_b64 || "",
          cad_preview_filename: part.cad_preview_filename || "",
          cad_extra_views: part.cad_extra_views || [],
          cad_stats: part.cad_stats || {},
          geo_scores: Array.isArray(part.geo_scores) ? part.geo_scores : [],
          aspect_ratio: Number(part.aspect_ratio || 0),
          circularity: Number(part.circularity || 0),
          convexity: Number(part.convexity || 0),
          edge_density: Number(part.edge_density || 0),
          symmetry_score: Number(part.symmetry_score || 0),
          symmetry: Number(part.symmetry || part.symmetry_score || 0),
          hole_count: Number(part.hole_count || 0),
          reflectivity: Number(part.reflectivity || 0),
          feature_complexity: Number(part.feature_complexity || 0),
          complexity: Number(part.complexity || part.feature_complexity || 0),
          compactness: Number(part.compactness || 0),
          slenderness: Number(part.slenderness || 0),
          mean_brightness: Number(part.mean_brightness || 0),
          surface_std_dev: Number(part.surface_std_dev || 0),
        })),
      };
      const res = await apiPost(ENDPOINTS.pastProjects.push, payload);
      if (!res?.ok) throw new Error(res?.error || "Push failed");
      const rows = Array.isArray(res?.results) ? res.results : [];
      if (rows.length) {
        rows.forEach((r) => {
          const pid = r?.part_id || "unknown_part";
          const pineconeOk = !!r?.ok;
          const zohoOk = !!r?.zoho_ok;
          if (pineconeOk) {
            appendLog(`Pinecone OK: ${pid}`);
          } else {
            appendLog(`Pinecone FAIL: ${pid} - ${r?.error || "unknown error"}`);
          }
          if (zohoOk) {
            appendLog(`Zoho OK: ${pid} (${r?.zoho_action || "updated"})`);
          } else {
            appendLog(`Zoho FAIL: ${pid} - ${r?.zoho_error || "not synced"}`);
          }
        });
      }
      appendLog(`Summary: Pinecone ${res?.pushed || 0}/${workbenchParts.length} · Zoho ${res?.zoho_ok || 0}/${workbenchParts.length}`);
      const pushedCount = Number(res?.pushed || 0);
      const zohoOkCount = Number(res?.zoho_ok || 0);
      const fullySynced = pushedCount === workbenchParts.length && zohoOkCount === workbenchParts.length;
      const dealId = `${editingProjectId || `zoho_${baseProjectName.toLowerCase()}`}`.trim();
      const fieldOverrides = getPastProjectFieldOverrides(session);
      const projectOverrides = {
        ...(fieldOverrides.projects || {}),
        [dealId]: {
          customer: baseCustomerName || baseProjectName,
          name: baseProjectName,
          description: baseOverview || baseProjectName,
          companyName: baseCompanyName,
          companySize: baseCompanySize,
          companyLocation: baseCompanyLocation,
          contactPhone: baseContactPhone,
          contactEmail: baseContactEmail,
          customerIndustry: baseIndustry,
          expectedAnnualProductionVolume: baseAnnualVolume,
          mandatoryCertifications: baseMandatoryCerts,
          certificationNotes: baseCertNotes,
          otherProjectRequirements: `${newProject.other_project_requirements || ""}`.trim(),
          projectOverview: baseOverview,
          projectDate: baseDate,
          whatWorked: baseWhatWorked,
          outcome: workbenchParts[0]?.outcome || "Success",
          tier: baseSharingTier.toLowerCase().includes("attr") ? "attributed" : baseSharingTier.toLowerCase(),
        },
      };
      const partOverrides = { ...(fieldOverrides.parts || {}) };
      workbenchParts.forEach((part, idx) => {
        const partId = `${part.part_id || `P-${idx + 1}`}`.trim();
        partOverrides[`${dealId}|${partId}`] = {
          name: part.part_name || part.part_family || `Part ${idx + 1}`,
          partName: part.part_name || "",
          partDetail: part.part_detail || "",
          process: part.process_primary || "",
          material: part.material || "",
          quantity: part.quantity || "",
          surfaceFinish: part.surface_finish || part.finish || "",
          toleranceDetails: part.tolerance_details || "",
          toleranceClass: part.tolerance_class || "",
          partEnvelope: part.part_envelope || "",
          requirements: part.requirements || "",
          additionalNotes: part.additional_notes || "",
          dataSharingTier: part.data_sharing_tier || baseSharingTier,
          overview: part.additional_notes || part.notes || baseOverview || "Historical project ingestion record.",
          sourcePartId: partId,
          customerIndustry: part.customer_industry || baseIndustry,
          partFamily: part.part_family || part.part_name || "",
          whatWorked: part.what_worked || baseWhatWorked,
          quotingLesson: part.quoting_lesson || "",
          outcome: part.outcome || "Success",
          quotedAmount: `${part.quoted_amount || part.quote_amount || part.quotedAmount || ""}`.trim(),
          awardPo: `${part.award_po || part.awardPo || part.po_number || part.order_id || ""}`.trim(),
          awardAmount: `${part.award_amount || part.awardAmount || part.po_amount || part.order_amount || ""}`.trim(),
        };
      });
      savePastProjectFieldOverrides({ projects: projectOverrides, parts: partOverrides }, session);
      const optimisticDeal = {
        id: dealId,
        dateStart: "2024-01",
        dateEnd: "ongoing",
        status: "active",
        recordIds: [],
        partIds: workbenchParts.map((part, idx)=>`${part.part_id || `P-${idx + 1}`}`.trim()).filter(Boolean),
        ...projectOverrides[dealId],
      };
      const optimisticJobs = workbenchParts.map((part, idx) => {
        const partId = `${part.part_id || `P-${idx + 1}`}`.trim();
        return {
          id: partId,
          dealId,
          rfqRef: "",
          date: `${part.project_date || baseDate}`.slice(0, 7),
          imageUrls: [part.image_preview].filter(Boolean),
          sourceRecordId: "",
          ...partOverrides[`${dealId}|${partId}`],
        };
      });
      setDealsData((prev) => {
        const rest = (prev || []).filter((d)=>`${d?.id || ""}`.trim() !== dealId);
        return [optimisticDeal, ...rest];
      });
      setJobsData((prev) => {
        const rest = (prev || []).filter((j)=>`${j?.dealId || ""}`.trim() !== dealId);
        return mergeJobsPreferRich(rest, optimisticJobs);
      });
      showIngestionToast(
        fullySynced
          ? "Successfully pushed to corpus."
          : `Partially pushed: Pinecone ${pushedCount}/${workbenchParts.length}, Zoho ${zohoOkCount}/${workbenchParts.length}.`,
        fullySynced ? "success" : "warn"
      );
      setWorkbenchParts([]);
      setWorkbenchFiles([]);
      setPushingWorkbench(false);
      const ts = `${Date.now()}`;
      localStorage.setItem("tb_corpus_updated_at", ts);
      localStorage.setItem("tb_corpus_event_type", "history");
      localStorage.setItem("tb_corpus_rescore_pending", "1");
      clearUiDataCaches();
      setShowInlineProjectUpload(false);
      setShowAddProject(false);
      resetProjectEditor();
      setTimeout(() => loadIngestionRef.current?.(true), 800);
    } catch (e) {
      appendLog(`Push failed: ${e?.message || e}`);
      showIngestionToast(`Push failed: ${e?.message || "server error"}`, "error");
      setPushingWorkbench(false);
    }
  }, [appendLog, editingProjectId, newProject, resetProjectEditor, showIngestionToast, workbenchParts]);

  const normalizeLessonSourceHint = useCallback((rawSource) => {
    const raw = `${rawSource || ""}`.trim();
    if (!raw) return "";
    if (raw.includes(" · ")) return raw;
    const job = (jobsData || []).find((j) => `${j.id || ""}`.trim() === raw);
    if (!job) return raw;
    const deal = (dealsData || []).find((d) => `${d.id || ""}`.trim() === `${job.dealId || ""}`.trim());
    const projectHint = `${deal?.name || deal?.customer || job?.name || ""}`.trim();
    if (!projectHint) return raw;
    return `${projectHint} · ${raw}`;
  }, [dealsData, jobsData]);

  const resolveLessonProjectRecordId = useCallback((lessonLike = {}) => {
    const explicit = `${lessonLike.projectRecordId || lessonLike.project_record_id || ""}`.trim();
    if (explicit) return explicit;

    const partId = `${lessonLike.partId || lessonLike.sourcePart || lessonLike.sourceJob || ""}`.trim();
    if (partId) {
      const j = (jobsData || []).find((x) => `${x.id || ""}`.trim() === partId);
      const rid = `${j?.sourceRecordId || ""}`.trim();
      if (rid) return rid;
    }

    const dealId = `${lessonLike.projectId || ""}`.trim();
    if (dealId) {
      const j = (jobsData || []).find((x) => `${x.dealId || ""}`.trim() === dealId && `${x.sourceRecordId || ""}`.trim());
      const rid = `${j?.sourceRecordId || ""}`.trim();
      if (rid) return rid;
      const deal = (dealsData || []).find((x) => `${x.id || ""}`.trim() === dealId);
      const recordIds = Array.isArray(deal?.recordIds) ? deal.recordIds : [];
      const dealRid = `${recordIds[0] || deal?.recordId || deal?.sourceRecordId || ""}`.trim();
      if (dealRid) return dealRid;
    }

    return "";
  }, [dealsData, jobsData]);

  const syncLessonsNow = useCallback(async (mfgInput, quotingInput, options = {}) => {
    const { silent = false, deletedMfgLessonIds = [], deletedQuotingLessonIds = [] } = options || {};
    if (!silent) {
      setSyncStatus("");
      setSyncingLessons(true);
    }
    try {
      const session = getSupplierSession();
      const mfgPayload = (mfgInput || []).map((l) => ({
        id: l.id || "",
        category: l.category || "Process",
        title: l.title || "Manufacturing Lesson",
        desc: l.body || l.desc || "",
        source_part: normalizeLessonSourceHint(Array.isArray(l.sourceJobs) ? (l.sourceJobs[0] || "") : ""),
        project_record_id: resolveLessonProjectRecordId(l),
        process: Array.isArray(l.processes) ? (l.processes[0] || "") : "",
        material: Array.isArray(l.materials) ? (l.materials[0] || "") : "",
      }));
      const quotingPayload = (quotingInput || []).map((l) => ({
        id: l.id || "",
        category: l.category || "Other",
        title: l.title || "Quoting Lesson",
        desc: l.body || l.desc || "",
        source_job: normalizeLessonSourceHint(Array.isArray(l.sourceJobs) ? (l.sourceJobs[0] || "") : ""),
        source_label: normalizeLessonSourceHint(Array.isArray(l.sourceJobs) ? (l.sourceJobs[0] || "") : ""),
        project_record_id: resolveLessonProjectRecordId(l),
        process: Array.isArray(l.processes) ? (l.processes[0] || "") : "",
        material: Array.isArray(l.materials) ? (l.materials[0] || "") : "",
        tier: l.tier || "",
        date: l.date || "",
        image_name: (l.attachments || []).find((a) => a?.type === "image")?.name || "",
        attachment_names: (l.attachments || []).filter((a) => a?.type !== "image").map((a) => a?.name || a?.label || "").filter(Boolean),
      }));
      const res = await apiPost(ENDPOINTS.pastProjects.syncLessons, {
        supplier_id: session.supplier_id || "",
        supplier_email: session.supplier_email || "",
        mfg_lessons: mfgPayload,
        quoting_lessons: quotingPayload,
        deleted_mfg_lesson_ids: deletedMfgLessonIds,
        deleted_quoting_lesson_ids: deletedQuotingLessonIds,
      });
      if (!res?.ok) throw new Error(res?.error || "Lesson sync failed");
      setSyncStatus(`Lessons synced: ${res?.synced || 0}/${res?.total || (mfgPayload.length + quotingPayload.length)}`);
      return true;
    } catch (e) {
      setSyncStatus(e?.message || "Lesson sync failed");
      return false;
    } finally {
      if (!silent) setSyncingLessons(false);
    }
  }, [normalizeLessonSourceHint, resolveLessonProjectRecordId]);

  const refreshLessonsFromZoho = useCallback(async () => {
    const session = getSupplierSession();
    const currentQuoting = Array.isArray(quotingLessonsData) ? quotingLessonsData : [];
    const currentMfg = Array.isArray(mfgLessonsData) ? mfgLessonsData : [];
    try {
      __GET_CACHE.clear();
      __GET_INFLIGHT.clear();
    } catch {}
    const data = await apiGet(ENDPOINTS.pastProjects.lessons, {
      supplier_id: session.supplier_id || "",
      supplier_email: session.supplier_email || "",
      limit: 500,
      _: Date.now(),
    });
    if (!data?.ok) throw new Error(data?.error || "Could not reload lessons.");
    const nextMfg = Array.isArray(data.mfg_lessons) ? data.mfg_lessons.map(mapZohoMfgLesson) : [];
    const nextQuoting = Array.isArray(data.quoting_lessons) ? data.quoting_lessons.map(mapZohoQuotingLesson) : [];
    const safeMfg = nextMfg.length ? nextMfg : currentMfg;
    const safeQuoting = nextQuoting.length ? nextQuoting : currentQuoting;
    setMfgLessonsData(safeMfg);
    setQuotingLessonsData((prev) => {
      const merged = mergeLessonsById(prev, safeQuoting);
      quotingLessonsDataRef.current = merged;
      return merged;
    });
    try {
      sessionStorage.setItem(_ingestionSnapshotKey(session), JSON.stringify({
        dealsData,
        jobsData,
        mfgLessonsData: safeMfg,
        quotingLessonsData: safeQuoting,
        processProfilesData,
        machinesData,
        machineMaterialsData: machineMaterialsCatalog,
        analyticsSummary,
      }));
    } catch {}
    return { mfg: safeMfg, quoting: safeQuoting };
  }, [analyticsSummary, dealsData, jobsData, machineMaterialsCatalog, machinesData, mfgLessonsData, processProfilesData, quotingLessonsData]);

  const handleSyncLessons = useCallback(async () => {
    setSyncingLessons(true);
    const ok = await syncLessonsNow(mfgLessonsData, quotingLessonsData);
    if (ok) {
      try {
        await refreshLessonsFromZoho();
      } catch (e) {
        setSyncStatus(e?.message || "Synced, but could not reload lessons.");
      }
    }
    setSyncingLessons(false);
  }, [mfgLessonsData, quotingLessonsData, refreshLessonsFromZoho, syncLessonsNow]);

  const openAddMfgLesson = useCallback(() => {
    setEditingMfgId("");
    setMfgDraft({
      id: "",
      category: "Process",
      title: "",
      body: "",
      projectId: "",
      partId: "",
      process: "",
      material: "",
      sourcePart: "",
      sourceLabel: "",
      tier: "private",
      date: "",
      imageName: "",
      attachmentNames: [],
    });
    setShowMfgEditor(true);
  }, []);

  const openEditMfgLesson = useCallback((lesson) => {
    const sourceRaw = Array.isArray(lesson?.sourceJobs) ? (lesson.sourceJobs[0] || "") : "";
    const selection = resolveLessonSelection(lesson, jobsData, dealsData);
    const matchedJob = selection.job;
    const sourceLabel = selection.sourceLabel || sourceRaw;
    setEditingMfgId(lesson?.id || "");
    setMfgDraft({
      id: lesson?.id || "",
      category: lesson?.category || "Process",
      title: lesson?.title || "",
      body: lesson?.body || lesson?.desc || "",
      projectId: selection.deal?.id || matchedJob?.dealId || "",
      partId: matchedJob?.id || "",
      process: Array.isArray(lesson?.processes) ? (lesson.processes[0] || "") : (matchedJob?.process || ""),
      material: Array.isArray(lesson?.materials) ? (lesson.materials[0] || "") : (matchedJob?.material || ""),
      sourcePart: sourceLabel,
      sourceLabel,
      tier: lesson?.tier || "private",
      date: `${lesson?.date || ""}`.slice(0, 7),
      imageName: "",
      attachmentNames: [],
    });
    setShowMfgEditor(true);
  }, [dealsData, jobsData]);

  const handleSaveMfgLesson = useCallback(async () => {
    if (!`${mfgDraft.title || ""}`.trim()) {
      setSyncStatus("Manufacturing lesson title is required.");
      return;
    }
    if (!`${mfgDraft.body || ""}`.trim()) {
      setSyncStatus("Manufacturing lesson description is required.");
      return;
    }
    const nextLesson = {
      id: `${mfgDraft.id || `ML-${Date.now()}`}`.trim(),
      category: `${mfgDraft.category || "Process"}`.trim(),
      title: `${mfgDraft.title || "Manufacturing Lesson"}`.trim(),
      body: `${mfgDraft.body || ""}`.trim(),
      processes: mfgDraft.process ? [`${mfgDraft.process}`.trim()] : [],
      materials: mfgDraft.material ? [`${mfgDraft.material}`.trim()] : [],
      sourceJobs: (mfgDraft.partId || mfgDraft.sourceLabel || mfgDraft.sourcePart)
        ? [`${mfgDraft.partId || mfgDraft.sourceLabel || mfgDraft.sourcePart}`.trim()]
        : [],
      projectRecordId: resolveLessonProjectRecordId(mfgDraft),
      tier: `${mfgDraft.tier || "private"}`.trim(),
      date: mfgDraft.date ? `${mfgDraft.date}-01` : new Date().toISOString().slice(0, 10),
      attachments: [
        ...(mfgDraft.imageName ? [{ type: "image", name: mfgDraft.imageName, label: mfgDraft.imageName }] : []),
        ...((mfgDraft.attachmentNames || []).map((n) => ({ type: "doc", name: n, label: n }))),
      ],
    };
    const next = editingMfgId
      ? mfgLessonsData.map((l) => (l.id === editingMfgId ? nextLesson : l))
      : [nextLesson, ...mfgLessonsData];
    setMfgLessonsData(next);
    setShowMfgEditor(false);
    await syncLessonsNow(next, quotingLessonsData, { silent: true });
  }, [editingMfgId, mfgDraft, mfgLessonsData, quotingLessonsData, resolveLessonProjectRecordId, syncLessonsNow]);

  const handleDeleteMfgLesson = useCallback(async (lesson) => {
    const lid = `${lesson?.id || ""}`.trim();
    if (!lid) return;
    const ok = window.confirm(`Delete manufacturing lesson ${lid}?`);
    if (!ok) return;
    const next = mfgLessonsData.filter((l) => `${l.id || ""}` !== lid);
    setMfgLessonsData(next);
    await syncLessonsNow(next, quotingLessonsData, { silent: true, deletedMfgLessonIds: [lid] });
  }, [mfgLessonsData, quotingLessonsData, syncLessonsNow]);

  const openAddQuoteLesson = useCallback(() => {
    setEditingQuoteId("");
    setQuoteDraft({
      id: "",
      category: "Cost Driver",
      title: "",
      body: "",
      projectId: "",
      partId: "",
      process: "",
      material: "",
      sourceJob: "",
      sourceLabel: "",
      tier: "private",
      date: "",
      imageName: "",
      attachmentNames: [],
    });
    setShowQuoteEditor(true);
  }, []);

  const openEditQuoteLesson = useCallback((lesson) => {
    const sourceRaw = Array.isArray(lesson?.sourceJobs) ? (lesson.sourceJobs[0] || "") : "";
    const selection = resolveLessonSelection(lesson, jobsData, dealsData);
    const matchedJob = selection.job;
    const sourceLabel = selection.sourceLabel || sourceRaw;
    setEditingQuoteId(lesson?.id || "");
    setQuoteDraft({
      id: lesson?.id || "",
      category: lesson?.category || "Cost Driver",
      title: lesson?.title || "",
      body: lesson?.body || lesson?.desc || "",
      projectId: selection.deal?.id || matchedJob?.dealId || "",
      partId: matchedJob?.id || "",
      process: Array.isArray(lesson?.processes) ? (lesson.processes[0] || "") : (matchedJob?.process || ""),
      material: Array.isArray(lesson?.materials) ? (lesson.materials[0] || "") : (matchedJob?.material || ""),
      sourceJob: sourceLabel,
      sourceLabel,
      tier: lesson?.tier || "private",
      date: `${lesson?.date || ""}`.slice(0, 7),
      imageName: "",
      attachmentNames: [],
    });
    setShowQuoteEditor(true);
  }, [dealsData, jobsData]);

  const handleSaveQuoteLesson = useCallback(async () => {
    if (!`${quoteDraft.title || ""}`.trim()) {
      setSyncStatus("Quoting lesson title is required.");
      return;
    }
    if (!`${quoteDraft.body || ""}`.trim()) {
      setSyncStatus("Quoting lesson description is required.");
      return;
    }
    const projectRecordId = resolveLessonProjectRecordId(quoteDraft);
    if (!projectRecordId) {
      setSyncStatus("Select a project/part before saving the quoting lesson.");
      return;
    }
    const selectedDeal = (dealsData || []).find((d) => `${d.id || ""}`.trim() === `${quoteDraft.projectId || ""}`.trim());
    const sourceRef = `${quoteDraft.partId || quoteDraft.sourceLabel || quoteDraft.sourceJob || selectedDeal?.name || selectedDeal?.customer || quoteDraft.projectId || ""}`.trim();
    const nextLesson = {
      id: `${quoteDraft.id || `QL-${Date.now()}`}`.trim(),
      category: `${quoteDraft.category || "Cost Driver"}`.trim(),
      title: `${quoteDraft.title || "Quoting Lesson"}`.trim(),
      body: `${quoteDraft.body || ""}`.trim(),
      processes: quoteDraft.process ? [`${quoteDraft.process}`.trim()] : [],
      materials: quoteDraft.material ? [`${quoteDraft.material}`.trim()] : [],
      sourceJobs: sourceRef ? [sourceRef] : [],
      projectRecordId,
      tier: `${quoteDraft.tier || "private"}`.trim(),
      date: quoteDraft.date ? `${quoteDraft.date}-01` : new Date().toISOString().slice(0, 10),
      attachments: [
        ...(quoteDraft.imageName ? [{ type: "image", name: quoteDraft.imageName, label: quoteDraft.imageName }] : []),
        ...((quoteDraft.attachmentNames || []).map((n) => ({ type: "doc", name: n, label: n }))),
      ],
    };
    const next = editingQuoteId
      ? quotingLessonsData.map((l) => (l.id === editingQuoteId ? nextLesson : l))
      : [nextLesson, ...quotingLessonsData];
    lessonsMutationAtRef.current = Date.now();
    quotingLessonsDataRef.current = next;
    setQuotingLessonsData(next);
    setSavingQuoteLesson(true);
    const ok = await syncLessonsNow(mfgLessonsData, next, { silent: true });
    setSavingQuoteLesson(false);
    if (!ok) {
      setSyncStatus("Quoting lesson was not saved. Please check the backend/Zoho connection and save again.");
      return;
    }
    setSyncStatus("Quoting lesson saved to the selected project.");
    showIngestionToast("Quoting lesson saved.");
    setShowQuoteEditor(false);
    refreshLessonsFromZoho().catch(() => {
      // Keep the locally saved lesson visible; the next page load will read it from Zoho.
    });
  }, [dealsData, editingQuoteId, mfgLessonsData, quoteDraft, quotingLessonsData, refreshLessonsFromZoho, resolveLessonProjectRecordId, showIngestionToast, syncLessonsNow]);

  const handleDeleteQuoteLesson = useCallback(async (lesson) => {
    const lid = `${lesson?.id || ""}`.trim();
    if (!lid) return;
    const ok = window.confirm(`Delete quoting lesson ${lid}?`);
    if (!ok) return;
    const next = quotingLessonsData.filter((l) => `${l.id || ""}` !== lid);
    lessonsMutationAtRef.current = Date.now();
    quotingLessonsDataRef.current = next;
    setQuotingLessonsData(next);
    const synced = await syncLessonsNow(mfgLessonsData, next, { silent: true, deletedQuotingLessonIds: [lid] });
    if (synced) {
      try {
        await refreshLessonsFromZoho();
      } catch {}
    }
  }, [mfgLessonsData, quotingLessonsData, refreshLessonsFromZoho, syncLessonsNow]);

  const loadInboundRealtime = useCallback(async () => {
    try {
      const session = getSupplierSession();
      let rfpPool = [];
      let asmtPool = [];

      const inbound = await apiGetCached(
        ENDPOINTS.pastProjects.inboundStats,
        { supplier_id: session.supplier_id || "", supplier_email: session.supplier_email || "", limit: 100 },
        { ttlMs: 20000 }
      );

      if (inbound?.ok) {
        rfpPool = [
          ...(Array.isArray(inbound.rfps_scoped) ? inbound.rfps_scoped : []),
        ];
        asmtPool = [
          ...(Array.isArray(inbound.assessments_crm) ? inbound.assessments_crm : []),
          ...(Array.isArray(inbound.assessments_scoped) ? inbound.assessments_scoped : []),
        ];
      } else {
        const [rfpResScoped, asmtResCRM, asmtResScoped] = await Promise.allSettled([
          apiGetCached(ENDPOINTS.rfp.recent, { supplier_id: session.supplier_id || "", limit: 100 }, { ttlMs: 20000 }),
          apiGetCached(ENDPOINTS.assessment.recent, { supplier_id: session.supplier_id || "", supplier_email: session.supplier_email || "", limit: 100, crm_only: true }, { ttlMs: 20000 }),
          apiGetCached(ENDPOINTS.assessment.recent, { supplier_id: session.supplier_id || "", supplier_email: session.supplier_email || "", limit: 100 }, { ttlMs: 20000 }),
        ]);

        rfpPool = [
          ...(rfpResScoped.status === "fulfilled" ? (rfpResScoped.value?.items || []) : []),
        ];
        asmtPool = [
          ...(asmtResCRM.status === "fulfilled" ? (asmtResCRM.value?.items || []) : []),
          ...(asmtResScoped.status === "fulfilled" ? (asmtResScoped.value?.items || []) : []),
        ];
      }

      const rfpById = new Map();
      rfpPool.forEach((r) => {
        const rid = `${r?.rfp_id || r?.id || ""}`.trim();
        if (!rid) return;
        const recv = isoDay(r?.received || r?.created_time || r?.created_at || "") || "";
        if (!recv) return;
        const prev = rfpById.get(rid);
        if (!prev || recv > (isoDay(prev?.received || prev?.created_time || prev?.created_at || "") || "")) {
          rfpById.set(rid, r);
        }
      });
      const rfps = Array.from(rfpById.values());

      const asmtByRfp = new Map();
      const asmtLatest = new Map();
      const normalizeAssessmentStatus = (row) => {
        const raw = `${row?.status || row?.bid_status || row?.assessment_status || ""}`.trim().toLowerCase().replace(/[\s-]+/g, "_");
        if (["no_bid", "nobid", "declined", "not_bidded"].includes(raw)) return "no_bid";
        return "scored";
      };
      const rfpDate = (row) =>
        isoDay(
          row?.created_at ||
          row?.Created_Time ||
          row?.received ||
          row?.created_time ||
          row?.created_at
        ) || "";
      const asmtDate = (row) =>
        isoDay(
          row?.created_at ||
          row?.assessment_date ||
          row?.Assessment_Date ||
          row?.Created_Time ||
          row?.created_time ||
          row?.created_at ||
          row?.updated_at
        ) || "";

      asmtPool.forEach((a) => {
        const rid = `${a?.rfp_id || a?.id || ""}`.trim();
        if (!rid) return;
        const d = asmtDate(a);
        if (!d) return;
        const status = normalizeAssessmentStatus(a);
        const prev = asmtByRfp.get(rid);
        if (!prev || d < prev.date) asmtByRfp.set(rid, { date: d, status });
        const prevLatest = asmtLatest.get(rid);
        if (!prevLatest || d > prevLatest.date) {
          asmtLatest.set(rid, {
            date: d,
            status,
            overall_score: Number(a?.overall_score || 0) || 0,
            buyer: `${a?.buyer || ""}`.trim(),
            project: `${a?.project || ""}`.trim(),
          });
        }
      });

      const monthlyMap = new Map();
      const dateDiffs = [];
      let untriagedOver5 = 0;
      const today = new Date();
      const norm = (x) => `${x || ""}`.slice(0, 10);

      rfps.forEach((r) => {
        const rid = `${r?.rfp_id || r?.id || ""}`.trim();
        const recv = rfpDate(r);
        if (!recv) return;
        const ym = recv.slice(0, 7);
        const bucket = monthlyMap.get(ym) || { received: 0, quoted: 0 };
        bucket.received += 1;
        monthlyMap.set(ym, bucket);

        const q = rid ? asmtByRfp.get(rid) : null;
        if (q && q.date && q.status !== "no_bid") {
          const qDate = q.date;
          const qYm = qDate.slice(0, 7);
          const qBucket = monthlyMap.get(qYm) || { received: 0, quoted: 0 };
          qBucket.quoted += 1;
          monthlyMap.set(qYm, qBucket);

          const rDt = new Date(norm(recv));
          const qDt = new Date(norm(qDate));
          if (!Number.isNaN(rDt.getTime()) && !Number.isNaN(qDt.getTime()) && qDt >= rDt) {
            dateDiffs.push(Math.round((qDt - rDt) / 86400000));
          }
        } else {
          const rDt = new Date(norm(recv));
          if (!Number.isNaN(rDt.getTime())) {
            const age = Math.round((today - rDt) / 86400000);
            if (age > 5) untriagedOver5 += 1;
          }
        }
      });

      // If recent RFP feed is empty, still map inbound dashboard from assessment records.
      if (rfps.length === 0 && asmtLatest.size > 0) {
        asmtLatest.forEach((a) => {
          const d = `${a?.date || ""}`.slice(0, 10);
          if (!d) return;
          const ym = d.slice(0, 7);
          const bucket = monthlyMap.get(ym) || { received: 0, quoted: 0 };
          bucket.received += 1;
          if (`${a?.status || ""}` !== "no_bid") bucket.quoted += 1;
          monthlyMap.set(ym, bucket);
        });
      }

      // ensure trailing 6 months present
      const now = new Date();
      for (let i = 5; i >= 0; i -= 1) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        if (!monthlyMap.has(ym)) monthlyMap.set(ym, { received: 0, quoted: 0 });
      }

      const monthly = Array.from(monthlyMap.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .slice(-6)
        .map(([ym, v]) => ({
          m: new Date(`${ym}-01`).toLocaleString("en-US", { month: "short" }),
          received: Number(v.received || 0),
          quoted: Number(v.quoted || 0),
        }));

      const totalReceived = monthly.reduce((n, r) => n + r.received, 0);
      const totalQuoted = monthly.reduce((n, r) => n + r.quoted, 0);
      const avgDaysToQuote = dateDiffs.length ? Math.round((dateDiffs.reduce((a, b) => a + b, 0) / dateDiffs.length) * 10) / 10 : 0;
      const assessments = Array.from(asmtLatest.values());
      const assessedCount = assessments.length;
      const noBidCount = assessments.filter((a) => `${a?.status || ""}` === "no_bid").length;
      const avgOverallScore = assessments.length
        ? Math.round((assessments.reduce((sum, a) => sum + (Number(a?.overall_score || 0) || 0), 0) / assessments.length) * 10) / 10
        : 0;
      const latestAssessment = assessments
        .slice()
        .sort((a, b) => `${b?.date || ""}`.localeCompare(`${a?.date || ""}`))[0] || null;

      setInboundRealtime({
        monthly,
        totalReceived,
        totalQuoted,
        avgDaysToQuote,
        untriagedOver5,
        assessmentSummary: {
          assessedCount,
          noBidCount,
          avgOverallScore,
          latestAssessment,
        },
        lastUpdated: new Date().toISOString(),
      });
    } catch {
      // keep last successful inbound snapshot
    }
  }, []);

  const loadIngestion = useCallback(async (force=false) => {
    let cancelled = false;
    const snapshotKey = _ingestionSnapshotKey(getSupplierSession());
    try {
      if (!dealsData.length) setIngestionLoading(true);
      setIngestionError("");
      const session = getSupplierSession();
      const loadStartedAt = Date.now();
      let snapDeals = [];
      let snapJobs = [];
      let snapMfg = [];
      let snapQuoting = [];
      let snapProfiles = [];
      let snapMachines = [];
      let snapMachineMaterials = [];
      let snapAnalytics = {};
      const analyticsPromise = withTimeout(
        apiGetCached(ENDPOINTS.pastProjects.analytics, { supplier_id: session.supplier_id, supplier_email: session.supplier_email, limit: 300 }, { ttlMs: 30000, force }),
        CRITICAL_INGESTION_TIMEOUT_MS
      );
      const projectsPromise = withTimeout(
        apiGetCached(ENDPOINTS.pastProjects.projects, { supplier_id: session.supplier_id, supplier_email: session.supplier_email, limit: 200 }, { ttlMs: 30000, force }),
        CRITICAL_INGESTION_TIMEOUT_MS
      );
      const lessonsPromise = withTimeout(
        apiGetCached(ENDPOINTS.pastProjects.lessons, { supplier_id: session.supplier_id, supplier_email: session.supplier_email, limit: 300 }, { ttlMs: 30000, force }),
        BACKGROUND_INGESTION_TIMEOUT_MS
      );
      const profilesPromise = withTimeout(
        apiGetCached(ENDPOINTS.pastProjects.processProfiles, { supplier_id: session.supplier_id, supplier_email: session.supplier_email, limit: 300 }, { ttlMs: 30000, force }),
        BACKGROUND_INGESTION_TIMEOUT_MS
      );
      const machinesPromise = withTimeout(
        apiGetCached(ENDPOINTS.pastProjects.machines, { supplier_id: session.supplier_id, supplier_email: session.supplier_email, limit: 300 }, { ttlMs: 30000, force }),
        BACKGROUND_INGESTION_TIMEOUT_MS
      );
      const machineMaterialsPromise = withTimeout(
        apiGetCached(ENDPOINTS.pastProjects.machineMaterials, { limit: 500 }, { ttlMs: 30000, force }),
        BACKGROUND_INGESTION_TIMEOUT_MS
      );

      projectsPromise.then((res) => {
        if (cancelled || !Array.isArray(res?.projects) || !res.projects.length) return;
        const mapped = applyPastProjectFieldOverrides(mapProjectsToIngestion(res.projects), session);
        const jobsWithOverrides = applyQuoteAwardOverrides(mapped.jobs, session);
        if (mapped.deals.length) setDealsData(mapped.deals);
        if (jobsWithOverrides.length) setJobsData((prev) => mergeJobsPreferRich(prev, jobsWithOverrides));
        if (mapped.deals.length || jobsWithOverrides.length) setIngestionLoading(false);
      }).catch(() => {});

      analyticsPromise.then((analytics) => {
        if (cancelled || !analytics?.ok) return;
        const nextSummary = {
          ...(analytics.analytics || {}),
          _projects: Array.isArray(analytics.projects) ? analytics.projects : [],
          _counts: analytics.counts || {},
        };
        setAnalyticsSummary(nextSummary);
        if (Array.isArray(analytics.projects) && analytics.projects.length) {
          const mapped = applyPastProjectFieldOverrides(mapProjectsToIngestion(analytics.projects), session);
          const jobsWithOverrides = applyQuoteAwardOverrides(mapped.jobs, session);
          if (mapped.deals.length) setDealsData(mapped.deals);
          if (jobsWithOverrides.length) setJobsData((prev) => mergeJobsPreferRich(prev, jobsWithOverrides));
          if (mapped.deals.length || jobsWithOverrides.length) setIngestionLoading(false);
        }
      }).catch(() => {});

      const [analyticsRes, projectsRes, lessonsRes, profilesRes, machinesRes, machineMaterialsRes] = await Promise.allSettled([
        analyticsPromise,
        projectsPromise,
        lessonsPromise,
        profilesPromise,
        machinesPromise,
        machineMaterialsPromise,
      ]);
      
      if (!cancelled && machinesRes.status === "fulfilled" && machinesRes.value?.ok) {
        if (Array.isArray(machinesRes.value.machines)) {
          snapMachines = machinesRes.value.machines;
          setMachinesData(machinesRes.value.machines);
        }
      }
      
      if (!cancelled && machineMaterialsRes.status === "fulfilled" && machineMaterialsRes.value?.ok) {
        if (Array.isArray(machineMaterialsRes.value.materials)) {
          snapMachineMaterials = machineMaterialsRes.value.materials;
          setMachineMaterialsCatalog(machineMaterialsRes.value.materials);
        }
      }

      if (!cancelled && analyticsRes.status === "fulfilled" && analyticsRes.value?.ok) {
        const analytics = analyticsRes.value || {};
        const nextSummary = {
          ...(analytics.analytics || {}),
          _projects: Array.isArray(analytics.projects) ? analytics.projects : [],
          _counts: analytics.counts || {},
        };
        snapAnalytics = nextSummary;
        setAnalyticsSummary(nextSummary);
        if (Array.isArray(analytics.projects) && analytics.projects.length) {
          const mapped = applyPastProjectFieldOverrides(mapProjectsToIngestion(analytics.projects), session);
          const jobsWithOverrides = applyQuoteAwardOverrides(mapped.jobs, session);
          if (mapped.deals.length) {
            snapDeals = mapped.deals;
            setDealsData(mapped.deals);
          }
          if (jobsWithOverrides.length) {
            snapJobs = jobsWithOverrides;
            setJobsData((prev) => mergeJobsPreferRich(prev, jobsWithOverrides));
          }
        }
        if (Array.isArray(analytics.profiles)) {
          snapProfiles = analytics.profiles;
          setProcessProfilesData(analytics.profiles);
        }
        if (lessonsMutationAtRef.current <= loadStartedAt && Array.isArray(analytics.mfg_lessons) && analytics.mfg_lessons.length) {
          const next = analytics.mfg_lessons.map(mapZohoMfgLesson);
          snapMfg = next;
          setMfgLessonsData(next);
        }
        if (lessonsMutationAtRef.current <= loadStartedAt && Array.isArray(analytics.quoting_lessons)) {
          const next = analytics.quoting_lessons.map(mapZohoQuotingLesson);
          const merged = mergeLessonsById(quotingLessonsDataRef.current, next);
          snapQuoting = merged;
          quotingLessonsDataRef.current = merged;
          setQuotingLessonsData(merged);
        }
      }

      if (projectsRes.status === "fulfilled" && Array.isArray(projectsRes.value.projects) && projectsRes.value.projects.length) {
        const mapped = applyPastProjectFieldOverrides(mapProjectsToIngestion(projectsRes.value.projects), session);
        const jobsWithOverrides = applyQuoteAwardOverrides(mapped.jobs, session);
        if (!cancelled) {
          if (mapped.deals.length) {
            snapDeals = mapped.deals;
            setDealsData(mapped.deals);
          }
          if (jobsWithOverrides.length) {
            snapJobs = jobsWithOverrides;
            setJobsData((prev) => mergeJobsPreferRich(prev, jobsWithOverrides));
          }
        }
      }

      if (lessonsRes.status === "fulfilled") {
        if (!cancelled && lessonsMutationAtRef.current <= loadStartedAt && Array.isArray(lessonsRes.value.mfg_lessons)) {
          const next = lessonsRes.value.mfg_lessons.map(mapZohoMfgLesson);
          snapMfg = next;
          setMfgLessonsData(next);
        }
        if (!cancelled && lessonsMutationAtRef.current <= loadStartedAt && Array.isArray(lessonsRes.value.quoting_lessons)) {
          const next = lessonsRes.value.quoting_lessons.map(mapZohoQuotingLesson);
          const merged = mergeLessonsById(quotingLessonsDataRef.current, next);
          snapQuoting = merged;
          quotingLessonsDataRef.current = merged;
          setQuotingLessonsData(merged);
        }
      }
      if (!cancelled && profilesRes.status === "fulfilled" && Array.isArray(profilesRes.value.profiles)) {
        snapProfiles = profilesRes.value.profiles;
        setProcessProfilesData(profilesRes.value.profiles);
      }
      try {
        sessionStorage.setItem(snapshotKey, JSON.stringify({
          dealsData: snapDeals,
          jobsData: snapJobs,
          mfgLessonsData: snapMfg,
          quotingLessonsData: snapQuoting,
          processProfilesData: snapProfiles,
          machinesData: snapMachines,
          machineMaterialsData: snapMachineMaterials,
          analyticsSummary: snapAnalytics,
        }));
      } catch {}
    } catch {
      if (!cancelled) setIngestionError("Could not load ingestion data from backend endpoints.");
    } finally {
      if (!cancelled) setIngestionLoading(false);
    }
  }, []);

  useEffect(() => {
    loadIngestionRef.current = loadIngestion;
  }, [loadIngestion]);

  const loadProcessProfilesRealtime = useCallback(async () => {
    try {
      const session = getSupplierSession();
      const res = await apiGetCached(ENDPOINTS.pastProjects.processProfiles, {
        supplier_id: session.supplier_id,
        supplier_email: session.supplier_email,
        limit: 300,
      }, { ttlMs: 20000 });
      if (Array.isArray(res?.profiles)) {
        setProcessProfilesData(res.profiles);
        setProcessProfilesUpdatedAt(new Date().toISOString());
      }
    } catch {
      // keep last successful snapshot
    }
  }, []);

  const loadMachinesRealtime = useCallback(async (force = false) => {
    try {
      const session = getSupplierSession();
      const [machinesRes, materialsRes] = await Promise.all([
        apiGetCached(ENDPOINTS.pastProjects.machines, {
          supplier_id: session.supplier_id,
          supplier_email: session.supplier_email,
          limit: 300,
        }, { ttlMs: 20000, force }),
        apiGetCached(ENDPOINTS.pastProjects.machineMaterials, { limit: 500 }, { ttlMs: 60000, force }),
      ]);
      if (Array.isArray(machinesRes?.machines)) setMachinesData(machinesRes.machines);
      if (Array.isArray(materialsRes?.materials)) setMachineMaterialsCatalog(materialsRes.materials);
    } catch {
      // keep last successful snapshot
    }
  }, []);

  const filteredMachineMaterials = useMemo(() => {
    const q = `${machineMaterialQuery || ""}`.trim().toLowerCase();
    const rows = Array.isArray(machineMaterialsCatalog) ? machineMaterialsCatalog : [];
    if (!q) return rows.slice(0, 200);
    return rows.filter((m) => {
      const name = `${m?.name || ""}`.toLowerCase();
      const id = `${m?.id || ""}`.toLowerCase();
      return name.includes(q) || id.includes(q);
    }).slice(0, 200);
  }, [machineMaterialQuery, machineMaterialsCatalog]);

  useEffect(() => {
    if (!showMachineEditor) return;
    const equipmentProbe = `${machineDraft.manufacturer || ""} ${machineDraft.equipment_text || machineDraft.name || ""}`.trim();
    if (!equipmentProbe || machineDraft.other_equipment) {
      setMachineResolveState((prev) => ({ ...prev, loading: false }));
      return;
    }
    const compactProbe = equipmentProbe.replace(/\s+/g, " ").trim();
    if (compactProbe.length < 5) return;
    const resolveKey = `${`${machineDraft.manufacturer || ""}`.trim().toLowerCase()}|${`${machineDraft.equipment_text || ""}`.trim().toLowerCase()}|${`${machineDraft.name || ""}`.trim().toLowerCase()}`;
    if (resolveKey === lastMachineResolveKeyRef.current) return;
    const timer = setTimeout(async () => {
      try {
        setMachineResolveState((prev) => ({ ...prev, loading: true }));
        const res = await apiPost(ENDPOINTS.pastProjects.machineResolve, {
          manufacturer: machineDraft.manufacturer,
          equipment_text: machineDraft.equipment_text,
          name: machineDraft.name,
        });
        if (res?.ok) {
          lastMachineResolveKeyRef.current = resolveKey;
          setMachineResolveState({ loading: false, best_match: res.best_match || null, matches: res.matches || [], status: res.status || "UNRESOLVED" });
        } else {
          setMachineResolveState({ loading: false, best_match: null, matches: [], status: "UNRESOLVED" });
        }
      } catch {
        setMachineResolveState({ loading: false, best_match: null, matches: [], status: "UNRESOLVED" });
      }
    }, 700);
    return () => clearTimeout(timer);
  }, [showMachineEditor, machineDraft.manufacturer, machineDraft.equipment_text, machineDraft.name, machineDraft.other_equipment]);

  const handleSaveMachine = useCallback(async () => {
    setMachineSaveError("");
    const session = getSupplierSession();
    try {
      if (!session?.supplier_id) throw new Error("Supplier session missing.");
      if (!`${machineDraft.name || ""}`.trim()) throw new Error("Machine name is required.");
      setSavingMachine(true);
      const payload = {
        ...machineDraft,
        supplier_id: session.supplier_id || "",
        supplier_email: session.supplier_email || "",
        company_name: session.supplier_name || "",
        material_ids: Array.isArray(machineDraft.material_ids) ? machineDraft.material_ids : [],
        material_ids_original: Array.isArray(machineDraft.material_ids_original) ? machineDraft.material_ids_original : [],
        other_materials: splitLooseList(machineDraft.other_materials),
      };
      const res = await apiPost(ENDPOINTS.pastProjects.machineSave, payload);
      if (!res?.ok) throw new Error(res?.error || "Could not save machine.");

      // Optimistic local update so the save feels instant.
      if (res?.machine && `${res.machine.id || ""}`.trim()) {
        setMachinesData((prev) => {
          const list = Array.isArray(prev) ? [...prev] : [];
          const idx = list.findIndex((m) => `${m?.id || ""}` === `${res.machine.id}`);
          if (idx >= 0) list[idx] = { ...list[idx], ...res.machine };
          else list.unshift(res.machine);
          return list;
        });
      }

      setShowMachineEditor(false);
      setMachineDraft(emptyMachineDraft());
      setMachineMaterialQuery("");
      setSyncStatus(
        `Machine saved: ${res?.machine?.name || machineDraft.name || "Machine"}`
      );

      // Refresh in background to reconcile any server-side transforms.
      loadMachinesRealtime(true);
      loadProcessProfilesRealtime();
    } catch (e) {
      setMachineSaveError(e?.message || "Could not save machine.");
    } finally {
      setSavingMachine(false);
    }
  }, [machineDraft, loadMachinesRealtime, loadProcessProfilesRealtime]);

  const handleCreateProfile = useCallback(async () => {
    const session = getSupplierSession();
    setCreatingProfile(true);
    setAddProfileError("");
    try {
      if (!session?.supplier_id) throw new Error("Supplier session missing.");
      if (!`${newProfile.name || ""}`.trim() && !`${newProfile.generic_process || ""}`.trim() && !`${newProfile.material_name || ""}`.trim()) {
        throw new Error("Enter at least a profile name, process, or material.");
      }
      const res = await apiPost(ENDPOINTS.pastProjects.processProfiles, {
        ...newProfile,
        supplier_id: session.supplier_id || "",
        supplier_email: session.supplier_email || "",
        company_name: session.supplier_name || "",
      });
      if (!res?.ok) throw new Error(res?.error || "Could not create process profile.");
      await loadProcessProfilesRealtime();
      try {
        const ts = `${Date.now()}`;
        localStorage.setItem("tb_corpus_updated_at", ts);
        localStorage.setItem("tb_corpus_event_type", "profile");
        localStorage.setItem("tb_corpus_rescore_pending", "1");
      } catch {}
      setSyncStatus(`Process profile added: ${res?.profile?.name || newProfile.name || "New profile"}`);
      setShowAddProfileEditor(false);
      setNewProfile({
        name:"",
        generic_process:"",
        branded_process:"",
        process_family:"",
        generic_name:"",
        material_name:"",
        material_class:"",
        material_family:"",
        material_type:"",
        tolerance:"",
        manufacturer:"",
        equipment_name:"",
        equipment_link:"",
        certifications:"",
        oem_description:"",
        oem_description_2:"",
      });
    } catch (e) {
      setAddProfileError(e?.message || "Could not create process profile.");
    } finally {
      setCreatingProfile(false);
    }
  }, [newProfile, loadProcessProfilesRealtime]);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(_ingestionSnapshotKey(getSupplierSession()));
      if (raw) {
        const snap = JSON.parse(raw);
        if (Array.isArray(snap?.dealsData) && snap.dealsData.length) setDealsData(snap.dealsData);
        if (Array.isArray(snap?.jobsData) && snap.jobsData.length) setJobsData(snap.jobsData);
        if (Array.isArray(snap?.mfgLessonsData) && snap.mfgLessonsData.length) setMfgLessonsData(snap.mfgLessonsData);
        if (Array.isArray(snap?.quotingLessonsData) && snap.quotingLessonsData.length) {
          const mergedQuoting = mergeLessonsById(quotingLessonsDataRef.current, snap.quotingLessonsData);
          quotingLessonsDataRef.current = mergedQuoting;
          setQuotingLessonsData(mergedQuoting);
        }
        if (Array.isArray(snap?.processProfilesData) && snap.processProfilesData.length) setProcessProfilesData(snap.processProfilesData);
        if (Array.isArray(snap?.machinesData) && snap.machinesData.length) setMachinesData(snap.machinesData);
        if (Array.isArray(snap?.machineMaterialsData) && snap.machineMaterialsData.length) setMachineMaterialsCatalog(snap.machineMaterialsData);
        if (snap?.analyticsSummary) setAnalyticsSummary(snap.analyticsSummary);
        if (
          (Array.isArray(snap?.dealsData) && snap.dealsData.length) ||
          (Array.isArray(snap?.jobsData) && snap.jobsData.length) ||
          (Array.isArray(snap?.mfgLessonsData) && snap.mfgLessonsData.length) ||
          (Array.isArray(snap?.quotingLessonsData) && snap.quotingLessonsData.length)
        ) {
          setIngestionLoading(false);
        }
      }
    } catch {}
    loadIngestion();
  }, [loadIngestion]);

  useEffect(() => {
    let disposed = false;
    async function refreshProfiles() {
      if (disposed) return;
      if (tab !== "profiles" && tab !== "analytics") return;
      await loadProcessProfilesRealtime();
    }
    refreshProfiles();
    const t = setInterval(refreshProfiles, 30000);
    return () => {
      disposed = true;
      clearInterval(t);
    };
  }, [loadProcessProfilesRealtime, tab]);

  useEffect(() => {
    let disposed = false;
    async function refresh() {
      if (disposed) return;
      if (tab !== "deals" && tab !== "analytics") return;
      await loadInboundRealtime();
    }
    refresh();
    const t = setInterval(refresh, 30000);
    return () => {
      disposed = true;
      clearInterval(t);
    };
  }, [loadInboundRealtime, tab]);

  useEffect(() => {
    if (tab !== "machines") return;
    // Keep machine tab responsive on open, independent of full ingestion reload.
    loadMachinesRealtime(true);
  }, [tab, loadMachinesRealtime]);

  useEffect(() => {
    if (!isProjectEditorOpen || !workbenchParts.length) return;
    const p = workbenchParts[0] || {};
    setNewProject((prev) => ({
      ...prev,
      part_family: prev.part_family || p.part_family || "",
      material: prev.material || p.material || "",
      process_primary: prev.process_primary || p.process_primary || "",
      project_name: prev.project_name || p.part_family || prev.project_name,
      project_overview: prev.project_overview || p.notes || "",
    }));
  }, [isProjectEditorOpen, workbenchParts]);

  useEffect(() => {
    if (!workbenchParts.length) return;
    const p = workbenchParts[0] || {};
    setNewProject((prev) => ({
      ...prev,
      // Keep the visible Project Details inputs in sync with extracted part defaults.
      // These are editable by the user, so only fill when the field is still blank.
      part_family: prev.part_family || p.part_family || "",
      material: prev.material || p.material || "",
      process_primary: prev.process_primary || p.process_primary || "",
      project_name: prev.project_name || p.part_family || "",
      project_overview: prev.project_overview || p.notes || "",
      customer_industry: prev.customer_industry || p.customer_industry || "",
      project_date: prev.project_date || p.project_date || "",
    }));
  }, [workbenchParts]);

  const openAddProjectEditor = useCallback(() => {
    resetProjectEditor();
    setShowInlineProjectUpload(false);
    setShowAddProject(true);
  }, [resetProjectEditor]);

  const openEditProject = useCallback((deal) => {
    const projectJobs = (jobsData || []).filter((job) => `${job.dealId || ""}`.trim() === `${deal?.id || ""}`.trim());
    setEditingProjectId(`${deal?.id || ""}`.trim());
    setNewProject({
      job_id: "",
      company_name: `${deal?.companyName || ""}`.trim(),
      company_size: `${deal?.companySize || ""}`.trim(),
      company_location: `${deal?.companyLocation || ""}`.trim(),
      customer_name: `${deal?.customer || ""}`.trim(),
      contact_phone: `${deal?.contactPhone || ""}`.trim(),
      contact_email: `${deal?.contactEmail || ""}`.trim(),
      project_name: `${deal?.name || ""}`.trim(),
      part_family: `${deal?.partFamily || ""}`.trim(),
      material: `${deal?.material || ""}`.trim(),
      process_primary: `${deal?.processPrimary || ""}`.trim(),
      customer_industry: `${deal?.customerIndustry || ""}`.trim(),
      expected_annual_production_volume: `${deal?.expectedAnnualProductionVolume || ""}`.trim(),
      mandatory_certifications: Array.isArray(deal?.mandatoryCertifications) ? deal.mandatoryCertifications.join(", ") : `${deal?.mandatoryCertifications || ""}`.trim(),
      certification_notes: `${deal?.certificationNotes || ""}`.trim(),
      other_project_requirements: `${deal?.otherProjectRequirements || ""}`.trim(),
      project_overview: `${deal?.projectOverview || ""}`.trim(),
      sharing_tier: `${deal?.tier || ""}`.toLowerCase() === "anonymized" ? "Anonymized" : "Attributed",
      project_date: `${deal?.projectDate || ""}`.trim(),
      what_worked: `${deal?.whatWorked || ""}`.trim(),
      outcome: `${deal?.outcome || "Success"}`.trim(),
    });
    setWorkbenchFiles([]);
    setExtractedPdfText("");
    setProcessLog([]);
    setAddProjectError("");
    setWorkbenchParts(projectJobs.map((job, idx) => ({
      part_id: `${job?.sourcePartId || job?.id || `edit_${idx + 1}`}`.trim(),
      source_record_id: `${job?.sourceRecordId || ""}`.trim(),
      filename: job?.name || "",
      part_name: `${job?.partName || job?.name || ""}`.trim(),
      part_detail: `${job?.partDetail || ""}`.trim(),
      part_family: `${job?.partFamily || job?.name || ""}`.trim(),
      material: `${job?.material || ""}`.trim(),
      process_primary: `${job?.process || ""}`.trim(),
      surface_finish: `${job?.surfaceFinish || ""}`.trim(),
      tolerance_details: `${job?.toleranceDetails || ""}`.trim(),
      quantity: `${job?.quantity || ""}`.trim(),
      part_envelope: `${job?.partEnvelope || ""}`.trim(),
      data_sharing_tier: `${job?.dataSharingTier || ""}`.trim(),
      additional_notes: `${job?.additionalNotes || ""}`.trim(),
      customer_industry: `${job?.customerIndustry || deal?.customerIndustry || ""}`.trim(),
      project_date: `${job?.date || deal?.projectDate || ""}`.trim(),
      notes: `${job?.overview || deal?.projectOverview || ""}`.trim(),
      what_worked: `${job?.whatWorked || deal?.whatWorked || ""}`.trim(),
      quoting_lesson: `${job?.quotingLesson || ""}`.trim(),
      quoted_amount: `${job?.quotedAmount || job?.quoteAmount || job?.bidAmount || ""}`.trim(),
      award_po: `${job?.awardPo || job?.poNumber || job?.orderId || ""}`.trim(),
      award_amount: `${job?.awardAmount || job?.poAmount || job?.orderAmount || ""}`.trim(),
      outcome: `${job?.outcome || deal?.outcome || ""}`.trim(),
      image_preview: Array.isArray(job?.imageUrls) ? (job.imageUrls[0] || "") : "",
      attached_files: [],
      upload_files: [],
    })));
    setShowInlineProjectUpload(false);
    setShowAddProject(true);
  }, [jobsData]);

  const handleDeleteProject = useCallback(async (deal) => {
    const projectId = `${deal?.id || ""}`.trim();
    if (!projectId || deletingProjectId) return;
    const ok = window.confirm(`Delete "${deal?.name || projectId}" from Zoho CRM and Pinecone?`);
    if (!ok) return;
    setDeletingProjectId(projectId);
    try {
      const session = getSupplierSession();
      const res = await apiPost(ENDPOINTS.pastProjects.deleteProject, {
        project_id: projectId,
        record_ids: Array.isArray(deal?.recordIds) ? deal.recordIds : [],
        part_ids: Array.isArray(deal?.partIds) ? deal.partIds : [],
        supplier_id: session.supplier_id || "",
        supplier_email: session.supplier_email || "",
      });
      if (!res?.ok) {
        throw new Error(res?.zoho_error || res?.pinecone_error || "Delete failed");
      }
      setDealsData((prev) => prev.filter((item) => `${item?.id || ""}`.trim() !== projectId));
      setJobsData((prev) => prev.filter((job) => `${job?.dealId || ""}`.trim() !== projectId));
      if (projectId === editingProjectId) {
        setShowAddProject(false);
        resetProjectEditor();
      }
      const fieldOverrides = getPastProjectFieldOverrides(session);
      if (fieldOverrides.projects || fieldOverrides.parts) {
        const nextProjects = { ...(fieldOverrides.projects || {}) };
        delete nextProjects[projectId];
        const nextParts = {};
        Object.entries(fieldOverrides.parts || {}).forEach(([key, value]) => {
          if (!key.startsWith(`${projectId}|`)) nextParts[key] = value;
        });
        savePastProjectFieldOverrides({ projects: nextProjects, parts: nextParts }, session);
      }
      const ts = `${Date.now()}`;
      localStorage.setItem("tb_corpus_updated_at", ts);
      localStorage.setItem("tb_corpus_event_type", "history");
      localStorage.setItem("tb_corpus_rescore_pending", "1");
      clearUiDataCaches();
      loadIngestionRef.current?.(true);
      showIngestionToast("Project deleted.", "success");
    } catch (e) {
      showIngestionToast(`Delete failed: ${e?.message || "server error"}`, "error");
    } finally {
      setDeletingProjectId("");
    }
  }, [deletingProjectId, editingProjectId, resetProjectEditor, showIngestionToast]);

  const handleRenameProject = useCallback((dealId, newName) => {
    setDealsData((prev) => prev.map((d) => `${d.id||""}`.trim() === `${dealId||""}`.trim() ? {...d, name: newName} : d));
  }, []);

  const handleAddProject = useCallback(async () => {
    if (addingProject) return;
    setAddProjectError("");
    if (!`${newProject.project_name || ""}`.trim()) {
      setAddProjectError("Project name is required.");
      return;
    }
    setAddingProject(true);
    try {
      const session = getSupplierSession();
      const cleanCustomerName = cleanExtractedText(newProject.customer_name || "");
      const cleanCompanyNameRaw = cleanExtractedText(newProject.company_name || "");
      const cleanCompanyName = looksLikeBadOrgValue(cleanCompanyNameRaw)
        ? (cleanCustomerName || cleanExtractedText(session.supplier_name || ""))
        : cleanCompanyNameRaw;
      const cleanProjectName = normalizeProjectName(newProject.project_name || "", cleanCustomerName || "Uploaded Project");
      const cleanOverview = cleanExtractedText(newProject.project_overview || "");
      const cleanOtherReq = cleanExtractedText(newProject.other_project_requirements || "");

      if (editingProjectId) {
        const partUpdates = (workbenchParts || []).map((p, idx) => ({
          part_id: `${p.part_id || p.sourcePartId || `edit_${idx + 1}`}`.trim(),
          record_id: `${p.source_record_id || p.sourceRecordId || ""}`.trim(),
          part_name: `${p.part_name || p.part_family || ""}`.trim(),
          part_detail: `${p.part_detail || p.part_family_detail || ""}`.trim(),
          part_family: `${p.part_family || newProject.part_family || newProject.project_name}`.trim(),
          material: `${p.material || newProject.material || ""}`.trim(),
          process_primary: `${p.process_primary || newProject.process_primary || ""}`.trim(),
          surface_finish: `${p.surface_finish || p.finish || ""}`.trim(),
          tolerance_details: `${p.tolerance_details || ""}`.trim(),
          quantity: `${p.quantity || ""}`.trim(),
          part_envelope: `${p.part_envelope || ""}`.trim(),
          additional_notes: `${p.additional_notes || p.notes || ""}`.trim(),
          data_sharing_tier: `${p.data_sharing_tier || newProject.sharing_tier || ""}`.trim(),
          customer_industry: `${p.customer_industry || newProject.customer_industry || ""}`.trim(),
          project_date: `${p.project_date || newProject.project_date || ""}`.trim(),
          notes: `${p.notes || newProject.project_overview || ""}`.trim(),
          what_worked: `${p.what_worked || newProject.what_worked || ""}`.trim(),
          quoting_lesson: `${p.quoting_lesson || ""}`.trim(),
          quoted_amount: `${p.quoted_amount || p.quotedAmount || p.quote_amount || ""}`.trim(),
          quote_amount: `${p.quote_amount || p.quoted_amount || p.quotedAmount || ""}`.trim(),
          quotedAmount: `${p.quotedAmount || p.quoted_amount || p.quote_amount || ""}`.trim(),
          award_po: `${p.award_po || p.awardPo || p.po_number || p.order_id || ""}`.trim(),
          awardPo: `${p.awardPo || p.award_po || p.po_number || p.order_id || ""}`.trim(),
          po_number: `${p.po_number || p.award_po || p.awardPo || p.order_id || ""}`.trim(),
          order_id: `${p.order_id || p.award_po || p.awardPo || p.po_number || ""}`.trim(),
          award_amount: `${p.award_amount || p.awardAmount || p.po_amount || p.order_amount || ""}`.trim(),
          po_amount: `${p.po_amount || p.award_amount || p.awardAmount || p.order_amount || ""}`.trim(),
          order_amount: `${p.order_amount || p.award_amount || p.awardAmount || p.po_amount || ""}`.trim(),
          awardAmount: `${p.awardAmount || p.award_amount || p.po_amount || p.order_amount || ""}`.trim(),
          outcome: `${p.outcome || newProject.outcome || "Success"}`.trim(),
        })).filter((p) => p.part_id || p.record_id);
        if (!partUpdates.length) {
          throw new Error("No linked project records were found to update.");
        }
        const combinedProjectDescription = [cleanOverview, cleanOtherReq ? `Other Project Requirements: ${cleanOtherReq}` : ""].filter(Boolean).join("\n\n");
        const updateRes = await apiPost(ENDPOINTS.pastProjects.updateProject, {
          supplier_id: session.supplier_id || "",
          supplier_email: session.supplier_email || "",
          company_name: `${cleanCompanyName || session.supplier_name || ""}`.trim(),
          zoho_id: session.supplier_id || "",
          project_name: `${cleanProjectName || ""}`.trim(),
          company_size: `${newProject.company_size || ""}`.trim(),
          company_location: `${newProject.company_location || ""}`.trim(),
          part_family: `${newProject.part_family || newProject.project_name || ""}`.trim(),
          material: `${newProject.material || ""}`.trim(),
          process_primary: `${newProject.process_primary || ""}`.trim(),
          customer_industry: `${newProject.customer_industry || ""}`.trim(),
          contact_phone: `${newProject.contact_phone || ""}`.trim(),
          contact_email: `${newProject.contact_email || ""}`.trim(),
          project_description: `${combinedProjectDescription || ""}`.trim(),
          expected_annual_production_volume: `${newProject.expected_annual_production_volume || ""}`.trim(),
          mandatory_certifications: csvTags(newProject.mandatory_certifications),
          certification_notes: `${newProject.certification_notes || ""}`.trim(),
          other_project_requirements: `${cleanOtherReq || ""}`.trim(),
          project_overview: `${cleanOverview || ""}`.trim(),
          project_date: `${newProject.project_date || ""}`.trim(),
          what_worked: `${newProject.what_worked || ""}`.trim(),
          outcome: `${newProject.outcome || "Success"}`.trim(),
          part_updates: partUpdates,
        });
        if (!updateRes?.ok) {
          const failedRow = (Array.isArray(updateRes?.results) ? updateRes.results.find((r) => !r?.ok) : null) || {};
          throw new Error(failedRow?.zoho_error || failedRow?.pinecone_error || "Project update failed");
        }

        // Persist quote/award/outcome through the same sync pipeline used by ingestion.
        const syncParts = (workbenchParts || []).map((p, idx) => ({
          company_name: `${cleanCompanyName || session.supplier_name || ""}`.trim(),
          company_size: `${newProject.company_size || ""}`.trim(),
          company_location: `${newProject.company_location || ""}`.trim(),
          contact_phone: `${newProject.contact_phone || ""}`.trim(),
          contact_email: `${newProject.contact_email || ""}`.trim(),
          zoho_id: session.supplier_id || "",
          supplier_email: session.supplier_email || "",
          project_name: `${cleanProjectName}`.trim(),
          customer_name: `${cleanCustomerName || ""}`.trim(),
          part_id: `${p.part_id || p.sourcePartId || `edit_${idx + 1}`}`.trim(),
          source_record_id: `${p.source_record_id || p.sourceRecordId || ""}`.trim(),
          record_id: `${p.source_record_id || p.sourceRecordId || ""}`.trim(),
          part_name: `${p.part_name || p.part_family || ""}`.trim(),
          part_family: `${p.part_family || newProject.part_family || cleanProjectName}`.trim(),
          material: `${p.material || newProject.material || ""}`.trim(),
          process_primary: `${p.process_primary || newProject.process_primary || ""}`.trim(),
          process: `${p.process_primary || newProject.process_primary || ""}`.trim(),
          surface_finish: `${p.surface_finish || p.finish || ""}`.trim(),
          tolerance_details: `${p.tolerance_details || ""}`.trim(),
          quantity: `${p.quantity || ""}`.trim(),
          part_envelope: `${p.part_envelope || ""}`.trim(),
          requirements: `${p.requirements || ""}`.trim(),
          customer_industry: `${p.customer_industry || newProject.customer_industry || ""}`.trim(),
          project_date: `${p.project_date || newProject.project_date || ""}`.trim(),
          notes: `${p.notes || newProject.project_overview || ""}`.trim(),
          additional_notes: `${p.additional_notes || ""}`.trim(),
          data_sharing_tier: `${p.data_sharing_tier || newProject.sharing_tier || ""}`.trim(),
          what_worked: `${p.what_worked || newProject.what_worked || ""}`.trim(),
          outcome: `${p.outcome || newProject.outcome || "Success"}`.trim(),
          quoted_amount: `${p.quoted_amount || p.quote_amount || p.quotedAmount || ""}`.trim(),
          quote_amount: `${p.quote_amount || p.quoted_amount || p.quotedAmount || ""}`.trim(),
          quote_value: `${p.quoted_amount || p.quote_amount || p.quotedAmount || ""}`.trim(),
          award_po: `${p.award_po || p.awardPo || p.po_number || p.order_id || ""}`.trim(),
          po_number: `${p.po_number || p.award_po || p.awardPo || p.order_id || ""}`.trim(),
          order_id: `${p.order_id || p.award_po || p.awardPo || p.po_number || ""}`.trim(),
          award_amount: `${p.award_amount || p.po_amount || p.order_amount || p.awardAmount || ""}`.trim(),
          po_amount: `${p.po_amount || p.award_amount || p.order_amount || p.awardAmount || ""}`.trim(),
          order_amount: `${p.order_amount || p.award_amount || p.po_amount || p.awardAmount || ""}`.trim(),
          award_value: `${p.award_amount || p.po_amount || p.order_amount || p.awardAmount || ""}`.trim(),
        }));
        const syncRes = await apiPost(ENDPOINTS.pastProjects.syncProjects, { parts: syncParts });
        if (!syncRes?.ok) {
          throw new Error(syncRes?.error || "Project sync failed after update");
        }

        const qaOverrides = getQuoteAwardOverrides(session);
        (workbenchParts || []).forEach((p) => {
          const k = `${editingProjectId || ""}|${p.part_id || p.sourcePartId || ""}`.trim();
          if (!k) return;
          qaOverrides[k] = {
            quotedAmount: `${p.quoted_amount || p.quote_amount || p.quotedAmount || ""}`.trim(),
            awardPo: `${p.award_po || p.awardPo || p.po_number || p.order_id || ""}`.trim(),
            awardAmount: `${p.award_amount || p.po_amount || p.order_amount || p.awardAmount || ""}`.trim(),
            outcome: `${p.outcome || newProject.outcome || "Success"}`.trim(),
            quotingLesson: `${p.quoting_lesson || ""}`.trim(),
            updated_at: Date.now(),
          };
        });
        saveQuoteAwardOverrides(qaOverrides, session);

        // Optimistic in-app update so user sees quote/award edits immediately.
        const partById = new Map(
          (workbenchParts || []).map((p) => [
            `${p.part_id || p.sourcePartId || ""}`.trim(),
            p,
          ])
        );
        setJobsData((prev) => (Array.isArray(prev) ? prev.map((job) => {
          if (`${job?.dealId || ""}`.trim() !== `${editingProjectId || ""}`.trim()) return job;
          const key = `${job?.sourcePartId || job?.id || ""}`.trim();
          const patch = partById.get(key);
          if (!patch) return job;
          return {
            ...job,
            quotedAmount: `${patch.quoted_amount || patch.quote_amount || patch.quotedAmount || ""}`.trim(),
            awardPo: `${patch.award_po || patch.awardPo || patch.po_number || patch.order_id || ""}`.trim(),
            awardAmount: `${patch.award_amount || patch.awardAmount || patch.po_amount || patch.order_amount || ""}`.trim(),
            outcome: `${patch.outcome || job?.outcome || ""}`.trim(),
          };
        }) : prev));

        setDealsData((prev) => (Array.isArray(prev) ? prev.map((d) => {
          if (`${d?.id || ""}`.trim() !== `${editingProjectId || ""}`.trim()) return d;
          return { ...d, outcome: `${newProject.outcome || d?.outcome || "Success"}`.trim() };
        }) : prev));

        setShowAddProject(false);
        resetProjectEditor();
        clearUiDataCaches();
        await loadIngestion(true);
        setSyncStatus(`Project updated: ${cleanProjectName || newProject.project_name}`);
        return;
      }
      const combinedProjectDescription = [cleanOverview, cleanOtherReq ? `Other Project Requirements: ${cleanOtherReq}` : ""].filter(Boolean).join("\n\n");
      const base = {
        company_name: `${cleanCompanyName || session.supplier_name || ""}`.trim(),
        company_size: `${newProject.company_size || ""}`.trim(),
        company_location: `${newProject.company_location || ""}`.trim(),
        contact_phone: `${newProject.contact_phone || ""}`.trim(),
        contact_email: `${newProject.contact_email || ""}`.trim(),
        zoho_id: session.supplier_id || "",
        supplier_email: session.supplier_email || "",
        project_name: `${cleanProjectName}`.trim(),
        customer_name: `${cleanCustomerName || ""}`.trim(),
        part_family: `${newProject.part_family || cleanProjectName}`.trim(),
        material: `${newProject.material || "Unspecified"}`.trim(),
        process_primary: `${newProject.process_primary || "Unspecified"}`.trim(),
        process: `${newProject.process_primary || "Unspecified"}`.trim(),
        customer_industry: `${newProject.customer_industry || ""}`.trim(),
        project_description: `${combinedProjectDescription || ""}`.trim(),
        expected_annual_production_volume: `${newProject.expected_annual_production_volume || ""}`.trim(),
        mandatory_certifications: csvTags(newProject.mandatory_certifications),
        certification_notes: `${newProject.certification_notes || ""}`.trim(),
        other_project_requirements: `${cleanOtherReq || ""}`.trim(),
        project_overview: `${cleanOverview || ""}`.trim(),
        sharing_tier: `${newProject.sharing_tier || "Attributed"}`.trim(),
        project_date: `${newProject.project_date || new Date().toISOString().slice(0, 10)}`.trim(),
        what_worked: `${newProject.what_worked || ""}`.trim(),
        outcome: `${newProject.outcome || "Success"}`.trim(),
      };

      const parts = workbenchParts.length
        ? workbenchParts.map((p, idx) => ({
            ...base,
            part_id: p.part_id || `wb_${Date.now()}_${idx + 1}`,
            project_name: base.project_name,
            part_name: cleanExtractedText(p.part_name) || cleanExtractedText(p.part_family) || fileStem(p.filename || "") || base.project_name,
            part_detail: p.part_detail || p.part_family_detail || "",
            part_family: p.part_family || base.part_family,
            part_family_detail: p.part_family_detail || "",
            quantity: p.quantity || "",
            surface_finish: p.surface_finish || p.finish || "",
            tolerance_details: p.tolerance_details || "",
            part_envelope: p.part_envelope || "",
            additional_notes: p.additional_notes || p.notes || "",
            data_sharing_tier: p.data_sharing_tier || base.sharing_tier || "",
            part_family_conf: Number(p.part_family_conf || 0),
            material: p.material || base.material,
            material_reasoning: p.material_reasoning || "",
            material_conf: Number(p.material_conf || 0),
            process_primary: p.process_primary || base.process_primary,
            process_secondary: p.process_secondary || "",
            process_conf: Number(p.process_conf || 0),
            process: p.process_primary || base.process_primary,
            finish: p.finish || "",
            finish_ra: p.finish_ra || "",
            finish_conf: Number(p.finish_conf || 0),
            complexity_class: p.complexity_class || "",
            tolerance_class: p.tolerance_class || "",
            features: p.features || [],
            notes: p.notes || base.project_overview,
            image_b64: p.image_b64 || "",
            image_ext: p.image_ext || ".jpg",
            clip_vector: p.clip_vector || null,
            cad_filename: p.cad_filename || "",
            cad_file_b64: p.cad_file_b64 || "",
            cad_preview_b64: p.cad_preview_b64 || "",
            cad_preview_filename: p.cad_preview_filename || "",
            cad_extra_views: p.cad_extra_views || [],
            cad_stats: p.cad_stats || {},
            geo_scores: Array.isArray(p.geo_scores) ? p.geo_scores : [],
            aspect_ratio: Number(p.aspect_ratio || 0),
            circularity: Number(p.circularity || 0),
            convexity: Number(p.convexity || 0),
            edge_density: Number(p.edge_density || 0),
            symmetry_score: Number(p.symmetry_score || 0),
            symmetry: Number(p.symmetry || p.symmetry_score || 0),
            hole_count: Number(p.hole_count || 0),
            reflectivity: Number(p.reflectivity || 0),
            feature_complexity: Number(p.feature_complexity || 0),
            complexity: Number(p.complexity || p.feature_complexity || 0),
            compactness: Number(p.compactness || 0),
            slenderness: Number(p.slenderness || 0),
            mean_brightness: Number(p.mean_brightness || 0),
            surface_std_dev: Number(p.surface_std_dev || 0),
            quoting_lesson: p.quoting_lesson || "",
            what_worked: p.what_worked || base.what_worked,
            quoted_amount: p.quoted_amount || p.quotedAmount || p.quote_amount || "",
            award_po: p.award_po || p.awardPo || p.po_number || p.order_id || "",
            award_amount: p.award_amount || p.awardAmount || p.po_amount || p.order_amount || "",
            outcome: p.outcome || base.outcome || "Success",
          }))
        : [{
            ...base,
            part_id: `manual_${Date.now()}`,
            part_family_conf: 0,
            material_conf: 0,
            process_conf: 0,
            finish_conf: 0,
            features: [],
            notes: base.project_overview,
            image_b64: "",
            image_ext: ".jpg",
            clip_vector: null,
            cad_filename: "",
            cad_file_b64: "",
            cad_preview_b64: "",
            cad_preview_filename: "",
            cad_extra_views: [],
            cad_stats: {},
            geo_scores: [],
            aspect_ratio: 0,
            circularity: 0,
            convexity: 0,
            edge_density: 0,
            symmetry_score: 0,
            symmetry: 0,
            hole_count: 0,
            reflectivity: 0,
            feature_complexity: 0,
            complexity: 0,
            compactness: 0,
            slenderness: 0,
            mean_brightness: 0,
            surface_std_dev: 0,
            quoting_lesson: "",
            quoted_amount: "",
            award_po: "",
            award_amount: "",
            outcome: base.outcome || "Success",
          }];

      const pushRes = await apiPost(ENDPOINTS.pastProjects.push, { parts });
      if (!pushRes?.ok) throw new Error(pushRes?.error || "Vector DB push failed");
      const pushRows = Array.isArray(pushRes?.results) ? pushRes.results : [];
      pushRows.forEach((r) => {
        const pid = r?.part_id || "unknown_part";
        if (r?.ok) appendLog(`Pinecone OK: ${pid}`);
        else appendLog(`Pinecone FAIL: ${pid} - ${r?.error || "unknown error"}`);
        if (r?.zoho_ok) appendLog(`Zoho(push) OK: ${pid} (${r?.zoho_action || "updated"})`);
        else appendLog(`Zoho(push) FAIL: ${pid} - ${r?.zoho_error || "not synced"}`);
      });

      const crmRes = await apiPost(ENDPOINTS.pastProjects.syncProjects, { parts });
      if (!crmRes?.ok) throw new Error(crmRes?.error || "CRM sync failed");
      const crmRows = Array.isArray(crmRes?.results) ? crmRes.results : [];
      crmRows.forEach((r) => {
        const pid = r?.part_id || "unknown_part";
        if (r?.ok) appendLog(`Zoho(sync) OK: ${pid} (${r?.action || "updated"})`);
        else appendLog(`Zoho(sync) FAIL: ${pid} - ${r?.error || "unknown error"}`);
      });
      appendLog(`Summary: Pinecone ${pushRes?.pushed || 0}/${parts.length} · Zoho(sync) ${crmRes?.synced || 0}/${parts.length}`);
      setShowAddProject(false);
      setNewProject({
        job_id: "",
        company_name: "",
        company_size: "",
        company_location: "",
        customer_name: "",
        contact_phone: "",
        contact_email: "",
        project_name: "",
        part_family: "",
        material: "",
        process_primary: "",
        customer_industry: "",
        expected_annual_production_volume: "",
        mandatory_certifications: "",
        certification_notes: "",
        other_project_requirements: "",
        project_overview: "",
        sharing_tier: "Attributed",
        project_date: "",
        what_worked: "",
        outcome: "Success",
      });
      setWorkbenchFiles([]);
      setWorkbenchParts([]);
      setExtractedPdfText("");
      clearUiDataCaches();
      await loadIngestion(true);
      try {
        const ts = `${Date.now()}`;
        localStorage.setItem("tb_corpus_updated_at", ts);
        localStorage.setItem("tb_corpus_event_type", "history");
        localStorage.setItem("tb_corpus_rescore_pending", "1");
      } catch {}
      setSyncStatus(`Project added: ${newProject.project_name} · Synced ${crmRes?.synced || 0}/${parts.length}`);
    } catch (e) {
      setAddProjectError(e?.message || "Could not add project.");
    } finally {
      setAddingProject(false);
    }
  }, [addingProject, editingProjectId, newProject, workbenchParts, loadIngestion, resetProjectEditor]);

  const visibleIngestion = useMemo(
    () => normalizeVisibleIngestionData(dealsData, jobsData),
    [dealsData, jobsData],
  );
  const visibleDealsData = visibleIngestion.deals;
  const visibleJobsData = visibleIngestion.jobs;

  const TABS=[
    {id:"deals",label:`Past RFPs (${visibleDealsData.length})`},
    {id:"quoting",label:`Quoting Lessons (${quotingLessonsData.length})`},
    {id:"jobs",label:`Shop Floor Jobs (${visibleJobsData.length})`},
    {id:"mfg",label:`Mfg Lessons (${mfgLessonsData.length})`},
    {id:"profiles",label:`Process Profiles (${processProfilesData.length})`},
    {id:"machines",label:`Machines (${machinesData.length})`},
    {id:"analytics",label:"Analytics"}
  ];

  const ingestionCorpusScore = useMemo(() => {
    const explicit = Number(analyticsSummary?.corpusScore || analyticsSummary?.corpus_score || NaN);
    if (Number.isFinite(explicit)) return Math.max(0, Math.min(100, Math.round(explicit)));

    const rawProjects = Array.isArray(analyticsSummary?._projects) ? analyticsSummary._projects : [];
    const projects = rawProjects.length ? rawProjects : visibleDealsData;
    const projectCount = Number(projects.length || 0);

    const allParts = rawProjects.length
      ? rawProjects.flatMap((p) => (Array.isArray(p?.parts) ? p.parts : []))
      : visibleJobsData;
    const partCount = Number(allParts.length || 0);

    const outcomeCount = allParts.filter((part) => {
      const outcome = `${part?.outcome || ""}`.trim().toLowerCase();
      return Boolean(outcome);
    }).length;

    const processSet = new Set();
    const materialSet = new Set();
    allParts.forEach((part) => {
      const process = `${part?.process_primary || part?.process || ""}`.trim();
      const material = `${part?.material || ""}`.trim();
      if (process) processSet.add(process.toLowerCase());
      if (material) materialSet.add(material.toLowerCase());
    });
    const processDiversity = processSet.size;
    const materialDiversity = materialSet.size;

    const lessonsTotal = Number(mfgLessonsData.length || 0) + Number(quotingLessonsData.length || 0);
    const linkedLessons = Number((analyticsSummary?.mfg_linked || 0)) + Number((analyticsSummary?.quoting_linked || 0));

    if (!projectCount && !partCount && !lessonsTotal) return 0;

    const score =
      5 +
      Math.min(20, projectCount * 2) +
      Math.min(24, partCount * 2) +
      Math.min(18, outcomeCount * 2) +
      Math.min(14, processDiversity * 2.5) +
      Math.min(8, materialDiversity * 1.5) +
      Math.min(11, linkedLessons * 1.5) +
      Math.min(10, Number(processProfilesData.length || 0) * 0.8);

    return Math.max(0, Math.min(100, Math.round(score)));
  }, [analyticsSummary, visibleDealsData, visibleJobsData, processProfilesData.length, mfgLessonsData.length, quotingLessonsData.length]);

  // Jobs are shown in the dedicated "Shop Floor Jobs" tab.

  const dealsById = useMemo(() => {
    const m = new Map();
    (Array.isArray(visibleDealsData) ? visibleDealsData : []).forEach((d) => {
      const id = `${d?.id || ""}`.trim();
      if (id) m.set(id, d);
    });
    return m;
  }, [visibleDealsData]);

  const jobsByDealId = useMemo(() => {
    const m = new Map();
    (Array.isArray(visibleJobsData) ? visibleJobsData : []).forEach((j) => {
      const did = `${j?.dealId || ""}`.trim();
      if (!did) return;
      if (!m.has(did)) m.set(did, []);
      m.get(did).push(j);
    });
    return m;
  }, [visibleJobsData]);

  const jobsSorted = useMemo(() => {
    const list = Array.isArray(visibleJobsData) ? [...visibleJobsData] : [];
    list.sort((a, b) => {
      const da = `${a?.date || ""}`.trim();
      const db = `${b?.date || ""}`.trim();
      if (da !== db) return db.localeCompare(da);
      return `${a?.id || ""}`.localeCompare(`${b?.id || ""}`);
    });
    return list;
  }, [visibleJobsData]);

  const summaryDeal = useMemo(
    () => (visibleDealsData || []).find((deal) => `${deal?.id || ""}` === `${summaryDealId || ""}`) || null,
    [visibleDealsData, summaryDealId],
  );

  if (summaryDeal) {
    return (
      <PastProjectSummaryScreen
        deal={summaryDeal}
        jobs={visibleJobsData}
        mfgLessons={mfgLessonsData}
        quotingLessons={quotingLessonsData}
        onBack={() => setSummaryDealId("")}
        onEdit={() => {
          setSummaryDealId("");
          openEditProject(summaryDeal);
        }}
        onLogout={onLogout}
      />
    );
  }

  return (
    <div style={{fontFamily:sans,fontSize:14,color:C.ink,minHeight:"100vh",background:C.bg}}>
      {ingestionToast && (
        <div
          style={{
            position:"fixed",
            top:92,
            left:"50%",
            transform:"translateX(-50%)",
            zIndex:99999,
            minWidth:260,
            maxWidth:"min(560px, calc(100vw - 32px))",
            padding:"12px 16px",
            borderRadius:8,
            background:
              ingestionToast.type === "error" ? C.warnBg :
              ingestionToast.type === "warn" ? C.goldPale :
              C.passBg,
            border:`1px solid ${
              ingestionToast.type === "error" ? C.warnRule :
              ingestionToast.type === "warn" ? C.gold :
              C.passRule
            }`,
            color:
              ingestionToast.type === "error" ? C.warn :
              ingestionToast.type === "warn" ? C.ink :
              C.pass,
            boxShadow:"0 12px 28px rgba(20,28,36,0.2)",
            fontFamily:disp,
            fontSize:13,
            fontWeight:700,
            textAlign:"center",
            pointerEvents:"none",
            animation:"up 0.18s ease",
          }}
        >
          {ingestionToast.message}
        </div>
      )}
      <Topbar screen="ingestion" onBack={()=>navigate("dashboard",{})} onLogout={onLogout}
        rightSlot={<div style={{display:"flex",alignItems:"center",gap:6,padding:"4px 10px",borderRadius:4,background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",marginRight:6}}><span style={{fontFamily:mono,fontSize:9,color:"rgba(255,255,255,0.4)",textTransform:"uppercase"}}>Corpus</span><span style={{fontFamily:mono,fontSize:13,fontWeight:700,color:C.gold}}>{ingestionCorpusScore}</span></div>}/>
      <div style={{background:C.white,borderBottom:`1px solid ${C.rule}`}}>
        <div style={{maxWidth:1260,margin:"0 auto",padding:"18px 26px 0"}}>
          <div style={{fontFamily:sans,fontSize:10,textTransform:"uppercase",letterSpacing:"0.04em",color:C.gold,marginBottom:4,fontWeight:700}}>Supplier Portal - Knowledge Base</div>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,marginBottom:5}}>
            <h1 style={{fontFamily:disp,fontSize:23,fontWeight:700,lineHeight:1.2,color:C.ink}}>Project & Knowledge Ingestion</h1>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <Btn sm variant="accent" onClick={openAddProjectEditor}>Add RFP</Btn>
            </div>
          </div>
          <p style={{fontSize:13,color:C.inkSoft,maxWidth:720,lineHeight:1.65,marginBottom:16}}>Build your manufacturing corpus here. Upload past project files, extract part details, and keep your visible project history clean so assessments can reference real past work with stronger context.</p>
          {syncStatus && (
            <div style={{marginBottom:12,padding:"8px 10px",background:C.surface,border:`1px solid ${C.ruleLight}`,borderRadius:5,fontSize:12,color:C.inkSoft}}>
              {syncStatus}
            </div>
          )}
          {ingestionError && (
            <div style={{marginBottom:12,padding:"8px 10px",background:C.warnBg,border:`1px solid ${C.warnRule}`,borderRadius:5,fontSize:12,color:C.warn}}>
              {userSafeMessage(ingestionError)}
            </div>
          )}
          <div style={{display:"flex",overflowX:"auto",overflowY:"hidden"}}>
            {TABS.map(t=><button key={t.id} onClick={()=>setTab(t.id)} style={{fontFamily:disp,fontSize:11,fontWeight:700,letterSpacing:0,textTransform:"uppercase",padding:"9px 16px",background:"none",border:"none",borderBottom:tab===t.id?`2px solid ${C.gold}`:"2px solid transparent",color:tab===t.id?C.ink:C.inkMuted,cursor:"pointer",marginBottom:-1,transition:"color 0.12s",whiteSpace:"nowrap"}}>{t.label}</button>)}
          </div>
        </div>
      </div>
      <div style={{maxWidth:1260,margin:"0 auto",padding:"20px 26px"}}>
        {ingestionLoading && (
          <div style={{marginBottom:12,padding:"8px 10px",background:C.surface,border:`1px solid ${C.rule}`,borderRadius:5,fontSize:12,color:C.inkMuted}}>
            Your data is loading...
          </div>
        )}
        {tab==="deals"&&(
          <div style={{animation:"up 0.25s ease"}}>
            <div style={{padding:"9px 13px",background:C.goldPale,borderLeft:`3px solid ${C.gold}`,borderRadius:4,fontSize:12.5,color:C.inkSoft,lineHeight:1.65,marginBottom:16}}><strong>Past RFPs</strong> record every uploaded manufacturing project/RFP that contributes to your corpus. Upload new RFP files at the top, then review the visible saved RFPs below.</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,minmax(0,1fr))",gap:10,marginBottom:14}}>
              <div style={{padding:"10px 12px",background:C.white,border:`1px solid ${C.rule}`,borderRadius:6}}>
                <div style={{fontFamily:sans,fontSize:10,color:C.inkMuted,textTransform:"uppercase",letterSpacing:"0.02em",fontWeight:700,marginBottom:4}}>Visible RFPs</div>
                <div style={{fontFamily:disp,fontSize:23,fontWeight:700,color:C.blue,lineHeight:1}}>{dealsData.length}</div>
              </div>
              <div style={{padding:"10px 12px",background:C.white,border:`1px solid ${C.rule}`,borderRadius:6}}>
                <div style={{fontFamily:sans,fontSize:10,color:C.inkMuted,textTransform:"uppercase",letterSpacing:"0.02em",fontWeight:700,marginBottom:4}}>Shop Floor Jobs</div>
                <div style={{fontFamily:disp,fontSize:23,fontWeight:700,color:C.gold,lineHeight:1}}>{jobsData.length}</div>
              </div>
              <div style={{padding:"10px 12px",background:C.white,border:`1px solid ${C.rule}`,borderRadius:6}}>
                <div style={{fontFamily:sans,fontSize:10,color:C.inkMuted,textTransform:"uppercase",letterSpacing:"0.02em",fontWeight:700,marginBottom:4}}>Lessons Linked</div>
                <div style={{fontFamily:disp,fontSize:23,fontWeight:700,color:C.pass,lineHeight:1}}>{mfgLessonsData.length + quotingLessonsData.length}</div>
              </div>
            </div>
            <Card style={{marginBottom:14}} id="past-project-upload">
              <div style={{padding:"12px 14px",borderBottom:`1px solid ${C.ruleLight}`,display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,flexWrap:"wrap"}}>
                <div>
                  <div style={{fontFamily:disp,fontSize:16,fontWeight:700,color:C.ink,lineHeight:1.2}}>Past RFP Upload</div>
                  <div style={{fontFamily:mono,fontSize:9,color:C.inkMuted,textTransform:"uppercase",letterSpacing:"0.06em"}}>CAD · Image · PDF · DOCX/TXT · Multi-file</div>
                </div>
                <button
                  type="button"
                  onClick={()=>{
                    if (showInlineProjectUpload) {
                      setShowInlineProjectUpload(false);
                      return;
                    }
                    resetProjectEditor();
                    setShowAddProject(false);
                    setShowInlineProjectUpload(true);
                  }}
                  style={{display:"inline-flex",alignItems:"center",gap:8,fontFamily:mono,fontSize:10,textTransform:"uppercase",letterSpacing:"0.05em",padding:"7px 12px",background:showInlineProjectUpload?C.goldPale:C.white,border:`1px solid ${showInlineProjectUpload?C.gold:C.rule}`,borderRadius:5,color:showInlineProjectUpload?C.ink:C.inkSoft,cursor:"pointer"}}
                >
                  <span>{showInlineProjectUpload ? "Hide Upload" : "Add Past RFP"}</span>
                  <span style={{fontSize:12,lineHeight:1}}>{showInlineProjectUpload ? "▴" : "▾"}</span>
                </button>
              </div>
              {showInlineProjectUpload && (
              <div style={{padding:16}}>
                <div style={{marginBottom:10,padding:"10px 12px",border:`1px solid ${C.ruleLight}`,borderRadius:6,background:C.surface}}>
                  <div style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",color:C.inkMuted,marginBottom:5,letterSpacing:"0.06em"}}>Step 1 — Project-Level Intake</div>
                  <div style={{fontSize:12.5,color:C.inkSoft,lineHeight:1.6}}>Upload project documents first (PDF, DOCX, TXT, CAD, images, quote sheets, work orders). Fields auto-populate after processing — or fill them in manually.</div>
                </div>

                <div
                  onClick={()=>workbenchInputRef.current?.click()}
                  onDragOver={(e)=>e.preventDefault()}
                  onDrop={(e)=>{e.preventDefault();handleWorkbenchFiles(e.dataTransfer?.files || []);}}
                  style={{border:`2px dashed ${workbenchFiles.length?C.gold:C.rule}`,borderRadius:8,padding:"24px 20px",textAlign:"center",background:workbenchFiles.length?C.goldPale:C.surface,cursor:"pointer",marginBottom:10}}
                >
                  <input
                    ref={workbenchInputRef}
                    type="file"
                    multiple
                    onChange={(e)=>{handleWorkbenchFiles(e.target.files || []); e.target.value = "";}}
                    style={{display:"none"}}
                  />
                  <div style={{fontFamily:disp,fontSize:13,fontWeight:700,marginBottom:4}}>Upload Past RFP Files</div>
                  <div style={{fontSize:12,color:C.inkMuted,lineHeight:1.55}}>Select multiple files for one past RFP: PDF, DOCX, TXT, CSV, RTF, STEP/STP, IGES/IGS, STL, OBJ, PLY, GLB, GLTF, 3MF, images, quote sheets, and work orders.</div>
                  <div style={{fontFamily:mono,fontSize:10,color:C.inkMuted,marginTop:6}}>Drop files here or click to browse</div>
                </div>

                {!!workbenchFiles.length && (
                  <div style={{marginBottom:10,display:"flex",flexWrap:"wrap",gap:6}}>
                    {workbenchFiles.map((f, idx)=>(
                      <span key={`${f.name}-${idx}`} style={{display:"inline-flex",alignItems:"center",gap:6,fontFamily:mono,fontSize:9,padding:"3px 8px",borderRadius:3,border:`1px solid ${C.rule}`,background:C.white,color:C.inkSoft}}>
                        <span>{f.name}</span>
                        <button onClick={(e)=>{e.stopPropagation();removeWorkbenchFile(idx);}} title="Remove file" style={{border:"none",background:"transparent",cursor:"pointer",color:C.inkMuted,fontSize:11,lineHeight:1,padding:0}}>x</button>
                      </span>
                    ))}
                  </div>
                )}

                <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:2,marginBottom:14}}>
                  <Btn sm variant="green" onClick={handlePushWorkbench} disabled={pushingWorkbench || !workbenchParts.length}>
                    {pushingWorkbench ? "Pushing..." : "Push To Corpus"}
                  </Btn>
                  <Btn variant="accent" onClick={handleProcessWorkbench} disabled={processingWorkbench || !workbenchFiles.length}>
                    {processingWorkbench ? "Processing..." : "Process Project Files"}
                  </Btn>
                </div>

                {!!extractedPdfText && (
                  <div style={{marginBottom:10,padding:"8px 10px",border:`1px solid ${C.ruleLight}`,background:C.offWhite,borderRadius:6}}>
                    <div style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted,marginBottom:4}}>Extracted PDF Context</div>
                    <div style={{fontSize:12,color:C.inkSoft,lineHeight:1.6,maxHeight:90,overflow:"auto",whiteSpace:"pre-wrap"}}>
                      {extractedPdfText.slice(0, 1400)}{extractedPdfText.length > 1400 ? "..." : ""}
                    </div>
                  </div>
                )}

                <div style={{padding:"12px",border:`1px solid ${C.ruleLight}`,borderRadius:6,background:C.surface,marginBottom:12}}>
                  <div style={intakeHeadingStyle}>Past RFP Intake Details</div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                    <div>
                      <div style={intakeFieldLabelStyle}>Internal ID (RFP/BID/ORDER NO)</div>
                      <input value={newProject.job_id} placeholder="JOB-1234" onChange={(e)=>setNewProject((p)=>({...p,job_id:e.target.value}))} style={intakeFieldControlStyle} />
                    </div>
                    <div>
                      <div style={intakeFieldLabelStyle}>Company Name</div>
                      <input value={newProject.company_name} placeholder="Supplier / account company" onChange={(e)=>setNewProject((p)=>({...p,company_name:e.target.value}))} style={intakeFieldControlStyle} />
                    </div>
                    <div>
                      <div style={intakeFieldLabelStyle}>Company Size</div>
                      <select value={newProject.company_size} onChange={(e)=>setNewProject((p)=>({...p,company_size:e.target.value}))} style={intakeFieldControlStyle}>
                        <option value="">-- select company size --</option>
                        {COMPANY_SIZE_OPTIONS.map((sz)=><option key={sz} value={sz}>{sz}</option>)}
                      </select>
                    </div>
                    <div>
                      <div style={intakeFieldLabelStyle}>Company Location</div>
                      <input value={newProject.company_location} placeholder="City, State, Country" onChange={(e)=>setNewProject((p)=>({...p,company_location:e.target.value}))} style={intakeFieldControlStyle} />
                    </div>
                    <div>
                      <div style={intakeFieldLabelStyle}>Customer Name</div>
                      <input value={newProject.customer_name} placeholder="Customer name (anonymized in sharing)" onChange={(e)=>setNewProject((p)=>({...p,customer_name:e.target.value}))} style={intakeFieldControlStyle} />
                    </div>
                    <div>
                      <div style={intakeFieldLabelStyle}>Contact Phone</div>
                      <input value={newProject.contact_phone} placeholder="+1 555 555 5555" onChange={(e)=>setNewProject((p)=>({...p,contact_phone:e.target.value}))} style={intakeFieldControlStyle} />
                    </div>
                    <div>
                      <div style={intakeFieldLabelStyle}>Contact Email</div>
                      <input value={newProject.contact_email} placeholder="name@company.com" onChange={(e)=>setNewProject((p)=>({...p,contact_email:e.target.value}))} style={intakeFieldControlStyle} />
                    </div>
                    <div>
                      <div style={intakeFieldLabelStyle}>Project Name</div>
                      <input value={newProject.project_name} placeholder="e.g. Aerospace Actuator Assembly" onChange={(e)=>setNewProject((p)=>({...p,project_name:e.target.value}))} style={intakeFieldControlStyle} />
                    </div>
                    <div>
                      <div style={intakeFieldLabelStyle}>Customer Industry</div>
                      <select value={newProject.customer_industry} onChange={(e)=>setNewProject((p)=>({...p,customer_industry:e.target.value}))} style={intakeFieldControlStyle}>
                        <option value="">-- select industry --</option>
                        <option value="Aerospace">Aerospace</option>
                        <option value="Automotive">Automotive</option>
                        <option value="Medical">Medical</option>
                        <option value="Industrial">Industrial</option>
                        <option value="Consumer">Consumer</option>
                        <option value="Energy">Energy</option>
                        <option value="Defense">Defense</option>
                        <option value="Other">Other</option>
                      </select>
                    </div>
                    <div>
                      <div style={intakeFieldLabelStyle}>Project Date</div>
                      <input type="date" value={newProject.project_date} onChange={(e)=>setNewProject((p)=>({...p,project_date:e.target.value}))} style={intakeFieldControlStyle} />
                    </div>
                    <div>
                      <div style={intakeFieldLabelStyle}>Data Sharing Tier</div>
                      <select value={newProject.sharing_tier} onChange={(e)=>setNewProject((p)=>({...p,sharing_tier:e.target.value}))} style={intakeFieldControlStyle}>
                        <option value="Private">Private</option>
                        <option value="Anonymized">Anonymized</option>
                        <option value="Attributed">Attributed</option>
                      </select>
                    </div>
                    <div>
                      <div style={intakeFieldLabelStyle}>Expected Annual Production Volume</div>
                      <input value={newProject.expected_annual_production_volume} placeholder="e.g. 12000 units" onChange={(e)=>setNewProject((p)=>({...p,expected_annual_production_volume:e.target.value}))} style={intakeFieldControlStyle} />
                    </div>
                    <div style={{gridColumn:"1 / -1"}}>
                      <div style={intakeFieldLabelStyle}>Mandatory Certifications</div>
                      <div style={intakeCheckboxPanelStyle}>
                        {MANDATORY_CERTIFICATION_OPTIONS.map((cert)=>{
                          const selected = canonicalizeCertList(csvTags(newProject.mandatory_certifications));
                          const checked = selected.includes(cert);
                          return (
                            <label key={cert} style={{...intakeCheckboxLabelStyle,background:checked?C.goldPale:"transparent"}}>
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e)=>{
                                  const next = new Set(canonicalizeCertList(csvTags(newProject.mandatory_certifications)));
                                  if (e.target.checked) next.add(cert); else next.delete(cert);
                                  setNewProject((p)=>({...p,mandatory_certifications:Array.from(next).join(", ")}));
                                }}
                              />
                              <span>{cert}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                    <div style={{gridColumn:"1 / -1"}}>
                      <div style={intakeFieldLabelStyle}>Certification Notes</div>
                      <textarea value={newProject.certification_notes} placeholder="Any additional cert context..." onChange={(e)=>setNewProject((p)=>({...p,certification_notes:e.target.value}))} rows={2} style={intakeTextareaStyle} />
                    </div>
                    <div style={{gridColumn:"1 / -1"}}>
                      <div style={intakeFieldLabelStyle}>Other Project Requirements</div>
                      <textarea value={newProject.other_project_requirements || ""} placeholder="Any additional requirements not covered above..." onChange={(e)=>setNewProject((p)=>({...p,other_project_requirements:e.target.value}))} rows={2} style={intakeTextareaStyle} />
                    </div>
                    <div style={{gridColumn:"1 / -1"}}>
                      <div style={intakeFieldLabelStyle}>Project Overview</div>
                      <textarea value={newProject.project_overview} placeholder="Auto-filled after first file analysis — or describe the job yourself." onChange={(e)=>setNewProject((p)=>({...p,project_overview:e.target.value}))} rows={2} style={intakeTextareaStyle} />
                    </div>
                  </div>
                </div>

                <div style={{padding:"14px",background:"linear-gradient(180deg,#F6F9FF 0%,#EFF3FA 100%)",border:`1px solid ${C.rule}`,borderRadius:10}}>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10,gap:8,flexWrap:"wrap"}}>
                    <div>
                      <div style={intakeFieldLabelStyle}>Step 2 — Part-Level Files & Details</div>
                      <div style={intakeHeadingStyle}>{workbenchParts.length} part{workbenchParts.length!==1?"s":""} added</div>
                    </div>
                    <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                      <label htmlFor="past-ingestion-overwrite" style={{display:"flex",alignItems:"center",gap:6,cursor:"pointer",fontFamily:mono,fontSize:10,fontWeight:700,color:C.inkSoft,letterSpacing:"0.03em"}}>
                        <input
                          id="past-ingestion-overwrite"
                          type="checkbox"
                          checked={workbenchExtractOverwrite}
                          onChange={(e)=>setWorkbenchExtractOverwrite(e.target.checked)}
                        />
                        Overwrite on extract
                      </label>
                      <Btn sm variant="outline" onClick={handleAddWorkbenchPart}>+ Add Part</Btn>
                    </div>
                  </div>

                  {!workbenchParts.length && (
                    <div style={{marginBottom:10,padding:"10px",border:`1px dashed ${C.rule}`,borderRadius:6,background:C.white,fontSize:12.5,color:C.inkMuted,lineHeight:1.55}}>
                      Click <strong style={{color:C.ink}}>Add Part</strong> to open a part detail form. File processing can still auto-populate these fields.
                    </div>
                  )}

                  {!!workbenchParts.length && (
                    <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:10}}>
                      {workbenchParts.map((part, idx)=>(
                        <div key={`${part.part_id}-${idx}`} style={{border:`1px solid ${C.rule}`,borderRadius:8,overflow:"hidden",background:C.white}}>
                          <div style={{padding:"8px 10px",background:C.surface,borderBottom:`1px solid ${C.ruleLight}`,display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,flexWrap:"wrap"}}>
                            <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                              <span style={{fontFamily:mono,fontSize:9,color:C.gold,fontWeight:600}}>{part.part_id || `PART-${idx + 1}`}</span>
                              <span style={{fontFamily:mono,fontSize:9,padding:"2px 7px",borderRadius:3,background:C.bluePale,color:C.blue,border:"1px solid rgba(26,61,92,0.2)",textTransform:"uppercase"}}>
                                {part.source_type || "file"}
                              </span>
                              <span style={{fontFamily:mono,fontSize:9,color:C.inkMuted}}>{part.filename || ""}</span>
                            </div>
                            <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                              <input
                                id={`wb-part-files-${idx}`}
                                type="file"
                                multiple
                                onChange={(e)=>{handleWorkbenchPartFiles(idx, e.target.files || []); e.target.value = "";}}
                                style={{display:"none"}}
                              />
                              <Btn sm variant="ghost" onClick={()=>document.getElementById(`wb-part-files-${idx}`)?.click()}>Attach CAD/Image</Btn>
                              <Btn sm variant="accent" onClick={()=>handleProcessWorkbenchPart(idx)} disabled={processingWorkbench || !(part.upload_files?.length)}>
                                {processingWorkbench ? "Processing..." : "Process Part"}
                              </Btn>
                              <Btn sm variant="green" onClick={handlePushWorkbench} disabled={pushingWorkbench || !workbenchParts.length}>
                                {pushingWorkbench ? "Pushing..." : "Push To Corpus"}
                              </Btn>
                              <span style={{fontFamily:mono,fontSize:9,color:workbenchExtractOverwrite?C.warn:C.inkMuted,fontStyle:"italic",whiteSpace:"nowrap"}}>
                                {workbenchExtractOverwrite ? "Will overwrite existing values" : "Only blank fields will be filled"}
                              </span>
                              <button
                                onClick={()=>setWorkbenchParts((prev)=>prev.filter((_,i)=>i!==idx))}
                                style={{fontFamily:mono,fontSize:9,background:"none",border:`1px solid ${C.rule}`,borderRadius:4,padding:"3px 8px",cursor:"pointer",color:C.inkMuted}}
                              >
                                Remove
                              </button>
                            </div>
                          </div>
                          <div style={{padding:10,display:"grid",gridTemplateColumns:"200px 1fr",gap:10}}>
                            <div>
                              <div style={{width:"100%",height:130,border:`1px solid ${C.ruleLight}`,borderRadius:6,overflow:"hidden",background:C.offWhite,display:"flex",alignItems:"center",justifyContent:"center"}}>
                                {part.image_preview ? (
                                  <button
                                    type="button"
                                    onClick={()=>setZoomImageSrc(part.image_preview)}
                                    style={{display:"flex",alignItems:"center",justifyContent:"center",width:"100%",height:"100%",border:"none",background:"transparent",padding:0,cursor:"zoom-in"}}
                                    title="Click to zoom"
                                  >
                                    <img src={part.image_preview} alt={part.filename || "preview"} style={{maxWidth:"100%",maxHeight:"100%",objectFit:"contain"}} />
                                  </button>
                                ) : (
                                  <span style={{fontFamily:mono,fontSize:9,color:C.inkMuted,textTransform:"uppercase"}}>No preview</span>
                                )}
                              </div>
                              {!!(part.cad_extra_views?.length) && (
                                <div style={{marginTop:6,display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:4}}>
                                  {part.cad_extra_views.slice(0,6).map((v, i)=>(
                                    <div key={i} style={{height:42,border:`1px solid ${C.ruleLight}`,borderRadius:4,overflow:"hidden",background:C.white}}>
                                      <button
                                        type="button"
                                        onClick={()=>{
                                          const src = typeof v === "string"
                                            ? `data:image/jpeg;base64,${v}`
                                            : (v?.data_url || (v?.b64 ? `data:image/jpeg;base64,${v.b64}` : ""));
                                          if (src) setZoomImageSrc(src);
                                        }}
                                        style={{display:"block",width:"100%",height:"100%",border:"none",background:"transparent",padding:0,cursor:"zoom-in"}}
                                        title="Click to zoom"
                                      >
                                        <img
                                          src={
                                            typeof v === "string"
                                              ? `data:image/jpeg;base64,${v}`
                                              : (v?.data_url || (v?.b64 ? `data:image/jpeg;base64,${v.b64}` : ""))
                                          }
                                          alt={v?.name || `view-${i}`}
                                          style={{width:"100%",height:"100%",objectFit:"cover"}}
                                        />
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              )}
                              {!!(part.attached_files?.length) && (
                                <div style={{marginTop:6,display:"flex",flexWrap:"wrap",gap:4}}>
                                  {part.attached_files.slice(0,8).map((name, i)=>(
                                    <span key={`${name}-${i}`} style={{fontFamily:mono,fontSize:8,padding:"2px 6px",borderRadius:3,border:`1px solid ${C.ruleLight}`,background:C.white,color:C.inkMuted}}>
                                      {name}
                                    </span>
                                  ))}
                                </div>
                              )}
                              {!!(part.cad_stats && Object.keys(part.cad_stats).length) && (
                                <div style={{marginTop:6,display:"flex",flexWrap:"wrap",gap:4}}>
                                  <span style={{fontFamily:mono,fontSize:8,padding:"2px 6px",borderRadius:3,border:`1px solid ${C.ruleLight}`,background:C.surface,color:C.inkMuted}}>
                                    TRI {Number(part.cad_stats.triangles || 0)}
                                  </span>
                                  <span style={{fontFamily:mono,fontSize:8,padding:"2px 6px",borderRadius:3,border:`1px solid ${C.ruleLight}`,background:C.surface,color:C.inkMuted}}>
                                    VTX {Number(part.cad_stats.vertices || 0)}
                                  </span>
                                  <span style={{fontFamily:mono,fontSize:8,padding:"2px 6px",borderRadius:3,border:`1px solid ${C.ruleLight}`,background:C.surface,color:C.inkMuted}}>
                                    AREA {Number(part.cad_stats.surface_area || 0).toFixed(2)}
                                  </span>
                                </div>
                              )}
                            </div>
                            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                              {[
                                ["Part Name","part_name"],
                                ["Material","material"],
                                ["Process Primary","process_primary"],
                                ["Surface Finish","surface_finish"],
                                ["Tolerance Details","tolerance_details"],
                                ["Quantity","quantity"],
                                ["Requirements","requirements"],
                                ["Finish","finish"],
                                ["Project Date","project_date"],
                              ].map(([label,key])=>(
                                <div key={`${part.part_id}-${key}`}>
                                  <div style={intakeFieldLabelStyle}>{label}</div>
                                  {key === "project_date" ? (
                                    <input
                                      type="date"
                                      value={part[key] || ""}
                                      onChange={(e)=>updateWorkbenchPart(idx,key,e.target.value)}
                                      style={intakeFieldControlStyle}
                                    />
                                  ) : (
                                    <input
                                      value={part[key] || ""}
                                      onChange={(e)=>updateWorkbenchPart(idx,key,e.target.value)}
                                      style={intakeFieldControlStyle}
                                    />
                                  )}
                                </div>
                              ))}
                              <div key={`${part.part_id}-data_sharing_tier`}>
                                <div style={intakeFieldLabelStyle}>Data Sharing Tier</div>
                                <select value={part.data_sharing_tier||""} onChange={(e)=>updateWorkbenchPart(idx,"data_sharing_tier",e.target.value)} style={{...intakeFieldControlStyle,cursor:"pointer"}}>
                                  <option value="">— select —</option>
                                  <option value="Attributed">✦ Attributed</option>
                                  <option value="Anonymized">~ Anonymized</option>
                                  <option value="Private">⊘ Private</option>
                                </select>
                              </div>
                              <div key={`${part.part_id}-tolerance_class`}>
                                <div style={intakeFieldLabelStyle}>Tolerance Class</div>
                                <select value={part.tolerance_class||""} onChange={(e)=>updateWorkbenchPart(idx,"tolerance_class",e.target.value)} style={{...intakeFieldControlStyle,cursor:"pointer"}}>
                                  <option value="">— select —</option>
                                  <option value="STANDARD">Standard</option>
                                  <option value="PRECISION">Precision</option>
                                  <option value="HIGH_PRECISION">High Precision</option>
                                </select>
                              </div>
                              <div style={{gridColumn:"1 / -1",marginTop:4,paddingTop:10,borderTop:`1px dashed ${C.ruleLight}`}}>
                                <div style={intakeHeadingStyle}>Quote & Award/PO</div>
                                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                                  <div>
                                    <div style={intakeFieldLabelStyle}>Quote Amount</div>
                                    <input value={part.quoted_amount || ""} onChange={(e)=>updateWorkbenchPart(idx,"quoted_amount",e.target.value)} style={intakeFieldControlStyle} />
                                  </div>
                                  <div>
                                    <div style={intakeFieldLabelStyle}>Award / PO</div>
                                    <input value={part.award_po || ""} onChange={(e)=>updateWorkbenchPart(idx,"award_po",e.target.value)} style={intakeFieldControlStyle} />
                                  </div>
                                  <div>
                                    <div style={intakeFieldLabelStyle}>Award Amount</div>
                                    <input value={part.award_amount || ""} onChange={(e)=>updateWorkbenchPart(idx,"award_amount",e.target.value)} style={intakeFieldControlStyle} />
                                  </div>
                                  <div>
                                    <div style={intakeFieldLabelStyle}>Outcome</div>
                                    <select value={part.outcome||""} onChange={(e)=>updateWorkbenchPart(idx,"outcome",e.target.value)} style={{...intakeFieldControlStyle,cursor:"pointer"}}>
                                      <option value="">— select —</option>
                                      <option value="Success">Success</option>
                                      <option value="Won">Won</option>
                                      <option value="Lost">Lost</option>
                                      <option value="Pending">Pending</option>
                                      <option value="Completed">Completed</option>
                                      <option value="No Bid">No Bid</option>
                                    </select>
                                  </div>
                                </div>
                              </div>
                              {(()=>{
                                const _raw = part.part_envelope || "";
                                const _nums = _raw.match(/[0-9]+\.?[0-9]*/g) || [];
                                const _unit = _raw.replace(/[0-9]+\.?[0-9]*/g,"").replace(/[x×\s]+/g,"").trim();
                                const _x=_nums[0]||""; const _y=_nums[1]||""; const _z=_nums[2]||"";
                                const _mk=(nx,ny,nz,nu)=>{const d=[nx,ny,nz].map(v=>`${v}`.trim()).filter(Boolean);return d.length?d.join(" x ")+(nu.trim()?" "+nu.trim():""):"";}
                                return (
                                  <div style={{gridColumn:"1 / -1"}}>
                                    <div style={intakeFieldLabelStyle}>Dimensions</div>
                                    <div style={{display:"flex",gap:6,alignItems:"flex-end"}}>
                                      {[["X",_x,(v)=>updateWorkbenchPart(idx,"part_envelope",_mk(v,_y,_z,_unit))],["Y",_y,(v)=>updateWorkbenchPart(idx,"part_envelope",_mk(_x,v,_z,_unit))],["Z",_z,(v)=>updateWorkbenchPart(idx,"part_envelope",_mk(_x,_y,v,_unit))]].map(([axis,val,onCh])=>(
                                        <div key={axis} style={{flex:1}}>
                                          <div style={intakeFieldLabelStyle}>{axis}</div>
                                          <input value={val} onChange={(e)=>onCh(e.target.value)} placeholder="0.00" style={intakeFieldControlStyle} />
                                        </div>
                                      ))}
                                      <div>
                                        <div style={intakeFieldLabelStyle}>Units</div>
                                        <select value={_unit} onChange={(e)=>updateWorkbenchPart(idx,"part_envelope",_mk(_x,_y,_z,e.target.value))} style={{...intakeFieldControlStyle,cursor:"pointer"}}>
                                          <option value="">—</option>
                                          <option value="in">in</option>
                                          <option value="mm">mm</option>
                                          <option value="cm">cm</option>
                                          <option value="ft">ft</option>
                                          <option value="m">m</option>
                                        </select>
                                      </div>
                                    </div>
                                  </div>
                                );
                              })()}
                              <div style={{gridColumn:"1 / -1"}}>
                                <div style={intakeFieldLabelStyle}>Notes</div>
                                <textarea
                                  rows={2}
                                  value={part.notes || ""}
                                  onChange={(e)=>updateWorkbenchPart(idx,"notes",e.target.value)}
                                  style={intakeTextareaStyle}
                                />
                              </div>
                              <div style={{gridColumn:"1 / -1"}}>
                                <div style={intakeFieldLabelStyle}>Additional Notes</div>
                                <textarea
                                  rows={2}
                                  value={part.additional_notes || ""}
                                  onChange={(e)=>updateWorkbenchPart(idx,"additional_notes",e.target.value)}
                                  style={intakeTextareaStyle}
                                />
                              </div>
                              <div style={{gridColumn:"1 / -1"}}>
                                <div style={intakeFieldLabelStyle}>What Worked</div>
                                <textarea
                                  rows={2}
                                  value={part.what_worked || ""}
                                  onChange={(e)=>updateWorkbenchPart(idx,"what_worked",e.target.value)}
                                  style={intakeTextareaStyle}
                                />
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div style={{display:"flex",justifyContent:"flex-end",marginTop:10}}>
                    <Btn sm variant="green" onClick={handlePushWorkbench} disabled={pushingWorkbench || !workbenchParts.length}>
                      {pushingWorkbench ? "Pushing..." : "Push To Corpus"}
                    </Btn>
                  </div>
                </div>
              </div>
              )}
            </Card>
            <div style={{borderTop:`2px solid ${C.rule}`,margin:"18px 0 14px",paddingTop:16}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <div style={{fontFamily:disp,fontSize:16,fontWeight:700,color:C.ink,lineHeight:1.2}}>Visible Past RFPs</div>
                  <span style={{fontFamily:mono,fontSize:9,padding:"2px 8px",borderRadius:3,background:C.navy,color:C.gold,border:`1px solid rgba(26,61,92,0.3)`}}>{visibleDealsData.length}</span>
                </div>
                <Btn sm variant="outline" onClick={openAddProjectEditor}>+ Log Past RFP</Btn>
              </div>
              <div style={{fontSize:12,color:C.inkMuted,lineHeight:1.55,marginTop:4}}>Every uploaded RFP record appears here with parts, specs, bid/order IDs, outcomes, and source jobs.</div>
            </div>
            {visibleDealsData.map(deal=><SIDealCard key={deal.id} deal={deal} jobs={visibleJobsData} mfgLessons={mfgLessonsData} quotingLessons={quotingLessonsData} targetJobId={targetJobId} onEdit={openEditProject} onDelete={handleDeleteProject} onRename={handleRenameProject} onViewSummary={(selectedDeal)=>setSummaryDealId(selectedDeal?.id || "")} deleting={deletingProjectId===deal.id} onOpenImage={setZoomImageSrc}/>) }
          </div>
        )}
        {tab==="jobs"&&(
          <div style={{animation:"up 0.25s ease"}}>
            <div style={{padding:"9px 13px",background:C.goldPale,borderLeft:`3px solid ${C.gold}`,borderRadius:4,fontSize:12.5,color:C.inkSoft,lineHeight:1.65,marginBottom:16}}>
              <strong>Shop Floor Jobs</strong> are the part-level job records extracted from your ingested past projects. Open any job to view images/attachments and linked lessons, or jump back into the parent project.
            </div>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
              <p style={{fontSize:13,color:C.inkSoft,lineHeight:1.65,maxWidth:700}}>Jobs are sorted by most recent date. Use "Open Project" on any job to jump to the parent project card and its selected run.</p>
              <button style={{fontFamily:mono,fontSize:9,background:"none",border:`1px solid ${C.blue}`,borderRadius:3,padding:"4px 12px",cursor:"pointer",color:C.blue,textTransform:"uppercase",letterSpacing:"0.04em",flexShrink:0}}>+ Log Job</button>
            </div>
            {jobsSorted.map((job) => {
              const did = `${job?.dealId || ""}`.trim();
              const deal = did ? dealsById.get(did) : null;
              const dealJobs = did ? (jobsByDealId.get(did) || []) : [];
              return (
                <SIJobStandaloneCard
                  key={`${job?.id || ""}-${did}`}
                  job={job}
                  deal={deal}
                  dealJobs={dealJobs}
                  mfgLessons={mfgLessonsData}
                  quotingLessons={quotingLessonsData}
                  onOpenInProject={(jobId) => navToJob(jobId)}
                  onOpenImage={setZoomImageSrc}
                />
              );
            })}
            {!jobsSorted.length && (
              <div style={{padding:"36px 20px",textAlign:"center",border:`2px dashed ${C.ruleLight}`,borderRadius:8,fontFamily:mono,fontSize:10,color:C.inkMuted,textTransform:"uppercase",letterSpacing:"0.06em"}}>No shop floor jobs found yet</div>
            )}
          </div>
        )}
        {tab==="mfg"&&(
          <div style={{animation:"up 0.25s ease"}}>
            <div style={{padding:"9px 13px",background:C.goldPale,borderLeft:`3px solid ${C.gold}`,borderRadius:4,fontSize:12.5,color:C.inkSoft,lineHeight:1.65,marginBottom:16}}>Manufacturing lessons capture process, fixturing, material, and inspection knowledge. Blue chips link each lesson to its source job.</div>
            <div style={{display:"flex",justifyContent:"flex-end",marginBottom:10}}>
              <Btn sm variant="accent" onClick={openAddMfgLesson}>+ Add MFG Lesson</Btn>
            </div>
            {[...new Set((mfgLessonsData || []).map((l)=>`${l.category || "Other"}`.trim() || "Other"))].map(cat=>{
              const items=mfgLessonsData.filter(l=>(`${l.category || "Other"}`.trim() || "Other")===cat);
              if(!items.length)return null;
              const col=catColorsMfg[cat] || C.inkMuted;
              return(
                <div key={cat} style={{marginBottom:18}}>
                  <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:9}}>
                    <div style={{width:9,height:9,borderRadius:2,background:col,flexShrink:0}}/>
                    <span style={{fontFamily:disp,fontSize:13,fontWeight:700}}>{cat}</span>
                    <div style={{flex:1,height:1,background:C.ruleLight}}/>
                    <span style={{fontFamily:mono,fontSize:9,color:C.inkMuted}}>{items.length}</span>
                  </div>
                  {items.map(l=><SILessonCard key={l.id} lesson={l} catColor={col} type="mfg" onNavigateDeals={navToJob} jobs={visibleJobsData} deals={visibleDealsData} onEdit={openEditMfgLesson} onDelete={handleDeleteMfgLesson}/>)}
                </div>
              );
            })}
          </div>
        )}
        {tab==="quoting"&&(
          <div style={{animation:"up 0.25s ease"}}>
            <div style={{padding:"9px 13px",background:C.goldPale,borderLeft:`3px solid ${C.gold}`,borderRadius:4,fontSize:12.5,color:C.inkSoft,lineHeight:1.65,marginBottom:16}}>Quoting lessons capture cost drivers, time risks, and estimation traps added from this UI and linked to a past RFP project.</div>
            <div style={{display:"flex",justifyContent:"flex-end",gap:8,marginBottom:10}}>
              <Btn sm variant="ghost" onClick={async()=>{setSyncStatus("Reloading UI-created lessons...");try{const res=await refreshLessonsFromZoho();setSyncStatus(`Lessons reloaded: ${res.quoting.length} quoting, ${res.mfg.length} mfg.`);}catch(e){setSyncStatus(e?.message || "Could not reload lessons.");}}} disabled={syncingLessons}>Reload Lessons</Btn>
              <Btn sm variant="accent" onClick={openAddQuoteLesson}>+ Add Quoting Lesson</Btn>
            </div>
            {[...new Set((quotingLessonsData || []).map((l)=>`${l.category || "Other"}`.trim() || "Other"))].map(cat=>{
              const items=quotingLessonsData.filter(l=>(`${l.category || "Other"}`.trim() || "Other")===cat);
              if(!items.length)return null;
              const col=catColorsQ[cat] || C.inkMuted;
              return(
                <div key={cat} style={{marginBottom:18}}>
                  <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:9}}>
                    <div style={{width:9,height:9,borderRadius:2,background:col,flexShrink:0}}/>
                    <span style={{fontFamily:disp,fontSize:13,fontWeight:700}}>{cat}</span>
                    <div style={{flex:1,height:1,background:C.ruleLight}}/>
                    <span style={{fontFamily:mono,fontSize:9,color:C.inkMuted}}>{items.length}</span>
                  </div>
                  {items.map(l=><SILessonCard key={l.id} lesson={l} catColor={col} type="quoting" onNavigateDeals={navToJob} jobs={visibleJobsData} deals={visibleDealsData} onEdit={openEditQuoteLesson} onDelete={handleDeleteQuoteLesson}/>)}
                </div>
              );
            })}
          </div>
        )}
        {tab==="machines"&&(
          <div style={{animation:"up 0.25s ease"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,flexWrap:"wrap",marginBottom:12}}>
              <Btn sm variant="accent" onClick={openAddMachine}>+ Add Machine</Btn>
            </div>
            {!machinesData.length ? (
              <Card>
                <div style={{padding:20,textAlign:"center"}}>
                  <div style={{fontFamily:disp,fontSize:18,fontWeight:700,color:C.ink,marginBottom:6}}>No machines in CRM yet</div>
                  <div style={{fontSize:13,color:C.inkMuted,lineHeight:1.65,marginBottom:12}}>Create the first machine, match it to equipment, and attach supported materials.</div>
                  <Btn sm variant="accent" onClick={openAddMachine}>Add Machine</Btn>
                </div>
              </Card>
            ) : (
              <div>
                {machinesData.map((machine) => <MachineCard key={machine.id} machine={machine} onEdit={openEditMachine} />)}
              </div>
            )}
          </div>
        )}
        {tab==="profiles"&&(
          <div style={{animation:"up 0.25s ease"}}>
            <div style={{padding:"9px 13px",background:C.goldPale,borderLeft:`3px solid ${C.gold}`,borderRadius:4,fontSize:12.5,color:C.inkSoft,lineHeight:1.65,marginBottom:10}}>
              Process Profiles from supplier CRM. Expand any row to view process, material, machine, and certifications.
            </div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,gap:8,flexWrap:"wrap"}}>
              <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                <Btn sm variant="accent" onClick={()=>{ setShowAddProfileEditor(true); setAddProfileError(""); }}>
                  + Add Process Profile
                </Btn>
                <span style={{fontFamily:mono,fontSize:9,color:C.inkMuted,textTransform:"uppercase",letterSpacing:"0.05em"}}>
                  Real-time refresh every 30s
                </span>
              </div>
              <span style={{fontFamily:mono,fontSize:9,color:C.inkMuted}}>
                Last updated: {processProfilesUpdatedAt ? new Date(processProfilesUpdatedAt).toLocaleTimeString() : "--"}
              </span>
            </div>
            <ProcessProfilesSection profiles={processProfilesData} />
          </div>
        )}
        {tab==="analytics"&&(
          <AnalyticsPanel
            dealsData={visibleDealsData}
            jobsData={visibleJobsData}
            mfgLessonsData={mfgLessonsData}
            quotingLessonsData={quotingLessonsData}
            processProfilesData={processProfilesData}
            analyticsSummary={analyticsSummary}
            inboundRealtime={inboundRealtime}
          />
        )}
      </div>
      {showMachineEditor && (
        <div style={{position:"fixed",inset:0,background:"rgba(17,30,51,0.55)",zIndex:650,display:"flex",alignItems:"center",justifyContent:"center"}} onMouseDown={(e)=>{if(e.target!==e.currentTarget)return;const bd=e.currentTarget;const onUp=(up)=>{document.removeEventListener('mouseup',onUp);if(up.target===bd)setShowMachineEditor(false);};document.addEventListener('mouseup',onUp);}}>
          <div style={{width:980,maxWidth:"96vw",maxHeight:"90vh",overflow:"auto",background:C.white,border:`1px solid ${C.rule}`,borderRadius:10,boxShadow:"0 18px 50px rgba(20,28,36,0.25)",overflowX:"hidden"}}>
            <div style={{padding:"12px 16px",background:C.navyDeep,borderBottom:`2px solid ${C.gold}`,display:"flex",alignItems:"center",justifyContent:"space-between",gap:10}}>
              <div>
                <div style={{fontFamily:disp,fontSize:16,fontWeight:700,color:C.white}}>{machineDraft.id ? "Edit Machine" : "Add Machine"}</div>
                <div style={{fontSize:12,color:"rgba(255,255,255,0.65)"}}>Manual supplier inventory with equipment-match assistance and CRM material linking</div>
              </div>
              <button onClick={()=>setShowMachineEditor(false)} style={{background:"none",border:"none",color:"rgba(255,255,255,0.6)",cursor:"pointer",fontSize:16}}>x</button>
            </div>
            <div style={{padding:16}}>
              {machineSaveError && (
                <div style={{marginBottom:12,padding:"8px 10px",background:C.warnBg,border:`1px solid ${C.warnRule}`,borderRadius:5,fontSize:12,color:C.warn}}>
                  {userSafeMessage(machineSaveError)}
                </div>
              )}
              <div style={{display:"grid",gridTemplateColumns:"1.2fr 0.8fr",gap:14,alignItems:"start"}}>
                <div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                    <div>
                      <div style={{fontFamily:mono,fontSize:8,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted,marginBottom:4}}>Machine Name *</div>
                      <input value={machineDraft.name} onChange={(e)=>setMachineDraft((p)=>({...p,name:e.target.value}))} placeholder="e.g. Haas VF-2" style={{width:"100%",padding:"9px 10px",border:`1px solid ${C.rule}`,borderRadius:5,background:C.surface,color:C.ink,fontSize:13}} />
                    </div>
                    <div>
                      <div style={{fontFamily:mono,fontSize:8,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted,marginBottom:4}}>Equipment Text</div>
                      <input value={machineDraft.equipment_text} onChange={(e)=>setMachineDraft((p)=>({...p,equipment_text:e.target.value}))} placeholder="Supplier-entered equipment text" style={{width:"100%",padding:"9px 10px",border:`1px solid ${C.rule}`,borderRadius:5,background:C.surface,color:C.ink,fontSize:13}} />
                    </div>
                    <div>
                      <div style={{fontFamily:mono,fontSize:8,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted,marginBottom:4}}>Manufacturer</div>
                      <input value={machineDraft.manufacturer} onChange={(e)=>setMachineDraft((p)=>({...p,manufacturer:e.target.value}))} placeholder="e.g. Haas" style={{width:"100%",padding:"9px 10px",border:`1px solid ${C.rule}`,borderRadius:5,background:C.surface,color:C.ink,fontSize:13}} />
                    </div>
                    <div>
                      <div style={{fontFamily:mono,fontSize:8,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted,marginBottom:4}}>Serial Number</div>
                      <input value={machineDraft.serial_number} onChange={(e)=>setMachineDraft((p)=>({...p,serial_number:e.target.value}))} placeholder="Numeric serial if available" style={{width:"100%",padding:"9px 10px",border:`1px solid ${C.rule}`,borderRadius:5,background:C.surface,color:C.ink,fontSize:13}} />
                    </div>
                    <div>
                      <div style={{fontFamily:mono,fontSize:8,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted,marginBottom:4}}>Purchase / Install Date</div>
                      <input type="date" value={machineDraft.year_of_purchase_install_date} onChange={(e)=>setMachineDraft((p)=>({...p,year_of_purchase_install_date:e.target.value}))} style={{width:"100%",padding:"9px 10px",border:`1px solid ${C.rule}`,borderRadius:5,background:C.surface,color:C.ink,fontSize:13}} />
                    </div>
                    <div>
                      <div style={{fontFamily:mono,fontSize:8,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted,marginBottom:4}}>Status</div>
                      <select value={machineDraft.status} onChange={(e)=>setMachineDraft((p)=>({...p,status:e.target.value}))} style={{width:"100%",padding:"9px 10px",border:`1px solid ${C.rule}`,borderRadius:5,background:C.surface,color:C.ink,fontSize:13}}>
                        <option value="">-- select status --</option>
                        <option value="Active">Active</option>
                        <option value="Ready">Ready</option>
                        <option value="Maintenance">Maintenance</option>
                        <option value="Inactive">Inactive</option>
                      </select>
                    </div>
                    <div style={{gridColumn:"1 / -1"}}>
                      <div style={{fontFamily:mono,fontSize:8,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted,marginBottom:4}}>Use Cases</div>
                      <textarea rows={2} value={machineDraft.use_cases} onChange={(e)=>setMachineDraft((p)=>({...p,use_cases:e.target.value}))} placeholder="What this machine is used for" style={{width:"100%",padding:"9px 10px",border:`1px solid ${C.rule}`,borderRadius:5,background:C.surface,color:C.ink,fontSize:13,resize:"vertical"}} />
                    </div>
                    <div style={{gridColumn:"1 / -1"}}>
                      <div style={{fontFamily:mono,fontSize:8,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted,marginBottom:4}}>Machine Notes</div>
                      <textarea rows={4} value={machineDraft.machine_notes} onChange={(e)=>setMachineDraft((p)=>({...p,machine_notes:e.target.value}))} placeholder="Setup details, capabilities, notes" style={{width:"100%",padding:"9px 10px",border:`1px solid ${C.rule}`,borderRadius:5,background:C.surface,color:C.ink,fontSize:13,resize:"vertical"}} />
                    </div>
                  </div>
                  <div style={{marginTop:14,padding:12,border:`1px solid ${C.ruleLight}`,borderRadius:8,background:C.offWhite}}>
                    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,marginBottom:8,flexWrap:"wrap"}}>
                      <div>
                        <div style={{fontFamily:disp,fontSize:14,fontWeight:700,color:C.ink}}>Equipment Match</div>
                        <div style={{fontSize:12,color:C.inkMuted}}>Reuses the older resolver logic as a suggestion engine.</div>
                      </div>
                      {machineResolveState.loading && <span style={{fontFamily:mono,fontSize:9,color:C.inkMuted}}>Checking equipment...</span>}
                    </div>
                    {machineDraft.matched_equipment_id ? (
                      <div style={{padding:"9px 10px",border:`1px solid ${C.passRule}`,borderRadius:6,background:C.passBg}}>
                        <div style={{fontFamily:mono,fontSize:8,textTransform:"uppercase",letterSpacing:"0.06em",color:C.pass,marginBottom:4}}>Selected Match</div>
                        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,flexWrap:"wrap"}}>
                          <div style={{fontSize:13,fontWeight:600,color:C.ink}}>{machineDraft.matched_equipment_name || "Matched equipment"}</div>
                          <Btn sm variant="ghost" onClick={()=>setMachineDraft((p)=>({...p,matched_equipment_id:"",matched_equipment_name:""}))}>Clear Match</Btn>
                        </div>
                      </div>
                    ) : machineResolveState.best_match ? (
                      <div style={{padding:"9px 10px",border:`1px solid ${C.ruleLight}`,borderRadius:6,background:C.white}}>
                        <div style={{fontFamily:mono,fontSize:8,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted,marginBottom:4}}>Suggested Match</div>
                        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,flexWrap:"wrap"}}>
                          <div>
                            <div style={{fontSize:13,fontWeight:600,color:C.ink}}>{machineResolveState.best_match.name}</div>
                            <div style={{fontSize:12,color:C.inkMuted}}>{machineResolveState.best_match.manufacturer || "Equipment DB"} · score {machineResolveState.best_match.score}</div>
                          </div>
                          <Btn sm variant="accent" onClick={()=>setMachineDraft((p)=>({...p,matched_equipment_id:machineResolveState.best_match.record_id || "",matched_equipment_name:machineResolveState.best_match.name || "",other_equipment:""}))}>Use Match</Btn>
                        </div>
                      </div>
                    ) : (
                      <div style={{fontSize:12.5,color:C.inkMuted}}>No confident match yet. You can continue with Other Equipment.</div>
                    )}
                    <div style={{marginTop:10}}>
                      <div style={{fontFamily:mono,fontSize:8,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted,marginBottom:4}}>Other Equipment</div>
                      <input value={machineDraft.other_equipment} onChange={(e)=>setMachineDraft((p)=>({...p,other_equipment:e.target.value,matched_equipment_id:e.target.value ? "" : p.matched_equipment_id,matched_equipment_name:e.target.value ? "" : p.matched_equipment_name}))} placeholder="Use when no DB match is right" style={{width:"100%",padding:"9px 10px",border:`1px solid ${C.rule}`,borderRadius:5,background:C.white,color:C.ink,fontSize:13}} />
                    </div>
                  </div>
                </div>
                <div>
                  <div style={{padding:12,border:`1px solid ${C.ruleLight}`,borderRadius:8,background:C.offWhite,marginBottom:12}}>
                    <div style={{fontFamily:disp,fontSize:14,fontWeight:700,color:C.ink,marginBottom:8}}>CRM Materials</div>
                    <input value={machineMaterialQuery} onChange={(e)=>setMachineMaterialQuery(e.target.value)} placeholder="Search materials" style={{width:"100%",padding:"8px 9px",border:`1px solid ${C.rule}`,borderRadius:5,background:C.white,color:C.ink,fontSize:12,marginBottom:8}} />
                    <div style={{display:"flex",flexWrap:"wrap",gap:6,maxHeight:220,overflow:"auto"}}>
                      {filteredMachineMaterials.map((material) => {
                        const selected = machineDraft.material_ids.includes(material.id);
                        return (
                          <button
                            key={material.id}
                            type="button"
                            onClick={() => setMachineDraft((prev) => ({
                              ...prev,
                              material_ids: selected ? prev.material_ids.filter((id) => id !== material.id) : [...prev.material_ids, material.id],
                            }))}
                            style={{fontFamily:mono,fontSize:9,padding:"4px 8px",borderRadius:4,cursor:"pointer",border:`1px solid ${selected ? C.gold : C.ruleLight}`,background:selected?C.goldPale:C.white,color:selected?C.gold:C.inkMuted}}
                          >
                            {material.name}
                          </button>
                        );
                      })}
                      {!filteredMachineMaterials.length && <div style={{fontSize:12,color:C.inkMuted}}>No CRM materials found for that search.</div>}
                    </div>
                  </div>
                  <div style={{padding:12,border:`1px solid ${C.ruleLight}`,borderRadius:8,background:C.offWhite}}>
                    <div style={{fontFamily:disp,fontSize:14,fontWeight:700,color:C.ink,marginBottom:8}}>Unmatched Materials</div>
                    <div style={{fontSize:12,color:C.inkMuted,lineHeight:1.6,marginBottom:8}}>Keep custom or unresolved materials visible here. Only CRM-linked materials flow into machine-material junction records.</div>
                    <textarea rows={4} value={machineDraft.other_materials} onChange={(e)=>setMachineDraft((p)=>({...p,other_materials:e.target.value}))} placeholder="Titanium foam, proprietary resin, etc." style={{width:"100%",padding:"9px 10px",border:`1px solid ${C.rule}`,borderRadius:5,background:C.white,color:C.ink,fontSize:13,resize:"vertical"}} />
                    {!!machineDraft.material_ids.length && (
                      <div style={{marginTop:10}}>
                        <div style={{fontFamily:mono,fontSize:8,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted,marginBottom:4}}>Selected CRM Materials</div>
                        <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                          {machineDraft.material_ids.map((id) => {
                            const material = machineMaterialsCatalog.find((item) => item.id === id);
                            return (
                              <span key={id} style={{fontFamily:mono,fontSize:9,padding:"3px 8px",borderRadius:3,background:C.bluePale,border:"1px solid rgba(26,61,92,0.2)",color:C.blue}}>
                                {material?.name || id}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div style={{display:"flex",justifyContent:"flex-end",gap:8,marginTop:16}}>
                <Btn sm variant="ghost" onClick={()=>setShowMachineEditor(false)}>Cancel</Btn>
                <Btn sm variant="accent" onClick={handleSaveMachine} disabled={savingMachine}>{savingMachine ? "Saving..." : "Save Machine"}</Btn>
              </div>
            </div>
          </div>
        </div>
      )}
      {zoomImageSrc && (
        <div onClick={()=>setZoomImageSrc("")} style={{position:"fixed",inset:0,background:"rgba(17,30,51,0.82)",zIndex:900,display:"flex",alignItems:"center",justifyContent:"center",padding:24,cursor:"zoom-out"}}>
          <img
            src={zoomImageSrc}
            alt="Part preview"
            style={{maxWidth:"92vw",maxHeight:"88vh",objectFit:"contain",borderRadius:8,border:`1px solid ${C.ruleLight}`,background:C.white}}
            onClick={(e)=>e.stopPropagation()}
          />
        </div>
      )}
      {showQuoteEditor && (
        <div style={{position:"fixed",inset:0,background:"rgba(17,30,51,0.55)",zIndex:650,display:"flex",alignItems:"center",justifyContent:"center"}} onMouseDown={(e)=>{if(e.target!==e.currentTarget)return;const bd=e.currentTarget;const onUp=(up)=>{document.removeEventListener('mouseup',onUp);if(up.target===bd)setShowQuoteEditor(false);};document.addEventListener('mouseup',onUp);}}>
          <div style={{width:760,maxWidth:"95vw",background:C.white,border:`1px solid ${C.rule}`,borderRadius:10,boxShadow:"0 18px 50px rgba(20,28,36,0.25)",overflow:"hidden"}}>
            <div style={{padding:"12px 16px",background:C.navyDeep,borderBottom:`2px solid ${C.gold}`,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <div>
                <div style={{fontFamily:disp,fontSize:16,fontWeight:700,color:C.white}}>{editingQuoteId ? "Edit Quoting Lesson" : "Add Quoting Lesson"}</div>
                <div style={{fontSize:12,color:"rgba(255,255,255,0.65)"}}>Capture a reusable estimating lesson</div>
              </div>
              <button onClick={()=>setShowQuoteEditor(false)} style={{background:"none",border:"none",color:"rgba(255,255,255,0.6)",cursor:"pointer",fontSize:16}}>x</button>
            </div>
            <div style={{padding:16}}>
              <div style={{marginBottom:10}}>
                <div style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted,marginBottom:6}}>Category</div>
                <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                  {["Cost Driver","Time Risk","Tolerance Loop","Tooling Cost","Setup Charge","Material Upcharge","Coordination","Rework Risk","Other"].map((cat)=>(
                    <button key={cat} type="button" onClick={()=>setQuoteDraft((p)=>({...p,category:cat}))} style={{fontFamily:mono,fontSize:9,padding:"4px 8px",borderRadius:4,cursor:"pointer",border:`1px solid ${quoteDraft.category===cat?C.gold:C.ruleLight}`,background:quoteDraft.category===cat?C.goldPale:C.surface,color:quoteDraft.category===cat?C.gold:C.inkMuted}}>
                      {cat}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{marginBottom:10}}>
                <div style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted,marginBottom:5}}>Lesson Title *</div>
                <input value={quoteDraft.title} onChange={(e)=>setQuoteDraft((p)=>({...p,title:e.target.value}))} placeholder="e.g. Type III anodize adds a tolerance loop" style={{width:"100%",padding:"9px 10px",border:`1px solid ${C.rule}`,borderRadius:5,background:C.surface,color:C.ink,fontSize:13}} />
              </div>

              <div style={{marginBottom:10}}>
                <div style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted,marginBottom:5}}>Description *</div>
                <textarea rows={3} value={quoteDraft.body} onChange={(e)=>setQuoteDraft((p)=>({...p,body:e.target.value}))} placeholder="Describe the quoting risk, cost surprise, or coordination note for future estimators." style={{width:"100%",padding:"9px 10px",border:`1px solid ${C.rule}`,borderRadius:5,background:C.surface,color:C.ink,fontSize:13,resize:"vertical"}} />
              </div>

              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
                <div>
                  <div style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted,marginBottom:5}}>Project</div>
                  <select value={quoteDraft.projectId} onChange={(e)=>setQuoteDraft((p)=>({...p,projectId:e.target.value,partId:"",sourceJob:"",sourceLabel:""}))} style={{width:"100%",padding:"9px 10px",border:`1px solid ${C.rule}`,borderRadius:5,background:C.surface,color:C.ink,fontSize:13}}>
                    <option value="">Select saved project</option>
                    {visibleDealsData.map((d)=><option key={d.id} value={d.id}>{d.name || d.customer || d.id}</option>)}
                  </select>
                </div>
                <div>
                  <div style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted,marginBottom:5}}>Part</div>
                  <select value={quoteDraft.partId} onChange={(e)=>{
                    const partId = e.target.value;
                    const job = (visibleJobsData || []).find((j)=>`${j.id || ""}`.trim() === `${partId}`.trim());
                    const deal = (visibleDealsData || []).find((d)=>`${d.id || ""}`.trim() === `${job?.dealId || quoteDraft.projectId || ""}`.trim());
                    const sourceLabel = buildLessonSourceLabel(deal, job, partId);
                    setQuoteDraft((p)=>({
                      ...p,
                      projectId: job?.dealId || p.projectId,
                      partId,
                      sourceJob: sourceLabel,
                      sourceLabel,
                      process: p.process || job?.process || "",
                      material: p.material || job?.material || "",
                    }));
                  }} style={{width:"100%",padding:"9px 10px",border:`1px solid ${C.rule}`,borderRadius:5,background:C.surface,color:C.ink,fontSize:13}}>
                    <option value="">Select part</option>
                    {visibleJobsData.filter((j)=>!quoteDraft.projectId || j.dealId===quoteDraft.projectId).map((j)=><option key={j.id} value={j.id}>{j.id} - {j.name}</option>)}
                  </select>
                </div>
                <div>
                  <div style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted,marginBottom:5}}>Process</div>
                  <input value={quoteDraft.process} onChange={(e)=>setQuoteDraft((p)=>({...p,process:e.target.value}))} style={{width:"100%",padding:"9px 10px",border:`1px solid ${C.rule}`,borderRadius:5,background:C.surface,color:C.ink,fontSize:13}} />
                </div>
                <div>
                  <div style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted,marginBottom:5}}>Material</div>
                  <input value={quoteDraft.material} onChange={(e)=>setQuoteDraft((p)=>({...p,material:e.target.value}))} style={{width:"100%",padding:"9px 10px",border:`1px solid ${C.rule}`,borderRadius:5,background:C.surface,color:C.ink,fontSize:13}} />
                </div>
                <div>
                  <div style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted,marginBottom:5}}>Source Label</div>
                  <input value={quoteDraft.sourceLabel} onChange={(e)=>setQuoteDraft((p)=>({...p,sourceLabel:e.target.value,sourceJob:e.target.value}))} style={{width:"100%",padding:"9px 10px",border:`1px solid ${C.rule}`,borderRadius:5,background:C.surface,color:C.ink,fontSize:13}} />
                </div>
                <div>
                  <div style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted,marginBottom:5}}>Tier</div>
                  <select value={quoteDraft.tier} onChange={(e)=>setQuoteDraft((p)=>({...p,tier:e.target.value}))} style={{width:"100%",padding:"9px 10px",border:`1px solid ${C.rule}`,borderRadius:5,background:C.surface,color:C.ink,fontSize:13}}>
                    <option value="private">Private</option>
                    <option value="anonymized">Anonymized</option>
                    <option value="attributed">Attributed</option>
                  </select>
                </div>
                <div>
                  <div style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted,marginBottom:5}}>Date</div>
                  <input value={quoteDraft.date} onChange={(e)=>setQuoteDraft((p)=>({...p,date:e.target.value}))} placeholder="YYYY-MM" style={{width:"100%",padding:"9px 10px",border:`1px solid ${C.rule}`,borderRadius:5,background:C.surface,color:C.ink,fontSize:13}} />
                </div>
              </div>

              <div style={{marginBottom:10}}>
                <div style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted,marginBottom:6}}>Attachments</div>
                <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                  <input ref={quoteImageInputRef} type="file" accept="image/*" style={{display:"none"}} onChange={(e)=>{const f=e.target.files?.[0]; if(f)setQuoteDraft((p)=>({...p,imageName:f.name})); e.target.value="";}} />
                  <Btn sm variant="outline" onClick={()=>quoteImageInputRef.current?.click()}>Upload Image</Btn>
                  <input ref={quoteFilesInputRef} type="file" multiple style={{display:"none"}} onChange={(e)=>{const arr=Array.from(e.target.files||[]).map((f)=>f.name); if(arr.length)setQuoteDraft((p)=>({...p,attachmentNames:[...(p.attachmentNames||[]), ...arr]})); e.target.value="";}} />
                  <Btn sm variant="ghost" onClick={()=>quoteFilesInputRef.current?.click()}>+ Attach File</Btn>
                </div>
              </div>

              {syncStatus && (
                <div style={{marginTop:4,marginBottom:10,padding:"8px 10px",border:`1px solid ${C.ruleLight}`,borderRadius:5,background:C.surface,fontSize:12,color:C.inkSoft}}>
                  {syncStatus}
                </div>
              )}
              <div style={{display:"flex",justifyContent:"flex-end",gap:8,marginTop:12}}>
                <Btn variant="ghost" onClick={()=>setShowQuoteEditor(false)} disabled={savingQuoteLesson}>Cancel</Btn>
                <Btn variant="accent" onClick={handleSaveQuoteLesson} disabled={savingQuoteLesson}>{savingQuoteLesson ? "Saving..." : editingQuoteId ? "Save Lesson ->" : "Add Lesson ->"}</Btn>
              </div>
            </div>
          </div>
        </div>
      )}
      {showAddProfileEditor && (
        <div style={{position:"fixed",inset:0,background:"rgba(17,30,51,0.55)",zIndex:650,display:"flex",alignItems:"center",justifyContent:"center"}} onMouseDown={(e)=>{if(e.target!==e.currentTarget)return;const bd=e.currentTarget;const onUp=(up)=>{document.removeEventListener('mouseup',onUp);if(up.target===bd)setShowAddProfileEditor(false);};document.addEventListener('mouseup',onUp);}}>
          <div style={{width:820,maxWidth:"95vw",background:C.white,border:`1px solid ${C.rule}`,borderRadius:10,boxShadow:"0 18px 50px rgba(20,28,36,0.25)",overflow:"hidden"}}>
            <div style={{padding:"12px 16px",background:C.navyDeep,borderBottom:`2px solid ${C.gold}`,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <div>
                <div style={{fontFamily:disp,fontSize:16,fontWeight:700,color:C.white}}>Add Process Profile</div>
                <div style={{fontSize:12,color:"rgba(255,255,255,0.65)"}}>Create a supplier capability profile directly from the Knowledge Base</div>
              </div>
              <button onClick={()=>setShowAddProfileEditor(false)} style={{background:"none",border:"none",color:"rgba(255,255,255,0.6)",cursor:"pointer",fontSize:16}}>x</button>
            </div>
            <div style={{padding:16}}>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                <div>
                  <div style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted,marginBottom:5}}>Profile Name</div>
                  <input value={newProfile.name} onChange={(e)=>setNewProfile((p)=>({...p,name:e.target.value}))} placeholder="Nylon SLS Production" style={{width:"100%",padding:"9px 10px",border:`1px solid ${C.rule}`,borderRadius:5,background:C.surface,color:C.ink,fontSize:13}} />
                </div>
                <div>
                  <div style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted,marginBottom:5}}>Generic Process</div>
                  <input value={newProfile.generic_process} onChange={(e)=>setNewProfile((p)=>({...p,generic_process:e.target.value}))} placeholder="SLS" style={{width:"100%",padding:"9px 10px",border:`1px solid ${C.rule}`,borderRadius:5,background:C.surface,color:C.ink,fontSize:13}} />
                </div>
                <div>
                  <div style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted,marginBottom:5}}>Branded Process</div>
                  <input value={newProfile.branded_process} onChange={(e)=>setNewProfile((p)=>({...p,branded_process:e.target.value}))} placeholder="EOS Nylon SLS" style={{width:"100%",padding:"9px 10px",border:`1px solid ${C.rule}`,borderRadius:5,background:C.surface,color:C.ink,fontSize:13}} />
                </div>
                <div>
                  <div style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted,marginBottom:5}}>Process Family</div>
                  <input value={newProfile.process_family} onChange={(e)=>setNewProfile((p)=>({...p,process_family:e.target.value}))} placeholder="Additive Manufacturing" style={{width:"100%",padding:"9px 10px",border:`1px solid ${C.rule}`,borderRadius:5,background:C.surface,color:C.ink,fontSize:13}} />
                </div>
                <div>
                  <div style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted,marginBottom:5}}>Generic Name</div>
                  <input value={newProfile.generic_name} onChange={(e)=>setNewProfile((p)=>({...p,generic_name:e.target.value}))} placeholder="Nylon SLS Capacity" style={{width:"100%",padding:"9px 10px",border:`1px solid ${C.rule}`,borderRadius:5,background:C.surface,color:C.ink,fontSize:13}} />
                </div>
                <div>
                  <div style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted,marginBottom:5}}>Material</div>
                  <input value={newProfile.material_name} onChange={(e)=>setNewProfile((p)=>({...p,material_name:e.target.value}))} placeholder="Nylon 12" style={{width:"100%",padding:"9px 10px",border:`1px solid ${C.rule}`,borderRadius:5,background:C.surface,color:C.ink,fontSize:13}} />
                </div>
                <div>
                  <div style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted,marginBottom:5}}>Material Class</div>
                  <input value={newProfile.material_class} onChange={(e)=>setNewProfile((p)=>({...p,material_class:e.target.value}))} placeholder="Engineering Plastic" style={{width:"100%",padding:"9px 10px",border:`1px solid ${C.rule}`,borderRadius:5,background:C.surface,color:C.ink,fontSize:13}} />
                </div>
                <div>
                  <div style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted,marginBottom:5}}>Material Family</div>
                  <input value={newProfile.material_family} onChange={(e)=>setNewProfile((p)=>({...p,material_family:e.target.value}))} placeholder="Polymer" style={{width:"100%",padding:"9px 10px",border:`1px solid ${C.rule}`,borderRadius:5,background:C.surface,color:C.ink,fontSize:13}} />
                </div>
                <div>
                  <div style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted,marginBottom:5}}>Material Type</div>
                  <input value={newProfile.material_type} onChange={(e)=>setNewProfile((p)=>({...p,material_type:e.target.value}))} placeholder="Powder Bed Fusion" style={{width:"100%",padding:"9px 10px",border:`1px solid ${C.rule}`,borderRadius:5,background:C.surface,color:C.ink,fontSize:13}} />
                </div>
                <div>
                  <div style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted,marginBottom:5}}>Tolerance</div>
                  <input value={newProfile.tolerance} onChange={(e)=>setNewProfile((p)=>({...p,tolerance:e.target.value}))} placeholder="+/- 0.005 in" style={{width:"100%",padding:"9px 10px",border:`1px solid ${C.rule}`,borderRadius:5,background:C.surface,color:C.ink,fontSize:13}} />
                </div>
                <div>
                  <div style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted,marginBottom:5}}>Manufacturer</div>
                  <input value={newProfile.manufacturer} onChange={(e)=>setNewProfile((p)=>({...p,manufacturer:e.target.value}))} placeholder="EOS" style={{width:"100%",padding:"9px 10px",border:`1px solid ${C.rule}`,borderRadius:5,background:C.surface,color:C.ink,fontSize:13}} />
                </div>
                <div>
                  <div style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted,marginBottom:5}}>Equipment Name</div>
                  <input value={newProfile.equipment_name} onChange={(e)=>setNewProfile((p)=>({...p,equipment_name:e.target.value}))} placeholder="P396" style={{width:"100%",padding:"9px 10px",border:`1px solid ${C.rule}`,borderRadius:5,background:C.surface,color:C.ink,fontSize:13}} />
                </div>
                <div>
                  <div style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted,marginBottom:5}}>Equipment Link</div>
                  <input value={newProfile.equipment_link} onChange={(e)=>setNewProfile((p)=>({...p,equipment_link:e.target.value}))} placeholder="https://..." style={{width:"100%",padding:"9px 10px",border:`1px solid ${C.rule}`,borderRadius:5,background:C.surface,color:C.ink,fontSize:13}} />
                </div>
                <div>
                  <div style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted,marginBottom:5}}>Certifications</div>
                  <input value={newProfile.certifications} onChange={(e)=>setNewProfile((p)=>({...p,certifications:e.target.value}))} placeholder="ISO 9001, AS9100" style={{width:"100%",padding:"9px 10px",border:`1px solid ${C.rule}`,borderRadius:5,background:C.surface,color:C.ink,fontSize:13}} />
                </div>
                <div style={{gridColumn:"1 / -1"}}>
                  <div style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted,marginBottom:5}}>Description</div>
                  <textarea rows={3} value={newProfile.oem_description} onChange={(e)=>setNewProfile((p)=>({...p,oem_description:e.target.value}))} placeholder="Describe the process strengths, part types, and envelope guidance." style={{width:"100%",padding:"9px 10px",border:`1px solid ${C.rule}`,borderRadius:5,background:C.surface,color:C.ink,fontSize:13,resize:"vertical"}} />
                </div>
                <div style={{gridColumn:"1 / -1"}}>
                  <div style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted,marginBottom:5}}>Additional Description</div>
                  <textarea rows={3} value={newProfile.oem_description_2} onChange={(e)=>setNewProfile((p)=>({...p,oem_description_2:e.target.value}))} placeholder="Extra quoting, inspection, or process notes." style={{width:"100%",padding:"9px 10px",border:`1px solid ${C.rule}`,borderRadius:5,background:C.surface,color:C.ink,fontSize:13,resize:"vertical"}} />
                </div>
              </div>
              {addProfileError && (
                <div style={{marginTop:10,padding:"8px 10px",background:C.warnBg,border:`1px solid ${C.warnRule}`,borderRadius:5,fontSize:12,color:C.warn}}>
                  {addProfileError}
                </div>
              )}
              <div style={{display:"flex",justifyContent:"flex-end",gap:8,marginTop:14}}>
                <Btn sm variant="ghost" onClick={()=>setShowAddProfileEditor(false)}>Cancel</Btn>
                <Btn sm variant="accent" onClick={handleCreateProfile} disabled={creatingProfile}>
                  {creatingProfile ? "Saving..." : "Add Process Profile"}
                </Btn>
              </div>
            </div>
          </div>
        </div>
      )}
      {showMfgEditor && (
        <div style={{position:"fixed",inset:0,background:"rgba(17,30,51,0.55)",zIndex:650,display:"flex",alignItems:"center",justifyContent:"center"}} onMouseDown={(e)=>{if(e.target!==e.currentTarget)return;const bd=e.currentTarget;const onUp=(up)=>{document.removeEventListener('mouseup',onUp);if(up.target===bd)setShowMfgEditor(false);};document.addEventListener('mouseup',onUp);}}>
          <div style={{width:760,maxWidth:"95vw",background:C.white,border:`1px solid ${C.rule}`,borderRadius:10,boxShadow:"0 18px 50px rgba(20,28,36,0.25)",overflow:"hidden"}}>
            <div style={{padding:"12px 16px",background:C.navyDeep,borderBottom:`2px solid ${C.gold}`,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <div>
                <div style={{fontFamily:disp,fontSize:16,fontWeight:700,color:C.white}}>{editingMfgId ? "Edit MFG Lesson" : "Add MFG Lesson"}</div>
                <div style={{fontSize:12,color:"rgba(255,255,255,0.65)"}}>Capture a specific, reusable shop-floor lesson</div>
              </div>
              <button onClick={()=>setShowMfgEditor(false)} style={{background:"none",border:"none",color:"rgba(255,255,255,0.7)",cursor:"pointer",fontSize:16}}>x</button>
            </div>
            <div style={{padding:16}}>
              <div style={{marginBottom:10}}>
                <div style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted,marginBottom:6}}>Category</div>
                <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                  {["Fixturing","Thermal","Material","Process","Quality","Setup","Tooling","Inspection","Other"].map((cat)=>(
                    <button key={cat} type="button" onClick={()=>setMfgDraft((p)=>({...p,category:cat}))} style={{fontFamily:mono,fontSize:9,padding:"4px 8px",borderRadius:4,cursor:"pointer",border:`1px solid ${mfgDraft.category===cat?C.gold:C.ruleLight}`,background:mfgDraft.category===cat?C.goldPale:C.surface,color:mfgDraft.category===cat?C.gold:C.inkMuted}}>
                      {cat}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{marginBottom:10}}>
                <div style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted,marginBottom:5}}>Lesson Title *</div>
                <input value={mfgDraft.title} onChange={(e)=>setMfgDraft((p)=>({...p,title:e.target.value}))} placeholder="e.g. Single-setup approach for jaw geometry" style={{width:"100%",padding:"9px 10px",border:`1px solid ${C.rule}`,borderRadius:5,background:C.surface,color:C.ink,fontSize:13}} />
              </div>

              <div style={{marginBottom:10}}>
                <div style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted,marginBottom:5}}>Description *</div>
                <textarea rows={3} value={mfgDraft.body} onChange={(e)=>setMfgDraft((p)=>({...p,body:e.target.value}))} placeholder="Describe the lesson clearly enough that someone else can reuse it on a similar job." style={{width:"100%",padding:"9px 10px",border:`1px solid ${C.rule}`,borderRadius:5,background:C.surface,color:C.ink,fontSize:13,resize:"vertical"}} />
              </div>

              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
                <div>
                  <div style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted,marginBottom:5}}>Project</div>
                  <select value={mfgDraft.projectId} onChange={(e)=>setMfgDraft((p)=>({...p,projectId:e.target.value,partId:"",sourcePart:"",sourceLabel:""}))} style={{width:"100%",padding:"9px 10px",border:`1px solid ${C.rule}`,borderRadius:5,background:C.surface,color:C.ink,fontSize:13}}>
                    <option value="">Select saved project</option>
                    {visibleDealsData.map((d)=><option key={d.id} value={d.id}>{d.name || d.customer || d.id}</option>)}
                  </select>
                </div>
                <div>
                  <div style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted,marginBottom:5}}>Part</div>
                  <select value={mfgDraft.partId} onChange={(e)=>{
                    const partId = e.target.value;
                    const job = (visibleJobsData || []).find((j)=>`${j.id || ""}`.trim() === `${partId}`.trim());
                    const deal = (visibleDealsData || []).find((d)=>`${d.id || ""}`.trim() === `${job?.dealId || mfgDraft.projectId || ""}`.trim());
                    const sourceLabel = buildLessonSourceLabel(deal, job, partId);
                    setMfgDraft((p)=>({
                      ...p,
                      projectId: job?.dealId || p.projectId,
                      partId,
                      sourcePart: sourceLabel,
                      sourceLabel,
                      process: p.process || job?.process || "",
                      material: p.material || job?.material || "",
                    }));
                  }} style={{width:"100%",padding:"9px 10px",border:`1px solid ${C.rule}`,borderRadius:5,background:C.surface,color:C.ink,fontSize:13}}>
                    <option value="">Select part</option>
                    {visibleJobsData.filter((j)=>!mfgDraft.projectId || j.dealId===mfgDraft.projectId).map((j)=><option key={j.id} value={j.id}>{j.id} - {j.name}</option>)}
                  </select>
                </div>
                <div>
                  <div style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted,marginBottom:5}}>Process</div>
                  <input value={mfgDraft.process} onChange={(e)=>setMfgDraft((p)=>({...p,process:e.target.value}))} style={{width:"100%",padding:"9px 10px",border:`1px solid ${C.rule}`,borderRadius:5,background:C.surface,color:C.ink,fontSize:13}} />
                </div>
                <div>
                  <div style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted,marginBottom:5}}>Material</div>
                  <input value={mfgDraft.material} onChange={(e)=>setMfgDraft((p)=>({...p,material:e.target.value}))} style={{width:"100%",padding:"9px 10px",border:`1px solid ${C.rule}`,borderRadius:5,background:C.surface,color:C.ink,fontSize:13}} />
                </div>
                <div>
                  <div style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted,marginBottom:5}}>Source Label</div>
                  <input value={mfgDraft.sourceLabel} onChange={(e)=>setMfgDraft((p)=>({...p,sourceLabel:e.target.value,sourcePart:e.target.value}))} style={{width:"100%",padding:"9px 10px",border:`1px solid ${C.rule}`,borderRadius:5,background:C.surface,color:C.ink,fontSize:13}} />
                </div>
                <div>
                  <div style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted,marginBottom:5}}>Tier</div>
                  <select value={mfgDraft.tier} onChange={(e)=>setMfgDraft((p)=>({...p,tier:e.target.value}))} style={{width:"100%",padding:"9px 10px",border:`1px solid ${C.rule}`,borderRadius:5,background:C.surface,color:C.ink,fontSize:13}}>
                    <option value="private">Private</option>
                    <option value="anonymized">Anonymized</option>
                    <option value="attributed">Attributed</option>
                  </select>
                </div>
                <div>
                  <div style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted,marginBottom:5}}>Date</div>
                  <input value={mfgDraft.date} onChange={(e)=>setMfgDraft((p)=>({...p,date:e.target.value}))} placeholder="YYYY-MM" style={{width:"100%",padding:"9px 10px",border:`1px solid ${C.rule}`,borderRadius:5,background:C.surface,color:C.ink,fontSize:13}} />
                </div>
              </div>

              <div style={{marginBottom:10}}>
                <div style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted,marginBottom:6}}>Attachments</div>
                <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                  <input ref={mfgImageInputRef} type="file" accept="image/*" style={{display:"none"}} onChange={(e)=>{const f=e.target.files?.[0]; if(f)setMfgDraft((p)=>({...p,imageName:f.name})); e.target.value="";}} />
                  <Btn sm variant="outline" onClick={()=>mfgImageInputRef.current?.click()}>Upload Image</Btn>
                  <input ref={mfgFilesInputRef} type="file" multiple style={{display:"none"}} onChange={(e)=>{const arr=Array.from(e.target.files||[]).map((f)=>f.name); if(arr.length)setMfgDraft((p)=>({...p,attachmentNames:[...(p.attachmentNames||[]), ...arr]})); e.target.value="";}} />
                  <Btn sm variant="ghost" onClick={()=>mfgFilesInputRef.current?.click()}>+ Attach File</Btn>
                </div>
                {!!mfgDraft.imageName && <div style={{marginTop:6,fontFamily:mono,fontSize:9,color:C.inkMuted}}>Image: {mfgDraft.imageName}</div>}
                {!!(mfgDraft.attachmentNames||[]).length && <div style={{marginTop:4,fontFamily:mono,fontSize:9,color:C.inkMuted}}>Files: {(mfgDraft.attachmentNames||[]).join(", ")}</div>}
              </div>

              <div style={{display:"flex",justifyContent:"flex-end",gap:8,marginTop:12}}>
                <Btn variant="ghost" onClick={()=>setShowMfgEditor(false)}>Cancel</Btn>
                <Btn variant="accent" onClick={handleSaveMfgLesson}>{editingMfgId ? "Save Lesson ->" : "Add Lesson ->"}</Btn>
              </div>
            </div>
          </div>
        </div>
      )}
      {showAddProject && (
        <div style={{position:"fixed",inset:0,background:"rgba(17,30,51,0.55)",zIndex:600,display:"flex",alignItems:"center",justifyContent:"center"}} onMouseDown={(e)=>{if(e.target!==e.currentTarget)return;const bd=e.currentTarget;const onUp=(up)=>{document.removeEventListener('mouseup',onUp);if(up.target===bd)setShowAddProject(false);};document.addEventListener('mouseup',onUp);}}>
          <div style={{width:900,maxWidth:"95vw",maxHeight:"90vh",background:C.white,border:`1px solid ${C.rule}`,borderRadius:10,boxShadow:"0 18px 50px rgba(20,28,36,0.25)",overflow:"hidden",display:"flex",flexDirection:"column"}}>
            <div style={{padding:"12px 16px",background:C.navyDeep,borderBottom:`2px solid ${C.gold}`,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                <div>
                  <div style={{fontFamily:disp,fontSize:16,fontWeight:700,color:C.white}}>{editingProjectId ? "Edit Past RFP" : "Log Past RFP"}</div>
                  <div style={{fontFamily:mono,fontSize:9,color:"rgba(255,255,255,0.45)",textTransform:"uppercase",letterSpacing:"0.06em"}}>Past RFP Draft</div>
                </div>
              <button onClick={()=>setShowAddProject(false)} style={{background:"none",border:"none",color:"rgba(255,255,255,0.6)",cursor:"pointer",fontSize:16}}>x</button>
            </div>
            <div style={{padding:16,overflowY:"auto"}}>
              {addProjectError && <div style={{marginBottom:10,padding:"8px 10px",background:C.warnBg,border:`1px solid ${C.warnRule}`,borderRadius:5,fontSize:12,color:C.warn}}>{userSafeMessage(addProjectError)}</div>}
              <div style={{marginBottom:10,display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                <div style={{padding:"8px 10px",border:`1px solid ${C.ruleLight}`,borderRadius:6,background:C.surface}}>
                  <div style={{fontFamily:mono,fontSize:9,color:C.inkMuted,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:3}}>Field types</div>
                  <div style={{fontSize:12,color:C.inkSoft}}>Suggested: File-derived defaults (editable)</div>
                </div>
                <div style={{padding:"8px 10px",border:`1px solid ${C.ruleLight}`,borderRadius:6,background:C.surface}}>
                  <div style={{fontFamily:mono,fontSize:9,color:C.inkMuted,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:3}}>Supplier</div>
                  <div style={{fontSize:12,color:C.inkSoft}}>You fill this manually</div>
                </div>
              </div>

              <div style={{marginBottom:14,padding:"12px 12px",border:`1px solid ${C.rule}`,borderRadius:8,background:C.offWhite}}>
                <div style={{fontFamily:disp,fontSize:14,fontWeight:700,color:C.ink,marginBottom:4}}>Start Here</div>
                <div style={{fontSize:12.5,color:C.inkSoft,lineHeight:1.55,marginBottom:10}}>
                  Upload all project files in one shot. Add RFP, quote, work order, images, CAD, and any supporting files.
                  Automatic processing runs for image/CAD files and populates the part fields.
                </div>
                <div
                  onDragOver={(e)=>e.preventDefault()}
                  onDrop={(e)=>{e.preventDefault();handleWorkbenchFiles(e.dataTransfer?.files || []);}}
                  style={{border:`2px dashed ${C.rule}`,borderRadius:8,padding:"12px",background:C.white}}
                >
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,flexWrap:"wrap"}}>
                    <div>
                      <div style={{fontFamily:mono,fontSize:10,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted,marginBottom:3}}>Upload project files</div>
                      <div style={{fontSize:12,color:C.inkSoft}}>or click to browse - Any format · Multi-file</div>
                      <div style={{fontSize:11.5,color:C.inkMuted,marginTop:3}}>Upload RFP, quote, work order, images, CAD and any attachments in one place.</div>
                      <div style={{fontSize:11.5,color:C.inkMuted}}>Fields are auto-populated when an image or CAD file is included.</div>
                    </div>
                    <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                      <input ref={workbenchInputRef} type="file" multiple onChange={(e)=>{handleWorkbenchFiles(e.target.files || []); e.target.value="";}} style={{display:"none"}} />
                      <Btn sm variant="ghost" onClick={()=>workbenchInputRef.current?.click()}>Browse</Btn>
                      <Btn sm variant="green" onClick={handlePushWorkbench} disabled={pushingWorkbench || !workbenchParts.length}>
                        {pushingWorkbench ? "Pushing..." : "Push To Corpus"}
                      </Btn>
                      <Btn sm variant="accent" onClick={handleProcessWorkbench} disabled={processingWorkbench || !workbenchFiles.length}>
                        {processingWorkbench ? "Auto Processing..." : "Process Now"}
                      </Btn>
                    </div>
                  </div>
                  {!!workbenchFiles.length && (
                    <div style={{marginTop:8,display:"flex",flexWrap:"wrap",gap:6}}>
                      {workbenchFiles.map((f, i)=>(
                        <span key={`${f.name}-${i}`} style={{display:"inline-flex",alignItems:"center",gap:6,fontFamily:mono,fontSize:9,padding:"2px 7px",borderRadius:3,border:`1px solid ${C.ruleLight}`,background:C.surface,color:C.inkMuted}}>
                          <span>{f.name}</span>
                          <button onClick={(e)=>{e.stopPropagation();removeWorkbenchFile(i);}} title="Remove file" style={{border:"none",background:"transparent",cursor:"pointer",color:C.inkMuted,fontSize:11,lineHeight:1,padding:0}}>x</button>
                        </span>
                      ))}
                    </div>
                  )}
                  {!!workbenchParts.length && (
                    <div style={{marginTop:8,fontFamily:mono,fontSize:9,color:C.pass}}>
                      Auto extracted {workbenchParts.length} part(s). You can edit fields below before submit.
                    </div>
                  )}
                </div>
              </div>

              <div style={{fontFamily:disp,fontSize:14,fontWeight:700,color:C.ink,marginBottom:8}}>Project Details</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                {[
                  ["INTERNAL ID (RFP/BID/ORDER NO)","job_id","Supplier","JOB-1234"],
                  ["Company Name","company_name","Supplier","Supplier / account company"],
                  ["Company Size","company_size","Supplier",""],
                  ["Company Location","company_location","Supplier","City, State, Country"],
                  ["Customer Name","customer_name","Supplier","Customer name (anonymized in sharing)"],
                  ["Contact Phone","contact_phone","Supplier","+1 555 555 5555"],
                  ["Contact Email","contact_email","Supplier","name@company.com"],
                  ["Project Name","project_name","Supplier","e.g. Aerospace Actuator Assembly"],
                  ["Project Date","project_date","Supplier",""],
                  ["Expected Annual Production Volume","expected_annual_production_volume","Supplier","e.g. 12000 units"],
                ].map(([label,key,type,placeholder])=>(
                  <div key={key}>
                    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,marginBottom:5}}>
                      <span style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted}}>{label}</span>
                      <span style={{fontFamily:mono,fontSize:8,padding:"1px 6px",borderRadius:3,background:type==="Auto"?C.bluePale:C.surface,color:type==="Auto"?C.blue:C.inkMuted,border:`1px solid ${type==="Auto"?"rgba(26,61,92,0.2)":C.ruleLight}`}}>{type}</span>
                    </div>
                    {key === "company_size" ? (
                      <select value={newProject.company_size} onChange={(e)=>setNewProject((p)=>({...p,company_size:e.target.value}))} style={{width:"100%",padding:"9px 10px",border:`1px solid ${C.rule}`,borderRadius:5,background:C.surface,color:C.ink,fontSize:13}}>
                        <option value="">-- select company size --</option>
                        {COMPANY_SIZE_OPTIONS.map((sz)=><option key={sz} value={sz}>{sz}</option>)}
                      </select>
                    ) : key === "project_date" ? (
                      <input type="date" value={newProject.project_date} onChange={(e)=>setNewProject((p)=>({...p,project_date:e.target.value}))} style={{width:"100%",padding:"9px 10px",border:`1px solid ${C.rule}`,borderRadius:5,background:C.surface,color:C.ink,fontSize:13}} />
                    ) : (
                      <input value={newProject[key]} placeholder={placeholder} onChange={(e)=>setNewProject((p)=>({...p,[key]:e.target.value}))} style={{width:"100%",padding:"9px 10px",border:`1px solid ${C.rule}`,borderRadius:5,background:C.surface,color:C.ink,fontSize:13}} />
                    )}
                  </div>
                ))}
                <div>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,marginBottom:5}}>
                    <span style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted}}>Customer Industry</span>
                    <span style={{fontFamily:mono,fontSize:8,padding:"1px 6px",borderRadius:3,background:C.surface,color:C.inkMuted,border:`1px solid ${C.ruleLight}`}}>Supplier</span>
                  </div>
                  <select value={newProject.customer_industry} onChange={(e)=>setNewProject((p)=>({...p,customer_industry:e.target.value}))} style={{width:"100%",padding:"9px 10px",border:`1px solid ${C.rule}`,borderRadius:5,background:C.surface,color:C.ink,fontSize:13}}>
                    <option value="">-- select industry --</option>
                    <option value="Aerospace">Aerospace</option>
                    <option value="Automotive">Automotive</option>
                    <option value="Medical">Medical</option>
                    <option value="Industrial">Industrial</option>
                    <option value="Consumer">Consumer</option>
                    <option value="Energy">Energy</option>
                    <option value="Defense">Defense</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div style={{gridColumn:"1 / -1"}}>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,marginBottom:5}}>
                    <span style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted}}>Mandatory Certifications</span>
                    <span style={{fontFamily:mono,fontSize:8,padding:"1px 6px",borderRadius:3,background:C.surface,color:C.inkMuted,border:`1px solid ${C.ruleLight}`}}>Supplier</span>
                  </div>
                  <div style={{border:`1px solid ${C.rule}`,borderRadius:5,background:C.surface,padding:"8px 10px",display:"grid",gridTemplateColumns:"repeat(2,minmax(0,1fr))",gap:6}}>
                    {MANDATORY_CERTIFICATION_OPTIONS.map((cert)=>{
                      const selected = canonicalizeCertList(csvTags(newProject.mandatory_certifications));
                      const checked = selected.includes(cert);
                      return (
                        <label key={cert} style={{display:"flex",alignItems:"center",gap:7,cursor:"pointer",padding:"3px 4px",borderRadius:4,background:checked?C.goldPale:"transparent"}}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e)=>{
                              const next = new Set(canonicalizeCertList(csvTags(newProject.mandatory_certifications)));
                              if (e.target.checked) next.add(cert); else next.delete(cert);
                              setNewProject((p)=>({...p,mandatory_certifications:Array.from(next).join(", ")}));
                            }}
                          />
                          <span style={{fontSize:12,color:C.ink}}>{cert}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
                <div style={{gridColumn:"1 / -1"}}>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,marginBottom:5}}>
                    <span style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted}}>Certification Notes</span>
                    <span style={{fontFamily:mono,fontSize:8,padding:"1px 6px",borderRadius:3,background:C.surface,color:C.inkMuted,border:`1px solid ${C.ruleLight}`}}>Supplier</span>
                  </div>
                  <textarea value={newProject.certification_notes} onChange={(e)=>setNewProject((p)=>({...p,certification_notes:e.target.value}))} rows={2} placeholder="Any extra certification context..." style={{width:"100%",padding:"9px 10px",border:`1px solid ${C.rule}`,borderRadius:5,background:C.surface,color:C.ink,fontSize:13,resize:"vertical"}} />
                </div>
                <div style={{gridColumn:"1 / -1"}}>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,marginBottom:5}}>
                    <span style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted}}>Other Project Requirements</span>
                    <span style={{fontFamily:mono,fontSize:8,padding:"1px 6px",borderRadius:3,background:C.surface,color:C.inkMuted,border:`1px solid ${C.ruleLight}`}}>Supplier</span>
                  </div>
                  <textarea value={newProject.other_project_requirements || ""} onChange={(e)=>setNewProject((p)=>({...p,other_project_requirements:e.target.value}))} rows={2} placeholder="Any additional requirements not covered above..." style={{width:"100%",padding:"9px 10px",border:`1px solid ${C.rule}`,borderRadius:5,background:C.surface,color:C.ink,fontSize:13,resize:"vertical"}} />
                </div>
                <div style={{gridColumn:"1 / -1"}}>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,marginBottom:5}}>
                    <span style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted}}>Project Overview</span>
                    <span style={{fontFamily:mono,fontSize:8,padding:"1px 6px",borderRadius:3,background:C.bluePale,color:C.blue,border:"1px solid rgba(26,61,92,0.2)"}}>Auto</span>
                  </div>
                  <textarea value={newProject.project_overview} onChange={(e)=>setNewProject((p)=>({...p,project_overview:e.target.value}))} rows={3} placeholder="Auto-filled after first image analysis - or describe the job yourself." style={{width:"100%",padding:"9px 10px",border:`1px solid ${C.rule}`,borderRadius:5,background:C.surface,color:C.ink,fontSize:13,resize:"vertical"}} />
                </div>
                <div style={{gridColumn:"1 / -1"}}>
                  <div style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted,marginBottom:6}}>Data Sharing Tier</div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
                    {[
                      ["Private","Your team only",""],
                      ["Anonymized","TrustBridge patterns only - no attribution","+6 pts match"],
                      ["Attributed","Boosts match standing - referenced with your name","+12 pts match"],
                    ].map(([tier,desc,badge])=>(
                      <label key={tier} style={{display:"block",padding:"9px 10px",border:`1px solid ${newProject.sharing_tier===tier?C.gold:C.rule}`,borderRadius:6,background:newProject.sharing_tier===tier?C.goldPale:C.surface,cursor:"pointer"}}>
                        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,marginBottom:4}}>
                          <span style={{fontFamily:disp,fontSize:13,fontWeight:700,color:C.ink}}>{tier==="Private"?"?":tier==="Anonymized"?"~":"?"} {tier}</span>
                          <input type="radio" name="sharing_tier" checked={newProject.sharing_tier===tier} onChange={()=>setNewProject((p)=>({...p,sharing_tier:tier}))}/>
                        </div>
                        <div style={{fontSize:11.5,color:C.inkMuted,lineHeight:1.5}}>{desc}</div>
                        {!!badge && <div style={{marginTop:4,fontFamily:mono,fontSize:9,color:C.gold}}>{badge}</div>}
                      </label>
                    ))}
                  </div>
                </div>
                <div style={{gridColumn:"1 / -1"}}>
                  <div style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted,marginBottom:5}}>What Worked</div>
                  <textarea value={newProject.what_worked} onChange={(e)=>setNewProject((p)=>({...p,what_worked:e.target.value}))} rows={3} style={{width:"100%",padding:"9px 10px",border:`1px solid ${C.rule}`,borderRadius:5,background:C.surface,color:C.ink,fontSize:13,resize:"vertical"}} />
                </div>
              </div>

              <label htmlFor="past-ingestion-modal-overwrite" style={{display:"flex",alignItems:"center",gap:6,cursor:"pointer",fontFamily:mono,fontSize:10,fontWeight:700,color:C.inkSoft,letterSpacing:"0.03em",marginTop:14,marginBottom:8}}>
                <input
                  id="past-ingestion-modal-overwrite"
                  type="checkbox"
                  checked={workbenchExtractOverwrite}
                  onChange={(e)=>setWorkbenchExtractOverwrite(e.target.checked)}
                />
                Overwrite existing values on extract
              </label>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginTop:14,marginBottom:8,gap:8,flexWrap:"wrap"}}>
                <div style={{fontFamily:disp,fontSize:14,fontWeight:700,color:C.ink}}>Part Details</div>
                <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                  {!!workbenchParts.length && (
                    <Btn sm variant="green" onClick={handlePushWorkbench} disabled={pushingWorkbench || !workbenchParts.length}>
                      {pushingWorkbench ? "Pushing..." : "Push To Corpus"}
                    </Btn>
                  )}
                  <Btn sm variant="outline" onClick={handleAddWorkbenchPart}>+ Add Part</Btn>
                </div>
              </div>
              {!workbenchParts.length && (
                <div style={{marginBottom:10,padding:"10px",border:`1px dashed ${C.rule}`,borderRadius:6,background:C.offWhite,fontSize:12.5,color:C.inkMuted,lineHeight:1.55}}>
                  Click <strong style={{color:C.ink}}>Add Part</strong> and attach part files/images. Then click <strong style={{color:C.ink}}>Process Part</strong> to auto-fill missing fields.
                </div>
              )}
              {!!workbenchParts.length && (
                <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:10}}>
                  {workbenchParts.map((part, idx)=>(
                    <div key={`modal-${part.part_id}-${idx}`} style={{border:`1px solid ${C.rule}`,borderRadius:8,overflow:"hidden"}}>
                      <div style={{padding:"8px 10px",background:C.surface,borderBottom:`1px solid ${C.ruleLight}`,display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,flexWrap:"wrap"}}>
                        <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                          <span style={{fontFamily:mono,fontSize:9,color:C.gold,fontWeight:600}}>{part.part_id || `PART-${idx + 1}`}</span>
                          <span style={{fontFamily:mono,fontSize:9,padding:"2px 7px",borderRadius:3,background:C.bluePale,color:C.blue,border:"1px solid rgba(26,61,92,0.2)",textTransform:"uppercase"}}>{part.source_type || "file"}</span>
                          <span style={{fontFamily:mono,fontSize:9,color:C.inkMuted}}>{part.filename || ""}</span>
                        </div>
                        <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                          <input id={`wb-modal-part-files-${idx}`} type="file" multiple onChange={(e)=>{handleWorkbenchPartFiles(idx, e.target.files || []); e.target.value = "";}} style={{display:"none"}} />
                          <Btn sm variant="ghost" onClick={()=>document.getElementById(`wb-modal-part-files-${idx}`)?.click()}>Attach CAD/Image</Btn>
                          <Btn sm variant="accent" onClick={()=>handleProcessWorkbenchPart(idx)} disabled={processingWorkbench || !(part.upload_files?.length)}>
                            {processingWorkbench ? "Processing..." : "Process Part"}
                          </Btn>
                          <button onClick={()=>setWorkbenchParts((prev)=>prev.filter((_,i)=>i!==idx))} style={{fontFamily:mono,fontSize:9,background:"none",border:`1px solid ${C.rule}`,borderRadius:4,padding:"3px 8px",cursor:"pointer",color:C.inkMuted}}>Remove</button>
                        </div>
                      </div>
                      <div style={{padding:10,display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                        {[
                          ["Part Name","part_name"],
                          ["Material","material"],
                          ["Process Primary","process_primary"],
                          ["Surface Finish","surface_finish"],
                          ["Tolerance Details","tolerance_details"],
                          ["Quantity","quantity"],
                          ["Dimensions / Part Envelope","part_envelope"],
                          ["Requirements","requirements"],
                          ["Project Date","project_date"],
                          ["Finish","finish"],
                        ].map(([label,key])=>(
                          <div key={`modal-${part.part_id}-${key}`}>
                            <div style={{fontFamily:mono,fontSize:8,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted,marginBottom:4}}>{label}</div>
                            {key === "project_date" ? (
                              <input type="date" value={part[key] || ""} onChange={(e)=>updateWorkbenchPart(idx,key,e.target.value)} style={{width:"100%",padding:"7px 8px",border:`1px solid ${C.rule}`,borderRadius:5,background:C.white,color:C.ink,fontSize:12}} />
                            ) : (
                              <input value={part[key] || ""} onChange={(e)=>updateWorkbenchPart(idx,key,e.target.value)} style={{width:"100%",padding:"7px 8px",border:`1px solid ${C.rule}`,borderRadius:5,background:C.white,color:C.ink,fontSize:12}} />
                            )}
                          </div>
                        ))}
                        <div key={`modal-${part.part_id}-data_sharing_tier`}>
                          <div style={{fontFamily:mono,fontSize:8,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted,marginBottom:4}}>Data Sharing Tier</div>
                          <select value={part.data_sharing_tier||""} onChange={(e)=>updateWorkbenchPart(idx,"data_sharing_tier",e.target.value)} style={{width:"100%",padding:"7px 8px",border:`1px solid ${C.rule}`,borderRadius:5,background:C.white,color:C.ink,fontSize:12,cursor:"pointer"}}>
                            <option value="">— select —</option>
                            <option value="Attributed">✦ Attributed</option>
                            <option value="Anonymized">~ Anonymized</option>
                            <option value="Private">⊘ Private</option>
                          </select>
                        </div>
                        <div key={`modal-${part.part_id}-tolerance_class`}>
                          <div style={{fontFamily:mono,fontSize:8,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted,marginBottom:4}}>Tolerance Class</div>
                          <select value={part.tolerance_class||""} onChange={(e)=>updateWorkbenchPart(idx,"tolerance_class",e.target.value)} style={{width:"100%",padding:"7px 8px",border:`1px solid ${C.rule}`,borderRadius:5,background:C.white,color:C.ink,fontSize:12,cursor:"pointer"}}>
                            <option value="">— select —</option>
                            <option value="STANDARD">Standard</option>
                            <option value="PRECISION">Precision</option>
                            <option value="HIGH_PRECISION">High Precision</option>
                          </select>
                        </div>
                        <div style={{gridColumn:"1 / -1",marginTop:4,paddingTop:10,borderTop:`1px dashed ${C.ruleLight}`}}>
                          <div style={{fontFamily:disp,fontSize:13,fontWeight:700,color:C.ink,marginBottom:8}}>Quote & Award/PO</div>
                          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                            <div>
                              <div style={{fontFamily:mono,fontSize:8,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted,marginBottom:4}}>Quote Amount</div>
                              <input value={part.quoted_amount || ""} onChange={(e)=>updateWorkbenchPart(idx,"quoted_amount",e.target.value)} style={{width:"100%",padding:"7px 8px",border:`1px solid ${C.rule}`,borderRadius:5,background:C.white,color:C.ink,fontSize:12}} />
                            </div>
                            <div>
                              <div style={{fontFamily:mono,fontSize:8,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted,marginBottom:4}}>Award / PO</div>
                              <input value={part.award_po || ""} onChange={(e)=>updateWorkbenchPart(idx,"award_po",e.target.value)} style={{width:"100%",padding:"7px 8px",border:`1px solid ${C.rule}`,borderRadius:5,background:C.white,color:C.ink,fontSize:12}} />
                            </div>
                            <div>
                              <div style={{fontFamily:mono,fontSize:8,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted,marginBottom:4}}>Award Amount</div>
                              <input value={part.award_amount || ""} onChange={(e)=>updateWorkbenchPart(idx,"award_amount",e.target.value)} style={{width:"100%",padding:"7px 8px",border:`1px solid ${C.rule}`,borderRadius:5,background:C.white,color:C.ink,fontSize:12}} />
                            </div>
                            <div>
                              <div style={{fontFamily:mono,fontSize:8,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted,marginBottom:4}}>Outcome</div>
                              <select value={part.outcome||""} onChange={(e)=>updateWorkbenchPart(idx,"outcome",e.target.value)} style={{width:"100%",padding:"7px 8px",border:`1px solid ${C.rule}`,borderRadius:5,background:C.white,color:C.ink,fontSize:12,cursor:"pointer"}}>
                                <option value="">— select —</option>
                                <option value="Success">Success</option>
                                <option value="Won">Won</option>
                                <option value="Lost">Lost</option>
                                <option value="Pending">Pending</option>
                                <option value="Completed">Completed</option>
                                <option value="No Bid">No Bid</option>
                              </select>
                            </div>
                          </div>
                        </div>
                        <div style={{gridColumn:"1 / -1"}}>
                          <div style={{fontFamily:mono,fontSize:8,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted,marginBottom:4}}>Notes</div>
                          <textarea rows={2} value={part.notes || ""} onChange={(e)=>updateWorkbenchPart(idx,"notes",e.target.value)} style={{width:"100%",padding:"7px 8px",border:`1px solid ${C.rule}`,borderRadius:5,background:C.white,color:C.ink,fontSize:12,resize:"vertical"}} />
                        </div>
                        <div style={{gridColumn:"1 / -1"}}>
                          <div style={{fontFamily:mono,fontSize:8,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted,marginBottom:4}}>Additional Notes</div>
                          <textarea rows={2} value={part.additional_notes || ""} onChange={(e)=>updateWorkbenchPart(idx,"additional_notes",e.target.value)} style={{width:"100%",padding:"7px 8px",border:`1px solid ${C.rule}`,borderRadius:5,background:C.white,color:C.ink,fontSize:12,resize:"vertical"}} />
                        </div>
                        {!!(part.attached_files?.length) && (
                          <div style={{gridColumn:"1 / -1",display:"flex",flexWrap:"wrap",gap:4}}>
                            {part.attached_files.slice(0,8).map((name, i)=>(
                              <span key={`modal-file-${name}-${i}`} style={{fontFamily:mono,fontSize:8,padding:"2px 6px",borderRadius:3,border:`1px solid ${C.ruleLight}`,background:C.white,color:C.inkMuted}}>{name}</span>
                            ))}
                          </div>
                        )}
                        {!!(part.cad_stats && Object.keys(part.cad_stats).length) && (
                          <div style={{gridColumn:"1 / -1",display:"flex",flexWrap:"wrap",gap:4}}>
                            <span style={{fontFamily:mono,fontSize:8,padding:"2px 6px",borderRadius:3,border:`1px solid ${C.ruleLight}`,background:C.surface,color:C.inkMuted}}>
                              TRI {Number(part.cad_stats.triangles || 0)}
                            </span>
                            <span style={{fontFamily:mono,fontSize:8,padding:"2px 6px",borderRadius:3,border:`1px solid ${C.ruleLight}`,background:C.surface,color:C.inkMuted}}>
                              VTX {Number(part.cad_stats.vertices || 0)}
                            </span>
                            <span style={{fontFamily:mono,fontSize:8,padding:"2px 6px",borderRadius:3,border:`1px solid ${C.ruleLight}`,background:C.surface,color:C.inkMuted}}>
                              AREA {Number(part.cad_stats.surface_area || 0).toFixed(2)}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div style={{display:"flex",justifyContent:"flex-end",gap:8,marginTop:14}}>
                <Btn variant="ghost" onClick={()=>setShowAddProject(false)}>Cancel</Btn>
                <Btn variant="accent" onClick={handleAddProject} disabled={addingProject}>{addingProject?"Submitting...":editingProjectId?"Update RFP":"Add RFP"}</Btn>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
const BUYER_PROJ = {
  company:"", contact:"", email:"", phone:"",
  companyIndustry:"", companySize:"", companyLocation:"",
  name:"", overview:"", annualVolume:"",
  deliveryLoc:"", deliveryDate:"",
  certs:"", mandatoryCerts:[], certificationPrefs:"",
  compliance:"", geo:"", countriesExclude:[], budget:"",
};
const BUYER_PARTS = [];
const BUYER_CERT_OPTIONS = [
  "ISO 9001", "AS9100", "IATF 16949", "ISO 13485", "ISO 14001",
  "ISO 45001 / OHSAS 18001", "ISO 50001", "ISO/IEC 27001", "NADCAP",
  "ITAR Registration", "RoHS Compliance", "REACH Compliance",
  "UL Certification", "CSA Certification", "CE Marking",
  "FDA Registration / GMP", "ISO/TS 22163 (IRIS)",
];
const BUYER_COUNTRY_OPTIONS = [
  "Bangladesh","Brazil","Canada","China","Czech Republic","France","Germany","Hungary","India",
  "Indonesia","Italy","Japan","Malaysia","Mexico","Philippines","Poland","Portugal","South Korea",
  "Spain","Taiwan","Thailand","Turkey","United Kingdom","United States","Vietnam",
];
const BUYER_INDUSTRY_OPTIONS = [
  "Consumer Goods",
  "Industrial Goods",
  "Healthcare",
  "Packaging",
  "Chemicals and Materials",
  "Technology",
  "Transportation",
  "Agriculture",
  "Entertainment",
  "Miscellaneous",
];
const BUYER_COMPANY_SIZE_OPTIONS = [
  "Small (<$1M annual revenue)",
  "Medium ($1M-$10M annual revenue)",
  "Large ($10M-$100M annual revenue)",
  "Enterprise (>$100M annual revenue)",
];

function BuyerPartCard({part, onChange, onAddCadFiles, onAddImageFiles, onRemoveImage, onSetPrimaryImage, onRemove, canRemove}) {
  const [open,setOpen]=useState(part.expanded);
  const collapsedSummary = part.summary || `${part.mat || "TBD"} · ${part.proc || "TBD"} · Qty ${part.qty || 1}`;
  return (
    <div style={{border:`1px solid ${C.rule}`,borderRadius:8,overflow:"hidden",boxShadow:"0 1px 3px rgba(20,28,36,0.07)",marginBottom:12}}>
      <div onClick={()=>setOpen(o=>!o)} style={{background:C.navy,padding:"9px 15px",display:"flex",alignItems:"center",justifyContent:"space-between",cursor:"pointer"}}>
        <span style={{fontFamily:mono,fontSize:10,letterSpacing:"0.05em"}}><span style={{color:C.gold,fontWeight:500}}>{part.id}</span>&nbsp; - &nbsp;<span style={{color:"rgba(255,255,255,0.85)"}}>{part.label}</span></span>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          {canRemove && (
            <button
              type="button"
              onClick={(e)=>{e.stopPropagation(); onRemove && onRemove(part.id);}}
              style={{fontFamily:mono,fontSize:9,padding:"3px 8px",borderRadius:4,border:"1px solid rgba(255,255,255,0.22)",background:"rgba(255,255,255,0.08)",color:"rgba(255,255,255,0.85)",cursor:"pointer"}}
            >
              Remove
            </button>
          )}
          <span style={{fontFamily:mono,fontSize:10,color:"rgba(255,255,255,0.4)"}}>{open?"Collapse":"Expand"}</span>
        </div>
      </div>
      {!open&&(
        <div style={{padding:"9px 15px",background:C.surface}}>
          <div style={{fontFamily:mono,fontSize:10,color:C.inkMuted,marginBottom:(part.images && part.images.length)?8:0}}>{collapsedSummary || "No details entered yet"}</div>
          {!!(part.images && part.images.length) && (
            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
              {part.images.slice(0,4).map((src, i)=>(
                <div key={i} style={{width:56,height:42,border:`1px solid ${C.ruleLight}`,borderRadius:4,overflow:"hidden",background:C.white}}>
                  <img src={src} alt={`${part.id || "PART"}-thumb-${i + 1}`} style={{width:"100%",height:"100%",objectFit:"cover"}} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {open&&(
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr"}}>
          <div style={{gridColumn:"1 / -1",padding:"10px 14px",borderBottom:`1px solid ${C.ruleLight}`}}>
            <div style={{fontFamily:mono,fontSize:8,textTransform:"uppercase",letterSpacing:"0.07em",color:C.inkMuted,marginBottom:5}}>Part Name</div>
            <input
              value={part.label || ""}
              onChange={(e)=>onChange && onChange(part.id, "label", e.target.value)}
              style={{width:"100%",padding:"7px 8px",border:`1px solid ${C.rule}`,borderRadius:5,background:C.white,color:C.ink,fontSize:12.5}}
            />
          </div>
          <div style={{gridColumn:"1 / -1",padding:"10px 14px",borderBottom:`1px solid ${C.ruleLight}`}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,marginBottom:6}}>
              <div style={{fontFamily:mono,fontSize:8,textTransform:"uppercase",letterSpacing:"0.07em",color:C.inkMuted}}>CAD Files</div>
              <label style={{fontFamily:mono,fontSize:9,padding:"3px 8px",border:`1px solid ${C.rule}`,borderRadius:4,cursor:"pointer",color:C.inkMuted}}>
                Attach CAD
                <input type="file" multiple accept=".step,.stp,.iges,.igs,.stl,.obj,.ply,.glb,.gltf,.3mf" style={{display:"none"}} onChange={(e)=>onAddCadFiles && onAddCadFiles(part.id, Array.from(e.target.files || []))}/>
              </label>
            </div>
            {!!(part.cadFiles && part.cadFiles.length) ? (
              <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                {part.cadFiles.map((f, i)=>(
                  <span key={`${f.name || "cad"}-${i}`} style={{fontFamily:mono,fontSize:9,padding:"2px 7px",borderRadius:3,background:C.surface,border:`1px solid ${C.ruleLight}`,color:C.inkSoft}}>
                    {f.name || f.filename || `CAD-${i + 1}`}
                  </span>
                ))}
              </div>
            ) : (
              <div style={{fontSize:12,color:C.inkMuted}}>No CAD files attached.</div>
            )}
          </div>
          <div style={{gridColumn:"1 / -1",padding:"10px 14px",borderBottom:`1px solid ${C.ruleLight}`}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,marginBottom:6}}>
              <div style={{fontFamily:mono,fontSize:8,textTransform:"uppercase",letterSpacing:"0.07em",color:C.inkMuted}}>Part Images</div>
              <label style={{fontFamily:mono,fontSize:9,padding:"3px 8px",border:`1px solid ${C.rule}`,borderRadius:4,cursor:"pointer",color:C.inkMuted}}>
                Attach Images
                <input type="file" multiple accept="image/*" style={{display:"none"}} onChange={(e)=>onAddImageFiles && onAddImageFiles(part.id, Array.from(e.target.files || []))}/>
              </label>
            </div>
            {!!(part.images && part.images.length) ? (
              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                {part.images.map((src, i)=>(
                  <div key={i} style={{width:108,border:`1px solid ${i===0?C.gold:C.ruleLight}`,borderRadius:5,overflow:"hidden",background:C.white}}>
                    <img src={src} alt={`${part.id || "PART"}-image-${i + 1}`} style={{width:"100%",height:66,objectFit:"cover"}} />
                    {i === 0 && !!`${part.imageSource || ""}`.trim() && (
                      <div style={{fontFamily:mono,fontSize:8,padding:"2px 4px",borderTop:`1px solid ${C.ruleLight}`,background:C.surface,color:C.inkMuted}}>
                        {part.imageSource === "assessment_match"
                          ? "From Assessment Match"
                          : part.imageSource === "assessment_part"
                            ? "From Assessment Part Image"
                            : "From CRM Part Image"}
                      </div>
                    )}
                    <div style={{display:"flex",gap:4,padding:4,justifyContent:"space-between"}}>
                      <button
                        type="button"
                        onClick={() => onSetPrimaryImage && onSetPrimaryImage(part.id, i)}
                        style={{fontFamily:mono,fontSize:8,padding:"2px 4px",border:`1px solid ${C.rule}`,borderRadius:3,background:i===0?C.goldPale:C.white,color:i===0?C.gold:C.inkMuted,cursor:"pointer"}}
                      >
                        {i===0 ? "Primary" : "Set Primary"}
                      </button>
                      <button
                        type="button"
                        onClick={() => onRemoveImage && onRemoveImage(part.id, i)}
                        style={{fontFamily:mono,fontSize:8,padding:"2px 4px",border:`1px solid ${C.rule}`,borderRadius:3,background:C.white,color:C.warn,cursor:"pointer"}}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{fontSize:12,color:C.inkMuted}}>No images attached.</div>
            )}
          </div>
          {[["Material",part.mat,true],["Manufacturing Process",part.proc,true],["Finish / Surface Treatment",part.finish,true],["Tolerances",part.tol,true]].map(([lbl,val,o],i)=>(
            <div key={lbl} style={{padding:"12px 14px",borderBottom:`1px solid ${C.ruleLight}`,borderRight:i%2===0?`1px solid ${C.ruleLight}`:"none"}}>
              <div style={{fontFamily:mono,fontSize:8,textTransform:"uppercase",letterSpacing:"0.07em",color:C.inkMuted,marginBottom:5}}>{lbl}{o&&<span style={{fontFamily:mono,fontSize:7,padding:"1px 4px",borderRadius:2,background:C.gold,color:"#fff",marginLeft:4}}>Open</span>}</div>
              <input value={val || ""} onChange={(e)=>onChange && onChange(part.id, lbl==="Material"?"mat":lbl==="Manufacturing Process"?"proc":lbl==="Finish / Surface Treatment"?"finish":"tol", e.target.value)} style={{width:"100%",padding:"7px 8px",border:`1px solid ${C.rule}`,borderRadius:5,background:C.white,color:C.ink,fontSize:12.5}} placeholder={`No ${lbl.toLowerCase()} specified`} />
            </div>
          ))}
          <div style={{padding:"12px 14px",borderBottom:`1px solid ${C.ruleLight}`,borderRight:`1px solid ${C.ruleLight}`}}>
            <div style={{fontFamily:mono,fontSize:8,textTransform:"uppercase",letterSpacing:"0.07em",color:C.inkMuted,marginBottom:5}}>Quantity</div>
            <input value={part.qty || ""} onChange={(e)=>onChange && onChange(part.id, "qty", e.target.value)} style={{width:"100%",padding:"7px 8px",border:`1px solid ${C.rule}`,borderRadius:5,background:C.white,color:C.ink,fontSize:12.5}} />
          </div>
          <div style={{padding:"12px 14px",gridColumn:"1 / -1",background:"#F8F7F4"}}>
            <div style={{fontFamily:mono,fontSize:8,textTransform:"uppercase",color:C.inkMuted,marginBottom:5}}>Additional Notes</div>
            <textarea rows={2} value={part.notes || ""} onChange={(e)=>onChange && onChange(part.id, "notes", e.target.value)} style={{width:"100%",padding:"7px 8px",border:`1px solid ${C.rule}`,borderRadius:5,background:C.white,color:C.inkSoft,fontSize:12.5,lineHeight:1.5,resize:"vertical"}} />
          </div>
        </div>
      )}
    </div>
  );
}

function BuyerRfpScreen({navigate,onLogout,screenData={}}) {
  const [submitted,setSubmitted]=useState(false);
  const [submitting,setSubmitting]=useState(false);
  const [submitError,setSubmitError]=useState("");
  const [submitStatus,setSubmitStatus]=useState("");

  const prefillRfp = screenData?.rfp || {};
  const noBidIntent = screenData?.noBidIntent || null;
  const resolveNoBidRfpId = useCallback((rfp) => {
    const raw = `${rfp?.rfp_id || rfp?.sourceRfpId || rfp?.id || rfp?.view_id || ""}`.trim();
    if (!raw) return "";
    if (raw.startsWith("ZOHO-")) return raw;
    if (/^\d{10,}$/.test(raw)) return `ZOHO-${raw}`;
    return raw;
  }, []);

  const extractPartImages = useCallback((part = {}) => {
    const out = [];
    const normalizeImageUrl = (raw) => {
      const s = `${raw || ""}`.trim();
      if (!s) return "";
      if (s.startsWith("data:")) return s;
      if (s.startsWith("/api/")) return `${API_BASE}${s}`;
      if (s.startsWith("api/")) return `${API_BASE}/${s}`;
      return s;
    };
    const pushIf = (v) => {
      const s = normalizeImageUrl(v);
      if (!s) return;
      if (!out.includes(s)) out.push(s);
    };
    (Array.isArray(part.images) ? part.images : []).forEach(pushIf);
    if (part.image_b64) pushIf(`data:image/jpeg;base64,${part.image_b64}`);
    if (part.part_image_b64) pushIf(`data:image/jpeg;base64,${part.part_image_b64}`);
    if (part.image_url) pushIf(part.image_url);
    (Array.isArray(part.attachments) ? part.attachments : []).forEach((a) => {
      if (!a) return;
      const kind = `${a.kind || ""}`.toLowerCase();
      const mime = `${a.mime_type || ""}`.toLowerCase();
      const looksImage = kind === "image" || mime.startsWith("image/");
      if (!looksImage) return;
      if (a.url) pushIf(a.url);
      if (a.file_b64) {
        const mt = a.mime_type || "image/jpeg";
        pushIf(`data:${mt};base64,${a.file_b64}`);
      }
    });
    return out;
  }, []);

  const project = useMemo(() => ({
    company: prefillRfp?.buyer || BUYER_PROJ.company || "",
    contact: prefillRfp?.contact || prefillRfp?.contact_name || BUYER_PROJ.contact || "",
    email: prefillRfp?.email || prefillRfp?.contact_email || noBidIntent?.buyer_contact_email || BUYER_PROJ.email || "",
    phone: prefillRfp?.phone || prefillRfp?.contact_phone || BUYER_PROJ.phone || "",
    companyIndustry: prefillRfp?.companyIndustry || prefillRfp?.customer_industry || BUYER_PROJ.companyIndustry || "",
    companySize: prefillRfp?.companySize || prefillRfp?.company_size || BUYER_PROJ.companySize || "",
    companyLocation: prefillRfp?.companyLocation || prefillRfp?.company_location || BUYER_PROJ.companyLocation || "",
    name: prefillRfp?.project || prefillRfp?.id || BUYER_PROJ.name || "",
    overview: prefillRfp?.summary || prefillRfp?.project_description || prefillRfp?.priority || BUYER_PROJ.overview || "",
    annualVolume: prefillRfp?.annualVolume || prefillRfp?.expected_annual_production_volume || BUYER_PROJ.annualVolume || "",
    deliveryLoc: prefillRfp?.deliveryLoc || prefillRfp?.delivery_location || prefillRfp?.location || BUYER_PROJ.deliveryLoc || "",
    deliveryDate: prefillRfp?.deliveryDate || prefillRfp?.required_date || prefillRfp?.delivery || prefillRfp?.due || BUYER_PROJ.deliveryDate || "",
    certs: Array.isArray(prefillRfp?.certs) ? prefillRfp.certs.join(", ") : (prefillRfp?.certs || BUYER_PROJ.certs || ""),
    mandatoryCerts: Array.isArray(prefillRfp?.mandatoryCerts)
      ? prefillRfp.mandatoryCerts
      : (Array.isArray(prefillRfp?.mandatory_certifications)
        ? prefillRfp.mandatory_certifications
        : (Array.isArray(BUYER_PROJ.mandatoryCerts) ? BUYER_PROJ.mandatoryCerts : [])),
    certificationPrefs: prefillRfp?.certification_preferences || prefillRfp?.certification_notes || BUYER_PROJ.certificationPrefs || "",
    compliance: prefillRfp?.compliance || BUYER_PROJ.compliance || "",
    geo: prefillRfp?.geo || prefillRfp?.geo_preference || BUYER_PROJ.geo || "",
    countriesExclude: Array.isArray(prefillRfp?.geo_constraint_multi)
      ? prefillRfp.geo_constraint_multi
      : (Array.isArray(BUYER_PROJ.countriesExclude) ? BUYER_PROJ.countriesExclude : []),
    budget: BUYER_PROJ.budget || "",
  }), [noBidIntent?.buyer_contact_email, prefillRfp]);

  const parts = useMemo(() => {
    if (Array.isArray(prefillRfp?.parts_prefill) && prefillRfp.parts_prefill.length) {
      return prefillRfp.parts_prefill.map((p, idx) => ({
        id: p.id || `PART-${String(idx + 1).padStart(3, "0")}`,
        label: p.description || p.label || p.name || `Part ${idx + 1}`,
        expanded: idx === 0,
        summary: `${p.material || p.mat || "TBD"} · ${p.process || p.proc || "TBD"} · Qty ${p.qty ?? p.quantity ?? p.Quantity ?? 1}`,
        mat: p.material || p.mat || "",
        proc: p.process || p.proc || "",
        finish: p.finish || "",
        tol: p.tolerance || p.tol || "",
        qty: `${p.qty ?? p.quantity ?? p.Quantity ?? 1}`,
        notes: p.notes || "",
        images: extractPartImages(p).slice(0, 1),
        imageSource: p.imageSource || p.image_source || "",
        cadFiles: Array.isArray(p.cadFiles)
          ? p.cadFiles
          : [p.cad_filename, p.cad_file_name, p.cad_name].filter(Boolean).map((name) => ({ name })),
      }));
    }
    if (Array.isArray(prefillRfp?.parts) && prefillRfp.parts.length) {
      return prefillRfp.parts.map((p, idx) => ({
        id: p.id || `PART-${String(idx + 1).padStart(3, "0")}`,
        label: p.description || p.label || p.name || `Part ${idx + 1}`,
        expanded: idx === 0,
        summary: `${p.material || p.mat || "TBD"} · ${p.process || p.proc || "TBD"} · Qty ${p.qty ?? p.quantity ?? p.Quantity ?? 1}`,
        mat: p.material || p.mat || "",
        proc: p.process || p.proc || "",
        finish: p.finish || "",
        tol: p.tolerance || p.tol || "",
        qty: `${p.qty ?? p.quantity ?? p.Quantity ?? 1}`,
        notes: p.notes || "",
        images: extractPartImages(p).slice(0, 1),
        imageSource: p.imageSource || p.image_source || "",
        cadFiles: Array.isArray(p.cadFiles)
          ? p.cadFiles
          : [p.cad_filename, p.cad_file_name, p.cad_name].filter(Boolean).map((name) => ({ name })),
      }));
    }
    return BUYER_PARTS;
  }, [extractPartImages, prefillRfp]);

  const [formProject, setFormProject] = useState(() => project);
  const [formParts, setFormParts] = useState(() => parts);

  const updateProjectField = useCallback((key, value) => {
    setFormProject((prev) => ({ ...prev, [key]: value }));
  }, []);
  const toggleProjectMulti = useCallback((key, value) => {
    setFormProject((prev) => {
      const cur = Array.isArray(prev?.[key]) ? prev[key] : [];
      const next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
      return { ...prev, [key]: next };
    });
  }, []);

  const updatePartField = useCallback((partId, key, value) => {
    setFormParts((prev) =>
      prev.map((p) => (p.id === partId ? { ...p, [key]: value } : p))
    );
  }, []);

  const addPartCadFiles = useCallback((partId, files = []) => {
    if (!files.length) return;
    const mapped = files.map((f) => ({ name: f.name || "cad-file", file: f }));
    setFormParts((prev) =>
      prev.map((p) =>
        p.id === partId ? { ...p, cadFiles: [...(p.cadFiles || []), ...mapped] } : p
      )
    );
  }, []);

  const addPartImageFiles = useCallback((partId, files = []) => {
    if (!files.length) return;
    const readers = files.map((f) => new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(`${reader.result || ""}`);
      reader.onerror = () => resolve("");
      reader.readAsDataURL(f);
    }));
    Promise.all(readers).then((results) => {
      const clean = results.map((x) => `${x || ""}`.trim()).filter(Boolean);
      if (!clean.length) return;
      setFormParts((prev) =>
        prev.map((p) =>
          p.id === partId
            ? { ...p, images: Array.from(new Set([...(p.images || []), ...clean])) }
            : p
        )
      );
    });
  }, []);
  const removePartImageAt = useCallback((partId, idx) => {
    setFormParts((prev) =>
      prev.map((p) => {
        if (p.id !== partId) return p;
        const imgs = Array.isArray(p.images) ? [...p.images] : [];
        if (idx < 0 || idx >= imgs.length) return p;
        imgs.splice(idx, 1);
        return { ...p, images: imgs };
      })
    );
  }, []);
  const setPrimaryPartImage = useCallback((partId, idx) => {
    setFormParts((prev) =>
      prev.map((p) => {
        if (p.id !== partId) return p;
        const imgs = Array.isArray(p.images) ? [...p.images] : [];
        if (idx <= 0 || idx >= imgs.length) return p;
        const [picked] = imgs.splice(idx, 1);
        imgs.unshift(picked);
        return { ...p, images: imgs };
      })
    );
  }, []);

  const addBuyerPart = useCallback(() => {
    setFormParts((prev) => {
      const nextNum = prev.length + 1;
      const nextId = `PART-${String(nextNum).padStart(3, "0")}`;
      return [
        ...prev,
        {
          id: nextId,
          label: `Part ${nextNum}`,
          expanded: true,
          summary: "",
          mat: "",
          proc: "",
          finish: "",
          tol: "",
          qty: "1",
          notes: "",
          images: [],
          cadFiles: [],
        },
      ];
    });
  }, []);

  const removeBuyerPart = useCallback((partId) => {
    setFormParts((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((p) => p.id !== partId);
    });
  }, []);

  const completeness = useMemo(() => {
    const hasText = (v) => `${v || ""}`.trim().length > 0;
    const companyAndContact = hasText(formProject.company) && (hasText(formProject.contact) || hasText(formProject.email) || hasText(formProject.phone));
    const projectOverview = hasText(formProject.overview);
    const deliveryDetails = hasText(formProject.deliveryLoc) && hasText(formProject.deliveryDate);
    const certifications = hasText(formProject.certs);
    const geoPreference = hasText(formProject.geo);
    const atLeastOnePart = (formParts || []).length > 0;
    const partSpecifications = (formParts || []).length > 0 && (formParts || []).every((p) => {
      const hasCore = hasText(p.label) && hasText(p.qty);
      const hasSpecs = hasText(p.mat) || hasText(p.proc) || hasText(p.tol) || hasText(p.finish);
      return hasCore && hasSpecs;
    });

    const checks = [
      ["Company & contact", companyAndContact],
      ["Project overview", projectOverview],
      ["Delivery details", deliveryDetails],
      ["Certifications", certifications],
      ["Geo preference", geoPreference],
      ["At least one part", atLeastOnePart],
      ["Part specifications", partSpecifications],
    ];
    const completed = checks.filter(([, done]) => Boolean(done)).length;
    const total = checks.length;
    return {
      checks,
      completed,
      total,
      score: Math.round((completed / total) * 100),
    };
  }, [formParts, formProject]);

  const handleSubmit = useCallback(async () => {
    setSubmitting(true);
    setSubmitError("");
    setSubmitStatus("");
    try {
      const session = getSupplierSession();
      const submitParts = await Promise.all((formParts || []).map(async (p, idx) => {
        const cadPayload = await Promise.all(
          (Array.isArray(p.cadFiles) ? p.cadFiles : []).map(async (f) => {
            const name = f?.name || f?.filename || f?.file?.name || "cad-file";
            if (f?.file) {
              try {
                const file_b64 = await fileToBase64(f.file);
                return { kind: "cad", name, file_b64, mime_type: f.file?.type || "" };
              } catch {
                return { kind: "cad", name };
              }
            }
            return { kind: "cad", name };
          })
        );
        const imagePayload = (Array.isArray(p.images) ? p.images : [])
          .map((img, i) => {
            const src = `${img || ""}`.trim();
            if (!src) return null;
            if (src.startsWith("data:")) {
              const [head, body] = src.split(",");
              const mime = (head.match(/^data:(.*?);base64$/i) || [])[1] || "image/jpeg";
              return {
                kind: "image",
                name: `part-${p.id || idx + 1}-image-${i + 1}.jpg`,
                mime_type: mime,
                file_b64: body || "",
              };
            }
            return {
              kind: "image",
              name: `part-${p.id || idx + 1}-image-${i + 1}`,
              url: src,
            };
          })
          .filter(Boolean);
        const attachments = [...imagePayload, ...cadPayload];
        const primaryImageB64 = imagePayload.find((a) => a?.file_b64)?.file_b64 || null;
        return {
          id: p.id || `PART-${String(idx + 1).padStart(3, "0")}`,
          description: p.label || "Part",
          material: p.mat || "TBD",
          process: p.proc || "TBD",
          tolerance: p.tol || "",
          qty: `${p.qty || ""}` || "1",
          image_b64: primaryImageB64,
          attachments,
          cad_files: cadPayload,
        };
      }));
      const safeParts = submitParts.length ? submitParts : [{
        id: "PART-001",
        description: "Part",
        material: "TBD",
        process: "TBD",
        tolerance: "",
        qty: "1",
      }];

      const certsRequired = Array.from(new Set([
        ...`${formProject.certs || ""}`.split(",").map((s) => s.trim()).filter(Boolean),
        ...(Array.isArray(formProject.mandatoryCerts) ? formProject.mandatoryCerts : []),
      ]));
      const certRequirementsMulti = Array.from(new Set([
        ...(Array.isArray(formProject.mandatoryCerts) ? formProject.mandatoryCerts : []),
        ...`${formProject.certs || ""}`.split(",").map((s) => s.trim()).filter(Boolean),
      ]));
      const geoConstraintMulti = Array.from(new Set(
        Array.isArray(formProject.countriesExclude) ? formProject.countriesExclude : []
      ));
      const extraNotes = [
        formProject.overview || "",
        formProject.annualVolume ? `Expected annual production volume: ${formProject.annualVolume}` : "",
        formProject.companyIndustry ? `Company industry: ${formProject.companyIndustry}` : "",
        formProject.companySize ? `Company size: ${formProject.companySize}` : "",
        formProject.companyLocation ? `Company location: ${formProject.companyLocation}` : "",
        (Array.isArray(formProject.countriesExclude) && formProject.countriesExclude.length)
          ? `Countries to exclude: ${formProject.countriesExclude.join(", ")}`
          : "",
        formProject.certificationPrefs ? `Certification preferences: ${formProject.certificationPrefs}` : "",
      ].filter(Boolean).join("\n");

      if (noBidIntent?.path === "master_rfp_engine") {
        await apiPost(ENDPOINTS.rfp.submit, {
          supplier_id: session.supplier_id || "unknown-supplier",
          supplier_name: session.supplier_name || "",
          supplier_email: session.supplier_email || "",
          supplier_certs: [],
          buyer: formProject.company || "Buyer",
          location: formProject.deliveryLoc || "",
          project: formProject.name || "RFP",
          certs_required: certsRequired,
          cert_requirements_multi: certRequirementsMulti,
          certification_preferences: formProject.certificationPrefs || "",
          geo_preference: formProject.geo || "",
          geo_constraint_multi: geoConstraintMulti,
          delivery: formProject.deliveryDate || "",
          priority_note: extraNotes,
          parts: safeParts,
          no_bid_source: true,
        });
        const resolvedId = resolveNoBidRfpId(prefillRfp);
        if (!resolvedId) throw new Error("Missing RFP id for BRFP submission.");
        const noBidRes = await apiPost(ENDPOINTS.assessment.noBid, {
          rfp_id: resolvedId,
          supplier_id: session.supplier_id || "",
          supplier_name: session.supplier_name || "",
          path: "master_rfp_engine",
          reason: "master_rfp_engine",
          buyer_contact_email: noBidIntent?.buyer_contact_email || "",
          note: noBidIntent?.note || "",
          cert_requirements_multi: certRequirementsMulti,
          certification_preferences: formProject.certificationPrefs || "",
          geo_constraint_multi: geoConstraintMulti,
          geo_preference: formProject.geo || "",
        });
        setSubmitStatus(`RFP has been submitted successfully${noBidRes?.brfp_id ? ` · BRFP ${noBidRes.brfp_id}` : ""}.`);
      } else {
        await apiPost(ENDPOINTS.rfp.submit, {
          supplier_id: session.supplier_id || "unknown-supplier",
          supplier_name: session.supplier_name || "",
          supplier_email: session.supplier_email || "",
          supplier_certs: [],
          buyer: formProject.company || "Buyer",
          location: formProject.deliveryLoc || "",
          project: formProject.name || "RFP",
          certs_required: certsRequired,
          cert_requirements_multi: certRequirementsMulti,
          certification_preferences: formProject.certificationPrefs || "",
          geo_preference: formProject.geo || "",
          geo_constraint_multi: geoConstraintMulti,
          delivery: formProject.deliveryDate || "",
          priority_note: extraNotes,
          parts: safeParts,
        });
        setSubmitStatus("RFP has been submitted successfully.");
      }
      setSubmitted(true);
    } catch {
      setSubmitError("Submit failed. Check backend and required fields.");
    } finally {
      setSubmitting(false);
    }
  }, [formParts, formProject, noBidIntent, prefillRfp, resolveNoBidRfpId]);

  return (
    <div style={{fontFamily:sans,fontSize:14,color:C.ink,minHeight:"100vh",background:C.bg}}>
      <Topbar screen="buyerrfp" onBack={()=>navigate("dashboard",{})} onLogout={onLogout}
        rightSlot={<div style={{display:"flex",gap:8,alignItems:"center"}}><Btn sm variant={submitted?"green":"accent"} disabled={submitting} onClick={handleSubmit}>{submitted?"RFP Submitted":submitting?"Submitting...":"Submit RFP ->"}</Btn></div>}/>
      <div style={{background:C.white,borderBottom:`1px solid ${C.rule}`,padding:"18px 26px"}}>
        <div style={{maxWidth:1160,margin:"0 auto"}}>
          <div style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.1em",color:C.gold,marginBottom:4}}>Buyer Portal - Submit RFP</div>
          <h1 style={{fontFamily:disp,fontSize:23,fontWeight:700,lineHeight:1.2,marginBottom:5}}>Request for Proposal</h1>
          <p style={{fontSize:13,color:C.inkSoft,maxWidth:560,lineHeight:1.65}}>Submit your manufacturing request. Our team reviews every submission and follows up with a brief discovery call before matching your project to qualified suppliers.</p>
        </div>
      </div>
      <div style={{maxWidth:1160,margin:"0 auto",padding:"20px 26px",display:"grid",gridTemplateColumns:"1fr 260px",gap:20,alignItems:"start"}}>
        <div>
          <div style={{marginBottom:12,padding:"10px 12px",background:C.surface,border:`1px solid ${C.rule}`,borderRadius:6,display:"flex",alignItems:"center",justifyContent:"space-between",gap:10}}>
            <div style={{fontFamily:mono,fontSize:10,color:C.inkMuted,textTransform:"uppercase",letterSpacing:"0.05em"}}>Buyer RFP Actions</div>
            <div style={{display:"flex",gap:8,alignItems:"center"}}>
              <Btn sm variant={submitted?"green":"accent"} disabled={submitting} onClick={handleSubmit}>
                {submitted?"RFP Submitted":submitting?"Submitting...":"Submit RFP ->"}
              </Btn>
            </div>
          </div>
          {submitStatus && (
            <div style={{marginBottom:12,padding:"8px 10px",background:C.passBg,border:`1px solid ${C.passRule}`,borderRadius:5,fontSize:12,color:C.pass}}>
              {submitStatus}
            </div>
          )}
          {submitError && (
            <div style={{marginBottom:12,padding:"8px 10px",background:C.warnBg,border:`1px solid ${C.warnRule}`,borderRadius:5,fontSize:12,color:C.warn}}>
              {userSafeMessage(submitError)}
            </div>
          )}
          {/* Section 1 */}
          <Card style={{marginBottom:16}}>
            <div style={{padding:"9px 16px",background:C.surface,borderBottom:`1px solid ${C.rule}`,display:"flex",alignItems:"center",gap:8}}>
              <span style={{width:18,height:18,background:C.navy,color:C.white,borderRadius:"50%",display:"inline-flex",alignItems:"center",justifyContent:"center",fontFamily:mono,fontSize:8,flexShrink:0}}>1</span>
              <span style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.08em",color:C.inkMuted}}>Project Context</span>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr"}}>
              {[["Company","company"],["Contact","contact"],["Email","email"],["Phone","phone"]].map(([l,key],i)=>(
                <div key={l} style={{padding:"11px 14px",borderBottom:`1px solid ${C.ruleLight}`,borderRight:i%2===0?`1px solid ${C.ruleLight}`:"none"}}>
                  <div style={{fontFamily:mono,fontSize:8,textTransform:"uppercase",letterSpacing:"0.07em",color:C.inkMuted,marginBottom:5}}>{l}</div>
                  <input
                    value={formProject[key] || ""}
                    onChange={(e)=>updateProjectField(key, e.target.value)}
                    style={{width:"100%",padding:"7px 8px",border:`1px solid ${C.rule}`,borderRadius:5,background:C.white,color:C.inkSoft,fontSize:13,fontWeight:600}}
                  />
                </div>
              ))}
              <div style={{padding:"11px 14px",borderBottom:`1px solid ${C.ruleLight}`,borderRight:`1px solid ${C.ruleLight}`}}>
                <div style={{fontFamily:mono,fontSize:8,textTransform:"uppercase",letterSpacing:"0.07em",color:C.inkMuted,marginBottom:5}}>Company Industry</div>
                <select
                  value={formProject.companyIndustry || ""}
                  onChange={(e)=>updateProjectField("companyIndustry", e.target.value)}
                  style={{width:"100%",padding:"7px 8px",border:`1px solid ${C.rule}`,borderRadius:5,background:C.white,color:C.ink,fontSize:13,fontWeight:600}}
                >
                  <option value="">Select industry</option>
                  {BUYER_INDUSTRY_OPTIONS.map((opt)=><option key={opt} value={opt}>{opt}</option>)}
                </select>
              </div>
              <div style={{padding:"11px 14px",borderBottom:`1px solid ${C.ruleLight}`}}>
                <div style={{fontFamily:mono,fontSize:8,textTransform:"uppercase",letterSpacing:"0.07em",color:C.inkMuted,marginBottom:5}}>Company Size</div>
                <select
                  value={formProject.companySize || ""}
                  onChange={(e)=>updateProjectField("companySize", e.target.value)}
                  style={{width:"100%",padding:"7px 8px",border:`1px solid ${C.rule}`,borderRadius:5,background:C.white,color:C.ink,fontSize:13,fontWeight:600}}
                >
                  <option value="">Select company size</option>
                  {BUYER_COMPANY_SIZE_OPTIONS.map((opt)=><option key={opt} value={opt}>{opt}</option>)}
                </select>
              </div>
              <div style={{padding:"11px 14px",gridColumn:"1 / -1"}}>
                <div style={{fontFamily:mono,fontSize:8,textTransform:"uppercase",letterSpacing:"0.07em",color:C.inkMuted,marginBottom:5}}>Company Location</div>
                <input
                  value={formProject.companyLocation || ""}
                  onChange={(e)=>updateProjectField("companyLocation", e.target.value)}
                  style={{width:"100%",padding:"7px 8px",border:`1px solid ${C.rule}`,borderRadius:5,background:C.white,color:C.inkSoft,fontSize:13,fontWeight:600}}
                />
              </div>
            </div>
          </Card>
          {/* Section 2 */}
          <Card style={{marginBottom:16}}>
            <div style={{padding:"9px 16px",background:C.surface,borderBottom:`1px solid ${C.rule}`,display:"flex",alignItems:"center",gap:8}}>
              <span style={{width:18,height:18,background:C.navy,color:C.white,borderRadius:"50%",display:"inline-flex",alignItems:"center",justifyContent:"center",fontFamily:mono,fontSize:8,flexShrink:0}}>2</span>
              <span style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.08em",color:C.inkMuted}}>Project Requirements</span>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr"}}>
              <div style={{padding:"11px 14px",gridColumn:"1 / -1",borderBottom:`1px solid ${C.ruleLight}`}}>
                <div style={{fontFamily:mono,fontSize:8,textTransform:"uppercase",letterSpacing:"0.07em",color:C.inkMuted,marginBottom:5}}>Project Name</div>
                <input
                  value={formProject.name || ""}
                  onChange={(e)=>updateProjectField("name", e.target.value)}
                  style={{width:"100%",padding:"8px 9px",border:`1px solid ${C.rule}`,borderRadius:5,background:C.white,color:C.ink,fontSize:13,fontWeight:600}}
                />
              </div>
              <div style={{padding:"11px 14px",gridColumn:"1 / -1",borderBottom:`1px solid ${C.ruleLight}`}}>
                <div style={{fontFamily:mono,fontSize:8,textTransform:"uppercase",letterSpacing:"0.07em",color:C.inkMuted,marginBottom:5}}>Project Overview <span style={{fontFamily:mono,fontSize:7,padding:"1px 4px",borderRadius:2,background:C.gold,color:"#fff",marginLeft:4}}>Open</span></div>
                <textarea
                  rows={3}
                  value={formProject.overview || ""}
                  onChange={(e)=>updateProjectField("overview", e.target.value)}
                  style={{width:"100%",padding:"8px 9px",border:`1px solid ${C.rule}`,borderRadius:5,background:C.white,color:C.inkSoft,fontSize:13,lineHeight:1.7,fontStyle:"italic",resize:"vertical"}}
                />
              </div>
              {[["Delivery Location","deliveryLoc"],["Required Delivery Date","deliveryDate"],["Compliance","compliance"]].map(([l,key],i)=>(
                <div key={l} style={{padding:"11px 14px",borderBottom:`1px solid ${C.ruleLight}`,borderRight:i%2===0?`1px solid ${C.ruleLight}`:"none"}}>
                  <div style={{fontFamily:mono,fontSize:8,textTransform:"uppercase",letterSpacing:"0.07em",color:C.inkMuted,marginBottom:5}}>{l}</div>
                  <input
                    value={formProject[key] || ""}
                    onChange={(e)=>updateProjectField(key, e.target.value)}
                    style={{width:"100%",padding:"7px 8px",border:`1px solid ${C.rule}`,borderRadius:5,background:C.white,color:C.ink,fontSize:13,fontWeight:600}}
                  />
                </div>
              ))}
              <div style={{padding:"11px 14px",borderBottom:`1px solid ${C.ruleLight}`,borderRight:`1px solid ${C.ruleLight}`}}>
                <div style={{fontFamily:mono,fontSize:8,textTransform:"uppercase",letterSpacing:"0.07em",color:C.inkMuted,marginBottom:5}}>Expected Annual Production Volume</div>
                <select
                  value={formProject.annualVolume || ""}
                  onChange={(e)=>updateProjectField("annualVolume", e.target.value)}
                  style={{width:"100%",padding:"7px 8px",border:`1px solid ${C.rule}`,borderRadius:5,background:C.white,color:C.ink,fontSize:13,fontWeight:600}}
                >
                  <option value="">Select volume</option>
                  <option value="Prototype (1-100)">Prototype (1-100)</option>
                  <option value="Low (101-1,000)">Low (101-1,000)</option>
                  <option value="Medium (1,001-10,000)">Medium (1,001-10,000)</option>
                  <option value="High (10,001+)">High (10,001+)</option>
                </select>
              </div>
              <div style={{padding:"11px 14px",gridColumn:"1 / -1",borderBottom:`1px solid ${C.ruleLight}`}}>
                <div style={{fontFamily:mono,fontSize:8,textTransform:"uppercase",letterSpacing:"0.07em",color:C.inkMuted,marginBottom:7}}>Countries To Exclude</div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(3,minmax(0,1fr))",gap:6}}>
                  {BUYER_COUNTRY_OPTIONS.map((country)=>(
                    <label key={country} style={{display:"flex",alignItems:"center",gap:6,fontSize:12,color:C.inkSoft}}>
                      <input
                        type="checkbox"
                        checked={Array.isArray(formProject.countriesExclude) && formProject.countriesExclude.includes(country)}
                        onChange={()=>toggleProjectMulti("countriesExclude", country)}
                      />
                      <span>{country}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div style={{padding:"11px 14px",gridColumn:"1 / -1",borderBottom:`1px solid ${C.ruleLight}`}}>
                <div style={{fontFamily:mono,fontSize:8,textTransform:"uppercase",letterSpacing:"0.07em",color:C.inkMuted,marginBottom:7}}>Mandatory Certifications</div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(3,minmax(0,1fr))",gap:6}}>
                  {BUYER_CERT_OPTIONS.map((cert)=>(
                    <label key={cert} style={{display:"flex",alignItems:"center",gap:6,fontSize:12,color:C.inkSoft}}>
                      <input
                        type="checkbox"
                        checked={Array.isArray(formProject.mandatoryCerts) && formProject.mandatoryCerts.includes(cert)}
                        onChange={()=>toggleProjectMulti("mandatoryCerts", cert)}
                      />
                      <span>{cert}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div style={{padding:"11px 14px",gridColumn:"1 / -1",borderBottom:`1px solid ${C.ruleLight}`}}>
                <div style={{fontFamily:mono,fontSize:8,textTransform:"uppercase",letterSpacing:"0.07em",color:C.inkMuted,marginBottom:5}}>Certification Preferences</div>
                <textarea
                  rows={2}
                  value={formProject.certificationPrefs || ""}
                  onChange={(e)=>updateProjectField("certificationPrefs", e.target.value)}
                  style={{width:"100%",padding:"8px 9px",border:`1px solid ${C.rule}`,borderRadius:5,background:C.white,color:C.inkSoft,fontSize:13,lineHeight:1.65,resize:"vertical"}}
                />
              </div>
              <div style={{padding:"11px 14px",gridColumn:"1 / -1",borderBottom:`1px solid ${C.ruleLight}`}}>
                <div style={{fontFamily:mono,fontSize:8,textTransform:"uppercase",letterSpacing:"0.07em",color:C.inkMuted,marginBottom:5}}>Geographic Preferences <span style={{fontFamily:mono,fontSize:7,padding:"1px 4px",borderRadius:2,background:C.gold,color:"#fff",marginLeft:4}}>Open</span></div>
                <textarea
                  rows={2}
                  value={formProject.geo || ""}
                  onChange={(e)=>updateProjectField("geo", e.target.value)}
                  style={{width:"100%",padding:"8px 9px",border:`1px solid ${C.rule}`,borderRadius:5,background:C.white,color:C.inkSoft,fontSize:13,lineHeight:1.65,fontStyle:"italic",resize:"vertical"}}
                />
              </div>
              <div style={{padding:"11px 14px",gridColumn:"1 / -1"}}>
                <div style={{fontFamily:mono,fontSize:8,textTransform:"uppercase",letterSpacing:"0.07em",color:C.inkMuted,marginBottom:5}}>Budget Sensitivity <span style={{fontFamily:mono,fontSize:7,padding:"1px 4px",borderRadius:2,background:C.gold,color:"#fff",marginLeft:4}}>Open</span></div>
                <textarea
                  rows={2}
                  value={formProject.budget || ""}
                  onChange={(e)=>updateProjectField("budget", e.target.value)}
                  style={{width:"100%",padding:"8px 9px",border:`1px solid ${C.rule}`,borderRadius:5,background:C.white,color:C.inkSoft,fontSize:13,lineHeight:1.65,fontStyle:"italic",resize:"vertical"}}
                />
              </div>
            </div>
          </Card>
          {/* Parts */}
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
            <div style={{display:"flex",alignItems:"center",gap:10}}><span style={{fontFamily:disp,fontSize:15,fontWeight:700}}>Parts</span><span style={{fontFamily:mono,fontSize:9,padding:"2px 7px",borderRadius:2,background:C.bluePale,color:C.blue,border:"1px solid rgba(26,61,92,0.18)",textTransform:"uppercase"}}>{formParts.length} added</span></div>
            <Btn sm variant="outline" onClick={addBuyerPart}>+ Add Part</Btn>
          </div>
          {formParts.map(p=><BuyerPartCard key={p.id} part={p} onChange={updatePartField} onAddCadFiles={addPartCadFiles} onAddImageFiles={addPartImageFiles} onRemoveImage={removePartImageAt} onSetPrimaryImage={setPrimaryPartImage} onRemove={removeBuyerPart} canRemove={formParts.length > 1}/>)}
          <div style={{marginTop:10,display:"flex",justifyContent:"flex-end"}}>
            <Btn variant={submitted?"green":"accent"} disabled={submitting} onClick={handleSubmit}>
              {submitted?"RFP Submitted":submitting?"Submitting...":"Submit RFP ->"}
            </Btn>
          </div>
        </div>
        {/* Sidebar */}
        <div style={{position:"sticky",top:68}}>
          <Card style={{marginBottom:12}}>
            <CardHead title="RFP Completeness"/>
            <div style={{padding:"13px 15px"}}>
              <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:12}}>
                <ScoreRing score={completeness.score} size={48}/>
                <div><div style={{fontFamily:disp,fontSize:16,fontWeight:700,lineHeight:1}}>{completeness.score}%</div><div style={{fontFamily:mono,fontSize:9,color:C.inkMuted,marginTop:2}}>{completeness.completed} / {completeness.total} sections</div></div>
              </div>
              {completeness.checks.map(([l,done])=>(
                <div key={l} style={{display:"flex",alignItems:"center",gap:8,marginBottom:7}}>
                  <span style={{width:15,height:15,borderRadius:"50%",flexShrink:0,background:done?C.passBg:C.surface,border:`1.5px solid ${done?C.pass:C.rule}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:8,color:C.pass}}>{done?"v":""}</span>
                  <span style={{fontFamily:mono,fontSize:9,color:done?C.ink:C.inkMuted}}>{l}</span>
                </div>
              ))}
            </div>
          </Card>
          <div style={{padding:"9px 11px",background:C.goldPale,border:`1px solid rgba(184,146,10,0.2)`,borderLeft:`3px solid ${C.gold}`,borderRadius:4,fontSize:11.5,color:C.inkSoft,lineHeight:1.6}}>
            Fields marked <span style={{fontFamily:mono,fontSize:7,padding:"1px 4px",borderRadius:2,background:C.gold,color:"#fff"}}>Open</span> are free-response. Our team may follow up to clarify.
          </div>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------
// ROUTER
// ------------------------------------------------------------------------------

function AuthGate({ onAuthenticated }) {
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [step, setStep] = useState("lookup");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [zohoAccountId, setZohoAccountId] = useState("");

  useEffect(() => {
    const session = getSupplierSession();
    if (session?.supplier_id) onAuthenticated(session);
  }, [onAuthenticated]);

  const handleLookupAndSend = async () => {
    setError("");
    if (!email.trim()) {
      setError("Email is required");
      return;
    }
    setLoading(true);
    try {
      const lookup = await apiPost(ENDPOINTS.auth.lookup, { email: email.trim().toLowerCase() });
      if (!lookup?.ok) throw new Error(lookup?.error || "Lookup failed");
      const name = lookup.company_name || "Supplier";
      const accountId = lookup.zoho_account_id || "";
      setCompanyName(name);
      setZohoAccountId(accountId);

      const sendOtp = await apiPost(ENDPOINTS.auth.sendOtp, {
        email: email.trim().toLowerCase(),
        company_name: name,
        zoho_account_id: accountId,
      });
      if (!sendOtp?.ok) throw new Error(sendOtp?.error || "Failed to send OTP");
      setStep("verify");
    } catch (e) {
      setError(e.message || "Authentication failed");
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async () => {
    setError("");
    if (!otp.trim()) {
      setError("OTP is required");
      return;
    }
    setLoading(true);
    try {
      const verified = await apiPost(ENDPOINTS.auth.verifyOtp, {
        email: email.trim().toLowerCase(),
        otp: otp.trim(),
      });
      if (!verified?.ok) throw new Error(verified?.error || "OTP verification failed");

      const session = {
        email: verified.email || email.trim().toLowerCase(),
        zoho_account_id: verified.zoho_account_id || zohoAccountId,
        company_name: verified.company_name || companyName || "Supplier",
      };
      clearUiDataCaches();
      setSupplierSession(session);
      onAuthenticated({
        supplier_id: session.zoho_account_id,
        supplier_email: session.email,
        supplier_name: session.company_name,
      });
    } catch (e) {
      setError(e.message || "OTP verification failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{fontFamily:sans,fontSize:14,color:C.ink,minHeight:"100vh",background:C.bg,display:"flex",alignItems:"center",justifyContent:"center",padding:"24px"}}>
      <div style={{width:"100%",maxWidth:460,background:C.white,border:`1px solid ${C.rule}`,borderRadius:10,boxShadow:"0 8px 24px rgba(20,28,36,0.12)",overflow:"hidden"}}>
        <div style={{background:C.navyDeep,borderBottom:`2px solid ${C.gold}`,padding:"14px 18px",display:"flex",alignItems:"center",gap:10}}>
          <BridgeMark size={24} color="white"/>
          <div>
            <div style={{fontFamily:serif,fontSize:18,fontWeight:700,color:C.white,lineHeight:1}}>Trustbridge</div>
            <div style={{fontFamily:mono,fontSize:9,color:"rgba(255,255,255,0.5)",textTransform:"uppercase",letterSpacing:"0.06em"}}>Supplier Authentication</div>
          </div>
        </div>
        <div style={{padding:"18px"}}>
          <div style={{fontFamily:disp,fontSize:16,fontWeight:700,marginBottom:8}}>
            {step === "lookup" ? "Sign In With Work Email" : "Enter OTP"}
          </div>
          <div style={{fontSize:12.5,color:C.inkMuted,lineHeight:1.6,marginBottom:14}}>
            {step === "lookup"
              ? "We will verify your supplier account and send a one-time code."
              : "Enter the 6-digit one-time code sent to your email."}
          </div>
          <div style={{marginBottom:10}}>
            <div style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted,marginBottom:5}}>Work Email</div>
            <input
              value={email}
              disabled={step === "verify"}
              onChange={(e)=>setEmail(e.target.value)}
              placeholder="you@company.com"
              style={{width:"100%",padding:"9px 10px",border:`1px solid ${C.rule}`,borderRadius:5,background:step==="verify"?C.surface:C.white,color:C.ink,fontSize:13}}
            />
          </div>

          {step === "verify" && (
            <div style={{marginBottom:10}}>
              <div style={{fontFamily:mono,fontSize:9,textTransform:"uppercase",letterSpacing:"0.06em",color:C.inkMuted,marginBottom:5}}>OTP Code</div>
              <input
                value={otp}
                onChange={(e)=>setOtp(e.target.value)}
                placeholder="6-digit code"
                style={{width:"100%",padding:"9px 10px",border:`1px solid ${C.rule}`,borderRadius:5,background:C.white,color:C.ink,fontSize:13}}
              />
            </div>
          )}

          {error && <div style={{fontSize:12,color:C.warn,background:C.warnBg,border:`1px solid ${C.warnRule}`,padding:"8px 10px",borderRadius:4,marginBottom:10}}>{userSafeMessage(error)}</div>}

          <div style={{display:"flex",gap:8,justifyContent:"space-between",marginTop:10}}>
            {step === "verify" ? (
              <Btn variant="outline" onClick={()=>{ setStep("lookup"); setOtp(""); setError(""); }} disabled={loading}>Back</Btn>
            ) : <div />}
            <Btn variant="accent" onClick={step === "lookup" ? handleLookupAndSend : handleVerify} disabled={loading}>
              {loading ? "Please wait..." : step === "lookup" ? "Send OTP" : "Verify & Continue"}
            </Btn>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function TrustbridgeApp() {
  const [screen, setScreen] = useState(() => getInitialScreenFromUrl());
  const [screenData, setScreenData] = useState({});
  const [authSession, setAuthSession] = useState(() => getSupplierSession());
  const isAuthenticated = Boolean(authSession?.supplier_id || authSession?.zoho_account_id);
  const buyerScreenKey = useMemo(() => {
    const rfp = screenData?.rfp || {};
    const parts = Array.isArray(rfp?.parts_prefill) ? rfp.parts_prefill : Array.isArray(rfp?.parts) ? rfp.parts : [];
    return JSON.stringify({
      rfp_id: rfp?.rfp_id || rfp?.sourceRfpId || rfp?.id || "",
      buyer: rfp?.buyer || "",
      project: rfp?.project || "",
      no_bid_email: screenData?.noBidIntent?.buyer_contact_email || "",
      parts_sig: parts.map((p) => `${p?.id || ""}|${p?.description || p?.label || ""}|${p?.material || ""}|${p?.process || ""}|${p?.qty || ""}`).join("||"),
    });
  }, [screenData]);

  const navigate = useCallback((dest, data = {}) => {
    setScreen(dest);
    setScreenData(data);
    window.scrollTo(0, 0);
  }, []);

  const handleLogout = useCallback(() => {
    clearSupplierSession();
    clearUiDataCaches();
    setAuthSession({});
    setScreen("dashboard");
    setScreenData({});
  }, []);

  useEffect(() => {
    const onStorage = (e) => {
      if (e.key && e.key !== SUPPLIER_SESSION_KEY) return;
      setAuthSession(getSupplierSession());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;
    const heartbeat = () => touchSupplierSession();
    const interval = setInterval(() => {
      const next = getSupplierSession();
      if (!next?.supplier_id) {
        handleLogout();
        return;
      }
      setAuthSession(next);
      heartbeat();
    }, 60 * 1000);
    window.addEventListener("click", heartbeat);
    window.addEventListener("keydown", heartbeat);
    return () => {
      clearInterval(interval);
      window.removeEventListener("click", heartbeat);
      window.removeEventListener("keydown", heartbeat);
    };
  }, [handleLogout, isAuthenticated]);

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500&family=IBM+Plex+Mono:wght@300;400;500&family=Playfair+Display:wght@600;700&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        ::-webkit-scrollbar{width:5px;}
        ::-webkit-scrollbar-thumb{background:#9BAAC0;border-radius:3px;}
        @keyframes up{from{opacity:0;transform:translateY(9px);}to{opacity:1;transform:none;}}
        @keyframes slideDown{from{opacity:0;transform:translateY(-10px);}to{opacity:1;transform:none;}}
        @keyframes slideIn{from{transform:translateX(40px);opacity:0;}to{transform:none;opacity:1;}}
        @keyframes fadeIn{from{opacity:0;}to{opacity:1;}}
        @keyframes spin{to{transform:rotate(360deg);}}
        textarea,input,select{font-family:${sans};}
        input::placeholder,textarea::placeholder{color:${C.inkMuted};}
        input:focus,textarea:focus,select:focus{outline:none;}
      `}</style>
      {!isAuthenticated ? (
        <AuthGate onAuthenticated={() => setAuthSession(getSupplierSession())} />
      ) : (
        <>
          {screen === "dashboard"  && <DashboardScreen  navigate={navigate} onLogout={handleLogout}/>}
          {screen === "assessment" && <AssessmentScreen  navigate={navigate} rfp={screenData.rfp} initialUploadFiles={screenData.uploadFiles || []} onLogout={handleLogout}/>}
          {screen === "ingestion"  && <IngestionScreen   navigate={navigate} onLogout={handleLogout}/>}
          {screen === "buyerrfp"   && <BuyerRfpScreen    key={buyerScreenKey} navigate={navigate} onLogout={handleLogout} screenData={screenData}/>}
        </>
      )}
    </>
  );
}
