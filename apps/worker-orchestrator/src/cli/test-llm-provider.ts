import { callLLM } from "../utils/llm-client.js";

async function main() {
  console.log("LLM_PROVIDER env:", process.env.LLM_PROVIDER);
  console.log("Calling with explicit provider=gemini_pool");
  try {
    const r = await callLLM("Say hi in one word", { provider: "gemini_pool" });
    console.log("SUCCESS:", r.slice(0, 50));
  } catch (e: any) {
    console.error("FAIL:", e.message.slice(0, 200));
  }
}
main();
