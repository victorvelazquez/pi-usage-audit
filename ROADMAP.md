# Avance del proyecto

**Queremos lograr:** abrir una aplicación local y ver qué agentes y modelos consumen más tokens y costo estimado, para decidir qué modelos conviene comparar. No cambiaremos modelos automáticamente ni inferiremos calidad sólo por consumo.

## Dónde estamos hoy

**L6 aceptado y cerrado para uso local por decisión humana, con el límite visual explícitamente aceptado: retorno al prompt no confirmado. Evidencia consolidada integrada en PR #58; sin release. Este nuevo registro documental es candidato local, aún sin commit ni integración.**

- **Última tarea terminada:** aceptación humana de L6 para uso local del producto existente en main `41f1f1e`, Node 22.20; código de aplicación fijo `834a1be` y guía L5 `d10dd9e` conservados. Evidencia posterior integrada en PR #57/#58; no se cambian los pins de [LOCAL.md](LOCAL.md).
- **En curso:** registro documental del cierre en `ROADMAP.md`, con lectura estructural completada; pendiente commit/integración con autorización separada. Producto aceptado no equivale a esta actualización documental entregada.
- **Excepción sólo A1:** techo autorizado de 550 líneas de diff completo formateado; no se traslada a A2 ni cambia el techo general de 400 incluidas pruebas/docs.
- **Siguiente tarea:** entrega de este registro documental sólo con autorización separada, o priorización humana de F1–F4 como decisión de producto, sin iniciar implementación. No se solicitan más comprobaciones técnicas; no se autorizan release, captura continua, recuperación histórica ni nuevos datos.
- **Distribución acordada:** repositorio local en commit fijo; no ZIP, paquete npm/global ni publicación de release. No actualizaciones implícitas. La decisión no autoriza leer nuevos historiales ni modificar datos originales.

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
| Dashboard local y precios | Abrir una pantalla con ranking, evolución, detalle y formulario de tarifas | Demo PR #17, API readonly PR #18 y UI seleccionada PR #19 entregados; evolución API PR #20/UI PR #21 entregadas; detalle PR #22 entregado; guardado atómico PR #23 entregado; apertura RW PR #24 entregada; admisión HTTP interna PR #25 y semántica PR #26 entregadas; opt-in/guardado PR #27 y formulario PR #28 entregados |
| Contexto y filtros | Filtrar por proyecto, tarea y sesión; agrupar worktrees del mismo repositorio | Metadatos básicos; filtro runtime API por sesión entregado PR #29; CLI entregado PR #30; costos API PR #31 y evolución API PR #32 entregados; compuesto API PR #33 entregado; selector dashboard al arrancar entregado PR #34; admisión interactiva A entregada PR #35, B entregada PR #36; identidad declarada API entregada PR #37; filtro runtime por proyecto API PR #39/CLI PR #40 entregados; refactor PR #41 integrado; costos API proyecto PR #42 y evolución API proyecto PR #43 entregados; compuesto readonly API proyecto PR #44 entregado; selector dashboard de arranque PR #45 entregado |
| Cobertura y validación real | Comprobar el recorrido con sesiones seleccionadas y mejorar identificación de agentes/hijos | L3 entregado PR #50; L4-A1/A2 entregados PR #51/#52; L4-B entregado PR #55: seis agentes y 47/47 tareas retenidas de la captura, no historial completo |
| Captura continua | Incorporar consumo nuevo sin importar cada archivo manualmente | No iniciada; requiere autorización |

## Plan de primera versión local

**Prioridad acordada:** aplicación local útil, efectiva y funcional; no servicio público. Seguimos las tareas en este orden, una a una. Son seis hitos, no seis PRs garantizadas: los defectos encontrados pueden requerir unidades adicionales.

| ID | Tarea | Criterio para cerrarla | Estado |
| --- | --- | --- | --- |
| L1 | Admitir selector interactivo por proyecto en el parser interno | Validar proyecto literal y exclusión con sesión antes de storage; conservar global/sesión y barreras de admisión; pruebas sintéticas de válidos, inválidos y límites. Sin conexión HTTP/UI nueva. | Entregado PR #47 (`ada499e`, `c71ac11`) |
| L2 | Conectar filtro por proyecto al dashboard | Cambiar entre global, sesión y proyecto con alcance coherente en ranking/costos/evolución/detalle; errores y vacío claros, sin exponer IDs/rutas; pruebas HTTP y browser sintéticos, teclado y regresión de precios/demo. | Entregado: L2-A PR #48; L2-B PR #49 (`401f5f0`, `3b9e424`), revisión y browser/teclado cerrados |
| L3 | Validar uso completo con sesiones reales seleccionadas | Autorizar primero rutas y datos; importar/reimportar, abrir dashboard y contrastar tokens, costos y filtros con evidencia de origen. Registrar discrepancias y límites sin divulgar datos privados. | Entregado PR #50 (`9b8cda2`, `b96481e`); evidencia histórica conservada |
| L4 | Resolver bloqueadores de utilidad y atribución | Seleccionar raíz, tareas vinculadas e hijos dentro de directorios explícitos; incorporar metadatos disponibles sin inferencias ni denominador histórico fabricado, con regresiones sintéticas. | Entregado: A1/A2 PR #51/#52; B PR #55 (`834a1be`, `7d81bc0`), 82 comprobaciones, seis agentes y 47/47 tareas retenidas; raíces unknown, costos ausentes e historial incompleto |
| L5 | Preparar instalación y uso local repetible | Acordar distribución; comprobar instalación, requisitos, arranque/parada, selección de base, resguardo de datos y recuperación básica siguiendo una guía sin conocimiento previo. | Guía entregada PR #56 (`d10dd9e`, `40757f9`): repositorio fijo y recuperación consistente comprobados; Ctrl+C y recorrido visual final pertenecen a L6 |
| L6 | Verificar y preparar la primera versión | Suite completa, recorrido documentado y comprobación visual/teclado; límites y problemas pendientes explícitos; revisiones aplicables cerradas y decisión humana de entrega. Publicar sólo con autorización separada. | Aceptado/cerrado para uso local por decisión humana con límite visual documentado aceptado; evidencia PR #57/#58 integrada. Retorno visual al prompt no confirmado, no completado artificialmente; sin release. Este registro de cierre aún no está integrado |

**Criterio de salida:** importar sesiones seleccionadas sin duplicar consumo, identificar agentes/modelos que consumen más, consultar estimaciones con tarifas explícitas, usar filtros global/sesión/proyecto, reconocer cobertura incierta y arrancar localmente siguiendo la guía. No inferir calidad por tokens ni presentar estimaciones como facturación real.

No se declara lista la versión sólo porque pasan pruebas sintéticas. L3 aporta evidencia real; L4 cierra sus bloqueadores. Cada hito conserva pruebas/evidencia y se marca entregado sólo después de su entrega comprobada.

## Futuro — separado del cierre local

Este backlog conserva objetivos, no autoriza implementarlos ni los elimina del producto. La propuesta es posponerlos respecto a la primera versión; si L3 demuestra que alguno es indispensable, acordaremos el cambio antes de incorporarlo al plan.

| ID | Objetivo futuro | Resultado buscado / condición para retomarlo |
| --- | --- | --- |
| F1 | Filtro y agrupación por tarea | Definir identidad de tarea y consultar su consumo sin inferencias ambiguas; acordar contrato y UI antes de implementar. |
| F2 | Captura continua opt-in | Incorporar nuevas entradas sin importación manual, con deduplicación, parada y errores visibles; requiere autorización explícita. |
| F3 | Ampliar cobertura de agentes e hijos | Priorizar formatos/casos no cubiertos observados en uso real, manteniendo consumo incierto separado y no aditivo. Los bloqueadores de la primera versión pertenecen a L4. |
| F4 | Mejoras de comparación y navegación | Priorizar con experiencia de uso qué vistas ayudan a decidir; sin cambio automático de modelos ni equiparar costo con calidad. |

Un servicio remoto/multiusuario queda fuera del enfoque actual: necesitaría una decisión de producto y un plan propio, no una extensión implícita del servidor local.

## Cómo seguir el avance

Leé sólo las secciones anteriores para conocer el estado. `ROADMAP.md` es la fuente única del orden y backlog; al empezar y terminar cada tarea actualizaremos **última terminada**, **en curso**, **siguiente** y su estado L1–L6.

- Sólo una tarea de implementación activa; confirmar alcance y criterio antes de escribir código.
- Unidades acotadas con techo de 400 líneas de diff incluyendo pruebas/docs; si no cabe, dividir o pedir acuerdo antes de ampliar.
- Un hallazgo se registra como bloqueador del hito actual o backlog futuro; no se añade funcionalidad silenciosamente.
- Antes de pasar al siguiente hito, registrar evidencia, límites y entrega comprobada. Sin acceso a datos reales, commit, push o publicación implícitos.

Una tarea se marca lista cuando está entregada, no sólo cuando se escribió código. No usamos un porcentaje: backend terminado no equivale a producto terminado. Las notas de candidatos del historial son evidencia de su momento; el estado actual está arriba.

El historial de pruebas y revisiones se conserva abajo, separado del seguimiento diario.

---

## Historial técnico y evidencia (lectura opcional)

Las secciones siguientes conservan las pruebas y decisiones de cada entrega. No necesitás leerlas para seguir el avance diario.

### L6 — aceptación humana para uso local con límite visual

- Decisión mediante `ask_user_choice`: **«Aceptar la versión local»**,
  valor `accept_local_with_documented_visual_limit`. Cierra L6 para uso local
  del producto existente en main `41f1f1e`, no autoriza release ni nuevos datos.
- Ctrl+C manual demostró Node ausente, puerto sin listener y HTTP inaccesible;
  el retorno visual al prompt no fue observado. El usuario acepta ese límite:
  no se transforma en verificación visual completada ni en defecto confirmado.
- Formulario opt-in: 22/22 PASS sintéticos con Tab/Enter vía CDP, no teclado
  físico. Suite 149/149 y recorrido readonly son históricos, sin nueva ejecución.
  No se extrapolan otros sistemas operativos, facturación, calidad, cobertura
  histórica completa ni captura continua.
- Consolidación anterior entregada: PR #58 MERGED, confirmado
  `2026-10-09T23:10:54Z`; commit `5cdade59fb48` ancestro de HEAD.
  Revisión nativa anterior `review-c9f66e82017341e6`, target `766f63a2`,
  aprobada, reconocida y cerrada. No describe la revisión de este nuevo registro.
- Esta unidad sólo registra la decisión: candidata local sin commit/integración;
  lectura estructural y `git diff --check` aprobados, sin commit/push/PR/release
  autorizados. F1–F4 siguen sin iniciar. TDD RED N/A: documentación pasiva,
  sin comportamiento nuevo; sin suite/build ni nuevas lecturas de datos reales.
- Rollback: sólo el nuevo diff de `ROADMAP.md`; no revoca la aceptación humana
  del producto ni su registro en memoria, ni altera historia previa, código,
  pins de la guía, datos o procesos.

### L6 — consolidación de evidencia y límites (histórica, integrada PR #58)

Las notas siguientes conservan el estado previo a integración y aceptación;
«candidata», «sin cierre» y «decisión pendiente» describen aquel momento.

**Formulario opt-in verificado; parada manual de Node/puerto comprobada.**
El retorno visual al prompt no está confirmado. Esta unidad consolida
la evidencia observada por el padre y completa su revisión documental aplicable;
no entrega ni cierra L6.
Base actual: main `6d608e5`, evidencia parcial PR #57 integrada; L5 PR #56
entregado. Suite histórica 149/149 y recorrido readonly anterior conservados,
sin nueva ejecución completa ni nueva lectura de datos reales.

#### Parada manual y límite visual

- Consola iniciada manualmente por el usuario desde Inicio, Node 22.20,
  `node src/dashboard.js --demo` directo. Antes: HTTP 200 y listener de Node.
  El usuario pulsó Ctrl+C; después: Node ausente, PowerShell vivo, puerto
  sin listener y HTTP inaccesible. Sin kill ni señal programática del padre.
- Las capturas mostraban la ventana ocluida: no prueban retorno visual al
  prompt. Se comprueba parada Node/puerto en este montaje, no todo el criterio
  Ctrl+C ni un defecto de aplicación. El usuario no quiere más confirmaciones
  técnicas; el límite queda explícito para la decisión humana.
- Test focal observado por el padre:
  `node --test --test-name-pattern='CLI effective URL, occupied port and signal shutdown' test/dashboard.test.js`:
  PASS 1/1, sin fallos; no sustituye Ctrl+C físico.
- El launcher automatizado anterior seguía activo y no se probó entrega SIGINT.
  Es una limitación del montaje, no un bug establecido. Esta unidad no limpia
  ni toca esos procesos; las notas de intentos anteriores siguen históricas.

#### Formulario opt-in: 22/22 comprobaciones aprobadas

- Nueva verificación del padre en Edge visible, perfil temporal propio/CDP,
  SQLite sintética fuera del repo y Node 22.20. Se renderizan seis campos;
  Tab alcanza modelo, categoría, moneda, vigencia, tarifa y guardar; Enter envía.
  Valores asignados por DOM y teclas CDP: no prueba de teclado físico.
- Casos inválidos: required, moneda minúscula y UTC inválido no persisten.
  Error visible genérico; no se presenta como resultado confirmado de guardado.
- Caso válido: proveedor `synthetic`, modelo `L6-check`, input propio de un millón
  de tokens, tarifa EUR 2.5 por millón vigente desde 2026-01-01 y uso 2026-01-02:
  costo exacto `2.500000000000`. No tarifa real ni factura.
- Append-only: otra tarifa 3 para la misma versión se rechaza y el reporte del
  ledger permanece igual. Guardar no refresca el snapshot de arranque;
  «Consultar Global» explícito muestra estimación fresca en DOM y API.
  Recargar vuelve al snapshot cacheado de arranque, como está previsto.
- Readonly: formulario ausente, POST 405 y sin cambios de datos.
- Capturas locales de formulario e inválido leídas por el padre; la captura de
  vista fresca muestra evolución, no costo. El costo se comprobó por DOM/API,
  no se inventa evidencia visual. Evidencia privada no publicada ni copiada.
- Browser nuevo cerrado, puertos propios sin listeners y sin Edge del perfil
  propio; repositorio limpio al finalizar esa verificación. Esto no describe
  ni autoriza limpiar el launcher anterior.

#### Revisión documental completada; decisión pendiente

- El padre contrastó el tracking y la evidencia, preservación del historial
  L3–L5 y límites de Ctrl+C, teclado CDP, snapshots y estimaciones sintéticas.
- La evaluación nativa clasificó esta unidad como documental pasiva: lectura
  estructural del padre suficiente, sin verificador separado ni revisión nativa
  adicional debida. No se afirma una aprobación formal de revisión nativa.
- Prompt visual sin confirmar, decisión humana y entrega siguen pendientes;
  sin autorización de release. Este diff es una candidata local, no una entrega.
- TDD RED N/A: unidad documental pasiva, sin cambio de comportamiento.
  `git diff --check` y lectura estructural aprobados; no rerun de suite total.
  Rollback: retirar sólo este diff de `ROADMAP.md`, preservando historia previa,
  producto, datos y procesos. Sin commit/push/PR ni entrega implícitos.

### L6 — evidencia parcial anterior (histórica, PR #57 integrado)

Las notas siguientes describen el recorrido previo; sus pendientes de formulario
y parada no sustituyen la evidencia nueva ni implican cierre de L6.

Base comprobada: main `d10dd9eba62ad99aba75b6d7a229693816ae8f1a`, PR #56 integrado.
Validación pasiva del producto existente; TDD RED no aplica. Sólo datos sintéticos
fuera del repositorio, sin historiales personales ni cambios en la base real.

- Clon de red nuevo del repositorio, no archivo/cache local. Checkout fijo de
  guía `d10dd9e` y de aplicación `834a1be`; src/test/package idénticos antes de
  ejecutar Node. Guía conservada aparte. Git 2.51.0.windows.2, Node 22.20.0;
  sin instalación de dependencias. Suite final 149/149, cero fallos/omitidos;
  sintaxis de cinco JS aprobada, LSP primario no disponible para el verificador.
- 73 aserciones API/HTTP y siete CLI/snapshot: plan con arrays PowerShell,
  tres importados, reimportación cero nuevos/tres duplicados; global 87 tokens,
  sesión 29 y proyecto explícito 68. Backup/restore con WAL/SHM presentes igual
  al origen, destino existente intacto y fuente ausente sin archivos nuevos.
  Demo CLI en cwd vacío no crea datos. Procesos propios cerrados y puertos libres
  mediante terminación Windows: esto no demuestra Ctrl+C.
- Edge visible, perfil temporal aislado y CDP: Tab/flechas/Enter seleccionan
  sesión/proyecto sin intersección; reportes 29/68, vacío cero y error inválido
  conserva vista previa. Recarga vuelve a global 87; modelos 48/39, agentes
  Beta 39/Alpha 29/unknown 19 y evolución 19/29/39. Espacio abre detalles;
  Tab y flecha derecha desplazan tabla ancha. Detalle Beta 39 y costos nulos
  `missingPrices` legibles; reporte sin IDs/rutas privadas. Capturas locales,
  no publicadas. No equivale a probar un teclado físico.
- Pendiente Ctrl+C: input nativo de Orca no tuvo efecto verificado. El usuario
  aclaró que cerró la primera terminal; en el segundo intento reportó retorno
  al prompt, pero Node y HTTP seguían activos y faltaba registro de retorno.
  No se da por aprobado ni se afirma defecto de aplicación sin comprobar señal.
  Limpieza sólo de procesos propios, puertos confirmados cerrados por terminación.
- Formulario opt-in cubierto por HTTP/API y evidencia histórica, no ejecutado
  visualmente en este recorrido final. También faltan decisión humana y entrega.
  File symlink EPERM no ejecutado; junctions aprobados, warnings Git por fixtures
  cíclicas esperados. No Windows/macOS/Linux equivalentes ni historial completo
  afirmados. Rollback sólo de este diff en `ROADMAP.md`; preservar código/datos.

### L5 — guía entregada PR #56

Main `d10dd9e`, commit `40757f9`. Las notas siguientes conservan la evidencia
anterior a su entrega; sus estados de candidata/integración pendiente son históricos.

- Distribución humana aprobada: repositorio en commit fijo de aplicación
  `834a1be47585c150d8068aa75308718b530c45cb`, sin ZIP/npm global/release.
  LOCAL.md todavía no existe en ese checkout; integración documental pendiente.
- Exportación limpia de HEAD a temporal del sistema (no clon remoto comprobado),
  Node 22.20.0 y rutas con espacios; sin instalación de dependencias/datos reales.
- Verificación independiente FAIL bloqueante del backup anterior: el recorrido
  normal deja WAL/SHM tras dashboard readonly y el guard impedía respaldar.
  El probe previo copió antes de readonly; no demostraba el orden de la guía.
- Corrección sólo documental: `node:sqlite backup()` async con fuente existente
  readonly, destino reservado nuevo, Promise esperada y cierre en finally.
  Backup y restore usan snapshots, no copia del archivo principal ni borrado WAL.
- 31 checks en PowerShell: plan sin SQLite, arrays import/reimport 2/0 nuevos y
  2 duplicados; report global 2/48 tokens, sesión 1/29; dashboard HTTP y cierre
  dejan sidecars presentes antes de backup; restore nuevo, snapshots readonly
  idénticos y hashes de fuente/base original conservados. GET/POST de selección
  frescos, recarga cacheada, HTTP 200 y puertos cerrados. Fuente de backup ausente
  no crea fuente/destino; destino existente falla sin sobrescribirlo.
- Reverificación independiente PASS en el orden normal, sin alterar la receta:
  un registro/15 tokens, reimportación 0 nuevos/1 duplicado; snapshots completos
  original/backup/restored iguales, WAL/SHM presentes, HTTP 200 y puertos cerrados.
  Destino existente intacto, fuente ausente sin creación y corrupción real con
  fallo async sanitizado; handles cerrados y hashes originales preservados.
- Ayuda/demo sin DB y errores de importación se comprobaron en el probe previo.
  Suite previa en exportación 149/149, no repetida por este fix documental;
  warnings SQLite/MockTimers y file symlink EPERM (junctions aprobados).
  Sin visual/teclado ni Ctrl+C físico: cierre por terminación de proceso Windows.
  TDD N/A: docs; FAIL funcional previo → PASS corregido no es RED de una feature.
- Rollback de esta unidad: sólo diff LOCAL.md/README.md/ROADMAP.md; preservar
  código, fuentes y datos. Revisión, integración y cierre de L5 quedan pendientes.

### L4-B — evidencia ampliada entregada PR #55

Entrega: main `834a1be`, commit `7d81bc0`. Las notas siguientes conservan la
verificación histórica previa a la entrega, no una nueva lectura de datos.
Base de esa verificación: main `e7b1dbe`, PR #54 integrado, commit documental `86c228e`.
Captura: 2026-10-09 19:08:47 UTC. Verificador independiente: 82 comprobaciones
aprobadas. Sin cambios de código ni defectos detectados; TDD RED no aplica.

- Se examinaron 201 registros de tareas y 36 cabeceras del proyecto: 47/47 tareas
  retenidas vinculadas fueron importadas, con estado metadata `completed`.
  Cuatro raíces y 46 sesiones originales, 14.631.982 bytes; sin hijos faltantes
  ni exclusiones por estado. Se excluyeron 154 registros ajenos o sin vínculo.
- Manifiesto temporal privado con sólo `id`, `sessionPath`, `agent`,
  `parentSessionId`: cada uno de los 47 registros contrastado con su original,
  sin cambiar localizadores, copiar conversaciones ni recorrer globalmente hijos.
  El CLI recibió ese directorio de metadatos explícito; no es una nueva función
  de captura automática ni un descubrimiento global de la aplicación.

| Agente | Tareas importadas | Registros propios | Tokens exactos |
| --- | --- | --- | --- |
| `unknown` | — | 369 | 31.277.286 |
| `gentle-ai-worker` | 7 | 159 | 8.035.744 |
| `gentle-ai-verify` | 8 | 134 | 6.091.254 |
| `flow-pr` | 10 | 100 | 1.175.758 |
| `gentle-ai-explore` | 3 | 37 | 903.179 |
| `flow-commit` | 9 | 74 | 776.716 |
| `flow-branch` | 10 | 29 | 201.172 |

- Total: 902 registros, 48.461.109 tokens; lectura independiente BigInt,
  normalización persistida, conteos, categorías y rankings idénticos al origen.
  Input 2.127.500, output 279.977, cache read 46.053.632, cache write 0.
  Sin registros copiados, ambiguos, incompletos, pendientes, malformados,
  conflictivos ni excluidos en esta captura.
- Modelos: 901 assistant, `openai-codex / gpt-6.1-sol`, 48.378.647 tokens;
  una compaction, proveedor/modelo `null`, 82.462 tokens. No se toma un default.
  Agentes y modelos representan los mismos registros: no se suman entre sí.
  Raíces sin nombre de agente siguen como `unknown`.
- Planes deterministas, arrays `importArgs` con `shell:false`. Reimportaciones:
  cero inserciones, 31/739/77/55 duplicados por raíz; accounting/rankings estables.
  CLI/API/snapshots readonly globales y por raíz coinciden. GET, POST de sesión
  y recarga HTTP 200; orden, modelos y detalle conjunto contrastados con API.
  Sin IDs/rutas privados reflejados, HTML retenido ni escrituras manuales.
- Costos manuales nulos: siete grupos sin precios; compaction con identidad de
  proveedor/modelo desconocida. Runtime moneda/total nulos por moneda no
  registrada; 902 estimaciones con moneda desconocida. No es facturación.
- Hashes SHA-256 de 46 sesiones y 47 tareas originales iguales antes de planificar
  y al finalizar HTTP, 19:08:48.091–19:08:55.602 UTC. Entre dos capturas estables
  aparecieron dos registros de verify y 218.849 tokens; sólo se informa la última,
  sin mezclar snapshots ni afirmar cierre de sesiones o estabilidad futura.
- Cobertura histórica sigue `complete:false`, `referenceCoverage:"not-inspected"`
  y denominador de tareas eliminadas desconocido. 47/47 describe esta captura
  retenida, no todo el consumo histórico ni todo agente configurado o existente.
- Sintaxis CLI/selection/ledger/dashboard/dashboard-report y diff aprobados.
  Suite previa 149/149, no repetida en esta continuación; browser no comprobado
  aquí, HTTP sí. Base/manifiesto/evidencia permanecen fuera del repo en temporal.
  Rollback: sólo este diff de `ROADMAP.md`; preservar producto, fuentes y datos.
  Sin commit/push/entrega implícitos; L4 espera integración de la evidencia.

### L4-B — contraste de cobertura parcial (histórico, ampliación resuelta)

Estas notas conservan la captura previa de cobertura; las cifras nuevas están
arriba. No describen el inventario retenido actual.

El usuario señaló agentes ausentes. Se contrastaron 200 tareas retenidas y
36 cabeceras del proyecto, excluyendo tareas ajenas o sin vínculo. Hay seis
agentes observados; sólo siete de 42 tareas vinculadas fueron importadas.

| Agente | Tareas retenidas / importadas |
| --- | --- |
| `flow-branch` | 9 / 2 |
| `flow-commit` | 8 / 2 |
| `flow-pr` | 8 / 2 |
| `gentle-ai-worker` | 7 / 1 |
| `gentle-ai-explore` | 3 / 0 |
| `gentle-ai-verify` | 7 / 0 |

Son conteos de metadatos, no tokens ni inventario histórico completo. Falta
importar la raíz que contiene explore/verify: el helper admite 29 sesiones y
32 tareas, aproximadamente 11,52 MB, con los seis nombres. Sus fuentes crecieron
entre comprobaciones; no se importó ese conjunto. Debe validarse estabilidad
antes de ampliar el ranking. La retención pasó de cinco raíces vinculadas a
cuatro; la cobertura histórica sigue desconocida, no se deduce ausencia de uso.

### L4-B — evidencia real de dos muestras, alcance parcial

La evidencia siguiente sólo valida las fuentes seleccionadas, no toda la
actividad del proyecto ni todos los agentes retenidos.

Base comprobada: main `9b0226d`, PR #53 integrado, commit documental `e2d33ce`.
Permiso humano explícito: leer sólo hijos vinculados a la muestra del proyecto
bajo `~/.pi/agent/gentle-agents/sessions/`; sin búsqueda de otros proyectos.
Verificador independiente: 43 comprobaciones aprobadas, sin defectos detectados.

| Muestra | Sesiones / tareas | Registros | Tokens exactos |
| --- | --- | --- | --- |
| A | 4 / 3 | 31 | 434.944 |
| B | 5 / 4 | 77 | 2.973.821 |
| Conjunto | 9 / 7 | 108 | 3.408.765 |

- Origen leído independientemente y normalización persistida iguales, incluidos
  conteos y categorías: input 297.821, output 17.568, cache read 3.093.376,
  cache write 0. Todos los registros son uso assistant confirmado propio;
  ninguno malformado, incompleto, pendiente, conflictivo ni excluido en la muestra.
- Dos planes por muestra deterministas; sin cambios de archivos temporales antes
  de importar. `importArgs` pasado como array, `shell:false`, al import existente.
  Reimportación: cero insertados, 31 y 77 duplicados respectivamente; rankings
  y accounting sin cambios. Ninguna importación automática por `plan`.

| Agente | Registros | Tokens |
| --- | --- | --- |
| `unknown` | 41 | 1.638.996 |
| `gentle-ai-worker` | 24 | 1.331.102 |
| `flow-pr` | 21 | 228.428 |
| `flow-commit` | 16 | 170.421 |
| `flow-branch` | 6 | 39.818 |

- Los hijos se atribuyen por siete tareas completadas; ambas raíces siguen
  desconocidas. Único modelo observado: `openai-codex / gpt-6.1-sol`, 108 registros
  y 3.408.765 tokens. No se demuestra diversidad ni se infieren defaults.
- CLI/API/lecturas readonly globales y por sesión equivalentes al origen.
  Dashboard loopback GET, POST de selección y recarga: HTTP 200; orden de agentes,
  contadores de modelo y detalle conjunto contrastados con API. Sin IDs/rutas
  privados reflejados ni escrituras manuales habilitadas; sin retener HTML.
- Sin tarifas: cinco grupos de costo manual nulos/incompletos por `missingPrices`.
  Total/moneda runtime nulos por moneda no registrada, 108 estimaciones con moneda
  desconocida. Tokens útiles; sin comparación de costos ni afirmación de factura.
- Cobertura conserva `complete:false`, `referenceCoverage:"not-inspected"` y
  `missingReferencedTasks:null`. No recupera denominador ni metadatos históricos.
- Los 16 hashes de sesiones/tareas originales permanecieron iguales durante las
  comprobaciones, incluido HTTP; sesiones seleccionadas: 1.963.472 bytes.
  Base y evidencia privadas en temporal del sistema; sin copias de fuentes,
  conversaciones, prompts, argumentos de herramientas ni threads en evidencia.
- Sintaxis de CLI/selection/ledger/dashboard/dashboard-report y diff aprobados;
  suite previa 149/149, no repetida en esta continuación. TDD RED no aplica:
  validación del producto entregado, sin cambios de comportamiento ni código.
- Límites: estabilidad fuera de la ventana y cierre definitivo no probados;
  compaction/copias reales, filtro por proyecto y browser no verificados aquí.
  Rollback: sólo este diff documental en `ROADMAP.md`; preservar producto y datos.
  No commit, push ni entrega implícitos; L4 sigue abierto hasta entrega comprobada.

### L4-B — bloqueo de alcance inicial (histórico, resuelto)

Estas notas describen el momento anterior al permiso adicional; no son el estado actual.

- Examen readonly acotado: 36 cabeceras del proyecto y 200 tareas retenidas;
  cinco raíces tienen metadatos de agentes disponibles, con 42 vínculos a hijos
  fuera del directorio de sesiones autorizado. Ningún hijo leído ni sondeado.
- Hace falta autorizar sólo los hijos vinculados de la muestra en
  `~/.pi/agent/gentle-agents/sessions/`; no descubrimiento de otros proyectos.
- Raíz reciente con tres tareas flow completadas: hashes de raíz/tareas estables
  en la ventana observada; no prueba cierre definitivo. `plan` sin ampliar scope
  falla de forma determinista y sanitizada; no se intentó importar datos reales.
- `npm test`: 149/149, cero omitidos; comprobaciones de sintaxis y diff aprobadas.
  Evidencia local temporal sin conversaciones ni copias de fuentes.
- Pendientes: plan completo, igualdad de tokens/filas origen-ledger, rankings
  agente/modelo, reimportación real idempotente y comprobación de reportes.
  Sin TDD nuevo: validación del producto entregado, no cambio de comportamiento.
  No se afirma atribución útil validada ni cierre de L4.

### L4-A2 — entregado PR #52

Integrado en main `666fdad`, commit `939bd07`. Revisión nativa
`review-51ed38eb947e43f1` aprobada y reconocida sin correcciones, sobre
310 líneas. Las notas siguientes conservan la evidencia previa a la entrega.

- CLI `plan` readonly, delegación directa y JSON con receta array; sin SQLite,
  importación automática, inferencias ni datos reales. Helper A1 sin cambios.
- RED: `node --test --test-name-pattern="CLI plan" test/cli.test.js`, 0/3:
  comando válido rechazado, ayuda ausente y fallo operativo con exit 2.
  GREEN: mismo comando 3/3. Barrera loader impide ledger/SQLite y fuentes en
  ayuda/inválidos; snapshots de archivos/directorios intactos en planificación.
- Subprocess real sintético: equivalencia helper/CLI, raíz/hijo/tareas, varios
  directorios, faltantes, errores genéricos y receta manual con import existente:
  2 insertados; reimportación 0 insertados/2 duplicados, ranking conservado.
- `npm test`: 149/149; `node --check src/cli.js`,
  `node --check test/cli.test.js` y `git diff --check`: aprobados.
  Padre reconfirmó 149/149 y sintaxis/diff tras formato automático. LSP primario:
  sin errores/warnings; tres hints de inferencia de `options.session` en CLI,
  no se afirma diagnóstico completamente limpio. ASSESS: riesgo medio,
  escritor grande, `under_budget`; revisión no requerida ahora, no aprobada.
  Sólo warnings experimentales SQLite/MockTimers; junctions A1 aprobados,
  symlink de archivo EPERM y POSIX no ejecutado. Browser N/A: sólo CLI.
  Revisión y entrega pertenecen al padre.
- Rollback: retirar sólo diff A2 en `src/cli.js`, `test/cli.test.js`, `README.md`
  y `ROADMAP.md` respecto a `7251450`; preservar helper A1, historia y bases.
  Techo ordinario 400 líneas incluyendo pruebas/docs; L4-B sigue pendiente.

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
| 5. Contexto y filtros | Parcial: metadatos básicos y filtro runtime API PR #29/CLI PR #30 y costos API PR #31 y evolución API PR #32 y compuesto API PR #33 y selector de arranque PR #34 entregados; admisión interactiva A/B entregadas PR #35/#36; identidad API entregada PR #37; filtro runtime por proyecto API PR #39/CLI PR #40 entregados; costos API proyecto PR #42 y evolución API proyecto PR #43 entregados; compuesto readonly API proyecto PR #44 entregado; selector dashboard de arranque candidato | Proyecto estable entre worktrees, funcionalidad por tarea, sesión y relaciones padre/hijo |
| 6. Dashboard localhost | Demo, API readonly, UI seleccionada, evolución, detalle y semántica PR #26 y opt-in/guardado PR #27 y formulario PR #28 entregados | Vista global primero, filtros y detalle después; formulario manual de precios |

## L3 — validación real aprobada, evidencia candidata no revisada ni entregada

- Muestra autorizada de tres historiales Pi v3 de este proyecto, alias S1–S3.
  Lectura sin modificar fuentes; SQLite nueva aislada fuera del repositorio.
  No conversaciones, IDs ni rutas privadas en esta evidencia pública.

| Alias | Entradas (assistant + compaction) | Tokens conservados |
| --- | --- | --- |
| S1 | 251 + 1 | 19273446 |
| S2 | 299 + 1 | 32642641 |
| S3 | 100 + 0 | 7536751 |
| Global | 650 + 2 | 59452838 |

- Fuente y ledger coinciden: input 1261035, output 225467, cacheRead 57966336,
  cacheWrite 0. Reimportación: 0 insertados, 652 duplicados; malformed,
  incomplete, pending, conflicts y unresolved: 0. Reinicio conserva resultados.
- API global/sesión/proyecto/desconocido, evolución UTC y proyección HTTP/DOM
  conjuntas comprobadas. Validation_A agrupa S1/S2 y Validation_B S3 mediante
  mappings explícitos de prueba; no son identidad Git ni descubrimiento automático.
- Edge 154.0.4258.62 real, headless/CDP: cinco envíos con teclado, exclusión de
  alcances, desconocido vacío, inválido sin POST, vista conservada y recarga del
  proyecto inicial aprobados; cero excepciones. POST de tarifas readonly denegado.
- Baseline sin tarifas: costos totales null; 650 entradas sin tarifas completas.
  Compactions: 119264 tokens con proveedor/modelo desconocidos, sin imputación
  al modelo assistant. Agente/actor unknown, tasks 0, evidencia no-task;
  clasificación own relativa a las raíces importadas, no prueba independiente.
- Clon separado con tarifas **sintéticas**, no precios reales ni factura:
  EUR por millón input 1/output 2/cacheRead 0/cacheWrite 3. Sólo grupo assistant:
  global 1.588878000000 EUR; A 1.388699000000; B 0.200179000000.
  Ausencia USD y compactions conservan null; cero conocido comprobado.
- Verificador ejecutó harnesses Node temporales de importación, browser y precios;
  evidencia agregada y bases contables retenidas localmente fuera del repositorio,
  sin conversaciones/toolargs. SHA256/stat de fuentes y baseline readonly intactos.
  Servidor, proceso/perfil browser y scripts temporales cerrados/retirados.
- No bloqueadores observados en esta muestra. Texto de reemplazo de alcance que
  omite mencionar proyecto: hallazgo menor para clasificar en L4, sin cambio de código.
  No demuestra atribución de hijos, cobertura completa ni preparación de producción.
- Sólo validación funcional/documentación: sin implementación ni RED significativo;
  no se repitió npm test ni se afirma una nueva suite por este diff documental.
  Rollback: retirar únicamente esta actualización de `ROADMAP.md`; no tocar fuentes
  originales ni bases de validación. Entrega requiere autorización separada.

## L2-B — selector UI, entregado PR #49

Integrado en main `401f5f0`, commit `3b9e424`. Suite 140/140, 15 grupos browser
Edge 154 sintéticos y captura visual comprobados antes de entrega; revisión nativa
aprobada y reconocida. Las notas siguientes conservan el estado histórico previo.

- Base limpia `b8da4ca`; L2-A entregado PR #48 (`d3b4e65`). Sólo formulario
  estático existente: proyecto ASCII literal 1–64, sin trim/normalización;
  global/sesión/proyecto exclusivos, modo desconocido sin fetch.
- Controles nativos etiquetados y status polite; pending/doble envío, restauración,
  inputs/precios y reemplazo atómico conservados. Sin interceptar foco/teclado;
  hash exacto CSP automático, gating readonly/opt-in/demo sin cambios.
- RED VM/SSR significativo: payload sesión en vez de proyecto y opción ausente.
  GREEN VM/SSR: límites ASCII/UTF-16, invalidación sin fetch, exclusión, pending,
  errores/recovery, DOM inseguro/duplicado y gating/hash exacto.
- `node --test --test-name-pattern="session filter client|manual form gating" test/dashboard.test.js`:
  RED 0/2; GREEN final 2/2. Intermedio 1/2 por aserción de pattern ajena al selector,
  corregida sólo en test. `npm test`: 140/140, reconfirmado tras triangulación.
  Regresión `node --test --test-name-pattern="session filter|price HTTP|dashboard project|manual form" test/dashboard.test.js`: 20/20.
  Sintaxis de ambos JS y diff check OK; diagnósticos de edición tests/docs limpios,
  sin herramienta LSP independiente disponible. Sólo warnings SQLite/MockTimers.
- Verificación actual browser/teclado pendiente del padre; no se afirma ejecutada.
  Sin datos reales, esquema/deps, dashboard/ledger/report ni Git mutación.
- Rollback sólo diff L2-B respecto a `b8da4ca` en `src/session-filter-form.js`,
  `test/dashboard.test.js`, `README.md` y `ROADMAP.md`; conservar L2-A e historia.
  Forecast previo 240–320 líneas, techo duro 400 incluidas pruebas/docs.

## L2-A — conexión HTTP privada, entregado PR #48

Integrado en main `b8da4ca`, commit `d3b4e65`. Evidencia histórica del candidato;
no revisa ni entrega L2-B.

- Base limpia `ada499e`; L1 entregado PR #47 (`c71ac11`). Handler existente
  acepta proyecto validado antes de storage y delega al compuesto readonly.
  Misma proyección pública/SSR y alcance de ranking/costos/evolución/detalle;
  sin clasificación duplicada ni postfiltro. Desconocido vacío, literal case-sensitive.
- Cada envío reemplaza alcance; GET conserva snapshot de arranque. Cierre antes
  de respuesta; invalidación sin storage y fallo 500 sin IDs/rutas. Global/sesión,
  precios/demo y barreras Host/Origin/cuerpo/CSP conservados.
- Pruebas HTTP loopback con SQLite sintético: equivalencia conjunta, valores
  grandes/cero/null, detalle/evolución, frescura, no escritura, barreras y errores.
  No UI nueva ni validación browser/teclado: L2-B pendiente, L2 no completo.
- RED/GREEN: `node --test --test-name-pattern="session filter project HTTP" test/dashboard.test.js`:
  RED 0/1, proyecto válido cerrado con `ECONNRESET`; GREEN 1/1.
- Regresión: `node --test --test-name-pattern="session filter|price HTTP|dashboard project" test/dashboard.test.js`
  18/18; `node --test test/dashboard.test.js` 39/39; `npm test` 140/140.
  `node --check src/dashboard.js`, `node --check test/dashboard.test.js` y
  `git diff --check`: OK. Warnings experimentales SQLite/MockTimers únicamente.
- Diagnósticos automáticos de edición tests/docs limpios; sin runner LSP primario
  independiente disponible al escritor ni build definido. Evidencia sintética,
  no aprobación nativa. Forecast 260–340 líneas; revisión/entrega del padre.
- Rollback: retirar sólo diff L2-A en `src/dashboard.js`, `test/dashboard.test.js`,
  `README.md` y `ROADMAP.md` respecto a `ada499e`; preservar L1, bases e historia.
  Sin esquema/deps/captura, datos reales, commit ni entrega. Techo duro 400 líneas.

## L1 — admisión interna de proyecto, entregado PR #47

Integrado en main `ada499e`, commit `c71ac11`. Evidencia histórica del candidato;
la barrera HTTP descrita abajo corresponde a L1, no al candidato L2-A actual.

- Parser privado: `{}` global, `{session}` literal existente o `{projectId}`
  ASCII literal 1–64; extras/tipos inválidos y ambos selectores se rechazan.
  Reutiliza validación de arranque, sin ledger/esquema/deps ni datos reales.
- Barrera explícita del handler: incluso proyecto válido se rechaza antes de
  cargar/abrir storage. HTTP/UI proyecto sigue pendiente de L2; demo/precios,
  CSP, snapshots y global/sesión conservados. Browser N/A: sin HTTP/UI nuevo.
- RED: `node --test --test-name-pattern="session filter project" test/dashboard.test.js`
  1/2; proyecto válido rechazado. GREEN: mismo comando 2/2. Intento intermedio
  1/2 por una aserción de PassThrough autoDestroy, corregida sólo en el test.
- Regresión: `node --test --test-name-pattern="session filter|price HTTP|dashboard project" test/dashboard.test.js`
  17/17; incluye barrera HTTP readonly/opt-in con cero llamadas storage y reset
  de transporte, válidos/límites/literalidad, extras/exclusión y admisión previa.
- Verificación: `node --test test/dashboard.test.js` 38/38; `npm test` 139/139.
  `node --check src/dashboard.js`, `node --check test/dashboard.test.js` y
  `git diff --check`: OK. Sólo warnings experimentales de SQLite/MockTimers.
- Padre: suite reconfirmada 139/139 tras formato; LSP primario y diagnósticos
  de sesión sin errores. ASSESS: medio, escritor grande, `under_budget`, sin
  verificador separado requerido; candidato no revisado ni entregado.
- Rollback: retirar sólo el diff L1 en `src/dashboard.js`,
  `test/dashboard.test.js`, `README.md` y `ROADMAP.md`; conservar entregas,
  bases y artefactos sintéticos. Techo duro 400 líneas incluidas pruebas/docs.
- No entrega ni aprobación afirmada; L2–L6 no implementados por esta unidad.

## Selector dashboard de proyecto al arrancar — candidato no revisado ni entregado

- Base limpia main `655a15e`, compuesto PR #44 (`d46fb5c`) integrado.
- API `projectId` y CLI `--project ID`: ASCII literal 1–64, exclusivo con sesión,
  incompatible con demo; validación antes de storage/listen y errores sanitizados.
- Delega al compuesto entregado; etiqueta SSR sin ID/path. POST sesión/global
  reemplaza alcance, no lo combina; recarga restaura snapshot de arranque.
- Sólo sintéticos: equivalencia API/CLI, límites/case/vacío, opt-in/readonly,
  cierre antes de listen, snapshot estático y conservación de precios/CSP.
- Sin esquema/deps/ledger, datos reales, rutas/forms de proyecto ni publicación.
  Browser visual y accesibilidad pendientes; revisión/entrega pertenecen al padre.
- Rollback: sólo diff de dashboard, dashboard-report, dashboard tests y estas docs
  respecto a `655a15e`; preservar entregas y artefactos sintéticos.
- RED: `node --test --test-name-pattern="dashboard project" test/dashboard.test.js`
  0/2: scope ignorado y 17 accesos storage frente a cero. GREEN: mismo comando 2/2.
- `node --test test/dashboard.test.js`: 36/36; `npm test`: 137/137.
  `node --check` en los tres JS cambiados y `git diff --check`: OK.
  LSP primario no disponible al escritor; diagnósticos de edición JS limpios.
- Techo 400 líneas formateadas incluidas pruebas/docs; evidencia sólo sintética.

## Compuesto readonly API por proyecto — entregado PR #44 (evidencia histórica)

PR #44 integrado en main `655a15e`, commit `d46fb5c`.
Las notas siguientes conservan la evidencia histórica del candidato anterior.

- Base limpia main `f546be9`; evolución PR #43 (`547cda6`) entregada.
- [x] Validación propia estricta antes de SQL: moneda requerida, proyecto ASCII
  literal 1–64, selector sesión/proyecto exclusivo; global/sesión conservados.
- [x] Mismo selector para runtime/costos/evolución dentro de una única transacción
  readonly existente; sin duplicar clasificación ni postfiltrar resultados.
- [x] Helpers existentes conservan membresía entre worktrees y linaje completo,
  incluidos padres externos, copias y origen desconocido.
- [x] Fixtures reutilizados: equivalencia de las tres APIs, unmapped/unknown,
  aliases/case, vacío/cero/grandes/null, montos completos o null, detached,
  validación sin SQL, commit independiente, cierre/recovery y esquema legado.
- RED/GREEN: `node --test --test-name-pattern="dashboardReport|readonly dashboard allowlist|tokenEvolution project membership|project identity readonly" test/audit.test.js`;
  RED 3/8 (cinco rechazos `Invalid dashboard report` para proyectos válidos),
  GREEN 8/8.
- Triangulación/regresión: `node --test --test-name-pattern="dashboardReport|readonly dashboard|tokenEvolution|costReport|runtimeReport project|project identity readonly" test/audit.test.js`: 26/26.
- `npm test`: 135/135; `node --check src/ledger.js` y
  `node --check test/audit.test.js`: OK. `git diff --check`: OK.
  Evidencia sólo sintética; sin datos reales.
- Sin UI/HTTP/CLI, esquema/deps/captura ni cambios de exposición RW.
  Runtime/browser N/A: API-only, probado funcionalmente con SQLite sintético.
- Rollback: sólo el diff de ledger, audit tests y estas dos docs respecto a
  `f546be9`; preservar entregas e historia. Temporales sintéticos autorizados
  exclusivamente bajo `test/.runtime-*`; no son nuevas fixtures permanentes.
- Forecast 300–350 líneas formateadas; actual 275 (225 adiciones + 50
  eliminaciones); techo 400 incluidas pruebas/docs.
  Revisión y entrega pertenecen al padre; candidato sin aprobación afirmada.

## Evolución API por proyecto — evidencia histórica (entregada PR #43)

PR #43 integrado en main `f546be9`, commit `547cda6`.
Las notas siguientes conservan evidencia del candidato anterior.

- Base main `7a9a582`; costos PR #42 (`d71721c`) entregados.
- Sólo `tokenEvolution({ projectId })`: global/sesión conservados y exclusión mutua.
- Membresía compartida con runtime/costos; linaje completo y selección en un snapshot.
- Sintéticos: worktrees, aliases/case, mapping tardío/cambio, padres externos,
  copia/linaje desconocido/ambiguo, fechas inválidas/ausentes, null/cero/grandes,
  proyectos vacíos, validación antes de SQL, recuperación y commit independiente.
- RED/GREEN: `node --test --test-name-pattern="tokenEvolution project" test/audit.test.js`;
  RED 0/3 (`Invalid token evolution` para proyectos válidos), GREEN 3/3.
- Regresión `node --test --test-name-pattern="tokenEvolution|costReport|runtimeReport project" test/audit.test.js`: 18/18;
  `npm test`: 134/134. Sólo evidencia sintética API, no validación real.
- Sin aprobación nativa ni entrega afirmada; revisión y entrega pertenecen al padre.
- Browser N/A (API); sin UI/CLI/compuesto, exposición readonly, esquema/deps,
  captura ni sesiones reales. Rollback sólo del diff de los cuatro archivos
  autorizados respecto a `7a9a582`; preservar bases e historia.

## Filtro costos API por proyecto — evidencia histórica (entregado PR #42)

- Base limpia main `10043b5`; alcance limitado a ledger, audit tests y estas dos docs.
- Moneda requerida; global/sesión conservados, proyecto exclusivo ASCII literal.
- Membresía runtime compartida; linaje completo antes de seleccionar en un snapshot.
- RED: `node --test --test-name-pattern="costReport project" test/audit.test.js`,
  0/3; todos rechazaron proyectos válidos con `Invalid cost report`. GREEN: 3/3.
- Sintéticos: worktrees, aliases, case, padre externo/copia, mapping tardío/reinicio,
  null/cero/grandes exactos, vacío, no mutación y commit independiente.
- Regresión `node --test --test-name-pattern="costReport|runtimeReport project" test/audit.test.js`: 11/11;
  `npm test`: 131/131; `node --check src/ledger.js`, `node --check test/audit.test.js`: OK.
- Diagnósticos: ocho hallazgos de estilo preexistentes fuera del diff; cobertura ledger parcial.
  Sin aprobación nativa afirmada; formato manual local, sin formatter global.
- Sin CLI/UI/evolución/compuesto, esquema/deps/captura/datos reales. Browser N/A.
- Rollback sólo del diff de `src/ledger.js`, `test/audit.test.js`, `README.md` y
  `ROADMAP.md` respecto a `10043b5`; preservar entregas, bases e historia.
- Techo 400 líneas formateadas; evaluación/revisión/entrega pertenecen al padre.

## Filtro runtime CLI por proyecto — entregado PR #40 (evidencia histórica)

PR #40 (`8203814`) integrado; refactor PR #41 (`ee3d657`) en main `10043b5`.
Las notas siguientes conservan evidencia del candidato anterior, no su estado actual.

- Base limpia main `86a283d`; API PR #39 entregada (merged `d4d86a7`).
- Único `report --project ID`, ASCII literal case-sensitive de 1–64 caracteres;
  mutuamente excluyente con sesión. Delegación directa, sin postfiltro JSON.
- Duplicados/faltantes/inválidos/ambos selectores fallan antes de almacenamiento;
  errores sin IDs/paths. Import/costs/global/sesión conservados.
- Pruebas subprocess sintéticas: límites/case, worktrees, unknown/unmapped/aliases,
  padre externo copiado/no resuelto, cero/faltantes y fallos sanitizados.
- RED: `node --test --test-name-pattern="CLI report project" test/cli.test.js`,
  0/2; ayuda sin flag y selector válido rechazado con exit 2.
- GREEN: mismo comando, 2/2. Ajustes intermedios sólo de fixtures: modelo del
  padre copiado y tolerancia al warning experimental de SQLite en stderr.
- Verificación del escritor: `npm test` 128/128; `node --check src/cli.js`,
  `node --check test/cli.test.js` y `git diff --check` aprobados.
- Padre confirmó `npm test` 128/128, sintaxis y diff check aprobados;
  diff previo tras formato: 228 líneas (211 adiciones + 17 eliminaciones).
- LSP primario: sin errores ni warnings; tres hints TS por objeto dinámico
  de sesión. Lens: sin hallazgos bloqueantes en todos los archivos.
- ASSESS nativo: riesgo medio, escritor runtime grande, `under_budget`,
  `reviewDue: false`; autoverificación suficiente, sin verificador separado requerido.
  Outcome desconocido; no aprobación nativa ni revisión obligatoria afirmadas.
- Diff final con esta nota: 235 líneas (218 adiciones + 17 eliminaciones).
- Rollback: retirar sólo este diff respecto a `86a283d` en `src/cli.js`,
  `test/cli.test.js`, `README.md` y `ROADMAP.md`; preservar API PR #39,
  historia, bases y artefactos sintéticos. Sin migraciones/cambios de datos.
- Sin UI/costos/evolución/esquema/deps/datos reales/publicación. Revisión nativa
  y entrega pertenecen al padre; esta evidencia no las sustituye.

## Filtro runtime por proyecto — API entregada PR #39 (evidencia histórica)

- Entregado sobre main `86a283d`, merged `d4d86a7`; base anterior `a1fc334`
  (PR #38); identidad entregada PR #37, merge `7f52101`, commit `15bdaad`.
- Selección explícita y case-sensitive; todos los locators cuentan antes del mapping.
- Membresía dentro de la transacción; snapshot completo conserva padres externos.
- Pruebas sintéticas: worktrees, aliases, montos cero/grandes/faltantes, validación,
  reinicio/mapping tardío, tabla opcional, recovery y commit independiente coherente.
- RED observado: `node --test --test-name-pattern="runtimeReport project" test/audit.test.js`,
  0/4; los cuatro fallaron por `Invalid runtime report` antes de implementar.
- GREEN final: mismo comando, 4/4; `npm test` 126/126 (base del padre: 122/122).
- `node --check src/ledger.js` y `node --check test/audit.test.js`: aprobados;
  `git diff --check`: aprobado. Sin formatter global ni runner LSP primario disponible.
- Diagnósticos automáticos: JS clean en escrituras; avisos preexistentes de ternarios
  y cobertura ast-grep parcial en ledger, no evidencia de LSP completo.
- Rollback: retirar sólo los diffs de `src/ledger.js`, `test/audit.test.js`,
  `README.md` y `ROADMAP.md`; sin migraciones ni cambios de datos.
- Browser N/A (API-only); no datos reales ni cambios CLI/dashboard/costos/evolución.
- Revisión nativa y entrega pertenecen al padre; esta evidencia no las sustituye.

## Identidad declarada de proyecto — API entregada PR #37 (evidencia histórica)

- Mapping explícito path hash → ID ASCII literal; sin leer locator/cwd ni descubrir Git.
- Binding inmutable/idempotente; conflicto revierte toda la importación y su reporte.
- Reader de snapshot: missing/unmapped/ambiguous conservadores; readonly legado sin repair.
- No cambia tareas, atribución histórica, accounting, CLI/UI ni dependencias.
- RED: patrón `project identity`, 0/4; API/tabla ausentes, validación/conflicto faltantes.
- GREEN inicial: mismo patrón, 4/4; reinicio, privacidad, aliases y rollback sintéticos.
- Final: `npm test` 122/122; sintaxis de ambos JS aprobada. Primer suite 120/122:
  dos allowlists readonly actualizadas al reader nuevo. Sin revisión nativa.
- LSP primario no disponible; diagnósticos automáticos parciales y avisos de estilo
  preexistentes fuera del diff. Browser N/A; no formatter global ejecutado.
- Browser N/A: API-only. Datos reales no autorizados; entrega/revisión del padre.
- Rollback sólo de este diff en `src/ledger.js`, `test/audit.test.js`, `README.md`,
  `ROADMAP.md`; preservar código/datos anteriores. Techo 400 líneas formateadas.

## Filtro interactivo — unidad B entregada PR #36

Main `52f33ed`, commit `1c64a66`. La evidencia siguiente es histórica de B,
no revisión ni autorización de identidad de proyecto.

- Ruta POST exacta y formulario en readonly/opt-in; demo fijo y scriptless. Parser A sin cambios semánticos, sin IDs reflejados ni selectores en URLs.
- Cada envío abre readonly y lee un reporte conjunto fresco (incluye importaciones/tarifas posteriores); cierre antes de respuesta. Sin polling ni selección compartida: GET/recarga restaura snapshot/alcance de arranque.
- DOMParser valida status/HTML y región scriptfree de reporte/alcance antes del reemplazo único; formularios fuera conservan controles/handlers/feedback. Pending bloquea doble envío; fallos conservan vista, sin retry.
- CSP seleccionada con hash exacto del filtro, más hash manual sólo opt-in; connect self. Default/frame/base/form-action none conservados.
- Excepción exclusiva B: exactamente 510 líneas formateadas incluidas pruebas/docs, autorizadas tras el recuento final; no amplía límites futuros. Rollback sólo del diff B en las seis superficies autorizadas, preservando entregas/bases/historia.
- RED observado: patrón enfocado 13/15, faltan formulario y módulo cliente. GREEN/triangulación 15/15: equivalencia conjunta literal/global/vacío, frescura sintética, barreras, cierres/fallos, hashes y cliente pending/DOM/fallos; suite 118/118.
- Verificación independiente: 118/118, sintaxis y diff limpios; Edge aislado 154.0.4258.53 con SQLite sintético, 21 comprobaciones funcionales aprobadas; temporales propios eliminados. LSP primario limpio. Revisión del candidato funcional `review-b1bfded02121f761` aprobada y reconocida antes de esta actualización documental; en ese momento sin entrega ni validación visual, de accesibilidad o de sesiones reales.

## Filtro interactivo — unidad A entregada PR #35

La evidencia siguiente conserva el candidato inactivo previo a la entrega de A; no describe la activación B actual.

- Alcance autorizado: parser `parseSessionFilterRequest`, admisión/cuerpo compartidos con precios, pruebas sintéticas y docs; sin almacenamiento, ruta activa, UI, CSP, dependencias ni esquema.
- JSON `{}` global o única clave propia `session`: literal no vacío ≤512 UTF-16; extras inválidos. Host/Origin exactos, duplicados rechazados, JSON ≤8192 bytes, UTF-8 fatal, deadline absoluto 5s y cleanup; errores sin IDs.
- Demo/readonly conservan GET `/session-filter` 404 y POST 405; opt-in conserva rechazo de transporte para POST ajeno. `--session` entregado sigue intacto.
- RED observado: `node --test --test-name-pattern='session filter HTTP' test/dashboard.test.js`, 1/5 pasa y 4 fallan por helper ausente. GREEN: `node --test --test-name-pattern='session filter HTTP|price HTTP' test/dashboard.test.js`, 11/11, incluyendo regresiones de precios y lifecycle.
- Verificación del escritor: `npm test` 116/116; `node --check src/dashboard.js`, `node --check test/dashboard.test.js` y `git diff --check` aprobados. El padre confirmó LSP primario de ambos JS sin diagnósticos; sin build definido en `package.json`.
- Diff final tras formato automático: 311 líneas (296 adiciones + 15 eliminaciones); sin comprimir ni retirar pruebas/comentarios para cumplir el techo.
- Rollback: sólo el diff de A en `src/dashboard.js`, `test/dashboard.test.js`, `README.md`, `ROADMAP.md`; preservar PR #34, bases y entregas previas. Techo 400 líneas formateadas, incluidas pruebas/docs.
- Unidad B y sesiones reales pendientes de autorización separada; browser N/A porque A no cambia UI. Revisión y entrega pertenecen al padre.

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

## Filtro runtime API por sesión — entregado PR #29 (`619654b`, commit `4a3eb2e`)

- Primera API aprobada: `{}` global intacto o única clave propia `session`, texto no vacío de hasta 512 unidades UTF-16; literal sin trim/casefold, extras propios rechazados antes de SQL.
- Clasificación del linaje completo primero; luego todas las vistas/coberturas sólo de la sesión seleccionada. Padres externos conservan evidencia; ID desconocido devuelve shape vacío existente.
- Pruebas sintéticas: grandes/cero/faltantes, continuaciones y atribución conflictiva, copias/hijos no resueltos, sesiones ambiguas, reinicio/detach, no mutación, errores sanitizados y snapshot con commit independiente.
- Evidencia del escritor: `node --test --test-name-pattern=runtimeReport test/audit.test.js` RED 3/6 (tres rechazos esperados de sesión), GREEN 6/6; `npm test` 100/100; `node --check src/ledger.js`, `node --check test/audit.test.js` y `git diff --check` aprobados. Evidencia histórica del escritor; revisión nativa `review-ac9fb5a8946953ce` aprobada y acknowledged antes de la entrega PR #29. No revisa el nuevo candidato evolución API.
- Esta entrega API no añadió filtros CLI/dashboard, mapping de repositorios, sesiones automáticas, datos reales, dependencias ni esquema.
- Rollback sólo de este diff en `src/ledger.js`, `test/audit.test.js`, `README.md`, `ROADMAP.md`; preservar PR #28, bases y artefactos. Techo 400 líneas formateadas incluidas pruebas/docs.

## Filtro runtime CLI por sesión — entregado PR #30 (`63bdcdb`, commit `3cefedb`)

Entrega comprobada en Git; la evidencia siguiente es histórica, no revisión del filtro evolución API actual.

- Sobre API PR #29: global `{}` intacto o un selector literal no vacío de hasta 512 unidades UTF-16; sin trim/casefold. ID desconocido: éxito con shape vacío existente.
- CLI delega a `runtimeReport`; no replica clasificación ni filtra JSON. Linaje externo disponible antes de seleccionar; vistas/cobertura aisladas.
- Duplicados, faltantes, vacío y exceso fallan antes de abrir almacenamiento; parser conserva rechazo de valores que empiezan con `--`, sin sintaxis equals. Import mantiene archivos repetibles; costs rechaza sesión.
- Sintéticos subprocess: equivalencia API/global, IDs literales/límites, cobertura, padre externo/copia/no resuelto, errores sanitizados, ayuda y regresiones import/costs.
- RED: `node --test --test-name-pattern='CLI report session' test/cli.test.js` 0/3 (ayuda sin selector y dos rechazos de sesión). GREEN 3/3; intento intermedio 1/3 por dos expectativas de fixture corregidas (cost dentro de usage y certeza `copied`).
- Verificación: `npm test` 103/103; `node --check src/cli.js`, `node --check test/cli.test.js` y `git diff --check` aprobados. Formato manual local, sin formatter global.
- Sin ledger/esquema/deps/dashboard/captura/datos reales. Entrega PR #30 comprobada; no se infiere revisión actual de la evidencia histórica.
- Rollback sólo de este diff en `src/cli.js`, `test/cli.test.js`, `README.md`, `ROADMAP.md`; preservar API PR #29, bases y artefactos. Techo duro 400 líneas formateadas incluidas pruebas/docs.

## Filtro costos API por sesión — entregado PR #31 (`00d82b1`, commit `df78f9e`)

Entrega comprobada en Git; la evidencia siguiente es histórica del escritor,
no revisión ni aprobación del candidato evolución API.

- Global `{currency}` intacto; selector propio opcional literal no vacío ≤512 UTF-16, sin trim/casefold. Moneda explícita; extras propios (símbolos/no enumerables incluidos) inválidos antes de SQL.
- Snapshot completo y clasificación de linaje antes de seleccionar; coberturas, exclusiones y cotizaciones sólo de filas seleccionadas. Sesión desconocida: shape vacío con moneda solicitada.
- Pruebas sintéticas: literalidad/límites/claves, linaje externo/tardío, copias/no resueltos/ambigüedad/conflictos, grandes/cero/null, detached/reinicio/no mutación y commit independiente durante snapshot.
- RED observado: `node --test --test-name-pattern=costReport test/audit.test.js` 0/4, rechazo esperado de sesión. GREEN 4/4; intermedio 3/4 por intento de asignar propiedad configurable pero no writable, corregido sólo en la prueba.
- Verificación: `npm test` 104/104; `node --check src/ledger.js`, `node --check test/audit.test.js` y `git diff --check` aprobados. Diff final tras formato: 227 líneas (203 adiciones + 24 eliminaciones); suite 104/104 y sintaxis/diff check reconfirmados por el padre, LSP primario sin errores. Sin aprobación nativa afirmada por esa evidencia; historial PR #29/#30/#28 no revisa unidades posteriores.
- Próximas propuestas: evolución API → compuesto en snapshot único → UI. No cambia runtime/evolución/dashboard/CLI, precios, esquema, dependencias, captura ni autorización de datos reales.
- Rollback sólo de este diff en `src/ledger.js`, `test/audit.test.js`, `README.md`, `ROADMAP.md`; preservar entregas, bases y artefactos. Techo 400 líneas formateadas, incluidas pruebas/docs.

## Filtro evolución API por sesión — entregado PR #32 (`b537af8`, commit `b3f9aa1`)

Entrega comprobada en Git. La evidencia siguiente es histórica y no aprueba el
nuevo candidato compuesto; se conserva el estado previo a integrar PR #32.

- Global `{}` compatible o única clave propia `session`, literal no vacía ≤512 UTF-16; sin trim/casefold/normalización. Extras propios y valores inválidos rechazados antes de SQL.
- Snapshot y clasificación completa antes de seleccionar; buckets UTC, undated y cobertura/exclusiones sólo seleccionados. ID ausente: shape vacío; exactitud BigInt/string y copias independientes intactas.
- RED: `node --test --test-name-pattern=tokenEvolution test/audit.test.js` 1/4; tres rechazos de selectores válidos. GREEN 4/4: Unicode/espacios/límites/null, linaje externo/tardío, grandes/undated, reinicio/no mutación, commit independiente y recuperación read/commit/rollback.
- Verificación del escritor: `npm test` 106/106; `node --check src/ledger.js` y `node --check test/audit.test.js` aprobados. Diagnósticos automáticos de tests/docs limpios; cuatro avisos de ternarios anidados en ledger preexistente fuera del diff, sin refactorizarlos.
- Padre postformato: suite 106/106, sintaxis en ambos JS, `git diff --check`, LSP primario y diagnósticos de sesión sin errores; diff medido antes de esta nota: 282 líneas (253 adiciones + 29 eliminaciones). ASSESS: riesgo medio, escritor grande, autoverificación suficiente, sin verificador independiente requerido; revisión nativa no vencida (`under_budget`), candidato no revisado ni entregado.
- No cambios dashboard compuesto/UI/CLI/otros reportes, esquema/deps, captura ni datos reales. Browser/build N/A por API; tests funcionales sintéticos. Revisión y entrega posteriores no autorizadas por esta unidad.
- Rollback sólo de esta unidad en `src/ledger.js`, `test/audit.test.js`, `README.md`, `ROADMAP.md`; preservar entregas, bases y artefactos. Techo 400 líneas formateadas incluyendo tests/docs.

## Filtro compuesto dashboard API por sesión — entregado PR #33 (`02aaa49`, commit `fab58d5`)

Entrega informada por el padre sobre la base limpia. La evidencia siguiente es
histórica del escritor; no revisa ni aprueba el selector de arranque actual.

- `{currency}` global compatible; selector propio opcional literal no vacío ≤512 UTF-16, sin trim/casefold/normalización. Extras propios (símbolos/no enumerables incluidos) fallan antes de SQL.
- Propagación a runtime/costos/evolución en un único snapshot diferido existente; linaje completo antes de selección, padres externos como evidencia. Desconocido: shapes vacíos y moneda explícita. Fronteras readonly/openLedger intactas.
- RED: `node --test --test-name-pattern='readonly dashboard|dashboardReport' test/audit.test.js` 3/6; tres rechazos esperados de selectores válidos. GREEN 6/6; intermedio 5/6 por fixture grande con subconjuntos incompatibles, corregida sólo en test.
- Sintéticos: equivalencia standalone/global, literalidad/Unicode/límites, BigInt, copias/padre externo, vacío, detached/reinicio/no mutación, fallos read/commit/rollback sanitizados y recuperación. Commit independiente entre subreportes para global y dos sesiones.
- Verificación: `npm test` 109/109; `node --check src/ledger.js`, `node --check test/audit.test.js` y `git diff --check` aprobados. Diff final: 250 líneas (220 adiciones + 30 eliminaciones). Browser/build N/A: API sin nueva frontera UI; runtime funcional sintético en tests.
- Diagnósticos de edición: último JS/Markdown limpio; ejecuciones previas avisaron cobertura parcial y ocho hallazgos de estilo en tests preexistentes fuera del diff. Sin herramienta LSP independiente disponible ni aprobación nativa afirmada.
- Esta entrega no añadió UI/HTTP/CLI/esquema/deps/captura/datos reales. Rollback histórico sólo de este diff en `src/ledger.js`, `test/audit.test.js`, `README.md`, `ROADMAP.md`; preservar entregas/bases/artefactos. Techo duro 400 líneas formateadas incluyendo tests/docs.

## Selector de sesión al arrancar dashboard — candidato no revisado ni entregado

- CLI único `--session ID` y API opcional `session`: literal no vacío ≤512 UTF-16; sin trim/casefold/normalización, validación antes de storage/listen. CLI conserva rechazo de valores `--` y no admite demo + sesión.
- Delegación directa a compuesto PR #33; global/demo intactos, ID desconocido vacío. Sin postfiltro, clasificación duplicada ni IDs/paths en la proyección/etiqueta SSR.
- Snapshot estático, cierre readonly antes de listen y reinicio para cambiar alcance. Tarifas opt-in/POST independientes del alcance; sin rutas ni CSP nuevos.
- Pruebas sintéticas reutilizan seed/barreras: equivalencia API/CLI, literalidad/límites/tipos, grandes/cero/null, padre externo, cierre/inmutabilidad y formulario/CSP/demo. No sesiones reales ni validación visual nueva.
- RED enfocado: etiqueta/ayuda ausentes (1/3 pasa); RED prestorage: 9 lecturas frente a 0 esperadas. GREEN enfocado 3/3. Primer intento corrigió un nombre de columna del seed antes del RED funcional; no cambios al ledger.
- Verificación del escritor: dashboard 27/27, `npm test` 111/111 y `node --check` de los tres JS aprobados. Diagnósticos de edición JS/Markdown limpios; no revisión nativa ni entrega afirmada.
- Verificación posterior: suite 111/111, sintaxis de tres JS, LSP primario, diagnósticos y diff check limpios; 290 líneas antes de esta nota. ASSESS: medio, under_budget, sin verificador separado exigido. Browser real bloqueado por `window_not_focused`; visual pendiente, sin aprobación nativa ni entrega.
- Rollback sólo del diff actual en `src/dashboard.js`, `src/dashboard-report.js`, `test/dashboard.test.js`, `README.md` y `ROADMAP.md`; preservar entregas, bases y artefactos. Techo duro 400 líneas formateadas incluyendo tests/docs; revisión/entrega parent-owned.

## Formulario manual — entregado PR #28 (`bc79558`)

La evidencia siguiente es histórica de la implementación previa a integrar PR #28; no revisa el candidato evolución API actual.

- Una sola tarifa de seis campos explícitos; sólo base seleccionada y opt-in booleano true/CLI existente. Demo/readonly sin formulario, script ni conexiones.
- Script estático con hash CSP exacto y connect-src self sólo opt-in; payload decimal/UTC textual, cero preservado, feedback por textContent y controles bloqueados durante envío.
- Éxito canónico, conflicto 409 y fallos genéricos; entradas retenidas, sin reintento automático, recotización ni refresco. Precios append-only/versionados; snapshot estimado, no factura.
- RED enfocado observado 0/2: script ausente y módulo inexistente; GREEN 2/2 con CSP/gating y VM fakeDOM (pending/doble envío/cero/éxito/conflicto/operación/red/JSON inválido).
- Verificación sintética: dashboard 25/25, `npm test` 99/99 y sintaxis de los cuatro JS/diff check aprobados. Diagnósticos automáticos de edición limpios; LSP primario no disponible al escritor.
- Antes de entregar PR #28: verificación independiente con datos sintéticos en browser real Edge 154, 12 grupos y suite 99/99; revisión nativa `review-78b87faea124bc1e` aprobada y acknowledged. Evidencia histórica del formulario, no aprobación del filtro evolución API actual. Sesiones reales pendientes; no ledger/esquema/rutas/deps nuevos.
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
