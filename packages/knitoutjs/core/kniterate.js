// helpers for the kniterate, which a pattern has from "lattice" (or its
// other names, "knitout-utilities/kniterate" and "kniterate-utilities"):
// `bindoff(k, dir, min, max, carrier)` and `addWasteSection(k, carriers,
// castOnCarrier, min, max)`. each writes its ops to k, a knitout Writer.
// the run worker loads this, so it imports nothing

// bind off the front bed from min to max (dir "+") or max to min ("-"),
// knitting each loop onto the next one along with carrier
export function bindoff(k, dir, min, max, carrier) {
  k.stitchNumber(4);
  let i = 0;
  if (dir === "+") {
    for (let n = min; n < max; ++n, ++i) {
      k.speedNumber(200);
      k.rollerAdvance(0);
      k.xfer("f" + n, "b" + n);
      k.rack(1);
      k.xfer("b" + n, "f" + (n + 1));
      k.rack(0);
      k.speedNumber(300);
      k.rollerAdvance(Math.max(150, 250 - 50 * i));
      k.knit("+", "f" + (n + 1), carrier);
    }
  } else {
    for (let n = max; n > min; --n, ++i) {
      k.speedNumber(200);
      k.rollerAdvance(0);
      k.xfer("f" + n, "b" + n);
      k.rack(-1);
      k.xfer("b" + n, "f" + (n - 1));
      k.rack(0);
      k.speedNumber(300);
      k.rollerAdvance(Math.max(150, 250 - 50 * i));
      k.knit("-", "f" + (n - 1), carrier);
    }
  }
}

// the kniterate's settings, which a waste section starts with
const WASTE_DEFAULTS = {
  rollerAdvance: 450,
  stitchNumber: 5,
  speedNumber: 400,
  wasteCarrier: "6",
  drawCarrier: "1",
};
// waste yarn interlock passes: always odd, so the waste carrier ends at the right
const WASTE_PASSES = 71;
const TUBE_ROWS = 5;

// the carriers a waste section brings in, and what each is for. each starts
// at the left
class CarrierSet {
  constructor(carriers = []) {
    this.carriers = carriers.map((c) => ({ position: "L", castOn: false, ...c }));
  }
  get castOn() {
    return this.carriers.find((c) => c.castOn);
  }
  get mainYarns() {
    return this.carriers.filter((c) => c.isMainYarn);
  }
  get(id) {
    return this.carriers.find((c) => c.id === id);
  }
  #find(id) {
    const carrier = this.get(id);
    if (!carrier) throw new Error(`carrier ${id} not found`);
    return carrier;
  }
  setMain(id, main) {
    this.#find(id).isMainYarn = main;
  }
  setRole(id, role) {
    this.#find(id).role = role;
  }
  push(carrier) {
    if (this.get(carrier.id)) throw new Error(`carrier ${carrier.id} already exists`);
    this.carriers.push({ position: "L", castOn: false, ...carrier });
  }
}

// a pass of interlock from min to max ("+", even needles on `even`'s bed) or
// back ("-")
function interlock(k, dir, min, max, carrier, even) {
  const odd = even === "f" ? "b" : "f";
  if (dir === "+") {
    for (let n = min; n <= max; ++n) k.knit("+", `${n % 2 === 0 ? even : odd}${n}`, carrier);
  } else {
    for (let n = max; n >= min; --n) k.knit("-", `${n % 2 === 0 ? even : odd}${n}`, carrier);
  }
}

function generateWasteSection(k, carrierSet, min, max, { wasteCarrier, drawCarrier }) {
  // slow for the first bit
  k.speedNumber(300);
  k.rollerAdvance(450);

  // tuck each carrier in turn
  const count = carrierSet.carriers.length;
  carrierSet.carriers.forEach((carrier, i) => {
    k.in(carrier.id);
    for (let n = min; n <= max; ++n) {
      const bed = (Math.abs(n) + i) % 2 === 0 ? "f" : "b";
      if (Math.abs(n) % count === i) k.tuck("+", bed + n, carrier.id);
      else if (n === max) k.miss("+", bed + n, carrier.id);
    }
    for (let n = max; n >= min; --n) {
      const bed = (Math.abs(n) + i) % 2 === 0 ? "b" : "f";
      if (Math.abs(n) % count === i) k.tuck("-", bed + n, carrier.id);
      else if (n === min) k.miss("-", bed + n, carrier.id);
    }
  });

  // waste yarn interlock, then faster
  k.comment("waste yarn section");
  k.speedNumber(400);
  for (let p = 0; p < WASTE_PASSES; ++p) {
    if (p % 2 === 0) {
      k.rollerAdvance(450);
      interlock(k, "+", min, max, wasteCarrier, "f");
    } else {
      k.rollerAdvance(0);
      interlock(k, "-", min, max, wasteCarrier, "b");
    }
  }

  // bring in the draw thread: one row, left to right
  interlock(k, "+", min, max, drawCarrier, "b");

  // bring in each main yarn: one row or two, so the cast on carrier ends up
  // going the other way to the rest
  for (const carrier of carrierSet.mainYarns) {
    let rows = 2;
    if (carrier.castOn && carrier.dir === "+") rows = 1;
    if (!carrier.castOn && carrier.dir === "-") rows = 1;
    for (let row = 0; row < rows; row++) {
      if (row % 2 === 0) interlock(k, "+", min, max, carrier.id, "f");
      else interlock(k, "-", min, max, carrier.id, "b");
    }
  }

  // a tube of waste, slower, dropping out on the left
  k.speedNumber(200);
  k.rollerAdvance(200);
  for (let p = 0; p < TUBE_ROWS; ++p) {
    if (p % 2 === 0) for (let n = max; n >= min; --n) k.knit("-", `b${n}`, wasteCarrier);
    else for (let n = min; n <= max; ++n) k.knit("+", `f${n}`, wasteCarrier);
  }

  // drop the back bed
  k.rollerAdvance(450);
  for (let n = min; n <= max; ++n) k.drop("b" + n);

  // the draw thread: always right to left
  k.comment("draw thread");
  k.rollerAdvance(100);
  for (let n = max; n >= min; --n) k.knit("-", `f${n}`, drawCarrier);
  k.out(drawCarrier);

  // cast on, half racked
  k.rollerAdvance(450);
  const castOn = carrierSet.castOn;
  if (castOn.dir === "-") {
    k.rack(0.5);
    for (let n = min; n <= max; ++n) {
      k.knit("+", `f${n}`, castOn.id);
      k.knit("+", `b${n}`, castOn.id);
    }
  } else {
    k.rack(-0.5);
    for (let n = max; n >= min; --n) {
      k.knit("-", `f${n}`, castOn.id);
      k.knit("-", `b${n}`, castOn.id);
    }
  }
  k.rack(0);

  // transfer the back bed to the front
  k.speedNumber(300);
  if (castOn.dir === "+") for (let n = min; n <= max; ++n) k.xfer("b" + n, "f" + n);
  else for (let n = max; n >= min; --n) k.xfer("b" + n, "f" + n);

  k.speedNumber(450);
  k.out(wasteCarrier);
}

// a waste section from min to max, bringing in each of `carriers` (the main
// yarns) and casting on with castOnCarrier, one of them. options can change
// the waste and draw thread carriers ("6" and "1") and the settings it
// starts with (rollerAdvance 450, stitchNumber 5, speedNumber 400)
export function addWasteSection(k, carriers, castOnCarrier, min, max, options = {}) {
  const settings = { ...WASTE_DEFAULTS, ...options };
  const { wasteCarrier, drawCarrier } = settings;
  if (!carriers.includes(castOnCarrier)) {
    throw new Error(`addWasteSection: the cast on carrier (${castOnCarrier}) is one of the carriers`);
  }

  k.rollerAdvance(settings.rollerAdvance);
  k.stitchNumber(settings.stitchNumber);
  k.speedNumber(settings.speedNumber);

  const carrierSet = new CarrierSet();
  for (const id of carriers) {
    if (carrierSet.get(id)) continue;
    const castOn = id === castOnCarrier;
    carrierSet.push({ id, role: castOn ? "castOn" : null, castOn, isMainYarn: true, dir: "+" });
  }

  // the waste yarn: last, if it's not a main yarn already (if it were the
  // first one tucked, that'd be a subtle bug)
  if (carrierSet.get(wasteCarrier)) {
    console.warn(`addWasteSection: carrier ${wasteCarrier} is the waste yarn carrier, make sure it's what you want to use!`);
    carrierSet.setRole(wasteCarrier, "waste");
    carrierSet.setMain(wasteCarrier, false);
  } else {
    carrierSet.push({ id: wasteCarrier, role: "waste", isMainYarn: false, dir: "+" });
  }

  // the draw thread
  if (carrierSet.get(drawCarrier)) {
    console.warn(`addWasteSection: main carriers can't be the same as the draw thread (${drawCarrier})`);
    carrierSet.setRole(drawCarrier, "drawThread");
  } else {
    carrierSet.push({ id: drawCarrier, role: "drawThread", isMainYarn: false, dir: "+" });
  }

  generateWasteSection(k, carrierSet, min, max, settings);
}
