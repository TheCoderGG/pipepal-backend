const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_KEY
});

async function detectProblem(text) {

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: "You are a plumbing assistant. Detect the plumbing problem type."
      },
      {
        role: "user",
        content: text
      }
    ]
  });

  return response.choices[0].message.content.toLowerCase();
}

module.exports = detectProblem;