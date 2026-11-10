import {spawn, spawnSync} from "node:child_process"
import {existsSync, readFileSync} from "node:fs"
import {dirname, join, relative, resolve, sep} from "node:path"
import {fileURLToPath} from "node:url"
import {stripVTControlCharacters} from "node:util"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const children = []
const processGroups = process.platform !== "win32"
// a cloudflare quick tunnel to this server, so the deployed lattice (yours,
// or mimi's) can use this server's packages: ?dev=<tunnel>. on unless
// --no-tunnel (or LATTICE_TUNNEL=0)
const tunnel =
	!process.argv.includes("--no-tunnel") && process.env.LATTICE_TUNNEL !== "0"
const SITE = "https://lattice.patchwork.inkandswitch.com"
const footerLines = tunnel ? 10 : 7
const footer = process.stdout.isTTY && process.stdout.rows > footerLines
let stopping = false
let footerVisible = false
let status = "starting"
let readyTimer
let devURL = "starting…"
let corePackages = ""
let basePackages = ""
let tunnelURL = tunnel ? "starting tunnel" : ""
let devLink = ""

// a spinner after "starting tunnel" until cloudflared says where it is
const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
let spinning = null
let spin = 0
function startSpinner() {
	if (!footer) return console.log("starting tunnel…")
	spinning = setInterval(() => {
		spin = (spin + 1) % SPINNER.length
		showFooter()
	}, 90)
}
function stopSpinner() {
	clearInterval(spinning)
	spinning = null
}
const tunnelText = () => (spinning ? `${tunnelURL} ${SPINNER[spin]}` : tunnelURL)

const bold = text => `\x1b[1m${text}\x1b[0m`
// a link the terminal can open (and copy whole, if it's cut short here)
const link = (url, shown = url) => `\x1b]8;;${url}\x1b\\\x1b[1;4;38;5;213m${shown}\x1b[0m\x1b]8;;\x1b\\`

function fit(value, width) {
	if (value.length <= width) return value
	return `${value.slice(0, Math.max(0, width - 1))}…`
}

function displayPath(directory) {
	const path = relative(root, directory)
	const distance = path.split(sep).filter(part => part === "..").length
	return distance <= 1 ? path : directory
}

function setStatus(next, settle = false) {
	clearTimeout(readyTimer)
	status = next
	showFooter()
	if (settle) readyTimer = setTimeout(() => setStatus("ready"), 800)
}

function showFooter() {
	if (!footer) return
	const row = process.stdout.rows
	const start = row - footerLines + 1
	const width = Math.max(
		24,
		Math.min(
			(process.stdout.columns ?? 80) - 1,
			Math.max(
				` Patchwork ${status} `.length + 2,
				devURL.length + 17,
				corePackages.length + 17,
				basePackages.length + 17,
				tunnelText().length + 17,
				devLink ? devLink.length + 7 : 0
			)
		)
	)
	const valueWidth = width - 17
	const title = fit(`─ patchwork ${status} `, width - 2)
	const lines = [
		`\x1b[2m┌${title}${"─".repeat(width - title.length - 2)}┐\x1b[0m`,
		`\x1b[2m│\x1b[0m`,
		`\x1b[2m│\x1b[0m  \x1b[36m→\x1b[0m site:     \x1b[36m${fit(devURL, valueWidth)}\x1b[0m`,
		`\x1b[2m│\x1b[0m  \x1b[36m→\x1b[0m core:     \x1b[36m${fit(corePackages, valueWidth)}\x1b[0m`,
		`\x1b[2m│\x1b[0m  \x1b[36m→\x1b[0m pkg-base: \x1b[36m${fit(basePackages, valueWidth)}\x1b[0m`,
		...(tunnel
			? [
					`\x1b[2m│\x1b[0m  \x1b[36m→\x1b[0m tunnel:   \x1b[36m${fit(tunnelText(), valueWidth)}\x1b[0m`,
					devLink ? `\x1b[2m│\x1b[0m  ${bold("send her this link:")}` : `\x1b[2m│\x1b[0m`,
					devLink ? `\x1b[2m│\x1b[0m    ${link(devLink, fit(devLink, width - 7))}` : `\x1b[2m│\x1b[0m`,
				]
			: []),
		`\x1b[2m│\x1b[0m`,
		`\x1b[2m└${"─".repeat(width - 2)}┘\x1b[0m`,
	]
	process.stdout.write(
		`\x1b[r\x1b[1;${start - 1}r\x1b[?7l${lines
			.map((line, index) => {
				const border =
					index > 0 && index < lines.length - 1
						? `\x1b[${start + index};${width}H\x1b[2m│\x1b[0m`
						: ""
				return `\x1b[${start + index};1H\x1b[2K${line}${border}`
			})
			.join("")}\x1b[?7h\x1b[${start - 1};1H`
	)
	footerVisible = true
}

function hideFooter() {
	if (!footerVisible) return
	const start = process.stdout.rows - footerLines + 1
	process.stdout.write(
		`\x1b[r\x1b[?7h${Array.from(
			{length: footerLines},
			(_, index) => `\x1b[${start + index};1H\x1b[2K`
		).join("")}`
	)
	footerVisible = false
}

function checkout(variables) {
	const directory = variables.map(name => process.env[name]).find(Boolean)
	return directory ? resolve(directory) : undefined
}

function packageVersion(name) {
	let entry
	try {
		entry = import.meta.resolve(`${name}/package.json`)
	} catch {
		entry = import.meta.resolve(name)
	}
	let directory = dirname(fileURLToPath(entry))
	while (dirname(directory) !== directory) {
		const manifest = join(directory, "package.json")
		if (existsSync(manifest)) {
			const pkg = JSON.parse(readFileSync(manifest, "utf8"))
			if (pkg.name === name) return pkg.version
		}
		directory = dirname(directory)
	}
	throw new Error(`Could not find ${name}/package.json`)
}

function run(name, command, args, cwd, env = process.env) {
	const child = spawn(command, args, {
		cwd,
		env,
		stdio: footer ? ["inherit", "pipe", "pipe"] : "inherit",
		detached: processGroups,
	})
	if (footer) {
		child.stdout.pipe(process.stdout, {end: false})
		child.stderr.pipe(process.stderr, {end: false})
		for (const output of [child.stdout, child.stderr]) {
			output.on("data", chunk => {
				const text = stripVTControlCharacters(chunk.toString())
				const changed = text.match(
					/(?:hmr update|page reload)\s+([^\s]+)|(?:change|changed|rebuild(?:ing)?)[: ]+([^\n]+)/i
				)
				if (changed) {
					const detail = fit((changed[1] ?? changed[2]).trim(), 48)
					setStatus(`rebuilding ${name}: ${detail}`, true)
				} else if (/build started|building/i.test(text)) {
					setStatus(`rebuilding ${name}`, true)
				}
			})
		}
	}
	children.push(child)
	child.on("exit", (code, signal) => {
		if (stopping) return
		process.exitCode = code ?? (signal ? 1 : 0)
		stop()
	})
	child.on("error", error => {
		console.error(`${name}: ${error.message}`)
		process.exitCode = 1
		stop()
	})
	return child
}

function ensure(path, command, args, cwd, env = process.env) {
	if (existsSync(path)) return
	build(command, args, cwd, env)
}

function build(command, args, cwd, env = process.env) {
	const child = spawnSync(command, args, {cwd, env, stdio: "inherit"})
	if (child.status !== 0) process.exit(child.status ?? 1)
}

function ensureBase(directory) {
	if (existsSync(join(directory, "static-dist", "modules.json"))) return
	for (const [command, args] of [
		["pnpm", ["-r", "--if-present", "build"]],
		["node", ["scripts/bundle.mjs"]],
	]) {
		const child = spawnSync(command, args, {
			cwd: directory,
			stdio: "inherit",
		})
		if (child.status !== 0) process.exit(child.status ?? 1)
	}
}

// cloudflared prints the quick tunnel's url among its logs. the tunnel going
// away (or not starting) leaves the dev server running
function startTunnel(url) {
	const child = spawn(
		"cloudflared",
		["tunnel", "--no-autoupdate", "--url", url],
		{stdio: ["ignore", "pipe", "pipe"], detached: processGroups}
	)
	children.push(child)
	let output = ""
	const read = chunk => {
		output = `${output}${chunk}`.slice(-4096)
		const match = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)
		if (!match || match[0] === tunnelURL) return
		stopSpinner()
		tunnelURL = match[0]
		devLink = `${SITE}/?dev=${tunnelURL}`
		console.log(
			`\n  tunnel: ${tunnelURL}\n\n  ${bold("send her this link:")}\n  ${link(devLink)}\n\n  \x1b[2m(anyone with it can use this dev server)\x1b[0m\n`
		)
		showFooter()
	}
	child.stdout.on("data", read)
	child.stderr.on("data", read)
	child.on("error", error => {
		stopSpinner()
		tunnelURL =
			error.code === "ENOENT"
				? "needs cloudflared: brew install cloudflared"
				: `couldn't start: ${error.message}`
		devLink = ""
		console.error(`tunnel: ${tunnelURL}`)
		showFooter()
	})
	child.on("exit", code => {
		stopSpinner()
		if (stopping || tunnelURL.startsWith("needs")) return
		tunnelURL = `closed (cloudflared exited ${code})`
		devLink = ""
		showFooter()
	})
}

function stop() {
	if (stopping) return
	stopping = true
	stopSpinner()
	process.stdout.off("resize", showFooter)
	hideFooter()
	for (const child of children) {
		if (child.exitCode !== null || child.killed) continue
		try {
			if (processGroups && child.pid) process.kill(-child.pid, "SIGTERM")
			else child.kill("SIGTERM")
		} catch (error) {
			if (error.code !== "ESRCH") throw error
		}
	}
	if (!children.some(child => child.exitCode === null)) process.exit()
}

process.on("SIGINT", stop)
process.on("SIGTERM", stop)
process.on("exit", hideFooter)

const core = checkout(["PATCHWORK_SYSTEM_DIRECTORY", "PATCHWORK_CORE_DIR"])
const base = checkout(["PATCHWORK_PKG_BASE_DIRECTORY", "PATCHWORK_BASE_DIR"])
corePackages = core
	? displayPath(core)
	: packageVersion("@inkandswitch/patchwork")
basePackages = base
	? displayPath(base)
	: packageVersion("@inkandswitch/patchwork-pkg-base")
const env = {
	...process.env,
	...(core ? {PATCHWORK_SYSTEM_DIRECTORY: core} : {}),
	...(base ? {PATCHWORK_PKG_BASE_DIRECTORY: base} : {}),
}
const watchEnv = {
	...env,
	...(tunnel ? {LATTICE_TUNNEL: "1"} : {}),
	PNPM_CONFIG_REPORTER: process.env.PNPM_CONFIG_REPORTER ?? "append-only",
}

if (core) {
	ensure(
		join(core, "core", "patchwork", "dist", "vite", "patchwork-plugin.js"),
		"pnpm",
		["--filter", "@inkandswitch/patchwork...", "build"],
		core
	)
}

if (base) {
	ensureBase(base)
}

if (core) run("core", "pnpm", ["watch"], core, watchEnv)
if (base) run("base", "pnpm", ["watch"], base, watchEnv)
// packages/versions is built (its dist is what's served), so it's rebuilt as
// it changes
run("versions", "pnpm", ["--filter", "@lattice/versions", "dev"], root, watchEnv)
const site = run("site", "pnpm", ["exec", "vite"], root, watchEnv)
let siteOutput = ""
site.stdout?.on("data", chunk => {
	siteOutput = `${siteOutput}${stripVTControlCharacters(chunk.toString())}`
	const match = siteOutput.match(/Local:\s+(https?:\/\/\S+)/)
	if (match) {
		if (tunnel && devURL === "starting…") {
			startSpinner()
			startTunnel(match[1])
		}
		devURL = match[1]
		setStatus("ready")
		siteOutput = ""
	} else {
		siteOutput = siteOutput.slice(-2048)
	}
})
process.stdout.on("resize", showFooter)
showFooter()
