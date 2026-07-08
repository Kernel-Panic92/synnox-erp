# SynnoxERP — Roadmap de Producto

> Visión de largo plazo del sistema ERP.
> Para detalles técnicos, ver [ARCHITECTURE.md](ARCHITECTURE.md).

---

## Estado Actual (Julio 2026)

### Módulos Activos

| Módulo | Estado | Funcionalidades Principales |
|--------|--------|----------------------------|
| **Launcher** | ✅ Producción | Auth, perfiles, dashboard central |
| **Nómina** | ✅ Producción | Horas extras, aprobaciones, reportes SIESA |
| **Proveedores** | ✅ Producción | Facturas DIAN, flujo de aprobación, IMAP sync |
| **Logística** | ✅ Producción | Rutas, pedidos, vehículos, geolocalización |

### Métricas Clave

- **Usuarios activos:** ~10
- **Facturas procesadas:** 1,500+
- **Registros de nómina:** 500+
- **Pedidos logística:** 100+

---

## Roadmap Corto Plazo (Q3 2026)

### Nómina

- [ ] **Migración a PostgreSQL**
  - Unificar base de datos con resto de módulos
  - Mejor rendimiento para reportes
  - Backup unificado

- [ ] **Mejoras en aprobaciones**
  - Notificaciones push (in-app)
  - Aprobación batch desde móvil
  - Historial de cambios completo

- [ ] **Exportación SIESA mejorada**
  - Soporte para múltiples centros de operación
  - Validación previa a exportación
  - Log de exportaciones

### Proveedores

- [ ] **Flujo de aprobación mejorado**
  - Aprobación multinivel (contador → tesorero)
  - Asignación automática por categoría
  - SLA de revisión (alertas por vencimiento)

- [ ] **Dashboard mejorado**
  - Gráficas interactivas
  - Filtros avanzados
  - Exportación a Excel/PDF

- [ ] **Integración DIAN mejorada**
  - Validación de XML en tiempo real
  - Acuse automático de recibos
  - Notificación de facturas vencidas

### Logística

- [ ] **Optimización de rutas**
  - Motor VRP (Vehicle Routing Problem)
  - Asignación automática de vehículos
  - Consideración de tráfico en tiempo real

- [ ] **Seguimiento en tiempo real**
  - GPS tracking de conductores
  - ETA calculado para clientes
  - Alertas de retraso

- [ ] **App móvil para conductores**
  - Ruta del día
  - Confirmación de entrega
  - Fotos de evidencia

### Cross-Module

- [ ] **Notificaciones centralizadas**
  - In-app notifications
  - Email digest diario
  - Alertas críticas (SMS opcional)

- [ ] **Reportes consolidados**
  - Dashboard ejecutivo multi-módulo
  - Exportación a PDF/Excel
  - Programación de reportes automáticos

---

## Roadmap Mediano Plazo (Q4 2026)

### Nuevo Módulo: Inventario

- [ ] **Gestión de almacén**
  - Productos con códigos de barras
  - Movimientos de entrada/salida
  - Stock mínimo y máximo

- [ ] **Control de lotes**
  - Trazabilidad por lote
  - Fecha de vencimiento
  - Recall management

- [ ] **Integración con Proveedores**
  - Orden de compra automática
  - Recepción contra OC
  - Facturación automática

### Nuevo Módulo: CRM Básico

- [ ] **Gestión de clientes**
  - Contactos y empresas
  - Historial de interacciones
  - Segmentación

- [ ] **Oportunidades de venta**
  - Pipeline de ventas
  - Seguimiento de prospectos
  - Reportes de conversión

- [ ] **Integración con Logística**
  - Cotización automática
  - Tracking para clientes
  - Facturación por servicio

### Mejoras Transversales

- [ ] **SSO mejorado**
  - Integración con Active Directory
  - 2FA opcional
  - Sesiones concurrentes controladas

- [ ] **Auditoría avanzada**
  - Logs inmutables
  - Compliance reports
  - Retención de datos configurable

- [ ] **API pública**
  - Endpoints para integraciones externas
  - Documentación interactiva (Swagger)
  - Rate limiting por cliente

---

## Roadmap Largo Plazo (2027)

### Inteligencia de Negocios

- [ ] **Business Intelligence**
  - Dashboards personalizables
  - KPIs automáticos
  - Alertas inteligentes

- [ ] **Machine Learning**
  - Predicción de demanda (Logística)
  - Detección de anomalías (Proveedores)
  - Rotación de inventario óptima

### Escalabilidad

- [ ] **Multi-empresa**
  - Datos aislados por empresa
  - Reportes consolidados
  - Configuración por tenant

- [ ] **Alta disponibilidad**
  - Load balancing
  - Failover automático
  - Backup geográfico

### Experiencia de Usuario

- [ ] **App móvil nativa**
  - iOS y Android
  - Funcionalidad offline
  - Push notifications

- [ ] **Modo offline**
  - Sincronización automática
  - Resolución de conflictos
  - Indicador de conectividad

---

## Principios de Producto

### Priorización

1. **Estabilidad sobre novedades** — Un bug en producción afecta a todos
2. **Simplicidad sobre completitud** — Mejor una funcionalidad bien hecha que cinco a medias
3. **Adopción sobre features** — Si no lo usan, no sirve

### Criterios de Aceptación

- [ ] Funcionalidad documentada
- [ ] Tests unitarios pasando
- [ ] Testing manual completado
- [ ] Rollback probado
- [ ] Performance aceptable (<2s carga)

### Métricas de Éxito

| Métrica | Target |
|---------|--------|
| Tiempo de carga | <2 segundos |
| Disponibilidad | >99.5% |
| Errores críticos | 0/mes |
| Satisfacción usuario | >4/5 |

---

## Mantenimiento

Este roadmap se revisa mensualmente:
- **Fin de mes:** Revisión de progreso
- **Inicio de mes:** Priorización para el siguiente
- **Ad-hoc:** Ajustes por feedback de usuarios

---

*Última actualización: 08 Jul 2026*
*Próxima revisión: 01 Ago 2026*
