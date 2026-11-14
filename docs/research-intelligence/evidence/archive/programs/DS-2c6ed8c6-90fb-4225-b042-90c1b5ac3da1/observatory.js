
(() => {
  const query = document.getElementById("design-search");
  const status = document.getElementById("design-filter");
  const rows = Array.from(document.querySelectorAll("[data-design-row]"));
  const output = document.getElementById("filter-count");
  const empty = document.getElementById("filter-empty");
  function filter() {
    const needle = query.value.trim().toLowerCase();
    let visible = 0;
    for (const row of rows) {
      const group = status.value;
      const matches = group === "all" ||
        (group === "issues" && row.dataset.issue === "true") ||
        (group === "measured" && row.dataset.measured === "true") ||
        (group === "unmeasured" && row.dataset.measured === "false");
      row.hidden = !matches || !row.textContent.toLowerCase().includes(needle);
      if (!row.hidden) visible += 1;
    }
    output.textContent = visible + " of " + rows.length + " designs shown";
    empty.hidden = visible !== 0;
  }
  query.addEventListener("input", filter);
  status.addEventListener("change", filter);
  document.getElementById("open-details").addEventListener("click", () => {
    for (const row of rows) if (!row.hidden) row.querySelector("details").open = true;
  });
  document.getElementById("close-details").addEventListener("click", () => {
    for (const detail of document.querySelectorAll(".design-detail")) detail.open = false;
  });
  filter();
})();