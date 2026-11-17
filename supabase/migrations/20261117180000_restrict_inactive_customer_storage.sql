-- Keep access to other buckets governed by their existing policies.
create policy "inactive customer private storage access revoked"
on storage.objects as restrictive for all to authenticated
using (bucket_id <> 'customer-private' or private.is_active_user())
with check (bucket_id <> 'customer-private' or private.is_active_user());
