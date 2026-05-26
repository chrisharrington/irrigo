// Irrigo — App-load error view
//
// Shown full-screen when the app cannot establish a working session on launch.
// Voice (per README): loud, terse, actionable. Tell the operator the failure
// mode plainly. No apology copy. Manual retry only — the operator decides
// when to try again.

// Local copy of the brand glyph so this file can be rendered without
// loading Mobile.jsx.
function ErrBrandGlyph({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 84 84" fill="none">
      <ellipse cx="42" cy="64" rx="32" ry="6" fill="#1B231F" stroke="#344239" strokeWidth="1.2"/>
      <path d="M10 46 A 32 30 0 0 1 74 46" stroke="#6FE39B" strokeWidth="2.4" strokeLinecap="round" fill="none" strokeDasharray="2.4 4"/>
      <path d="M42 46 L 42 60" stroke="#6FE39B" strokeWidth="2.4" strokeLinecap="round"/>
      <path d="M42 22 C 36 30, 36 38, 42 40 C 48 38, 48 30, 42 22 Z" fill="#6FE39B"/>
    </svg>
  );
}

const ERR_SCENARIOS = {
  controller: {
    eyebrow: 'Connection lost',
    title: 'Controller unreachable',
    sub: 'No response from Home Assistant since 14:02. Planner paused, no zone can fire.',
    // Sample stack — the kind of thing that would land in the diagnostics
    // log. Kept short enough to read on one phone screen.
    stack: [
      'Error: connect ECONNREFUSED 192.168.1.42:8123',
      '    at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1611:16)',
      '    at HAClient.connect (planner/ha.js:142:23)',
      '    at retryWithBackoff (planner/retry.js:38:11)',
      '    at async PlannerBoot.connect (planner/boot.js:48:5)',
      '    at async App.mount (app/main.jsx:23:9)',
    ],
  },
};

function ErrSpinner({ size = 12 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none"
      style={{ animation: 'errSpin 0.9s linear infinite', flex: '0 0 ' + size + 'px' }}>
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeOpacity="0.22" strokeWidth="1.6"/>
      <path d="M14 8 a 6 6 0 0 0 -6 -6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none"/>
    </svg>
  );
}

// Props:
//   scenario: 'controller'
//   state:    'idle'     — waiting for manual retry
//             'retrying' — attempt in flight (spinner, Cancel button)
function ErrorView({ scenario = 'controller', state = 'idle' }) {
  const s = ERR_SCENARIOS[scenario];

  const toneColor = 'var(--danger)';
  const toneGlow  = 'rgba(255,107,123,0.45)';
  const toneWash  = 'rgba(255,107,123,0.16)';

  return (
    <div style={{
      background: 'var(--bg)', color: 'var(--fg)', height: '100%',
      display: 'flex', flexDirection: 'column',
      fontFamily: 'var(--font-body)', position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Vignette — the system "looks wrong". */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        background: `
          radial-gradient(ellipse 80% 50% at 100% -10%, ${toneWash}, transparent 60%),
          radial-gradient(ellipse 60% 40% at 0% 110%, ${toneWash}, transparent 60%)
        `,
      }}/>

      {/* Status-bar safe area */}
      <div style={{ height: 60 }}/>

      {/* Brand row — desaturated. The system can't talk to its peers, so it
          shouldn't pretend to look healthy. */}
      <div style={{
        display: 'flex', alignItems: 'center',
        padding: '4px 20px 14px',
        position: 'relative',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          opacity: 0.4, filter: 'grayscale(1)',
        }}>
          <ErrBrandGlyph size={22}/>
          <span style={{ font: '600 15px/1 var(--font-display)', letterSpacing: '-0.02em' }}>Irrigo</span>
        </div>
      </div>

      {/* Body */}
      <div style={{
        flex: 1, overflow: 'auto', padding: '6px 20px 22px',
        display: 'flex', flexDirection: 'column', gap: 18,
        position: 'relative',
      }}>
        {/* Hero — eyebrow + display headline + factual sub + stack */}
        <div style={{ marginTop: 12 }}>
          <div style={{
            font: '500 11px/1 var(--font-body)',
            letterSpacing: '0.18em', textTransform: 'uppercase',
            color: toneColor,
            display: 'inline-flex', alignItems: 'center', gap: 8,
          }}>
            <span style={{
              width: 5, height: 5, background: toneColor,
              boxShadow: `0 0 8px ${toneGlow}`,
            }}/>
            {s.eyebrow}
          </div>
          <div style={{
            font: '700 32px/1.04 var(--font-display)',
            letterSpacing: '-0.025em',
            marginTop: 12, textWrap: 'pretty',
          }}>{s.title}</div>
          <div className="body-sm" style={{
            color: 'var(--fg-soft)', marginTop: 10, textWrap: 'pretty',
          }}>{s.sub}</div>

          {/* Stack trace — mono, scrolls horizontally if a frame is long. */}
          {s.stack && (
            <div style={{
              marginTop: 16,
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--r-2)',
              padding: '10px 12px',
              overflowX: 'auto',
              WebkitOverflowScrolling: 'touch',
            }}>
              <pre style={{
                margin: 0,
                font: '500 10.5px/1.55 var(--font-mono)',
                color: 'var(--fg-dim)',
                whiteSpace: 'pre',
                fontFeatureSettings: '"tnum"',
              }}>
                {s.stack.map((line, i) => (
                  <div key={i} style={{
                    color: i === 0 ? toneColor : 'var(--fg-dim)',
                  }}>{line}</div>
                ))}
              </pre>
            </div>
          )}
        </div>

        {/* Action — pinned to bottom of scroll content */}
        <div style={{
          display: 'flex', flexDirection: 'column', gap: 12,
          marginTop: 'auto', paddingTop: 4,
        }}>
          {state === 'retrying' && (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              font: 'var(--num-sm)', minHeight: 16,
              color: 'var(--accent)',
            }}>
              <ErrSpinner size={11}/>
              <span>Contacting hass.local…</span>
            </div>
          )}

          <button className="btn btn-primary btn-lg" style={{ width: '100%' }}>
            {state === 'retrying' ? 'Cancel attempt' : 'Retry connection'}
          </button>
        </div>
      </div>

      <style>{`
        @keyframes errSpin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

Object.assign(window, { ErrorView, ERR_SCENARIOS });
