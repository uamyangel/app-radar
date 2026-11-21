import assert from "node:assert/strict";
import { before, test } from "node:test";
import { verifyAccessJwt } from "./access.ts";

const TEAM = "example.cloudflareaccess.com";
const AUD = "aud-123";
let priv: CryptoKey;

const b64url = (b: Uint8Array | string) =>
  Buffer.from(typeof b === "string" ? b : Buffer.from(b)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function sign(payload: Record<string, unknown>, kid = "k1") {
  const h = b64url(JSON.stringify({ alg: "RS256", kid }));
  const p = b64url(JSON.stringify(payload));
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", priv, new TextEncoder().encode(`${h}.${p}`));
  return `${h}.${p}.${b64url(new Uint8Array(sig))}`;
}
const now = () => Math.floor(Date.now() / 1000);
const good = () => ({ aud: [AUD], exp: now() + 600, nbf: now() - 10, iss: `https://${TEAM}`, email: "me@example.com" });

before(async () => {
  const kp = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true, ["sign", "verify"],
  )) as CryptoKeyPair;
  priv = kp.privateKey;
  const jwk = { ...(await crypto.subtle.exportKey("jwk", kp.publicKey)), kid: "k1" };
  // 模拟 Access 的公钥接口
  globalThis.fetch = (async (url: string) => {
    assert.equal(url, `https://${TEAM}/cdn-cgi/access/certs`);
    return new Response(JSON.stringify({ keys: [jwk] }));
  }) as typeof fetch;
});

test("合法的 Access 令牌通过", async () => {
  assert.equal(await verifyAccessJwt(await sign(good()), TEAM, AUD), true);
});

test("缺少、格式错误、签名被篡改的令牌被拒绝", async () => {
  assert.equal(await verifyAccessJwt(null, TEAM, AUD), false);
  assert.equal(await verifyAccessJwt("abc.def", TEAM, AUD), false);
  const t = await sign(good());
  const [h, , s] = t.split(".");
  const forged = `${h}.${b64url(JSON.stringify({ ...good(), email: "attacker@example.com" }))}.${s}`;
  assert.equal(await verifyAccessJwt(forged, TEAM, AUD), false);
});

test("过期、受众不对、签发方不对、未知 kid 的令牌被拒绝", async () => {
  assert.equal(await verifyAccessJwt(await sign({ ...good(), exp: now() - 1 }), TEAM, AUD), false);
  assert.equal(await verifyAccessJwt(await sign({ ...good(), aud: ["other-app"] }), TEAM, AUD), false);
  assert.equal(await verifyAccessJwt(await sign({ ...good(), iss: "https://evil.cloudflareaccess.com" }), TEAM, AUD), false);
  assert.equal(await verifyAccessJwt(await sign(good(), "unknown"), TEAM, AUD), false);
});
