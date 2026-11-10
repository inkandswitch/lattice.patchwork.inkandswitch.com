// perfect-freehand — MIT © Steve Ruiz (steveruizok/perfect-freehand, v1.2.x).
// this readable port is chee's, from aftersun (patchwork/playground/aftersun,
// sketchy/lith), where it's checked against perfect-freehand@1.2.3's own
// build. vendored as it isn't in patchwork's importmap. wm's ink (../ink.js)
// draws with it

const { min, PI, hypot, sin, cos } = Math;
const FIXED_PI = PI + 0.0001;

// ── vectors — a point is [x, y] (a third slot carries pressure) ───────────────
const neg = (a) => [-a[0], -a[1]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const mul = (a, s) => [a[0] * s, a[1] * s];
const div = (a, s) => [a[0] / s, a[1] / s];
const per = (a) => [a[1], -a[0]]; // perpendicular
const dpr = (a, b) => a[0] * b[0] + a[1] * b[1]; // dot product
const isEqual = (a, b) => a[0] === b[0] && a[1] === b[1];
const len = (a) => hypot(a[0], a[1]);
const dist2 = (a, b) => { const x = a[0] - b[0], y = a[1] - b[1]; return x * x + y * y; };
const uni = (a) => div(a, len(a)); // normalize
const dist = (a, b) => hypot(a[1] - b[1], a[0] - b[0]);
const lrp = (a, b, t) => add(a, mul(sub(b, a), t)); // linear interpolate
const prj = (a, b, c) => add(a, mul(b, c)); // project a in direction b by dist c
const rotAround = (a, c, r) => {
  const s = sin(r), co = cos(r);
  const px = a[0] - c[0], py = a[1] - c[1];
  return [px * co - py * s + c[0], px * s + py * co + c[1]];
};

// ink radius at a given pressure
function getStrokeRadius(size, thinning, pressure, easing = (t) => t) {
  return size * easing(0.5 - thinning * (0.5 - pressure));
}

// ── raw input → resampled stroke points (streamlined, with running length) ────
export function getStrokePoints(points, options = {}) {
  const { streamline = 0.5, size = 16, last: isComplete = false } = options;
  const t = 0.15 + (1 - streamline) * 0.85;
  if (points.length === 0) return [];

  let pts = Array.isArray(points[0])
    ? points
    : points.map(({ x, y, pressure = 0.5 }) => [x, y, pressure]);

  if (pts.length === 2) {
    const last = pts[1];
    pts = pts.slice(0, -1);
    for (let i = 1; i < 5; i++) pts.push(lrp(pts[0], last, i / 4));
  }
  if (pts.length === 1) pts = [...pts, [...add(pts[0], [1, 1]), ...pts[0].slice(2)]];

  const strokePoints = [
    {
      point: [pts[0][0], pts[0][1]],
      pressure: pts[0][2] >= 0 ? pts[0][2] : 0.25,
      vector: [1, 1],
      distance: 0,
      runningLength: 0,
    },
  ];

  let hasReachedMinimumLength = false;
  let runningLength = 0;
  let prev = strokePoints[0];
  const max = pts.length - 1;

  for (let i = 1; i < pts.length; i++) {
    const point = isComplete && i === max ? [pts[i][0], pts[i][1]] : lrp(prev.point, pts[i], t);
    if (isEqual(prev.point, point)) continue;

    const distance = dist(point, prev.point);
    runningLength += distance;

    if (i < max && !hasReachedMinimumLength) {
      if (runningLength < size) continue;
      hasReachedMinimumLength = true;
    }

    prev = {
      point,
      pressure: pts[i][2] >= 0 ? pts[i][2] : 0.5,
      vector: uni(sub(prev.point, point)),
      distance,
      runningLength,
    };
    strokePoints.push(prev);
  }

  strokePoints[0].vector = (strokePoints[1] && strokePoints[1].vector) || [0, 0];
  return strokePoints;
}

// ── stroke points → the filled outline polygon ────────────────────────────────
export function getStrokeOutlinePoints(points, options = {}) {
  const {
    size = 16,
    smoothing = 0.5,
    thinning = 0.5,
    simulatePressure = true,
    easing = (t) => t,
    start = {},
    end = {},
    last: isComplete = false,
  } = options;
  const { cap: capStart = true, easing: taperStartEase = (t) => t * (2 - t) } = start;
  const { cap: capEnd = true, easing: taperEndEase = (t) => --t * t * t + 1 } = end;

  if (points.length === 0 || size <= 0) return [];

  const totalLength = points[points.length - 1].runningLength;
  const taper = (v) => (v === false || v === undefined ? 0 : v === true ? Math.max(size, totalLength) : v);
  const taperStart = taper(start.taper);
  const taperEnd = taper(end.taper);

  const minDistance = (size * smoothing) ** 2;
  const leftPts = [];
  const rightPts = [];

  // seed pressure from the first few points (smooths out a jumpy start)
  let prevPressure = points.slice(0, 10).reduce((acc, curr) => {
    let pressure = curr.pressure;
    if (simulatePressure) {
      const sp = min(1, curr.distance / size);
      const rp = min(1, 1 - sp);
      pressure = min(1, acc + (rp - acc) * (sp * 0.275));
    }
    return (acc + pressure) / 2;
  }, points[0].pressure);

  let radius = getStrokeRadius(size, thinning, points[points.length - 1].pressure, easing);
  let firstRadius;
  let prevVector = points[0].vector;
  let pl = points[0].point;
  let pr = points[0].point;
  let tl = pl;
  let tr = pr;
  let isPrevPointSharpCorner = false;

  for (let i = 0; i < points.length; i++) {
    let { pressure } = points[i];
    const { point, vector, distance, runningLength } = points[i];
    if (i < points.length - 1 && totalLength - runningLength < 3) continue;

    if (thinning) {
      if (simulatePressure) {
        const sp = min(1, distance / size);
        const rp = min(1, 1 - sp);
        pressure = min(1, prevPressure + (rp - prevPressure) * (sp * 0.275));
      }
      radius = getStrokeRadius(size, thinning, pressure, easing);
    } else {
      radius = size / 2;
    }
    if (firstRadius === undefined) firstRadius = radius;

    const ts = runningLength < taperStart ? taperStartEase(runningLength / taperStart) : 1;
    const te = totalLength - runningLength < taperEnd ? taperEndEase((totalLength - runningLength) / taperEnd) : 1;
    radius = Math.max(0.01, radius * Math.min(ts, te));

    const nextVector = (i < points.length - 1 ? points[i + 1] : points[i]).vector;
    const nextDpr = i < points.length - 1 ? dpr(vector, nextVector) : 1;
    const prevDpr = dpr(vector, prevVector);
    const isPointSharpCorner = prevDpr < 0 && !isPrevPointSharpCorner;
    const isNextPointSharpCorner = nextDpr !== null && nextDpr < 0;

    if (isPointSharpCorner || isNextPointSharpCorner) {
      const offset = mul(per(prevVector), radius);
      for (let step = 1 / 13, t = 0; t <= 1; t += step) {
        tl = rotAround(sub(point, offset), point, FIXED_PI * t);
        leftPts.push(tl);
        tr = rotAround(add(point, offset), point, FIXED_PI * -t);
        rightPts.push(tr);
      }
      pl = tl;
      pr = tr;
      if (isNextPointSharpCorner) isPrevPointSharpCorner = true;
      continue;
    }
    isPrevPointSharpCorner = false;

    if (i === points.length - 1) {
      const offset = mul(per(vector), radius);
      leftPts.push(sub(point, offset));
      rightPts.push(add(point, offset));
      continue;
    }

    const offset = mul(per(lrp(nextVector, vector, nextDpr)), radius);
    tl = sub(point, offset);
    if (i <= 1 || dist2(pl, tl) > minDistance) {
      leftPts.push(tl);
      pl = tl;
    }
    tr = add(point, offset);
    if (i <= 1 || dist2(pr, tr) > minDistance) {
      rightPts.push(tr);
      pr = tr;
    }

    prevPressure = pressure;
    prevVector = vector;
  }

  const firstPoint = points[0].point.slice(0, 2);
  const lastPoint = points.length > 1 ? points[points.length - 1].point.slice(0, 2) : add(points[0].point, [1, 1]);
  const startCap = [];
  const endCap = [];

  if (points.length === 1) {
    if (!(taperStart || taperEnd) || isComplete) {
      const start2 = prj(firstPoint, uni(per(sub(firstPoint, lastPoint))), -(firstRadius || radius));
      const dotPts = [];
      for (let step = 1 / 13, t = step; t <= 1; t += step) dotPts.push(rotAround(start2, firstPoint, FIXED_PI * 2 * t));
      return dotPts;
    }
  } else {
    // start cap
    if (taperStart || (taperEnd && points.length === 1)) {
      // tapered — no cap
    } else if (capStart) {
      for (let step = 1 / 13, t = step; t <= 1; t += step) startCap.push(rotAround(rightPts[0], firstPoint, FIXED_PI * t));
    } else {
      const corners = sub(leftPts[0], rightPts[0]);
      const a = mul(corners, 0.5);
      const b = mul(corners, 0.51);
      startCap.push(sub(firstPoint, a), sub(firstPoint, b), add(firstPoint, b), add(firstPoint, a));
    }

    // end cap
    const dir = per(neg(points[points.length - 1].vector));
    if (taperEnd || (taperStart && points.length === 1)) {
      endCap.push(lastPoint);
    } else if (capEnd) {
      const start2 = prj(lastPoint, dir, radius);
      for (let step = 1 / 29, t = step; t < 1; t += step) endCap.push(rotAround(start2, lastPoint, FIXED_PI * 3 * t));
    } else {
      endCap.push(
        add(lastPoint, mul(dir, radius)),
        add(lastPoint, mul(dir, radius * 0.99)),
        sub(lastPoint, mul(dir, radius * 0.99)),
        sub(lastPoint, mul(dir, radius)),
      );
    }
  }

  return leftPts.concat(endCap, rightPts.reverse(), startCap);
}

// raw input → outline. `points` may be [[x,y,pressure?],…] or [{x,y,pressure?},…].
export function getStroke(points, options = {}) {
  return getStrokeOutlinePoints(getStrokePoints(points, options), options);
}

export default getStroke;
