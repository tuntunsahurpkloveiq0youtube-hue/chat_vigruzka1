-- Выполните целиком в Supabase: SQL Editor -> New query -> Run
-- ВНИМАНИЕ: удаляет старые таблицы chats/messages (демо-данные первой версии).

drop table if exists public.messages     cascade;
drop table if exists public.chat_members cascade;
drop table if exists public.chats        cascade;
drop table if exists public.profiles     cascade;

/* ---------- аккаунты ---------- */
create table public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  username   text not null unique check (username ~ '^[a-z0-9_]{3,20}$'),
  created_at timestamptz not null default now()
);

-- при регистрации автоматически создаём профиль с логином
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, username)
  values (new.id, lower(coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1))));
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

/* ---------- чаты ---------- */
create table public.chats (
  id         bigint generated always as identity primary key,
  name       text not null check (char_length(name) between 1 and 60),
  hue        int  not null default 200,
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.chat_members (
  chat_id      bigint not null references public.chats(id)    on delete cascade,
  user_id      uuid   not null references public.profiles(id) on delete cascade,
  star         boolean not null default false,   -- избранное (у каждого своё)
  arch         boolean not null default false,   -- архив (у каждого свой)
  last_read_at timestamptz not null default now(),
  primary key (chat_id, user_id)
);
create index on public.chat_members (user_id);

create table public.messages (
  id           bigint generated always as identity primary key,
  chat_id      bigint not null references public.chats(id) on delete cascade,
  user_id      uuid   not null default auth.uid() references public.profiles(id),
  kind         text   not null check (kind in ('text','file','table')),
  title        text,
  body         text,
  file_name    text,
  file_size    bigint,
  file_type    text,
  storage_path text,
  cols         jsonb,
  rows         jsonb,
  dump         boolean not null default false,
  created_at   timestamptz not null default now()
);
create index on public.messages (chat_id, created_at);

/* ---------- доступ ---------- */
create or replace function public.is_member(p_chat bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.chat_members where chat_id = p_chat and user_id = auth.uid()
  );
$$;

alter table public.profiles     enable row level security;
alter table public.chats        enable row level security;
alter table public.chat_members enable row level security;
alter table public.messages     enable row level security;

create policy "profiles: видят вошедшие" on public.profiles
  for select to authenticated using (true);

create policy "chats: видят участники" on public.chats
  for select to authenticated using (public.is_member(id));

create policy "members: видят участники чата" on public.chat_members
  for select to authenticated using (public.is_member(chat_id));
create policy "members: менять свои настройки" on public.chat_members
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
-- менять можно только эти поля (нельзя «перепрыгнуть» в чужой чат)
revoke update on public.chat_members from authenticated;
grant  update (star, arch, last_read_at) on public.chat_members to authenticated;

create policy "messages: читают участники" on public.messages
  for select to authenticated using (public.is_member(chat_id));
create policy "messages: пишут участники" on public.messages
  for insert to authenticated with check (public.is_member(chat_id) and user_id = auth.uid());
create policy "messages: очищают участники" on public.messages
  for delete to authenticated using (public.is_member(chat_id));

/* ---------- функции: создать чат, добавить человека ---------- */
create or replace function public.create_chat(p_name text, p_usernames text[] default '{}')
returns bigint language plpgsql security definer set search_path = public as $$
declare cid bigint;
begin
  if auth.uid() is null then raise exception 'Нужно войти'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Нужно название чата'; end if;
  insert into chats (name, hue, created_by)
    values (left(trim(p_name), 60), floor(random() * 360)::int, auth.uid())
    returning id into cid;
  insert into chat_members (chat_id, user_id) values (cid, auth.uid());
  insert into chat_members (chat_id, user_id)
    select cid, p.id from profiles p
    where p.username in (select lower(trim(x)) from unnest(p_usernames) x)
      and p.id <> auth.uid();
  return cid;
end $$;

create or replace function public.add_member(p_chat bigint, p_username text)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  if not public.is_member(p_chat) then raise exception 'Вы не участник этого чата'; end if;
  select id into uid from profiles where username = lower(trim(p_username));
  if uid is null then raise exception 'Пользователь не найден'; end if;
  insert into chat_members (chat_id, user_id) values (p_chat, uid) on conflict do nothing;
end $$;

revoke all on function public.create_chat(text, text[]) from public, anon;
revoke all on function public.add_member(bigint, text)  from public, anon;
grant execute on function public.create_chat(text, text[]) to authenticated;
grant execute on function public.add_member(bigint, text)  to authenticated;

/* ---------- файлы (приватное хранилище, путь: <chat_id>/<файл>) ---------- */
insert into storage.buckets (id, name, public) values ('dumps', 'dumps', false)
on conflict (id) do nothing;

drop policy if exists "dumps: чтение"  on storage.objects;
drop policy if exists "dumps: запись"  on storage.objects;
drop policy if exists "dumps: удаление" on storage.objects;

create policy "dumps: чтение" on storage.objects for select to authenticated
  using (bucket_id = 'dumps' and public.is_member(((storage.foldername(name))[1])::bigint));
create policy "dumps: запись" on storage.objects for insert to authenticated
  with check (bucket_id = 'dumps' and public.is_member(((storage.foldername(name))[1])::bigint));
create policy "dumps: удаление" on storage.objects for delete to authenticated
  using (bucket_id = 'dumps' and public.is_member(((storage.foldername(name))[1])::bigint));

/* ---------- мгновенные обновления (Realtime) ---------- */
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.chat_members;
