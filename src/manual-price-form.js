// Trusted static source: hash these exact bytes for the opted-in CSP.
export const manualPriceScript = `
(() => {
  const form = document.getElementById("manual-price-form");
  const button = document.getElementById("manual-price-submit");
  const feedback = document.getElementById("manual-price-feedback");
  const keys = [
    "provider", "model", "category", "currency", "effectiveFrom", "ratePerMillion",
  ];
  let pending = false;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (pending) return;
    pending = true;
    const price = Object.fromEntries(
      keys.map((key) => [key, form.elements.namedItem(key).value]),
    );
    const disable = (value) => {
      button.disabled = value;
      for (const key of keys) form.elements.namedItem(key).disabled = value;
    };
    disable(true);
    feedback.textContent = "Guardando…";
    try {
      const response = await fetch("/manual-prices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(price),
      });
      if (response.status === 409) {
        feedback.textContent = "Conflicto: esa versión ya tiene otra tarifa. No se reemplazó; revise la vigencia.";
      } else if (response.status === 200) {
        const saved = await response.json();
        feedback.textContent = "Tarifa guardada (canónica): " +
          JSON.stringify(saved) + ". Snapshot de costos sin cambios.";
      } else {
        feedback.textContent = "No se pudo guardar. Revise los campos y compruebe el estado antes de reenviar.";
      }
    } catch {
      feedback.textContent = "No se pudo guardar. Resultado no confirmado; compruebe el estado antes de reenviar.";
    } finally {
      pending = false;
      disable(false);
    }
  });
})();
`;

export const manualPriceForm = `<section aria-labelledby="manual-price-title">
<h2 id="manual-price-title">Guardar una tarifa manual</h2>
<p>Escrituras habilitadas sólo en la base seleccionada. Tarifas append-only y versionadas:
una identidad/moneda/categoría/vigencia no se reemplaza; otra vigencia crea otra versión.</p>
<p>Los costos son estimaciones del snapshot estático, no son una factura.
Guardar no recalcula ni refresca el snapshot. Sin reintentos automáticos.</p>
<form id="manual-price-form" aria-describedby="manual-price-help">
<p id="manual-price-help">Complete los seis campos explícitos. Moneda independiente de la vista.
Use punto decimal (cero es válido) y texto UTC canónico, no hora local.</p>
<p><label for="price-provider">Proveedor</label>
<input id="price-provider" name="provider" required type="text"></p>
<p><label for="price-model">Modelo</label>
<input id="price-model" name="model" required type="text"></p>
<p><label for="price-category">Categoría</label>
<select id="price-category" name="category" required>
<option value="input">input</option><option value="output">output</option>
<option value="cacheRead">cacheRead</option><option value="cacheWrite">cacheWrite</option>
</select></p>
<p><label for="price-currency">Moneda (tres letras mayúsculas, por ejemplo EUR)</label>
<input id="price-currency" name="currency" required type="text" pattern="[A-Z]{3}" maxlength="3"></p>
<p><label for="price-effective">Vigencia UTC (YYYY-MM-DDTHH:mm:ss.sssZ)</label>
<input id="price-effective" name="effectiveFrom" required type="text" placeholder="2025-01-01T00:00:00.000Z"></p>
<p><label for="price-rate">Tarifa por millón (0–999999999999, hasta seis decimales)</label>
<input id="price-rate" name="ratePerMillion" required type="text" inputmode="decimal" pattern="(0|[1-9][0-9]{0,11})([.][0-9]{1,6})?" placeholder="0.000000"></p>
<button id="manual-price-submit" type="submit">Guardar tarifa</button>
<p id="manual-price-feedback" role="status" aria-live="polite" aria-atomic="true"></p>
</form></section><script>${manualPriceScript}</script>`;
