import fs from "node:fs";
const d = JSON.parse(fs.readFileSync("coverage/coverage-summary.json", "utf-8"));
let tot = 0, cov = 0, totF = 0;
for (const [f, v] of Object.entries(d)) {
  if (f === "total") continue;
  const norm = f.replace(/\\/g, "/").toLowerCase();
  if (norm.includes("src/app/api")) {
    tot += v.lines.total;
    cov += v.lines.covered;
    totF++;
  }
}
console.log(
  `app/api files: ${totF}, lines: ${cov}/${tot} = ${
    tot ? ((cov / tot) * 100).toFixed(1) + "%" : "n/a"
  }`,
);
