require('dotenv').config();
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const axios = require('axios');
const fs = require('fs');
const express = require('express');
const QRCode = require('qrcode');

const AUTH_DIR = './auth_info';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const PORT = process.env.PORT || 3000;

let latestQR = null; // хранит последний QR-код

if (!OPENAI_API_KEY) {
  console.error('❌ Не найден ключ OPENAI_API_KEY в .env');
  process.exit(1);
}

// Веб-сервер для отображения QR-кода
const app = express();

app.get('/', (req, res) => {
  res.send(`
    <h2>WhatsApp OpenAI Бот</h2>
    <p>Статус: <span id="status">Ожидание...</span></p>
    <div id="qr"></div>
    <script>
      async function fetchQR() {
        const r = await fetch('/qr');
        if (r.status === 200) {
          const { qr } = await r.json();
          if (qr) {
            document.getElementById('qr').innerHTML = '<img src="'+qr+'" alt="QR Code"/><p>Отсканируйте QR-код WhatsApp</p>';
            document.getElementById('status').textContent = "Ожидает сканирования...";
          } else {
            document.getElementById('qr').innerHTML = '';
            document.getElementById('status').textContent = "Бот авторизован!";
          }
        }
      }
      setInterval(fetchQR, 2000);
      fetchQR();
    </script>
  `);
});

app.get('/qr', async (req, res) => {
  if (latestQR) {
    const dataUrl = await QRCode.toDataURL(latestQR);
    res.json({ qr: dataUrl });
  } else {
    res.json({ qr: null });
  }
});

app.listen(PORT, () => {
  console.log(`🌍 Веб-интерфейс доступен на http://localhost:${PORT}`);
});

async function connectToWhatsApp() {
  if (!fs.existsSync(AUTH_DIR)) {
    fs.mkdirSync(AUTH_DIR);
  }
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  const sock = makeWASocket({
    auth: state,
    // printQRInTerminal: true, // убираем, чтобы не было warning
  });

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      latestQR = qr;
      console.log('📱 QR-код обновлен! Проверьте веб-интерфейс.');
    }
    if (connection === 'close') {
      const reason = lastDisconnect?.error?.output?.statusCode;
      latestQR = null;
      if (reason === DisconnectReason.loggedOut) {
        console.log('🔌 Соединение закрыто. Требуется повторная авторизация.');
        process.exit(0);
      } else {
        console.log('🔌 Соединение закрыто. Переподключение...');
        connectToWhatsApp();
      }
    } else if (connection === 'open') {
      latestQR = null;
      console.log('✅ Подключено к WhatsApp!');
    } else if (connection === 'connecting') {
      console.log('⏳ Подключение к WhatsApp...');
    }
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('messages.upsert', async (m) => {
    const msg = m.messages && m.messages[0];
    if (!msg?.message || msg.key.fromMe) return;
    const sender = msg.key.remoteJid;
    let text = '';
    if (msg.message.conversation) {
      text = msg.message.conversation;
    } else if (msg.message.extendedTextMessage) {
      text = msg.message.extendedTextMessage.text;
    } else if (msg.message.imageMessage && msg.message.imageMessage.caption) {
      text = msg.message.imageMessage.caption;
    }
    if (!text.trim()) return;

    console.log(`💬 Сообщение от ${sender}: ${text}`);

    // Отправляем текст в OpenAI API
    try {
      const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: 'gpt-4',
          messages: [
            { role: 'user', content: text }
          ],
          max_tokens: 1000,
        },
        {
          headers: {
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
            'Content-Type': 'application/json'
          }
        }
      );
      const openaiReply = response.data.choices?.[0]?.message?.content?.trim();
      if (openaiReply) {
        await sock.sendMessage(sender, { text: openaiReply }, { quoted: msg });
      } else {
        await sock.sendMessage(sender, { text: '🤖 Ошибка: пустой ответ от OpenAI.' }, { quoted: msg });
      }
    } catch (err) {
      console.error('❌ Ошибка при обращении к OpenAI:', err?.response?.data || err.message);
      await sock.sendMessage(sender, { text: '❌ Не удалось получить ответ от OpenAI.' }, { quoted: msg });
    }
  });
}

connectToWhatsApp();

console.log(`
---------------------------
Инструкция по запуску бота:
1. npm install
2. Создайте .env с ключом OPENAI_API_KEY
3. node index.js
4. Откройте http://localhost:3000 для сканирования QR-кода
---------------------------
`);
