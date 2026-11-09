// your pointer: an arrow in your colour (your contact's, the one people see
// you in). it's the one in the settings' colours, and your mouse's own in the
// frame
export const POINTER_PATH = "M4 1.6v11.6l2.9-2.7 1.9 4.4 2.1-.9-1.9-4.3h4.1z";

// drawn this big, its tip's at the hotspot (the path's 4,1.6 of 16)
const SIZE = 22;
const HOTSPOT = [Math.round((4 * SIZE) / 16), Math.round((1.6 * SIZE) / 16)];

/** a css cursor of your pointer in `colour`, or null without one */
export function pointerCursor(colour) {
  colour = String(colour ?? "").trim();
  if (!colour || /["<>]/.test(colour)) return null;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 16 16"><path d="${POINTER_PATH}" fill="${colour}" stroke="white" stroke-width="1.2" stroke-linejoin="round" paint-order="stroke"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${HOTSPOT.join(" ")}, auto`;
}
