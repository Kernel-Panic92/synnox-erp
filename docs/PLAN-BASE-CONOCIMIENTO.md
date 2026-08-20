# Plan de Base de Conocimiento SynnoxERP

## Referencia

- Epic: [#119](https://github.com/Kernel-Panic92/synnox-erp/issues/119)
- Issues: #120, #121, #122, #123, #124, #125 y #126
- Estado: preparado para ejecucion por bloques
- Alcance: Launcher + Nomina + Proveedores + Logistica + Proyectos

## Objetivo

Construir una base de conocimiento central, versionable y administrable para
SynnoxERP. El contenido debe combinar texto, pasos, capturas, videos,
subtitulos y transcripciones, con visibilidad segun modulo, rol y estado de
publicacion.

La primera implementacion funcional debe usar Nomina como piloto sin bloquear
la operacion de los modulos existentes.

## Principios

- La base de conocimiento pertenece al Launcher, no a un modulo operativo.
- El contenido publicado es de solo lectura para usuarios finales.
- El contenido se versiona y conserva historial de publicaciones.
- Los videos se almacenan fuera de la base de datos.
- No se capturan datos reales, secretos ni credenciales.
- Los manuales describen capacidades vigentes, no codigo interno.
- Toda publicacion administrativa queda auditada.
- El contenido se identifica por modulo, rol y version de producto.

## Dependencias

```text
#126 Estandar documental
  |
  +--> #120 Auditoria de Nomina
  |      |
  |      +--> #122 Auditoria de los demas modulos
  |
  +--> #121 Modelo de datos y API
         |
         +--> #125 Consulta publica
         |      |
         |      +--> #124 Videos, subtitulos y transcripciones
         |
         +--> #123 Editor administrativo
```

La auditoria documental (#120 y #122) puede avanzar en paralelo con el diseño
tecnico (#121), pero la implementacion del editor y multimedia debe esperar el
contrato base de articulos y recursos.

## Fases

### Fase 0: Preparacion

Issues: #119, #126

Entregables:

- Convencion de nombres para articulos, capturas y videos.
- Plantilla de articulo.
- Matriz modulo/rol/tema.
- Checklist de revision.
- Politica de datos ficticios y multimedia.
- Definicion de contenido minimo para publicar.

Definition of Done:

- Un agente puede crear un articulo de prueba siguiendo la guia.
- La guia define cuando usar texto, captura, video o transcripcion.
- PO valida el estandar antes de iniciar el desarrollo tecnico.

### Fase 1: Auditoria y piloto documental

Issues: #120, #122

Orden:

1. Auditar Nomina.
2. Actualizar manuales y capturas de Nomina.
3. Auditar Proveedores, Logistica y Proyectos.
4. Crear issues secundarios por modulo si aparecen bloques grandes.

Entregables:

- Inventario de pantallas y flujos actuales.
- Clasificacion conservar/actualizar/retirar.
- Lista de capturas faltantes.
- Manuales piloto revisados.
- Registro de funcionalidades que requieren confirmacion del PO.

Definition of Done:

- Cada modulo tiene una matriz de documentacion.
- No se documentan funciones eliminadas.
- Las capturas usan datos ficticios y una ubicacion canonica.
- Los manuales cargan para cada rol disponible.

### Fase 2: Modelo y contrato tecnico

Issue: #121

Entidades iniciales:

- `knowledge_articles`
- `knowledge_article_versions`
- `knowledge_modules`
- `knowledge_categories`
- `knowledge_tags`
- `knowledge_resources`
- `knowledge_article_roles`
- `knowledge_publications`
- `knowledge_audit_log`

El nombre final debe validarse contra las convenciones del Launcher y la base
de datos central antes de crear migraciones.

El contrato debe cubrir:

- CRUD administrativo de borradores.
- Publicacion, despublicacion y archivado.
- Consulta de contenido publicado.
- Filtros por modulo, rol, categoria y version.
- Recursos de imagen, video, subtitulos y archivos.
- Paginacion y busqueda.
- Auditoria.

Definition of Done:

- Migracion revisada y reversible.
- API documentada con ejemplos de respuesta.
- Middleware de autenticacion y permisos definido.
- Pruebas de validacion, publicacion y acceso por rol.

### Fase 3: Consulta para usuarios

Issue: #125

Entregables:

- Ruta central de ayuda en el Launcher.
- Indice por modulo y categoria.
- Busqueda y filtros.
- Vista de articulo con pasos y recursos.
- Vista responsive.
- Estados loading, vacio, error y contenido no publicado.
- Enlaces contextuales desde los modulos.

Definition of Done:

- Un usuario solo ve contenido publicado que corresponde a su acceso.
- Un articulo puede abrirse desde un modulo y volver al contexto anterior.
- Se muestran version y fecha de actualizacion.
- Se validan teclado, movil y CSP.

### Fase 4: Editor administrativo

Issue: #123

Entregables:

- Lista de borradores y publicados.
- Editor Markdown o enriquecido seguro.
- Seleccion de modulo, rol, categoria y etiquetas.
- Insercion y ordenamiento de pasos.
- Carga de capturas y recursos.
- Vista previa como usuario final.
- Flujo publicar/archivar.
- Historial y restauracion de versiones.

Definition of Done:

- Solo usuarios autorizados acceden al editor.
- No se permite HTML/JS peligroso sin sanitizacion.
- Cada cambio de estado genera auditoria.
- Una version anterior puede restaurarse sin perder historial.

### Fase 5: Videos y tutoriales

Issue: #124

Orden recomendado:

1. Reproductor para URL externa.
2. Reproductor para archivo interno autenticado.
3. Miniaturas.
4. Subtitulos WebVTT.
5. Transcripcion visible y buscable.
6. Limites, retencion y limpieza administrativa.

Requisitos:

- MP4/H.264 como formato inicial.
- Soporte HTTP Range.
- Archivos fuera de carpetas publicas.
- Validacion de MIME, extension, tamano y permisos.
- Registro de subida, reemplazo y eliminacion.
- Fallback de transcripcion si el video no carga.

Definition of Done:

- Un articulo muestra texto, capturas y video en escritorio y movil.
- Los subtitulos se activan correctamente.
- El contenido multimedia respeta permisos.
- Se documenta el limite de almacenamiento y la retencion.

## Trabajo por agentes

### Agente de auditoria documental

Investiga un modulo sin modificar codigo funcional. Entrega matriz de pantallas,
roles, capturas existentes, faltantes y referencias obsoletas.

### Agente de contenido

Actualiza manuales y capturas de un modulo. No inventa permisos ni flujos;
verifica cada afirmacion contra la interfaz y backend.

### Agente de arquitectura

Disena migraciones, API, permisos, almacenamiento y auditoria de la base de
conocimiento. No implementa el editor hasta contar con contrato aprobado.

### Agente frontend

Implementa consulta o editor usando los patrones existentes del Launcher,
responsive, CSP, estados de carga y permisos.

### Agente de verificacion

Revisa enlaces, XSS, permisos, CSP, multimedia, accesibilidad, migraciones,
`git diff --check` y pruebas automatizadas.

## Plantilla de trabajo para cada agente

```text
Issue: #XXX
Objetivo: [resultado verificable]
Archivos a revisar: [lista]
No modificar: [areas fuera de alcance]
Entregables: [codigo, docs, pruebas]
Criterios de aceptacion: [lista]
Verificacion: [comandos y prueba manual]
Reporte final: hallazgos, archivos, pruebas y pendientes
```

## Estrategia de ramas

- Crear ramas desde `dev`.
- Documentacion: `docs/kb-nomina` o `docs/kb-estandar`.
- Backend: `feat/knowledge-base-api`.
- Consulta: `feat/knowledge-base-ui`.
- Editor: `feat/knowledge-base-admin`.
- Multimedia: `feat/knowledge-base-video`.
- Un PR por fase o bloque estable.
- No hacer merge, deploy ni cerrar issues sin validacion del PO.

## Definition of Done global

- Criterios del issue cumplidos.
- Pruebas automatizadas o verificacion manual documentada.
- Sin errores de sintaxis ni `git diff --check`.
- Permisos y auditoria revisados.
- CSP y sanitizacion revisadas.
- Documentacion actualizada.
- PR contra `dev` revisado.
- Issue comentado con resultado y pendientes concretos.

## Primer bloque recomendado

Empezar por #126 y #120 en paralelo:

1. #126 define el formato comun.
2. #120 produce el primer contenido real con Nomina.
3. Con ambos resultados se valida el modelo de #121.

No iniciar aun el editor ni la carga de videos. Primero hay que validar el
flujo de contenido, permisos, versionado y publicacion con articulos simples.
