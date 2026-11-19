// where a layer is: moved (`at`, [dx, dy]), turned (`turn`, degrees) and
// sized (`scale`, [sx, sy]) about its `pivot` ([x, y], in its own units:
// written the first time it's turned or sized, so everyone turns it about
// the same point). each is its own field, so two people at once, one
// moving it and one turning it, both keep theirs
//
// a matrix is [a, b, c, d, e, f], as svg's matrix() has it: a point in the
// layer's own units goes to (a x + c y + e, b x + d y + f) on the page

export const IDENTITY = [1, 0, 0, 1, 0, 0];
// as small as a side can be sized to (in page units)
const SMALLEST = 1;

const finite = (n, otherwise) => (Number.isFinite(+n) && n !== null && n !== "" ? +n : otherwise);
const pair = (value, otherwise) =>
  Array.isArray(value) && value.length === 2 ? [finite(value[0], otherwise[0]), finite(value[1], otherwise[1])] : otherwise;

// a mark's place, every field there (whatever's in the doc, checked)
export function placeOf(mark) {
  let scale = pair(mark?.scale, [1, 1]);
  // (never nothing: it couldn't be found, or sized back)
  scale = scale.map((s) => (Math.abs(s) < 0.02 ? (s < 0 ? -0.02 : 0.02) : s));
  return {
    at: pair(mark?.at, [0, 0]),
    turn: finite(mark?.turn, 0),
    scale,
    pivot: Array.isArray(mark?.pivot) ? pair(mark.pivot, [0, 0]) : null,
  };
}

// is it only moved (so its pivot doesn't matter)?
export const onlyMoved = ({ turn, scale }) => !turn && scale[0] === 1 && scale[1] === 1;

export function multiply([a1, b1, c1, d1, e1, f1], [a2, b2, c2, d2, e2, f2]) {
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
}

export function invert([a, b, c, d, e, f]) {
  const det = a * d - b * c || 1e-9;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

export const transform = ([a, b, c, d, e, f], [x, y]) => [a * x + c * y + e, b * x + d * y + f];

// how much bigger a unit of the layer is on the page, on the whole
export const sizeOf = ([a, b, c, d]) => Math.sqrt(Math.abs(a * d - b * c)) || 1;

const rotation = (degrees) => {
  const r = (degrees * Math.PI) / 180;
  return [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0];
};
const translation = ([x, y]) => [1, 0, 0, 1, x, y];

// the layer's units to the page: moved, and turned and sized about `pivot`
// (its own, or the one given, for a layer that's never been turned)
export function matrixOf(place, pivot = place.pivot ?? [0, 0]) {
  const [px, py] = place.pivot ?? pivot;
  if (onlyMoved(place)) return translation(place.at);
  return [translation([place.at[0] + px, place.at[1] + py]), rotation(place.turn), [place.scale[0], 0, 0, place.scale[1], 0, 0], translation([-px, -py])].reduce(multiply);
}

export const svgMatrix = (m) => `matrix(${m.map((n) => Math.round(n * 10000) / 10000).join(" ")})`;

// an old erase's `on` was where the layer had been moved to; now it's the
// layer's whole matrix, when it was rubbed
export const matrixFrom = (value) =>
  Array.isArray(value) && value.length === 6 && value.every((n) => Number.isFinite(+n))
    ? value.map(Number)
    : translation(pair(value, [0, 0]));

const turnBy = (degrees, [x, y]) => transform(rotation(degrees), [x, y]);

// sized by dragging its `corner` (a point in its own units) to `pointer` (on
// the page), the `opposite` corner staying where it is. shift: as it was,
// only bigger or smaller
export function resized(place, pivot, corner, opposite, pointer, keepShape = false) {
  const p = place.pivot ?? pivot;
  const before = matrixOf(place, p);
  const fixed = transform(before, opposite);
  // the pointer from the corner that stays, in the layer's turned frame
  const [vx, vy] = turnBy(-place.turn, [pointer[0] - fixed[0], pointer[1] - fixed[1]]);
  const [wx, wy] = [corner[0] - opposite[0], corner[1] - opposite[1]];
  const [sx0, sy0] = place.scale;
  // past the opposite corner, it goes on growing that way, as tldraw's do:
  // never turned inside out, the corner you're dragging is where the
  // opposite one was, on that side, and the opposite one follows the pointer
  const least = (w, s) => (Math.abs(w) > 1e-6 ? SMALLEST / Math.abs(w) : Math.abs(s));
  const sized = (s, s0, w) => Math.sign(s0) * Math.max(Math.abs(s), least(w, s0));
  let [sx, sy] = [sx0, sy0];
  let [pastX, pastY] = [false, false];
  if (keepShape) {
    const [ux, uy] = [wx * sx0, wy * sy0];
    const along = (vx * ux + vy * uy) / (ux * ux + uy * uy || 1);
    pastX = pastY = along < 0;
    const by = Math.max(Math.abs(along), least(wx, sx0) / Math.abs(sx0), least(wy, sy0) / Math.abs(sy0));
    sx = sx0 * by;
    sy = sy0 * by;
  } else {
    if (Math.abs(wx) > 1e-6) (pastX = vx / wx / sx0 < 0), (sx = sized(vx / wx, sx0, wx));
    if (Math.abs(wy) > 1e-6) (pastY = vy / wy / sy0 < 0), (sy = sized(vy / wy, sy0, wy));
  }
  const scale = placeOf({ scale: [sx, sy] }).scale;
  // what stays where the opposite corner was: it, or (past it) the corner
  const stays = [pastX ? corner[0] : opposite[0], pastY ? corner[1] : opposite[1]];
  const turned = turnBy(place.turn, [scale[0] * (stays[0] - p[0]), scale[1] * (stays[1] - p[1])]);
  const at = [fixed[0] - p[0] - turned[0], fixed[1] - p[1] - turned[1]];
  return { ...place, at, scale, pivot: p };
}

// turned by dragging from `start` to `pointer` (both on the page), about its
// pivot. shift: to a multiple of 15°
export function turned(place, pivot, start, pointer, snap = false) {
  const p = place.pivot ?? pivot;
  const [cx, cy] = transform(matrixOf(place, p), p);
  const from = Math.atan2(start[1] - cy, start[0] - cx);
  const to = Math.atan2(pointer[1] - cy, pointer[0] - cx);
  let turn = place.turn + ((to - from) * 180) / Math.PI;
  if (snap) turn = Math.round(turn / 15) * 15;
  turn = ((((turn + 180) % 360) + 360) % 360) - 180;
  return { ...place, turn, pivot: p };
}

// a layer that's one of several being turned together, by `degrees` about
// `centre` (on the page): it goes round, and turns as it goes
export function turnedAbout(place, pivot, centre, degrees) {
  const p = place.pivot ?? pivot;
  const [rx, ry] = turnBy(degrees, [place.at[0] + p[0] - centre[0], place.at[1] + p[1] - centre[1]]);
  let turn = place.turn + degrees;
  turn = ((((turn + 180) % 360) + 360) % 360) - 180;
  return { ...place, at: [centre[0] + rx - p[0], centre[1] + ry - p[1]], turn, pivot: p };
}

// and sized together, `by` as much, away from `fixed` (on the page)
export function sizedAbout(place, pivot, fixed, by) {
  const p = place.pivot ?? pivot;
  const [px, py] = [place.at[0] + p[0], place.at[1] + p[1]];
  const scale = placeOf({ scale: place.scale.map((s) => s * by) }).scale;
  return { ...place, at: [fixed[0] + by * (px - fixed[0]) - p[0], fixed[1] + by * (py - fixed[1]) - p[1]], scale, pivot: p };
}

// how far round the pointer's gone about `centre`, from `start` (degrees;
// shift: to a multiple of 15°)
export function angleAbout(centre, start, pointer, snap = false) {
  const degrees = ((Math.atan2(pointer[1] - centre[1], pointer[0] - centre[0]) - Math.atan2(start[1] - centre[1], start[0] - centre[0])) * 180) / Math.PI;
  return snap ? Math.round(degrees / 15) * 15 : degrees;
}

// how much bigger, dragging a corner that was at `from` to `pointer`, away
// from `fixed` (never nothing, nor inside out)
export function factorAbout(fixed, from, pointer) {
  const [ux, uy] = [from[0] - fixed[0], from[1] - fixed[1]];
  const along = ((pointer[0] - fixed[0]) * ux + (pointer[1] - fixed[1]) * uy) / (ux * ux + uy * uy || 1);
  return Math.max(0.05, along);
}
