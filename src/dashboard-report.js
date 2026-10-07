const tokenKeys = ["input", "output", "cacheRead", "cacheWrite", "totalTokens"];

// Copy public summaries only: never retain session/entry IDs or selected prices.
export function projectDemo(report, costs) {
  return {
    agents: structuredClone(report.agents),
    models: structuredClone(report.models),
    coverage: structuredClone(report.coverage),
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
  return `<section><h2>${escape(title)}</h2><div class="scroll"><table><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table></div>${rows.length ? "" : "<p>Sin filas</p>"}</section>`;
}
export function renderDashboard(demo, { selected = false } = {}) {
  const coverage = demo.coverage;
  const banner = selected
    ? "BASE SELECCIONADA — snapshot local, sin captura"
    : "DEMO — datos sintéticos, sin captura";
  const description = selected
    ? "Snapshot estático al arrancar de la base existente seleccionada. Sin refresco, captura ni validación de sesiones reales. Lectura SQLite readonly: puede usar WAL/SHM. Sin inicialización, reparación ni escrituras por API."
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
${table(
  `Costos manuales comparativos — ${demo.currency}`,
  [
    "Agente",
    "Proveedor",
    "Modelo",
    "Entradas",
    "Total del grupo",
    "Cobertura",
    "Razones",
  ],
  demo.costs.map((g) => [
    g.agent,
    g.provider,
    g.model,
    g.entries,
    g.total,
    `${g.coverage.complete ? "complete" : "incomplete"}; completeQuotes: ${g.coverage.completeQuotes}; incompleteEntries: ${g.coverage.incompleteEntries}`,
    g.reasons.join("; "),
  ]),
)}
<p>Moneda explícita: ${escape(demo.currency)}. Orden por identidad, no por dinero.
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
</main></html>`;
}
