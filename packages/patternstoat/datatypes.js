// patchwork datatypes for a charm and a patternstoat
import {newCharm} from "./charm.js"
import {newPatternstoat} from "./patternstoat.js"

function datatype(make, fallback) {
	return {
		init(doc) {
			const {"@patchwork": _, ...fields} = make()
			Object.assign(doc, fields)
		},
		getTitle(doc) {
			return doc?.title || fallback
		},
		setTitle(doc, title) {
			doc.title = title
		},
	}
}

export const CharmDatatype = datatype(newCharm, "charm")
export const PatternstoatDatatype = datatype(newPatternstoat, "patternstoat")
