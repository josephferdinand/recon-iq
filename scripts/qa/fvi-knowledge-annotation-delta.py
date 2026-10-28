"""Prepare a guarded annotation-only delta; preserve the original source ZIP/assets."""
from pathlib import Path
import datetime, difflib, hashlib, json, re, zipfile

ROOT = Path(__file__).resolve().parents[2]
CANDIDATE = Path(r'./LOCAL_USER/AppData/Local/Temp/fvi-batch4-candidate-20260928')
DATA_PATH = 'src/content/application-user-guide.data.ts'
def load(path): return json.loads(path.read_text(encoding='utf-8-sig'))
def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def values(text, name):
    return json.loads(re.search(r'export function ' + name + r'\(\): [^\n]+? \{ return (.*?); \}', text, re.S)[1])

base = load(ROOT / 'docs/evidence/FVI_IN_APP_KNOWLEDGE_GUIDE_READY_PACKET_2026-10-04.json')
base_hash = load(ROOT / 'docs/evidence/FVI_IN_APP_KNOWLEDGE_GUIDE_SOURCE_PACKET_HASH_2026-10-04.json')
assert sha(ROOT / base_hash['path']) == base_hash['sha256']
with zipfile.ZipFile(ROOT / base_hash['path']) as source:
    previous_bytes = source.read(DATA_PATH)
current_bytes = (CANDIDATE / DATA_PATH).read_bytes()
previous, current = previous_bytes.decode().replace('\r\n', '\n'), current_bytes.decode().replace('\r\n', '\n')
changed = {}
old_articles, new_articles = values(previous, 'getApplicationGuideArticles'), values(current, 'getApplicationGuideArticles')
assert len(old_articles) == len(new_articles) == 26
for old, new in zip(old_articles, new_articles):
    assert {k: v for k, v in old.items() if k != 'blocks'} == {k: v for k, v in new.items() if k != 'blocks'}
    assert len(old['blocks']) == len(new['blocks'])
    for a, b in zip(old['blocks'], new['blocks']):
        if a['kind'] == 'capture':
            ca, cb = a['capture'], b['capture']
            assert {k: v for k, v in ca.items() if k not in ['marks', 'annotationStatus']} == {k: v for k, v in cb.items() if k not in ['marks', 'annotationStatus']}
            if ca['marks'] != cb['marks']: changed[cb['asset']] = cb
        else: assert a == b
for name in ['getApplicationGuideCoverage', 'getSupportGuideCoverage']:
    assert values(previous, name) == values(current, name)
assert len(changed) == 7
files = []
for entry in base['files']:
    path = CANDIDATE / entry['path']
    current_sha = sha(path)
    if entry['path'] != DATA_PATH: assert current_sha == entry['sha256'], entry['path']
    files.append({**entry, 'sha256': current_sha, 'bytes': path.stat().st_size})
next(entry for entry in files if entry['path'] == DATA_PATH)['preimageSHA256'] = hashlib.sha256(previous_bytes).hexdigest()
patch = ROOT / 'docs/evidence/FVI_IN_APP_KNOWLEDGE_GUIDE_ANNOTATION_BATCH2_2026-10-04.patch'
patch.write_text(''.join(difflib.unified_diff(previous.splitlines(True), current.splitlines(True), fromfile='a/' + DATA_PATH, tofile='b/' + DATA_PATH)), encoding='utf-8')
test_file = ROOT / 'docs/evidence/FVI_IN_APP_KNOWLEDGE_GUIDE_FOCUSED_TESTS_ANNOTATION_BATCH2_2026-10-04.json'
tests = load(test_file); assert tests['passed'] == 16
result = {'owner': 'Leibniz — in-app Knowledge annotation continuation',
    'atUTC': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'status': 'SOURCE COMPLETE annotation-only delta / LOCALLY VERIFIED; NOT DEPLOYED; full scope IN PROGRESS',
    'basePacket': base_hash, 'basePacketUnchanged': True, 'sourceFilesAndAssets': files,
    'changedCaptureAnnotations': list(changed.values()), 'reviewedControlCaptures': 13,
    'remainingContextOnlyCaptures': 65, 'originalCaptureBytesMetadataAndProceduresUnchanged': True,
    'allOtherSourceAndAssetsUnchanged': True, 'noBinaryAssetDuplication': True,
    'deltaPatch': {'path': patch.relative_to(ROOT).as_posix(), 'sha256': sha(patch), 'bytes': patch.stat().st_size},
    'tests': tests, 'noGlobalBuildSQLDeployDocker': True,
    'publishingGaps': ['Parent required global checks/build/deployment and authenticated Navigator Hub readback',
                       '65 captures need detailed control annotations',
                       'Remaining original full feature/function/role/checker/error/recovery/download acceptance'],
    'retainedFinding': 'Tri-Party middle hint says both sources; actual footer correctly requires three. This delta documents that text limitation, not a runtime fix.'}
(ROOT / 'docs/evidence/FVI_IN_APP_KNOWLEDGE_GUIDE_ANNOTATION_BATCH2_READY_2026-10-04.json').write_text(json.dumps(result, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
print(json.dumps({'changedCaptureAnnotations': 7, 'detailed': 13, 'pending': 65, 'focusedChecks': tests['passed'], 'patchBytes': patch.stat().st_size, 'noNewBinaryArchive': True}))
