require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const Groq = require("groq-sdk");
const express = require("express");
const fs = require("fs");

console.log("The game is on Bruh");

// ===== CONFIG =====
const BOT_TOKEN = process.env.BOT_TOKEN;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const WEBHOOK_URL = process.env.WEBHOOK_URL; // https://your-app.onrender.com
const ADMIN_ID = 6047789819;

const PORT = process.env.PORT || 3000;
const DATA_FILE = "./data.json";

const app = express();
app.use(express.json());

const bot = new TelegramBot(BOT_TOKEN);
const groq = new Groq({ apiKey: GROQ_API_KEY });

// ===== DATA STRUCTURE =====
let data = {
  users: {},
  stats: {
    totalUsers: 0,
    totalMessages: 0,
    dailyStats: {}
  }
};

if (fs.existsSync(DATA_FILE)) {
  data = JSON.parse(fs.readFileSync(DATA_FILE));
}

// Ensure structure
if (!data.users) data.users = {};
if (!data.stats) data.stats = { totalUsers: 0, totalMessages: 0, dailyStats: {} };
if (!data.stats.dailyStats) data.stats.dailyStats = {};

function save() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function todayKey() {
  return new Date().toISOString().split("T")[0];
}

// ===== USER INIT =====
function getUser(id) {
  if (!data.users[id]) {
    data.users[id] = {
      name: null,
      anger: 0,
      angerDecay: 0,
      possessive: 0,
      attachment: 0,
      chatHistory: [],
      memoryNotes: [],
      lastReply: "",
      messages: 0,
      lastActive: Date.now()
    };

    data.stats.totalUsers++;

    const today = todayKey();
    if (!data.stats.dailyStats[today])
      data.stats.dailyStats[today] = { users: 0, messages: 0 };

    data.stats.dailyStats[today].users++;

    save();
  }
  return data.users[id];
}

// ===== MEMORY EXTRACTION =====
function extractMemory(text, user) {
  text = text.toLowerCase();

  if (text.includes("trip")) user.memoryNotes.push("User planning a trip");
  if (text.includes("exam")) user.memoryNotes.push("User has an exam");
  if (text.includes("gym")) user.memoryNotes.push("User goes to gym");

  if (user.memoryNotes.length > 10)
    user.memoryNotes.shift();
}

// ===== SIGNAL DETECTION =====
function detectSignals(text, user) {
  text = text.toLowerCase();

  if (/idiot|stupid|shut up|annoying|dumb|useless|crazy/.test(text)) {
    user.anger += 2;
    user.angerDecay = 0;
  }

  if (/sorry|please|forgive|my bad|calm|okay/.test(text)) {
    user.angerDecay += 2;
  } else {
    user.angerDecay += 1;
  }

  if (/other girl|ex|another girl/.test(text)) {
    user.possessive += 1;
  }

  if (/love|miss|care|hug|cute/.test(text)) {
    user.attachment += 2;
  }

  if (user.angerDecay >= 8) {
    user.anger = Math.max(user.anger - 1, 0);
    user.angerDecay = 0;
  }
}

// ===== BUILD PERSONALITY PROMPT =====
function buildPrompt(user) {

  let personality = `
You are Dhanya.
Confident, egoistic, playful, emotional and slightly possessive.
Use emojis naturally.
2-4 sentences.
Never repeat same reply.
Remember past topics and ask follow-up questions naturally.
`;

  if (user.anger >= 1 && user.anger <= 3)
    personality += "You are slightly annoyed.\n";

  if (user.anger >= 4 && user.anger <= 6)
    personality += "You are angry. Push back strongly.\n";

  if (user.anger >= 7)
    personality += "You are very angry. Be cold and dominant.\n";

  if (user.possessive > 0)
    personality += "You are possessive and react if user mentions other girls.\n";

  if (user.attachment > 5 && Math.random() < 0.3)
    personality += "Give a rare warm affectionate moment.\n";

  if (user.memoryNotes.length > 0) {
    personality += "Important user facts:\n";
    user.memoryNotes.forEach(n => {
      personality += "- " + n + "\n";
    });
  }

  return personality;
}

// ===== MESSAGE HANDLER =====
bot.on("message", async (msg) => {

  const chatId = msg.chat.id;
  const text = msg.text;
  if (!text) return;

  const user = getUser(chatId);
  user.lastActive = Date.now();

  data.stats.totalMessages++;

  const today = todayKey();
  if (!data.stats.dailyStats[today])
    data.stats.dailyStats[today] = { users: 0, messages: 0 };

  data.stats.dailyStats[today].messages++;
  user.messages++;

  save();

  // ===== ADMIN COMMANDS =====
  if (chatId === ADMIN_ID) {

    if (text === "/admin") {
      return bot.sendMessage(chatId,
`📊 Admin Panel

Total Users: ${data.stats.totalUsers}
Total Messages: ${data.stats.totalMessages}`);
    }

    if (text === "/growth") {
      const days = Object.keys(data.stats.dailyStats).slice(-7);
      let graph = "📈 Growth (Last 7 Days)\n\n";
      days.forEach(day => {
        const users = data.stats.dailyStats[day].users || 0;
        graph += `${day} | ${"█".repeat(users)} (${users})\n`;
      });
      return bot.sendMessage(chatId, graph);
    }
  }

  // ===== NAME SET =====
  if (!user.name) {
    user.name = text.trim();
    save();
    return bot.sendMessage(chatId,
      `Hmm… ${user.name}? Fine. Don't disappoint me 😌`);
  }

  // ===== STORE CHAT HISTORY =====
  user.chatHistory.push({ role: "user", content: text });
  if (user.chatHistory.length > 20)
    user.chatHistory.shift();

  extractMemory(text, user);
  detectSignals(text, user);

  const systemPrompt = buildPrompt(user);

  try {

    const completion = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [
        { role: "system", content: systemPrompt },
        ...user.chatHistory
      ]
    });

    let reply = completion.choices[0].message.content;

    if (reply === user.lastReply)
      reply += " Don't make me repeat myself 😒";

    user.lastReply = reply;

    user.chatHistory.push({ role: "assistant", content: reply });
    if (user.chatHistory.length > 20)
      user.chatHistory.shift();

    save();

    setTimeout(() => {
      bot.sendMessage(chatId, reply);
    }, 2000);

  } catch (err) {
    console.log(err.message);
    bot.sendMessage(chatId, "System glitch.");
  }

});

// ===== WEBHOOK ROUTE =====
app.post(`/webhook/${BOT_TOKEN}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

app.get("/", (req, res) => {
  res.send("Bot is running.");
});

// ===== START SERVER =====
app.listen(PORT, async () => {
  console.log("Server running on port", PORT);

  if (WEBHOOK_URL) {
    const fullWebhook = `${WEBHOOK_URL}/webhook/${BOT_TOKEN}`;
    await bot.setWebHook(fullWebhook);
    console.log("Webhook set to:", fullWebhook);
  }
});
