
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
            {
  type: "text",
  text: `You are an expert plumber in South Africa.

Analyze the plumbing issue shown in this photo.

Possible plumbing problems include:
- leaking pipe
- burst pipe
- blocked drain
- overflowing toilet
- broken tap
- geyser leak
- loose pipe joint
- damaged valve
- rusted pipe

Respond ONLY with the most likely plumbing issue in 2–5 words.

Examples:
leaking copper pipe
blocked kitchen drain
geyser pressure valve leak

If the plumbing problem is not clear, respond:
"unclear plumbing issue"`
}
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

  return response.choices[0].message.content.trim().toLowerCase();
  return response.choices[0].message.content;

}

module.exports = analyzePlumbingPhoto;