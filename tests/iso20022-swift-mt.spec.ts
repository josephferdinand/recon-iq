import { describe, it, expect } from "vitest";
import { parseISO20022 } from "@/lib/iso20022";
import { parseSwiftMT, swiftMTToRows } from "@/lib/swift-mt";

const CAMT053 = `<?xml version="1.0"?>
<Document>
  <BkToCstmrStmt>
    <GrpHdr><MsgId>FALCON-EOD-20260626</MsgId></GrpHdr>
    <Stmt>
      <Acct><Id><IBAN>GB29NWBK60161331926819</IBAN></Id><Ccy>USD</Ccy></Acct>
      <Bal><Tp><CdOrPrtry><Cd>OPBD</Cd></CdOrPrtry></Tp><Amt Ccy="USD">1000.00</Amt></Bal>
      <Bal><Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp><Amt Ccy="USD">1250.50</Amt></Bal>
      <Ntry>
        <Amt Ccy="USD">250.50</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <BookgDt><Dt>2026-06-26</Dt></BookgDt>
        <ValDt><Dt>2026-06-26</Dt></ValDt>
        <NtryDtls><TxDtls>
          <Refs><EndToEndId>FALCON-E2E-001</EndToEndId><AcctSvcrRef>BANKREF-A1</AcctSvcrRef></Refs>
          <RltdPties><Dbtr><Nm>JPM London</Nm></Dbtr></RltdPties>
          <RmtInf><Ustrd>Falcon nostro top-up</Ustrd></RmtInf>
        </TxDtls></NtryDtls>
      </Ntry>
    </Stmt>
  </BkToCstmrStmt>
</Document>`;

const MT940 = [
  ":20:FALCON-EOD",
  ":25:GB29NWBK60161331926819",
  ":28C:00123/001",
  ":60F:C260626USD1000,00",
  ":61:2606260626CR250,50NTRFFALCON-E2E-001//BANKREF-A1",
  ":86:Falcon nostro top-up from JPM",
  ":62F:C260626USD1250,50",
].join("\n");

describe("ISO 20022 camt.053", () => {
  it("parses Falcon Bank statement headers and entries", () => {
    const r = parseISO20022(CAMT053);
    expect(r.msgId).toBe("FALCON-EOD-20260626");
    expect(r.account).toBe("GB29NWBK60161331926819");
    expect(r.currency).toBe("USD");
    expect(r.openingBalance).toBe(1000);
    expect(r.closingBalance).toBe(1250.5);
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0].amount).toBe(250.5);
    expect(r.entries[0].side).toBe("CRDT");
    expect(r.entries[0].endToEndId).toBe("FALCON-E2E-001");
  });
});

describe("SWIFT MT940", () => {
  it("parses Falcon Bank EOD statement", () => {
    const r = parseSwiftMT(MT940);
    expect(r.type).toBe("MT940");
    expect(r.transactionReference).toBe("FALCON-EOD");
    expect(r.account).toBe("GB29NWBK60161331926819");
    expect(r.currency).toBe("USD");
    expect(r.openingBalance).toBe(1000);
    expect(r.closingBalance).toBe(1250.5);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0].side).toBe("C");
    expect(r.lines[0].amount).toBeCloseTo(250.5, 2);
    expect(r.lines[0].valueDate).toBe("2026-06-26");
    expect(r.lines[0].bookingDate).toBe("2026-06-26");
    expect(swiftMTToRows(r)[0]).toMatchObject({
      value_date: "2026-06-26",
      booking_date: "2026-06-26",
    });
  });

  it("resolves an entry date across a year boundary and falls back when omitted", () => {
    const crossYear = parseSwiftMT(
      [
        ":20:CROSS-YEAR",
        ":25:FVI-USD",
        ":60F:C251231USD100,00",
        ":61:2512310101D10,00NTRFREF-1",
        ":61:260102C5,00NTRFREF-2",
        ":62F:C260102USD95,00",
      ].join("\n"),
    );

    expect(crossYear.lines[0]).toMatchObject({
      valueDate: "2025-12-31",
      bookingDate: "2026-01-01",
    });
    expect(crossYear.lines[1]).toMatchObject({
      valueDate: "2026-01-02",
      bookingDate: "2026-01-02",
    });
  });
});
