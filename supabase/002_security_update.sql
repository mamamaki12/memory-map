-- 2026-11 更新（setup.sql の続き）
-- setup.sql を実行したあと、Supabase の SQL Editor でこのファイルを一度実行します。
-- もう一度実行しても同じ状態になります。setup.sql は書き換えずに、このファイルで直します。
begin;

-- 1) 申請相手・友達の名前が読めなかった問題を直す。
--    以前の条件の id は友達関係の行の id を指していたため、自分以外の名前が一切見えなかった。
drop policy if exists memory_profile_read on public.memory_profiles;
create policy memory_profile_read on public.memory_profiles for select to authenticated using (
  id = (select auth.uid()) or exists (
    select 1 from public.memory_friendships f
    where (select auth.uid()) in (f.requester, f.recipient)
      and memory_profiles.id in (f.requester, f.recipient)
  )
);

-- 2) 友達コードは本人だけが読める。ほかの人に見えるのは id と表示名だけ。
--    自分のコードは ensure_memory_profile() で受け取る。
revoke select on public.memory_profiles from authenticated;
grant select (id, display_name) on public.memory_profiles to authenticated;

-- 3) 知らない人から申請が続くときのために、自分の友達コードを作り直せるようにする。
create or replace function public.regenerate_memory_friend_code() returns uuid
language plpgsql security definer set search_path = '' as $$
declare next_code uuid := gen_random_uuid();
begin
  if auth.uid() is null then raise exception 'ログインしてください'; end if;
  update public.memory_profiles set friend_code = next_code where id = auth.uid();
  if not found then raise exception 'プロフィールがありません。画面を再読み込みしてください'; end if;
  return next_code;
end $$;
revoke all on function public.regenerate_memory_friend_code() from public, anon;
grant execute on function public.regenerate_memory_friend_code() to authenticated;

-- 4) 申請の送りすぎを防ぐ（承認待ちの申請は 1 人 20 件まで）。
create or replace function public.request_memory_friend(code text) returns void
language plpgsql security definer set search_path = '' as $$
declare other uuid;
begin
  if auth.uid() is null then raise exception 'ログインしてください'; end if;
  if (select count(*) from public.memory_friendships where requester = auth.uid() and status = 'pending') >= 20 then
    raise exception '承認待ちの申請が多すぎます。承認されるか、申請を取り消してから送ってください';
  end if;
  select id into other from public.memory_profiles where friend_code::text=lower(trim(code));
  if other is null then raise exception '友達コードが見つかりません'; end if;
  if other=auth.uid() then raise exception '自分のコードは追加できません'; end if;
  insert into public.memory_friendships(requester,recipient) values(auth.uid(),other);
exception when unique_violation then raise exception '申請済み、または既に友達です';
end $$;

-- 5) 共有できる写真は 1 人 300 枚まで。
create or replace function public.memory_shared_photo_limit() returns trigger
language plpgsql set search_path = '' as $$
begin
  -- 同じ人の同時の共有を順番に処理して、上限をすり抜けられないようにする。
  perform pg_advisory_xact_lock(hashtext('memory_shared_photos:' || new.owner::text));
  if (select count(*) from public.memory_shared_photos where owner = new.owner) >= 300 then
    raise exception '共有できる写真は300枚までです。ほかの写真の共有を停止してから追加してください';
  end if;
  return new;
end $$;
revoke all on function public.memory_shared_photo_limit() from public, anon, authenticated;
drop trigger if exists memory_shared_photo_limit on public.memory_shared_photos;
create trigger memory_shared_photo_limit before insert on public.memory_shared_photos
  for each row execute function public.memory_shared_photo_limit();

-- 6) 画像は、先に作った自分の共有記録と同じ場所にだけ置ける。
--    以前はログインした人なら誰でも、共有と関係のないファイルを無制限に置けた。
drop policy if exists memory_storage_insert on storage.objects;
create policy memory_storage_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'memory-photos'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1 from public.memory_shared_photos p
    where p.object_path = objects.name and p.owner = (select auth.uid())
  )
);

commit;
