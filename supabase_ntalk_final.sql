
create extension if not exists pgcrypto with schema extensions;

alter table public.profiles add column if not exists full_name text;
alter table public.profiles add column if not exists needs_setup boolean not null default false;
update public.profiles set full_name = coalesce(full_name, display_name, username) where full_name is null;

alter table public.chats add column if not exists is_group boolean not null default false;
update public.chats set is_group = true where chat_type = 'group' and is_group = false;

do $$
declare r record;
begin
  for r in
    select c.conname, c.conrelid::regclass as tbl
    from pg_constraint c
    where c.contype = 'c'
      and c.conrelid in ('public.chats'::regclass, 'public.messages'::regclass)
      and (pg_get_constraintdef(c.oid) ilike '%chat_type%' or pg_get_constraintdef(c.oid) ilike '%message_type%')
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
  end loop;
end $$;
alter table public.chats    add constraint chats_chat_type_check check (chat_type in ('private','group'));
alter table public.messages add constraint messages_type_check   check (message_type in ('text','image','video','audio','file'));

do $$ begin
  create unique index if not exists profiles_username_lower_key on public.profiles (lower(username));
exception when others then raise notice 'username unique index skipped: %', sqlerrm; end $$;
do $$ begin
  create unique index if not exists chat_members_chat_user_key on public.chat_members (chat_id, user_id);
exception when others then raise notice 'chat_members unique index skipped: %', sqlerrm; end $$;
create index if not exists messages_chat_created_idx on public.messages (chat_id, created_at);
create index if not exists chat_members_user_idx on public.chat_members (user_id);

create table if not exists public.call_logs (
  id uuid primary key default gen_random_uuid(),
  caller_id uuid not null references auth.users(id) on delete cascade,
  callee_id uuid references auth.users(id) on delete set null,
  chat_id uuid references public.chats(id) on delete set null,
  is_group boolean not null default false,
  call_type text not null default 'voice',
  status text not null default 'missed',
  started_at timestamptz not null default now(),
  answered_at timestamptz,
  duration_seconds integer not null default 0
);
create index if not exists call_logs_caller_idx on public.call_logs (caller_id, started_at desc);
create index if not exists call_logs_callee_idx on public.call_logs (callee_id, started_at desc);

create table if not exists public.contact_names (
  owner_id uuid not null references auth.users(id) on delete cascade,
  target_id uuid not null references auth.users(id) on delete cascade,
  nickname text not null,
  updated_at timestamptz not null default now(),
  primary key (owner_id, target_id)
);

create table if not exists public.secret_chats (
  owner_id uuid not null references auth.users(id) on delete cascade,
  chat_id uuid not null references public.chats(id) on delete cascade,
  primary key (owner_id, chat_id)
);
create table if not exists public.secret_pins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  pin_hash text not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.user_privacy (
  user_id uuid primary key references auth.users(id) on delete cascade,
  share_last_seen boolean not null default true,
  last_seen_at timestamptz
);

create table if not exists public.statuses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('text','image','video')),
  media_path text,
  text_content text,
  bg_color text,
  caption text,
  duration_seconds numeric,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours')
);
create index if not exists statuses_user_idx on public.statuses (user_id, created_at);
create index if not exists statuses_expires_idx on public.statuses (expires_at);

create table if not exists public.status_views (
  status_id uuid not null references public.statuses(id) on delete cascade,
  viewer_id uuid not null references auth.users(id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key (status_id, viewer_id)
);

create table if not exists public.notes (
  user_id uuid primary key references auth.users(id) on delete cascade,
  body text,
  audio_path text,
  audio_title text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours')
);

create table if not exists public.shorts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  video_path text not null,
  caption text,
  created_at timestamptz not null default now()
);
create index if not exists shorts_created_idx on public.shorts (created_at desc);

create table if not exists public.short_likes (
  short_id uuid not null references public.shorts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (short_id, user_id)
);

create table if not exists public.short_comments (
  id uuid primary key default gen_random_uuid(),
  short_id uuid not null references public.shorts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 300),
  created_at timestamptz not null default now()
);
create index if not exists short_comments_short_idx on public.short_comments (short_id, created_at);

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

create or replace function public.is_chat_member(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.chat_members where chat_id = cid and user_id = auth.uid());
$$;

create or replace function public.shares_chat_with(other uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select other = auth.uid() or exists (
    select 1 from public.chat_members a
    join public.chat_members b on a.chat_id = b.chat_id
    where a.user_id = auth.uid() and b.user_id = other);
$$;

create or replace function public.profiles_sync_names()
returns trigger language plpgsql as $$
begin
  if new.full_name is not null and btrim(new.full_name) <> '' then
    new.display_name := new.full_name;
  elsif new.display_name is not null then
    new.full_name := new.display_name;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists profiles_sync_names on public.profiles;
create trigger profiles_sync_names before insert or update on public.profiles
  for each row execute function public.profiles_sync_names();

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  nm text; base text; uname text; n int := 0; setup boolean;
begin
  nm := coalesce(nullif(new.raw_user_meta_data->>'full_name',''),
                 nullif(new.raw_user_meta_data->>'display_name',''),
                 nullif(new.raw_user_meta_data->>'name',''),
                 split_part(new.email,'@',1), 'NTalk User');
  base := lower(regexp_replace(coalesce(nullif(new.raw_user_meta_data->>'username',''), split_part(coalesce(new.email,''),'@',1)),
                               '[^a-zA-Z0-9_.]', '', 'g'));
  if length(base) < 3 then base := 'user' || substr(replace(new.id::text,'-',''),1,6); end if;
  base := left(base, 20);
  setup := coalesce(new.raw_user_meta_data->>'username','') = '';
  uname := base;
  while exists (select 1 from public.profiles where lower(username) = uname) loop
    n := n + 1; uname := base || n::text;
  end loop;
  insert into public.profiles (id, username, full_name, display_name, avatar_url, needs_setup)
  values (new.id, uname, nm, nm, new.raw_user_meta_data->>'avatar_url', setup)
  on conflict (id) do nothing;
  return new;
end $$;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'on_auth_user_created' and tgrelid = 'auth.users'::regclass) then
    create trigger on_auth_user_created after insert on auth.users
      for each row execute function public.handle_new_user();
  end if;
end $$;

create or replace function public.messages_guard_update()
returns trigger language plpgsql as $$
begin
  if auth.uid() is not null and old.sender_id is distinct from auth.uid() then
    if (to_jsonb(new) - 'delivered_at' - 'seen_at') is distinct from (to_jsonb(old) - 'delivered_at' - 'seen_at') then
      raise exception 'Only delivery/seen status can be changed on messages from others';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists messages_guard_update on public.messages;
create trigger messages_guard_update before update on public.messages
  for each row execute function public.messages_guard_update();

create or replace function public.username_available(u text)
returns boolean language sql stable security definer set search_path = public as $$
  select not exists (select 1 from public.profiles where lower(username) = lower(btrim(u)));
$$;

create or replace function public.search_profiles(q text)
returns table (id uuid, username text, full_name text, avatar_url text)
language sql stable security definer set search_path = public as $$
  with t as (select replace(replace(replace(btrim(q), '\', '\\'), '%', '\%'), '_', '\_') as s)
  select p.id, p.username, coalesce(p.full_name, p.display_name), p.avatar_url
  from public.profiles p, t
  where auth.uid() is not null
    and p.id <> auth.uid()
    and length(btrim(q)) >= 2
    and (p.username ilike t.s || '%' or coalesce(p.full_name, p.display_name, '') ilike '%' || t.s || '%')
  order by p.username
  limit 20;
$$;

create or replace function public.get_or_create_private_chat(other_user uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); cid uuid;
begin
  if me is null then raise exception 'not authenticated'; end if;
  if other_user is null or other_user = me then raise exception 'invalid user'; end if;
  if not exists (select 1 from public.profiles where id = other_user) then raise exception 'user not found'; end if;

  select c.id into cid
  from public.chats c
  where c.is_group = false
    and exists (select 1 from public.chat_members m where m.chat_id = c.id and m.user_id = me)
    and exists (select 1 from public.chat_members m where m.chat_id = c.id and m.user_id = other_user)
  order by c.created_at
  limit 1;

  if cid is null then
    insert into public.chats (chat_type, is_group, created_by) values ('private', false, me) returning id into cid;
    insert into public.chat_members (chat_id, user_id) values (cid, me), (cid, other_user);
  end if;
  return cid;
end $$;

create or replace function public.get_or_create_direct_chat(other_user_id uuid)
returns uuid language sql security definer set search_path = public as $$
  select public.get_or_create_private_chat(other_user_id);
$$;

create or replace function public.my_chats()
returns table (chat_id uuid, other_user_id uuid)
language sql stable security definer set search_path = public as $$
  select c.id, o.user_id
  from public.chats c
  join public.chat_members m on m.chat_id = c.id and m.user_id = auth.uid()
  join public.chat_members o on o.chat_id = c.id and o.user_id <> auth.uid()
  where c.is_group = false;
$$;

create or replace function public.my_groups()
returns table (chat_id uuid, name text, member_count integer, created_by uuid)
language sql stable security definer set search_path = public as $$
  select c.id, c.name,
         (select count(*)::int from public.chat_members x where x.chat_id = c.id),
         c.created_by
  from public.chats c
  join public.chat_members m on m.chat_id = c.id and m.user_id = auth.uid()
  where c.is_group = true;
$$;

create or replace function public.group_members(cid uuid)
returns table (user_id uuid, full_name text, username text, avatar_url text)
language sql stable security definer set search_path = public as $$
  select p.id, coalesce(p.full_name, p.display_name), p.username, p.avatar_url
  from public.chat_members m
  join public.profiles p on p.id = m.user_id
  where m.chat_id = cid
    and exists (select 1 from public.chat_members me where me.chat_id = cid and me.user_id = auth.uid())
  order by m.joined_at;
$$;

create or replace function public.create_group(group_name text, member_ids uuid[])
returns uuid language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); gid uuid; nm text := btrim(coalesce(group_name, ''));
begin
  if me is null then raise exception 'not authenticated'; end if;
  if nm = '' then raise exception 'Group name required'; end if;
  if coalesce(array_length(member_ids, 1), 0) > 255 then raise exception 'Too many members'; end if;
  insert into public.chats (chat_type, is_group, name, created_by) values ('group', true, left(nm, 60), me) returning id into gid;
  insert into public.chat_members (chat_id, user_id, is_admin) values (gid, me, true);
  insert into public.chat_members (chat_id, user_id)
    select gid, p.id from public.profiles p where p.id = any(member_ids) and p.id <> me
    on conflict do nothing;
  return gid;
end $$;

create or replace function public.add_group_members(cid uuid, member_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.chats where id = cid and is_group = true and created_by = auth.uid())
  then raise exception 'Only the group admin can add members'; end if;
  insert into public.chat_members (chat_id, user_id)
    select cid, p.id from public.profiles p where p.id = any(member_ids)
    on conflict do nothing;
end $$;

create or replace function public.remove_group_member(cid uuid, member uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.chats where id = cid and is_group = true and created_by = auth.uid())
  then raise exception 'Only the group admin can remove members'; end if;
  if member = auth.uid() then raise exception 'Use Leave group instead'; end if;
  delete from public.chat_members where chat_id = cid and user_id = member;
end $$;

create or replace function public.rename_group(cid uuid, new_name text)
returns void language plpgsql security definer set search_path = public as $$
declare nm text := btrim(coalesce(new_name, ''));
begin
  if nm = '' then raise exception 'Group name required'; end if;
  if not exists (select 1 from public.chats where id = cid and is_group = true and created_by = auth.uid())
  then raise exception 'Only the group admin can rename the group'; end if;
  update public.chats set name = left(nm, 60) where id = cid;
end $$;

create or replace function public.leave_group(cid uuid)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); nxt uuid;
begin
  if not exists (select 1 from public.chats where id = cid and is_group = true) then raise exception 'Not a group'; end if;
  delete from public.chat_members where chat_id = cid and user_id = me;
  if exists (select 1 from public.chats where id = cid and created_by = me) then
    select user_id into nxt from public.chat_members where chat_id = cid order by joined_at limit 1;
    if nxt is null then
      delete from public.messages where chat_id = cid;
      delete from public.chats where id = cid;
    else
      update public.chats set created_by = nxt where id = cid;
      update public.chat_members set is_admin = true where chat_id = cid and user_id = nxt;
    end if;
  end if;
end $$;

create or replace function public.touch_last_seen()
returns void language sql security definer set search_path = public as $$
  insert into public.user_privacy (user_id, last_seen_at) values (auth.uid(), now())
  on conflict (user_id) do update set last_seen_at = now();
$$;

create or replace function public.set_share_last_seen(share boolean)
returns void language sql security definer set search_path = public as $$
  insert into public.user_privacy (user_id, share_last_seen) values (auth.uid(), share)
  on conflict (user_id) do update set share_last_seen = excluded.share_last_seen;
$$;

create or replace function public.get_last_seen(target uuid)
returns timestamptz language sql stable security definer set search_path = public as $$
  select t.last_seen_at
  from public.user_privacy t
  where t.user_id = target
    and t.share_last_seen
    and coalesce((select m.share_last_seen from public.user_privacy m where m.user_id = auth.uid()), true);
$$;

create or replace function public.secret_has_pin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.secret_pins where user_id = auth.uid());
$$;

create or replace function public.secret_verify(pin text)
returns boolean language sql stable security definer set search_path = public, extensions as $$
  select exists (select 1 from public.secret_pins
                 where user_id = auth.uid() and pin_hash = extensions.crypt(pin, pin_hash));
$$;

create or replace function public.secret_set_pin(new_pin text, old_pin text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'not authenticated'; end if;
  if new_pin is null or char_length(new_pin) < 4 or char_length(new_pin) > 32 then
    raise exception 'Password must be 4 to 32 characters';
  end if;
  if exists (select 1 from public.secret_pins where user_id = me) then
    if old_pin is null or not exists (select 1 from public.secret_pins where user_id = me and pin_hash = extensions.crypt(old_pin, pin_hash)) then
      raise exception 'Current password is wrong';
    end if;
  end if;
  insert into public.secret_pins (user_id, pin_hash) values (me, extensions.crypt(new_pin, extensions.gen_salt('bf')))
  on conflict (user_id) do update set pin_hash = excluded.pin_hash, updated_at = now();
end $$;

create or replace function public.secret_reset()
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.secret_pins where user_id = auth.uid();
  delete from public.secret_chats where owner_id = auth.uid();
end $$;

create or replace function public.set_note(p_body text, p_audio_path text, p_audio_title text)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); b text := nullif(btrim(coalesce(p_body, '')), '');
begin
  if me is null then raise exception 'not authenticated'; end if;
  if b is null and p_audio_path is null then raise exception 'Write something or add a song'; end if;
  if p_audio_path is not null and split_part(p_audio_path, '/', 1) <> me::text then raise exception 'Invalid audio path'; end if;
  insert into public.notes (user_id, body, audio_path, audio_title, created_at, expires_at)
  values (me, left(b, 60), p_audio_path, left(p_audio_title, 40), now(), now() + interval '24 hours')
  on conflict (user_id) do update
    set body = excluded.body, audio_path = excluded.audio_path, audio_title = excluded.audio_title,
        created_at = now(), expires_at = now() + interval '24 hours';
end $$;

create or replace function public.shorts_feed(p_limit integer default 8, p_before timestamptz default null)
returns table (id uuid, user_id uuid, video_path text, caption text, created_at timestamptz,
               full_name text, username text, avatar_url text, likes integer, comments integer, liked boolean)
language sql stable security definer set search_path = public as $$
  select s.id, s.user_id, s.video_path, s.caption, s.created_at,
         coalesce(p.full_name, p.display_name), p.username, p.avatar_url,
         (select count(*)::int from public.short_likes l where l.short_id = s.id),
         (select count(*)::int from public.short_comments c where c.short_id = s.id),
         exists (select 1 from public.short_likes l where l.short_id = s.id and l.user_id = auth.uid())
  from public.shorts s
  join public.profiles p on p.id = s.user_id
  where auth.uid() is not null
    and (p_before is null or s.created_at < p_before)
  order by s.created_at desc
  limit least(greatest(coalesce(p_limit, 8), 1), 30);
$$;

create or replace function public.short_comments_list(p_short uuid)
returns table (id uuid, user_id uuid, body text, created_at timestamptz,
               full_name text, username text, avatar_url text)
language sql stable security definer set search_path = public as $$
  select c.id, c.user_id, c.body, c.created_at,
         coalesce(p.full_name, p.display_name), p.username, p.avatar_url
  from public.short_comments c
  join public.profiles p on p.id = c.user_id
  where auth.uid() is not null and c.short_id = p_short
  order by c.created_at;
$$;

create or replace function public.register_push(p_endpoint text, p_p256dh text, p_auth text)
returns void language sql security definer set search_path = public as $$
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do update set user_id = auth.uid(), p256dh = excluded.p256dh, auth = excluded.auth;
$$;

create or replace function public.unregister_push(p_endpoint text)
returns void language sql security definer set search_path = public as $$
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
$$;

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('is_chat_member','shares_chat_with','search_profiles','get_or_create_private_chat',
        'get_or_create_direct_chat','my_chats','my_groups','group_members','create_group','add_group_members',
        'remove_group_member','rename_group','leave_group','touch_last_seen','set_share_last_seen','get_last_seen',
        'secret_has_pin','secret_verify','secret_set_pin','secret_reset','set_note','shorts_feed',
        'short_comments_list','register_push','unregister_push')
  loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
revoke all on function public.username_available(text) from public;
grant execute on function public.username_available(text) to anon, authenticated;

alter table public.profiles          enable row level security;
alter table public.chats             enable row level security;
alter table public.chat_members      enable row level security;
alter table public.messages          enable row level security;
alter table public.call_logs         enable row level security;
alter table public.contact_names     enable row level security;
alter table public.secret_chats      enable row level security;
alter table public.secret_pins       enable row level security;
alter table public.user_privacy      enable row level security;
alter table public.statuses          enable row level security;
alter table public.status_views      enable row level security;
alter table public.notes             enable row level security;
alter table public.shorts            enable row level security;
alter table public.short_likes       enable row level security;
alter table public.short_comments    enable row level security;
alter table public.push_subscriptions enable row level security;

drop policy if exists "Users can add themselves to chats" on public.chat_members;
drop policy if exists "Chat creators can add members" on public.chat_members;

drop policy if exists "Chat members can send messages" on public.messages;
create policy "Chat members can send messages" on public.messages
  for insert to authenticated
  with check (auth.uid() = sender_id and public.is_chat_member(chat_id));

drop policy if exists "Chat members can update delivery state" on public.messages;
create policy "Chat members can update delivery state" on public.messages
  for update to authenticated
  using (public.is_chat_member(chat_id))
  with check (public.is_chat_member(chat_id));

drop policy if exists "call_logs select" on public.call_logs;
create policy "call_logs select" on public.call_logs for select to authenticated
  using (caller_id = auth.uid() or callee_id = auth.uid()
         or (is_group and chat_id is not null and public.is_chat_member(chat_id)));
drop policy if exists "call_logs insert" on public.call_logs;
create policy "call_logs insert" on public.call_logs for insert to authenticated
  with check (caller_id = auth.uid());

drop policy if exists "contact_names own" on public.contact_names;
create policy "contact_names own" on public.contact_names for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "secret_chats own" on public.secret_chats;
create policy "secret_chats own" on public.secret_chats for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid() and public.is_chat_member(chat_id));

drop policy if exists "user_privacy own" on public.user_privacy;
create policy "user_privacy own" on public.user_privacy for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "statuses select" on public.statuses;
create policy "statuses select" on public.statuses for select to authenticated
  using (user_id = auth.uid() or (expires_at > now() and public.shares_chat_with(user_id)));
drop policy if exists "statuses insert" on public.statuses;
create policy "statuses insert" on public.statuses for insert to authenticated
  with check (user_id = auth.uid());
drop policy if exists "statuses delete" on public.statuses;
create policy "statuses delete" on public.statuses for delete to authenticated
  using (user_id = auth.uid());

drop policy if exists "status_views select" on public.status_views;
create policy "status_views select" on public.status_views for select to authenticated
  using (viewer_id = auth.uid()
         or exists (select 1 from public.statuses s where s.id = status_id and s.user_id = auth.uid()));
drop policy if exists "status_views insert" on public.status_views;
create policy "status_views insert" on public.status_views for insert to authenticated
  with check (viewer_id = auth.uid()
              and exists (select 1 from public.statuses s where s.id = status_id and public.shares_chat_with(s.user_id)));

drop policy if exists "notes select" on public.notes;
create policy "notes select" on public.notes for select to authenticated
  using (user_id = auth.uid() or (expires_at > now() and public.shares_chat_with(user_id)));
drop policy if exists "notes delete" on public.notes;
create policy "notes delete" on public.notes for delete to authenticated
  using (user_id = auth.uid());

drop policy if exists "shorts select" on public.shorts;
create policy "shorts select" on public.shorts for select to authenticated using (true);
drop policy if exists "shorts insert" on public.shorts;
create policy "shorts insert" on public.shorts for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "shorts delete" on public.shorts;
create policy "shorts delete" on public.shorts for delete to authenticated using (user_id = auth.uid());

drop policy if exists "short_likes select" on public.short_likes;
create policy "short_likes select" on public.short_likes for select to authenticated using (true);
drop policy if exists "short_likes insert" on public.short_likes;
create policy "short_likes insert" on public.short_likes for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "short_likes delete" on public.short_likes;
create policy "short_likes delete" on public.short_likes for delete to authenticated using (user_id = auth.uid());

drop policy if exists "short_comments select" on public.short_comments;
create policy "short_comments select" on public.short_comments for select to authenticated using (true);
drop policy if exists "short_comments insert" on public.short_comments;
create policy "short_comments insert" on public.short_comments for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "short_comments delete" on public.short_comments;
create policy "short_comments delete" on public.short_comments for delete to authenticated
  using (user_id = auth.uid()
         or exists (select 1 from public.shorts s where s.id = short_id and s.user_id = auth.uid()));

insert into storage.buckets (id, name, public, file_size_limit)
values ('ntalk-media', 'ntalk-media', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = 52428800;

insert into storage.buckets (id, name, public, file_size_limit)
values ('ntalk-avatars', 'ntalk-avatars', true, 2097152)
on conflict (id) do update set public = true, file_size_limit = 2097152;

drop policy if exists "ntalk-media upload own folder" on storage.objects;
create policy "ntalk-media upload own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'ntalk-media' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "ntalk-media read" on storage.objects;
create policy "ntalk-media read" on storage.objects for select to authenticated
  using (bucket_id = 'ntalk-media');
drop policy if exists "ntalk-media delete own" on storage.objects;
create policy "ntalk-media delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'ntalk-media' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "ntalk-avatars upload own folder" on storage.objects;
create policy "ntalk-avatars upload own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'ntalk-avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "ntalk-avatars read" on storage.objects;
create policy "ntalk-avatars read" on storage.objects for select to public
  using (bucket_id = 'ntalk-avatars');
drop policy if exists "ntalk-avatars update own" on storage.objects;
create policy "ntalk-avatars update own" on storage.objects for update to authenticated
  using (bucket_id = 'ntalk-avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "ntalk-avatars delete own" on storage.objects;
create policy "ntalk-avatars delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'ntalk-avatars' and (storage.foldername(name))[1] = auth.uid()::text);

alter table public.messages replica identity full;
do $$ begin
  begin alter publication supabase_realtime add table public.messages; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.statuses; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.notes;    exception when duplicate_object then null; end;
end $$;

select kind, name, status
from (
  select kind, name, case when found then 'ok' else 'MISSING' end as status from (
  select 'table' as kind, t as name, exists (select 1 from information_schema.tables where table_schema='public' and table_name=t) as found
  from unnest(array['profiles','chats','chat_members','messages','call_logs','contact_names','secret_chats','secret_pins',
                    'user_privacy','statuses','status_views','notes','shorts','short_likes','short_comments','push_subscriptions']) t
  union all
  select 'function', f, exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=f)
  from unnest(array['username_available','search_profiles','get_or_create_private_chat','my_chats','my_groups','group_members',
                    'create_group','add_group_members','remove_group_member','rename_group','leave_group','touch_last_seen',
                    'set_share_last_seen','get_last_seen','secret_has_pin','secret_verify','secret_set_pin','secret_reset',
                    'set_note','shorts_feed','short_comments_list','register_push','unregister_push']) f
  union all
  select 'column', c, exists (select 1 from information_schema.columns where table_schema='public' and table_name||'.'||column_name = c)
  from unnest(array['profiles.full_name','profiles.needs_setup','chats.is_group','messages.reply_to','messages.file_path',
                    'messages.mime_type','messages.seen_at']) c
  union all
  select 'bucket', b, exists (select 1 from storage.buckets where id = b) from unnest(array['ntalk-media','ntalk-avatars']) b
  union all
  select 'realtime', t, exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t)
  from unnest(array['messages','statuses','notes']) t
  union all
  select 'trigger', 'auth.users -> handle_new_user', exists (select 1 from pg_trigger where tgname='on_auth_user_created')
) y
) x
order by (status = 'ok'), kind, name;

