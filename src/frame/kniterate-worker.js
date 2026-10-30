import {knitoutToKcode} from "./vendor/knitout-to-kcode.js"

// turns knitout into kcode off the page's thread. the converter talks a lot on
// the console: its warnings come back with the kcode, the rest is dropped
//
// in:  {id, text, name, options}
// out: {id, kcode, warnings} · {id, error, warnings}

let warnings = []
console.log = () => {}
console.warn = (...args) => warnings.push(args.join(" "))

onmessage = ({data: {id, text, name, options}}) => {
	warnings = []
	try {
		postMessage({id, kcode: knitoutToKcode(text, name, options), warnings})
	} catch (error) {
		postMessage({id, error: String(error?.message ?? error), warnings})
	}
}
