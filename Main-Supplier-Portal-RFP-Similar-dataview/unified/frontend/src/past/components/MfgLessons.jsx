import { useState } from "react";

const C = {
  ink: "#1B2D4F",
  inkSoft: "#2D4567",
  inkMuted: "#6B7F96",
  rule: "#CBD3DF",
  ruleLight: "#E2E8F0",
  surface: "#F2F4F8",
  white: "#FAFCFF",
  bg: "#E4E8F0",
  copper: "#B8920A",
  copperPale: "#F5F0DC",
  pass: "#1E5E3A",
  passBg: "#E6F4EC",
  warn: "#7A2E0E",
  warnBg: "#FDF3EC",
  red: "#C53030",
  redBg: "#FFF5F5",
  blue: "#1A3D5C",
  blueBg: "#E8EFF8",
};

const mono = "'IBM Plex Mono', monospace";
const display = "'Syne', sans-serif";
const sans = "'DM Sans', sans-serif";

const CATEGORIES = [
  "Fixturing",
  "Thermal",
  "Material",
  "Process",
  "Quality",
  "Setup",
  "Tooling",
  "Inspection",
  "Other",
];

const CAT_COLORS = {
  Fixturing: { color: "#1A3D5C", bg: "#EAF0F8", border: "rgba(26,61,92,0.2)" },
  Thermal: { color: "#7B2D00", bg: "#FEF3EC", border: "rgba(123,45,0,0.2)" },
  Material: { color: "#2E5C3E", bg: "#EAF4EE", border: "rgba(46,92,62,0.2)" },
  Process: { color: "#B87333", bg: "#F5EDE3", border: "rgba(184,115,51,0.25)" },
  Quality: { color: "#1A56DB", bg: "#EBF5FF", border: "rgba(26,86,219,0.2)" },
  Setup: { color: "#5B2D8E", bg: "#F3EEFF", border: "rgba(91,45,142,0.2)" },
  Tooling: { color: "#1A5C5C", bg: "#E8F6F6", border: "rgba(26,92,92,0.2)" },
  Inspection: { color: "#3D3D00", bg: "#FAFAEC", border: "rgba(61,61,0,0.2)" },
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

// ── Add / Edit Modal ──────────────────────────────────────────
function LessonModal({ initial, onSave, onClose, corpusSaved = [] }) {
  const blank = {
    category: "Process",
    title: "",
    desc: "",
    source_part: "",
    selected_project_key: "",
    selected_part_key: "",
  };
  const [form, setForm] = useState(initial || blank);
  const [errors, setErrors] = useState({});
  const projectOptions = corpusSaved.map((project, projectIndex) => {
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
      })),
    };
  });
  const selectedProject =
    projectOptions.find((project) => project.key === form.selected_project_key) ||
    null;
  const selectedPart =
    selectedProject?.parts.find((part) => part.key === form.selected_part_key) ||
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
      source_part: "",
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
      source_part: sourceLabel,
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
    onSave({ ...form, id: initial?.id || Date.now() });
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
          maxWidth: 520,
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
              {initial ? "Edit Lesson" : "Add Manufacturing Lesson"}
            </div>
            <div
              style={{
                fontFamily: mono,
                fontSize: 9,
                color: C.inkMuted,
                marginTop: 2,
              }}
            >
              Capture a specific, reusable process insight
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
          {/* category selector */}
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
              placeholder="e.g. Warm-up cycle required before datum bore"
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
              Description *
            </div>
            <textarea
              value={form.desc}
              onChange={(e) => set("desc", e.target.value)}
              placeholder="2–3 sentences of practical insight a machinist or estimator can apply to similar future work…"
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

          {/* source part */}
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
              Source Part / Job{" "}
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
              value={form.source_part}
              onChange={(e) => set("source_part", e.target.value)}
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

// ── Single lesson card ────────────────────────────────────────
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
            fontFamily: display,
            fontSize: 13,
            fontWeight: 700,
            color: C.ink,
            marginBottom: 5,
          }}
        >
          {lesson.title}
        </div>
        <div
          style={{
            fontFamily: sans,
            fontSize: 12,
            color: C.inkSoft,
            lineHeight: 1.65,
            marginBottom: lesson.source_part ? 8 : 0,
          }}
        >
          {lesson.desc}
        </div>
        {lesson.source_part && (
          <div
            style={{
              fontFamily: mono,
              fontSize: 9,
              color: C.inkMuted,
              letterSpacing: "0.03em",
            }}
          >
            ↳ {lesson.source_part}
          </div>
        )}
      </div>

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
                border: `1px solid rgba(197,48,48,0.3)`,
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
              border: `1px solid rgba(197,48,48,0.2)`,
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

// ── Empty state ───────────────────────────────────────────────
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
          border: `1px solid rgba(184,115,51,0.2)`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          margin: "0 auto 14px",
          fontSize: 22,
        }}
      >
        🔧
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
        No manufacturing lessons yet
      </div>
      <div
        style={{
          fontFamily: sans,
          fontSize: 12,
          color: C.inkMuted,
          maxWidth: 400,
          margin: "0 auto 22px",
          lineHeight: 1.65,
        }}
      >
        Capture fixturing tricks, thermal quirks, material gotchas, and process
        insights from completed jobs so your team can apply them to future work.
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

// ── Main ──────────────────────────────────────────────────────
export default function MfgLessons({
  lessons: externalLessons,
  setLessons: externalSetLessons,
  corpusSaved = [],
}) {
  const [internalLessons, setInternalLessons] = useState([]);
  const [modal, setModal] = useState(null); // null | "add" | lesson-object
  const [filterCat, setFilterCat] = useState("All");
  const [search, setSearch] = useState("");
  const lessons = externalLessons ?? internalLessons;
  const setLessons = externalSetLessons ?? setInternalLessons;

  function handleAdd(lesson) {
    setLessons((p) => [lesson, ...p]);
    setModal(null);
  }
  function handleEdit(updated) {
    setLessons((p) => p.map((l) => (l.id === updated.id ? updated : l)));
    setModal(null);
  }
  function handleDelete(id) {
    setLessons((p) => p.filter((l) => l.id !== id));
  }

  const partLessons = [];
  corpusSaved.forEach((project) => {
    (project.parts || []).forEach((part) => {
      const blocks = [];
      if (part.what_worked) blocks.push(`What worked: ${part.what_worked}`);
      if (part.what_didnt) blocks.push(`What did not work: ${part.what_didnt}`);
      if (!blocks.length) return;

      partLessons.push({
        id: `mfg_${project.id}_${part.part_id || part.part_label || partLessons.length}`,
        category: "Process",
        title: part.part_name || part.part_label || "Manufacturing lesson",
        desc: blocks.join("\n\n"),
        source_part: [project.project_name, part.part_name || part.part_label, project.job_id]
          .filter(Boolean)
          .join(" · "),
        source: "part",
      });
    });
  });

  const allLessons = [...lessons, ...partLessons];

  const usedCats = [
    "All",
    ...CATEGORIES.filter((c) => allLessons.some((l) => l.category === c)),
  ];

  const filtered = allLessons.filter((l) => {
    const catOk = filterCat === "All" || l.category === filterCat;
    const q = search.toLowerCase();
    const textOk =
      !q ||
      l.title.toLowerCase().includes(q) ||
      l.desc.toLowerCase().includes(q) ||
      (l.source_part || "").toLowerCase().includes(q);
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

      {/* page header */}
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
            Manufacturing Lessons
          </div>
          <div
            style={{
              fontFamily: sans,
              fontSize: 12,
              color: C.inkMuted,
              lineHeight: 1.55,
              maxWidth: 520,
            }}
          >
            Capture process insights, fixturing tricks, thermal behaviour, and
            material lessons from completed jobs. Private to your team — never
            shared externally.
          </div>
        </div>
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
          + Add MFG Lesson
        </button>
      </div>

      {/* privacy banner */}
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
        ✦ &nbsp;Manufacturing lessons are <strong>private to your team</strong>{" "}
        — never shared with buyers or TrustBridge regardless of project sharing
        tier.
      </div>

      {allLessons.length === 0 ? (
        <EmptyLessons onAdd={() => setModal("add")} />
      ) : (
        <>
          {/* filter bar */}
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
                width: 200,
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
                        ({lessons.filter((l) => l.category === cat).length})
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

          {/* list */}
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

          {/* stats footer */}
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
              Total: {allLessons.length} lesson{allLessons.length !== 1 ? "s" : ""}
            </span>
            {partLessons.length > 0 && <span>From projects: {partLessons.length}</span>}
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
