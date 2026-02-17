import express from "express";
import axios from "axios";
import dotenv from "dotenv";
import Groq from "groq-sdk";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const app = express();
app.use(express.json());

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const ADMIN_ID = "6047789819";

const groq = new Groq({ apiKey: GROQ_API_KEY });
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

/* =========================
   SEND MESSAGE
========================= */
async function sendMessage(chatId, text) {
  await axios.post(`${TELEGRAM_API}/sendMessage`, {
    chat_id: chatId,
    text,
  });
}

/* =========================
   ADMIN PANEL
========================= */
async function handleAdmin(chatId) {
  const { count: users } = await supabase
    .from("users")
    .select("*", { count: "exact", head: true });

  const { count: active24h } = await supabase
    .from("users")
    .select("*", { count: "exact", head: true })
    .gt("last_active", new Date(Date.now() - 86400000).toISOString());

  const report = `
📊 Admin Dashboard

Users: ${users}
Active (24h): ${active24h}
`;

  await sendMessage(chatId, report.trim());
}

/* =========================
   TOPIC INITIATOR
========================= */
function randomTopic() {
  const topics = [
    "Miss me today?",
    "Tell me one secret.",
    "Why are you quiet?",
    "Are you thinking about someone?",
    "What’s your mood right now?"
  ];
  return topics[Math.floor(Math.random() * topics.length)];
}

/* =========================
   WEBHOOK
========================= */
app.post("/webhook", async (req, res) => {
  try {
    const message = req.body.message;
    if (!message || !message.text) return res.sendStatus(200);

    const chatId = String(message.chat.id);
    const text = message.text.trim();

    /* ===== ADMIN CHECK ===== */
    /* ===== ADMIN CHECK ===== */
if (text === "/admin" && Number(chatId) === ADMIN_ID) {

  const { count: userCount } = await supabase
    .from("users")
    .select("*", { count: "exact", head: true });

  const report = `
📊 Admin Dashboard

Users: ${userCount || 0}
`;

  await bot.sendMessage(chatId, report);

  return res.sendStatus(200); // VERY IMPORTANT
}

    /* ===== GET OR CREATE USER ===== */
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
          last_active: new Date().toISOString(),
        })
        .select()
        .single();
      user = data;
    }

    await supabase
      .from("users")
      .update({ last_active: new Date().toISOString() })
      .eq("id", chatId);

    /* ===== TOPIC INITIATOR ===== */
    if (text.toLowerCase() === "start topic") {
      await sendMessage(chatId, randomTopic());
      return res.sendStatus(200);
    }

    /* ===== AI RESPONSE ===== */
    const completion = await groq.chat.completions.create({
      model: "llama3-70b-8192",
      messages: [
        {
          role: "system",
          content: `
You are Dhanya.
Short replies only.
1–3 lines max.
No long paragraphs.
Natural WhatsApp tone.
Slight ego allowed.
`
        },
        { role: "user", content: text }
      ],
    });

    const reply = completion.choices[0].message.content;

    await sendMessage(chatId, reply);

    return res.sendStatus(200);
  } catch (err) {
    console.error(err);
    return res.sendStatus(200);
  }
});

/* =========================
   START SERVER
========================= */
app.listen(3000, () => {
  console.log("Bot running...");
});
