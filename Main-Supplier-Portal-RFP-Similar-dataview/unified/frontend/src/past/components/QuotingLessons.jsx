import { useState } from "react";

const C = {
  ink: "#1B2D4F",
  inkSoft: "#2D4567",
  inkMuted: "#6B7F96",
  rule: "#CBD3DF",
  ruleLight: "#E2E8F0",
  surface: "#F2F4F8",
  white: "#FAFCFF",
  copper: "#B8920A",
  copperPale: "#F5F0DC",
  pass: "#1E5E3A",
  passBg: "#E6F4EC",
  red: "#C53030",
  redBg: "#FFF5F5",
  blue: "#1A3D5C",
  blueBg: "#E8EFF8",
  gold: "#A07800",
  goldBg: "#FFF8E0",
};
const mono = "'IBM Plex Mono', monospace";
const display = "'Syne', sans-serif";
const sans = "'DM Sans', sans-serif";

const CATEGORIES = [
  "Cost Driver",
  "Time Buffer",
  "Tolerance Loop",
  "Tooling Cost",
  "Setup Charge",
  "Material Upcharge",
  "Coordination",
  "Rework Risk",
  "Other",
];

const CAT_COLORS = {
  "Cost Driver": {
    color: "#7B2D00",
    bg: "#FEF3EC",
    border: "rgba(123,45,0,0.2)",
  },
  "Time Buffer": {
    color: "#1A3D5C",
    bg: "#EAF0F8",
    border: "rgba(26,61,92,0.2)",
  },
  "Tolerance Loop": {
    color: "#5B2D8E",
    bg: "#F3EEFF",
    border: "rgba(91,45,142,0.2)",
  },
  "Tooling Cost": {
    color: "#B87333",
    bg: "#F5EDE3",
    border: "rgba(184,115,51,0.25)",
  },
  "Setup Charge": {
    color: "#1A5C5C",
    bg: "#E8F6F6",
    border: "rgba(26,92,92,0.2)",
  },
  "Material Upcharge": {
    color: "#2E5C3E",
    bg: "#EAF4EE",
    border: "rgba(46,92,62,0.2)",
  },
  Coordination: {
    color: "#1A56DB",
    bg: "#EBF5FF",
    border: "rgba(26,86,219,0.2)",
  },
  "Rework Risk": {
    color: "#C53030",
    bg: "#FFF5F5",
    border: "rgba(197,48,48,0.2)",
  },
  Other: { color: "#7A8A96", bg: "#F5F4F1", border: "#D8DDE2" },
};

function catStyle(cat) {
  return CAT_COLORS[cat] || CAT_COLORS["Other"];
}

function Badge({ label, color, bg, border }) {
  return (
    <span
      style={{
        fontFamily: mono,
        fontSize: 9,
        padding: "2px 7px",
        borderRadius: 3,
        background: bg || C.surface,
        color: color || C.inkMuted,
        border: `1px solid ${border || C.rule}`,
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

// ── Add / Edit Modal ──────────────────────────────────────────────────────────
function normalizeMatchValue(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function sourceIncludes(source, value) {
  const src = normalizeMatchValue(source);
  const val = normalizeMatchValue(value);
  return Boolean(src && val && src.includes(val));
}

function buildProjectOptions(corpusSaved = []) {
  return corpusSaved.map((project, projectIndex) => {
    const projectKey = String(
      project.id || project.job_id || project.project_name || projectIndex,
    );
    const projectName =
      project.project_name ||
      project.projectFields?.project_name ||
      `Project ${projectIndex + 1}`;
    const jobId =
      project.job_id || project.projectFields?.job_id || project.id || "";

    return {
      key: projectKey,
      projectName,
      jobId,
      parts: (project.parts || []).map((part, partIndex) => ({
        key: String(
          part.part_id ||
            part.part_label ||
            part.part_name ||
            `${projectKey}-${partIndex}`,
        ),
        partName: part.part_name || part.part_label || `Part ${partIndex + 1}`,
        process: part.process || part.process_primary || "",
        material: part.material || "",
      })),
    };
  });
}

function hydrateLessonForm(initial, blank, projectOptions) {
  const form = { ...blank, ...(initial || {}) };
  if (!initial) return form;

  const source = form.source_job || form.source_label || "";
  const selectedProject =
    projectOptions.find((project) => project.key === String(form.selected_project_key || "")) ||
    projectOptions.find((project) =>
      [initial.project_id, initial.job_id, initial.source_project_id, initial.project_name].some(
        (value) =>
          value &&
          [project.key, project.jobId, project.projectName].some(
            (projectValue) => String(projectValue) === String(value),
          ),
      ),
    ) ||
    projectOptions.find(
      (project) => sourceIncludes(source, project.projectName) || sourceIncludes(source, project.jobId),
    ) ||
    null;

  const selectedPart =
    selectedProject?.parts.find((part) => part.key === String(form.selected_part_key || "")) ||
    selectedProject?.parts.find((part) =>
      [initial.part_id, initial.part_label, initial.part_name, initial.source_part_id].some(
        (value) =>
          value &&
          [part.key, part.partName].some(
            (partValue) => String(partValue) === String(value),
          ),
      ),
    ) ||
    selectedProject?.parts.find((part) => sourceIncludes(source, part.partName)) ||
    null;

  return {
    ...form,
    source_job: form.source_job || source,
    selected_project_key: selectedProject?.key || form.selected_project_key || "",
    selected_part_key: selectedPart?.key || form.selected_part_key || "",
    process: form.process || selectedPart?.process || "",
    material: form.material || selectedPart?.material || "",
  };
}

function LessonModal({ initial, onSave, onClose, corpusSaved = [] }) {
  const blank = {
    category: "Cost Driver",
    title: "",
    desc: "",
    process: "",
    material: "",
    source_job: "",
    selected_project_key: "",
    selected_part_key: "",
  };
  const projectOptions = buildProjectOptions(corpusSaved);
  const [form, setForm] = useState(() =>
    hydrateLessonForm(initial, blank, projectOptions),
  );
  const [errors, setErrors] = useState({});
  const selectedProject =
    projectOptions.find((project) => project.key === form.selected_project_key) ||
    null;

  function set(key, val) {
    setForm((f) => ({ ...f, [key]: val }));
    setErrors((e) => ({ ...e, [key]: "" }));
  }

  function handleProjectChange(projectKey) {
    setForm((prev) => ({
      ...prev,
      selected_project_key: projectKey,
      selected_part_key: "",
      source_job: "",
    }));
  }

  function handlePartChange(partKey) {
    const project =
      projectOptions.find((item) => item.key === form.selected_project_key) ||
      null;
    const part = project?.parts.find((item) => item.key === partKey) || null;
    const sourceLabel = [project?.projectName, part?.partName, project?.jobId]
      .filter(Boolean)
      .join(" · ");

    setForm((prev) => ({
      ...prev,
      selected_part_key: partKey,
      source_job: sourceLabel,
      process: prev.process || part?.process || "",
      material: prev.material || part?.material || "",
    }));
  }

  function validate() {
    const errs = {};
    if (!form.title.trim()) errs.title = "Title is required";
    if (!form.desc.trim()) errs.desc = "Description is required";
    return errs;
  }

  function handleSave() {
    const errs = validate();
    if (Object.keys(errs).length) {
      setErrors(errs);
      return;
    }
    onSave({ ...form, id: initial?.id || Date.now(), source: "manual" });
  }

  const fieldStyle = (err) => ({
    fontFamily: sans,
    fontSize: 12,
    color: C.ink,
    background: err ? C.redBg : C.surface,
    border: `1px solid ${err ? C.red : C.rule}`,
    borderRadius: 5,
    padding: "8px 10px",
    width: "100%",
    outline: "none",
    boxSizing: "border-box",
  });

  return (
    <div
      onClick={(e) => e.target === e.currentTarget && onClose()}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(20,28,36,0.55)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        style={{
          background: C.white,
          border: `1px solid ${C.rule}`,
          borderRadius: 10,
          width: "100%",
          maxWidth: 540,
          boxShadow: "0 8px 32px rgba(20,28,36,0.18)",
          overflow: "hidden",
        }}
      >
        {/* header */}
        <div
          style={{
            padding: "14px 20px",
            background: C.surface,
            borderBottom: `1px solid ${C.rule}`,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div>
            <div
              style={{
                fontFamily: display,
                fontSize: 14,
                fontWeight: 700,
                color: C.ink,
              }}
            >
              {initial ? "Edit Quoting Lesson" : "Add Quoting Lesson"}
            </div>
            <div
              style={{
                fontFamily: mono,
                fontSize: 9,
                color: C.inkMuted,
                marginTop: 2,
              }}
            >
              Capture a cost surprise, buffer, or coordination item for future
              estimates
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              fontSize: 20,
              color: C.inkMuted,
              cursor: "pointer",
              lineHeight: 1,
              padding: "0 4px",
            }}
          >
            ×
          </button>
        </div>

        {/* body */}
        <div
          style={{
            padding: "18px 20px",
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          {/* category */}
          <div>
            <div
              style={{
                fontFamily: mono,
                fontSize: 9,
                color: C.inkMuted,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                marginBottom: 7,
              }}
            >
              Category
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {CATEGORIES.map((cat) => {
                const cs = catStyle(cat);
                const active = form.category === cat;
                return (
                  <button
                    key={cat}
                    onClick={() => set("category", cat)}
                    style={{
                      fontFamily: mono,
                      fontSize: 9,
                      padding: "4px 10px",
                      borderRadius: 4,
                      border: `1px solid ${active ? cs.border : C.rule}`,
                      background: active ? cs.bg : C.surface,
                      color: active ? cs.color : C.inkMuted,
                      cursor: "pointer",
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      fontWeight: active ? 600 : 400,
                    }}
                  >
                    {cat}
                  </button>
                );
              })}
            </div>
          </div>

          {/* title */}
          <div>
            <div
              style={{
                fontFamily: mono,
                fontSize: 9,
                color: C.inkMuted,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                marginBottom: 6,
              }}
            >
              Lesson Title *
            </div>
            <input
              value={form.title}
              onChange={(e) => set("title", e.target.value)}
              placeholder="e.g. Hard anodize adds 0.001–0.002″ per face — budget into bore clearance"
              style={fieldStyle(errors.title)}
            />
            {errors.title && (
              <div
                style={{
                  fontFamily: sans,
                  fontSize: 10,
                  color: C.red,
                  marginTop: 3,
                }}
              >
                {errors.title}
              </div>
            )}
          </div>

          {/* description */}
          <div>
            <div
              style={{
                fontFamily: mono,
                fontSize: 9,
                color: C.inkMuted,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                marginBottom: 6,
              }}
            >
              Estimator Note *
            </div>
            <textarea
              value={form.desc}
              onChange={(e) => set("desc", e.target.value)}
              placeholder="1–3 sentences: what to watch for when pricing similar work, what buffer to add, or what to clarify with the vendor upfront…"
              rows={4}
              style={{ ...fieldStyle(errors.desc), resize: "vertical" }}
            />
            {errors.desc && (
              <div
                style={{
                  fontFamily: sans,
                  fontSize: 10,
                  color: C.red,
                  marginTop: 3,
                }}
              >
                {errors.desc}
              </div>
            )}
          </div>

          {/* process + material */}
          <div
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}
          >
            <div>
              <div
                style={{
                  fontFamily: mono,
                  fontSize: 9,
                  color: C.inkMuted,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  marginBottom: 6,
                }}
              >
                Process <span style={{ fontWeight: 400 }}>(optional)</span>
              </div>
              <input
                value={form.process}
                onChange={(e) => set("process", e.target.value)}
                placeholder="e.g. 5-axis CNC, EDM"
                style={fieldStyle(false)}
              />
            </div>
            <div>
              <div
                style={{
                  fontFamily: mono,
                  fontSize: 9,
                  color: C.inkMuted,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  marginBottom: 6,
                }}
              >
                Material <span style={{ fontWeight: 400 }}>(optional)</span>
              </div>
              <input
                value={form.material}
                onChange={(e) => set("material", e.target.value)}
                placeholder="e.g. Ti-6Al-4V, 7075-T6"
                style={fieldStyle(false)}
              />
            </div>
          </div>

          {/* source job */}
          <div>
            <div
              style={{
                fontFamily: mono,
                fontSize: 9,
                color: C.inkMuted,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                marginBottom: 6,
              }}
            >
              Source Job / Part{" "}
              <span style={{ fontWeight: 400 }}>(optional)</span>
            </div>
            {projectOptions.length > 0 && (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 8,
                  marginBottom: 8,
                }}
              >
                <select
                  value={form.selected_project_key || ""}
                  onChange={(e) => handleProjectChange(e.target.value)}
                  style={fieldStyle(false)}
                >
                  <option value="">Select saved project</option>
                  {projectOptions.map((project) => (
                    <option key={project.key} value={project.key}>
                      {[project.projectName, project.jobId]
                        .filter(Boolean)
                        .join(" · ")}
                    </option>
                  ))}
                </select>
                <select
                  value={form.selected_part_key || ""}
                  onChange={(e) => handlePartChange(e.target.value)}
                  disabled={!selectedProject}
                  style={fieldStyle(false)}
                >
                  <option value="">Select part</option>
                  {(selectedProject?.parts || []).map((part) => (
                    <option key={part.key} value={part.key}>
                      {part.partName}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <input
              value={form.source_job}
              onChange={(e) => set("source_job", e.target.value)}
              placeholder="Selected source will appear here"
              style={fieldStyle(false)}
            />
          </div>
        </div>

        {/* footer */}
        <div
          style={{
            padding: "12px 20px",
            background: C.surface,
            borderTop: `1px solid ${C.rule}`,
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
          }}
        >
          <button
            onClick={onClose}
            style={{
              fontFamily: mono,
              fontSize: 10,
              padding: "8px 16px",
              borderRadius: 5,
              border: `1px solid ${C.rule}`,
              background: C.white,
              color: C.inkSoft,
              cursor: "pointer",
              letterSpacing: "0.04em",
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            style={{
              fontFamily: mono,
              fontSize: 10,
              padding: "8px 18px",
              borderRadius: 5,
              border: "none",
              background: C.copper,
              color: "#fff",
              cursor: "pointer",
              letterSpacing: "0.04em",
              fontWeight: 600,
            }}
          >
            {initial ? "Save Changes" : "Add Lesson →"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Lesson Card ───────────────────────────────────────────────────────────────
function LessonCard({ lesson, onEdit, onDelete, readOnly }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const cs = catStyle(lesson.category);

  return (
    <div
      style={{
        background: C.white,
        border: `1px solid ${C.rule}`,
        borderRadius: 7,
        padding: "14px 16px",
        boxShadow: "0 1px 3px rgba(20,28,36,0.05)",
        display: "flex",
        gap: 14,
        alignItems: "flex-start",
      }}
    >
      <div style={{ flexShrink: 0, marginTop: 2 }}>
        <Badge
          label={lesson.category}
          color={cs.color}
          bg={cs.bg}
          border={cs.border}
        />
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 4,
          }}
        >
          <div
            style={{
              fontFamily: display,
              fontSize: 13,
              fontWeight: 700,
              color: C.ink,
            }}
          >
            {lesson.title}
          </div>
          {lesson.source === "part" && (
            <span
              style={{
                fontFamily: mono,
                fontSize: 8,
                padding: "1px 5px",
                borderRadius: 2,
                background: C.copperPale,
                color: C.copper,
                border: "1px solid rgba(184,115,51,0.3)",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              From Part
            </span>
          )}
        </div>
        <div
          style={{
            fontFamily: sans,
            fontSize: 12,
            color: C.inkSoft,
            lineHeight: 1.65,
            marginBottom: 6,
          }}
        >
          {lesson.desc}
        </div>
        <div
          style={{
            display: "flex",
            gap: 6,
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          {lesson.process && (
            <span
              style={{
                fontFamily: mono,
                fontSize: 9,
                padding: "2px 6px",
                borderRadius: 2,
                background: "#EAF0F8",
                color: "#1A3D5C",
                border: "1px solid rgba(26,61,92,0.15)",
              }}
            >
              {lesson.process}
            </span>
          )}
          {lesson.material && (
            <span
              style={{
                fontFamily: mono,
                fontSize: 9,
                padding: "2px 6px",
                borderRadius: 2,
                background: "#EAF4EE",
                color: "#2E5C3E",
                border: "1px solid rgba(46,92,62,0.15)",
              }}
            >
              {lesson.material}
            </span>
          )}
          {lesson.source_job && (
            <span
              style={{
                fontFamily: mono,
                fontSize: 9,
                color: C.inkMuted,
                letterSpacing: "0.03em",
              }}
            >
              ↳ {lesson.source_job}
            </span>
          )}
        </div>
      </div>

      {/* actions — hidden for read-only part-derived lessons */}
      {!readOnly && (
        <div
          style={{
            flexShrink: 0,
            display: "flex",
            flexDirection: "column",
            gap: 4,
            alignItems: "flex-end",
          }}
        >
          <button
            onClick={() => onEdit(lesson)}
            style={{
              fontFamily: mono,
              fontSize: 9,
              padding: "3px 9px",
              borderRadius: 3,
              border: `1px solid ${C.rule}`,
              background: C.surface,
              color: C.inkSoft,
              cursor: "pointer",
              letterSpacing: "0.04em",
            }}
          >
            Edit
          </button>
          {confirmDelete ? (
            <div style={{ display: "flex", gap: 4 }}>
              <button
                onClick={() => {
                  onDelete(lesson.id);
                  setConfirmDelete(false);
                }}
                style={{
                  fontFamily: mono,
                  fontSize: 9,
                  padding: "3px 7px",
                  borderRadius: 3,
                  border: "1px solid rgba(197,48,48,0.3)",
                  background: C.redBg,
                  color: C.red,
                  cursor: "pointer",
                }}
              >
                Confirm
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                style={{
                  fontFamily: mono,
                  fontSize: 9,
                  padding: "3px 7px",
                  borderRadius: 3,
                  border: `1px solid ${C.rule}`,
                  background: C.white,
                  color: C.inkMuted,
                  cursor: "pointer",
                }}
              >
                ✕
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              style={{
                fontFamily: mono,
                fontSize: 9,
                padding: "3px 9px",
                borderRadius: 3,
                border: "1px solid rgba(197,48,48,0.2)",
                background: C.redBg,
                color: C.red,
                cursor: "pointer",
                letterSpacing: "0.04em",
              }}
            >
              Delete
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────
function EmptyLessons({ onAdd }) {
  return (
    <div
      style={{
        textAlign: "center",
        padding: "60px 20px",
        background: C.white,
        border: `1px solid ${C.rule}`,
        borderRadius: 10,
      }}
    >
      <div
        style={{
          width: 48,
          height: 48,
          borderRadius: "50%",
          background: C.copperPale,
          border: "1px solid rgba(184,115,51,0.2)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          margin: "0 auto 14px",
          fontSize: 22,
        }}
      >
        💰
      </div>
      <div
        style={{
          fontFamily: display,
          fontSize: 16,
          fontWeight: 700,
          color: C.ink,
          marginBottom: 8,
        }}
      >
        No quoting lessons yet
      </div>
      <div
        style={{
          fontFamily: sans,
          fontSize: 12,
          color: C.inkMuted,
          maxWidth: 420,
          margin: "0 auto 22px",
          lineHeight: 1.65,
        }}
      >
        Capture cost surprises, time underestimates, tolerance loops, tooling
        charges, and coordination items from completed jobs so your estimators
        price future similar work more accurately.
      </div>
      <button
        onClick={onAdd}
        style={{
          fontFamily: mono,
          fontSize: 11,
          fontWeight: 600,
          padding: "10px 22px",
          borderRadius: 6,
          border: "none",
          background: C.copper,
          color: "#fff",
          cursor: "pointer",
          letterSpacing: "0.05em",
        }}
      >
        + Add First Lesson
      </button>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────
// corpusSaved prop: passed from App.jsx so part-derived lessons also appear
export default function QuotingLessons({
  corpusSaved = [],
  manualLessons: externalManualLessons,
  setManualLessons: externalSetManualLessons,
}) {
  // ── Manual lessons (standalone, like MfgLessons) ──────────────────────────
  const [internalManualLessons, setInternalManualLessons] = useState([]);
  const [modal, setModal] = useState(null); // null | "add" | lesson-obj
  const [filterCat, setFilterCat] = useState("All");
  const [search, setSearch] = useState("");
  const manualLessons = externalManualLessons ?? internalManualLessons;
  const setManualLessons =
    externalSetManualLessons ?? setInternalManualLessons;

  function handleAdd(lesson) {
    setManualLessons((p) => [lesson, ...p]);
    setModal(null);
  }
  function handleEdit(updated) {
    setManualLessons((p) => p.map((l) => (l.id === updated.id ? updated : l)));
    setModal(null);
  }
  function handleDelete(id) {
    setManualLessons((p) => p.filter((l) => l.id !== id));
  }

  // ── Part-derived lessons (read-only, from saved projects) ─────────────────
  const partLessons = [];
  corpusSaved.forEach((proj) => {
    (proj.parts || []).forEach((part) => {
      if (part.quoting_lesson) {
        partLessons.push({
          id: `part_${proj.id}_${part.part_id || part.part_label || partLessons.length}`,
          source: "part",
          category: "Other",
          title: part.part_name || part.part_label || part.process || "Part",
          desc: part.quoting_lesson,
          process: part.process || "",
          material: part.material || "",
          source_job: [proj.project_name, part.part_name || part.part_label, proj.job_id]
            .filter(Boolean)
            .join(" · "),
          tier: proj.sharing_tier || "Private",
        });
      }
    });
  });

  // ── Combine: manual first, then part-derived ──────────────────────────────
  const allLessons = [...manualLessons, ...partLessons];

  // ── Filter ────────────────────────────────────────────────────────────────
  const usedCats = [
    "All",
    ...CATEGORIES.filter((c) => allLessons.some((l) => l.category === c)),
    ...(partLessons.length > 0 && !CATEGORIES.includes("Other") ? [] : []),
  ].filter((v, i, a) => a.indexOf(v) === i);

  const filtered = allLessons.filter((l) => {
    const catOk = filterCat === "All" || l.category === filterCat;
    const q = search.toLowerCase();
    const textOk =
      !q ||
      l.title.toLowerCase().includes(q) ||
      l.desc.toLowerCase().includes(q) ||
      (l.process || "").toLowerCase().includes(q) ||
      (l.material || "").toLowerCase().includes(q) ||
      (l.source_job || "").toLowerCase().includes(q);
    return catOk && textOk;
  });

  return (
    <>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Sans:opsz,wght@9..40,400;9..40,500&family=IBM+Plex+Mono:wght@400;500&display=swap');`}</style>

      {modal && (
        <LessonModal
          initial={modal === "add" ? null : modal}
          onSave={modal === "add" ? handleAdd : handleEdit}
          onClose={() => setModal(null)}
          corpusSaved={corpusSaved}
        />
      )}

      {/* ── Page header ─────────────────────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: 18,
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div>
          <div
            style={{
              fontFamily: display,
              fontSize: 18,
              fontWeight: 700,
              color: C.ink,
              marginBottom: 4,
            }}
          >
            Quoting Lessons
          </div>
          <div
            style={{
              fontFamily: sans,
              fontSize: 12,
              color: C.inkMuted,
              lineHeight: 1.55,
              maxWidth: 560,
            }}
          >
            Capture cost surprises, time buffers, tolerance loops, and tooling
            charges from completed jobs. Private to your estimators — never
            shared externally.
          </div>
        </div>
        {/* ← THE FIX: standalone Add button, same as MfgLessons */}
        <button
          onClick={() => setModal("add")}
          style={{
            fontFamily: mono,
            fontSize: 11,
            fontWeight: 600,
            padding: "10px 20px",
            borderRadius: 6,
            border: "none",
            background: C.copper,
            color: "#fff",
            cursor: "pointer",
            letterSpacing: "0.05em",
            flexShrink: 0,
            whiteSpace: "nowrap",
          }}
        >
          + Add Quoting Lesson
        </button>
      </div>

      {/* ── Privacy banner ──────────────────────────────────────────────────── */}
      <div
        style={{
          padding: "10px 14px",
          marginBottom: 18,
          background: C.copperPale,
          border: "1px solid rgba(184,115,51,0.2)",
          borderLeft: `3px solid ${C.copper}`,
          borderRadius: 4,
          fontFamily: sans,
          fontSize: 12,
          color: C.inkSoft,
          lineHeight: 1.6,
        }}
      >
        ✎ &nbsp;Quoting lessons are <strong>private to your estimators</strong>{" "}
        — never shared with buyers or TrustBridge, regardless of project sharing
        tier.
      </div>

      {/* ── Source legend (shown when there are part-derived lessons) ─────── */}
      {partLessons.length > 0 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginBottom: 14,
            padding: "8px 12px",
            background: C.surface,
            border: `1px solid ${C.rule}`,
            borderRadius: 6,
          }}
        >
          <span
            style={{
              fontFamily: mono,
              fontSize: 9,
              color: C.inkMuted,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            Legend:
          </span>
          <span
            style={{
              fontFamily: mono,
              fontSize: 8,
              padding: "1px 5px",
              borderRadius: 2,
              background: C.copperPale,
              color: C.copper,
              border: "1px solid rgba(184,115,51,0.3)",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            From Part
          </span>
          <span style={{ fontFamily: sans, fontSize: 11, color: C.inkMuted }}>
            Auto-extracted from saved project parts (read-only)
          </span>
          <span
            style={{
              marginLeft: "auto",
              fontFamily: sans,
              fontSize: 11,
              color: C.inkMuted,
            }}
          >
            {manualLessons.length} manual · {partLessons.length} from parts
          </span>
        </div>
      )}

      {allLessons.length === 0 ? (
        <EmptyLessons onAdd={() => setModal("add")} />
      ) : (
        <>
          {/* ── Filter bar ────────────────────────────────────────────────── */}
          <div
            style={{
              display: "flex",
              gap: 10,
              marginBottom: 16,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search lessons…"
              style={{
                fontFamily: sans,
                fontSize: 12,
                color: C.ink,
                background: C.white,
                border: `1px solid ${C.rule}`,
                borderRadius: 5,
                padding: "7px 12px",
                outline: "none",
                width: 210,
              }}
            />
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
              {usedCats.map((cat) => {
                const active = filterCat === cat;
                const cs = cat === "All" ? null : catStyle(cat);
                return (
                  <button
                    key={cat}
                    onClick={() => setFilterCat(cat)}
                    style={{
                      fontFamily: mono,
                      fontSize: 9,
                      padding: "4px 10px",
                      borderRadius: 4,
                      border: `1px solid ${active && cs ? cs.border : active ? C.copper : C.rule}`,
                      background:
                        active && cs
                          ? cs.bg
                          : active
                            ? C.copperPale
                            : C.surface,
                      color:
                        active && cs
                          ? cs.color
                          : active
                            ? C.copper
                            : C.inkMuted,
                      cursor: "pointer",
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      fontWeight: active ? 600 : 400,
                    }}
                  >
                    {cat}
                    {cat !== "All" && (
                      <span style={{ marginLeft: 4, opacity: 0.6 }}>
                        ({allLessons.filter((l) => l.category === cat).length})
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <span
              style={{
                fontFamily: mono,
                fontSize: 9,
                color: C.inkMuted,
                marginLeft: "auto",
              }}
            >
              {filtered.length} lesson{filtered.length !== 1 ? "s" : ""}
            </span>
          </div>

          {/* ── List ──────────────────────────────────────────────────────── */}
          {filtered.length === 0 ? (
            <div
              style={{
                padding: "30px 20px",
                textAlign: "center",
                background: C.white,
                border: `1px solid ${C.rule}`,
                borderRadius: 8,
                fontFamily: sans,
                fontSize: 12,
                color: C.inkMuted,
              }}
            >
              No lessons match your search or filter.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {filtered.map((lesson) => (
                <LessonCard
                  key={lesson.id}
                  lesson={lesson}
                  onEdit={(l) => setModal(l)}
                  onDelete={handleDelete}
                  readOnly={lesson.source === "part"}
                />
              ))}
            </div>
          )}

          {/* ── Stats footer ──────────────────────────────────────────────── */}
          <div
            style={{
              marginTop: 16,
              padding: "10px 14px",
              background: C.surface,
              border: `1px solid ${C.rule}`,
              borderRadius: 6,
              fontFamily: mono,
              fontSize: 9,
              color: C.inkMuted,
              lineHeight: 1.8,
              letterSpacing: "0.02em",
              display: "flex",
              gap: 20,
              flexWrap: "wrap",
            }}
          >
            <span>
              Total: {allLessons.length} lesson
              {allLessons.length !== 1 ? "s" : ""}
            </span>
            {CATEGORIES.filter((c) =>
              allLessons.some((l) => l.category === c),
            ).map((c) => {
              const cs = catStyle(c);
              return (
                <span key={c} style={{ color: cs.color }}>
                  {c}: {allLessons.filter((l) => l.category === c).length}
                </span>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}
