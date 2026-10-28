import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

const root = process.cwd();
const sourceRoot = path.join(root, "src");
const outputFlag = process.argv.indexOf("--write");
const outputPath = outputFlag >= 0 ? path.resolve(process.argv[outputFlag + 1] ?? "") : null;
const summaryOnly = process.argv.includes("--summary");
const extensions = new Set([".ts", ".tsx", ".js", ".jsx"]);
const bannedCopy = /^(?:invalid|incorrect|error occurred|something went wrong|request failed|unknown error|operation failed|failed|error)$/iu;
const genericPhrase = /\b(?:error occurred|something went wrong|request failed|unknown error|operation failed|failed|try again)\b/iu;
const technicalCopy = /\b(?:sqlstate|postgres(?:ql)?|postgrest|pgrst\d+|stack trace|traceback|constraint violation|relation does not exist|failed to fetch)\b/iu;
const actionWord = /\b(?:enter|check|review|select|choose|correct|refresh|sign in|reset|contact|ask|open|view|retry|try again|download|upload|continue)\b/iu;
const rawErrorExpression = /(?:\b(?:e|err|error|cause|response)\??\.(?:message|stack|cause|body|text)\b|JSON\.stringify\s*\(\s*(?:e|err|error|response)\b|String\s*\(\s*(?:e|err|error)\b)/iu;
const messageSinkCall = /(?:^|\.)toast\.(?:error|warning|success|info)|(?:^|\.)set(?:Form)?Error|(?:^|\.)set(?:Form)?Message|(?:^|\.)setFeedback/iu;
const apiErrorCall = /(?:oauthError|jsonError|errorResponse|Response\.json|NextResponse\.json)/u;
const validationMethod = new Set(["min", "max", "email", "regex", "url", "uuid", "int", "positive", "nonnegative", "refine"]);

async function walk(dir) {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return []; }
  const found = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", ".git", "dist", "build", ".output"].includes(entry.name)) continue;
      found.push(...await walk(full));
    } else if (extensions.has(path.extname(entry.name))) found.push(full);
  }
  return found;
}

function literalText(node) {
  if (!node) return undefined;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) {
    let value = node.head.text;
    for (const span of node.templateSpans) value += "<dynamic>" + span.literal.text;
    return value;
  }
  return undefined;
}

function sourceRef(node, source) {
  const pos = source.getLineAndCharacterOfPosition(node.getStart(source));
  return { line: pos.line + 1, column: pos.character + 1 };
}

function classify(message, dynamicText, kind) {
  const flags = [];
  if (dynamicText && rawErrorExpression.test(dynamicText)) flags.push("raw-exception-forwarding");
  if (message && bannedCopy.test(message.trim())) flags.push("standalone-generic-copy");
  if (message && genericPhrase.test(message)) flags.push("generic-or-ambiguous-copy");
  if (message && technicalCopy.test(message)) flags.push("technical-detail-in-copy");
  if (message && ["toast.error", "toast.warning", "alert-text", "field-error"].includes(kind) && !actionWord.test(message)) {
    flags.push("no-working-next-action-visible-in-copy");
  }
  return flags;
}

function stableId(file, kind, operation, text, duplicateIndex) {
  const hash = createHash("sha256").update([file, kind, operation, text ?? "<dynamic>", duplicateIndex].join("\n")).digest("hex").slice(0, 12).toUpperCase();
  return `VMG-SITE-${hash}`;
}

const files = (await walk(sourceRoot)).sort();
const messageSites = [];
const apiErrorSites = [];
let formCount = 0;
let serverFunctionCount = 0;
let validationRuleCount = 0;
const occurrences = new Map();

for (const absolute of files) {
  const relative = path.relative(root, absolute).replaceAll("\\", "/");
  const text = await readFile(absolute, "utf8");
  const scriptKind = absolute.endsWith(".tsx") || absolute.endsWith(".jsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(absolute, text, ts.ScriptTarget.Latest, true, scriptKind);
  const isApiFile = relative.startsWith("src/routes/api/");

  function addSite(node, kind, operation, message, dynamicText) {
    const flags = classify(message, dynamicText, kind);
    const counterKey = [relative, kind, operation, message ?? "<dynamic>"].join("|");
    const duplicateIndex = occurrences.get(counterKey) ?? 0;
    occurrences.set(counterKey, duplicateIndex + 1);
    const row = {
      id: stableId(relative, kind, operation, message, duplicateIndex),
      file: relative,
      ...sourceRef(node, source),
      kind,
      operation,
      message: message && message.length <= 320 ? message : message ? `${message.slice(0, 317)}...` : undefined,
      dynamicErrorForwarding: Boolean(dynamicText && rawErrorExpression.test(dynamicText)),
      riskFlags: flags,
      reviewStatus: flags.length ? "OPEN_CANDIDATE_NOT_BEHAVIOR_TESTED" : "INVENTORIED_NOT_BEHAVIOR_TESTED",
    };
    if (flags.length) {
      row.triage = {
        severity: "UNASSESSED_CANDIDATE",
        reproduction: "Not established by static analysis. Identify the enclosing control and actor, then reproduce the exact negative result with a deterministic fixture or an already-authorized hosted read; do not induce real service outages.",
        expectedHumanMessage: "Not assigned from source text alone. Derive from the verified business/security result and state only a reason the application can establish.",
        workingNextAction: "Inspect the complete user action and available recovery controls; test that the suggested next action works for this actor.",
        owner: "Turing — module consumer triage; source/domain owner to confirm from the owning workflow before remediation.",
        focusedBehaviorTest: "NOT_RUN; this row is a source candidate, not a confirmed defect.",
        deployedHostedStatus: "NOT_TESTED_BY_THIS_INVENTORY.",
      };
    }
    messageSites.push(row);
    if (isApiFile && /error|response|json/iu.test(operation)) apiErrorSites.push(row.id);
  }

  function visit(node) {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = ts.isJsxElement(node) ? node.openingElement.tagName.getText(source) : node.tagName.getText(source);
      const attributes = ts.isJsxElement(node) ? node.openingElement.attributes : node.attributes;
      const hasAlertRole = attributes.properties.some((attribute) =>
        ts.isJsxAttribute(attribute) && attribute.name.getText(source) === "role" && literalText(attribute.initializer?.expression) === "alert",
      );
      if (hasAlertRole && ts.isJsxElement(node)) {
        const parts = [];
        const collect = (child) => {
          if (ts.isJsxText(child)) { if (child.getText(source).trim()) parts.push(child.getText(source).trim()); }
          else if (ts.isJsxExpression(child) && child.expression && ts.isStringLiteral(child.expression)) parts.push(child.expression.text);
          else if (ts.isJsxElement(child) || ts.isJsxFragment(child)) child.children.forEach(collect);
        };
        node.children.forEach(collect);
        const message = parts.join(" ").replace(/\s+/gu, " ").trim();
        if (message) addSite(node, "alert-text", tag, message, undefined);
      }
      if (ts.isJsxElement(node)) node.children.forEach(visit);
    }

    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      if (node.tagName.getText(source).toLowerCase() === "form") formCount++;
    }

    if (ts.isCallExpression(node)) {
      const operation = node.expression.getText(source);
      const arg = node.arguments[0];
      const message = literalText(arg);
      if (messageSinkCall.test(operation)) {
        const kind = /toast\.success|toast\.info/iu.test(operation) ? "status-toast" : /setFormError|setError/iu.test(operation) ? "field-error" : "toast.error";
        addSite(node, kind, operation, message, arg?.getText(source));
      }
      const methodName = ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : "";
      if (validationMethod.has(methodName)) {
        validationRuleCount++;
        const messageArg = node.arguments.length > 1 ? node.arguments[node.arguments.length - 1] : undefined;
        const validationMessage = literalText(messageArg);
        if (validationMessage) addSite(node, "validation-copy", operation, validationMessage, undefined);
      }
      const responseShape = arg?.getText(source) ?? "";
      if (isApiFile && apiErrorCall.test(operation) && (/oauthError/i.test(operation) || /\b(?:error|error_description|message|errorCode)\b/iu.test(responseShape))) {
        addSite(node, "api-error-response", operation, message, arg?.getText(source));
      }
      if (operation.endsWith("createServerFn")) serverFunctionCount++;
    }

    if (ts.isNewExpression(node) && node.expression.getText(source) === "Error") {
      const message = literalText(node.arguments?.[0]);
      if (message) addSite(node, "server-error-copy", "new Error", message, undefined);
    }

    ts.forEachChild(node, visit);
  }

  visit(source);
}

const routeFiles = files.filter((file) => path.relative(path.join(root, "src/routes"), file).split(path.sep)[0] !== "..");
const apiRouteFiles = routeFiles.filter((file) => path.relative(path.join(root, "src/routes/api"), file).split(path.sep)[0] !== "..");
const componentFiles = files.filter((file) => path.relative(path.join(root, "src/components"), file).split(path.sep)[0] !== "..");
const libFiles = files.filter((file) => path.relative(path.join(root, "src/lib"), file).split(path.sep)[0] !== "..");
function routeArea(file) {
  const relative = path.relative(root, file).replaceAll("\\", "/");
  if (relative.startsWith("src/routes/api/")) return "api";
  if (relative.startsWith("src/routes/mkt-admin/")) return "marketing-admin";
  if (relative.startsWith("src/routes/_authenticated/$slug/")) return "tenant-workspace-shell";
  if (/^src\/routes\/_authenticated\/platform(?:\.|\/|$)/u.test(relative)) return "platform-admin";
  if (relative.startsWith("src/routes/_authenticated/")) return "authenticated-shared";
  if (relative.startsWith("src/routes/")) return "public-auth-and-marketing";
  if (relative.startsWith("src/components/")) return "shared-components";
  if (relative.startsWith("src/lib/")) return "shared-libraries";
  return "other-source";
}
const routeAreaCounts = Object.fromEntries(
  [...new Set(routeFiles.map(routeArea))].sort().map((area) => [area, routeFiles.filter((file) => routeArea(file) === area).length]),
);
const messageAreaCounts = {};
for (const row of messageSites) {
  const area = routeArea(path.join(root, row.file));
  const group = messageAreaCounts[area] ??= { sites: 0, unverifiedCandidates: 0, rawErrorForwarding: 0, genericOrAmbiguous: 0 };
  group.sites += 1;
  if (row.riskFlags.length) group.unverifiedCandidates += 1;
  if (row.dynamicErrorForwarding) group.rawErrorForwarding += 1;
  if (row.riskFlags.some((flag) => flag.includes("generic"))) group.genericOrAmbiguous += 1;
}
const pageText = await readFile(path.join(sourceRoot, "lib/page-permissions.ts"), "utf8");
const platformText = await readFile(path.join(sourceRoot, "routes/_authenticated/platform.tsx"), "utf8");
function pageCount(name, nextName) {
  const start = pageText.indexOf(`export const ${name}`);
  const end = nextName ? pageText.indexOf(`export const ${nextName}`, start + 1) : pageText.indexOf("/** Platform pages", start + 1);
  if (start < 0) return null;
  const slice = pageText.slice(start, end < 0 ? pageText.length : end);
  return (slice.match(/\{\s*key:/gu) ?? []).length;
}
const platformStart = platformText.indexOf("const PAGES");
const platformEnd = platformText.indexOf("const PLATFORM_HIDDEN_FROM_PRIMARY_NAV", platformStart + 1);
const platformPageSource = platformStart < 0 ? "" : platformText.slice(platformStart, platformEnd < 0 ? platformText.length : platformEnd);
const platformPageDefinitions = (platformPageSource.match(/\{\s*key:/gu) ?? []).length;

const output = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  evidenceTier: "SOURCE_INVENTORY_NOT_BEHAVIORAL_CLOSURE",
  scope: {
    sourceFiles: files.length,
    routeFiles: routeFiles.length,
    apiRouteFiles: apiRouteFiles.length,
    componentFiles: componentFiles.length,
    libraryFiles: libFiles.length,
    workspacePageDefinitions: pageCount("WORKSPACE_PAGES", "TENANT_PAGES"),
    tenantPageDefinitions: pageCount("TENANT_PAGES", "PLATFORM_PAGES"),
    platformPageDefinitions,
    formElements: formCount,
    serverFunctionDeclarations: serverFunctionCount,
    validationRuleCallSites: validationRuleCount,
    routeFilesByArea: routeAreaCounts,
    messageSinksBySourceArea: messageAreaCounts,
  },
  scan: {
    messageSites: messageSites.length,
    apiErrorResponseSites: apiErrorSites.length,
    openCandidates: messageSites.filter((row) => row.riskFlags.length > 0).length,
    rawErrorForwardingSites: messageSites.filter((row) => row.dynamicErrorForwarding).length,
    genericOrAmbiguousSites: messageSites.filter((row) => row.riskFlags.some((flag) => flag.includes("generic"))).length,
    technicalCopySites: messageSites.filter((row) => row.riskFlags.includes("technical-detail-in-copy")).length,
  },
  limitations: [
    "Static discovery identifies candidate sinks and exact source locations; it does not prove execution, visibility, accessibility, or working recovery actions.",
    "Dynamic server errors, condition-dependent wording, API status semantics, and service/provider paths require the behavioral cases in the human registry.",
    "Files under tests, generated route trees, private QA data, vendor output, and non-src runtime bundles are not part of this source denominator.",
  ],
  messageSites,
};

if (outputPath) {
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, { flag: "wx" });
  process.stdout.write(`${JSON.stringify({written:true,path:path.relative(root,outputPath),scope:output.scope,scan:output.scan})}\n`);
} else if (summaryOnly) {
  process.stdout.write(`${JSON.stringify({scope:output.scope,scan:output.scan})}\n`);
} else {
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}
