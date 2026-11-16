// what's sent to a tab to run (page.js), run, and what comes of it made into
// something that goes as json: plain, and nothing in it the page can't spare

const AsyncFunction = (async () => {}).constructor;

/**
 * `code` as a function of `lattice` (page.js's helpers). an expression is its
 * own value (`document.title`); anything else is the body of an async
 * function, which says what with `return`
 */
export function compile(code) {
  try {
    return new AsyncFunction("lattice", `return (\n${code}\n);`);
  } catch {
    return new AsyncFunction("lattice", code);
  }
}

const isElement = (value) => typeof Element !== "undefined" && value instanceof Element;
const isNode = (value) => typeof Node !== "undefined" && value instanceof Node;

function cut(text, chars) {
  return text.length > chars ? `${text.slice(0, chars)}…(${text.length - chars} more)` : text;
}

/** an element, briefly: what it is, its words, and where it is */
export function describeElement(element, { text = 200 } = {}) {
  const box = element.getBoundingClientRect();
  const words = (element.innerText ?? element.textContent ?? "").replace(/\s+/g, " ").trim();
  const described = {
    tag: element.tagName.toLowerCase(),
    ...(element.id ? { id: element.id } : {}),
    ...(element.classList.length ? { classes: [...element.classList] } : {}),
    ...(words ? { text: cut(words, text) } : {}),
    box: { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) },
  };
  if (box.width === 0 && box.height === 0) described.hidden = true;
  return described;
}

/**
 * `value` as plain json: cycles cut, functions named, elements described,
 * maps and sets and lists as objects and arrays, errors with their stack.
 * `depth` deep, `items` of a list, `chars` of a string, at most
 */
export function toJSONSafe(value, { depth = 6, items = 200, chars = 1_000_000 } = {}) {
  const within = new Set();
  function safe(value, level) {
    if (value === undefined) return null;
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
    if (typeof value === "string") return cut(value, chars);
    if (typeof value === "bigint") return `${value}n`;
    if (typeof value === "symbol") return String(value);
    if (typeof value === "function") return `[function ${value.name || "anon"}]`;
    if (isElement(value)) return describeElement(value);
    if (isNode(value)) return cut(String(value.textContent ?? value.nodeName), chars);
    if (value instanceof Error) return { error: `${value.name}: ${value.message}`, stack: value.stack };
    if (value instanceof Date) return value.toISOString();
    if (within.has(value)) return "[cycle]";
    if (level >= depth) return Array.isArray(value) ? "[list]" : "[object]";
    within.add(value);
    try {
      if (value instanceof Map) return safe(Object.fromEntries(value), level);
      const listy =
        Array.isArray(value) ||
        value instanceof Set ||
        (typeof value[Symbol.iterator] === "function" && typeof value.length === "number") ||
        (typeof NodeList !== "undefined" && value instanceof NodeList);
      if (listy) {
        const all = [...value];
        const out = all.slice(0, items).map((item) => safe(item, level + 1));
        if (all.length > items) out.push(`…${all.length - items} more`);
        return out;
      }
      if (ArrayBuffer.isView(value)) return `[${value.constructor.name} of ${value.length ?? value.byteLength}]`;
      const out = {};
      for (const key of Object.keys(value)) {
        let item;
        try {
          item = value[key];
        } catch (error) {
          item = error;
        }
        if (item === undefined) continue;
        out[key] = safe(item, level + 1);
      }
      return out;
    } finally {
      within.delete(value);
    }
  }
  return safe(value, 0);
}
