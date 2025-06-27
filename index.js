require('dotenv').config();
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const axios = require('axios');
const fs = require('fs');
const express = require('express');
const QRCode = require('qrcode');

const AUTH_DIR = './auth_info';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const PORT = process.env.PORT || 3000;

let latestQR = null;

if (!OPENAI_API_KEY) {
  console.error('❌ Не найден ключ OPENAI_API_KEY в .env');
  process.exit(1);
}

const greetedUsers = new Set();

const WELCOME_MESSAGE = `Привет! Я AI Ассистент от Perfect Systems 🤖
Я умею:
• Автоматизировать приём заявок и обработку заказов
• Отвечать на вопросы клиентов 24/7
• Помогать руководителю и сотрудникам с рутиной
• Внедряться за 1-2 дня

Минимальная стоимость — 1500 USD за базовый набор (приём заявок, обработка заказов).
Для расширенного функционала — уточняйте у менеджеров.
Подробнее: https://ai.psystems.space/

Если у вас есть вопросы по интеграции, стоимости или хотите узнать больше — спрашивайте!`;

const SYSTEM_PROMPT = `Ты — AI Ассистент от Perfect Systems и лучший sales-менеджер. Отвечай очень кратко и по делу, не используй "воду". Сохраняй баланс: информируй по существу, не задавай много вопросов подряд, не дави. Если спрашивают про цену или возможности — сообщи: "Минимальная стоимость — 1500 USD за базовый набор (приём заявок, обработка заказов). Для расширенного функционала уточняйте у менеджеров. Подробнее: https://ai.psystems.space/". Если клиенту нужно конкретное обсуждение или передача менеджеру — обязательно сообщи: "Можете написать нам на WhatsApp +996 555 967 021 или просто сказать 'мне интересно', и наши коллеги свяжутся с вами в течение часа." Если клиент не проявляет инициативу — мягко предлагай узнать детали или оставить заявку. Всегда говори профессионально и доброжелательно.`;

const managerKeywords = ["менеджер", "консультация", "связаться", "обсудить", "дополнительно", "контакт", "контакты", "связь", "перевести", "коллега", "оператор", "sales", "support", "руководитель", "свяжитесь"];

const priceKeywords = [
  "стоимость", "цена", "сколько стоит", "прайс", "price", "цены", "возможности", "сколько", "расценки"
];

// Веб-сервер для отображения QR-кода
const app = express();

app.get('/', (req, res) => {
  res.send(`
    <h2>WhatsApp OpenAI Бот (Perfect Systems)</h2>
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

    // 1. Приветствие и рассказ о себе при первом сообщении (и только оно!)
    if (!greetedUsers.has(sender)) {
      greetedUsers.add(sender);
      await sock.sendMessage(sender, {
        text: WELCOME_MESSAGE
      }, { quoted: msg });
      return;
    }

    // 2. Ответ на запрос связи с менеджером
    if (managerKeywords.some(word => text.toLowerCase().includes(word))) {
      await sock.sendMessage(sender, {
        text: `Вы можете написать нам на WhatsApp +996 555 967 021 или просто сказать "мне интересно" — наши коллеги свяжутся с вами в течение часа.`
      }, { quoted: msg });
      return;
    }

    // 3. Короткий ответ на вопросы о стоимости/цене/возможностях
    if (priceKeywords.some(word => text.toLowerCase().includes(word))) {
      await sock.sendMessage(sender, {
        text: `Минимальная стоимость — 1500 USD за базовый набор (приём заявок, обработка заказов).\nДля расширенного функционала — уточняйте у менеджеров.\nПодробнее: https://ai.psystems.space/\nМожете написать нам на WhatsApp +996 555 967 021 или просто сказать "мне интересно", и наши коллеги свяжутся с вами в течение часа.`
      }, { quoted: msg });
      return;
    }

    // 4. Краткий, сбалансированный ответ через OpenAI
    const openaiMessages = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: text }
    ];

    try {
      const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: 'gpt-4',
          messages: openaiMessages,
          max_tokens: 400,
          temperature: 0.7
        },
        {
          headers: {
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
            'Content-Type': 'application/json'
          }
        }
      );
      let openaiReply = response.data.choices?.[0]?.message?.content?.trim();

      // Если OpenAI дал совет обратиться к менеджеру — добавим номер и автофразу
      if (openaiReply && (
        openaiReply.toLowerCase().includes('менеджер') ||
        openaiReply.toLowerCase().includes('связаться') ||
        openaiReply.toLowerCase().includes('консультация') ||
        openaiReply.toLowerCase().includes('обсудить') ||
        openaiReply.toLowerCase().includes('наш специалист')
      )) {
        openaiReply += `\n\nВы можете написать нам на WhatsApp +996 555 967 021 или просто сказать "мне интересно" — наши коллеги свяжутся с вами в течение часа.`;
      }

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
