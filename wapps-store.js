/**
 * W//APPS — Shared Data Bus v1.1
 * ─────────────────────────────────────────────────────────────────
 * Módulo central de datos y notificaciones para todas las apps.
 * Cárgalo con <script src="wapps-store.js"> antes de tu código.
 * Requiere wapps-firebase.js cargado previamente para sync.
 *
 * APIs disponibles:
 *   WStore.get(app, key)           → valor o null
 *   WStore.set(app, key, value)    → void (guarda, marca pending, emite evento)
 *   WStore.on(app, key, callback)  → unsubscribe fn
 *   WStore.bridge.despensa()       → datos de despensa
 *   WStore.bridge.finanzas()       → datos de finanzas
 *   WStore.bridge.suministros()    → datos de suministros
 *   WStore.bridge.gastosDiarios()  → datos de gastos diarios
 *   WStore.bridge.compra()         → datos de lista de compra
 *   WStore.bridge.semana()         → datos de semana
 *   WStore.bridge.deseados()       → datos de deseados
 *
 *   WNotify.request()              → pide permiso al usuario
 *   WNotify.send(title, body, opts)→ lanza notificación
 *   WNotify.check()                → revisa todas las alertas ahora
 * ─────────────────────────────────────────────────────────────────
 */

// ═══════════════════════════════════════════════════════════════
// STORE — bus de datos con eventos
// ═══════════════════════════════════════════════════════════════
const WStore = (() => {
  const PREFIX = 'wapps.';

  // Mapa de migración: clave nueva → clave legacy antigua
  // Solo se usa UNA VEZ al arrancar para migrar datos al nuevo esquema.
  const MIGRATE_MAP = {
    'wapps.despensa.items':    'despensa_v1',
    'wapps.finanzas.data':     'finanzas_v1',
    'wapps.suministros.data':  'suministros_v1',
    'wapps.gastos.data':       'gastos_v1',
    'wapps.compra.data':       'compra_v1',
    'wapps.semana.data':       'semana_v2',
    'wapps.deseados.data':     'deseados_v1',
    'wapps.obra.data':         'miobra_v2',
    'wapps.instrumentos.data': 'instrumentos_v2',
    'wapps.setlist.data':      'setlist_v1',
    'wapps.coches.data':       'coches_v1',
    'wapps.ninos.data':        'ninos_v1',
  };

  // Migración one-shot: copia datos legacy a claves nuevas si no existen,
  // luego borra las claves legacy. Se ejecuta una sola vez al arrancar.
  function migrateLegacy() {
    const DONE_KEY = 'wapps._migrated_v2';
    try {
      if (localStorage.getItem(DONE_KEY)) return;
      let migrated = 0;
      for (const [newKey, oldKey] of Object.entries(MIGRATE_MAP)) {
        const oldRaw = localStorage.getItem(oldKey);
        if (!oldRaw) continue;
        const newRaw = localStorage.getItem(newKey);
        if (!newRaw) {
          localStorage.setItem(newKey, oldRaw);
          migrated++;
          localStorage.removeItem(oldKey);
        } else {
          try {
            const oldData = JSON.parse(oldRaw);
            const newData = JSON.parse(newRaw);
            const oldTs = new Date(oldData._updatedAt || 0).getTime();
            const newTs = new Date(newData._updatedAt || 0).getTime();
            if (oldTs > newTs) {
              localStorage.setItem(newKey, oldRaw);
              migrated++;
            }
            localStorage.removeItem(oldKey);
          } catch(e) {}
        }
      }
      localStorage.setItem(DONE_KEY, '1');
    } catch(e) {
      console.warn('[WStore] migrateLegacy error:', e);
    }
  }

  // ── Detectar localStorage vacío tras wipe del SW y recuperar Firestore ──
  // Si no hay NINGUNA clave wapps.* de datos, probablemente el navegador
  // purgó el localStorage (iOS/Safari, reinstalación, etc.). En ese caso
  // lanzamos un pull completo en cuanto haya usuario autenticado.
  // NOTA: el pull principal al autenticarse ocurre en wapps-firebase.js
  // (listener wapps:auth-change en WSync). Esta función es el fallback
  // para cuando localStorage está completamente vacío.
  function checkAndRecoverFromFirestore() {
    const hasData = Object.keys(MIGRATE_MAP).some(k => localStorage.getItem(k) !== null);
    if (hasData) return; // localStorage tiene datos — el pull lo gestiona WSync en auth-change

    // Sin datos locales — esperar a que Firebase confirme usuario y tirar pull
    const doRecover = async () => {
      try {
        if (typeof WFirebase === 'undefined' || typeof WSync === 'undefined') return;
        const user = WFirebase.getUser();
        if (!user || !WFirebase.isOnline()) return;
        const ok = await WSync.pullAll(user.uid);
        if (ok) {
          // Emitir evento global para que las apps que ya cargaron se re-rendericen
          window.dispatchEvent(new CustomEvent('wapps:recovered', { detail: { source: 'firestore' } }));
        }
      } catch(e) {
        console.warn('[WStore] checkAndRecoverFromFirestore error:', e);
      }
    };

    // Si Firebase ya tiene usuario, recuperar ahora; si no, esperar auth-change
    if (typeof WFirebase !== 'undefined' && WFirebase.getUser()) {
      doRecover();
    } else {
      const handler = () => { doRecover(); window.removeEventListener('wapps:auth-change', handler); };
      window.addEventListener('wapps:auth-change', handler);
    }
  }

  function storageKey(app, key) {
    return `${PREFIX}${app}.${key}`;
  }

  // Cache en memoria para evitar JSON.parse en cada llamada a get()
  // set() actualiza directamente; el listener sincroniza si otro módulo emite wapps:change
  const _memCache = Object.create(null);
  let _settingKey = null; // evita doble escritura cuando el propio set() emite el evento
  window.addEventListener('wapps:change', e => {
    const k = e.detail?.app && e.detail?.key ? `${e.detail.app}.${e.detail.key}` : null;
    if (k && k !== _settingKey) _memCache[k] = e.detail.value;
  });

  function get(app, key) {
    const cacheKey = `${app}.${key}`;
    if (cacheKey in _memCache) return _memCache[cacheKey];
    const sk = storageKey(app, key);
    try {
      const v = localStorage.getItem(sk);
      const parsed = v !== null ? JSON.parse(v) : null;
      _memCache[cacheKey] = parsed;
      return parsed;
    } catch(e) {}
    return null;
  }

  function set(app, key, value) {
    const sk = storageKey(app, key);
    try {
      // Añadir timestamp para merge offline/online
      const payload = (value && typeof value === 'object' && !Array.isArray(value))
        ? { ...value, _updatedAt: new Date().toISOString() }
        : value;

      localStorage.setItem(sk, JSON.stringify(payload));

      // Actualizar cache y emitir evento (el listener ignora esta clave para evitar doble update)
      const cacheKey = `${app}.${key}`;
      _memCache[cacheKey] = payload;
      _settingKey = cacheKey;
      window.dispatchEvent(new CustomEvent('wapps:change', { detail: { app, key, value: payload } }));
      _settingKey = null;

      // ── Firebase sync ─────────────────────────────────────────
      const storeKey = `${app}.${key}`;

      // Marcar como pendiente siempre (por si no hay red o usuario)
      if (typeof WSync !== 'undefined') {
        WSync.markPending(storeKey);

        // Si hay usuario y red, intentar subir inmediatamente
        if (typeof WFirebase !== 'undefined') {
          const user = WFirebase.getUser();
          if (user && WFirebase.isOnline()) {
            const fsKey = storeKey.replace(/\./g, '_');
            // CRÍTICO: pasar el mismo payload (con el mismo _updatedAt) a Firestore
            // para que local y Firebase queden sincronizados exactamente.
            // pushToFirestore añade su propio _updatedAt — usamos el de payload
            // para evitar la deriva T1 (local) vs T2 (remote) que causa re-syncs infinitos.
            WFirebase.pushToFirestoreExact(user.uid, fsKey, payload)
              .then(ok => {
                if (ok) {
                  WSync.clearPending(storeKey);
                  // Actualizar local con el mismo timestamp confirmado
                  localStorage.setItem(sk, JSON.stringify(payload));
                }
              })
              .catch(() => {}); // silencioso, queda en pending
          }
        }
      }

    } catch(e) { console.warn('WStore.set error:', e); }
  }

  function on(app, key, callback) {
    const handler = (e) => {
      if (e.detail.app === app && e.detail.key === key) {
        callback(e.detail.value);
      }
    };
    // Eventos en misma pestaña
    window.addEventListener('wapps:change', handler);
    // Eventos cross-tab via StorageEvent nativo
    const storageHandler = (e) => {
      const sk = storageKey(app, key);
      if (e.key === sk) {
        try { callback(JSON.parse(e.newValue)); } catch(_) {}
      }
    };
    window.addEventListener('storage', storageHandler);
    // Devuelve función de cleanup
    return () => {
      window.removeEventListener('wapps:change', handler);
      window.removeEventListener('storage', storageHandler);
    };
  }

  // ── Bridges — accesos tipados a cada app ──
  const bridge = {
    despensa() {
      const d = get('despensa', 'items');
      return d?.alimentos || [];
    },
    finanzas() {
      return get('finanzas', 'data') || { ingresos: [], gastos: [] };
    },
    suministros() {
      const d = get('suministros', 'data');
      return d?.facturas || [];
    },
    gastosDiarios() {
      const d = get('gastos', 'data');
      return d?.gastos || [];
    },
    compra() {
      const d = get('compra', 'data');
      return d || null;
    },
    semana() {
      return get('semana', 'data') || null;
    },
    deseados() {
      const d = get('deseados', 'data');
      return d?.items || [];
    },
    // Utilitario: media mensual de suministros por tipo
    suministrosMediaMensual(tipo) {
      const facturas = bridge.suministros()
        .filter(f => f.tipo === tipo)
        .sort((a, b) => b.inicio?.localeCompare(a.inicio) || 0)
        .slice(0, 3);
      if (!facturas.length) return null;
      const medias = facturas.map(f => {
        if (f.inicio && f.fin) {
          const dias = Math.max(1, Math.round(
            (new Date(f.fin) - new Date(f.inicio)) / (1000 * 60 * 60 * 24)
          ));
          return f.importe / (dias / 30);
        }
        return f.importe;
      });
      return medias.reduce((s, v) => s + v, 0) / medias.length;
    },
    // Gastos del mes actual en gastos-diarios
    gastosEsteMes() {
      const now = new Date();
      const prefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      return bridge.gastosDiarios()
        .filter(g => g.fecha?.startsWith(prefix))
        .reduce((s, g) => s + (g.importe || 0), 0);
    },
    // Items de despensa que caducan en N días
    caducidadesProximas(dias = 3) {
      const hoy = new Date();
      hoy.setHours(0, 0, 0, 0);
      return bridge.despensa().filter(item => {
        if (!item.fecha) return false;
        const cad = new Date(item.fecha);
        const diff = Math.ceil((cad - hoy) / (1000 * 60 * 60 * 24));
        return diff <= dias;
      });
    }
  };

  // ── syncOnLoad: pull puntual de un dato desde Firestore ──────────
  // Llámalo al inicio de cada app para aplicar datos remotos si son más recientes.
  // No bloquea el render: la app ya carga con localStorage, esto actualiza en background.
  //
  // Uso:  WStore.syncOnLoad('despensa', 'items', data => render(data));
  //
  async function syncOnLoad(app, key, onUpdate) {
    try {
      // Necesita WFirebase disponible y usuario autenticado
      if (typeof WFirebase === 'undefined') return;
      const user = WFirebase.getUser();
      if (!user || !WFirebase.isOnline()) return;

      const fsKey  = `${app}_${key}`;
      const remote = await WFirebase.pullFromFirestore(user.uid, fsKey);
      if (!remote) return;

      // Comparar timestamps
      const localRaw  = localStorage.getItem(storageKey(app, key));
      const local     = localRaw ? JSON.parse(localRaw) : null;
      const remoteTs  = new Date(remote._updatedAt || 0).getTime();
      const localTs   = new Date(local?._updatedAt  || 0).getTime();

      if (remoteTs > localTs) {
        let merged;

        // Intentar merge inteligente si WSync lo soporta y la diferencia es < 24h
        const ageDiff = remoteTs - localTs;
        const MERGE_WINDOW_MS = 24 * 60 * 60 * 1000;
        if (
          local &&
          ageDiff < MERGE_WINDOW_MS &&
          typeof WSync !== 'undefined' &&
          typeof WSync._mergeArraysForKey === 'function'
        ) {
          merged = WSync._mergeArraysForKey(fsKey, local, remote);
        } else {
          merged = { ...remote };
        }

        // Guardar CON _updatedAt en localStorage para comparaciones futuras
        localStorage.setItem(storageKey(app, key), JSON.stringify(merged));
        // Pasar a la app sin _updatedAt (campo interno)
        const clean = { ...merged };
        delete clean._updatedAt;

        // Notificar a la app
        if (typeof onUpdate === 'function') onUpdate(clean);

        // Emitir evento global
        window.dispatchEvent(new CustomEvent('wapps:change', {
          detail: { app, key, value: clean }
        }));
      }
    } catch(e) {
      console.warn(`[WStore.syncOnLoad] ${app}.${key}:`, e);
    }
  }

  // ── syncAllOnLoad: pull de todas las claves del usuario ─────────
  // Útil en index.html al hacer login para traer todo de golpe.
  async function syncAllOnLoad() {
    try {
      if (typeof WSync === 'undefined' || typeof WFirebase === 'undefined') return;
      const user = WFirebase.getUser();
      if (!user || !WFirebase.isOnline()) return;
      await WSync.pullAll(user.uid);
    } catch(e) {
      console.warn('[WStore.syncAllOnLoad]', e);
    }
  }

  // Ejecutar migración al arrancar
  migrateLegacy();
  // Detectar wipe de localStorage (iOS/Safari/SW) y recuperar desde Firestore
  checkAndRecoverFromFirestore();

  return { get, set, on, bridge, syncOnLoad, syncAllOnLoad };
})();

// ═══════════════════════════════════════════════════════════════
// NOTIFY — sistema de notificaciones
// ═══════════════════════════════════════════════════════════════
const WNotify = (() => {
  const STORE_KEY_PERM   = 'notify.permission';
  const STORE_KEY_LAST   = 'notify.lastCheck';
  const STORE_KEY_CONFIG = 'notify.config';

  const DEFAULT_CONFIG = {
    caducidades:    true,   // Despensa: caducidades próximas
    stockMinimo:    true,   // Despensa: stock bajo
    facturas:       true,   // Suministros: factura sin registrar
    presupuesto:    true,   // Finanzas: presupuesto al límite
    semana:         true,   // Semana: tareas del día
    diasSinGasto:   false,  // Gastos: recordatorio de registro
  };

  function getConfig() {
    try {
      const s = localStorage.getItem(STORE_KEY_CONFIG);
      return s ? { ...DEFAULT_CONFIG, ...JSON.parse(s) } : { ...DEFAULT_CONFIG };
    } catch(e) { return { ...DEFAULT_CONFIG }; }
  }

  function setConfig(cfg) {
    try { localStorage.setItem(STORE_KEY_CONFIG, JSON.stringify(cfg)); } catch(e) {}
  }

  async function request() {
    if (!('Notification' in window)) return 'unsupported';
    if (Notification.permission === 'granted') return 'granted';
    if (Notification.permission === 'denied') return 'denied';
    const result = await Notification.requestPermission();
    try { localStorage.setItem(STORE_KEY_PERM, result); } catch(e) {}
    return result;
  }

  function send(title, body, opts = {}) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const n = new Notification(title, {
      body,
      icon:  opts.icon  || '/pwa-apps/icons/icon-192.png',
      badge: opts.badge || '/pwa-apps/icons/icon-192.png',
      tag:   opts.tag   || 'wapps-generic',
      requireInteraction: opts.persist || false,
      ...opts
    });
    if (opts.url) n.onclick = () => { window.focus(); window.location.href = opts.url; n.close(); };
    return n;
  }

  // ── Checks individuales ──

  function checkCaducidades(config) {
    if (!config.caducidades) return [];
    const items = WStore.bridge.caducidadesProximas(3);
    if (!items.length) return [];
    const hoy   = items.filter(i => { const d = new Date(i.fecha) - new Date(); return Math.ceil(d / 864e5) <= 0; });
    const pronto = items.filter(i => { const d = new Date(i.fecha) - new Date(); const dd = Math.ceil(d / 864e5); return dd > 0 && dd <= 3; });
    const alerts = [];
    if (hoy.length) alerts.push({
      title: '🔴 Caducados hoy',
      body:  hoy.map(i => i.nombre).join(', '),
      tag:   'despensa-hoy',
      url:   'despensa.html'
    });
    if (pronto.length) alerts.push({
      title: '🟠 Caducan pronto',
      body:  pronto.map(i => `${i.nombre} (${i.fecha})`).join(', '),
      tag:   'despensa-pronto',
      url:   'despensa.html'
    });
    return alerts;
  }

  function checkFacturasSinRegistrar(config) {
    if (!config.facturas) return [];
    const facturas = WStore.bridge.suministros();
    const alerts = [];
    ['luz', 'gas', 'agua'].forEach(tipo => {
      const tf = facturas.filter(f => f.tipo === tipo).sort((a, b) => b.inicio?.localeCompare(a.inicio) || 0);
      if (!tf.length) return;
      const ultima = new Date(tf[0].inicio);
      const hoy    = new Date();
      const dias   = Math.floor((hoy - ultima) / 864e5);
      if (dias > 35) {
        alerts.push({
          title: `💡 Suministros — ${tipo}`,
          body:  `Llevas ${dias} días sin registrar una factura de ${tipo}. ¿La has recibido?`,
          tag:   `suministros-${tipo}`,
          url:   'suministros.html'
        });
      }
    });
    return alerts;
  }

  function checkPresupuesto(config) {
    if (!config.presupuesto) return [];
    const fin     = WStore.bridge.finanzas();
    const FREQ_M  = { mensual:1, bimestral:2, trimestral:3, semestral:6, anual:12 };
    const ingresos = (fin.ingresos || []).reduce((s, i) => s + (i.importe / (FREQ_M[i.freq] || 1)), 0);
    if (!ingresos) return [];
    const gastosMes = WStore.bridge.gastosEsteMes();
    const pct = gastosMes / ingresos;
    if (pct >= 0.8) {
      return [{
        title: '💰 Presupuesto al límite',
        body:  `Llevas ${Math.round(pct * 100)}% de tus ingresos gastados este mes (${gastosMes.toFixed(0)} €).`,
        tag:   'finanzas-presupuesto',
        url:   'finanzas.html'
      }];
    }
    return [];
  }

  function checkDiasSinGasto(config) {
    if (!config.diasSinGasto) return [];
    const gastos = WStore.bridge.gastosDiarios();
    if (!gastos.length) return [];
    const ultimo = gastos.map(g => new Date(g.fecha)).sort((a, b) => b - a)[0];
    const dias   = Math.floor((new Date() - ultimo) / 864e5);
    if (dias >= 2) {
      return [{
        title: '📝 Gastos sin registrar',
        body:  `Llevas ${dias} días sin apuntar ningún gasto. ¿Lo tienes al día?`,
        tag:   'gastos-recordatorio',
        url:   'gastos-diarios.html'
      }];
    }
    return [];
  }

  function checkSemana(config) {
    if (!config.semana) return [];
    const data = WStore.bridge.semana();
    if (!data?.tareas?.length) return [];
    const hoy = new Date().toISOString().slice(0, 10);
    const hoyTareas = data.tareas.filter(t => t.fecha === hoy && !t.done);
    if (hoyTareas.length) {
      return [{
        title: '📅 Tareas de hoy',
        body:  `Tienes ${hoyTareas.length} tarea${hoyTareas.length !== 1 ? 's' : ''} pendiente${hoyTareas.length !== 1 ? 's' : ''} para hoy.`,
        tag:   'semana-hoy',
        url:   'semana.html'
      }];
    }
    return [];
  }

  // ── Check maestro ──
  function check() {
    const config  = getConfig();
    const alerts  = [
      ...checkCaducidades(config),
      ...checkFacturasSinRegistrar(config),
      ...checkPresupuesto(config),
      ...checkDiasSinGasto(config),
      ...checkSemana(config),
    ];
    alerts.forEach(a => send(a.title, a.body, { tag: a.tag, url: a.url }));
    try { localStorage.setItem(STORE_KEY_LAST, new Date().toISOString()); } catch(e) {}
    return alerts;
  }

  // ── UI helper: renderiza panel de config de notificaciones ──
  function renderConfigPanel(containerId) {
    const el = document.getElementById(containerId);
    if (!el) return;
    const config = getConfig();
    const perm   = ('Notification' in window) ? Notification.permission : 'unsupported';

    const labels = {
      caducidades:  '🥛 Caducidades en despensa',
      stockMinimo:  '📦 Stock mínimo agotado',
      facturas:     '💡 Facturas sin registrar',
      presupuesto:  '💰 Presupuesto mensual al límite',
      semana:       '📅 Tareas del día',
      diasSinGasto: '📝 Recordatorio de registro de gastos',
    };

    const permBadge = perm === 'granted'
      ? `<span style="color:var(--g);font-size:10px;font-family:var(--fm)">● Notificaciones activadas</span>`
      : perm === 'denied'
      ? `<span style="color:var(--r);font-size:10px;font-family:var(--fm)">● Notificaciones bloqueadas — actívalas en ajustes del navegador</span>`
      : `<button onclick="WNotify.request().then(()=>WNotify.renderConfigPanel('${containerId}'))" style="background:var(--y);color:#0a0a09;border:none;border-radius:6px;padding:7px 14px;font-family:var(--fm);font-size:11px;cursor:pointer;">Activar notificaciones</button>`;

    el.innerHTML = `
      <div style="margin-bottom:12px;">${permBadge}</div>
      ${Object.entries(labels).map(([k, label]) => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:0.5px solid var(--border,rgba(255,255,255,0.07));">
          <span style="font-size:12px;color:var(--text,#f0ebe0);">${label}</span>
          <label style="position:relative;display:inline-block;width:36px;height:20px;cursor:pointer;">
            <input type="checkbox" ${config[k] ? 'checked' : ''} onchange="WNotify._toggleConfig('${k}',this.checked,'${containerId}')"
              style="opacity:0;width:0;height:0;position:absolute;">
            <span style="position:absolute;inset:0;background:${config[k] ? 'var(--y,#e8f040)' : 'var(--dim,#2a2a26)'};border-radius:20px;transition:0.2s;"></span>
            <span style="position:absolute;top:3px;left:${config[k] ? '19px' : '3px'};width:14px;height:14px;background:${config[k] ? '#0a0a09' : '#5a5850'};border-radius:50%;transition:0.2s;"></span>
          </label>
        </div>
      `).join('')}
      ${perm === 'granted' ? `<button onclick="WNotify.check()" style="margin-top:12px;width:100%;padding:9px;background:transparent;border:0.5px solid var(--line2,rgba(255,255,255,0.11));border-radius:8px;color:var(--muted,#5a5850);font-family:var(--fm);font-size:11px;cursor:pointer;">Probar notificaciones ahora</button>` : ''}
    `;
  }

  function _toggleConfig(key, val, containerId) {
    const cfg = getConfig();
    cfg[key] = val;
    setConfig(cfg);
    if (containerId) renderConfigPanel(containerId);
  }

  return { request, send, check, getConfig, setConfig, renderConfigPanel, _toggleConfig };
})();

// ═══════════════════════════════════════════════════════════════
// AUTO-CHECK al cargar cualquier página
// ═══════════════════════════════════════════════════════════════
window.addEventListener('DOMContentLoaded', () => {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  // Solo revisar 1 vez cada 2 horas para no saturar
  try {
    const last = localStorage.getItem('notify.lastCheck');
    if (last) {
      const mins = (Date.now() - new Date(last)) / 60000;
      if (mins < 120) return;
    }
  } catch(e) {}

  // Pequeño delay para no bloquear el render inicial
  setTimeout(() => WNotify.check(), 2000);
});

// ═══════════════════════════════════════════════════════════════
// WTRANSITION — fade-out/in entre páginas
// ═══════════════════════════════════════════════════════════════
const WTransition = (() => {
  const DURATION = 160; // ms

  function go(url) {
    document.body.style.transition = `opacity ${DURATION}ms ease`;
    document.body.style.opacity = '0';
    setTimeout(() => { window.location.href = url; }, DURATION);
  }

  // Intercepta todos los <a href="*.html"> automáticamente
  function _intercept() {
    document.addEventListener('click', e => {
      const a = e.target.closest('a[href]');
      if (!a) return;
      const href = a.getAttribute('href');
      // Solo links internos .html sin target externo
      if (!href || !href.endsWith('.html') || href.startsWith('http') || a.target) return;
      e.preventDefault();
      go(href);
    }, true);
  }

  // Fade-in al cargar
  function _fadeIn() {
    document.body.style.opacity = '0';
    document.body.style.transition = 'none';
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        document.body.style.transition = `opacity ${DURATION}ms ease`;
        document.body.style.opacity = '1';
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { _intercept(); _fadeIn(); });
  } else {
    _intercept(); _fadeIn();
  }

  return { go };
})();

// ═══════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════
// WTHEME — sistema de temas completo
// Controla: modo (dark/light), color de acento, tamaño de fuente
// Se aplica via <style> inyectado en <head> para cubrir inline styles
// ═══════════════════════════════════════════════════════════════
const WTheme = (() => {

  const KEY = 'wapps.theme.prefs';

  // Paletas de acento disponibles
  const ACCENTS = {
    yellow:  { label:'Amarillo', '--y':'#e8f040', '--y-text':'#0a0a09', '--y-rgb':'232,240,64'  },
    blue:    { label:'Azul',     '--y':'#30a8f0', '--y-text':'#ffffff', '--y-rgb':'48,168,240'  },
    green:   { label:'Verde',    '--y':'#30d880', '--y-text':'#0a0a09', '--y-rgb':'48,216,128'  },
    orange:  { label:'Naranja',  '--y':'#f09030', '--y-text':'#ffffff', '--y-rgb':'240,144,48'  },
    pink:    { label:'Rosa',     '--y':'#f060c0', '--y-text':'#ffffff', '--y-rgb':'240,96,192'  },
    white:   { label:'Blanco',   '--y':'#f0ebe0', '--y-text':'#0a0a09', '--y-rgb':'240,235,224' },
  };

  // Tamaños de fuente base
  const FONT_SIZES = {
    small:  { label:'Pequeña', base:'11px', body:'12px' },
    medium: { label:'Normal',  base:'13px', body:'14px' },
    large:  { label:'Grande',  base:'15px', body:'16px' },
  };

  const DEFAULTS = { mode:'dark', accent:'yellow', fontSize:'medium' };

  function getPrefs() {
    try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; }
    catch(e) { return { ...DEFAULTS }; }
  }

  function savePrefs(prefs) {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  }

  // Genera el bloque CSS completo que sobreescribe hardcodes inline
  function _buildCSS(prefs) {
    const isDark = prefs.mode === 'dark';
    const accent = ACCENTS[prefs.accent] || ACCENTS.yellow;
    const fs = FONT_SIZES[prefs.fontSize] || FONT_SIZES.medium;

    // Colores base según modo
    const bg    = isDark ? '#0a0a09' : '#f5f4f0';
    const bg2   = isDark ? '#141412' : '#ffffff';
    const bg3   = isDark ? '#1e1e1b' : '#e8e6e0';
    const text  = isDark ? '#f0ebe0' : '#1a1a18';
    const muted = isDark ? '#5a5850' : '#7a7870';
    const dim   = isDark ? '#2a2a26' : '#c8c6c0';
    const bdr   = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.08)';
    const bdr2  = isDark ? 'rgba(255,255,255,0.13)' : 'rgba(0,0,0,0.15)';
    const line  = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
    const line2 = isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)';
    const grid  = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)';

    return `
:root {
  --bg:${bg}; --bg2:${bg2}; --bg3:${bg3};
  --text:${text}; --muted:${muted}; --dim:${dim};
  --border:${bdr}; --border2:${bdr2};
  --line:${line}; --line2:${line2};
  --y:${accent['--y']}; --y-text:${accent['--y-text']};
  --y-rgb:${accent['--y-rgb']};
  --r:#f04030; --g:#30d880; --b:#30a8f0; --o:#f09030;
  --fh:'Bebas Neue',sans-serif; --fm:'DM Mono',monospace; --fs:'DM Sans',sans-serif;
  --base-size:${fs.base}; --body-size:${fs.body};
}

/* Fondo y texto global */
html, body { background:${bg} !important; color:${text} !important; font-size:${fs.body}; }

/* Inputs y selects */
input, select, textarea {
  background:${bg3} !important;
  color:${text} !important;
  border-color:${bdr2} !important;
}

/* Botón primario — acento con texto correcto */
.btn-y {
  background:var(--y) !important;
  color:var(--y-text) !important;
  border-color:var(--y) !important;
}
.btn-y:hover { opacity:0.88 !important; }

/* Botón secundario — contraste mejorado en modo claro */
.btn:not(.btn-y):not(.btn-r) {
  background:${bg3} !important;
  color:${text} !important;
  border-color:${bdr2} !important;
}
.btn:not(.btn-y):not(.btn-r):hover {
  background:${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'} !important;
}

/* Nav back */
.wnav-back {
  border-color:var(--y) !important;
  background:rgba(var(--y-rgb),0.08) !important;
  color:var(--y) !important;
}
.wnav-back:hover { background:rgba(var(--y-rgb),0.18) !important; }

/* Cards y contenedores */
.wnav, .sync-bar, .tabs, .tab-bar {
  background:${bg} !important;
  border-color:${bdr2} !important;
}
.section-card, .card, .ap-panel, .add-panel, .modal, .block, .hero {
  background:${bg2} !important;
  border-color:${bdr2} !important;
}

/* Tabs activos */
.tab.active { color:var(--y) !important; border-bottom-color:var(--y) !important; }

/* Grid de fondo */
.grid-bg {
  background-image:
    linear-gradient(${grid} 1px, transparent 1px),
    linear-gradient(90deg, ${grid} 1px, transparent 1px) !important;
}

/* Loading overlay */
.wapp-loading { background:${bg}e6 !important; }

/* Spinner de carga */
.wapp-spinner { border-top-color:var(--y) !important; }

/* Logo */
.wnav-logo a span, .logo span, .logo-slash { color:var(--y) !important; }

/* Sync bar dots */
.sync-dot.online { background:var(--g) !important; }
.sync-dot.offline { background:var(--r) !important; }
.sync-dot.syncing { background:var(--y) !important; }

/* Font size scaling */
body, .fm, input, select, button { font-size:${fs.body}; }
.fh, h1, h2, h3 { font-size:calc(${fs.base} * 1.4); }
    `.trim();
  }

  let _styleEl = null;
  function _injectStyle(css) {
    if (!_styleEl) {
      _styleEl = document.createElement('style');
      _styleEl.id = 'wapps-theme';
      document.head.appendChild(_styleEl);
    }
    _styleEl.textContent = css;
  }

  function apply(prefs) {
    _injectStyle(_buildCSS(prefs));
    document.documentElement.setAttribute('data-theme', prefs.mode);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = prefs.mode === 'light' ? '#f5f4f0' : '#0a0a09';
    window.dispatchEvent(new CustomEvent('wapps:theme-change', { detail: prefs }));
  }

  function setMode(mode) {
    const p = { ...getPrefs(), mode };
    savePrefs(p); apply(p);
  }

  function setAccent(accent) {
    const p = { ...getPrefs(), accent };
    savePrefs(p); apply(p);
  }

  function setFontSize(fontSize) {
    const p = { ...getPrefs(), fontSize };
    savePrefs(p); apply(p);
  }

  function get() { return getPrefs().mode; }
  function getAll() { return getPrefs(); }

  // Aplicar inmediatamente al cargar — antes del DOMContentLoaded para evitar flash
  const _initPrefs = getPrefs();
  if (document.readyState === 'loading') {
    // Inyectar en <head> tan pronto como sea posible
    document.addEventListener('DOMContentLoaded', () => apply(_initPrefs));
  } else {
    apply(_initPrefs);
  }

  return { get, getAll, setMode, setAccent, setFontSize, apply, ACCENTS, FONT_SIZES };
})();

// ═══════════════════════════════════════════════════════════════
// WSKELETON — skeleton loaders para contenido en carga
// ═══════════════════════════════════════════════════════════════
const WSkeleton = (() => {

  // CSS inyectado una sola vez
  const CSS = `
    .sk-line{height:12px;border-radius:4px;background:linear-gradient(90deg,var(--bg3,#1e1e1b) 25%,var(--bg2,#141412) 50%,var(--bg3,#1e1e1b) 75%);background-size:200% 100%;animation:sk-shimmer 1.4s infinite;}
    .sk-card{background:var(--bg2,#141412);border:0.5px solid var(--border2,rgba(255,255,255,0.13));border-radius:12px;padding:16px;margin-bottom:10px;}
    @keyframes sk-shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
  `;

  let _injected = false;
  function injectCSS() {
    if (_injected) return;
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    _injected = true;
  }

  // Genera N tarjetas skeleton con líneas de anchos variados
  function cards(n = 3, lines = [80, 50, 65]) {
    injectCSS();
    return Array.from({ length: n }, () => `
      <div class="sk-card">
        ${lines.map(w => `<div class="sk-line" style="width:${w}%;margin-bottom:8px;"></div>`).join('')}
      </div>`).join('');
  }

  // Empty state con mensaje y botón de acción opcional
  function empty(msg, actionLabel, actionFn) {
    const btn = actionLabel
      ? `<button onclick="${actionFn}" style="margin-top:14px;padding:10px 20px;background:var(--y,#e8f040);color:#0a0a09;border:none;border-radius:8px;font-family:var(--fh,'Bebas Neue',sans-serif);font-size:15px;letter-spacing:1px;cursor:pointer;">${actionLabel}</button>`
      : '';
    return `<div style="text-align:center;padding:3rem 1.5rem;color:var(--muted,#5a5850);font-size:13px;line-height:1.8;">${msg}${btn}</div>`;
  }

  return { cards, empty, injectCSS };
})();

// ═══════════════════════════════════════════════════════════════
// WPDF — exportación a PDF con jsPDF
// Uso: await WPDF.export(title, sections)
// sections: [{ title, rows: [[col1, col2, ...]], headers: [...] }]
// ═══════════════════════════════════════════════════════════════
const WPDF = (() => {

  async function _loadjsPDF() {
    if (window.jspdf) return window.jspdf.jsPDF;
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
      s.onload = () => resolve(window.jspdf.jsPDF);
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  async function exportDoc(title, sections) {
    const jsPDF = await _loadjsPDF();
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

    const W = 210, MARGIN = 14;
    let y = 20;

    // Header
    doc.setFillColor(10, 10, 9);
    doc.rect(0, 0, W, 18, 'F');
    doc.setTextColor(232, 240, 64);
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('W//APPS', MARGIN, 12);
    doc.setTextColor(180, 175, 165);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text(new Date().toLocaleDateString('es-ES', { day:'2-digit', month:'long', year:'numeric' }), W - MARGIN, 12, { align: 'right' });

    y = 28;
    doc.setTextColor(30, 30, 27);
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text(title, MARGIN, y);
    y += 10;

    for (const section of sections) {
      if (y > 260) { doc.addPage(); y = 20; }

      // Section title
      doc.setFillColor(232, 240, 64);
      doc.rect(MARGIN, y, W - MARGIN * 2, 7, 'F');
      doc.setTextColor(10, 10, 9);
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.text(section.title.toUpperCase(), MARGIN + 3, y + 5);
      y += 10;

      // Headers
      if (section.headers?.length) {
        const colW = (W - MARGIN * 2) / section.headers.length;
        doc.setFontSize(8);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(90, 88, 80);
        section.headers.forEach((h, i) => doc.text(String(h), MARGIN + i * colW + 2, y));
        y += 6;
        doc.setDrawColor(200, 200, 195);
        doc.line(MARGIN, y, W - MARGIN, y);
        y += 3;
      }

      // Rows
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      for (const row of section.rows) {
        if (y > 270) { doc.addPage(); y = 20; }
        const colW = (W - MARGIN * 2) / row.length;
        doc.setTextColor(30, 30, 27);
        row.forEach((cell, i) => {
          const text = String(cell ?? '').substring(0, 40);
          doc.text(text, MARGIN + i * colW + 2, y);
        });
        y += 6;
      }
      y += 6;
    }

    // Footer
    const pages = doc.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i);
      doc.setFontSize(7);
      doc.setTextColor(150, 148, 140);
      doc.text(`Página ${i} de ${pages} — Exportado desde W//APPS`, W / 2, 290, { align: 'center' });
    }

    const safeName = title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    doc.save(`wapps_${safeName}_${new Date().toISOString().slice(0,10)}.pdf`);
  }

  return { export: exportDoc };
})();
