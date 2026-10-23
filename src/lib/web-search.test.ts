/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { parseSearchResults, searchWeb, type SearchRequest } from "./web-search";

const rss = '<rss><channel><item><title>NASA &amp; Artemis</title><link>https://www.nasa.gov/artemis/</link><description>Notícias da missão</description></item></channel></rss>';

describe("web research", () => {
  test("reads HTML regardless of attribute order and snippet element", () => {
    const html = '<a href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.nasa.gov%2F" class="result__a">NASA</a><span class="result__snippet">Missões espaciais</span>';
    expect(parseSearchResults(html, "html", 5)).toEqual([{ title: "NASA", url: "https://www.nasa.gov/", snippet: "Missões espaciais" }]);
  });
  test("falls back when search receives an ant robot challenge", async () => {
    const calls: string[] = [];
    const request: SearchRequest = async (input) => {
      calls.push(String(input));
      return calls.length === 1 ? new Response('anomaly.js', { status: 202 }) : new Response(rss);
    };
    const result = await searchWeb("NASA Artemis", 5, request);
    expect(calls.length).toBe(2);
    expect(new URL(calls[1]).searchParams.get("q")).toBe("NASA Artemis");
    expect(result.provider).toBe("Bing");
    expect(result.results[0].url).toBe("https://www.nasa.gov/artemis/");
  });
  test("retries empty successful pages rather than reporting no results", async () => {
    let count = 0;
    const request: SearchRequest = async () => new Response(++count === 1 ? '<html></html>' : rss);
    expect((await searchWeb("NASA", 5, request)).results.length).toBe(1);
    expect(count).toBe(2);
  });
  test("reports an error when every source is unavailable", async () => {
    const request: SearchRequest = async () => new Response("blocked", { status: 403 });
    await expect(searchWeb("NASA", 5, request)).rejects.toThrow("Não consegui obter resultados");
  });
  test("deduplicates sources, respects limits and rejects unsafe links", () => {
    const item = '<item><title>Outro</title><link>https://example.com/</link><description>Outro resultado</description></item>';
    const unsafe = '<item><title>Unsafe</title><link>javascript:alert(1)</link></item>';
    expect(parseSearchResults(rss + rss + item + unsafe, "rss", 10).length).toBe(2);
    expect(parseSearchResults(rss + item, "rss", 1).length).toBe(1);
  });
});