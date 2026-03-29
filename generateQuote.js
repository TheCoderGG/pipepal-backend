const supabase = require("./supabaseClient");

async function generateQuote(problemType) {
  try {
    const { data, error } = await supabase
      .from("pricing")
      .select("*")
      .eq("problem_type", problemType)
      .single();

    if (error || !data) {
      console.error("❌ generateQuote: no pricing found for:", problemType, error?.message);
      return {
        callout: 0,
        materials: 0,
        totalLow: 0,
        totalHigh: 0,
        error: "No pricing configured for this problem type."
      };
    }

    const callout   = Number(data.callout);
    const materials = Number(data.materials);
    const rate      = Number(data.labour_per_hour);
    const labourLow  = Number(data.labour_hours_low)  * rate;
    const labourHigh = Number(data.labour_hours_high) * rate;

    const totalLow  = callout + labourLow  + materials;
    const totalHigh = callout + labourHigh + materials;

    console.log("💰 Quote for", problemType, "→ R", totalLow, "–", totalHigh);

    return {
      callout,
      materials,
      labourLow,
      labourHigh,
      totalLow,
      totalHigh
    };

  } catch (err) {
    console.error("❌ generateQuote exception:", err.message);
    return { callout: 0, materials: 0, totalLow: 0, totalHigh: 0 };
  }
}

module.exports = generateQuote;
