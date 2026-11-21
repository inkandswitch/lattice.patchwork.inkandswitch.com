// what the language server knows of the knitout library a pattern gets from
// `require("knitout")` or `import … from "knitout"` (it's the vendored
// evalJS.js Writer). the argument shapes are what its shiftDirection,
// shiftBedNeedle and shiftCarrierSet accept, and each doc says what the
// method pushes and what it throws on
export const KNITOUT_TYPES = `declare module "knitout" {
  /** the way a carrier moves, or a stitch goes: + is left to right, - right to left */
  export type Direction = "+" | "-";
  /** a bed: front or back, and \`s\` for the slider bed in front of it */
  export type Bed = "f" | "b" | "fs" | "bs";
  /** a needle as one string, like "f10", "b-2" or "bs66" */
  export type NeedleString = \`\${Bed}\${number}\`;
  /** a needle as a string, as ["f", 12], or as { bed: "fs", needle: 5 } */
  export type Needle = NeedleString | [bed: Bed, needle: number] | { bed: Bed; needle: number };

  export interface WriterOptions {
    /** the carrier names, front to back; none of them may contain a space */
    carriers: string[];
  }

  export class Writer {
    /**
     * makes a writer. its first header is \`;;Carriers: …\` from the carriers.
     * throws when carriers isn't an array of space-free strings (and warns,
     * assuming one carrier "A", when there's no carriers option at all)
     */
    constructor(options: WriterOptions);

    /** the carriers that are in right now, and whether each is on the yarn inserting hook */
    carriers: { [carrier: string]: { hook: boolean } };
    /** the needles holding a loop right now, by name ("f10") */
    needles: { [needle: string]: true };
    /** the current racking, as set by rack() */
    racking: number;

    /**
     * adds a \`;;name: value\` header. names can't hold ": ", values can't hold a
     * newline, "Carriers" can't be set (use the constructor), "Position" is one of
     * Left, Center, Right or Keep, and "Yarn-<carrier>" and "X-…" names are
     * accepted. throws on a bad name or value; an unknown name is warned about
     * and written anyway
     */
    addHeader(name: string, value: string): void;
    /** adds a line to the output as it is, with no checking (and a warning) */
    addRawOperation(operation: string): void;

    /** brings carriers in (\`in A B\`). throws on an empty set, an unknown carrier, or one that's in already */
    in(...carriers: string[]): void;
    in(carriers: string[]): void;
    /** brings carriers in on the yarn inserting hook (\`inhook\`). throws as in() does */
    inhook(...carriers: string[]): void;
    inhook(carriers: string[]): void;
    /** lets go of carriers held by the hook (\`releasehook\`). throws when one isn't in, or isn't on the hook */
    releasehook(...carriers: string[]): void;
    releasehook(carriers: string[]): void;
    /** takes carriers out (\`out\`). throws on an empty set, or a carrier that isn't in */
    out(...carriers: string[]): void;
    out(carriers: string[]): void;
    /** takes carriers out with the hook (\`outhook\`). throws as out() does */
    outhook(...carriers: string[]): void;
    outhook(carriers: string[]): void;

    /** sets the stitch values before and after a knit (\`stitch L T\`). throws unless both are finite numbers */
    stitch(before: number, after: number): void;
    /** \`x-stitch-number\`. throws unless it's a non-negative integer */
    stitchNumber(stitchNumber: number): void;
    /** \`x-presser-mode\`. an unknown mode is warned about and ignored */
    fabricPresser(mode: "auto" | "on" | "off"): void;
    /** \`x-vis-color\`: how to draw a carrier in a visualiser. warns and ignores when the color doesn't start with # or the carrier isn't listed */
    visColor(hex: \`#\${string}\`, carrier: string): void;
    /** \`x-speed-number\`. a value that isn't a non-negative integer is warned about and ignored */
    speedNumber(value: number): void;
    /** \`x-roller-advance\` (Kniterate). a value that isn't an integer is warned about and ignored */
    rollerAdvance(value: number): void;
    /** \`x-add-roller-advance\` (Kniterate). a value that isn't an integer is warned about and ignored */
    addRollerAdvance(value: number): void;
    /** \`x-carrier-spacing\` (Kniterate). a value that isn't a positive integer is warned about and ignored */
    carrierSpacing(value: number): void;
    /** \`x-carrier-stopping-distance\` (Kniterate). a value that isn't a positive integer is warned about and ignored */
    carrierStoppingDistance(value: number): void;

    /** which way the last knit, tuck or miss with this carrier went: "R" for +, "L" for -, or null when it hasn't */
    getCarrierPosition(carrier: string): "R" | "L" | null;
    /** the bed ("f", "b", …) of the last operation that touched this needle number, or null */
    getNeedleBed(needle: number): string | null;

    /** shifts the back bed relative to the front (\`rack\`). throws unless it's a finite number */
    rack(racking: number): void;

    /**
     * makes a loop at a needle, pulling it through the loop it holds (\`knit\`). with no
     * carriers it's a knit with no yarn, which drops the loop. throws on a bad
     * direction, needle or carrier name
     */
    knit(direction: Direction, needle: Needle, ...carriers: string[]): void;
    knit(direction: Direction, needle: Needle, carriers: string[]): void;
    knit(direction: Direction, bed: Bed, needle: number, ...carriers: string[]): void;
    knit(direction: Direction, bed: Bed, needle: number, carriers: string[]): void;
    /** makes a loop at a needle, keeping the loop it holds (\`tuck\`). throws as knit() does */
    tuck(direction: Direction, needle: Needle, ...carriers: string[]): void;
    tuck(direction: Direction, needle: Needle, carriers: string[]): void;
    tuck(direction: Direction, bed: Bed, needle: number, ...carriers: string[]): void;
    tuck(direction: Direction, bed: Bed, needle: number, carriers: string[]): void;
    /** takes the carrier past a needle without making a loop (\`miss\`). throws as knit() does, and on an empty carrier set */
    miss(direction: Direction, needle: Needle, ...carriers: string[]): void;
    miss(direction: Direction, needle: Needle, carriers: string[]): void;
    miss(direction: Direction, bed: Bed, needle: number, ...carriers: string[]): void;
    miss(direction: Direction, bed: Bed, needle: number, carriers: string[]): void;

    /**
     * knits a new loop at the first needle and passes the old one to the second
     * (\`split\`), the first needle on the other bed. each needle is one argument or
     * a bed and a number, then the carriers. throws on bad arguments
     */
    split(
      direction: Direction,
      ...args: [...from: NeedleArgs, ...to: NeedleArgs, ...carriers: string[]]
        | [...from: NeedleArgs, ...to: NeedleArgs, carriers: string[]]
    ): void;
    /** moves the loop at the first needle to the second (\`xfer\`). each needle is one argument or a bed and a number. throws on bad arguments or extra ones */
    xfer(...args: [...from: NeedleArgs, ...to: NeedleArgs]): void;
    /** drops the loop at a needle (\`drop\`). throws on bad arguments or extra ones */
    drop(needle: Needle): void;
    drop(bed: Bed, needle: number): void;
    /** a tuck with no yarn (\`amiss\`). throws on bad arguments or extra ones */
    amiss(needle: Needle): void;
    amiss(bed: Bed, needle: number): void;

    /** adds a comment (\`;…\`), a line each for a multi-line string; a leading ; is stripped (with a warning) */
    comment(text: string): void;
    /** asks the machine to pause (\`pause\`), after a comment of the same text */
    pause(comment: string): void;
    /**
     * returns the knitout text: the version line, the headers, the operations. when
     * given a filename it writes it there too (node only); without one it logs it
     */
    write(filename?: string): string;
  }

  /** a needle as the arguments of a call: one argument, or a bed then a number */
  type NeedleArgs = [needle: Needle] | [bed: Bed, needle: number];

  const knitout: { Writer: typeof Writer };
  export default knitout;
}
`;
