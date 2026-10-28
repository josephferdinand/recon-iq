import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("transactional email queue consumer", () => {
  it("authenticates, sends, logs, deletes and dead-letters without exposing secrets", async () => {
    const source = await readFile("src/routes/api/public/cron/email-queue.ts", "utf8");
    expect(source).toContain("verifyCronSecret(request)");
    expect(source).toContain('getRuntimeEnv("ZEPTOMAIL_API_KEY")');
    expect(source).toContain('rpc("read_email_batch"');
    expect(source).toContain("sendViaZeptoMail");
    expect(source).toContain('from("email_send_log").insert');
    expect(source).toContain('rpc("delete_email"');
    expect(source).toContain('rpc("move_to_dlq"');
    expect(source).not.toMatch(/Zoho-enczapikey\s+[A-Za-z0-9.]+/u);
    const client = await readFile("src/lib/email-templates/zeptomail.ts", "utf8");
    expect(client).toContain("reply_to: req.replyTo");
    expect(client).not.toContain("? [{ address:");
    expect(client).not.toContain("trackopens:");
    expect(client).toContain("parsed.data?.message_id");
  });
});
