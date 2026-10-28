import { createErrorReference, USER_FACING_ERRORS } from "./user-facing-errors";

export function renderErrorPage(referenceId = createErrorReference()): string {
  const safeReference = /^FVI-[A-F0-9]{12}$/.test(referenceId) ? referenceId : "FVI-UNAVAILABLE";
  const copy = USER_FACING_ERRORS.unexpected;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${copy.title} — ReconIQ</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body { font: 15px/1.5 system-ui, -apple-system, sans-serif; background: #fbf8f3; color: #172033; display: grid; place-items: center; min-height: 100vh; margin: 0; padding: 1.5rem; }
      .card { max-width: 30rem; width: 100%; padding: 2rem; background: #fff; border: 1px solid #e6ded3; border-top: 4px solid #b42318; border-radius: 1rem; box-shadow: 0 10px 30px #17203312; }
      .brand { width: 2.5rem; height: 2.5rem; margin-bottom: 1rem; }
      h1 { font-size: 1.35rem; margin: 0 0 0.75rem; }
      p { color: #475467; margin: 0 0 0.75rem; }
      .reference { font-size: 0.8rem; margin-top: 1.25rem; }
      .actions { display: flex; gap: 0.5rem; justify-content: center; flex-wrap: wrap; }
      a { padding: 0.6rem 1rem; border-radius: 0.5rem; font: inherit; cursor: pointer; text-decoration: none; border: 1px solid transparent; min-height: 2.75rem; box-sizing: border-box; }
      a:focus-visible { outline: 3px solid #2563eb; outline-offset: 2px; }
      .primary { background: #172033; color: #fff; }
      .secondary { background: #fff; color: #172033; border-color: #cbd5e1; }
    </style>
  </head>
  <body>
    <main class="card" role="alert" aria-labelledby="error-title">
      <img class="brand" src="/favicon.svg" alt="" />
      <h1 id="error-title">${copy.title}</h1>
      <p>${copy.message}</p>
      <p>${copy.action}</p>
      <div class="actions">
        <a class="primary" href="">Try again</a>
        <a class="secondary" href="/home">Return to Home</a>
      </div>
      <p class="reference">Error Reference ID: ${safeReference}</p>
    </main>
  </body>
</html>`;
}
