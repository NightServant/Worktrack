import { modelFor, providerFor, type IntegrationConfig, type LlmTask } from './config'

/**
 * One call to an OpenAI-compatible chat endpoint, answering with JSON.
 *
 * WHY IT EXISTS (Gabe, 2026-09-19: "wire all three"). Tailoring had this code
 * to itself and learned three things the hard way that the other two jobs were
 * about to learn again: a 429 is the ORDINARY state of a free tier and not an
 * error worth a stack trace; a 401 is a key problem and needs its own
 * sentence; and `response_format` has to be ASKED for, because a model told
 * "JSON only" still emits fences and still lets a literal newline land inside
 * a quoted string. That last one shipped as a production bug.
 *
 * IT RETURNS A RESULT, NEVER THROWS. Every caller here has a working fallback
 * -- the deterministic CV composer, the posting parser -- so a model being
 * unavailable has to be a branch rather than an exception. That is the same
 * rule every client in this directory follows.
 *
 * THE PROVIDER IS CONFIGURATION. Groq, OpenRouter, Together, Cloudflare and a
 * local Ollama all speak this shape, and every one of their free tiers has
 * changed its limits at least once.
 */

export type LlmFailure =
  | 'disabled'
  | 'auth'
  | 'rate-limit'
  | 'network'
  | 'timeout'
  | 'bad-response'

export type LlmResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: LlmFailure; message: string }

export interface LlmRequest {
  task: LlmTask
  system: string
  user: string
  /**
   * How long to wait. Defaults differ by job and the caller sets them: filling
   * a posting happens while somebody watches a form, and tailoring happens
   * behind a progress state.
   */
  timeoutMs?: number
  /**
   * Low but rarely zero. Extraction wants determinism; prose wants a little
   * variation. The no-invention rule is carried by the prompt, not by this.
   */
  temperature?: number
  /**
   * A ceiling on the reply, so a model cannot spend the budget rambling.
   *
   * IT IS A TIME CONTROL, NOT A COST ONE. Generation is roughly linear in
   * output tokens, so the honest way to make a call finish sooner is to ask
   * for less -- and every one of these replies is a bounded JSON object whose
   * size is known from the schema. Set it with headroom: a reply cut off
   * mid-string is invalid JSON, which costs the whole answer rather than its
   * tail.
   */
  maxTokens?: number
  /**
   * How hard the model should think before answering, where it can choose.
   *
   * THE BIGGEST LEVER ON LATENCY, and on these tasks it buys almost nothing
   * (Gabe, 2026-09-19: "implement shorter budget for CV writing without
   * loosing quality"). Two of the three models configured here are reasoning
   * models, and reasoning tokens are generated before the first character of
   * the answer -- so a chain of thought about how to phrase a CV line is pure
   * wait. Writing prose from facts that are already in front of it is not a
   * problem that reasoning solves; extraction against a schema is not either.
   *
   * SENT AS THE FLAT `reasoning_effort`, which is the OpenAI-style spelling.
   * OpenRouter documents both that and the nested `reasoning: { effort }`;
   * Groq rejects the nested one outright with a 400, and a rejected request
   * costs the whole answer. See the request body for the measurement.
   */
  reasoningEffort?: 'low' | 'medium' | 'high'
}

export interface LlmOptions {
  config: IntegrationConfig
  fetchImpl?: typeof fetch
}

/** Pull a JSON object out of a reply, tolerating fences and stray prose. */
export function parseJsonReply<T>(raw: string): LlmResult<T> {
  const trimmed = raw.trim()
  // Models add ```json fences even when told not to. Strip rather than fail:
  // the alternative is discarding a good answer over its packaging.
  const unfenced = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  const start = unfenced.indexOf('{')
  const end = unfenced.lastIndexOf('}')
  if (start === -1 || end <= start) {
    return { ok: false, reason: 'bad-response', message: 'The model did not return JSON.' }
  }
  try {
    return { ok: true, data: JSON.parse(unfenced.slice(start, end + 1)) as T }
  } catch {
    return { ok: false, reason: 'bad-response', message: 'The model returned malformed JSON.' }
  }
}

export async function askForJson<T>(
  request: LlmRequest,
  options: LlmOptions
): Promise<LlmResult<T>> {
  // The provider is resolved for THIS task -- `cv` and `extract` may each sit
  // somewhere other than the shared pair. `enabled` is deployment-wide and
  // stays where it is: it is a spend switch, not a route.
  const { enabled } = options.config.tailoring
  const { baseUrl, apiKey } = providerFor(options.config, request.task)
  const model = modelFor(options.config, request.task)
  if (enabled === false || !apiKey || !baseUrl || !model) {
    return {
      ok: false,
      reason: 'disabled',
      message:
        'No model is configured for this deployment. Set PROVIDER_BASE_URL, ' +
        'PROVIDER_API_KEY and a model id.',
    }
  }

  const doFetch = options.fetchImpl ?? fetch
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), request.timeoutMs ?? 30_000)

  try {
    const response = await doFetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        // OPENROUTER READS THESE AND NOBODY ELSE MINDS THEM. They are how a
        // free-tier account is attributed, and an unattributed one is rate
        // limited harder. Harmless headers on every other provider.
        'HTTP-Referer': 'https://worktrack-jobs.vercel.app',
        'X-Title': 'Worktrack',
      },
      body: JSON.stringify({
        model,
        temperature: request.temperature ?? 0.2,
        ...(request.maxTokens ? { max_tokens: request.maxTokens } : {}),
        // `reasoning_effort`, NOT `reasoning: { effort }`. Both are documented
        // by OpenRouter and they are not interchangeable across providers:
        // Groq answers the nested form with `400 property 'reasoning' is
        // unsupported` and the whole call is lost. Measured 2026-09-19 against
        // `api.groq.com` with `openai/gpt-oss-120b` -- the flat OpenAI-style
        // key returned 200 on the same request. It is the spelling both the
        // providers this repo actually runs on accept.
        ...(request.reasoningEffort ? { reasoning_effort: request.reasoningEffort } : {}),
        // ASKED FOR, NOT HOPED FOR (2026-09-15, and it is why this is shared).
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: request.system },
          { role: 'user', content: request.user },
        ],
      }),
    })

    if (response.status === 401 || response.status === 403) {
      return { ok: false, reason: 'auth', message: 'The model provider rejected the API key.' }
    }
    // 429 is the ordinary state of a free tier, not a fault.
    if (response.status === 429) {
      return {
        ok: false,
        reason: 'rate-limit',
        message: 'The free tier is rate-limited right now. Try again in a minute.',
      }
    }
    if (!response.ok) {
      return {
        ok: false,
        reason: 'network',
        message: `The model provider answered ${response.status}.`,
      }
    }

    const body = (await response.json()) as {
      choices?: { message?: { content?: unknown } }[]
    }
    const content = body.choices?.[0]?.message?.content
    if (typeof content !== 'string' || !content.trim()) {
      return { ok: false, reason: 'bad-response', message: 'The model returned nothing.' }
    }
    return parseJsonReply<T>(content)
  } catch (error) {
    // An abort is a timeout here, and nothing else aborts this controller.
    if (error instanceof Error && error.name === 'AbortError') {
      return { ok: false, reason: 'timeout', message: 'The model took too long to answer.' }
    }
    return { ok: false, reason: 'network', message: 'Could not reach the model provider.' }
  } finally {
    clearTimeout(timer)
  }
}
