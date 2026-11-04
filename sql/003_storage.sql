-- ─────────────────────────────────────────────────────────────
-- Cupcake Delight — 003_storage.sql
-- Storage bucket policies. Buckets themselves are created by
-- scripts/db-setup.js through the Storage API.
-- Idempotent: drop-then-create.
-- ─────────────────────────────────────────────────────────────

drop policy if exists "admin upload logo"      on storage.objects;
create policy "admin upload logo"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'logo');

drop policy if exists "admin upload hero"      on storage.objects;
create policy "admin upload hero"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'hero');

drop policy if exists "admin upload menu items" on storage.objects;
create policy "admin upload menu items"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'menu-items');

drop policy if exists "public read assets" on storage.objects;
create policy "public read assets"
  on storage.objects for select
  using (bucket_id in ('logo', 'hero', 'menu-items'));
