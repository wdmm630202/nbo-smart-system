import assert from "node:assert/strict";
import { originPathFor, shortPathFor } from "./worker.js";

assert.equal(originPathFor("/"), "/nbo-smart-system/p/");
assert.equal(originPathFor("/privacy.html"), "/nbo-smart-system/p/privacy.html");
assert.equal(originPathFor("/projects/portfolio-v2/app.js"), "/nbo-smart-system/projects/portfolio-v2/app.js");
assert.equal(originPathFor("/projects/portfolio/assets/photos/thumbs/photo-137.webp"), "/nbo-smart-system/projects/portfolio/assets/photos/thumbs/photo-137.webp");
assert.equal(shortPathFor("/nbo-smart-system/p/"), "/");
assert.equal(shortPathFor("/nbo-smart-system/p/privacy.html"), "/privacy.html");
assert.equal(shortPathFor("/projects/portfolio-v2/app.js"), null);

console.log("portfolio gateway path mapping: ok");
