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
      console.log("⚠️ Status update — ignoring");
      return res.sendStatus(200);
    }

    const from = message.from;

    // Button replies come through as-is; text messages are lowercased
    const isButtonReply = !!message.interactive?.button_reply?.id;
    const text = isButtonReply
      ? message.interactive.button_reply.id
      : (message.text?.body?.toLowerCase().trim() || "");

    console.log("FROM:", from);
    console.log("TEXT:", text);
    console.log("IS_BUTTON_REPLY:", isButtonReply);
    console.log("TYPE:", message.type);

    ////////////////////////////////////////////////////
    // LOAD SESSION
    ////////////////////////////////////////////////////

    let { data: session } = await supabase
      .from("job_sessions")
      .select("*")
      .eq("customer_phone", from)
      .single();

    console.log("SESSION LOADED:", JSON.stringify(session));

    const isGreeting = ["hi", "hello", "hey", "start", "restart", "reset"].includes(text);

    if (!session) {
      // No session at all — create a fresh one
      await supabase.from("job_sessions").insert([
        { customer_phone: from, step: 0, answers: {} }
      ]);
      session = { step: 0, answers: {} };
      console.log("SESSION CREATED for:", from);

    } else if (isGreeting) {
      // Session exists but user wants to restart — reset it
      await supabase
        .from("job_sessions")
        .update({ step: 0, answers: {}, problem_type: null, ai_detected: null })
        .eq("customer_phone", from);
      session = { step: 0, answers: {} };
      console.log("SESSION RESET for:", from);
    }

    console.log("CURRENT STEP:", session.step);

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

      console.log("SENT: greeting buttons → step 1");
      return res.sendStatus(200);
    }

    ////////////////////////////////////////////////////
    // STEP 1 — CAPTURE PROBLEM TYPE FROM BUTTON
    ////////////////////////////////////////////////////

    if (session.step === 1) {

      console.log("PROBLEM TYPE SELECTED:", text);

      await supabase
        .from("job_sessions")
        .update({ problem_type: text, step: 2 })
        .eq("customer_phone", from);

      await sendWhatsApp(from, "Got it 👍 Let me ask a few quick questions...");

      console.log("STEP → 2, problem_type:", text);
      return res.sendStatus(200);
    }

    ////////////////////////////////////////////////////
    // IMAGE HANDLING (only after problem type is set)
    ////////////////////////////////////////////////////

    if (message.type === "image" && session.step >= 2) {

      const imageId = message.image.id;

      const imageRes = await axios.get(
        `https://graph.facebook.com/v18.0/${imageId}`,
        { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
      );

      const imageUrl = imageRes.data.url;

      await sendWhatsApp(from, "🔎 Analyzing your photo...");

      const detectedProblem = await analyzePlumbingPhoto(imageUrl);

      await supabase
        .from("job_sessions")
        .update({ ai_detected: detectedProblem })
        .eq("customer_phone", from);

      await sendWhatsApp(from, `I detected: ${detectedProblem}\n\nLet me confirm a few details...`);

      return res.sendStatus(200);
    }

    ////////////////////////////////////////////////////
    // DYNAMIC QUESTIONS (step 2 to 98)
    ////////////////////////////////////////////////////

    if (session.step >= 2 && session.step < 99) {

      console.log("FETCHING QUESTIONS for problem_type:", session.problem_type);

      const { data: questions, error: qError } = await supabase
        .from("questions")
        .select("*")
        .eq("problem_type", session.problem_type)
        .order("step", { ascending: true });

      console.log("QUESTIONS FOUND:", questions?.length ?? 0);
      if (qError) console.log("QUESTIONS ERROR:", qError.message);
      if (questions) console.log("QUESTIONS DATA:", JSON.stringify(questions));

      if (!questions || questions.length === 0) {
        console.log("⚠️ No questions for:", session.problem_type);
        await sendWhatsApp(from, "⚠️ No questions found. Please contact us directly.");
        await supabase
          .from("job_sessions")
          .update({ step: 99 })
          .eq("customer_phone", from);
        return res.sendStatus(200);
      }

      const index = session.step - 2;
      console.log("QUESTION INDEX:", index);

      // Save the answer to the previous question
      if (index > 0 && questions[index - 1]) {
        const field = questions[index - 1].field;
        const updatedAnswers = { ...session.answers, [field]: text };
        await supabase
          .from("job_sessions")
          .update({ answers: updatedAnswers })
          .eq("customer_phone", from);
        session.answers = updatedAnswers;
        console.log("SAVED ANSWER:", field, "=", text);
      }

      // Ask the next question
      if (questions[index]) {
        await sendWhatsApp(from, questions[index].question);
        await supabase
          .from("job_sessions")
          .update({ step: session.step + 1 })
          .eq("customer_phone", from);
        console.log("ASKED:", questions[index].question, "→ step", session.step + 1);
        return res.sendStatus(200);
      }

      ////////////////////////////////////////////////////
      // ALL QUESTIONS DONE — save last answer then quote
      ////////////////////////////////////////////////////

      if (questions[index - 1]) {
        const field = questions[index - 1].field;
        const updatedAnswers = { ...session.answers, [field]: text };
        await supabase
          .from("job_sessions")
          .update({ answers: updatedAnswers })
          .eq("customer_phone", from);
        session.answers = updatedAnswers;
        console.log("SAVED LAST ANSWER:", field, "=", text);
      }

      const aiProblem = session.ai_detected || session.problem_type;
      const quote = generateQuote(aiProblem, session.answers);

      console.log("QUOTE:", JSON.stringify(quote));

      await sendWhatsApp(from,
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

      console.log("QUOTE SENT → step 99");
      return res.sendStatus(200);
    }

    ////////////////////////////////////////////////////
    // STEP 99 — AWAIT YES
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
        console.log("TIME SLOT buttons sent → step 100");
        return res.sendStatus(200);
      }

      await sendWhatsApp(from, "Reply YES to confirm your booking, or RESTART to start over.");
      return res.sendStatus(200);
    }

    ////////////////////////////////////////////////////
    // STEP 100 — CAPTURE TIME SLOT
    ////////////////////////////////////////////////////

    if (session.step === 100) {

      const timeSlot = text;

      await supabase
        .from("job_sessions")
        .update({ time_slot: timeSlot, step: 101 })
        .eq("customer_phone", from);

      await sendWhatsApp(from,
        `✅ Booked! A plumber will contact you to confirm your ${timeSlot} appointment.\n\nThank you for using PipePal ZA 🇿🇦`
      );

      console.log("BOOKING CONFIRMED:", timeSlot, "→ step 101");
      return res.sendStatus(200);
    }

    console.log("No handler matched for step:", session.step, "text:", text);

  } catch (error) {
    console.error("❌ ERROR:", error.message);
    console.error(error.stack);
  }

  res.sendStatus(200);
});

////////////////////////////////////////////////////
// SEND TEXT
////////////////////////////////////////////////////

async function sendWhatsApp(to, body) {
  try {
    await axios.post(
      `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
      { messaging_product: "whatsapp", to, text: { body } },
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    );
  } catch (err) {
    console.error("❌ sendWhatsApp failed:", err.response?.data || err.message);
  }
}

////////////////////////////////////////////////////
// SEND BUTTONS
////////////////////////////////////////////////////

async function sendButtons(to, bodyText, buttons) {
  try {
    await axios.post(
      `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to,
        type: "interactive",
        interactive: {
          type: "button",
          body: { text: bodyText },
          action: {
            buttons: buttons.map(b => ({
              type: "reply",
              reply: { id: b.id, title: b.title }
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
  } catch (err) {
    console.error("❌ sendButtons failed:", err.response?.data || err.message);
  }
}

////////////////////////////////////////////////////
// ROOT
////////////////////////////////////////////////////

app.get("/", (req, res) => {
  res.send("PipePal ZA running ✅");
});

////////////////////////////////////////////////////
// START
////////////////////////////////////////////////////

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
