import "server-only";
import { query, type Options } from "@anthropic-ai/claude-agent-sdk";

/**
 * Thin wrapper over the Claude Agent SDK for the advisor.
 *
 * Billing guardrail (decision D5): the SDK authenticates via the subscription
 * token `CLAUDE_CODE_OAUTH_TOKEN` so usage draws on the Max plan's monthly
 * credit. A present `ANTHROPIC_API_KEY` wins auth precedence and would silently
 * route to pay-as-you-go — so we refuse to run if it's set.
 */

export class AdvisorDisabledError extends Error {
  constructor() {
    super("El asesor está desactivado (ADVISOR_ENABLED=false).");
    this.name = "AdvisorDisabledError";
  }
}

export class AdvisorAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdvisorAuthError";
  }
}

export function assertAdvisorEnabled(): void {
  if (process.env.ADVISOR_ENABLED === "false") throw new AdvisorDisabledError();
}

export function assertAdvisorAuth(): void {
  assertAdvisorEnabled();
  // The critical guardrail: a present API key wins auth precedence and would
  // silently route billing to pay-as-you-go instead of the subscription credit.
  if (process.env.ANTHROPIC_API_KEY) {
    throw new AdvisorAuthError(
      "ANTHROPIC_API_KEY está definida: gana en precedencia y se saltaría el crédito de la suscripción. Quítala del entorno.",
    );
  }
  // Auth comes from CLAUDE_CODE_OAUTH_TOKEN (a long-lived `claude setup-token`)
  // when set, or otherwise from the existing Claude Code keychain login that the
  // `claude` subprocess uses and auto-refreshes. If neither exists, the SDK call
  // fails with an auth error, which the caller surfaces.
}

export type AdvisorOptions = {
  model: string;
  systemPrompt: string;
  prompt: string;
  /** Read-only tools only; never Bash/Write/Edit. */
  allowedTools?: string[];
  maxTurns?: number;
};

export type AdvisorUsage = {
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  webSearches: number;
  isError: boolean;
  errorType?: string;
};

const ZERO_USAGE: AdvisorUsage = {
  costUsd: 0,
  inputTokens: 0,
  outputTokens: 0,
  webSearches: 0,
  isError: false,
};

function buildOptions(o: AdvisorOptions): Options {
  // Pass the process env to the subprocess MINUS the API key (defensive — the
  // guardrail already refuses if it's set), so the subscription token is used.
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v != null && k !== "ANTHROPIC_API_KEY") env[k] = v;
  }
  return {
    model: o.model,
    systemPrompt: o.systemPrompt,
    allowedTools: o.allowedTools ?? [],
    permissionMode: "dontAsk", // headless: never prompt, deny anything not allowed
    settingSources: [], // isolate from the repo's CLAUDE.md / project settings
    maxTurns: o.maxTurns ?? 6,
    env,
  };
}

// The SDK message union is large; result/usage fields are read defensively.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function readResultUsage(msg: any): AdvisorUsage {
  return {
    costUsd: msg.total_cost_usd ?? 0,
    inputTokens: msg.usage?.input_tokens ?? 0,
    outputTokens: msg.usage?.output_tokens ?? 0,
    webSearches: msg.usage?.server_tool_use?.web_search_requests ?? 0,
    isError: Boolean(msg.is_error),
    errorType: msg.subtype === "success" ? undefined : msg.subtype,
  };
}

/** Single-shot call (memory extraction, scans). Returns the final text + usage. */
export async function runAdvisorOnce(
  o: AdvisorOptions,
): Promise<{ text: string } & AdvisorUsage> {
  assertAdvisorAuth();
  let text = "";
  let usage: AdvisorUsage = { ...ZERO_USAGE };
  for await (const msg of query({ prompt: o.prompt, options: buildOptions(o) })) {
    if (msg.type === "result") {
      usage = readResultUsage(msg);
      if (msg.subtype === "success") text = msg.result;
    }
  }
  return { text, ...usage };
}

export type StreamChunk =
  | { type: "delta"; text: string }
  | { type: "done"; text: string; usage: AdvisorUsage };

/** Streaming call (chat). Yields text deltas, then a final `done` with usage. */
export async function* streamAdvisor(o: AdvisorOptions): AsyncGenerator<StreamChunk> {
  assertAdvisorAuth();
  let acc = "";
  let usage: AdvisorUsage = { ...ZERO_USAGE };
  const options: Options = { ...buildOptions(o), includePartialMessages: true };
  for await (const msg of query({ prompt: o.prompt, options })) {
    if (msg.type === "stream_event") {
      // BetaRawMessageStreamEvent — forward only text deltas.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ev = (msg as any).event;
      if (
        ev?.type === "content_block_delta" &&
        ev.delta?.type === "text_delta" &&
        typeof ev.delta.text === "string"
      ) {
        acc += ev.delta.text;
        yield { type: "delta", text: ev.delta.text };
      }
    } else if (msg.type === "result") {
      usage = readResultUsage(msg);
      const text = msg.subtype === "success" ? msg.result : acc;
      yield { type: "done", text, usage };
    }
  }
}
