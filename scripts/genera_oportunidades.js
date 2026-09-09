import pool from '../modules/crm/backend/config/db.js';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Uso:
//   node scripts/genera_oportunidades.js [n] [--dias N]
//   Sin --dias: comportamiento original (creadas hoy).
//   Con --dias N: simula N días de operación (creado_en escalonado,
//   progresión de etapas coherente con la antigüedad e historial fechado).
async function main(){
  const args = process.argv.slice(2);
  const n = parseInt(args.find(a => !a.startsWith('--')) || '12');
  const diasIdx = args.indexOf('--dias');
  const DIAS = diasIdx >= 0 ? parseInt(args[diasIdx + 1] || '30') : 0;

  const ldb = new Database(path.join(__dirname,'..','launcher','launcher.db'),{readonly:true});
  const asesores = ldb.prepare(`SELECT id FROM usuarios WHERE perfil_id=2440 AND activo=1`).all().map(r=>r.id);
  ldb.close();
  if(!asesores.length){ console.log('No hay asesores 2440'); process.exit(1); }
  const clientes = (await pool.query(`SELECT id, nombre FROM crm.clientes WHERE activo=TRUE ORDER BY random() LIMIT ${Math.min(n*2,50)}`)).rows;
  const leads = (await pool.query(`SELECT id, raison_social FROM crm.leads ORDER BY random() LIMIT ${Math.min(n,20)}`)).rows;
  const productos = (await pool.query(`SELECT id, codigo, nombre, precio_unitario FROM crm.productos WHERE activo=TRUE ORDER BY random() LIMIT 30`)).rows;
  if(!clientes.length){ console.log('No hay clientes'); process.exit(1); }
  const fuentes=['web','referido','llamada','feria','otro'];
  const prioridades=['baja','media','alta','critica'];
  const ETAPAS=['lead','calificado','propuesta','negociacion'];
  const pick = a => a[Math.floor(Math.random()*a.length)];
  const dayMs = 86400000;
  const now = Date.now();
  const isoDay = ts => new Date(ts).toISOString().slice(0,10);

  let creadas=0;
  for(let i=0;i<n;i++){
    const useLead = Math.random()<0.5 && leads.length;
    const cliente = useLead ? null : pick(clientes);
    const lead = useLead ? pick(leads) : null;
    const vendedor = pick(asesores);
    const fuente = pick(fuentes);
    const prioridad = pick(prioridades);

    // Antigüedad y etapa final coherente: viejas tienden a cerradas
    const edadDias = DIAS ? Math.floor(Math.random()*DIAS) : 0;
    const creadoTs = now - edadDias*dayMs - Math.floor(Math.random()*dayMs);
    let etapa, cerrada=null;
    if (DIAS && edadDias > 20 && Math.random() < 0.7) {
      cerrada = Math.random() < 0.55 ? 'ganada' : 'perdida';
      etapa = cerrada;
    } else if (DIAS && edadDias > 10 && Math.random() < 0.35) {
      cerrada = Math.random() < 0.5 ? 'ganada' : 'perdida';
      etapa = cerrada;
    } else {
      etapa = ETAPAS[Math.min(Math.floor(edadDias/8), ETAPAS.length-1)];
      if (!DIAS) etapa = pick(['lead','calificado','propuesta','negociacion','ganada','perdida']);
      if (etapa==='ganada'||etapa==='perdida') cerrada = etapa;
    }
    const prob = etapa==='ganada'?100: etapa==='perdida'?0 : [10,30,50,70,90][Math.floor(Math.random()*5)];
    const nombre = `OPORT-${String(creadoTs).slice(-6)}-${i+1} ${(cliente? cliente.nombre : lead.raison_social).slice(0,20)}`;
    const fechaCierre = isoDay(creadoTs + (Math.floor(Math.random()*60)-15)*dayMs);
    const r = await pool.query(`
      INSERT INTO crm.oportunidades (cliente_id, lead_id, nombre, monto_esperado, probabilidad, etapa, vendedor_id, fecha_cierre_estimada, fuente, prioridad, lista_precios, creado_en)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      RETURNING id, nombre`, [cliente?.id||null, lead?.id||null, nombre, 0, prob, etapa, vendedor, fechaCierre, fuente, prioridad, '200', new Date(creadoTs).toISOString()]);
    const oppId = r.rows[0].id;
    // 1-2 productos y monto recalculado
    const nProd = 1+Math.floor(Math.random()*2);
    for(let k=0;k<nProd;k++){
      const p = pick(productos);
      const cant = 1+Math.floor(Math.random()*20);
      const precio = Number(p.precio_unitario)||10000;
      await pool.query(`INSERT INTO crm.oportunidad_productos (oportunidad_id, producto_id, cantidad, precio_unitario) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [oppId, p.id, cant, precio]);
    }
    const sum = await pool.query(`SELECT COALESCE(SUM(cantidad*precio_unitario),0) as t FROM crm.oportunidad_productos WHERE oportunidad_id=$1`,[oppId]);
    const monto = parseFloat(sum.rows[0].t)>0 ? sum.rows[0].t : Math.floor(500000 + Math.random()*5000000);
    const motivo = cerrada==='perdida' ? pick(['Precio','Competencia','Sin presupuesto','No responde','Otro']) : null;
    await pool.query(`UPDATE crm.oportunidades SET monto_esperado=$1, motivo_perdida=COALESCE($2, motivo_perdida) WHERE id=$3`,[monto, motivo, oppId]);
    // Historial: cadena lead→…→etapa con fechas entre creación y hoy
    const orden = ['lead','calificado','propuesta','negociacion','ganada','perdida'];
    const hasta = orden.indexOf(etapa);
    const pasos = hasta <= 0 ? ['lead'] : orden.slice(0, hasta+1);
    for (let s=0; s<pasos.length; s++) {
      const fTs = pasos.length === 1 ? creadoTs : creadoTs + Math.floor((now-creadoTs) * s/(pasos.length-1 || 1));
      await pool.query(
        `INSERT INTO crm.oportunidad_historial (oportunidad_id, etapa_anterior, etapa_nueva, cambiado_por, comentario, fecha) VALUES ($1,$2,$3,$4,'Sintética', $5)`,
        [oppId, s===0?null:pasos[s-1], pasos[s], vendedor, new Date(Math.min(fTs, now)).toISOString()]);
    }
    creadas++;
    console.log(`+ ${r.rows[0].nombre} [${etapa}/${fuente}/${prioridad}] vend ${vendedor} monto ${monto} creado ${isoDay(creadoTs)}`);
  }
  console.log(`Creadas ${creadas} oportunidades sintéticas${DIAS?` (simulando ${DIAS} días)`:''}`);
  process.exit(0);
}
main().catch(e=>{ console.error(e); process.exit(1); });
