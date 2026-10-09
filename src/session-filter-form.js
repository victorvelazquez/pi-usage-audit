// Trusted static source: hash these exact bytes, never interpolate a selector.
export const sessionFilterScript = `
(() => {
  const form = document.getElementById("session-filter-form");
  const button = document.getElementById("session-filter-submit");
  const feedback = document.getElementById("session-filter-feedback");
  const mode = form.elements.namedItem("mode");
  const session = form.elements.namedItem("session");
  const project = form.elements.namedItem("projectId");
  let pending = false;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (pending) return;
    let selector;
    if (mode.value === "global") selector = {};
    else if (mode.value === "session") {
      if (!session.value.length || session.value.length > 512) {
        feedback.textContent = "Ingrese una sesión literal de 1–512 unidades UTF-16.";
        return;
      }
      selector = { session: session.value };
    } else if (mode.value === "project") {
      if (!project.value.length || project.value.length > 64 ||
          /[^A-Za-z0-9_-]/.test(project.value)) {
        feedback.textContent = "Ingrese un proyecto literal de 1–64 caracteres ASCII: letras, números, _ o -.";
        return;
      }
      selector = { projectId: project.value };
    } else {
      feedback.textContent = "Seleccione global, sesión o proyecto.";
      return;
    }
    pending = true;
    const disable = (value) => {
      for (const control of [button, mode, session, project]) control.disabled = value;
    };
    disable(true);
    feedback.textContent = "Consultando…";
    try {
      const response = await fetch("/session-filter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(selector),
      });
      if (response.status !== 200 ||
          !/^text\\/html(?:\\s*;|$)/i.test(response.headers.get("Content-Type") || ""))
        throw new Error();
      const page = new DOMParser().parseFromString(await response.text(), "text/html");
      const regions = page.querySelectorAll("#dashboard-report");
      if (regions.length !== 1 ||
          regions[0].querySelector("script, form, iframe, object, embed") ||
          !regions[0].querySelector('[data-dashboard-scope]')) throw new Error();
      document.getElementById("dashboard-report").replaceWith(regions[0]);
      feedback.textContent = "Snapshot actualizado. Recargar restaura el alcance de arranque.";
    } catch {
      feedback.textContent = "No se pudo consultar. Vista anterior conservada; sin reintento automático.";
    } finally {
      pending = false;
      disable(false);
    }
  });
})();
`;

export const sessionFilterForm = `<section aria-labelledby="session-filter-title">
<h2 id="session-filter-title">Consultar alcance</h2>
<p>Cada envío lee un snapshot conjunto nuevo: incluye importaciones y tarifas posteriores.
Sin polling. Recargar restaura el snapshot y alcance de arranque; no cambia otras páginas.</p>
<form id="session-filter-form">
<p><label for="session-mode">Alcance</label>
<select id="session-mode" name="mode"><option value="global">Global</option>
<option value="session">Sesión literal</option>
<option value="project">Proyecto literal</option></select></p>
<p><label for="session-id">ID de sesión (literal, sin normalización)</label>
<input id="session-id" name="session" type="text" maxlength="512" autocomplete="off"></p>
<p><label for="project-id">ID de proyecto (literal ASCII: letras, números, _ o -, sin normalización)</label>
<input id="project-id" name="projectId" type="text" maxlength="64" autocomplete="off"></p>
<button id="session-filter-submit" type="submit">Consultar</button>
<p id="session-filter-feedback" role="status" aria-live="polite" aria-atomic="true"></p>
</form></section><script>${sessionFilterScript}</script>`;
