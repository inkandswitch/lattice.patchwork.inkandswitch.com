// the screen as latticex sends it. each row is a list of runs,
// [x, text, fg, bg, flags]: the column it starts at, its characters, and how
// they look. a colour is -1 for the terminal's own, 0–255 for a palette
// colour, or 0x1000000 | rgb. a wide character (漢) is a run of its own, two
// columns wide, flagged WIDE. what's past a row's last run is blank
export const BOLD = 1
export const ITALIC = 2
export const UNDERLINE = 4
export const INVERSE = 8
export const DIM = 16
export const STRIKE = 32
export const INVISIBLE = 64
export const WIDE = 128

export const RGB = 0x1000000

function fg(cell) {
	if (cell.isFgDefault()) return -1
	return cell.isFgRGB() ? RGB | cell.getFgColor() : cell.getFgColor()
}

function bg(cell) {
	if (cell.isBgDefault()) return -1
	return cell.isBgRGB() ? RGB | cell.getBgColor() : cell.getBgColor()
}

function flags(cell) {
	return (
		(cell.isBold() ? BOLD : 0) |
		(cell.isItalic() ? ITALIC : 0) |
		(cell.isUnderline() ? UNDERLINE : 0) |
		(cell.isInverse() ? INVERSE : 0) |
		(cell.isDim() ? DIM : 0) |
		(cell.isStrikethrough() ? STRIKE : 0) |
		(cell.isInvisible() ? INVISIBLE : 0)
	)
}

/** one row of an @xterm/headless buffer as runs */
export function rowRuns(line, cols, cell) {
	const runs = []
	let run = null
	for (let x = 0; x < cols; x++) {
		line?.getCell(x, cell)
		if (!line || !cell) break
		const width = cell.getWidth()
		// the second half of a wide character
		if (width === 0) continue
		const text = cell.getChars() || " "
		const look = [fg(cell), bg(cell), flags(cell) | (width === 2 ? WIDE : 0)]
		if (
			run &&
			!(look[2] & WIDE) &&
			run.look[0] === look[0] &&
			run.look[1] === look[1] &&
			run.look[2] === look[2]
		) {
			run.text += text
			continue
		}
		run = {x, text, look}
		runs.push(run)
	}
	// blank at the end of the row is the default anyway
	while (runs.length) {
		const last = runs[runs.length - 1]
		if (last.look[1] !== -1 || last.look[2] & (INVERSE | UNDERLINE | STRIKE)) break
		const kept = last.text.trimEnd()
		if (kept) {
			last.text = kept
			break
		}
		runs.pop()
	}
	return runs.map(({x, text, look}) => [x, text, ...look])
}

/** a screen's rows as plain text, wide characters and all */
export function screenText(lines, cols) {
	return lines.map(runs => {
		const row = Array(cols).fill(" ")
		for (const [x, text, , , look] of runs ?? []) {
			if (look & WIDE) {
				row[x] = text
				if (x + 1 < cols) row[x + 1] = ""
				continue
			}
			Array.from(text).forEach((char, i) => {
				if (x + i < cols) row[x + i] = char
			})
		}
		return row.join("").trimEnd()
	})
}
