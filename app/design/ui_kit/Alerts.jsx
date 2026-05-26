// Irrigo — Alerts surface
//
// Two parts:
//   1. AlertBell — the header trigger. Replaces the refresh icon top-right.
//      Renders a count badge for unread items; no badge when zero.
//      Three count modes: 0 (hidden), 1–9 (number), 10+ (caps to "9+").
//      Severity tinting: if any unread item is danger, the badge is red;
//      otherwise amber for warn-only; otherwise green for info-only.
//
//   2. AlertsView — full-screen list opened when the bell is tapped.
//      Grouped by recency (New / Earlier today / This week / Older).
//      Each row has a tone strip on the left + monospace timestamp.

const { useState: useAlS } = React;

// ─── Data ───────────────────────────────────────────────────────────────────
// Realistic mix for a single-site residential controller.
// `t` is the absolute timestamp string we show. `bucket` keys the grouping.

const ALERTS_DATA = [
  {
    id: 'a1',
    tone: 'danger',
    unread: true,
    bucket: 'new',
    title: 'Controller unreachable',
    sub: 'Home Assistant has not responded since 14:02. Planner is paused.',
    t: '14:02',
    kind: 'CONNECTION',
  },
  {
    id: 'a2',
    tone: 'warn',
    unread: true,
    bucket: 'new',
    title: 'Forecast stale',
    sub: 'OpenWeather returned 504 on 3 fetches. Using fallback ET₀.',
    t: '13:47',
    kind: 'FORECAST',
  },
  {
    id: 'a3',
    tone: 'warn',
    unread: true,
    bucket: 'today',
    title: 'North · cycle 2 of 3 cut short',
    sub: 'Flow sensor reported 0.3 L/min for 41s. Cycle ended at 02:41.',
    t: '02:41',
    kind: 'RUN',
  },
  {
    id: 'a4',
    tone: 'info',
    unread: false,
    bucket: 'today',
    title: 'Tonight\'s plan re-evaluated',
    sub: '14.2 mm forecast in next 24h. Skipping North & South.',
    t: '06:14',
    kind: 'PLAN',
  },
  {
    id: 'a5',
    tone: 'info',
    unread: false,
    bucket: 'week',
    title: 'Manual run · South · 8.0 mm',
    sub: '3 × 16 min · finished 02:14.',
    t: 'Mon 23:21',
    kind: 'RUN',
  },
  {
    id: 'a6',
    tone: 'warn',
    unread: false,
    bucket: 'week',
    title: 'East past RAW · queued tonight',
    sub: 'Depletion 18.4 / 16 mm. First cycle at 22:30.',
    t: 'Sun 17:58',
    kind: 'DEPLETION',
  },
  {
    id: 'a7',
    tone: 'info',
    unread: false,
    bucket: 'older',
    title: 'Long-lived token rotated',
    sub: 'New token issued. Old token revoked on 2026-05-12.',
    t: 'May 12',
    kind: 'AUTH',
  },
  {
    id: 'a8',
    tone: 'info',
    unread: false,
    bucket: 'older',
    title: 'Profile switched · Maintenance',
    sub: 'Replaced "Spring growth". Re-plan ran on switch.',
    t: 'May 09',
    kind: 'PROFILE',
  },
];

// ─── Bell icon ──────────────────────────────────────────────────────────────
// `count`: 0 hides the badge. Caps display at 9+.
// `severity`: 'danger' | 'warn' | 'info' — drives badge color.
// `interactive`: render as a button with hover; off for static showcase cells.

function AlertBell({ count = 0, severity = 'info', size = 16, interactive = true }) {
  const display = count > 9 ? '9+' : String(count);
  const sevColor = severity === 'danger' ? 'var(--danger)'
                 : severity === 'warn'   ? 'var(--warn)'
                 : 'var(--accent)';
  const sevGlow  = severity === 'danger' ? 'rgba(255,107,123,0.55)'
                 : severity === 'warn'   ? 'rgba(255,190,107,0.55)'
                 : 'rgba(111,227,155,0.55)';

  const inner = (
    <span style={{ position: 'relative', display: 'inline-flex' }}>
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none"
        stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        {/* Bell silhouette — straight Irrigo line weight, no whimsy. */}
        <path d="M3.5 11.5 L 12.5 11.5 C 11.7 11, 11.3 10.2, 11.3 9 V 7 a 3.3 3.3 0 0 0 -6.6 0 v 2 c 0 1.2 -.4 2 -1.2 2.5 Z"/>
        <path d="M6.6 13.2 a 1.5 1.5 0 0 0 2.8 0"/>
        <path d="M8 3.4 V 2.4"/>
      </svg>
      {count > 0 && (
        <span style={{
          position: 'absolute',
          top: -5, right: -6,
          minWidth: 14, height: 14,
          padding: count > 9 ? '0 4px' : 0,
          borderRadius: 7,
          background: sevColor,
          color: '#06090A',
          font: '600 9px/14px var(--font-mono)',
          textAlign: 'center',
          letterSpacing: count > 9 ? '-0.02em' : 0,
          boxShadow: `0 0 0 2px var(--bg), 0 0 8px ${sevGlow}`,
          fontFeatureSettings: '"tnum"',
        }}>{display}</span>
      )}
    </span>
  );

  if (!interactive) return (
    <div style={{
      width: 40, height: 40, borderRadius: 'var(--r-2)',
      background: 'transparent', color: 'var(--fg)',
      display: 'grid', placeItems: 'center',
    }}>{inner}</div>
  );

  return (
    <button className="btn btn-icon btn-ghost"
      style={{ width: 40, height: 40 }}
      aria-label={count > 0 ? `${display} unread alerts` : 'Alerts'}>
      {inner}
    </button>
  );
}

// ─── Header showcase row ────────────────────────────────────────────────────
// Renders the live mobile header in three states. Standalone (not in device
// frame) so the bell + badge are big enough to read in the canvas.

function HeaderRow({ count, severity, label, sub }) {
  return (
    <div style={{
      width: 402,
      background: 'var(--bg)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--r-3)',
      overflow: 'hidden',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 16px',
      }}>
        <div style={{
          width: 40, height: 40, borderRadius: 'var(--r-2)',
          display: 'grid', placeItems: 'center', color: 'var(--fg)',
        }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <path d="M4 6 h 16"/><path d="M4 12 h 16"/><path d="M4 18 h 16"/>
          </svg>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <BrandGlyph size={24}/>
          <span style={{ font: '600 16px/1 var(--font-display)', letterSpacing: '-0.02em' }}>Irrigo</span>
        </div>
        <AlertBell count={count} severity={severity} />
      </div>
      <div style={{
        borderTop: '1px solid var(--hairline)',
        padding: '10px 16px',
        display: 'flex', gap: 12, alignItems: 'baseline',
      }}>
        <span style={{
          font: '500 10px/1 var(--font-body)',
          letterSpacing: '0.16em', textTransform: 'uppercase',
          color: 'var(--fg-muted)',
        }}>{label}</span>
        <span className="num-sm" style={{ color: 'var(--fg-dim)' }}>{sub}</span>
      </div>
    </div>
  );
}

function BrandGlyph({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 84 84" fill="none">
      <ellipse cx="42" cy="64" rx="32" ry="6" fill="#1B231F" stroke="#344239" strokeWidth="1.2"/>
      <path d="M10 46 A 32 30 0 0 1 74 46" stroke="#6FE39B" strokeWidth="2.4" strokeLinecap="round" fill="none" strokeDasharray="2.4 4"/>
      <path d="M42 46 L 42 60" stroke="#6FE39B" strokeWidth="2.4" strokeLinecap="round"/>
      <path d="M42 22 C 36 30, 36 38, 42 40 C 48 38, 48 30, 42 22 Z" fill="#6FE39B"/>
    </svg>
  );
}

// ─── Full alerts page ──────────────────────────────────────────────────────
// Rendered inside the iOS frame, replaces the current view.
// Filter chips at top, grouped list below.

function AlertsView({ empty = false, onBack }) {
  const [filter, setFilter] = useAlS('all');
  const visible = empty ? [] : (
    filter === 'unread' ? ALERTS_DATA.filter(a => a.unread) :
    filter === 'critical' ? ALERTS_DATA.filter(a => a.tone === 'danger' || a.tone === 'warn') :
    ALERTS_DATA
  );

  // Group respecting filter
  const groups = [
    { id: 'new',   label: 'New',           rows: visible.filter(a => a.bucket === 'new') },
    { id: 'today', label: 'Earlier today', rows: visible.filter(a => a.bucket === 'today') },
    { id: 'week',  label: 'This week',     rows: visible.filter(a => a.bucket === 'week') },
    { id: 'older', label: 'Older',         rows: visible.filter(a => a.bucket === 'older') },
  ].filter(g => g.rows.length > 0);

  const unreadCount = ALERTS_DATA.filter(a => a.unread).length;

  return (
    <div style={{
      background: 'var(--bg)', color: 'var(--fg)', height: '100%',
      display: 'flex', flexDirection: 'column',
      fontFamily: 'var(--font-body)', position: 'relative',
    }}>
      {/* Status bar gap */}
      <div style={{ height: 60 }}/>

      {/* Header — back, title, mark-all */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '4px 16px 14px', gap: 12,
      }}>
        <button
          className="btn btn-icon btn-ghost"
          onClick={onBack}
          aria-label="Back"
          style={{ width: 40, height: 40 }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 3 l -5 5 l 5 5"/>
          </svg>
        </button>
        <span style={{ font: '600 16px/1 var(--font-display)', letterSpacing: '-0.02em' }}>Alerts</span>
        <button
          disabled={empty || unreadCount === 0}
          style={{
            all: 'unset', cursor: empty || unreadCount === 0 ? 'not-allowed' : 'pointer',
            color: empty || unreadCount === 0 ? 'var(--fg-dim)' : 'var(--fg-soft)',
            font: '500 13px/1 var(--font-body)',
            padding: '10px 6px',
            opacity: empty || unreadCount === 0 ? 0.4 : 1,
          }}>
          Mark all read
        </button>
      </div>

      {/* Page heading + filter chips */}
      <div style={{ padding: '6px 20px 14px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <div className="eyebrow">
            {empty ? 'All clear' : `${unreadCount} unread · ${ALERTS_DATA.length} total`}
          </div>
          <div style={{
            font: '700 28px/1 var(--font-display)',
            letterSpacing: '-0.025em', marginTop: 8,
          }}>
            {empty ? 'Nothing to flag' : 'Recent alerts'}
          </div>
        </div>

        {!empty && (
          <div style={{ display: 'flex', gap: 6 }}>
            {[
              ['all',      'All',      ALERTS_DATA.length],
              ['unread',   'Unread',   unreadCount],
              ['critical', 'Critical', ALERTS_DATA.filter(a => a.tone === 'danger' || a.tone === 'warn').length],
            ].map(([id, label, n]) => {
              const active = filter === id;
              return (
                <button
                  key={id}
                  onClick={() => setFilter(id)}
                  style={{
                    all: 'unset', cursor: 'pointer',
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '7px 11px',
                    background: active ? 'var(--surface-2)' : 'transparent',
                    border: '1px solid ' + (active ? 'var(--border)' : 'var(--hairline)'),
                    color: active ? 'var(--fg)' : 'var(--fg-muted)',
                    font: '500 12px/1 var(--font-body)',
                    borderRadius: 4,
                  }}>
                  {label}
                  <span style={{
                    font: '500 11px/1 var(--font-mono)',
                    color: active ? 'var(--fg-soft)' : 'var(--fg-dim)',
                  }}>{n}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Body — grouped list or empty state */}
      <div style={{ flex: 1, overflow: 'auto', padding: '0 20px 24px' }}>
        {empty ? (
          <EmptyState/>
        ) : groups.length === 0 ? (
          <div style={{
            padding: '40px 0',
            color: 'var(--fg-muted)',
            font: '500 14px/1.4 var(--font-body)', textAlign: 'center',
          }}>
            No alerts match this filter.
          </div>
        ) : groups.map((g, gi) => (
          <div key={g.id} style={{ marginTop: gi === 0 ? 0 : 22 }}>
            <div style={{
              display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
              marginBottom: 8,
            }}>
              <span style={{
                font: '500 10px/1 var(--font-body)',
                letterSpacing: '0.16em', textTransform: 'uppercase',
                color: 'var(--fg-muted)',
              }}>{g.label}</span>
              <span className="num-sm" style={{ color: 'var(--fg-dim)' }}>{g.rows.length}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {g.rows.map(a => <AlertCard key={a.id} alert={a}/>)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Alert card ─────────────────────────────────────────────────────────────
// Left tone strip (3px), kind+time row, title, body. Unread items get a
// brighter title color and a small dot in the time row.

function AlertCard({ alert: a }) {
  const tone = a.tone;
  const toneColor = tone === 'danger' ? 'var(--danger)'
                  : tone === 'warn'   ? 'var(--warn)'
                  : 'var(--accent)';
  const toneTint  = tone === 'danger' ? 'rgba(255,107,123,0.06)'
                  : tone === 'warn'   ? 'rgba(255,190,107,0.05)'
                  : 'rgba(111,227,155,0.04)';

  return (
    <button style={{
      all: 'unset', cursor: 'pointer', display: 'block',
      background: a.unread
        ? `linear-gradient(180deg, ${toneTint}, transparent 70%), var(--surface)`
        : 'var(--surface)',
      border: '1px solid var(--border)',
      borderLeft: `3px solid ${toneColor}`,
      borderRadius: 4,
      padding: '12px 14px',
    }}>
      {/* Top row — kind tag + time + unread dot */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 6,
      }}>
        <span style={{
          font: '500 10px/1 var(--font-mono)',
          letterSpacing: '0.12em',
          color: toneColor,
        }}>{a.kind}</span>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          font: '500 11px/1 var(--font-mono)',
          color: 'var(--fg-dim)',
        }}>
          {a.t}
          {a.unread && (
            <span style={{
              width: 6, height: 6,
              background: toneColor,
              boxShadow: `0 0 6px ${toneColor === 'var(--danger)' ? 'rgba(255,107,123,0.6)' : toneColor === 'var(--warn)' ? 'rgba(255,190,107,0.6)' : 'rgba(111,227,155,0.6)'}`,
            }}/>
          )}
        </span>
      </div>

      {/* Title */}
      <div style={{
        font: '600 15px/1.2 var(--font-display)',
        letterSpacing: '-0.015em',
        color: a.unread ? 'var(--fg)' : 'var(--fg-soft)',
      }}>{a.title}</div>

      {/* Body */}
      <div className="body-sm" style={{
        color: 'var(--fg-muted)', marginTop: 5,
        textWrap: 'pretty',
      }}>{a.sub}</div>
    </button>
  );
}

// ─── Empty state ────────────────────────────────────────────────────────────
function EmptyState() {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      gap: 14, padding: '60px 20px 0',
      textAlign: 'center',
    }}>
      {/* Quiet, lit-from-below glyph — 'system is healthy' rather than 'no data' */}
      <div style={{
        width: 64, height: 64, borderRadius: 4,
        background: 'linear-gradient(180deg, rgba(111,227,155,0.06), transparent 70%), var(--surface)',
        border: '1px solid rgba(111,227,155,0.28)',
        display: 'grid', placeItems: 'center',
        color: 'var(--accent)',
      }}>
        <svg width="22" height="22" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 8.5 l 3 3 l 7 -7"/>
        </svg>
      </div>
      <div style={{
        font: '600 18px/1.2 var(--font-display)',
        letterSpacing: '-0.02em',
        color: 'var(--fg)',
      }}>No active alerts</div>
      <div className="body-sm" style={{ color: 'var(--fg-muted)', maxWidth: 280, textWrap: 'pretty' }}>
        Planner is healthy. The last 30 days of activity is in the log.
      </div>
      <button style={{
        all: 'unset', cursor: 'pointer',
        marginTop: 6,
        color: 'var(--fg-soft)',
        font: '500 13px/1 var(--font-body)',
        display: 'inline-flex', alignItems: 'center', gap: 6,
      }}>
        Open activity log
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M6 3 l 5 5 l -5 5"/></svg>
      </button>
    </div>
  );
}

Object.assign(window, { AlertBell, AlertsView, HeaderRow, ALERTS_DATA });
