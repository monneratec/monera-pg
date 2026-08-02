# Monera PostgreSQL Mongoose Adapter

This internal package preserves the Mongoose model and query surface used by
Monera services while persisting documents in Supabase PostgreSQL.

Required environment:

```text
SUPABASE_DB_URL=postgresql://...
PG_DOCUMENT_NAMESPACE=hyperx_auth
```

The database must include the `public.monera_documents` migration.
# monera-pg
