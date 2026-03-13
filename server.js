require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const supabase = require("./supabaseClient");
const generateQuote = require("./generateQuote");
const analyzePlumbingPhoto = require("./analyzePlumbingPhoto");
const app = express();
const transcribeVoice = require("./transcribeVoice");
const fs = require("fs");
app.use(bodyParser.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

// Webhook verification
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("Webhook verified");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// Receive WhatsApp messages
app.post("/webhook", async (req, res) => {

  console.log("Incoming:", JSON.stringify(req.body, null, 2));

  try {

    // Extract message from WhatsApp webhook JSON
    const message =
      req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
	  
	  if (message?.type === "image") {

  const imageId = message.image.id;

  console.log("Customer sent image:", imageId);

}    if (message) {

      const from = message.from;
      const text = message.text?.body || "";
	  let problem = "unknown";

if (text.toLowerCase().includes("blocked"))
  problem = "blocked drain";

if (text.toLowerCase().includes("leak"))
  problem = "leaking pipe";

if (text.toLowerCase().includes("geyser"))
  problem = "geyser problem";

if (text.toLowerCase().includes("tap"))
  problem = "tap problem";

const quote = generateQuote(problem);
if (quote) {

  await supabase
    .from("quotes")
    .insert([
      {
        customer_phone: from,
        problem_type: problem,
        materials_estimate: quote.materials,
        callout_fee: quote.callout,
        total_low: quote.totalLow,
        total_high: quote.totalHigh
      }
	  
if (message?.type === "audio") {

  const audioId = message.audio.id;

  console.log("Customer sent voice note:", audioId);

}
    ]);

}

      console.log("Customer:", from);
      console.log("Message:", text);

      // Save message to Supabase database
      await supabase
        .from("messages")
        .insert([
          {
            customer_phone: from,
            message_text: text,
            message_type: "text",
            direction: "incoming"
          }
        ]);

      // Update conversation list
      await supabase
        .from("conversations")
        .upsert({
          customer_phone: from,
          last_message: text,
          last_message_time: new Date()
        });
		
		let replyText =
		
"👋 Hi! Thanks for contacting PipePal. Please describe your plumbing problem.";

if (quote) {

  replyText =
`PipePal Estimate

Issue: ${problem}

Call-out: R${quote.callout}
Materials: R${quote.materials}

Estimated Total:
R${quote.totalLow} – R${quote.totalHigh}

Reply YES to book the job.`;

}

      // Send reply back to WhatsApp
      await axios.post(
        `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
        {
          messaging_product: "whatsapp",
          to: from,
          text: {
            body: "👋 Hi! Thanks for contacting PipePal. A plumber will assist you shortly.",
          },
        },
        {
          headers: {
            Authorization: `Bearer ${WHATSAPP_TOKEN}`,
            "Content-Type": "application/json",
          },
        }
      );

    }

  } catch (error) {

    console.error(
      "Error processing message:",
      error.response?.data || error.message
    );

  }

  res.sendStatus(200);

});

// Root test route
app.get("/", (req, res) => {
  res.send("PipePal backend running");
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

const audioResponse = await axios.get(
  `https://graph.facebook.com/v18.0/${audioId}`,
  {
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`
    }
  }
);

const audioResponse = await axios.get(
  `https://graph.facebook.com/v18.0/${audioId}`,
  {
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`
    }
  }
);

const audioUrl = audioResponse.data.url;

const audioFile = await axios.get(audioUrl, {
  responseType: "arraybuffer",
  headers: {
    Authorization: `Bearer ${WHATSAPP_TOKEN}`
  }
});

fs.writeFileSync("voice.ogg", audioFile.data);

const text = await transcribeVoice("voice.ogg");

console.log("Voice message text:", text);

const problem = detectPlumbingProblem(text);

const quote = generateQuote(problem);
});