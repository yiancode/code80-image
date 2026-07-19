import type { ModelDefinition } from "./domain.js";

const gptSizes = ["auto", "1024x1024", "1536x1024", "1024x1536", "2048x2048", "2048x1152", "3840x2160", "2160x3840"];
const grokRatios = ["auto", "1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "2:1", "1:2", "19.5:9", "9:19.5", "20:9", "9:20"];

function definition(model: string, label: string, sizes: string[], qualities: string[] = [], canGenerate = true): ModelDefinition {
  return {
    id: "",
    model,
    label,
    sizes: [...sizes],
    qualities: [...qualities],
    canGenerate,
    canEdit: true,
    price: { mode: "unknown", currency: "CNY", note: "实际费用以当前 Code80 分组定价为准" }
  };
}

export function code80Catalog(): ModelDefinition[] {
  return [
    definition("gpt-image-2", "GPT-Image 2", gptSizes),
    definition("grok-imagine", "Grok Imagine（推荐）", grokRatios, ["1k", "2k"]),
    definition("grok-imagine-image-quality", "Grok Imagine Image Quality", grokRatios, ["1k", "2k"]),
    definition("grok-imagine-image", "Grok Imagine Image", grokRatios, ["1k", "2k"]),
    definition("grok-imagine-edit", "Grok Imagine Edit", grokRatios, ["1k", "2k"], false)
  ];
}

export function nextGroupName(names: readonly string[]): string {
  const occupied = new Set(names.map((name) => name.trim().toLowerCase()));
  if (!occupied.has("默认")) return "默认";
  let number = 2;
  while (occupied.has(`分组 ${number}`.toLowerCase())) number += 1;
  return `分组 ${number}`;
}
