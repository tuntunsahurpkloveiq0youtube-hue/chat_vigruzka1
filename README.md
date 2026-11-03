# Выгрузка в чаты — Supabase + Render

Supabase хранит данные и файлы, Node-сервер на Render даёт REST API (ключ `service_role` остаётся только на сервере).

## 1. Supabase
1. Создайте проект на supabase.com.
2. SQL Editor → вставьте `supabase/schema.sql` → Run (создаст таблицы, приватный bucket `dumps` и демо-чаты).
3. Project Settings → API: скопируйте **Project URL** и **service_role key**.

## 2. GitHub
Загрузите эту папку в репозиторий (`.env` не коммитьте).

## 3. Render
1. New → **Blueprint** → выберите репозиторий (подхватится `render.yaml`) — или New → Web Service с командами `npm install` / `npm start`.
2. В Environment задайте `SUPABASE_URL` и `SUPABASE_SERVICE_ROLE_KEY`.
3. `API_TOKEN` Render создаст сам — скопируйте его в `public/api.js`.
4. Проверьте: `https://<ваш-сервис>.onrender.com/health` → `{"ok":true}`.

## API
| Метод | Путь | Что делает |
|---|---|---|
| GET | `/api/chats` | чаты со всеми сообщениями |
| POST | `/api/chats` | `{name}` — новый чат |
| PATCH | `/api/chats/:id` | `{star, arch, unread, name}` |
| GET | `/api/chats/:id/messages` | сообщения чата |
| POST | `/api/chats/:id/messages` | `{text}` |
| DELETE | `/api/chats/:id/messages` | очистить чат |
| POST | `/api/dump` | `{targets:[id], title, text, table:{title,cols,rows}, files:[{name,type,data}]}` |

## Подключение интерфейса
Положите ваш HTML в `public/index.html`, добавьте `<script src="api.js"></script>` и замените `load()/save()` на вызовы `VygruzkaAPI`
(например, в `doDump()` — `VygruzkaAPI.dump({targets: ids, title, text, table, files})`, затем `loadChats()` для обновления).

## Локально
```
cp .env.example .env   # заполнить
npm install
npm run dev
```
Бесплатный план Render «засыпает» после простоя — первый запрос может идти ~30 секунд.
