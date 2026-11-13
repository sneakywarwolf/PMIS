-- Optional hardening: run PMIS as a database owner that is NOT a superuser.
-- Usage (see the Deployment guide):  docker compose exec -T -e APP_PW=... postgres psql -U pmis -d pmis -v ON_ERROR_STOP=1 -v app_pw="$APP_PW" -f - < restricted-user.sql
-- Safe to re-run. Creates the role, then moves ownership of everything PMIS created to it. The built-in admin user is left alone.
SELECT format('CREATE ROLE pmis_app LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION', :'app_pw')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pmis_app') \gexec
SELECT format('ALTER ROLE pmis_app PASSWORD %L', :'app_pw') \gexec

DO $$
DECLARE r record;
BEGIN
  EXECUTE format('ALTER DATABASE %I OWNER TO pmis_app', current_database());
  EXECUTE 'ALTER SCHEMA public OWNER TO pmis_app';
  FOR r IN SELECT c.relname, c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relkind IN ('r','p','S','v','m') AND pg_get_userbyid(c.relowner) <> 'pmis_app' LOOP
    EXECUTE format('ALTER %s public.%I OWNER TO pmis_app',
      CASE r.relkind WHEN 'S' THEN 'SEQUENCE' WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW' ELSE 'TABLE' END, r.relname);
  END LOOP;
  FOR r IN SELECT t.typname FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
           WHERE n.nspname = 'public' AND t.typtype = 'e' AND pg_get_userbyid(t.typowner) <> 'pmis_app' LOOP
    EXECUTE format('ALTER TYPE public.%I OWNER TO pmis_app', r.typname);
  END LOOP;
END $$;
