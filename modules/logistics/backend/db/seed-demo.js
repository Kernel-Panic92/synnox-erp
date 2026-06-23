// Seed sintético para logistics — datos de negocio con coordenadas reales en Cali, Colombia
import bcrypt from 'bcrypt';
import pool from '../config/db.js';

const sedes = [
  { nombre: 'Bodega Principal Cali', direccion: 'Cra 1 # 26-85, Barrio San Vicente', ciudad: 'Cali', latitud: 3.4516, longitud: -76.5320, centro_operacion: 'Cali Sur' },
  { nombre: 'Sede Norte', direccion: 'Av 3N # 52-10, Barrio Granada', ciudad: 'Cali', latitud: 3.4725, longitud: -76.5192, centro_operacion: 'Cali Norte' },
  { nombre: 'Centro de Distribución Jamundí', direccion: 'Cra 10 # 15-40, Jamundí', ciudad: 'Jamundí', latitud: 3.2600, longitud: -76.5400, centro_operacion: 'Jamundí' },
  { nombre: 'Sede Palmira', direccion: 'Cra 30 # 28-12, Palmira', ciudad: 'Palmira', latitud: 3.5394, longitud: -76.3036, centro_operacion: 'Palmira' },
];

const clientes = [
  { nombre: 'Almacenes Éxito S.A.', direccion: 'Cra 10 # 15-00, Cali', ciudad: 'Cali', telefono: '602-1234567', latitud: 3.4584, longitud: -76.5342, ruta: 'Sur-1', ruta_moto: 'Moto-Sur' },
  { nombre: 'Farmacias Cruz Verde', direccion: 'Av 6N # 12-34, Cali', ciudad: 'Cali', telefono: '602-2345678', latitud: 3.4652, longitud: -76.5401, ruta: 'Norte-1', ruta_moto: 'Moto-Norte' },
  { nombre: 'Droguería Colsubsidio', direccion: 'Cra 5 # 10-20, Cali', ciudad: 'Cali', telefono: '602-3456789', latitud: 3.4701, longitud: -76.5285, ruta: 'Norte-1', ruta_moto: 'Moto-Norte' },
  { nombre: 'Mercaldas', direccion: 'Av 2N # 8-90, Cali', ciudad: 'Cali', telefono: '602-4567890', latitud: 3.4608, longitud: -76.5350, ruta: 'Sur-1', ruta_moto: 'Moto-Sur' },
  { nombre: 'Comfandi Droguerías', direccion: 'Cra 25 # 22-10, Cali', ciudad: 'Cali', telefono: '602-5678901', latitud: 3.4555, longitud: -76.5420, ruta: 'Sur-2', ruta_moto: 'Moto-Sur' },
  { nombre: 'Supermercados La 14', direccion: 'Av 4N # 32-18, Cali', ciudad: 'Cali', telefono: '602-6789012', latitud: 3.4680, longitud: -76.5250, ruta: 'Norte-2', ruta_moto: null },
  { nombre: 'Olimpica S.A.', direccion: 'Cra 15 # 5-60, Cali', ciudad: 'Cali', telefono: '602-7890123', latitud: 3.4625, longitud: -76.5380, ruta: 'Sur-1', ruta_moto: null },
  { nombre: 'D1 Market', direccion: 'Av 3N # 20-45, Cali', ciudad: 'Cali', telefono: '602-8901234', latitud: 3.4660, longitud: -76.5300, ruta: 'Norte-1', ruta_moto: 'Moto-Norte' },
  { nombre: 'Almacenes La 14 Jamundí', direccion: 'Cra 12 # 18-30, Jamundí', ciudad: 'Jamundí', telefono: '602-9012345', latitud: 3.2610, longitud: -76.5410, ruta: 'Jamundí-1', ruta_moto: null },
  { nombre: 'Caja de Compensación Comfamiliar', direccion: 'Cra 28 # 30-12, Palmira', ciudad: 'Palmira', telefono: '602-0123456', latitud: 3.5400, longitud: -76.3050, ruta: 'Palmira-1', ruta_moto: 'Moto-Palmira' },
  { nombre: 'Droguería La 14 Centro', direccion: 'Cra 3 # 9-45, Cali', ciudad: 'Cali', telefono: '602-1122334', latitud: 3.4520, longitud: -76.5440, ruta: 'Sur-2', ruta_moto: 'Moto-Sur' },
  { nombre: 'Casa del Químico', direccion: 'Av 1N # 15-30, Cali', ciudad: 'Cali', telefono: '602-2233445', latitud: 3.4675, longitud: -76.5365, ruta: 'Norte-2', ruta_moto: 'Moto-Norte' },
  { nombre: 'Multifarma', direccion: 'Cra 8 # 22-11, Cali', ciudad: 'Cali', telefono: '602-3344556', latitud: 3.4580, longitud: -76.5390, ruta: 'Sur-1', ruta_moto: 'Moto-Sur' },
  { nombre: 'Coopser Salud', direccion: 'Cra 20 # 14-08, Cali', ciudad: 'Cali', telefono: '602-4455667', latitud: 3.4635, longitud: -76.5330, ruta: 'Sur-2', ruta_moto: null },
  { nombre: 'Servifarma Palmira', direccion: 'Cra 32 # 26-15, Palmira', ciudad: 'Palmira', telefono: '602-5566778', latitud: 3.5378, longitud: -76.3010, ruta: 'Palmira-1', ruta_moto: 'Moto-Palmira' },
];

const vehiculos = [
  { placa: 'XYZ123', alias: 'Camión 1', capacidad_peso: 5000, capacidad_volumen: 20, sede: 'Bodega Principal Cali', color: '#3498DB', estado: 'disponible' },
  { placa: 'ABC456', alias: 'Vehículo Mediano 1', capacidad_peso: 3000, capacidad_volumen: 12, sede: 'Bodega Principal Cali', color: '#E74C3C', estado: 'disponible' },
  { placa: 'DEF789', alias: 'Camión 2', capacidad_peso: 5000, capacidad_volumen: 20, sede: 'Sede Norte', color: '#2ECC71', estado: 'disponible' },
  { placa: 'GHI012', alias: 'Moto 1', capacidad_peso: 200, capacidad_volumen: 1, sede: 'Sede Norte', color: '#F39C12', estado: 'disponible' },
  { placa: 'JKL345', alias: 'Vehículo Mediano 2', capacidad_peso: 3000, capacidad_volumen: 12, sede: 'Centro de Distribución Jamundí', color: '#9B59B6', estado: 'disponible' },
  { placa: 'MNO678', alias: 'Camión Jamundí', capacidad_peso: 5000, capacidad_volumen: 20, sede: 'Centro de Distribución Jamundí', color: '#1ABC9C', estado: 'disponible' },
  { placa: 'PQR901', alias: 'Moto Palmira', capacidad_peso: 200, capacidad_volumen: 1, sede: 'Sede Palmira', color: '#E67E22', estado: 'disponible' },
];

const estadosPedido = ['pendiente', 'asignado', 'en_ruta', 'entregado', 'fallido'];

function randomEntre(min, max) { return +(min + Math.random() * (max - min)).toFixed(2); }
function randomFecha(diasAtras) {
  const d = new Date(); d.setDate(d.getDate() - Math.floor(Math.random() * diasAtras));
  return d.toISOString();
}
function randomHora() {
  const h = 6 + Math.floor(Math.random() * 12);
  const m = Math.floor(Math.random() * 60);
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:00`;
}

async function seedDemo() {
  console.log('Sembrando datos demo de logistics...');
  try {
    // 1. Sedes
    for (const s of sedes) {
      await pool.query(
        `INSERT INTO logistics.sedes (nombre, direccion, ciudad, latitud, longitud, centro_operacion, activo)
         VALUES ($1,$2,$3,$4,$5,$6,true) ON CONFLICT (nombre) DO NOTHING`,
        [s.nombre, s.direccion, s.ciudad, s.latitud, s.longitud, s.centro_operacion]
      );
    }
    console.log(`  ${sedes.length} sedes`);

    // 2. Clientes
    for (const c of clientes) {
      await pool.query(
        `INSERT INTO logistics.clientes (nombre, direccion, ciudad, telefono, latitud, longitud, geocodificado, ruta, ruta_moto)
         VALUES ($1,$2,$3,$4,$5,$6,true,$7,$8) ON CONFLICT (nombre) DO NOTHING`,
        [c.nombre, c.direccion, c.ciudad, c.telefono, c.latitud, c.longitud, c.ruta, c.ruta_moto]
      );
    }
    console.log(`  ${clientes.length} clientes`);

    // 3. Vehículos
    for (const v of vehiculos) {
      await pool.query(
        `INSERT INTO logistics.vehiculos (placa, alias, capacidad_peso, capacidad_volumen, sede, color, estado)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (placa) DO NOTHING`,
        [v.placa, v.alias, v.capacidad_peso, v.capacidad_volumen, v.sede, v.color, v.estado]
      );
    }
    console.log(`  ${vehiculos.length} vehículos`);

    // 4. Pedidos (one batch per client)
    let totalPedidos = 0;
    const clientsDb = (await pool.query('SELECT id, nombre FROM logistics.clientes')).rows;

    for (const c of clientsDb) {
      const numPedidos = 1 + Math.floor(Math.random() * 3);
      for (let i = 0; i < numPedidos; i++) {
        const estado = estadosPedido[Math.floor(Math.random() * estadosPedido.length)];
        const factura = `FAC-${String(Date.now()).slice(-4)}-${String(c.id).padStart(3,'0')}-${i}`;
        await pool.query(
          `INSERT INTO logistics.pedidos_logistica
           (numero_factura, cliente_id, cliente_nombre, direccion, ciudad, latitud, longitud,
            valor_contado, valor_credito, estado, peso_estimado, volumen_estimado,
            ventana_horaria_inicio, ventana_horaria_fin)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
           ON CONFLICT (numero_factura) DO NOTHING`,
          [
            `${factura}-${Date.now()}`, c.id, c.nombre,
            clientes.find(cl => cl.nombre === c.nombre)?.direccion || 'Dirección demo',
            clientes.find(cl => cl.nombre === c.nombre)?.ciudad || 'Cali',
            clientes.find(cl => cl.nombre === c.nombre)?.latitud || 3.45,
            clientes.find(cl => cl.nombre === c.nombre)?.longitud || -76.53,
            randomEntre(50000, 500000), randomEntre(30000, 300000),
            estado, randomEntre(1, 50), randomEntre(0.1, 5),
            '08:00:00', randomHora(),
          ]
        );
        totalPedidos++;
      }
    }

    console.log(`  ${totalPedidos} pedidos`);
    console.log('Seed demo completado');
    process.exit(0);
  } catch (err) {
    console.error('Error en seed demo:', err);
    process.exit(1);
  }
}

seedDemo();
