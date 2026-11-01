import {expect} from "chai";
import {readFileSync} from "fs";

// shells/tauri serves public/ under the Content-Security-Policy in its
// tauri.conf.json; nothing in the suite runs Tauri, so the policy is read
// off the config. Tauri sends it with HTML responses only, so the
// translation worker (js/translate-worker.js), where the WebAssembly is
// compiled and the blob: workers start, most likely runs under no policy of
// its own and needs neither source below. They are kept as the Electron
// shell had them — whose policy did reach the worker — in case a web view
// applies the page's policy to it; neither is checked in a Tauri web view.
describe("Tauri shell (shells/tauri/src-tauri/tauri.conf.json)", function () {
	const config = JSON.parse(readFileSync("shells/tauri/src-tauri/tauri.conf.json", "utf8"));
	const csp: Record<string, string> = config.app.security.csp;

	function directive(name: string): string[] {
		return (csp[name] ?? "").split(" ").filter(Boolean);
	}

	it("lets the translation worker compile WebAssembly and nothing more", function () {
		// Every in-page translation engine compiles WebAssembly in
		// js/translate-worker.js (ONNX Runtime, WebLLM's model library and
		// tokenizer); under a policy without this the compile is refused and
		// no model loads. Apple's translator on macOS needs none of it;
		// Windows and Linux have only these engines.
		const scripts = directive("script-src");
		expect(scripts).to.include("'self'");
		expect(scripts).to.include("'wasm-unsafe-eval'");
		// The page has no inline script for a nonce or a hash to admit
		// (test/tests/build.ts pins that), and nothing needs eval.
		expect(scripts).to.not.include("'unsafe-inline'");
		expect(scripts).to.not.include("'unsafe-eval'");
	});

	it("lets the translation worker and the CPU language model's blob: workers start", function () {
		// js/translate-worker.js and ONNX Runtime's thread workers are 'self';
		// wllama (engines/cpuLlm.real.ts) starts its proxy worker from a
		// blob: URL, even single-threaded, and its pthreads from that worker.
		const workers = directive("worker-src");
		expect(workers).to.include("'self'");
		expect(workers).to.include("blob:");
	});
});

// Threads for the translation engines need a cross-origin-isolated page,
// which the service worker gives a browser (branding.md § Threads) and no
// shell has. Tauri sends the configured headers on every asset response, the
// worker script's included; Tauri merges tauri.windows.conf.json over the base
// file on Windows alone. Only WebView2 (Chromium) knows `credentialless`: a
// WebKit view would take `require-corp` and lose every cross-origin preview.
describe("Tauri shell headers (tauri.windows.conf.json)", function () {
	const read = (file: string) =>
		JSON.parse(readFileSync(`shells/tauri/src-tauri/${file}`, "utf8"));

	it("isolates the page on Windows, without credentials rather than CORP", function () {
		const headers = read("tauri.windows.conf.json").app.security.headers;
		expect(headers["Cross-Origin-Opener-Policy"]).to.equal("same-origin");
		expect(headers["Cross-Origin-Embedder-Policy"]).to.equal("credentialless");
	});

	it("isolates nothing on macOS or Linux, whose WebKit has no credentialless", function () {
		expect(read("tauri.conf.json").app.security.headers).to.equal(undefined);
	});
});
