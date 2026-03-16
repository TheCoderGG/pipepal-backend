require("dotenv").config();

const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const cron = require("node-cron");

const supabase = require("./supabaseClient");
const generateQuote = require("./generateQuote");
const analyzePlumbingPhoto = require("./analyzePlumbingPhoto");

const app = express();
app.use(bodyParser.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

////////////////////////////////////////////////////
// Utility delay
////////////////////////////////////////////////////

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

////////////////////////////////////////////////////
// Webhook verification
////////////////////////////////////////////////////

app.get("/webhook", (req, res) => {

  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("Webhook verified");
    return res.status(200).send(challenge);
  }

  res.sendStatus(403);

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
      message.text?.body?.toLowerCase() ||
      message.interactive?.button_reply?.id ||
      "";

    ////////////////////////////////////////////////////
    // Cancel followups if user replies
    ////////////////////////////////////////////////////

    await supabase
      .from("followups")
      .delete()
      .eq("customer_phone", from);

    ////////////////////////////////////////////////////
    // IMAGE MESSAGE
    ////////////////////////////////////////////////////

    if (message.type === "image") {

      const imageId = message.image.id;

      const imageResponse = await axios.get(
        `https://graph.facebook.com/v18.0/${imageId}`,
        {
          headers: {
            Authorization: `Bearer ${WHATSAPP_TOKEN}`
          }
        }
      );

      const imageUrl = imageResponse.data.url;

      await axios.post(
        `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
        {
          messaging_product: "whatsapp",
          to: from,
          text: { body: "🔎 Analyzing plumbing photo..." }
        },
        {
          headers: {
            Authorization: `Bearer ${WHATSAPP_TOKEN}`,
            "Content-Type": "application/json"
          }
        }
      );

      await wait(2000);

      const problem = await analyzePlumbingPhoto(imageUrl);

      const quote = generateQuote(problem);

      const replyText = `PipePal Diagnosis

Problem detected:
${problem}

Estimated repair cost:
R${quote.totalLow} – R${quote.totalHigh}

Reply YES to book the job.`;

      await axios.post(
        `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
        {
          messaging_product: "whatsapp",
          to: from,
          text: { body: replyText }
        },
        {
          headers: {
            Authorization: `Bearer ${WHATSAPP_TOKEN}`,
            "Content-Type": "application/json"
          }
        }
      );

      await supabase
        .from("followups")
        .insert([{ customer_phone: from, sent: false }]);

      return res.sendStatus(200);

    }

////////////////////////////////////////////////////
// SEND PHOTO BUTTON CLICK
////////////////////////////////////////////////////

if (text === "send_photo") {

  await sendWhatsApp(
    from,
    "📷 Please send a clear photo of the plumbing problem."
  );

  return res.sendStatus(200);

}

    ////////////////////////////////////////////////////
    // BOOKING FLOW
    ////////////////////////////////////////////////////

    if (text === "yes") {

      const reply =
`Great 👍 When would you like the plumber to come?

1️⃣ Tomorrow morning (08:00–10:00)
2️⃣ Tomorrow afternoon (13:00–15:00)
3️⃣ Friday morning (08:00–10:00)`;

      await sendWhatsApp(from, reply);

      return res.sendStatus(200);

    }

    if (text === "1") {

      await supabase
        .from("appointments")
        .insert([
          {
            customer_phone: from,
            appointment_time: "Tomorrow 08:00–10:00"
          }
        ]);

      const { data: plumber } = await supabase
        .from("plumber_profile")
        .select("*")
        .limit(1)
        .single();

      await sendWhatsApp(
        from,
`✅ Appointment booked!

${plumber.name} will contact you shortly.

Plumber phone:
${plumber.phone}`
      );

      await sendWhatsApp(
        plumber.phone,
`🚨 New appointment booked

Customer: ${from}
Time: Tomorrow 08:00–10:00`
      );

      return res.sendStatus(200);

    }

    ////////////////////////////////////////////////////
    // DEFAULT MESSAGE
    ////////////////////////////////////////////////////

    await axios.post(
      `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to: from,
        type: "interactive",
        interactive: {
          type: "button",
          body: {
            text:
"👋 Hi! I'm PipePal.\n\nDescribe your plumbing problem or send a photo."
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

  } catch (error) {

    console.error(
      "Webhook error:",
      error.response?.data || error.message
    );

  }

  res.sendStatus(200);

});

////////////////////////////////////////////////////
// Helper to send WhatsApp messages
////////////////////////////////////////////////////

async function sendWhatsApp(to, text) {

  await axios.post(
    `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      text: { body: text }
    },
    {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json"
      }
    }
  );

}

////////////////////////////////////////////////////
// Follow-up reminder system
////////////////////////////////////////////////////

async function checkFollowUps() {

  const { data: rows } = await supabase
    .from("followups")
    .select("*")
    .eq("sent", false);

  for (const row of rows) {

    const created = new Date(row.created_at);
    const now = new Date();

    const minutes = (now - created) / 1000 / 60;

    if (minutes > 30) {

      await sendWhatsApp(
        row.customer_phone,
"👋 Just checking if you still need help with that plumbing problem. Reply YES to book the job."
      );

      await supabase
        .from("followups")
        .update({ sent: true })
        .eq("id", row.id);

    }

  }

}

////////////////////////////////////////////////////
// Daily schedule
////////////////////////////////////////////////////

async function sendDailySchedule() {

  const today = new Date().toISOString().split("T")[0];

  const { data: jobs } = await supabase
    .from("appointments")
    .select("*")
    .gte("created_at", today);

  if (!jobs || jobs.length === 0) return;

  let schedule = "📅 PipePal Daily Job List\n\n";

  for (const job of jobs) {

    schedule += `${job.appointment_time}
Customer: ${job.customer_phone}

`;

  }

  const { data: plumber } = await supabase
    .from("plumber_profile")
    .select("*")
    .limit(1)
    .single();

  await sendWhatsApp(plumber.phone, schedule);

}

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

setInterval(checkFollowUps, 600000);

cron.schedule("0 6 * * *", () => {
  console.log("Sending PipePal daily schedule...");
  sendDailySchedule();
});