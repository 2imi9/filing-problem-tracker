import type { Metadata } from "next";
import { Card } from "@/components/ui/Card";
import { CourthouseHero } from "./CourthouseHero";
import { BeforeAfterIllustration, CounterIllustration, LeaderIllustration } from "./illustrations";
import { ScenarioLink } from "./ScenarioLink";
import styles from "./how.module.css";

export const metadata: Metadata = { title: "How it's used" };

export default function HowItWorksPage() {
  return (
    <div className={styles.page}>
      <CourthouseHero>
        <h1>How it&apos;s used</h1>
        <p>Three moments in a courthouse: a clerk at the counter, a court leader looking at the month, and a check on whether a change helped.</p>
      </CourthouseHero>

      <ol className={styles.scenarios}>
        <li className={styles.scenario}>
          <CounterIllustration className={styles.art} />
          <p className={styles.when}>
            <span className="num">1</span> At the counter
          </p>
          <h2>A clerk tags what was wrong</h2>
          <p>
            A filing from someone without a lawyer is rejected or sent back. The clerk opens Tag a filing, picks the case type and the form, presses the number
            keys for the problems, and presses Enter. It takes a few seconds. No name and no case number is stored.
          </p>
          <ScenarioLink href="/log" roles={["clerk", "admin"]}>
            Go to Tag a filing
          </ScenarioLink>
        </li>

        <li className={styles.scenario}>
          <LeaderIllustration className={styles.art} />
          <p className={styles.when}>
            <span className="num">2</span> In a leadership meeting
          </p>
          <h2>A court leader sees the pattern</h2>
          <p>
            The dashboard counts the tags by problem, county, case type and form. A leader can see, for example, which problem is most common on one form in
            one county, and how many filings were fixed at the counter the same day.
          </p>
          <ScenarioLink href="/dashboard" roles={["clerk", "leader", "admin"]}>
            Go to the dashboard
          </ScenarioLink>
        </li>

        <li className={styles.scenario}>
          <BeforeAfterIllustration className={styles.art} />
          <p className={styles.when}>
            <span className="num">3</span> After a change
          </p>
          <h2>The court checks whether a change helped</h2>
          <p>
            A court revises a form, hands out a guide, or adds a kiosk. The before and after panel compares how often one problem was tagged each month before
            the change with the months after it. Only full months are compared.
          </p>
          <ScenarioLink href="/workspace" roles={["clerk", "leader", "admin"]}>
            Go to the workspace
          </ScenarioLink>
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
    </div>
  );
}
