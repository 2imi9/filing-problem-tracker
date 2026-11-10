import { describe, expect, it } from "vitest";
import { axisMax, axisTicks, dateX, heatStep, labelStep, slotX, valueY } from "@/components/charts/geometry";
import type { PlotBox } from "@/components/charts/geometry";

const BOX: PlotBox = { left: 40, top: 20, width: 600, height: 200 };
const MONTHS = ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];

describe("chart geometry", () => {
  it("rounds the top of the axis up to a tidy number", () => {
    expect(axisMax(0)).toBe(1);
    expect(axisMax(-3)).toBe(1);
    expect(axisMax(1)).toBe(1);
    expect(axisMax(3)).toBe(4);
    expect(axisMax(4)).toBe(4);
    expect(axisMax(7)).toBe(10);
    expect(axisMax(11)).toBe(20);
    expect(axisMax(38)).toBe(40);
    expect(axisMax(41)).toBe(50);
    expect(axisMax(120)).toBe(200);
    expect(axisMax(1000)).toBe(1000);
  });

  it("never puts the axis top below the largest value", () => {
    for (let value = 1; value <= 2500; value += 7) expect(axisMax(value)).toBeGreaterThanOrEqual(value);
  });

  it("uses whole-number grid lines from zero to the top", () => {
    expect(axisTicks(1)).toEqual([0, 1]);
    expect(axisTicks(2)).toEqual([0, 1, 2]);
    expect(axisTicks(4)).toEqual([0, 1, 2, 3, 4]);
    expect(axisTicks(5)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(axisTicks(10)).toEqual([0, 2, 4, 6, 8, 10]);
    expect(axisTicks(40)).toEqual([0, 10, 20, 30, 40]);
    for (const top of [1, 2, 4, 5, 10, 20, 40, 50, 100, 200, 400, 500, 1000]) {
      const ticks = axisTicks(top);
      expect(ticks[0]).toBe(0);
      expect(ticks[ticks.length - 1]).toBe(top);
      expect(ticks.every(Number.isInteger)).toBe(true);
      expect(ticks.length).toBeLessThanOrEqual(6);
    }
  });

  it("puts each month in the middle of an equal slot", () => {
    expect(slotX(0, 6, BOX)).toBe(90);
    expect(slotX(5, 6, BOX)).toBe(590);
    expect(slotX(0, 1, BOX)).toBe(340);
    expect(slotX(0, 0, BOX)).toBe(40);
  });

  it("maps values to heights, zero at the bottom, and clamps what is off the scale", () => {
    expect(valueY(0, 10, BOX)).toBe(220);
    expect(valueY(10, 10, BOX)).toBe(20);
    expect(valueY(5, 10, BOX)).toBe(120);
    expect(valueY(15, 10, BOX)).toBe(20);
    expect(valueY(-2, 10, BOX)).toBe(220);
    expect(valueY(3, 0, BOX)).toBe(220);
  });

  it("places a date across the month slots: the 1st is the slot's left edge", () => {
    // June is the second slot: it starts 100 units in.
    expect(dateX("2026-06-01", MONTHS, BOX)).toBe(140);
    // July 15 is 14 of 31 days into the third slot.
    expect(dateX("2026-07-15", MONTHS, BOX)).toBe(285.2);
    expect(dateX("2026-05-01", MONTHS, BOX)).toBe(40);
    expect(dateX("2025-12-01", MONTHS, BOX)).toBeNull();
    expect(dateX("2026-11-01", MONTHS, BOX)).toBeNull();
  });

  it("keeps a change on the 1st between the month before and its own month", () => {
    const marker = dateX("2026-08-01", MONTHS, BOX);
    expect(marker).not.toBeNull();
    expect(marker).toBeGreaterThan(slotX(2, MONTHS.length, BOX));
    expect(marker).toBeLessThan(slotX(3, MONTHS.length, BOX));
  });

  it("thins month labels so they do not collide", () => {
    expect(labelStep(6, 600, 44)).toBe(1);
    expect(labelStep(12, 300, 44)).toBe(2);
    expect(labelStep(36, 300, 44)).toBe(6);
    expect(labelStep(0, 300, 44)).toBe(1);
    expect(labelStep(6, 0, 44)).toBe(1);
  });

  it("shades heat cells in four steps, with zero unshaded", () => {
    expect(heatStep(0, 40)).toBe(0);
    expect(heatStep(1, 40)).toBe(1);
    expect(heatStep(10, 40)).toBe(1);
    expect(heatStep(11, 40)).toBe(2);
    expect(heatStep(20, 40)).toBe(2);
    expect(heatStep(21, 40)).toBe(3);
    expect(heatStep(31, 40)).toBe(4);
    expect(heatStep(40, 40)).toBe(4);
    expect(heatStep(50, 40)).toBe(4);
    expect(heatStep(3, 0)).toBe(0);
  });
});
