import { useState } from "react";

const C = {
  ink: "#1B2D4F",
  inkMuted: "#6B7F96",
  rule: "#CBD3DF",
  surface: "#F2F4F8",
  white: "#FAFCFF",
  copper: "#B8920A",
};

const mono = "'IBM Plex Mono', monospace";
const display = "'Syne', sans-serif";
const sans = "'DM Sans', sans-serif";

function Pill({ label }) {
  return (
    <span
      style={{
        fontFamily: mono,
        fontSize: 9,
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        color: C.inkMuted,
        border: `1px solid ${C.rule}`,
        borderRadius: 999,
        padding: "3px 8px",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

function csvTags(input) {
  return String(input || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

export default function CapabilitiesTab({ profiles = [] }) {
  const [openId, setOpenId] = useState("");

  const rowStyle = (isOpen) => ({
    border: `1px solid ${isOpen ? C.copper : C.rule}`,
    borderRadius: 10,
    background: C.white,
    overflow: "hidden",
  });

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto" }}>
      {profiles.length === 0 ? (
        <div
          style={{
            border: `1px dashed ${C.rule}`,
            borderRadius: 10,
            background: C.white,
            padding: 24,
            textAlign: "center",
            color: C.inkMuted,
            fontFamily: sans,
            fontSize: 13,
          }}
        >
          No process profiles were found for this supplier yet.
        </div>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {profiles.map((p) => {
            const pid = p.id || `${p.name}_${p.process_profile_number}`;
            const isOpen = openId === pid;
            const certs = csvTags(p.certifications);
            return (
              <article
                key={pid}
                style={rowStyle(isOpen)}
              >
                <button
                  type="button"
                  onClick={() => setOpenId((prev) => (prev === pid ? "" : pid))}
                  style={{
                    width: "100%",
                    border: "none",
                    background: isOpen
                      ? "linear-gradient(180deg, #FFFFFF 0%, #F8FBFF 100%)"
                      : C.white,
                    padding: "12px 14px",
                    display: "grid",
                    gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr) auto",
                    alignItems: "center",
                    gap: 10,
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <div
                    style={{
                      minWidth: 0,
                    }}
                  >
                    <div
                      style={{
                        fontFamily: display,
                        fontSize: 16,
                        fontWeight: 700,
                        color: C.ink,
                        marginBottom: 2,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {p.name || "Process Profile"}
                    </div>
                    <div
                      style={{
                        fontFamily: mono,
                        fontSize: 10,
                        color: C.inkMuted,
                        textTransform: "uppercase",
                        letterSpacing: "0.06em",
                      }}
                    >
                      {p.process_profile_number || "No Number"}
                    </div>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 6,
                      justifyContent: "flex-start",
                    }}
                  >
                    {p.generic_process ? <Pill label={p.generic_process} /> : null}
                    {p.material_family ? <Pill label={p.material_family} /> : null}
                    {p.equipment_name ? <Pill label={p.equipment_name} /> : null}
                  </div>
                  <div
                    style={{
                      fontFamily: mono,
                      fontSize: 12,
                      color: C.inkMuted,
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                    }}
                  >
                    {isOpen ? "▲" : "▼"}
                  </div>
                </button>

                {isOpen ? (
                  <div style={{ borderTop: `1px solid ${C.rule}`, padding: 14 }}>
                    {p.record_image_url ? (
                      <img
                        src={p.record_image_url}
                        alt={p.name || "Process profile"}
                        style={{
                          width: "100%",
                          maxHeight: 240,
                          objectFit: "cover",
                          border: `1px solid ${C.rule}`,
                          borderRadius: 8,
                          marginBottom: 12,
                          display: "block",
                        }}
                      />
                    ) : null}

                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
                      {p.generic_process ? <Pill label={p.generic_process} /> : null}
                      {p.branded_process ? <Pill label={p.branded_process} /> : null}
                      {p.process_family ? <Pill label={p.process_family} /> : null}
                    </div>

                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr",
                        gap: "8px 12px",
                        fontFamily: sans,
                        fontSize: 12,
                        color: C.ink,
                        marginBottom: 10,
                      }}
                    >
                      <div><strong>Generic Name:</strong> {p.generic_name || "-"}</div>
                      <div><strong>Material:</strong> {p.material_name || "-"}</div>
                      <div><strong>Material Type:</strong> {p.material_type || "-"}</div>
                      <div><strong>Material Class:</strong> {p.material_class || "-"}</div>
                      <div><strong>Material Family:</strong> {p.material_family || "-"}</div>
                      <div><strong>Manufacturer:</strong> {p.manufacturer || "-"}</div>
                      <div><strong>Machine:</strong> {p.equipment_name || "-"}</div>
                    </div>

                    {p.equipment_link ? (
                      <div style={{ marginBottom: 10 }}>
                        <a
                          href={p.equipment_link}
                          target="_blank"
                          rel="noreferrer"
                          style={{
                            fontFamily: mono,
                            fontSize: 10,
                            color: C.copper,
                            letterSpacing: "0.04em",
                            textTransform: "uppercase",
                            textDecoration: "none",
                          }}
                        >
                          View Equipment Link
                        </a>
                      </div>
                    ) : null}

                    {certs.length > 0 ? (
                      <div style={{ marginBottom: 8 }}>
                        <div
                          style={{
                            fontFamily: mono,
                            fontSize: 10,
                            color: C.inkMuted,
                            textTransform: "uppercase",
                            letterSpacing: "0.06em",
                            marginBottom: 6,
                          }}
                        >
                          Certifications
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                          {certs.map((tag) => (
                            <Pill key={`${p.id}_${tag}`} label={tag} />
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
