import express from "express";
import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";
import Groq from "groq-sdk";
import dotenv from "dotenv";

dotenv.config();

console.log("Smart Emotional Engine Activated 🚀");

const app = express();
app.use(express.json());

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN_ID = "6047789819";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const groq = new Groq({ apiKey: GROQ_API_KEY });

/* =========================
   UTILS
========================= */

function clamp(num, min, max) {
  return Math.min(Math.max(num, min), max);
}

function detectInsult(text) {
  const insults = ["fuck", "stupid", "idiot", "loser", "bitch"];
  return insults.some(word => text.toLowerCase().includes(word));
}

function detectJealousy(text) {
  const triggers = ["other girl", "another girl", "she", "my friend"];
  return triggers.some(word => text.toLowerCase().includes(word));
}

/* =========================
   EMOTIONAL ENGINE
========================= */

async function updateAttachment(user, text) {
  let score = user.attachment_score || 20;

  if (detectInsult(text)) score -= 5;
  if (text.toLowerCase().includes("love")) score += 4;
  if (text.toLowerCase().includes("sorry")) score += 5;
  if (text.toLowerCase().includes("miss")) score += 3;

  score = clamp(score, 0, 100);

  await supabase
    .from("users")
    .update({ attachment_score: score })
    .eq("id", user.id);

  return score;
}

async function updateMood(user, text) {
  let mood = user.mood_state || "neutral";
  let counter = user.mood_counter || 0;

  if (detectInsult(text)) {
    mood = "angry";
    counter = 8;
  } else if (detectJealousy(text)) {
    mood = "jealous";
    counter = 5;
  } else if (counter > 0) {
    counter -= 1;
  }

  await supabase
    .from("users")
    .update({ mood_state: mood, mood_counter: counter })
    .eq("id", user.id);

  return mood;
}

/* =========================
   ADMIN DASHBOARD
========================= */

async function handleAdmin(chatId, res) {

  const { count: totalUsers } = await supabase
    .from("users")
    .select("*", { count: "exact", head: true });

  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { count: dailyActive } = await supabase
    .from("users")
    .select("*", { count: "exact", head: true })
    .gt("last_active", dayAgo);

  const { data: users } = await supabase
    .from("users")
    .select("attachment_score");

  const avgAttachment =
    users.reduce((sum, u) => sum + (u.attachment_score || 0), 0) /
    (users.length || 1);

  const message =
`Users: ${totalUsers}
DAU: ${dailyActive}
Avg Attachment: ${Math.round(avgAttachment)}`;

  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: message
    })
  });

  return res.sendStatus(200);
}

/* =========================
   TOPIC INITIATOR
========================= */

async function runTopicInitiator() {

  const fourHoursAgo =
    new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();

  const { data: users } = await supabase
    .from("users")
    .select("*")
    .lt("last_active", fourHoursAgo);

  if (!users) return;

  for (const user of users) {

    const attachment = user.attachment_score || 20;

    let message = "";

    if (attachment < 30) {
      message = "So you just disappear now?";
    } else if (attachment < 70) {
      message = "You're quiet today. Busy or ignoring me?";
    } else {
      message = "You really think I won’t notice when you vanish?";
    }

    await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: user.id,
        text: message
      })
    });

    await supabase
      .from("users")
      .update({ last_initiated_at: new Date().toISOString() })
      .eq("id", user.id);
  }
}

/* =========================
   WEBHOOK
========================= */

app.post("/webhook", async (req, res) => {
  try {
    const message = req.body.message;
    if (!message || !message.text) return res.sendStatus(200);

    const chatId = String(message.chat.id);
    const text = message.text;
// ===== ADMIN PANEL =====
if (text === "/admin" && chatId === ADMIN_ID) {

  const users = await pool.query("SELECT COUNT(*) FROM users");
  const messages = await pool.query("SELECT COUNT(*) FROM messages");
  const activeToday = await pool.query(`
    SELECT COUNT(*) FROM users 
    WHERE last_active > NOW() - INTERVAL '1 day'
  `);

  const report = `
📊 Admin Dashboard

Users: ${users.rows[0].count}
Messages: ${messages.rows[0].count}
Active (24h): ${activeToday.rows[0].count}
  `;

  await bot.sendMessage(chatId, report);
  return res.sendStatus(200);
}

    if (text === "/admin" && chatId === ADMIN_ID) {
      return handleAdmin(chatId, res);
    }

    let { data: user } = await supabase
      .from("users")
      .select("*")
      .eq("id", chatId)
      .single();

    if (!user) {
      const { data } = await supabase
        .from("users")
        .insert({
          id: chatId,
          attachment_score: 20,
          mood_state: "neutral",
          mood_counter: 0,
          last_active: new Date().toISOString()
        })
        .select()
        .single();
      user = data;
    }

    const attachment = await updateAttachment(user, text);
    const mood = await updateMood(user, text);

    await supabase
      .from("users")
      .update({ last_active: new Date().toISOString() })
      .eq("id", chatId);

    const systemPrompt = `
You are Dhanya.

Short replies only.
1-3 sentences.
Rarely 4 if emotionally intense.
Never long paragraphs.

Personality:
Confident. Playful. Slightly egoistic.
If insulted, respond with attitude.
Never log off unless user says bye.

Attachment: ${attachment}
Mood: ${mood}

Stay human.
`;

    const completion = await groq.chat.completions.create({
      model: "mixtral-8x7b-32768",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: text }
      ],
      temperature: 0.9,
      max_tokens: 80
    });

    const reply = completion.choices[0].message.content;

    await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: reply
      })
    });

    res.sendStatus(200);

  } catch (err) {
    console.error(err);
    res.sendStatus(500);
  }
});

/* =========================
   SCHEDULER
========================= */

setInterval(() => {
  runTopicInitiator();
}, 15 * 60 * 1000);

app.listen(process.env.PORT || 10000, () => {
  console.log("Server running 🚀");
});
