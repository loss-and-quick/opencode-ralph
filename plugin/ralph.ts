import type { Plugin } from "@opencode-ai/plugin"
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from "fs"
import { join } from "path"

/**
 * Ralph Wiggum Plugin for OpenCode
 *
 * Implementation of the Ralph Wiggum technique - continuous self-referential AI loops
 * for iterative development. Named after Ralph Wiggum from The Simpsons, embodying
 * the philosophy of persistent iteration despite setbacks.
 *
 * Core concept: Feed the same prompt repeatedly, letting the AI see its previous work
 * in files and git history, creating a self-referential feedback loop.
 *
 * Based on: https://ghuntley.com/ralph/
 */

interface RalphState {
  active: boolean
  iteration: number
  maxIterations: number
  completionPromise: string | null
  startedAt: string
  prompt: string
}

const STATE_FILE = "ralph-loop.local.md"

function parseRalphState(directory: string): RalphState | null {
  const statePath = join(directory, STATE_FILE)

  if (!existsSync(statePath)) {
    return null
  }

  try {
    const content = readFileSync(statePath, "utf-8")

    // Parse YAML frontmatter
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
    if (!frontmatterMatch) {
      return null
    }

    const [, frontmatter, prompt] = frontmatterMatch

    // Parse frontmatter values
    const getValue = (key: string): string | null => {
      const match = frontmatter.match(new RegExp(`^${key}:\\s*(.*)$`, "m"))
      if (!match) return null
      // Remove surrounding quotes if present
      return match[1].replace(/^["'](.*)["']$/, "$1")
    }

    const active = getValue("active") === "true"
    const iteration = parseInt(getValue("iteration") || "1", 10)
    const maxIterations = parseInt(getValue("max_iterations") || "0", 10)
    const completionPromise = getValue("completion_promise")
    const startedAt = getValue("started_at") || new Date().toISOString()

    return {
      active,
      iteration,
      maxIterations,
      completionPromise: completionPromise === "null" ? null : completionPromise,
      startedAt,
      prompt: prompt.trim(),
    }
  } catch {
    return null
  }
}

function writeRalphState(directory: string, state: RalphState): void {
  const statePath = join(directory, STATE_FILE)



  const completionPromiseYaml =
    state.completionPromise === null ? "null" : `"${state.completionPromise}"`

  const content = `---
active: ${state.active}
iteration: ${state.iteration}
max_iterations: ${state.maxIterations}
completion_promise: ${completionPromiseYaml}
started_at: "${state.startedAt}"
---

${state.prompt}
`

  writeFileSync(statePath, content, "utf-8")
}

function deleteRalphState(directory: string): boolean {
  const statePath = join(directory, STATE_FILE)

  if (existsSync(statePath)) {
    unlinkSync(statePath)
    return true
  }
  return false
}

function checkCompletionPromise(text: string, promise: string): boolean {
  // Extract text from <promise> tags
  const promiseMatch = text.match(/<promise>([\s\S]*?)<\/promise>/)
  if (!promiseMatch) return false

  // Normalize whitespace and compare
  const promiseText = promiseMatch[1].trim().replace(/\s+/g, " ")
  return promiseText === promise
}

export const RalphPlugin: Plugin = async ({ directory, client, $ }) => {
  return {
    /**
     * Handle session idle event - this is when the AI has finished responding
     * and would normally wait for user input. In Ralph mode, we intercept this
     * to continue the loop.
     */
    event: async ({ event }) => {
      if (event.type !== "session.idle") return

      const state = parseRalphState(directory)
      if (!state || !state.active) return

      // Get the last assistant message to check for completion
      // We need to check if the completion promise was output
      if (state.completionPromise) {
        try {
          // Use the SDK to get session messages
          const session = await client.session.get({ id: event.properties.sessionID })
          if (session.messages && session.messages.length > 0) {
            // Find the last assistant message
            const lastAssistantMsg = [...session.messages]
              .reverse()
              .find((m) => m.role === "assistant")

            if (lastAssistantMsg) {
              // Extract text content from message parts
              const textContent = lastAssistantMsg.parts
                ?.filter((p: any) => p.type === "text")
                .map((p: any) => p.text)
                .join("\n")

              if (textContent && checkCompletionPromise(textContent, state.completionPromise)) {
                // Completion promise detected - stop the loop
                deleteRalphState(directory)
                await client.app.log({
                  service: "ralph-plugin",
                  level: "info",
                  message: `Ralph loop completed: detected <promise>${state.completionPromise}</promise>`,
                })
                return
              }
            }
          }
        } catch (err) {
          // If we can't check messages, continue the loop
          await client.app.log({
            service: "ralph-plugin",
            level: "warn",
            message: `Could not check for completion promise: ${err}`,
          })
        }
      }

      // Check max iterations
      if (state.maxIterations > 0 && state.iteration >= state.maxIterations) {
        deleteRalphState(directory)
        await client.app.log({
          service: "ralph-plugin",
          level: "info",
          message: `Ralph loop stopped: max iterations (${state.maxIterations}) reached`,
        })
        return
      }

      // Continue the loop - increment iteration and feed prompt back
      const nextIteration = state.iteration + 1
      writeRalphState(directory, {
        ...state,
        iteration: nextIteration,
      })

      // Build the continuation message
      let systemMsg = `Ralph iteration ${nextIteration}`
      if (state.completionPromise) {
        systemMsg += ` | To stop: output <promise>${state.completionPromise}</promise> (ONLY when TRUE)`
      } else if (state.maxIterations > 0) {
        systemMsg += ` / ${state.maxIterations}`
      } else {
        systemMsg += ` | No completion promise set - loop runs until cancelled`
      }

      // Log the iteration
      await client.app.log({
        service: "ralph-plugin",
        level: "info",
        message: systemMsg,
      })

      // Append the prompt back to continue the session
      // The prompt includes a marker showing the iteration
      const continuationPrompt = `[${systemMsg}]\n\n${state.prompt}`

      // Use session.send to continue the conversation
      await client.session.send({
        id: event.properties.sessionID,
        text: continuationPrompt,
      })
    },
  }
}
