const themes = [
	{id: "lattice-light", name: "Lattice Light", colorScheme: "light"},
	{id: "lattice-dark", name: "Lattice Dark", colorScheme: "dark"},
]

export const plugins = [
	...themes.map(theme => ({
		type: "patchwork:theme",
		id: theme.id,
		name: theme.name,
		colorScheme: theme.colorScheme,
		style: new URL("./lattice.css", import.meta.url).href,
		async load() {
			return {}
		},
	})),
]
