/**
 * stats.js — Métricas calculadas exclusivamente a partir de los registros.
 *
 * Definiciones (las mismas que se muestran en la app):
 *  - Oportunidad: un hábito programado en una fecha (desde su inicio y desde
 *    el primer uso de la app; nunca días futuros ni días de descanso).
 *  - % del día = oportunidades cumplidas / oportunidades del día.
 *  - % de un periodo = oportunidades cumplidas / oportunidades del periodo,
 *    contando desde el inicio del periodo hasta hoy (incluido). Los días sin
 *    ningún registro cuentan como no cumplidos y se informan aparte.
 *  - Racha de un hábito = días programados consecutivos cumplidos. Los días
 *    no programados no la rompen. Si hoy aún está pendiente, la racha actual
 *    se mide hasta ayer (hoy todavía puede cumplirse).
 *  - Racha perfecta = días consecutivos (con algo programado) en que se
 *    cumplió el 100 %.
 */
import { addDays, rangeDays, maxDate, minDate } from './dates.js';
import { scheduledRule, isDone, logId } from './model.js';

export function buildContext({ habits, logs, notes, today, measureFrom }) {
  const logsMap = new Map(logs.map((l) => [l.id, l]));
  const touchedDays = new Set(logs.map((l) => l.date));
  notes.forEach((n) => touchedDays.add(n.date));
  return { habits, logsMap, touchedDays, today, measureFrom: measureFrom || today };
}

/** Detalle de un día: hábitos programados, estado de cada uno y resumen. */
export function dayDetail(ctx, date) {
  const items = [];
  for (const h of ctx.habits) {
    const rule = scheduledRule(h, date, ctx.measureFrom);
    if (!rule) continue;
    const log = ctx.logsMap.get(logId(date, h.id));
    items.push({ habit: h, rule, log, done: isDone(h, log, rule) });
  }
  const total = items.length;
  const done = items.filter((i) => i.done).length;
  let state;
  if (date > ctx.today) state = 'future';
  else if (date < ctx.measureFrom) state = 'before';
  else if (total === 0) state = 'rest';
  else if (done === total) state = 'complete';
  else if (date === ctx.today) state = 'today';
  else if (done > 0) state = 'partial';
  else if (ctx.touchedDays.has(date)) state = 'missed';
  else state = 'unrecorded';
  return { date, items, total, done, pct: total ? Math.round((done / total) * 100) : null, state };
}

/** Totales de un periodo [from, to] recortado a [measureFrom, today]. */
export function periodStats(ctx, from, to) {
  const a = maxDate(from, ctx.measureFrom);
  const b = minDate(to, ctx.today);
  let total = 0; let done = 0; let unrecordedDays = 0; let perfectDays = 0; let scheduledDays = 0;
  const days = [];
  for (const d of rangeDays(a, b)) {
    const det = dayDetail(ctx, d);
    days.push(det);
    total += det.total;
    done += det.done;
    if (det.total) scheduledDays += 1;
    if (det.state === 'unrecorded') unrecordedDays += 1;
    if (det.state === 'complete') perfectDays += 1;
  }
  return { from: a, to: b, total, done, pct: total ? Math.round((done / total) * 100) : null, unrecordedDays, perfectDays, scheduledDays, days };
}

/** Rachas y consistencia de un hábito. `windowDays` define la consistencia reciente. */
export function habitStats(ctx, habit, windowDays = 30) {
  const start = maxDate(habit.startDate, ctx.measureFrom);
  let best = 0; let run = 0; let totalDone = 0; let totalOpp = 0;
  const windowStart = addDays(ctx.today, -(windowDays - 1));
  let wOpp = 0; let wDone = 0;
  const seq = []; // secuencia de días programados (true/false/'pending')
  for (const d of rangeDays(start, ctx.today)) {
    const rule = scheduledRule(habit, d, ctx.measureFrom);
    if (!rule) continue;
    const done = isDone(habit, ctx.logsMap.get(logId(d, habit.id)), rule);
    const pendingToday = d === ctx.today && !done;
    if (pendingToday) { seq.push('pending'); }
    else {
      seq.push(done);
      totalOpp += 1;
      if (done) totalDone += 1;
      if (d >= windowStart) { wOpp += 1; if (done) wDone += 1; }
    }
    if (done) { run += 1; best = Math.max(best, run); } else if (!pendingToday) run = 0;
  }
  // Racha actual: desde el final, ignorando hoy si aún está pendiente.
  let current = 0;
  for (let i = seq.length - 1; i >= 0; i -= 1) {
    if (seq[i] === 'pending') continue;
    if (seq[i] === true) current += 1; else break;
  }
  return {
    habit, current, best, totalDone, totalOpp,
    rate: totalOpp ? totalDone / totalOpp : null,
    windowOpp: wOpp, windowDone: wDone,
    windowRate: wOpp ? wDone / wOpp : null,
  };
}

/** Racha de días perfectos (todos los hábitos programados cumplidos). */
export function perfectStreak(ctx) {
  let current = 0; let best = 0; let run = 0;
  const seq = [];
  for (const d of rangeDays(ctx.measureFrom, ctx.today)) {
    const det = dayDetail(ctx, d);
    if (!det.total) continue;
    if (det.state === 'today') { seq.push('pending'); continue; }
    const ok = det.state === 'complete';
    seq.push(ok);
    if (ok) { run += 1; best = Math.max(best, run); } else run = 0;
  }
  for (let i = seq.length - 1; i >= 0; i -= 1) {
    if (seq[i] === 'pending') continue;
    if (seq[i] === true) current += 1; else break;
  }
  return { current, best };
}

/** Mejor y más descuidado según consistencia de los últimos N días (mín. 3 oportunidades). */
export function bestAndWorst(list) {
  const eligible = list.filter((s) => s.windowOpp >= 3 && !s.habit.archived);
  if (eligible.length < 2) return { best: eligible[0] || null, worst: null, enough: eligible.length > 0 };
  const sorted = [...eligible].sort((a, b) => b.windowRate - a.windowRate || b.current - a.current);
  const best = sorted[0];
  const worst = sorted[sorted.length - 1];
  return { best, worst: worst.windowRate < best.windowRate ? worst : null, enough: true };
}
