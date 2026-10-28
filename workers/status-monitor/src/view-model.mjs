/** Shared tested public-view derivation; no provider identities or credentials. */
export function deriveView(snapshot,environment='production',period=30,regionKey='uk',now=Date.now()){
 const windowDays=[7,30,90].includes(Number(period))?Number(period):30;
 const regions=snapshot?.regions??[{key:'uk',label:'United Kingdom',location:'London',phase:'live',environment_keys:{production:'production',development:'development'}}];
 const region=regions.find(x=>x.key===regionKey)??regions[0];
 const planned=region?.phase!=='live';const envKey=region?.environment_keys?.[environment];
 const current=planned?null:snapshot?.environments?.[envKey];
 const stamp=Date.parse(snapshot?.monitor?.last_check);const stale=!current||!Number.isFinite(stamp)||now-stamp>22*60000||snapshot?.monitor?.stale===true;
 const dayStart=new Date(now);dayStart.setUTCHours(0,0,0,0);const since=dayStart.getTime()-(windowDays-1)*86400000;
 const totals={checks:0,healthy:0,degraded:0,outage:0,unknown:0};const daily=[];
 const serviceList=(current?.services??[]).map(x=>({...x,outcome:stale?'unknown':x.outcome,latency_ms:stale?null:x.latency_ms}));
 const dailyByService={};for(const s of serviceList)dailyByService[s.id]=[];
 let observedDays=0;
 for(let i=0;i<windowDays;i++){
  const date=new Date(since+i*86400000).toISOString().slice(0,10),byService=planned?{}:snapshot?.days?.[date]?.[envKey]??{};
  const day={date,checks:0,healthy:0,degraded:0,outage:0,unknown:0};
  for(const service of serviceList){const v=byService[service.id]??{};const row={date,checks:0,healthy:0,degraded:0,outage:0,unknown:0};for(const name of Object.keys(totals)){row[name]=Math.max(0,Number(v[name])||0);day[name]+=row[name];}row.outcome=!row.checks?'unknown':row.outage?'outage':row.degraded?'degraded':row.unknown?'unknown':'healthy';dailyByService[service.id].push(row);}
  if(day.checks)observedDays++;for(const name of Object.keys(totals))totals[name]+=day[name];daily.push(day);
 }
 const incidents=(planned?[]:snapshot?.incidents??[]).filter(x=>x.environment===envKey&&(!x.region_key||x.region_key===region.key)).sort((a,b)=>Date.parse(b.started_at)-Date.parse(a.started_at));
 const active=incidents.filter(x=>x.status!=='resolved'&&x.status!=='completed');const inPeriod=incidents.filter(x=>Date.parse(x.started_at)>=since||x.resolved_at&&Date.parse(x.resolved_at)>=since||active.includes(x));
 const resolved=inPeriod.filter(x=>x.resolved_at&&Date.parse(x.resolved_at)>=Date.parse(x.started_at));
 const durations=resolved.map(x=>Date.parse(x.resolved_at)-Date.parse(x.started_at)).sort((a,b)=>a-b);
 const samples=planned?[]:(snapshot?.samples??[]).filter(x=>x.at>=now-86400000&&x.at<=now);
 const latencies=samples.flatMap(x=>Object.entries(x.values).filter(([k,v])=>k.startsWith(envKey+':')&&typeof v[1]==='number'&&v[0]!=='unknown').map(([,v])=>v[1])).sort((a,b)=>a-b);
 const counts={healthy:0,degraded:0,outage:0,unknown:0};for(const s of serviceList)counts[s.outcome in counts?s.outcome:'unknown']++;
 const hb=current?.heartbeat;const heartbeatFresh=Boolean(hb?.checked_at&&now-Date.parse(hb.checked_at)<=40*60000&&now>=Date.parse(hb.checked_at));
 const heartbeatOk=heartbeatFresh&&hb.database_query_confirmed===true;
 const rag=planned?'planned':stale?'unknown':counts.outage?'red':counts.degraded?'amber':counts.unknown?'unknown':!heartbeatOk?'amber':'green';
 const ragLabel={planned:'Planned',unknown:'Not verified',red:'Red · Service disruption',amber:'Amber · Attention needed',green:'Green · Operational'}[rag];
 return{environment,envKey,region,regions,planned,stale,windowDays,services:serviceList,counts,rag,ragLabel,totals,daily,dailyByService,observedDays,samples,incidents:inPeriod,active,resolved,successPct:totals.checks?100*(totals.healthy+totals.degraded)/totals.checks:null,medianLatency:latencies.length?latencies[Math.floor(latencies.length/2)]:null,medianRecovery:durations.length?durations[Math.floor(durations.length/2)]:null,heartbeat:hb??null,heartbeatFresh,heartbeatOk,functions:current?.functions??[],lastCheck:snapshot?.monitor?.last_check??null,startedAt:snapshot?.monitor?.started_at??null};
}
