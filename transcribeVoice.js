const OpenAI = require("openai");
const fs = require("fs");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

async function transcribeVoice(audioPath) {

  const transcription = await openai.audio.transcriptions.create({
    file: fs.createReadStream(audioPath),
    model: "gpt-4o-mini-transcribe"
  });

  return transcription.text;

}

module.exports = transcribeVoice;