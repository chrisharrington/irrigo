// logos.jsx — eight logo directions for Irrigo
// Each is presented on a brand-dark artboard. SVGs use the design system tokens
// (--accent, --grass-glow, --fg, --fg-muted). Glyphs sized in a 64-unit box so
// proportions are comparable across options.

// ─── Reusable bits ──────────────────────────────────────────────────────

const GLOW = 'drop-shadow(0 0 8px rgba(111, 227, 155, 0.55))';
const SOFT_GLOW = 'drop-shadow(0 0 12px rgba(111, 227, 155, 0.35))';

// Card frame — what each DCArtboard contains.
function LogoFrame({ children, caption, sub, layout = 'stack' }) {
  return (
    <div style={{
      width: '100%', height: '100%',
      background: 'var(--bg)',
      display: 'grid',
      gridTemplateRows: '1fr auto',
      color: 'var(--fg)',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* subtle brand glow in the corner */}
      <div style={{
        position: 'absolute', inset: 0,
        background: 'radial-gradient(circle at 15% 10%, rgba(111,227,155,0.05), transparent 50%)',
        pointerEvents: 'none',
      }} />
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '36px 28px 8px',
        position: 'relative',
        zIndex: 1,
      }}>
        <div style={{
          display: 'flex',
          flexDirection: layout === 'row' ? 'row' : 'column',
          alignItems: 'center',
          gap: layout === 'row' ? 14 : 16,
        }}>
          {children}
        </div>
      </div>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        padding: '12px 16px 14px',
        borderTop: '1px solid var(--hairline)',
        position: 'relative',
        zIndex: 1,
      }}>
        <div style={{ font: 'var(--num-sm)', color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.14em' }}>
          {caption}
        </div>
        <div style={{ font: 'var(--num-sm)', color: 'var(--fg-faint)' }}>{sub}</div>
      </div>
    </div>
  );
}

// Standard Bricolage wordmark used by the glyph-led options.
function Wordmark({ size = 30, color = 'var(--fg)' }) {
  return (
    <div style={{
      font: `600 ${size}px/1 var(--font-display)`,
      letterSpacing: '-0.025em',
      color,
    }}>Irrigo</div>
  );
}

// ─── Option 01 — ARC (refined sprinkler) ────────────────────────────────
// Direct evolution of the existing mark. Soil ellipse + dashed sprinkler arc
// + droplet at the apex of the spray. Orange stick removed; everything sits
// on a quiet green axis.

function L01_Arc({ s = 64 }) {
  return (
    <svg width={s} height={s} viewBox="0 0 64 64" fill="none" style={{ filter: SOFT_GLOW }}>
      <ellipse cx="32" cy="50" rx="22" ry="3.2" fill="#1B231F" stroke="#344239" strokeWidth="1" />
      <path d="M9 36 A 23 22 0 0 1 55 36" stroke="var(--accent)" strokeWidth="1.8"
            strokeLinecap="round" fill="none" strokeDasharray="2 3.6" />
      <path d="M32 36 L 32 47" stroke="var(--accent)" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M32 12 C 27 19, 27 26, 32 28 C 37 26, 37 19, 32 12 Z" fill="var(--accent)" />
    </svg>
  );
}

// ─── Option 02 — SPRAY (abstract dotted arcs) ───────────────────────────
// Three concentric dotted arcs fanning from a base anchor — the spray pattern
// stripped of any literal sprinkler. Reads as "broadcast" or "coverage".

function L02_Spray({ s = 64 }) {
  // Three arcs, dotted, sharing the same center bottom-anchor.
  const dotR = 1.4;
  const arcs = [
    { r: 14, dots: 5 },
    { r: 22, dots: 7 },
    { r: 30, dots: 9 },
  ];
  return (
    <svg width={s} height={s} viewBox="0 0 64 64" fill="none" style={{ filter: SOFT_GLOW }}>
      {/* anchor */}
      <rect x="30" y="48" width="4" height="4" fill="var(--accent)" />
      {arcs.map(({ r, dots }, ai) => {
        const spread = Math.PI * 0.78; // ~140°
        const start = -Math.PI / 2 - spread / 2;
        return Array.from({ length: dots }).map((_, i) => {
          const t = i / (dots - 1);
          const a = start + spread * t;
          const cx = 32 + Math.cos(a) * r;
          const cy = 50 + Math.sin(a) * r;
          const op = 0.4 + 0.6 * (1 - ai / arcs.length);
          return <circle key={`${ai}-${i}`} cx={cx} cy={cy} r={dotR} fill="var(--accent)" opacity={op} />;
        });
      })}
    </svg>
  );
}

// ─── Option 03 — DROP (the simplest) ────────────────────────────────────
// Just the droplet. Solid green, glowing. Pairs with the wordmark in a row
// lockup so the mark earns its keep at small sizes (favicon, app icon).

function L03_Drop({ s = 56 }) {
  return (
    <svg width={s} height={s} viewBox="0 0 64 64" fill="none" style={{ filter: GLOW }}>
      <path d="M32 8 C 22 22, 16 32, 16 40 A 16 16 0 0 0 48 40 C 48 32, 42 22, 32 8 Z" fill="var(--accent)" />
      {/* inner highlight */}
      <path d="M22 36 A 10 10 0 0 1 28 28" stroke="rgba(255,255,255,0.35)" strokeWidth="1.2" strokeLinecap="round" fill="none" />
    </svg>
  );
}

// ─── Option 04 — GAUGE (depletion arc) ──────────────────────────────────
// Quarter-to-three-quarter circular arc, like the depletion battery rolled
// into a circle. A small filled segment marks "where we are" — instrument
// energy, very on-brand for an operator app.

function L04_Gauge({ s = 64 }) {
  // 270° track using a circle + dashed strokes (more reliable than arc paths).
  // Track starts at upper-left (10:30), runs clockwise through bottom to
  // upper-right (1:30). Filled portion is ~60% of the track — a confident
  // "healthy moisture" indicator.
  const r = 21;
  const C = 2 * Math.PI * r;        // full circumference
  const TRACK = C * 0.75;            // 270° visible track
  const FILL = TRACK * 0.6;          // 60% of track is the live segment
  // Tip dot position: end of the filled segment.
  const endAngle = (225 + 0.6 * 270) * Math.PI / 180; // radians, CW from east
  const tipX = 32 + r * Math.cos(endAngle);
  const tipY = 32 + r * Math.sin(endAngle);
  return (
    <svg width={s} height={s} viewBox="0 0 64 64" fill="none" style={{ filter: SOFT_GLOW }}>
      {/* track — muted ring, 270° visible */}
      <circle cx="32" cy="32" r={r}
              fill="none" stroke="var(--ink-500)" strokeWidth="2.4"
              strokeDasharray={`${TRACK} ${C}`}
              transform="rotate(225 32 32)" />
      {/* filled segment — green */}
      <circle cx="32" cy="32" r={r}
              fill="none" stroke="var(--accent)" strokeWidth="2.4"
              strokeDasharray={`${FILL} ${C}`}
              transform="rotate(225 32 32)" />
      {/* tip dot */}
      <circle cx={tipX} cy={tipY} r="2.4" fill="var(--accent)" />
      {/* center droplet */}
      <path d="M32 22 C 28 28, 26 32, 26 35 A 6 6 0 0 0 38 35 C 38 32, 36 28, 32 22 Z" fill="var(--accent)" opacity="0.9" />
    </svg>
  );
}

// ─── Option 05 — DROPLET-i (wordmark) ───────────────────────────────────
// Lowercase irrigo. Both i-dots are replaced with bright green droplet shapes
// that glow. The wordmark itself is the logo — no separate glyph needed.

function L05_DropletI({ size = 54 }) {
  // We render the non-i letters normally and substitute a custom DropIGlyph
  // for each 'i' so we control the dot. Letterspacing is tight to match
  // Bricolage's natural fit.
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'flex-end',
      font: `600 ${size}px/1 var(--font-display)`,
      letterSpacing: '-0.025em',
      color: 'var(--fg)',
    }}>
      <DropIGlyph size={size} />
      <span>rr</span>
      <DropIGlyph size={size} />
      <span>go</span>
    </span>
  );
}

function DropIGlyph({ size }) {
  // Custom lowercase 'i': a sharp stem with a green teardrop dot floating
  // above. Dimensions are pegged to font-size in em-equivalents so it sits
  // nicely next to Bricolage at any scale.
  const w = size * 0.32;
  const stemW = Math.max(2, size * 0.105);
  const stemH = size * 0.58;
  const dotW = size * 0.21;
  const dotH = size * 0.27;
  return (
    <span style={{
      position: 'relative',
      display: 'inline-block',
      width: w,
      height: size,
      verticalAlign: 'baseline',
    }}>
      {/* stem */}
      <span style={{
        position: 'absolute',
        left: '50%',
        transform: 'translateX(-50%)',
        bottom: 0,
        width: stemW,
        height: stemH,
        background: 'var(--fg)',
      }} />
      {/* droplet dot */}
      <svg viewBox="0 0 12 16" style={{
        position: 'absolute',
        left: '50%',
        transform: 'translateX(-50%)',
        top: size * 0.10,
        width: dotW,
        height: dotH,
        filter: GLOW,
        overflow: 'visible',
      }}>
        <path d="M6 1 C 3.5 5, 2 8.5, 2 11 A 4 4 0 0 0 10 11 C 10 8.5, 8.5 5, 6 1 Z" fill="var(--accent)" />
      </svg>
    </span>
  );
}

// ─── Option 06 — IRRIGO. (period as drop) ──────────────────────────────
// Uppercase tight Bricolage, with a square green period that glows. Reads
// like a terminal command or a tight masthead.

function L06_Period() {
  return (
    <div style={{
      display: 'inline-flex',
      alignItems: 'flex-end',
      gap: '0.18em',
      font: '700 44px/1 var(--font-display)',
      letterSpacing: '-0.04em',
      color: 'var(--fg)',
    }}>
      <span>IRRIGO</span>
      <span style={{
        width: '0.22em', height: '0.22em',
        background: 'var(--accent)',
        marginBottom: '0.08em',
        filter: GLOW,
        display: 'inline-block',
      }} />
    </div>
  );
}

// ─── Option 07 — MONO (utility wordmark) ────────────────────────────────
// Geist Mono lowercase + a green block cursor. Maximum "operator tool" feel.
// Plays well next to the numeric columns elsewhere in the app.

function L07_Mono() {
  return (
    <div style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 4,
      font: '500 36px/1 var(--font-mono)',
      letterSpacing: '-0.02em',
      color: 'var(--fg)',
    }}>
      <span>irrigo</span>
      <span style={{
        width: '0.5em', height: '0.7em',
        background: 'var(--accent)',
        marginLeft: 2,
        filter: GLOW,
        animation: 'irblink 1.4s steps(2) infinite',
      }} />
    </div>
  );
}

// ─── Option 08 — TILE (monogram) ────────────────────────────────────────
// Sharp dark tile with a green sprinkler-arc glyph inside. Reads as an
// app icon — the form most users will encounter most often.

function L08_Tile() {
  return (
    <div style={{
      width: 92, height: 92,
      background: 'var(--ink-300)',
      border: '1px solid var(--ink-500)',
      boxShadow: '0 1px 0 rgba(255,255,255,0.05) inset, 0 12px 36px rgba(0,0,0,0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 4,
      position: 'relative',
    }}>
      {/* corner accent */}
      <div style={{
        position: 'absolute', top: 8, right: 8,
        width: 6, height: 6, background: 'var(--accent)', filter: GLOW,
      }} />
      <svg width="56" height="56" viewBox="0 0 64 64" fill="none" style={{ filter: SOFT_GLOW }}>
        <path d="M14 38 A 18 17 0 0 1 50 38" stroke="var(--accent)" strokeWidth="2.2"
              strokeLinecap="round" fill="none" strokeDasharray="2 3.6" />
        <path d="M32 14 C 27 21, 27 28, 32 30 C 37 28, 37 21, 32 14 Z" fill="var(--accent)" />
      </svg>
    </div>
  );
}

// ─── SPRAY FAMILY (15–19) ───────────────────────────────────────────────────
// Variations on Option 02 — the dotted-spray vocabulary. Same instrument
// feel; different geometries (wide broadcast, narrow jet, corner sweep,
// three-zone, top-down ring).

// Helper: lay out dots along arcs/rings.
function sprayDots({ cx, cy, arcs, baseDeg, spreadDeg, dotR = 1.3 }) {
  const out = [];
  arcs.forEach((arc, ai) => {
    const { r, n, op } = arc;
    const spread = spreadDeg * Math.PI / 180;
    const start = baseDeg * Math.PI / 180 - spread / 2;
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0.5 : i / (n - 1);
      // Full-ring rings: distribute evenly over 360 rather than t-fan.
      const a = spreadDeg >= 360
        ? (i / n) * 2 * Math.PI + (baseDeg * Math.PI / 180)
        : start + spread * t;
      out.push({
        x: cx + Math.cos(a) * r,
        y: cy + Math.sin(a) * r,
        op: op ?? (1 - ai * 0.18),
        key: `${ai}-${i}`,
        r: dotR,
      });
    }
  });
  return out;
}

function Dots({ dots }) {
  return dots.map((d) => (
    <circle key={d.key} cx={d.x} cy={d.y} r={d.r} fill="var(--accent)" opacity={d.op} />
  ));
}

// ─── Option 15 — SPRAY · WIDE ─────────────────────────────────────────────
// 180° broadcast, four arcs deep. Same anchor as Option 02 but the fan
// fills the upper hemisphere — reads as full-yard coverage.

function L15_SprayWide({ s = 64 }) {
  const dots = sprayDots({
    cx: 32, cy: 50, baseDeg: -90, spreadDeg: 180,
    arcs: [
      { r: 10, n: 7,  op: 1 },
      { r: 16, n: 9,  op: 0.78 },
      { r: 22, n: 11, op: 0.56 },
      { r: 28, n: 13, op: 0.36 },
    ],
  });
  return (
    <svg width={s} height={s} viewBox="0 0 64 64" fill="none" style={{ filter: SOFT_GLOW }}>
      <rect x="30" y="48" width="4" height="4" fill="var(--accent)" />
      <Dots dots={dots} />
    </svg>
  );
}

// ─── Option 16 — SPRAY · CONE ─────────────────────────────────────────────
// 60° narrow jet aimed straight up. Fewer dots, more punch. Reads as a
// targeted spray rather than a broad sprinkler.

function L16_SprayCone({ s = 64 }) {
  const dots = sprayDots({
    cx: 32, cy: 54, baseDeg: -90, spreadDeg: 60,
    arcs: [
      { r: 12, n: 3, op: 1 },
      { r: 20, n: 4, op: 0.7 },
      { r: 28, n: 5, op: 0.42 },
    ],
    dotR: 1.5,
  });
  return (
    <svg width={s} height={s} viewBox="0 0 64 64" fill="none" style={{ filter: SOFT_GLOW }}>
      <rect x="30" y="52" width="4" height="4" fill="var(--accent)" />
      <Dots dots={dots} />
    </svg>
  );
}

// ─── Option 17 — SPRAY · CORNER ────────────────────────────────────────────
// Asymmetric: anchor at the lower-left corner, fan sweeping up and to the
// right. The most kinetic of the family — implies a corner sprinkler
// firing across the yard.

function L17_SprayCorner({ s = 64 }) {
  const dots = sprayDots({
    cx: 12, cy: 52, baseDeg: -45, spreadDeg: 80,
    arcs: [
      { r: 14, n: 4, op: 1 },
      { r: 22, n: 6, op: 0.7 },
      { r: 30, n: 8, op: 0.42 },
      { r: 38, n: 10, op: 0.22 },
    ],
  });
  return (
    <svg width={s} height={s} viewBox="0 0 64 64" fill="none" style={{ filter: SOFT_GLOW }}>
      <rect x="10" y="50" width="4" height="4" fill="var(--accent)" />
      <Dots dots={dots} />
    </svg>
  );
}

// ─── Option 18 — SPRAY · TRIPLE ────────────────────────────────────────────
// Three small fans from three anchors — a direct reference to the
// three-zone product (North · South · East). All firing in sync.

function L18_SprayTriple({ s = 64 }) {
  const xs = [16, 32, 48];
  const fans = xs.map((cx, idx) => sprayDots({
    cx, cy: 50, baseDeg: -90, spreadDeg: 70,
    arcs: [
      { r: 6,  n: 3, op: idx === 1 ? 1 : 0.9 },
      { r: 11, n: 4, op: idx === 1 ? 0.78 : 0.6 },
      { r: 16, n: 5, op: idx === 1 ? 0.5 : 0.32 },
    ],
  }).map((d) => ({ ...d, key: `f${idx}-${d.key}` }))).flat();
  return (
    <svg width={s} height={s} viewBox="0 0 64 64" fill="none" style={{ filter: SOFT_GLOW }}>
      {xs.map((cx) => (
        <rect key={cx} x={cx - 1.6} y="48.4" width="3.2" height="3.2" fill="var(--accent)" />
      ))}
      <Dots dots={fans} />
    </svg>
  );
}

// ─── Option 19 — SPRAY · RING ─────────────────────────────────────────────
// Top-down: concentric rings of dots around a center anchor. Reads as
// rainfall coverage seen from above, or a circular irrigation pattern.
// (Different from Rotor 10 — no radial arms, just rings.)

function L19_SprayRing({ s = 64 }) {
  const dots = sprayDots({
    cx: 32, cy: 32, baseDeg: 0, spreadDeg: 360,
    arcs: [
      { r: 10, n: 8,  op: 1 },
      { r: 18, n: 14, op: 0.65 },
      { r: 26, n: 20, op: 0.35 },
    ],
  });
  return (
    <svg width={s} height={s} viewBox="0 0 64 64" fill="none" style={{ filter: SOFT_GLOW }}>
      {/* center anchor */}
      <rect x="30" y="30" width="4" height="4" fill="var(--accent)" />
      <Dots dots={dots} />
    </svg>
  );
}

// ─── Option 09 — PROFILE (soil cross-section) ──────────────────────────
// A small earth-block showing soil layers, with a droplet about to land and
// a green seep line tracing moisture descending past RAW. The most domain-
// specific glyph — speaks the brief's language directly.

function L09_Profile({ s = 64 }) {
  return (
    <svg width={s} height={s} viewBox="0 0 64 64" fill="none" style={{ filter: SOFT_GLOW }}>
      {/* soil block */}
      <rect x="14" y="24" width="36" height="32" fill="#0E1412" stroke="var(--ink-500)" strokeWidth="1" />
      {/* layer hairlines */}
      <line x1="14" y1="34" x2="50" y2="34" stroke="var(--ink-500)" strokeWidth="0.6" />
      <line x1="14" y1="44" x2="50" y2="44" stroke="var(--ink-500)" strokeWidth="0.6" />
      {/* droplet above the surface */}
      <path d="M32 6 C 28 12, 26 16, 26 19 A 6 6 0 0 0 38 19 C 38 16, 36 12, 32 6 Z" fill="var(--accent)" />
      {/* seep line — moisture descending into soil */}
      <path d="M32 25 L 32 52" stroke="var(--accent)" strokeWidth="1.4"
            strokeDasharray="1.5 2.4" strokeLinecap="round" />
    </svg>
  );
}

// ─── Option 10 — ROTOR (top-down sprinkler) ────────────────────────────
// A literal top-down view of a rotor sprinkler firing: a small head with
// dot-arms radiating outward. Different angle than the side-on Arc —
// suggests coverage from above (planner's view).

function L10_Rotor({ s = 64 }) {
  const arms = 6;
  const dotsPerArm = 4;
  return (
    <svg width={s} height={s} viewBox="0 0 64 64" fill="none" style={{ filter: SOFT_GLOW }}>
      {/* central head */}
      <circle cx="32" cy="32" r="3.6" fill="var(--accent)" />
      <circle cx="32" cy="32" r="6" stroke="var(--accent)" strokeWidth="1" fill="none" opacity="0.35" />
      {/* radiating dot arms */}
      {Array.from({ length: arms }).map((_, i) => {
        const angle = (i / arms) * 2 * Math.PI - Math.PI / 2;
        return Array.from({ length: dotsPerArm }).map((_, j) => {
          const r = 11 + j * 5;
          const x = 32 + Math.cos(angle) * r;
          const y = 32 + Math.sin(angle) * r;
          const op = 1 - j * 0.20;
          return <circle key={`${i}-${j}`} cx={x} cy={y} r="1.3" fill="var(--accent)" opacity={op} />;
        });
      })}
    </svg>
  );
}

// ─── Option 11 — BRACKET (single clean arc) ────────────────────────────
// One unbroken arc + droplet underneath. The arc reads as a sprinkler
// trace, a horizon, or a parenthesis. Maximum reduction of the arc family.

function L11_Bracket({ s = 64 }) {
  return (
    <svg width={s} height={s} viewBox="0 0 64 64" fill="none" style={{ filter: SOFT_GLOW }}>
      <path d="M 6 36 A 30 24 0 0 1 58 36" stroke="var(--accent)" strokeWidth="2.6"
            strokeLinecap="round" fill="none" />
      <path d="M32 30 C 28 36, 26 40, 26 43 A 6 6 0 0 0 38 43 C 38 40, 36 36, 32 30 Z" fill="var(--accent)" />
    </svg>
  );
}

// ─── Option 12 — PULSE (moisture sparkline) ────────────────────────────
// A small moisture chart: rain event spike, dry-down decline, current-value
// dot. Reads as data — the operator app's job condensed into 14 points.

function L12_Pulse({ s = 64 }) {
  return (
    <svg width={s} height={s} viewBox="0 0 64 64" fill="none" style={{ filter: SOFT_GLOW }}>
      {/* baseline (RAW reference) */}
      <line x1="6" y1="46" x2="58" y2="46" stroke="var(--ink-500)" strokeWidth="0.6" strokeDasharray="1.5 2" />
      {/* moisture curve: gentle climb, peak (rain), then dry-down */}
      <path d="M 6 38 L 14 34 L 22 18 L 30 24 L 38 30 L 46 36 L 54 42"
            stroke="var(--accent)" strokeWidth="2"
            strokeLinejoin="round" strokeLinecap="round" fill="none" />
      {/* current-value dot */}
      <circle cx="54" cy="42" r="2.6" fill="var(--accent)" />
    </svg>
  );
}

// ─── Option 13 — ZONES (nested arcs) ───────────────────────────────────
// Three concentric arcs at decreasing opacity, anchored at a single base
// point. Direct nod to the multi-zone product (North / South / East) and
// the way coverage radiates outward from each head.

function L13_Zones({ s = 64 }) {
  return (
    <svg width={s} height={s} viewBox="0 0 64 64" fill="none" style={{ filter: SOFT_GLOW }}>
      <path d="M 16 44 A 16 16 0 0 1 48 44" stroke="var(--accent)" strokeWidth="2.2"
            strokeLinecap="round" fill="none" />
      <path d="M 11 44 A 21 21 0 0 1 53 44" stroke="var(--accent)" strokeWidth="1.8"
            strokeLinecap="round" fill="none" opacity="0.7" />
      <path d="M 6 44 A 26 26 0 0 1 58 44" stroke="var(--accent)" strokeWidth="1.6"
            strokeLinecap="round" fill="none" opacity="0.45" />
      {/* base anchor */}
      <rect x="30" y="42" width="4" height="4" fill="var(--accent)" />
    </svg>
  );
}

// ─── Option 14 — SPROUT (blades + drop) ────────────────────────────────
// Three angled grass blades growing from a baseline, with a single drop
// above. The most botanical of the set — reads as "green things growing
// because of water".

function L14_Sprout({ s = 64 }) {
  return (
    <svg width={s} height={s} viewBox="0 0 64 64" fill="none" style={{ filter: SOFT_GLOW }}>
      {/* baseline */}
      <line x1="14" y1="50" x2="50" y2="50" stroke="var(--ink-500)" strokeWidth="0.8" />
      {/* three blades */}
      <path d="M 22 50 C 22 42, 20 34, 17 28" stroke="var(--accent)" strokeWidth="2"
            strokeLinecap="round" fill="none" />
      <path d="M 32 50 C 32 40, 32 30, 32 22" stroke="var(--accent)" strokeWidth="2"
            strokeLinecap="round" fill="none" />
      <path d="M 42 50 C 42 42, 44 34, 47 28" stroke="var(--accent)" strokeWidth="2"
            strokeLinecap="round" fill="none" />
      {/* droplet above */}
      <path d="M32 6 C 29 10, 27.5 13, 27.5 15.5 A 4.5 4.5 0 0 0 36.5 15.5 C 36.5 13, 35 10, 32 6 Z" fill="var(--accent)" />
    </svg>
  );
}

// ─── Canvas ─────────────────────────────────────────────────────────────

function App() {
  // Inject blink keyframes for the mono cursor.
  React.useEffect(() => {
    if (document.getElementById('ir-blink')) return;
    const s = document.createElement('style');
    s.id = 'ir-blink';
    s.textContent = '@keyframes irblink { 0%, 50% { opacity: 1 } 50.01%, 100% { opacity: 0.25 } }';
    document.head.appendChild(s);
  }, []);

  const W = 400;
  const H = 300;

  return (
    <DesignCanvas>
      <DCSection id="glyph" title="Glyph-led" subtitle="Icon + Irrigo wordmark. Works at favicon / app-icon scale.">

        <DCArtboard id="arc" label="01 · Arc — refined sprinkler" width={W} height={H} style={{ background: 'var(--bg)' }}>
          <LogoFrame caption="Arc" sub="sprinkler + drop">
            <L01_Arc s={72} />
            <Wordmark size={28} />
          </LogoFrame>
        </DCArtboard>

        <DCArtboard id="spray" label="02 · Spray — radar dots" width={W} height={H} style={{ background: 'var(--bg)' }}>
          <LogoFrame caption="Spray" sub="coverage pattern">
            <L02_Spray s={80} />
            <Wordmark size={28} />
          </LogoFrame>
        </DCArtboard>

        <DCArtboard id="drop" label="03 · Drop — minimal" width={W} height={H} style={{ background: 'var(--bg)' }}>
          <LogoFrame caption="Drop" sub="droplet only" layout="row">
            <L03_Drop s={56} />
            <Wordmark size={32} />
          </LogoFrame>
        </DCArtboard>

        <DCArtboard id="gauge" label="04 · Gauge — depletion arc" width={W} height={H} style={{ background: 'var(--bg)' }}>
          <LogoFrame caption="Gauge" sub="moisture instrument">
            <L04_Gauge s={80} />
            <Wordmark size={28} />
          </LogoFrame>
        </DCArtboard>

      </DCSection>

      <DCSection id="spray" title="Spray family" subtitle="Variations on Option 02 — same dotted vocabulary, different geometries.">

        <DCArtboard id="spray-wide" label="15 · Spray · Wide" width={W} height={H} style={{ background: 'var(--bg)' }}>
          <LogoFrame caption="Wide" sub="180° broadcast">
            <L15_SprayWide s={84} />
            <Wordmark size={28} />
          </LogoFrame>
        </DCArtboard>

        <DCArtboard id="spray-cone" label="16 · Spray · Cone" width={W} height={H} style={{ background: 'var(--bg)' }}>
          <LogoFrame caption="Cone" sub="60° narrow jet">
            <L16_SprayCone s={84} />
            <Wordmark size={28} />
          </LogoFrame>
        </DCArtboard>

        <DCArtboard id="spray-corner" label="17 · Spray · Corner" width={W} height={H} style={{ background: 'var(--bg)' }}>
          <LogoFrame caption="Corner" sub="diagonal sweep">
            <L17_SprayCorner s={84} />
            <Wordmark size={28} />
          </LogoFrame>
        </DCArtboard>

        <DCArtboard id="spray-triple" label="18 · Spray · Triple" width={W} height={H} style={{ background: 'var(--bg)' }}>
          <LogoFrame caption="Triple" sub="three zones firing">
            <L18_SprayTriple s={84} />
            <Wordmark size={28} />
          </LogoFrame>
        </DCArtboard>

        <DCArtboard id="spray-ring" label="19 · Spray · Ring" width={W} height={H} style={{ background: 'var(--bg)' }}>
          <LogoFrame caption="Ring" sub="top-down rings">
            <L19_SprayRing s={84} />
            <Wordmark size={28} />
          </LogoFrame>
        </DCArtboard>

      </DCSection>

      <DCSection id="glyph-2" title="Glyph-led · further" subtitle="More directions: soil, top-down, minimal, data, zones, botanical.">

        <DCArtboard id="profile" label="09 · Profile — soil cross-section" width={W} height={H} style={{ background: 'var(--bg)' }}>
          <LogoFrame caption="Profile" sub="soil + seep">
            <L09_Profile s={80} />
            <Wordmark size={28} />
          </LogoFrame>
        </DCArtboard>

        <DCArtboard id="rotor" label="10 · Rotor — top-down" width={W} height={H} style={{ background: 'var(--bg)' }}>
          <LogoFrame caption="Rotor" sub="top-down sprinkler">
            <L10_Rotor s={88} />
            <Wordmark size={28} />
          </LogoFrame>
        </DCArtboard>

        <DCArtboard id="bracket" label="11 · Bracket — single arc" width={W} height={H} style={{ background: 'var(--bg)' }}>
          <LogoFrame caption="Bracket" sub="one clean arc">
            <L11_Bracket s={84} />
            <Wordmark size={28} />
          </LogoFrame>
        </DCArtboard>

        <DCArtboard id="pulse" label="12 · Pulse — moisture chart" width={W} height={H} style={{ background: 'var(--bg)' }}>
          <LogoFrame caption="Pulse" sub="data sparkline">
            <L12_Pulse s={80} />
            <Wordmark size={28} />
          </LogoFrame>
        </DCArtboard>

        <DCArtboard id="zones" label="13 · Zones — nested arcs" width={W} height={H} style={{ background: 'var(--bg)' }}>
          <LogoFrame caption="Zones" sub="multi-zone coverage">
            <L13_Zones s={84} />
            <Wordmark size={28} />
          </LogoFrame>
        </DCArtboard>

        <DCArtboard id="sprout" label="14 · Sprout — blades + drop" width={W} height={H} style={{ background: 'var(--bg)' }}>
          <LogoFrame caption="Sprout" sub="grass + water">
            <L14_Sprout s={84} />
            <Wordmark size={28} />
          </LogoFrame>
        </DCArtboard>

      </DCSection>

      <DCSection id="wordmark" title="Wordmark-led" subtitle="The type carries the brand. No icon required.">

        <DCArtboard id="dropi" label="05 · Droplet-i" width={W} height={H} style={{ background: 'var(--bg)' }}>
          <LogoFrame caption="Droplet-i" sub="bricolage lowercase">
            <L05_DropletI />
          </LogoFrame>
        </DCArtboard>

        <DCArtboard id="period" label="06 · Period" width={W} height={H} style={{ background: 'var(--bg)' }}>
          <LogoFrame caption="Period" sub="IRRIGO + accent">
            <L06_Period />
          </LogoFrame>
        </DCArtboard>

        <DCArtboard id="mono" label="07 · Mono cursor" width={W} height={H} style={{ background: 'var(--bg)' }}>
          <LogoFrame caption="Mono" sub="utility terminal">
            <L07_Mono />
          </LogoFrame>
        </DCArtboard>

        <DCArtboard id="tile" label="08 · Tile — app icon" width={W} height={H} style={{ background: 'var(--bg)' }}>
          <LogoFrame caption="Tile" sub="app icon form" layout="row">
            <L08_Tile />
            <Wordmark size={30} />
          </LogoFrame>
        </DCArtboard>

      </DCSection>
    </DesignCanvas>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
