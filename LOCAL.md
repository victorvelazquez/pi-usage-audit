# Usar pi-usage-audit en tu equipo

Guía local para empezar con una demo y después importar **sólo fuentes que
hayas autorizado**. No hay captura automática, servicio público ni instalación
global. Git y Node son los únicos requisitos; no ejecutes `npm install`.

## 1. Obtener una versión fija

Los comandos son para **Windows PowerShell**, desde una carpeta donde quieras
conservar el código. No pegues comandos de Bash en PowerShell. En otros sistemas
los comandos Node/Git son equivalentes, pero este recorrido no fue verificado.

```powershell
git --version
node --version
```

Necesitás Node **22.20.0 o posterior** con `node:sqlite`. Si no tenés Git o Node,
instalalos desde sus distribuidores oficiales y abrí otra terminal. El aviso
experimental de SQLite en Node 22 es esperado; no es un error de importación.

En una carpeta nueva (si ya existe `pi-usage-audit`, elegí otra carpeta padre):

```powershell
git clone https://github.com/victorvelazquez/pi-usage-audit.git
Set-Location ./pi-usage-audit
git checkout --detach 834a1be47585c150d8068aa75308718b530c45cb
git rev-parse HEAD
node src/cli.js --help
```

El hash debe coincidir exactamente. `detached HEAD` es intencional: usamos una
versión fija, no actualizaciones implícitas con `git pull`. Todos los comandos
siguientes se ejecutan desde esa carpeta; las rutas con espacios van entre comillas.
El paquete es privado, ESM y sin dependencias: no requiere ZIP, paquete nuevo,
`npm install`, `npm link` ni instalación npm global.

**Código y guía son versiones distintas:** ese commit entrega el código de PR #55,
pero todavía no contiene esta guía L5 candidata. Conservá esta guía aparte para
seguirla al clonar; su integración documental sigue pendiente. No busques
`LOCAL.md` en ese checkout ni cambies a un `main` móvil para encontrarlo.

## 2. Probar sin datos personales

```powershell
node src/dashboard.js --help
node src/dashboard.js --demo
```

Abrí manualmente la URL impresa `http://127.0.0.1:<puerto>/` en tu navegador.
El puerto por defecto es aleatorio/libre; no se abre el navegador automáticamente.
La pantalla indica **demo sintética**: no lee historiales ni crea SQLite.
Mirá ranking por agente/modelo, evolución y detalle; son vistas de los mismos
registros, no totales para sumar entre sí. Volvé a la terminal y pulsá **Ctrl+C**.

El servidor escucha sólo en loopback, no es público. No cambies el host ni uses
un túnel para compartirlo. Ayuda y demo no preparan una base real.

## 3. Elegir dónde guardar tus datos

Elegí una carpeta **fuera del repositorio**. Este ejemplo usa tu almacenamiento
local de Windows; podés reemplazarlo por otra ruta absoluta propia y accesible:

```powershell
$dataDir = Join-Path $env:LOCALAPPDATA 'pi-usage-audit'
$db = Join-Path $dataDir 'usage.sqlite'
```

Definir variables no crea la carpeta/base. La primera importación explícita la
inicializa; `report` y dashboard necesitan una base existente. Usá siempre
`--db $db`: no dependas de la ubicación predeterminada. No hay una base real
prellenada; las bases usadas para validar L4 fueron temporales, no tu base default.
Si abrís otra terminal, volvé a definir estas variables y a entrar al repositorio.

## 4. Seleccionar raíz, tareas e hijos antes de importar

No importes sólo la raíz si querés atribución de agentes. Necesitás el historial
raíz `.jsonl`, los metadatos de tareas `.json` y los directorios autorizados que
contienen sus sesiones hijas. No copies conversaciones a archivos de tareas.

1. Elegí esos archivos/directorios en tu equipo y autorizá su lectura.
2. Reemplazá las tres rutas de abajo por rutas absolutas existentes. El directorio
   de tareas debe contener los metadatos que querés admitir, no otros proyectos.
3. Agregá otro par `'--sessions-dir', 'ruta'` al array si los hijos autorizados
   están en otro directorio. No apuntes a todo tu historial por comodidad.

```powershell
$root = 'C:\ruta elegida\raiz.jsonl'
$tasksDir = 'C:\ruta elegida\tareas'
$sessionsDir = 'C:\ruta elegida\sesiones'
$planArgs = @(
  'src/cli.js', 'plan', '--root', $root,
  '--tasks-dir', $tasksDir, '--sessions-dir', $sessionsDir
)
$planText = & node @planArgs
if ($LASTEXITCODE -ne 0) { throw 'No se pudo planificar; no importar.' }
$plan = ($planText -join "`n") | ConvertFrom-Json
$plan | ConvertTo-Json -Depth 20
```

**Revisá antes de continuar:** `sources` debe listar sólo fuentes autorizadas;
`coverage` informa hijos faltantes y límites. El plan no abre SQLite ni importa.
Lee cabeceras y tareas dentro de los directorios explícitos, sin búsqueda
recursiva. No es recuperación de tareas eliminadas ni inventario histórico.
`complete:false`, `referenceCoverage:'not-inspected'` y denominador desconocido
son límites reales, no errores que debas ocultar.

**Privacidad:** este JSON incluye rutas e identificadores locales. No lo publiques
sin redactarlos. Tampoco compartas SQLite o los reportes crudos: pueden incluir
metadatos/identificadores. La pantalla omite rutas/IDs del informe, pero no vuelve
públicos ni anónimos tus archivos. No uses secretos como etiquetas.

## 5. Importar el plan aprobado y consultar

Sólo después de revisar y autorizar el plan anterior:

```powershell
$importArgs = @('src/cli.js', 'import', '--db', $db) + @($plan.importArgs)
& node @importArgs
if ($LASTEXITCODE -ne 0) { throw 'Importación fallida; revisar antes de seguir.' }
node src/cli.js report --db $db
```

`importArgs` es un **array de argumentos**, no texto ejecutable. No lo unas con
espacios para ejecutarlo, no uses `Invoke-Expression`, `eval` ni un shell intermedio.
La [receta ESM del README](README.md#planificar-sesiones-y-tareas-sin-importar-l4-a2-entregado-pr-52)
es una alternativa con `spawnSync` y `shell:false`.

Para incorporar nuevas entradas, detené el dashboard, repetí el plan/revisión y
reimportá manualmente. Reimportar fuentes sin cambios debe dar cero registros
nuevos y duplicados reconocidos, sin multiplicar tokens. No hay polling/captura.
Si la identidad o evidencia cambió, puede quedar en cuarentena: no borres la base
ni fuerces reemplazos para conseguir un ranking mayor.

`report` sin selector es global para esa base. Para una sesión específica usá su
ID literal de la cabecera, **no la ruta del archivo**:

```powershell
$sessionId = 'ID literal elegido'
node src/cli.js report --db $db --session $sessionId
```

Un ID desconocido produce vacío, no descubre fuentes. Proyecto requiere mappings
explícitos por API; no se deduce del directorio/Git. Consultá el
[contrato de identidad](README.md#declared-project-identity-api-only-delivered-in-pr-37)
si necesitás ese alcance; no combines proyecto y sesión.

Las raíces sin metadatos siguen `unknown`: no adivinamos el orquestador. L4 validó
seis agentes y 47/47 tareas retenidas de una captura, **no todo el historial**.
Uso propio incierto/excluido no equivale a cero; agentes y modelos no se suman.

## 6. Abrir tu base y entender moneda/actualización

Elegí `USD` o `EUR` según el catálogo que quieras consultar, sin conversión:

```powershell
$currency = 'EUR'
node src/dashboard.js --db $db --currency $currency
```

Abrí la URL impresa; Ctrl+C detiene el servidor. Para arrancar seleccionado:

```powershell
node src/dashboard.js --db $db --currency $currency --session $sessionId
```

Global/Sesión/Proyecto y **Consultar** reemplazan el alcance: no lo intersectan.
El envío explícito POST lee un snapshot fresco; GET/recargar vuelve al snapshot y
alcance del arranque, que queda cacheado. Lo más sencillo tras importar es
reiniciar el dashboard. No confíes en recargar para ver datos nuevos.

La moneda es obligatoria, tres letras mayúsculas; no agrega precios. Sin tarifas
los costos manuales son `null`, no cero. Runtime conserva moneda/total desconocidos;
no son facturas ni costos comparables completos. No infieras calidad por tokens.
La edición es opcional: sólo `--allow-manual-prices` habilita escrituras de tarifas
sobre la base existente. Seguí el [formulario opt-in](README.md#opt-in-manual-tariff-form-delivered-pr-28)
con tus propios precios y vigencias; esta guía no suministra tarifas reales.

## 7. Respaldar y recuperar sin sobrescribir originales

Detené **todos** los dashboards con Ctrl+C y esperá que terminen todas las
importaciones y otros lectores/escritores de esta base; no los reinicies durante
el respaldo/recuperación. Aun cerrados pueden quedar `-wal`/`-shm`: **no los borres**
ni copies sólo el archivo principal. Usamos el snapshot consistente de SQLite
incluido en Node ≥22.20, sin herramientas externas ni dependencias.

Definí este script en PowerShell; abre sólo una fuente existente en readonly,
reserva un destino nuevo y espera la Promise de `backup()` con opciones default:

```powershell
$snapshotScript = @'
import * as sqlite from 'node:sqlite';
import { statSync, openSync, closeSync } from 'node:fs';
const [from, to] = process.argv.slice(2);
let source;
try {
  if (typeof sqlite.backup !== 'function') throw new Error('Node incompatible');
  if (!from || !to || !statSync(from).isFile()) throw new Error('Source required');
  source = new sqlite.DatabaseSync(from, { readOnly: true });
  const reserved = openSync(to, 'wx', 0o600);
  closeSync(reserved);
  await sqlite.backup(source, to);
} catch {
  console.error('Snapshot failed; preserve originals, do not use the destination.');
  process.exitCode = 1;
} finally {
  try {
    source?.close();
  } catch {
    console.error('Snapshot close failed.');
    process.exitCode = 1;
  }
}
'@
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$backup = Join-Path $dataDir "usage-$stamp.backup.sqlite"
$snapshotScript | node --input-type=module - $db $backup
if ($LASTEXITCODE -ne 0) { throw 'Respaldo fallido; no recuperar desde ese destino.' }
```

Si falta la fuente, no se crea ni fuente ni destino. Un destino existente falla
sin sobrescribirlo. Si falla después de reservarlo, puede quedar un archivo
parcial: no lo uses, conservá originales y elegí otro nombre al reintentar.
No arranques otros procesos mientras se genera el snapshot.

Para recuperar, mantené los procesos cerrados y generá **otro snapshot nuevo**
desde el respaldo; así tampoco dependés de copiar un archivo sin sus sidecars:

```powershell
$restored = Join-Path $dataDir "usage-restored-$stamp.sqlite"
$snapshotScript | node --input-type=module - $backup $restored
if ($LASTEXITCODE -ne 0) { throw 'Recuperación fallida; conservar original/respaldo.' }
node src/dashboard.js --db $restored --currency $currency
```

Este dashboard valida/consulta mediante API readonly; contrastá conteos/tokens
con lo esperado. Ctrl+C al terminar. Si coinciden, usá explícitamente
`--db $restored` en adelante (o `$db = $restored`); preservá original y respaldo.
No uses CLI `report` como prueba de inmutabilidad: su opener configura tablas/WAL
en una base existente. Incluso readonly puede usar sidecars; no promete cero
efectos físicos. Un respaldo contiene datos privados: guardalo con acceso limitado.

## Si algo falla

| Síntoma | Acción sin destruir datos |
| --- | --- |
| `node`/`git` no reconocido | Verificá instalación/PATH y abrí otra terminal. |
| `node:sqlite` ausente | Comprobá `node --version`; usá Node ≥22.20, no instales un paquete SQLite. |
| No encuentra `src/cli.js` | Entrá al directorio del checkout antes de ejecutar. |
| Base ausente/ENOENT | Revisá `$db`; report/dashboard no crean la base. Importá sólo fuentes aprobadas para inicializarla. |
| Error de acceso/operación | Comprobá permisos y existencia de rutas seleccionadas. No ejecutes como administrador por defecto. |
| Puerto ocupado | Omití `--port` para elegir uno libre o elegí otro; no mates procesos ajenos. |
| Argumentos inválidos | Consultá `--help`; no dupliques flags únicos, no uses `--flag=valor`, separá flag/valor. |
| Fuentes malformadas | Revisá contadores de líneas/tails omitidos; no interpretes éxito como cobertura completa. Preservá originales. |

Exit codes: 0 éxito/ayuda, 2 argumentos, 1 operación. Errores operativos se
sanitizan (no revelan rutas); una fuente ilegible revierte la importación, aunque
un intento de inicialización puede dejar storage creado. No repares/borras datos
a ciegas: conservá originales/respaldo y revisá el alcance antes de reintentar.

## Qué está comprobado

Exportación limpia del HEAD fijo en temporal del sistema, rutas con espacios y
fuentes **sintéticas**, sin `npm install`. La verificación independiente bloqueó
el respaldo anterior: readonly dejó WAL/SHM y el guard no permitía copiar. El
probe anterior había copiado antes de readonly: no validaba el orden de la guía.

Corrección comprobada con Node 22.20.0: 31 checks, recorrido PowerShell
importar/reimportar → report → dashboard HTTP → cerrar → `backup()` con sidecars
presentes → restore nuevo → dashboard/lectura readonly. Reimportación 0 nuevos/2
duplicados; global 2 registros/48 tokens, sesión 1/29; snapshots equivalentes,
HTTP 200, puertos cerrados y hashes originales conservados. Fuente ausente no
crea fuente/destino; destino existente falla sin sobrescribirlo. Ayuda/demo sin
base se comprobaron antes; suite previa 149/149, no repetida por esta corrección.

No demuestra un clon remoto nuevo ni uso de datos personales. El cierre del probe
usó terminación del proceso en Windows, no pulsación física de Ctrl+C. HTTP no es
comprobación visual/teclado. Entrega de L5 y recorrido visual final siguen
pendientes. [ROADMAP.md](ROADMAP.md) conserva el estado y límites de L4/L6.
