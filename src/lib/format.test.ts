import { describe, expect, it } from "vitest";
import { bytes, clock, duration, fileName, folderOf, remaining, speed } from "./format";

describe("format", () => {
  it("prints clocks like the transcript files", () => {
    expect(clock(0)).toBe("00:00:00");
    expect(clock(3661.9)).toBe("01:01:01");
    expect(clock(-5)).toBe("00:00:00");
  });

  it("prints durations for people", () => {
    expect(duration(42)).toBe("42 s");
    expect(duration(125)).toBe("2 min 5 s");
    expect(duration(1500)).toBe("25 min");
    expect(duration(3600)).toBe("1 h");
    expect(duration(3725)).toBe("1 h 2 min");
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
});
