const status = document.querySelector("#status");
const workspace = document.querySelector("#ledger");
const list = document.querySelector("#entries");
const details = document.querySelector("#details");
const filter = document.querySelector("#filter");
const evaluation = document.querySelector("#evaluation");

function add(parent, tag, text, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  parent.append(node);
  return node;
}

function wire(snapshot) {
  const lookup = new Map(snapshot.records.map((row) => [row.hash, row]));
  let selected;

  function select(record) {
    selected = record;
    const item = record.event;
    details.replaceChildren();
    add(details, "p", `Record ${record.seq} · ${record.actor} · ${record.role}`, "meta");
    add(details, "h2", item.kind);
    add(details, "p", item.text);
    const review = snapshot.standing[record.hash];
    if (review || item.kind === "correction" || item.kind === "guidance") {
      add(
        details,
        "p",
        review ? `Review: ${review}` : "Scientific review pending",
        "meta",
      );
    }
    add(details, "p", "Record digest", "meta");
    add(details, "code", record.hash);
    if (Object.keys(item.data).length) {
      const data = add(details, "details");
      add(data, "summary", "Source identifiers and record data");
      add(data, "pre", JSON.stringify(item.data, null, 2));
    }
    for (const [label, links] of [
      ["Sources", item.refs.map((hash) => lookup.get(hash)).filter(Boolean)],
      [
        "Cited by",
        snapshot.records.filter((row) => row.event.refs.includes(record.hash)),
      ],
    ]) {
      if (!links.length) continue;
      add(details, "h3", label);
      const refs = add(details, "ul");
      for (const next of links) {
        const anchor = add(add(refs, "li"), "a", `${next.seq}. ${next.event.kind}`);
        anchor.href = `#${next.hash}`;
        anchor.addEventListener("click", (e) => {
          e.preventDefault();
          navigate(next);
          details.tabIndex = -1;
          details.focus();
        });
      }
    }
    render();
  }

  function navigate(record) {
    history.replaceState(null, "", `#${record.hash}`);
    select(record);
  }

  function render() {
    list.replaceChildren();
    const query = filter.value.toLowerCase().trim();
    for (const row of snapshot.records) {
      const item = row.event;
      if (
        !`${item.kind} ${item.subject} ${item.text} ${row.actor}`
          .toLowerCase()
          .includes(query)
      )
        continue;
      const button = add(add(list, "li"), "button", `${row.seq}. ${item.kind}`);
      button.type = "button";
      button.setAttribute("aria-pressed", String(row === selected));
      button.addEventListener("click", () => {
        navigate(row);
        list.querySelector('button[aria-pressed="true"]')?.focus();
      });
    }
    if (!list.childElementCount) add(list, "li", "No matching records.");
  }

  filter.addEventListener("input", render);
  for (const [phase, result] of Object.entries(snapshot.evaluation)) {
    const section = add(evaluation, "details");
    add(section, "summary", `${phase}: ${result.verdict}`);
    add(
      section,
      "p",
      `${result.joint_seed_successes}/${result.seeds} seeds met the joint pattern. Counts describe the registered simulator.`,
    );
    add(section, "pre", JSON.stringify(result.cells, null, 2));
  }
  status.textContent = `${snapshot.records.length} published records · Synthetic CIRCLE signal processing · Separately scored`;
  workspace.hidden = false;
  select(lookup.get(location.hash.slice(1)) ?? snapshot.records.at(-1));
}

fetch("./snapshot.json")
  .then((response) => {
    if (!response.ok) throw new Error("Unavailable");
    return response.json();
  })
  .then(wire)
  .catch(() => {
    status.textContent = "The published evidence snapshot is unavailable.";
  });
