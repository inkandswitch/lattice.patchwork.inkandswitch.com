const SVG = "http://www.w3.org/2000/svg";

// line drawings on a 16 unit square, in the ink they sit in
const PATHS = {
  plus: "M8 3.5v9M3.5 8h9",
  close: "M4.5 4.5l7 7M11.5 4.5l-7 7",
  "chevron-down": "M4.5 6.25 8 9.75l3.5-3.5",
  "chevron-right": "M6.25 4.5 9.75 8l-3.5 3.5",
  warning: "M8 2.5 14 13H2ZM8 6.5v3M8 11.25v.01",
  play: "M5 3.5v9l7.5-4.5Z",
  pause: "M6 4v8M10 4v8",
  restart: "M4.5 4v8M11.5 4 7 8l4.5 4",
  back: "M10 4 6 8l4 4",
  step: "M6 4l4 4-4 4",
  "open-new":
    "M9 2.5h4.5V7M13.5 2.5 7 9M11.5 9.5v3.5a.5.5 0 0 1-.5.5H3a.5.5 0 0 1-.5-.5V5a.5.5 0 0 1 .5-.5h3.5",
};

/**
 * a line icon, as an <svg> element: goes into html`` templates and plain dom
 * alike. `size` is anything an svg's width takes; by default it's as big as
 * the text around it, and sits on its line like a letter
 */
export function icon(name, size = "1em") {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", size);
  svg.setAttribute("height", size);
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", `icon icon-${name}`);
  svg.style.flex = "none";
  svg.style.verticalAlign = "-0.125em";
  const path = document.createElementNS(SVG, "path");
  path.setAttribute("d", PATHS[name]);
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "1.4");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  svg.append(path);
  return svg;
}
