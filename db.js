/**
 * db.js — Persistencia en IndexedDB.
 *
 * Almacenes (versión de esquema 1):
 *   habits   keyPath "id"   → definición de cada hábito (con historial de horario)
 *   logs     keyPath "id"   → un registro por (fecha, hábito). id = "AAAA-MM-DD|habitId"
 *                             La clave compuesta hace imposible duplicar registros.
 *   notes    keyPath "date" → cierre diario opcional
 *   settings keyPath "key"  → preferencias y configuración
 *
 * Todas las escrituras resuelven la promesa en `transaction.oncomplete`,
 * es decir, SOLO cuando el navegador confirma que los datos quedaron guardados.
 */

export const DB_NAME = 'no-negociables';
export const DB_VERSION = 1;
export const STORES = ['habits', 'logs', 'notes', 'settings'];

let dbPromise = null;

/**
 * Migraciones encadenadas: cada bloque lleva el esquema de la versión N-1 a N.
 * Nunca se borran almacenes con datos; para cambios futuros se agrega un
 * nuevo `if (oldVersion < N)` que transforme los registros existentes.
 */
function migrate(db, oldVersion, tx) {
  if (oldVersion < 1) {
    db.createObjectStore('habits', { keyPath: 'id' });
    const logs = db.createObjectStore('logs', { keyPath: 'id' });
    logs.createIndex('date', 'date', { unique: false });
    logs.createIndex('habitId', 'habitId', { unique: false });
    db.createObjectStore('notes', { keyPath: 'date' });
    db.createObjectStore('settings', { keyPath: 'key' });
  }
  // Ejemplo de migración futura:
  // if (oldVersion < 2) { const s = tx.objectStore('habits'); ...cursor que agrega campos... }
  void tx;
}

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('Este navegador no permite guardar datos (IndexedDB no disponible).'));
      return;
    }
    let req;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (e) {
      reject(new Error('No se pudo abrir el almacenamiento local: ' + e.message));
      return;
    }
    req.onupgradeneeded = (ev) => migrate(req.result, ev.oldVersion, req.transaction);
    req.onsuccess = () => {
      const db = req.result;
      // Si otra pestaña abre una versión nueva, cerramos para no bloquear su migración.
      db.onversionchange = () => { db.close(); dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => reject(new Error('Error al abrir el almacenamiento: ' + (req.error && req.error.message)));
    req.onblocked = () => reject(new Error('Cierra las otras pestañas de NO NEGOCIABLES para actualizar el almacenamiento.'));
  });
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

/** Ejecuta `work(tx)` en una transacción y resuelve cuando se confirma. */
async function run(storeNames, mode, work) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    let tx;
    try {
      tx = db.transaction(storeNames, mode);
    } catch (e) {
      reject(e);
      return;
    }
    let result;
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error || new Error('Error de almacenamiento'));
    tx.onabort = () => reject(tx.error || new Error('La operación de guardado fue cancelada por el navegador'));
    try {
      const maybe = work(tx);
      if (maybe && typeof maybe.then === 'function') {
        // No se deben usar promesas externas dentro de una transacción IDB.
        throw new Error('work() debe ser síncrono');
      }
      result = maybe;
    } catch (e) {
      try { tx.abort(); } catch { /* ya abortada */ }
      reject(e);
    }
  });
}

function reqToPromiseInTx(req, sink, key) {
  req.onsuccess = () => { sink[key] = req.result; };
}

export async function getAll(store) {
  const sink = {};
  await run([store], 'readonly', (tx) => reqToPromiseInTx(tx.objectStore(store).getAll(), sink, 'v'));
  return sink.v || [];
}

export async function get(store, key) {
  const sink = {};
  await run([store], 'readonly', (tx) => reqToPromiseInTx(tx.objectStore(store).get(key), sink, 'v'));
  return sink.v;
}

export async function getByIndex(store, index, value) {
  const sink = {};
  await run([store], 'readonly', (tx) => reqToPromiseInTx(tx.objectStore(store).index(index).getAll(value), sink, 'v'));
  return sink.v || [];
}

export const put = (store, value) => run([store], 'readwrite', (tx) => { tx.objectStore(store).put(value); });
export const putMany = (store, values) => run([store], 'readwrite', (tx) => {
  const s = tx.objectStore(store);
  values.forEach((v) => s.put(v));
});
export const del = (store, key) => run([store], 'readwrite', (tx) => { tx.objectStore(store).delete(key); });

/** Lee todo el contenido (para respaldos y estadísticas). */
export async function readAll() {
  const sink = {};
  await run(STORES, 'readonly', (tx) => {
    STORES.forEach((s) => reqToPromiseInTx(tx.objectStore(s).getAll(), sink, s));
  });
  return { habits: sink.habits || [], logs: sink.logs || [], notes: sink.notes || [], settings: sink.settings || [] };
}

/**
 * Reemplaza TODO el contenido en una sola transacción atómica.
 * Si algo falla, el navegador revierte y los datos anteriores quedan intactos.
 */
export const replaceAll = (data) => run(STORES, 'readwrite', (tx) => {
  STORES.forEach((s) => {
    const store = tx.objectStore(s);
    store.clear();
    (data[s] || []).forEach((v) => store.put(v));
  });
});

/** Elimina un hábito y todos sus registros de forma atómica. */
export async function deleteHabitCascade(habitId) {
  const logs = await getByIndex('logs', 'habitId', habitId);
  return run(['habits', 'logs'], 'readwrite', (tx) => {
    tx.objectStore('habits').delete(habitId);
    const ls = tx.objectStore('logs');
    logs.forEach((l) => ls.delete(l.id));
  });
}

/** Borra absolutamente todo (Ajustes → borrar datos). */
export const clearEverything = () => run(STORES, 'readwrite', (tx) => {
  STORES.forEach((s) => tx.objectStore(s).clear());
});

/** Pide al navegador almacenamiento persistente (menos riesgo de borrado automático). */
export async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      if (await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    }
  } catch { /* no soportado */ }
  return false;
}

export async function isPersisted() {
  try {
    return !!(navigator.storage && navigator.storage.persisted && await navigator.storage.persisted());
  } catch { return false; }
}
