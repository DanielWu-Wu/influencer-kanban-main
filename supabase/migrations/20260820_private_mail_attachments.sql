-- Private temporary storage for Tencent Exmail attachments.
-- Objects are scoped by the first path segment: <auth.uid()>/<file>.

insert into storage.buckets (id, name, public, file_size_limit)
values ('mail-attachments-temp', 'mail-attachments-temp', false, 26214400)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit;

drop policy if exists "Users upload own temporary mail attachments" on storage.objects;
create policy "Users upload own temporary mail attachments"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'mail-attachments-temp'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "Users read own temporary mail attachments" on storage.objects;
create policy "Users read own temporary mail attachments"
on storage.objects for select
to authenticated
using (
  bucket_id = 'mail-attachments-temp'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "Users delete own temporary mail attachments" on storage.objects;
create policy "Users delete own temporary mail attachments"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'mail-attachments-temp'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
