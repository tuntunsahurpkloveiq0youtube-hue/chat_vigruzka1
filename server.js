import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Сервер только раздаёт сайт и публичные настройки.
// Аккаунты, сообщения и файлы — напрямую в Supabase (с защитой RLS), поэтому секретных ключей здесь нет.
const { SUPABASE_URL = '', SUPABASE_ANON_KEY = '', ICE_SERVERS = '', PORT = 3000 } = process.env;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.warn('Не заданы SUPABASE_URL и SUPABASE_ANON_KEY — сайт покажет ошибку настройки.');
}

let iceServers = [];
try { if (ICE_SERVERS) iceServers = JSON.parse(ICE_SERVERS); }
catch { console.warn('ICE_SERVERS должен быть корректным JSON-массивом'); }

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.get('/health', (_req, res) => res.json({ ok: true }));

app.get('/config.js', (_req, res) => {
  res.type('application/javascript').set('Cache-Control', 'no-store').send(
    'window.APP_CONFIG=' + JSON.stringify({
      supabaseUrl: SUPABASE_URL,
      supabaseAnonKey: SUPABASE_ANON_KEY,
      iceServers,
    }) + ';'
  );
});

app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => console.log(`Сайт запущен на порту ${PORT}`));
