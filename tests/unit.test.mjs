import * as D from '../dates.js';
import * as M from '../model.js';
import * as S from '../stats.js';
let pass=0, fail=0;
const eq=(name,a,b)=>{ const ok=JSON.stringify(a)===JSON.stringify(b); ok?pass++:fail++; console.log(`${ok?'PASS':'FAIL'} ${name}${ok?'':` → got ${JSON.stringify(a)} expected ${JSON.stringify(b)}`}`); };
// Fechas
eq('cambio de año', D.addDays('2026-12-31',1), '2027-01-01');
eq('cambio de mes', D.addDays('2026-10-31',1), '2026-11-01');
eq('año bisiesto 2028', D.endOfMonth('2028-02-10'), '2028-02-29');
eq('febrero no bisiesto', D.endOfMonth('2027-02-10'), '2027-02-28');
eq('lunes de semana que cruza año', D.startOfWeek('2027-01-01'), '2026-12-28');
eq('addMonths dic→ene', D.addMonths('2026-12-15',1), '2027-01-01');
eq('weekday 28-oct-2026 = miércoles', D.weekday('2026-10-28'), 3);
eq('fecha larga', D.formatLong('2027-01-01'), 'viernes, 1 de enero de 2027');
eq('isISODate rechaza 2026-02-30', D.isISODate('2026-02-30'), false);
// 23:30 en Ecuador = 04:30 UTC del día siguiente → debe seguir siendo el mismo día local
eq('medianoche UTC vs Ecuador', D.localParts(new Date('2026-10-29T04:30:00Z')).date, '2026-10-28');
eq('00:05 Ecuador', D.localParts(new Date('2026-10-29T05:05:00Z')).date, '2026-10-29');
eq('31-dic 23:59 Ecuador', D.localParts(new Date('2027-01-01T04:59:00Z')).date, '2026-12-31');
eq('rango inclusivo', D.rangeDays('2026-12-30','2027-01-02').length, 4);
// Rachas con días de descanso: lunes a viernes, cumplido L-V dos semanas, hoy lunes pendiente
const h={id:'h_test1', name:'T', type:'check', startDate:'2026-10-05', schedule:[{from:'2026-10-05',days:[1,2,3,4,5],target:null}], archivePeriods:[], archived:false};
const logs=[]; for (const d of D.rangeDays('2026-10-05','2026-10-16')) if (D.weekday(d)>=1&&D.weekday(d)<=5) logs.push({id:M.logId(d,h.id),date:d,habitId:h.id,done:true,value:1});
let ctx=S.buildContext({habits:[h],logs,notes:[],today:'2026-10-19',measureFrom:'2026-10-05'});
let hs=S.habitStats(ctx,h);
eq('racha L-V: fines de semana no rompen (10)', hs.current, 10);
eq('mejor racha 10', hs.best, 10);
eq('sábado no programado', S.dayDetail(ctx,'2026-10-17').state, 'rest');
eq('día futuro', S.dayDetail(ctx,'2026-10-20').state, 'future');
eq('antes de empezar', S.dayDetail(ctx,'2026-10-01').state, 'before');
// Romper la racha el miércoles 14
const logs2=logs.filter(l=>l.date!=='2026-10-14');
ctx=S.buildContext({habits:[h],logs:logs2,notes:[],today:'2026-10-19',measureFrom:'2026-10-05'});
hs=S.habitStats(ctx,h);
eq('racha tras fallo: jue+vie = 2', hs.current, 2);
eq('mejor racha 7 (5 + lun/mar)', hs.best, 7);
const ps=S.periodStats(ctx,'2026-10-01','2026-10-31');
eq('mes: 9 de 11 oportunidades (hoy lunes incluido)', [ps.done, ps.total], [9, 11]);
eq('día sin registro marcado como tal', S.dayDetail(ctx,'2026-10-14').state, 'unrecorded');
// Edición de horario conserva el pasado
const sched=M.applyScheduleEdit(h,{startDate:'2026-10-05',days:[1,3],target:null},'2026-10-19');
eq('nueva versión desde hoy', sched.map(r=>r.from), ['2026-10-05','2026-10-19']);
const h2={...h,schedule:sched};
eq('martes pasado sigue programado', !!M.scheduledRule(h2,'2026-10-13','2026-10-05'), true);
eq('martes futuro ya no', !!M.scheduledRule(h2,'2026-10-20','2026-10-05'), false);
// Cantidad: cumplimiento según objetivo vigente de esa fecha
const hc={...h,id:'h_test2',type:'count',schedule:[{from:'2026-10-05',days:[0,1,2,3,4,5,6],target:30},{from:'2026-10-10',days:[0,1,2,3,4,5,6],target:60}]};
eq('30/30 cumple el 6-oct', M.isDone(hc,{value:30},M.ruleAt(hc,'2026-10-06')), true);
eq('30/60 no cumple el 11-oct', M.isDone(hc,{value:30},M.ruleAt(hc,'2026-10-11')), false);
// Archivado
const ha={...h,archived:true,archivePeriods:[{from:'2026-10-12',to:null}]};
eq('archivado no programado', !!M.scheduledRule(ha,'2026-10-13','2026-10-05'), false);
eq('antes de archivar sí', !!M.scheduledRule(ha,'2026-10-09','2026-10-05'), true);
// Saneamiento rechaza basura
let threw=false; try { M.sanitizeHabit({id:'x',name:'<img onerror=1>'}); } catch { threw=true; } eq('sanitize rechaza hábito inválido', threw, true);
eq('sanitize conserva texto tal cual (se escapa al mostrar)', M.sanitizeHabit({...h,name:'<b>x</b>'}).name, '<b>x</b>');
console.log(`\n${pass} pasaron, ${fail} fallaron`);
process.exit(fail?1:0);
