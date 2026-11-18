import { Vec3 } from "../Vec3.js";

// Flattens a yarn's segment list into the control-point array the renderer and
// spline code expect. Purely a function of nodes + segments, so it's shared by
// every stitch model.
export function segmentsToPoints(segmentArr, nodes) {
  const controlPoints = [];
  for (const { source, sourceOffset, target, targetOffset } of segmentArr) {
    const sourcePos = nodes[source].pos;
    controlPoints.push(...Vec3.add(sourcePos, sourceOffset ?? [0, 0, 0]));
    const targetPos = nodes[target].pos;
    controlPoints.push(...Vec3.add(targetPos, targetOffset ?? [0, 0, 0]));
  }
  return controlPoints;
}
