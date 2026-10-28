-- Keep primary-database PL/pgSQL validation reproducible. The extension is
-- diagnostic only and is installed in the existing non-exposed extensions schema.

CREATE EXTENSION IF NOT EXISTS plpgsql_check WITH SCHEMA extensions;
