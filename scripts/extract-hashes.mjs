import fs from "node:fs";
const content = fs.readFileSync("dist/_worker.js/_ssr/esm-D699u9Wt.mjs", "utf8");
const wanted = ['createFamily', 'createTenant', 'listAllTenants', 'listFamilies', 'listMyTenants', 'listRecentAudit', 'listSeedablePlatformPrincipals', 'setTenantAi', 'getTenantBySlug', 'getMyAccess'];
const result = {};
for (const fn of wanted) {
  const re = new RegExp('"([0-9a-f]{64})":\\s*\\{\\s*functionName: "' + fn + '_createServerFn_handler"');
  const m = content.match(re);
  result[fn] = m ? m[1] : 'NOT_FOUND';
}
console.log(JSON.stringify(result, null, 2));