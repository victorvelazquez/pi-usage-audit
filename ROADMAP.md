# Hoja de ruta y avance

**Objetivo:** identificar qué agentes consumen más globalmente, por tokens y costo, para comparar modelos más económicos sin perder calidad. Proyecto, tarea y sesión son contexto secundario; no fragmentan el ranking inicial.

## En qué estamos ahora

- **Terminado:** primera base de recolector por API y SQLite, integrada en `main` mediante PR #1. Evidencia del bloque: 12 pruebas sintéticas aprobadas, verificación independiente y revisión RDD cerrada.
- **Bloque actual (1A + 1B):** implementado y verificado independientemente; entrega pendiente. No hay commit, PR ni merge de este bloque. La aprobación RDD se confirma mediante su resultado nativo y el seguimiento de la sesión.
- **Evidencia funcional:** escritor: RED observado (híbrido blue/19, falso origen propio 57/19 y CLI ausente), luego GREEN. Verificador independiente: `npm test` 18/18; cinco comprobaciones `node --check`, 20 invocaciones CLI sintéticas y tres barreras de escritura independiente aprobadas. LSP: cinco archivos, cero errores. Los criterios tienen evidencia de implementación/pruebas o documentación; no se usaron datos reales.
- **Límite de diseño:** una importación limpia o timestamps no prueban origen propio de IDs hijos desconocidos. Su consumo observado incierto se expone separado del ranking confirmado y no aditivo.
- **Siguiente:** cerrar revisión RDD y entrega de este bloque: autorización de commit/PR, confirmación humana de merge y actualización de la rama base. Sólo después iniciar bloque 2, salvo cambio de secuencia autorizado. No ampliar automáticamente fuentes ni prometer deduplicación completa.
- **No iniciado:** dashboard, precios manuales y captura en vivo. No se han recolectado sesiones reales.

## Lista completa del MVP

| Bloque | Estado | Resultado esperado |
| --- | --- | --- |
| 0. Base contable local | Completado, cobertura inicial | SQLite durable, ingesta por API, deduplicación, atribución básica y pruebas sintéticas |
| 1. Importación utilizable | Verificado, entrega pendiente | CLI de archivos explícitos y consultas consistentes durante importaciones concurrentes |
| 2. Cobertura y atribución | Parcial, por completar | Orquestador, subagentes, auxiliares y consumo desconocido visibles, con evidencia y huecos declarados |
| 3. Precios manuales | Pendiente | Tarifas por proveedor/modelo/categoría, moneda y vigencia, sin reescribir costos históricos |
| 4. Análisis global | Parcial: ranking básico por API | Ranking por agente/modelo, evolución, ejecuciones y costos con cobertura explícita |
| 5. Contexto y filtros | Parcial: metadatos básicos | Proyecto estable entre worktrees, funcionalidad por tarea, sesión y relaciones padre/hijo |
| 6. Dashboard localhost | Pospuesto; requiere habilitación posterior | Vista global primero, filtros y detalle después; formulario manual de precios |

## Bloque actual: tareas y criterios de cierre

### 1A. Consistencia contable

- [x] Identificar lecturas que pueden mezclar generaciones durante escrituras concurrentes.
- [x] Identificar que una importación limpia no prueba que la historia parental esté cerrada.
- [x] Añadir regresión determinista de ranking y atribución durante una escritura de otro proceso.
- [x] Garantizar una lectura coherente de consumo y atribución.
- [x] Añadir regresión de historia parental que crece, incluyendo reinicio e importación tardía.
- [x] Resolver o exponer la incertidumbre sin inventar gasto ni ocultar hijos legítimos como si su consumo fuera cero.

**Cierre:** regresiones RED/GREEN, verificaciones independientes y cobertura explícita. Son mejoras nuevas; no reabren la revisión aprobada del bloque 0.

### 1B. CLI explícita

- [x] Importar únicamente rutas indicadas por el usuario, con sesiones y tareas repetibles.
- [x] Permitir seleccionar base; conservar almacenamiento fuera del repositorio por defecto.
- [x] Mostrar reporte de importación, ranking y cobertura, sin volcar contenido ni rutas privadas en errores.
- [x] Hacer que ayuda, ausencia de argumentos y argumentos inválidos no creen una base ni escaneen directorios.
- [x] Probar reimportación, reinicio, atribución tardía, errores y privacidad con fixtures sintéticos.
- [x] Documentar un recorrido mínimo reproducible.

**Cierre:** CLI ejecutable comprobada de extremo a extremo, pruebas aprobadas y documentación concordante. No hay captura automática implícita.

## Trabajo posterior por bloque

- **Cobertura:** ampliar evidencia de fuentes y operaciones; conservar correlaciones antes de la poda de tareas; validar continuaciones y clones multinivel. Captura en vivo o nuevas fuentes sólo con selección explícita y autorización. Desconocido/incompleto nunca significa cero.
- **Precios:** conservar versión o tarifa aplicada; distinguir estimación del runtime, estimación manual y factura/suscripción. Precio faltante no es costo cero; no mezclar monedas sin una política explícita.
- **Análisis:** consumo propio como ranking global; total del árbol como métrica separada. Contar ejecuciones y resultados sólo cuando exista evidencia; no inferir éxito ni ahorro por tokens solamente.
- **Contexto:** identidad estable de repositorio/worktrees y funcionalidad por tarea, heredable a hijos; fallback "Sin clasificar". Contexto secundario, no sustituto del ranking global.
- **Dashboard:** localhost, ranking por tokens/costo, evolución y detalle; precios editados manualmente. No empezar hasta habilitación posterior del usuario.

## Cómo acompañar el avance

Este archivo es la referencia del estado del proyecto; la lista de tareas de la sesión refleja el bloque activo.

Al empezar o cerrar un bloque se actualizarán:

1. **Trabajando en:** tarea concreta y estado real (preparación, implementación o verificación).
2. **Terminado:** comportamiento entregado y evidencia exacta, no sólo archivos creados.
3. **Falta o bloquea:** pendientes, decisiones y límites de cobertura.
4. **Siguiente:** próximo resultado útil para el objetivo global.

Cada bloque mantiene sus pruebas y documentación. Se estima el tamaño antes de editar; si supera el presupuesto de revisión, se acuerda una división o excepción sin comprimir código ni quitar pruebas.

## Límites permanentes

- No persistir prompts, código, respuestas, argumentos de herramientas ni credenciales por defecto.
- No publicar datos locales; fixtures sintéticos únicamente en el repositorio.
- No cambiar modelos automáticamente: el MVP observa y permite comparar.
- No presentar el consumo observado como facturación completa.
- Commit, push, PR y merge requieren su autorización correspondiente; terminar un bloque no autoriza publicación.
