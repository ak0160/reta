import type { Metadata } from "next";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "ReTA | 読書体験に関する実験",
  description: "読書体験に関する実験の参加者向けページです。",
};

type IconName = "clipboard" | "book" | "message" | "participants" | "check";

type ExperimentCardProps = {
  eyebrow: string;
  title: string;
  description: string;
  href: string;
  action: string;
  icon: IconName;
  featured?: boolean;
  message?: string;
};

const preSurvey: ExperimentCardProps = {
  eyebrow: "BEFORE READING",
  title: "事前アンケート",
  description: "実験開始前に回答してください。",
  href: "https://docs.google.com/forms/d/e/1FAIpQLScKjQzhIi4Sy290jpgVGTjKMjv1maY8uT0BHCESv2chOoARZA/viewform?usp=dialog",
  action: "アンケートに回答する",
  icon: "clipboard",
};

const retaExperience: ExperimentCardProps = {
  eyebrow: "READING EXPERIENCE",
  title: "ReTAを開く",
  description: "実験者の指示に従って読書を開始してください。",
  href: "https://ak0160.github.io/reta/",
  action: "ReTAを開く",
  icon: "book",
  featured: true,
  message: "あなたのペースで、読書を楽しむ。",
};

const soloReadingSurvey: ExperimentCardProps = {
  eyebrow: "AFTER READING",
  title: "一人読み後アンケート",
  description: "一人読み体験の終了後に回答してください。実施順は参加者によって異なるため、実験者の指示に従って回答してください。",
  href: "https://docs.google.com/forms/d/e/1FAIpQLSeGr6VutH6rGJnl4gRX88cceDJqcKJcXwTLzuN64m4ruNGcCQ/viewform?usp=dialog",
  action: "アンケートに回答する",
  icon: "message",
};

const sharedReadingSurvey: ExperimentCardProps = {
  eyebrow: "AFTER READING",
  title: "共有読み後アンケート",
  description: "共有読み体験の終了後に回答してください。実施順は参加者によって異なるため、実験者の指示に従って回答してください。",
  href: "https://docs.google.com/forms/d/e/1FAIpQLScfuBUmKDn_J8Oq8oYwW2CpVKS-GeGhPN00SlJEP_4UFbishA/viewform?usp=dialog",
  action: "アンケートに回答する",
  icon: "participants",
};

const finalSurvey: ExperimentCardProps = {
  eyebrow: "FINAL QUESTIONNAIRE",
  title: "実験終了後アンケート",
  description: "すべての読書体験が終了した後に回答してください。",
  href: "https://docs.google.com/forms/d/e/1FAIpQLScE0GeKtYH6dT8MGXic_ax5szf2G1IOUFmZ2ZYFNbqIq5LGKQ/viewform?usp=dialog",
  action: "アンケートに回答する",
  icon: "check",
};

function StepIcon({ name }: { name: IconName }) {
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
  if (name === "participants") {
    return <svg {...common}><circle cx="9" cy="8" r="3" /><path d="M3.5 19v-1a5.5 5.5 0 0 1 11 0v1ZM16 5.5a3 3 0 0 1 0 5.8M17 13a4.5 4.5 0 0 1 3.5 4.4V19" /></svg>;
  }
  return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="m8 12 2.5 2.5L16.5 9" /></svg>;
}

function ExperimentCard({
  eyebrow,
  title,
  description,
  href,
  action,
  icon,
  featured = false,
  message,
}: ExperimentCardProps) {
  return (
    <a
      className={`${styles.card} ${featured ? styles.featured : ""}`}
      href={href}
      target="_blank"
      rel="noreferrer"
    >
      <div className={styles.cardHeader}>
        <p className={styles.cardEyebrow}>{eyebrow}</p>
        <span className={styles.iconWrap}><StepIcon name={icon} /></span>
      </div>
      <h2>{title}</h2>
      {message && <p className={styles.cardMessage}>{message}</p>}
      <p className={styles.description}>{description}</p>
      <span className={styles.action}>
        {action}
        <svg className={styles.arrow} viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path d="M4 10h11M10 5l5 5-5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    </a>
  );
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
          <p className={styles.intro}>一人読みと共有読みの実施順は参加者によって異なります。実験者の指示に従って、該当するアンケートに回答してください。</p>
        </header>

        <section className={styles.steps} aria-label="実験の手順">
          <ExperimentCard {...preSurvey} />
          <ExperimentCard {...retaExperience} />
          <div className={styles.afterReading}>
            <ExperimentCard {...soloReadingSurvey} />
            <ExperimentCard {...sharedReadingSurvey} />
          </div>
          <ExperimentCard {...finalSurvey} />
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
