import bcrypt from 'bcrypt';
import pool from '../config/db.js';

async function seed() {
  console.log('▶️ Sembrando datos iniciales...');
  try {
    const email = process.env.ADMIN_EMAIL || 'admin@vitamar.com';
    const password = process.env.ADMIN_PASSWORD || 'admin123';
    const hash = await bcrypt.hash(password, 10);

    await pool.query(
      `INSERT INTO logistics.usuarios (nombre, email, password_hash, rol)
       VALUES ($1, $2, $3, 'admin')
       ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
      ['Administrador', email, hash]
    );

    console.log(`✅ Usuario admin creado: ${email}`);
    console.log('✅ Seed completado');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error en seed:', err);
    process.exit(1);
  }
}

seed();
