// Irrigo — shared UI primitives used by the mobile app screens.
// Pulls visual rules from ../colors_and_type.css and ../components.css.

const { useState, useEffect, useRef } = React;

// ─── primitives ─────────────────────────────────────────────────────────────

function Badge({ tone = 'neutral', dot = true, children }) {
  const cls = tone === 'neutral' ? 'badge' : `badge badge--${tone}`;
  return (
    <span className={cls}>
      {dot && tone !== 'neutral-nodot' && <span className="dot" />}
      {children}
    </span>
  );
}

// SOIL-MOISTURE BATTERY — the marquee depletion visual.
// `pct` is depletion as % of the scale max (we use 1.25× RAW). `rawPct` is the notch position.
function Battery({ depletion, raw, tall = false }) {
  const scaleMax = Math.max(raw * 1.25, depletion + 4);
  const pct = Math.min(100, (depletion / scaleMax) * 100);
  const rawPct = (raw / scaleMax) * 100;
  let tone = 'ok';
  if (depletion >= raw) tone = 'danger';
  else if (depletion / raw > 0.8) tone = 'warn';
  return (
    <div
      className={`batt${tall ? ' batt--tall' : ''}`}
      data-tone={tone}
      style={{ '--pct': pct + '%', '--raw': rawPct + '%' }}
    >
      <div className="fill" />
      <div className="notch" />
    </div>
  );
}

// LAWN-PATCH icon used per zone. Slug picks a unique organic shape.
function LawnPatch({ slug = 'a', size = 28, tone = '#6FE39B' }) {
  const paths = {
    a: 'M4 8 C 6 4, 14 4, 18 8 C 22 6, 28 10, 28 16 C 28 22, 22 28, 16 28 C 8 28, 3 22, 4 16 C 4 12, 3 10, 4 8 Z',
    b: 'M5 7 C 9 3, 22 4, 26 9 C 30 14, 28 22, 22 27 C 14 30, 6 26, 4 18 C 3 13, 4 10, 5 7 Z',
    c: 'M6 9 C 4 5, 14 3, 20 5 C 26 8, 30 14, 26 20 C 24 26, 16 30, 10 26 C 4 22, 4 14, 6 9 Z',
  };
  const blades = [
    'M8 12 l1 -2', 'M11 10 l1 -2', 'M14 12 l1 -2', 'M17 10 l1 -2', 'M20 12 l1 -2',
    'M9 16 l1 -2', 'M13 16 l1 -2', 'M17 16 l1 -2', 'M21 16 l1 -2',
    'M11 20 l1 -2', 'M15 20 l1 -2', 'M19 20 l1 -2',
  ];
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" style={{ display: 'block' }}>
      <path d={paths[slug] || paths.a} fill={tone} fillOpacity={0.22} stroke={tone} strokeWidth="1.4" />
      {blades.map((d, i) => (
        <path key={i} d={d} stroke={tone} strokeWidth="1.2" strokeLinecap="round" opacity={0.95} />
      ))}
    </svg>
  );
}

// CYCLE STRIP — time-axis Gantt for one irrigation night.
//
// Props:
//   night = {
//     axisStart, axisEnd:  "HH:MM" — chart bounds (defaults 22:00 → 06:00)
//     sunset, sunrise:     "HH:MM" — actual sun moments
//     zones: [{ name, color, glow, cycles: [{ start: "HH:MM", durMin }] }]
//   }
//   variant: 'full' (default) | 'compact'
//
// All positions are computed from real times so the staccato fire-then-soak
// rhythm and the "no two zones overlap" rule are visible at a glance.
function CycleStrip({ night, variant = 'full' }) {
  const compact = variant === 'compact';
  const toMin = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
  const startMin = toMin(night.axisStart);
  const endMinRaw = toMin(night.axisEnd);
  // handle wrap past midnight
  const totalMin = endMinRaw > startMin ? endMinRaw - startMin : (endMinRaw + 24 * 60 - startMin);
  const pct = (hhmm) => {
    let m = toMin(hhmm);
    if (m < startMin) m += 24 * 60;
    return ((m - startMin) / totalMin) * 100;
  };
  const widthPct = (durMin) => (durMin / totalMin) * 100;

  // Hour ticks — every 1 hour for full, every 2 hours for compact.
  const stepH = compact ? 2 : 1;
  const ticks = [];
  const firstTick = Math.ceil(startMin / 60) * 60;
  for (let m = firstTick; m <= startMin + totalMin; m += stepH * 60) {
    const h = Math.floor(m / 60) % 24;
    ticks.push({ h, leftPct: ((m - startMin) / totalMin) * 100 });
  }

  const laneH = compact ? 16 : 20;
  const totalCycleMin = (z) => z.cycles.reduce((s, c) => s + c.durMin, 0);

  return (
    <div style={{ position: 'relative', userSelect: 'none' }}>
      {/* Legend — zones above the chart, never overlapping pulses */}
      <div style={{
        display: 'flex', flexWrap: 'wrap',
        gap: compact ? 10 : 16,
        marginBottom: 10,
      }}>
        {night.zones.map((z, i) => (
          <div key={i} style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            font: 'var(--num-sm)',
          }}>
            <span style={{
              width: 10, height: 10, borderRadius: 4,
              background: z.color,
              boxShadow: `0 0 8px ${z.glow}`,
            }} />
            <span style={{ color: 'var(--fg)', font: '500 12px/1 var(--font-body)' }}>{z.name}</span>
            <span style={{ color: 'var(--fg-muted)' }}>
              · {z.cycles.length} cycles · {totalCycleMin(z)} min
            </span>
          </div>
        ))}
      </div>

      {/* Hour axis */}
      <div style={{ position: 'relative', height: 16, marginBottom: 4 }}>
        {ticks.map((t, i) => {
          // anchor first/last tick to their edge to avoid clipping
          const isFirst = i === 0;
          const isLast = i === ticks.length - 1;
          return (
            <div key={i} style={{
              position: 'absolute',
              left: t.leftPct + '%',
              top: 0,
              transform: isFirst ? 'translateX(0)' : isLast ? 'translateX(-100%)' : 'translateX(-50%)',
              font: 'var(--num-sm)', color: 'var(--fg-dim)',
              fontFeatureSettings: '"tnum"',
              whiteSpace: 'nowrap',
            }}>
              {String(t.h).padStart(2, '0')}<span style={{ opacity: 0.5 }}>:00</span>
            </div>
          );
        })}
      </div>

      {/* Plot area */}
      <div style={{
        position: 'relative',
        padding: '10px 0',
        background: 'linear-gradient(90deg, rgba(216,198,144,0.05) 0%, transparent 12%, transparent 88%, rgba(216,198,144,0.05) 100%)',
        borderTop: '1px solid var(--hairline)',
        borderBottom: '1px solid var(--hairline)',
      }}>
        {/* hour grid lines */}
        {ticks.map((t, i) => (
          <div key={i} style={{
            position: 'absolute', left: t.leftPct + '%', top: 0, bottom: 0, width: 1,
            background: 'var(--hairline)', opacity: 0.55,
          }} />
        ))}

        {/* sunset / sunrise vertical lines */}
        <SunLine leftPct={pct(night.sunset)} />
        <SunLine leftPct={pct(night.sunrise)} />

        {/* zone lanes */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: compact ? 6 : 8, position: 'relative' }}>
          {night.zones.map((z, zi) => (
            <div key={zi} style={{ position: 'relative', height: laneH }}>
              <div style={{
                position: 'absolute', inset: 0,
                background: `linear-gradient(to right, transparent, ${z.color}10 30%, ${z.color}10 70%, transparent)`,
                borderRadius: 4,
                opacity: 0.55,
              }} />
              {z.cycles.map((c, ci) => (
                <div key={ci} style={{
                  position: 'absolute',
                  left: pct(c.start) + '%',
                  width: `max(${widthPct(c.durMin)}%, 6px)`,
                  top: 0, bottom: 0,
                  background: z.color,
                  borderRadius: 4,
                  boxShadow: `0 0 10px ${z.glow}, inset 0 1px 0 rgba(255,255,255,0.22)`,
                }} />
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Sun labels under the plot — paired to vertical lines */}
      <div style={{ position: 'relative', height: 16, marginTop: 6 }}>
        <SunLabel leftPct={pct(night.sunset)} kind="set" time={night.sunset} />
        <SunLabel leftPct={pct(night.sunrise)} kind="rise" time={night.sunrise} />
      </div>
    </div>
  );
}

function SunLine({ leftPct, kind }) {
  return (
    <div style={{
      position: 'absolute', left: leftPct + '%', top: 0, bottom: 0, width: 1,
      background: 'linear-gradient(to bottom, transparent, var(--moon-500), transparent)',
      opacity: 0.55,
    }} />
  );
}

function SunLabel({ leftPct, kind, time }) {
  const align = leftPct > 50 ? 'right' : 'left';
  return (
    <div style={{
      position: 'absolute', left: leftPct + '%', top: 0,
      transform: align === 'right' ? 'translateX(-100%)' : 'translateX(0)',
      display: 'inline-flex', alignItems: 'center', gap: 5,
      font: 'var(--num-sm)', color: 'var(--moon-500)',
      whiteSpace: 'nowrap',
    }}>
      <SunGlyph kind={kind} />
      <span>{kind === 'set' ? 'sunset' : 'sunrise'} {time}</span>
    </div>
  );
}

function SunGlyph({ kind }) {
  // Half-sun resting on horizon, with arrow showing direction of motion.
  return (
    <svg width="13" height="9" viewBox="0 0 13 9" fill="none">
      <path d="M1.5 8 a 5 5 0 0 1 10 0 Z" fill="currentColor" opacity="0.85" />
      <line x1="0" y1="8.5" x2="13" y2="8.5" stroke="currentColor" strokeWidth="0.8" opacity="0.6" />
      {kind === 'set'
        ? <path d="M6.5 2.5 v 3 M5 4 l 1.5 1.5 l 1.5 -1.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" fill="none" />
        : <path d="M6.5 5.5 v -3 M5 4 l 1.5 -1.5 l 1.5 1.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" fill="none" />
      }
    </svg>
  );
}

// ALERT ROW — used in the mobile activity feed.
function AlertRow({ tone, title, sub, when }) {
  const icon = tone === 'danger' ? '!' : tone === 'warn' ? '⚠' : 'i';
  return (
    <div className={`alert alert--${tone}`} style={{ marginBottom: 8 }}>
      <div className="icon">{icon}</div>
      <div className="body">
        <div className="ttl">{title}</div>
        {sub && <div className="sub">{sub}</div>}
      </div>
      {when && <div className="when">{when}</div>}
    </div>
  );
}

// Tiny SVG icons (Lucide-ish). Use these wherever a glyph is needed.
const Icon = {
  drop: (p) => <svg {...p} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"><path d="M8 1.5 C 4 6, 3 9, 3 11 a 5 5 0 0 0 10 0 C 13 9, 12 6, 8 1.5 Z"/></svg>,
  chevR: (p) => <svg {...p} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M6 3 l 5 5 l -5 5"/></svg>,
  chevL: (p) => <svg {...p} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M10 3 l -5 5 l 5 5"/></svg>,
  refresh: (p) => <svg {...p} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M13 8 a 5 5 0 1 1 -1.5 -3.5 M13 2 v 3 h -3"/></svg>,
  bell: (p) => <svg {...p} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M4 11 V 7 a 4 4 0 0 1 8 0 v 4 M3 11 h 10 M6.5 13 a 1.5 1.5 0 0 0 3 0"/></svg>,
  more: (p) => <svg {...p} viewBox="0 0 16 16" fill="currentColor"><circle cx="3" cy="8" r="1"/><circle cx="8" cy="8" r="1"/><circle cx="13" cy="8" r="1"/></svg>,
  play: (p) => <svg {...p} viewBox="0 0 16 16" fill="currentColor"><path d="M4 3 L 13 8 L 4 13 Z"/></svg>,
  zone: (p) => <svg {...p} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"><path d="M3 4 C 4 2, 12 2, 13 5 C 14 8, 12 12, 8 13 C 4 13, 2 9, 3 4 Z"/></svg>,
  cal: (p) => <svg {...p} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><rect x="2.5" y="3.5" width="11" height="10" rx="1.5"/><path d="M2.5 6 H 13.5 M5 2 v 3 M11 2 v 3"/></svg>,
  history: (p) => <svg {...p} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M2 8 a 6 6 0 1 0 2 -4.3 M2 3 v 3 h 3 M8 5 v 3 l 2 1.5"/></svg>,
  home: (p) => <svg {...p} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"><path d="M2.5 7.5 L 8 3 L 13.5 7.5 V 13 H 2.5 Z"/></svg>,
  menu: (p) => <svg {...p} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M2.5 4.5 H 13.5 M2.5 8 H 13.5 M2.5 11.5 H 9.5"/></svg>,
  x: (p) => <svg {...p} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M4 4 L 12 12 M12 4 L 4 12"/></svg>,
};

// ─── data ───────────────────────────────────────────────────────────────────

const ZONES = [
  { slug: 'north', name: 'North', grass: 'Fescue', area: 320, depletion: 27.4, raw: 32, rootM: 0.18, last: '2 nights ago · 14 mm', patch: 'a', color: '#6FE39B', glow: 'rgba(111,227,155,0.4)' },
  { slug: 'south', name: 'South', grass: 'Kentucky bluegrass', area: 180, depletion: 11.2, raw: 28, rootM: 0.22, last: 'last night · 9 mm', patch: 'b', color: '#7CD4FB', glow: 'rgba(124,212,251,0.4)' },
  { slug: 'east',  name: 'East',  grass: 'Ryegrass', area: 240, depletion: 34.1, raw: 30, rootM: 0.15, last: '4 nights ago · 11 mm', patch: 'c', color: '#FFBE6B', glow: 'rgba(255,190,107,0.4)' },
];

const SCHEDULES = [
  {
    slug: 'maintenance', name: 'Maintenance', active: true,
    daysCsv: 'Wed · Fri · Sun', window: '00:00–10:00',
    days: [false, false, true, false, true, false, true],
    note: 'Roots 0.20m · default depletion 0.45',
    rules: {
      endBySunrise: true,
      rootOverride: null,
      depletionFraction: 0.45,
      timeWindow: '00:00–10:00',
      allowedNights: 'Wed · Fri · Sun',
    },
    nextRun: { inLabel: '8h 14m', whenLabel: 'Friday · 00:23', zonesLabel: 'North → South' },
  },
  {
    slug: 'overseeding', name: 'Overseeding', active: false,
    daysCsv: 'Daily', window: '02:00–08:00',
    days: [true,true,true,true,true,true,true],
    note: 'Shallow 0.05m · frequent fires during germination',
    rules: {
      endBySunrise: true,
      rootOverride: 0.05,
      depletionFraction: 0.30,
      timeWindow: '02:00–08:00',
      allowedNights: 'Daily',
    },
  },
  {
    slug: 'autumn-taper', name: 'Autumn taper', active: false,
    daysCsv: 'Sun', window: '00:00–08:00',
    days: [false,false,false,false,false,false,true],
    note: 'Phasing irrigation out through Oct–Nov',
    rules: {
      endBySunrise: true,
      rootOverride: null,
      depletionFraction: 0.60,
      timeWindow: '00:00–08:00',
      allowedNights: 'Sun',
    },
  },
];

// Tonight's plan — bursty pattern, North first then South, ending by sunrise.
// Real times so the Gantt shows actual soak gaps.
const TONIGHT_NIGHT = {
  axisStart: '22:00',
  axisEnd: '06:00',
  sunset: '22:08',
  sunrise: '05:48',
  zones: [
    {
      name: 'North',
      color: '#6FE39B',
      glow: 'rgba(111,227,155,0.5)',
      cycles: [
        { start: '22:25', durMin: 15 },
        { start: '23:30', durMin: 15 },
        { start: '00:35', durMin: 15 },
        { start: '01:40', durMin: 15 },
        { start: '02:45', durMin: 15 },
        { start: '03:50', durMin: 15 },
      ],
    },
    {
      name: 'South',
      color: '#7CD4FB',
      glow: 'rgba(124,212,251,0.4)',
      cycles: [
        { start: '04:15', durMin: 14 },
        { start: '04:42', durMin: 14 },
        { start: '05:09', durMin: 14 },
        { start: '05:34', durMin: 14 },
      ],
    },
  ],
};

// 14-day timeline data — each day, each zone's planned cycles (or empty).
function buildForecast() {
  const today = new Date('2026-05-14T00:00:00');
  const days = [];
  // Pattern: North fires every 3rd day, South every 4th, East every 5th (offset).
  for (let i = 0; i < 14; i++) {
    const d = new Date(today); d.setDate(today.getDate() + i);
    const fires = [];
    if (i === 0) { fires.push({ z: 0, mm: 9 }); fires.push({ z: 1, mm: 6 }); }
    else if (i === 1) { /* skip - rain */ }
    else if ((i % 3) === 1) fires.push({ z: 0, mm: 7 });
    if ((i % 4) === 2) fires.push({ z: 1, mm: 6 });
    if ((i % 5) === 3) fires.push({ z: 2, mm: 8 });
    days.push({ date: d, fires, rain: i === 1 ? 6 : 0 });
  }
  return days;
}

Object.assign(window, {
  Badge, Battery, LawnPatch, CycleStrip, AlertRow, Icon,
  ZONES, SCHEDULES, TONIGHT_NIGHT, buildForecast,
});
