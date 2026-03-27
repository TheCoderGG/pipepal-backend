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

    if (!message) {
      console.log("⚠️ Status update");
      return res.sendStatus(200);
    }

    const from = message.from;

    const text =
      message.text?.body?.toLowerCase().trim() ||
      message.interactive?.button_reply?.id ||
      "";

    console.log("FROM:", from);
    console.log("TEXT:", text);
    console.log("TYPE:", message.type);

    ////////////////////////////////////////////////////
    // LOAD SESSION
    ////////////////////////////////////////////////////

    let { data: session } = await supabase
      .from("job_sessions")
      .select("*")
      .eq("customer_phone", from)
      .single();

    // BUG FIX 1: Reset session on greeting words or if no session exists
    if (!session || text === "restart" || text === "reset" || text === "hi" || text === "hello") {

      if (session) {
        await supabase
          .from("job_sessions")
          .update({ step: 0, answers: {}, problem_type: null, ai_detected: null })
          .eq("customer_phone", from);
      } else {
        await supabase.from("job_sessions").insert([
          {
            customer_phone: from,
            step: 0,
            answers: {}
          }
        ]);
      }

      session = { step: 0, answers: {} };
    }

    ////////////////////////////////////////////////////
    // STEP 0 — GREETING (BUTTONS)
    ////////////////////////////////////////////////////

    if (session.step === 0) {

      await sendButtons(from, "👋 Hi! I'm PipePal ZA 🇿🇦\n\nWhat problem do you have?", [
        { id: "leak", title: "Leak" },
        { id: "blocked", title: "Blocked drain" },
        { id: "geyser", title: "Geyser" }
      ]);

      await supabase
        .from("job_sessions")
        .update({ step: 1 })
        .eq("customer_phone", from);

      return res.sendStatus(200);
    }

    ////////////////////////////////////////////////////
    // STEP 1 — PROBLEM TYPE
    ////////////////////////////////////////////////////

    if (session.step === 1) {

      await supabase
        .from("job_sessions")
        .update({
          problem_type: text,
          step: 2
        })
        .eq("customer_phone", from);

      await sendWhatsApp(from, "Got it 👍 Let me ask a few quick questions...");

      return res.sendStatus(200);
    }

    ////////////////////////////////////////////////////
    // IMAGE HANDLING — BUG FIX 4: guard with step >= 2
    ////////////////////////////////////////////////////

    if (message.type === "image" && session.step >= 2) {

      const imageId = message.image.id;

      const imageRes = await axios.get(
        `https://graph.facebook.com/v18.0/${imageId}`,
        {
          headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` }
        }
      );

      const imageUrl = imageRes.data.url;

      await sendWhatsApp(from, "🔎 Analyzing your photo...");

      const detectedProblem = await analyzePlumbingPhoto(imageUrl);

      await supabase
        .from("job_sessions")
        .update({
          ai_detected: detectedProblem
        })
        .eq("customer_phone", from);

      await sendWhatsApp(
        from,
        `I detected: ${detectedProblem}\n\nLet me confirm a few details...`
      );

      return res.sendStatus(200);
    }

    ////////////////////////////////////////////////////
    // DYNAMIC QUESTIONS
    ////////////////////////////////////////////////////

    if (session.step >= 2 && session.step < 99) {

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

      // BUG FIX 3: Save answer for ALL questions (index >= 0, not > 0)
      if (index >= 0 && questions[index - 1]) {

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

      // ASK NEXT QUESTION
      if (questions[index]) {

        await sendWhatsApp(from, questions[index].question);

        await supabase
          .from("job_sessions")
          .update({ step: session.step + 1 })
          .eq("customer_phone", from);

        return res.sendStatus(200);
      }

		console.log("SESSION:", session);
		console.log("QUESTIONS:", questions);
      ////////////////////////////////////////////////////
      // ALL QUESTIONS DONE — save last answer, then quote
      ////////////////////////////////////////////////////

      if (questions[index - 1]) {
        const field = questions[index - 1].field;
        const updatedAnswers = { ...session.answers, [field]: text };
        await supabase
          .from("job_sessions")
          .update({ answers: updatedAnswers })
          .eq("customer_phone", from);
        session.answers = updatedAnswers;
      }

      const aiProblem = session.ai_detected || session.problem_type;

      const quote = generateQuote(aiProblem, session.answers);

      await sendWhatsApp(
        from,
`💰 PipePal Estimate

Problem: ${aiProblem}

Estimated:
R${quote.totalLow} – R${quote.totalHigh}

Reply YES to book or RESTART to start over`
      );

      await supabase
        .from("job_sessions")
        .update({ step: 99 })
        .eq("customer_phone", from);

      return res.sendStatus(200);
    }

    ////////////////////////////////////////////////////
    // BOOKING — BUG FIX 2: step 99 and 100 properly handled
    ////////////////////////////////////////////////////

    if (session.step === 99) {

      if (text === "yes") {

        await sendButtons(from, "When should we come?", [
          { id: "morning", title: "Morning" },
          { id: "afternoon", title: "Afternoon" }
        ]);

        await supabase
          .from("job_sessions")
          .update({ step: 100 })
          .eq("customer_phone", from);

        return res.sendStatus(200);
      }
    }

    if (session.step === 100) {

      const timeSlot = text; // "morning" or "afternoon" from button reply

      await supabase
        .from("job_sessions")
        .update({ time_slot: timeSlot, step: 101 })
        .eq("customer_phone", from);

      await sendWhatsApp(
        from,
        `✅ Booked! A plumber will contact you to confirm your ${timeSlot} appointment.\n\nThank you for using PipePal ZA 🇿🇦`
      );

      return res.sendStatus(200);
    }

  } catch (error) {
    console.error("❌ ERROR:", error);
  }

  res.sendStatus(200);
});

////////////////////////////////////////////////////
// SEND TEXT
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
// SEND BUTTONS
////////////////////////////////////////////////////

async function sendButtons(to, text, buttons) {

  await axios.post(
    `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text },
        action: {
          buttons: buttons.map(b => ({
            type: "reply",
            reply: {
              id: b.id,
              title: b.title
            }
          }))
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
}

////////////////////////////////////////////////////
// ROOT
////////////////////////////////////////////////////

app.get("/", (req, res) => {
  res.send("PipePal running");
});

////////////////////////////////////////////////////
// START
////////////////////////////////////////////////////

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
