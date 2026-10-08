// @vitest-environment jsdom
import { expect, it } from "vitest";
import type { ReaderSelection, TranslationBlock } from "@reader/core";
import {
  linkTranslatedSelection,
  sentenceLink,
  sourcePassage,
  validParts,
} from "./sentence-links";
const t: TranslationBlock = {
  blockId: "p1-b1",
  sourceHash: "h",
  status: "complete",
  sentences: [
    { source: "First sentence.", target: "第一句。" },
    { source: "Second sentence.", target: "第二句。" },
  ],
};
it("keeps a partial translated selection and links the complete counterpart sentence", () => {
  const selection: ReaderSelection = {
    text: "第二",
    location: {
      type: "pdf",
      page: 1,
      translation: {
        blockId: t.blockId,
        sourceHash: "h",
        sentenceIndexes: [1],
        start: 4,
        end: 6,
      },
    },
  };
  const linked = linkTranslatedSelection(selection, [t]);
  expect(linked.text).toBe("第二");
  expect(
    linked.location.type === "pdf" && linked.location.sentenceLink,
  ).toEqual({
    origin: "translation",
    parts: [
      {
        blockId: t.blockId,
        sourceHash: "h",
        sentenceIndex: 1,
        ...t.sentences[1],
      },
    ],
  });
  expect(selection.location).not.toHaveProperty("sentenceLink");
  expect(sourcePassage(t, 1).sourceOffset).toBe(14);
});
it("captures multiple sentences/blocks once and rejects stale regenerated counterparts", () => {
  const other = { ...t, blockId: "p2-b1" };
  const link = sentenceLink(
    [
      { blockId: t.blockId, sentenceIndexes: [0, 1, 1] },
      { blockId: other.blockId, sentenceIndexes: [0] },
    ],
    [t, other],
    "source",
  );
  expect(link?.parts).toHaveLength(3);
  expect(validParts(link, [{ ...t, sourceHash: "new" }, other])).toHaveLength(
    1,
  );
  expect(
    validParts(link, [
      {
        ...t,
        sentences: t.sentences.map((s) => ({ ...s, target: "新译文。" })),
      },
    ]),
  ).toHaveLength(0);
  expect(link?.parts[0].target).toBe("第一句。");
});

it("does not bind a stale selection to a new source and retains snapshots while a note is open", () => {
  const selection: ReaderSelection = {
    text: "第二",
    location: {
      type: "pdf",
      page: 1,
      translation: {
        blockId: t.blockId,
        sourceHash: "old-source",
        sentenceIndexes: [1],
        start: 4,
        end: 6,
      },
    },
  };
  const stale = linkTranslatedSelection(selection, [t]);
  expect(stale.location).not.toHaveProperty("sentenceLink.parts");
  const captured = {
    ...selection,
    location: {
      ...selection.location,
      type: "pdf" as const,
      page: 1,
      sentenceLink: sentenceLink(
        [{ blockId: t.blockId, sentenceIndexes: [1] }],
        [t],
        "translation",
      ),
    },
  };
  expect(
    linkTranslatedSelection(captured, [
      {
        ...t,
        sentences: [{ source: "Other sentence.", target: "其他句子。" }],
      },
    ]),
  ).toBe(captured);
});
