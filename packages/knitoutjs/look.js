// knitout.js's look (look.css): its stylesheet, and the filters that draw
// its headings a little by hand. a filter is found by id in the page, so
// these go in the page once, wherever the look is worn
export const LOOK = new URL("./look.css", import.meta.url).href;

const SVG = "http://www.w3.org/2000/svg";

export function roughFilters() {
  if (document.getElementById("knitoutjs-rough-1")) return;
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("aria-hidden", "true");
  svg.style.cssText = "position: absolute; width: 0; height: 0";
  for (const seed of [1, 2, 3]) {
    const filter = document.createElementNS(SVG, "filter");
    filter.id = `knitoutjs-rough-${seed}`;
    const noise = document.createElementNS(SVG, "feTurbulence");
    noise.setAttribute("type", "fractalNoise");
    noise.setAttribute("baseFrequency", "0.04");
    noise.setAttribute("numOctaves", "2");
    noise.setAttribute("seed", String(seed));
    const shift = document.createElementNS(SVG, "feDisplacementMap");
    shift.setAttribute("in", "SourceGraphic");
    shift.setAttribute("scale", "1.4");
    filter.append(noise, shift);
    svg.append(filter);
  }
  document.body.append(svg);
}

// the look on the page: its stylesheet in the head, its filters in the body
export function wearLook() {
  if (typeof document === "undefined") return;
  if (![...document.styleSheets].some((sheet) => sheet.href === LOOK) && !document.querySelector(`link[href="${LOOK}"]`)) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = LOOK;
    document.head.append(link);
  }
  roughFilters();
}
