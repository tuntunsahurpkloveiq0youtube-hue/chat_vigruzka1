import express from 'express';
import cors from 'cors';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  API_TOKEN,                 // необязательно: если задан, API требует заголовок Authorization: Bearer <token>
  ALLOWED_ORIGIN = '*',
  PORT = 3000,
} = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Не заданы SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const BUCKET = 'dumps';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors({ origin: ALLOWED_ORIGIN === '*' ? true : ALLOWED_ORIGIN.split(',') }));
app.use(express.json({ limit: '25mb' })); // файлы приходят в base64

// Render проверяет живость сервиса по этому адресу
app.get('/health', (_req, res) => res.json({ ok: true }));

// Защита API токеном
app.use('/api', (req, res, next) => {
  if (!API_TOKEN) return next();
  const t = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const a = Buffer.from(t), b = Buffer.from(API_TOKEN);
  if (a.length === b.length && crypto.timingSafeEqual(a, b)) return next();
  res.status(401).json({ error: 'Неверный токен' });
});

const wrap = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((e) => {
    console.error(e);
    res.status(500).json({ error: e.message || 'Ошибка сервера' });
  });
const must = ({ data, error }) => { if (error) throw error; return data; };

/* ---------- форматирование ---------- */
async function toMessage(m) {
  const o = {
    id: m.id, from: m.from_who, who: m.who, kind: m.kind, title: m.title,
    dump: m.dump, ts: new Date(m.created_at).getTime(),
  };
  if (m.kind === 'text') o.text = m.body;
  if (m.kind === 'file') {
    Object.assign(o, { name: m.file_name, size: m.file_size, type: m.file_type });
    if (m.storage_path && /^image\//.test(m.file_type || '')) {
      const { data } = await sb.storage.from(BUCKET).createSignedUrl(m.storage_path, 3600);
      o.url = data?.signedUrl;
    }
  }
  if (m.kind === 'table') Object.assign(o, { cols: m.cols, rows: m.rows });
  return o;
}

/* ---------- чаты ---------- */
// Список чатов + все сообщения (как ожидает фронтенд)
app.get('/api/chats', wrap(async (_req, res) => {
  const chats = must(await sb.from('chats').select('*').order('id'));
  const msgs = must(await sb.from('messages').select('*').order('created_at'));
  const byChat = {};
  for (const m of msgs) (byChat[m.chat_id] ||= []).push(await toMessage(m));
  res.json(chats.map((c) => ({
    id: c.id, name: c.name, hue: c.hue, star: c.star, arch: c.arch,
    unread: c.unread, msgs: byChat[c.id] || [],
  })));
}));

app.post('/api/chats', wrap(async (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 60);
  if (!name) return res.status(400).json({ error: 'Нужно название чата' });
  const row = must(await sb.from('chats')
    .insert({ name, hue: Math.floor(Math.random() * 360) }).select().single());
  res.status(201).json({ ...row, msgs: [] });
}));

app.patch('/api/chats/:id', wrap(async (req, res) => {
  const patch = {};
  for (const k of ['name', 'star', 'arch', 'unread']) if (k in req.body) patch[k] = req.body[k];
  const row = must(await sb.from('chats').update(patch).eq('id', req.params.id).select().single());
  res.json(row);
}));

/* ---------- сообщения ---------- */
async function addMessages(chatIds, { title, text, table, files, dump = true, from = 'me' }) {
  const rows = [];
  const base = Date.now();
  let step = 0;
  const stamp = () => new Date(base + step++).toISOString();

  // файлы грузим в Storage один раз на чат
  for (const id of chatIds) {
    if (text) rows.push({ chat_id: id, from_who: from, kind: 'text', title: title || null, body: text, dump, created_at: stamp() });
    for (const f of files || []) {
      const buf = Buffer.from(f.data, 'base64');
      const safe = String(f.name).replace(/[^\w.\-]+/g, '_');
      const storage_path = `${id}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${safe}`;
      const up = await sb.storage.from(BUCKET).upload(storage_path, buf, {
        contentType: f.type || 'application/octet-stream',
      });
      if (up.error) throw up.error;
      rows.push({
        chat_id: id, from_who: from, kind: 'file', file_name: f.name, file_size: buf.length,
        file_type: f.type || null, storage_path, dump, created_at: stamp(),
      });
    }
    if (table?.cols) rows.push({
      chat_id: id, from_who: from, kind: 'table', title: table.title || null,
      cols: table.cols, rows: table.rows || [], dump, created_at: stamp(),
    });
  }
  if (!rows.length) return [];
  return must(await sb.from('messages').insert(rows).select());
}

app.get('/api/chats/:id/messages', wrap(async (req, res) => {
  const data = must(await sb.from('messages').select('*')
    .eq('chat_id', req.params.id).order('created_at'));
  res.json(await Promise.all(data.map(toMessage)));
}));

// Обычное сообщение из поля ввода
app.post('/api/chats/:id/messages', wrap(async (req, res) => {
  const text = String(req.body.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Пустое сообщение' });
  const [m] = await addMessages([Number(req.params.id)], { text, dump: false });
  res.status(201).json(await toMessage(m));
}));

// Очистить чат
app.delete('/api/chats/:id/messages', wrap(async (req, res) => {
  const old = must(await sb.from('messages').select('storage_path')
    .eq('chat_id', req.params.id).not('storage_path', 'is', null));
  if (old.length) await sb.storage.from(BUCKET).remove(old.map((o) => o.storage_path));
  must(await sb.from('messages').delete().eq('chat_id', req.params.id).select());
  res.json({ ok: true });
}));

// «Выгрузить» сразу в несколько чатов
// body: { targets:[1,2], title?, text?, table?:{title,cols,rows}, files?:[{name,type,data(base64)}] }
app.post('/api/dump', wrap(async (req, res) => {
  const { targets, title, text, table, files } = req.body;
  if (!Array.isArray(targets) || !targets.length) return res.status(400).json({ error: 'Не выбраны чаты' });
  if (!text && !table?.cols && !files?.length) return res.status(400).json({ error: 'Нечего выгружать' });
  const created = await addMessages(targets.map(Number), { title, text, table, files, dump: true });
  res.status(201).json({ ok: true, chats: targets.length, messages: created.length });
}));

// Фронтенд (положите index.html в папку public)
app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => console.log(`API запущен на порту ${PORT}`));
