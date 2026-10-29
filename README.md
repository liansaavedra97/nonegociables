# NO NEGOCIABLES

Aplicación web progresiva (PWA) para registrar y cumplir tus no negociables cada día. Funciona sin conexión, se instala en el teléfono como una app, no tiene cuentas ni contraseñas, no muestra anuncios y **no envía ningún dato fuera del dispositivo**.

- Idioma: español. Fechas en hora de Ecuador (`America/Guayaquil`).
- Sin servidores, sin bases de datos remotas, sin claves API, sin dependencias de CDN.
- Costo: cero. Se publica gratis en GitHub Pages.

---

## 1. Qué incluye

| Sección | Para qué sirve |
|---|---|
| **Hoy** | Marcar cada hábito programado para hoy, ver `3/5`, el porcentaje y la barra de progreso (un segmento por hábito). Filtro Todos / Pendientes / Hechos. Resumen y cierre del día. |
| **Historial** | Semana actual, calendario mensual por colores, detalle de cualquier día y corrección explícita de días pasados. |
| **Estadísticas** | % de hoy, semana y mes; total completado; racha de días perfectos; mejor hábito y el más descuidado (30 días); rachas actual y mejor por hábito; gráfico de 30 días; mapa de 16 semanas; explicación de cada cálculo. |
| **Hábitos** | Crear, editar, archivar, restaurar, eliminar, marcar como prioritario y reordenar. |
| **Ajustes** | Nombre de la rutina, tema oscuro/claro/sistema, recordatorios, respaldos (JSON y CSV), restauración, instalación, almacenamiento persistente y borrado total. |

Cada hábito tiene: nombre, descripción, categoría (Salud, Disciplina, Aprendizaje, Finanzas, Trabajo, Negocio, Relaciones o Personalizada), tipo (acción o cantidad), objetivo y unidad, criterio de cumplimiento, días de la semana, hora de recordatorio, fecha de inicio, estado activo/archivado, prioridad y orden.

---

## 2. Estructura del proyecto

```
no-negociables/
├── index.html              Estructura de la app (vistas, navegación, iconos SVG)
├── styles.css              Estilos mobile-first, tema oscuro y claro
├── theme-init.js           Aplica el tema antes de pintar (evita parpadeo)
├── app.js                  Estado, pantallas, eventos, recordatorios, service worker
├── db.js                   IndexedDB: esquema, migraciones, transacciones atómicas
├── model.js                Reglas de hábitos, horarios versionados y validación
├── stats.js                Métricas: porcentajes, rachas, mejor/peor hábito
├── dates.js                Fechas locales de Ecuador sin errores de UTC
├── backup.js               Exportar JSON/CSV, validar y restaurar respaldos
├── ui.js                   Plantillas con escape de HTML, avisos y hojas
├── onboarding.js           Asistente de configuración inicial (6 pasos)
├── manifest.webmanifest    Manifiesto PWA (rutas relativas)
├── sw.js                   Service worker (offline y actualizaciones)
├── fonts/archivo.woff2     Tipografía Archivo (licencia OFL, incluida localmente)
├── icons/                  Iconos SVG y PNG (192, 512, maskable, Apple, insignia)
└── tests/                  Pruebas unitarias (Node) y de navegador (Playwright)
```

### Modelo de datos (IndexedDB `no-negociables`, esquema v1)

| Almacén | Clave | Contenido |
|---|---|---|
| `habits` | `id` | Definición del hábito. El horario es una lista de versiones `schedule: [{from, days, target}]`: al editar días u objetivo se agrega una versión que rige desde hoy y el pasado no cambia. `archivePeriods` guarda los periodos archivados. |
| `logs` | `"AAAA-MM-DD\|habitId"` | Un registro por hábito y día: `{date, habitId, done, value}`. La clave compuesta hace imposible duplicar registros. En hábitos de cantidad se guarda el **total** del día, no incrementos. |
| `notes` | `date` | Cierre diario opcional: qué hice bien, qué no cumplí, por qué, qué cambiaré, nota libre. |
| `settings` | `key` | Nombre de la rutina, tema, notificaciones, hora de revisión, fecha de primer uso, último respaldo. |

`localStorage` solo guarda el tema (para no parpadear al abrir) y qué recordatorios ya se mostraron hoy.

### Cómo se calculan las métricas

- **Oportunidad**: un hábito programado en una fecha, desde su fecha de inicio y desde el primer uso de la app. Los días futuros y los días no programados nunca cuentan.
- **% del día** = cumplidos ÷ programados ese día.
- **% de semana o mes** = oportunidades cumplidas ÷ oportunidades del periodo, desde su inicio hasta hoy (incluido hoy en curso). No depende de los días en que abriste la app.
- **Racha de un hábito**: días programados consecutivos cumplidos. Un día libre no la rompe. Si hoy está pendiente, la racha actual se mide hasta ayer.
- **Racha de días perfectos**: días seguidos con el 100 % de lo programado (distinta de la racha por hábito).
- **Días sin registro**: un día pasado sin ninguna anotación cuenta como no cumplido, pero se muestra como "Sin registro" para que lo distingas y lo corrijas desde Historial si corresponde.
- **Mejor / más descuidado**: consistencia de los últimos 30 días, con al menos 3 días programados.

---

## 3. Ejecutar en tu computadora

Los service workers y los módulos JavaScript requieren un servidor (no funcionan abriendo `index.html` con doble clic).

```bash
cd no-negociables
python3 -m http.server 8080
```

Abre `http://localhost:8080/`. Con `localhost` el navegador permite el service worker sin HTTPS.

Para probarlo en tu celular dentro de la misma red Wi-Fi se necesita HTTPS; lo más simple es publicarlo en GitHub Pages (sección 5).

---

## 4. Primer uso y configuración

1. Al abrir por primera vez aparece el asistente: nombre de la rutina → hábitos (cinco ejemplos editables, puedes desmarcarlos todos) → días → horarios → categorías → revisión.
2. Si ya tenías datos en otro teléfono, en el primer paso toca **Restaurar un respaldo**.
3. Las estadísticas empiezan a contar desde ese día. La app nunca inventa días anteriores.
4. Después puedes cambiarlo todo desde **Hábitos** y **Ajustes**.

---

## 5. Publicar gratis en GitHub Pages

### 5.1 Crear el repositorio

1. Crea una cuenta en <https://github.com> si no tienes.
2. Botón **New repository**. Nombre sugerido: `no-negociables`. Visibilidad: **Public** (GitHub Pages gratuito requiere repositorio público en cuentas gratuitas). No marques ninguna opción de README.
3. Pulsa **Create repository**.

### 5.2 Subir los archivos

**Opción A, desde el navegador (sin instalar nada):**

1. En el repositorio vacío, pulsa **uploading an existing file**.
2. Arrastra **el contenido** de la carpeta `no-negociables` (es decir `index.html`, `app.js`, las carpetas `icons/`, `fonts/`, etc.), no la carpeta contenedora. `index.html` debe quedar en la raíz del repositorio.
3. Pulsa **Commit changes**.

**Opción B, con Git:**

```bash
cd no-negociables
git init
git add .
git commit -m "NO NEGOCIABLES 1.0.0"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/no-negociables.git
git push -u origin main
```

### 5.3 Activar Pages

1. En el repositorio: **Settings → Pages**.
2. En **Build and deployment → Source** elige **Deploy from a branch**.
3. **Branch:** `main`, carpeta **`/ (root)`**. Pulsa **Save**.
4. Espera uno o dos minutos y recarga la página de ajustes. Aparecerá la URL:
   `https://TU_USUARIO.github.io/no-negociables/`
5. Abre esa URL. Fíjate que termine en `/`.

### 5.4 Por qué funciona con el nombre del repositorio en la URL

Todas las rutas son relativas (`./app.js`, `./sw.js`, `icons/icon-192.png`). El manifiesto usa `"start_url": "./#today"` y `"scope": "./"`, y el service worker se registra como `./sw.js`, de modo que su alcance es exactamente `/no-negociables/`. No hay que cambiar nada si usas otro nombre de repositorio.

### 5.5 Comprobar que está bien publicada

1. La dirección empieza con `https://` y el navegador muestra el candado.
2. Abre la app, configúrala y marca un hábito.
3. En Chrome de escritorio: `F12 → Application`.
   - **Manifest**: sin errores, iconos visibles.
   - **Service Workers**: `sw.js` en estado *activated and is running*.
   - **Cache Storage**: una caché `nn-v1.0.0` con todos los archivos.
   - **IndexedDB → no-negociables**: tus hábitos y registros.
4. Prueba sin conexión: activa el modo avión, cierra la app y vuelve a abrirla. Debe cargar y dejarte marcar hábitos. Aparece la etiqueta "Sin conexión".

> No des por publicada la app hasta completar estos pasos con tu URL real.

---

## 6. Instalar en el teléfono

Abre primero la URL con conexión y espera unos segundos a que cargue por completo (así se guardan los archivos para usarla sin internet).

### Android (Chrome)

1. Abre `https://TU_USUARIO.github.io/no-negociables/` en Chrome.
2. Si aparece el aviso **Instalar app**, acéptalo. Si no, menú **⋮ → Instalar app** (en algunas versiones dice **Agregar a la pantalla principal**). También puedes ir a **Ajustes → Instalar app** dentro de NO NEGOCIABLES.
3. Abre la app desde el icono nuevo: se ve a pantalla completa, sin barra del navegador.

En Samsung Internet el menú es **≡ → Agregar página a → Pantalla de inicio**.

### iPhone (Safari)

1. Abre la URL en **Safari** (en iOS, la instalación como app se hace desde Safari).
2. Toca el botón **Compartir** (cuadrado con flecha hacia arriba).
3. Desliza y elige **Agregar a pantalla de inicio**. Confirma con **Agregar**.
4. Abre la app desde el icono. Usa siempre ese icono: en iPhone, la app instalada y Safari guardan sus datos por separado.

Recomendación iPhone: usa la app instalada al menos cada pocas semanas y exporta respaldos con frecuencia. Safari puede borrar datos de sitios que no se usan durante mucho tiempo; las apps añadidas a la pantalla de inicio están mejor protegidas.

---

## 7. Actualizar la app sin perder datos

Tus datos están en IndexedDB y **las actualizaciones no los tocan**. Solo cambian los archivos de la app.

1. Haz tus cambios en los archivos.
2. **Obligatorio:** en `sw.js` cambia la versión, por ejemplo `const VERSION = 'nn-v1.0.1';`. Si agregas un archivo nuevo, añádelo también a la lista `ASSETS`.
3. Opcional: actualiza `APP_VERSION` en `app.js` para verlo en Ajustes.
4. Sube los cambios a GitHub (arrastrando los archivos modificados o con `git commit` + `git push`).
5. En el teléfono, abre la app con conexión. En segundos aparece **"Hay una versión nueva de la app"** → **Actualizar**. La app se recarga con la versión nueva y borra la caché anterior.

El service worker se registra con `updateViaCache: 'none'` y descarga los archivos con `cache: 'reload'`, así que nunca queda atrapado en una versión vieja. Mientras no pulses **Actualizar**, sigue funcionando la versión anterior completa (nunca una mezcla).

### Cambios en la estructura de datos

Si en el futuro cambias la forma de guardar los datos, sube `DB_VERSION` en `db.js` y agrega un bloque `if (oldVersion < 2) { ... }` en `migrate()` que transforme los registros existentes. Nunca borres un almacén con datos. Exporta un respaldo antes de publicar una migración.

---

## 8. Respaldos

- **Exportar respaldo completo (.json)**: hábitos, historial, cierres y ajustes. Incluye una huella SHA-256 del contenido; al exportar, la app vuelve a leer el archivo generado para comprobar que es válido.
- **Exportar registros (.csv)**: una fila por hábito programado y día, separada por punto y coma (formato de Excel en español) y con codificación UTF-8 para que las tildes se vean bien. En Google Sheets: **Archivo → Importar → Subir**, y en "Tipo de separador" elige *Detectar automáticamente* o *Punto y coma*.
- **Restaurar respaldo**: elige el `.json`. La app valida todo el archivo **antes** de tocar tus datos, te muestra un resumen y te deja cancelar. Al confirmar, reemplaza todo en una única transacción: si algo falla, tus datos anteriores quedan intactos. Después compara la huella de lo guardado con la del archivo y te confirma si coinciden.
- Los archivos inválidos, de otra app o manipulados con datos incorrectos se rechazan con un mensaje claro. El respaldo nunca se ejecuta como código: solo se leen campos conocidos.

**Hábito recomendado**: exporta un respaldo cada semana y guárdalo en Google Drive, iCloud o tu correo.

Borrar los datos del navegador, desinstalar la app o cambiar de teléfono elimina el historial si no tienes un respaldo reciente.

---

## 9. Recordatorios: qué funciona y qué no

- Puedes poner una hora por hábito y una hora general para revisar el día.
- **Mientras la app esté abierta** (o en segundo plano reciente), a esa hora verás una notificación del sistema si la activaste en Ajustes y diste permiso; si no, un aviso dentro de la app.
- Al abrir la app siempre aparece un recuadro con los hábitos pendientes cuya hora ya pasó.
- **Limitación real**: sin un servidor de notificaciones push, el teléfono no despierta una app web cerrada a una hora exacta. Esta versión no usa servidores, así que no promete recordatorios con la app cerrada. Para recordatorios garantizados, crea una alarma en el reloj del teléfono con el mismo nombre del hábito.
- En iPhone, las notificaciones web requieren iOS 16.4 o posterior y la app instalada en la pantalla de inicio.

---

## 10. Privacidad y seguridad

- Sin cuentas, contraseñas, analíticas, rastreadores ni anuncios.
- Ningún hábito, nota ni estadística sale del dispositivo. La política de seguridad de contenido (`Content-Security-Policy`) solo permite cargar recursos del propio sitio.
- Todo texto introducido se muestra escapado: un nombre como `<b>hola</b>` aparece tal cual, nunca se interpreta como HTML.
- El CSV antepone `'` a celdas que empiezan con `=`, `+`, `-` o `@` para evitar fórmulas en Excel.
- Ninguna operación se muestra como guardada antes de que IndexedDB confirme la transacción.

---

## 11. Pruebas

```bash
# Unitarias (fechas, rachas, porcentajes, validación). Requiere Node 20+.
node tests/unit.test.mjs

# De navegador (Chromium real). Desde la carpeta que CONTIENE no-negociables/:
pip install playwright && python -m playwright install chromium
python no-negociables/tests/e2e_test.py
```

Las pruebas de navegador simulan el reloj (medianoche, fin de mes, fin de año), cierran y reabren el navegador, trabajan sin conexión, exportan y restauran respaldos y comprueban los anchos 320, 360, 390, 430 y 1280 px.

---

## 12. Mantenimiento rápido

| Quiero… | Dónde |
|---|---|
| Cambiar colores | Variables `--accent`, `--bg`, etc. al inicio de `styles.css` (tema oscuro y claro). |
| Cambiar los ejemplos iniciales | `EXAMPLES` en `onboarding.js`. |
| Agregar una categoría | `CATEGORIES` en `model.js`. |
| Cambiar los mensajes de Hoy | `todayMessage()` en `app.js`. |
| Publicar una versión | Cambiar `VERSION` en `sw.js` y subir. |

Licencia de la tipografía Archivo: SIL Open Font License (`fonts/OFL-LICENSE.txt`).
