import { describe, expect, it } from "vitest";
import { transcriptText } from "./format";
import { addSpeaker, assignSpeaker, findMatches, joinLine, lineAt, nextSpeaker, parseTranscript, playingAt, splitLine, withTimes } from "./transcript";

describe("parseTranscript", () => {
  it("reads a file with timecodes back into lines", () => {
    const parsed = parseTranscript("[00:00:00.00 --> 00:00:12.75] สวัสดี\n[01:01:01.50 --> 01:01:14.00] second line\n");
    expect(parsed.timestamps).toBe(true);
    expect(parsed.lines).toEqual([
      { start: 0, end: 12.75, text: "สวัสดี" },
      { start: 3661.5, end: 3674, text: "second line" },
    ]);
  });

  it("round-trips what the app writes", () => {
    const lines = [
      { start: 0, end: 12.75, text: "first" },
      { start: 24.35, end: 39.25, text: "second" },
    ];
    expect(transcriptText(parseTranscript(transcriptText(lines, true)).lines, true)).toBe(transcriptText(lines, true));
  });

  it("reads the speaker of each line back by the names it was saved with", () => {
    const speakers = ["Speaker 1", "Speaker 10", "Client"];
    const lines = [
      { start: 0, end: 4, text: "Hello: welcome", speaker: 0 },
      { start: 4.5, end: 9, text: "Hi", speaker: 1 },
      { start: 9, end: 12, text: "Thanks", speaker: 2 },
    ];
    for (const timed of [true, false]) {
      const parsed = parseTranscript(transcriptText(lines, timed, speakers), speakers);
      expect(parsed.lines.map((l) => [l.speaker, l.text])).toEqual([
        [0, "Hello: welcome"],
        [1, "Hi"],
        [2, "Thanks"],
      ]);
    }
    expect(parseTranscript("Someone else: hi\n", speakers).lines[0]).toEqual({ start: 0, end: 0, text: "Someone else: hi" });
    expect(parseTranscript("Client: hi\n").lines[0].text).toBe("Client: hi");
  });

  it("reads a plain file line by line, also with Windows line endings", () => {
    const parsed = parseTranscript("first line\r\n\r\nsecond line\r\n");
    expect(parsed.timestamps).toBe(false);
    expect(parsed.lines.map((l) => l.text)).toEqual(["first line", "second line"]);
  });

  it("keeps a hand-edited file as written when only some lines carry timecodes", () => {
    const parsed = parseTranscript("[00:00:00.00 --> 00:00:12.75] first\na note added by hand\n");
    expect(parsed.timestamps).toBe(false);
    expect(parsed.lines.map((l) => l.text)).toEqual(["[00:00:00.00 --> 00:00:12.75] first", "a note added by hand"]);
  });

  it("gives a plain file its kept times back, only when the lines still match", () => {
    const plain = parseTranscript("first\nsecond\n");
    const restored = withTimes(plain, [[0, 4.5], [5, 9]]);
    expect(restored.timed).toBe(true);
    expect(restored.timestamps).toBe(false);
    expect(restored.lines.map((l) => [l.start, l.end])).toEqual([[0, 4.5], [5, 9]]);
    expect(withTimes(plain, [[0, 4.5]]).timed).toBe(false);
    expect(withTimes(plain, null).timed).toBe(false);
    expect(withTimes(parseTranscript("[00:00:00.00 --> 00:00:04.00] a\n"), null).timed).toBe(true);
  });

  it("returns nothing for an empty file", () => {
    expect(parseTranscript("\n\n")).toEqual({ timestamps: false, lines: [] });
  });

  it("finds the line playing at a given second", () => {
    const lines = [
      { start: 0, end: 12, text: "a" },
      { start: 12, end: 25, text: "b" },
      { start: 25, end: 40, text: "c" },
    ];
    expect(lineAt(lines, 0)).toBe(0);
    expect(lineAt(lines, 11.9)).toBe(0);
    expect(lineAt(lines, 12)).toBe(1);
    expect(lineAt(lines, 99)).toBe(2);
    expect(lineAt([{ start: 5, end: 9, text: "x" }], 1)).toBe(-1);
  });

  it("keeps the main line during a short reply over it, and after it", () => {
    const lines = [
      { start: 0, end: 20, text: "a long turn" },
      { start: 6, end: 7.5, text: "yeah" },
      { start: 21, end: 30, text: "next turn" },
    ];
    expect(lineAt(lines, 6.5)).toBe(0);
    expect(lineAt(lines, 10)).toBe(0);
    expect(lineAt(lines, 20.5)).toBe(0);
    expect(lineAt(lines, 22)).toBe(2);
  });

  it("marks every line under the playhead while two people speak at once", () => {
    const lines = [
      { start: 0, end: 20, text: "a long turn" },
      { start: 6, end: 7.5, text: "yeah" },
      { start: 21, end: 30, text: "next turn" },
    ];
    expect(playingAt(lines, 6.5)).toEqual({ lines: [0, 1], main: 0 });
    expect(playingAt(lines, 10)).toEqual({ lines: [0], main: 0 });
    expect(playingAt(lines, 20.5)).toEqual({ lines: [0], main: 0 });
    expect(playingAt([], 3)).toEqual({ lines: [], main: -1 });
  });

  it("finds lines containing the search text, ignoring case", () => {
    const lines = [
      { start: 0, end: 1, text: "Budget for Q4" },
      { start: 1, end: 2, text: "nothing here" },
      { start: 2, end: 3, text: "the budget again" },
    ];
    expect(findMatches(lines, "budget")).toEqual([0, 2]);
    expect(findMatches(lines, "")).toEqual([]);
  });

});

describe("speaker corrections", () => {
  const lines = [
    { start: 0, end: 10, text: "Hello there. Hi back.", speaker: 0 },
    { start: 10, end: 12, text: "", speaker: 1 },
    { start: 12, end: 20, text: "Next turn", speaker: 1 },
  ];

  it("splits a line at the cursor and shares its time by the length of each half", () => {
    const split = splitLine(lines, 0, "Hello there. Hi back.", 12, 2);
    expect(split).toHaveLength(4);
    expect(split[0]).toEqual({ start: 0, end: 6, text: "Hello there.", speaker: 0 });
    expect(split[1]).toEqual({ start: 6, end: 10, text: "Hi back.", speaker: 1 });
    expect(split.slice(2)).toEqual(lines.slice(1));
  });

  it("splits a line without times and keeps its place", () => {
    const untimed = [{ start: 3, end: 3, text: "one two" }];
    expect(splitLine(untimed, 0, "one two", 3, 0)).toEqual([
      { start: 3, end: 3, text: "one" },
      { start: 3, end: 3, text: "two", speaker: undefined },
    ]);
  });

  it("gives the second half the next speaker", () => {
    expect(nextSpeaker(0, 2)).toBe(1);
    expect(nextSpeaker(1, 2)).toBe(0);
    expect(nextSpeaker(1, 3)).toBe(2);
    expect(nextSpeaker(undefined, 3)).toBe(1);
    expect(nextSpeaker(0, 1)).toBe(0);
  });

  it("joins a line to the earlier line with text, past a hidden empty one", () => {
    const joined = joinLine(lines, 2, "next turn")!;
    expect(joined.index).toBe(0);
    expect(joined.at).toBe(22);
    expect(joined.lines).toEqual([{ start: 0, end: 20, text: "Hello there. Hi back. next turn", speaker: 0 }, lines[1]]);
    expect(joinLine(lines, 0, "Hello")).toBeNull();
  });

  it("assigns a speaker to one line", () => {
    expect(assignSpeaker(lines, 2, 0).map((l) => l.speaker)).toEqual([0, 1, 0]);
  });

  it("adds a speaker under a free name, and gives every line a speaker when there was none", () => {
    const plain = [{ start: 0, end: 1, text: "a" }];
    expect(addSpeaker([], plain)).toEqual({ speakers: ["Speaker 1", "Speaker 2"], lines: [{ start: 0, end: 1, text: "a", speaker: 0 }] });
    expect(addSpeaker(["Speaker 1"], plain).speakers).toEqual(["Speaker 1", "Speaker 2"]);
    expect(addSpeaker(["Marc", "Client"], lines)).toEqual({ speakers: ["Marc", "Client", "Speaker 3"], lines });
    expect(addSpeaker(["Marc", "speaker 3"], lines).speakers).toEqual(["Marc", "speaker 3", "Speaker 4"]);
  });
});
