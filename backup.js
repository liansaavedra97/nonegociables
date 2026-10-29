/**
 * backup.js — Exportar, validar y restaurar respaldos.
 *
 * El JSON de respaldo nunca se ejecuta: se lee con JSON.parse, se valida
 * campo por campo y solo se guardan los campos conocidos y saneados.
 * Incluye una huella (SHA-256) del contenido para verificar que lo restaurado
 * coincide exactamente con lo exportado.
 */
import { readAll, replaceAll, DB_VERSION } from './db.js';
import { sanitizeHabit, sanitizeLog, sanitizeNote, sanitizeSetting, scheduledRule, isDone, logId, categoryLabel } from './model.js';
import { rangeDays, weekday, WEEKDAYS } from './dates.js';

export const BACKUP_FORMAT = 'no-negociables-backup';
export const BACKUP_VERSION = 1;
const MAX_FILE_BYTES = 20 * 1024 * 1024;

/** Orden canónico para que la huella no dependa del orden de lectura. */
function canonical(data) {
  const byKey = (k) => (a, b) => (a[k] < b[k] ? -1 : a[k] > b[k] ? 1 : 0);
  const sortKeys = (o) => {
    if (Array.isArray(o)) return o.map(sortKeys);
    if (o && typeof o === 'object') return Object.keys(o).sort().reduce((acc, k) => { acc[k] = sortKeys(o[k]); return acc; }, {});
    return o;
  };
  return JSON.stringify(sortKeys({
    habits: [...data.habits].sort(byKey('id')),
    logs: [...data.logs].sort(byKey('id')),
    notes: [...data.notes].sort(byKey('date')),
    settings: [...data.settings].sort(byKey('key')),
  }));
}

export async function fingerprint(data) {
  const text = canonical(data);
  if (globalThis.crypto && crypto.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return 'sha256:' + [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  // Respaldo sin contexto seguro: FNV-1a de 32 bits.
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return 'fnv1a:' + h.toString(16).padStart(8, '0');
}

export async function buildBackup() {
  const data = await readAll();
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    schemaVersion: DB_VERSION,
    exportedAt: new Date().toISOString(),
    fingerprint: await fingerprint(data),
    counts: { habits: data.habits.length, logs: data.logs.length, notes: data.notes.length },
    data,
  };
}

export function downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/**
 * Lee y valida un archivo. No toca la base de datos.
 * Devuelve { data, summary, fingerprintOk } o lanza un Error comprensible.
 */
export async function parseBackupFile(file) {
  if (!file) throw new Error('No se seleccionó ningún archivo.');
  if (file.size > MAX_FILE_BYTES) throw new Error('El archivo es demasiado grande para ser un respaldo de esta app.');
  const text = await file.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('El archivo no es un JSON válido. Elige un respaldo exportado desde NO NEGOCIABLES.');
  }
  if (!json || json.format !== BACKUP_FORMAT) throw new Error('El archivo no es un respaldo de NO NEGOCIABLES.');
  if (!Number.isInteger(json.version) || json.version > BACKUP_VERSION) {
    throw new Error('Este respaldo fue creado por una versión más nueva de la app. Actualiza la app e inténtalo de nuevo.');
  }
  const d = json.data;
  if (!d || !Array.isArray(d.habits) || !Array.isArray(d.logs) || !Array.isArray(d.notes) || !Array.isArray(d.settings)) {
    throw new Error('El respaldo está incompleto: faltan hábitos, registros, notas o ajustes.');
  }
  const habits = d.habits.map(sanitizeHabit);
  const ids = new Set();
  habits.forEach((h) => { if (ids.has(h.id)) throw new Error(`Hábito duplicado en el respaldo: ${h.name}`); ids.add(h.id); });
  const logs = d.logs.map((l) => sanitizeLog(l, ids));
  const logIds = new Set();
  logs.forEach((l) => { if (logIds.has(l.id)) throw new Error(`Registro duplicado en el respaldo (${l.date}).`); logIds.add(l.id); });
  const notes = d.notes.map(sanitizeNote);
  const noteDates = new Set();
  notes.forEach((n) => { if (noteDates.has(n.date)) throw new Error(`Nota duplicada en el respaldo (${n.date}).`); noteDates.add(n.date); });
  const settings = d.settings.map(sanitizeSetting).filter(Boolean);
  const data = { habits, logs, notes, settings };
  const fp = await fingerprint(data);
  return {
    data,
    exportedAt: typeof json.exportedAt === 'string' ? json.exportedAt : null,
    expectedFingerprint: typeof json.fingerprint === 'string' ? json.fingerprint : null,
    fingerprint: fp,
    fingerprintOk: json.fingerprint ? json.fingerprint === fp : null,
    summary: { habits: habits.length, logs: logs.length, notes: notes.length },
  };
}

/** Aplica un respaldo ya validado y verifica que lo guardado coincida. */
export async function restoreBackup(parsed) {
  await replaceAll(parsed.data);
  const after = await readAll();
  const fp = await fingerprint(after);
  return { verified: fp === parsed.fingerprint, fingerprint: fp };
}

/* ----------------------------- CSV ----------------------------- */

function csvCell(v) {
  let s = v == null ? '' : String(v);
  // Evita que Excel interprete texto del usuario como fórmula.
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Una fila por oportunidad (hábito programado en una fecha) desde el inicio
 * hasta hoy. Separador ";" (Excel en español); con BOM UTF-8 para tildes.
 */
export async function buildCSV(today, measureFrom) {
  const { habits, logs, notes } = await readAll();
  const logsMap = new Map(logs.map((l) => [l.id, l]));
  const touched = new Set(logs.map((l) => l.date));
  notes.forEach((n) => touched.add(n.date));
  const header = ['fecha', 'dia', 'habito', 'categoria', 'tipo', 'objetivo', 'valor_registrado', 'unidad', 'estado'];
  const rows = [header.join(';')];
  const start = measureFrom || today;
  for (const d of rangeDays(start, today)) {
    for (const h of habits) {
      const rule = scheduledRule(h, d, start);
      if (!rule) continue;
      const log = logsMap.get(logId(d, h.id));
      const done = isDone(h, log, rule);
      let estado;
      if (done) estado = 'Cumplido';
      else if (d === today) estado = 'Pendiente (hoy)';
      else if (!log && !touched.has(d)) estado = 'Sin registro';
      else estado = 'No cumplido';
      const valor = h.type === 'count' ? (log ? log.value : '') : (log ? (log.done ? 1 : 0) : '');
      rows.push([d, WEEKDAYS[weekday(d)], h.name, categoryLabel(h), h.type === 'count' ? 'Cantidad' : 'Acción', h.type === 'count' ? rule.target : '', valor, h.unit, estado].map(csvCell).join(';'));
    }
  }
  return '﻿' + rows.join('\r\n') + '\r\n';
}
