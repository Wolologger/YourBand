/**
 * W//APPS — Onboarding System v1.0
 * ─────────────────────────────────────────────
 * Uso:
 *   WOnboarding.show('despensa', STEPS_DESPENSA);
 *
 * Cada step: { icon, title, body, highlight? }
 * Se muestra solo una vez por app (flag en localStorage).
 * WOnboarding.reset('despensa')  → fuerza a volver a mostrar
 * WOnboarding.resetAll()         → resetea todas las apps
 */

const WOnboarding = (() => {
  const KEY = app => `wapps.onboarding.${app}`;

  function isDone(app) {
    try { return !!localStorage.getItem(KEY(app)); } catch(e) { return false; }
  }
  function markDone(app) {
    try { localStorage.setItem(KEY(app), '1'); } catch(e) {}
  }
  function reset(app) {
    try { localStorage.removeItem(KEY(app)); } catch(e) {}
  }
  function resetAll() {
    try {
      Object.keys(localStorage)
        .filter(k => k.startsWith('wapps.onboarding.'))
        .forEach(k => localStorage.removeItem(k));
    } catch(e) {}
  }

  function show(app, steps) {
    if (isDone(app)) return;
    if (!steps || !steps.length) return;
    _render(app, steps, 0);
  }

  function _render(app, steps, idx) {
    // Remove existing overlay
    document.getElementById('wob-overlay')?.remove();

    const step  = steps[idx];
    const total = steps.length;
    const isLast = idx === total - 1;

    const overlay = document.createElement('div');
    overlay.id = 'wob-overlay';
    overlay.style.cssText = [
      'position:fixed;inset:0;z-index:8000',
      'background:rgba(0,0,0,0.72)',
      'backdrop-filter:blur(3px)',
      'display:flex;align-items:flex-end;justify-content:center',
      'animation:wobFadeIn 0.2s ease',
    ].join(';');

    overlay.innerHTML = `
      <style>
        @keyframes wobFadeIn{from{opacity:0}to{opacity:1}}
        @keyframes wobSlideUp{from{transform:translateY(40px);opacity:0}to{transform:translateY(0);opacity:1}}
        #wob-card{
          background:var(--bg2,#141412);
          border:0.5px solid var(--border2,rgba(255,255,255,0.13));
          border-radius:16px 16px 0 0;
          width:100%;max-width:600px;
          padding:24px 22px 36px;
          animation:wobSlideUp 0.22s ease;
          font-family:var(--fm,'DM Mono',monospace);
        }
        #wob-icon{font-size:36px;margin-bottom:12px;line-height:1;display:block;}
        #wob-title{font-family:var(--fh,'Bebas Neue',sans-serif);font-size:24px;letter-spacing:0.5px;color:var(--text,#f0ebe0);margin-bottom:8px;}
        #wob-body{font-size:13px;color:var(--muted,#5a5850);line-height:1.7;margin-bottom:20px;font-family:var(--fs,'DM Sans',sans-serif);}
        #wob-body strong{color:var(--text,#f0ebe0);font-weight:500;}
        .wob-dots{display:flex;gap:6px;justify-content:center;margin-bottom:18px;}
        .wob-dot{width:6px;height:6px;border-radius:50%;background:var(--dim,#2a2a26);transition:all 0.2s;}
        .wob-dot.active{background:var(--y,#e8f040);width:18px;border-radius:3px;}
        .wob-btns{display:flex;gap:8px;}
        .wob-btn{flex:1;padding:11px;font-family:var(--fh,'Bebas Neue',sans-serif);font-size:14px;border-radius:8px;border:0.5px solid var(--border2,rgba(255,255,255,0.13));background:transparent;color:var(--text,#f0ebe0);cursor:pointer;transition:all 0.15s;letter-spacing:0.3px;}
        .wob-btn:hover{background:var(--bg3,#1e1e1b);}
        .wob-btn.primary{background:var(--y,#e8f040);color:#0a0a09;border-color:var(--y,#e8f040);flex:2;}
        .wob-btn.primary:hover{opacity:0.9;}
        #wob-skip{background:none;border:none;color:var(--muted,#5a5850);font-family:var(--fm,'DM Mono',monospace);font-size:10px;cursor:pointer;padding:4px 0;text-align:center;width:100%;margin-top:10px;letter-spacing:0.5px;}
        #wob-skip:hover{color:var(--text,#f0ebe0);}
      </style>
      <div id="wob-card">
        <span id="wob-icon">${step.icon || '👋'}</span>
        <div id="wob-title">${step.title}</div>
        <div id="wob-body">${step.body}</div>
        <div class="wob-dots">
          ${Array.from({length: total}, (_,i) =>
            `<div class="wob-dot${i===idx?' active':''}"></div>`
          ).join('')}
        </div>
        <div class="wob-btns">
          ${idx > 0
            ? `<button class="wob-btn" onclick="WOnboarding._go('${app}',${idx-1})">← Atrás</button>`
            : ''
          }
          <button class="wob-btn primary" onclick="WOnboarding._go('${app}',${isLast ? -1 : idx+1})">
            ${isLast ? '¡Empezar!' : 'Siguiente →'}
          </button>
        </div>
        ${!isLast ? `<button id="wob-skip" onclick="WOnboarding._skip('${app}')">Saltar introducción</button>` : ''}
      </div>
    `;

    document.body.appendChild(overlay);
  }

  function _go(app, idx) {
    if (idx === -1) {
      _close(app);
      return;
    }
    // Need steps — re-fetch from registry
    const steps = _registry[app];
    if (steps) _render(app, steps, idx);
  }

  function _skip(app) { _close(app); }

  function _close(app) {
    document.getElementById('wob-overlay')?.remove();
    markDone(app);
  }

  // Registry so _go can find steps without passing them around
  const _registry = {};
  const _origShow = show;

  return {
    show(app, steps) {
      _registry[app] = steps;
      _origShow(app, steps);
    },
    _go,
    _skip,
    reset,
    resetAll,
    isDone,
  };
})();
