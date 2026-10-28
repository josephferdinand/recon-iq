-- Sequence values are allocated before an insert waits on audit_chain_head.
-- A valid committed parent may therefore have a numerically higher ID than
-- its child. Parent validity is hash-based, not sequence-order-based.
do $migration$
declare
  function_name text;
  function_ddl text;
  fixed_ddl text;
begin
  foreach function_name in array array[
    'public.verify_audit_chain(integer)',
    'public.audit_chain_integrity_status(integer)'
  ] loop
    select pg_get_functiondef(function_name::regprocedure) into function_ddl;
    fixed_ddl := replace(function_ddl, 'p.id < r.id', 'p.id <> r.id');
    fixed_ddl := replace(fixed_ddl, 'p.id < b.id', 'p.id <> b.id');
    if fixed_ddl is distinct from function_ddl then
      execute fixed_ddl;
    elsif position('p.id <> r.id' in function_ddl) = 0
       and position('p.id <> b.id' in function_ddl) = 0 then
      raise exception 'Unexpected audit verifier definition for %', function_name;
    end if;
  end loop;
end
$migration$;
