
-- 1. Extend regulatory_pack_installs with materialization status
ALTER TABLE public.regulatory_pack_installs
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','materializing','ready','failed')),
  ADD COLUMN IF NOT EXISTS materialization_error text,
  ADD COLUMN IF NOT EXISTS materialized_at timestamptz,
  ADD COLUMN IF NOT EXISTS materialized_artifacts jsonb NOT NULL DEFAULT '{}'::jsonb;

-- 2. Load EMIR Refit blueprint into the existing pack definition
UPDATE public.regulatory_template_packs
SET definition = jsonb_build_object(
  'recon', jsonb_build_object(
    'name', 'EMIR Refit — Trade Repository Reconciliation',
    'recon_type', 'two_sided',
    'sides', jsonb_build_array(
      jsonb_build_object('key','internal','label','Internal Trade Store','source_type','file'),
      jsonb_build_object('key','tr','label','Trade Repository (DTCC/REGIS-TR/UnaVista)','source_type','file')
    ),
    'rules', jsonb_build_array(
      jsonb_build_object('type','exact_match','left','uti','right','uti','priority',1),
      jsonb_build_object('type','exact_match','left','prior_uti','right','prior_uti','priority',2),
      jsonb_build_object('type','tolerance_match','left','notional','right','notional','tolerance',0.01,'unit','percent'),
      jsonb_build_object('type','tolerance_match','left','price','right','price','tolerance',0.0001,'unit','absolute'),
      jsonb_build_object('type','date_match','left','execution_timestamp','right','execution_timestamp','tolerance_minutes',5),
      jsonb_build_object('type','exact_match','left','lei_reporting','right','lei_reporting','priority',3),
      jsonb_build_object('type','exact_match','left','lei_counterparty','right','lei_counterparty','priority',4),
      jsonb_build_object('type','exact_match','left','action_type','right','action_type','priority',5),
      jsonb_build_object('type','exact_match','left','event_type','right','event_type','priority',6)
    )
  ),
  'reference_table', jsonb_build_object(
    'name','EMIR Refit Field Dictionary',
    'key_columns', ARRAY['field_code'],
    'value_columns', ARRAY['esma_ref','field_name','data_type','required','description','asset_classes']
  ),
  'pipelines', jsonb_build_array(
    jsonb_build_object('name','EMIR — Normalize Internal Trade Store',
      'description','Parse internal blotter, normalise dates to UTC, harmonise LEI/UTI casing, derive PRIOR UTI from action chain.',
      'steps', jsonb_build_array(
        jsonb_build_object('op','trim_whitespace'),
        jsonb_build_object('op','upper_case','columns',ARRAY['uti','prior_uti','lei_reporting','lei_counterparty']),
        jsonb_build_object('op','iso_date','columns',ARRAY['execution_timestamp','event_date','maturity_date']),
        jsonb_build_object('op','numeric_normalize','columns',ARRAY['notional','price','quantity']),
        jsonb_build_object('op','map_action_codes','target','action_type'),
        jsonb_build_object('op','validate_lei','columns',ARRAY['lei_reporting','lei_counterparty'])
      ),
      'dq_rules', jsonb_build_array(
        jsonb_build_object('rule','required','field','uti'),
        jsonb_build_object('rule','regex','field','uti','pattern','^[A-Z0-9]{18,52}$'),
        jsonb_build_object('rule','required','field','lei_reporting'),
        jsonb_build_object('rule','regex','field','lei_reporting','pattern','^[A-Z0-9]{20}$')
      )
    ),
    jsonb_build_object('name','EMIR — Normalize Trade Repository Feed',
      'description','Parse TR delivery (CSV/XML), unwrap action chain, align field names to ESMA Refit dictionary.',
      'steps', jsonb_build_array(
        jsonb_build_object('op','trim_whitespace'),
        jsonb_build_object('op','upper_case','columns',ARRAY['uti','prior_uti','lei_reporting','lei_counterparty']),
        jsonb_build_object('op','iso_date','columns',ARRAY['execution_timestamp','event_date','maturity_date']),
        jsonb_build_object('op','numeric_normalize','columns',ARRAY['notional','price','quantity']),
        jsonb_build_object('op','rename','mapping', jsonb_build_object(
          'TradeID','uti','PriorTradeID','prior_uti','ReportingCounterparty','lei_reporting','OtherCounterparty','lei_counterparty'
        ))
      ),
      'dq_rules', jsonb_build_array(
        jsonb_build_object('rule','required','field','uti'),
        jsonb_build_object('rule','regex','field','uti','pattern','^[A-Z0-9]{18,52}$')
      )
    )
  ),
  'field_dictionary', jsonb_build_array(
    jsonb_build_object('field_code','uti','esma_ref','2.1','field_name','Unique Transaction Identifier','data_type','string','required',true,'description','UTI assigned at execution per ISO 23897','asset_classes','ALL'),
    jsonb_build_object('field_code','prior_uti','esma_ref','2.2','field_name','Prior UTI','data_type','string','required',false,'description','Previous UTI in modification/compression chain','asset_classes','ALL'),
    jsonb_build_object('field_code','utr','esma_ref','2.3','field_name','Unique Trade Identifier (legacy USI/UTR)','data_type','string','required',false,'description','Legacy identifier where UTI not yet assigned','asset_classes','ALL'),
    jsonb_build_object('field_code','report_tracking_number','esma_ref','2.4','field_name','Report Tracking Number','data_type','string','required',false,'description','TR-assigned tracking ref','asset_classes','ALL'),
    jsonb_build_object('field_code','lei_reporting','esma_ref','1.3','field_name','Reporting Counterparty ID (LEI)','data_type','string','required',true,'description','LEI of reporting counterparty','asset_classes','ALL'),
    jsonb_build_object('field_code','lei_counterparty','esma_ref','1.4','field_name','Other Counterparty ID (LEI)','data_type','string','required',true,'description','LEI of other counterparty','asset_classes','ALL'),
    jsonb_build_object('field_code','counterparty_side','esma_ref','1.5','field_name','Counterparty Side','data_type','enum','required',true,'description','BUYR / SELL','asset_classes','ALL'),
    jsonb_build_object('field_code','action_type','esma_ref','2.5','field_name','Action Type','data_type','enum','required',true,'description','NEWT, MODI, CORR, TERM, EROR, REVI, VALU, MARU, COMP, POSC','asset_classes','ALL'),
    jsonb_build_object('field_code','event_type','esma_ref','2.6','field_name','Event Type','data_type','enum','required',true,'description','TRAD, NOVA, COMP, ETRM, INCP, UPDT, CORP, CLRG, EXER, ALOC, CREV, PTNG','asset_classes','ALL'),
    jsonb_build_object('field_code','event_date','esma_ref','2.7','field_name','Event Date','data_type','date','required',true,'description','Date of the action/event','asset_classes','ALL'),
    jsonb_build_object('field_code','execution_timestamp','esma_ref','2.8','field_name','Execution Timestamp','data_type','timestamp','required',true,'description','UTC execution time','asset_classes','ALL'),
    jsonb_build_object('field_code','effective_date','esma_ref','2.9','field_name','Effective Date','data_type','date','required',true,'description','Trade effective date','asset_classes','ALL'),
    jsonb_build_object('field_code','maturity_date','esma_ref','2.10','field_name','Maturity Date','data_type','date','required',true,'description','Maturity / termination date','asset_classes','ALL'),
    jsonb_build_object('field_code','asset_class','esma_ref','2.11','field_name','Asset Class','data_type','enum','required',true,'description','CR, CO, CU, EQ, IR','asset_classes','ALL'),
    jsonb_build_object('field_code','product_classification','esma_ref','2.12','field_name','Product Classification (CFI)','data_type','string','required',true,'description','ISO 10962 CFI code','asset_classes','ALL'),
    jsonb_build_object('field_code','product_identifier','esma_ref','2.13','field_name','Product Identifier (UPI/ISIN)','data_type','string','required',true,'description','UPI per ANNA DSB or ISIN','asset_classes','ALL'),
    jsonb_build_object('field_code','underlying_identifier','esma_ref','2.14','field_name','Underlying Identifier','data_type','string','required',false,'description','Underlying instrument ID','asset_classes','RATES,EQUITY,CREDIT'),
    jsonb_build_object('field_code','notional','esma_ref','2.15','field_name','Notional Amount Leg 1','data_type','number','required',true,'description','Initial notional','asset_classes','ALL'),
    jsonb_build_object('field_code','notional_currency','esma_ref','2.16','field_name','Notional Currency Leg 1','data_type','enum','required',true,'description','ISO 4217 currency code','asset_classes','ALL'),
    jsonb_build_object('field_code','notional_leg2','esma_ref','2.17','field_name','Notional Amount Leg 2','data_type','number','required',false,'description','Cross-currency / FX leg 2 notional','asset_classes','FX,RATES'),
    jsonb_build_object('field_code','notional_currency_leg2','esma_ref','2.18','field_name','Notional Currency Leg 2','data_type','enum','required',false,'description','ISO 4217 leg 2','asset_classes','FX,RATES'),
    jsonb_build_object('field_code','price','esma_ref','2.19','field_name','Price','data_type','number','required',true,'description','Traded price or rate','asset_classes','ALL'),
    jsonb_build_object('field_code','price_currency','esma_ref','2.20','field_name','Price Currency','data_type','enum','required',false,'description','ISO 4217','asset_classes','ALL'),
    jsonb_build_object('field_code','quantity','esma_ref','2.21','field_name','Quantity','data_type','number','required',false,'description','Number of units','asset_classes','EQUITY,COMMODITY'),
    jsonb_build_object('field_code','direction','esma_ref','2.22','field_name','Direction','data_type','enum','required',true,'description','MAKE/TAKE; payer/receiver','asset_classes','ALL'),
    jsonb_build_object('field_code','clearing_obligation','esma_ref','3.1','field_name','Clearing Obligation','data_type','boolean','required',true,'description','Subject to mandatory clearing','asset_classes','ALL'),
    jsonb_build_object('field_code','cleared','esma_ref','3.2','field_name','Cleared','data_type','boolean','required',true,'description','Trade has been cleared','asset_classes','ALL'),
    jsonb_build_object('field_code','ccp_lei','esma_ref','3.3','field_name','CCP LEI','data_type','string','required',false,'description','LEI of the CCP','asset_classes','ALL'),
    jsonb_build_object('field_code','intragroup','esma_ref','3.4','field_name','Intragroup','data_type','boolean','required',true,'description','Intragroup transaction flag','asset_classes','ALL'),
    jsonb_build_object('field_code','venue_of_execution','esma_ref','2.23','field_name','Venue of Execution','data_type','string','required',true,'description','MIC code or XOFF/XXXX','asset_classes','ALL'),
    jsonb_build_object('field_code','confirmation_means','esma_ref','3.5','field_name','Confirmation Means','data_type','enum','required',true,'description','Electronic, Non-electronic, Non-confirmed','asset_classes','ALL'),
    jsonb_build_object('field_code','confirmation_timestamp','esma_ref','3.6','field_name','Confirmation Timestamp','data_type','timestamp','required',false,'description','Time of trade confirmation','asset_classes','ALL'),
    jsonb_build_object('field_code','collateral_portfolio_code','esma_ref','4.1','field_name','Collateral Portfolio Code','data_type','string','required',false,'description','Portfolio code for margin','asset_classes','ALL'),
    jsonb_build_object('field_code','initial_margin_posted','esma_ref','4.2','field_name','Initial Margin Posted','data_type','number','required',false,'description','IM posted by reporting counterparty','asset_classes','ALL'),
    jsonb_build_object('field_code','variation_margin_posted','esma_ref','4.3','field_name','Variation Margin Posted','data_type','number','required',false,'description','VM posted','asset_classes','ALL'),
    jsonb_build_object('field_code','contract_valuation','esma_ref','4.4','field_name','Contract Valuation Amount','data_type','number','required',true,'description','MtM valuation','asset_classes','ALL'),
    jsonb_build_object('field_code','valuation_timestamp','esma_ref','4.5','field_name','Valuation Timestamp','data_type','timestamp','required',true,'description','Valuation time UTC','asset_classes','ALL'),
    jsonb_build_object('field_code','valuation_type','esma_ref','4.6','field_name','Valuation Type','data_type','enum','required',true,'description','Mark-to-market or Mark-to-model','asset_classes','ALL'),
    jsonb_build_object('field_code','delta','esma_ref','5.1','field_name','Delta','data_type','number','required',false,'description','Options delta','asset_classes','EQUITY,RATES,FX'),
    jsonb_build_object('field_code','option_type','esma_ref','5.2','field_name','Option Type','data_type','enum','required',false,'description','PUT/CALL','asset_classes','EQUITY,RATES,FX'),
    jsonb_build_object('field_code','strike_price','esma_ref','5.3','field_name','Strike Price','data_type','number','required',false,'description','Option strike','asset_classes','EQUITY,RATES,FX'),
    jsonb_build_object('field_code','exercise_style','esma_ref','5.4','field_name','Exercise Style','data_type','enum','required',false,'description','EURO/AMER/BERM/ASIA','asset_classes','EQUITY,RATES,FX')
  )
), updated_at = now()
WHERE code = 'emir-eu-1';
