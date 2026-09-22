# Changelog

Todos los cambios notables de este proyecto se documentan en este archivo.

El formato sigue aproximadamente [Keep a Changelog](https://keepachangelog.com/es-ES/1.0.0/).
La versión actual también es visible dentro de la app (toca el número de
versión en la barra superior o en Ajustes) con un resumen en lenguaje de
usuario — este archivo tiene el detalle completo.

## [1.8.0] - 2026-09-22

### Corregido
- La app se quedaba colgada indefinidamente en la pantalla "VERIFICANDO SESIÓN"
  si Firebase no podía inicializar (config ausente, SDK bloqueado/sin red,
  error al inicializar). Ahora siempre recupera y muestra el login, con un
  mensaje de error específico si el fallo persiste (`wapps-firebase.js`).
- `index.html` cargaba `wapps-pdf.js`, un archivo que nunca existió (404 en
  consola). El código de exportación a PDF (`WPDF`) ya vivía en
  `wapps-store.js`; se quitó la etiqueta `<script>` sobrante.
- El tutorial de bienvenida (`WOnboarding`) se mostraba encima de la pantalla
  de login en la primera visita, bloqueando por completo el botón "ENTRAR CON
  GOOGLE". Ahora solo se muestra después de iniciar sesión.
- El service worker recargaba la página automáticamente ~1-2s después de
  *cualquier* primera visita (no solo en actualizaciones reales), por un
  efecto secundario de `clients.claim()`. Esto podía interrumpir un login con
  popup de Google en curso. Se añadió la guarda estándar para que solo
  recargue en actualizaciones reales.
- `window.WFirebase` era siempre `undefined` (bug de scoping: `const` a nivel
  de script no crea una propiedad en `window`), lo que dejaba muerto el
  monitor de conectividad real y la re-emisión de sesión para listeners
  tardíos — ambos ya implementados pero nunca ejecutados. Corregido.
- `WFirebase.login()` atrapaba el error real de Firebase y devolvía `null`,
  por lo que el mensaje específico de "ventana cerrada" (`auth/popup-closed-by-user`)
  nunca podía mostrarse; toda cancelación mostraba el mensaje genérico.
- `fmt()` en `wapps-utils.js` no incluía `useGrouping: true`, así que los
  números formateados perdían el separador de miles (`1234,50` en vez de
  `1.234,50`), pese a que la documentación de la función prometía ese formato.
- Exportar a PDF sin conexión fallaba en silencio (promesa rechazada sin
  capturar) si no se podía cargar jsPDF desde el CDN. Ahora muestra un aviso
  claro ("No se pudo generar el PDF. ¿Tienes conexión?").
- `delMiembro()` y `delCompartido()` borraban al instante, sin ningún diálogo
  de confirmación (a diferencia de todas las demás acciones de borrado de la
  app). Ahora piden confirmación como el resto.
- El manifest anunciaba los colores del tema claro (`theme_color`/
  `background_color`) aunque la app arranca en modo oscuro por defecto,
  provocando un parpadeo de color al instalar/abrir la PWA.
- La app cargaba las fuentes Anton/Merriweather/Nunito de Google Fonts, pero
  el sistema de temas (`WTheme`) las sobrescribía siempre con Bebas Neue/DM
  Mono/DM Sans — que nunca se llegaban a cargar. El resultado real era la
  fuente por defecto del sistema, no el diseño previsto. Ahora se cargan las
  fuentes correctas.

### Añadido
- Aviso en pantalla (toast) al crear, editar o borrar: grupos, canciones,
  setlists, ensayos, sesiones de estudio, bolos, instrumentos, ajustes de
  instrumentos, integrantes y accesos compartidos. Antes estas 22 acciones
  eran completamente silenciosas.
- Capturas de pantalla reales de la app (no mockups) en `manifest.json`, para
  la ficha de instalación de la PWA.
- Suite de tests automatizados con Playwright (unitarios + end-to-end) que
  cubren el login, el flujo principal de la app y la lógica de sincronización
  offline. Son una herramienta local, no se suben al repositorio — ver
  `tests/README.md`.
- Número de versión de la app visible (toca el número para ver esta lista de
  novedades dentro de la propia app) y este `CHANGELOG.md`.

### Antes de esta versión
El historial de versiones anteriores a la 1.8.0 no se documentó en su
momento.
