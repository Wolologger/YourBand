# YourBand

App de bolsillo para gestionar tu grupo: repertorio, ensayos, instrumentos y modo directo para tocar en vivo. Funciona **sin conexión** y sincroniza tus datos entre dispositivos cuando hay Internet.

## Estructura del proyecto

```
yourband/
├── index.html               ← la app (todo el código vive aquí)
├── manifest.json             ← metadatos de la PWA (nombre, iconos, colores)
├── sw.js                     ← service worker: cachea la app para uso offline
├── offline.html              ← pantalla que se muestra sin red y sin cache
├── 404.html                  ← pantalla de error genérica
├── wapps-config.example.js   ← plantilla de credenciales de Firebase
├── wapps-config.js           ← tus credenciales reales (NO se sube al repo)
├── wapps-utils.js            ← utilidades compartidas (haptics, escape HTML…)
├── wapps-store.js            ← capa de datos: localStorage + cola de sync
├── wapps-firebase.js         ← login con Google + lectura/escritura en Firestore
├── wapps-sync-ui.js          ← indicador visual de estado de sincronización
├── wapps-nav.js               ← ajustes de navegación/scroll
├── wapps-onboarding.js       ← tutorial de bienvenida
├── wapps-common.css          ← ajustes responsive compartidos
├── icons/
│   ├── icon-192.png
│   └── icon-512.png
├── firestore.rules           ← reglas de seguridad de Firestore
├── firebase.json             ← config opcional para desplegar con Firebase Hosting
└── .gitignore
```

Todo el HTML/CSS/JS específico de la app (bandas, canciones, ensayos, instrumentos, modo directo) está en `index.html`. Los archivos `wapps-*` son la "fontanería" compartida: guardado local, sincronización y login.

## Subir a Git

```bash
cd yourband
git init
git add .
git commit -m "YourBand: primera versión"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/yourband.git
git push -u origin main
```

`wapps-config.js` está en `.gitignore` a propósito — nunca se sube. Cada persona que clone el repo copia `wapps-config.example.js` → `wapps-config.js` y pone sus propias claves (ver guía abajo).

Para publicarla como página web, actívala en **Settings → Pages** del repo de GitHub (rama `main`, carpeta `/`), o despliega con Firebase Hosting (paso 5 de la guía).

## Guía: conectar Firebase

### 1. Crear el proyecto
1. Ve a [console.firebase.google.com](https://console.firebase.google.com) → **Crear un proyecto**.
2. Ponle nombre (p. ej. "YourBand") y termina el asistente (puedes desactivar Google Analytics, no hace falta).

### 2. Registrar la app web y copiar la configuración
1. En el panel del proyecto, pulsa el icono **`</>`** ("Añadir app" → Web).
2. Dale un apodo (p. ej. "yourband-web") y pulsa **Registrar app**. No hace falta Firebase Hosting en este paso.
3. Firebase te muestra un bloque `firebaseConfig` con `apiKey`, `authDomain`, `projectId`, etc. Copia esos valores en tu propio `wapps-config.js` (duplica `wapps-config.example.js` y rellénalo):

```js
window.WAPPS_CONFIG = {
  apiKey:            "AIza...",
  authDomain:        "tu-proyecto.firebaseapp.com",
  projectId:         "tu-proyecto",
  storageBucket:     "tu-proyecto.firebasestorage.app",
  messagingSenderId: "...",
  appId:             "1:...:web:..."
};
```

### 3. Activar el login con Google
1. En el menú lateral: **Compilación → Authentication → Get started**.
2. Pestaña **Sign-in method** → activa **Google** → guarda.
3. En **Authentication → Settings → Authorized domains**, añade el dominio donde vayas a alojar la app (por ejemplo `tu-usuario.github.io`, o el dominio que te dé Firebase Hosting). `localhost` ya viene autorizado por defecto, así que puedes probar la app en local sin tocar nada más.

### 4. Activar Firestore (donde se guardan los datos)
1. **Compilación → Firestore Database → Crear base de datos**.
2. Elige una región (la más cercana a ti) y modo de producción.
3. Sube las reglas de seguridad incluidas en `firestore.rules` (pestaña **Reglas** del panel de Firestore, pega el contenido del archivo y publica). Esto asegura que cada usuario solo puede leer y escribir sus propios datos, en `users/{uid}/data/{key}`.

### 5. (Opcional) Desplegar con Firebase Hosting en vez de GitHub Pages
```bash
npm install -g firebase-tools
firebase login
firebase init hosting   # elige "usar un proyecto existente" y el que acabas de crear
firebase deploy
```
El `firebase.json` incluido ya apunta a la carpeta actual como raíz pública.

## Cómo funciona el modo offline

- **Los datos nunca dependen de la red**: cada cambio (canción, ensayo, instrumento) se guarda al instante en el `localStorage` del dispositivo. Firebase es una copia de seguridad y el mecanismo de sincronizar entre tus dispositivos, no la fuente de la verdad.
- Cuando hay conexión, los cambios pendientes se suben solos a Firestore; si no la hay, se quedan en cola (verás "PULL"/"SYNC" en la barra superior) y se suben en cuanto vuelva la red.
- **El `sw.js`** (service worker) guarda en caché la app entera (HTML, CSS, JS, iconos) la primera vez que la visitas. A partir de ahí, abrir la app no requiere red — incluso puedes instalarla en el móvil ("Añadir a pantalla de inicio") y usarla como una app nativa sin conexión.
- Si visitas una URL que no está en caché y no hay red, verás `offline.html` en vez de un error del navegador.
- Cuando publiques una actualización, el service worker la detecta en segundo plano y muestra un aviso ("Hay una versión nueva disponible") para recargar cuando quieras — así nunca te quedas con una versión a medio actualizar.

## Compartir un grupo con otras personas

En Ajustes → Compartir grupo puedes dar acceso a alguien añadiendo su correo de Google y un permiso (solo ver / ver y editar / ver, editar y borrar). Cosas importantes que debes saber:

- **No se envía ningún correo real.** Solo se guarda el permiso; tienes que avisar tú a esa persona para que abra la app con su propia cuenta de Google (con ese mismo correo).
- Esa persona verá el grupo en Ajustes → "Grupos compartidos conmigo", con un botón para abrirlo. Mientras lo tiene abierto verá un aviso arriba del todo y un botón para volver a su propio grupo.
- **La distinción "editar" vs "borrar" es solo de la interfaz**, no de Firestore: technically Firestore solo distingue "puede leer" de "puede escribir el documento entero", así que alguien con permiso de "editor" podría, escribiendo directamente a la base de datos (no desde la app), hacer lo mismo que un "admin". Para el uso normal desde la app la distinción funciona bien, pero no la trates como una barrera de seguridad estricta.
- El modo compartido escribe directamente a Firestore en cuanto guardas (no pasa por la cola offline de tus propios datos), así que para editar el grupo de otra persona necesitas conexión a internet.
- Si cambias las reglas de `firestore.rules` en algún momento, recuerda volver a pegarlas en la consola de Firebase (Firestore Database → Reglas) para que el cambio se aplique.

## Desarrollo local

No hace falta build ni Node: es HTML/CSS/JS plano. Basta con servir la carpeta con cualquier servidor estático (el login con Google necesita `http://` o `https://`, no funciona abriendo el archivo directamente con `file://`):

```bash
cd yourband
python3 -m http.server 8080
# abre http://localhost:8080
```
