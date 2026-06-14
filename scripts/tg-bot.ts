// Bot de Telegram autónomo — siempre activo bajo launchd (com.finances.tg-bot).
//
// A diferencia del puente MCP de Claude (que entrega los mensajes a una sesión
// interactiva y se pierde si no hay nadie escuchando), este demonio hace su
// propio long-polling de getUpdates y responde por sí mismo. No depende de
// ninguna sesión: /net y /ask funcionan siempre, desde cualquier sitio.
//
// Comandos:
//   /net          → snapshot financiero (KPIs de la home). Solo lectura.
//   /ask <texto>  → una pregunta al asesor (one-shot, sin historial).
//   /start /help  → ayuda.
//
// El resumen de mercados de las 09:00 NO vive aquí: lo dispara
// com.finances.advisor-scan vía sendMessage (no hace polling, no colisiona).
//
// Telegram solo admite UN consumidor de getUpdates por token, así que el plugin
// MCP de Telegram debe quedar desactivado mientras corre este demonio.
try {
  process.loadEnvFile(".env.local");
} catch {
  // .env.local opcional — si no está, se usan los valores del entorno.
}

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

if (!TOKEN || !CHAT_ID) {
  console.error("[tg-bot] faltan TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID en .env.local");
  process.exit(1);
}

const API = `https://api.telegram.org/bot${TOKEN}`;
const TELEGRAM_MAX = 4096;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function log(msg: string): void {
  // Timestamp ISO sin depender de Date.now prohibido en el harness — aquí es un
  // proceso normal, new Date() está permitido fuera de los scripts de workflow.
  console.log(`[tg-bot ${new Date().toISOString()}] ${msg}`);
}

// Llamada genérica a la Bot API. Nunca lanza: devuelve null en error para que el
// bucle de polling siga vivo pase lo que pase.
async function tg<T = unknown>(
  method: string,
  payload: Record<string, unknown>,
  timeoutMs = 15_000,
): Promise<{ ok: true; result: T } | { ok: false; status: number; detail: string } | null> {
  try {
    const res = await fetch(`${API}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const json = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      result?: T;
      description?: string;
    };
    if (res.ok && json.ok) return { ok: true, result: json.result as T };
    return { ok: false, status: res.status, detail: json.description ?? `HTTP ${res.status}` };
  } catch (err) {
    log(`tg(${method}) error: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

async function send(text: string): Promise<void> {
  let body = text.trim() || "(sin contenido)";
  if (body.length > TELEGRAM_MAX) body = `${body.slice(0, TELEGRAM_MAX - 24)}\n… (ver /asesor)`;
  // Texto plano sin parse_mode: el markdown del asesor no puede romper el envío.
  await tg("sendMessage", { chat_id: CHAT_ID, text: body, disable_web_page_preview: true });
}

// Indicador "escribiendo…" mientras una operación larga está en curso. Telegram
// lo expira a los ~5s, así que lo refrescamos hasta que el llamante lo apaga.
function startTyping(): () => void {
  let active = true;
  void (async () => {
    while (active) {
      await tg("sendChatAction", { chat_id: CHAT_ID, action: "typing" });
      await sleep(4_500);
    }
  })();
  return () => {
    active = false;
  };
}

// --- /net ---------------------------------------------------------------
async function handleNet(): Promise<void> {
  const stop = startTyping();
  try {
    const { getOverviewKpis } = await import("../src/server/overview");
    const { formatEur, formatPercent } = await import("../src/lib/format");
    const signedPct = (ratio: number | null): string =>
      ratio == null ? "—" : `${ratio >= 0 ? "+" : ""}${formatPercent(ratio)}`;

    const k = await getOverviewKpis();
    const lines = [
      "📊 Estado financiero",
      "",
      `Patrimonio neto: ${formatEur(k.totalNetWorthEur)}`,
      `Liquidez: ${formatEur(k.cashEur)}`,
      `Inversión (coste): ${formatEur(k.investedEur)}`,
      `Inversión (mercado): ${formatEur(k.investedMarketValueEur)}`,
      `P&L latente: ${k.unrealizedPnlEur >= 0 ? "+" : ""}${formatEur(k.unrealizedPnlEur)} (${signedPct(k.unrealizedPnlPct)})`,
      `XIRR: ${signedPct(k.xirrPct)}`,
    ];
    await send(lines.join("\n"));
  } catch (err) {
    log(`/net error: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
    await send("⚠️ Error generando el snapshot. Revisa los logs del bot.");
  } finally {
    stop();
  }
}

// --- /ask ---------------------------------------------------------------
async function handleAsk(question: string): Promise<void> {
  if (!question) {
    await send("Uso: /ask <tu pregunta al asesor>");
    return;
  }
  const stop = startTyping();
  try {
    const { runAdvisorOnce } = await import("../src/lib/advisor/client");
    const { buildChatPrompt, buildChatSystemPrompt } = await import("../src/lib/advisor/prompts");
    const { getAdvisorContext, readDigestForPrompt, readProfileForPrompt } = await import(
      "../src/server/advisor"
    );

    const portfolio = await getAdvisorContext();
    const systemPrompt = buildChatSystemPrompt({
      portfolio,
      profile: readProfileForPrompt(),
      digest: readDigestForPrompt(),
      summaries: "",
    });
    const prompt = buildChatPrompt([], question);
    const model = process.env.ADVISOR_CHAT_MODEL ?? "claude-opus-4-8";

    const { text } = await runAdvisorOnce({
      model,
      systemPrompt,
      prompt,
      allowedTools: ["WebSearch", "WebFetch"],
      maxTurns: 8,
    });
    await send(text.trim() || "(el asesor no devolvió texto)");
  } catch (err) {
    log(`/ask error: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
    await send("⚠️ Error consultando al asesor. Revisa los logs del bot.");
  } finally {
    stop();
  }
}

const HELP = [
  "🤖 Bot de Finances",
  "",
  "/net — snapshot financiero (patrimonio, liquidez, P&L, XIRR)",
  "/ask <pregunta> — consulta única al asesor",
  "",
  "El resumen de mercados llega automático cada día a las 09:00.",
].join("\n");

// Despacha un mensaje entrante. Fire-and-forget desde el bucle: una /ask larga
// no debe bloquear el polling de los siguientes mensajes.
function dispatch(text: string): void {
  const trimmed = text.trim();
  const firstSpace = trimmed.search(/\s/);
  const head = (firstSpace === -1 ? trimmed : trimmed.slice(0, firstSpace)).toLowerCase();
  // Soporta el sufijo @bot que Telegram añade en grupos (/net@nyhz_market_bot).
  const cmd = head.split("@")[0];
  const rest = firstSpace === -1 ? "" : trimmed.slice(firstSpace + 1).trim();

  switch (cmd) {
    case "/net":
      void handleNet();
      break;
    case "/ask":
      void handleAsk(rest);
      break;
    case "/start":
    case "/help":
      void send(HELP);
      break;
    default:
      void send("Comandos: /net, /ask <pregunta>");
  }
}

async function main(): Promise<void> {
  // Verifica el token al arrancar — falla ruidoso si está mal, en vez de hacer
  // polling silencioso contra un bot inexistente.
  const me = await tg<{ username: string }>("getMe", {});
  if (!me || !me.ok) {
    log(`getMe falló: ${me && !me.ok ? me.detail : "sin respuesta"} — abortando`);
    process.exit(1);
  }
  log(`conectado como @${me.result.username}, escuchando chat ${CHAT_ID}`);

  const startedAt = Date.now();
  let offset: number | undefined;
  let firstPoll = true;

  for (;;) {
    const updates = await tg<
      Array<{
        update_id: number;
        message?: { text?: string; date: number; chat: { id: number } };
      }>
    >(
      "getUpdates",
      { offset, timeout: 30, allowed_updates: ["message"] },
      40_000,
    );

    if (!updates) {
      await sleep(3_000);
      continue;
    }
    if (!updates.ok) {
      // 409 = otro getUpdates activo (p. ej. el plugin MCP sin desactivar).
      if (updates.status === 409) log("409 conflicto: hay otro poller del mismo bot activo");
      else log(`getUpdates error: ${updates.detail}`);
      await sleep(3_000);
      continue;
    }

    for (const u of updates.result) {
      offset = u.update_id + 1;
      const msg = u.message;
      if (!msg || !msg.text) continue;
      // Seguridad: solo el chat del Commander. Cualquier otro remitente se ignora.
      if (String(msg.chat.id) !== CHAT_ID) continue;
      // En el primer poll, descarta backlog viejo para no reprocesar mensajes
      // enviados antes de arrancar el demonio. 10s de gracia por desfase de reloj.
      if (firstPoll && msg.date * 1000 < startedAt - 10_000) continue;
      dispatch(msg.text);
    }
    firstPoll = false;
  }
}

main().catch((err) => {
  log(`fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  process.exit(1);
});
