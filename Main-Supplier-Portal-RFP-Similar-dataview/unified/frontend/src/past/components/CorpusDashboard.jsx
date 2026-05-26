import { useState, useEffect } from "react";

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
const API = (import.meta.env.VITE_API_BASE || "http://127.0.0.1:8000").replace(
  /\/+$/,
  "",
);

// ── primitives ────────────────────────────────────────────────────────────────
function Card({ children, style: s = {} }) {
  return (
    <div
      style={{
        background: C.white,
        border: `1px solid ${C.rule}`,
        borderRadius: 8,
        overflow: "hidden",
        boxShadow: "0 1px 4px rgba(20,28,36,0.07)",
        ...s,
      }}
    >
      {children}
    </div>
  );
}

function CardHead({ title, sub, right }) {
  return (
    <div
      style={{
        padding: "12px 16px",
        background: C.surface,
        borderBottom: `1px solid ${C.rule}`,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
      }}
    >
      <div>
        <div
          style={{
            fontFamily: display,
            fontSize: 13,
            fontWeight: 700,
            color: C.ink,
          }}
        >
          {title}
        </div>
        {sub && (
          <div
            style={{
              fontFamily: mono,
              fontSize: 9,
              color: C.inkMuted,
              marginTop: 2,
              letterSpacing: "0.03em",
            }}
          >
            {sub}
          </div>
        )}
      </div>
      {right}
    </div>
  );
}

function MonoLabel({ children, color }) {
  return (
    <div
      style={{
        fontFamily: mono,
        fontSize: 9,
        textTransform: "uppercase",
        letterSpacing: "0.07em",
        color: color || C.inkMuted,
      }}
    >
      {children}
    </div>
  );
}

function Bar({ pct, color, h = 4 }) {
  const [v, setV] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setV(pct), 200);
    return () => clearTimeout(t);
  }, [pct]);
  return (
    <div
      style={{
        height: h,
        background: C.ruleLight,
        borderRadius: 2,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          height: "100%",
          width: `${v}%`,
          background: color || C.copper,
          borderRadius: 2,
          transition: "width 0.6s cubic-bezier(.4,0,.2,1)",
        }}
      />
    </div>
  );
}

// ── progress ring ─────────────────────────────────────────────────────────────
function ProgressRing({ pct, size = 64, stroke = 5 }) {
  const r = (size - stroke * 2) / 2;
  const circ = 2 * Math.PI * r;
  const color = pct >= 80 ? C.pass : pct >= 50 ? C.copper : C.warn;
  return (
    <div
      style={{ position: "relative", width: size, height: size, flexShrink: 0 }}
    >
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={C.ruleLight}
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeDasharray={circ}
          strokeDashoffset={circ - (pct / 100) * circ}
          strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 0.6s ease" }}
        />
      </svg>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <span
          style={{ fontFamily: display, fontSize: 14, fontWeight: 700, color }}
        >
          {pct}
        </span>
      </div>
    </div>
  );
}

// ── stats compute ─────────────────────────────────────────────────────────────
function computeStats(saved) {
  const totalProjects = saved.length;
  const totalParts = saved.reduce((s, p) => s + (p.parts?.length || 0), 0);

  const attributed = saved.filter(
    (p) => p.sharing_tier === "Attributed",
  ).length;
  const anonymized = saved.filter(
    (p) => p.sharing_tier === "Anonymized",
  ).length;
  const priv = saved.filter((p) => p.sharing_tier === "Private").length;

  // flatten all parts across projects for analysis
  const allParts = saved.flatMap((proj) =>
    (proj.parts || []).map((pt) => ({
      ...pt,
      sharing_tier: proj.sharing_tier,
    })),
  );

  const partsWithOutcome = allParts.filter((pt) => pt.outcome).length;
  const partsWithWhatWorked = allParts.filter((pt) => pt.what_worked).length;
  const partsWithQuotingLesson = allParts.filter(
    (pt) => pt.quoting_lesson,
  ).length;

  // process diversity: unique process types
  const processSet = new Set();
  const processCounts = {};
  allParts.forEach((pt) => {
    const proc =
      pt.process?.split(".")?.[0]?.trim() || pt.process_primary || "";
    if (proc) {
      processSet.add(proc);
      processCounts[proc] = (processCounts[proc] || 0) + 1;
    }
  });
  const processDiversity = processSet.size; // unique process types

  // annotation completeness: parts that have outcome + what_worked + quoting_lesson
  const fullyAnnotated = allParts.filter(
    (pt) => pt.outcome && pt.what_worked && pt.quoting_lesson,
  ).length;

  // scoring breakdown (max 100)
  const baseScore = 10; // just for having any corpus
  const partsScore = Math.min(24, totalParts * 4); // up to 24 pts, 4 per part (cap at 6 parts)
  const attributedScore = Math.min(20, attributed * 10); // up to 20 pts
  const anonymizedScore = Math.min(6, anonymized * 3); // up to 6 pts
  const outcomeScore = Math.min(16, partsWithOutcome * 4); // up to 16 pts
  const annotationScore = Math.min(12, fullyAnnotated * 6); // up to 12 pts (full notes)
  const diversityScore = Math.min(12, processDiversity * 3); // up to 12 pts for process variety

  const score = Math.min(
    100,
    baseScore +
      partsScore +
      attributedScore +
      anonymizedScore +
      outcomeScore +
      annotationScore +
      diversityScore,
  );

  return {
    totalProjects,
    totalParts,
    partsWithOutcome,
    partsWithWhatWorked,
    partsWithQuotingLesson,
    fullyAnnotated,
    attributed,
    anonymized,
    priv,
    processCounts,
    processDiversity,
    score,
    // score breakdown for transparency
    scoreBreakdown: {
      base: baseScore,
      parts: partsScore,
      attributed: attributedScore,
      anonymized: anonymizedScore,
      outcomes: outcomeScore,
      annotations: annotationScore,
      diversity: diversityScore,
    },
  };
}

// ── column 1: match standing ──────────────────────────────────────────────────
function MatchStanding({ stats, savedCount, allCount }) {
  const pct = stats.score;
  const color = pct >= 80 ? C.pass : pct >= 50 ? C.copper : C.warn;

  return (
    <Card>
      <CardHead
        title="Match Standing"
        sub="vs. Buyer RFPs in your process mix"
      />

      <div style={{ padding: "16px 18px" }}>
        {/* score ring + number */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            marginBottom: 14,
          }}
        >
          <ProgressRing pct={pct} />
          <div>
            <div
              style={{
                fontFamily: display,
                fontSize: 32,
                fontWeight: 800,
                color,
                lineHeight: 1,
              }}
            >
              {pct}
            </div>
            <div
              style={{
                fontFamily: mono,
                fontSize: 9,
                color: C.inkMuted,
                marginTop: 3,
              }}
            >
              / 100 · Corpus Score
            </div>
            <div
              style={{
                fontFamily: mono,
                fontSize: 9,
                color: C.pass,
                marginTop: 2,
              }}
            >
              {savedCount > 0
                ? `↑ ${savedCount * 4} pts from saved projects`
                : "Save projects to increase score"}
            </div>
          </div>
        </div>
        <div
          style={{
            fontFamily: sans,
            fontSize: 12,
            color: C.inkMuted,
            lineHeight: 1.6,
            marginBottom: 12,
          }}
        >
          Score is driven by corpus coverage, outcome quality, and sharing tier.
          Attributed projects carry the highest weight.
        </div>
        {savedCount < allCount && (
          <div
            style={{
              padding: "8px 10px",
              background: C.passBg,
              border: `1px solid rgba(46,107,79,0.2)`,
              borderLeft: `3px solid ${C.pass}`,
              borderRadius: 4,
              fontFamily: sans,
              fontSize: 11,
              color: C.pass,
              lineHeight: 1.5,
            }}
          >
            ✦ Upgrading {allCount - savedCount} more project
            {allCount - savedCount > 1 ? "s" : ""} to Attributed would boost
            your match score.
          </div>
        )}

        {/* corpus stats */}
        <div
          style={{
            marginTop: 16,
            borderTop: `1px solid ${C.ruleLight}`,
            paddingTop: 14,
          }}
        >
          <MonoLabel>Corpus Stats</MonoLabel>
          <div
            style={{
              marginTop: 10,
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            {[
              { label: "Projects Ingested", val: stats.totalProjects },
              { label: "Parts with Outcomes", val: stats.partsWithOutcome },
              { label: "Attributed", val: stats.attributed },
              { label: "Anonymized", val: stats.anonymized },
              { label: "Private Only", val: stats.priv },
              { label: "Fully Annotated Parts", val: stats.fullyAnnotated },
              { label: "Process Types", val: stats.processDiversity },
            ].map((row) => (
              <div
                key={row.label}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span
                  style={{
                    fontFamily: mono,
                    fontSize: 10,
                    color: C.inkSoft,
                    letterSpacing: "0.02em",
                  }}
                >
                  {row.label}
                </span>
                <span
                  style={{
                    fontFamily: display,
                    fontSize: 13,
                    fontWeight: 700,
                    color: C.ink,
                  }}
                >
                  {row.val}
                </span>
              </div>
            ))}
          </div>
        </div>
        {/* Score Breakdown */}
        <div
          style={{
            marginTop: 16,
            borderTop: `1px solid ${C.ruleLight}`,
            paddingTop: 14,
          }}
        >
          <MonoLabel>Score Breakdown</MonoLabel>
          <div
            style={{
              marginTop: 10,
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            {[
              { label: "Base", val: stats.scoreBreakdown?.base, max: 10 },
              { label: "Parts", val: stats.scoreBreakdown?.parts, max: 24 },
              {
                label: "Attributed",
                val: stats.scoreBreakdown?.attributed,
                max: 20,
              },
              {
                label: "Anonymized",
                val: stats.scoreBreakdown?.anonymized,
                max: 6,
              },
              {
                label: "Outcomes",
                val: stats.scoreBreakdown?.outcomes,
                max: 16,
              },
              {
                label: "Full Notes",
                val: stats.scoreBreakdown?.annotations,
                max: 12,
              },
              {
                label: "Diversity",
                val: stats.scoreBreakdown?.diversity,
                max: 12,
              },
            ].map((row) => (
              <div key={row.label}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    marginBottom: 3,
                  }}
                >
                  <span
                    style={{
                      fontFamily: mono,
                      fontSize: 9,
                      color: C.inkMuted,
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                    }}
                  >
                    {row.label}
                  </span>
                  <span
                    style={{ fontFamily: mono, fontSize: 9, color: C.inkSoft }}
                  >
                    {row.val ?? 0} / {row.max}
                  </span>
                </div>
                <Bar
                  pct={Math.round(((row.val ?? 0) / row.max) * 100)}
                  color={C.copper}
                  h={3}
                />
              </div>
            ))}
          </div>
        </div>

        {/* sharing tier breakdown */}
        <div
          style={{
            marginTop: 16,
            borderTop: `1px solid ${C.ruleLight}`,
            paddingTop: 14,
          }}
        >
          <MonoLabel>Sharing Tier Breakdown</MonoLabel>
          <div
            style={{
              marginTop: 10,
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            {[
              {
                label: "Private",
                icon: "⊘",
                count: stats.priv,
                color: C.inkMuted,
              },
              {
                label: "Anonymized",
                icon: "~",
                count: stats.anonymized,
                color: C.blue,
              },
              {
                label: "Attributed",
                icon: "✦",
                count: stats.attributed,
                color: C.copper,
              },
            ].map((tier) => {
              const total = stats.totalProjects || 1;
              const p = Math.round((tier.count / total) * 100);
              return (
                <div key={tier.label}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      marginBottom: 3,
                    }}
                  >
                    <span
                      style={{
                        fontFamily: mono,
                        fontSize: 10,
                        color: tier.color,
                      }}
                    >
                      {tier.icon} {tier.label.toUpperCase()}
                    </span>
                    <span
                      style={{
                        fontFamily: mono,
                        fontSize: 10,
                        color: C.inkMuted,
                      }}
                    >
                      {tier.count} project{tier.count !== 1 ? "s" : ""} · {p}%
                    </span>
                  </div>
                  <Bar pct={p} color={tier.color} h={3} />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </Card>
  );
}

// ── column 2: process coverage + gaps ────────────────────────────────────────
function ProcessCoverage({ processCounts }) {
  const entries = Object.entries(processCounts).sort((a, b) => b[1] - a[1]);
  const maxVal = entries[0]?.[1] || 1;
  const gaps = entries
    .filter(([, c]) => c === 1)
    .map(([proc]) => ({
      name: proc,
      pct: 18,
      reason:
        "Only 1 job in corpus — thin coverage for buyer RFPs requiring this process",
    }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Card>
        <CardHead
          title="Process Coverage"
          sub="Jobs in corpus by process type"
        />
        <div
          style={{
            padding: "14px 18px",
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          {entries.length === 0 ? (
            <div
              style={{
                fontFamily: mono,
                fontSize: 10,
                color: C.inkMuted,
                textAlign: "center",
                padding: "16px 0",
              }}
            >
              Save projects to see process coverage
            </div>
          ) : (
            entries.map(([proc, count]) => {
              const barPct = Math.round((count / maxVal) * 100);
              return (
                <div key={proc}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      marginBottom: 4,
                    }}
                  >
                    <span
                      style={{
                        fontFamily: mono,
                        fontSize: 10,
                        color: C.ink,
                        textTransform: "uppercase",
                        letterSpacing: "0.04em",
                      }}
                    >
                      {proc}
                    </span>
                    <span
                      style={{
                        fontFamily: mono,
                        fontSize: 10,
                        color: C.inkMuted,
                      }}
                    >
                      {count} job{count !== 1 ? "s" : ""}
                    </span>
                  </div>
                  <Bar pct={barPct} color={C.copper} h={5} />
                </div>
              );
            })
          )}
        </div>
      </Card>

      <Card>
        <CardHead
          title="Coverage Gaps"
          sub="Processes with thin or no corpus"
          right={
            <span
              style={{
                fontFamily: mono,
                fontSize: 8,
                padding: "2px 7px",
                borderRadius: 2,
                background: C.warnBg,
                color: C.warn,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              Action Needed
            </span>
          }
        />
        <div
          style={{
            padding: "12px 18px",
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          {gaps.length === 0 ? (
            <div
              style={{
                padding: "10px 12px",
                background: C.passBg,
                border: `1px solid rgba(46,107,79,0.2)`,
                borderRadius: 6,
                fontFamily: sans,
                fontSize: 12,
                color: C.pass,
              }}
            >
              ✓ &nbsp;No thin-coverage processes detected.
            </div>
          ) : (
            <>
              {gaps.map((gap) => (
                <div
                  key={gap.name}
                  style={{ display: "flex", alignItems: "flex-start", gap: 10 }}
                >
                  <span
                    style={{
                      fontFamily: mono,
                      fontSize: 9,
                      padding: "2px 5px",
                      borderRadius: 2,
                      background: C.warnBg,
                      color: C.warn,
                      flexShrink: 0,
                    }}
                  >
                    {gap.pct}%
                  </span>
                  <div>
                    <div
                      style={{
                        fontFamily: mono,
                        fontSize: 10,
                        color: C.ink,
                        fontWeight: 500,
                      }}
                    >
                      {gap.name}
                    </div>
                    <div
                      style={{
                        fontFamily: sans,
                        fontSize: 11,
                        color: C.inkMuted,
                        marginTop: 2,
                      }}
                    >
                      {gap.reason}
                    </div>
                  </div>
                </div>
              ))}
              <div
                style={{
                  fontFamily: sans,
                  fontSize: 11,
                  color: C.inkMuted,
                  lineHeight: 1.6,
                  paddingTop: 4,
                  borderTop: `1px solid ${C.ruleLight}`,
                }}
              >
                Gaps reduce your score for RFPs requiring these process/material
                combinations. Adding even one job improves coverage
                significantly.
              </div>
            </>
          )}
        </div>
      </Card>
    </div>
  );
}

// ── column 3: RFP activity + nudges + sharing model ──────────────────────────
function RightColumn({ saved, stats }) {
  const nudges = [];
  if (saved.length === 0) {
    nudges.push({
      icon: "A",
      color: C.warn,
      text: "No projects saved yet — save projects from the Projects tab to build your match standing.",
      action: "Save projects →",
    });
  }
  if (stats.attributed < saved.length) {
    nudges.push({
      icon: "↑",
      color: C.copper,
      text: `${saved.length - stats.attributed} project(s) are Anonymized. Upgrading to Attributed adds +${(saved.length - stats.attributed) * 6} pts.`,
      action: "Upgrade tier →",
    });
  }
  if (saved.some((p) => p.parts?.some((pt) => !pt.what_worked))) {
    nudges.push({
      icon: "✎",
      color: C.inkMuted,
      text: "Some parts have no estimator notes — add quoting context to improve RFP match confidence.",
      action: "Add notes →",
    });
  }
  if (nudges.length === 0) {
    nudges.push({
      icon: "✓",
      color: C.pass,
      text: "Corpus is in great shape — all projects saved, attributed, and annotated.",
      action: null,
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Recent RFP Match Activity */}
      <Card>
        <CardHead
          title="Recent RFP Match Activity"
          sub="How your corpus is being used"
        />
        <div style={{ padding: "14px 16px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div
              style={{
                padding: "12px 14px",
                background: C.surface,
                border: `1px solid ${C.ruleLight}`,
                borderRadius: 6,
              }}
            >
              <div
                style={{
                  fontFamily: mono,
                  fontSize: 9,
                  color: C.inkMuted,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  marginBottom: 5,
                }}
              >
                Status
              </div>
              <div
                style={{
                  fontFamily: sans,
                  fontSize: 12,
                  color: C.inkSoft,
                  lineHeight: 1.6,
                }}
              >
                No RFP match activity yet. Once TrustBridge starts matching your
                corpus against buyer RFPs, activity will appear here.
              </div>
            </div>
            <div
              style={{
                padding: "10px 14px",
                background: C.copperPale,
                border: `1px solid rgba(184,115,51,0.2)`,
                borderLeft: `3px solid ${C.copper}`,
                borderRadius: 4,
                fontFamily: sans,
                fontSize: 11,
                color: C.inkSoft,
                lineHeight: 1.6,
              }}
            >
              ✦ &nbsp;Your corpus is being indexed. Buyer RFPs that match your
              process mix will surface here as they come in.
            </div>
          </div>
        </div>
      </Card>

      {/* Corpus Quality Nudges */}
      <Card>
        <CardHead title="Corpus Quality Nudges" />
        <div
          style={{
            padding: "12px 16px",
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          {nudges.map((n, i) => (
            <div
              key={i}
              style={{ display: "flex", alignItems: "flex-start", gap: 10 }}
            >
              <span
                style={{
                  fontFamily: mono,
                  fontSize: 11,
                  color: n.color,
                  width: 16,
                  flexShrink: 0,
                  marginTop: 1,
                }}
              >
                {n.icon}
              </span>
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    fontFamily: sans,
                    fontSize: 12,
                    color: C.inkSoft,
                    lineHeight: 1.55,
                  }}
                >
                  {n.text}
                </div>
                {n.action && (
                  <button
                    style={{
                      marginTop: 5,
                      fontFamily: mono,
                      fontSize: 9,
                      color: C.copper,
                      background: C.copperPale,
                      border: `1px solid rgba(184,115,51,0.25)`,
                      borderRadius: 3,
                      padding: "3px 8px",
                      cursor: "pointer",
                      letterSpacing: "0.04em",
                    }}
                  >
                    {n.action}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Sharing Model */}
      <Card>
        <CardHead title="Sharing Model" />
        <div
          style={{
            padding: "12px 16px",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          {[
            {
              icon: "⊘",
              key: "Private",
              desc: "Your team only — never leaves your account",
              active: false,
              color: C.inkMuted,
              bg: C.surface,
            },
            {
              icon: "~",
              key: "Anonymized",
              desc: "TrustBridge sees patterns — no attribution, no buyer access",
              active: true,
              color: C.blue,
              bg: C.blueBg,
            },
            {
              icon: "✦",
              key: "Attributed",
              desc: "Boosts your match standing — referenced with your name",
              active: true,
              color: C.copper,
              bg: C.copperPale,
            },
          ].map((t) => (
            <div
              key={t.key}
              style={{
                padding: "8px 12px",
                borderRadius: 6,
                background: t.active ? t.bg : C.surface,
                border: `1px solid ${t.active ? "rgba(0,0,0,0.08)" : C.rule}`,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  marginBottom: 2,
                }}
              >
                <span
                  style={{
                    fontFamily: mono,
                    fontSize: 11,
                    color: t.active ? t.color : C.inkMuted,
                  }}
                >
                  {t.icon}
                </span>
                <span
                  style={{
                    fontFamily: mono,
                    fontSize: 10,
                    color: t.active ? t.color : C.ink,
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                  }}
                >
                  {t.key}
                </span>
              </div>
              <div
                style={{ fontFamily: sans, fontSize: 11, color: C.inkMuted }}
              >
                {t.desc}
              </div>
            </div>
          ))}
          <div
            style={{
              fontFamily: sans,
              fontSize: 11,
              color: C.inkMuted,
              lineHeight: 1.6,
              marginTop: 4,
              paddingTop: 8,
              borderTop: `1px solid ${C.ruleLight}`,
            }}
          >
            Customer names are always anonymized in Anonymized + Attributed
            tiers. Lessons-learned fields marked Private are never shared
            regardless of project tier.
          </div>
        </div>
      </Card>
    </div>
  );
}

// ── empty state ───────────────────────────────────────────────────────────────
function EmptyDashboard() {
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
          fontFamily: display,
          fontSize: 18,
          fontWeight: 700,
          color: C.ink,
          marginBottom: 8,
        }}
      >
        Your corpus is empty
      </div>
      <div
        style={{
          fontFamily: sans,
          fontSize: 13,
          color: C.inkMuted,
          maxWidth: 400,
          margin: "0 auto 20px",
          lineHeight: 1.6,
        }}
      >
        Go to the <strong>Projects</strong> tab, drop a part image, fill in the
        details, and click <strong>"Save to Corpus →"</strong> to start building
        your match standing.
      </div>
      <div
        style={{
          display: "inline-flex",
          gap: 8,
          padding: "10px 16px",
          background: C.copperPale,
          border: `1px solid rgba(184,115,51,0.25)`,
          borderRadius: 6,
          fontFamily: mono,
          fontSize: 10,
          color: C.copper,
          letterSpacing: "0.04em",
        }}
      >
        ✦ Attributed projects carry the highest match weight
      </div>
    </div>
  );
}

// ── main ──────────────────────────────────────────────────────────────────────
export default function CorpusDashboard({ corpusSaved, supplierId = "", supplierEmail = "" }) {
  const [allProjects, setAllProjects] = useState([]);
  const [flashKey, setFlashKey] = useState(0);

  useEffect(() => {
    const sid = encodeURIComponent(supplierId || "");
    const semail = encodeURIComponent(supplierEmail || "");
    fetch(`${API}/projects?supplier_id=${sid}&supplier_email=${semail}&limit=200`)
      .then((r) => r.json())
      .then((d) => setAllProjects(d.projects || []))
      .catch(() => {});
  }, [supplierId, supplierEmail]);

  useEffect(() => {
    if (corpusSaved.length > 0) setFlashKey((k) => k + 1);
  }, [corpusSaved.length]);

  const stats = computeStats(corpusSaved);

  if (corpusSaved.length === 0) {
    return (
      <>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Sans:opsz,wght@9..40,400;9..40,500&family=IBM+Plex+Mono:wght@400;500&display=swap');`}</style>
        <EmptyDashboard />
      </>
    );
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Sans:opsz,wght@9..40,400;9..40,500&family=IBM+Plex+Mono:wght@400;500&display=swap');
        @keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
      `}</style>

      {/* saved banner */}
      <div
        key={flashKey}
        style={{
          padding: "10px 16px",
          background: C.passBg,
          border: `1px solid rgba(46,107,79,0.2)`,
          borderLeft: `3px solid ${C.pass}`,
          borderRadius: 6,
          marginBottom: 20,
          fontFamily: sans,
          fontSize: 12,
          color: C.pass,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          animation: "fadeIn 0.4s ease",
        }}
      >
        <span>
          ✓ &nbsp;
          <strong>
            {corpusSaved.length} project{corpusSaved.length > 1 ? "s" : ""}
          </strong>{" "}
          saved to corpus — match score updated
        </span>
        <span style={{ fontFamily: mono, fontSize: 10, color: C.pass }}>
          Score: {stats.score} / 100
        </span>
      </div>

      {/* 3-column grid matching screenshot */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "220px 1fr 260px",
          gap: 16,
          alignItems: "start",
        }}
      >
        <MatchStanding
          stats={stats}
          savedCount={corpusSaved.length}
          allCount={allProjects.length || corpusSaved.length}
        />
        <ProcessCoverage processCounts={stats.processCounts} />
        <RightColumn saved={corpusSaved} stats={stats} />
      </div>
    </>
  );
}
