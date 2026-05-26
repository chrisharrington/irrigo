// Irrigo — Splash screen + app icons
//
// Mark: "Spray / radar dots" (originally L02 in the logo explorations).
// Three concentric dotted arcs fanning up from a square anchor; reads as
// coverage / broadcast / radar.
//
// Sized for the design tokens in ../colors_and_type.css — the mark always
// uses var(--accent) green so it inherits any future palette tweak.

// ─── Mark ───────────────────────────────────────────────────────────────────
// Renders into a 64-unit viewBox. `weight` lets us thicken dots at small
// sizes so the mark stays legible from favicon up to splash hero.
//
// `glow` controls the SVG drop-shadow filter — turned off for very small
// icons (favicon) where the blur halo destroys the silhouette.

function RadarMark({ size = 96, weight = 1, glow = true, color = 'var(--accent)' }) {
  const dotR = 1.4 * weight;
  // Anchor square (the "sprinkler" the arcs spray from)
  const anchorW = 4 * weight;
  const arcs = [
    { r: 14, n: 5, op: 1.0 },
    { r: 22, n: 7, op: 0.78 },
    { r: 30, n: 9, op: 0.55 },
  ];
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none"
      style={{
        filter: glow
          ? 'drop-shadow(0 0 14px rgba(111,227,155,0.55)) drop-shadow(0 0 3px rgba(111,227,155,0.45))'
          : 'none',
        display: 'block',
      }}>
      {/* Anchor */}
      <rect
        x={32 - anchorW / 2} y={50 - anchorW / 2}
        width={anchorW} height={anchorW}
        fill={color}
      />
      {/* Arcs of dots, fanning up ~140° */}
      {arcs.map(({ r, n, op }, ai) => {
        const spread = Math.PI * 0.78;
        const start = -Math.PI / 2 - spread / 2;
        return Array.from({ length: n }).map((_, i) => {
          const t = i / (n - 1);
          const a = start + spread * t;
          const cx = 32 + Math.cos(a) * r;
          const cy = 50 + Math.sin(a) * r;
          return (
            <circle
              key={`${ai}-${i}`}
              cx={cx} cy={cy} r={dotR}
              fill={color} opacity={op}
            />
          );
        });
      })}
    </svg>
  );
}

// ─── Splash screen ──────────────────────────────────────────────────────────
// Full bleed. Black canvas with a faint green radial gradient WASHED IN FROM
// THE EDGES (vignette inverted — corners glow, center is pure black). The
// mark sits dead center.
//
// `pulse` lights a slow expand-and-fade ring behind the icon — the system
// "tuning in". Default on; turn off for static screenshots.
//
// `showWordmark` adds an "Irrigo" wordmark beneath the icon for the variant
// with brand. The brief asks for icon-only; this is offered as an option.

function SplashScreen() {
  return (
    <div style={{
      position: 'relative',
      width: '100%', height: '100%',
      background: 'var(--bg)',
      overflow: 'hidden',
      display: 'grid', placeItems: 'center',
    }}>
      {/* Edge wash — green wash that lives at the corners and fades toward
          the center, leaving a pure black core where the mark sits. Faint. */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        background: `
          radial-gradient(ellipse 90% 70% at 50% 50%, transparent 45%, rgba(111,227,155,0.04) 88%, rgba(111,227,155,0.07) 100%),
          radial-gradient(circle at 0% 0%, rgba(111,227,155,0.045), transparent 55%),
          radial-gradient(circle at 100% 0%, rgba(111,227,155,0.035), transparent 50%),
          radial-gradient(circle at 0% 100%, rgba(111,227,155,0.035), transparent 55%),
          radial-gradient(circle at 100% 100%, rgba(111,227,155,0.045), transparent 50%)
        `,
      }}/>

      {/* Faint film grain — keeps the black from looking like dead pixels */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none', opacity: 0.04,
        background: 'radial-gradient(circle at 50% 50%, rgba(255,255,255,0.12), transparent 60%)',
        mixBlendMode: 'overlay',
      }}/>

      {/* Mark + wordmark + spinner */}
      <div style={{
        position: 'relative',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', gap: 28,
      }}>
        <RadarMark size={140} weight={1.2}/>

        <span style={{
          font: '600 28px/1 var(--font-display)',
          letterSpacing: '-0.025em',
          color: 'var(--fg)',
        }}>Irrigo</span>

        {/* Loading spinner — sits beneath the wordmark with breathing room.
            Sized small; this is a hint that the app is doing work, not the
            focal point. */}
        <SplashSpinner size={22}/>
      </div>

      <style>{`
        @keyframes irrigoSpin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

function SplashSpinner({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none"
      style={{
        animation: 'irrigoSpin 1s linear infinite',
        display: 'block',
        filter: 'drop-shadow(0 0 6px rgba(111,227,155,0.45))',
      }}>
      <circle cx="8" cy="8" r="6"
        stroke="rgba(111,227,155,0.18)" strokeWidth="1.4"/>
      <path d="M14 8 a 6 6 0 0 0 -6 -6"
        stroke="var(--accent)" strokeWidth="1.4" strokeLinecap="round"
        fill="none"/>
    </svg>
  );
}

// ─── App-icon tile ──────────────────────────────────────────────────────────
// `size` is the rendered pixel size. `radius` controls platform shape:
//   - iOS uses ~22.37% squircle (we approximate with border-radius)
//   - Android adaptive uses circle / round-rect / squircle masks
//   - 'sharp' is the in-app variant (no rounding)
//
// Background uses the system bg (ink-100 / pure black). A faint green inner
// glow lifts the mark off the substrate at every size.

function AppIconTile({ size = 180, radius = 'ios', label, sub }) {
  const r = radius === 'ios' ? size * 0.2237
          : radius === 'circle' ? size / 2
          : radius === 'round' ? size * 0.16
          : 0;

  // Mark scale: ~58% of tile keeps safe-area on iOS. For circle (Android
  // maskable round), pull in slightly to clear the mask.
  const markScale = radius === 'circle' ? 0.50 : 0.58;
  const markSize = size * markScale;
  // Below a certain raster size, kill the glow filter so the silhouette stays
  // crisp. Roughly: <72px tiles get a hard-edged mark.
  const glow = size >= 72;
  // And bump dot weight on tiny tiles.
  const weight = size <= 48 ? 1.8 : size <= 96 ? 1.3 : 1.1;

  return (
    <div style={{
      position: 'relative',
      width: size, height: size,
      borderRadius: r,
      background: '#020403',
      // Subtle inner border to suggest a physical tile edge on the canvas.
      boxShadow: `
        0 0 0 1px rgba(111,227,155,0.08) inset,
        0 1px 0 rgba(255,255,255,0.04) inset,
        0 ${size * 0.04}px ${size * 0.12}px rgba(0,0,0,0.6)
      `,
      overflow: 'hidden',
      display: 'grid', placeItems: 'center',
      flex: '0 0 ' + size + 'px',
    }}>
      {/* Edge glow */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        background: `
          radial-gradient(circle at 50% 100%, rgba(111,227,155,0.16), transparent 60%),
          radial-gradient(circle at 50% 0%,  rgba(111,227,155,0.05), transparent 60%)
        `,
      }}/>
      {/* Corner accent — micro-detail at large sizes only */}
      {size >= 144 && (
        <span style={{
          position: 'absolute',
          top: size * 0.085, right: size * 0.085,
          width: size * 0.035, height: size * 0.035,
          background: 'var(--accent)',
          boxShadow: '0 0 8px rgba(111,227,155,0.6)',
        }}/>
      )}
      <RadarMark size={markSize} weight={weight} glow={glow}/>
    </div>
  );
}

// ─── Showcase row helpers ───────────────────────────────────────────────────
function IconCard({ size, radius, label, sub }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 10,
      alignItems: 'center',
    }}>
      <AppIconTile size={size} radius={radius}/>
      <div style={{ textAlign: 'center' }}>
        <div style={{
          font: '500 11px/1 var(--font-mono)',
          color: 'var(--fg)',
          letterSpacing: '0.04em',
        }}>{label}</div>
        <div style={{
          font: '500 10px/1 var(--font-body)',
          color: 'var(--fg-dim)',
          marginTop: 4,
          letterSpacing: '0.04em',
        }}>{sub}</div>
      </div>
    </div>
  );
}

// Mock iOS home-screen plate — the icon in situ. Shows the icon at typical
// home-screen scale (~60pt rendered larger) on a desaturated wallpaper.
function HomeScreenContext() {
  // Fake icon grid neighbors so our tile sits in a believable row.
  const neighbors = [
    { c: '#2A3942', g: '#8A9DB0' },
    { c: '#3D2A33', g: '#C29CAF' },
    null, // ← Irrigo lives here
    { c: '#2E3A2A', g: '#AEC09C' },
  ];
  return (
    <div style={{
      width: '100%', height: '100%',
      background: `
        radial-gradient(ellipse at 30% 20%, rgba(111,227,155,0.06), transparent 50%),
        linear-gradient(180deg, #0A0F0C, #06090A 70%)
      `,
      padding: 30,
      display: 'flex', flexDirection: 'column', gap: 24,
      position: 'relative',
    }}>
      {/* Status bar */}
      <div style={{
        display: 'flex', justifyContent: 'space-between',
        font: '600 13px/1 var(--font-mono)',
        color: 'var(--fg)',
        opacity: 0.85,
      }}>
        <span>9:41</span>
        <span>·  ·  ·</span>
      </div>

      {/* Icon row */}
      <div style={{
        display: 'flex', gap: 16, justifyContent: 'center',
        marginTop: 20,
      }}>
        {neighbors.map((n, i) => n ? (
          <div key={i} style={{
            width: 72, height: 72,
            borderRadius: 16,
            background: n.c,
            position: 'relative',
            boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
          }}>
            <div style={{
              position: 'absolute', top: 18, left: 18,
              width: 36, height: 36, borderRadius: 18,
              background: n.g, opacity: 0.55,
            }}/>
          </div>
        ) : (
          <AppIconTile key={i} size={72} radius="ios"/>
        ))}
      </div>

      {/* Labels */}
      <div style={{
        display: 'flex', gap: 16, justifyContent: 'center',
        font: '500 11px/1 var(--font-body)',
        color: 'var(--fg)',
      }}>
        <span style={{ width: 72, textAlign: 'center', opacity: 0.55 }}>Mail</span>
        <span style={{ width: 72, textAlign: 'center', opacity: 0.55 }}>Photos</span>
        <span style={{ width: 72, textAlign: 'center', color: 'var(--fg)' }}>Irrigo</span>
        <span style={{ width: 72, textAlign: 'center', opacity: 0.55 }}>Garden</span>
      </div>
    </div>
  );
}

Object.assign(window, {
  RadarMark, SplashScreen, AppIconTile, IconCard, HomeScreenContext,
});
