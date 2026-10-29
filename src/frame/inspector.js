import { createSignal, For } from "solid-js";
import html from "solid-js/html";
import { remember, remembered } from "./sidebars.js";

const DRAG_TYPE = "application/x-lattice-inspector";
const ORDER_KEY = "lattice:inspector:order";

/**
 * the inspectors down the right, like vscode's views: each folds away under
 * its heading, and moves above or below the others by dragging its heading
 * (or alt+up/down on it). which are open, and their order, are remembered.
 * `sections` is [{ id, name, render() }]
 */
export function Inspector(props) {
  const sections = new Map(props.sections.map((section) => [section.id, section]));
  const ids = [...sections.keys()];
  const saved = remembered(ORDER_KEY, ids).filter((id) => sections.has(id));
  const [order, setOrder] = createSignal([...saved, ...ids.filter((id) => !saved.includes(id))]);

  // `id` to `index` in the order
  function move(id, index) {
    const next = order().filter((other) => other !== id);
    next.splice(Math.max(0, Math.min(index, next.length)), 0, id);
    setOrder(next);
    remember(ORDER_KEY, next);
  }

  // where a dragged heading would land: { id, after }
  const [dropAt, setDropAt] = createSignal(null);

  function Section(props) {
    const section = sections.get(props.id);
    const openKey = `lattice:inspector:${section.id}:open`;
    const [open, setOpen] = createSignal(remembered(openKey, true));
    let heading;

    function onDragOver(event) {
      if (!event.dataTransfer.types.includes(DRAG_TYPE)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      const box = event.currentTarget.getBoundingClientRect();
      setDropAt({ id: section.id, after: event.clientY > box.top + box.height / 2 });
    }

    function onDrop(event) {
      const dragged = event.dataTransfer.getData(DRAG_TYPE);
      const at = dropAt();
      setDropAt(null);
      if (!dragged || !at || dragged === at.id) return;
      event.preventDefault();
      const without = order().filter((id) => id !== dragged);
      move(dragged, without.indexOf(at.id) + (at.after ? 1 : 0));
    }

    function onKeyDown(event) {
      if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
      event.preventDefault();
      move(section.id, order().indexOf(section.id) + (event.key === "ArrowUp" ? -1 : 1));
      // moving it takes it out of the page for a moment, and the focus with it
      queueMicrotask(() => heading.focus());
    }

    return html`<section
      class="lattice-inspector-section"
      data-open=${() => (open() ? "" : undefined)}
      data-drop=${() =>
        dropAt()?.id === section.id ? (dropAt().after ? "after" : "before") : undefined}
      onDragOver=${onDragOver}
      onDragLeave=${(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setDropAt(null);
      }}
      onDrop=${onDrop}
    >
      <button
        class="lattice-inspector-heading"
        aria-expanded=${() => String(open())}
        title="click to fold it away · drag it, or alt+↑/↓, to move it"
        draggable="true"
        ref=${(el) => (heading = el)}
        onClick=${() => {
          setOpen(!open());
          remember(openKey, open());
        }}
        onKeyDown=${onKeyDown}
        onDragStart=${(event) => {
          event.dataTransfer.setData(DRAG_TYPE, section.id);
          event.dataTransfer.effectAllowed = "move";
        }}
        onDragEnd=${() => setDropAt(null)}
      >
        <span class="lattice-inspector-chevron" aria-hidden="true">›</span>
        ${section.name}
      </button>
      <div class="lattice-inspector-body" hidden=${() => !open()}>${section.render()}</div>
    </section>`;
  }

  return html`<${For} each=${order}>${(id) => html`<${Section} id=${id} />`}<//>`;
}
