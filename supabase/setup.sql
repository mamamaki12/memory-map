-- Run once in your Supabase project's SQL Editor.
create table public.memory_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '名前未設定' check (length(display_name) between 1 and 30),
  friend_code uuid not null unique default gen_random_uuid()
);
create table public.memory_friendships (
  id uuid primary key default gen_random_uuid(),
  requester uuid not null references public.memory_profiles(id) on delete cascade,
  recipient uuid not null references public.memory_profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted')),
  created_at timestamptz not null default now(),
  check (requester <> recipient)
);
create unique index memory_friend_pair on public.memory_friendships (least(requester,recipient), greatest(requester,recipient));
create table public.memory_shared_photos (
  id uuid primary key,
  owner uuid not null references public.memory_profiles(id) on delete cascade,
  local_id text not null check (length(local_id) between 1 and 200),
  caption text not null default '' check (length(caption) <= 100),
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  captured_at timestamptz not null,
  object_path text not null unique,
  unique(owner,local_id),
  check (object_path = owner::text || '/' || id::text || '.jpg')
);
alter table public.memory_profiles enable row level security;
alter table public.memory_friendships enable row level security;
alter table public.memory_shared_photos enable row level security;
revoke all on public.memory_profiles, public.memory_friendships, public.memory_shared_photos from anon, authenticated;
grant select on public.memory_profiles, public.memory_friendships, public.memory_shared_photos to authenticated;
grant insert, delete on public.memory_shared_photos to authenticated;

create policy memory_friend_read on public.memory_friendships for select to authenticated using (auth.uid() in (requester, recipient));
create policy memory_profile_read on public.memory_profiles for select to authenticated using (
  id = auth.uid() or exists(select 1 from public.memory_friendships f where auth.uid() in (f.requester,f.recipient) and id in (f.requester,f.recipient))
);
create policy memory_photo_read on public.memory_shared_photos for select to authenticated using (
  owner = auth.uid() or exists(select 1 from public.memory_friendships f where f.status='accepted' and auth.uid() in (f.requester,f.recipient) and owner in (f.requester,f.recipient))
);
create policy memory_photo_insert on public.memory_shared_photos for insert to authenticated with check(owner=auth.uid());
create policy memory_photo_delete on public.memory_shared_photos for delete to authenticated using(owner=auth.uid());

create function public.ensure_memory_profile() returns public.memory_profiles
language plpgsql security definer set search_path = '' as $$
declare p public.memory_profiles;
begin
  if auth.uid() is null then raise exception 'ログインしてください'; end if;
  insert into public.memory_profiles(id) values(auth.uid()) on conflict(id) do nothing;
  select * into p from public.memory_profiles where id=auth.uid();
  return p;
end $$;
create function public.rename_memory_profile(new_name text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'ログインしてください'; end if;
  if length(trim(new_name)) not between 1 and 30 then raise exception '名前は1〜30文字です'; end if;
  update public.memory_profiles set display_name=trim(new_name) where id=auth.uid();
end $$;
create function public.request_memory_friend(code text) returns void
language plpgsql security definer set search_path = '' as $$
declare other uuid;
begin
  if auth.uid() is null then raise exception 'ログインしてください'; end if;
  select id into other from public.memory_profiles where friend_code::text=lower(trim(code));
  if other is null then raise exception '友達コードが見つかりません'; end if;
  if other=auth.uid() then raise exception '自分のコードは追加できません'; end if;
  insert into public.memory_friendships(requester,recipient) values(auth.uid(),other);
exception when unique_violation then raise exception '申請済み、または既に友達です';
end $$;
create function public.accept_memory_friend(request_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'ログインしてください'; end if;
  update public.memory_friendships set status='accepted' where id=request_id and recipient=auth.uid() and status='pending';
  if not found then raise exception '承認できる申請がありません'; end if;
end $$;
create function public.remove_memory_friend(request_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'ログインしてください'; end if;
  delete from public.memory_friendships where id=request_id and auth.uid() in (requester,recipient);
  if not found then raise exception '対象の友達・申請がありません'; end if;
end $$;
revoke all on function public.ensure_memory_profile(), public.rename_memory_profile(text), public.request_memory_friend(text), public.accept_memory_friend(uuid), public.remove_memory_friend(uuid) from public, anon;
grant execute on function public.ensure_memory_profile(), public.rename_memory_profile(text), public.request_memory_friend(text), public.accept_memory_friend(uuid), public.remove_memory_friend(uuid) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('memory-photos','memory-photos',false,10485760,array['image/jpeg','image/png','image/webp']);
create policy memory_storage_insert on storage.objects for insert to authenticated with check (
  bucket_id='memory-photos' and (storage.foldername(name))[1]=auth.uid()::text
);
create policy memory_storage_read on storage.objects for select to authenticated using (
  bucket_id='memory-photos' and (
    (storage.foldername(name))[1]=auth.uid()::text or exists (
      select 1 from public.memory_shared_photos p where p.object_path=name
    )
  )
);
create policy memory_storage_delete on storage.objects for delete to authenticated using (
  bucket_id='memory-photos' and (storage.foldername(name))[1]=auth.uid()::text
);
