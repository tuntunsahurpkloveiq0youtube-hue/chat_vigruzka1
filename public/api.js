// Клиент для вашего интерфейса: подключите перед основным скриптом и вызывайте вместо localStorage.
// Если фронтенд лежит на том же Render-сервисе, API_URL оставьте пустым.
const API_URL = '';              // например 'https://vygruzka-backend.onrender.com'
const API_TOKEN = 'f9efb5a94ced00f9f3b565a0a70f15a951c4d2c481beec58'; // тот же, что API_TOKEN в Render

async function api(method, url, body) {
  const r = await fetch(API_URL + url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(API_TOKEN ? { Authorization: 'Bearer ' + API_TOKEN } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
  return r.json();
}

// File -> { name, type, data(base64) }
function fileToPayload(f) {
  return new Promise((ok, fail) => {
    const rd = new FileReader();
    rd.onload = () => ok({ name: f.name, type: f.type, data: String(rd.result).split(',')[1] });
    rd.onerror = fail;
    rd.readAsDataURL(f);
  });
}

window.VygruzkaAPI = {
  loadChats:   ()          => api('GET', '/api/chats'),
  createChat:  (name)      => api('POST', '/api/chats', { name }),
  updateChat:  (id, patch) => api('PATCH', `/api/chats/${id}`, patch),   // {star}, {arch}, {unread:0}
  sendMessage: (id, text)  => api('POST', `/api/chats/${id}/messages`, { text }),
  clearChat:   (id)        => api('DELETE', `/api/chats/${id}/messages`),
  dump:        (payload)   => api('POST', '/api/dump', payload),         // {targets,title,text,table,files}
  fileToPayload,
};
