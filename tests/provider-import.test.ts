import assert from "node:assert/strict";
import test from "node:test";
import { detectMediaMime } from "../src/server/storage/private-files";
import { isPublicIpv4, pinnedHttpsRequestOptions } from "../src/server/storage/provider-import";

test("provider output import blocks private, loopback and metadata IPv4 ranges", () => {
  for (const address of ["127.0.0.1", "10.1.2.3", "172.16.0.4", "192.168.1.9", "169.254.169.254", "100.64.1.1", "0.0.0.0"]) {
    assert.equal(isPublicIpv4(address), false, address);
  }
  assert.equal(isPublicIpv4("8.8.8.8"), true);
});

test("generated media uses byte signatures rather than remote content type", () => {
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(16)]);
  assert.equal(detectMediaMime(png, "image"), "image/png");
  assert.equal(detectMediaMime(png, "video"), null);
});

test("pinned download connects to the vetted IP while TLS verifies the original hostname", () => {
  const url = new URL("https://cdn.example.test/media.png?signature=sample");
  const options = pinnedHttpsRequestOptions(url, "93.184.215.14", 4);
  assert.equal(options.agent, false, "the client must not reuse a socket that skipped the pinned lookup");
  assert.equal(options.servername, "cdn.example.test", "SNI and certificate hostname must remain the URL host");
  assert.equal(options.rejectUnauthorized, true);
  assert.equal(options.family, 4);
  assert.ok(options.lookup);

  let called = false;
  options.lookup("cdn.example.test", { all: false }, (error, address, family) => {
    assert.equal(error, null);
    assert.equal(address, "93.184.215.14");
    assert.equal(family, 4);
    called = true;
  });
  assert.equal(called, true);

  options.lookup("cdn.example.test", { all: true }, (error, addresses) => {
    assert.equal(error, null);
    assert.deepEqual(addresses, [{ address: "93.184.215.14", family: 4 }]);
  });
  options.lookup("other.example.test", { all: false }, error => {
    assert.ok(error, "a host change must not receive the vetted address");
  });
  assert.throws(() => pinnedHttpsRequestOptions(url, "169.254.169.254", 4));
});
