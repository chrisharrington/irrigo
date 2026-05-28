// Irrigo — Mobile App
// Multi-view container rendered inside IOSDevice. Tabs: Home, Zone detail, Schedule.

const { useState: useS } = React;

function MobileApp() {
  const [view, setView] = useS({ name: 'home' });
  const [scheduleSlug, setScheduleSlug] = useS('maintenance');
  const [confirmFire, setConfirmFire] = useS(null);
  const [confirmSwitch, setConfirmSwitch] = useS(null);
  const [drawerOpen, setDrawerOpen] = useS(false);
  const [irrigationOn, setIrrigationOn] = useS(true);

  const goto = (v) => {
    if (!irrigationOn) return;
    setView(v); setDrawerOpen(false);
  };

  return (
    <div style={{
      background: 'var(--bg)',
      color: 'var(--fg)',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      fontFamily: 'var(--font-body)',
      position: 'relative',
    }}>
      {/* Status bar gap (top safe area on iOS frame) */}
      <div style={{ height: 60 }} />

      {/* App header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '4px 16px 14px', gap: 12,
      }}>
        <button
          className="btn btn-icon btn-ghost"
          onClick={() => irrigationOn && setDrawerOpen(true)}
          disabled={!irrigationOn}
          aria-label="Open menu"
          style={{
            width: 40, height: 40,
            opacity: irrigationOn ? 1 : 0.35,
            cursor: irrigationOn ? 'pointer' : 'not-allowed',
          }}>
          <Icon.menu width={18} height={18}/>
        </button>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          opacity: irrigationOn ? 1 : 0.45,
          filter: irrigationOn ? 'none' : 'grayscale(1)',
        }}>
          <BrandGlyph size={24}/>
          <span style={{ font: '600 16px/1 var(--font-display)', letterSpacing: '-0.02em' }}>Irrigo</span>
        </div>
        <button
          className="btn btn-icon btn-ghost"
          disabled={!irrigationOn}
          style={{
            width: 40, height: 40,
            opacity: irrigationOn ? 1 : 0.35,
            cursor: irrigationOn ? 'pointer' : 'not-allowed',
          }}
          aria-label="Re-plan">
          <Icon.refresh width={16} height={16}/>
        </button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto', paddingBottom: 40 }}>
        {view.name === 'home' && (
          <HomeView
            goto={goto}
            onFire={(z) => setConfirmFire(z)}
            irrigationOn={irrigationOn}
            onToggleIrrigation={() => setIrrigationOn(v => !v)}
          />
        )}
        {view.name === 'zone' && <ZoneView zone={ZONES.find(z => z.slug === view.slug)} onFire={(z) => setConfirmFire(z)} />}
        {view.name === 'schedule' && (
          <ScheduleView activeSlug={scheduleSlug} onSwitch={(s) => setConfirmSwitch(s)} />
        )}
        {view.name === 'log' && <ActivityView />}
      </div>

      {/* Side drawer (no-op when irrigation off, since hamburger is disabled) */}
      <NavDrawer
        open={drawerOpen && irrigationOn}
        view={view}
        onClose={() => setDrawerOpen(false)}
        onNavigate={goto}
      />

      {/* Modals */}
      {confirmFire && <FireSheet zone={confirmFire} onClose={() => setConfirmFire(null)} />}
      {confirmSwitch && (
        <SwitchModal
          schedule={confirmSwitch}
          onCancel={() => setConfirmSwitch(null)}
          onConfirm={() => { setScheduleSlug(confirmSwitch.slug); setConfirmSwitch(null); }}
        />
      )}
    </div>
  );
}

// ─── Side drawer ────────────────────────────────────────────────────────────

function NavDrawer({ open, view, onClose, onNavigate }) {
  const items = [
    { id: 'home', label: 'Home',     icon: Icon.home,    target: { name: 'home' } },
    { id: 'zone', label: 'Zones',    icon: Icon.zone,    target: { name: 'zone', slug: 'north' } },
    { id: 'schedule', label: 'Schedules', icon: Icon.cal, target: { name: 'schedule' } },
    { id: 'log',  label: 'Activity', icon: Icon.history, target: { name: 'log' } },
  ];
  const isActive = (id) => view.name === id || (view.name === 'zone' && id === 'zone');

  return (
    <>
      {/* Scrim */}
      <div
        onClick={onClose}
        style={{
          position: 'absolute', inset: 0, zIndex: 90,
          background: 'rgba(2,4,3,0.55)',
          backdropFilter: 'blur(6px)',
          WebkitBackdropFilter: 'blur(6px)',
          opacity: open ? 1 : 0,
          pointerEvents: open ? 'auto' : 'none',
          transition: 'opacity 220ms cubic-bezier(.2,.7,.2,1)',
        }}
      />
      {/* Drawer */}
      <aside
        aria-hidden={!open}
        style={{
          position: 'absolute', top: 0, bottom: 0, left: 0,
          width: 280,
          background: 'var(--ink-300)',
          borderRight: '1px solid var(--border)',
          boxShadow: 'var(--shadow-3)',
          transform: open ? 'translateX(0)' : 'translateX(-100%)',
          transition: 'transform 280ms cubic-bezier(.2,.7,.2,1)',
          zIndex: 100,
          display: 'flex', flexDirection: 'column',
          paddingTop: 60, // clear the iOS status bar
        }}>
        {/* Brand row + close */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '6px 16px 18px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <BrandGlyph size={28}/>
            <div>
              <div style={{ font: '600 18px/1 var(--font-display)', letterSpacing: '-0.02em' }}>Irrigo</div>
              <div className="num-sm" style={{ color: 'var(--fg-muted)', marginTop: 2 }}>Calgary · 740 m²</div>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close menu"
            style={{
              width: 32, height: 32, borderRadius: 4,
              border: '1px solid var(--border)', background: 'var(--ink-400)',
              color: 'var(--fg-muted)', cursor: 'pointer',
              display: 'grid', placeItems: 'center',
            }}>
            <Icon.x width={14} height={14}/>
          </button>
        </div>

        {/* Nav */}
        <nav style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {items.map((it) => {
            const active = isActive(it.id);
            return (
              <button
                key={it.id}
                onClick={() => onNavigate(it.target)}
                style={{
                  all: 'unset', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 14,
                  padding: '12px 14px',
                  borderRadius: 4,
                  background: active ? 'var(--surface-2)' : 'transparent',
                  border: active ? '1px solid var(--border)' : '1px solid transparent',
                  color: active ? 'var(--fg)' : 'var(--fg-soft)',
                  font: '500 15px/1 var(--font-body)',
                }}>
                <it.icon width={18} height={18} style={{ color: active ? 'var(--accent)' : 'var(--fg-muted)' }}/>
                <span style={{ flex: 1 }}>{it.label}</span>
                {active && <span style={{ width: 6, height: 6, borderRadius: 4, background: 'var(--accent)', boxShadow: '0 0 8px var(--accent)' }}/>}
              </button>
            );
          })}
        </nav>

        {/* Active schedule footer */}
        <div style={{ marginTop: 'auto', padding: 16 }}>
          <div style={{
            background: 'linear-gradient(180deg, rgba(111,227,155,0.06), rgba(111,227,155,0) 70%), var(--surface)',
            border: '1px solid rgba(111,227,155,0.28)',
            borderRadius: 'var(--r-3)',
            padding: '14px 14px 12px',
          }}>
            <div className="eyebrow" style={{ color: 'var(--accent)' }}>Active</div>
            <div style={{ font: 'var(--h2)', marginTop: 4 }}>Maintenance</div>
            <div className="num-sm" style={{ color: 'var(--fg-muted)', marginTop: 2 }}>Wed · Fri · Sun · 00:00–10:00</div>
            <button
              onClick={() => onNavigate({ name: 'schedule' })}
              className="btn btn-secondary btn-sm"
              style={{ width: '100%', marginTop: 12 }}>
              Switch profile
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}

function ActivityView() {
  return (
    <div style={{ padding: '0 20px', display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div className="eyebrow">Chronological · all zones</div>
      <div style={{ font: '700 28px/1 var(--font-display)', letterSpacing: '-0.025em' }}>Activity</div>
      <AlertRow tone="warn"
        title="Weather API stale"
        sub="Last forecast at 18:02 yesterday. Planner is using fallback ET₀."
        when="11h" />
      <FireLog rows={[
        { d: 'May 13', applied: 14.0, dur: 62, before: 30, after: 16 },
        { d: 'May 13', applied: 9.0,  dur: 51, before: 22, after: 13 },
        { d: 'May 11', applied: 8.0,  dur: 40, before: 28, after: 20 },
        { d: 'May 10', applied: 11.5, dur: 51, before: 28, after: 17 },
        { d: 'May 06', applied: 9.0,  dur: 40, before: 24, after: 15 },
      ]}/>
    </div>
  );
}

function BrandGlyph({ size = 28 }) {
  const s = size;
  return (
    <svg width={s} height={s} viewBox="0 0 84 84" fill="none">
      <ellipse cx="42" cy="64" rx="32" ry="6" fill="#1B231F" stroke="#344239" strokeWidth="1.2"/>
      <path d="M10 46 A 32 30 0 0 1 74 46" stroke="#6FE39B" strokeWidth="2.4" strokeLinecap="round" fill="none" strokeDasharray="2.4 4"/>
      <path d="M42 46 L 42 60" stroke="#6FE39B" strokeWidth="2.4" strokeLinecap="round"/>
      <path d="M42 22 C 36 30, 36 38, 42 40 C 48 38, 48 30, 42 22 Z" fill="#6FE39B"/>
    </svg>
  );
}

// ─── Home ───────────────────────────────────────────────────────────────────

function HomeView({ goto, onFire, irrigationOn, onToggleIrrigation }) {
  return (
    <div style={{ padding: '0 20px', display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Master toggle — always interactive, always on top */}
      <MasterToggle on={irrigationOn} onToggle={onToggleIrrigation} />

      {/* Everything below is the "operating" body — dimmed and disabled when off */}
      <div
        aria-hidden={!irrigationOn}
        style={{
          display: 'flex', flexDirection: 'column', gap: 18,
          opacity: irrigationOn ? 1 : 0.32,
          filter: irrigationOn ? 'none' : 'grayscale(1) blur(0.2px)',
          pointerEvents: irrigationOn ? 'auto' : 'none',
          transition: 'opacity 240ms cubic-bezier(.2,.7,.2,1), filter 240ms cubic-bezier(.2,.7,.2,1)',
          userSelect: irrigationOn ? 'auto' : 'none',
        }}>
        <div className="eyebrow">Tonight · America/Edmonton</div>

      {/* Hero card */}
      <div className="card-elev" style={{
        padding: '20px 20px 18px',
        background: 'linear-gradient(180deg, rgba(111,227,155,0.07), rgba(111,227,155,0) 60%), var(--elevated)',
        borderColor: 'rgba(111,227,155,0.22)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div className="eyebrow" style={{ color: 'var(--accent)' }}>Next run</div>
            <div style={{ font: '600 36px/1 var(--font-display)', letterSpacing: '-0.025em', marginTop: 6 }}>
              <span style={{ color: 'var(--accent)' }}>10:23 pm</span>
            </div>
            <div className="body-sm" style={{ marginTop: 4 }}>North, then South · 10 cycles · ends 5:48 am</div>
          </div>
          <Badge tone="active">Scheduled</Badge>
        </div>
        <div style={{ marginTop: 18 }}>
          <CycleStrip night={TONIGHT_NIGHT} variant="compact" />
        </div>
      </div>

      {/* Zones */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div className="h2">Zones</div>
        <div className="num-sm" style={{ color: 'var(--fg-dim)' }}>3 · 740 m²</div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {ZONES.map((z) => (
          <button key={z.slug} onClick={() => goto({ name: 'zone', slug: z.slug })}
            style={{
              all: 'unset', cursor: 'pointer',
              background: 'var(--surface)', border: '1px solid var(--border)',
              borderRadius: 'var(--r-3)', padding: 14,
              display: 'flex', flexDirection: 'column', gap: 10,
            }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ font: '600 16px/1.1 var(--font-display)' }}>{z.name}</div>
                <div className="num-sm" style={{ color: 'var(--fg-muted)', marginTop: 2 }}>{z.grass} · {z.area} m²</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                <span className="num" style={{
                  fontSize: 18,
                  color: z.depletion >= z.raw ? 'var(--danger)' : 'var(--fg)',
                }}>{z.depletion.toFixed(1)}</span>
                <span className="num-sm" style={{ color: 'var(--fg-muted)' }}>/ {z.raw} mm</span>
              </div>
            </div>
            <Battery depletion={z.depletion} raw={z.raw} />
            <div className="num-sm" style={{ color: 'var(--fg-dim)' }}>
              {z.depletion >= z.raw ? <span style={{ color: 'var(--danger)' }}>Runs tonight</span> : `Last ran ${z.last}`}
            </div>
          </button>
        ))}
      </div>

      {/* Active schedule chip — profile-card identity at end of feed.
          Tapping anywhere jumps to the Schedules screen. */}
      <button
        onClick={() => goto({ name: 'schedule' })}
        style={{
          all: 'unset', cursor: 'pointer', marginTop: 10,
          position: 'relative',
          background: 'linear-gradient(180deg, rgba(111,227,155,0.05), rgba(111,227,155,0) 70%), var(--surface)',
          border: '1px solid var(--border)',
          borderLeft: '3px solid var(--accent)',
          padding: '14px 16px 14px 16px',
          display: 'block',
        }}>
        {/* Header — eyebrow + live indicator */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: 10,
        }}>
          <span style={{
            font: '500 10px/1 var(--font-body)',
            letterSpacing: '0.16em', textTransform: 'uppercase',
            color: 'var(--fg-muted)',
          }}>On profile</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{
              width: 6, height: 6,
              background: 'var(--accent)',
              boxShadow: '0 0 8px var(--accent)',
            }}/>
            <span style={{ font: '500 10px/1 var(--font-mono)', color: 'var(--accent)', letterSpacing: '0.08em' }}>
              RUNNING
            </span>
          </span>
        </div>

        {/* Body — name + day mini-strip + countdown */}
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{
              font: '600 22px/1 var(--font-display)',
              letterSpacing: '-0.02em',
              color: 'var(--fg)',
            }}>Maintenance</div>
            <div style={{ display: 'flex', gap: 6, marginTop: 10, alignItems: 'center' }}>
              {['M','T','W','T','F','S','S'].map((d, i) => {
                const on = [false,false,true,false,true,false,true][i];
                return (
                  <span key={i} style={{
                    font: '500 11px/1 var(--font-mono)',
                    color: on ? 'var(--accent)' : 'var(--fg-dim)',
                    opacity: on ? 1 : 0.6,
                    textShadow: on ? '0 0 6px rgba(111,227,155,0.5)' : 'none',
                  }}>{d}</span>
                );
              })}
            </div>
          </div>

          <div style={{ textAlign: 'right', flex: '0 0 auto' }}>
            <div className="num-sm" style={{ color: 'var(--fg-dim)', marginBottom: 4 }}>Next run</div>
            <div style={{
              font: '500 18px/1 var(--font-mono)',
              letterSpacing: '-0.02em',
              color: 'var(--accent)',
              whiteSpace: 'nowrap',
            }}>8h 14m</div>
          </div>
        </div>
      </button>
      </div>{/* /dimmed wrapper */}
    </div>
  );
}

// ─── Master irrigation toggle ──────────────────────────────────────────────
// Top of Home. Always interactive. When OFF, every other surface on the
// home screen + navigation is greyed and locked.

function MasterToggle({ on, onToggle }) {
  return (
    <div style={{
      position: 'relative',
      background: on
        ? 'linear-gradient(180deg, rgba(111,227,155,0.05), rgba(111,227,155,0) 60%), var(--elevated)'
        : 'linear-gradient(180deg, rgba(255,190,107,0.05), rgba(255,190,107,0) 60%), var(--elevated)',
      border: '1px solid ' + (on ? 'rgba(111,227,155,0.32)' : 'rgba(255,190,107,0.38)'),
      boxShadow: on
        ? '0 0 0 1px rgba(111,227,155,0.14) inset'
        : '0 0 0 1px rgba(255,190,107,0.18) inset',
      borderRadius: 4,
      padding: '14px 16px',
      display: 'flex', alignItems: 'center', gap: 14,
    }}>
      {/* Status indicator */}
      <div style={{
        width: 36, height: 36, flex: '0 0 36px',
        display: 'grid', placeItems: 'center',
        background: on ? 'rgba(111,227,155,0.10)' : 'rgba(255,190,107,0.10)',
        border: '1px solid ' + (on ? 'rgba(111,227,155,0.32)' : 'rgba(255,190,107,0.38)'),
        borderRadius: 4,
        color: on ? 'var(--accent)' : 'var(--warn)',
        position: 'relative',
      }}>
        {on ? (
          // Droplet — system is alive
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 1.5 C 4 6, 3 9, 3 11 a 5 5 0 0 0 10 0 C 13 9, 12 6, 8 1.5 Z"/>
          </svg>
        ) : (
          // Pause — system is dormant
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <rect x="4" y="3" width="2.5" height="10"/>
            <rect x="9.5" y="3" width="2.5" height="10"/>
          </svg>
        )}
        {on && (
          <span style={{
            position: 'absolute', top: -2, right: -2,
            width: 8, height: 8,
            background: 'var(--accent)',
            border: '2px solid var(--elevated)',
            boxShadow: '0 0 8px var(--accent)',
          }}/>
        )}
      </div>

      {/* Label */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          font: '500 10px/1 var(--font-body)',
          letterSpacing: '0.16em', textTransform: 'uppercase',
          color: on ? 'var(--accent)' : 'var(--warn)',
        }}>{on ? 'System on' : 'System off'}</div>
        <div style={{ font: '600 17px/1.1 var(--font-display)', color: 'var(--fg)', marginTop: 6 }}>
          {on ? 'Irrigation enabled' : 'Irrigation disabled'}
        </div>
        <div className="num-sm" style={{ color: 'var(--fg-muted)', marginTop: 4 }}>
          {on
            ? 'Scheduling & manual runs allowed'
            : 'Master kill switch · all runs blocked'}
        </div>
      </div>

      {/* Toggle */}
      <label className="toggle" style={{ '--w': '54px', '--h': '30px' }}>
        <input type="checkbox" checked={on} onChange={onToggle} />
        <span className="track" />
        <span className="thumb" />
      </label>
    </div>
  );
}

// ─── Zone Detail ────────────────────────────────────────────────────────────

function ZoneView({ zone, onFire }) {
  if (!zone) return null;
  const tone = zone.depletion >= zone.raw ? 'danger' : (zone.depletion / zone.raw > 0.8 ? 'warn' : 'ok');
  return (
    <div style={{ padding: '0 20px', display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div className="eyebrow">{zone.grass} · {zone.area} m²</div>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
        <LawnPatch slug={zone.patch} size={44} tone={zone.depletion >= zone.raw ? '#FF6B7B' : '#6FE39B'} />
        <div>
          <div style={{ font: '700 32px/1 var(--font-display)', letterSpacing: '-0.025em' }}>{zone.name}</div>
          <div className="body-sm" style={{ marginTop: 4 }}>
            {tone === 'danger' ? <span style={{ color: 'var(--danger)' }}>Past RAW · queued for tonight</span> :
              tone === 'warn' ? <span style={{ color: 'var(--warn)' }}>Approaching RAW</span> :
              <span>Within tolerance</span>}
          </div>
        </div>
      </div>

      {/* Battery hero */}
      <div className="card-elev" style={{ padding: 18 }}>
        <div className="eyebrow">Soil-moisture deficit</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 6 }}>
          <span style={{
            font: '500 56px/0.95 var(--font-mono)', letterSpacing: '-0.04em',
            color: tone === 'danger' ? 'var(--danger)' : 'var(--accent)',
          }}>{zone.depletion.toFixed(1)}</span>
          <span className="num-lg" style={{ color: 'var(--fg-muted)' }}>mm</span>
        </div>
        <div style={{ marginTop: 14 }}>
          <Battery depletion={zone.depletion} raw={zone.raw} tall />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
          <span className="num-sm" style={{ color: 'var(--fg-dim)' }}>0</span>
          <span className="num-sm" style={{ color: 'var(--warn)' }}>RAW · {zone.raw}</span>
          <span className="num-sm" style={{ color: 'var(--fg-dim)' }}>{Math.round(zone.raw * 1.25)}</span>
        </div>
      </div>

      {/* Manual run */}
      <button className="btn btn-primary btn-lg" onClick={() => onFire(zone)} style={{ width: '100%' }}>
        <Icon.play width={14} height={14}/> Run now
      </button>

      {/* Physical attributes */}
      <div>
        <div className="h2" style={{ marginBottom: 10 }}>Physical</div>
        <AttrTable rows={[
          ['Grass type', zone.grass],
          ['Area', `${zone.area} m²`],
          ['Root depth', `${zone.rootM.toFixed(2)} m`],
          ['Allowable depletion', '0.45'],
          ['Soil', 'Sandy loam · AWHC 140 mm/m'],
          ['Precipitation rate', '14 mm/hr'],
          ['Microclimate factor', '1.05'],
          ['Entity', `switch.${zone.slug}_sprinkler`],
        ]}/>
      </div>

      {/* Recent runs */}
      <div>
        <div className="h2" style={{ marginBottom: 10 }}>Recent runs</div>
        <FireLog rows={[
          { d: 'May 12', applied: 14.0, dur: 62, before: 30, after: 16 },
          { d: 'May 09', applied: 11.5, dur: 51, before: 28, after: 17 },
          { d: 'May 06', applied: 9.0,  dur: 40, before: 24, after: 15 },
          { d: 'May 03', applied: 12.0, dur: 54, before: 27, after: 15 },
        ]}/>
      </div>
    </div>
  );
}

function AttrTable({ rows }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-3)' }}>
      {rows.map(([k, v], i) => (
        <div key={i} style={{
          display: 'flex', justifyContent: 'space-between', padding: '12px 14px',
          borderTop: i === 0 ? 0 : '1px solid var(--hairline)',
        }}>
          <span className="body-sm" style={{ color: 'var(--fg-muted)' }}>{k}</span>
          <span className="num" style={{ color: 'var(--fg)' }}>{v}</span>
        </div>
      ))}
    </div>
  );
}

function FireLog({ rows }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-3)' }}>
      {rows.map((r, i) => (
        <div key={i} style={{
          display: 'grid', gridTemplateColumns: '64px 1fr auto', gap: 12, padding: '12px 14px',
          borderTop: i === 0 ? 0 : '1px solid var(--hairline)', alignItems: 'center',
        }}>
          <span className="num-sm" style={{ color: 'var(--fg-muted)' }}>{r.d}</span>
          <div>
            <div className="num" style={{ color: 'var(--fg)' }}>{r.applied.toFixed(1)} mm · {r.dur} min</div>
            <div className="num-sm" style={{ color: 'var(--fg-dim)' }}>{r.before} → {r.after} mm</div>
          </div>
          <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: 4, background: 'var(--accent)' }} />
        </div>
      ))}
    </div>
  );
}

// ─── Schedule list ──────────────────────────────────────────────────────────

function ScheduleView({ activeSlug, onSwitch }) {
  const active = SCHEDULES.find(s => s.slug === activeSlug) || SCHEDULES[0];
  const others = SCHEDULES.filter(s => s.slug !== active.slug);
  const [skipping, setSkipping] = useS(false);

  return (
    <div style={{ padding: '0 20px', display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div className="eyebrow">Profile · 1 active</div>
      <div style={{ font: '700 28px/1 var(--font-display)', letterSpacing: '-0.025em' }}>Schedules</div>

      {/* HERO — active schedule */}
      <ActiveScheduleHero
        schedule={active}
        skipping={skipping}
        onToggleSkip={() => setSkipping(v => !v)}
      />

      {/* Other schedules — switcher list */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 6 }}>
        <div className="h2">Other profiles</div>
        <button className="btn btn-ghost btn-sm">+ New</button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {others.map((s) => (
          <button
            key={s.slug}
            onClick={() => onSwitch(s)}
            style={{
              all: 'unset', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              gap: 12, padding: '14px 14px',
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 4,
            }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ font: '600 15px/1.1 var(--font-display)', color: 'var(--fg)' }}>{s.name}</div>
              <div className="num-sm" style={{ color: 'var(--fg-muted)', marginTop: 4 }}>
                {s.daysCsv} · {s.window}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <DayDots days={s.days} size={6} gap={3} />
              <span style={{
                font: '500 12px/1 var(--font-body)',
                color: 'var(--fg-soft)',
                display: 'inline-flex', alignItems: 'center', gap: 4,
              }}>
                Switch <Icon.chevR width={12} height={12} />
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function ActiveScheduleHero({ schedule, skipping, onToggleSkip }) {
  const s = schedule;

  return (
    <div style={{
      position: 'relative',
      background: 'linear-gradient(180deg, rgba(111,227,155,0.07), rgba(111,227,155,0) 60%), var(--elevated)',
      border: '1px solid rgba(111,227,155,0.42)',
      boxShadow: '0 0 0 1px rgba(111,227,155,0.18) inset, 0 0 28px -4px rgba(111,227,155,0.18)',
      borderRadius: 4,
      padding: '16px 18px 18px',
      display: 'flex', flexDirection: 'column', gap: 16,
    }}>
      {/* Header row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          padding: '4px 10px',
          background: 'rgba(111,227,155,0.10)',
          border: '1px solid rgba(111,227,155,0.42)',
          color: 'var(--accent)',
          font: '500 11px/1 var(--font-body)',
          letterSpacing: '0.12em', textTransform: 'uppercase',
          borderRadius: 4,
        }}>
          <span style={{
            width: 7, height: 7, borderRadius: 4,
            background: 'var(--accent)',
            boxShadow: '0 0 10px var(--accent)',
          }}/>
          Running
        </span>
        <button
          className="btn btn-icon btn-ghost"
          style={{ width: 32, height: 32 }}
          aria-label="Re-plan now">
          <Icon.refresh width={14} height={14}/>
        </button>
      </div>

      {/* Name + summary */}
      <div>
        <div style={{ font: '700 30px/1 var(--font-display)', letterSpacing: '-0.025em' }}>{s.name}</div>
        <div className="body-sm" style={{ color: 'var(--fg-muted)', marginTop: 6 }}>{s.daysCsv} · {s.window}</div>
      </div>

      {/* Week strip */}
      <DayStrip days={s.days} />

      {/* Skip-tonight banner */}
      {skipping && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 12px',
          background: 'rgba(255,190,107,0.06)',
          border: '1px solid rgba(255,190,107,0.32)',
          borderRadius: 4,
        }}>
          <div style={{ width: 8, height: 8, borderRadius: 4, background: 'var(--warn)' }}/>
          <div style={{ flex: 1, font: '500 13px/1.2 var(--font-body)', color: 'var(--fg)' }}>Tonight skipped</div>
          <button onClick={onToggleSkip}
            style={{ all: 'unset', cursor: 'pointer', font: '500 12px/1 var(--font-body)', color: 'var(--warn)' }}>
            Undo
          </button>
        </div>
      )}

      {/* Next run */}
      <div style={{ paddingTop: 10, borderTop: '1px solid var(--hairline)' }}>
        <div className="eyebrow" style={{ marginBottom: 8 }}>Next run</div>
        {!skipping ? (
          <>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
              <span style={{
                font: '500 36px/1 var(--font-mono)',
                letterSpacing: '-0.03em',
                color: 'var(--accent)',
                whiteSpace: 'nowrap',
              }}>
                {s.nextRun?.inLabel || '—'}
              </span>
              <span className="num-sm" style={{ color: 'var(--fg-muted)', whiteSpace: 'nowrap' }}>from now</span>
            </div>
            <div className="num-sm" style={{ color: 'var(--fg-dim)', marginTop: 6 }}>
              {s.nextRun?.whenLabel} · {s.nextRun?.zonesLabel}
            </div>
          </>
        ) : (
          <div className="body-sm" style={{ color: 'var(--fg-muted)' }}>
            Skipped tonight. Re-evaluating tomorrow morning.
          </div>
        )}
      </div>

      {/* Rules */}
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div className="eyebrow" style={{ marginBottom: 8 }}>Rules</div>
        <RuleRow k="Time window" v={s.rules.timeWindow}/>
        <RuleRow k="End by sunrise" v={s.rules.endBySunrise ? 'On' : 'Off'} good={s.rules.endBySunrise}/>
        <RuleRow k="Root depth override" v={s.rules.rootOverride ? `${s.rules.rootOverride.toFixed(2)} m` : '—'} dim={!s.rules.rootOverride}/>
        <RuleRow k="Depletion fraction" v={s.rules.depletionFraction.toFixed(2)} last/>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-primary" style={{ flex: 1 }}>Switch profile</button>
        <button
          className="btn btn-secondary"
          onClick={onToggleSkip}
          style={{ flex: 1 }}>
          {skipping ? 'Resume tonight' : 'Skip tonight'}
        </button>
      </div>
    </div>
  );
}

function DayStrip({ days }) {
  const labels = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      {labels.map((d, i) => {
        const on = days[i];
        return (
          <div key={i} style={{
            flex: 1, height: 40,
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 5,
            background: on ? 'rgba(111,227,155,0.10)' : 'var(--surface)',
            border: '1px solid ' + (on ? 'rgba(111,227,155,0.42)' : 'var(--border)'),
            borderRadius: 4,
            color: on ? 'var(--accent)' : 'var(--fg-dim)',
          }}>
            <span style={{ font: '500 11px/1 var(--font-mono)' }}>{d}</span>
            <span style={{
              width: 4, height: 4,
              background: on ? 'var(--accent)' : 'var(--ink-500)',
              boxShadow: on ? '0 0 6px var(--accent)' : 'none',
            }}/>
          </div>
        );
      })}
    </div>
  );
}

// Minimal version of the day strip for the "other profiles" rows.
function DayDots({ days, size = 6, gap = 3 }) {
  return (
    <div style={{ display: 'flex', gap }}>
      {days.map((on, i) => (
        <span key={i} style={{
          width: size, height: size,
          background: on ? 'var(--accent)' : 'var(--ink-500)',
          opacity: on ? 1 : 0.6,
        }}/>
      ))}
    </div>
  );
}

function RuleRow({ k, v, good, dim, last }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
      gap: 16,
      padding: '10px 0',
      borderBottom: last ? 'none' : '1px solid var(--hairline)',
    }}>
      <span className="body-sm" style={{ color: 'var(--fg-muted)' }}>{k}</span>
      <span className="num" style={{
        color: good ? 'var(--accent)' : (dim ? 'var(--fg-dim)' : 'var(--fg)'),
        whiteSpace: 'nowrap',
        textAlign: 'right',
      }}>{v}</span>
    </div>
  );
}

// ─── Sheet / Modal ─────────────────────────────────────────────────────────

function FireSheet({ zone, onClose }) {
  const [minutes, setMinutes] = React.useState(5);
  const MIN = 1, MAX = 60;
  const dec = () => setMinutes(m => Math.max(MIN, m - 1));
  const inc = () => setMinutes(m => Math.min(MAX, m + 1));
  const canDec = minutes > MIN;
  const canInc = minutes < MAX;

  const stepperBtn = (enabled) => ({
    width: 56, height: 56, borderRadius: 4,
    border: '1px solid var(--border)',
    background: 'var(--ink-400)',
    color: enabled ? 'var(--fg)' : 'var(--fg-dim)',
    cursor: enabled ? 'pointer' : 'not-allowed',
    display: 'grid', placeItems: 'center',
    transition: 'background var(--d-1) var(--ease-out), border-color var(--d-1) var(--ease-out)',
  });

  return (
    <>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(2,4,3,0.55)', backdropFilter: 'blur(6px)', zIndex: 99 }} onClick={onClose}/>
      <div className="sheet" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 100 }}>
        <div className="grabber" />
        <div style={{ marginBottom: 20 }}>
          <div style={{ font: 'var(--h1)', color: 'var(--fg)' }}>Run {zone.name}</div>
          <div className="body-sm" style={{ color: 'var(--fg-muted)' }}>{zone.grass} · {zone.area} m²</div>
        </div>

        {/* Duration stepper */}
        <div style={{
          background: 'var(--ink-200)',
          border: '1px solid var(--hairline)',
          borderRadius: 6,
          padding: '18px 14px 16px',
          marginBottom: 14,
        }}>
          <div className="eyebrow" style={{ textAlign: 'center', marginBottom: 12 }}>Duration</div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <button
              onClick={dec}
              disabled={!canDec}
              aria-label="Decrease minutes"
              style={stepperBtn(canDec)}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M3 8h10" stroke="currentColor" strokeWidth="1.75" strokeLinecap="square"/>
              </svg>
            </button>

            <div style={{ flex: 1, textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
              <span className="num-hero" style={{ color: 'var(--fg)', fontSize: 56, lineHeight: 1 }}>
                {minutes}
              </span>
              <span className="label" style={{ color: 'var(--fg-muted)' }}>
                {minutes === 1 ? 'minute' : 'minutes'}
              </span>
            </div>

            <button
              onClick={inc}
              disabled={!canInc}
              aria-label="Increase minutes"
              style={stepperBtn(canInc)}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M3 8h10M8 3v10" stroke="currentColor" strokeWidth="1.75" strokeLinecap="square"/>
              </svg>
            </button>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={onClose}>Run now</button>
        </div>
      </div>
    </>
  );
}

function SheetRow({ k, v }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '12px 0', borderBottom: '1px solid var(--hairline)',
    }}>
      <span className="body" style={{ color: 'var(--fg-muted)' }}>{k}</span>
      <span className="num" style={{ color: 'var(--fg)' }}>{v}</span>
    </div>
  );
}

function SwitchModal({ schedule, onCancel, onConfirm }) {
  return (
    <>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(2,4,3,0.66)', backdropFilter: 'blur(8px)', zIndex: 99 }} onClick={onCancel}/>
      <div className="modal" style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 100, maxWidth: 320 }}>
        <div className="modal-header">
          <div className="ttl">Switch to {schedule.name}?</div>
          <div className="sub">Active schedule will be replaced. A re-plan will run immediately.</div>
        </div>
        <div className="modal-body">
          <label className="check"><input type="checkbox" defaultChecked /><span className="box"></span>Re-plan now from current depletion</label>
          <label className="check"><input type="checkbox" /><span className="box"></span>Notify when first cycles are queued</label>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary" onClick={onConfirm}>Switch & re-plan</button>
        </div>
      </div>
    </>
  );
}

Object.assign(window, { MobileApp });
