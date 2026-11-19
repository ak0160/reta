import type { Metadata } from "next";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "ReTA | 読書体験に関する実験",
  description: "読書体験に関する実験の参加者向けページです。",
};

const experimentSteps = [
  {
    number: "01",
    title: "事前アンケート",
    description: "実験開始前に回答してください。",
    href: "https://docs.google.com/forms/d/e/1FAIpQLSd5KQsiv2bF3WpRGJC5qijCY-1YL9t-0fDV3fnQWvh0IElKww/viewform?usp=dialog",
    action: "アンケートに回答する",
    icon: "clipboard",
  },
  {
    number: "02",
    title: "ReTAを開く",
    description: "実験者の指示に従って読書を開始してください。",
    href: "https://ak0160.github.io/reta/",
    action: "ReTAを開く",
    icon: "book",
  },
  {
    number: "03",
    title: "読書後アンケート",
    description: "各読書体験の終了後に回答してください。このアンケートには実験中に2回答えていただきます。",
    href: "https://docs.google.com/forms/d/e/1FAIpQLScmMOclR5nDaGouJtqfF4A98Ft7W7G4jAWfPEaCh7W5qZuSjA/viewform?usp=dialog",
    action: "アンケートに回答する",
    icon: "message",
  },
  {
    number: "04",
    title: "実験終了後アンケート",
    description: "すべての読書体験が終了した後に回答してください。",
    href: "https://docs.google.com/forms/d/e/1FAIpQLSdBbcyDkOdtckFwQK8R6USWQnXuQR55dgi9MVZF2MSAtz1o1w/viewform?usp=dialog",
    action: "アンケートに回答する",
    icon: "check",
  },
] as const;

function StepIcon({ name }: { name: (typeof experimentSteps)[number]["icon"] }) {
  const common = {
    className: styles.icon,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true as const,
  };

  if (name === "clipboard") {
    return <svg {...common}><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 4.5h6a1.5 1.5 0 0 0-1.5-1.5h-3A1.5 1.5 0 0 0 9 4.5ZM8.5 10h7M8.5 14h7M8.5 18h4" /></svg>;
  }
  if (name === "book") {
    return <svg {...common}><path d="M12 7v14M12 7C9.7 5.1 6.7 4.8 3.5 5.7v13c3.2-.9 6.2-.6 8.5 1.3M12 7c2.3-1.9 5.3-2.2 8.5-1.3v13c-3.2-.9-6.2-.6-8.5 1.3" /></svg>;
  }
  if (name === "message") {
    return <svg {...common}><path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5 8 8 0 0 1-3.7-.9L4 20l1.4-4.1a7.4 7.4 0 0 1-.9-3.4A7.5 7.5 0 1 1 20 11.5Z" /><path d="M8.5 11.5h7M8.5 14.5h4" /></svg>;
  }
  return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="m8 12 2.5 2.5L16.5 9" /></svg>;
}

export default function ExperimentPage() {
  return (
    <main className={styles.page}>
      <div className={styles.container}>
        <header className={styles.header}>
          <img className={styles.logo} src="/reta/reta-logo.png" alt="ReTA ロゴ" width={44} height={44} />
          <p className={styles.eyebrow}>READING TOGETHER, APART</p>
          <h1>ReTA</h1>
          <p className={styles.subtitle}>読書体験に関する実験</p>
          <p className={styles.intro}>実験者の案内に沿って、下の項目を順番に進めてください。</p>
        </header>

        <section className={styles.steps} aria-label="実験の手順">
          {experimentSteps.map((step) => (
            <a
              className={styles.card}
              href={step.href}
              key={step.number}
              target="_blank"
              rel="noreferrer"
            >
              <div className={styles.cardTop}>
                <span className={styles.stepNumber}>{step.number}</span>
                <span className={styles.iconWrap}><StepIcon name={step.icon} /></span>
              </div>
              <h2>{step.title}</h2>
              <p className={styles.description}>{step.description}</p>
              <span className={styles.action}>
                {step.action}
                <svg className={styles.arrow} viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path d="M4 10h11M10 5l5 5-5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            </a>
          ))}
        </section>

        <footer className={styles.footer}>
          <span>Reading Together, Apart</span>
          <span className={styles.footerDivider} aria-hidden="true" />
          <span>公立はこだて未来大学</span>
        </footer>
      </div>
    </main>
  );
}
