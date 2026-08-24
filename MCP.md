# SynnoxERP — MCP (Model Context Protocol)

## ¿Qué es MCP?

El Model Context Protocol permite que clientes de IA como **Claude Desktop**, **ChatGPT**, **Cursor** y otros se conecten directamente a los módulos de SynnoxERP para consultar datos, crear registros y ejecutar acciones.

## URL de conexión

```
https://horixvitamar.fortiddns.com/mcp-gateway/mcp
```

> Esta URL se puede copiar desde **Admin → Sistema → 🤖 MCP**

## Herramientas disponibles

| Módulo | Herramientas | Descripción |
|--------|--------------|-------------|
| **Nómina** | 16 | Consultar registros, empleados, nóminas, estadísticas |
| **Logística** | 16 | Dashboard, vehículos, sedes, pedidos, rutas, devoluciones, geocercas |
| **Proveedores** | 15 | Facturas, proveedores, categorías, aprobaciones |
| **Proyectos** | 14 | Proyectos, tareas, comentarios, aprobaciones |

**Total: 61 herramientas**

Las herramientas se descubren automáticamente desde cada módulo habilitado en
el gateway. Los nombres publicados usan el prefijo del módulo, por ejemplo
`logistica_listar_devoluciones`.

---

## Conectar con Claude Desktop

### 1. Descargar Claude Desktop
https://claude.ai/download

### 2. Configurar MCP
1. Abrir Claude Desktop
2. Ir a **Settings → Developer → Edit Config**
3. Agregar el siguiente contenido:

```json
{
  "mcpServers": {
    "synnox-erp": {
      "url": "https://horixvitamar.fortiddns.com/mcp-gateway/mcp"
    }
  }
}
```

### 3. Reiniciar Claude Desktop
Las herramientas de SynnoxERP aparecerán en el icono de 🔧 herramientas.

---

## Conectar con Cursor

### 1. Configurar MCP
1. Abrir Cursor
2. Ir a **Settings → MCP Servers**
3. Agregar nueva URL:
   - **Name**: SynnoxERP
   - **URL**: `https://horixvitamar.fortiddns.com/mcp-gateway/mcp`

### 2. Activar el servidor
Toggle el switch para activar la conexión.

---

## Conectar con ChatGPT

### 1. Configurar MCP
1. Abrir ChatGPT
2. Ir a **Settings → Connectors → New Connector**
3. Ingresar la URL del MCP

### 2. Usar
En un chat, seleccionar el conector de SynnoxERP para usar las herramientas.

---

## Conectar con cualquier cliente MCP genérico

Cualquier cliente que soporte MCP sobre HTTP puede conectarse:

```
Endpoint: POST https://horixvitamar.fortiddns.com/mcp-gateway/mcp
Protocolo: JSON-RPC 2.0
Transporte: HTTP POST con Content-Type: application/json
```

### Ejemplo con curl

```bash
# Inicializar sesión
curl -X POST https://horixvitamar.fortiddns.com/mcp-gateway/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'

# Listar herramientas (usar session-id del paso anterior)
curl -X POST https://horixvitamar.fortiddns.com/mcp-gateway/mcp \
  -H "Content-Type: application/json" \
  -H "mcp-session-id: TU_SESSION_ID" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'

# Ejecutar herramienta
curl -X POST https://horixvitamar.fortiddns.com/mcp-gateway/mcp \
  -H "Content-Type: application/json" \
  -H "mcp-session-id: TU_SESSION_ID" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"nomina_estadisticas","arguments":{}}}'
```

---

## Seguridad

### OAuth 2.0 (recomendado)

El endpoint MCP soporta OAuth 2.0 con PKCE. Para habilitarlo:

1. Ir a **Admin → Sistema → 🔐 OAuth MCP**
2. Activar **Habilitar OAuth en MCP**
3. Los clientes deberán autenticarse antes de usar herramientas

### Sin OAuth (acceso abierto)

Si OAuth está deshabilitado, cualquier persona con la URL puede ejecutar herramientas. Solo usar en entornos de desarrollo o redes internas.

---

## Administración

### Admin → Sistema → 🤖 MCP
- Configurar URL de cada módulo
- Habilitar/deshabilitar módulos
- Probar conexión por módulo
- Gestionar herramientas individuales

### Admin → Sistema → 📋 Logs MCP
- Ver llamadas a herramientas (quién, cuándo, resultado)
- Estadísticas de uso
- Filtrar por módulo o herramienta

### Admin → Sistema → 🔐 OAuth MCP
- Habilitar/deshabilitar OAuth
- Ver clientes registrados
- Revocar tokens
- URLs de descubrimiento

---

## Herramientas por módulo

### Nómina (`nomina_*`)
- `nomina_consultar` — Consulta datos de una tabla
- `nomina_describir` — Describe una tabla
- `nomina_tablas` — Lista tablas y cantidad de filas
- `nomina_registros` — Lista registros de horas extra
- `nomina_resumen_por_sede` — Agrupa registros por sede
- `nomina_resumen_por_estado` — Agrupa registros por estado
- `nomina_empleados` — Lista de empleados
- `nomina_nominas` — Lista de nóminas
- `nomina_tipos` — Lista tipos de horas extra activos
- `nomina_estadisticas` — Estadísticas generales
- `nomina_empleado_detalle` — Detalle de empleado
- `nomina_crear_registro` — Crear registro de horas
- `nomina_aprobar_rechazar` — Aprobar/rechazar registro
- `nomina_crear_empleado` — Crear empleado
- `nomina_reporte_mensual` — Reporte mensual por sede
- `nomina_exportar_csv` — Exportar registros como CSV

### Logística (`logistica_*`)
- `logistica_dashboard` — Resumen de logística
- `logistica_listar_vehiculos` — Lista de vehículos
- `logistica_listar_sedes` — Lista de sedes
- `logistica_listar_pedidos` — Lista de pedidos
- `logistica_buscar_clientes` — Buscar clientes
- `logistica_crear_pedido` — Crear pedido
- `logistica_generar_rutas` — Generar rutas optimizadas
- `logistica_listar_rutas` — Lista de rutas
- `logistica_obtener_ruta` — Detalle de ruta
- `logistica_listar_devoluciones` — Lista devoluciones con filtros y paginación
- `logistica_obtener_devolucion` — Detalle de una devolución
- `logistica_resumen_devoluciones` — Estadísticas de devoluciones
- `logistica_listar_causales_devolucion` — Lista causales de devolución
- `logistica_listar_geocercas` — Lista geocercas
- `logistica_obtener_geocerca` — Detalle de una geocerca
- `logistica_listar_alertas_geocerca` — Historial de entradas y salidas

### Proveedores (`proveedores_*`)
- `proveedores_listar_facturas` — Lista de facturas
- `proveedores_resumen_dashboard` — Dashboard de proveedores
- `proveedores_listar_proveedores` — Lista de proveedores
- `proveedores_facturas_por_vencer` — Facturas próximas a vencer
- `proveedores_buscar_factura` — Buscar factura
- `proveedores_listar_categorias` — Lista categorías activas
- `proveedores_listar_areas` — Lista áreas activas
- `proveedores_estadisticas` — Estadísticas
- `proveedores_aprobar_factura` — Aprobar factura
- `proveedores_rechazar_factura` — Rechazar factura
- `proveedores_causar_factura` — Causar factura
- `proveedores_pagar_factura` — Marcar factura como pagada
- `proveedores_historial_eventos` — Historial de una factura
- `proveedores_vencimientos_dian` — Facturas próximas al vencimiento DIAN
- `proveedores_resumen_proveedor` — Resumen agrupado por proveedor

### Proyectos (`proyectos_*`)
- `proyectos_dashboard` — Resumen de proyectos
- `proyectos_listar_proyectos` — Lista de proyectos
- `proyectos_obtener_proyecto` — Detalle de proyecto
- `proyectos_crear_proyecto` — Crear proyecto
- `proyectos_listar_tareas` — Lista de tareas
- `proyectos_obtener_tarea` — Detalle de tarea
- `proyectos_buscar_tareas` — Buscar tareas
- `proyectos_crear_tarea` — Crear tarea
- `proyectos_actualizar_tarea` — Actualizar tarea
- `proyectos_comentarios` — Ver comentarios
- `proyectos_agregar_comentario` — Agregar comentario
- `proyectos_aprobar_tarea` — Aprobar tarea
- `proyectos_rechazar_tarea` — Rechazar tarea
- `proyectos_estadisticas` — Estadísticas

---

## Solución de problemas

### "Sesión inválida"
El cliente necesita enviar `mcp-session-id` después del `initialize`. La sesión dura 1 hora.

### "No autenticado"
OAuth está habilitado. El cliente necesita completar el flujo OAuth antes de usar herramientas.

### "Timeout"
Algunas herramientas pueden tardar. Aumentar el timeout del cliente a 30 segundos.

### "Herramienta no encontrada"
Verificar el nombre exacto: `modulo_nombre_herramienta` (ej: `nomina_empleados`).
