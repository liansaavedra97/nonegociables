"""Pruebas de extremo a extremo de NO NEGOCIABLES en Chromium real (headless).

Uso (desde la carpeta que CONTIENE no-negociables/):
  pip install playwright && playwright install chromium
  python no-negociables/tests/e2e_test.py
"""
import sys, json, shutil, os, re, tempfile
sys.path.insert(0, os.path.dirname(__file__))
from server import start
from playwright.sync_api import sync_playwright

OUT = os.path.join(tempfile.gettempdir(), 'nn-e2e') + os.sep
os.makedirs(OUT, exist_ok=True)
URL = 'http://127.0.0.1:8766/no-negociables/'
PROFILE = tempfile.mkdtemp(prefix='nn-profile-')
srv = start()
results = []
errors = []

def check(n, name, ok, detail=''):
    results.append((n, name, bool(ok), detail))
    print(f"{'PASS' if ok else 'FAIL'} [{n}] {name}" + (f" — {detail}" if detail else ''), flush=True)

def ec(date, hm='08:00:00'):
    return f'{date}T{hm}-05:00'

DUMP = """async () => {
  const db = await new Promise((res, rej) => { const r = indexedDB.open('no-negociables'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const all = (s) => new Promise((res) => { const q = db.transaction(s).objectStore(s).getAll(); q.onsuccess = () => res(q.result); });
  const out = { habits: await all('habits'), logs: await all('logs'), notes: await all('notes'), settings: await all('settings') };
  db.close(); return out;
}"""

def attach(pg):
    pg.on('console', lambda m: errors.append(f'{m.type}: {m.text}') if m.type == 'error' else None)
    pg.on('pageerror', lambda e: errors.append(f'pageerror: {e}'))

def open_ctx(p, persistent=True, width=390, time=None):
    kw = dict(viewport={'width': width, 'height': 844}, timezone_id='America/Guayaquil', locale='es-EC', accept_downloads=True)
    ctx = p.chromium.launch_persistent_context(PROFILE, **kw) if persistent else p.chromium.launch().new_context(**kw)
    if time: ctx.clock.install(time=time)
    pg = ctx.pages[0] if persistent and ctx.pages else ctx.new_page()
    attach(pg)
    return ctx, pg

def goto_day(ctx, pg, date, hm='08:00:00'):
    ctx.clock.set_system_time(ec(date, hm))
    pg.goto(URL + f'?d={date}{hm.replace(":", "")}#today'); pg.wait_for_selector('#view-today .today-date')

def today_row(pg, name):
    return pg.locator('#view-today .habit-row', has=pg.locator('.habit-name', has_text=re.compile('^' + re.escape(name) + '$')))

def score(pg):
    return pg.locator('.score-fraction').inner_text().replace('\n', '')

def create_habit(pg, name, typ='check', days=None, target=None, unit=None):
    pg.click('.tab[data-view=habits]')
    pg.click('#view-habits [data-action=new-habit]')
    pg.fill('#habit-form [name=name]', name)
    if typ == 'count':
        pg.click('#habit-form [data-type=count]')
        pg.fill('#habit-form [name=target]', str(target)); pg.fill('#habit-form [name=unit]', unit)
    if days is not None:
        for d in range(7):
            box = pg.locator(f'#habit-form [name=days][value="{d}"]')
            if box.is_checked() != (d in days): box.check() if d in days else box.uncheck()
    pg.click('#habit-form [type=submit]')
    pg.wait_for_selector('#sheet:not([open])', state='attached')
    pg.wait_for_timeout(150)

def toast_text(pg):
    pg.wait_for_selector('.toast', timeout=4000)
    return pg.locator('.toast').last.inner_text()

def dump(pg):
    return pg.evaluate(DUMP)

with sync_playwright() as p:
    # ------------------------------------------------------------ Día 1: lunes 5-oct-2026
    ctx, pg = open_ctx(p, time=ec('2026-10-05'))
    pg.goto(URL); pg.wait_for_selector('#ob-name')
    pg.fill('#ob-name', 'Prueba <b>XSS</b>')
    pg.click('[data-next]'); pg.click('[data-none]')
    for _ in range(4): pg.click('[data-next]')
    pg.click('[data-next]')  # Comenzar
    pg.wait_for_selector('#view-today')
    check(14, 'Nombre con HTML se muestra como texto (sin inyección)', pg.locator('#brand-name').inner_text() == 'Prueba <b>XSS</b>' and pg.locator('#brand-name b').count() == 0)
    create_habit(pg, 'Leer')
    create_habit(pg, 'Trabajo profundo', days=[1, 2, 3, 4, 5])
    create_habit(pg, 'Agua', typ='count', target=8, unit='vasos')
    pg.click('.tab[data-view=today]')
    check(1, 'Crear hábitos: aparecen en Hoy', score(pg) == '0/3', score(pg))
    today_row(pg, 'Leer').locator('.mark').click(); pg.wait_for_timeout(200)
    d = dump(pg)
    leer = next(h for h in d['habits'] if h['name'] == 'Leer')
    log = next((l for l in d['logs'] if l['habitId'] == leer['id']), None)
    check(1, 'Completar: progreso 1/3 y registro guardado en IndexedDB', score(pg) == '1/3' and log and log['done'] is True and log['date'] == '2026-10-05', score(pg))
    today_row(pg, 'Leer').locator('.mark').click(); pg.wait_for_timeout(200)
    d = dump(pg)
    log = next(l for l in d['logs'] if l['habitId'] == leer['id'])
    check(2, 'Desmarcar: vuelve a 0/3 y el registro queda done=false', score(pg) == '0/3' and log['done'] is False, score(pg))

    # Duplicados: doble toque muy rápido + cantidad guardada dos veces
    mark = today_row(pg, 'Leer').locator('.mark')
    mark.dblclick(); pg.wait_for_timeout(300)
    d = dump(pg)
    ids = [l['id'] for l in d['logs']]
    check(11, 'Doble toque rápido no duplica registros', len(ids) == len(set(ids)) and sum(1 for l in d['logs'] if l['habitId'] == leer['id']) == 1, f"{len(ids)} registros")
    if score(pg) != '1/3':
        today_row(pg, 'Leer').locator('.mark').click(); pg.wait_for_timeout(200)
    today_row(pg, 'Agua').locator('.mark').click()
    pg.fill('#count-val', '5'); pg.click('#count-form [type=submit]'); pg.wait_for_timeout(200)
    today_row(pg, 'Agua').locator('.mark').click()
    pg.fill('#count-val', '8'); pg.click('#count-form [type=submit]'); pg.wait_for_timeout(200)
    d = dump(pg)
    agua = next(h for h in d['habits'] if h['name'] == 'Agua')
    alog = [l for l in d['logs'] if l['habitId'] == agua['id']]
    check(11, 'Cantidad registrada dos veces no se acumula (5 y luego 8 → 8)', len(alog) == 1 and alog[0]['value'] == 8, str([l['value'] for l in alog]))
    today_row(pg, 'Trabajo profundo').locator('.mark').click(); pg.wait_for_timeout(200)
    check(1, 'Día completo muestra celebración discreta', pg.locator('.done-card').count() == 1 and score(pg) == '3/3', score(pg))
    pg.screenshot(path=OUT + 'dia-completo.png')
    ctx.close()

    # ------------------------------------------------------------ Cerrar y reabrir
    ctx, pg = open_ctx(p, time=ec('2026-10-05', '21:00:00'))
    pg.goto(URL); pg.wait_for_selector('#view-today .today-date')
    check(3, 'Cerrar el navegador y reabrir conserva los registros', score(pg) == '3/3', score(pg))

    # ------------------------------------------------------------ Mar a vie: cumplir Leer y Trabajo profundo
    for date in ['2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09']:
        goto_day(ctx, pg, date)
        for n in ['Leer', 'Trabajo profundo']:
            today_row(pg, n).locator('.mark').click(); pg.wait_for_timeout(120)
    goto_day(ctx, pg, '2026-10-10')  # sábado
    names = pg.locator('#view-today .habit-name').all_inner_texts()
    check(4, 'Hábito de lunes a viernes no aparece el sábado', 'Trabajo profundo' not in names and 'Leer' in names, ', '.join(names))
    check(6, 'Fecha correcta tras cambiar de día', pg.locator('.today-date').inner_text().lower().startswith('sábado, 10 de octubre de 2026'), pg.locator('.today-date').inner_text())

    goto_day(ctx, pg, '2026-10-12')  # lunes siguiente, nada marcado aún
    pg.click('.tab[data-view=stats]')
    def habit_stat(name):
        blk = pg.locator('.habit-stat', has=pg.locator('.habit-name', has_text=re.compile('^' + name + '$')))
        t = blk.inner_text()
        cur = int(re.search(r'Racha actual\s*(\d+)', t).group(1)); best = int(re.search(r'Mejor racha\s*(\d+)', t).group(1))
        return cur, best
    tp = habit_stat('Trabajo profundo'); lr = habit_stat('Leer')
    check(5, 'Fin de semana no rompe la racha de un hábito L-V (actual 5, hoy pendiente)', tp == (5, 5), str(tp))
    check(5, 'Hábito diario sí pierde la racha al saltarse sáb/dom (actual 0, mejor 5)', lr == (0, 5), str(lr))
    pg.click('.tab[data-view=today]')
    today_row(pg, 'Trabajo profundo').locator('.mark').click(); pg.wait_for_timeout(150)
    pg.click('.tab[data-view=stats]')
    check(5, 'Al cumplir el lunes la racha sube a 6', habit_stat('Trabajo profundo') == (6, 6), str(habit_stat('Trabajo profundo')))

    # ------------------------------------------------------------ Estadísticas vs registros reales
    d = dump(pg)
    # Cálculo independiente en Python
    import datetime as dt
    def sched(h, day):
        if day < h['startDate']: return None
        rule = None
        for r in h['schedule']:
            if r['from'] <= day: rule = r
        wd = (dt.date.fromisoformat(day).weekday() + 1) % 7
        return rule if rule and wd in rule['days'] else None
    def done(h, day, rule):
        l = next((x for x in d['logs'] if x['date'] == day and x['habitId'] == h['id']), None)
        if not l: return False
        return l['value'] >= rule['target'] if h['type'] == 'count' else l['done']
    def period(a, b):
        tot = dn = 0
        cur = dt.date.fromisoformat(a)
        while cur <= dt.date.fromisoformat(b):
            s = cur.isoformat()
            for h in d['habits']:
                r = sched(h, s)
                if r: tot += 1; dn += done(h, s, r)
            cur += dt.timedelta(days=1)
        return dn, tot
    mdn, mtot = period('2026-10-05', '2026-10-12')
    wdn, wtot = period('2026-10-12', '2026-10-12')
    kp = pg.locator('.kpi').all_inner_texts()
    exp_m = f"{round(mdn / mtot * 100)}%"; exp_w = f"{round(wdn / wtot * 100)}%"
    check(15, f'% del mes coincide con cálculo independiente ({mdn}/{mtot} = {exp_m})', exp_m in kp[2] and f'{mdn} de {mtot}' in kp[2], kp[2].replace('\n', ' '))
    check(15, f'% de la semana coincide ({wdn}/{wtot} = {exp_w})', exp_w in kp[1] and f'{wdn} de {wtot}' in kp[1], kp[1].replace('\n', ' '))
    total_done = mdn
    check(15, 'Total de hábitos completados coincide', kp[3].split('\n')[0].strip() == str(total_done), kp[3].replace('\n', ' '))
    pg.screenshot(path=OUT + 'estadisticas.png', full_page=True)

    # ------------------------------------------------------------ Editar sin borrar historial
    before_logs = sum(1 for l in d['logs'] if l['habitId'] == leer['id'])
    pg.click('.tab[data-view=habits]')
    pg.click(f'#view-habits [data-action=edit][aria-label="Editar Leer"]')
    pg.fill('#habit-form [name=name]', 'Leer 20 páginas')
    for dd in range(7):
        box = pg.locator(f'#habit-form [name=days][value="{dd}"]')
        box.check() if dd in (1, 2, 3) else box.uncheck()
    pg.click('#habit-form [type=submit]'); pg.wait_for_timeout(200)
    d2 = dump(pg)
    after_logs = sum(1 for l in d2['logs'] if l['habitId'] == leer['id'])
    check(8, 'Editar nombre y días no borra registros anteriores', before_logs == after_logs and before_logs >= 5, f'{before_logs} → {after_logs}')
    pg.click('.tab[data-view=history]')
    pg.click('.cal-day[data-date="2026-10-10"]')
    det = pg.locator('.day-detail').inner_text()
    check(8, 'El sábado pasado conserva su programación anterior (Leer seguía programado)', 'Leer 20 páginas' in det, det.replace('\n', ' | ')[:160])
    goto_day(ctx, pg, '2026-10-15')  # jueves: ya no aplica Leer
    names = pg.locator('#view-today .habit-name').all_inner_texts()
    check(8, 'Los nuevos días aplican desde la edición (jueves sin Leer)', 'Leer 20 páginas' not in names, ', '.join(names))

    # Corrección explícita de un día pasado
    pg.click('.tab[data-view=history]')
    pg.click('.cal-day[data-date="2026-10-11"]')
    pg.click('[data-action=edit-past]')
    pg.locator('.day-detail [data-action=toggle]').first.click(); pg.wait_for_timeout(200)
    d3 = dump(pg)
    check(15, 'Corrección de un día pasado guarda el registro con esa fecha', any(l['date'] == '2026-10-11' and l['done'] for l in d3['logs']))

    # ------------------------------------------------------------ Medianoche, mes y año
    goto_day(ctx, pg, '2026-10-15', '23:59:30')
    pg.goto(URL + '#today'); pg.wait_for_selector('.today-date')
    t1 = pg.locator('.today-date').inner_text()
    pg.clock.run_for(60000); pg.wait_for_timeout(200)
    t2 = pg.locator('.today-date').inner_text()
    check(6, 'A medianoche (hora Ecuador) cambia el día sin recargar', t1.lower().startswith('jueves, 15') and t2.lower().startswith('viernes, 16'), f'{t1} → {t2}')
    goto_day(ctx, pg, '2026-10-31', '23:59:30')
    pg.goto(URL + '#today'); pg.wait_for_selector('.today-date')
    pg.clock.run_for(60000); pg.wait_for_timeout(200)
    check(7, 'Cambio de mes: 31-oct → 1-nov', pg.locator('.today-date').inner_text().lower().startswith('domingo, 1 de noviembre de 2026'), pg.locator('.today-date').inner_text())
    goto_day(ctx, pg, '2026-12-31', '23:59:30')
    pg.goto(URL + '#today'); pg.wait_for_selector('.today-date')
    pg.clock.run_for(60000); pg.wait_for_timeout(200)
    check(7, 'Cambio de año: 31-dic-2026 → 1-ene-2027', pg.locator('.today-date').inner_text().lower().startswith('viernes, 1 de enero de 2027'), pg.locator('.today-date').inner_text())
    pg.click('.tab[data-view=history]')
    m1 = pg.locator('.month-nav h3').inner_text()
    pg.click('[data-action=month][data-dir="-1"]')
    m2 = pg.locator('.month-nav h3').inner_text()
    future = pg.locator('.cal-day.s-future').count()
    check(7, 'Calendario navega Enero 2027 → Diciembre 2026', m1 == 'Enero 2027' and m2 == 'Diciembre 2026', f'{m1} → {m2}')
    pg.click('[data-action=month][data-dir="1"]')
    fut_missed = pg.locator('.cal-day.s-future.s-missed').count()
    check(7, 'Los días futuros aparecen como futuros, no incumplidos', pg.locator('.cal-day.s-future').count() == 30 and fut_missed == 0, f"{pg.locator('.cal-day.s-future').count()} futuros")

    # ------------------------------------------------------------ Respaldo
    pg.click('.tab[data-view=settings]')
    with pg.expect_download() as dl:
        pg.click('[data-action=export-json]')
    backup_path = OUT + 'respaldo.json'
    dl.value.save_as(backup_path)
    backup = json.load(open(backup_path))
    original = dump(pg)
    check(9, 'Exportar JSON contiene hábitos, registros, notas y ajustes', backup['format'] == 'no-negociables-backup' and len(backup['data']['habits']) == 3 and len(backup['data']['logs']) == len(original['logs']), f"{len(backup['data']['logs'])} registros")
    with pg.expect_download() as dl:
        pg.click('[data-action=export-csv]')
    csv_path = OUT + 'registros.csv'
    dl.value.save_as(csv_path)
    csv = open(csv_path, encoding='utf-8-sig').read().splitlines()
    check(9, 'Exportar CSV con encabezado y una fila por oportunidad', csv[0].startswith('fecha;dia;habito') and len(csv) > 50, f'{len(csv) - 1} filas')

    # Archivo inválido
    bad1 = OUT + 'malo.json'; open(bad1, 'w').write('{esto no es json')
    bad2 = OUT + 'otro.json'; json.dump({'format': 'otra-app', 'data': {}}, open(bad2, 'w'))
    bad3 = OUT + 'manipulado.json'
    evil = json.loads(json.dumps(backup)); evil['data']['logs'].append({'date': '2026-13-45', 'habitId': 'x', 'value': 1})
    json.dump(evil, open(bad3, 'w'))
    msgs = []
    for f in [bad1, bad2, bad3]:
        pg.set_input_files('#import-file', f)
        msgs.append(toast_text(pg)); pg.wait_for_timeout(100)
    after_bad = dump(pg)
    check(10, 'Archivos inválidos se rechazan con mensaje claro', all(m.startswith('No se restauró nada') for m in msgs), ' / '.join(m[:60] for m in msgs))
    check(10, 'Los datos existentes quedan intactos tras intentos inválidos', json.dumps(after_bad, sort_keys=True) == json.dumps(original, sort_keys=True))

    # Cancelar una restauración válida
    pg.set_input_files('#import-file', backup_path)
    pg.wait_for_selector('#sheet[open] [data-no]'); pg.click('#sheet [data-no]')
    check(9, 'Restauración cancelable: no cambia nada', 'cancelada' in toast_text(pg) and json.dumps(dump(pg), sort_keys=True) == json.dumps(original, sort_keys=True))
    ctx.close()

    # Restaurar en un teléfono "nuevo" (perfil limpio) desde el asistente inicial
    ctx2, pg2 = open_ctx(p, persistent=False, time=ec('2027-01-01', '09:00:00'))
    pg2.goto(URL); pg2.wait_for_selector('#ob-import', state='attached')
    pg2.set_input_files('#ob-import', backup_path)
    pg2.wait_for_selector('#sheet[open] [data-yes]'); pg2.click('#sheet [data-yes]')
    msg = toast_text(pg2)
    restored = dump(pg2)
    same = json.dumps(restored, sort_keys=True) == json.dumps(backup['data'], sort_keys=True) or (
        sorted(json.dumps(x, sort_keys=True) for x in restored['logs']) == sorted(json.dumps(x, sort_keys=True) for x in backup['data']['logs'])
        and sorted(json.dumps(x, sort_keys=True) for x in restored['habits']) == sorted(json.dumps(x, sort_keys=True) for x in backup['data']['habits']))
    check(9, 'Restaurar en dispositivo nuevo: los datos coinciden exactamente con el respaldo', same and 'verificado' in msg, msg)
    pg2.wait_for_selector('#view-today .today-date')
    check(9, 'Tras restaurar se abre la app (no el asistente)', pg2.locator('#app').is_visible() and pg2.locator('#brand-name').inner_text() == 'Prueba <b>XSS</b>')
    # Restaurar dos veces el mismo archivo no duplica
    pg2.click('.tab[data-view=settings]')
    pg2.set_input_files('#import-file', backup_path)
    pg2.wait_for_selector('#sheet[open] [data-yes]'); pg2.click('#sheet [data-yes]'); toast_text(pg2)
    again = dump(pg2)
    check(11, 'Restaurar dos veces no duplica registros', len(again['logs']) == len(backup['data']['logs']) and len(again['habits']) == 3)
    ctx2.browser.close()

    # ------------------------------------------------------------ Offline
    ctx3, pg3 = open_ctx(p, persistent=False)
    pg3.goto(URL); pg3.wait_for_selector('#ob-name')
    pg3.evaluate("() => navigator.serviceWorker.ready")
    pg3.reload(); pg3.wait_for_selector('#ob-name')
    controlled = pg3.evaluate("() => !!navigator.serviceWorker.controller")
    pg3.click('[data-next]')
    for _ in range(5): pg3.click('[data-next]')
    pg3.wait_for_selector('#view-today .habit-row')
    ctx3.set_offline(True)
    pg3.reload(); pg3.wait_for_selector('#view-today .habit-row')
    check(12, 'Sin conexión la app abre desde la caché del service worker', controlled and pg3.locator('#offline-pill').is_visible())
    pg3.locator('#view-today .habit-row .mark[data-action=toggle]').first.click(); pg3.wait_for_timeout(200)
    pg3.reload(); pg3.wait_for_selector('#view-today .habit-row')
    check(12, 'Sin conexión se marca un hábito y persiste tras recargar', score(pg3).startswith('1/'), score(pg3))
    pg3.click('.tab[data-view=stats]')
    check(12, 'Sin conexión se calculan estadísticas', '%' in pg3.locator('.kpi').first.inner_text())
    pg3.screenshot(path=OUT + 'offline.png')
    ctx3.set_offline(False)

    # ------------------------------------------------------------ Pantallas estrechas
    for w in [320, 360, 390, 430, 1280]:
        pg3.set_viewport_size({'width': w, 'height': 800})
        bad = []
        for v in ['today', 'history', 'stats', 'habits', 'settings']:
            pg3.click(f'.tab[data-view={v}]'); pg3.wait_for_timeout(80)
            sw = pg3.evaluate('() => document.documentElement.scrollWidth')
            if sw > w: bad.append(f'{v}:{sw}')
            if w == 320: pg3.screenshot(path=OUT + f'w320-{v}.png', full_page=True)
        pg3.click('.tab[data-view=history]')
        cal = pg3.evaluate("() => { const r = document.querySelector('.cal-day:not(.blank)').getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }")
        small = []
        for v in ['today', 'history', 'stats', 'habits', 'settings']:
            pg3.click(f'.tab[data-view={v}]'); pg3.wait_for_timeout(60)
            small += pg3.evaluate("""() => [...document.querySelectorAll('button:not(.cal-day), .chip span')].filter(e => e.offsetParent).filter(e => { const r = e.getBoundingClientRect(); return r.width < 44 || r.height < 44; }).map(e => (e.getAttribute('aria-label') || e.textContent).trim().slice(0, 20) + ' ' + Math.round(e.getBoundingClientRect().width) + 'x' + Math.round(e.getBoundingClientRect().height))""")
        check(13, f'Sin desplazamiento horizontal a {w}px en las 5 secciones', not bad, ', '.join(bad))
        check(13, f'Botones de al menos 44x44 px a {w}px (excepto celdas del calendario)', not small, ', '.join(small[:6]))
        if w < 1280: check(13, f'Celdas del calendario a {w}px: {cal[0]}x{cal[1]} px', cal[0] >= 44 or (w == 320 and cal[0] >= 38 and cal[1] >= 44), 'a 320 px 7 columnas no caben a 44 px de ancho' if w == 320 else '')
    # Editor de hábitos a 320 px
    pg3.set_viewport_size({'width': 320, 'height': 640})
    pg3.click('.tab[data-view=habits]'); pg3.click('#view-habits [data-action=new-habit]')
    sheet_overflow = pg3.evaluate("() => document.querySelector('.sheet-inner').scrollWidth > document.querySelector('.sheet-inner').clientWidth")
    pg3.screenshot(path=OUT + 'w320-editor.png')
    check(13, 'Editor de hábito cabe a 320 px', not sheet_overflow)
    # Botones sin nombre accesible
    unnamed = pg3.evaluate("""() => [...document.querySelectorAll('button')].filter(b => !(b.getAttribute('aria-label') || b.textContent.trim())).length""")
    check(14, 'Todos los botones tienen nombre accesible', unnamed == 0, str(unnamed))
    ctx3.browser.close()

check(14, 'Sin errores de JavaScript en consola durante todas las pruebas', not errors, ' | '.join(errors[:5]))
shutil.rmtree(PROFILE, ignore_errors=True)
failed = [r for r in results if not r[2]]
print(f'\n{len(results) - len(failed)} de {len(results)} comprobaciones superadas')
json.dump(results, open(OUT + 'resultados.json', 'w'), ensure_ascii=False, indent=1)
sys.exit(1 if failed else 0)
