/**
 * app.js — Punto de entrada: estado, navegación y pantallas.
 *
 * Flujo de guardado: cada acción espera la confirmación de IndexedDB y SOLO
 * después actualiza el estado en memoria y la pantalla. Si el guardado falla,
 * se muestra un error y la pantalla sigue reflejando lo que realmente está guardado.
 */
import * as db from './db.js';
import {
  todayISO, localParts, addDays, startOfWeek, startOfMonth, endOfMonth, addMonths, rangeDays,
  formatLong, formatShort, formatMonthYear, weekday, WEEKDAYS, WEEKDAYS_ABBR, WEEKDAYS_SHORT, isISODate, TIME_ZONE,
} from './dates.js';
import {
  CATEGORIES, ALL_DAYS, LIMITS, NOTE_FIELDS, uid, logId, scheduledRule, isDone, categoryLabel, applyScheduleEdit, ruleAt,
} from './model.js';
import { buildContext, dayDetail, periodStats, habitStats, perfectStreak, bestAndWorst } from './stats.js';
import { buildBackup, buildCSV, downloadFile, parseBackupFile, restoreBackup } from './backup.js';
import { html, raw, icon, toast, openSheet, closeSheet, initSheet, sheetHead, confirmDialog } from './ui.js';
import { startOnboarding } from './onboarding.js';

export const APP_VERSION = '1.0.0';

/* ====================================================================== */
/* Estado                                                                  */
/* ====================================================================== */
const state = {
  habits: [],
  logs: new Map(),
  notes: new Map(),
  settings: {},
  today: todayISO(),
  view: 'today',
  todayFilter: 'all',
  histMonth: null,
  histSelected: null,
  histEditing: false,
  justToggled: null,
  busy: new Set(),
  installPrompt: null,
  swWaiting: null,
};

const $ = (sel, root = document) => root.querySelector(sel);
const views = ['today', 'history', 'stats', 'habits', 'settings'];

const measureFrom = () => state.settings.firstUseDate || state.today;
const ctx = () => buildContext({
  habits: state.habits,
  logs: [...state.logs.values()],
  notes: [...state.notes.values()],
  today: state.today,
  measureFrom: measureFrom(),
});
const sortedHabits = (list = state.habits) => [...list].sort((a, b) => (b.priority - a.priority) || (a.order - b.order) || a.name.localeCompare(b.name));
const activeHabits = () => sortedHabits(state.habits.filter((h) => !h.archived));

async function loadAll() {
  const data = await db.readAll();
  state.habits = data.habits;
  state.logs = new Map(data.logs.map((l) => [l.id, l]));
  state.notes = new Map(data.notes.map((n) => [n.date, n]));
  state.settings = Object.fromEntries(data.settings.map((s) => [s.key, s.value]));
}

async function saveSetting(key, value) {
  await db.put('settings', { key, value });
  state.settings[key] = value;
}

/* ====================================================================== */
/* Arranque                                                                */
/* ====================================================================== */
async function boot() {
  initSheet();
  try {
    await loadAll();
  } catch (err) {
    const b = $('#boot');
    b.classList.add('error');
    $('#boot-msg').textContent = `${err.message} Si usas navegación privada, abre la app en una ventana normal.`;
    return;
  }
  applyTheme(state.settings.theme || readLocalTheme());
  $('#boot').hidden = true;
  if (!state.settings.onboarded) {
    showOnboarding();
  } else {
    showApp();
  }
  setupConnectivity();
  setupServiceWorker();
  setupInstall();
  setInterval(tick, 20000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
}

function showOnboarding() {
  $('#app').hidden = true;
  const root = $('#onboarding');
  root.hidden = false;
  startOnboarding(root, {
    onFinish: finishOnboarding,
    onRestore: async (file) => {
      await handleImport(file);
      if (state.settings.onboarded) showApp();
    },
  });
}

async function finishOnboarding({ routineName, reviewTime, habits }) {
  const today = todayISO();
  const now = new Date().toISOString();
  const records = habits.map((h, i) => ({
    id: uid('h'),
    name: h.name.slice(0, LIMITS.name),
    description: '',
    criteria: (h.criteria || '').slice(0, LIMITS.criteria),
    category: CATEGORIES.includes(h.category) ? h.category : 'Personalizada',
    customCategory: h.category === 'Personalizada' ? (h.customCategory || '').slice(0, LIMITS.customCategory) : '',
    type: h.type === 'count' ? 'count' : 'check',
    unit: h.type === 'count' ? (h.unit || '') : '',
    startDate: today,
    schedule: [{ from: today, days: [...h.days].sort(), target: h.type === 'count' ? Number(h.target) : null }],
    reminderTime: h.reminderTime || '',
    archived: false,
    archivePeriods: [],
    priority: false,
    order: i,
    createdAt: now,
    updatedAt: now,
  }));
  await db.putMany('habits', records);
  await db.putMany('settings', [
    { key: 'routineName', value: routineName },
    { key: 'reviewTime', value: reviewTime || '' },
    { key: 'firstUseDate', value: today },
    { key: 'onboarded', value: true },
  ]);
  await loadAll();
  db.requestPersistence();
  $('#onboarding').hidden = true;
  $('#onboarding').innerHTML = '';
  showApp();
  toast('Sistema listo. Empieza por el primero.');
}

let appBound = false;
function showApp() {
  $('#app').hidden = false;
  $('#onboarding').hidden = true;
  $('#onboarding').innerHTML = '';
  updateBrand();
  if (appBound) { navigate(state.view, { focus: false }); return; }
  appBound = true;
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => navigate(t.dataset.view)));
  bindViewEvents();
  const hash = location.hash.replace('#', '');
  navigate(views.includes(hash) ? hash : 'today', { focus: false });
  window.addEventListener('hashchange', () => {
    const v = location.hash.replace('#', '');
    if (views.includes(v) && v !== state.view) navigate(v, { push: false });
  });
  tick();
}

function updateBrand() {
  const name = state.settings.routineName;
  $('#brand-name').textContent = name ? name : 'NO NEGOCIABLES';
}

/* ====================================================================== */
/* Navegación                                                              */
/* ====================================================================== */
function navigate(view, { focus = true, push = true } = {}) {
  state.view = view;
  views.forEach((v) => { $(`#view-${v}`).hidden = v !== view; });
  document.querySelectorAll('.tab').forEach((t) => {
    if (t.dataset.view === view) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
  });
  if (push && location.hash !== `#${view}`) history.replaceState(null, '', `#${view}`);
  render();
  window.scrollTo(0, 0);
  if (focus) { const h = $(`#view-${view} .view-title`); if (h) h.focus({ preventScroll: true }); }
}

function render() {
  switch (state.view) {
    case 'today': renderToday(); break;
    case 'history': renderHistory(); break;
    case 'stats': renderStats(); break;
    case 'habits': renderHabits(); break;
    case 'settings': renderSettings(); break;
    default: break;
  }
}

/** Revisa cambio de día y recordatorios. Se ejecuta cada 20 s y al volver a la app. */
function tick() {
  const now = todayISO();
  if (now !== state.today) {
    state.today = now;
    if (state.histSelected && state.histSelected > now) state.histSelected = now;
    if (!$('#sheet').open) render();
  }
  checkReminders();
}

/* ====================================================================== */
/* Utilidades de presentación                                              */
/* ====================================================================== */
const pctText = (p) => (p === null || p === undefined ? '—' : `${p}%`);
function daysLabel(days) {
  if (days.length === 7) return 'Todos los días';
  if (days.length === 5 && [1, 2, 3, 4, 5].every((d) => days.includes(d))) return 'Lunes a viernes';
  if (days.length === 2 && days.includes(0) && days.includes(6)) return 'Fines de semana';
  return ALL_DAYS.filter((d) => days.includes(d)).map((d) => WEEKDAYS_ABBR[d]).join(', ');
}
function goalText(h, rule) {
  if (h.type === 'count') return `Meta: ${rule ? rule.target : ''} ${h.unit}`.trim();
  return h.criteria ? h.criteria : '';
}
const plural = (n, s, p) => (n === 1 ? s : p);

/* ====================================================================== */
/* HOY                                                                     */
/* ====================================================================== */
function todayMessage(det, hasHabits) {
  if (!hasHabits) return 'Define tus no negociables para empezar.';
  if (!det.total) return 'Hoy no tienes no negociables programados.';
  const left = det.total - det.done;
  if (left === 0) return 'Día cumplido. Así se construye.';
  if (det.done === 0) return 'Empieza por el primero.';
  return `${plural(left, 'Falta', 'Faltan')} ${left}. Uno a la vez.`;
}

function renderToday() {
  const root = $('#view-today');
  const c = ctx();
  const det = dayDetail(c, state.today);
  const hasHabits = state.habits.some((h) => !h.archived);
  const order = new Map(activeHabits().map((h, i) => [h.id, i]));
  const items = [...det.items].sort((a, b) => (order.get(a.habit.id) ?? 999) - (order.get(b.habit.id) ?? 999));
  const segs = items.map((it) => {
    let f = it.done ? 1 : 0;
    if (!it.done && it.habit.type === 'count' && it.log) f = Math.min(1, (it.log.value || 0) / it.rule.target);
    return { id: it.habit.id, f };
  });
  let shown = items;
  if (state.todayFilter === 'pending') shown = items.filter((i) => !i.done);
  else if (state.todayFilter === 'done') shown = items.filter((i) => i.done);
  else shown = [...items.filter((i) => !i.done), ...items.filter((i) => i.done)];

  const just = state.justToggled;
  state.justToggled = null;

  root.innerHTML = String(html`
    <h1 class="visually-hidden view-title" id="today-title" tabindex="-1">Hoy</h1>
    <div class="today-head">
      <p class="today-date">${formatLong(state.today)}</p>
      <div class="today-score">
        <p class="score-fraction num" aria-label="${det.done} de ${det.total} cumplidos"><span>${det.done}</span><span class="of">/${det.total}</span></p>
        <div class="score-side">
          <div class="score-pct num">${pctText(det.pct)}</div>
          <div class="score-label">${det.total ? `${det.done} de ${det.total} ${plural(det.total, 'hábito cumplido', 'hábitos cumplidos')}` : 'sin compromisos hoy'}</div>
        </div>
      </div>
      ${det.total ? html`<div class="segbar" role="progressbar" aria-label="Progreso del día" aria-valuemin="0" aria-valuemax="${det.total}" aria-valuenow="${det.done}">
        ${segs.map((s) => html`<span class="seg ${s.id === just ? 'just' : ''}"><i style="--f:${s.f}"></i></span>`)}
      </div>` : ''}
      <p class="today-msg">${todayMessage(det, hasHabits)}</p>
    </div>

    ${det.total ? html`
      <div class="today-actions">
        <div class="segmented" role="group" aria-label="Filtrar hábitos">
          <button type="button" data-filter="all" aria-pressed="${state.todayFilter === 'all'}">Todos</button>
          <button type="button" data-filter="pending" aria-pressed="${state.todayFilter === 'pending'}">Pendientes</button>
          <button type="button" data-filter="done" aria-pressed="${state.todayFilter === 'done'}">Hechos</button>
        </div>
      </div>
      <ul class="habit-list" aria-label="No negociables de hoy">
        ${shown.map((it) => habitRow(it, state.today, it.habit.id === just))}
      </ul>
      ${!shown.length ? html`<p class="muted small" style="text-align:center;margin-top:18px">${state.todayFilter === 'pending' ? 'No hay pendientes.' : 'Todavía no completas ninguno.'}</p>` : ''}
    ` : ''}

    ${!hasHabits ? html`
      <div class="empty"><strong>Aún no tienes no negociables</strong>Crea el primero. Puede ser algo pequeño que harás todos los días.
        <div><button class="btn btn-accent" type="button" data-action="new-habit">${icon('plus')}Crear hábito</button></div>
      </div>` : ''}
    ${hasHabits && !det.total ? html`<div class="empty"><strong>Día libre</strong>Ningún hábito está programado para hoy, así que no cuenta como incumplido.</div>` : ''}

    ${det.total && det.done === det.total ? html`
      <div class="done-card" role="status">
        <h3>Día cumplido</h3>
        <p class="small">${det.total} de ${det.total}. ${perfectLine(c)}</p>
        <button class="btn btn-small" type="button" data-action="day-summary">Ver resumen y cerrar el día</button>
      </div>` : ''}

    <div style="margin-top:18px">
      <button class="btn btn-block" type="button" data-action="day-summary">Resumen del día</button>
    </div>
  `);
}

function perfectLine(c) {
  // Un día completo ya cuenta en la racha (incluido hoy si está al 100 %).
  const { current } = perfectStreak(c);
  return current > 1 ? `Racha perfecta: ${current} días seguidos.` : 'Primer día perfecto de esta racha.';
}

function habitRow(it, date, isJust) {
  const h = it.habit;
  const goal = goalText(h, it.rule);
  let markBtn;
  if (h.type === 'count') {
    const v = it.log ? it.log.value : 0;
    markBtn = html`<button type="button" class="mark count ${it.done ? 'on' : ''} ${!it.done && v > 0 ? 'partial' : ''} ${isJust ? 'just' : ''}"
      data-action="count" data-id="${h.id}" data-date="${date}"
      aria-label="Registrar cantidad de ${h.name}: ${v} de ${it.rule.target} ${h.unit}"><b class="num">${v}</b><small class="num">/${it.rule.target}</small></button>`;
  } else {
    markBtn = html`<button type="button" class="mark ${it.done ? 'on' : ''} ${isJust ? 'just' : ''}" data-action="toggle" data-id="${h.id}" data-date="${date}"
      aria-pressed="${it.done}" aria-label="${it.done ? 'Desmarcar' : 'Marcar como cumplido'}: ${h.name}">${icon('check')}</button>`;
  }
  return html`
    <li class="habit-row ${it.done ? 'is-done' : ''} ${h.priority ? 'priority' : ''}">
      ${markBtn}
      <div class="habit-main">
        <div class="habit-name">${h.name}</div>
        <div class="habit-meta"><span class="cat">${categoryLabel(h)}</span>${goal ? html`<span>${goal}</span>` : ''}${h.reminderTime ? html`<span>${h.reminderTime}</span>` : ''}</div>
        ${h.description ? html`<div class="habit-desc">${h.description}</div>` : ''}
      </div>
      <button class="icon-btn" type="button" data-action="edit" data-id="${h.id}" aria-label="Editar ${h.name}">${icon('more')}</button>
    </li>`;
}

/* -------------------------- acciones de registro -------------------------- */
async function writeLog(habit, date, patch) {
  const id = logId(date, habit.id);
  const prev = state.logs.get(id);
  const log = {
    id, date, habitId: habit.id,
    done: patch.done ?? (prev ? prev.done : false),
    value: patch.value ?? (prev ? prev.value : 0),
    updatedAt: new Date().toISOString(),
  };
  await db.put('logs', log);
  state.logs.set(id, log);
  return log;
}

async function toggleCheck(habitId, date) {
  const key = `${habitId}|${date}`;
  if (state.busy.has(key)) return; // evita doble toque mientras se guarda
  const habit = state.habits.find((h) => h.id === habitId);
  if (!habit) return;
  const rule = scheduledRule(habit, date, measureFrom());
  if (!rule) { toast('Ese hábito no estaba programado para esa fecha.', { error: true }); return; }
  state.busy.add(key);
  try {
    const prev = state.logs.get(logId(date, habitId));
    const nowDone = !(prev && prev.done);
    await writeLog(habit, date, { done: nowDone, value: nowDone ? 1 : 0 });
    state.justToggled = nowDone ? habitId : null;
    render();
    if (date === state.today) {
      if (nowDone) {
        toast(`Guardado: ${habit.name}`, { action: { label: 'Deshacer', run: () => toggleCheck(habitId, date) } });
      } else {
        toast(`Desmarcado: ${habit.name}`);
      }
    }
  } catch (err) {
    toast(`No se guardó el cambio. ${err.message}`, { error: true });
  } finally {
    state.busy.delete(key);
  }
}

function openCountSheet(habitId, date) {
  const habit = state.habits.find((h) => h.id === habitId);
  if (!habit) return;
  const rule = scheduledRule(habit, date, measureFrom());
  if (!rule) return;
  const cur = state.logs.get(logId(date, habitId));
  const start = cur ? cur.value : 0;
  const step = rule.target >= 20 ? 5 : 1;
  openSheet(html`
    ${sheetHead(habit.name)}
    <p class="small muted">${date === state.today ? 'Hoy' : formatLong(date)}. Meta: ${rule.target} ${habit.unit}. Escribe el total realizado; no se suma dos veces.</p>
    <form id="count-form" novalidate>
      <div class="stepper">
        <button type="button" data-step="-${step}" aria-label="Restar ${step}">${icon('minus')}</button>
        <label class="visually-hidden" for="count-val">Cantidad total</label>
        <input id="count-val" type="number" inputmode="decimal" min="0" max="1000000" step="any" value="${start}" autofocus>
        <button type="button" data-step="${step}" aria-label="Sumar ${step}">${icon('plus')}</button>
      </div>
      <div class="quick">
        <button class="btn btn-small" type="button" data-set="${rule.target}">Meta completa (${rule.target})</button>
        <button class="btn btn-small btn-ghost" type="button" data-set="0">Poner en 0</button>
      </div>
      <p class="error-text" id="count-err" hidden></p>
      <div class="sheet-actions">
        <button class="btn" type="button" data-close>Cancelar</button>
        <button class="btn btn-accent" type="submit">Guardar</button>
      </div>
    </form>`, (root) => {
    const input = root.querySelector('#count-val');
    root.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => closeSheet()));
    root.querySelectorAll('[data-step]').forEach((b) => b.addEventListener('click', () => {
      const v = Math.max(0, (Number(input.value) || 0) + Number(b.dataset.step));
      input.value = String(Math.round(v * 100) / 100);
    }));
    root.querySelectorAll('[data-set]').forEach((b) => b.addEventListener('click', () => { input.value = b.dataset.set; }));
    root.querySelector('#count-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = Number(input.value);
      const err = root.querySelector('#count-err');
      if (input.value.trim() === '' || !Number.isFinite(v) || v < 0 || v > 1000000) {
        err.textContent = 'Escribe un número válido (0 o más).';
        err.hidden = false;
        return;
      }
      const btn = e.submitter || root.querySelector('[type=submit]');
      btn.disabled = true;
      try {
        const wasDone = isDone(habit, cur, rule);
        await writeLog(habit, date, { value: v, done: v >= rule.target });
        const nowDone = v >= rule.target;
        state.justToggled = nowDone && !wasDone ? habitId : null;
        closeSheet();
        render();
        toast(nowDone ? `Meta cumplida: ${habit.name}` : `Guardado: ${v} ${habit.unit}`);
      } catch (ex) {
        btn.disabled = false;
        err.textContent = 'No se guardó. ' + ex.message;
        err.hidden = false;
      }
    });
  });
}

/* --------------------------- resumen y cierre --------------------------- */
function openDaySheet(date) {
  const c = ctx();
  const det = dayDetail(c, date);
  const note = state.notes.get(date) || {};
  const missed = det.items.filter((i) => !i.done).map((i) => i.habit.name);
  const isFuture = date > state.today;
  openSheet(html`
    ${sheetHead(date === state.today ? 'Resumen del día' : formatLong(date))}
    <p class="small"><strong class="num">${det.done} de ${det.total}</strong> ${plural(det.total, 'hábito', 'hábitos')} cumplidos${det.pct !== null ? ` (${det.pct}%)` : ''}.
      ${missed.length ? `${date === state.today ? 'Pendientes' : 'No cumplidos'}: ${missed.join(', ')}.` : ''}</p>
    ${isFuture ? html`<p class="muted small">Es un día futuro: todavía no se puede cerrar.</p>` : html`
    <form id="note-form" novalidate>
      <p class="small muted">Cierre opcional. Llena solo lo que te sirva.</p>
      <label class="field"><span>Qué hice bien</span><textarea name="good" maxlength="${LIMITS.note}" rows="2">${note.good || ''}</textarea></label>
      <label class="field"><span>Qué hábito no cumplí</span><input type="text" name="missed" maxlength="${LIMITS.note}" value="${note.missed ?? ''}" placeholder="${missed.join(', ')}"></label>
      <label class="field"><span>Por qué no lo cumplí</span><input type="text" name="why" maxlength="${LIMITS.note}" value="${note.why || ''}"></label>
      <label class="field"><span>Qué voy a cambiar mañana</span><input type="text" name="change" maxlength="${LIMITS.note}" value="${note.change || ''}"></label>
      <label class="field"><span>Nota libre</span><textarea name="free" maxlength="${LIMITS.note}" rows="3">${note.free || ''}</textarea></label>
      <p class="error-text" id="note-err" hidden></p>
      <div class="sheet-actions">
        <button class="btn" type="button" data-close>Cerrar</button>
        <button class="btn btn-accent" type="submit">Guardar cierre</button>
      </div>
    </form>`}`, (root) => {
    root.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => closeSheet()));
    const form = root.querySelector('#note-form');
    if (!form) return;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const n = { date, updatedAt: new Date().toISOString() };
      NOTE_FIELDS.forEach((f) => { n[f] = String(fd.get(f) || '').trim().slice(0, LIMITS.note); });
      const empty = NOTE_FIELDS.every((f) => !n[f]);
      try {
        if (empty) { await db.del('notes', date); state.notes.delete(date); } else { await db.put('notes', n); state.notes.set(date, n); }
        closeSheet();
        render();
        toast(empty ? 'Cierre vacío: no se guardó nada.' : 'Cierre del día guardado.');
      } catch (ex) {
        const err = root.querySelector('#note-err');
        err.textContent = 'No se guardó. ' + ex.message;
        err.hidden = false;
      }
    });
  });
}

/* ====================================================================== */
/* EDITOR DE HÁBITOS                                                       */
/* ====================================================================== */
function openHabitEditor(habitId = null) {
  const h = habitId ? state.habits.find((x) => x.id === habitId) : null;
  const isNew = !h;
  const rule = h ? (ruleAt(h, state.today) || h.schedule[h.schedule.length - 1]) : null;
  const logsCount = h ? [...state.logs.values()].filter((l) => l.habitId === h.id).length : 0;
  const f = {
    name: h ? h.name : '',
    description: h ? h.description : '',
    criteria: h ? h.criteria : '',
    category: h ? h.category : 'Disciplina',
    customCategory: h ? h.customCategory : '',
    type: h ? h.type : 'check',
    target: rule && rule.target ? rule.target : '',
    unit: h ? h.unit : '',
    days: rule ? rule.days : [0, 1, 2, 3, 4, 5, 6],
    reminderTime: h ? h.reminderTime : '',
    startDate: h ? h.startDate : state.today,
    priority: h ? h.priority : false,
  };
  openSheet(html`
    ${sheetHead(isNew ? 'Nuevo hábito' : 'Editar hábito')}
    <form id="habit-form" novalidate>
      <label class="field"><span>Nombre</span>
        <input type="text" name="name" maxlength="${LIMITS.name}" required value="${f.name}" placeholder="Por ejemplo: Leer" ${isNew ? raw('autofocus') : ''}></label>
      <label class="field"><span>Descripción <span class="muted">(opcional)</span></span>
        <input type="text" name="description" maxlength="${LIMITS.description}" value="${f.description}"></label>

      <fieldset class="field"><legend>Tipo de seguimiento</legend>
        <div class="segmented" role="radiogroup">
          <button type="button" role="radio" data-type="check" aria-pressed="${f.type === 'check'}" aria-checked="${f.type === 'check'}" ${!isNew ? raw('disabled') : ''}>Completar una acción</button>
          <button type="button" role="radio" data-type="count" aria-pressed="${f.type === 'count'}" aria-checked="${f.type === 'count'}" ${!isNew ? raw('disabled') : ''}>Alcanzar una cantidad</button>
        </div>
        ${!isNew ? html`<span class="hint">El tipo no se cambia después de crear el hábito para no alterar su historial. Si lo necesitas, crea uno nuevo.</span>` : ''}
      </fieldset>
      <input type="hidden" name="type" value="${f.type}">

      <label class="field" data-only="check"><span>Criterio de cumplimiento <span class="muted">(opcional)</span></span>
        <input type="text" name="criteria" maxlength="${LIMITS.criteria}" value="${f.criteria}" placeholder="Qué tiene que pasar para marcarlo"></label>
      <div class="field-row" data-only="count">
        <label class="field"><span>Objetivo diario</span><input type="number" name="target" inputmode="decimal" min="0" step="any" value="${f.target}" placeholder="30"></label>
        <label class="field"><span>Unidad</span><input type="text" name="unit" maxlength="${LIMITS.unit}" value="${f.unit}" placeholder="minutos, vasos, páginas"></label>
      </div>

      <div class="field-row">
        <label class="field"><span>Categoría</span>
          <select name="category">${CATEGORIES.map((c) => html`<option value="${c}" ${c === f.category ? raw('selected') : ''}>${c}</option>`)}</select></label>
        <label class="field" data-custom-cat ${f.category === 'Personalizada' ? '' : raw('hidden')}><span>Nombre</span>
          <input type="text" name="customCategory" maxlength="${LIMITS.customCategory}" value="${f.customCategory}" placeholder="Tu categoría"></label>
      </div>

      <fieldset class="field"><legend>Días en que aplica</legend>
        <div class="chips">${ALL_DAYS.map((d) => html`<label class="chip"><input type="checkbox" name="days" value="${d}" ${f.days.includes(d) ? raw('checked') : ''} aria-label="${WEEKDAYS[d]}"><span>${WEEKDAYS_SHORT[d]}</span></label>`)}</div>
        <div class="row" style="margin-top:6px">
          <button type="button" class="link-btn" data-days="all">Todos</button>
          <button type="button" class="link-btn" data-days="week">Lunes a viernes</button>
        </div>
        ${!isNew ? html`<span class="hint">Si cambias los días o el objetivo, el cambio aplica desde hoy. Los días anteriores conservan su configuración.</span>` : ''}
      </fieldset>

      <div class="field-row">
        <label class="field"><span>Recordatorio <span class="muted">(opcional)</span></span><input type="time" name="reminderTime" value="${f.reminderTime}"></label>
        <label class="field"><span>Fecha de inicio</span><input type="date" name="startDate" value="${f.startDate}" min="${measureFrom()}" required></label>
      </div>
      <label class="switch field"><span>Prioritario <span class="hint" style="margin:0">Aparece primero y resaltado</span></span>
        <input type="checkbox" name="priority" ${f.priority ? raw('checked') : ''}></label>

      <p class="error-text" id="habit-err" role="alert" hidden></p>
      <div class="sheet-actions">
        <button class="btn" type="button" data-close>Cancelar</button>
        <button class="btn btn-accent" type="submit">${isNew ? 'Crear hábito' : 'Guardar cambios'}</button>
      </div>
      ${!isNew ? html`
        <div class="sheet-actions">
          <button class="btn" type="button" data-archive>${h.archived ? 'Restaurar' : 'Archivar'}</button>
          <button class="btn btn-danger" type="button" data-delete>Eliminar</button>
        </div>
        <p class="tiny muted" style="margin-top:8px">Archivar lo oculta desde hoy y conserva su historial (${logsCount} ${plural(logsCount, 'registro', 'registros')}). Eliminar lo borra por completo.</p>` : ''}
    </form>`, (root) => {
    const form = root.querySelector('#habit-form');
    const typeInput = form.querySelector('[name=type]');
    const syncType = () => {
      root.querySelectorAll('[data-only]').forEach((el) => { el.hidden = el.dataset.only !== typeInput.value; });
      root.querySelectorAll('[data-type]').forEach((b) => { const on = b.dataset.type === typeInput.value; b.setAttribute('aria-pressed', on); b.setAttribute('aria-checked', on); });
    };
    syncType();
    root.querySelectorAll('[data-type]').forEach((b) => b.addEventListener('click', () => { typeInput.value = b.dataset.type; syncType(); }));
    form.querySelector('[name=category]').addEventListener('change', (e) => {
      root.querySelector('[data-custom-cat]').hidden = e.target.value !== 'Personalizada';
    });
    root.querySelectorAll('[data-days]').forEach((b) => b.addEventListener('click', () => {
      const set = b.dataset.days === 'all' ? [0, 1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5];
      form.querySelectorAll('[name=days]').forEach((c) => { c.checked = set.includes(Number(c.value)); });
    }));
    root.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => closeSheet()));
    const archiveBtn = root.querySelector('[data-archive]');
    if (archiveBtn) archiveBtn.addEventListener('click', () => toggleArchive(h.id));
    const delBtn = root.querySelector('[data-delete]');
    if (delBtn) delBtn.addEventListener('click', () => deleteHabit(h.id));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = root.querySelector('#habit-err');
      const fd = new FormData(form);
      const data = {
        name: String(fd.get('name') || '').trim(),
        description: String(fd.get('description') || '').trim(),
        criteria: String(fd.get('criteria') || '').trim(),
        category: String(fd.get('category')),
        customCategory: String(fd.get('customCategory') || '').trim(),
        type: typeInput.value === 'count' ? 'count' : 'check',
        target: Number(fd.get('target')),
        unit: String(fd.get('unit') || '').trim(),
        days: fd.getAll('days').map(Number).sort(),
        reminderTime: String(fd.get('reminderTime') || ''),
        startDate: String(fd.get('startDate') || ''),
        priority: fd.get('priority') === 'on',
      };
      const problem = validateHabitForm(data);
      if (problem) { err.textContent = problem; err.hidden = false; return; }
      const btn = form.querySelector('[type=submit]');
      btn.disabled = true;
      try {
        await saveHabit(h, data);
        closeSheet();
        render();
        toast(isNew ? `Hábito creado: ${data.name}` : 'Cambios guardados.');
      } catch (ex) {
        btn.disabled = false;
        err.textContent = 'No se guardó. ' + ex.message;
        err.hidden = false;
      }
    });
  });
}

function validateHabitForm(d) {
  if (!d.name) return 'Escribe un nombre para el hábito.';
  if (!CATEGORIES.includes(d.category)) return 'Elige una categoría.';
  if (d.category === 'Personalizada' && !d.customCategory) return 'Escribe el nombre de tu categoría personalizada.';
  if (d.type === 'count' && !(Number.isFinite(d.target) && d.target > 0 && d.target <= 100000)) return 'Define un objetivo numérico mayor que 0.';
  if (d.type === 'count' && !d.unit) return 'Indica la unidad de medida (por ejemplo, minutos).';
  if (!d.days.length) return 'Elige al menos un día de la semana.';
  if (!isISODate(d.startDate)) return 'Indica una fecha de inicio válida.';
  if (d.startDate < measureFrom()) return `La fecha de inicio no puede ser anterior al ${formatShort(measureFrom())}, cuando empezaste a usar la app.`;
  return '';
}

async function saveHabit(existing, d) {
  const now = new Date().toISOString();
  const target = d.type === 'count' ? d.target : null;
  let habit;
  if (!existing) {
    const maxOrder = state.habits.reduce((m, x) => Math.max(m, x.order), -1);
    habit = {
      id: uid('h'), name: d.name, description: d.description, criteria: d.type === 'check' ? d.criteria : '',
      category: d.category, customCategory: d.category === 'Personalizada' ? d.customCategory : '',
      type: d.type, unit: d.type === 'count' ? d.unit : '',
      startDate: d.startDate,
      schedule: [{ from: d.startDate, days: d.days, target }],
      reminderTime: d.reminderTime, archived: false, archivePeriods: [], priority: d.priority,
      order: maxOrder + 1, createdAt: now, updatedAt: now,
    };
  } else {
    // El cambio de horario aplica desde hoy (o desde el inicio si aún no empieza).
    const effective = state.today < d.startDate ? d.startDate : state.today;
    habit = {
      ...existing,
      name: d.name, description: d.description, criteria: existing.type === 'check' ? d.criteria : '',
      category: d.category, customCategory: d.category === 'Personalizada' ? d.customCategory : '',
      unit: existing.type === 'count' ? d.unit : '',
      reminderTime: d.reminderTime, priority: d.priority,
      startDate: d.startDate,
      schedule: applyScheduleEdit(existing, { startDate: d.startDate, days: d.days, target: existing.type === 'count' ? target : null }, effective),
      updatedAt: now,
    };
  }
  await db.put('habits', habit);
  const i = state.habits.findIndex((x) => x.id === habit.id);
  if (i >= 0) state.habits[i] = habit; else state.habits.push(habit);
}

async function toggleArchive(id) {
  const h = state.habits.find((x) => x.id === id);
  if (!h) return;
  const periods = (h.archivePeriods || []).map((p) => ({ ...p }));
  let next;
  if (h.archived) {
    const last = periods[periods.length - 1];
    if (last && !last.to) last.to = state.today;
    next = { ...h, archived: false, archivePeriods: periods.filter((p) => !(p.to && p.to <= p.from)), updatedAt: new Date().toISOString() };
  } else {
    periods.push({ from: state.today, to: null });
    next = { ...h, archived: true, archivePeriods: periods, updatedAt: new Date().toISOString() };
  }
  try {
    await db.put('habits', next);
    state.habits[state.habits.indexOf(h)] = next;
    closeSheet();
    render();
    toast(next.archived ? `Archivado: ${h.name}. Su historial se conserva.` : `Restaurado: ${h.name}`);
  } catch (ex) {
    toast('No se guardó el cambio. ' + ex.message, { error: true });
  }
}

async function deleteHabit(id) {
  const h = state.habits.find((x) => x.id === id);
  if (!h) return;
  const n = [...state.logs.values()].filter((l) => l.habitId === id).length;
  const ok = await confirmDialog({
    title: `¿Eliminar "${h.name}"?`,
    body: html`<p>Se borrarán el hábito y ${n} ${plural(n, 'registro diario', 'registros diarios')}. Las estadísticas pasadas dejarán de incluirlo. Esta acción no se puede deshacer.</p>
      <p class="muted">Si solo quieres dejar de verlo, archívalo: así conservas su historial.</p>`,
    confirm: 'Eliminar definitivamente',
    danger: true,
  });
  if (!ok) return;
  try {
    await db.deleteHabitCascade(id);
    state.habits = state.habits.filter((x) => x.id !== id);
    [...state.logs.keys()].forEach((k) => { if (state.logs.get(k).habitId === id) state.logs.delete(k); });
    render();
    toast(`Eliminado: ${h.name}`);
  } catch (ex) {
    toast('No se pudo eliminar. ' + ex.message, { error: true });
  }
}

async function moveHabit(id, dir) {
  const list = activeHabits().filter((h) => !h.priority === !state.habits.find((x) => x.id === id).priority);
  const i = list.findIndex((h) => h.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  // Renumera el grupo para que el orden sea estable y explícito.
  const reordered = [...list];
  [reordered[i], reordered[j]] = [reordered[j], reordered[i]];
  const all = activeHabits();
  const others = all.filter((h) => !reordered.includes(h));
  const merged = reordered[0].priority ? [...reordered, ...others] : [...others, ...reordered];
  const updated = merged.map((h, k) => ({ ...h, order: k }));
  try {
    await db.putMany('habits', updated);
    updated.forEach((u) => { state.habits[state.habits.findIndex((x) => x.id === u.id)] = u; });
    renderHabits();
    const btn = document.querySelector(`[data-action="move"][data-id="${id}"][data-dir="${dir}"]`);
    if (btn && !btn.disabled) btn.focus(); else { const any = document.querySelector(`[data-action="move"][data-id="${id}"]:not([disabled])`); if (any) any.focus(); }
  } catch (ex) {
    toast('No se guardó el nuevo orden. ' + ex.message, { error: true });
  }
}

async function togglePriority(id) {
  const h = state.habits.find((x) => x.id === id);
  const next = { ...h, priority: !h.priority, updatedAt: new Date().toISOString() };
  try {
    await db.put('habits', next);
    state.habits[state.habits.indexOf(h)] = next;
    renderHabits();
    toast(next.priority ? `Prioritario: ${h.name}` : `Ya no es prioritario: ${h.name}`);
  } catch (ex) {
    toast('No se guardó el cambio. ' + ex.message, { error: true });
  }
}

/* ====================================================================== */
/* HÁBITOS                                                                 */
/* ====================================================================== */
function renderHabits() {
  const root = $('#view-habits');
  const active = activeHabits();
  const archived = sortedHabits(state.habits.filter((h) => h.archived));
  const row = (h, i, group) => {
    const rule = ruleAt(h, state.today) || h.schedule[h.schedule.length - 1];
    const notStarted = h.startDate > state.today;
    return html`
    <li class="manage-row">
      <div style="min-width:0">
        <div class="habit-name">${h.name}</div>
        <div class="days-text">${categoryLabel(h)}. ${daysLabel(rule.days)}${h.type === 'count' ? `. ${rule.target} ${h.unit}` : ''}${notStarted ? `. Empieza el ${formatShort(h.startDate)}` : ''}</div>
      </div>
      <div class="tools">
        ${!h.archived ? html`
          <button class="icon-btn ${h.priority ? 'is-on' : ''}" type="button" data-action="priority" data-id="${h.id}" aria-pressed="${h.priority}" aria-label="${h.priority ? 'Quitar prioridad a' : 'Marcar como prioritario'} ${h.name}">${icon(h.priority ? 'star' : 'star-o')}</button>
          <button class="icon-btn" type="button" data-action="move" data-dir="-1" data-id="${h.id}" aria-label="Subir ${h.name}" ${i === 0 || (group[i - 1] && group[i - 1].priority !== h.priority) ? raw('disabled') : ''}>${icon('up')}</button>
          <button class="icon-btn" type="button" data-action="move" data-dir="1" data-id="${h.id}" aria-label="Bajar ${h.name}" ${i === group.length - 1 || (group[i + 1] && group[i + 1].priority !== h.priority) ? raw('disabled') : ''}>${icon('down')}</button>` : ''}
        <button class="icon-btn" type="button" data-action="edit" data-id="${h.id}" aria-label="Editar ${h.name}">${icon('more')}</button>
      </div>
    </li>`;
  };
  root.innerHTML = String(html`
    <h1 class="view-title" id="habits-title" tabindex="-1">Configurar hábitos</h1>
    <button class="btn btn-accent btn-block" type="button" data-action="new-habit">${icon('plus')}Nuevo hábito</button>
    <h2 class="section-title">Activos <span class="muted num">(${active.length})</span></h2>
    ${active.length ? html`<ul class="manage-list">${active.map((h, i) => row(h, i, active))}</ul>`
    : html`<div class="empty"><strong>Sin hábitos activos</strong>Crea tu primer no negociable con el botón de arriba.</div>`}
    <p class="tiny muted" style="margin-top:10px">La estrella marca un hábito como prioritario: aparece primero en Hoy. Las flechas cambian el orden.</p>
    ${archived.length ? html`
      <h2 class="section-title">Archivados <span class="muted num">(${archived.length})</span></h2>
      <p class="small muted">No aparecen en Hoy ni cuentan como incumplidos. Su historial se conserva.</p>
      <ul class="manage-list">${archived.map((h, i) => row(h, i, archived))}</ul>` : ''}
  `);
}

/* ====================================================================== */
/* HISTORIAL                                                               */
/* ====================================================================== */
const STATE_LABEL = {
  complete: 'Completo', partial: 'Parcial', missed: 'Sin cumplir', unrecorded: 'Sin registro',
  rest: 'Sin hábitos programados', future: 'Día futuro', before: 'Antes de empezar', today: 'Hoy, en curso',
};

function renderHistory() {
  const root = $('#view-history');
  const c = ctx();
  if (!state.histMonth) state.histMonth = startOfMonth(state.today);
  if (!state.histSelected) state.histSelected = state.today;
  const month = state.histMonth;
  const first = startOfMonth(month);
  const last = endOfMonth(month);
  const lead = (weekday(first) + 6) % 7; // semana empieza en lunes
  const cells = [];
  for (let i = 0; i < lead; i += 1) cells.push(null);
  rangeDays(first, last).forEach((d) => cells.push(dayDetail(c, d)));
  const canNext = addMonths(month, 1) <= startOfMonth(state.today);
  const canPrev = addMonths(month, -1) >= startOfMonth(addMonths(measureFrom(), -1));

  const wStart = startOfWeek(state.today);
  const week = rangeDays(wStart, addDays(wStart, 6)).map((d) => dayDetail(c, d));
  const ws = periodStats(c, wStart, addDays(wStart, 6));
  const ms = periodStats(c, first, last);

  root.innerHTML = String(html`
    <h1 class="view-title" id="history-title" tabindex="-1">Historial</h1>

    <h2 class="section-title">Esta semana <span class="muted num">${pctText(ws.pct)}</span></h2>
    <div class="week-strip">
      ${week.map((d) => html`<div class="week-day s-${d.state}" ${d.date === state.today ? raw('aria-current="date"') : ''}>
        <b>${WEEKDAYS_ABBR[weekday(d.date)]}</b><span class="num">${d.state === 'future' || d.state === 'before' ? '·' : d.total ? `${d.pct}%` : '—'}</span></div>`)}
    </div>
    <p class="tiny muted" style="margin-top:6px">${ws.total ? `${ws.done} de ${ws.total} oportunidades cumplidas hasta hoy.` : 'Sin oportunidades esta semana todavía.'}</p>

    <h2 class="section-title">Calendario</h2>
    <div class="card cal-card">
      <div class="month-nav">
        <button class="icon-btn" type="button" data-action="month" data-dir="-1" aria-label="Mes anterior" ${canPrev ? '' : raw('disabled')}>${icon('left')}</button>
        <h3>${formatMonthYear(month)}</h3>
        <button class="icon-btn" type="button" data-action="month" data-dir="1" aria-label="Mes siguiente" ${canNext ? '' : raw('disabled')}>${icon('right')}</button>
      </div>
      <div class="cal" role="grid" aria-label="Calendario de ${formatMonthYear(month)}">
        ${[1, 2, 3, 4, 5, 6, 0].map((d) => html`<div class="cal-head" aria-hidden="true">${WEEKDAYS_SHORT[d]}</div>`)}
        ${cells.map((d) => (d ? html`
          <button type="button" class="cal-day s-${d.state} ${d.date === state.histSelected ? 'is-selected' : ''}" data-action="select-day" data-date="${d.date}"
            aria-label="${formatLong(d.date)}: ${STATE_LABEL[d.state]}${d.total && d.state !== 'future' && d.state !== 'before' ? `, ${d.pct}%` : ''}" ${d.date === state.today ? raw('aria-current="date"') : ''}>
            <span class="num">${Number(d.date.slice(8))}</span>
            <small class="num">${['complete', 'partial', 'missed', 'today'].includes(d.state) ? `${d.pct}%` : ''}</small>
          </button>` : html`<div class="cal-day blank" aria-hidden="true"></div>`))}
      </div>
      <div class="legend" aria-hidden="true">
        <span><i class="lg-complete"></i>Completo</span><span><i class="lg-partial"></i>Parcial</span>
        <span><i class="lg-missed"></i>Sin cumplir</span><span><i class="lg-unrecorded"></i>Sin registro</span><span><i class="lg-rest"></i>Descanso</span>
      </div>
      <p class="tiny muted" style="margin-top:10px">Mes: ${ms.total ? `${ms.pct}% (${ms.done} de ${ms.total})` : 'sin oportunidades'}. ${ms.perfectDays} ${plural(ms.perfectDays, 'día completo', 'días completos')}.</p>
    </div>

    <div id="day-detail-wrap">${dayDetailBlock(c, state.histSelected)}</div>
  `);
}

function dayDetailBlock(c, date) {
  const det = dayDetail(c, date);
  const note = state.notes.get(date);
  const editable = date <= state.today && date >= measureFrom() && date !== state.today;
  const editing = state.histEditing && editable;
  let body;
  if (det.state === 'future') body = html`<p class="muted small">Día futuro. No cuenta como incumplido.</p>`;
  else if (det.state === 'before') body = html`<p class="muted small">Antes de que empezaras a usar la app. No hay datos y no se cuentan.</p>`;
  else if (!det.total) body = html`<p class="muted small">Ningún hábito estaba programado. Es un día de descanso: no afecta rachas ni porcentajes.</p>`;
  else {
    body = html`
      ${det.state === 'unrecorded' ? html`<p class="small muted">No hay registros de este día. Se cuenta como no cumplido en las estadísticas, pero puede que simplemente no lo anotaras. Si cumpliste, corrígelo.</p>` : ''}
      ${det.items.map((it) => {
        const v = it.log ? it.log.value : 0;
        const status = it.done ? html`<span class="status ok">Cumplido</span>`
          : date === state.today ? html`<span class="status unk">Pendiente</span>`
            : it.log ? html`<span class="status no">No cumplido</span>`
              : html`<span class="status unk">Sin registro</span>`;
        let control = status;
        if (editing) {
          control = it.habit.type === 'count'
            ? html`<button class="btn btn-small" type="button" data-action="count" data-id="${it.habit.id}" data-date="${date}">${v}/${it.rule.target}</button>`
            : html`<button class="btn btn-small ${it.done ? 'btn-accent' : ''}" type="button" data-action="toggle" data-id="${it.habit.id}" data-date="${date}" aria-pressed="${it.done}">${it.done ? 'Cumplido' : 'Marcar'}</button>`;
        }
        return html`<div class="item"><div><div class="habit-name" style="font-size:15px">${it.habit.name}</div>
          <div class="tiny muted">${it.habit.type === 'count' ? `${v} de ${it.rule.target} ${it.habit.unit}` : categoryLabel(it.habit)}</div></div>${control}</div>`;
      })}`;
  }
  return html`
    <section class="card day-detail" style="margin-top:16px" aria-labelledby="dd-title">
      <div class="row-between">
        <h2 class="section-title" id="dd-title" style="margin:0">${date === state.today ? 'Hoy' : formatLong(date)}</h2>
        <span class="status ${det.state === 'complete' ? 'ok' : det.state === 'missed' ? 'no' : 'unk'} num">${det.total && det.state !== 'future' && det.state !== 'before' ? `${det.done}/${det.total} · ${det.pct}%` : STATE_LABEL[det.state]}</span>
      </div>
      <div style="margin-top:8px">${body}</div>
      <div class="row wrap" style="margin-top:12px">
        ${editable && det.total ? html`<button class="btn btn-small ${editing ? 'btn-accent' : ''}" type="button" data-action="edit-past">${editing ? 'Terminar corrección' : 'Corregir registros'}</button>` : ''}
        ${date === state.today ? html`<button class="btn btn-small" type="button" data-action="goto-today">Ir a Hoy</button>` : ''}
        ${date <= state.today && date >= measureFrom() ? html`<button class="btn btn-small" type="button" data-action="day-note" data-date="${date}">${note ? 'Editar cierre' : 'Escribir cierre'}</button>` : ''}
      </div>
      ${editing ? html`<p class="tiny muted" style="margin-top:8px">Modo corrección: los cambios se guardan al tocar y actualizan las estadísticas.</p>` : ''}
      ${note ? html`<dl class="note-view" style="margin-top:12px">
        ${note.good ? html`<dt>Qué hice bien</dt><dd>${note.good}</dd>` : ''}
        ${note.missed ? html`<dt>Qué no cumplí</dt><dd>${note.missed}</dd>` : ''}
        ${note.why ? html`<dt>Por qué</dt><dd>${note.why}</dd>` : ''}
        ${note.change ? html`<dt>Qué cambiaré</dt><dd>${note.change}</dd>` : ''}
        ${note.free ? html`<dt>Nota</dt><dd>${note.free}</dd>` : ''}
      </dl>` : ''}
    </section>`;
}

/* ====================================================================== */
/* ESTADÍSTICAS                                                            */
/* ====================================================================== */
function renderStats() {
  const root = $('#view-stats');
  const c = ctx();
  const t = periodStats(c, state.today, state.today);
  const wStart = startOfWeek(state.today);
  const w = periodStats(c, wStart, addDays(wStart, 6));
  const m = periodStats(c, startOfMonth(state.today), endOfMonth(state.today));
  const all = periodStats(c, measureFrom(), state.today);
  const perfect = perfectStreak(c);
  const hs = activeHabits().map((h) => habitStats(c, h, 30));
  const bw = bestAndWorst(hs);
  const last30 = periodStats(c, addDays(state.today, -29), state.today);
  const chartDays = rangeDays(addDays(state.today, -29), state.today).map((d) => dayDetail(c, d));

  root.innerHTML = String(html`
    <h1 class="view-title" id="stats-title" tabindex="-1">Estadísticas</h1>
    <div class="kpis">
      <div class="kpi"><b class="num">${pctText(t.pct)}</b><span>Hoy</span><em class="num">${t.done} de ${t.total}</em></div>
      <div class="kpi"><b class="num">${pctText(w.pct)}</b><span>Semana</span><em class="num">${w.done} de ${w.total}</em></div>
      <div class="kpi"><b class="num">${pctText(m.pct)}</b><span>Mes</span><em class="num">${m.done} de ${m.total}</em></div>
    </div>
    <div class="kpis kpis-2">
      <div class="kpi"><b class="num">${all.done}</b><span>Hábitos completados</span><em>desde ${formatShort(measureFrom())}</em></div>
      <div class="kpi"><b class="num">${perfect.current}</b><span>Racha de días perfectos</span><em class="num">mejor: ${perfect.best}</em></div>
    </div>
    ${m.unrecordedDays ? html`<p class="tiny muted" style="margin-top:8px">Este mes hay ${m.unrecordedDays} ${plural(m.unrecordedDays, 'día', 'días')} sin ningún registro; cuentan como no cumplidos. Puedes corregirlos en Historial.</p>` : ''}

    <h2 class="section-title">Lo que destaca</h2>
    ${bw.enough ? html`<div class="insight">
      ${bw.best ? html`<div class="card"><div class="label">Mejor consistencia (30 días)</div><div class="val">${bw.best.habit.name}</div>
        <div class="small muted num">${Math.round(bw.best.windowRate * 100)}%: ${bw.best.windowDone} de ${bw.best.windowOpp} días programados</div></div>` : ''}
      ${bw.worst ? html`<div class="card"><div class="label">El que más estás descuidando</div><div class="val">${bw.worst.habit.name}</div>
        <div class="small muted num">${Math.round(bw.worst.windowRate * 100)}%: ${bw.worst.windowDone} de ${bw.worst.windowOpp} días programados</div></div>`
    : html`<div class="card"><div class="label">El que más estás descuidando</div><div class="val">Ninguno por ahora</div><div class="small muted">Todos tus hábitos tienen la misma consistencia.</div></div>`}
    </div>` : html`<p class="small muted">Se necesitan al menos 3 días programados de un hábito para comparar consistencia. Vuelve en unos días.</p>`}

    <h2 class="section-title">Últimos 30 días <span class="muted num">${pctText(last30.pct)}</span></h2>
    <div class="card">${raw(barChart(chartDays))}
      <p class="tiny muted" style="margin-top:8px">Cada barra es el % de un día. Sin barra: descanso, día antes de empezar o futuro.</p></div>

    <h2 class="section-title">Por hábito</h2>
    ${hs.length ? html`<div class="card">${hs.map((s) => html`
      <div class="habit-stat">
        <div class="row-between"><span class="habit-name" style="font-size:15.5px">${s.habit.name}</span>
          <span class="num small">${s.windowRate === null ? '—' : `${Math.round(s.windowRate * 100)}%`}</span></div>
        <div class="meter" role="img" aria-label="Consistencia de 30 días: ${s.windowRate === null ? 'sin datos' : `${Math.round(s.windowRate * 100)}%`}"><i style="width:${s.windowRate === null ? 0 : Math.round(s.windowRate * 100)}%"></i></div>
        <div class="streaks">
          <span>Racha actual <b class="num">${s.current}</b></span>
          <span>Mejor racha <b class="num">${s.best}</b></span>
          <span>Total <b class="num">${s.totalDone}</b></span>
        </div>
      </div>`)}</div>` : html`<p class="muted small">Todavía no hay hábitos activos.</p>`}

    <h2 class="section-title">Calendario de consistencia</h2>
    <div class="card">${raw(heatmap(c))}
      <div class="legend" aria-hidden="true"><span><i class="lg-missed"></i>0%</span><span><i style="background:color-mix(in srgb,var(--accent) 30%,var(--surface-2))"></i>1–49%</span><span><i style="background:color-mix(in srgb,var(--accent) 60%,var(--surface-2))"></i>50–99%</span><span><i class="lg-complete"></i>100%</span></div>
      <p class="tiny muted" style="margin-top:8px">Últimas 16 semanas. Cada columna es una semana de lunes a domingo.</p></div>

    <details class="card" style="margin-top:16px">
      <summary style="min-height:44px;display:flex;align-items:center;font-weight:650;cursor:pointer">Cómo se calcula</summary>
      <div class="small muted stack">
        <p>Una oportunidad es un hábito programado en una fecha. Solo cuentan los días desde que empezaste a usar la app y desde la fecha de inicio de cada hábito.</p>
        <p>% del día = hábitos cumplidos ÷ hábitos programados ese día. % de semana o mes = oportunidades cumplidas ÷ oportunidades del periodo, desde su inicio hasta hoy, incluido hoy en curso. No depende de los días en que abriste la app.</p>
        <p>Las rachas por hábito cuentan solo sus días programados: un día libre no la rompe. Si hoy aún está pendiente, la racha actual se mide hasta ayer.</p>
        <p>La racha de días perfectos cuenta días seguidos con el 100 % de lo programado; los días sin nada programado no la rompen.</p>
        <p>Un día pasado sin registros se cuenta como no cumplido y se marca como "sin registro" para que lo distingas y lo corrijas si corresponde. Los días futuros nunca cuentan.</p>
        <p>Todas las fechas usan la hora de Ecuador (${TIME_ZONE}).</p>
      </div>
    </details>
  `);
}

function barChart(days) {
  const W = 300; const H = 110; const pad = 16; const n = days.length; const gap = 2;
  const bw = (W - gap * (n - 1)) / n;
  let out = `<svg class="chart" viewBox="0 0 ${W} ${H + pad}" role="img" aria-label="Porcentaje diario de los últimos 30 días">`;
  out += `<line class="axis" x1="0" y1="${H}" x2="${W}" y2="${H}"/>`;
  days.forEach((d, i) => {
    const x = (i * (bw + gap)).toFixed(2);
    const counted = d.total && !['future', 'before', 'rest'].includes(d.state);
    if (counted) {
      const h = Math.max(2, (d.pct / 100) * (H - 4));
      out += `<rect class="${d.pct ? 'bar' : 'bar-empty'}" x="${x}" y="${(H - (d.pct ? h : 3)).toFixed(2)}" width="${bw.toFixed(2)}" height="${(d.pct ? h : 3).toFixed(2)}" rx="1.5"><title>${formatShort(d.date)}: ${d.pct}%</title></rect>`;
    }
  });
  [0, Math.floor(n / 2), n - 1].forEach((i) => {
    const x = i * (bw + gap) + bw / 2;
    out += `<text x="${x.toFixed(1)}" y="${H + 12}" text-anchor="${i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}">${formatShort(days[i].date)}</text>`;
  });
  return out + '</svg>';
}

function heatmap(c) {
  const end = addDays(startOfWeek(state.today), 6);
  const start = addDays(startOfWeek(state.today), -7 * 15);
  let cells = '';
  rangeDays(start, end).forEach((d) => {
    const det = dayDetail(c, d);
    let cls = 'na';
    if (['complete', 'partial', 'missed', 'unrecorded', 'today'].includes(det.state)) {
      cls = det.pct === 0 ? 'l0' : det.pct < 50 ? 'l1' : det.pct < 100 ? 'l2' : 'l3';
    } else if (det.state === 'rest') cls = 'rest';
    cells += `<i class="${cls}" title="${formatShort(d)}${det.pct !== null && cls !== 'na' && cls !== 'rest' ? `: ${det.pct}%` : ''}"></i>`;
  });
  return `<div class="heat" role="img" aria-label="Mapa de consistencia de las últimas 16 semanas">${cells}</div>`;
}

/* ====================================================================== */
/* AJUSTES                                                                 */
/* ====================================================================== */
function readLocalTheme() {
  try { return localStorage.getItem('nn-theme') || 'dark'; } catch { return 'dark'; }
}
function applyTheme(pref) {
  const dark = pref === 'dark' || (pref === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  $('#meta-theme').setAttribute('content', dark ? '#14181F' : '#EDEFF3');
  try { localStorage.setItem('nn-theme', pref); } catch { /* sin almacenamiento */ }
}

const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

async function renderSettings() {
  const root = $('#view-settings');
  const theme = state.settings.theme || readLocalTheme();
  const notifSupported = 'Notification' in window;
  const perm = notifSupported ? Notification.permission : 'unsupported';
  const persisted = await db.isPersisted();
  const lastBackup = state.settings.lastBackupAt;
  const backupAge = lastBackup ? Math.floor((Date.now() - new Date(lastBackup).getTime()) / 86400000) : null;
  root.innerHTML = String(html`
    <h1 class="view-title" id="settings-title" tabindex="-1">Ajustes</h1>

    <div class="settings-group">
      <div class="settings-item">
        <label class="field" style="margin:0"><span>Nombre de tu rutina</span>
          <input type="text" id="set-name" maxlength="40" value="${state.settings.routineName || ''}" placeholder="NO NEGOCIABLES"></label>
      </div>
      <div class="settings-item">
        <h3 id="theme-lbl">Tema</h3>
        <div class="segmented" role="group" aria-labelledby="theme-lbl">
          <button type="button" data-theme-set="dark" aria-pressed="${theme === 'dark'}">Oscuro</button>
          <button type="button" data-theme-set="light" aria-pressed="${theme === 'light'}">Claro</button>
          <button type="button" data-theme-set="system" aria-pressed="${theme === 'system'}">Sistema</button>
        </div>
      </div>
    </div>

    <h2 class="section-title">Recordatorios</h2>
    <div class="settings-group">
      <div class="settings-item">
        <label class="switch"><span><strong>Notificaciones del sistema</strong></span>
          <input type="checkbox" id="set-notif" ${state.settings.notifications && perm === 'granted' ? raw('checked') : ''} ${notifSupported ? '' : raw('disabled')}></label>
        <p>${!notifSupported ? 'Este navegador no ofrece notificaciones. Los recordatorios se muestran dentro de la app.'
    : perm === 'denied' ? 'Las notificaciones están bloqueadas para este sitio. Actívalas desde los ajustes del navegador si las quieres.'
      : 'Se piden permisos solo al activar este interruptor.'}</p>
        <p><strong>Límite real:</strong> sin un servidor, los recordatorios solo funcionan mientras la app está abierta o en segundo plano reciente. Si la cierras por completo, el teléfono no la despierta a la hora indicada. Por eso también se muestran dentro de la app los hábitos cuya hora ya pasó.</p>
        ${isIOS() ? html`<p>En iPhone, las notificaciones web requieren iOS 16.4 o posterior y que la app esté instalada en la pantalla de inicio.</p>` : ''}
        <button class="btn btn-small" type="button" data-action="test-notif" ${notifSupported && perm !== 'denied' ? '' : raw('disabled')}>Probar recordatorio</button>
      </div>
      <div class="settings-item">
        <label class="field" style="margin:0"><span>Hora para revisar el día</span>
          <input type="time" id="set-review" value="${state.settings.reviewTime || ''}">
          <span class="hint">Opcional. Te recuerda hacer el cierre diario si aún no lo escribiste.</span></label>
      </div>
    </div>

    <h2 class="section-title">Respaldos</h2>
    <div class="settings-group">
      <div class="settings-item">
        <p class="warn">Tus datos viven solo en este navegador. Si borras los datos del navegador, desinstalas la app o cambias de teléfono, el historial se pierde a menos que tengas un respaldo reciente.</p>
        <p style="margin-top:10px">${lastBackup ? `Último respaldo: hace ${backupAge === 0 ? 'menos de un día' : `${backupAge} ${plural(backupAge, 'día', 'días')}`}.` : 'Todavía no has exportado un respaldo.'}</p>
      </div>
      <div class="settings-item">
        <h3>Exportar respaldo completo</h3>
        <p>Archivo JSON con hábitos, historial, cierres y preferencias. Sirve para restaurar.</p>
        <button class="btn btn-small btn-accent" type="button" data-action="export-json">Descargar respaldo (.json)</button>
      </div>
      <div class="settings-item">
        <h3>Exportar registros</h3>
        <p>Archivo CSV para Excel o Google Sheets: una fila por hábito programado y día, separada por punto y coma.</p>
        <button class="btn btn-small" type="button" data-action="export-csv">Descargar registros (.csv)</button>
      </div>
      <div class="settings-item">
        <h3>Restaurar respaldo</h3>
        <p>Elige un .json exportado desde esta app. Antes de aplicar nada verás un resumen y podrás cancelar.</p>
        <label class="btn btn-small" for="import-file" style="cursor:pointer">Elegir archivo…</label>
        <input type="file" id="import-file" accept="application/json,.json" class="visually-hidden">
      </div>
    </div>

    <h2 class="section-title">Instalación y almacenamiento</h2>
    <div class="settings-group">
      <div class="settings-item">
        <h3>Instalar en el teléfono</h3>
        ${isStandalone() ? html`<p>La app ya está instalada y abierta como aplicación.</p>`
    : state.installPrompt ? html`<p>Instálala para abrirla desde la pantalla de inicio y usarla sin conexión.</p><button class="btn btn-small btn-accent" type="button" data-action="install">Instalar app</button>`
      : isIOS() ? html`<p>En Safari: toca el botón Compartir y luego "Agregar a pantalla de inicio".</p>`
        : html`<p>Abre el menú del navegador y elige "Instalar app" o "Agregar a la pantalla principal". Si no aparece, la página debe abrirse por HTTPS.</p>`}
      </div>
      <div class="settings-item">
        <h3>Protección del almacenamiento</h3>
        <p>${persisted ? 'El navegador marcó tus datos como persistentes: no los borrará automáticamente por falta de espacio.' : 'El navegador aún no garantiza conservar tus datos si se queda sin espacio. Instalar la app ayuda a que lo conceda.'}</p>
        ${persisted ? '' : html`<button class="btn btn-small" type="button" data-action="persist">Solicitar almacenamiento persistente</button>`}
      </div>
      <div class="settings-item">
        <h3>Fechas</h3>
        <p>Los días cambian a medianoche, hora de Ecuador (${TIME_ZONE}). Usas la app desde el ${formatLong(measureFrom())}.</p>
      </div>
    </div>

    <h2 class="section-title">Zona de riesgo</h2>
    <div class="settings-group">
      <div class="settings-item">
        <h3>Borrar todos los datos</h3>
        <p>Elimina hábitos, historial, cierres y ajustes de este dispositivo. Descarga un respaldo antes.</p>
        <button class="btn btn-small btn-danger" type="button" data-action="wipe">Borrar todo</button>
      </div>
    </div>
    <p class="tiny muted" style="margin:18px 0 0;text-align:center">NO NEGOCIABLES ${APP_VERSION}. Sin cuentas, sin anuncios, sin rastreadores. Ningún dato sale de este dispositivo.</p>
  `);
}

async function exportJSON() {
  try {
    const backup = await buildBackup();
    const text = JSON.stringify(backup, null, 2);
    // Verificación inmediata: el archivo generado debe poder leerse y validarse.
    const check = await parseBackupFile(new File([text], 'check.json', { type: 'application/json' }));
    if (!check.fingerprintOk) throw new Error('La verificación del respaldo falló.');
    downloadFile(`no-negociables-respaldo-${state.today}.json`, text, 'application/json');
    await saveSetting('lastBackupAt', new Date().toISOString());
    toast(`Respaldo descargado: ${backup.counts.habits} hábitos, ${backup.counts.logs} registros, ${backup.counts.notes} cierres.`);
    if (state.view === 'settings') renderSettings();
  } catch (ex) {
    toast('No se pudo exportar. ' + ex.message, { error: true });
  }
}

async function exportCSV() {
  try {
    const csv = await buildCSV(state.today, measureFrom());
    downloadFile(`no-negociables-registros-${state.today}.csv`, csv, 'text/csv;charset=utf-8');
    toast('Registros descargados (.csv).');
  } catch (ex) {
    toast('No se pudo exportar. ' + ex.message, { error: true });
  }
}

async function handleImport(file) {
  let parsed;
  try {
    parsed = await parseBackupFile(file);
  } catch (ex) {
    toast(`No se restauró nada. ${ex.message}`, { error: true, duration: 7000 });
    return;
  }
  const current = { habits: state.habits.length, logs: state.logs.size, notes: state.notes.size };
  const ok = await confirmDialog({
    title: 'Restaurar este respaldo',
    body: html`
      <p>Respaldo${parsed.exportedAt ? ` del ${formatLong(parsed.exportedAt.slice(0, 10))}` : ''}: <strong>${parsed.summary.habits} hábitos, ${parsed.summary.logs} registros y ${parsed.summary.notes} cierres</strong>.</p>
      ${parsed.fingerprintOk === false ? html`<p class="warn">La huella del archivo no coincide con su contenido: pudo editarse a mano. Los datos son válidos, pero revisa que sea el archivo correcto.</p>` : ''}
      <p class="warn" style="margin-top:10px">Esto reemplaza todo lo que hay ahora en este dispositivo (${current.habits} hábitos, ${current.logs} registros, ${current.notes} cierres). Si no tienes respaldo de lo actual, cancela y descárgalo primero.</p>`,
    confirm: 'Reemplazar mis datos',
    danger: true,
  });
  if (!ok) { toast('Restauración cancelada. No se cambió nada.'); return; }
  try {
    const res = await restoreBackup(parsed);
    await loadAll();
    applyTheme(state.settings.theme || readLocalTheme());
    updateBrand();
    state.histMonth = null; state.histSelected = null;
    if (!state.settings.onboarded) { await saveSetting('onboarded', true); }
    if (!state.settings.firstUseDate) {
      const earliest = state.habits.reduce((m, h) => (h.startDate < m ? h.startDate : m), state.today);
      await saveSetting('firstUseDate', earliest);
    }
    render();
    if (res.verified && parsed.fingerprintOk !== false) toast('Respaldo restaurado y verificado: los datos coinciden con el archivo.', { duration: 6000 });
    else if (res.verified) toast('Respaldo restaurado. Los datos guardados coinciden con el archivo leído.', { duration: 6000 });
    else toast('Respaldo restaurado, pero la verificación no coincide. Revisa tus datos y vuelve a intentarlo.', { error: true });
  } catch (ex) {
    toast('La restauración falló y tus datos anteriores se conservaron. ' + ex.message, { error: true, duration: 8000 });
    await loadAll();
    render();
  }
}

async function wipeAll() {
  const ok = await new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    openSheet(html`${sheetHead('Borrar todos los datos')}
      <p class="small">Se eliminarán ${state.habits.length} hábitos, ${state.logs.size} registros y ${state.notes.size} cierres. No se puede deshacer.</p>
      <label class="field"><span>Escribe BORRAR para confirmar</span><input type="text" id="wipe-confirm" autocomplete="off" autocapitalize="characters"></label>
      <div class="sheet-actions"><button class="btn" type="button" data-close>Cancelar</button><button class="btn btn-danger" type="button" data-yes disabled>Borrar todo</button></div>`, (r) => {
      const inp = r.querySelector('#wipe-confirm');
      const yes = r.querySelector('[data-yes]');
      inp.addEventListener('input', () => { yes.disabled = inp.value.trim().toUpperCase() !== 'BORRAR'; });
      yes.addEventListener('click', () => { finish(true); closeSheet(); });
      r.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => { finish(false); closeSheet(); }));
      return () => finish(false);
    });
  });
  if (!ok) return;
  try {
    await db.clearEverything();
    try { localStorage.removeItem('nn-notified'); } catch { /* nada */ }
    await loadAll();
    location.hash = '';
    location.reload();
  } catch (ex) {
    toast('No se pudo borrar. ' + ex.message, { error: true });
  }
}

/* ====================================================================== */
/* Recordatorios (solo con la app abierta)                                 */
/* ====================================================================== */
function readNotified() {
  try {
    const v = JSON.parse(localStorage.getItem('nn-notified') || '{}');
    return v && v.date === state.today && Array.isArray(v.ids) ? v : { date: state.today, ids: [] };
  } catch { return { date: state.today, ids: [] }; }
}
function writeNotified(v) { try { localStorage.setItem('nn-notified', JSON.stringify(v)); } catch { /* nada */ } }

async function systemNotify(title, body, tag) {
  if (!state.settings.notifications || !('Notification' in window) || Notification.permission !== 'granted') return false;
  try {
    const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
    if (reg && reg.showNotification) { await reg.showNotification(title, { body, tag, icon: './icons/icon-192.png', badge: './icons/badge-96.png' }); return true; }
    // eslint-disable-next-line no-new
    new Notification(title, { body, tag, icon: './icons/icon-192.png' });
    return true;
  } catch { return false; }
}

function checkReminders() {
  if (!state.settings.onboarded) return;
  const { hh, mm } = localParts();
  const now = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  const c = ctx();
  const det = dayDetail(c, state.today);
  const overdue = det.items.filter((i) => !i.done && i.habit.reminderTime && i.habit.reminderTime <= now);
  const banner = $('#reminder-banner');
  if (overdue.length) {
    banner.hidden = false;
    banner.innerHTML = String(html`<strong>${plural(overdue.length, 'Pendiente', 'Pendientes')} con hora pasada:</strong> ${overdue.map((i) => `${i.habit.name} (${i.habit.reminderTime})`).join(', ')}.`);
  } else {
    banner.hidden = true;
    banner.textContent = '';
  }
  const notified = readNotified();
  const fresh = overdue.filter((i) => !notified.ids.includes(i.habit.id));
  fresh.forEach(async (i) => {
    notified.ids.push(i.habit.id);
    const shown = await systemNotify('NO NEGOCIABLES', `Pendiente: ${i.habit.name}`, `nn-${i.habit.id}`);
    if (!shown && !document.hidden) toast(`Recordatorio: ${i.habit.name}`);
  });
  const rt = state.settings.reviewTime;
  if (rt && rt <= now && !state.notes.has(state.today) && !notified.ids.includes('review')) {
    notified.ids.push('review');
    systemNotify('NO NEGOCIABLES', 'Es hora de revisar tu día.', 'nn-review').then((shown) => { if (!shown && !document.hidden) toast('Es hora de revisar tu día.', { action: { label: 'Abrir', run: () => openDaySheet(state.today) } }); });
  }
  writeNotified(notified);
}

async function setNotifications(on, input) {
  if (!on) { await saveSetting('notifications', false); toast('Notificaciones del sistema desactivadas.'); return; }
  if (!('Notification' in window)) { input.checked = false; return; }
  let perm = Notification.permission;
  if (perm === 'default') perm = await Notification.requestPermission();
  if (perm !== 'granted') {
    input.checked = false;
    await saveSetting('notifications', false);
    toast('Permiso no concedido. Los recordatorios seguirán apareciendo dentro de la app.', { error: true });
    renderSettings();
    return;
  }
  await saveSetting('notifications', true);
  toast('Notificaciones activadas.');
}

/* ====================================================================== */
/* Eventos                                                                 */
/* ====================================================================== */
function bindViewEvents() {
  $('#main').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-action],[data-filter],[data-theme-set]');
    if (!b || b.disabled) return;
    if (b.dataset.filter) { state.todayFilter = b.dataset.filter; renderToday(); $(`[data-filter="${b.dataset.filter}"]`).focus(); return; }
    if (b.dataset.themeSet) {
      applyTheme(b.dataset.themeSet);
      try { await saveSetting('theme', b.dataset.themeSet); } catch (ex) { toast('No se guardó el tema. ' + ex.message, { error: true }); }
      renderSettings();
      return;
    }
    const { id, date } = b.dataset;
    switch (b.dataset.action) {
      case 'toggle': await toggleCheck(id, date); break;
      case 'count': openCountSheet(id, date); break;
      case 'edit': openHabitEditor(id); break;
      case 'new-habit': openHabitEditor(); break;
      case 'day-summary': openDaySheet(state.today); break;
      case 'day-note': openDaySheet(date); break;
      case 'priority': await togglePriority(id); break;
      case 'move': await moveHabit(id, Number(b.dataset.dir)); break;
      case 'month':
        state.histMonth = addMonths(state.histMonth, Number(b.dataset.dir));
        state.histEditing = false;
        renderHistory();
        $(`[data-action="month"][data-dir="${b.dataset.dir}"]`).focus();
        break;
      case 'select-day':
        state.histSelected = date;
        state.histEditing = false;
        renderHistory();
        $(`[data-date="${date}"].cal-day`).focus();
        $('#day-detail-wrap').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        break;
      case 'edit-past': state.histEditing = !state.histEditing; renderHistory(); break;
      case 'goto-today': navigate('today'); break;
      case 'export-json': await exportJSON(); break;
      case 'export-csv': await exportCSV(); break;
      case 'install':
        if (state.installPrompt) {
          state.installPrompt.prompt();
          await state.installPrompt.userChoice.catch(() => null);
          state.installPrompt = null;
          renderSettings();
        }
        break;
      case 'persist': {
        const ok = await db.requestPersistence();
        toast(ok ? 'Almacenamiento persistente concedido.' : 'El navegador no lo concedió por ahora. Instalar la app y usarla a diario ayuda.', { error: !ok });
        renderSettings();
        break;
      }
      case 'test-notif': {
        if (Notification.permission === 'default') await Notification.requestPermission();
        const shown = Notification.permission === 'granted' && await (async () => {
          const prev = state.settings.notifications; state.settings.notifications = true;
          const r = await systemNotify('NO NEGOCIABLES', 'Así se verán tus recordatorios.', 'nn-test');
          state.settings.notifications = prev; return r;
        })();
        toast(shown ? 'Notificación de prueba enviada.' : 'No se pudo mostrar la notificación. Revisa los permisos.', { error: !shown });
        renderSettings();
        break;
      }
      case 'wipe': await wipeAll(); break;
      default: break;
    }
  });
  $('#main').addEventListener('change', async (e) => {
    const t = e.target;
    try {
      if (t.id === 'set-name') { await saveSetting('routineName', t.value.trim().slice(0, 40)); updateBrand(); toast('Nombre guardado.'); }
      if (t.id === 'set-review') { await saveSetting('reviewTime', t.value); toast(t.value ? `Revisión diaria a las ${t.value}.` : 'Revisión diaria sin hora.'); }
      if (t.id === 'set-notif') await setNotifications(t.checked, t);
      if (t.id === 'import-file') { const file = t.files && t.files[0]; t.value = ''; if (file) await handleImport(file); }
    } catch (ex) {
      toast('No se guardó. ' + ex.message, { error: true });
    }
  });
}

/* ====================================================================== */
/* Conexión, instalación y service worker                                  */
/* ====================================================================== */
function setupConnectivity() {
  const upd = () => { $('#offline-pill').hidden = navigator.onLine; };
  window.addEventListener('online', upd);
  window.addEventListener('offline', upd);
  upd();
}

function setupInstall() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    state.installPrompt = e;
    if (state.view === 'settings') renderSettings();
  });
  window.addEventListener('appinstalled', () => { state.installPrompt = null; toast('App instalada.'); });
}

function setupServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  let reloading = false;
  let userAskedUpdate = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading || !userAskedUpdate) return;
    reloading = true;
    location.reload();
  });
  const showUpdate = (worker) => {
    state.swWaiting = worker;
    $('#update-banner').hidden = false;
  };
  $('#update-btn').addEventListener('click', () => {
    if (!state.swWaiting) return;
    userAskedUpdate = true;
    $('#update-btn').disabled = true;
    state.swWaiting.postMessage({ type: 'SKIP_WAITING' });
  });
  navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then((reg) => {
    if (reg.waiting && navigator.serviceWorker.controller) showUpdate(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      if (!nw) return;
      nw.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) showUpdate(nw);
      });
    });
    // Busca actualizaciones al abrir y cada hora mientras la app siga abierta.
    setInterval(() => { if (navigator.onLine) reg.update().catch(() => {}); }, 3600000);
  }).catch(() => {
    // Sin service worker (por ejemplo, abierto como archivo local): la app funciona, pero no offline.
  });
}

/* Errores no controlados: se informan en vez de fallar en silencio. */
window.addEventListener('unhandledrejection', (e) => {
  console.error(e.reason);
  toast('Ocurrió un error inesperado. ' + ((e.reason && e.reason.message) || ''), { error: true });
});

boot();
