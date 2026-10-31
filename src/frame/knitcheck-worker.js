import {checkKnitout} from "./knitcheck.js"
import {knitoutToKcode} from "./vendor/knitout-to-kcode.js"

// checks a .k off the page's thread: through the kniterate's own converter
// (what it warns of, and where it stops), then on a pretend kniterate
//
// in:  {id, text, settings}
// out: {id, result} · {id, error}

let warnings = []
console.log = () => {}
console.warn = (...args) => warnings.push(args.join(" "))

onmessage = ({data: {id, text, settings}}) => {
	warnings = []
	let error = null
	try {
		knitoutToKcode(text, "check.k", {})
	} catch (thrown) {
		error = String(thrown?.message ?? thrown)
	}
	try {
		postMessage({id, result: checkKnitout(text, {error, warnings}, settings)})
	} catch (thrown) {
		postMessage({id, error: String(thrown?.message ?? thrown)})
	}
}
