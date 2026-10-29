/**
 * onboarding.js — Asistente de configuración inicial (6 pasos cortos).
 * No escribe nada en la base de datos hasta que la persona pulsa "Comenzar".
 */
import { html, raw, icon } from './ui.js';
import { CATEGORIES, ALL_DAYS, LIMITS } from './model.js';
import { WEEKDAYS_SHORT, WEEKDAYS } from './dates.js';

const EXAMPLES = [
  { name: 'Entrenar o hacer actividad física', category: 'Salud', type: 'count', target: 30, unit: 'minutos', criteria: '' },
  { name: 'Cumplir mi objetivo diario de alimentación', category: 'Salud', type: 'check', criteria: 'Seguir el plan de comidas del día' },
  { name: 'Dedicar tiempo al aprendizaje', category: 'Aprendizaje', type: 'count', target: 20, unit: 'minutos', criteria: '' },
  { name: 'Avanzar en mi proyecto o negocio', category: 'Negocio', type: 'check', criteria: 'Completar al menos una tarea importante' },
  { name: 'Revisar prioridades y preparar el día siguiente', category: 'Disciplina', type: 'check', criteria: 'Dejar definidas 3 prioridades para mañana' },
];

const STEPS = ['Tu rutina', 'Tus no negociables', 'Días de cumplimiento', 'Horarios', 'Categorías', 'Revisión'];

const daysLabel = (days) => {
  if (days.length === 7) return 'Todos los días';
  if (days.length === 5 && [1, 2, 3, 4, 5].every((d) => days.includes(d))) return 'Lunes a viernes';
  return ALL_DAYS.filter((d) => days.includes(d)).map((d) => WEEKDAYS[d].slice(0, 3)).join(', ');
};

export function startOnboarding(root, { onFinish, onRestore }) {
  const st = {
    step: 0,
    routineName: '',
    reviewTime: '',
    habits: EXAMPLES.map((e, i) => ({ key: `ex${i}`, selected: true, days: [0, 1, 2, 3, 4, 5, 6], reminderTime: '', unit: '', target: null, ...e })),
    error: '',
  };
  const chosen = () => st.habits.filter((h) => h.selected && h.name.trim());

  function stepBody() {
    switch (st.step) {
      case 0: return html`
        <p class="muted">Ponle un nombre a tu sistema. Aparecerá en la parte superior de la app. Puedes dejarlo vacío.</p>
        <label class="field"><span>Nombre de tu rutina</span>
          <input type="text" id="ob-name" maxlength="40" placeholder="Por ejemplo: Mi estándar" value="${st.routineName}" autocomplete="off">
        </label>
        <p class="small muted">Tus datos se guardan solo en este teléfono. No hay cuentas ni contraseñas.</p>
        <div class="card" style="margin-top:22px">
          <p class="small" style="margin:0 0 8px"><strong>¿Ya usabas la app?</strong> Restaura tu respaldo (.json) en lugar de configurar desde cero.</p>
          <label class="btn btn-small" for="ob-import" style="cursor:pointer">Restaurar un respaldo…</label>
          <input type="file" id="ob-import" accept="application/json,.json" class="visually-hidden">
        </div>`;
      case 1: return html`
        <p class="muted">Estos son ejemplos editables. Desmarca los que no quieras y añade los tuyos. Puedes empezar desde cero.</p>
        ${st.habits.map((h) => html`
          <div class="ob-habit">
            <div class="row">
              <input type="checkbox" data-sel="${h.key}" ${h.selected ? raw('checked') : ''} aria-label="Incluir ${h.name || 'hábito'}">
              <label class="field" style="flex:1;margin:0"><span class="visually-hidden">Nombre</span>
                <input type="text" data-name="${h.key}" maxlength="${LIMITS.name}" value="${h.name}" placeholder="Nombre del hábito">
              </label>
            </div>
            <p class="tiny muted" style="margin:6px 0 0 36px">${h.type === 'count' ? `Meta: ${h.target} ${h.unit} por día` : (h.criteria || 'Se marca como hecho o no hecho')}</p>
          </div>`)}
        <div class="row" style="margin-top:12px">
          <button class="btn btn-small" type="button" data-add>${icon('plus')}Añadir hábito</button>
          <button class="btn btn-small btn-ghost" type="button" data-none>Desmarcar todos</button>
        </div>
        <p class="tiny muted" style="margin-top:12px">Después podrás cambiar el tipo, la meta, la descripción y todo lo demás desde Hábitos.</p>`;
      case 2: return html`
        <p class="muted">Un hábito solo cuenta los días en que está programado. Los días libres no rompen tu racha.</p>
        <div class="row wrap" style="margin-bottom:12px">
          <button class="btn btn-small" type="button" data-all-days="all">Todos, todos los días</button>
          <button class="btn btn-small" type="button" data-all-days="week">Todos, lunes a viernes</button>
        </div>
        ${chosen().map((h) => html`
          <fieldset class="ob-habit field">
            <legend class="ob-habit-title">${h.name}</legend>
            <div class="chips">${ALL_DAYS.map((d) => html`
              <label class="chip"><input type="checkbox" data-day="${h.key}" value="${d}" ${h.days.includes(d) ? raw('checked') : ''} aria-label="${WEEKDAYS[d]}"><span>${WEEKDAYS_SHORT[d]}</span></label>`)}
            </div>
          </fieldset>`)}
        ${chosen().length ? '' : html`<p class="muted">No elegiste hábitos. Puedes continuar y crearlos después.</p>`}`;
      case 3: return html`
        <p class="muted">Opcional. Si la app está abierta a esa hora, te recordará lo que falte.</p>
        ${chosen().map((h) => html`
          <label class="ob-habit field" style="display:block"><span class="ob-habit-title">${h.name}</span>
            <input type="time" data-time="${h.key}" value="${h.reminderTime}">
          </label>`)}
        <label class="field"><span>Hora para revisar el día</span>
          <input type="time" id="ob-review" value="${st.reviewTime}">
          <span class="hint">Un recordatorio para hacer el cierre diario, también opcional.</span>
        </label>`;
      case 4: return html`
        <p class="muted">Agrupa tus hábitos. Elige "Personalizada" para escribir tu propia categoría.</p>
        ${chosen().map((h) => html`
          <div class="ob-habit">
            <label class="field" style="margin-bottom:8px"><span>${h.name}</span>
              <select data-cat="${h.key}">${CATEGORIES.map((c) => html`<option value="${c}" ${c === h.category ? raw('selected') : ''}>${c}</option>`)}</select>
            </label>
            <label class="field" style="margin:0" ${h.category === 'Personalizada' ? '' : raw('hidden')}><span class="visually-hidden">Nombre de la categoría</span>
              <input type="text" data-custom="${h.key}" maxlength="${LIMITS.customCategory}" placeholder="Nombre de la categoría" value="${h.customCategory || ''}">
            </label>
          </div>`)}`;
      default: return html`
        <p class="muted">${st.routineName ? `Rutina: ${st.routineName}. ` : ''}${chosen().length} ${chosen().length === 1 ? 'hábito' : 'hábitos'} desde hoy.</p>
        ${chosen().map((h) => html`
          <div class="ob-habit">
            <div class="ob-habit-title" style="margin:0">${h.name}</div>
            <p class="tiny muted" style="margin:4px 0 0">${h.category === 'Personalizada' && h.customCategory ? h.customCategory : h.category}. ${daysLabel(h.days)}.${h.reminderTime ? ` Recordatorio ${h.reminderTime}.` : ''}</p>
          </div>`)}
        ${chosen().length ? '' : html`<div class="empty"><strong>Sin hábitos por ahora</strong>Podrás crearlos desde la pantalla Hábitos.</div>`}
        <p class="small muted" style="margin-top:14px">Las estadísticas empiezan a contar desde hoy. No se registra nada de días anteriores.</p>`;
    }
  }

  function render() {
    root.innerHTML = String(html`
      <div class="brand"><span class="brand-mark" aria-hidden="true"></span><span class="brand-name">NO NEGOCIABLES</span></div>
      <div class="ob-progress" aria-hidden="true">${STEPS.map((_, i) => html`<i class="${i <= st.step ? 'on' : ''}"></i>`)}</div>
      <p class="ob-step-label">Paso ${st.step + 1} de ${STEPS.length}</p>
      <h1 class="ob-title" id="ob-title" tabindex="-1">${STEPS[st.step]}</h1>
      <div class="ob-body">${stepBody()}</div>
      ${st.error ? html`<p class="error-text" role="alert">${st.error}</p>` : ''}
      <div class="ob-nav">
        ${st.step > 0 ? html`<button class="btn" type="button" data-back>Atrás</button>` : ''}
        <button class="btn btn-accent" type="button" data-next>${st.step === STEPS.length - 1 ? 'Comenzar' : 'Continuar'}</button>
      </div>`);
  }

  function readInputs() {
    const q = (s) => root.querySelector(s);
    if (q('#ob-name')) st.routineName = q('#ob-name').value.trim().slice(0, 40);
    if (q('#ob-review')) st.reviewTime = q('#ob-review').value;
    root.querySelectorAll('[data-name]').forEach((i) => { st.habits.find((h) => h.key === i.dataset.name).name = i.value.slice(0, LIMITS.name); });
    root.querySelectorAll('[data-sel]').forEach((i) => { st.habits.find((h) => h.key === i.dataset.sel).selected = i.checked; });
    root.querySelectorAll('[data-time]').forEach((i) => { st.habits.find((h) => h.key === i.dataset.time).reminderTime = i.value; });
    root.querySelectorAll('[data-custom]').forEach((i) => { st.habits.find((h) => h.key === i.dataset.custom).customCategory = i.value.trim(); });
    const dayMap = {};
    root.querySelectorAll('[data-day]').forEach((i) => {
      dayMap[i.dataset.day] = dayMap[i.dataset.day] || [];
      if (i.checked) dayMap[i.dataset.day].push(Number(i.value));
    });
    Object.entries(dayMap).forEach(([k, days]) => { st.habits.find((h) => h.key === k).days = days; });
  }

  function validate() {
    if (st.step === 2) {
      const bad = chosen().find((h) => !h.days.length);
      if (bad) return `Elige al menos un día para "${bad.name}".`;
    }
    if (st.step === 4) {
      const bad = chosen().find((h) => h.category === 'Personalizada' && !h.customCategory);
      if (bad) return `Escribe el nombre de la categoría para "${bad.name}".`;
    }
    return '';
  }

  root.onclick = async (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    readInputs();
    if (t.matches('[data-add]')) {
      st.habits.push({ key: `c${Date.now()}`, selected: true, name: '', category: 'Disciplina', type: 'check', criteria: '', days: [0, 1, 2, 3, 4, 5, 6], reminderTime: '', unit: '', target: null });
      render();
      const inputs = root.querySelectorAll('[data-name]');
      inputs[inputs.length - 1].focus();
      return;
    }
    if (t.matches('[data-none]')) { st.habits.forEach((h) => { h.selected = false; }); render(); return; }
    if (t.dataset.allDays) {
      const days = t.dataset.allDays === 'all' ? [0, 1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5];
      chosen().forEach((h) => { h.days = [...days]; });
      render();
      return;
    }
    if (t.matches('[data-back]')) { st.error = ''; st.step -= 1; render(); root.querySelector('#ob-title').focus(); return; }
    if (t.matches('[data-next]')) {
      st.error = validate();
      if (st.error) { render(); return; }
      if (st.step < STEPS.length - 1) { st.step += 1; render(); root.querySelector('#ob-title').focus(); window.scrollTo(0, 0); return; }
      t.disabled = true;
      try {
        await onFinish({
          routineName: st.routineName,
          reviewTime: st.reviewTime,
          habits: chosen().map((h) => ({ ...h, name: h.name.trim() })),
        });
      } catch (err) {
        st.error = 'No se pudo guardar la configuración: ' + err.message;
        render();
      }
    }
  };
  root.onchange = (e) => {
    if (e.target.id === 'ob-import') {
      const file = e.target.files && e.target.files[0];
      e.target.value = '';
      if (file && onRestore) onRestore(file);
      return;
    }
    if (e.target.matches('[data-cat]')) {
      readInputs();
      st.habits.find((h) => h.key === e.target.dataset.cat).category = e.target.value;
      render();
      const c = root.querySelector(`[data-custom="${e.target.dataset.cat}"]`);
      if (c && e.target.value === 'Personalizada') c.focus();
    }
  };
  render();
}
