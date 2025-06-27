# WhatsApp OpenAI Bot

Бот для WhatsApp на Node.js с использованием [@whiskeysockets/baileys](https://github.com/WhiskeySockets/Baileys) и OpenAI GPT-4.

## Запуск

1. Установите зависимости:
   ```
   npm install
   ```

2. Создайте файл `.env` с содержимым:
   ```
   OPENAI_API_KEY=ваш_ключ_OpenAI
   ```

3. Запустите бота:
   ```
   node index.js
   ```

4. Отсканируйте QR-код с помощью приложения WhatsApp.

## Деплой на Render.com

Используйте файл `render.yaml` для быстрого деплоя.

## Особенности

- Сохраняет сессию авторизации в папке `auth_info`.
- Все входящие текстовые сообщения пересылаются в OpenAI GPT-4.
- Ответы отправляются обратно в WhatsApp.
- Логи подключения и входящих сообщений выводятся в консоль.