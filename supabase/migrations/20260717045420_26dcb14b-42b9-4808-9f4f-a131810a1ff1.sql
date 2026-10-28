-- see /tmp/seed/final.sql
BEGIN;
INSERT INTO public.mkt_template_categories(slug,name,parent_id,kind,sort_order) SELECT 'cash-bank','Cash & Bank Reconciliation',(SELECT id FROM public.mkt_template_categories WHERE slug='banking'),'industry',10 ON CONFLICT (slug) DO NOTHING;
INSERT INTO public.mkt_template_categories(slug,name,parent_id,kind,sort_order) SELECT 'gl','General Ledger Reconciliation',(SELECT id FROM public.mkt_template_categories WHERE slug='banking'),'industry',11 ON CONFLICT (slug) DO NOTHING;
INSERT INTO public.mkt_template_categories(slug,name,parent_id,kind,sort_order) SELECT 'intercompany','Intercompany Reconciliation',(SELECT id FROM public.mkt_template_categories WHERE slug='banking'),'industry',12 ON CONFLICT (slug) DO NOTHING;
INSERT INTO public.mkt_template_categories(slug,name,parent_id,kind,sort_order) SELECT 'nostro-vostro','Nostro & Vostro',(SELECT id FROM public.mkt_template_categories WHERE slug='banking'),'industry',13 ON CONFLICT (slug) DO NOTHING;
INSERT INTO public.mkt_template_categories(slug,name,parent_id,kind,sort_order) SELECT 'loans','Loans & Lending',(SELECT id FROM public.mkt_template_categories WHERE slug='banking'),'industry',14 ON CONFLICT (slug) DO NOTHING;
INSERT INTO public.mkt_template_categories(slug,name,parent_id,kind,sort_order) SELECT 'treasury-cat','Treasury',(SELECT id FROM public.mkt_template_categories WHERE slug='banking'),'industry',15 ON CONFLICT (slug) DO NOTHING;
INSERT INTO public.mkt_template_categories(slug,name,parent_id,kind,sort_order) SELECT 'revenue-fee','Revenue & Fees',(SELECT id FROM public.mkt_template_categories WHERE slug='banking'),'industry',16 ON CONFLICT (slug) DO NOTHING;
INSERT INTO public.mkt_template_categories(slug,name,parent_id,kind,sort_order) SELECT 'client-customer','Client & Customer',(SELECT id FROM public.mkt_template_categories WHERE slug='banking'),'industry',17 ON CONFLICT (slug) DO NOTHING;
INSERT INTO public.mkt_template_categories(slug,name,parent_id,kind,sort_order) SELECT 'payments-ops','Payments Operations',(SELECT id FROM public.mkt_template_categories WHERE slug='payments'),'industry',20 ON CONFLICT (slug) DO NOTHING;
INSERT INTO public.mkt_template_categories(slug,name,parent_id,kind,sort_order) SELECT 'cards','Card Operations',(SELECT id FROM public.mkt_template_categories WHERE slug='payments'),'industry',21 ON CONFLICT (slug) DO NOTHING;
INSERT INTO public.mkt_template_categories(slug,name,parent_id,kind,sort_order) SELECT 'payment-gateways','Payment Gateways & FinTech',(SELECT id FROM public.mkt_template_categories WHERE slug='payments'),'industry',22 ON CONFLICT (slug) DO NOTHING;
INSERT INTO public.mkt_template_categories(slug,name,parent_id,kind,sort_order) SELECT 'securities-capmkts','Securities',(SELECT id FROM public.mkt_template_categories WHERE slug='capital-markets'),'industry',30 ON CONFLICT (slug) DO NOTHING;
INSERT INTO public.mkt_template_categories(slug,name,parent_id,kind,sort_order) SELECT 'investment-banking','Investment Banking',(SELECT id FROM public.mkt_template_categories WHERE slug='capital-markets'),'industry',31 ON CONFLICT (slug) DO NOTHING;
INSERT INTO public.mkt_template_categories(slug,name,parent_id,kind,sort_order) SELECT 'asset-management','Asset Management',(SELECT id FROM public.mkt_template_categories WHERE slug='capital-markets'),'industry',32 ON CONFLICT (slug) DO NOTHING;
INSERT INTO public.mkt_template_categories(slug,name,parent_id,kind,sort_order) SELECT 'hedge-fund','Hedge Funds',(SELECT id FROM public.mkt_template_categories WHERE slug='capital-markets'),'industry',33 ON CONFLICT (slug) DO NOTHING;
INSERT INTO public.mkt_template_categories(slug,name,parent_id,kind,sort_order) SELECT 'custody-cat','Custody',(SELECT id FROM public.mkt_template_categories WHERE slug='capital-markets'),'industry',34 ON CONFLICT (slug) DO NOTHING;
INSERT INTO public.mkt_template_categories(slug,name,parent_id,kind,sort_order) SELECT 'trade-settlement','Trade & Settlement',(SELECT id FROM public.mkt_template_categories WHERE slug='capital-markets'),'industry',35 ON CONFLICT (slug) DO NOTHING;
INSERT INTO public.mkt_template_categories(slug,name,parent_id,kind,sort_order) SELECT 'derivatives','Derivatives',(SELECT id FROM public.mkt_template_categories WHERE slug='capital-markets'),'industry',36 ON CONFLICT (slug) DO NOTHING;
INSERT INTO public.mkt_template_categories(slug,name,parent_id,kind,sort_order) SELECT 'fx','Foreign Exchange',(SELECT id FROM public.mkt_template_categories WHERE slug='capital-markets'),'industry',37 ON CONFLICT (slug) DO NOTHING;
INSERT INTO public.mkt_template_categories(slug,name,parent_id,kind,sort_order) SELECT 'corporate-actions','Corporate Actions',(SELECT id FROM public.mkt_template_categories WHERE slug='capital-markets'),'industry',38 ON CONFLICT (slug) DO NOTHING;
INSERT INTO public.mkt_template_categories(slug,name,parent_id,kind,sort_order) SELECT 'digital-assets','Digital Assets & Crypto',(SELECT id FROM public.mkt_template_categories WHERE slug='capital-markets'),'industry',39 ON CONFLICT (slug) DO NOTHING;
INSERT INTO public.mkt_template_categories(slug,name,parent_id,kind,sort_order) SELECT 'regulatory-recon','Regulatory Reconciliation',(SELECT id FROM public.mkt_template_categories WHERE slug='reg-global'),'industry',40 ON CONFLICT (slug) DO NOTHING;
INSERT INTO public.mkt_template_categories(slug,name,parent_id,kind,sort_order) SELECT 'compliance-controls','Compliance & Controls',(SELECT id FROM public.mkt_template_categories WHERE slug='reg-global'),'industry',41 ON CONFLICT (slug) DO NOTHING;
INSERT INTO public.mkt_template_categories(slug,name,parent_id,kind,sort_order) SELECT 'ai-smart','AI-Generated Smart Templates',(SELECT id FROM public.mkt_template_categories WHERE slug='banking'),'industry',90 ON CONFLICT (slug) DO NOTHING;

-- Templates: use a temp values list, then bulk insert with ON CONFLICT DO NOTHING.
WITH seed(slug,title,cat_slug,industries,standards,tags,pack) AS (
  VALUES
  -- Cash & Bank
  ('daily-bank-reconciliation','Daily Bank Reconciliation','cash-bank',ARRAY['banking'],ARRAY[]::text[],ARRAY['cash','bank'],'industry'),
  ('cash-position-reconciliation','Cash Position Reconciliation','cash-bank',ARRAY['banking'],ARRAY[]::text[],ARRAY['cash','bank'],'industry'),
  ('branch-cash-reconciliation','Branch Cash Reconciliation','cash-bank',ARRAY['banking'],ARRAY[]::text[],ARRAY['cash','bank'],'industry'),
  ('vault-reconciliation','Vault Reconciliation','cash-bank',ARRAY['banking'],ARRAY[]::text[],ARRAY['cash','bank'],'industry'),
  ('teller-reconciliation','Teller Reconciliation','cash-bank',ARRAY['banking'],ARRAY[]::text[],ARRAY['cash','bank'],'industry'),
  ('cash-in-transit-reconciliation','Cash-in-Transit Reconciliation','cash-bank',ARRAY['banking'],ARRAY[]::text[],ARRAY['cash','bank'],'industry'),
  ('multi-bank-reconciliation','Multi-Bank Reconciliation','cash-bank',ARRAY['banking'],ARRAY[]::text[],ARRAY['cash','bank'],'industry'),
  ('virtual-account-reconciliation','Virtual Account Reconciliation','cash-bank',ARRAY['banking'],ARRAY[]::text[],ARRAY['cash','bank'],'industry'),
  -- Treasury
  ('treasury-cash-reconciliation','Treasury Cash Reconciliation','treasury-cat',ARRAY['banking'],ARRAY[]::text[],ARRAY['treasury'],'industry'),
  ('treasury-position-reconciliation','Treasury Position Reconciliation','treasury-cat',ARRAY['banking'],ARRAY[]::text[],ARRAY['treasury'],'industry'),
  ('liquidity-reconciliation','Liquidity Reconciliation','treasury-cat',ARRAY['banking'],ARRAY[]::text[],ARRAY['treasury'],'industry'),
  ('treasury-settlement-reconciliation','Treasury Settlement Reconciliation','treasury-cat',ARRAY['banking'],ARRAY[]::text[],ARRAY['treasury'],'industry'),
  ('treasury-gl-reconciliation','Treasury GL Reconciliation','treasury-cat',ARRAY['banking'],ARRAY[]::text[],ARRAY['treasury'],'industry'),
  ('money-market-reconciliation','Money Market Reconciliation','treasury-cat',ARRAY['banking'],ARRAY[]::text[],ARRAY['treasury'],'industry'),
  ('investment-reconciliation','Investment Reconciliation','treasury-cat',ARRAY['banking'],ARRAY[]::text[],ARRAY['treasury'],'industry'),
  ('funding-reconciliation','Funding Reconciliation','treasury-cat',ARRAY['banking'],ARRAY[]::text[],ARRAY['treasury'],'industry'),
  ('repo-reconciliation','Repo Reconciliation','treasury-cat',ARRAY['banking'],ARRAY[]::text[],ARRAY['treasury'],'industry'),
  ('reverse-repo-reconciliation','Reverse Repo Reconciliation','treasury-cat',ARRAY['banking'],ARRAY[]::text[],ARRAY['treasury'],'industry'),
  -- GL
  ('subledger-to-gl-reconciliation','Subledger to GL Reconciliation','gl',ARRAY['banking'],ARRAY['IFRS','GAAP'],ARRAY['gl','erp'],'industry'),
  ('balance-sheet-reconciliation','Balance Sheet Reconciliation','gl',ARRAY['banking'],ARRAY['IFRS','GAAP'],ARRAY['gl','erp'],'industry'),
  ('trial-balance-reconciliation','Trial Balance Reconciliation','gl',ARRAY['banking'],ARRAY['IFRS','GAAP'],ARRAY['gl','erp'],'industry'),
  ('journal-entry-reconciliation','Journal Entry Reconciliation','gl',ARRAY['banking'],ARRAY['IFRS','GAAP'],ARRAY['gl','erp'],'industry'),
  ('suspense-account-reconciliation','Suspense Account Reconciliation','gl',ARRAY['banking'],ARRAY['IFRS','GAAP'],ARRAY['gl','erp'],'industry'),
  ('control-account-reconciliation','Control Account Reconciliation','gl',ARRAY['banking'],ARRAY['IFRS','GAAP'],ARRAY['gl','erp'],'industry'),
  ('closing-reconciliation','Closing Reconciliation','gl',ARRAY['banking'],ARRAY['IFRS','GAAP'],ARRAY['gl','erp'],'industry'),
  ('financial-statement-reconciliation','Financial Statement Reconciliation','gl',ARRAY['banking'],ARRAY['IFRS','GAAP'],ARRAY['gl','erp'],'industry'),
  ('sap-gl-reconciliation','SAP GL Reconciliation','gl',ARRAY['banking'],ARRAY['IFRS','GAAP'],ARRAY['gl','erp','sap'],'industry'),
  ('oracle-gl-reconciliation','Oracle GL Reconciliation','gl',ARRAY['banking'],ARRAY['IFRS','GAAP'],ARRAY['gl','erp','oracle'],'industry'),
  ('dynamics-365-reconciliation','Dynamics 365 Reconciliation','gl',ARRAY['banking'],ARRAY['IFRS','GAAP'],ARRAY['gl','erp','dynamics'],'industry'),
  ('workday-financial-reconciliation','Workday Financial Reconciliation','gl',ARRAY['banking'],ARRAY['IFRS','GAAP'],ARRAY['gl','erp','workday'],'industry'),
  -- Intercompany
  ('intercompany-transaction-reconciliation','Intercompany Transaction Reconciliation','intercompany',ARRAY['banking'],ARRAY[]::text[],ARRAY['intercompany'],'industry'),
  ('due-to-due-from-reconciliation','Due-To Due-From Reconciliation','intercompany',ARRAY['banking'],ARRAY[]::text[],ARRAY['intercompany'],'industry'),
  ('cross-entity-reconciliation','Cross-Entity Reconciliation','intercompany',ARRAY['banking'],ARRAY[]::text[],ARRAY['intercompany'],'industry'),
  ('shared-service-center-reconciliation','Shared Service Center Reconciliation','intercompany',ARRAY['banking'],ARRAY[]::text[],ARRAY['intercompany'],'industry'),
  ('global-treasury-intercompany-reconciliation','Global Treasury Intercompany Reconciliation','intercompany',ARRAY['banking'],ARRAY[]::text[],ARRAY['intercompany'],'industry'),
  ('cross-border-entity-reconciliation','Cross-Border Entity Reconciliation','intercompany',ARRAY['banking'],ARRAY[]::text[],ARRAY['intercompany'],'industry'),
  -- Nostro/Vostro
  ('mirror-account-reconciliation','Mirror Account Reconciliation','nostro-vostro',ARRAY['banking'],ARRAY['SWIFT','ISO20022'],ARRAY['nostro','vostro','correspondent'],'industry'),
  ('correspondent-banking-reconciliation','Correspondent Banking Reconciliation','nostro-vostro',ARRAY['banking'],ARRAY['SWIFT','ISO20022'],ARRAY['nostro','vostro','correspondent'],'industry'),
  ('swift-statement-reconciliation','SWIFT Statement Reconciliation','nostro-vostro',ARRAY['banking'],ARRAY['SWIFT','ISO20022'],ARRAY['nostro','vostro','correspondent'],'industry'),
  ('mt940-reconciliation','MT940 Reconciliation','nostro-vostro',ARRAY['banking'],ARRAY['SWIFT'],ARRAY['nostro','vostro','swift'],'industry'),
  ('mt950-reconciliation','MT950 Reconciliation','nostro-vostro',ARRAY['banking'],ARRAY['SWIFT'],ARRAY['nostro','vostro','swift'],'industry'),
  ('iso-20022-camt-reconciliation','ISO 20022 CAMT Reconciliation','nostro-vostro',ARRAY['banking'],ARRAY['ISO20022'],ARRAY['nostro','vostro','iso20022'],'industry'),
  -- Payments Ops
  ('payment-settlement-reconciliation','Payment Settlement Reconciliation','payments-ops',ARRAY['payments'],ARRAY['ISO20022'],ARRAY['payments'],'industry'),
  ('incoming-payment-reconciliation','Incoming Payment Reconciliation','payments-ops',ARRAY['payments'],ARRAY['ISO20022'],ARRAY['payments'],'industry'),
  ('outgoing-payment-reconciliation','Outgoing Payment Reconciliation','payments-ops',ARRAY['payments'],ARRAY['ISO20022'],ARRAY['payments'],'industry'),
  ('real-time-payment-reconciliation','Real-Time Payment Reconciliation','payments-ops',ARRAY['payments'],ARRAY['ISO20022'],ARRAY['payments','rtp'],'industry'),
  ('ach-reconciliation','ACH Reconciliation','payments-ops',ARRAY['payments'],ARRAY[]::text[],ARRAY['payments','ach'],'industry'),
  ('wire-transfer-reconciliation','Wire Transfer Reconciliation','payments-ops',ARRAY['payments'],ARRAY[]::text[],ARRAY['payments','wire'],'industry'),
  ('rtgs-reconciliation','RTGS Reconciliation','payments-ops',ARRAY['payments'],ARRAY[]::text[],ARRAY['payments','rtgs'],'industry'),
  ('neft-reconciliation','NEFT Reconciliation','payments-ops',ARRAY['payments'],ARRAY[]::text[],ARRAY['payments','neft'],'industry'),
  ('imps-reconciliation','IMPS Reconciliation','payments-ops',ARRAY['payments'],ARRAY[]::text[],ARRAY['payments','imps'],'industry'),
  ('upi-reconciliation','UPI Reconciliation','payments-ops',ARRAY['payments'],ARRAY[]::text[],ARRAY['payments','upi'],'industry'),
  ('faster-payments-reconciliation','Faster Payments Reconciliation','payments-ops',ARRAY['payments'],ARRAY[]::text[],ARRAY['payments','fps'],'industry'),
  ('sepa-reconciliation','SEPA Reconciliation','payments-ops',ARRAY['payments'],ARRAY['ISO20022'],ARRAY['payments','sepa'],'industry'),
  ('fedwire-reconciliation','Fedwire Reconciliation','payments-ops',ARRAY['payments'],ARRAY[]::text[],ARRAY['payments','fedwire'],'industry'),
  ('chaps-reconciliation','CHAPS Reconciliation','payments-ops',ARRAY['payments'],ARRAY[]::text[],ARRAY['payments','chaps'],'industry'),
  ('bacs-reconciliation','BACS Reconciliation','payments-ops',ARRAY['payments'],ARRAY[]::text[],ARRAY['payments','bacs'],'industry'),
  -- Cards
  ('credit-card-reconciliation','Credit Card Reconciliation','cards',ARRAY['payments'],ARRAY[]::text[],ARRAY['cards'],'industry'),
  ('debit-card-reconciliation','Debit Card Reconciliation','cards',ARRAY['payments'],ARRAY[]::text[],ARRAY['cards'],'industry'),
  ('atm-settlement-reconciliation','ATM Settlement Reconciliation','cards',ARRAY['payments'],ARRAY[]::text[],ARRAY['cards','atm'],'industry'),
  ('pos-settlement-reconciliation','POS Settlement Reconciliation','cards',ARRAY['payments'],ARRAY[]::text[],ARRAY['cards','pos'],'industry'),
  ('visa-settlement-reconciliation','Visa Settlement Reconciliation','cards',ARRAY['payments'],ARRAY[]::text[],ARRAY['cards','visa'],'industry'),
  ('mastercard-settlement-reconciliation','Mastercard Settlement Reconciliation','cards',ARRAY['payments'],ARRAY[]::text[],ARRAY['cards','mastercard'],'industry'),
  ('rupay-settlement-reconciliation','RuPay Settlement Reconciliation','cards',ARRAY['payments'],ARRAY[]::text[],ARRAY['cards','rupay'],'industry'),
  ('amex-settlement-reconciliation','Amex Settlement Reconciliation','cards',ARRAY['payments'],ARRAY[]::text[],ARRAY['cards','amex'],'industry'),
  ('chargeback-reconciliation','Chargeback Reconciliation','cards',ARRAY['payments'],ARRAY[]::text[],ARRAY['cards','chargeback'],'industry'),
  ('dispute-reconciliation','Dispute Reconciliation','cards',ARRAY['payments'],ARRAY[]::text[],ARRAY['cards','dispute'],'industry'),
  ('interchange-fee-reconciliation','Interchange Fee Reconciliation','cards',ARRAY['payments'],ARRAY[]::text[],ARRAY['cards','fees'],'industry'),
  -- Payment gateways
  ('stripe-reconciliation','Stripe Reconciliation','payment-gateways',ARRAY['payments'],ARRAY[]::text[],ARRAY['gateway','stripe'],'industry'),
  ('adyen-reconciliation','Adyen Reconciliation','payment-gateways',ARRAY['payments'],ARRAY[]::text[],ARRAY['gateway','adyen'],'industry'),
  ('braintree-reconciliation','Braintree Reconciliation','payment-gateways',ARRAY['payments'],ARRAY[]::text[],ARRAY['gateway','braintree'],'industry'),
  ('razorpay-reconciliation','Razorpay Reconciliation','payment-gateways',ARRAY['payments'],ARRAY[]::text[],ARRAY['gateway','razorpay'],'industry'),
  ('paypal-reconciliation','PayPal Reconciliation','payment-gateways',ARRAY['payments'],ARRAY[]::text[],ARRAY['gateway','paypal'],'industry'),
  ('square-reconciliation','Square Reconciliation','payment-gateways',ARRAY['payments'],ARRAY[]::text[],ARRAY['gateway','square'],'industry'),
  ('checkout-com-reconciliation','Checkout.com Reconciliation','payment-gateways',ARRAY['payments'],ARRAY[]::text[],ARRAY['gateway','checkout'],'industry'),
  ('worldpay-reconciliation','WorldPay Reconciliation','payment-gateways',ARRAY['payments'],ARRAY[]::text[],ARRAY['gateway','worldpay'],'industry'),
  ('gateway-to-bank-reconciliation','Gateway to Bank Reconciliation','payment-gateways',ARRAY['payments'],ARRAY[]::text[],ARRAY['gateway'],'industry'),
  ('merchant-fee-reconciliation','Merchant Fee Reconciliation','payment-gateways',ARRAY['payments'],ARRAY[]::text[],ARRAY['gateway','fees'],'industry'),
  ('settlement-file-reconciliation','Settlement File Reconciliation','payment-gateways',ARRAY['payments'],ARRAY[]::text[],ARRAY['gateway','settlement'],'industry'),
  -- Securities
  ('trade-capture-reconciliation','Trade Capture Reconciliation','securities-capmkts',ARRAY['capital-markets'],ARRAY[]::text[],ARRAY['securities'],'industry'),
  ('trade-execution-reconciliation','Trade Execution Reconciliation','securities-capmkts',ARRAY['capital-markets'],ARRAY[]::text[],ARRAY['securities'],'industry'),
  ('trade-confirmation-reconciliation','Trade Confirmation Reconciliation','securities-capmkts',ARRAY['capital-markets'],ARRAY[]::text[],ARRAY['securities'],'industry'),
  ('exposure-reconciliation','Exposure Reconciliation','securities-capmkts',ARRAY['capital-markets'],ARRAY[]::text[],ARRAY['securities','risk'],'industry'),
  ('risk-reconciliation','Risk Reconciliation','securities-capmkts',ARRAY['capital-markets'],ARRAY[]::text[],ARRAY['securities','risk'],'industry'),
  ('collateral-reconciliation','Collateral Reconciliation','securities-capmkts',ARRAY['capital-markets'],ARRAY[]::text[],ARRAY['securities','collateral'],'industry'),
  ('depot-reconciliation','Depot Reconciliation','securities-capmkts',ARRAY['capital-markets'],ARRAY[]::text[],ARRAY['securities','depot'],'industry'),
  ('asset-servicing-reconciliation','Asset Servicing Reconciliation','securities-capmkts',ARRAY['capital-markets'],ARRAY[]::text[],ARRAY['securities','asset-servicing'],'industry'),
  -- Investment banking
  ('prime-brokerage-reconciliation','Prime Brokerage Reconciliation','investment-banking',ARRAY['capital-markets'],ARRAY[]::text[],ARRAY['ib','prime-broker'],'industry'),
  ('syndication-reconciliation','Syndication Reconciliation','investment-banking',ARRAY['capital-markets'],ARRAY[]::text[],ARRAY['ib'],'industry'),
  ('ib-corporate-action-reconciliation','IB Corporate Action Reconciliation','investment-banking',ARRAY['capital-markets'],ARRAY[]::text[],ARRAY['ib','corp-actions'],'industry'),
  ('ma-transaction-reconciliation','M&A Transaction Reconciliation','investment-banking',ARRAY['capital-markets'],ARRAY[]::text[],ARRAY['ib','ma'],'industry'),
  ('ipo-settlement-reconciliation','IPO Settlement Reconciliation','investment-banking',ARRAY['capital-markets'],ARRAY[]::text[],ARRAY['ib','ipo'],'industry'),
  ('bond-settlement-reconciliation','Bond Settlement Reconciliation','investment-banking',ARRAY['capital-markets'],ARRAY[]::text[],ARRAY['ib','bond'],'industry'),
  -- Asset management
  ('fund-reconciliation','Fund Reconciliation','asset-management',ARRAY['capital-markets'],ARRAY[]::text[],ARRAY['fund'],'industry'),
  ('nav-reconciliation','NAV Reconciliation','asset-management',ARRAY['capital-markets'],ARRAY[]::text[],ARRAY['fund','nav'],'industry'),
  ('unit-holder-reconciliation','Unit Holder Reconciliation','asset-management',ARRAY['capital-markets'],ARRAY[]::text[],ARRAY['fund','unit-holder'],'industry'),
  ('investment-position-reconciliation','Investment Position Reconciliation','asset-management',ARRAY['capital-markets'],ARRAY[]::text[],ARRAY['fund','position'],'industry'),
  ('fund-accounting-reconciliation','Fund Accounting Reconciliation','asset-management',ARRAY['capital-markets'],ARRAY[]::text[],ARRAY['fund','accounting'],'industry'),
  ('fund-custody-reconciliation','Fund Custody Reconciliation','asset-management',ARRAY['capital-markets'],ARRAY[]::text[],ARRAY['fund','custody'],'industry'),
  ('benchmark-reconciliation','Benchmark Reconciliation','asset-management',ARRAY['capital-markets'],ARRAY[]::text[],ARRAY['fund','benchmark'],'industry'),
  -- Hedge fund
  ('hedge-fund-portfolio-reconciliation','Hedge Fund Portfolio Reconciliation','hedge-fund',ARRAY['capital-markets'],ARRAY[]::text[],ARRAY['hedge-fund'],'industry'),
  ('prime-broker-reconciliation','Prime Broker Reconciliation','hedge-fund',ARRAY['capital-markets'],ARRAY[]::text[],ARRAY['hedge-fund','prime-broker'],'industry'),
  ('derivative-reconciliation','Derivative Reconciliation','hedge-fund',ARRAY['capital-markets'],ARRAY[]::text[],ARRAY['hedge-fund','derivatives'],'industry'),
  ('margin-reconciliation','Margin Reconciliation','hedge-fund',ARRAY['capital-markets'],ARRAY[]::text[],ARRAY['hedge-fund','margin'],'industry'),
  ('short-position-reconciliation','Short Position Reconciliation','hedge-fund',ARRAY['capital-markets'],ARRAY[]::text[],ARRAY['hedge-fund','short'],'industry'),
  -- Custody
  ('custody-account-reconciliation','Custody Account Reconciliation','custody-cat',ARRAY['capital-markets'],ARRAY[]::text[],ARRAY['custody'],'industry'),
  ('asset-position-reconciliation','Asset Position Reconciliation','custody-cat',ARRAY['capital-markets'],ARRAY[]::text[],ARRAY['custody','position'],'industry'),
  ('holdings-reconciliation','Holdings Reconciliation','custody-cat',ARRAY['capital-markets'],ARRAY[]::text[],ARRAY['custody','holdings'],'industry'),
  ('custodian-statement-reconciliation','Custodian Statement Reconciliation','custody-cat',ARRAY['capital-markets'],ARRAY[]::text[],ARRAY['custody'],'industry'),
  ('custody-corporate-action-reconciliation','Custody Corporate Action Reconciliation','custody-cat',ARRAY['capital-markets'],ARRAY[]::text[],ARRAY['custody','corp-actions'],'industry'),
  -- Trade & Settlement
  ('trade-date-reconciliation','Trade Date Reconciliation','trade-settlement',ARRAY['capital-markets'],ARRAY[]::text[],ARRAY['settlement'],'industry'),
  ('settlement-date-reconciliation','Settlement Date Reconciliation','trade-settlement',ARRAY['capital-markets'],ARRAY[]::text[],ARRAY['settlement'],'industry'),
  ('failed-trade-reconciliation','Failed Trade Reconciliation','trade-settlement',ARRAY['capital-markets'],ARRAY[]::text[],ARRAY['settlement','failed'],'industry'),
  ('settlement-instruction-reconciliation','Settlement Instruction Reconciliation','trade-settlement',ARRAY['capital-markets'],ARRAY[]::text[],ARRAY['settlement'],'industry'),
  ('exchange-reconciliation','Exchange Reconciliation','trade-settlement',ARRAY['capital-markets'],ARRAY[]::text[],ARRAY['settlement','exchange'],'industry'),
  ('ccp-reconciliation','CCP Reconciliation','trade-settlement',ARRAY['capital-markets'],ARRAY[]::text[],ARRAY['settlement','ccp'],'industry'),
  -- Derivatives
  ('swap-reconciliation','Swap Reconciliation','derivatives',ARRAY['capital-markets'],ARRAY['ISDA'],ARRAY['derivatives','swap'],'industry'),
  ('cds-reconciliation','CDS Reconciliation','derivatives',ARRAY['capital-markets'],ARRAY['ISDA'],ARRAY['derivatives','cds'],'industry'),
  ('forward-reconciliation','Forward Reconciliation','derivatives',ARRAY['capital-markets'],ARRAY[]::text[],ARRAY['derivatives','forward'],'industry'),
  ('fx-derivative-reconciliation','FX Derivative Reconciliation','derivatives',ARRAY['capital-markets'],ARRAY[]::text[],ARRAY['derivatives','fx'],'industry'),
  ('futures-reconciliation','Futures Reconciliation','derivatives',ARRAY['capital-markets'],ARRAY[]::text[],ARRAY['derivatives','futures'],'industry'),
  ('options-reconciliation','Options Reconciliation','derivatives',ARRAY['capital-markets'],ARRAY[]::text[],ARRAY['derivatives','options'],'industry'),
  ('clearing-margin-reconciliation','Clearing Margin Reconciliation','derivatives',ARRAY['capital-markets'],ARRAY[]::text[],ARRAY['derivatives','margin'],'industry'),
  ('emir-reconciliation','EMIR Reconciliation','derivatives',ARRAY['capital-markets'],ARRAY['EMIR'],ARRAY['derivatives','emir'],'industry'),
  ('umr-reconciliation','UMR Reconciliation','derivatives',ARRAY['capital-markets'],ARRAY['UMR'],ARRAY['derivatives','umr'],'industry'),
  ('isda-reconciliation','ISDA Reconciliation','derivatives',ARRAY['capital-markets'],ARRAY['ISDA'],ARRAY['derivatives','isda'],'industry'),
  -- FX
  ('fx-trade-reconciliation','FX Trade Reconciliation','fx',ARRAY['capital-markets'],ARRAY[]::text[],ARRAY['fx'],'industry'),
  ('fx-settlement-reconciliation','FX Settlement Reconciliation','fx',ARRAY['capital-markets'],ARRAY[]::text[],ARRAY['fx'],'industry'),
  ('fx-position-reconciliation','FX Position Reconciliation','fx',ARRAY['capital-markets'],ARRAY[]::text[],ARRAY['fx'],'industry'),
  ('fx-exposure-reconciliation','FX Exposure Reconciliation','fx',ARRAY['capital-markets'],ARRAY[]::text[],ARRAY['fx'],'industry'),
  ('fx-confirmation-reconciliation','FX Confirmation Reconciliation','fx',ARRAY['capital-markets'],ARRAY[]::text[],ARRAY['fx'],'industry'),
  -- Loans
  ('loan-disbursement-reconciliation','Loan Disbursement Reconciliation','loans',ARRAY['banking'],ARRAY[]::text[],ARRAY['loans'],'industry'),
  ('loan-repayment-reconciliation','Loan Repayment Reconciliation','loans',ARRAY['banking'],ARRAY[]::text[],ARRAY['loans'],'industry'),
  ('emi-reconciliation','EMI Reconciliation','loans',ARRAY['banking'],ARRAY[]::text[],ARRAY['loans','emi'],'industry'),
  ('syndicated-loan-reconciliation','Syndicated Loan Reconciliation','loans',ARRAY['banking'],ARRAY[]::text[],ARRAY['loans','syndicated'],'industry'),
  ('credit-facility-reconciliation','Credit Facility Reconciliation','loans',ARRAY['banking'],ARRAY[]::text[],ARRAY['loans','credit'],'industry'),
  ('lending-exposure-reconciliation','Lending Exposure Reconciliation','loans',ARRAY['banking'],ARRAY[]::text[],ARRAY['loans','exposure'],'industry'),
  -- Regulatory
  ('basel-iii-reconciliation-pack','Basel III Reconciliation Pack','regulatory-recon',ARRAY['banking'],ARRAY['Basel III'],ARRAY['regulatory','basel'],'regulatory'),
  ('capital-adequacy-reconciliation','Capital Adequacy Reconciliation','regulatory-recon',ARRAY['banking'],ARRAY['Basel III'],ARRAY['regulatory','capital'],'regulatory'),
  ('liquidity-coverage-reconciliation','Liquidity Coverage Reconciliation','regulatory-recon',ARRAY['banking'],ARRAY['Basel III'],ARRAY['regulatory','lcr'],'regulatory'),
  ('sec-reporting-reconciliation','SEC Reporting Reconciliation','regulatory-recon',ARRAY['capital-markets'],ARRAY[]::text[],ARRAY['regulatory','sec'],'regulatory'),
  ('finra-control-reconciliation','FINRA Control Reconciliation','regulatory-recon',ARRAY['capital-markets'],ARRAY[]::text[],ARRAY['regulatory','finra'],'regulatory'),
  ('fca-regulatory-reconciliation','FCA Regulatory Reconciliation','regulatory-recon',ARRAY['banking'],ARRAY[]::text[],ARRAY['regulatory','fca'],'regulatory'),
  ('pra-control-reconciliation','PRA Control Reconciliation','regulatory-recon',ARRAY['banking'],ARRAY[]::text[],ARRAY['regulatory','pra'],'regulatory'),
  ('mifid-ii-reconciliation','MiFID II Reconciliation','regulatory-recon',ARRAY['capital-markets'],ARRAY['MiFID II'],ARRAY['regulatory','mifid'],'regulatory'),
  ('emir-trade-reconciliation','EMIR Trade Reconciliation','regulatory-recon',ARRAY['capital-markets'],ARRAY['EMIR'],ARRAY['regulatory','emir'],'regulatory'),
  ('apra-regulatory-reconciliation','APRA Regulatory Reconciliation','regulatory-recon',ARRAY['banking'],ARRAY[]::text[],ARRAY['regulatory','apra'],'regulatory'),
  ('rbi-regulatory-reporting-reconciliation','RBI Regulatory Reporting Reconciliation','regulatory-recon',ARRAY['banking'],ARRAY[]::text[],ARRAY['regulatory','rbi'],'regulatory'),
  ('sebi-capital-market-reconciliation','SEBI Capital Market Reconciliation','regulatory-recon',ARRAY['capital-markets'],ARRAY[]::text[],ARRAY['regulatory','sebi'],'regulatory'),
  -- Compliance controls
  ('sox-control-reconciliation','SOX Control Reconciliation','compliance-controls',ARRAY['banking'],ARRAY['SOX'],ARRAY['compliance','sox'],'regulatory'),
  ('internal-controls-reconciliation','Internal Controls Reconciliation','compliance-controls',ARRAY['banking'],ARRAY['SOX'],ARRAY['compliance'],'regulatory'),
  ('operational-risk-reconciliation','Operational Risk Reconciliation','compliance-controls',ARRAY['banking'],ARRAY[]::text[],ARRAY['compliance','op-risk'],'regulatory'),
  ('audit-trail-reconciliation','Audit Trail Reconciliation','compliance-controls',ARRAY['banking'],ARRAY[]::text[],ARRAY['compliance','audit'],'regulatory'),
  ('compliance-exception-reconciliation','Compliance Exception Reconciliation','compliance-controls',ARRAY['banking'],ARRAY[]::text[],ARRAY['compliance'],'regulatory'),
  -- Corporate actions
  ('dividend-reconciliation','Dividend Reconciliation','corporate-actions',ARRAY['capital-markets'],ARRAY[]::text[],ARRAY['corp-actions','dividend'],'industry'),
  ('interest-payment-reconciliation','Interest Payment Reconciliation','corporate-actions',ARRAY['capital-markets'],ARRAY[]::text[],ARRAY['corp-actions','interest'],'industry'),
  ('stock-split-reconciliation','Stock Split Reconciliation','corporate-actions',ARRAY['capital-markets'],ARRAY[]::text[],ARRAY['corp-actions','split'],'industry'),
  ('rights-issue-reconciliation','Rights Issue Reconciliation','corporate-actions',ARRAY['capital-markets'],ARRAY[]::text[],ARRAY['corp-actions','rights'],'industry'),
  ('bonus-share-reconciliation','Bonus Share Reconciliation','corporate-actions',ARRAY['capital-markets'],ARRAY[]::text[],ARRAY['corp-actions','bonus'],'industry'),
  ('merger-event-reconciliation','Merger Event Reconciliation','corporate-actions',ARRAY['capital-markets'],ARRAY[]::text[],ARRAY['corp-actions','merger'],'industry'),
  -- Revenue & fees
  ('revenue-reconciliation','Revenue Reconciliation','revenue-fee',ARRAY['banking'],ARRAY[]::text[],ARRAY['revenue'],'industry'),
  ('fee-reconciliation','Fee Reconciliation','revenue-fee',ARRAY['banking'],ARRAY[]::text[],ARRAY['fees'],'industry'),
  ('brokerage-fee-reconciliation','Brokerage Fee Reconciliation','revenue-fee',ARRAY['banking'],ARRAY[]::text[],ARRAY['fees','brokerage'],'industry'),
  ('management-fee-reconciliation','Management Fee Reconciliation','revenue-fee',ARRAY['banking'],ARRAY[]::text[],ARRAY['fees','management'],'industry'),
  ('custody-fee-reconciliation','Custody Fee Reconciliation','revenue-fee',ARRAY['banking'],ARRAY[]::text[],ARRAY['fees','custody'],'industry'),
  ('commission-reconciliation','Commission Reconciliation','revenue-fee',ARRAY['banking'],ARRAY[]::text[],ARRAY['fees','commission'],'industry'),
  -- Client / customer
  ('client-money-reconciliation','Client Money Reconciliation','client-customer',ARRAY['banking'],ARRAY[]::text[],ARRAY['client','cass'],'industry'),
  ('client-asset-reconciliation','Client Asset Reconciliation','client-customer',ARRAY['banking'],ARRAY[]::text[],ARRAY['client','cass'],'industry'),
  ('customer-account-reconciliation','Customer Account Reconciliation','client-customer',ARRAY['banking'],ARRAY[]::text[],ARRAY['client'],'industry'),
  ('investor-account-reconciliation','Investor Account Reconciliation','client-customer',ARRAY['banking'],ARRAY[]::text[],ARRAY['client','investor'],'industry'),
  -- Digital assets
  ('crypto-wallet-reconciliation','Crypto Wallet Reconciliation','digital-assets',ARRAY['capital-markets'],ARRAY[]::text[],ARRAY['crypto','wallet'],'industry'),
  ('crypto-exchange-reconciliation','Crypto Exchange Reconciliation','digital-assets',ARRAY['capital-markets'],ARRAY[]::text[],ARRAY['crypto','exchange'],'industry'),
  ('digital-asset-custody-reconciliation','Digital Asset Custody Reconciliation','digital-assets',ARRAY['capital-markets'],ARRAY[]::text[],ARRAY['crypto','custody'],'industry'),
  ('stablecoin-reserve-reconciliation','Stablecoin Reserve Reconciliation','digital-assets',ARRAY['capital-markets'],ARRAY[]::text[],ARRAY['crypto','stablecoin'],'industry'),
  ('blockchain-settlement-reconciliation','Blockchain Settlement Reconciliation','digital-assets',ARRAY['capital-markets'],ARRAY[]::text[],ARRAY['crypto','settlement'],'industry'),
  -- AI smart
  ('ai-payment-flow-reconciliation','AI Payment Flow Reconciliation','ai-smart',ARRAY['payments'],ARRAY[]::text[],ARRAY['ai','smart'],'featured'),
  ('ai-swift-message-reconciliation','AI SWIFT Message Reconciliation','ai-smart',ARRAY['banking'],ARRAY['SWIFT'],ARRAY['ai','smart','swift'],'featured'),
  ('ai-erp-to-bank-reconciliation','AI ERP to Bank Reconciliation','ai-smart',ARRAY['banking'],ARRAY[]::text[],ARRAY['ai','smart','erp'],'featured'),
  ('ai-core-banking-to-gl-reconciliation','AI Core Banking to GL Reconciliation','ai-smart',ARRAY['banking'],ARRAY[]::text[],ARRAY['ai','smart','gl'],'featured'),
  ('ai-treasury-to-settlement-reconciliation','AI Treasury to Settlement Reconciliation','ai-smart',ARRAY['banking'],ARRAY[]::text[],ARRAY['ai','smart','treasury'],'featured'),
  ('ai-multi-system-reconciliation','AI Multi-System Reconciliation','ai-smart',ARRAY['banking'],ARRAY[]::text[],ARRAY['ai','smart'],'featured'),
  ('ai-regulatory-reporting-reconciliation','AI Regulatory Reporting Reconciliation','ai-smart',ARRAY['banking'],ARRAY[]::text[],ARRAY['ai','smart','regulatory'],'featured'),
  ('ai-natural-language-custom-reconciliation','AI Natural Language Custom Reconciliation','ai-smart',ARRAY['banking'],ARRAY[]::text[],ARRAY['ai','smart','nlp'],'featured')
)
INSERT INTO public.mkt_templates(slug,title,summary,pack_type,certification,visibility,license,industries,regions,standards,tags,category_id)
SELECT s.slug, s.title,
       'Starter template for '||lower(s.title)||'. Clone into your tenant to customize sources, keys and tolerances.',
       s.pack::mkt_tpl_pack_type,'certified'::mkt_tpl_certification,'public'::mkt_tpl_visibility,'free'::mkt_tpl_license,
       s.industries, ARRAY['global']::text[], s.standards, s.tags,
       (SELECT id FROM public.mkt_template_categories WHERE slug=s.cat_slug)
FROM seed s
ON CONFLICT (slug) DO NOTHING;

-- Create v1.0.0 published version for any template lacking one
INSERT INTO public.mkt_template_versions(template_id,semver,status,spec,changelog,approved_at,published_at)
SELECT t.id,'1.0.0','published'::mkt_tpl_version_status,
  jsonb_build_object(
    'sources', jsonb_build_array(jsonb_build_object('role','source_a'), jsonb_build_object('role','source_b')),
    'match_keys', jsonb_build_array('reference','amount','value_date'),
    'tolerance', jsonb_build_object('amount', 0.01),
    'exceptions', jsonb_build_object('aging_buckets_days', jsonb_build_array(1,3,7,30)),
    'notes','Seeded starter template. Clone into tenant to customize.'
  ),
  'Initial seed', now(), now()
FROM public.mkt_templates t
WHERE t.current_version_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM public.mkt_template_versions v WHERE v.template_id=t.id);

UPDATE public.mkt_templates t
SET current_version_id = v.id, updated_at = now()
FROM public.mkt_template_versions v
WHERE v.template_id = t.id AND v.semver='1.0.0' AND v.status='published' AND t.current_version_id IS NULL;

COMMIT;