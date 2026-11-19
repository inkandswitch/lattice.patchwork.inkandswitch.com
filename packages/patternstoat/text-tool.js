// (a stand-in, till its editor is written)
export default function CharmTextTool(handle, element) {
	element.textContent = "charm-text"
	return () => {
		element.textContent = ""
	}
}
