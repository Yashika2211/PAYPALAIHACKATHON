import { readFileSync } from "node:fs";
import { extractCatalog } from "../lib/agents/catalog-extractor";
import { verifyDelivery } from "../lib/agents/delivery-verifier";

const img = (f: string) => ({ base64: readFileSync(`public/demo/${f}`).toString("base64"), mediaType: "image/jpeg" });

async function main() {
  const t = Date.now();
  const c = await extractCatalog({ file: img("menu.jpg"), knownCategories: ["catering", "bakery", "printing", "flowers"] });
  console.log(`catalog via ${c.source} ${c.model ?? ""} in ${Date.now() - t}ms: ${c.value.businessName} [${c.value.category}]`);
  for (const i of c.value.items) console.log(`  ${i.name} | ${i.unit} | ${i.priceCents} | ${i.dietaryTags.join(",")} | ${i.confidence}`);
  const ok = await verifyDelivery({ description: "Inkwell Print Co.: 40× Printed name badges with lanyards", photo: img("delivery-badges.jpg") });
  console.log("badges photo:", ok);
  const short = await verifyDelivery({ description: "Inkwell Print Co.: 40× Printed name badges with lanyards", photo: img("delivery-short.jpg") });
  console.log("short photo:", short);
  const bad = await verifyDelivery({ description: "Inkwell Print Co.: 40× Printed name badges with lanyards", photo: img("delivery-wrong.jpg") });
  console.log("wrong photo:", bad);
}
main();
