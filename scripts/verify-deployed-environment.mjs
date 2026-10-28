const baseURL = process.env.FVI_E2E_BASE_URL;
const expectedRef = process.env.FVI_EXPECTED_SUPABASE_REF;
const forbiddenRef = process.env.FVI_FORBIDDEN_SUPABASE_REF;
const forbiddenSecret = process.env.FVI_FORBIDDEN_SERVER_SECRET;

if (!baseURL || !expectedRef || !forbiddenRef) {
  throw new Error(
    "Set FVI_E2E_BASE_URL, FVI_EXPECTED_SUPABASE_REF, and FVI_FORBIDDEN_SUPABASE_REF",
  );
}

const root = await fetch(baseURL, { redirect: "follow" });
if (!root.ok) throw new Error(`Root request failed with HTTP ${root.status}`);

const html = await root.text();
const sources = [
  ...new Set([...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((match) => match[1])),
];
if (sources.length === 0) throw new Error("No client script source was found");

const clientScripts = await Promise.all(
  sources.map(async (source) => {
    const url = new URL(source, baseURL);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Client script failed with HTTP ${response.status}`);
    return response.text();
  }),
);
const client = clientScripts.join("\n");

const checks = {
  expected_environment_present: client.includes(expectedRef),
  opposite_environment_absent: !client.includes(forbiddenRef),
  forbidden_server_secret_absent: !forbiddenSecret || !client.includes(forbiddenSecret),
};

for (const [name, passed] of Object.entries(checks)) {
  console.log(`${passed ? "PASS" : "FAIL"} ${name}`);
}

if (Object.values(checks).some((passed) => !passed)) {
  process.exitCode = 1;
}
