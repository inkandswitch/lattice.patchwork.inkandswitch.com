// (a stand-in, till its editor is written)
export default function ArrangementTool(handle, element) {
	element.textContent = "arrangement"
	return () => {
		element.textContent = ""
	}
}
