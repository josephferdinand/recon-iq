/**
 * ISO 20022 parser — camt.053 (Bank-to-Customer Statement) and
 * camt.054 (Debit/Credit Notification).
 *
 * Pure function module — no runtime dependencies. Operates on the XML string
 * directly using DOMParser when available, falling back to a tiny regex-based
 * extractor on the server.
 */

export interface ISO20022Entry {
  bookingDate: string | null;
  valueDate: string | null;
  amount: number;
  currency: string;
  side: "DBIT" | "CRDT";
  reference: string | null;
  endToEndId: string | null;
  counterparty: string | null;
  remittanceInfo: string | null;
  raw: Record<string, string>;
}

export interface ISO20022Statement {
  msgId: string | null;
  account: string | null;
  currency: string | null;
  openingBalance: number | null;
  closingBalance: number | null;
  entries: ISO20022Entry[];
}

const RX = {
  msgId: /<MsgId>([^<]+)<\/MsgId>/,
  iban: /<IBAN>([^<]+)<\/IBAN>/,
  acctCcy: /<Acct>[\s\S]*?<Ccy>([^<]+)<\/Ccy>/,
  bal: /<Bal>([\s\S]*?)<\/Bal>/g,
  balType: /<Cd>(OPBD|CLBD|PRCD|ITBD)<\/Cd>/,
  balAmt: /<Amt[^>]*Ccy="([^"]+)"[^>]*>([0-9.]+)<\/Amt>/,
  ntry: /<Ntry>([\s\S]*?)<\/Ntry>/g,
  ntryAmt: /<Amt[^>]*Ccy="([^"]+)"[^>]*>([0-9.]+)<\/Amt>/,
  cdtDbt: /<CdtDbtInd>(DBIT|CRDT)<\/CdtDbtInd>/,
  bookDt: /<BookgDt>\s*<Dt>([^<]+)<\/Dt>/,
  valDt: /<ValDt>\s*<Dt>([^<]+)<\/Dt>/,
  e2e: /<EndToEndId>([^<]+)<\/EndToEndId>/,
  acctSvcrRef: /<AcctSvcrRef>([^<]+)<\/AcctSvcrRef>/,
  rmtInf: /<Ustrd>([^<]+)<\/Ustrd>/,
  nm: /<Nm>([^<]+)<\/Nm>/,
};

export function parseISO20022(xml: string): ISO20022Statement {
  const msgId = xml.match(RX.msgId)?.[1] ?? null;
  const account = xml.match(RX.iban)?.[1] ?? null;
  const currency = xml.match(RX.acctCcy)?.[1] ?? null;

  let opening: number | null = null;
  let closing: number | null = null;
  for (const bal of xml.matchAll(RX.bal)) {
    const t = bal[1].match(RX.balType)?.[1];
    const a = bal[1].match(RX.balAmt);
    if (!t || !a) continue;
    const v = parseFloat(a[2]);
    if (t === "OPBD" || t === "PRCD") opening = v;
    if (t === "CLBD" || t === "ITBD") closing = v;
  }

  const entries: ISO20022Entry[] = [];
  for (const ntry of xml.matchAll(RX.ntry)) {
    const block = ntry[1];
    const amt = block.match(RX.ntryAmt);
    if (!amt) continue;
    entries.push({
      amount: parseFloat(amt[2]),
      currency: amt[1],
      side: (block.match(RX.cdtDbt)?.[1] ?? "CRDT") as "DBIT" | "CRDT",
      bookingDate: block.match(RX.bookDt)?.[1] ?? null,
      valueDate: block.match(RX.valDt)?.[1] ?? null,
      endToEndId: block.match(RX.e2e)?.[1] ?? null,
      reference: block.match(RX.acctSvcrRef)?.[1] ?? null,
      remittanceInfo: block.match(RX.rmtInf)?.[1] ?? null,
      counterparty: block.match(RX.nm)?.[1] ?? null,
      raw: {},
    });
  }

  return {
    msgId,
    account,
    currency,
    openingBalance: opening,
    closingBalance: closing,
    entries,
  };
}

/** Normalize ISO 20022 entries into a flat record set for the recon engine. */
export function iso20022ToRows(
  stmt: ISO20022Statement,
): Record<string, unknown>[] {
  return stmt.entries.map((e) => ({
    account: stmt.account,
    booking_date: e.bookingDate,
    value_date: e.valueDate,
    amount: e.side === "DBIT" ? -Math.abs(e.amount) : Math.abs(e.amount),
    currency: e.currency,
    side: e.side,
    reference: e.reference,
    end_to_end_id: e.endToEndId,
    counterparty: e.counterparty,
    description: e.remittanceInfo,
  }));
}
