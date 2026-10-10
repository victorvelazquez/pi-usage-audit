// Trusted static source; no selectors, identities or token values interpolated.
export const comparisonNavigationScript = `
(() => {
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-token-sort]");
    if (!button) return;
    const table = button.closest("table");
    const header = button.closest("th");
    const descending = header.getAttribute("aria-sort") !== "descending";
    const column = BigInt(button.dataset.tokenSort) + 4n;
    const rows = Array.from(table.tBodies[0].rows);
    rows.sort((a, b) => {
      const left = BigInt(a.cells[column].textContent);
      const right = BigInt(b.cells[column].textContent);
      if (left !== right) return (left > right ? 1 : -1) * (descending ? -1 : 1);
      const leftIdentity = BigInt(a.dataset.identityOrder);
      const rightIdentity = BigInt(b.dataset.identityOrder);
      return leftIdentity === rightIdentity ? 0 : leftIdentity < rightIdentity ? -1 : 1;
    });
    table.tBodies[0].append(...rows);
    for (const control of table.querySelectorAll("[data-token-sort]")) {
      control.closest("th").setAttribute("aria-sort", control === button
        ? descending ? "descending" : "ascending"
        : "none");
    }
  });
})();
`;
