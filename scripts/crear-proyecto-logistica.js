#!/usr/bin/env node
/**
 * Script para crear proyecto "Desarrollo Módulo Logística" en producción
 * Uso: ADMIN_EMAIL=xxx ADMIN_PASS=xxx node scripts/crear-proyecto-logistica.js
 */

import fs from 'fs';
import path from 'path';

const BASE_URL = 'https://horixvitamar.fortiddns.com';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'coordinadorsistemas@vitamar.com.co';
const ADMIN_PASS = process.env.ADMIN_PASS;

if (!ADMIN_PASS) {
  console.error('❌ Falta ADMIN_PASS en variables de entorno');
  console.error('Uso: ADMIN_EMAIL=xxx ADMIN_PASS=xxx node scripts/crear-proyecto-logistica.js');
  process.exit(1);
}

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const TAREAS_FILE = path.join(__dirname, 'tareas-logistica.json');
const data = JSON.parse(fs.readFileSync(TAREAS_FILE, 'utf8'));

let jwtToken = null;
let proyectoId = null;
let usuarioId = null;

async function fetchApi(url, options = {}) {
  const defaultHeaders = {
    'Content-Type': 'application/json',
    ...(jwtToken && { 'Authorization': `Bearer ${jwtToken}` })
  };

  const res = await fetch(url, {
    ...options,
    headers: { ...defaultHeaders, ...options.headers },
    credentials: 'include'
  });

  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${json.error || json.raw || res.statusText}`);
  }

  return json;
}

async function login() {
  console.log('🔐 Iniciando sesión en producción...');
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASS }),
    credentials: 'include'
  });

  const text = await res.text();
  const json = text ? JSON.parse(text) : {};

  if (!res.ok) {
    throw new Error(`Login falló: ${json.error || res.statusText}`);
  }

  jwtToken = json.jwt;
  console.log(`✅ Login OK - Usuario: ${json.usuario?.nombre || json.usuario?.email}`);
  console.log(`   Rol: ${json.usuario?.rol}, Módulos: ${json.modulos?.join(', ')}`);

  if (!json.modulos?.includes('proyectos')) {
    throw new Error('El usuario no tiene acceso al módulo "proyectos"');
  }
}

async function buscarUsuarioEdgar() {
  console.log('\n🔍 Buscando usuario "Edgar Velasquez"...');
  const res = await fetchApi(`${BASE_URL}/api/usuarios/public`);
  const usuarios = res;

  const edgar = usuarios.find(u =>
    u.nombre?.toLowerCase().includes('edgar') &&
    u.nombre?.toLowerCase().includes('velasquez')
  );

  if (!edgar) {
    console.log('Usuarios disponibles:', usuarios.map(u => `${u.id}: ${u.nombre} (${u.email})`).join(', '));
    throw new Error('No se encontró usuario "Edgar Velasquez"');
  }

  usuarioId = edgar.id;
  console.log(`✅ Encontrado: ID=${usuarioId}, Nombre="${edgar.nombre}", Email="${edgar.email}", Rol="${edgar.rol}"`);
}

async function crearProyecto() {
  console.log('\n📁 Creando proyecto...');
  const proyecto = data.proyecto;
  const res = await fetchApi(`${BASE_URL}/proyectos/api/proyectos`, {
    method: 'POST',
    body: JSON.stringify({
      ...proyecto,
      asignado_a: usuarioId
    })
  });

  if (!res.exitosa) throw new Error(res.error || 'Error creando proyecto');
  proyectoId = res.proyecto.id;
  console.log(`✅ Proyecto creado: ID=${proyectoId}, Nombre="${res.proyecto.nombre}"`);
}

async function crearTarea(tarea, columna, estado) {
  const res = await fetchApi(`${BASE_URL}/proyectos/api/tareas`, {
    method: 'POST',
    body: JSON.stringify({
      proyecto_id: proyectoId,
      titulo: tarea.titulo,
      descripcion: tarea.descripcion,
      tipo: tarea.tipo,
      prioridad: tarea.prioridad,
      columna: columna,
      estado: estado,
      asignado_a: usuarioId,
      reportero: usuarioId
    })
  });

  if (!res.exitosa) throw new Error(res.error || 'Error creando tarea');
  return res.tarea;
}

async function main() {
  console.log('═══════════════════════════════════════════');
  console.log('  CREAR PROYECTO: Desarrollo Módulo Logística');
  console.log('═══════════════════════════════════════════\n');

  try {
    await login();
    await buscarUsuarioEdgar();
    await crearProyecto();

    console.log('\n📋 Creando 29 tareas COMPLETADAS...');
    let okCompletadas = 0, failCompletadas = 0;
    for (const tarea of data.tareas_completadas) {
      try {
        const created = await crearTarea(tarea, 'completada', 'completada');
        console.log(`  ✅ [${created.id}] ${tarea.titulo}`);
        okCompletadas++;
      } catch (e) {
        console.log(`  ❌ ${tarea.titulo}: ${e.message}`);
        failCompletadas++;
      }
    }

    console.log('\n📋 Creando 10 tareas PENDIENTES...');
    let okPendientes = 0, failPendientes = 0;
    for (const tarea of data.tareas_pendientes) {
      try {
        const created = await crearTarea(tarea, 'pendiente', 'pendiente');
        console.log(`  ✅ [${created.id}] ${tarea.titulo}`);
        okPendientes++;
      } catch (e) {
        console.log(`  ❌ ${tarea.titulo}: ${e.message}`);
        failPendientes++;
      }
    }

    console.log('\n═══════════════════════════════════════════');
    console.log('  RESUMEN');
    console.log('═══════════════════════════════════════════');
    console.log(`Proyecto: ID=${proyectoId} (${data.proyecto.nombre})`);
    console.log(`Asignado a: Usuario ID=${usuarioId} (Edgar Velasquez)`);
    console.log(`Tareas completadas: ${okCompletadas} OK, ${failCompletadas} fallaron`);
    console.log(`Tareas pendientes:  ${okPendientes} OK, ${failPendientes} fallaron`);
    console.log(`Total: ${okCompletadas + okPendientes}/${data.tareas_completadas.length + data.tareas_pendientes.length}`);
    console.log(`\n🔗 Ver en: ${BASE_URL}/proyectos/#proyectos`);
    console.log(`🔗 Ver tareas: ${BASE_URL}/proyectos/#tareas?proyecto_id=${proyectoId}`);

    if (failCompletadas > 0 || failPendientes > 0) {
      process.exit(1);
    }
  } catch (e) {
    console.error('\n❌ ERROR:', e.message);
    process.exit(1);
  }
}

main();