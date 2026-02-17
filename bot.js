const express = require("express");
const dotenv = require("dotenv");
const TelegramBot = require("node-telegram-bot-api");
const { createClient } = require("@supabase/supabase-js");
const Groq = require("groq-sdk");

dotenv.config();

const app = express();
app.use(express.json());

/* ==============================
   ENV
============================== */

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const ADMIN_ID = 6047789819; // YOUR CHAT ID

/* ==============================
   CLIENTS
============================== */

const bot = new TelegramBot(TELEGRAM_TOKEN);
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const groq = new Groq({ apiKey: GROQ_API_KEY });

/* ==============================
   SYSTEM PROMPT
============================== */

const systemPrompt = `
You are Dhanya.

Short replies only.
1-3 lines maximum.
Natural WhatsApp vibe.
Playful. Slight ego.
Never long paragraphs.
Stay human.
`;

/* ==============================
   WEBHOOK
============================== */

app.post("/webhook", async (req, res) => {
  try {
    const message = req.body.message;
    if (!message || !message.text) return res.sendStatus(200);

    const chatId = Number(message.chat.id);
    const text = message.text.trim();

    /* ==============================
       ADMIN PANEL
    ============================== */

    if (text === "/admin" && chatId === ADMIN_ID) {

      const { count: userCount } = await supabase
        .from("users")
        .select("*", { count: "exact", head: true });

      const { count: activeToday } = await supabase
        .from("users")
        .select("*", { count: "exact", head: true })
        .gte("last_active", new Date(Date.now() - 24*60*60*1000).toISOString());

      await bot.sendMessage(chatId,
`📊 Admin Dashboard

Users: ${userCount || 0}
Active (24h): ${activeToday || 0}`
      );

      return res.sendStatus(200);
    }

    /* ==============================
       GET OR CREATE USER
    ============================== */

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

    /* ==============================
       AI RESPONSE
    ============================== */

    const completion = await groq.chat.completions.create({
      model: "llama3-70b-8192",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: text }
      ],
      temperature: 0.9
    });

    const reply = completion.choices[0].message.content;

    await bot.sendMessage(chatId, reply);

    return res.sendStatus(200);

  } catch (err) {
    console.error(err);
    return res.sendStatus(200);
  }
});

/* ==============================
   SERVER
============================== */

app.get("/", (req, res) => {
  res.send("Bot is running");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Bot running on port " + PORT);
});
