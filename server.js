require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const supabase = require("./supabaseClient");
const generateQuote = require("./generateQuote");

const app = express();
app.use(bodyParser.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

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

app.post("/webhook", async (req, res) => {

  console.log("Incoming:", JSON.stringify(req.body, null, 2));

  try {

    const message =
      req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (message) {

      const from = message.from;
      const text =
  message.text?.body ||
  message.interactive?.button_reply?.id ||
  "";

      console.log("Customer:", from);
      console.log("Message:", text);

      let replyText = "";

      // Detect basic plumbing problem
      let problem = "unknown";

      if (text.toLowerCase().includes("blocked"))
        problem = "blocked drain";

      if (text.toLowerCase().includes("leak"))
        problem = "leaking pipe";

      if (text.toLowerCase().includes("geyser"))
        problem = "geyser problem";

      if (text.toLowerCase().includes("tap"))
        problem = "tap problem";

      // CHECK IF SESSION EXISTS
      const { data: session } = await supabase
        .from("job_sessions")
        .select("*")
        .eq("customer_phone", from)
        .single();

      // START NEW SESSION
      if (!session && problem !== "unknown") {

        await supabase
          .from("job_sessions")
          .insert([
            {
              customer_phone: from,
              problem_type: problem,
              stage: "question1"
            }
          ]);

        replyText =
`Where is the problem?

1 Under sink
2 Wall pipe
3 Outside pipe
4 Ceiling`;

      }

      // QUESTION 1 ANSWERED
      else if (session && session.stage === "question1") {

        await supabase
          .from("job_sessions")
          .update({
            answer1: text,
            stage: "question2"
          })
          .eq("customer_phone", from);

        replyText =
`How serious is the problem?

1 Dripping
2 Steady leak
3 Pipe burst`;

      }

      // QUESTION 2 ANSWERED → GENERATE QUOTE
      else if (session && session.stage === "question2") {

        await supabase
          .from("job_sessions")
          .update({
            answer2: text,
            stage: "quote_sent"
          })
          .eq("customer_phone", from);

        const quote = generateQuote(session.problem_type);

        await supabase
          .from("quotes")
          .insert([
            {
              customer_phone: from,
              problem_type: session.problem_type,
              materials_estimate: quote.materials,
              callout_fee: quote.callout,
              total_low: quote.totalLow,
              total_high: quote.totalHigh
            }
          ]);

        replyText =
`PipePal Estimate

Issue: ${session.problem_type}

Call-out: R${quote.callout}
Materials: R${quote.materials}

Estimated Total:
R${quote.totalLow} – R${quote.totalHigh}

Reply YES to book the job.`;

      }

      else {

        replyText =
"👋 Hi! Please describe your plumbing problem (leak, blocked drain, geyser etc).";

      }

      // SEND MESSAGE BACK TO WHATSAPP
      await axios.post(
        `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
        {
          messaging_product: "whatsapp",
          to: from,
          text: {
            body: replyText,
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

app.get("/", (req, res) => {
  res.send("PipePal backend running");
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});