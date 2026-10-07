import { expect, it } from "vitest";
import {
  bibtex,
  citationKeys,
  citationType,
  formatCitations,
  missingFields,
  orderForCitation,
  ris,
  titleAndLink,
} from "./citation";
import { paper } from "./fixtures";

const attention = paper({
  id: "a",
  title: "Attention is all you need",
  metadata: {
    itemType: "conference",
    creators: [
      { given: "Ashish", family: "Vaswani" },
      { given: "Noam", family: "Shazeer" },
      { given: "Niki", family: "Parmar" },
      { given: "Jakob", family: "Uszkoreit" },
    ],
    date: "2017-12",
    venue: "Advances in Neural Information Processing Systems",
    volume: "30",
    pages: "6000-6010",
    doi: "10.5555/3295222.3295349",
  },
});
const gpt3 = paper({
  id: "b",
  title: "Language Models are Few-Shot Learners",
  metadata: {
    creators: [{ given: "Tom B.", family: "Brown" }],
    date: "2020-05-28",
    arxiv: "2005.14165",
  },
});
const chinese = paper({
  id: "c",
  title: "基于图神经网络的推荐方法_研究",
  metadata: {
    itemType: "journal",
    creators: [
      { name: "张三" },
      { name: "李四" },
      { name: "王五" },
      { name: "赵六" },
    ],
    date: "2021",
    venue: "计算机学报",
    volume: "44",
    issue: "3",
    pages: "1-10",
  },
});

it("infers types from venues when none is set", () => {
  expect(citationType(gpt3)).toBe("preprint");
  expect(
    citationType(paper({ metadata: { venue: "Proceedings of ACL 2020" } })),
  ).toBe("conference");
  expect(citationType(paper({ metadata: { venue: "Nature" } }))).toBe(
    "journal",
  );
  expect(citationType(paper())).toBe("other");
});

it("formats GB/T 7714 with Chinese and English author rules", async () => {
  const text = await formatCitations([attention, gpt3, chinese], "gb7714");
  const lines = text.split("\n");
  expect(lines[0]).toBe(
    "[1] VASWANI A, SHAZEER N, PARMAR N, et al. Attention is all you need[C/OL]//Advances in Neural Information Processing Systems: Vol. 30. 2017: 6000-6010. DOI:10.5555/3295222.3295349.",
  );
  expect(lines[1]).toContain(
    "BROWN T B. Language Models are Few-Shot Learners[A/OL]. arXiv, 2020",
  );
  expect(lines[2]).toBe(
    "[3] 张三, 李四, 王五, 等. 基于图神经网络的推荐方法_研究[J]. 计算机学报, 2021, 44(3): 1-10.",
  );
});

it("formats APA", async () => {
  const text = await formatCitations([attention], "apa");
  expect(text).toBe(
    "Vaswani, A., Shazeer, N., Parmar, N., & Uszkoreit, J. (2017). Attention is all you need. Advances in Neural Information Processing Systems, 30, 6000–6010. https://doi.org/10.5555/3295222.3295349",
  );
});

it("writes BibTeX that keeps non-Latin text and escapes TeX", () => {
  const text = bibtex([attention, gpt3, chinese]);
  expect(text).toContain("@inproceedings{vaswani2017attention,");
  expect(text).toContain(
    "  booktitle = {Advances in Neural Information Processing Systems}",
  );
  expect(text).toContain("  pages = {6000--6010}");
  expect(text).toContain("@misc{brown2020language,");
  expect(text).toContain("  eprint = {2005.14165},\n  archivePrefix = {arXiv}");
  expect(text).toContain("@article{ref2021,");
  expect(text).toContain("  title = {{基于图神经网络的推荐方法\\_研究}}");
  expect(text).toContain(
    "  author = {{张三} and {李四} and {王五} and {赵六}}",
  );
  expect(text).toContain("  journal = {计算机学报}");
});

it("deduplicates citation keys", () => {
  expect(citationKeys([attention, attention, attention])).toEqual([
    "vaswani2017attentiona",
    "vaswani2017attentionb",
    "vaswani2017attentionc",
  ]);
});

it("writes RIS for reference managers", () => {
  const text = ris([attention, gpt3]);
  expect(text).toContain(
    "TY  - CPAPER\nTI  - Attention is all you need\nAU  - Vaswani, Ashish",
  );
  expect(text).toContain("SP  - 6000\nEP  - 6010");
  expect(text).toContain("TY  - UNPB");
  expect(text).toContain("AN  - arXiv:2005.14165");
  expect(text.trim().endsWith("ER  -")).toBe(true);
});

it("exports CSL-JSON for Zotero", async () => {
  const items = JSON.parse(await formatCitations([gpt3], "csl-json"));
  expect(items[0]).toMatchObject({
    type: "article",
    publisher: "arXiv",
    number: "arXiv:2005.14165",
    issued: { "date-parts": [[2020, 5, 28]] },
  });
});

it("reports missing fields and orders by author or year", () => {
  expect(missingFields(paper(), "apa")).toEqual(["作者", "年份", "出处"]);
  expect(missingFields(gpt3, "gb7714")).toEqual([]);
  expect(missingFields(paper(), "bibtex")).toEqual(["作者", "年份"]);
  const ids = (docs: { id: string }[]) => docs.map((d) => d.id);
  expect(ids(orderForCitation([chinese, attention, gpt3], "author"))).toEqual([
    "b",
    "a",
    "c",
  ]);
  expect(ids(orderForCitation([chinese, gpt3, attention], "year"))).toEqual([
    "a",
    "b",
    "c",
  ]);
  expect(titleAndLink(gpt3)).toBe(
    "Language Models are Few-Shot Learners\nhttps://arxiv.org/abs/2005.14165",
  );
});
