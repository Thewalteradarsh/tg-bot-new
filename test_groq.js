require("dotenv").config();
const Groq = require("groq-sdk");

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

async function test() {
  const chat = await groq.chat.completions.create({
    model: "llama-3.1-8b-instant",
    messages: [
      { role: "user", content: "Say hi romantically" }
    ],
  });

  console.log(chat.choices[0].message.content);
}

test();
