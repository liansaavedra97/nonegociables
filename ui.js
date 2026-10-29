/**
 * ui.js — Utilidades de interfaz: plantillas seguras, avisos, hojas y confirmaciones.
 *
 * `html` es una plantilla etiquetada que ESCAPA todo valor interpolado.
 * Solo `raw()` (usado con marcado generado por la propia app) se inserta tal cual.
 * Así los nombres, descripciones y notas del usuario nunca se interpretan como HTML.
 */

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Raw(String(s));

function renderValue(v) {
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(renderValue).join('');
  if (v === false || v === null || v === undefined) return '';
  return esc(v);
}

export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((v, i) => { out += renderValue(v) + strings[i + 1]; });
  return raw(out);
}

export const icon = (name, cls = 'ic') => raw(`<svg class="${cls}" aria-hidden="true" focusable="false"><use href="#i-${name}"/></svg>`);

/* ------------------------------ avisos ------------------------------ */
export function toast(message, { error = false, action = null, duration = 3200 } = {}) {
  const region = document.getElementById('toasts');
  // Un aviso a la vez (los errores no se reemplazan por avisos normales).
  region.querySelectorAll('.toast').forEach((t) => { if (error || !t.classList.contains('error')) t.remove(); });
  const el = document.createElement('div');
  el.className = 'toast' + (error ? ' error' : '');
  el.setAttribute('role', error ? 'alert' : 'status');
  const span = document.createElement('span');
  span.textContent = message;
  el.appendChild(span);
  if (action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = action.label;
    b.addEventListener('click', () => { el.remove(); action.run(); });
    el.appendChild(b);
  }
  region.appendChild(el);
  setTimeout(() => el.remove(), error ? Math.max(duration, 6000) : duration);
}

/* ------------------------------ hoja ------------------------------ */
const sheet = () => document.getElementById('sheet');
let sheetCleanup = null;
let returnFocus = null;

/**
 * Abre la hoja inferior con el contenido dado. `onMount(root)` conecta eventos.
 * Devuelve la raíz para consultas.
 */
export function openSheet(content, onMount) {
  const dlg = sheet();
  const body = document.getElementById('sheet-body');
  if (dlg.open) closeSheet(true);
  returnFocus = document.activeElement;
  body.innerHTML = String(content);
  sheetCleanup = onMount ? onMount(body) : null;
  if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
  const focusable = body.querySelector('[autofocus]') || body.querySelector('h2');
  if (focusable) { if (focusable.tagName === 'H2') focusable.setAttribute('tabindex', '-1'); focusable.focus({ preventScroll: true }); }
  return body;
}

export function closeSheet(silent = false) {
  const dlg = sheet();
  if (typeof sheetCleanup === 'function') sheetCleanup();
  sheetCleanup = null;
  if (dlg.open) { if (typeof dlg.close === 'function') dlg.close(); else dlg.removeAttribute('open'); }
  document.getElementById('sheet-body').innerHTML = '';
  if (!silent && returnFocus && document.contains(returnFocus)) returnFocus.focus({ preventScroll: true });
}

export function initSheet() {
  const dlg = sheet();
  // Tocar el fondo cierra la hoja.
  dlg.addEventListener('click', (e) => { if (e.target === dlg) closeSheet(); });
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); closeSheet(); });
}

export const sheetHead = (title, id = 'sheet-title') => html`
  <div class="sheet-head">
    <h2 id="${id}">${title}</h2>
    <button class="icon-btn" type="button" data-close aria-label="Cerrar">${icon('close')}</button>
  </div>`;

/** Diálogo de confirmación. Resuelve true / false. */
export function confirmDialog({ title, body, confirm = 'Confirmar', cancel = 'Cancelar', danger = false }) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (settled) return; settled = true; resolve(v); };
    openSheet(html`
      ${sheetHead(title)}
      <div class="small">${body}</div>
      <div class="sheet-actions">
        <button class="btn" type="button" data-no>${cancel}</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-accent'}" type="button" data-yes>${confirm}</button>
      </div>`, (root) => {
      root.querySelector('[data-yes]').addEventListener('click', () => { done(true); closeSheet(); });
      root.querySelector('[data-no]').addEventListener('click', () => { done(false); closeSheet(); });
      root.querySelector('[data-close]').addEventListener('click', () => { done(false); closeSheet(); });
      return () => done(false);
    });
  });
}
