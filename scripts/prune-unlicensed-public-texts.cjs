const { rm } = require("node:fs/promises");
const path = require("node:path");

const excludedTexts = ["dashi.txt", "hakuchumu.txt", "megachurch.txt"];
const exportTextDirectory = path.join(process.cwd(), "out", "texts");

async function main() {
  for (const filename of excludedTexts) {
    await rm(path.join(exportTextDirectory, filename), { force: true });
  }
}

main().catch((error) => {
  console.error("Failed to remove unlicensed texts from the static export:", error);
  process.exitCode = 1;
});
