import { hexToRgb } from "../../shared/hexToRgb.js";
import { segmentsToPoints } from "../../shared/simulation/segments.js";
import { createRelaxationDriver } from "../../shared/simulation/relaxationDriver.js";
import { computeYarnPathSpline, layoutNodes } from "./layout.js";
import { generateTopology } from "./topology.js";

export const DEFAULT_YARN_DIAMETER = 0.27;
export const DEFAULT_STITCH_ASPECT = 1;
const STITCH_WIDTH = 1;
const BED_OFFSET = 0.25;

export function simulate(program, options) {
  const yarnDiameter = options.yarnDiameter ?? DEFAULT_YARN_DIAMETER;
  const params = {
    YARN_RADIUS: yarnDiameter / 2,
    STITCH_WIDTH,
    ASPECT: options.cellAspect,
    BED_OFFSET,
  };

  const layoutMode = options.layoutMode ?? "technical";

  function buildGeometry(maxStitch) {
    const topology = generateTopology(program, layoutMode, maxStitch);
    const { nodes, nodeMap } = layoutNodes(topology, program, params);
    const segments = computeYarnPathSpline(
      topology,
      program,
      nodes,
      nodeMap,
      params,
    );
    const yarnData = Object.entries(segments).map(
      ([yarnIndex, segmentArr]) => ({
        yarnIndex,
        pts: segmentsToPoints(segmentArr, nodes),
        diameter: yarnDiameter,
        color: hexToRgb(program.palette[Number(yarnIndex) - 1]).map(
          (colorInt) => colorInt / 255,
        ),
      }),
    );
    return { nodes, segments, yarnData };
  }

  const t0 = performance.now();
  const geometry = buildGeometry(options.maxStitch ?? Infinity);
  const topologyMs = performance.now() - t0;

  const driver = createRelaxationDriver(geometry, {
    canvas: options.canvas,
    resetCamera: options.resetCamera,
    relaxSettings: options.relaxSettings,
    createWorker: options.createWorker,
  });

  function setMaxStitch(n) {
    driver.rebuild(buildGeometry(n));
  }

  return { ...driver, setMaxStitch, topologyMs };
}
