// (lattice: knitscape's shared/opData.ts's Op and BACK_OPS, without its chart
// symbols, which make Path2Ds as they load: there are none in a worker)
export const Op = Object.freeze({
  MISS: 0,
  FKNIT: 1,
  FTUCK: 2,
  BKNIT: 3,
  BTUCK: 4,
  FTB: 5,
  BTF: 6,
  FDROP: 7,
  BDROP: 8,
  EMPTY: 9,
});

export const BACK_OPS = new Set([Op.BKNIT, Op.BTUCK, Op.BTF, Op.BDROP]);
