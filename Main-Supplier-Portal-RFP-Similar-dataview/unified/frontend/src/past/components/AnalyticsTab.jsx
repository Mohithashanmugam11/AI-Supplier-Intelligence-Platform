const C = {
  ink: "#1B2D4F",
  inkSoft: "#2D4567",
  inkMuted: "#6B7F96",
  rule: "#CBD3DF",
  ruleLight: "#DDE3EE",
  surface: "#F2F4F8",
  white: "#FAFCFF",
  gold: "#B8920A",
  goldPale: "#F5F0DC",
  pass: "#1E5E3A",
  passBg: "#E6F4EC",
  passRule: "rgba(30,94,58,0.2)",
  warn: "#7A2E0E",
  warnBg: "#FDF0EB",
  warnRule: "rgba(122,46,14,0.25)",
  blue: "#1A3D5C",
  bluePale: "#E8EFF8",
};

const mono = "'IBM Plex Mono', monospace";
const display = "'Syne', sans-serif";
const sans = "'DM Sans', sans-serif";

function MiniBar({ pct, color }) {
  const clamped = Math.max(0, Math.min(100, Number(pct) || 0));
  return (
    <div style={{ height: 4, background: C.ruleLight, borderRadius: 2, overflow: "hidden" }}>
      <div style={{ height: "100%", width: `${clamped}%`, background: color, borderRadius: 2 }} />
    </div>
  );
}

function StatCard({ label, value, tone = "default" }) {
  const palette = {
    default: { color: C.ink, bg: C.white },
    gold: { color: C.gold, bg: C.goldPale },
    pass: { color: C.pass, bg: C.passBg },
    warn: { color: C.warn, bg: C.warnBg },
  }[tone] || { color: C.ink, bg: C.white };

  return (
    <div
      style={{
        background: C.white,
        border: `1px solid ${C.rule}`,
        borderRadius: 8,
        padding: "14px 16px",
        boxShadow: "0 1px 3px rgba(20,28,36,0.07)",
      }}
    >
      <div style={{ fontFamily: mono, fontSize: 9, textTransform: "uppercase", letterSpacing: "0.07em", color: C.inkMuted, marginBottom: 8 }}>
        {label}
      </div>
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          padding: "4px 8px",
          borderRadius: 6,
          background: palette.bg,
          color: palette.color,
          border: `1px solid ${tone === "pass" ? C.passRule : tone === "warn" ? C.warnRule : "rgba(184,146,10,0.2)"}`,
          fontFamily: mono,
          fontSize: 26,
          fontWeight: 600,
          lineHeight: 1,
        }}
      >
        {value}
      </div>
    </div>
  );
}

export default function AnalyticsTab({
  corpusSaved = [],
  mfgLessons = [],
  quotingLessons = [],
  processProfiles = [],
  corpusScore = 0,
}) {
  const allParts = corpusSaved.flatMap((p) => p.parts || []);
  const totalProjects = corpusSaved.length;
  const totalParts = allParts.length;
  const totalLessons = (mfgLessons?.length || 0) + (quotingLessons?.length || 0);
  const linkedLessons =
    (mfgLessons || []).filter((l) => (l.source_part || "").trim()).length +
    (quotingLessons || []).filter((l) => (l.source_job || "").trim()).length;

  const processCounts = {};
  allParts.forEach((part) => {
    const proc = (part.process_primary || part.process || "").split(".")[0].trim();
    if (!proc) return;
    processCounts[proc] = (processCounts[proc] || 0) + 1;
  });
  const sortedProcesses = Object.entries(processCounts).sort((a, b) => b[1] - a[1]);
  const processCoverage = sortedProcesses.slice(0, 6).map(([name, count]) => ({
    name,
    count,
    pct: totalParts ? Math.round((count / totalParts) * 100) : 0,
  }));

  const capabilityProcesses = new Set(
    (processProfiles || [])
      .map((p) => (p.generic_process || p.branded_process || p.process_family || "").trim())
      .filter(Boolean),
  );
  const capabilityGaps = [...capabilityProcesses].filter((proc) => !processCounts[proc]);

  const unsuccessful = allParts.filter((p) => {
    const o = (p.outcome || "").toLowerCase();
    return o && !o.includes("successful");
  }).length;

  const topProcess = processCoverage[0];
  const concentrationRisk = topProcess && topProcess.pct >= 70;
  const lessonLinkRate = totalLessons ? Math.round((linkedLessons / totalLessons) * 100) : 0;

  return (
    <div style={{ maxWidth: 1260, margin: "0 auto" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10, marginBottom: 20 }}>
        <StatCard label="Corpus Score" value={corpusScore} tone="gold" />
        <StatCard label="Projects" value={totalProjects} />
        <StatCard label="Lessons" value={totalLessons} tone={totalLessons > 0 ? "pass" : "default"} />
        <StatCard label="Coverage Gaps" value={capabilityGaps.length} tone={capabilityGaps.length > 0 ? "warn" : "pass"} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div style={{ background: C.white, border: `1px solid ${C.rule}`, borderRadius: 8, overflow: "hidden" }}>
          <div style={{ padding: "11px 16px", background: C.surface, borderBottom: `1px solid ${C.rule}`, fontFamily: display, fontSize: 13, fontWeight: 700 }}>
            Top Insights
          </div>
          <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ padding: "10px 12px", borderRadius: 6, background: lessonLinkRate < 60 ? C.warnBg : C.passBg, border: `1px solid ${lessonLinkRate < 60 ? C.warnRule : C.passRule}` }}>
              <div style={{ fontFamily: mono, fontSize: 8, textTransform: "uppercase", letterSpacing: "0.06em", color: lessonLinkRate < 60 ? C.warn : C.pass, marginBottom: 4 }}>
                Lesson Link Rate
              </div>
              <div style={{ fontSize: 12.5, color: C.inkSoft }}>
                {lessonLinkRate}% of lessons are linked to a source job/part ({linkedLessons}/{totalLessons || 0}).
              </div>
            </div>

            <div style={{ padding: "10px 12px", borderRadius: 6, background: concentrationRisk ? C.warnBg : C.bluePale, border: `1px solid ${concentrationRisk ? C.warnRule : "rgba(26,61,92,0.2)"}` }}>
              <div style={{ fontFamily: mono, fontSize: 8, textTransform: "uppercase", letterSpacing: "0.06em", color: concentrationRisk ? C.warn : C.blue, marginBottom: 4 }}>
                Process Mix
              </div>
              <div style={{ fontSize: 12.5, color: C.inkSoft }}>
                {topProcess
                  ? `${topProcess.name} is ${topProcess.pct}% of parts (${topProcess.count}/${totalParts || 0}).`
                  : "No process data available yet."}
              </div>
            </div>

            <div style={{ padding: "10px 12px", borderRadius: 6, background: unsuccessful > 0 ? C.warnBg : C.passBg, border: `1px solid ${unsuccessful > 0 ? C.warnRule : C.passRule}` }}>
              <div style={{ fontFamily: mono, fontSize: 8, textTransform: "uppercase", letterSpacing: "0.06em", color: unsuccessful > 0 ? C.warn : C.pass, marginBottom: 4 }}>
                Outcome Signal
              </div>
              <div style={{ fontSize: 12.5, color: C.inkSoft }}>
                {unsuccessful > 0
                  ? `${unsuccessful} part(s) recorded non-success outcomes. Capture lessons to strengthen future quotes.`
                  : "No non-success outcomes in current visible corpus."}
              </div>
            </div>
          </div>
        </div>

        <div style={{ background: C.white, border: `1px solid ${C.rule}`, borderRadius: 8, overflow: "hidden" }}>
          <div style={{ padding: "11px 16px", background: C.surface, borderBottom: `1px solid ${C.rule}`, fontFamily: display, fontSize: 13, fontWeight: 700 }}>
            Process Coverage
          </div>
          <div style={{ padding: "13px 16px" }}>
            {processCoverage.length === 0 ? (
              <div style={{ fontFamily: mono, fontSize: 10, color: C.inkMuted, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                No process coverage yet
              </div>
            ) : (
              processCoverage.map((pc) => (
                <div key={pc.name} style={{ marginBottom: 11 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                    <span style={{ fontFamily: mono, fontSize: 9, textTransform: "uppercase", color: C.inkSoft }}>
                      {pc.name}
                    </span>
                    <span style={{ fontFamily: mono, fontSize: 9, color: C.inkMuted }}>
                      {pc.pct}%
                    </span>
                  </div>
                  <MiniBar pct={pc.pct} color={pc.pct >= 70 ? C.gold : pc.pct >= 40 ? C.blue : C.inkMuted} />
                </div>
              ))
            )}
            {capabilityGaps.length > 0 && (
              <div style={{ marginTop: 12, padding: "9px 11px", background: C.warnBg, border: `1px solid ${C.warnRule}`, borderRadius: 5 }}>
                <div style={{ fontFamily: mono, fontSize: 8, color: C.warn, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>
                  Capability Gap
                </div>
                <div style={{ fontSize: 12, color: C.inkSoft, lineHeight: 1.5 }}>
                  Capability profiles exist but no project history yet for: {capabilityGaps.slice(0, 4).join(", ")}
                  {capabilityGaps.length > 4 ? "..." : ""}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
