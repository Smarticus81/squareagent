import { describe, expect, it } from "vitest";
import { dayRange, hourInZone, normalizePeriod, periodRange, resolveTimeZone, zonedTimeToUtc } from "../src/lib/venue-time";

describe("venue-time", () => {
  it("resolves invalid timezones to UTC", () => {
    expect(resolveTimeZone("America/Chicago")).toBe("America/Chicago");
    expect(resolveTimeZone("Not/AZone")).toBe("UTC");
    expect(resolveTimeZone(undefined)).toBe("UTC");
  });

  it("computes local midnight in the venue timezone", () => {
    // 2026-07-04 00:00 in Chicago (CDT, UTC-5) is 05:00Z.
    expect(zonedTimeToUtc(2026, 7, 4, 0, 0, 0, "America/Chicago").toISOString()).toBe("2026-07-04T05:00:00.000Z");
    // In winter (CST, UTC-6).
    expect(zonedTimeToUtc(2026, 1, 15, 0, 0, 0, "America/Chicago").toISOString()).toBe("2026-01-15T06:00:00.000Z");
  });

  it("builds a full local day range", () => {
    const range = dayRange("2026-07-04", "America/Los_Angeles");
    expect(range.start).toBe("2026-07-04T07:00:00.000Z");
    expect(range.end).toBe("2026-07-05T06:59:59.999Z");
  });

  it("defaults to the venue's current day", () => {
    // 03:30Z on the 5th is still the evening of the 4th in Los Angeles.
    const now = new Date("2026-07-05T03:30:00Z");
    const range = dayRange(undefined, "America/Los_Angeles", now);
    expect(range.start).toBe("2026-07-04T07:00:00.000Z");
  });

  it("maps period names and computes Monday-based weeks", () => {
    expect(normalizePeriod("last 7 days")).toBe("last_7_days");
    expect(normalizePeriod("This-Week")).toBe("this_week");
    expect(normalizePeriod("bogus")).toBe("today");
    // Wednesday 2026-07-08 in UTC: week starts Monday 2026-07-06.
    const now = new Date("2026-07-08T12:00:00Z");
    const week = periodRange("this_week", "UTC", now);
    expect(week.start).toBe("2026-07-06T00:00:00.000Z");
    expect(week.end).toBe("2026-07-08T23:59:59.999Z");
    const yesterday = periodRange("yesterday", "UTC", now);
    expect(yesterday.start).toBe("2026-07-07T00:00:00.000Z");
    expect(yesterday.end).toBe("2026-07-07T23:59:59.999Z");
  });

  it("reports the local hour of an instant", () => {
    expect(hourInZone("2026-07-04T23:30:00Z", "America/New_York")).toBe(19);
    expect(hourInZone("2026-07-04T23:30:00Z", "UTC")).toBe(23);
  });
});
