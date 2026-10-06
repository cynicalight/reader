import { TranslationText } from "./TranslationText";
import "./translation.css";
const bounds = { x: 0, y: 0, width: 1, height: 1 };
const formula =
  "$$\nS(i,j)=\\frac{1}{2}\\left[\\log p_R(j\\mid i)+\\log p_L(i\\mid j)\\right]\n$$\n";
const tableImage = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="680" height="170" viewBox="0 0 680 170"><rect width="680" height="170" fill="white"/><g font-family="serif" font-size="22" fill="black"><text x="24" y="35">Table 5: Example results</text><text x="24" y="75">Model</text><text x="300" y="75">Clean utility</text><text x="520" y="75">Attack</text><text x="24" y="120">Model A</text><text x="330" y="120">66.7</text><text x="520" y="120">58.6 (42.4)</text></g><path d="M24 50H656M24 88H656M24 140H656" stroke="black"/></svg>`)}`;
export default function FormulaCaptionPreview() {
  return (
    <main
      className="translation-document"
      style={{
        maxWidth: 860,
        margin: "32px auto",
        padding: 24,
        fontSize: "1.15rem",
      }}
    >
      <section>
        <TranslationText
          block={{
            id: "p1-b1",
            page: 1,
            label: "display_formula",
            text: "",
            bounds,
            formulaMarkdown: formula,
          }}
          documentId="preview"
          retry={() => {}}
        />
      </section>
      <section>
        <img className="translation-image" src={tableImage} alt="原表格示例" />
        <TranslationText
          block={{
            id: "p1-b2",
            page: 1,
            label: "table",
            text: "Model Clean utility Attack Model A 66.7 58.6 (42.4)",
            caption: "Table 5: Example results",
            bounds,
          }}
          translation={{
            blockId: "p1-b2",
            sourceHash: "preview",
            status: "complete",
            sentences: [
              {
                source: "Table 5: Example results",
                target: "表 5：示例结果。",
              },
            ],
          }}
          documentId="preview"
          retry={() => {}}
        />
      </section>
    </main>
  );
}
