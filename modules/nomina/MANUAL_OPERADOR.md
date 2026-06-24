# Manual del Operador — Horix

> Sistema de Gestión de Horas Extras y Novedades de Nómina

---

## 1. Inicio de Sesión

1. Abre el navegador y ve a la URL de Horix
2. Ingresa tu **correo electrónico** y **contraseña** asignados por RRHH
3. Haz clic en **"Iniciar Sesión"**

![Pantalla de inicio de sesión](screenshots/01-login.png)

> Si olvidaste tu contraseña, haz clic en "¿Olvidaste tu contraseña?" para solicitar un restablecimiento.

---

## 2. Conociendo el Dashboard

Al ingresar, verás el **Dashboard** con un resumen visual:

![Dashboard principal](screenshots/02-dashboard.png)

### Widgets disponibles:

| Widget | Descripción |
|---|---|
| **Distribución por Estado** | Gráfico circular con el porcentaje de tus registros aprobados, pendientes y rechazados |
| **Horas por Centro** | Horas acumuladas por cada sede en el año actual |
| **Top 5 Empleados** | Los 5 empleados con más horas registradas en el año |
| **Últimos Registros** | Lista de los registros más recientes que has creado |
| **Valor COP por Mes** | Distribución mensual del valor monetario en el año |

---

## 3. Barra Lateral de Navegación

A la izquierda encontrarás el menú principal:

![Barra lateral](screenshots/03-sidebar.png)

### Opciones disponibles para Operador:

| Ícono | Sección | Descripción |
|---|---|---|
| 📊 | **Dashboard** | Panel de inicio con resumen |
| 📝 | **Historial** | Consulta todos los registros que has creado |
| ➕ | **Nuevo Registro** | Formulario para cargar horas extras o novedades |
| 📈 | **Reportes** | Exportar y filtrar registros |

> Si el menú se ve muy pequeño, usa el botón ≡ para colapsarlo o ☰ en móvil.

---

## 4. Crear un Nuevo Registro de Horas

![Formulario de nuevo registro](screenshots/04-nuevo-registro.png)

### Paso a paso:

1. Haz clic en **"Nuevo Registro"** en el menú lateral
2. **Empleado** — empieza a escribir su nombre y elige de la lista
3. **Período de Nómina** — selecciona el período correspondiente
4. **Fecha** — escoge la fecha del registro
5. **Horas** — ingresa en formato `HH:MM` (ej: `1:30`)
6. **Tipo** — selecciona el tipo de hora
7. **Motivo** — describe la actividad (campo obligatorio)
8. **Observaciones** — opcional
9. **Adjuntos** — arrastra archivos si aplica
10. Haz clic en **"Guardar Registro"**

![Registro guardado](screenshots/05-registro-exitoso.png)

### Tipos Valor COP:

Si el tipo seleccionado es de **Valor COP**:
- El campo **Horas** se oculta automáticamente
- Aparece el campo **Valor COP** para ingresar el monto en pesos

![Registro tipo valor](screenshots/06-registro-valor.png)

> No puedes crear registros con fecha futura ni fuera del período de nómina.

---

## 5. Consultar el Historial

![Historial](screenshots/07-historial.png)

### Filtros disponibles:

| Filtro | Descripción |
|---|---|
| **Buscar Empleado** | Por nombre |
| **Período de Nómina** | Período específico |
| **Tipo de Hora** | Por tipo |
| **Centro de Operación** | Por sede |
| **Empleado** | Selección específica |
| **Estado** | Pendiente, Aprobado o Rechazado |

Ordena la tabla haciendo clic en los encabezados.

### Acciones:

| Botón | Acción |
|---|---|
| ✏️ | **Editar** — solo si el registro está Pendiente y fue creado por ti |
| 👁️ | **Ver detalle** — haz clic en la fila |

> La tabla se actualiza automáticamente cada 30 segundos.

---

## 6. Editar un Registro Pendiente

1. Ve al **Historial** y localiza el registro
2. Haz clic en **✏️ Editar**
3. Modifica los campos necesarios
4. Haz clic en **"Guardar Cambios"**

![Editar registro](screenshots/08-editar-registro.png)

> Solo puedes editar registros Pendiente que hayas creado tú.

---

## 7. Reportes

![Reportes](screenshots/09-reportes.png)

Filtros adicionales: **Rango de Fechas** y **Vinculación**.

### Exportar a Excel:

1. Aplica los filtros deseados
2. Haz clic en **"📥 Exportar"**
3. Se descarga un `.xlsx` con formato profesional

![Exportar Excel](screenshots/10-exportar-excel.png)

---

## 9. Cerrar Sesión

Haz clic en **⎋** (barra superior derecha) y confirma.

![Cerrar sesión](screenshots/12-cerrar-sesion.png)

> La sesión expira automáticamente tras 30 días de inactividad.

---

## 10. Solución de Problemas

| Problema | Solución |
|---|---|
| No veo Editar | El registro ya fue aprobado/rechazado o no es tuyo |
| No encuentro un empleado | Solo ves los de tu sede. Contacta a RRHH |
| Valor COP no aparece | Selecciona un tipo marcado como "Tipo valor" |
| "Motivo requerido" | El motivo es obligatorio |
| Fecha incorrecta | No se permiten fechas futuras ni fuera del período |
| Historial desactualizado | Espera hasta 30 segundos (auto-refresh) |

---

## Resumen de Permisos

| Acción | ¿Puede? |
|---|---|
| Ver Dashboard | ✅ |
| Crear registros | ✅ |
| Editar registros propios (pendientes) | ✅ |
| Ver Historial (solo propios) | ✅ |
| Ver Reportes | ✅ |
| Exportar Excel | ✅ |
| Adjuntar archivos | ✅ |
| Aprobar/Rechazar | ❌ |
| Revertir | ❌ |
| Gestionar empleados/usuarios/tipos/centros/nóminas | ❌ |
| Configuración/Backup | ❌ |

---

*Documento generado para Horix v2.10.0*
© 2026 Edgar Velasquez
github.com/Kernel-Panic92/Horix
Todos los derechos reservados
