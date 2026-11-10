import "server-only";
import { todayIso } from "@/lib/time";
import { APP_MODE } from "./config";

/** The app's today, YYYY-MM-DD. In demo mode this is the sample data's fixed today. */
export function appToday(): string {
  return todayIso(APP_MODE, new Date());
}
