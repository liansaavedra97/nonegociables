/**
 * model.js — Reglas del dominio: hábitos, horarios, registros y validación.
 *
 * Un hábito guarda su horario como una lista de versiones:
 *   schedule: [{ from: 'AAAA-MM-DD', days: [1,2,3,4,5], target: 30 }]
 * Cuando se editan los días u objetivo se añade una versión nueva que rige
 * desde hoy. Así el pasado conserva los días y objetivos que realmente
 * aplicaban y las estadísticas anteriores no cambian al editar.
 */
import { isISODate, weekday } from './dates.js';

export const CATEGORIES = ['Salud', 'Disciplina', 'Aprendizaje', 'Finanzas', 'Trabajo', 'Negocio', 'Relaciones', 'Personalizada'];
export const ALL_DAYS = [1, 2, 3, 4, 5, 6, 0]; // orden de presentación lunes→domingo
export const LIMITS = { name: 60, description: 160, criteria: 120, unit: 20, customCategory: 30, note: 1000 };
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const ID_RE = /^[A-Za-z0-9_-]{4,64}$/;

export function uid(prefix = 'h') {
  const rnd = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`);
  return `${prefix}_${rnd.replace(/[^A-Za-z0-9]/g, '').slice(0, 24)}`;
}

export const logId = (date, habitId) => `${date}|${habitId}`;

const str = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max) : '');
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : NaN));

/** Versión del horario vigente en una fecha (o null si la fecha es anterior al inicio). */
export function ruleAt(habit, date) {
  if (!habit || date < habit.startDate) return null;
  let rule = null;
  for (const r of habit.schedule) {
    if (r.from <= date) rule = r; else break;
  }
  return rule || habit.schedule[0] || null;
}

export function isArchivedOn(habit, date) {
  return (habit.archivePeriods || []).some((p) => p.from <= date && (!p.to || date < p.to));
}

/**
 * ¿El hábito estaba programado en esa fecha?
 * `measureFrom` es la fecha en que se empezó a usar la app: antes de ella no
 * existe información, así que nunca se considera programado.
 */
export function scheduledRule(habit, date, measureFrom) {
  if (measureFrom && date < measureFrom) return null;
  const rule = ruleAt(habit, date);
  if (!rule) return null;
  if (isArchivedOn(habit, date)) return null;
  if (!rule.days.includes(weekday(date))) return null;
  return rule;
}

/** ¿El registro cumple el criterio con la regla de esa fecha? */
export function isDone(habit, log, rule) {
  if (!log) return false;
  if (habit.type === 'count') return (log.value || 0) >= (rule && rule.target ? rule.target : Infinity);
  return log.done === true;
}

export function categoryLabel(h) {
  return h.category === 'Personalizada' && h.customCategory ? h.customCategory : h.category;
}

/**
 * Aplica una edición de horario conservando la historia.
 * - Si cambia la fecha de inicio, la primera versión se mueve a esa fecha.
 * - Si cambian días u objetivo, se añade una versión que rige desde `effective`.
 */
export function applyScheduleEdit(habit, { startDate, days, target }, effective) {
  let schedule = habit.schedule.map((r) => ({ ...r, days: [...r.days] }));
  if (startDate !== habit.startDate) {
    // Las versiones que empezaban en o antes del nuevo inicio se funden en una sola.
    const before = schedule.filter((r) => r.from <= startDate);
    const base = before.length ? before[before.length - 1] : schedule[0];
    schedule = [{ ...base, from: startDate }, ...schedule.filter((r) => r.from > startDate)];
  }
  const eff = effective < startDate ? startDate : effective;
  const current = ruleAt({ startDate, schedule }, eff) || schedule[0];
  const same = current && sameDays(current.days, days) && (current.target ?? null) === (target ?? null);
  if (!same) {
    // Las versiones que empezaban en `eff` o después quedan reemplazadas por la nueva.
    schedule = schedule.filter((r) => r.from < eff);
    schedule.push({ from: eff, days: [...days].sort(), target: target ?? null });
  }
  if (!schedule.length || schedule[0].from !== startDate) {
    schedule.unshift({ from: startDate, days: [...days].sort(), target: target ?? null });
  }
  return schedule;
}

function sameDays(a, b) {
  return a.length === b.length && [...a].sort().join() === [...b].sort().join();
}

/* ------------------------------------------------------------------ */
/* Validación y saneamiento (formularios y restauración de respaldos)  */
/* ------------------------------------------------------------------ */

function cleanDays(v) {
  if (!Array.isArray(v)) return null;
  const set = new Set(v.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6));
  return set.size ? [...set].sort() : null;
}

/** Devuelve un hábito limpio o lanza un Error con el motivo. */
export function sanitizeHabit(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('hábito con formato inválido');
  const id = typeof raw.id === 'string' && ID_RE.test(raw.id) ? raw.id : null;
  if (!id) throw new Error('hábito sin identificador válido');
  const name = str(raw.name, LIMITS.name);
  if (!name) throw new Error(`el hábito ${id} no tiene nombre`);
  const type = raw.type === 'count' ? 'count' : 'check';
  const category = CATEGORIES.includes(raw.category) ? raw.category : 'Personalizada';
  if (!isISODate(raw.startDate)) throw new Error(`"${name}": fecha de inicio inválida`);
  if (!Array.isArray(raw.schedule) || !raw.schedule.length) throw new Error(`"${name}": horario inválido`);
  const schedule = raw.schedule.map((r) => {
    const days = cleanDays(r && r.days);
    if (!r || !isISODate(r.from) || !days) throw new Error(`"${name}": versión de horario inválida`);
    let target = null;
    if (type === 'count') {
      target = num(r.target);
      if (!(target > 0 && target <= 100000)) throw new Error(`"${name}": objetivo numérico inválido`);
    }
    return { from: r.from, days, target };
  }).sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
  const archivePeriods = Array.isArray(raw.archivePeriods)
    ? raw.archivePeriods.filter((p) => p && isISODate(p.from) && (p.to == null || isISODate(p.to))).map((p) => ({ from: p.from, to: p.to || null }))
    : [];
  const order = Number.isInteger(raw.order) ? raw.order : 0;
  return {
    id, name, type, category,
    customCategory: str(raw.customCategory, LIMITS.customCategory),
    description: str(raw.description, LIMITS.description),
    criteria: str(raw.criteria, LIMITS.criteria),
    unit: str(raw.unit, LIMITS.unit),
    startDate: raw.startDate,
    schedule: schedule[0].from === raw.startDate ? schedule : [{ ...schedule[0], from: raw.startDate }, ...schedule.slice(1)],
    reminderTime: typeof raw.reminderTime === 'string' && TIME_RE.test(raw.reminderTime) ? raw.reminderTime : '',
    archived: raw.archived === true,
    archivePeriods,
    priority: raw.priority === true,
    order,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt.slice(0, 40) : new Date().toISOString(),
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt.slice(0, 40) : new Date().toISOString(),
  };
}

export function sanitizeLog(raw, habitIds) {
  if (!raw || typeof raw !== 'object') throw new Error('registro con formato inválido');
  if (!isISODate(raw.date)) throw new Error('registro con fecha inválida');
  if (typeof raw.habitId !== 'string' || !habitIds.has(raw.habitId)) throw new Error(`registro del ${raw.date} apunta a un hábito inexistente`);
  const value = num(raw.value);
  if (!(value >= 0 && value <= 1000000)) throw new Error(`registro del ${raw.date} con valor inválido`);
  return {
    id: logId(raw.date, raw.habitId),
    date: raw.date,
    habitId: raw.habitId,
    done: raw.done === true,
    value,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt.slice(0, 40) : new Date().toISOString(),
  };
}

export const NOTE_FIELDS = ['good', 'missed', 'why', 'change', 'free'];
export function sanitizeNote(raw) {
  if (!raw || typeof raw !== 'object' || !isISODate(raw.date)) throw new Error('nota con fecha inválida');
  const n = { date: raw.date, updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt.slice(0, 40) : new Date().toISOString() };
  NOTE_FIELDS.forEach((f) => { n[f] = str(raw[f], LIMITS.note); });
  return n;
}

/** Solo se aceptan claves de configuración conocidas y valores simples. */
export const SETTING_KEYS = {
  routineName: (v) => str(v, 40),
  onboarded: (v) => v === true,
  firstUseDate: (v) => (isISODate(v) ? v : undefined),
  theme: (v) => (['dark', 'light', 'system'].includes(v) ? v : 'dark'),
  notifications: (v) => v === true,
  lastBackupAt: (v) => (typeof v === 'string' ? v.slice(0, 40) : undefined),
  reviewTime: (v) => (typeof v === 'string' && TIME_RE.test(v) ? v : ''),
};
export function sanitizeSetting(raw) {
  if (!raw || typeof raw !== 'object' || !Object.prototype.hasOwnProperty.call(SETTING_KEYS, raw.key)) return null;
  const value = SETTING_KEYS[raw.key](raw.value);
  return value === undefined ? null : { key: raw.key, value };
}
