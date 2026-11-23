import assert from "node:assert/strict";
import { once } from "node:events";
import { performance } from "node:perf_hooks";
import { after, before, test } from "node:test";
import { createTriageServer } from "./server.mjs";

const server = createTriageServer();
let url;

before(async () => {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  url = `http://127.0.0.1:${server.address().port}/api/triage`;
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
});

async function triage(body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    signal: AbortSignal.timeout(3000),
  });
  return { status: response.status, body: await response.json() };
}

const manualReview = {
  status: 200,
  body: { status: "manual_review", topic: null, draft: null },
};

test("invalid input returns HTTP 400", async () => {
  const invalidBodies = ["", "{", "null", "{}", '{"text":7}', '{"text":""}', '{"text":"  \\t\\n"}'];
  for (const body of invalidBodies) {
    assert.deepEqual(await triage(body), {
      status: 400,
      body: { status: "invalid_input" },
    }, `input: ${JSON.stringify(body)}`);
  }
});

test("valid input returns a topic and a draft", async () => {
  const examples = [
    ["Когда доставка?", "delivery"],
    ["Какая цена?", "pricing"],
    ["Здравствуйте!", "other"],
  ];
  for (const [text, topic] of examples) {
    assert.deepEqual(await triage(JSON.stringify({ text })), {
      status: 200,
      body: { status: "ready", topic, draft: "Спасибо за обращение. Уточним детали заявки." },
    });
  }
});

for (const marker of ["[error]", "[bad-json]", "[bad-topic]", "[empty-draft]"]) {
  test(`${marker} returns manual review without a draft`, async () => {
    assert.deepEqual(await triage(JSON.stringify({ text: marker })), manualReview);
  });
}

test("timeout returns manual review before the model finishes", async () => {
  const start = performance.now();
  assert.deepEqual(await triage('{"text":"[timeout]"}'), manualReview);
  const elapsed = performance.now() - start;
  // Leave room for HTTP and scheduling overhead, but not for the mock's 1200 ms delay.
  assert.ok(elapsed < 900, `timeout response took ${Math.round(elapsed)} ms`);
});
