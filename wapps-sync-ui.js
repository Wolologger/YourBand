// wapps-sync-ui.js — Boilerplate de UI de sincronización compartido
// Incluir en cada app DESPUÉS de wapps-firebase.js
// Expone: _fb(), _sync(), updateSyncUI(), manualSync(), manualPull(), manualPushApp(appKey)
// Las apps pueden sobrescribir manualPushApp() si necesitan un filtro específico.

(function () {
  function _fb()   { return (typeof WFirebase !== 'undefined') ? WFirebase : null; }
  function _sync() { return (typeof WSync     !== 'undefined') ? WSync     : null; }

  function updateSyncUI(state, pendingCount) {
    const dot   = document.getElementById('sync-dot');
    const label = document.getElementById('sync-label');
    const btn   = document.getElementById('sync-btn');
    const pend  = document.getElementById('sync-pending');
    if (!dot) return;

    dot.className   = 'sync-dot '   + state;
    label.className = 'sync-label ' + state;
    const labels = { online: 'ONLINE', offline: 'OFFLINE', syncing: 'SINCRONIZANDO...' };
    label.textContent = labels[state] || state.toUpperCase();

    if (pend) {
      pend.textContent = pendingCount > 0
        ? '· ' + pendingCount + ' PENDIENTE' + (pendingCount > 1 ? 'S' : '')
        : '';
    }
    if (btn) btn.disabled = !(state === 'online' && _fb() && _fb().getUser());

    const pullBtn = document.getElementById('pull-btn');
    if (pullBtn) pullBtn.disabled = !(state === 'online' && _fb() && _fb().getUser());

    const pushAppBtn = document.getElementById('push-app-btn');
    if (pushAppBtn) pushAppBtn.disabled = false;
  }

  async function manualSync() {
    const fb = _fb(), sync = _sync();
    if (!fb || !sync) return;
    const user = fb.getUser();
    if (!user || !fb.isOnline()) return;
    const btn = document.getElementById('sync-btn');
    const originalText = btn?.textContent || '↑ SYNC';
    updateSyncUI('syncing', sync.getPending().length);
    if (btn) btn.disabled = true;
    const result = await sync.syncAll(user.uid);
    updateSyncUI(fb.isOnline() ? 'online' : 'offline', sync.getPending().length);
    if (btn) {
      const { pushed = 0, failed = 0 } = result || {};
      if (pushed === 0 && failed === 0) btn.textContent = '✓ Al día';
      else if (failed > 0) btn.textContent = `⚠ ${pushed}/${pushed + failed}`;
      else btn.textContent = `✓ ${pushed}`;
      setTimeout(() => { if (btn) btn.textContent = originalText; }, 2500);
    }
  }

  async function manualPull() {
    const fb = _fb(), sync = _sync();
    if (!fb || !sync) return;
    const user = fb.getUser();
    if (!user || !fb.isOnline()) return;
    const btn = document.getElementById('pull-btn');
    if (btn) btn.disabled = true;
    updateSyncUI('syncing', sync.getPending().length);
    await sync.pullAll(user.uid);
    updateSyncUI(fb.isOnline() ? 'online' : 'offline', sync.getPending().length);
    if (btn) btn.disabled = false;
    window.location.reload();
  }

  // appKey: e.g. 'coches.data', 'semana.data' — the WSync filter key for this app
  async function manualPushApp(appKey) {
    const fb = _fb(), sync = _sync();
    if (!fb || !sync) return;
    const user = fb.getUser();
    if (!user || !fb.isOnline()) return;
    const btn = document.getElementById('push-app-btn');
    if (btn) btn.disabled = true;
    updateSyncUI('syncing', sync.getPending().length);
    const { pushed, failed } = await sync.pushAll(user.uid, appKey);
    updateSyncUI(fb.isOnline() ? 'online' : 'offline', sync.getPending().length);
    if (btn) {
      btn.disabled = false;
      btn.textContent = failed > 0 ? `⚠ ${pushed}/${pushed + failed}` : pushed > 0 ? `✓ ${pushed}` : '⬆ SUBIR';
      if (pushed > 0 || failed > 0) setTimeout(() => { if (btn) btn.textContent = '⬆ SUBIR'; }, 3000);
    }
  }

  // ── Listeners comunes ────────────────────────────────────────
  window.addEventListener('wapps:online',         () => updateSyncUI('online',  _sync()?.getPending().length ?? 0));
  window.addEventListener('wapps:offline',        () => updateSyncUI('offline', _sync()?.getPending().length ?? 0));
  window.addEventListener('wapps:sync-start',     () => updateSyncUI('syncing', _sync()?.getPending().length ?? 0));
  window.addEventListener('wapps:sync-done',      () => {
    const fb = _fb();
    updateSyncUI(fb ? (fb.isOnline() ? 'online' : 'offline') : 'offline', _sync()?.getPending().length ?? 0);
    if (typeof localStorage !== 'undefined') localStorage.setItem('wapps.lastSync', new Date().toISOString());
  });
  window.addEventListener('wapps:pending-change', e => {
    const fb = _fb();
    const label = document.getElementById('sync-label');
    const isSyncing = label?.className?.includes('syncing');
    updateSyncUI(
      isSyncing ? 'syncing' : (fb ? (fb.isOnline() ? 'online' : 'offline') : 'offline'),
      e.detail.pending.length
    );
  });

  // ── Init ────────────────────────────────────────────────────
  updateSyncUI(navigator.onLine ? 'online' : 'offline', 0);

  // Exportar al scope global para que las apps puedan llamarlas
  window._fb           = _fb;
  window._sync         = _sync;
  window.updateSyncUI  = updateSyncUI;
  window.manualSync    = manualSync;
  window.manualPull    = manualPull;
  window.manualPushApp = manualPushApp;
})();
