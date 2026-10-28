"""Verify DEV protected routes render correctly via Playwright."""
import asyncio, json, os, sys, tempfile, time
from playwright.async_api import async_playwright

WIN_TMP = os.environ.get("TEMP") or r"C:\Users\ALICEY~1\AppData\Local\Temp"
token_path = os.path.join(WIN_TMP, "dev-access.txt")
access = open(token_path).read().strip()
print("Loaded access_token len=", len(access))

PROD = "https://app.reconiq.example"
DEV = "https://dev.app.reconiq.example"


async def run():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)

        async def check(env, base):
            ctx = await browser.new_context(viewport={"width": 1280, "height": 900})
            await ctx.add_init_script(
                f"""
                try {{
                    localStorage.setItem(
                        "sb-YOUR_PROJECT_REF-auth-token",
                        JSON.stringify({{
                            access_token: "{access}",
                            token_type: "bearer",
                            expires_in: 3600,
                            expires_at: 9999999999999,
                            refresh_token: "noop",
                            user: {{ id: "9b132fb0-5a28-40ee-b431-ea2193d52c91",
                                   email: "joseph.ferdinand@reconiq.example" }}
                        }})
                    );
                }} catch(e) {{ console.error(e); }}
                """
            )
            results = {}
            for path in ["/profile", "/profile/security", "/settings"]:
                page = await ctx.new_page()
                console_errs = []
                page.on("pageerror", lambda e: console_errs.append(str(e)[:200]))
                page.on(
                    "console",
                    lambda m: console_errs.append(f"[{m.type}] {m.text[:200]}")
                    if m.type == "error"
                    else None,
                )
                url = base + path
                t0 = time.time()
                try:
                    resp = await page.goto(url, wait_until="networkidle", timeout=30000)
                    status = resp.status if resp else None
                except Exception as e:
                    results[path] = {"error": str(e)[:120]}
                    await page.close()
                    continue
                await page.wait_for_timeout(1500)
                body_text = ""
                try:
                    body_text = await page.evaluate(
                        "document.body ? (document.body.innerText || '').slice(0,2000) : ''"
                    )
                except Exception as e:
                    body_text = f"ERR: {e}"
                title = await page.title()
                results[path] = {
                    "status": status,
                    "elapsed_ms": int((time.time() - t0) * 1000),
                    "title": title,
                    "body_sample": body_text[:400].replace("\n", " | "),
                    "has_joseph": "Joseph" in body_text,
                    "has_email": "joseph.ferdinand" in body_text,
                    "redirected_to_signin": "Sign in" in body_text,
                    "errors": console_errs[:5],
                }
                await page.close()
            await ctx.close()
            return results

        results = {"DEV": await check("dev", DEV), "PROD": await check("prod", PROD)}
        await browser.close()
        return results


if __name__ == "__main__":
    out = asyncio.run(run())
    print(json.dumps(out, indent=2))
