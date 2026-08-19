const { Client, LocalAuth } = require('whatsapp-web.js');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const SUMMARY_FILE = path.join(__dirname, 'daily_summary.json');

// Проверка наличия файла
if (!fs.existsSync(SUMMARY_FILE)) {
  console.log('\x1b[31m[Ошибка]\x1b[0m Файл daily_summary.json не найден или пуст.');
  process.exit(1);
}

let summaryData = [];
try {
  const content = fs.readFileSync(SUMMARY_FILE, 'utf8');
  summaryData = JSON.parse(content);
} catch (e) {
  console.log('\x1b[31m[Ошибка]\x1b[0m Ошибка чтения daily_summary.json:', e.message);
  process.exit(1);
}

if (!summaryData.length) {
  console.log('Список входящих сообщений за день пуст.');
  process.exit(0);
}

function displaySummary() {
  console.log('\n======================================================');
  console.log('         🌙 ВЕЧЕРНИЙ ДАЙДЖЕСТ СООБЩЕНИЙ WHATSAPP      ');
  console.log('======================================================\n');

  summaryData.forEach((item, index) => {
    const num = index + 1;
    const isAction = item.has_action_item;
    const status = item.answered ? ' [ОТВЕЧЕНО]' : '';

    if (isAction) {
      // Выделение БОЛДОМ И ЯРКИМ ЦВЕТОМ для чатов с Action Item (встречи/вопросы)
      console.log(`\x1b[1m\x1b[33m${num}. ⚠️ [ВАЖНО / ВСТРЕЧА] ${item.from} (${item.phone})${status}\x1b[0m`);
      console.log(`\x1b[1m   Время: ${item.timestamp}\x1b[0m`);
      console.log(`\x1b[1m   Сообщение: "${item.last_message}"\x1b[0m`);
    } else {
      console.log(`${num}. ${item.from} (${item.phone})${status}`);
      console.log(`   Время: ${item.timestamp}`);
      console.log(`   Сообщение: "${item.last_message}"`);
    }
    console.log('------------------------------------------------------');
  });

  console.log('\nИнструкция отправки ответа:');
  console.log('Формат: <номер_чата> <текст_ответа>');
  console.log('Пример: 1 давай завтра в 17:00');
  console.log('Для выхода введите: exit\n');
}

displaySummary();

// Инициализация WhatsApp клиента для отправки ответов
const client = new Client({
  authStrategy: new LocalAuth({ dataPath: '.wwebjs_auth' }),
  puppeteer: {
    headless: true,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  },
});

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

client.on('ready', () => {
  console.log('\x1b[32m[Подключено]\x1b[0m Готов к отправке сообщений через WhatsApp.\n');
  promptUser();
});

client.on('auth_failure', (msg) => {
  console.error('\x1b[31m[Ошибка авторизации]\x1b[0m:', msg);
});

function promptUser() {
  rl.question('\nВведите команду (<номер> <текст>) > ', async (input) => {
    const trimmed = input.trim();
    if (trimmed.toLowerCase() === 'exit' || trimmed.toLowerCase() === 'quit') {
      console.log('Завершение работы CLI...');
      rl.close();
      await client.destroy();
      process.exit(0);
    }

    const firstSpaceIndex = trimmed.indexOf(' ');
    if (firstSpaceIndex === -1) {
      console.log('\x1b[31m[Неверный формат]\x1b[0m Используйте: <номер_чата> <текст_ответа>');
      promptUser();
      return;
    }

    const chatIndex = parseInt(trimmed.substring(0, firstSpaceIndex), 10) - 1;
    const replyText = trimmed.substring(firstSpaceIndex + 1).trim();

    if (isNaN(chatIndex) || chatIndex < 0 || chatIndex >= summaryData.length) {
      console.log(`\x1b[31m[Ошибка]\x1b[0m Чат с номером ${chatIndex + 1} не найден в списке.`);
      promptUser();
      return;
    }

    if (!replyText) {
      console.log('\x1b[31m[Ошибка]\x1b[0m Текст ответа не может быть пустым.');
      promptUser();
      return;
    }

    const targetItem = summaryData[chatIndex];
    let recipientId = targetItem.phone;

    if (!recipientId.includes('@c.us') && !recipientId.includes('@g.us')) {
      recipientId = `${recipientId.replace(/\D/g, '')}@c.us`;
    }

    try {
      console.log(`Отправка сообщения для ${targetItem.from} (${recipientId})...`);
      await client.sendMessage(recipientId, replyText);

      // Помечаем как отвеченный в дайджесте
      summaryData[chatIndex].answered = true;
      fs.writeFileSync(SUMMARY_FILE, JSON.stringify(summaryData, null, 2), 'utf8');

      console.log(`\x1b[32m[Успех]\x1b[0m Ответ успешно отправлен для ${targetItem.from}!`);
    } catch (err) {
      console.error(`\x1b[31m[Ошибка отправки]\x1b[0m:`, err.message);
    }

    promptUser();
  });
}

console.log('Подключение к WhatsApp клиенту для возможности отправки сообщений...');
client.initialize();
