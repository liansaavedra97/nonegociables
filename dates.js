/**
 * dates.js — Fechas locales de Ecuador sin errores de UTC.
 *
 * Regla de oro: dentro de la app TODA fecha de calendario es un texto
 * "AAAA-MM-DD" interpretado en la zona America/Guayaquil. Para hacer
 * aritmética se convierte a un instante UTC a medianoche (Date.UTC), que no
 * tiene horario de verano ni desplazamientos, y se vuelve a texto.
 */

export const TIME_ZONE = 'America/Guayaquil';
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86400000;

let partsFormatter = null;
try {
  partsFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
} catch {
  partsFormatter = null; // Navegador sin soporte de zonas: usamos UTC-5 fijo.
}

/** Devuelve {date:'AAAA-MM-DD', hh, mm} de un instante en hora de Ecuador. */
export function localParts(instant = new Date()) {
  if (partsFormatter) {
    const p = Object.fromEntries(partsFormatter.formatToParts(instant).map((x) => [x.type, x.value]));
    return { date: `${p.year}-${p.month}-${p.day}`, hh: Number(p.hour) % 24, mm: Number(p.minute) };
  }
  // Ecuador continental no usa horario de verano: UTC-5 constante.
  const shifted = new Date(instant.getTime() - 5 * 3600000);
  return { date: shifted.toISOString().slice(0, 10), hh: shifted.getUTCHours(), mm: shifted.getUTCMinutes() };
}

export const todayISO = () => localParts().date;

export function isISODate(s) {
  if (typeof s !== 'string' || !ISO_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function toUTC(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}
function fromUTC(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

export const addDays = (iso, n) => fromUTC(toUTC(iso) + n * DAY_MS);
/** Diferencia en días (b - a). */
export const diffDays = (a, b) => Math.round((toUTC(b) - toUTC(a)) / DAY_MS);
/** 0 = domingo … 6 = sábado. */
export const weekday = (iso) => new Date(toUTC(iso)).getUTCDay();

/** Lunes de la semana que contiene la fecha (semana lunes–domingo). */
export function startOfWeek(iso) {
  const wd = weekday(iso);
  return addDays(iso, -((wd + 6) % 7));
}
export const startOfMonth = (iso) => iso.slice(0, 8) + '01';
export function endOfMonth(iso) {
  const [y, m] = iso.split('-').map(Number);
  return fromUTC(Date.UTC(y, m, 0)); // día 0 del mes siguiente = último día
}
export function addMonths(iso, n) {
  const [y, m] = iso.split('-').map(Number);
  return fromUTC(Date.UTC(y, m - 1 + n, 1));
}

/** Lista inclusiva de fechas entre a y b. */
export function rangeDays(a, b) {
  const out = [];
  if (!a || !b || a > b) return out;
  for (let d = a; d <= b; d = addDays(d, 1)) out.push(d);
  return out;
}

export const minDate = (a, b) => (a < b ? a : b);
export const maxDate = (a, b) => (a > b ? a : b);

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
export const WEEKDAYS_SHORT = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
export const WEEKDAYS_ABBR = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

export const monthName = (iso) => MONTHS[Number(iso.slice(5, 7)) - 1];

/** "miércoles, 28 de octubre de 2026" */
export function formatLong(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${WEEKDAYS[weekday(iso)]}, ${d} de ${MONTHS[m - 1]} de ${y}`;
}
/** "28 oct" */
export function formatShort(iso) {
  const [, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1].slice(0, 3)}`;
}
export function formatMonthYear(iso) {
  const m = monthName(iso);
  return `${m[0].toUpperCase()}${m.slice(1)} ${iso.slice(0, 4)}`;
}
