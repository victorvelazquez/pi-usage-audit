import { manualPriceForm } from "./manual-price-form.js";

const tokenKeys = ["input", "output", "cacheRead", "cacheWrite", "totalTokens"];

function groupUsage(quotes) {
  const sums = Object.fromEntries(
    tokenKeys.slice(0, 4).map((key) => [key, 0n]),
  );
  const sessions = new Set();
  for (const { session, observation } of quotes) {
    sessions.add(session);
    for (const key of Object.keys(sums))
      sums[key] += BigInt(observation.usage[key]);
  }
  sums.totalTokens = Object.values(sums).reduce(
    (sum, value) => sum + value,
    0n,
  );
  return {
    sessions: sessions.size,
    tokens: Object.fromEntries(
      Object.entries(sums).map(([key, value]) => [key, value.toString()]),
    ),
  };
}

// Copy public summaries only: never retain session/entry IDs or selected prices.
export function projectDemo(report, costs, evolution) {
  return {
    agents: structuredClone(report.agents),
    models: structuredClone(report.models),
    coverage: structuredClone(report.coverage),
    evolution: structuredClone(evolution),
    runtime: {
      currency: report.runtime.currency,
      total: report.runtime.total,
      totalUnavailableReason: report.runtime.totalUnavailableReason,
      amounts: report.runtime.observations.map(({ amount }) => amount),
      coverage: structuredClone(report.runtime.coverage),
    },
    currency: costs.currency,
    costs: costs.groups.map(
      ({ agent, provider, model, entries, total, coverage, quotes }) => ({
        agent,
        provider,
        model,
        entries,
        ...groupUsage(quotes),
        total,
        coverage: structuredClone(coverage),
        reasons: [
          ...new Set(
            quotes.flatMap(({ eligibility, quote }) => [
              ...eligibility.reasons,
              ...["missingCounters", "missingPrices"].flatMap((key) =>
                quote?.coverage[key]?.length
                  ? [`${key}: ${quote.coverage[key].join(", ")}`]
                  : [],
              ),
            ]),
          ),
        ],
      }),
    ),
  };
}

function escape(value) {
  const text = value === null ? "Desconocido (null)" : String(value);
  return text.replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char],
  );
}
function table(title, headings, rows) {
  const header = headings
    .map((key) => `<th scope="col">${escape(key)}</th>`)
    .join("");
  const body = rows
    .map(
      (row) =>
        `<tr>${row.map((value) => `<td>${escape(value)}</td>`).join("")}</tr>`,
    )
    .join("");
  return `<section><h2>${escape(title)}</h2><div class="scroll"><table><caption>${escape(title)}</caption><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table></div>${rows.length ? "" : "<p>Sin filas</p>"}</section>`;
}
function groupDetails(group, currency) {
  const identity = (value) => escape(value === null ? value : `"${value}"`);
  return `<details><summary>Proveedor: ${identity(group.provider)} — Modelo: ${identity(group.model)}</summary>${table(
    `Consumo del grupo y costo manual — ${currency}`,
    [
      "Proveedor",
      "Modelo",
      "Entradas",
      "Sesiones distintas del grupo",
      ...tokenKeys,
      "Costo manual del grupo",
      "Cobertura",
      "Razones",
    ],
    [
      [
        group.provider,
        group.model,
        group.entries,
        group.sessions,
        ...tokenKeys.map((key) => group.tokens[key]),
        group.total,
        `${group.coverage.complete ? "complete" : "incomplete"}; completeQuotes: ${group.coverage.completeQuotes}; incompleteEntries: ${group.coverage.incompleteEntries}`,
        group.reasons.join("; "),
      ],
    ],
  )}</details>`;
}
function agentDetails(demo) {
  return `<section><h2>Detalle de consumo por agente y proveedor/modelo</h2>
<p>Sesiones distintas del grupo; no aditivas entre proveedores/modelos.
Exclusiones sólo en las vistas globales; sin subtotal monetario por agente.</p>
${
  demo.agents.length
    ? demo.agents
        .map(({ agent }) => {
          const groups = demo.costs.filter((g) => g.agent === agent);
          return `<details><summary>${escape(agent)}</summary>${groups
            .map((group) => groupDetails(group, demo.currency))
            .join("")}</details>`;
        })
        .join("")
    : "<p>Sin filas</p>"
}</section>`;
}
export function renderDashboard(
  demo,
  { selected = false, allowManualPrices = false } = {},
) {
  const editable = selected && allowManualPrices === true;
  const coverage = demo.coverage;
  const evolution = demo.evolution;
  const banner = selected
    ? "BASE SELECCIONADA — snapshot local, sin captura"
    : "DEMO — datos sintéticos, sin captura";
  const description = selected
    ? "Snapshot estático al arrancar de la base existente seleccionada. Sin refresco, captura ni validación de sesiones reales. Lectura SQLite readonly: puede usar WAL/SHM. Sin inicialización ni reparación." +
      (editable
        ? " Guardado manual opt-in habilitado."
        : " Sin escrituras por API.")
    : "Snapshot sintético fijo. Sin bases reales, escrituras, llamadas externas ni facturación.";
  return `<!doctype html><html lang="es"><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Consumo local — ${selected ? "base seleccionada" : "demo"}</title><style>
body { font: 16px system-ui; margin: 2rem; background: #f7f9fc; color: #172338; }
main { max-width: 1200px; margin: auto; }
aside { padding: 1rem; background: #ffe59a; font-weight: bold; }
section { margin-top: 2rem; }
.scroll { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; background: white; }
th, td { text-align: left; border: 1px solid #ccd3df; padding: .6rem; }
td { font-variant-numeric: tabular-nums; }
</style><main><aside>${escape(banner)}</aside>
<h1>Agentes, modelos y costos estimados</h1>
<p>${escape(description)}</p>
<p>Agentes, modelos y costos describen las mismas entradas: vistas no aditivas.
Sesiones entre modelos no aditivas; reasoning y cacheWrite1h son subconjuntos excluidos de la suma.</p>
<p>Entradas propias confirmadas: ${escape(coverage.includedEntries)}.
Excluidas (no son cero): ${escape(coverage.excludedEntries)}.</p>
<p>Evolución de tokens propios confirmados, por día UTC observado; sin rellenar huecos.
Agentes, modelos y evolución son vistas no aditivas; sin costos temporales.</p>
${table(
  "Evolución diaria — UTC",
  ["Día UTC", "Entradas", "Tokens exactos"],
  evolution.buckets.map(({ day, entries, totalTokens }) => [
    day,
    entries,
    totalTokens,
  ]),
)}
${table(
  "Sin fecha — separado de los días UTC",
  ["Entradas", "Tokens exactos", "Timestamp ausente", "Timestamp inválido"],
  [
    [
      evolution.undated.entries,
      evolution.undated.totalTokens,
      evolution.undated.missingTimestampEntries,
      evolution.undated.invalidTimestampEntries,
    ],
  ],
)}
<p>Entradas incluidas en evolución: ${escape(evolution.coverage.includedEntries)}.
Excluidas de evolución (no son cero): ${escape(evolution.coverage.excludedEntries)}.
Cobertura no aditiva con las otras vistas. Sin fecha no se asigna a un día.</p>
${table(
  "Exclusiones de evolución por certeza",
  ["Certeza", "Entradas"],
  Object.entries(evolution.coverage.excludedByCertainty),
)}
${table("Exclusiones por certeza", ["Certeza", "Entradas"], Object.entries(coverage.excludedByCertainty))}
${table(
  "Agentes — orden por tokens",
  ["Agente", "Entradas", "Sesiones", "Tokens exactos"],
  demo.agents.map((a) => [a.agent, a.entries, a.sessions, a.totalTokens]),
)}
${table(
  "Modelos — tokens exactos",
  ["Proveedor", "Modelo", "Entradas", "Sesiones", ...tokenKeys],
  demo.models.map((m) => [
    m.provider,
    m.model,
    m.entries,
    m.sessions,
    ...tokenKeys.map((key) => m.tokens[key]),
  ]),
)}
<p>Atribución por consenso de tareas; unknown no prueba rol de orquestador o subagente.</p>
${agentDetails(demo)}
<p>Moneda explícita: ${escape(demo.currency)}. Grupos por identidad dentro de cada agente, no por dinero.
Total null significa incompleto: no hay subtotal ni total global. Cero explícito es conocido.
Proyección de cotizaciones API: sin recalcular precios, conversión ni factura.</p>
<h2>Runtime — separado de costos manuales</h2>
<p>Moneda: ${escape(demo.runtime.currency)}; total: ${escape(demo.runtime.total)}.
Razón: ${escape(demo.runtime.totalUnavailableReason)}. No se infiere ninguna moneda.</p>
${table("Cobertura runtime", ["Campo", "Entradas"], Object.entries(demo.runtime.coverage))}
${table(
  "Importes runtime observados — moneda desconocida",
  ["Importe"],
  demo.runtime.amounts.map((amount) => [amount]),
)}
${editable ? manualPriceForm : ""}
</main></html>`;
}
