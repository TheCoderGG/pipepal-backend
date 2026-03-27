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

// 🔥 IMPORTANT: ignore status updates
if (!message) {
  console.log("⚠️ Status update (no message)");
  return res.sendStatus(200);
}

const from = message.from;

const text =
  message.text?.body?.toLowerCase() ||
  message.interactive?.button_reply?.id ||
  "";

  console.log("🔥 MESSAGE RECEIVED");
  console.log("FROM:", from);
  console.log("TEXT:", text);

// 👇 START CONVERSATION IF NEW USER

const { data: session } = await supabase
  .from("job_sessions")
  .select("*")
  .eq("customer_phone", from)
  .single();

// 🆕 No session → start new flow
if (!session) {

  await supabase.from("job_sessions").insert([
    {
      customer_phone: from,
      step: 1,
      answers: {}
    }
  ]);

  await sendWhatsApp(
    from,
`👋 Hi! I'm PipePal ZA 🇿🇦

What problem are you experiencing?

1️⃣ Leak
2️⃣ Blocked drain
3️⃣ Geyser issue
4️⃣ Other`
  );

  return res.sendStatus(200);
}

        //////////////////////////////////////////////////// LOAD SESSION (ONLY ONCE)
		//////////////////////////////////////////

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

  session = {
    step: 0,
    answers: {}
  };
}

    ////////////////////////////////////////////////
    // STEP 0 – GREETING
	///////////////////////////////////////////////////

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
    // STEP 1 – SAVE PROBLEM
    ////////////////////////////////////////////////////

// STEP 1 → user selects problem
if (session.step === 1) {

  let problemType = "";

  if (text === "1") problemType = "leak";
  else if (text === "2") problemType = "blocked";
  else if (text === "3") problemType = "geyser";
  else problemType = "other";

  await supabase
    .from("job_sessions")
    .update({
      problem_type: problemType,
      step: 2
    })
    .eq("customer_phone", from);

  await sendWhatsApp(
    from,
"Got it 👍 Let me ask a few quick questions..."
  );

  return res.sendStatus(200);
}
    ////////////////////////////////////////////////////
    // DYNAMIC QUESTIONS
    ////////////////////////////////////////////////////

    if (session.step >= 2) {

  const { data: questions } = await supabase
    .from("questions")
    .select("*")
    .eq("problem_type", session.problem_type)
    .order("step", { ascending: true });

  if (!questions || questions.length === 0) {
    await sendWhatsApp(from, "No questions configured.");
    return res.sendStatus(200);
  }

  const index = session.step - 2;

  // ✅ SAVE PREVIOUS ANSWER
  if (index > 0 && questions[index - 1]) {

    const field = questions[index - 1].field;

    const updatedAnswers = {
      ...session.answers,
      [field]: text
    };

    await supabase
      .from("job_sessions")
      .update({ answers: updatedAnswers })
      .eq("customer_phone", from);

    session.answers = updatedAnswers;
  }

  // ✅ ASK NEXT QUESTION
  if (questions[index]) {

    await sendWhatsApp(from, questions[index].question);

    await supabase
      .from("job_sessions")
      .update({ step: session.step + 1 })
      .eq("customer_phone", from);

    return res.sendStatus(200);
  }

  // ✅ SAFE QUOTE GENERATION
  const quote = generateQuote(session.problem_type, session.answers);

  if (!quote || !quote.totalLow) {
    await sendWhatsApp(from, "I need a bit more info.");
    return res.sendStatus(200);
  }

  await sendWhatsApp(
    from,
`💰 PipePal Estimate

Problem: ${session.problem_type}

Estimated:
R${quote.totalLow} – R${quote.totalHigh}

Reply YES to book.`
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
        "When would you like the plumber?\n1️⃣ Tomorrow\n2️⃣ Afternoon"
      );

      return res.sendStatus(200);
    }

  } catch (error) {

    console.error("❌ WEBHOOK ERROR:", error);

  }

  res.sendStatus(200);
});

////////////////////////////////////////////////////
// Helper to send WhatsApp messages (DEBUG VERSION)
////////////////////////////////////////////////////

async function sendWhatsApp(to, text) {
  try {
    const response = await axios.post(
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

    console.log("✅ Message sent:", JSON.stringify(response.data, null, 2));

  } catch (err) {

    console.error("❌ SEND ERROR FULL:");

    console.error({
      status: err.response?.status,
      data: err.response?.data,
      message: err.message
    });
  }
}

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