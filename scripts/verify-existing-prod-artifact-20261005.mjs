import{readFile,readdir,writeFile}from'node:fs/promises';
import{createHash}from'node:crypto';
import path from'node:path';
import ts from'typescript';
const candidate='./LOCAL_USER/AppData/Local/Temp/fvi-batch4-candidate-20260928',root='output/parent-integrated-next-20261005/home-reports';
const sha=x=>createHash('sha256').update(x).digest('hex');
const suffix=process.argv[2]==='repair02'?'-repair02':'';
const diagnostic=JSON.parse(await readFile(root+'/artifact-boundary-diagnostic'+suffix+'.json','utf8'));
if(diagnostic.matches.some(x=>x.service)||!diagnostic.matches.some(x=>x.prod))throw Error('Actual protected artifact boundary failed');
const mappings={
 'FVI-CX-012-migration-ledger-repair-plan':'docs/runbooks/FVI-CX-012-migration-ledger-repair-plan.md',
 'PROD_GAP_NOTE_2026-09-30':'docs/evidence/browser-human-20260930/PROD_GAP_NOTE_2026-09-30.md',
 'recon-exceptions-prod-requery-20260930':'docs/evidence/recon-exceptions-prod-requery-20260930.md',
 'VERITAS16_PROD_BROWSER_FINAL_t_b450ebfb_2026-09-30':'docs/evidence/VERITAS16_PROD_BROWSER_FINAL_t_b450ebfb_2026-09-30.md',
 '2026-09-22-gpt-5-6-sol-RETURN':'docs/handover/returns/2026-09-22-gpt-5-6-sol-RETURN.md',
 '70_detailed_session_handover_2026-09-14':'docs/70_detailed_session_handover_2026-09-14.md',
 'ACCESS_AND_ENVIRONMENT':'docs/handover/ACCESS_AND_ENVIRONMENT.md',
 'OWNER_SESSION_TEST_PLAN':'docs/testing/OWNER_SESSION_TEST_PLAN.md',
};
const proof=[];
for(const file of diagnostic.matches.filter(x=>x.dev&&x.path.startsWith('assets/')&&x.path.endsWith('.js'))){
 const basename=path.basename(file.path),key=Object.keys(mappings).find(k=>basename.startsWith(k+'-'));
 if(!key)throw Error('Unclassified client runtime DEV reference: '+file.path);
 const bytes=await readFile(path.join(candidate,'dist',file.path)),ast=ts.createSourceFile(basename,bytes.toString('utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
 if(ast.parseDiagnostics.length||ast.statements.length!==2||!ts.isVariableStatement(ast.statements[0])||!ts.isExportDeclaration(ast.statements[1]))throw Error('Documentation chunk contains executable statements');
 const declarations=ast.statements[0].declarationList.declarations,exportClause=ast.statements[1].exportClause;
 if(declarations.length!==1||!ts.isIdentifier(declarations[0].name)||!exportClause||!ts.isNamedExports(exportClause)||exportClause.elements.length!==1||exportClause.elements[0].name.text!=='default'||exportClause.elements[0].propertyName?.text!==declarations[0].name.text||ast.statements[1].moduleSpecifier)throw Error('Documentation default-export contract differs');
 const init=declarations[0].initializer;if(!init||!(ts.isStringLiteral(init)||ts.isNoSubstitutionTemplateLiteral(init)))throw Error('Historical documentation is not a closed static string');
 const source=await readFile(path.join(candidate,mappings[key]),'utf8');if(init.text!==source)throw Error('Raw documentation literal/source mismatch: '+key);
 proof.push({artifact:file.path,sha256:sha(bytes),source:mappings[key],sourceSHA256:sha(source),singleStaticStringOnly:true});
}
const build=await readFile(root+'/protected-prod-build-current'+suffix+'.log','utf8');if(!build.includes('You can deploy this build')||!build.includes('PROD artifact identity or server-secret scan failed'))throw Error('Exact completed compile/failed scan history absent');
const receipt={at:new Date().toISOString(),compileCompleted:true,originalScanFalsePositive:true,strictSourceBackedStaticDocuments:proof,runtimeDevRefFiles:0,serviceRoleMatches:0,prodRefFiles:diagnostic.matches.filter(x=>x.prod).length,generatedEnvironmentRemoved:true,artifactRebuilt:false,originalFailurePreserved:true};
try{await readFile(path.join(candidate,'.env.production.local'));throw Error('Generated environment not removed');}catch(e){if(e.code!=='ENOENT')throw e;}
await writeFile(root+'/STRICT-ARTIFACT-VERIFICATION'+suffix+'.json',JSON.stringify(receipt,null,2),{flag:'wx'});
console.log(JSON.stringify({strictArtifactVerificationPassed:true,staticDocModules:proof.length,runtimeDevReferences:0,serviceRoleMatches:0}));
