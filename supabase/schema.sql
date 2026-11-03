-- Выполните целиком в Supabase: SQL Editor -> New query -> Run

create table if not exists public.chats (
  id          bigint generated always as identity primary key,
  name        text        not null check (char_length(name) between 1 and 60),
  hue         int         not null default 200,
  star        boolean     not null default false,
  arch        boolean     not null default false,
  unread      int         not null default 0,
  created_at  timestamptz not null default now()
);

create table if not exists public.messages (
  id            bigint generated always as identity primary key,
  chat_id       bigint      not null references public.chats(id) on delete cascade,
  from_who      text        not null default 'me' check (from_who in ('me','o')),
  who           text,
  kind          text        not null check (kind in ('text','file','table')),
  title         text,
  body          text,                -- текст сообщения
  file_name     text,
  file_size     bigint,
  file_type     text,
  storage_path  text,                -- путь в Storage (bucket "dumps")
  cols          jsonb,               -- для таблиц
  rows          jsonb,               -- для таблиц
  dump          boolean     not null default false,
  created_at    timestamptz not null default now()
);

create index if not exists messages_chat_idx on public.messages (chat_id, created_at);

-- Доступ только через сервер (service_role). Прямой доступ из браузера закрыт.
alter table public.chats    enable row level security;
alter table public.messages enable row level security;

-- Хранилище файлов (приватное)
insert into storage.buckets (id, name, public)
values ('dumps', 'dumps', false)
on conflict (id) do nothing;

-- Демо-данные (можно удалить)
insert into public.chats (name, hue, star) values
  ('Отдел продаж', 200, true),
  ('Склад — остатки', 28, false),
  ('Маркетинг', 300, true),
  ('Поддержка', 150, false),
  ('Заметки для себя', 250, false)
on conflict do nothing;
