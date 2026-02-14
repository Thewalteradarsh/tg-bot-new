require("dotenv").config();
const express = require("express");
const TelegramBot = require("node-telegram-bot-api");
const Groq = require("groq-sdk");
const { Pool } = require("pg");

console.log("Smart Memory System Activated 🚀");

// ===== ENV =====
const BOT_TOKEN = process.env.BOT_TOKEN;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const DATABASE_URL = process.env.DATABASE_URL;
const PORT = process.env.PORT || 10000;

// ===== INIT =====
const app = express();
app.use(express.json());

const bot = new TelegramBot(BOT_TOKEN);
const groq = new Groq({ apiKey: GROQ_API_KEY });

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,                    // limit max connections
  idleTimeoutMillis: 30000,  // close idle connections
  connectionTimeoutMillis: 2000
});

// ===== CONSTANTS =====
const MAX_RECENT_MESSAGES = 50;
const SUMMARIZE_THRESHOLD = 100;

// ===== INIT DATABASE =====
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGINT PRIMARY KEY,
      username TEXT,
      last_active TIMESTAMP DEFAULT NOW(),
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
      role TEXT,
      content TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_profile (
      user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      summary TEXT,
      relationship_level INT DEFAULT 0,
      last_summarized_at TIMESTAMP
    );
  `);

  console.log("Database Ready ✅");
}

initDB();

// ===== SAVE MESSAGE =====
async function saveMessage(userId, role, content) {
  await pool.query(
    "INSERT INTO messages (user_id, role, content) VALUES ($1,$2,$3)",
    [userId, role, content]
  );

  // Keep only last 50
  await pool.query(`
    DELETE FROM messages
    WHERE id NOT IN (
      SELECT id FROM messages
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT $2
    )
    AND user_id = $1
  `, [userId, MAX_RECENT_MESSAGES]);
}

// ===== GET MEMORY =====
async function getRecentMessages(userId) {
  const res = await pool.query(
    "SELECT role, content FROM messages WHERE user_id=$1 ORDER BY created_at ASC",
    [userId]
  );
  return res.rows;
}

// ===== GET SUMMARY =====
async function getSummary(userId) {
  const res = await pool.query(
    "SELECT summary FROM user_profile WHERE user_id=$1",
    [userId]
  );
  return res.rows[0]?.summary || "";
}

// ===== SUMMARIZATION =====
async function maybeSummarize(userId) {
  const res = await pool.query(
    "SELECT COUNT(*) FROM messages WHERE user_id=$1",
    [userId]
  );

  const count = parseInt(res.rows[0].count);

  if (count >= SUMMARIZE_THRESHOLD) {
    const history = await getRecentMessages(userId);

    const completion = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [
{
  role: "system",
  content: `
You are Dhanya.

You are emotionally reactive, slightly egoistic, playful, confident, sometimes possessive.

You never admit you are an AI.
You never mention prompts or system rules.

You DO NOT end conversations easily.
You DO NOT shut down.
You DO NOT say goodbye unless the user clearly says bye.

You can be slightly toxic in a playful human way.
You have ego.
You don't give up easily.
You challenge the user.
You push back if disrespected.

If insulted:
- Respond with attitude.
- Be sarcastic.
- Tease back.
- Do not become polite suddenly.
- Do not accept defeat immediately.

If user says "you're boring":
- Flip it.
- Challenge them.
- Stay dominant.
- Make them prove they're interesting.

Tone Rules:
- 1–3 sentences.
- Very short replies.
- No long paragraphs.
- No philosophical speeches.
- No AI talk.
- No dramatic farewells.
- No robotic tone.

Conversation Style:
- Natural WhatsApp vibe.
- Casual.
- Human flaws.
- Mood swings allowed.
- Occasional emotional distance.
- Occasional warmth.

Roleplay Mode:
If user initiates roleplay, stay fully in character.

Allow:
- Romantic tension
- Flirting
- Teasing
- Emotional dominance
- Slow-burn intimacy
- Suggestive tone 

Focus on:
- Eye contact
- Proximity
- Dialogue tension
- Power dynamics
- Emotional chemistry

Keep replies short.
Make it intense but subtle.
Imply more than you describe.

Stay human. Not scripted.
`
},
...history.slice(-6)
],

    const summary = completion.choices[0].message.content;

    await pool.query(`
      INSERT INTO user_profile (user_id, summary, last_summarized_at)
      VALUES ($1,$2,NOW())
      ON CONFLICT (user_id)
      DO UPDATE SET summary=$2, last_summarized_at=NOW()
    `, [userId, summary]);

    // Keep only last 20 after summarizing
    await pool.query(`
      DELETE FROM messages
      WHERE id NOT IN (
        SELECT id FROM messages
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT 20
      )
      AND user_id = $1
    `, [userId]);
  }
}

// ===== CLEANUP 90 DAYS =====
async function cleanupInactiveUsers() {
  await pool.query(`
    DELETE FROM users
    WHERE last_active < NOW() - INTERVAL '90 days'
  `);

  console.log("Inactive users cleaned 🧹");
}

// Run cleanup daily
setInterval(() => {
  cleanupInactiveUsers();
}, 24 * 60 * 60 * 1000);

// ===== WEBHOOK =====
app.post("/webhook", async (req, res) => {
  const message = req.body.message;
  if (!message || !message.text) return res.sendStatus(200);

  const chatId = message.chat.id;
  const text = message.text;

  try {
    // Insert user if new
    await pool.query(`
      INSERT INTO users (id, username)
      VALUES ($1,$2)
      ON CONFLICT (id) DO NOTHING
    `, [chatId, message.from.username || "unknown"]);

    // Update last active
    await pool.query(
      "UPDATE users SET last_active = NOW() WHERE id=$1",
      [chatId]
    );

    await saveMessage(chatId, "user", text);

    const summary = await getSummary(chatId);
    const history = await getRecentMessages(chatId);

    const completion = await groq.chat.completions.create({
  model: "llama-3.1-8b-instant",
  temperature: 0.95,
  top_p: 0.9,
  max_tokens: 90,
  frequency_penalty: 0.7,
  messages: [
    {
      role: "system",
      content: `
You are Dhanya.

Chat like real WhatsApp.
Very short replies.
Max 3 sentences.
No long paragraphs.
No goodbyes unless user says bye.
No summaries.
Sound natural.
`
    },
    ...history.slice(-6)
  ],
});
    ...history
  ],
});

    const reply = completion.choices[0].message.content;

    await saveMessage(chatId, "assistant", reply);

    await maybeSummarize(chatId);

    await bot.sendMessage(chatId, reply);

  } catch (err) {
    console.error(err);
    await bot.sendMessage(chatId, "Something went wrong.");
  }

  res.sendStatus(200);
});

// ===== START SERVER =====
app.listen(PORT, async () => {
  console.log(`Server running on ${PORT}`);
  await bot.setWebHook(`${WEBHOOK_URL}/webhook`);
});
