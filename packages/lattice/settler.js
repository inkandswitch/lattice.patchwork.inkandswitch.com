import {moduleWorker} from "./files.js"
import {newSettling} from "./settling.js"

// the fabric settling, for a view: in a worker where the browser allows it
// (settling-worker.js), or else on the page, a little at a time (settling.js
// either way). the view says where it's got to and how it wants it settled
// each frame (`settle`), and draws `fabric`, the latest answer: a frame or
// so behind, and so only ever as many loops as it has (`count`), which may be
// fewer than the view's machine has made. while it isn't `ready` (nothing's
// answered for this .k yet, or the answer's from further on than the view
// has got to: it's gone back) the view keeps what it last drew
//
// it asks one thing at a time: when the request's changed since it last
// asked, or the last answer still moved (more than MOVED; at most `limit`
// times over, till the request changes). `onUpdate` is called as each answer
// comes, for the view to draw it and ask again

const WORKER_URL = new URL("./settling-worker.js", import.meta.url)
const MOVED = 0.01

export const NO_FABRIC = Object.freeze({
	upTo: 0,
	count: 0,
	xs: new Float32Array(0),
	ys: new Float32Array(0),
	zs: new Float32Array(0),
	slack: new Uint8Array(0),
	pinned: new Uint8Array(0),
	strain: new Float32Array(0),
	moved: 0,
})

export function settler({onUpdate = () => {}, limit = Infinity} = {}) {
	let gen = 0 // which .k: a later load's answers are the only ones taken
	let upTo = 0 // where the view last said it was
	let loaded = {type: "load", gen, ops: [], carriers: []}
	let fabric = NO_FABRIC
	let waiting = false
	let asked = null // the last request sent, as json
	let follows = 0 // how many times it's been sent again, unchanged
	let gone = false
	let inPage = null

	let worker = null
	if (typeof Worker === "function") {
		try {
			worker = moduleWorker(WORKER_URL)
		} catch (error) {
			console.warn("settling on the page instead of a worker:", error)
		}
	}
	if (worker) {
		worker.onmessage = ({data}) => receive(data)
		worker.onerror = event => {
			event.preventDefault()
			console.warn("settling on the page instead of a worker:", event.message)
			worker.terminate()
			worker = null
			// (what it had, it has again, and whatever it was asked is asked again)
			send(loaded)
			waiting = false
			asked = null
			if (!gone) api.onUpdate()
		}
	}

	function send(message) {
		if (worker) return worker.postMessage(message)
		inPage ??= newSettling()
		const reply = inPage.handle(message)
		// (answered later, as a worker would: never in the middle of the view's frame)
		if (reply) setTimeout(() => receive(reply))
	}

	function receive({gen: from, answer}) {
		if (gone) return
		waiting = false
		if (from === gen) fabric = answer
		api.onUpdate()
	}

	const api = {
		onUpdate,
		get fabric() {
			return fabric
		},
		get ready() {
			return fabric !== NO_FABRIC && fabric.upTo <= upTo
		},
		// a new .k: nothing's settled on it yet
		load(ops, carriers) {
			gen++
			fabric = NO_FABRIC
			loaded = {type: "load", gen, ops, carriers}
			send(loaded)
		},
		// be at `request.upTo`, settled as it says (see settling.js): whether
		// an answer's on its way
		settle(request) {
			upTo = request.upTo
			const json = JSON.stringify([gen, request])
			const changed = json !== asked
			if (changed) follows = 0
			const more = changed || (fabric.moved > MOVED && follows < limit)
			if (more && !waiting) {
				if (!changed) follows++
				asked = json
				waiting = true
				send({type: "step", gen, request})
			}
			return waiting
		},
		destroy() {
			gone = true
			worker?.terminate()
			worker = null
		},
	}
	return api
}
