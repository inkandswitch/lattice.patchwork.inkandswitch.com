// curves for motion, as css's cubic-bezier(): a function of how far through
// it is (0–1) to how far along (0–1). the in-out one is for something moving
// from one place on screen to another
export function cubicBezier(x1, y1, x2, y2) {
  const at = (a, b, t) => 3 * a * t * (1 - t) ** 2 + 3 * b * t ** 2 * (1 - t) + t ** 3;
  const slope = (a, b, t) => 3 * a * (1 - t) ** 2 + 6 * (b - a) * t * (1 - t) + 3 * (1 - b) * t ** 2;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    // newton's method for the t whose x is x, then its y
    let t = x;
    for (let i = 0; i < 8; i++) {
      const d = slope(x1, x2, t);
      if (Math.abs(d) < 1e-6) break;
      t -= (at(x1, x2, t) - x) / d;
    }
    t = Math.max(0, Math.min(1, t));
    return at(y1, y2, t);
  };
}

export const easeInOut = cubicBezier(0.77, 0, 0.175, 1);
export const easeOut = cubicBezier(0.23, 1, 0.32, 1);

/** whether whoever's looking asked for less motion */
export const lessMotion = () =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
