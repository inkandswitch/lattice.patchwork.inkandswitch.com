// the edit made to some text, worked out from it before and after (and where
// the caret's left): what profile-form.js's boxes of words splice into their
// doc as they're typed, and how a caret moves when someone else's edit lands
// around it

// how far two strings agree from the start, and from the end
function samePrefix(a, b) {
	let n = 0
	while (n < a.length && n < b.length && a[n] === b[n]) n++
	return n
}
function sameSuffix(a, b) {
	let n = 0
	while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++
	return n
}

// the one edit that turns `before` into `after`, the caret at `caret` after
// it: {at, remove, insert}. what's typed or pasted ends at the caret, so it's
// placed by that, and a letter typed beside the same letter ("aa" → "aaa")
// goes where it was typed, not at the first place it'd fit
export function editBetween(before, after, caret = after.length) {
	const keep = Math.min(sameSuffix(before, after), after.length - Math.min(caret, after.length), before.length)
	const at = Math.min(samePrefix(before, after), before.length - keep, after.length - keep)
	return {at, remove: before.length - keep - at, insert: after.slice(at, after.length - keep)}
}

// where a position goes when `edit` happens before or around it
export const moved = (position, {at, remove, insert}) =>
	position <= at ? position : position >= at + remove ? position - remove + insert.length : at + insert.length
