import {readFileSync} from "node:fs";
import {afterEach,describe,expect,it,vi} from "vitest";
import {api} from "./api";
import type {SourceReviewInput} from "@inspector-ai/contracts";

const manual=JSON.parse(readFileSync(new URL("../../../fixtures/matrix-water-node-ui-v1/qa-manual-ui-expectations.json",import.meta.url),"utf8"));
const pd=manual.cases.find((c:any)=>c.name==="PD-whole-authenticated-source-preview");
const review=manual.cases.find((c:any)=>c.name==="full-review-CAS-and-all-sibling-preservation");
afterEach(()=>vi.unstubAllGlobals());

describe("water-node authenticated web transport",()=>{
 it("loads exact complete source DTO with encoded identities and the same cancellation signal",async()=>{
  const fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify(pd.origin)));
  vi.stubGlobal("fetch",fetch);const controller=new AbortController();
  const result=await api.getSourceWaterNodePages("CHK /?","FIL /?",controller.signal);
  expect(result).toEqual(pd.origin);
  const [url,init]=fetch.mock.calls[0] as [string,RequestInit];
  expect(url).toBe("/api/checks/CHK%20%2F%3F/source-files/FIL%20%2F%3F/water-node-pages");
  expect(init.credentials).toBe("include");expect(init.signal).toBe(controller.signal);
  expect(init.body).toBeUndefined();expect(init.method).toBeUndefined();
  expect((init.headers as Headers).has("Idempotency-Key")).toBe(false);
  expect(fetch).toHaveBeenCalledTimes(1);
 });
 it("sends only exact original selection to preview with CSRF and no human authority",async()=>{
  const expected=structuredClone(pd.preview);delete expected.selection;
  const fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify(expected)));
  vi.stubGlobal("fetch",fetch);vi.stubGlobal("document",{cookie:"theme=paper; inspector_csrf=water%20csrf"});
  const signal=new AbortController().signal,selection=structuredClone(pd.preview.selection),before=JSON.stringify(selection);
  expect(await api.previewSourceWaterNode("CHK /?","FIL /?",selection,signal)).toEqual(expected);
  const [url,init]=fetch.mock.calls[0] as [string,RequestInit];
  expect(url).toBe("/api/checks/CHK%20%2F%3F/source-files/FIL%20%2F%3F/water-node-preview");
  expect(init.method).toBe("POST");expect(init.credentials).toBe("include");expect(init.signal).toBe(signal);
  expect((init.headers as Headers).get("X-CSRF-Token")).toBe("water csrf");
  expect((init.headers as Headers).get("Content-Type")).toBe("application/json");
  expect((init.headers as Headers).has("Idempotency-Key")).toBe(false);
  expect(JSON.parse(init.body as string)).toEqual({selection});expect(JSON.stringify(selection)).toBe(before);
  expect(fetch).toHaveBeenCalledTimes(1);
 });
 it("saves the whole independent review request with all prior siblings and exact CAS",async()=>{
  const fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify(review.prior),{status:201}));
  vi.stubGlobal("fetch",fetch);vi.stubGlobal("document",{cookie:"inspector_csrf=review-csrf"});
  const input=structuredClone(review.expectedRequest) as SourceReviewInput,before=JSON.stringify(input);
  await api.recordSourceReview("OBJ-WATER","FIL-WATER",input);
  const [url,init]=fetch.mock.calls[0] as [string,RequestInit];
  expect(url).toBe("/api/objects/OBJ-WATER/files/FIL-WATER/source-review");
  expect(JSON.parse(init.body as string)).toEqual(review.expectedRequest);
  expect((init.headers as Headers).get("X-CSRF-Token")).toBe("review-csrf");
  expect((init.headers as Headers).get("Idempotency-Key")).toMatch(/^[0-9a-f-]{36}$/u);
  expect(JSON.stringify(input)).toBe(before);expect(init.credentials).toBe("include");
  expect(fetch).toHaveBeenCalledTimes(1);
 });
 it.each([401,403,409])("surfaces source-preview HTTP%s without a retry, refresh or rerun",async status=>{
  const fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify({message:"Источник изменился: требуется явная проверка"}),{status}));
  vi.stubGlobal("fetch",fetch);
  await expect(api.previewSourceWaterNode("CHK","FIL",pd.preview.selection,new AbortController().signal))
   .rejects.toThrow("Источник изменился: требуется явная проверка");
  expect(fetch).toHaveBeenCalledTimes(1);
 });
 it("does not silently rebase and retry a stale source-review command",async()=>{
  const fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify({message:"SOURCE_REVIEW_STALE"}),{status:409}));
  vi.stubGlobal("fetch",fetch);
  await expect(api.recordSourceReview("OBJ","FIL",structuredClone(review.expectedRequest))).rejects.toThrow("SOURCE_REVIEW_STALE");
  expect(fetch).toHaveBeenCalledTimes(1);
 });
});
