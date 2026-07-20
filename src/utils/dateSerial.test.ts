// Tests for the Excel-style date/time serial helpers: round-trip
// conversion, all four display renderings (incl. duration > 24h and
// negative duration), and strict literal parsing accept/reject cases.

import { describe, expect, it } from "vitest";
import {
  dateToSerial,
  formatDateSerial,
  parseDateTimeLiteral,
  serialToUTCParts,
} from "./dateSerial";

describe("dateToSerial / serialToUTCParts", () => {
  it("round-trips the REQ reference date", () => {
    expect(dateToSerial(2008, 9, 26)).toBe(39717);
    expect(serialToUTCParts(39717)).toEqual({
      y: 2008,
      m: 9,
      d: 26,
      hh: 0,
      mm: 0,
      ss: 0,
    });
  });

  it("round-trips a date+time serial", () => {
    const serial = dateToSerial(2008, 9, 26, 15, 59, 0);
    expect(serial).toBeCloseTo(39717.66597, 4);
    expect(serialToUTCParts(serial)).toEqual({
      y: 2008,
      m: 9,
      d: 26,
      hh: 15,
      mm: 59,
      ss: 0,
    });
  });

  it("carries seconds rounding up to the next day", () => {
    const almostMidnight = dateToSerial(2026, 1, 1, 23, 59, 59) + 0.6 / 86400;
    expect(serialToUTCParts(almostMidnight)).toEqual({
      y: 2026,
      m: 1,
      d: 2,
      hh: 0,
      mm: 0,
      ss: 0,
    });
  });
});

describe("formatDateSerial", () => {
  it("formats date", () => {
    expect(formatDateSerial(39717, "date")).toBe("9/26/2008");
  });

  it("formats time with AM/PM, including noon and midnight", () => {
    expect(formatDateSerial(dateToSerial(2008, 9, 26, 15, 59, 0), "time")).toBe(
      "3:59:00 PM"
    );
    expect(formatDateSerial(0.5, "time")).toBe("12:00:00 PM");
    expect(formatDateSerial(0, "time")).toBe("12:00:00 AM");
  });

  it("formats datetime with 24-hour zero-padded time", () => {
    expect(
      formatDateSerial(dateToSerial(2008, 9, 26, 15, 59, 0), "datetime")
    ).toBe("9/26/2008 15:59:00");
  });

  it("formats duration cumulatively, past 24h and negative", () => {
    expect(formatDateSerial(1.75, "duration")).toBe("42:00:00");
    expect(formatDateSerial(-1.5, "duration")).toBe("-36:00:00");
  });

  it("falls back to null for negative/non-finite date/time/datetime", () => {
    expect(formatDateSerial(-5, "date")).toBeNull();
    expect(formatDateSerial(-5, "time")).toBeNull();
    expect(formatDateSerial(-5, "datetime")).toBeNull();
    expect(formatDateSerial(NaN, "date")).toBeNull();
    expect(formatDateSerial(Infinity, "duration")).toBeNull();
  });
});

describe("parseDateTimeLiteral", () => {
  it("parses ISO and US dates", () => {
    expect(parseDateTimeLiteral("2008-09-26")).toEqual({
      serial: 39717,
      fmt: "date",
    });
    expect(parseDateTimeLiteral("9/26/2008")).toEqual({
      serial: 39717,
      fmt: "date",
    });
  });

  it("parses bare and AM/PM times, including 24h without AM/PM", () => {
    expect(parseDateTimeLiteral("15:59")?.fmt).toBe("time");
    expect(parseDateTimeLiteral("3:59 PM")).toEqual(
      expect.objectContaining({ fmt: "time" })
    );
    expect(parseDateTimeLiteral("3:59 pm")?.serial).toBeCloseTo(
      parseDateTimeLiteral("15:59:00")!.serial,
      6
    );
    expect(parseDateTimeLiteral("12:00 AM")?.serial).toBe(0);
    expect(parseDateTimeLiteral("12:00 PM")?.serial).toBe(0.5);
  });

  it("parses combined date+time, with and without AM/PM", () => {
    const noAmpm = parseDateTimeLiteral("9/26/2008 15:59");
    expect(noAmpm?.fmt).toBe("datetime");
    expect(noAmpm?.serial).toBeCloseTo(39717.66597, 4);

    const withAmpm = parseDateTimeLiteral("9/26/2008 3:59 PM");
    expect(withAmpm?.fmt).toBe("datetime");
    expect(withAmpm?.serial).toBeCloseTo(39717.66597, 4);
  });

  it("rejects invalid calendar/clock values and ambiguous input", () => {
    expect(parseDateTimeLiteral("13/45/2026")).toBeNull();
    expect(parseDateTimeLiteral("2/30/2026")).toBeNull();
    expect(parseDateTimeLiteral("25:99")).toBeNull();
    expect(parseDateTimeLiteral("1234.5")).toBeNull();
    expect(parseDateTimeLiteral("9/26/08")).toBeNull(); // 2-digit year, non-goal
    expect(parseDateTimeLiteral("")).toBeNull();
  });
});
