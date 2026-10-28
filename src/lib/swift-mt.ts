/**
 * SWIFT MT940 (End-of-day statement) + MT942 (Interim statement) parser.
 * Pure function module operating on the message text.
 *
 * MT940/942 are SWIFT FIN block-4 text formats. Each line begins with a tag
 * like :20:, :25:, :60F:, :61:, :86:, :62F:.
 */

export interface SwiftMTLine {
  bookingDate: string | null; // ISO 8601; derived from optional MT940 entry date
  valueDate: string | null; // ISO 8601; derived from mandatory MT940 value date
  side: "D" | "C"; // Debit / Credit
  amount: number;
  reference: string | null;
  transactionType: string | null;
  description: string | null;
  raw61: string;
}

function toIsoDate(year: number, month: number, day: number): string | null {
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    return null;
  }
  return candidate.toISOString().slice(0, 10);
}

function parseSwiftValueDate(raw: string): string | null {
  if (!/^\d{6}$/.test(raw)) return null;
  const shortYear = Number(raw.slice(0, 2));
  // SWIFT FIN dates carry a two-digit year. A conventional rolling pivot keeps
  // modern statement files deterministic while still accepting archived data.
  const year = shortYear >= 70 ? 1900 + shortYear : 2000 + shortYear;
  return toIsoDate(year, Number(raw.slice(2, 4)), Number(raw.slice(4, 6)));
}

function parseSwiftEntryDate(raw: string | undefined, valueDate: string | null): string | null {
  if (!raw || !/^\d{4}$/.test(raw) || !valueDate) return null;
  const valueTime = Date.parse(`${valueDate}T00:00:00Z`);
  const baseYear = Number(valueDate.slice(0, 4));
  const month = Number(raw.slice(0, 2));
  const day = Number(raw.slice(2, 4));
  const candidates = [baseYear - 1, baseYear, baseYear + 1]
    .map((year) => toIsoDate(year, month, day))
    .filter((date): date is string => date !== null);
  return (
    candidates.sort(
      (a, b) =>
        Math.abs(Date.parse(`${a}T00:00:00Z`) - valueTime) -
        Math.abs(Date.parse(`${b}T00:00:00Z`) - valueTime),
    )[0] ?? null
  );
}

export interface SwiftMTStatement {
  type: "MT940" | "MT942";
  transactionReference: string | null;
  account: string | null;
  statementNumber: string | null;
  openingBalance: number | null;
  closingBalance: number | null;
  currency: string | null;
  lines: SwiftMTLine[];
}

function getTag(text: string, tag: string): string | null {
  // tag like ":20:" — capture up to next ":" tag line or end
  const rx = new RegExp(`:${tag}:([\\s\\S]*?)(?=\\n:[0-9]{2}[A-Z]?:|$)`);
  return text.match(rx)?.[1]?.trim() ?? null;
}

function parseBalance(s: string | null): {
  amount: number | null;
  currency: string | null;
} {
  if (!s) return { amount: null, currency: null };
  // C231231USD12345,67  → side, YYMMDD, CCY, amount
  const m = s.match(/^([DC])(\d{6})([A-Z]{3})([\d,.]+)/);
  if (!m) return { amount: null, currency: null };
  const sign = m[1] === "D" ? -1 : 1;
  const amount = sign * parseFloat(m[4].replace(",", "."));
  return { amount, currency: m[3] };
}

export function parseSwiftMT(message: string): SwiftMTStatement {
  const isMT942 = /:34F:/.test(message) && !/:60F:/.test(message);
  const type: "MT940" | "MT942" = isMT942 ? "MT942" : "MT940";

  const txnRef = getTag(message, "20");
  const account = getTag(message, "25");
  const stmtNum = getTag(message, "28C");
  const opening = parseBalance(getTag(message, "60F") ?? getTag(message, "60M"));
  const closing = parseBalance(
    getTag(message, "62F") ?? getTag(message, "62M") ?? getTag(message, "64"),
  );

  // Iterate :61: ... :86: pairs
  const lines: SwiftMTLine[] = [];
  const rx = /:61:([\s\S]*?)(?=\n:61:|\n:62|\n:64|$)/g;
  for (const m of message.matchAll(rx)) {
    const body = m[1];
    const first = body.split(/\n/, 1)[0];
    // YYMMDD [MMDD] D|C [N|R][amount][type-3]NREF//ACCREF
    const r = /^(\d{6})(\d{4})?(RC|R)?([DC])([A-Z])?([\d,.]+)([A-Z0-9]{3,4})?(\S*)/;
    const mm = first.match(r);
    if (!mm) continue;
    const amount = parseFloat(mm[6].replace(",", "."));
    const desc = body.match(/\n:86:([\s\S]+)/)?.[1]?.trim() ?? null;
    const valueDate = parseSwiftValueDate(mm[1]);
    const bookingDate = parseSwiftEntryDate(mm[2], valueDate) ?? valueDate;
    lines.push({
      bookingDate,
      valueDate,
      side: mm[4] as "D" | "C",
      amount,
      reference: mm[8] || null,
      transactionType: mm[7] || null,
      description: desc,
      raw61: first,
    });
  }

  return {
    type,
    transactionReference: txnRef,
    account,
    statementNumber: stmtNum,
    openingBalance: opening.amount,
    closingBalance: closing.amount,
    currency: opening.currency ?? closing.currency,
    lines,
  };
}

export function swiftMTToRows(s: SwiftMTStatement): Record<string, unknown>[] {
  return s.lines.map((l) => ({
    account: s.account,
    booking_date: l.bookingDate,
    value_date: l.valueDate,
    amount: l.side === "D" ? -Math.abs(l.amount) : Math.abs(l.amount),
    currency: s.currency,
    side: l.side === "D" ? "DBIT" : "CRDT",
    reference: l.reference,
    transaction_type: l.transactionType,
    description: l.description,
  }));
}
