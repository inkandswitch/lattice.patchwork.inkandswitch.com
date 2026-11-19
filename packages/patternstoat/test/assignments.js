// what a function assigns and deletes in a doc, as paths ("stitches.5.1"):
// in an automerge doc, assigning a whole map or list where someone else may
// be adding to it at the same moment loses their edit
export function assignments(doc, fn) {
	const seen = []
	const wrap = (target, path) =>
		new Proxy(target, {
			get(object, key) {
				const value = object[key]
				if (value && typeof value === "object" && typeof key === "string") return wrap(value, [...path, key])
				return value
			},
			set(object, key, value) {
				if (!(Array.isArray(object) && key === "length")) seen.push({op: "set", path: [...path, key].join("."), object: !!value && typeof value === "object"})
				object[key] = value
				return true
			},
			deleteProperty(object, key) {
				seen.push({op: "delete", path: [...path, key].join(".")})
				delete object[key]
				return true
			},
		})
	fn(wrap(doc, []))
	return seen
}
