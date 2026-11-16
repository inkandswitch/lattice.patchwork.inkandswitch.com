#!/usr/bin/env node
// pnpm page: look in the lattice tab that's using this dev server, and do
// things there. what to run goes through the dev server (vite/page.ts) to the
// tab (packages/lattice/page.js), with the token in
// node_modules/.lattice-page.json, and what came of it is printed: a string
// as it is, anything else as json
import {existsSync, readFileSync} from "node:fs"
import {dirname, join, resolve} from "node:path"
import {fileURLToPath} from "node:url"
import {parseArgs} from "node:util"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const TOKEN_FILE = join(root, "node_modules", ".lattice-page.json")
const TUNNEL_FILE = join(root, "node_modules", ".lattice-tunnel")
const SITE = "https://lattice.patchwork.inkandswitch.com"

export const USAGE = `usage: pnpm page [--tab ID] [--timeout MS] <command>

  link [URL]                    the link that lets a tab in (open it once).
                                with URL, that address with the token on it
  tabs                          the tabs that are in
  eval CODE | eval -            run CODE (or stdin) in the tab. an expression
                                is its value; else return what you want.
                                \`lattice\` is the helpers:
  dom [SELECTOR] [--depth N]    the elements there, briefly (body, 3)
  inspect SELECTOR              where it is, and its layout styles
  logs                          the console's errors and warnings
  projects                      the account's projects
  new-project [TITLE]           a new project, shown. its url
  open PROJECT                  show a project
  files PROJECT                 a project's files
  add-file PROJECT NAME         a new file, its content from stdin. its url
  read FILE                     a file's content
  write FILE                    a file's content, from stdin (merged in)

the helpers in code: lattice.projects() .newProject(title) .open(url)
.files(project) .addFile(project, name, content) .read(url) .write(url,
content) .dom(selector, {depth}) .inspect(selector) .logs(), and lattice.repo
.hive .home`

const quote = JSON.stringify

/** what `argv` asks for: a route, and for a run its code (or a function of stdin's) */
export function parseCommand(argv) {
	const {values, positionals} = parseArgs({
		args: argv,
		allowPositionals: true,
		options: {
			tab: {type: "string"},
			timeout: {type: "string"},
			depth: {type: "string"},
			help: {type: "boolean", short: "h"},
		},
	})
	const fail = () => {
		throw new Error(USAGE)
	}
	if (values.help) fail()
	const [name, ...rest] = positionals
	const run = (code, extra = {}) => ({
		route: "run",
		code,
		tab: values.tab,
		timeout: values.timeout ? Number(values.timeout) : undefined,
		...extra,
	})
	const one = () => rest[0] ?? fail()
	switch (name) {
		case "link":
			return {route: "link", url: rest[0]}
		case "tabs":
			return {route: "tabs"}
		case "eval":
			return one() === "-" ? run(({code}) => code, {stdin: "code"}) : run(rest.join(" "))
		case "dom":
			return run(`lattice.dom(${quote(rest[0] ?? "body")}, {depth: ${Number(values.depth ?? 3)}})`)
		case "inspect":
			return run(`lattice.inspect(${quote(one())})`)
		case "logs":
			return run("lattice.logs()")
		case "projects":
			return run("lattice.projects()")
		case "new-project":
			return run(`lattice.newProject(${quote(rest.join(" ") || "untitled")})`)
		case "open":
			return run(`lattice.open(${quote(one())})`)
		case "files":
			return run(`lattice.files(${quote(one())})`)
		case "read":
			return run(`lattice.read(${quote(one())})`)
		case "write": {
			const file = one()
			return run(({content}) => `lattice.write(${quote(file)}, ${quote(content)})`, {stdin: "content"})
		}
		case "add-file": {
			const [project, file] = rest
			if (!project || !file) fail()
			return run(({content}) => `lattice.addFile(${quote(project)}, ${quote(file)}, ${quote(content)})`, {
				stdin: "content",
			})
		}
		default:
			fail()
	}
}

/** `url` with `#page=<token>`, beside whatever else its fragment had */
export function linkFor(url, token) {
	const link = new URL(url)
	const params = new URLSearchParams(link.hash.slice(1))
	params.set("page", token)
	link.hash = params.toString()
	return link.href
}

function kept() {
	if (!existsSync(TOKEN_FILE)) {
		throw new Error("no dev server's made a token yet: start one (pnpm dev)")
	}
	return JSON.parse(readFileSync(TOKEN_FILE, "utf8"))
}

async function stdin() {
	if (process.stdin.isTTY) return ""
	const chunks = []
	for await (const chunk of process.stdin) chunks.push(chunk)
	return Buffer.concat(chunks).toString("utf8")
}

async function ask(path, body) {
	const {url, token} = kept()
	if (!url) throw new Error("the dev server hasn't said where it is: is it running?")
	let response
	try {
		response = await fetch(new URL(`/__lattice-page/${path}`, url), {
			method: body ? "POST" : "GET",
			headers: {authorization: `Bearer ${token}`, ...(body ? {"content-type": "application/json"} : {})},
			body: body ? JSON.stringify(body) : undefined,
		})
	} catch {
		throw new Error(`the dev server at ${url} isn't answering: is pnpm dev running?`)
	}
	if (response.status === 404) {
		throw new Error(`the dev server at ${url} doesn't know this token: it's from before vite/page.ts, or another server`)
	}
	return response.json()
}

function print(value) {
	if (typeof value === "string") process.stdout.write(value.endsWith("\n") ? value : `${value}\n`)
	else process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

async function main() {
	const command = parseCommand(process.argv.slice(2))
	if (command.route === "link") {
		const {token, url} = kept()
		const tunnel = existsSync(TUNNEL_FILE) ? readFileSync(TUNNEL_FILE, "utf8").trim() : ""
		if (command.url) return print(linkFor(command.url, token))
		if (tunnel) print(linkFor(`${SITE}/?dev=${tunnel}`, token))
		if (url) print(linkFor(url, token))
		console.error(
			`\nyours, not for sending. open one once (or put #page=${token} on the address of a tab that's already open)`,
		)
		return
	}
	if (command.route === "tabs") {
		const {tabs} = await ask("tabs")
		if (!tabs.length) console.error("no tab's in: open the link from `pnpm page link`")
		return print(tabs)
	}
	let {code} = command
	if (command.stdin) {
		const input = await stdin()
		code = code(command.stdin === "code" ? {code: input} : {content: input})
	}
	const answer = await ask("run", {code, tab: command.tab, timeout: command.timeout})
	if (answer.ok) return print(answer.value ?? null)
	console.error(answer.error)
	if (answer.stack) console.error(answer.stack)
	process.exitCode = 1
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main().catch(error => {
		console.error(error.message)
		process.exitCode = 1
	})
}
