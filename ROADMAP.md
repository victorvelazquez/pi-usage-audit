# Avance del proyecto

**Queremos lograr:** abrir una aplicación local y ver qué agentes y modelos consumen más tokens y costo estimado, para decidir qué modelos conviene comparar. No cambiaremos modelos automáticamente ni inferiremos calidad sólo por consumo.

## Dónde estamos hoy

**Motor, dashboard y guardado opt-in entregados; formulario candidato, sin sesiones reales.**

- **Última tarea terminada:** opt-in CLI/API y persistencia HTTP, PR #27 integrada; base `main` `64c81bb`.
- **En curso:** formulario manual implementado; candidato pendiente de verificación, revisión y entrega por el padre.
- **Siguiente propuesta:** acordar contexto/filtros o validación real seleccionada; propuesta, no autorización.
- **Decisiones pendientes:** autorización de sesiones reales y pasos posteriores; esta unidad no los autoriza.

## Qué ya podés hacer

| Listo | Resultado | Cómo se usa hoy |
| --- | --- | --- |
| ✅ Guardar e importar consumo | Datos locales durables, sin duplicar reimportaciones | CLI y API |
| ✅ Ver consumo por agente | Ranking global de consumo propio confirmado y exclusiones visibles | CLI y API |
| ✅ Ver tokens por modelo | Totales globales por proveedor/modelo | Sólo API |
| ✅ Registrar precios y estimaciones | Tarifas versionadas y estimaciones históricas; suma de selecciones explícitas | Sólo API |

**API** significa usar funciones desde código. **CLI** significa usar comandos de terminal. Tener la API no significa que ya exista una pantalla para usarla.

## Qué falta para terminar

Esta lista describe resultados del producto, no cantidad de PRs. El orden siguiente es una propuesta; no cambia el alcance acordado ni autoriza trabajo pendiente.

| Pendiente | Qué vas a poder hacer cuando esté listo | Estado |
| --- | --- | --- |
| Costos comparativos | Consultar estimaciones conjuntas agente/proveedor/modelo con tarifas y moneda explícitas | Entregado en PR #16; runtime entregado en PR #15 |
| Dashboard local y precios | Abrir una pantalla con ranking, evolución, detalle y formulario de tarifas | Demo PR #17, API readonly PR #18 y UI seleccionada PR #19 entregados; evolución API PR #20/UI PR #21 entregadas; detalle PR #22 entregado; guardado atómico PR #23 entregado; apertura RW PR #24 entregada; admisión HTTP interna PR #25 y semántica PR #26 entregadas; opt-in/guardado PR #27 entregados; formulario candidato pendiente de verificación/revisión/entrega |
| Contexto y filtros | Filtrar por proyecto, tarea y sesión; agrupar worktrees del mismo repositorio | Metadatos básicos; falta completar |
| Cobertura y validación real | Comprobar el recorrido con sesiones seleccionadas y mejorar identificación de agentes/hijos | Pruebas sintéticas existentes; validación real pendiente |
| Captura continua | Incorporar consumo nuevo sin importar cada archivo manualmente | No iniciada; requiere autorización |

**Criterio de cierre propuesto:** poder importar sesiones seleccionadas, abrir la vista global, identificar quién consume más, consultar costos estimados con tarifas explícitas y reconocer datos faltantes. Debemos acordar si filtros avanzados y captura continua son obligatorios para la primera versión o posteriores; hoy no están retirados del alcance.

## Cómo seguir el avance

Leé sólo las secciones anteriores para conocer el estado. Al empezar y terminar cada tarea actualizaremos **última terminada**, **en curso**, **siguiente** y la tabla de pendientes. Una tarea se marca lista cuando está entregada, no sólo cuando se escribió código. No usamos un porcentaje: backend terminado no equivale a producto terminado.

El historial de pruebas y revisiones se conserva abajo, separado del seguimiento diario.

---

## Historial técnico y evidencia (lectura opcional)

Las secciones siguientes conservan las pruebas y decisiones de cada entrega. No necesitás leerlas para seguir el avance diario.

### Entregas técnicas

- **Terminado:** primera base de recolector por API y SQLite, integrada en `main` mediante PR #1. Evidencia del bloque: 12 pruebas sintéticas aprobadas, verificación independiente y revisión RDD cerrada.
- **Entregado (1A + 1B):** PR #2 integrado en `main`, comprobado en el historial tras actualizar la base: `9f4745c`, commit del bloque `a100962`. Se conserva la evidencia previa; no se reabre esa revisión.
- **Entregado (2, unidad acotada):** `accounting().breakdown`, integrado mediante PR #3: merge `76f8931`, commit `7d5fff5`. Revisión RDD `review-8bb3c81ff0de5489`, target `f817b475`, aprobada; ack consumido antes del commit, sin correcciones.
- **Entregado (3, catálogo):** PR #4 integrado en `main`, merge `a55c043`, commit `52a08854bba352c8e626298601dd4152b6e8d583`. Revisión `45f20b992971afaf`, target `300bd64a137b4a3977b6ebbc99ef3f483288750fd1f298d33ef84d1a51a99a9f`, aprobada; ack consumido antes del commit, sin correcciones.
- **Entregado (3, cotización):** PR #5 integrado en `main` `b3fd9c5`, commit `f473cb7`. Revisión nativa `review-57f9a0860f6d2e68`, target `248ee402ea11afe31272797035701ec934ac063afb4a8e2adb5dcc517a1d9636`, aprobada y reconocida, sin correcciones.
- **Entregado (3, estimaciones explícitas):** PR #6, main `68a85dc`, commit `1a05948`. Revisión nativa `975d244bc17353a7`, target `2afff9cf9de427a49799b379a679ff3a91c3427309d245498897614022e191ef`, aprobada con ack, sin correcciones.
- **Entregado (3, cotización importada):** PR #7, main `23ab4bc`, commit `8cdcbe9`. Revisión nativa `review-e61564f8d238322b`, target `c9a732ae2df2e3a287bf346f3edc5b029acf54d7e89639a608ebb7057e1006d4`, aprobada con ack, sin correcciones; evidencia histórica.
- **Entregado (3, colector):** PR #8 integrado, main `35ef3e4`; extracción `ced9521` y política LF `dae15e9` conservadas.
- **Entregado (3, persistencia importada):** PR #9, main `8e2c823`, commit `7ad2dbed8c89f23f563cfa3d15376aaf1e996301`; evidencia histórica abajo.
- **Entregado (3, enumeración):** PR #10, main `8dcc385`, commit `5a617299619e`; revisión `review-7802c286f859ac36` aprobada con ack, sin correcciones; autoridad consumida. Target histórico `f57c418063f337c1c9c6ae0dc6b33e5bca0cc610f0c699753257f2512bd344f4`.
- **Entregado (3, lector validado):** PR #11, main `4213aa4`, commit `b68a20c1621f`; evidencia histórica abajo.
- **Entregado (3, resumen seleccionado):** PR #12, main `4f5af9d`, commit `14c4587f5fb9f9057d2b9059f7d3102b068fedaf`; evidencia histórica abajo.
- **Entregado (4, tokens por modelo):** `modelUsage({})`, PR #13 integrado en `main` mediante `dd4ee3f`, commit `ec9c0dc`. Revisión `review-4173b82ce0c1c96b` aprobada y reconocida; autoridad consumida.
- **Evidencia histórica del bloque 1:** escritor: RED observado (híbrido blue/19, falso origen propio 57/19 y CLI ausente), luego GREEN. Verificador independiente: `npm test` 18/18; cinco comprobaciones `node --check`, 20 invocaciones CLI sintéticas y tres barreras de escritura independiente aprobadas. LSP: cinco archivos, cero errores. Los criterios tienen evidencia de implementación/pruebas o documentación; no se usaron datos reales.
- **Límite de diseño:** una importación limpia o timestamps no prueban origen propio de IDs hijos desconocidos. Su consumo observado incierto se expone separado del ranking confirmado y no aditivo.
- **Revisión cerrada del bloque 4:** captura nativa y reconocimiento completados; sin correcciones. Entrega realizada mediante PR #13. Esto no autoriza publicar unidades futuras.
- **Entregado:** demo PR #17 (`8873088`), API readonly A PR #18 (`7d924e4`) y UI seleccionada B PR #19 (`f8c87b2`). Captura en vivo no iniciada; sin sesiones reales.

## Lista completa del MVP

| Bloque | Estado | Resultado esperado |
| --- | --- | --- |
| 0. Base contable local | Completado, cobertura inicial | SQLite durable, ingesta por API, deduplicación, atribución básica y pruebas sintéticas |
| 1. Importación utilizable | Entregado en PR #2 | CLI de archivos explícitos y consultas consistentes durante importaciones concurrentes |
| 2. Cobertura y atribución | Parcial, por completar | Orquestador, subagentes, auxiliares y consumo desconocido visibles, con evidencia y huecos declarados |
| 3. Precios manuales | Catálogo, cotizaciones, estimaciones, colector, enumeración, lector y resumen seleccionado entregados | Tarifas por proveedor/modelo/categoría, moneda y vigencia, sin reescribir costos históricos |
| 4. Análisis global | Parcial: tokens/runtime/costos/evolución API/UI y detalle PR #22 entregados | Ranking por agente/modelo, evolución, ejecuciones y costos con cobertura explícita |
| 5. Contexto y filtros | Parcial: metadatos básicos | Proyecto estable entre worktrees, funcionalidad por tarea, sesión y relaciones padre/hijo |
| 6. Dashboard localhost | Demo, API readonly, UI seleccionada, evolución, detalle y semántica PR #26 y opt-in/guardado PR #27 entregados; formulario candidato | Vista global primero, filtros y detalle después; formulario manual de precios |

## Admisión HTTP y cuerpo limitado — entregada PR #25 (inactiva)

Integrada en `main` `799cf42`; revisión nativa aprobada y reconocida antes de la entrega. La evidencia siguiente conserva el estado histórico de implementación.

- [x] Helper interno sin almacenamiento ni cambios a rutas GET-only; Host/Origin exactos obligatorios, duplicados rechazados, Fetch-site sólo same-origin, POST/ruta/JSON estrictos.
- [x] 8192 bytes declarados/reales, UTF-8 fatal, JSON estricto, plazo absoluto 5s y cleanup en éxito/rechazo/abort/error/close/timeout. Devuelve JSON no confiable: validar antes de cualquier RW futuro.
- [x] Pruebas sintéticas y harness loopback chunked; regresión demo/readonly 405 sin guardar. No sesiones reales ni revisión nativa afirmada.
- [x] Validación semántica de seis campos/canonicalización entregada después en PR #26.
- [x] Opt-in CLI/API y persistencia HTTP entregados en PR #27; formulario candidato separado, hasta 400 líneas por unidad.
- RED histórico: patrón `price HTTP`, 0/1 por helper ausente. Nuevo RED: rechazo de JSON válido no semántico (1 pasa/4 fallan; harness agotó 60s). GREEN actual 5/5: JSON no confiable intacto, admisión, parsing, lifecycle y loopback; sin pruebas semánticas.
- Verificación: `node --test test/dashboard.test.js` 17/17; `npm test` 91/91; `node --check src/dashboard.js` y `node --check test/dashboard.test.js` aprobados. Timers Node mockeados sin parámetro configurable por request; clearTimeout y listeners comprobados.
- Diff anterior autoformateado: 475 líneas, no 344; alcance reducido retirando validación semántica y sus pruebas, sin comprimir código ni quitar cobertura HTTP. Final tras herramientas: 384 líneas (372 adiciones + 12 eliminaciones), bajo 400; `git diff --check` aprobado. Verificación sintética no equivale a aprobación nativa.
- Techo duro 400 líneas incluidas pruebas/docs por unidad; sin ledger/esquema/deps/formulario. Rollback sólo este diff en dashboard, su test, README y ROADMAP; preservar bases y entregas.

## Formulario manual — candidato no entregado

- Una sola tarifa de seis campos explícitos; sólo base seleccionada y opt-in booleano true/CLI existente. Demo/readonly sin formulario, script ni conexiones.
- Script estático con hash CSP exacto y connect-src self sólo opt-in; payload decimal/UTC textual, cero preservado, feedback por textContent y controles bloqueados durante envío.
- Éxito canónico, conflicto 409 y fallos genéricos; entradas retenidas, sin reintento automático, recotización ni refresco. Precios append-only/versionados; snapshot estimado, no factura.
- RED enfocado observado 0/2: script ausente y módulo inexistente; GREEN 2/2 con CSP/gating y VM fakeDOM (pending/doble envío/cero/éxito/conflicto/operación/red/JSON inválido).
- Verificación sintética: dashboard 25/25, `npm test` 99/99 y sintaxis de los cuatro JS/diff check aprobados. Diagnósticos automáticos de edición limpios; LSP primario no disponible al escritor.
- Verificación browser real, revisión independiente y entrega pendientes del padre; sólo datos sintéticos. No ledger/esquema/rutas/deps nuevos.
- Rollback sólo del diff candidato en `src/manual-price-form.js`, `src/dashboard-report.js`, `src/dashboard.js`, `test/dashboard.test.js`, `README.md`, `ROADMAP.md`; preservar bases y entregas.

## Opt-in CLI/API y persistencia HTTP — entregado PR #27 (`64c81bb`)

La evidencia siguiente es histórica de la implementación previa a integrar PR #27.

- Implementado sobre `7d37f7c`: booleano estricto/default false; CLI valueless sólo base/moneda; POST valida antes de RW por petición, cierre en finally, sin writer retenido.
- 200 canónico/idempotente, 409 conflicto exacto y 500 genérico; rechazo del parser cierra transporte, no promete respuesta HTTP. Moneda del cuerpo explícita, HTML/CSP estáticos.
- Sintéticos: persistencia/reapertura, versión/moneda/conflicto, admisión/no RW, interrupción, fallos open/save/close y reintento tras commit; CLI ayuda/límites/arranque/señales. Windows puede terminar directamente, sin garantía de cierre graceful.
- RED: `node --test --test-name-pattern='opt-in prices|CLI help' test/dashboard.test.js` 1/5; GREEN 5/5. Dos intentos intermedios agotaron 60s por lifecycle/transport, corregidos sin cambiar el parser.
- Verificación sintética: dashboard 23/23, `npm test` 97/97; `node --check` de ambos JS y `git diff --check` aprobados. Formato manual; sin formatter autorizado.
- Rollback sólo de este diff en `src/dashboard.js`, `test/dashboard.test.js`, `README.md`, `ROADMAP.md`; preservar bases, temporales y entregas. Sin formulario, deps, esquema, datos reales ni aprobación nativa afirmada.

## Validación semántica de tarifas — entregada PR #26 (`7d37f7c`)

Revisión histórica aprobada antes de integrar PR #26; no revisa unidades posteriores. La evidencia siguiente conserva el estado previo a la entrega.

- [x] Parser devuelve seis campos canónicos mediante wrapper puro `validateManualPrice`; contrato privado existente compartido con `addManualPrice`, sin duplicar reglas ni abrir almacenamiento.
- [x] Import diferido sólo en semántica; rechazos 400 sanitizados destruyen request, fallos de carga conservan naturaleza operacional. Demo/readonly siguen GET-only.
- [x] Sintéticos: cero/mínimo/máximo, categorías, UTC, identidades, moneda, decimales, claves faltantes/extra/`__proto__`, tipos y claves propias no enumerables/símbolos; lifecycle y loopback conservados.
- [x] Revisión/entrega completadas mediante PR #26; opt-in/persistencia entregados después en PR #27; formulario candidato y sesiones reales pendientes.
- RED enfocado: 4/7 pasan, 3 fallan por canonicalización/rechazo/wrapper ausentes. GREEN enfocado: 7/7 (22 éxitos canónicos y 103 rechazos semánticos); dashboard 19/19, `npm test` 93/93 y sintaxis de los tres JS aprobados. Sin revisión nativa afirmada.
- Rollback sólo del diff de esta unidad en `src/ledger.js`, `src/dashboard.js`, `test/dashboard.test.js`, `README.md`, `ROADMAP.md`; preservar los cambios previos del padre. Techo duro 400 líneas formateadas contando esos cambios.

## Apertura RW existente sin creación — entregada PR #24 (main `8cfb899`)

La evidencia siguiente conserva el estado histórico previo a la integración.

- [x] API mínima `openExistingLedger(path)`: sólo tarifas y cierre; URL interna escapada con `mode=rw`, sin stat/mkdir/DDL/migración ni configurar WAL.
- [x] Validación compartida readonly, snapshot diferido cerrado antes de devolver API, errores sanitizados y cierre best-effort incluyendo construcción.
- [x] Sintéticos: missing/padres ausentes, vacía/corrupta/legada/sin clave, Unicode/#/% y ruta relativa, conservación de filas/esquema/journal, persistencia/idempotencia/conflicto/rollback, reinicio readonly y cleanup fallido.
- [x] Revisión nativa aprobada y reconocida; entrega mediante PR #24. Formulario, HTTP/CLI/dashboard y datos reales fuera de esta unidad.
- RED: `node --test --test-name-pattern=openExistingLedger test/audit.test.js`, 0/3 por API ausente. GREEN inicial 3/3; intento intermedio 2/3 por expectativa incorrecta de total completo con tarifas faltantes, corregida comprobando tarifa/input y total null.
- GREEN final: `node --test --test-name-pattern=openExistingLedger test/audit.test.js` 3/3; Node 22.20.0 / SQLite 3.50.4 observados en Windows. Rama de fixtures con `?` sólo para plataformas que lo admiten, no ejecutada aquí.
- Regresión: `node --test --test-name-pattern='openExistingLedger|readonly|addManualPrice|manual|tariffs' test/audit.test.js` 18/18; `npm test` 86/86; `node --check src/ledger.js`, `node --check test/audit.test.js` y `git diff --check` aprobados. Formato manual, sin formatter ni revisión nativa afirmada.
- Previsión 280–370; final 287 líneas (272 adiciones + 15 eliminaciones), techo duro 400 incluidas pruebas/docs. Rollback sólo del diff de esta unidad en `src/ledger.js`, `test/audit.test.js`, `README.md`, `ROADMAP.md`; preservar entregas, bases y artefactos.
- Runtime API sintético probado; UI N/A. Sin garantía de ausencia de sidecars naturales ni identidad ante sustitución hostil. Validación no ampliada a integridad completa/triggers/NOT NULL.

## Guardado atómico addManualPrice — entregado PR #23 (`5fca78d`)

La evidencia siguiente conserva el estado histórico previo a la integración.

- Savepoint local: INSERT, confirmación y conflicto en una operación; compatible con `BEGIN IMMEDIATE` exterior, sin apropiarse de su commit/rollback.
- API de seis campos, validación antes de SQL, tarifas append-only y firmas/errores de conflicto conservados; sin opener, formulario, CLI/dashboard/HTTP/esquema/deps ni datos reales.
- RED: `node --test --test-name-pattern=addManualPrice test/audit.test.js`, 0/1; tras fallo SELECT post-INSERT quedaba una fila en lugar de `[]`.
- GREEN/triangulación: mismo comando, 3/3; recuperación en mismo handle, duplicado canónico, conflicto, versión nueva, rollback/commit exterior y fallos de savepoint/INSERT/confirmación/release/cleanup sanitizados.
- Verificación: `node --test --test-name-pattern='manual|tariffs' test/audit.test.js` 10/10; `npm test` 83/83; `node --check src/ledger.js`, `node --check test/audit.test.js` y `git diff --check` aprobados. Formato manual según estilo existente; diagnósticos automáticos parciales, sin herramienta LSP primaria disponible al escritor.
- Cleanup rechazado por SQLite no permite garantizar rollback: recuperar o cerrar el handle. Runtime N/A: sólo API, sin nueva frontera CLI/HTTP/UI; pruebas funcionales sintéticas en memoria.
- Revisión/entrega pendientes del padre. Apertura RW existente sin creación y formulario son trabajo posterior, no implementado aquí.
- Rollback sólo del diff actual de `src/ledger.js`, `test/audit.test.js`, `README.md`, `ROADMAP.md`; preservar entregas, bases y artefactos. Techo 400 líneas formateadas incluidas pruebas/docs.

## Detalle agente→proveedor/modelo — entregado PR #22 (`73a1d63`, commit `5535d91`)

La evidencia siguiente conserva el estado histórico previo a la integración.

- [x] Desplegables nativos anidados agente→proveedor/modelo demo/base seleccionada; tabla por grupo, cuatro categorías/total exactos, entradas, sesiones distintas no aditivas, costo manual/cobertura/razones; exclusiones globales.
- [x] Observations del snapshot existente: BigInt/Set temporales, proyección pública detached; sin IDs/rutas/tarifas, repricing ni cambios ledger/CLI/API/esquema/deps.
- [x] Sintéticos: conservación cruzada agentes/modelos, sesión repetida y varios modelos, >safe, cero, fecha/identidad inválida con tokens y costo null, escape/clones/vacío.
- [ ] Revisión/entrega por el padre; sin aprobación nativa afirmada, sesiones reales ni browser visual. Padre informó LSP de ambos JS/lens limpios antes del ajuste anidado; edición posterior limpia, sin nueva comprobación LSP primaria del escritor.
- RED: `node --test test/dashboard.test.js` 10/12, dos fallos por tokens ausentes; primer intento incluyó un error SQL del test, corregido antes del RED contractual.
- GREEN final: `node --test test/dashboard.test.js` 12/12; `npm test` 80/80. Triangulación pasó tras corregir selección SQL duplicada en la nueva prueba.
- Ajuste anidado: RED enfocado 10/12 por segundo nivel/summary ausentes; GREEN 12/12. Estructura prueba dos niveles, una tabla/grupo, summaries nativos sin JS y null/texto/escape distintos.
- `node --check src/dashboard-report.js`, `node --check test/dashboard.test.js` y `git diff --check` aprobados. Padre autoformateó el diff previo: 317 líneas (+30 sobre 287). Ajuste posterior formateado manualmente, sin comando formatter autorizado; diff final 357 líneas (322 adiciones + 35 eliminaciones).
- Runtime: CLI/HTTP sintético ambos modos, fixture equivalente, cierre pre-listen y HTML estático, CSP/Host/Origin/Fetch-site y GET `/` preservados.
- Rollback sólo del diff candidato en `src/dashboard-report.js`, `test/fixtures/dashboard-demo.json`, `test/dashboard.test.js`, `README.md`, `ROADMAP.md`; preservar entregas/bases/temporales. Techo duro 400 líneas formateadas incluidas pruebas/docs.

## Unidad B evolución diaria SSR — entregada PR #21 (`ef660d2`, commit `dc03b15`)

La evidencia siguiente conserva el estado histórico previo a la integración.

- [x] Demo y base seleccionada: tabla con caption, scope col, scroll, días UTC/entradas/tokens exactos; sólo días observados, sin rellenar huecos, cero visible.
- [x] Proyección profunda de evolution del snapshot conjunto existente; sin tocar ledger/API/esquema/dependencias. Undated separado con missing/invalid y cobertura/exclusiones no aditivas.
- [x] Pruebas sintéticas: seed original/fixture equivalente, vacío, fechas múltiples, huecos, cero, precisión grande, sólo undated, escape/clones y cambios de fecha/tokens posteriores sin refresco.
- [ ] Revisión nativa y entrega por el padre; no se afirma aprobación. Sin sesiones reales ni validación visual de browser.
- RED: `node --test test/dashboard.test.js`, 4/10; seis fallos por proyección/caption ausentes tras corregir uso de dashboardReport (sólo disponible readonly). GREEN enfocado 10/10.
- Verificación: `node --test test/dashboard.test.js` 10/10; `npm test` 78/78. Runtime CLI/HTTP sintético en ambos modos: caption/tokens/banner, CSP/barreras, puerto ocupado y señales; snapshot cerrado y estático tras cambiar fechas/tokens.
- Diagnósticos automáticos de edición JS/JSON/Markdown limpios; LSP primario no disponible al escritor, pendiente del padre. Formato final manual conforme al estilo existente; sin comando de formatter suministrado. Diff 248 líneas (222 adiciones + 26 eliminaciones); `git diff --check` aprobado.
- Rollback exclusivamente del diff B en `src/dashboard-report.js`, `src/dashboard.js`, `test/fixtures/dashboard-demo.json`, `test/dashboard.test.js`, `README.md`, `ROADMAP.md`. Preservar API A entregada, bases y temporales. Techo duro 400 líneas formateadas, sin quitar cobertura.

## Unidad A evolución diaria — entregada PR #20 (`896fa46`, commit `e5049bd`)

La evidencia siguiente conserva el estado histórico del escritor previo a la integración.

- `tokenEvolution({})` global own, buckets diarios UTC ascendentes y undated; strings/BigInt exactos, conservación con runtime y cobertura dinámica antes de fechas.
- Sólo timestamp exterior canónico; sin inferencias, días rellenados, tarifas, categorías extra, filtros, cambios CLI/UI/esquema/dependencias ni datos reales.
- `dashboardReport` incluye evolution en la transacción diferida conjunta; readonly conserva sólo dashboardReport/close.
- RED: `node --test --test-name-pattern=tokenEvolution test/audit.test.js`, 0/2 por API ausente. GREEN: patrón `tokenEvolution|readonly dashboard|dashboardReport`, 5/5; recuperación, reinicio, cero/grandes, fechas, copias y commit independiente con conteos constantes.
- Verificación: `npm test` 75/75; `node --check src/ledger.js`, `node --check test/audit.test.js` y `git diff --check` aprobados. Diff final tras formato: 345 líneas (327 adiciones + 18 eliminaciones), medido por el padre. Padre: suite 75/75, sintaxis de ambos JS y LSP primario en ambos archivos limpios; `lens_diagnostics` sin errores. Revisión/entrega pendientes; runtime N/A API-only sintética, evolución UI B futura.
- Rollback sólo de este diff en `src/ledger.js`, `test/audit.test.js`, `README.md`, `ROADMAP.md`; preservar PR #19, APIs, bases y temporales. Techo duro 400 líneas formateadas incluidas pruebas/docs.

## Unidad B dashboard seleccionado — entregada PR #19 (`f8c87b2`)

La evidencia siguiente conserva el estado histórico del escritor previo a la integración.

- Base existente `--db` y `--currency` explícitas; demo conservado e incompatible con ambas. Ayuda/invalid no abren base ni listener.
- Un `dashboardReport` conjunto proyectado al SSR; cierre antes de listen y ante fallos. Snapshot estático, sin repricing, refresco ni captura.
- Banner distingue base seleccionada/demo; null no es cero, vistas no aditivas, runtime separado. Barreras HTTP/CSP conservadas; errores sin rutas privadas.
- RED observado: dashboard 5/7, dos fallos por función ausente. GREEN enfocado 7/7; CLI/HTTP sintéticos, cierre, conservación de bytes, fallo de apertura/reporte/puerto y cambios posteriores sin refresco.
- Verificación: `node --test test/dashboard.test.js` 7/7; `npm test` 73/73; `node --check src/dashboard.js`, `node --check src/dashboard-report.js`, `node --check test/dashboard.test.js` aprobados. Padre: suite 73/73, tres comprobaciones de sintaxis y LSP primario en tres archivos limpios; `lens_diagnostics` sin bloqueos. Sin build definido.
- Diff final formateado: 303 líneas (263 adiciones + 40 eliminaciones), medido con `git diff --numstat`; `git diff --check` aprobado. Techo 400 incluidos tests/docs, sin heredar excepciones históricas. SQLite puede usar WAL/SHM; sin validación real ni visual de browser.
- Rollback sólo del diff B de `src/dashboard.js`, `src/dashboard-report.js`, `test/dashboard.test.js`, `README.md`, `ROADMAP.md`; preservar bases, temporales preexistentes y API PR #18. Entrega histórica completada en PR #19; esta evidencia no revisa la evolución UI candidata.

## Unidad A readonly — entregada PR #18 (`7d924e4`)

- Apertura existente explícita sin init/repair ni API de escritura; SQLite puede usar WAL/SHM.
- Runtime/costos en un snapshot diferido; moneda estricta antes de SQL y errores sanitizados.
- Pruebas sólo sintéticas: rechazos, conservación, recuperación y commit independiente entre informes con conteos constantes. RED 0/3 por opener ausente; GREEN 3/3 y suite 71/71.
- Techo 400 líneas formateadas incluidas pruebas/docs. Rollback sólo del diff de `src/ledger.js`, `test/audit.test.js`, `README.md` y `ROADMAP.md`; preservar bases y temporales preexistentes. UI B fuera de alcance.

## Dashboard demo — entregado PR #17 (`8873088`)

La evidencia siguiente conserva el estado histórico del escritor previo a la integración.

- SSR sin JS cliente ni dependencias; servidor sólo fixture, bind 127.0.0.1 y puerto efectivo explícito.
- Fixture proyectado desde APIs existentes sobre ledger sintético en memoria; sin IDs privados ni recálculo de precios.
- Agentes/modelos/tokens exactos, costos EUR completos/cero/null, cobertura y razones; vistas no aditivas y runtime sin moneda inferida.
- RED observado por módulos ausentes; GREEN demo 5/5 y suite 68/68, tres comprobaciones de sintaxis y diff check aprobados. Formato completado; browser no disponible al escritor, validación visual pendiente del padre.
- Techo inicial 560; usuario amplió explícitamente hasta 700 líneas formateadas incluidas pruebas/docs para las mismas siete superficies. Rollback sólo de esos siete archivos, nunca bases ni APIs previas.

## Costos comparativos — entregado en PR #16 (`64ce935`)

- Revisión histórica `review-8c5074f0bb6e7bac` aprobada y acknowledged, sin correcciones; 63/63. Esta autoridad no revisa el dashboard candidato.

- `costReport({currency})` y CLI `costs --db` existente con moneda explícita; snapshot único, filas conjuntas y cobertura sin subtotal ni ranking monetario.
- Evidencia histórica del escritor anterior: RED 59/63, cuatro fallos por API/CLI ausentes; GREEN 63/63. CLI sintética equivalente a API; snapshot independiente, exclusiones, fechas, cero, precisión grande y grupos incompletos aprobados. LSP completo no disponible entonces; revisión posteriormente cerrada según registro anterior.
- Expectativa grande corregida mediante aritmética independiente: `9007199254740991 × (10¹² − 10⁻⁶) = 9007199254740990990992.800745259009`.
- Usuario autorizó hasta 500 líneas formateadas (adiciones + eliminaciones), sólo esta unidad/seis archivos, incluidas pruebas/docs; no hereda excepciones anteriores.
- Sin datos reales, esquema, dependencias, captura/UI, cambios runtime/ranking ni publicación; rollback sólo del diff autorizado, preservando bases y fixtures ignorados.

## Reporte global runtime — entregado en PR #15 (`f8f961b`)

- API `runtimeReport({})` y CLI `report --db` explícito existente; snapshot único, tokens exactos, importes individuales con moneda/total null y faltantes visibles.
- Excepción final del usuario: exactamente **616 líneas formateadas** sólo para este reporte, tras expansión del autoformato; límite habitual de 400 permanece para unidades futuras. Sin división API/CLI.
- RED original API 0/3 y CLI 0/1; final tras formato: API 5/5, CLI 1/1, suite 59/59 y cuatro comprobaciones de sintaxis aprobadas. Cobertura adicional sin defecto observado no requiere RED artificial.
- Sin datos reales, esquema, captura, UI ni precios inferidos. Inicialización/WAL del opener impide afirmar CLI totalmente read-only.
- Rollback sólo del diff de ledger, CLI, ambas pruebas, README y ROADMAP; preservar bases, APIs anteriores y fixtures ignorados. Revisión/publicación pertenecen al padre.

## Bloque 4 entregado — tokens globales por proveedor/modelo

- [x] `modelUsage({})` estricto antes de SQL; una clasificación dinámica dentro de un snapshot diferido, sin tareas ni escrituras.
- [x] Sólo own: cuatro categorías y total almacenado con BigInt/strings; exclusiones por certeza, sin ceros ficticios ni costos.
- [x] Identidades observadas literales/null; orden total descendente, desempate binario UTF-8 con null primero; sesiones no aditivas entre modelos.
- [x] RED: cinco pruebas nuevas fallaron por API ausente; GREEN 5/5. Escritor: `npm test` 53/53, dos `node --check` y diff check aprobados; API sintética sin build/runtime adicional aplicable.
- [x] Triangulación: suma exacta grande/cero, identidades/null/Unicode, todas las exclusiones, tareas tardías, copias/reinicio/estado intacto, commit WAL independiente y recuperación de fallos genéricos. Diagnósticos automáticos parciales; no se afirma LSP completo.
- [x] Padre postformato: suite 53/53, sintaxis en dos archivos, diff check y LSP primario en dos archivos limpios; sin verificador independiente separado afirmado. Revisión nativa aprobada y reconocida; PR #13 integrado.

**Límites:** excepción explícita del usuario de exactamente 478 líneas formateadas incluidas pruebas/docs sólo para esta unidad; límite habitual de 400 para unidades futuras. Sin dinero, esquema, cambios de ranking/accounting, CLI/UI, captura, políticas automáticas ni datos reales. Rollback sólo de este diff de cuatro archivos; preservar bases, APIs anteriores y ambos fixtures ignorados.

## Bloque 3 entregado — resumen histórico seleccionado

- [x] Dos claves exactas, IDs densos/distintos y moneda explícita; rechazos antes de SQL.
- [x] Un SELECT seleccionado con binding JSON, orden binario y snapshots validados; sin lectura de entradas/tarifas ni escrituras.
- [x] Rechazar IDs ausentes, moneda distinta y alternativas de una entrada; pares literales sin colisiones de delimitadores.
- [x] Total fixed-12/BigInt sólo con selección no vacía y completa; null incompleto/vacío, cero explícito y cobertura histórica separada.
- [x] RED observado: imported 12 pasan/5 fallan por API ausente; luego 16/17 por expectativa aparcada incorrecta de 18 decimales. Corrección autorizada sólo en la aserción activa: `72057594037927927927942.405962072072`; fixtures ignorados intactos.
- [x] Escritor: imported 17/17, suite 48/48, sintaxis de ledger/audit y diff check aprobados; pruebas sintéticas, sin build/runtime aplicable.
- [x] Padre histórico: suite 48/48, sintaxis en dos archivos, diff check y LSP primario limpios; unidad final 382 líneas. Revisión `review-61e8763c6490c107` aprobada con ack, autoridad consumida sin correcciones; PR #12 integrado. No aprueba la unidad nueva.

Identidades históricas: target `75104038d83cd33e0ac47302b3ca8570248b32c632f501d131959a213cb0f01b`, tree `47dedad218cb9758058c763eb7fa1a91294b787c`, revisión `20cba84d861c6e7780eb6a0919a33afaa6b3c6c43fb808044e6a8c55eb12fdc3`.

**Límites:** 400 líneas formateadas totales; sin subtotal parcial, ranking global, ownership actual, factura, conversión, manual/runtime, CLI/UI ni datos reales. Rollback sólo del diff actual de cuatro archivos; preservar lector entregado, bases y ambos fixtures ignorados.

## Bloque 3 entregado — lector histórico validado por ID

- [x] Sólo `importedEstimate({ id })`: estructura requerida, identidad/procedencia y coherencia histórica; missing ID sigue null y validación pública sin cambios.
- [x] Parser privado fixed-12/BigInt, cuatro categorías y cobertura coherentes; total completo exacto o null incompleto, sin subtotal.
- [x] Baseline tras aparcar cinco RED de resumen: `npm test` 41/41; fixture completo y cuerpo de 256 líneas preservados byte a byte, ignorados/inactivos/no publicados.
- [x] RED nuevo: imported 11/12, rechazo ausente de JSON válido corrupto; GREEN inicial 12/12.
- [x] Casos alternos: completo, cero, incompleto con null, importes grandes, metadata extra, historia tras conflicto/tarifas, copias/reinicio y fallos genéricos; una lectura, sin cambios contables/almacenamiento.
- [x] Escritor final: imported 12/12, `npm test` 43/43 y dos comprobaciones `node --check` aprobadas; diagnósticos JS/Markdown de edición limpios. API sintética, sin build/runtime aplicable.
- [x] Padre histórico: 43/43, sintaxis en dos archivos, diff check y LSP en dos archivos limpios; diff final 339 líneas. PR #11 integrado; revisión `review-bfc943dd06fb8b00` aprobada con ack, autoridad consumida.

Ack/target histórico: `25057d6260917e7e8a3d3e80483283a7ec2824df54a42a99960beefdf73ec16a`; no aprueba el resumen seleccionado.
**Límites históricos:** sólo lector por ID, sin cambios de enumeración/retries, esquema, clasificación/precios actuales, ranking/runtime, CLI/UI ni datos reales. Rollback de esa unidad, nunca bases ni fixtures.

## Bloque 3 entregado — enumeración global importada

- [x] `importedEstimates({})` estricto: cero claves propias, rechazo antes de SQL.
- [x] Un SELECT de `imported_estimates`, orden literal `id COLLATE BINARY`, snapshots históricos intactos y profundamente separados; `additive: false`.
- [x] RED: imported 7/10, tres fallos esperados por API ausente; GREEN inicial 10/10.
- [x] Triangulación: vacío, alternativas de una entrada, USD/EUR, quote completo/incompleto, tarifas/conflictos posteriores, reinicio/mutación, errores de prepare/SELECT y JSON corrupto sin resultado parcial.
- [x] Una lectura sin transacción/escrituras ni consultas de entradas/precios; estado contable, filas/conteos y hash de almacenamiento conservados.
- [x] Escritor final: `node --test --test-name-pattern=imported test/audit.test.js` 10/10; `npm test` 41/41; `node --check src/ledger.js`, `node --check test/audit.test.js` y `git diff --check` aprobados. Diagnósticos de edición JS/Markdown limpios; sin build/runtime aplicable a esta API, pruebas funcionales sólo sintéticas.
- [x] Padre histórico: suite 41/41, sintaxis en dos archivos, diff check y LSP en dos archivos limpios; diff final formateado de 282 líneas. PR #10 integrado, revisión reconocida sin correcciones; no verifica el lector nuevo.

**Límites:** máximo 400 líneas formateadas totales en los cuatro archivos autorizados. Historial no aditivo, no cobertura de todas las entradas ni ownership actual, sin selección preferida, suma, repricing, paginación, manual-estimates globales, runtime/ranking, CLI/UI ni datos reales. Lectura única consistente por SQLite; no se afirma nueva prueba de concurrencia. Rollback sólo del diff de esta unidad; preservar bases/APIs durables y fixture ignorado, ya activo y no publicado.

## Bloque 3 entregado — estimaciones importadas durables

- [x] API estricta de cuatro claves y consulta por ID; namespace independiente y migración aditiva.
- [x] `BEGIN IMMEDIATE`: lookup antes de clasificación/precios, snapshot inmutable e ineligibles sin persistencia; tarifas faltantes producen quote incompleto.
- [x] Fixture ignorado intacto: hashes completos y de cuerpos verificados antes de restaurar sus tres pruebas; tarifa retrospectiva ahora aplicable cambia ID nuevo de `0.000019000000` a `0.000038000000`.
- [x] RED escritor: cuatro imported pasan, tres fallan por API ausente; GREEN inicial 7/7.
- [x] Escritor final: imported 7/7, suite sintética 38/38, ambas comprobaciones `node --check` y `git diff --check` aprobadas; diagnósticos disponibles limpios, sin build aplicable.
- [x] Triangulación: rollback de colector/tarifa/insert/commit, writers independientes bloqueados durante creación, arbitraje posterior, reinicio/copias y esquema legado preservado.
- [x] Padre: suite 38/38, ambas comprobaciones de sintaxis, diff check y LSP primario limpios. ASSESS previo: riesgo medio/escritor grande, autoverificación suficiente; sin verificador independiente exigido ni afirmado.
- [x] PR #9 integrado: main `8e2c823`, commit `7ad2dbed8c89f23f563cfa3d15376aaf1e996301`. Revisión `review-e7953ecbe3993137` aprobada con ack; autoridad consumida, sin correcciones.

Identidades históricas: target `54348f7dd217a5f04652f265d9a8e7202656d99ddb7adde6a26b3baff38f0b0a`, tree `328884594fa924d5a5588f3619b40e98fe0f3209`, rev `58e3f0a23aa094ecc429311c85a4d940b34f4c17275ff2826b5a363f8088e4ea`. No constituyen autoridad para la enumeración nueva.

**Límites:** 400 líneas formateadas totales, incluidos tests/docs; alternativas no aditivas, sin consumo nuevo, runtime/ranking, CLI/UI, fuentes ni sesiones reales. Rollback sólo de esta unidad en los cuatro archivos autorizados, nunca bases ni trabajo entregado.

## Bloque 3 entregado — extracción del colector importado

- [x] Extraer clasificación, observación y quote opcional a un colector interno sin transacciones; el llamador conserva validación, transacción diferida y errores.
- [x] Preservar exactamente las tres pruebas RED de estimaciones en `local-data/deferred-imported-estimates.test.js` (fixture sintético ignorado); restaurar sólo sus adiciones en audit, conservando todas las pruebas actuales.
- [x] Compatibilidad antes/después: cuatro pruebas imported aprobadas; no hay RED significativo para esta extracción sin cambio de comportamiento.
- [x] Escritor: `npm test` 35/35; ambas comprobaciones de sintaxis y `git diff --check` aprobados.
- [x] Padre tras autoformato: `npm test` 35/35 y ambas comprobaciones de sintaxis aprobadas; 137 líneas antes del cierre documental. Evaluación nativa: riesgo medio/escritor grande, sin verificador separado exigido.
- [x] LSP primario confirmado limpio al comprobar cada archivo individualmente con mayor presupuesto; los dos intentos batch previos fueron inconclusos por timeout.
- [x] Integrado mediante PR #8; confirmación de base suministrada por el padre.

**División:** primero esta extracción, después persistencia importada; máximo 400 líneas formateadas por unidad. Sin APIs/tablas durables nuevas, cambios de runtime/ranking, fuentes, CLI, UI ni datos reales. La tarifa retrospectiva del fixture diferido es anterior a la original y no prueba cambio de precio para un ID nuevo; reforzar ese caso en la unidad siguiente. La evidencia PR #7 siguiente es histórica, no aprobación de este refactor.

## Bloque 3 entregado — cotización importada de sólo lectura

- [x] Tres claves exactas, par session/entry literal y moneda explícita; rechazo antes de SQL.
- [x] Clasificación dinámica y tarifas en el mismo snapshot diferido; sólo own con identidad/fecha/contadores válidos.
- [x] Respuesta separa observación, elegibilidad y quote; incertidumbre sin precio, tarifas ausentes no niegan ownership.
- [x] Escritor: RED 0/4 por API ausente; GREEN 4/4 `node --test --test-name-pattern=imported test/audit.test.js`.
- [x] Casos alternos: metadatos inválidos, clases no propias, linaje tardío, conflicto posterior, commit WAL independiente, errores/rollback, mutación/reinicio y tarifas retrospectivas.
- [x] Escritor final: `npm test` 35/35; `node --check src/ledger.js`, `node --check test/audit.test.js` y `git diff --check` aprobados. Diff final manualmente formateado: 389 líneas (381 adiciones + 8 eliminaciones).
- [x] Padre tras autoformato: `npm test` 35/35, dos comprobaciones de sintaxis y LSP sin errores; diff 396 líneas antes del cierre documental. Evaluación nativa: riesgo medio/escritor grande, sin verificador separado exigido. El padre no observó RED.
- [x] Revisión nativa aprobada con ack y entrega mediante PR #7; identidades registradas arriba. Sin correcciones.

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
- **Dashboard:** snapshot localhost entregado; evolución UI B PR #21, detalle PR #22 y guardado atómico PR #23 entregados; apertura RW PR #24 entregada; admisión HTTP interna PR #25 y semántica PR #26 entregadas; guardado opt-in candidato y formulario pendiente.

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
