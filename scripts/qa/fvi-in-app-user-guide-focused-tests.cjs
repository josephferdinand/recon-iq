// Isolated Knowledge guide checks only. Not a global compiler/build or hosted proof.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const Module = require('node:module');
const ts = require('typescript');
const esbuild = require('esbuild');
const { JSDOM } = require('jsdom');
const ROOT = path.resolve(__dirname, '../..');
const CANDIDATE = process.env.FVI_GUIDE_SOURCE_ROOT || './LOCAL_USER/AppData/Local/Temp/fvi-batch4-candidate-20260928';
const report = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/evidence', process.env.FVI_GUIDE_GENERATION_MANIFEST || 'FVI_IN_APP_KNOWLEDGE_GUIDE_GENERATION_2026-10-04.json'), 'utf8'));
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://guide-preview.invalid' });
global.window = dom.window; global.document = dom.window.document;
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });
global.HTMLElement = dom.window.HTMLElement; global.Element = dom.window.Element;
const React = require('react');
const { render, screen, fireEvent, cleanup, within } = require('@testing-library/react');
const passed = [];
const procedures = () => within(screen.getByRole('navigation', { name: 'Application guide procedures' }));
const test = (name, fn) => { fn(); passed.push(name); };

(async () => {
  const sourcePath = path.join(CANDIDATE, 'src/components/application-user-guide.tsx');
  let source = fs.readFileSync(sourcePath, 'utf8');
  const urls = Object.fromEntries(report.captures.map(capture => [`../assets/application-guide/${capture.asset}`, `/guide-assets/${capture.asset}`]));
  source = source.replace(/const media = import\.meta\.glob<string>\([^\n]+\);/, `const media = ${JSON.stringify(urls)};`);
  const result = await esbuild.build({ stdin: { contents: source, sourcefile: sourcePath, resolveDir: path.dirname(sourcePath), loader: 'tsx' }, bundle: true, platform: 'node', format: 'cjs', write: false,
    external: ['react', 'react-dom', 'isomorphic-dompurify'], loader: { '.css': 'empty' }, jsx: 'automatic',
    plugins: [{ name: 'leased-guide-alias', setup(build) { build.onResolve({ filter: /^@\// }, args => ({ path: path.join(CANDIDATE, 'src', args.path.slice(2)) + '.ts' })); } }] });
  const fixtureFilename = path.join(ROOT, 'scripts/qa/guide-component-fixture.cjs');
  const fixture = new Module(fixtureFilename);
  fixture.filename = fixtureFilename;
  fixture.paths = Module._nodeModulePaths(ROOT); fixture._compile(result.outputFiles[0].text, fixtureFilename);
  const Guide = fixture.exports.default;

  test('Every generated figure references an unchanged reviewed PNG and explicit qualification', () => {
    assert(report.captures.length >= 75);
    for (const capture of report.captures) {
      assert(capture.alt && capture.environment && capture.version && capture.capturedAt && capture.actorRole && capture.qualification);
      assert(fs.existsSync(path.join(CANDIDATE, 'src/assets/application-guide', capture.asset)));
      for (const mark of capture.marks) {
        assert(mark.x >= 0 && mark.x <= 100 && mark.y >= 0 && mark.y <= 100); assert(mark.number > 0 && mark.text);
        if (mark.box) { const [x, y, width, height] = mark.box; assert(x >= 0 && y >= 0 && width > 0 && height > 0 && x + width <= 100 && y + height <= 100); }
      }
      assert.equal(new Set(capture.marks.map(mark => mark.number)).size, capture.marks.length);
    }
  });
  render(React.createElement(Guide, { scope: 'workspace' }));
  test('Workspace index is visible without invoking a Knowledge business query', () => {
    assert(screen.getByRole('heading', { name: 'Application user guide' }));
    assert(screen.getByRole('searchbox')); assert.equal(screen.getByRole('combobox').value, 'workspace');
    assert(procedures().getByRole('button', { name: /Read your workspace intelligence/ }));
  });
  test('Existing API documentation stays a link, not a copied API page', () => {
    const link = screen.getByRole('link', { name: /Existing API documentation/ });
    assert.equal(link.getAttribute('href'), '/support/api'); assert.equal(link.getAttribute('rel'), 'noopener noreferrer');
  });
  test('Task search returns an explicit no-match state', () => {
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'no-such-task-xyz' } });
    assert(screen.getByText(/No procedure matches/));
  });
  test('Scope selection exposes the retained tenant procedures', () => {
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '' } });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'tenant' } });
    assert(procedures().getByRole('button', { name: /business unit, group and member invitation/ }));
  });
  test('All-scope full-text search finds Unicode/document workflows', () => {
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'all' } });
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Unicode' } });
    assert(procedures().getByRole('button', { name: /productivity pivot and document view/ }));
  });
  test('Opening Home renders numbered supported steps and actual capture metadata', () => {
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '' } });
    fireEvent.click(procedures().getByRole('button', { name: /Read your workspace intelligence/ }));
    const article = screen.getByRole('article', { name: 'Read your workspace intelligence' });
    assert(article.querySelector('ol')); assert(within(article).getAllByRole('img').length >= 2);
    assert(within(article).getAllByText(/7180321a/).length > 0);
  });
  test('Annotation toggle removes only overlays, never original image pixels or URLs', () => {
    const article = screen.getByRole('article'); const figure = article.querySelector('figure');
    const image = figure.querySelector('img'); const original = image.getAttribute('src');
    assert(figure.querySelector('svg[data-guide-markings]')); fireEvent.click(within(figure).getByRole('checkbox'));
    assert(!figure.querySelector('svg[data-guide-markings]')); assert.equal(image.getAttribute('src'), original);
    fireEvent.click(within(figure).getByRole('checkbox')); assert(figure.querySelector('svg[data-guide-markings]'));
  });
  test('Numbered annotation links have real corresponding keyboard-focus targets', () => {
    const links = screen.getAllByRole('link', { name: /^Mark \d+:/ });
    for (const link of links) { const target = document.getElementById(link.hash.slice(1)); assert(target); assert.equal(target.tabIndex, -1); }
  });
  test('Capture originals open safely and retain descriptive alt text', () => {
    const article = screen.getByRole('article');
    for (const link of within(article).getAllByRole('link', { name: /Open original capture/ })) { assert.equal(link.target, '_blank'); assert.equal(link.rel, 'noopener noreferrer'); }
    for (const image of within(article).getAllByRole('img')) assert(image.alt.trim());
  });
  test('Reports publishes the actual failed read, not unseen future download/scheduler actions', () => {
    fireEvent.click(procedures().getByRole('button', { name: /Recover an unavailable report/ }));
    const article = screen.getByRole('article');
    assert(article.textContent.includes('Retry reports')); assert(article.textContent.includes('No populated tabs'));
    assert(!article.textContent.includes('Save new report')); assert(!article.textContent.includes('Submit for independent approval'));
  });
  test('All147 navigation entries and32 existing Support articles retain qualified coverage', () => {
    assert.equal(report.sourceNavigationRows, 147); assert.equal(report.supportArticles, 32);
    assert(screen.getByText(/Feature and procedure coverage/)); assert(screen.getByText(/Existing Support article inventory/));
    assert(document.body.textContent.includes('Procedure needed'));
  });
  test('Navigator preserves query errors, management gates and original library workflow', () => {
    const nav = fs.readFileSync(path.join(CANDIDATE, 'src/components/navigator-hub.tsx'), 'utf8');
    assert.equal((nav.match(/\{userGuide\}/g) || []).length, 3);
    assert(nav.includes('q.isError')); assert(nav.includes('q.data?.can_manage')); assert(nav.includes('Manage articles'));
    assert(nav.includes('RebuildCopilotIndexButton')); assert(nav.includes('getKbArticleBySlug')); assert(nav.includes('navigatorHubData'));
  });
  test('Leased components parse without invoking global typechecking or route generation', () => {
    for (const name of ['application-user-guide.tsx', 'navigator-hub.tsx']) {
      const source = fs.readFileSync(path.join(CANDIDATE, 'src/components', name), 'utf8');
      const parsed = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 }, reportDiagnostics: true });
      assert.equal(parsed.diagnostics.length, 0);
    }
  });
  cleanup();
  let openedSlug = null;
  render(React.createElement(Guide, { scope: 'workspace', libraryState: 'available',
    libraryArticles: [{ slug: 'existing-reader-control', title: 'Existing permission-scoped article', category_id: 'existing-category' }],
    libraryCategories: [{ id: 'existing-category', name: 'Workspace · Existing category' }],
    onOpenLibraryArticle: slug => { openedSlug = slug; } }));
  test('Permission-scoped library inventory calls the original article opener with its exact slug', () => {
    fireEvent.click(screen.getByRole('button', { name: 'Existing permission-scoped article' }));
    assert.equal(openedSlug, 'existing-reader-control');
    assert(screen.getByText(/Current permission-scoped Knowledge library inventory/));
    assert(document.body.textContent.includes('1 articles / 1 categories'));
  });
  cleanup();
  render(React.createElement(Guide, { scope: 'tenant', libraryState: 'unavailable' }));
  test('Unavailable library metadata is not reported as an empty authoritative library', () => {
    assert(screen.getByText(/Library metadata is unavailable; no empty-library result is inferred/));
    assert(screen.getByRole('heading', { name: 'Application user guide' }));
  });
  cleanup();
  fs.writeFileSync(path.join(ROOT, 'docs/evidence', process.env.FVI_GUIDE_TEST_REPORT || 'FVI_IN_APP_KNOWLEDGE_GUIDE_FOCUSED_TESTS_2026-10-04.json'), JSON.stringify({ atUTC: new Date().toISOString(), passed: passed.length, cases: passed,
    qualification: 'Isolated real React component/jsdom/static-source contracts. Media URL mapping is a fixture for testing only. NOT global compiler/build, app deployment or hosted acceptance.' }, null, 2) + '\n');
  console.log(`Knowledge guide focused component checks passed: ${passed.length}. No hosted/global build claim.`);
})().catch(error => { cleanup(); console.error(error.message); process.exitCode = 1; });


