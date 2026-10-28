import {
  Banknote, Layers, CreditCard, Building2, FileCheck2,
  BrainCircuit, ShieldCheck, Workflow, Wand2, Database, LineChart, Clock,
  Lock, GitBranch, FileText, AlertTriangle,
} from "lucide-react";
import type { SolutionSpec } from "@/components/solution-page";

export const SOLUTIONS: Record<string, SolutionSpec> = {
  "cash-reconciliation": {
    slug: "cash-reconciliation",
    eyebrow: "Cash & Nostro Reconciliation",
    title: "Cash and nostro reconciliation, without the manual chase.",
    subtitle:
      "Reconcile MT940/MT950, CAMT.053/054 and internal ledger cash across every nostro, vostro and internal account — with AI-assisted triage that groups breaks by likely cause for your team to review and approve.",
    heroStat: [
      { value: "MT940 · CAMT.053", label: "Statement formats reconciled" },
      { value: "1:1 · 1:N · N:N", label: "Matching modes supported" },
      { value: "Intraday", label: "Runs on statement arrival" },
    ],
    personas: ["Treasury Operations", "Nostro Recon Teams", "Cash Management"],
    painPoints: [
      { title: "Fragmented statements", body: "Dozens of correspondent banks, mixed MT and ISO 20022 formats, timezone-dependent value dates and non-standard narratives." },
      { title: "Fee & FX noise", body: "Small fees, rate differences and rounding create high-volume, low-value breaks that swamp analysts." },
      { title: "Duplicate & missing entries", body: "Bank-side reversals and internal ledger delays create pending items that age silently past MTTR SLAs." },
      { title: "Regulatory pressure", body: "BCBS 239, DORA and internal audit demand traceable, replayable evidence for every match and write-off." },
    ],
    capabilities: [
      { icon: BrainCircuit, title: "Agentic break triage", body: "AI clusters cash breaks by root cause (fee, FX, timing, duplicate) and drafts resolutions under policy gates." },
      { icon: Workflow, title: "Configurable matching rules", body: "1:1, 1:N, N:N, tolerance, fuzzy narrative, composite keys — tuned for MT940/CAMT semantics." },
      { icon: Wand2, title: "Statement normalisation", body: "Pre-built transforms map narratives, value dates and reference fields into a canonical cash model." },
      { icon: Clock, title: "Ageing & MTTR SLAs", body: "Per-account ageing buckets, reviewer SLAs, escalation policies and near-real-time dashboards." },
      { icon: FileText, title: "Four-eyes write-off", body: "Purpose-built Break Manager with maker-checker approvals for tolerance write-offs and forced matches." },
      { icon: ShieldCheck, title: "Hash-chained audit", body: "Every match, break, comment and approval is signed into an immutable evidence chain for regulators." },
    ],
    dataSources: [
      "SWIFT MT940 / MT942 / MT950 statements",
      "ISO 20022 CAMT.053 / CAMT.054 / CAMT.052",
      "Core banking GL extracts (Flexcube, T24, Finacle, Vision Plus)",
      "SWIFT gpi tracker events",
      "Payment gateway settlement files (CSV, XML, fixed-width)",
      "Legacy fixed-width mainframe drops",
    ],
    outcomes: [
      { metric: "Automated", label: "First-pass matching with tolerance and fuzzy-narrative rules" },
      { metric: "Grouped", label: "Breaks clustered by likely cause — fee, FX, timing, duplicate" },
      { metric: "Four-eyes", label: "Approval required for write-offs and forced matches" },
      { metric: "Hash-chained", label: "Audit evidence for every match, break and approval" },
    ],
    compliance: ["BCBS 239", "DORA", "SOX ICFR", "ISO 20022", "SWIFT CSP", "SOC 2 Type II (target)"],
    faq: [
      { q: "How does ReconIQ handle correspondent-bank fee breaks?", a: "Fees are matched using tolerance and fuzzy narrative rules; residuals are auto-clustered by counterparty and routed to a tolerance write-off queue that supports four-eyes approval and policy caps." },
      { q: "Can we run cash recon intraday?", a: "Yes. ReconIQ supports scheduled, event-driven and streaming triggers, so cash can be reconciled hourly or on statement arrival, ahead of a same-day close." },
      { q: "Does ReconIQ support ISO 20022 migration?", a: "Both MT and CAMT formats are supported natively, and the Data Prep pipeline maps legacy MT narratives to canonical ISO fields so you can migrate without breaking historical rules." },
    ],
  },

  "securities-reconciliation": {
    slug: "securities-reconciliation",
    eyebrow: "Securities & Position Reconciliation",
    title: "Securities, positions and custody reconciliation in one place.",
    subtitle:
      "Reconcile custody positions, trades, corporate actions and cash-vs-position across custodians, prime brokers and internal books — with AI-assisted root-cause suggestions and evidence for every position.",
    heroStat: [
      { value: "MT535 · MT536", label: "Custody statement formats" },
      { value: "Trade · Settlement", label: "Date-aware position matching" },
      { value: "3-way", label: "Custodian · broker · internal book" },
    ],
    personas: ["Middle Office", "Custody Ops", "Fund Accounting", "Prime Brokerage Ops"],
    painPoints: [
      { title: "Multi-custodian fragmentation", body: "Different SWIFT MT535/MT536 dialects, custodian-specific extensions and inconsistent identifiers (ISIN, CUSIP, SEDOL, internal)." },
      { title: "Corporate actions", body: "Elective events, DR conversions and stock splits create transient breaks that need lifecycle-aware matching." },
      { title: "Trade date vs settlement date", body: "T/S-date reconciliation across pending, failed and partially-settled trades needs stateful position rollforward." },
      { title: "Cash-vs-position integrity", body: "Position moves must reconcile back to cash movements to catch booking errors before NAV strike." },
    ],
    capabilities: [
      { icon: Layers, title: "Position lifecycle matching", body: "Stateful reconciliation across trade date, settlement date, pending and failed states with rollforward semantics." },
      { icon: BrainCircuit, title: "Corp-actions aware AI", body: "Agentic triage recognises DR/ADR splits, mergers and elective events, proposing resolutions with source evidence." },
      { icon: Database, title: "Identifier crosswalk", body: "Built-in ISIN/CUSIP/SEDOL/ticker crosswalk with tenant overrides for internal instrument masters." },
      { icon: GitBranch, title: "Cash-vs-position", body: "Two-legged reconciliation ties position changes to their cash counterparts for booking-error detection." },
      { icon: LineChart, title: "NAV-ready dashboards", body: "Sign-off dashboards with ageing, exposure and unmatched trend, exportable to fund accounting sign-off packs." },
      { icon: ShieldCheck, title: "Custodian isolation", body: "Multi-custodian tenants use row-level isolation so ops teams only see the books they are entitled to." },
    ],
    dataSources: [
      "SWIFT MT535 (holdings), MT536 (statement of transactions), MT537 (pending), MT548 (settlement status)",
      "ISO 20022 semt.002, semt.003, semt.017",
      "Custodian & prime broker files (State Street, BNY Mellon, Northern Trust, JPM, Citi, GS PB)",
      "Trading system extracts (Charles River, BlackRock Aladdin, Bloomberg AIM)",
      "Corp-actions vendor feeds (Bloomberg CACS, Refinitiv, ICE)",
      "Internal instrument & entity masters",
    ],
    outcomes: [
      { metric: "Lifecycle-aware", label: "Matching across pending, failed and settled states" },
      { metric: "Cross-checked", label: "Cash movements tied back to position changes" },
      { metric: "Sign-off ready", label: "Ageing and exposure views for fund accounting review" },
      { metric: "Isolated", label: "Custodian books separated by row-level access controls" },
    ],
    compliance: ["SEC 17a-13", "AIFMD Annex IV", "UCITS", "MiFID II RTS 22", "DORA", "SOC 2 Type II (target)"],
    faq: [
      { q: "Can ReconIQ reconcile shadow-NAV against fund accounting?", a: "Yes. ReconIQ supports tri-party reconciliation — custody, prime broker and fund accountant — with configurable tolerance and materiality per book." },
      { q: "How are failed trades handled?", a: "Failed trades are flagged as stateful breaks tied to the parent trade lifecycle; ageing SLAs, escalation and buy-in workflows are configurable per tenant." },
      { q: "Do you support ISO 20022 semt.* messages?", a: "Yes, alongside MT5xx. ReconIQ maintains both models in the canonical schema so you can run mixed-custodian populations without dual-book pipelines." },
    ],
  },

  "payments-reconciliation": {
    slug: "payments-reconciliation",
    eyebrow: "Payments & Card Scheme Reconciliation",
    title: "Payments, cards and PSP reconciliation for modern money movement.",
    subtitle:
      "Reconcile scheme settlements, PSP payouts, wallet ledgers and switch clearing with tolerance-aware matching, chargeback lifecycle handling and exception routing as files and events arrive.",
    heroStat: [
      { value: "3-way", label: "Scheme · PSP · GL matching" },
      { value: "Scheme-native", label: "Parsers for card schemes and regional rails" },
      { value: "Streaming", label: "Exception routing on file or event arrival" },
    ],
    personas: ["Payment Ops", "Merchant Services", "Wallet & Neobank Ops", "Card Issuers"],
    painPoints: [
      { title: "Scheme file complexity", body: "Visa VSS/EPIN, Mastercard IPM/CSF, Amex, UPI, PIX, SEPA — every scheme brings its own hierarchy, fee model and reversal semantics." },
      { title: "Merchant funding disputes", body: "Merchants demand penny-perfect payout reconciliation across gross, fees, refunds, chargebacks and holdbacks." },
      { title: "Chargeback lifecycle", body: "Presentment, first chargeback, representment, arbitration — each stage moves money and must reconcile end-to-end." },
      { title: "High volume, tight SLAs", body: "Volumes into the tens of millions per day with same-day settlement SLAs leave no headroom for manual triage." },
    ],
    capabilities: [
      { icon: CreditCard, title: "Scheme-native parsers", body: "Out-of-the-box parsers for Visa VSS, Mastercard IPM/CSF, Amex, JCB, Discover, UPI, PIX, SEPA and PSP files." },
      { icon: Workflow, title: "3-way & N-way matching", body: "Match authorization, clearing, settlement and GL simultaneously with N-way tolerance and reversal awareness." },
      { icon: BrainCircuit, title: "Fee & interchange AI", body: "Agents learn per-merchant fee patterns and cluster interchange breaks by BIN, MCC and product." },
      { icon: AlertTriangle, title: "Chargeback lifecycle", body: "Stateful matching across CB stages with automatic tie-back to originating auth and settlement." },
      { icon: Clock, title: "Streaming ingestion", body: "Kafka, Kinesis and webhook connectors for real-time exception detection under scheme SLAs." },
      { icon: LineChart, title: "Merchant statements", body: "Per-merchant payout evidence and downloadable reconciliation packs to end funding disputes." },
    ],
    dataSources: [
      "Visa VSS-110/120/900 series, Base II / EPIN",
      "Mastercard IPM, CSF, T112/T140",
      "Amex, JCB, Discover, Diners scheme files",
      "SEPA SCT/SDD/Inst, UK Faster Payments, PIX (BR), UPI (IN), FedNow / RTP",
      "PSP payout files (Stripe, Adyen, Checkout.com, Worldpay, PayPal, Braintree)",
      "Switch, wallet ledger and core banking GL extracts",
    ],
    outcomes: [
      { metric: "N-way", label: "Authorisation, clearing, settlement and GL matched together" },
      { metric: "Stateful", label: "Chargeback stages tied back to the original transaction" },
      { metric: "Per-merchant", label: "Payout evidence packs for funding questions" },
      { metric: "Tokenised", label: "No PAN stored — masked PAN, BIN and last-4 only" },
    ],
    compliance: ["PCI DSS 4.0 (aligned)", "PSD2 / PSD3", "Scheme mandates (Visa, MC)", "DORA", "SOC 2 Type II (target)"],
    faq: [
      { q: "Does ReconIQ store PANs?", a: "No. Card data is tokenised on ingest; only masked PAN, BIN and last-4 are retained. Full PCI-aligned isolation with BYO-KMS envelope encryption." },
      { q: "How does it handle scheme mandates?", a: "Parsers are versioned per scheme release; ReconIQ publishes mandate-tracking notes with each release so operations teams stay ahead of Visa and Mastercard bulletins." },
      { q: "Can we reconcile in near real time?", a: "Yes. ReconIQ supports streaming ingestion, so scheme-vs-switch exceptions can be surfaced as files or events arrive, rather than at end of day." },
    ],
  },

  "intercompany-reconciliation": {
    slug: "intercompany-reconciliation",
    eyebrow: "Intercompany & GL Reconciliation",
    title: "Intercompany and GL reconciliation for month-end close.",
    subtitle:
      "Reconcile intercompany balances, subledger-to-GL and GL-to-GL across ERPs and entities — with FX awareness, elimination rules and evidence-ready packs for group audit.",
    heroStat: [
      { value: "Multi-ERP", label: "SAP, Oracle, Workday, NetSuite and file feeds" },
      { value: "Pair-aware", label: "Elimination rules per trading-partner pair" },
      { value: "Close-calendar", label: "Cut-off and sign-off controls built in" },
    ],
    personas: ["Group Finance", "Controllership", "Shared Services", "Internal Audit"],
    painPoints: [
      { title: "IC mismatches at close", body: "Entities record intercompany transactions on different dates, currencies and account structures — surfacing only at consolidation." },
      { title: "Multi-ERP reality", body: "Group finance rarely runs a single ERP; SAP, Oracle, Workday, NetSuite and legacy systems must be reconciled to a common chart." },
      { title: "FX & translation noise", body: "Rate differences, translation adjustments and CTA movements create breaks that materially matter." },
      { title: "Audit evidence overhead", body: "Excel-based reconciliations don't scale, and lack the immutable evidence external auditors increasingly demand." },
    ],
    capabilities: [
      { icon: Building2, title: "Multi-ERP ingestion", body: "Pre-built connectors for SAP S/4HANA, Oracle EBS/Fusion, Workday, NetSuite, Dynamics and file-based feeds." },
      { icon: Workflow, title: "IC elimination engine", body: "Configurable elimination rules across trading-partner pairs with materiality thresholds and FX tolerance." },
      { icon: BrainCircuit, title: "Agentic root cause", body: "AI proposes the likely source of imbalance (timing, FX, missed entry, mispost) with links to source documents." },
      { icon: FileText, title: "Reviewer certification", body: "Preparer/reviewer workflow with attestation, sign-off packs and evidence attachments per account." },
      { icon: Lock, title: "Close calendar controls", body: "Cut-off enforcement, WD-based ageing SLAs and open-item auto-reminders tied to group close calendar." },
      { icon: ShieldCheck, title: "SOX-grade audit trail", body: "Hash-chained log of every match, override and approval — signed and exportable for external audit." },
    ],
    dataSources: [
      "SAP S/4HANA (ACDOCA, BSEG), Oracle Fusion / EBS GL_JE",
      "Workday Financials, NetSuite, Microsoft Dynamics 365",
      "Legacy GL extracts (JD Edwards, Sage, Infor)",
      "Consolidation systems (OneStream, Oracle HFM / EPBCS, SAP BPC, Tagetik)",
      "AP / AR subledgers and treasury systems",
      "FX rate feeds (Bloomberg, Reuters, ECB)",
    ],
    outcomes: [
      { metric: "Rule-based", label: "Intercompany elimination with materiality thresholds" },
      { metric: "FX-aware", label: "Transaction and reporting currencies kept side by side" },
      { metric: "Attested", label: "Preparer and reviewer attestation per account" },
      { metric: "Hash-chained", label: "Evidence exportable for group audit" },
    ],
    compliance: ["SOX ICFR", "IFRS 10 / IAS 21", "US GAAP consolidation", "Local statutory audit", "SOC 2 Type II (target)"],
    faq: [
      { q: "Can ReconIQ replace BlackLine / Trintech account reconciliation?", a: "For intercompany, GL certification and subledger-to-GL, yes. ReconIQ adds native agentic root-cause and hash-chained evidence, and integrates with your consolidation platform for eliminations." },
      { q: "How is FX handled?", a: "The canonical schema stores both transaction and functional/reporting currencies with the rate applied; tolerance rules can be set per currency pair and materiality tier." },
      { q: "Does it fit into month-end close?", a: "Yes — ReconIQ is close-calendar aware, with WD-based SLAs, cut-off enforcement and reviewer certification workflows built for group controllership." },
    ],
  },

  "regulatory-reconciliation": {
    slug: "regulatory-reconciliation",
    eyebrow: "Regulatory & Transaction Reporting Reconciliation",
    title: "Regulatory reporting reconciliation, with proof for the regulator.",
    subtitle:
      "Reconcile what you reported to trade repositories, competent authorities and central banks against your source of truth — with lineage, evidence and completeness testing on every field.",
    heroStat: [
      { value: "Field-level", label: "Lineage on every reported field" },
      { value: "Completeness", label: "Universe, duplicate and over-reporting checks" },
      { value: "Exportable", label: "Signed evidence packs for supervisory review" },
    ],
    personas: ["Regulatory Reporting", "Compliance Ops", "Data Quality", "Head of Non-Financial Risk"],
    painPoints: [
      { title: "Reported ≠ intended", body: "Between source systems and the TR/NCA lies transformation, enrichment and rejection — differences here are enforcement risk." },
      { title: "Field-level accuracy", body: "EMIR REFIT, MiFID/MiFIR, SFTR, CFTC Part 45 and Dodd-Frank each demand per-field accuracy testing, not just record counts." },
      { title: "Rejections & pairings", body: "Unpaired trades, rejected submissions and back-reporting corrections need explicit reconciliation and remediation SLAs." },
      { title: "Evidence for regulators", body: "Regulators expect on-demand evidence of controls, exceptions and remediation — not screenshots of Excel." },
    ],
    capabilities: [
      { icon: FileCheck2, title: "Reported-vs-source recon", body: "Reconcile every submitted field back to the golden source, with lineage down to the record and transformation step." },
      { icon: BrainCircuit, title: "Agentic exception triage", body: "AI clusters reporting breaks by rule, jurisdiction and source system, then drafts remediation aligned to your MI/EPS control." },
      { icon: Workflow, title: "TR & NCA connectors", body: "Ingest ACK/NACK, pairing/matching and reconciliation reports from DTCC, UnaVista, REGIS-TR, KDPW, ESMA / FCA / CFTC feeds." },
      { icon: Database, title: "Completeness testing", body: "Detects universe drops, over-reporting and duplicate submissions with tenant-configurable materiality." },
      { icon: ShieldCheck, title: "Regulator-ready evidence", body: "Signed, hash-chained evidence packs exportable to CSV/JSON/PDF for SREP, ARROW and Skilled Person reviews." },
      { icon: AlertTriangle, title: "Back-reporting workflow", body: "Native handling of corrections, cancellations and terminations with linked audit history." },
    ],
    dataSources: [
      "EMIR REFIT (ESMA & FCA UK EMIR)",
      "MiFIR RTS 22 transaction reporting",
      "SFTR, CFTC Part 45/46 (Dodd-Frank), MAS OTC, HKMA, ASIC",
      "Trade repositories: DTCC GTR, UnaVista, REGIS-TR, KDPW, CME TR",
      "Front-office trade booking systems (Murex, Calypso, Summit, in-house)",
      "Reference data (LEI, ISIN, UPI, UTI)",
    ],
    outcomes: [
      { metric: "Field-level", label: "Reported values reconciled back to the golden source" },
      { metric: "Clustered", label: "Reporting breaks grouped by rule, jurisdiction and system" },
      { metric: "Remediation", label: "Corrections and back-reporting tracked with linked history" },
      { metric: "Exportable", label: "Evidence packs in CSV, JSON and PDF" },
    ],
    compliance: ["EMIR REFIT", "MiFID II / MiFIR", "SFTR", "Dodd-Frank Title VII", "DORA", "BCBS 239", "SOC 2 Type II (target)"],
    faq: [
      { q: "Does ReconIQ replace our reporting engine?", a: "No — ReconIQ is the assurance layer around your reporting engine. It reconciles what was submitted vs. what should have been submitted, and evidences the control to regulators." },
      { q: "Which regimes are supported?", a: "EMIR REFIT, MiFIR, SFTR, CFTC Parts 45/46, MAS, HKMA and ASIC out of the box. Additional regimes are configurable via the Data Prep pipeline and canonical schema." },
      { q: "How does the regulator-evidence pack work?", a: "Every reconciliation, exception, override and remediation is written to a SHA-256 hash-chained log. Evidence packs are exportable per regime, per date, signed and ready for supervisory review." },
    ],
  },
};

export const SOLUTION_SLUGS = Object.keys(SOLUTIONS);
