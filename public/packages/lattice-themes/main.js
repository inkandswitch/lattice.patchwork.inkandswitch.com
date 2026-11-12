// lattice's own themes, and some from patchwork's experiments/themes (each
// sets patchwork's studio and syntax tokens, which lattice's look is made of)
const themes = [
	{id: "lattice-light", name: "Lattice Light", colorScheme: "light", style: "./lattice.css"},
	{id: "lattice-dark", name: "Lattice Dark", colorScheme: "dark", style: "./lattice.css"},
	{id: "flexoki-light", name: "Flexoki Light", colorScheme: "light", style: "./flexoki-light.css"},
	{id: "flexoki-dark", name: "Flexoki Dark", colorScheme: "dark", style: "./flexoki-dark.css"},
	{id: "bear", name: "Bear", colorScheme: "light", style: "./bear.css"},
	{id: "lavender", name: "Lavender", colorScheme: "light", style: "./lavender.css"},
]

export const plugins = [
	...themes.map(theme => ({
		type: "patchwork:theme",
		id: theme.id,
		name: theme.name,
		colorScheme: theme.colorScheme,
		style: new URL(theme.style, import.meta.url).href,
		async load() {
			return {}
		},
	})),
]
