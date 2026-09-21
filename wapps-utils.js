/**
 * W//APPS — Utilidades compartidas v1.0
 * ─────────────────────────────────────────────────────────────────
 * Funciones de uso común en todas las apps.
 * Cárgar ANTES del código específico de cada app.
 *
 * APIs disponibles:
 *   haptic(p)             → vibración táctil (light|medium|success|error)
 *   p2(n)                 → padding con cero ("5" → "05")
 *   today()               → fecha actual YYYY-MM-DD (hora local)
 *   fmt(n, d?)            → número formateado en español ("1.234,56")
 *   esc(s)                → escape HTML seguro
 *   showToast(msg, isErr?) → notificación toast temporal
 * ─────────────────────────────────────────────────────────────────
 */

function haptic(p = 'light') {
  if (!navigator.vibrate) return;
  if (p === 'light') navigator.vibrate(8);
  else if (p === 'medium') navigator.vibrate(18);
  else if (p === 'success') navigator.vibrate([8, 50, 8]);
  else if (p === 'error') navigator.vibrate([30, 60, 30]);
  else navigator.vibrate(p);
}

function p2(n) { return String(n).padStart(2, '0'); }

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}

function fmt(n, d = 2) {
  return Number(n || 0).toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d });
}

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

let _wToastTimer = null;
function showToast(msg, isErr = false) {
  let el = document.getElementById('wapps-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'wapps-toast';
    el.style.cssText = 'position:fixed;bottom:100px;left:50%;transform:translateX(-50%);background:var(--bg2,#141412);border:0.5px solid var(--border2,rgba(255,255,255,0.13));border-radius:8px;padding:10px 18px;font-size:12px;font-family:var(--fm,monospace);color:var(--text,#f0ebe0);z-index:9999;max-width:320px;text-align:center;opacity:0;transition:opacity 0.25s;pointer-events:none;';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.color = isErr ? 'var(--r,#f04030)' : 'var(--g,#30d880)';
  el.style.opacity = '1';
  clearTimeout(_wToastTimer);
  _wToastTimer = setTimeout(() => { el.style.opacity = '0'; }, 2800);
}
