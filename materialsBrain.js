function getMaterials(problem) {

  if (problem.includes("blocked drain")) {
    return [
      "Drain cleaner",
      "Drain auger",
      "Rubber gloves"
    ];
  }

  if (problem.includes("leaking pipe")) {
    return [
      "PVC pipe section",
      "PVC elbow",
      "PVC solvent cement",
      "PTFE tape"
    ];
  }

  if (problem.includes("geyser")) {
    return [
      "Pressure valve",
      "PTFE tape",
      "Copper fittings"
    ];
  }

  if (problem.includes("tap")) {
    return [
      "Tap washer",
      "O-ring",
      "PTFE tape"
    ];
  }

  return ["General plumbing materials"];

}

module.exports = getMaterials;