import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendTelegram } from "../telegram";

describe("sendTelegram", () => {
  const SAVED = { ...process.env };
  beforeEach(() => {
    process.env = { ...SAVED };
  });
  afterEach(() => {
    process.env = { ...SAVED };
    vi.unstubAllGlobals();
  });

  it("fails (no throw) when token/chat are missing", async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
    const r = await sendTelegram("hola");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/falta/i);
  });

  it("does nothing when disabled", async () => {
    process.env.ADVISOR_TELEGRAM_ENABLED = "false";
    const r = await sendTelegram("hola");
    expect(r.ok).toBe(false);
  });

  it("posts to the Bot API and truncates over the 4096 limit", async () => {
    process.env.ADVISOR_TELEGRAM_ENABLED = "true";
    process.env.TELEGRAM_BOT_TOKEN = "TOKEN";
    process.env.TELEGRAM_CHAT_ID = "123";
    let captured: { chat_id: string; text: string } | null = null;
    const fetchMock = vi.fn(async (_url: unknown, init: { body: string }) => {
      captured = JSON.parse(init.body);
      return { ok: true } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const r = await sendTelegram("x".repeat(5000));
    expect(r.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(captured!.chat_id).toBe("123");
    expect(captured!.text.length).toBeLessThanOrEqual(4096);
  });
});
