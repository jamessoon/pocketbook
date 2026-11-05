import {describe, expect, it} from "vitest";
import {keypadDisplay, keypadInput, pressKey} from "./entry-helpers";

function type(keys: string[], currency = "SGD", initial = "0") {
  const input = keys.reduce((value, key) => pressKey(value, key, currency), initial);
  return keypadDisplay(input, currency);
}
describe("expense keypad", () => {
  it.each([["050","0.50"],["1025","10.25"],["280000","2800.00"],
    ["10.25","10.25"],[".5","0.5"]])("%s enters %s in SGD", (keys, expected) => {
    expect(type([...keys])).toBe(expected);
  });
  it("removes the last cent digit", () => expect(type(["1","0","2","5","delete"])).toBe("1.02"));
  it("preserves the amount across currency changes and edits", () => {
    expect(type([], "SGD", keypadInput(10.25,"SGD"))).toBe("10.25");
    expect(type([], "MYR", keypadInput(10.25,"MYR"))).toBe("10.25");
  });
  it("keeps ordinary decimal entry for foreign currencies", () => {
    expect(type([..."1025"],"MYR")).toBe("1025");
    expect(type([..."10.25"],"MYR")).toBe("10.25");
  });
});
