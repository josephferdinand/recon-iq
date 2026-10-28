/**
 * FIX 4.4 parser — wave 2 deliverable for the FIX 4.4 ingestion roadmap
 * item. Pure-JS, workerd-compatible. Parses FIX session messages with the
 * standard SOH (\x01) field delimiter, validates checksum (tag 10), and
 * extracts Execution Reports (35=8) into normalized trade rows used by the
 * securities reconciliation engine.
 */

export const FIX_SOH = "\x01";

export interface FixMessage {
  raw: string;
  fields: Map<number, string>;
  msgType: string;
  checksumValid: boolean;
  bodyLengthValid: boolean;
}

export interface FixGroupEntry {
  [tag: number]: string;
}

export interface ExecutionReport {
  clOrdId: string | null;
  execId: string | null;
  symbol: string | null;
  side: "buy" | "sell" | "sell_short" | "unknown";
  orderQty: number | null;
  lastQty: number | null;
  lastPx: number | null;
  avgPx: number | null;
  cumQty: number | null;
  ordStatus: string | null;
  execType: string | null;
  account: string | null;
  transactTime: string | null;
  parties: FixGroupEntry[];
  allocs: FixGroupEntry[];
}

const SIDE_MAP: Record<string, ExecutionReport["side"]> = {
  "1": "buy",
  "2": "sell",
  "5": "sell_short",
  "6": "sell_short",
};

export function parseFixMessage(raw: string): FixMessage {
  const fields = new Map<number, string>();
  for (const part of raw.split(FIX_SOH)) {
    if (!part) continue;
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const tag = parseInt(part.slice(0, eq), 10);
    const val = part.slice(eq + 1);
    if (Number.isFinite(tag)) {
      // Repeating-group tags may appear multiple times; we keep last-write,
      // but tag 10 / tag 9 keep last by spec which is what we want.
      fields.set(tag, val);
    }
  }
  const msgType = fields.get(35) ?? "";

  // Checksum (tag 10): sum of all bytes up to and including the SOH
  // before "10=" mod 256, formatted as 3-digit zero-padded.
  const cksumPos = raw.indexOf(`${FIX_SOH}10=`);
  let checksumValid = false;
  if (cksumPos > 0) {
    let sum = 0;
    const slice = raw.slice(0, cksumPos + 1); // include trailing SOH
    for (let i = 0; i < slice.length; i++) sum += slice.charCodeAt(i) & 0xff;
    const expected = String(sum % 256).padStart(3, "0");
    checksumValid = fields.get(10) === expected;
  }

  // Body length (tag 9): byte count from after "9=NNN<SOH>" up to (not
  // including) the "10=" checksum field.
  const bodyLenStr = fields.get(9);
  let bodyLengthValid = false;
  if (bodyLenStr) {
    const expectedLen = parseInt(bodyLenStr, 10);
    const bodyStart = raw.indexOf(`${FIX_SOH}`, raw.indexOf("9=")) + 1;
    const bodyEnd = cksumPos > 0 ? cksumPos + 1 : raw.length;
    bodyLengthValid = expectedLen === bodyEnd - bodyStart;
  }
  return { raw, fields, msgType, checksumValid, bodyLengthValid };
}

/**
 * Parse repeating groups (NoPartyIDs=453, NoAllocs=78). FIX repeating groups
 * are flat lists; the leading "count" tag (e.g. 453) tells how many entries
 * follow, each delimited by the first tag of the group definition.
 */
function parseGroup(raw: string, countTag: number, leadTag: number): FixGroupEntry[] {
  const entries: FixGroupEntry[] = [];
  const countMatch = raw.match(new RegExp(`${FIX_SOH}${countTag}=(\\d+)`));
  if (!countMatch) return entries;
  const startIdx = countMatch.index! + countMatch[0].length;
  const after = raw.slice(startIdx);
  const parts = after.split(new RegExp(`${FIX_SOH}(?=${leadTag}=)`));
  // First element starts at the lead tag of the first entry.
  for (const part of parts) {
    if (!part.startsWith(`${FIX_SOH}`) && !part.startsWith(`${leadTag}=`)) continue;
    const entry: FixGroupEntry = {};
    for (const seg of part.split(FIX_SOH)) {
      if (!seg) continue;
      const eq = seg.indexOf("=");
      if (eq < 0) continue;
      const t = parseInt(seg.slice(0, eq), 10);
      if (!Number.isFinite(t)) continue;
      if (t === 10 || t === 9 || t === 35) break; // hit trailer / outer header
      entry[t] = seg.slice(eq + 1);
    }
    if (Object.keys(entry).length) entries.push(entry);
    if (entries.length >= parseInt(countMatch[1], 10)) break;
  }
  return entries;
}

export function extractExecutionReport(msg: FixMessage): ExecutionReport | null {
  if (msg.msgType !== "8") return null;
  const f = msg.fields;
  const toNum = (v: string | undefined) => (v != null && v !== "" ? Number(v) : null);
  return {
    clOrdId: f.get(11) ?? null,
    execId: f.get(17) ?? null,
    symbol: f.get(55) ?? null,
    side: SIDE_MAP[f.get(54) ?? ""] ?? "unknown",
    orderQty: toNum(f.get(38)),
    lastQty: toNum(f.get(32)),
    lastPx: toNum(f.get(31)),
    avgPx: toNum(f.get(6)),
    cumQty: toNum(f.get(14)),
    ordStatus: f.get(39) ?? null,
    execType: f.get(150) ?? null,
    account: f.get(1) ?? null,
    transactTime: f.get(60) ?? null,
    parties: parseGroup(msg.raw, 453, 448),
    allocs: parseGroup(msg.raw, 78, 79),
  };
}

export interface ParsedFixBatch {
  total: number;
  execReports: number;
  quarantined: { reason: string; raw: string }[];
  reports: ExecutionReport[];
}

export function parseFixStream(stream: string): ParsedFixBatch {
  const out: ParsedFixBatch = { total: 0, execReports: 0, quarantined: [], reports: [] };
  // Messages start with "8=FIX.4.4" and end with the 10= field + SOH.
  const re = /8=FIX\.4\.4[\s\S]*?\x0110=\d{3}\x01?/g;
  const matches = stream.match(re) ?? [];
  for (const raw of matches) {
    out.total += 1;
    const msg = parseFixMessage(raw);
    if (!msg.checksumValid) {
      out.quarantined.push({ reason: "checksum_invalid", raw });
      continue;
    }
    if (!msg.bodyLengthValid) {
      out.quarantined.push({ reason: "body_length_invalid", raw });
      continue;
    }
    const er = extractExecutionReport(msg);
    if (er) {
      out.execReports += 1;
      out.reports.push(er);
    }
  }
  return out;
}
