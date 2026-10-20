// One-time read-only source check. Never logs in, retries, buys, or schedules.
const TARGET = "https://apis.ticketplus.com.tw/config/api/v1/getS3?path=event/af2bd66d8fe65d78963cbb5bdc85771c/event.json";

export default {
  async fetch(request) {
    const pathname = new URL(request.url).pathname;
    if (pathname === "/") {
      return new Response("Ready. Visit /check for one read-only Ticket Plus request.", {
        headers: {"content-type": "text/plain; charset=utf-8", "cache-control": "no-store"}
      });
    }
    if (pathname !== "/check" || request.method !== "GET") {
      return new Response("Not found", {status: 404});
    }
    try {
      const response = await fetch(TARGET, {method: "GET", redirect: "manual"});
      const result = {
        source: "Ticket Plus official event resource",
        httpStatus: response.status,
        success: response.ok,
        contentType: response.headers.get("content-type"),
        server: response.headers.get("server"),
        observation: response.status === 403 ? "REQUEST_BLOCKED" : response.ok ? "RESPONSE_RECEIVED" : "OTHER_RESPONSE"
      };
      if (response.ok) {
        // Verify the body is JSON, without publicly exposing event payloads.
        const body = (await response.text()).slice(0, 250000);
        try {
          const parsed = JSON.parse(body);
          result.jsonParsed = true;
          result.topLevelKeys = parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? Object.keys(parsed).slice(0, 15) : [];
          result.possibleEventData = body.includes("af2bd66d8fe65d78963cbb5bdc85771c") || body.includes("2026");
        } catch {
          result.jsonParsed = false;
          result.possibleEventData = false;
        }
      }
      return Response.json(result, {headers: {"cache-control": "no-store", "x-robots-tag": "noindex"}});
    } catch (e) {
      return Response.json({observation: "REQUEST_FAILED", errorType: e?.name || "UnknownError"}, {
        headers: {"cache-control": "no-store", "x-robots-tag": "noindex"}
      });
    }
  }
};
