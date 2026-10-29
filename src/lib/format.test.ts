import { describe, expect, it } from "vitest";
import { bytes, clock, duration, fileName, folderOf, remaining, sourceLabel, speed, stamp, titleOf, transcriptText, wholeGb } from "./format";

describe("format", () => {
  it("prints clocks like the transcript files", () => {
    expect(clock(0)).toBe("00:00:00");
    expect(clock(3661.9)).toBe("01:01:01");
    expect(clock(-5)).toBe("00:00:00");
  });

  it("prints durations for people", () => {
    expect(duration(42)).toBe("42s");
    expect(duration(125)).toBe("2min 5s");
    expect(duration(1500)).toBe("25min");
    expect(duration(3600)).toBe("1h");
    expect(duration(3725)).toBe("1h 2min");
  });

  it("rounds the remaining time up and admits when it does not know", () => {
    expect(remaining(Number.NaN)).toBe("estimating");
    expect(remaining(4)).toBe("a few seconds");
    expect(remaining(34)).toBe("about 40 s");
    expect(remaining(130)).toBe("about 3 min");
    expect(remaining(3700)).toBe("about 1 h 2 min");
  });

  it("prints sizes in decimal units like the download pages", () => {
    expect(bytes(574041195)).toBe("574 MB");
    expect(bytes(1656538283)).toBe("1.7 GB");
    expect(bytes(77691713)).toBe("78 MB");
  });

  it("prints the speed relative to real time", () => {
    expect(speed(180, 18)).toBe("10x real time");
    expect(speed(180, 45)).toBe("4.0x real time");
    expect(speed(0, 10)).toBe("");
  });

  it("splits paths from both platforms", () => {
    expect(fileName("/a/b/meeting.m4a")).toBe("meeting.m4a");
    expect(fileName("C:\\Users\\x\\meeting.m4a")).toBe("meeting.m4a");
    expect(folderOf("/a/b/meeting.m4a")).toBe("/a/b");
    expect(folderOf("C:\\Users\\x\\meeting.m4a")).toBe("C:\\Users\\x");
  });

  it("describes the source by its container, video and tracks", () => {
    expect(sourceLabel("/a/call.mp4", true, 2)).toBe("MP4 video, 2 tracks");
    expect(sourceLabel("C:\\x\\memo.m4a", false, 1)).toBe("M4A audio");
    expect(sourceLabel("/a/old.mp3", null, 1)).toBe("MP3");
  });

  it("names a transcript after its file, without the suffix", () => {
    expect(titleOf("/a/b/Weekly sync_transcript.txt")).toBe("Weekly sync");
    expect(titleOf("C:\\x\\meeting_transcript.txt")).toBe("meeting");
    expect(titleOf("/a/notes.TXT")).toBe("notes");
    expect(titleOf("/a/_transcript.txt")).toBe("_transcript");
  });

  it("writes time stamps like the engine", () => {
    expect(stamp(0)).toBe("00:00:00.00");
    expect(stamp(17.25)).toBe("00:00:17.25");
    expect(stamp(3661.5)).toBe("01:01:01.50");
  });

  it("builds the transcript text with or without timecodes", () => {
    const lines = [
      { start: 0, end: 17, text: "first line" },
      { start: 17, end: 35, text: "" },
      { start: 35, end: 50, text: "third line" },
    ];
    expect(transcriptText(lines, true)).toBe("[00:00:00.00 --> 00:00:17.00] first line\n[00:00:35.00 --> 00:00:50.00] third line\n");
    expect(transcriptText(lines, false)).toBe("first line\nthird line\n");
  });

  it("writes the speaker in front of each line like the engine", () => {
    const lines = [
      { start: 0, end: 4, text: "Hello", speaker: 0 },
      { start: 4.5, end: 9, text: "Hi there", speaker: 1 },
    ];
    expect(transcriptText(lines, true, ["Marc", "Client"])).toBe(
      "[00:00:00.00 --> 00:00:04.00] Marc: Hello\n[00:00:04.50 --> 00:00:09.00] Client: Hi there\n",
    );
    expect(transcriptText(lines, false, ["Marc", "Client"])).toBe("Marc: Hello\nClient: Hi there\n");
  });

  it("rounds to whole gigabytes, and to tens of megabytes below one", () => {
    expect(wholeGb(9.7 * 2 ** 30)).toBe("10 GB");
    expect(wholeGb(16 * 2 ** 30)).toBe("16 GB");
    expect(wholeGb(1.4 * 2 ** 30)).toBe("1 GB");
    expect(wholeGb(0.43 * 2 ** 30)).toBe("440 MB");
  });
});
