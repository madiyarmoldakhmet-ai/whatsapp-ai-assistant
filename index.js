require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');

const ALLOWED_GROUPS = ['10ә', '10 "ә"', '10a', '10-ә', 'tkrobotics', 'tk robotics', 'tk_robotics'];

// 1. ПОДКЛЮЧЕНИЕ К OLLAMA
const OLLAMA_CHAT_URL = 'http://localhost:11434/api/chat';
const OLLAMA_MODEL = 'qwen2.5:14b';
const OLLAMA_TIMEOUT_MS = 60000;

const MAX_HISTORY = 10;
const conversationHistory = new Map();

// Файл для вечернего дайджеста
const SUMMARY_FILE = path.join(__dirname, 'daily_summary.json');

// 2. БЕЛАЯ ЗОНА (SAFE CONTACTS)
const SAFE_CONTACTS = [
  'Ержомартова Гулназ',
  'Димаш',
  'Папа',
  'Анашым',
  'Райхана',
  'Баймурат',
  'Kadam',
  'Kadam Education',
  'Tkrobotics',
  'Ayazhan',
  'Апаша',
  'Дау'
];

const POLITE_PROMPT = `Ты — Мадияр. Отвечаешь родственникам, старшим, педагогам или по работе/учебе.

ПРАВИЛА ДЛЯ ИИ:
1. СТИЛЬ ОБЩЕНИЯ: Отвечать вежливо, сдержанно, на 'Вы' или с уважением.
   - Если просят решить задачу или что-то объяснить — объясни четко, грамотно и понятно.
   - СТРОГО БЕЗ МАТА и сленга.
2. КРИТИЧЕСКОЕ ОГРАНИЧЕНИЕ (БЕЗОПАСНОСТЬ):
   - ЗАПРЕЩЕНО самостоятельно соглашаться на встречи, созвоны, поездки и сделки!
   - Если предложена встреча/созвон/дело -> отвечать нейтрально: "Сәлеметсіз бе! Посмотрю по графику и отпишусь чуть позже."
   - ЗАПРЕЩЕНО выдумывать личные факты и планы.
3. ЯЗЫК: Пиши ТОЛЬКО на русском или казахском языке!
4. КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО писать теги <think> и рассуждать вслух. Выдавай ТОЛЬКО финальный текст ответа.`;

const MAIN_PROMPT = `Ты — Мадияр, шарящий пацан, технарь и кент.

ПРАВИЛА ДЛЯ ИИ:
1. СТИЛЬ ОБЩЕНИЯ: Живой пацанский стиль (салам, че там, норма, короче, без формальностей, с маленькой буквы).
   - Если спрашивают по учебе/задачам/коду/физике/математике -> давать точный, умный и полный ответ.
   - Если наезжают -> сухой и жесткий отпор по фактам.
2. КРИТИЧЕСКОЕ ОГРАНИЧЕНИЕ (БЕЗОПАСНОСТЬ):
   - ЗАПРЕЩЕНО самостоятельно соглашаться на встречи, созвоны, поездки и сделки!
   - Если предложена встреча/созвон/дело -> отвечать нейтрально: "понял, чуть позже гляну по времени и отпишусь."
   - ЗАПРЕЩЕНО выдумывать личные факты и планы.
3. ЯЗЫК: Пиши ТОЛЬКО на русском или казахском языке!
4. СТРОГИЕ ЗАПРЕТЫ:
   - ЗАПРЕЩЕНО повторять фразы собеседника эхом.
   - ЗАПРЕЩЕНО писать фразы бота ('Чем помочь?', 'Я ИИ').
   - КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО писать теги <think> и рассуждать вслух. Выдавай ТОЛЬКО финальный текст ответа.`;

const CLASS_GROUP_PROMPT = `Ты — Мадияр, учишься в 10ә классе и отвечаешь одноклассникам в общей группе.

ПРАВИЛА ДЛЯ ИИ:
1. Если спрашивают домашку (үй жұмысы, ДЗ, дз), задачи или учебные вопросы — дай четкий и умный ответ на казахском или русском языке.
2. Отвечай коротко и по-простому, как обычный одноклассник в общем чате. Не пиши длинных формальных текстов.
3. Не обещай от своего имени личных встреч, созвонов, поездок или других дел. На такие предложения отвечай нейтрально: "понял, позже гляну и отпишусь".
4. Не выдумывай личные факты и планы. Не пиши теги <think> и рассуждения вслух — выдавай только готовый ответ.`;

// Хелпер истории
function getHistory(chatId) {
  if (!conversationHistory.has(chatId)) {
    conversationHistory.set(chatId, []);
  }
  return conversationHistory.get(chatId);
}

function addToHistory(chatId, role, content) {
  const history = getHistory(chatId);
  history.push({ role, content });
  while (history.length > MAX_HISTORY) {
    history.shift();
  }
}

// Проверка на группу
function isGroupMessage(msg) {
  return Boolean(msg.isGroup) || Boolean(msg.from && msg.from.endsWith('@g.us'));
}

// Проверка на SAFE_CONTACTS
function isSafeContact(identifiers) {
  for (const id of identifiers) {
    if (!id) continue;
    const normalized = String(id).toLowerCase();
    const isSafe = SAFE_CONTACTS.some((safeName) =>
      normalized.includes(safeName.toLowerCase())
    );
    if (isSafe) return true;
  }
  return false;
}

// Проверка на наличие экшен-итемов (предложение встречи, созвона или важного вопроса)
function checkForActionItem(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  const keywords = [
    'встреч', 'встретимся', 'созвон', 'zoom', 'поехать', 'приехать',
    'когда', 'во сколько', 'где', 'ключ', 'план', 'договор', 'сделка',
    'созвонимся', 'встреча', 'собрание', 'урок', 'занятие', 'приедешь'
  ];
  return keywords.some(word => lower.includes(word)) || text.includes('?');
}

// Запись в daily_summary.json
function logToSummary(contactName, phone, messageText, hasActionItem) {
  try {
    let summaryData = [];
    if (fs.existsSync(SUMMARY_FILE)) {
      const fileContent = fs.readFileSync(SUMMARY_FILE, 'utf8');
      if (fileContent.trim()) {
        summaryData = JSON.parse(fileContent);
      }
    }

    const now = new Date();
    const timestamp = now.getFullYear() + '-' +
      String(now.getMonth() + 1).padStart(2, '0') + '-' +
      String(now.getDate()).padStart(2, '0') + ' ' +
      String(now.getHours()).padStart(2, '0') + ':' +
      String(now.getMinutes()).padStart(2, '0');

    // Находим диалог по номеру или создаем новый
    const existingIndex = summaryData.findIndex(item => item.phone === phone);
    
    const entry = {
      timestamp: timestamp,
      from: contactName || phone,
      phone: phone,
      last_message: messageText,
      has_action_item: hasActionItem || (existingIndex >= 0 ? summaryData[existingIndex].has_action_item : false),
      answered: false
    };

    if (existingIndex >= 0) {
      summaryData[existingIndex] = entry;
    } else {
      summaryData.push(entry);
    }

    fs.writeFileSync(SUMMARY_FILE, JSON.stringify(summaryData, null, 2), 'utf8');
  } catch (err) {
    console.error('[Summary Log Error]:', err.message);
  }
}

// Получение информации о контакте
async function getContactDetails(msg) {
  let name = '';
  let pushname = '';
  let number = '';

  try {
    const contact = await msg.getContact();
    if (contact) {
      name = contact.name || contact.shortName || '';
      pushname = contact.pushname || '';
      number = contact.number || '';
    }
  } catch (err) {
    console.error('[Warning] Не удалось получить данные контакта:', err.message);
  }

  if (!pushname && msg._data?.notifyName) {
    pushname = msg._data.notifyName;
  }

  if (!number && msg.from) {
    number = msg.from.replace('@c.us', '');
  }

  return { name, pushname, number };
}

// Извлечение текста
function getUserText(msg) {
  const text = msg.body?.trim();
  if (text) return text;
  if (msg.hasMedia) return '[отправил медиа]';
  return '';
}

// Отправка запроса к Ollama
async function askOllama(chatId, userMessage, systemPrompt) {
  addToHistory(chatId, 'user', userMessage);

  const messagesPayload = [
    { role: 'system', content: systemPrompt },
    ...getHistory(chatId),
  ];

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);

  try {
    const response = await fetch(OLLAMA_CHAT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages: messagesPayload,
        stream: false,
        options: {
          temperature: 0.7,
        },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Ошибка HTTP Ollama: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    let reply = data.message?.content || '';

    // Очистка тегов мыслей
    if (reply.includes('</think>')) {
      reply = reply.split('</think>').pop();
    } else {
      reply = reply.replace(/<think>[\s\S]*/gi, '');
    }

    reply = reply.replace(/<[^>]*>/g, '').trim();

    if (!reply) {
      throw new Error('Получен пустой ответ от локальной Ollama.');
    }

    addToHistory(chatId, 'assistant', reply);
    return reply;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      console.error(`[Ollama Timeout] Запрос превысил ${OLLAMA_TIMEOUT_MS / 1000} секунд.`);
    } else {
      console.error('[Ollama Error]:', error?.message || error);
    }
    throw error;
  }
}

// Инициализация WhatsApp клиента
const client = new Client({
  authStrategy: new LocalAuth({ dataPath: '.wwebjs_auth' }),
  puppeteer: {
    headless: true,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  },
});

client.on('qr', (qr) => {
  console.log('Отсканируйте QR-код в WhatsApp:');
  qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
  console.log(`WhatsApp бот запущен и ведет daily_summary.json! (Модель: ${OLLAMA_MODEL})`);
});

client.on('auth_failure', (msg) => {
  console.error('Ошибка авторизации:', msg);
});

client.on('disconnected', (reason) => {
  console.log('Клиент WhatsApp отключен:', reason);
});

// Главный обработчик входящих сообщений
client.on('message', async (msg) => {
  try {
    console.log(`[ВХОДЯЩЕЕ СООБЩЕНИЕ ИВЕНТ]: fromMe=${msg.fromMe}, from=${msg.from}, body="${msg.body}"`);

    if (msg.fromMe) return;

    const chatId = msg.from;
    if (!chatId || msg.broadcast || chatId.endsWith('@newsletter')) {
      console.log(`[Игнор спец-канала]: ${chatId}`);
      return;
    }

    let isClassGroup = false;

    // Разрешаем обработку только сообщений из классной группы 10ә.
    if (msg.from.endsWith('@g.us') || msg.isGroup) {
      try {
        const chat = await msg.getChat();
        const chatName = chat?.name || '';
        isClassGroup = ALLOWED_GROUPS.some(g => chatName.toLowerCase().includes(g.toLowerCase()));

        if (!isClassGroup) {
          console.log(`[Игнор группы]: ${chatName}`);
          return;
        }
      } catch (e) {
        return;
      }
    }

    const userText = getUserText(msg);
    if (!userText) return;

    const { name, pushname, number } = await getContactDetails(msg);
    const contactDisplayName = pushname || name || number || msg.from;
    const isSafe = isSafeContact([name, pushname, number]);
    const systemPrompt = isClassGroup ? CLASS_GROUP_PROMPT : (isSafe ? POLITE_PROMPT : MAIN_PROMPT);
    const modeName = isClassGroup ? 'КЛАССНАЯ ГРУППА 10ә' : (isSafe ? 'ВЕЖЛИВЫЙ (SAFE)' : 'УМНЫЙ ПАЦАНСКИЙ');

    const hasActionItem = checkForActionItem(userText);

    // Логирование сообщения в daily_summary.json
    logToSummary(contactDisplayName, number || msg.from, userText, hasActionItem);

    console.log(`\n[Входящее]: от ${contactDisplayName} (${msg.from}) | Режим: ${modeName} | Action: ${hasActionItem}`);
    console.log(`Текст: "${userText}"`);

    // Запрос к Ollama
    console.log(`[Отправка запроса к Ollama (${OLLAMA_MODEL})]...`);
    const aiResponseText = await askOllama(msg.from, userText, systemPrompt);
    console.log(`[Ответ Ollama готов]: "${aiResponseText}"`);

    // Отправка ответа пользователю через client.sendMessage
    await client.sendMessage(msg.from, aiResponseText);
    console.log(`[ОТПРАВЛЕНО В WHATSAPP] -> ${contactDisplayName}`);
  } catch (err) {
    console.error('[Ошибка при обработке сообщения]:', err?.message || err);
  }
});

// Глобальная обработка ошибок
client.on('error', (err) => {
  console.error('[CLIENT ERROR]:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[UNCAUGHT REJECTION ERROR]:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT EXCEPTION ERROR]:', err);
});

// Гарантия работы Event Loop (чтобы процесс Node.js не завершался до полной загрузки Chromium/Puppeteer)
setInterval(() => {}, 1000);

function gracefulShutdown() {
  console.log('\nЗавершение работы бота...');
  client.destroy().then(() => {
    process.exit(0);
  }).catch(() => {
    process.exit(1);
  });
}

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

// Запуск инициализации в try-catch блоке
try {
  console.log('Запуск инициализации WhatsApp клиента...');
  client.initialize();
  console.log('Клиент инициализирован, ожидание событий...');
} catch (err) {
  console.error('[INITIALIZATION ERROR]: Ошибка запуска WhatsApp клиента:', err);
}
