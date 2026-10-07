import assert from 'node:assert/strict';

// Start the one body read as soon as the response waiter settles, independently
// of the triggering click. Never refetch or replace evidence from this request.
export async function captureJsonResponse(responsePromise, observe = () => {}) {
  const response = await responsePromise;
  observe('body-read-start');
  let body;
  try {
    body = await response.text();
  } catch (error) {
    observe('body-read-failed', {name: error.name, message: error.message});
    throw error;
  }
  observe('body-read-complete', {bytes: Buffer.byteLength(body)});
  assert.equal(response.status(), 200, `${response.url()}: ${body}`);
  return {response, json: JSON.parse(body)};
}
