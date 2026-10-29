/* Aplica el tema guardado antes de pintar, para evitar un parpadeo de colores.
   LocalStorage solo guarda esta preferencia visual; los datos viven en IndexedDB. */
(function () {
  var pref = 'dark';
  try { pref = localStorage.getItem('nn-theme') || 'dark'; } catch (e) { /* almacenamiento bloqueado */ }
  var dark = pref === 'dark' || (pref === 'system' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
}());
