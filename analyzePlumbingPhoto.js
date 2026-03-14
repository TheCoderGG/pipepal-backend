const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

async function analyzePlumbingPhoto(imageUrl) {

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "You are a plumbing expert. Identify the plumbing issue in this photo. Respond ONLY with one of these: leaking pipe, blocked drain, broken tap, geyser problem, toilet problem."
          },
          {
            type: "image_url",
            image_url: {
              url: imageUrl
            }
          }
        ]
      }
    ]
  });

  return response.choices[0].message.content;

}

module.exports = analyzePlumbingPhoto;