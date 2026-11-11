import type { Metadata } from "next";
import { Page } from "@/components/shell/Page";
import { Card } from "@/components/ui/Card";
import { BeforeAfterIllustration, CounterIllustration, LeaderIllustration } from "./illustrations";
import { ScenarioLink } from "./ScenarioLink";
import styles from "./how.module.css";

export const metadata: Metadata = { title: "How it's used" };

// Three moments, each a plain section under a rule: the text on the left, a line drawing on the right.
// The courthouse picture is in the shared header band, so this page has no picture of its own.
export default function HowItWorksPage() {
  return (
    <Page title="How it's used" intro="Three moments in a courthouse: at the counter, in a leadership meeting, and after a change.">
      <ol className={styles.scenarios}>
        <li>
          <Card title="A clerk tags what was wrong" note="at the counter">
            <div className={styles.scenario}>
              <div className={styles.text}>
                <p>
                  A filing from someone without a lawyer is rejected or sent back. The clerk opens Tag a filing, picks the case type and the form, presses the
                  number keys for the problems, and presses Enter. It takes a few seconds. No name and no case number is stored.
                </p>
                <ScenarioLink href="/log" roles={["clerk", "admin"]}>
                  Go to Tag a filing
                </ScenarioLink>
              </div>
              <CounterIllustration className={styles.art} />
            </div>
          </Card>
        </li>

        <li>
          <Card title="A court leader sees the pattern" note="in a leadership meeting">
            <div className={styles.scenario}>
              <div className={styles.text}>
                <p>
                  The dashboard counts the tags by problem, county, case type and form. A leader can see, for example, which problem is most common on one form
                  in one county, and how many filings were fixed at the counter the same day.
                </p>
                <ScenarioLink href="/dashboard" roles={["clerk", "leader", "admin"]}>
                  Go to the dashboard
                </ScenarioLink>
              </div>
              <LeaderIllustration className={styles.art} />
            </div>
          </Card>
        </li>

        <li>
          <Card title="The court checks whether a change helped" note="after a change">
            <div className={styles.scenario}>
              <div className={styles.text}>
                <p>
                  A court revises a form, hands out a guide, or adds a kiosk. The before and after panel compares how often one problem was tagged each month
                  before the change with the months after it. Only full months are compared.
                </p>
                <ScenarioLink href="/workspace" roles={["clerk", "leader", "admin"]}>
                  Go to the workspace
                </ScenarioLink>
              </div>
              <BeforeAfterIllustration className={styles.art} />
            </div>
          </Card>
        </li>
      </ol>

      <Card title="What the tracker does not do">
        <ul className={styles.limits}>
          <li>It sits next to Odyssey and e-filing and changes neither.</li>
          <li>It does not give legal advice. Its labels describe what was wrong with a filing.</li>
          <li>It does not store names, case numbers, or anything else that identifies a person. Notes and imported reasons are checked before they are saved.</li>
          <li>It counts flagged filings. It does not know how many filings there were in total, so a busy month can look worse than it was.</li>
        </ul>
      </Card>
    </Page>
  );
}
