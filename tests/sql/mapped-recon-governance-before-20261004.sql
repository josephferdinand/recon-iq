SET ROLE authenticated;
SELECT qa.expect_error('PROD452 raw promotion preimage rejects mapped draft',
 $$SELECT public.submit_recon_definition_promotion('11111111-1111-1111-1111-111111111111','44444444-4444-4444-4444-444444444441','baseline defect')$$,'23514','only an editable non-production draft can be submitted');
RESET ROLE;
