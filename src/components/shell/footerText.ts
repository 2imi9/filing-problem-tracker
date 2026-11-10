// The sentences in the footer. Plain functions, so the wording can be tested without a browser.

/** Who made this and what it is not. True on every copy. */
export const FOOTER_ABOUT = "Student prototype for CS4535 AI for Impact, Team 1. Not affiliated with the Indiana courts.";
/** Only where the data is the built-in sample (demo mode). */
export const FOOTER_SAMPLE = "Counties are real; every number and entry is made up.";
export const FOOTER_ADVICE = "This tool does not give legal advice.";

/**
 * The footer's main text. In demo mode it is the full wording the product owner approved. On a copy that
 * holds a court's own entries the sentence about made-up numbers is left out, because it would be false.
 */
export function footerText(demo: boolean): string {
  return demo ? `${FOOTER_ABOUT} ${FOOTER_SAMPLE} ${FOOTER_ADVICE}` : `${FOOTER_ABOUT} ${FOOTER_ADVICE}`;
}

/**
 * Which features use AI on this copy, and which model. Numbers are always counted by code.
 * `model` is the configured model's name. The browser is not told it (GET /api/me and GET /api/health
 * say only whether AI is on), so without it the sentence names the features and not the model.
 */
export function aiUseText(enabled: boolean, model?: string | null): string {
  if (!enabled) return "AI use: none on this copy. Import sorts with keyword rules, and every number is counted by code.";
  const who = model ? `the ${model} model` : "an AI model";
  return `AI use: ${who} sorts the Import reasons the keyword rules cannot, writes the dashboard summary when asked, and reads requests typed into the workspace. Tagging uses no AI, and every number is counted by code.`;
}
