import {newSettling} from "./settling.js"

// the fabric settling (see settling.js), off the page's thread: settler.js's
// messages in, and answers out, their arrays handed over rather than copied
//
// in:  {type: "load", gen, ops, carriers} · {type: "step", gen, request}
// out: {gen, answer}

const settling = newSettling()

onmessage = ({data}) => {
	const reply = settling.handle(data)
	if (!reply) return
	const {xs, ys, zs, slack, pinned, strain} = reply.answer
	postMessage(reply, [xs.buffer, ys.buffer, zs.buffer, slack.buffer, pinned.buffer, strain.buffer])
}
