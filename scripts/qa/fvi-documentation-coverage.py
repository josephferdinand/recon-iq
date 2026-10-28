"""Reconcile owned capture receipts without publishing private page text or secrets."""
import argparse, datetime, hashlib, json, re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EVIDENCE = ROOT / 'docs/evidence'
PUBLIC = ROOT / 'support-docs-site/assets/img/application-guide/20261002-prod77f15362'

def read(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def write(path, obj):
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--private-root', type=Path, required=True)
    parser.add_argument('--release',default='77f15362')
    parser.add_argument('--dev-release',default='e4088305')
    parser.add_argument('--plan',type=Path)
    args=parser.parse_args()
    if not re.fullmatch(r'[a-f0-9]{8}',args.release) or not re.fullmatch(r'[a-f0-9]{8}',args.dev_release):
        raise ValueError('Supply actual owner release identifiers')
    if not args.private_root.is_dir() or 'LEIBNIZ-DOCS-' not in args.private_root.name:
        raise ValueError('Use the assigned isolated documentation custody directory')
    global PUBLIC
    PUBLIC=ROOT/('support-docs-site/assets/img/application-guide/20261002-prod'+args.release)
    plan=read(args.plan or EVIDENCE/'FVI_DOCS_FULL_RUNTIME_CAPTURE_PLAN_2026-10-02.json')
    selected={}
    private=[]
    for folder in ['prod-content-current','prod-forms-current','prod-form-dialogs-current','prod-subforms-current','prod-loading-recheck','dev-public-current','public-current','dev-owned-current','dev-owned-recheck']:
        for file in sorted((args.private_root/folder).glob('*-receipt.json')):
            try: r=read(file)
            except (ValueError,OSError): continue
            if not isinstance(r,dict) or not r.get('id'): continue
            text=r.get('metadata',{}).get('privatePageText','')
            if re.search(r'Loading exceptions|Loading recent runs|^Resolving access|^Skip to main content$',text):
                r['observedState']='LOADING_OBSERVED'
            selected[r['id']]=r
            private.append({k:r.get(k) for k in ['id','atUTC','url','environment','releaseBasis','actorLabel','roleBasis','observedState','raw','derivative','rawSHA256','derivativeSHA256','openedControl']})
    now=datetime.datetime.now(datetime.timezone.utc).isoformat()
    mfa_receipt=args.private_root/'own-mfa-challenge-capture.json'
    if mfa_receipt.is_file():
        m=read(mfa_receipt)
        m.update({'url':'https://app.reconiq.example/mfa-challenge','roleBasis':'Assigned synthetic QA normal password session at challenge; actual real-MFA AAL2 success separately verified',
            'raw':str(args.private_root/'prod-own-mfa-challenge-raw.png'),'derivative':str(args.private_root/'prod-own-mfa-challenge-review.png'),'observedState':'ACTUAL_MFA_CHALLENGE'})
        m['rawSHA256']=digest(Path(m['raw'])); m['derivativeSHA256']=digest(Path(m['derivative']))
        selected[m['id']]=m
        private.append(m)
    rows=[]
    captures=[]
    for item in plan:
        r=selected.get(item['id'],{})
        short=item['id'].removeprefix('prod-').removesuffix('-'+args.release)
        image=PUBLIC/(short+'.png')
        published=bool(r) and image.is_file() and digest(image).lower()==str(r.get('derivativeSHA256','')).lower()
        metadata=r.get('metadata',{})
        state=r.get('observedState','NOT_CAPTURED')
        rows.append({'id':item['id'],'scope':short.split('-')[0], 'label':item.get('pageLabel'),
            'route':item['url'],'environment':'PROD','releaseBasis':item['releaseBasis'],
            'actorRole':'assigned synthetic QA platform maker / actual AAL2 observed',
            'controlScope':item.get('permissionHint') or 'source navigation / platform or route gate; action authority not inferred',
            'sourceVersion':'candidate4746723 pinned inventory; not asserted identical to deployed UI',
            'atUTC':r.get('atUTC'),'expected':'Authorized settled '+str(item.get('pageLabel'))+' view; independent action/denial/history evidence needed',
            'actual':state,'httpStatus':r.get('httpStatus'),'fieldCount':len(metadata.get('fields',[])),
            'observedFields':metadata.get('fields',[]),
            'assetPaths':metadata.get('assetPaths',[]),
            'actionCount':len(metadata.get('actions',[])),
            'screenshot':str(image.relative_to(ROOT)).replace('\\','/') if published else None,
            'privateCaptureId':r.get('id'),'review':'pixel reviewed public derivative' if published else 'PRIVATE / publication review pending',
            'procedureStatus':'IN PROGRESS; navigation evidence only unless linked authored procedure states narrower proof',
            'workflowClosure':'OPEN','nextCapture':('Wait for settled page and recapture only this route' if state=='LOADING_OBSERVED' else 'Open each child tab/form; record validation, allowed/denied action, distinct checker where applicable, actual outcome, recovery and audit/history')})
        if published and r:
            captures.append({'id':r['id'],'atUTC':r['atUTC'],'environment':r['environment'],'releaseBasis':r['releaseBasis'],
                'actorLabel':r['actorLabel'],'roleBasis':r['roleBasis'],'url':r['url'],'observedState':state,
                'publicImage':str(image.relative_to(ROOT)).replace('\\','/'),'derivativeSHA256':digest(image),
                'privateOriginalId':r['id'],'rawSHA256':r.get('rawSHA256'),'review':'Actual hosted image pixel reviewed; sanitized derivative; no business submission',
                'workflowProof':r.get('workflowProof')})
    for key,r in selected.items():
        extra=PUBLIC/(key+'.png')
        if key.startswith('prod-own-mfa-challenge-'): extra=PUBLIC/'prod-own-mfa-challenge.png'
        if extra.is_file() and not r.get('openedControl'):
            captures.append({'id':key,'atUTC':r.get('atUTC'),'environment':r['environment'],'releaseBasis':r['releaseBasis'],'roleBasis':r['roleBasis'],
                'url':r['url'],'observedState':r['observedState'],'publicImage':str(extra.relative_to(ROOT)).replace('\\','/'),
                'derivativeSHA256':digest(extra),'rawSHA256':r.get('rawSHA256'),'privateOriginalId':key,
                'review':'Actual canonical public/challenge capture, pixel reviewed; credential/OTP fields masked; no QR/signed URL',
                'workflowProof':r.get('workflowProof')})
        if not r.get('openedControl'): continue
        short=key.removeprefix('prod-').removesuffix('-'+args.release)
        image=PUBLIC/(short+'.png')
        if image.is_file() and digest(image).lower()==str(r.get('derivativeSHA256','')).lower():
            captures.append({'id':key,'atUTC':r['atUTC'],'environment':'PROD','releaseBasis':r['releaseBasis'],'roleBasis':r['roleBasis'],
                'url':r['url'],'observedState':r['observedState'],'openedControl':r['openedControl'],'publicImage':str(image.relative_to(ROOT)).replace('\\','/'),
                'derivativeSHA256':digest(image),'rawSHA256':r.get('rawSHA256'),'privateOriginalId':key,
                'review':'Actual dialog-only browser capture; background excluded; pixel-reviewed original QA form; no submission',
                'workflowProof':'Form opening only; save/approval/outcome and denial remain OPEN'})
    extras=[('prod-s6-processed-result-receipt.json','prod-s6-processed-result-raw.png','prod-s6-processed-result-review.png','workspace-s6-processed-result.png',None),
        ('prod-retained-pipeline-view-receipt.json','prod-retained-pipeline-view-raw.png','prod-retained-pipeline-view-review.png','workspace-retained-pipeline-view.png',None),
        ('retained-pipeline-outcomes-receipt.json','pipeline-success-history-raw.png','pipeline-success-history-review.png','pipeline-success-history.png',0),
        ('retained-pipeline-outcomes-receipt.json','pipeline-error-history-raw.png','pipeline-error-history-review.png','pipeline-error-history.png',1),
        ('prod-form-dialogs-current/prod-workspace-runs-selected-s6-'+args.release+'-receipt.json',None,None,'workspace-runs.png',None)]
    for receipt,raw_name,review_name,image_name,index in extras:
        file=args.private_root/receipt; image=PUBLIC/image_name
        if not file.is_file() or not image.is_file(): continue
        r=read(file); r=r[index] if index is not None else r
        raw=args.private_root/raw_name if raw_name else Path(r['raw'])
        derivative=args.private_root/review_name if review_name else Path(r['derivative'])
        if digest(image)!=digest(derivative): continue
        record={'id':r['id'],'atUTC':r['atUTC'],'environment':'PROD','releaseBasis':r['releaseBasis'],
            'roleBasis':r.get('roleBasis','assigned synthetic QA / real AAL2'),'publicImage':str(image.relative_to(ROOT)).replace('\\','/'),
            'derivativeSHA256':digest(image),'rawSHA256':digest(raw),'privateOriginalId':r['id'],
            'review':'Actual owned synthetic retained record; region/dialog/row derivative pixel reviewed; no new run/save/approval',
            'workflowProof':r.get('workflowProof','Read-only retained record; no business submission')}
        captures.append(record)
        private.append({**record,'raw':str(raw),'derivative':str(derivative),'receipt':str(file)})
    dev_public=ROOT/('support-docs-site/assets/img/application-guide/20261002-dev'+args.dev_release)
    for key in ['dev-workspace-dashboard-'+args.dev_release,'dev-workspace-prep-'+args.dev_release]:
        r=selected.get(key); image=dev_public/('workspace-'+('dashboard' if 'dashboard' in key else 'prep')+'.png')
        if r and image.is_file() and digest(image).lower()==str(r.get('derivativeSHA256','')).lower():
            captures.append({'id':key,'atUTC':r['atUTC'],'environment':'DEV','releaseBasis':r['releaseBasis'],'roleBasis':r['roleBasis'],
                'url':r['url'],'observedState':r['observedState'],'publicImage':str(image.relative_to(ROOT)).replace('\\','/'),
                'derivativeSHA256':digest(image),'rawSHA256':r.get('rawSHA256'),'privateOriginalId':key,
                'review':'Actual owned DEV QA view, pixel reviewed; AAL1 only','workflowProof':r['workflowProof']})
    peer=read(EVIDENCE/'FVI_INSIGHTS_HOSTED_READBACK_77F15362_2026-10-02.json')
    for r in peer.get('screenshots',[]):
        original=ROOT/r['path']; image=PUBLIC/('peer-'+original.name)
        if args.release=='77f15362' and image.is_file():
            captures.append({'id':'peer-helmholtz-'+original.stem,'environment':'PROD','releaseBasis':'77f15362; parent receipt and peer hosted content readback',
                'roleBasis':'Helmholtz owned synthetic QA maker / AAL1; no AAL2 claimed','url':'https://app.reconiq.example/reconiq-assurance-lab-prod/workspace',
                'publicImage':str(image.relative_to(ROOT)).replace('\\','/'),'derivativeSHA256':digest(image),'rawSHA256':r['sha256'],
                'sourceReceipt':'docs/evidence/FVI_INSIGHTS_HOSTED_READBACK_77F15362_2026-10-02.json',
                'review':'Pixel reviewed owned synthetic QA screen; authorized reuse; private original copy retained',
                'workflowProof':'Bounded peer readback only; retain per-feature limits and known defects in authored article'})
    ledger_path=EVIDENCE/'FVI_APPLICATION_GUIDE_CURRENT_CAPTURE_LEDGER_2026-10-02.json'
    unique={}
    for capture in captures:
        path=capture['publicImage']
        if path in unique:
            unique[path].setdefault('additionalCaptureRefs',[]).append(capture['id'])
        else: unique[path]=capture
    captures=list(unique.values())
    old=read(ledger_path) if ledger_path.is_file() else []
    historical=old if isinstance(old,list) else old.get('historicalCaptures',[])+[c for c in old.get('currentReviewedCaptures',[]) if args.release not in c.get('releaseBasis','')]
    historical=list({c['id']:c for c in historical}.values())
    write(ledger_path,{'owner':'Leibniz — Full application procedures/current screenshots','atUTC':now,'status':'IN PROGRESS',
        'releaseBasis':'PROD'+args.release+' / DEV'+args.dev_release+'; owner/canonical verified','currentReviewedCaptures':captures,'historicalCaptures':historical,
        'limitations':'Current route capture does not close complete procedures, approvals, roles, errors, downloads or recovery. V4 remains proposal until deployed.',
        'peerAuditExportSHA256':peer.get('audit',{}).get('csv_sha256')})
    matrix={'owner':'Leibniz — Full application procedures/current screenshots','atUTC':now,'status':'IN PROGRESS','sourceNavigationTargets':len(plan),
        'owner128Baseline':'128 requested baseline preserved;147 candidate navigation keys are a superset, not147 distinct accepted functions. Dedicated routes/substates still require reconciliation.',
        'rows':rows}
    write(EVIDENCE/'FVI_APPLICATION_PROCEDURE_CURRENT_RUNTIME_MATRIX_2026-10-02.json',matrix)
    write(args.private_root/'FVI_APPLICATION_PROCEDURE_PRIVATE_CAPTURE_MANIFEST_2026-10-02.json',{'atUTC':now,'captures':private,'originalCustody':'assigned Joseph+SYSTEM protected directory; no original deletion'})
    text=['# Current application procedure and screenshot matrix','',f'Leibniz — Full application procedures/current screenshots. **IN PROGRESS**. {len(plan)} candidate navigation targets have versioned current receipt slots; the owner128 baseline is not replaced or claimed complete. All workflow closures remain OPEN unless separately evidenced.','',
        '| Page / scope | Route | Role / control scope | Current actual | Screenshot / review | Concrete next capture |','|---|---|---|---|---|---|']
    for row in rows:
        shot=f"[Current image](../../{row['screenshot']})" if row['screenshot'] else 'Private receipt; pixel/publication review pending'
        text.append(f"| {row['label']} / {row['scope']} | `{row['route']}` | AAL2 synthetic platform maker / `{row['controlScope']}` | {row['actual']}; {row['fieldCount']} fields / {row['actionCount']} controls; workflow OPEN | {shot} | {row['nextCapture']} |")
    (EVIDENCE/'FVI_APPLICATION_PROCEDURE_CURRENT_RUNTIME_MATRIX_2026-10-02.md').write_text('\n'.join(text)+'\n',encoding='utf-8')
    print(json.dumps({'currentRouteReceipts':sum(bool(r['privateCaptureId']) for r in rows),'reviewedPublicImages':len(captures),
        'loadingRoutes':[r['id'] for r in rows if r['actual']=='LOADING_OBSERVED'],'wholeWorkflowCompletion':False}))

if __name__=='__main__': main()
