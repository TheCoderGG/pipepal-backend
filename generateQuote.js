const pricing = require("./pricing");

function generateQuote(problem) {

  const p = pricing.problems[problem];

  if (!p) return null;

  const callout = pricing.callout;
  const labourLow = p.labour_hours[0] * pricing.labour_per_hour;
  const labourHigh = p.labour_hours[1] * pricing.labour_per_hour;

  const materials = p.materials;

  const totalLow = callout + labourLow + materials;
  const totalHigh = callout + labourHigh + materials;

  return {
    callout,
    materials,
    totalLow,
    totalHigh
  };
}

module.exports = generateQuote;