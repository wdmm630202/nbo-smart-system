import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const directory = new URL("./", import.meta.url);

test("云托管镜像使用 Node LTS、非 root 用户和健康检查", async () => {
  const dockerfile = await readFile(new URL("Dockerfile", directory), "utf8");
  assert.match(dockerfile, /^FROM node:22-alpine$/m);
  assert.match(dockerfile, /^USER node$/m);
  assert.match(dockerfile, /^EXPOSE 8080$/m);
  assert.match(dockerfile, /^HEALTHCHECK /m);
  assert.match(dockerfile, /^CMD \["node", "server\.js"\]$/m);
});

test("独立上下文以 ES module 运行且不复制密钥和测试文件", async () => {
  const packageJson = JSON.parse(await readFile(new URL("package.json", directory), "utf8"));
  assert.equal(packageJson.type, "module");
  assert.equal(packageJson.scripts.start, "node server.js");

  const dockerignore = await readFile(new URL(".dockerignore", directory), "utf8");
  for (const pattern of [".git", ".env", "*.test.mjs"]) {
    assert.match(dockerignore, new RegExp(`^${pattern.replace("*", "\\*")}$`, "m"));
  }
});
