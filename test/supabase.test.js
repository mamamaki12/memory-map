import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// A small stand-in for the parts of Supabase the SQL relies on: roles, auth.uid() and the storage schema.
const supabase = `
create role anon nologin; create role authenticated nologin;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
create schema auth; create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated;
create schema storage;
create table storage.buckets (id text primary key, name text not null, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text, unique (bucket_id, name));
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
grant usage on schema storage to anon, authenticated; grant all on storage.objects to anon, authenticated;`;
const sql = name => readFile(new URL('../supabase/' + name, import.meta.url), 'utf8');
const db = new PGlite();
await db.exec(supabase);
await db.exec(await sql('setup.sql'));
const update = await sql('002_security_update.sql');
await db.exec(update);
await db.exec(update); // safe to run again

async function as(uid, text, params = []) {
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [uid ?? '']);
    await db.exec(uid ? 'set local role authenticated' : 'set local role anon');
    const { rows, affectedRows } = await db.query(text, params);
    await db.exec('commit');
    return { rows, affected: affectedRows };
  } catch (error) { await db.exec('rollback'); return { error: error.message }; }
}
const user = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const [A, B, C] = [user(1), user(2), user(3)];
for (const id of [A, B, C]) { await db.query('insert into auth.users values ($1)', [id]); await as(id, 'select public.ensure_memory_profile()'); }
await as(A, "select public.rename_memory_profile('あきら')");
const codeOf = async id => (await as(id, 'select friend_code from public.ensure_memory_profile()')).rows[0].friend_code;
const share = (owner, id) => as(owner, `insert into public.memory_shared_photos(id, owner, local_id, object_path, caption, lat, lng, captured_at)
  values ($1::uuid, $2::uuid, $1::text, $2::text || '/' || $1::text || '.jpg', '', 31, 130, now())`, [id, owner]);
const upload = (owner, path) => as(owner, "insert into storage.objects(bucket_id, name) values ('memory-photos', $1)", [path]);

test('requests show the sender name but never other people\'s friend codes', async () => {
  await as(A, 'select public.request_memory_friend($1)', [await codeOf(B)]);
  assert.deepEqual((await as(B, 'select display_name from public.memory_profiles where id = $1', [A])).rows, [{ display_name: 'あきら' }]);
  assert.match((await as(B, 'select friend_code from public.memory_profiles where id = $1', [A])).error, /permission denied/);
  assert.deepEqual((await as(C, 'select id from public.memory_profiles where id <> $1', [C])).rows, []);
  assert.match((await as(null, 'select id from public.memory_profiles')).error, /permission denied/);
});
test('only the recipient can accept, and nobody can write friendships directly', async () => {
  const [{ id }] = (await as(A, 'select id from public.memory_friendships')).rows;
  assert.match((await as(A, 'select public.accept_memory_friend($1)', [id])).error, /承認できる申請がありません/);
  assert.match((await as(C, 'select public.accept_memory_friend($1)', [id])).error, /承認できる申請がありません/);
  assert.match((await as(C, 'select public.remove_memory_friend($1)', [id])).error, /対象の友達・申請がありません/);
  assert.match((await as(C, "insert into public.memory_friendships(requester, recipient, status) values ($1, $2, 'accepted')", [C, A])).error, /permission denied/);
  assert.equal((await as(B, 'select public.accept_memory_friend($1)', [id])).error, undefined);
});
test('a new friend code replaces the old one', async () => {
  const old = await codeOf(C);
  await as(C, 'select public.regenerate_memory_friend_code()');
  assert.match((await as(B, 'select public.request_memory_friend($1)', [old])).error, /友達コードが見つかりません/);
  assert.notEqual(await codeOf(C), old);
});
test('images can only follow the owner\'s own share, and only friends can read them', async () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const path = A + '/' + id + '.jpg';
  assert.match((await upload(A, path)).error, /row-level security/);
  assert.equal((await share(A, id)).affected, 1);
  assert.equal((await upload(A, path)).affected, 1);
  assert.match((await upload(A, A + '/unrelated.jpg')).error, /row-level security/);
  assert.match((await upload(C, A + '/' + id + '-copy.jpg')).error, /row-level security/);
  assert.equal((await as(C, 'delete from storage.objects where name = $1', [path])).affected, 0);
  assert.equal((await as(B, 'select name from storage.objects')).rows.length, 1);
  assert.equal((await as(C, 'select name from storage.objects')).rows.length, 0);
  assert.equal((await as(C, 'select id from public.memory_shared_photos')).rows.length, 0);
  assert.match((await as(C, `insert into public.memory_shared_photos(id, owner, local_id, object_path, caption, lat, lng, captured_at)
    values (gen_random_uuid(), $1, 'x', $2, '', 0, 0, now())`, [C, path])).error, /check constraint/);
});
test('sharing and pending requests have per-person limits', async () => {
  const many = await as(C, `insert into public.memory_shared_photos(id, owner, local_id, object_path, caption, lat, lng, captured_at)
    select g, $1::uuid, g::text, $1::text || '/' || g || '.jpg', '', 0, 0, now() from (select gen_random_uuid() g from generate_series(1, 300)) s`, [C]);
  assert.equal(many.affected, 300);
  assert.match((await share(C, '22222222-2222-4222-8222-222222222222')).error, /300枚まで/);
  const results = [];
  for (let n = 10; n < 31; n++) {
    await db.query('insert into auth.users values ($1)', [user(n)]);
    await as(user(n), 'select public.ensure_memory_profile()');
    results.push((await as(C, 'select public.request_memory_friend($1)', [await codeOf(user(n))])).error ?? 'sent');
  }
  assert.equal(results.filter(r => r === 'sent').length, 20);
  assert.match(results.at(-1), /承認待ちの申請が多すぎます/);
});
