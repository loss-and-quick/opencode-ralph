import type { Plugin } from "@opencode-ai/plugin"
import { unlink, readFile } from "node:fs/promises"
import { join, dirname } from "path"
import { fileURLToPath } from "url"

const COMMANDS_DIR = join(dirname(fileURLToPath(import.meta.url)), "../command")

const STATE_FILE = "ralph-loop.local.md"

type RalphState = {
  active: boolean
  paused: boolean
  iteration: number
  maxIterations: number
  completionPromise: string | null
  startedAt: string
  gitCommit: boolean
  prompt: string
}

async function parseRalphState(directory: string): Promise<RalphState | null> {
  const statePath = join(directory, STATE_FILE)
  const file = Bun.file(statePath)
  if (!(await file.exists())) return null

  const content = await file.text()
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!frontmatterMatch) return null

  const [, frontmatter, prompt] = frontmatterMatch
  const getValue = (key: string) => {
    const match = frontmatter.match(new RegExp(`^${key}:\\s*(.*)$`, "m"))
    return match ? match[1].replace(/^["'](.*)["']$/, "$1") : null
  }

  return {
    active: getValue("active") === "true",
    paused: getValue("paused") === "true",
    iteration: parseInt(getValue("iteration") ?? "1", 10),
    maxIterations: parseInt(getValue("max_iterations") ?? "0", 10),
    completionPromise: getValue("completion_promise") === "null" ? null : getValue("completion_promise"),
    startedAt: getValue("started_at") ?? new Date().toISOString(),
    gitCommit: getValue("git_commit") === "true",
    prompt: prompt.trim(),
  }
}

async function writeRalphState(directory: string, state: RalphState): Promise<void> {
  const completionPromiseYaml = state.completionPromise === null ? "null" : `"${state.completionPromise}"`
  await Bun.write(
    join(directory, STATE_FILE),
    `---
active: ${state.active}
paused: ${state.paused}
iteration: ${state.iteration}
max_iterations: ${state.maxIterations}
completion_promise: ${completionPromiseYaml}
started_at: "${state.startedAt}"
git_commit: ${state.gitCommit}
---

${state.prompt}
`,
  )
}

async function deleteRalphState(directory: string): Promise<void> {
  const file = Bun.file(join(directory, STATE_FILE))
  if (await file.exists()) await unlink(join(directory, STATE_FILE))
}

function checkCompletionPromise(text: string, promise: string): boolean {
  const match = text.match(/<promise>([\s\S]*?)<\/promise>/)
  return match ? match[1].trim().replace(/\s+/g, " ") === promise : false
}

const server: Plugin = async ({ directory, client, $ }) => {
  return {
    config: async (cfg) => {
      cfg.command ??= {}
      for (const [name, file] of [
        ["ralph-loop", "ralph-loop.md"],
        ["cancel-ralph", "cancel-ralph.md"],
        ["ralph-help", "ralph-help.md"],
      ] as const) {
        const raw = await readFile(join(COMMANDS_DIR, file), "utf-8")
        const match = raw.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/)
        const descMatch = raw.match(/^description:\s*(.+)$/m)
        cfg.command[name] = {
          template: match ? match[1].trim() : raw.trim(),
          description: descMatch?.[1]?.trim(),
        }
      }
    },
    event: async ({ event }) => {
      if (event.type !== "session.idle") return

      const state = await parseRalphState(directory)
      if (!state || !state.active || state.paused) return

      if (state.completionPromise) {
        const result = await client.session.messages({ path: { id: event.properties.sessionID } })
        const messages = result.data ?? []
        const lastAssistantMsg = [...messages].reverse().find((m: any) => m.role === "assistant")
        if (lastAssistantMsg) {
          const textContent = (lastAssistantMsg.parts ?? [])
            .filter((p: any) => p.type === "text")
            .map((p: any) => p.text)
            .join("\n")
          if (textContent && checkCompletionPromise(textContent, state.completionPromise)) {
            await deleteRalphState(directory)
            await client.app.log({ body: { service: "ralph", level: "info", message: `Loop completed: <promise>${state.completionPromise}</promise>` } })
            return
          }
        }
      }

      if (state.maxIterations > 0 && state.iteration >= state.maxIterations) {
        await deleteRalphState(directory)
        await client.app.log({ body: { service: "ralph", level: "info", message: `Loop stopped: max iterations (${state.maxIterations}) reached` } })
        return
      }

      if (state.gitCommit) {
        await $`git -C ${directory} add -A && git -C ${directory} commit -m "ralph: iteration ${state.iteration}" --allow-empty`.quiet()
      }

      const nextIteration = state.iteration + 1
      await writeRalphState(directory, { ...state, iteration: nextIteration })

      const systemMsg = state.completionPromise
        ? `Ralph iteration ${nextIteration} | To stop: output <promise>${state.completionPromise}</promise> (ONLY when TRUE)`
        : state.maxIterations > 0
          ? `Ralph iteration ${nextIteration} / ${state.maxIterations}`
          : `Ralph iteration ${nextIteration} | No completion promise set`

      await client.app.log({ body: { service: "ralph", level: "info", message: systemMsg } })

      await client.session.prompt({
        path: { id: event.properties.sessionID },
        body: { parts: [{ type: "text", text: `[${systemMsg}]\n\n${state.prompt}` }] },
      })
    },
  }
}

export default { id: "ralph", server }
