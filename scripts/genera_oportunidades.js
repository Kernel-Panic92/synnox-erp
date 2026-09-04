import pool from '../modules/crm/backend/config/db.js';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main(){
  const n = parseInt(process.argv[2]||'12');
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
  const etapas=['lead','calificado','propuesta','negociacion','ganada','perdida'];
  let creadas=0;
  for(let i=0;i<n;i++){
    const useLead = Math.random()<0.5 && leads.length;
    const cliente = useLead ? null : clientes[Math.floor(Math.random()*clientes.length)];
    const lead = useLead ? leads[Math.floor(Math.random()*leads.length)] : null;
    const vendedor = asesores[Math.floor(Math.random()*asesores.length)];
    const etapa = etapas[Math.floor(Math.random()*etapas.length)];
    const fuente = fuentes[Math.floor(Math.random()*fuentes.length)];
    const prioridad = prioridades[Math.floor(Math.random()*prioridades.length)];
    const prob = etapa==='ganada'?100: etapa==='perdida'?0 : [10,30,50,70,90][Math.floor(Math.random()*5)];
    const monto = Math.floor(500000 + Math.random()*5000000);
    const nombre = `OPORT-${String(Date.now()).slice(-6)}-${i+1} ${cliente? cliente.nombre.slice(0,20) : lead.raison_social.slice(0,20)}`;
    const fecha = new Date(Date.now() + (Math.floor(Math.random()*60)-15)*86400000).toISOString().slice(0,10);
    const r = await pool.query(`
      INSERT INTO crm.oportunidades (cliente_id, lead_id, nombre, monto_esperado, probabilidad, etapa, vendedor_id, fecha_cierre_estimada, fuente, prioridad, lista_precios)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      RETURNING id, nombre`, [cliente?.id||null, lead?.id||null, nombre, monto, prob, etapa, vendedor, fecha, fuente, prioridad, '200']);
    const oppId = r.rows[0].id;
    // 1-3 productos aleatorios
    const nProd = 1+Math.floor(Math.random()*2);
    for(let k=0;k<nProd;k++){
      const p = productos[Math.floor(Math.random()*productos.length)];
      const cant = 1+Math.floor(Math.random()*20);
      const precio = Number(p.precio_unitario)||10000;
      await pool.query(`INSERT INTO crm.oportunidad_productos (oportunidad_id, producto_id, cantidad, precio_unitario) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [oppId, p.id, cant, precio]);
    }
    // recalcula monto desde productos si hay
    const sum = await pool.query(`SELECT COALESCE(SUM(cantidad*precio_unitario),0) as t FROM crm.oportunidad_productos WHERE oportunidad_id=$1`,[oppId]);
    if(parseFloat(sum.rows[0].t)>0) await pool.query(`UPDATE crm.oportunidades SET monto_esperado=$1 WHERE id=$2`,[sum.rows[0].t, oppId]);
    await pool.query(`INSERT INTO crm.oportunidad_historial (oportunidad_id, etapa_anterior, etapa_nueva, cambiado_por, comentario) VALUES ($1,NULL,$2,$3,'Sintética')`,[oppId, etapa, vendedor]);
    creadas++;
    console.log(`+ ${r.rows[0].nombre} [${etapa}/${fuente}/${prioridad}] vend ${vendedor} monto ${monto}`);
  }
  console.log(`Creadas ${creadas} oportunidades sintéticas`);
  process.exit(0);
}
main().catch(e=>{ console.error(e); process.exit(1); });
