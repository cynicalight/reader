import { useEffect, useState } from "react";
import type { Processing } from "@reader/core";
import { Button } from "@reader/ui/components/button";
import { CoverProcessing } from "./ProcessingStatus";

const base: Processing = {
  documentId: "preview",
  phase: "settling",
  status: "running",
  pagesDone: 1,
  pagesTotal: 1,
  assetsDone: 0,
  assetsTotal: 4,
  translationsDone: 8,
  translationsTotal: 22,
  detail: "",
  updatedAt: "",
};
const examples: { label: string; job: Processing }[] = [
  {
    label: "同时运行",
    job: {
      ...base,
      settling: { status: "running", detail: "正在理解图表" },
      translating: { status: "running", detail: "正在翻译正文" },
    },
  },
  {
    label: "翻译先完成",
    job: {
      ...base,
      assetsDone: 2,
      translationsDone: 22,
      settling: { status: "running", detail: "正在理解图表" },
      translating: { status: "complete", detail: "翻译完成" },
    },
  },
  {
    label: "沉淀等待配置",
    job: {
      ...base,
      phase: "translating",
      settling: { status: "waiting", detail: "等待图片能力验证" },
      translating: { status: "running", detail: "正在翻译正文" },
    },
  },
  {
    label: "沉淀失败，翻译继续",
    job: {
      ...base,
      phase: "translating",
      settling: { status: "failed", detail: "图片调用失败" },
      translating: { status: "running", detail: "正在翻译正文" },
    },
  },
];
export default function CoverProcessingPreview() {
  const [dark, setDark] = useState(true);
  const [step, setStep] = useState<number | null>(null);
  useEffect(() => {
    if (step === null || step >= 14) return;
    const timer = setTimeout(() => setStep(step + 1), 1200);
    return () => clearTimeout(timer);
  }, [step]);
  const demo: Processing | null =
    step === null
      ? null
      : {
          ...base,
          phase: step >= 12 ? "ready" : "settling",
          status: step >= 12 ? "complete" : "running",
          translationsDone: Math.min(22, step * 2),
          assetsDone: Math.min(4, Math.floor(step / 3)),
          translating: {
            status: step >= 11 ? "complete" : "running",
            detail: "模拟翻译进度",
          },
          settling: {
            status: step >= 12 ? "complete" : "running",
            detail: "模拟沉淀进度",
          },
        };
  return (
    <main
      className={dark ? "dark" : ""}
      style={{
        minHeight: "100vh",
        background: "var(--background)",
        color: "var(--foreground)",
        padding: 32,
      }}
    >
      <Button variant="outline" size="sm" onClick={() => setDark(!dark)}>
        {dark ? "浅色" : "深色"}
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setStep(0)}>
        播放模拟进度
      </Button>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 260px))",
          gap: 28,
          marginTop: 24,
        }}
      >
        {examples.map(({ label, job }, index) => (
          <section key={label}>
            <p style={{ fontSize: 13, marginBottom: 12 }}>{label}</p>
            <div className="book-cover-frame">
              <div className="book-cover cover-3">
                <div className="cover-top">
                  <span>PDF</span>
                </div>
                <div className="cover-text">
                  <div className="cover-title">focal-loss-page-9</div>
                </div>
                <div className="cover-decoration" />
              </div>
              <CoverProcessing
                job={index === 0 && demo ? demo : job}
                onSettings={() => {}}
              />
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
