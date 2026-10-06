# Hoja de ruta y avance

**Objetivo:** identificar qué agentes consumen más globalmente, por tokens y costo, para comparar modelos más económicos sin perder calidad. Proyecto, tarea y sesión son contexto secundario; no fragmentan el ranking inicial.

## En qué estamos ahora

- **Terminado:** primera base de recolector por API y SQLite, integrada en `main` mediante PR #1. Evidencia del bloque: 12 pruebas sintéticas aprobadas, verificación independiente y revisión RDD cerrada.
- **Entregado (1A + 1B):** PR #2 integrado en `main`, comprobado en el historial tras actualizar la base: `9f4745c`, commit del bloque `a100962`. Se conserva la evidencia previa; no se reabre esa revisión.
- **Entregado (2, unidad acotada):** `accounting().breakdown`, integrado mediante PR #3: merge `76f8931`, commit `7d5fff5`. Revisión RDD `review-8bb3c81ff0de5489`, target `f817b475`, aprobada; ack consumido antes del commit, sin correcciones.
- **Entregado (3, catálogo):** PR #4 integrado en `main`, merge `a55c043`, commit `52a08854bba352c8e626298601dd4152b6e8d583`. Revisión `45f20b992971afaf`, target `300bd64a137b4a3977b6ebbc99ef3f483288750fd1f298d33ef84d1a51a99a9f`, aprobada; ack consumido antes del commit, sin correcciones.
- **Entregado (3, cotización):** PR #5 integrado en `main` `b3fd9c5`, commit `f473cb7`. Revisión nativa `review-57f9a0860f6d2e68`, target `248ee402ea11afe31272797035701ec934ac063afb4a8e2adb5dcc517a1d9636`, aprobada y reconocida, sin correcciones.
- **Entregado (3, estimaciones explícitas):** PR #6, main `68a85dc`, commit `1a05948`. Revisión nativa `975d244bc17353a7`, target `2afff9cf9de427a49799b379a679ff3a91c3427309d245498897614022e191ef`, aprobada con ack, sin correcciones.
- **Bloque actual (3):** cotización de entrada importada de sólo lectura; comprobaciones del escritor y del padre completas, revisión nativa pendiente.
- **Evidencia histórica del bloque 1:** escritor: RED observado (híbrido blue/19, falso origen propio 57/19 y CLI ausente), luego GREEN. Verificador independiente: `npm test` 18/18; cinco comprobaciones `node --check`, 20 invocaciones CLI sintéticas y tres barreras de escritura independiente aprobadas. LSP: cinco archivos, cero errores. Los criterios tienen evidencia de implementación/pruebas o documentación; no se usaron datos reales.
- **Límite de diseño:** una importación limpia o timestamps no prueban origen propio de IDs hijos desconocidos. Su consumo observado incierto se expone separado del ranking confirmado y no aditivo.
- **Siguiente:** revisión nativa de cotización importada antes de autorizar entrega. No ampliar fuentes ni prometer roles o deduplicación completa.
- **No iniciado:** dashboard y captura en vivo. No se han recolectado sesiones reales.

## Lista completa del MVP

| Bloque | Estado | Resultado esperado |
| --- | --- | --- |
| 0. Base contable local | Completado, cobertura inicial | SQLite durable, ingesta por API, deduplicación, atribución básica y pruebas sintéticas |
| 1. Importación utilizable | Entregado en PR #2 | CLI de archivos explícitos y consultas consistentes durante importaciones concurrentes |
| 2. Cobertura y atribución | Parcial, por completar | Orquestador, subagentes, auxiliares y consumo desconocido visibles, con evidencia y huecos declarados |
| 3. Precios manuales | Catálogo, cotizaciones y estimaciones explícitas entregados; cotización importada en verificación | Tarifas por proveedor/modelo/categoría, moneda y vigencia, sin reescribir costos históricos |
| 4. Análisis global | Parcial: ranking básico por API | Ranking por agente/modelo, evolución, ejecuciones y costos con cobertura explícita |
| 5. Contexto y filtros | Parcial: metadatos básicos | Proyecto estable entre worktrees, funcionalidad por tarea, sesión y relaciones padre/hijo |
| 6. Dashboard localhost | Pospuesto; requiere habilitación posterior | Vista global primero, filtros y detalle después; formulario manual de precios |

## Bloque actual: 3 — cotización importada de sólo lectura

- [x] Tres claves exactas, par session/entry literal y moneda explícita; rechazo antes de SQL.
- [x] Clasificación dinámica y tarifas en el mismo snapshot diferido; sólo own con identidad/fecha/contadores válidos.
- [x] Respuesta separa observación, elegibilidad y quote; incertidumbre sin precio, tarifas ausentes no niegan ownership.
- [x] Escritor: RED 0/4 por API ausente; GREEN 4/4 `node --test --test-name-pattern=imported test/audit.test.js`.
- [x] Casos alternos: metadatos inválidos, clases no propias, linaje tardío, conflicto posterior, commit WAL independiente, errores/rollback, mutación/reinicio y tarifas retrospectivas.
- [x] Escritor final: `npm test` 35/35; `node --check src/ledger.js`, `node --check test/audit.test.js` y `git diff --check` aprobados. Diff final manualmente formateado: 389 líneas (381 adiciones + 8 eliminaciones).
- [x] Padre tras autoformato: `npm test` 35/35, dos comprobaciones de sintaxis y LSP sin errores; diff 396 líneas antes del cierre documental. Evaluación nativa: riesgo medio/escritor grande, sin verificador separado exigido. El padre no observó RED.
- [ ] Revisión nativa y entrega pendientes.

**Límites:** máximo 400 líneas formateadas totales; sólo los cuatro archivos autorizados. Sin estimaciones importadas durables, CLI, fuentes nuevas, datos reales ni cambios de ranking/runtime. Rollback sólo de esta unidad, sin borrar bases. Evidencia anterior es histórica, no aprobación de este bloque.

## Bloque 3 entregado — estimaciones manuales explícitas persistidas

- [x] API estricta de seis claves y consulta por ID; validación antes de SQL, sin metadatos libres.
- [x] Request canónico de cuatro contadores; null/omisión equivalentes, cero distinto; mismo ID conserva snapshot sin consultar tarifas, conflicto sin escrituras.
- [x] Tabla aditiva y `BEGIN IMMEDIATE`; reutilizar cotización exacta, procedencias explícitas y tarifas copiadas, incluso cobertura incompleta.
- [x] Escritor: `node --test --test-name-pattern=manual test/audit.test.js`: RED cinco fallos por API ausente; GREEN 9/9. `npm test`: 31/31; `node --check src/ledger.js` y `node --check test/audit.test.js`: aprobados. Regresiones de reinicio, copias mutables, tarifas retrospectivas, límites exactos, rollback y esquema legado.
- [x] Arbitraje probado entre handles independientes secuenciales; no se afirma carrera simultánea entre procesos para estimaciones.
- [x] Padre tras autoformato: `npm test` 31/31, dos comprobaciones de sintaxis y LSP sin errores. Evaluación nativa: riesgo medio, escritor grande; no exige verificador separado. El padre no observó el RED histórico.
- [x] Revisión nativa aprobada con ack y entrega mediante PR #6; identidades registradas arriba. Evidencia anterior histórica.

**Presupuesto:** previsión 305–370; medición del padre tras autoformato 356 líneas antes del cierre documental. Techo 400 líneas formateadas totales (adiciones + eliminaciones), incluidas pruebas/docs. Sin CLI, fuentes nuevas, datos reales, integración de entradas ni cambios de ranking/runtime. Rollback sólo en los cuatro archivos autorizados, sin borrar bases. Reestimar requiere ID nuevo; `at` sigue siendo vigencia, no conocimiento histórico.

## Bloque 3 entregado — cotización manual de sólo lectura

- [x] Validar cinco claves explícitas, fecha UTC y sólo cuatro contadores seguros; rechazos antes de SQL.
- [x] Seleccionar versiones inclusivas por categoría en un SELECT y calcular importes exactos con BigInt.
- [x] Distinguir desconocido de cero; total sólo con cobertura completa, tarifas copiadas en la respuesta.
- [x] Probar límites, versiones futuras/retrospectivas, reinicio, mutación de respuesta y ausencia de escrituras/cambios contables.
- [x] Escritor: RED observado en tres pruebas nuevas por API ausente (y regresión histórica ampliada); GREEN 6/6 `manual`, `npm test` 28/28 y dos comprobaciones de sintaxis aprobadas.
- [x] Verificador independiente: 28/28 pruebas y 6/6 `manual`, dos comprobaciones de sintaxis y LSP sin errores, hashes estables; probes API con 103 entradas inválidas rechazadas antes de SQL y coherencia con escritor independiente. No observó el RED histórico.
- [x] Revisión nativa aprobada y entrega mediante PR #5; identidades registradas arriba. La evidencia de pruebas siguiente es histórica, no aprobación de la unidad nueva.

**Presupuesto histórico de cotización:** objetivo 250–295 líneas formateadas; medición independiente tras autoformato: 393 líneas antes del cierre documental (adiciones + eliminaciones). Se conserva el techo 400; la excepción de 450 del catálogo no se traslada a esta unidad.

**Alcance:** sólo contadores del llamador; ninguna cotización ni estimación persistida, integración de costos/ranking, conversión, CLI o datos reales. `at` es vigencia de tarifa, no conocimiento histórico: una adición retrospectiva puede cambiar una cotización nueva. La respuesta anterior conserva su tarifa copiada, sin garantía durable. Aplicación futura: nuevo registro inmutable con procedencia, nunca sobrescritura. Rollback: sólo cambios de esta unidad en los cuatro archivos permitidos, sin borrar bases.

## Bloque 3 entregado — catálogo manual, no estimaciones

- [x] Añadir `addManualPrice` y `manualPrices`, con claves explícitas y errores genéricos.
- [x] Validar identidades literales, categorías cobrables, moneda explícita, fechas UTC reales y decimales de texto; cero no equivale a ausencia.
- [x] Conservar versiones por categoría/fecha/moneda; duplicados canónicos idempotentes y conflictos inmutables, también entre dos handles.
- [x] Probar persistencia, límites y rechazos sin cambios de almacenamiento; esquema anterior sintético conserva entradas/imports.
- [x] Probar precios retrospectivos sin alterar entradas, ranking, accounting, coverage ni runtime-estimate.
- [x] Verificación funcional independiente: 25/25 pruebas y 3/3 enfocadas, dos comprobaciones de sintaxis y LSP sin errores; probe API con 138 entradas inválidas rechazadas sin cambios del catálogo.
- [x] Revisión aprobada y entregado mediante PR #4; identidades registradas arriba.

**Presupuesto histórico del catálogo:** excepción explícita del usuario de hasta 450 líneas para esa unidad; el autoformato amplió el diff inicial a 411, antes del cierre documental. No se recortaron pruebas ni se comprimió código.

**Evidencia propia:** `node --test --test-name-pattern=manual test/audit.test.js`: RED 0/3, tres fallos por APIs ausentes; GREEN 3/3 tras implementación. Prueba funcional directa de API, sin CLI ni datos reales. Escritor: `npm test` 25/25; `node --check src/ledger.js` y `node --check test/audit.test.js` aprobados. El verificador independiente observó GREEN tras el autoformato, con hashes estables; no presenció el RED histórico. La verificación funcional no constituye aprobación de revisión nativa.

**Alcance:** tabla aditiva en la transacción de inicialización, sin migración de versión ni conexiones nuevas. Vigencia inclusiva/límite por versión posterior sólo define aplicación futura: sin selección automática, estimaciones manuales, conversión o reescritura. API append-only no protege frente al SQL arbitrario de `ledger.db`. Rollback limitado a cuatro archivos, sin borrar bases.

## Bloque 2 entregado — evidencia de metadatos, no roles

- [x] Añadir desglose de todas las certezas persistidas, sin cambiar ranking, atribución ni campos contables anteriores.
- [x] Separar `no-task`, `missing-agent`, `conflicting-agents` y `task-consensus`; conflicto precede a ausencia parcial.
- [x] Exponer conteos, categorías observadas y faltantes; `additive: false`, categorías totalmente ausentes null y subconjuntos sin doble suma.
- [x] Probar operaciones auxiliares, continuaciones sin fanout, importación tardía, reinicio/idempotencia y clones explícitos de tres niveles.
- [x] Probar snapshot contable durante commit independiente y recuperación tras excepción; salida CLI sin contenido sensible sintético.
- [x] Verificación funcional independiente: 22/22 pruebas, 23 invocaciones CLI sintéticas, tres comprobaciones de sintaxis y hashes estables. LSP: tres archivos sin errores.
- [x] Revisión RDD aprobada: `review-8bb3c81ff0de5489`, target `f817b475`; ack consumido antes del commit, sin correcciones.
- [x] Entregado mediante PR #3: commit `7d5fff5`, merge `76f8931`.

La evidencia 22/22 de este apartado es histórica y exclusiva del bloque 2; la cobertura general sigue parcial, sin roles confiables.

**Alcance:** sólo metadatos ya importados. No prueba roles ni origen hijo; tareas eliminadas no se reconstruyen. Cada lectura API es coherente, no todos los campos CLI juntos. Sin costos nuevos, fuentes nuevas, captura, precios, UI o migraciones.

**Evidencia propia:** RED observado: cuatro pruebas `accounting` fallaron por ausencia de `breakdown`; GREEN inicial 4/4. Verificación final: `node --test --test-name-pattern=accounting test/audit.test.js` 5/5, `node --test test/cli.test.js` 4/4 y `npm test` 22/22; `node --check` aprobado para ledger y ambos archivos de pruebas. Sólo fixtures sintéticos; escritor existente sin cambios. El verificador independiente repitió GREEN; no observó el RED histórico. Las pruebas funcionales no constituyen un veredicto de revisión nativa.

## Bloque 1 entregado: criterios conservados

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

- **Cobertura:** ampliar evidencia de fuentes y operaciones; conservar correlaciones antes de la poda de tareas; ampliar la validación de continuaciones y clones multinivel más allá de los casos sintéticos de esta unidad. Captura en vivo o nuevas fuentes sólo con selección explícita y autorización. Desconocido/incompleto nunca significa cero.
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
