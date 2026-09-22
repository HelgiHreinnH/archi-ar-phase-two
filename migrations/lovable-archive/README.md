# Lovable-era migrations (archived 22 Sep 2026)

These 13 files were written by Lovable against the Lovable Cloud project
`hjaqqfuebfpxpbyldcso` between Feb and Jul 2026. They are kept for history only.

They are deliberately **outside `supabase/migrations/`**. The Supabase GitHub
integration applies everything it finds there, and none of these versions are in
the ledger of our own project (`njrytsladmfhbttsitmn`) — whose applied history
starts at `20260917172144`. Nine of them contain unguarded `CREATE` statements,
starting with `CREATE TABLE public.profiles`, so an attempted apply would fail on
the first statement or leave the schema half-built.

The files in `supabase/migrations/` now mirror the applied ledger exactly.
