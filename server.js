require("dotenv").config();

const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");

const supabase = require("./supabaseClient");
const generateQuote = require("./generateQuote");
const analyzePlumbingPhoto = require("./analyzePlumbingPhoto");

const app = express();
app.use(bodyParser.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

////////////////////////////////////////////////////
// Webhook verification
////////////////////////////////////////////////////

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

////////////////////////////////////////////////////
// Receive WhatsApp messages
////////////////////////////////////////////////////

app.post("/webhook", async (req, res) => {

  console.log("Incoming:", JSON.stringify(req.body, null, 2));

  try {

    const message =
      req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (!message) {
      return res.sendStatus(200);
    }

    const from = message.from;

    const text =
      message.text?.body ||
      message.interactive?.button_reply?.id ||
      "";

    let replyText = "";

////////////////////////////////////////////////////
// BUTTON CLICK: SEND PHOTO
////////////////////////////////////////////////////

    if (text === "send_photo") {

      replyText =
"📷 Please send a clear photo of the plumbing problem.";

    }

////////////////////////////////////////////////////
// CUSTOMER SENT IMAGE
////////////////////////////////////////////////////

    else if (message.type === "image") {

      const imageId = message.image.id;

      console.log("Image received:", imageId);

      // Get image URL from WhatsApp
      const imageResponse = await axios.get(
        `https://graph.facebook.com/v18.0/${imageId}`,
        {
          headers: {
            Authorization: `Bearer ${WHATSAPP_TOKEN}`
          }
        }
      );

      const imageUrl = imageResponse.data.url;

      console.log("Image URL:", imageUrl);

      // Send image to AI
      const problem = await analyzePlumbingPhoto(imageUrl);

      console.log("AI detected problem:", problem);

      const quote = generateQuote(problem);

      replyText =
`PipePal AI Diagnosis

Problem detected:
${problem}

Estimated repair cost:
R${quote.totalLow} – R${quote.totalHigh}

Reply YES to book a plumber.`;

    }

////////////////////////////////////////////////////
// NORMAL TEXT MESSAGE
////////////////////////////////////////////////////

    else {

      replyText =
"👋 Hi! I'm PipePal.\n\nYou can describe your plumbing problem or send a photo.";

      // Send photo button
      await axios.post(
        `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
        {
          messaging_product: "whatsapp",
          to: from,
          type: "interactive",
          interactive: {
            type: "button",
            body: {
              text: replyText
            },
            action: {
              buttons: [
                {
                  type: "reply",
                  reply: {
                    id: "send_photo",
                    title: "📷 Send Photo"
                  }
                }
              ]
            }
          }
        },
        {
          headers: {
            Authorization: `Bearer ${WHATSAPP_TOKEN}`,
            "Content-Type": "application/json"
          }
        }
      );

      return res.sendStatus(200);

    }

////////////////////////////////////////////////////
// SEND NORMAL MESSAGE RESPONSE
////////////////////////////////////////////////////

    await axios.post(
      `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to: from,
        text: {
          body: replyText
        }
      },
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    );

  }

  catch (error) {

    console.error(
      "Webhook error:",
      error.response?.data || error.message
    );

  }

  res.sendStatus(200);

});

////////////////////////////////////////////////////
// Root route
////////////////////////////////////////////////////

app.get("/", (req, res) => {
  res.send("PipePal backend running");
});

////////////////////////////////////////////////////
// Start server
////////////////////////////////////////////////////

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});