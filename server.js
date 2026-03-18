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
// WEBHOOK VERIFY
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
// MAIN WEBHOOK
////////////////////////////////////////////////////

app.post("/webhook", async (req, res) => {
  console.log("Incoming:", JSON.stringify(req.body, null, 2));

  try {
    const message =
      req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (!message) return res.sendStatus(200);

    const from = message.from;

    const text =
      message.text?.body?.toLowerCase() ||
      message.interactive?.button_reply?.id ||
      "";

    ////////////////////////////////////////////////////
    // LOAD SESSION
    ////////////////////////////////////////////////////

    let { data: session } = await supabase
      .from("job_sessions")
      .select("*")
      .eq("customer_phone", from)
      .single();

    if (!session) {
      await supabase.from("job_sessions").insert([
        {
          customer_phone: from,
          step: 0,
          answers: {}
        }
      ]);

      session = { step: 0, answers: {} };
    }

    ////////////////////////////////////////////////////
    // IMAGE HANDLING (AI BOOST)
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

      await sendWhatsApp(from, "🔎 Analyzing photo...");

      const aiProblem = await analyzePlumbingPhoto(imageUrl);

      await supabase
        .from("job_sessions")
        .update({
          problem_type: aiProblem,
          step: 1
        })
        .eq("customer_phone", from);

      await sendWhatsApp(
        from,
`I detected: ${aiProblem}

Let me ask a few quick questions to give you an accurate quote.`
      );

      return res.sendStatus(200);
    }

    ////////////////////////////////////////////////////
    // STEP 0 – SELECT PROBLEM TYPE
    ////////////////////////////////////////////////////

    if (session.step === 0) {

      await sendWhatsApp(
        from,
`👋 Hi! I'm PipePal ZA

What is the problem?

1️⃣ Leak
2️⃣ Blocked drain
3️⃣ Geyser
4️⃣ Tap`
      );

      await supabase
        .from("job_sessions")
        .update({ step: 1 })
        .eq("customer_phone", from);

      return res.sendStatus(200);
    }

    ////////////////////////////////////////////////////
    // STEP 1 – SAVE PROBLEM TYPE
    ////////////////////////////////////////////////////

    if (session.step === 1 && !session.problem_type) {

  const problemMap = {
    "1": "leak",
    "2": "blocked",
    "3": "geyser",
    "4": "tap"
  };

  const problem = problemMap[text] || text;

  await supabase
    .from("job_sessions")
    .update({
      problem_type: problem,
      step: 2
    })
    .eq("customer_phone", from);

  // ✅ IMMEDIATE RESPONSE
  await sendWhatsApp(
    from,
    "Got it 👍 Let me ask a few quick questions to give you an accurate quote."
  );

  // ✅ IMPORTANT: DO NOT RETURN YET
  session.problem_type = problem;
  session.step = 2;
}

    ////////////////////////////////////////////////////
    // DYNAMIC QUESTIONS
    ////////////////////////////////////////////////////

    if (session.step >= 2) {

  if (!session.problem_type) {
    await sendWhatsApp(from, "Please choose a problem first.");
    return res.sendStatus(200);
  }

  const { data: questions } = await supabase
    .from("questions")
    .select("*")
    .eq("problem_type", session.problem_type)
    .order("step", { ascending: true });

  if (!questions || questions.length === 0) {
    await sendWhatsApp(from, "No questions configured yet.");
    return res.sendStatus(200);
  }
  {

      const { data: questions } = await supabase
        .from("questions")
        .select("*")
        .eq("problem_type", session.problem_type)
        .order("step", { ascending: true });

      const questionIndex = session.step - 2;

      // SAVE previous answer
      if (questions[questionIndex - 1]) {

        const field = questions[questionIndex - 1].field;

        const updatedAnswers = {
          ...session.answers,
          [field]: text
        };

        await supabase
          .from("job_sessions")
          .update({
            answers: updatedAnswers
          })
          .eq("customer_phone", from);

        session.answers = updatedAnswers;
      }

      // ASK NEXT QUESTION
      if (questions[questionIndex]) {

        await sendWhatsApp(from, questions[questionIndex].question);

        await supabase
          .from("job_sessions")
          .update({ step: session.step + 1 })
          .eq("customer_phone", from);

        return res.sendStatus(200);
      }

      ////////////////////////////////////////////////////
      // GENERATE FINAL QUOTE
      ////////////////////////////////////////////////////

      const quote = generateQuote(session.problem_type, session.answers);

      if (!quote) {
        await sendWhatsApp(from, "I need a bit more info.");
        return res.sendStatus(200);
      }

      await sendWhatsApp(
        from,
`💰 PipePal Estimate

Problem: ${session.problem_type}

Estimated:
R${quote.totalLow} – R${quote.totalHigh}

Reply YES to book a plumber.`
      );

      await supabase
        .from("job_sessions")
        .update({ step: 99 })
        .eq("customer_phone", from);

      return res.sendStatus(200);
    }

    ////////////////////////////////////////////////////
    // BOOKING
    ////////////////////////////////////////////////////

    if (text === "yes") {

      await sendWhatsApp(
        from,
"When would you like the plumber?\n1️⃣ Tomorrow morning\n2️⃣ Afternoon"
      );

      return res.sendStatus(200);
    }

 } catch (error) {
  console.error("FULL ERROR:", error);
}

  res.sendStatus(200);
});

////////////////////////////////////////////////////
// ROOT
////////////////////////////////////////////////////

app.get("/", (req, res) => {
  res.send("PipePal ZA running");
});

////////////////////////////////////////////////////
// START
////////////////////////////////////////////////////

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});