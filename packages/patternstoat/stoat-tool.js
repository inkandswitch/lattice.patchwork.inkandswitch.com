// (a stand-in, till its editor is written)
export default function StoatTool(handle, element) {
	element.textContent = "patternstoat"
	return () => {
		element.textContent = ""
	}
}
