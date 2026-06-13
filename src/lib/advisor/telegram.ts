import "server-only";

const TELEGRAM_MAX = 4096;

/**
 * Send a message to the Commander's Telegram chat via the Bot API. Secondary by
 * design: never throws — returns a result the caller logs but does not fail on.
 * Sends plain text (no parse_mode) so LLM-generated markdown can't be rejected.
 */
export async function sendTelegram(text: string): Promise<{ ok: boolean; error?: string }> {
  if (process.env.ADVISOR_TELEGRAM_ENABLED === "false") {
    return { ok: false, error: "telegram desactivado" };
  }
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    return { ok: false, error: "faltan TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID" };
  }

  let body = text.trim();
  if (body.length > TELEGRAM_MAX) {
    body = `${body.slice(0, TELEGRAM_MAX - 24)}\n… (ver /asesor)`;
  }
  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: body,
          disable_web_page_preview: true,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) return { ok: true };
      if (attempt === 1) {
        const detail = await res.text().catch(() => "");
        return { ok: false, error: `HTTP ${res.status} ${detail.slice(0, 120)}` };
      }
    } catch (err) {
      if (attempt === 1) return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return { ok: false, error: "telegram falló" };
}
