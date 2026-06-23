// Seed sintético para docflow — facturas y proveedores con estados variados
require('dotenv').config();
const { pool } = require('./index.js');

const proveedores = [
  { nit: '900123456-7', nombre: 'Tecnología Andina SAS', email: 'facturas@tecandina.com', telefono: '602-1112233', direccion: 'Cra 5 # 15-20, Cali' },
  { nit: '900234567-8', nombre: 'Empaques del Valle SAS', email: 'ventas@empaquesvalle.com', telefono: '602-2223344', direccion: 'Av 3N # 8-90, Cali' },
  { nit: '900345678-9', nombre: 'Transportes Rápidos Ltda', email: 'facturacion@transrapidos.com', telefono: '602-3334455', direccion: 'Cra 10 # 22-11, Yumbo' },
  { nit: '900456789-0', nombre: 'Insumos Químicos del Pacífico', email: 'facturas@insumosqpacifico.com', telefono: '602-4445566', direccion: 'Av 4N # 12-34, Cali' },
  { nit: '900567890-1', nombre: 'Mantenimiento Industrial SAS', email: 'admin@mantenimientoindustrial.com', telefono: '602-5556677', direccion: 'Cra 25 # 30-12, Cali' },
  { nit: '900678901-2', nombre: 'Aseo y Servicios Generales', email: 'facturas@aseoservicios.com', telefono: '602-6667788', direccion: 'Av 6N # 18-45, Cali' },
  { nit: '900789012-3', nombre: 'Papelería y Suministros Ltda', email: 'ventas@papeletasuministros.com', telefono: '602-7778899', direccion: 'Cra 15 # 10-30, Cali' },
  { nit: '900890123-4', nombre: 'Materiales de Empaque SAS', email: 'facturas@materialesempaque.com', telefono: '602-8889900', direccion: 'Av 2N # 25-60, Yumbo' },
  { nit: '900901234-5', nombre: 'Logística Integral del Cauca', email: 'facturacion@logisticaicauca.com', telefono: '602-9990011', direccion: 'Cra 30 # 15-22, Palmira' },
  { nit: '901012345-6', nombre: 'Suministros Industriales SAS', email: 'ventas@suministrosindustriales.com', telefono: '602-0001122', direccion: 'Av 1N # 5-15, Cali' },
  { nit: '901123456-7', nombre: 'Seguridad Ocupacional Ltda', email: 'facturas@seguridadocupacional.com', telefono: '602-1113344', direccion: 'Cra 8 # 20-10, Cali' },
  { nit: '901234567-8', nombre: 'Computadores y Redes SAS', email: 'facturacion@computadoresredes.com', telefono: '602-2224455', direccion: 'Av 5N # 35-40, Cali' },
  { nit: '901345678-9', nombre: 'Dotaciones Industriales SAS', email: 'ventas@dotacionesindustriales.com', telefono: '602-3335566', direccion: 'Cra 18 # 12-08, Cali' },
  { nit: '901456789-0', nombre: 'Servicios Temporales del Valle', email: 'facturas@serviciostemporales.com', telefono: '602-4446677', direccion: 'Av 7N # 28-15, Cali' },
];

const estados = ['recibida', 'revision', 'aprobada', 'rechazada', 'causada', 'pagada'];

function randomEntre(min, max) { return +(min + Math.random() * (max - min)).toFixed(2); }
function randomFecha(diasAtras) {
  const d = new Date(); d.setDate(d.getDate() - Math.floor(Math.random() * diasAtras));
  return d.toISOString();
}
function randomDate(diasAtras) {
  const d = new Date(); d.setDate(d.getDate() - Math.floor(Math.random() * diasAtras));
  return d.toISOString().split('T')[0];
}

async function seedDemo() {
  console.log('Sembrando datos demo de docflow...');
  try {
    const categorias = (await pool.query('SELECT id, nombre FROM categorias_compra')).rows;
    const areas = (await pool.query('SELECT id, nombre FROM areas')).rows;
    const usuarios = (await pool.query('SELECT id, nombre, email FROM usuarios WHERE activo = true LIMIT 5')).rows;

    if (!categorias.length || !areas.length) {
      console.log('Ejecuta primero seed.js para crear categorías y áreas');
      process.exit(1);
    }

    for (const p of proveedores) {
      const catDefault = categorias[Math.floor(Math.random() * categorias.length)].id;
      await pool.query(
        `INSERT INTO proveedores (nit, nombre, email_facturacion, telefono, direccion, activo, categoria_default_id)
         VALUES ($1,$2,$3,$4,$5,true,$6)
         ON CONFLICT (nit) DO NOTHING`,
        [p.nit, p.nombre, p.email, p.telefono, p.direccion, catDefault]
      );
    }
    console.log(`  ${proveedores.length} proveedores`);

    const provDb = (await pool.query('SELECT id, nombre FROM proveedores')).rows;
    let totalFacturas = 0;

    for (const p of provDb) {
      const numFacturas = 1 + Math.floor(Math.random() * 4);
      for (let i = 0; i < numFacturas; i++) {
        const estado = estados[Math.floor(Math.random() * estados.length)];
        const cat = categorias[Math.floor(Math.random() * categorias.length)];
        const area = areas[Math.floor(Math.random() * areas.length)];
        const asig = usuarios.length && Math.random() > 0.3 ? usuarios[Math.floor(Math.random() * usuarios.length)].id : null;
        const valor = randomEntre(500000, 15000000);
        const iva = +(valor * 0.19).toFixed(2);
        const numFact = `FAC-${String(p.nombre).substring(0,3).toUpperCase()}-${String(Date.now()).slice(-5)}-${i}`;

        const fechas = { recibida: randomFecha(60), revision: null, aprobada: null, causada: null, pagada: null };
        if (['revision','aprobada','rechazada','causada','pagada'].includes(estado)) fechas.revision = randomFecha(50);
        if (['aprobada','rechazada','causada','pagada'].includes(estado)) fechas.aprobada = randomFecha(40);
        if (['causada','pagada'].includes(estado)) fechas.causada = randomFecha(30);
        if (estado === 'pagada') fechas.pagada = randomFecha(20);

        await pool.query(
          `INSERT INTO facturas
           (numero_factura, proveedor_id, categoria_id, area_responsable_id, asignado_a_id,
            valor, valor_iva, valor_total, estado, fecha_factura,
            nit_emisor, nombre_emisor, recibida_en, aprobada_en, causada_en, pagada_en, observaciones)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
           ON CONFLICT DO NOTHING`,
          [
            numFact + '-' + Date.now(), p.id, cat.id, area.id, asig,
            valor, iva, total, estado, randomDate(60),
            p.nit.replace(/-/g,''), p.nombre.substring(0, 200),
            fechas.recibida, fechas.aprobada, fechas.causada, fechas.pagada,
            estado === 'rechazada' ? 'Documentación incompleta, se solicitó nuevamente' : null,
          ]
        );
        totalFacturas++;
      }
    }

    console.log(`  ${totalFacturas} facturas`);
    console.log('Seed demo completado');
    process.exit(0);
  } catch (err) {
    console.error('Error en seed demo:', err);
    process.exit(1);
  }
}

seedDemo();
