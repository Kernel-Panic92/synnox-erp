# Manual de RRHH — Horix

> Sistema de Gestión de Horas Extras y Novedades de Nómina

---

## 1. Inicio de Sesión

1. Abre el navegador y ve a la URL de Horix
2. Ingresa tu **correo electrónico** y **contraseña** asignados por el administrador
3. Haz clic en **"Iniciar Sesión"**

![Pantalla de inicio de sesión](screenshots/01-login.png)

> Si olvidaste tu contraseña, haz clic en "¿Olvidaste tu contraseña?" para solicitar un restablecimiento.

---

## 2. Conociendo el Dashboard

Al ingresar, verás el **Dashboard** con información consolidada de toda la organización:

![Dashboard principal](screenshots/02-dashboard.png)

### Widgets disponibles:

| Widget | Descripción |
|---|---|
| **Distribución por Estado** | Gráfico circular con todos los registros de la empresa |
| **Horas por Centro** | Horas acumuladas por cada sede |
| **Top 5 Empleados** | Empleados con más horas registradas |
| **Últimos Registros** | Registros más recientes de todos los empleados |
| **Valor COP por Mes** | Distribución mensual del valor monetario |

> Como RRHH, ves **todos los datos** de todas las sedes y empleados sin restricciones.

---

## 3. Barra Lateral de Navegación

A la izquierda encontrarás el menú principal con las opciones de gestión:

![Barra lateral RRHH](screenshots/30-sidebar-rrhh.png)

### Opciones disponibles:

| Ícono | Sección | Descripción |
|---|---|---|
| 📊 | **Dashboard** | Panel de inicio con resumen |
| ➕ | **Registrar Horas** | Formulario para cargar horas extras |
| 📋 | **Historial** | Todos los registros de la organización |
| 👥 | **Empleados** | Gestión completa de empleados |
| 🏢 | **Centros de Op.** | Gestión de centros de operación |
| 💰 | **Períodos Nómina** | Gestión de períodos de nómina |
| 📈 | **Reportes** | Exportar y filtrar registros |
| 📤 | **Exportar Siesa** | Exportación para Siesa Nómina Web |
| 🔐 | **Usuarios** | Consulta de usuarios del sistema |
| 🏷️ | **Tipos de Hora** | Gestión de tipos de hora extra |

> Si el menú se ve muy pequeño, usa el botón ≡ para colapsarlo o ☰ en móvil.

---

## 4. Gestión de Empleados

Administra la base de datos de empleados de la organización.

![Gestión de empleados](screenshots/16-empleados.png)

### Campos del empleado:

| Campo | Descripción |
|---|---|
| **Nombre** | Nombre completo |
| **Cédula** | Número de identificación (único) |
| **Cargo** | Cargo del empleado |
| **Departamento** | Departamento al que pertenece |
| **Email** | Correo electrónico (opcional) |
| **Teléfono** | Número de contacto (opcional) |
| **Vinculación** | Vinculado o Temporal |
| **Sede** | Centro de operación asignado |

### Importación masiva por CSV:

![Importar empleados desde CSV](screenshots/17-importar-csv.png)

1. Ve a **Empleados** y haz clic en **"Importar CSV"**
2. Arrastra un archivo `.csv` con las columnas:
   - `nombre` (requerido)
   - `cedula` (requerido, único)
   - `cargo`, `departamento`, `sede` (requeridos)
   - `email`, `telefono` (opcionales)
3. El sistema **omite duplicados** automáticamente por cédula

### Limpiar datos corruptos:

Si ves un banner de advertencia **"⚠️ Empleados con datos corruptos"**, significa que hay registros con caracteres extraños (�) por problemas de codificación.

1. Haz clic en **"Mostrar afectados"** para filtrar solo esos empleados
2. Edita cada uno y corrige el nombre manualmente
3. Guarda los cambios

> RRHH puede crear, editar y corregir empleados, pero **no puede eliminarlos**. Contacta al administrador si necesitas eliminar un empleado.

---

## 5. Centros de Operación (Sedes)

Gestiona las sedes o centros de operación.

![Centros de operación](screenshots/18-centros.png)

1. Ve a **Centros de Op.**
2. Haz clic en **"Nuevo Centro"**
3. Ingresa el **nombre** del centro
4. Opcionalmente puedes **desactivar** un centro

> RRHH puede crear y editar centros, pero **no puede eliminarlos**. Si un centro tiene empleados asignados, no podrás eliminarlo. Desactívalo en su lugar.

---

## 6. Períodos de Nómina

Gestiona los períodos de nómina del sistema.

![Períodos de nómina](screenshots/19-nominas.png)

### Crear un período manualmente:

1. Ve a **Períodos Nómina**
2. Haz clic en **"Nuevo Período"**
3. Ingresa nombre, tipo (Quincenal/Mensual) y rango de fechas
4. Guarda

### Generación automática anual:

1. Haz clic en **"Generar Año"**
2. Selecciona el **tipo**: Quincenal (24 períodos) o Mensual (12 períodos)
3. Revisa el **preview** antes de confirmar
4. Confirma la generación

> RRHH puede crear y editar períodos, pero **no puede eliminarlos**. Solo el administrador puede eliminar períodos de nómina.

---

## 7. Tipos de Hora

Define los tipos de hora extra o concepto de nómina disponibles.

![Tipos de hora](screenshots/21-tipos.png)

### Crear un tipo:

1. Ve a **Tipos de Hora**
2. Haz clic en **"Nuevo Tipo"**
3. Ingresa:
   - **Nombre**: identificador único
   - **Valor COP**: marca esta opción si el concepto es monetario (transporte, bonificaciones) en vez de horas
4. Guarda

### Activar/Desactivar:

- Los tipos **inactivos** no aparecen en el formulario de registro
- Los registros existentes con tipos inactivos no se ven afectados

> Si marcas "Valor COP", el campo Horas se oculta automáticamente y aparece Valor COP en el formulario.

---

## 8. Exportar Siesa

Exporta las novedades de horas extra aprobadas para Siesa Nómina Web.

![Exportar Siesa](screenshots/20-siesa.png)

1. Ve a **Exportar Siesa**
2. Selecciona **rango de fechas**
3. Opcionalmente filtra por **concepto** (código Siesa)
4. Revisa la **vista previa**
5. Haz clic en **"Exportar"**
6. Se descarga un `.xlsx` listo para importar en Siesa

> Solo se exportan registros con estado **Aprobado**.

---

## 9. Registrar Horas Extra

Puedes crear registros de horas extra o novedades para cualquier empleado.

![Formulario de nuevo registro](screenshots/04-nuevo-registro.png)

1. Ve a **Registrar Horas**
2. **Empleado** — empieza a escribir su nombre y elige de la lista
3. **Período de Nómina** — selecciona el período
4. **Fecha** — escoge la fecha del registro
5. **Horas** — ingresa en formato `HH:MM` (ej: `1:30`) o **Valor COP** si el tipo lo requiere
6. **Tipo** — selecciona el tipo de hora
7. **Motivo** — describe la actividad (campo obligatorio)
8. **Observaciones** — opcional
9. **Adjuntos** — arrastra archivos si aplica
10. Haz clic en **"Guardar Registro"**

### Tipos Valor COP:

Si el tipo seleccionado es de **Valor COP**:
- El campo **Horas** se oculta automáticamente
- Aparece el campo **Valor COP** para ingresar el monto en pesos

![Registro tipo valor](screenshots/06-registro-valor.png)

> No puedes crear registros con fecha futura ni fuera del período de nómina.

---

## 10. Historial

Ves **todos los registros** de la organización. Puedes filtrar por sede si lo necesitas.

![Historial](screenshots/07-historial.png)

### Acciones disponibles:

| Botón | Acción |
|---|---|
| ✏️ | **Editar** — cualquier registro pendiente |
| 👁️ | **Ver detalle** — haz clic en la fila |

> La tabla se actualiza automáticamente cada 30 segundos.

---

## 11. Reportes

Exporta registros filtrados a Excel con formato profesional.

![Reportes](screenshots/09-reportes.png)

Filtros: empleado, período, tipo, centro, estado, rango de fechas, vinculación.

1. Aplica los filtros deseados
2. Haz clic en **"📥 Exportar"**
3. Se descarga un `.xlsx` con estilo profesional (encabezados azules, bordes, formato de moneda)

---

## 12. Usuarios (Consulta)

Puedes ver la lista de usuarios del sistema y sus roles, pero la **gestión de usuarios** (crear, editar, eliminar, resetear contraseñas) es exclusiva del administrador.

![Usuarios](screenshots/15-usuarios.png)

> Si necesitas crear un nuevo usuario, cambiar su rol o resetear una contraseña, contacta al administrador del sistema.

---

## 13. Cerrar Sesión

Haz clic en **⎋** en el sidebar (parte inferior) y confirma.

![Cerrar sesión](screenshots/12-cerrar-sesion.png)

> La sesión expira automáticamente tras 30 días de inactividad.

---

## 14. Solución de Problemas

| Problema | Solución |
|---|---|
| No encuentro un empleado | Revisa los filtros de búsqueda. Todos los empleados deberían aparecer |
| Error al importar CSV | Verifica que las columnas sean: nombre, cedula, cargo, departamento, sede |
| Empleados con caracteres extraños (�) | Usa "Limpiar corruptos" en Empleados y edita uno por uno |
| No puedo eliminar un empleado/centro/período | Solo el administrador puede eliminar. Desactívalo si es necesario |
| No veo la opción de eliminar | Es correcto — RRHH no puede eliminar registros permanentemente |
| No aparecen todos los registros | El Historial muestra todos. Verifica los filtros de búsqueda |
| Valor COP no aparece en el formulario | Selecciona un tipo marcado como "Tipo valor" |
| No veo Configuración en el menú | La configuración (SMTP, backup, seguridad) es solo para administradores |
| Historial desactualizado | Espera hasta 30 segundos (auto-refresh) |

---

## Resumen de Permisos

| Acción | ¿Puede? |
|---|---|
| Ver Dashboard (datos consolidados) | ✅ |
| Ver Historial (todos los registros) | ✅ |
| Crear registros | ✅ |
| Editar cualquier registro (pendiente) | ✅ |
| Gestionar empleados (CRUD) | ✅ (excepto eliminar) |
| Importar empleados por CSV | ✅ |
| Gestionar centros (CRUD) | ✅ (excepto eliminar) |
| Gestionar períodos de nómina (CRUD) | ✅ (excepto eliminar) |
| Generar períodos automáticos | ✅ |
| Gestionar tipos de hora (CRUD) | ✅ |
| Exportar Siesa | ✅ |
| Ver usuarios del sistema | ✅ (solo lectura) |
| Exportar reportes Excel | ✅ |
| Configuración SMTP / Backup / Logo / Seguridad | ❌ |
| Auditoría / Diagnóstico | ❌ |
| Aprobar/Rechazar registros | ❌ (solo Gerencia) |
| Eliminar empleados / centros / períodos | ❌ (solo Admin) |
| Gestionar usuarios (crear/editar/eliminar) | ❌ (solo Admin) |

---

*Documento generado para Horix v2.10.0*
© 2026 Edgar Velasquez
github.com/Kernel-Panic92/Horix
Todos los derechos reservados
