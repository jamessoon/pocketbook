import {describe, expect, it} from "vitest";
import {calculation,calculationKey,changeKeypadCurrency,keypadDisplay, keypadInput, pressKey} from "./entry-helpers";

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

describe("expense keypad arithmetic",()=>{
  function enter(keys:string[],currency="SGD"){
    return keys.reduce((input,key)=>calculationKey(input,key,currency),"0")
  }
  it.each([["1025+050-100",9.75],["1.20+.05",1.25],["100-200+300",2],["100-200",-1]])("calculates %s", (keys,expected)=>{
    expect(calculation(enter([...String(keys)]),"SGD").value).toBe(expected)
  })
  it("replaces a pending operator and lets backspace undo it",()=>{
    const input=enter([..."1025+-"])
    expect(calculation(input,"SGD").complete).toBe(false)
    expect(enter([..."1025+-","delete"])).toBe("1025")
  })
  it("preserves each operand when switching currencies",()=>{
    const input=enter([..."1025+050"])
    const converted=changeKeypadCurrency(input,"SGD","MYR")
    expect(calculation(converted,"MYR").value).toBe(10.75)
    expect(calculation(changeKeypadCurrency(converted,"MYR","SGD"),"SGD").value).toBe(10.75)
    expect(calculation(enter([..."30-8.25"],"MYR"),"MYR").value).toBe(21.75)
  })
})
