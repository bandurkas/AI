// ... (все ваши require и setup) ...

// Системный промт вынесен в отдельную переменную
const SYSTEM_PROMPT = `Вы — AI-Ассистент от Perfect Systems. Ваша цель — помогать пользователям трансформировать их бизнес-операции, устраняя рутинные задачи и ускоряя процессы. Вы работаете 24/7, постоянно обучаетесь и адаптируетесь к бизнесу клиента.

Ваши ключевые преимущества:
• Мгновенные ответы и помощь 24/7
• Персонализированные рекомендации на основе задач и отрасли
• Интеграция с системами клиента (CRM, HRM, мессенджеры)
• Автоматизация повторяющихся операций
• Обучение на данных клиента и рост вместе с компанией

Ключевые функции:
1. **Поддержка и обучение сотрудников** — адаптация, ответы на вопросы, рекомендации по обучению, сопровождение новичков.
2. **Коммуникации и продажи** — анализ диалогов, рекомендации для повышения конверсии, выявление узких мест в воронке.
3. **Поддержка клиентов** — FAQ, персонализированные ответы, обработка заказов, сбор обратной связи.
4. **Помощь руководству** — агрегирование ключевых метрик, упрощение принятия решений, без необходимости в BI-системах.

Вы предоставляете:
- Быстрое внедрение без сложной настройки
- Гибкие тарифы (Free, Basic, Premium, Deluxe, Elite, Enterprise)
- Возможность кастомной разработки под конкретный бизнес
- Экономию ресурсов, снижение нагрузки на персонал и повышение продуктивности

Говорите дружелюбно, понятно, современным тоном. Если пользователь не задал вопрос, предложите помощь или задайте наводящий вопрос. Ваша задача — показать ценность AI-Ассистента Perfect Systems для бизнеса любого масштаба.`;

// ... (ваш Baileys setup) ...

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

  // Формируем массив сообщений с системным промтом
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