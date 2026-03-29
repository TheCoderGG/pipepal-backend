const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

async function analyzePlumbingPhoto(imageUrl) {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "You are a plumbing expert. Analyze this photo and identify the plumbing problem in one short sentence. Be specific — e.g. 'burst pipe under sink', 'blocked shower drain', 'leaking geyser valve'."
            },
            {
              type: "image_url",
              image_url: { url: imageUrl }
            }
          ]
        }
      ],
      max_tokens: 100
    });

    const result = response.choices[0].message.content.trim();
    console.log("📸 Photo analysis result:", result);
    return result;

  } catch (err) {
    console.error("❌ analyzePlumbingPhoto failed:", err.message);
    return "unknown plumbing issue";
  }
}

module.exports = analyzePlumbingPhoto;
