import {expect} from "chai";
import {
	compareScripts,
	DEFAULT_FOLDER,
	deleteScript,
	isValidScript,
	isValidScriptName,
	loadScriptData,
	loadScripts,
	MAX_CODE_LENGTH,
	MAX_DATA_LENGTH,
	MAX_DESCRIPTION_LENGTH,
	MAX_FOLDER_LENGTH,
	MAX_LIBRARY_LENGTH,
	MAX_NAME_LENGTH,
	MAX_SCRIPTS,
	MAX_TOTAL_DATA_LENGTH,
	normalizeDescription,
	normalizeFolder,
	saveScript,
	saveScriptData,
	saveScripts,
	scriptFolders,
	ScriptStorageError,
	STORAGE_KEY,
	STORAGE_PREFIX,
	useStorageBackend,
} from "../../client/js/irc/scripting/storage";
import type {Script, ScriptStorageBackend} from "../../client/js/irc/scripting/types";

class MemoryBackend implements ScriptStorageBackend {
	data = new Map<string, string>();

	get(key: string): string | null {
		return this.data.has(key) ? (this.data.get(key) as string) : null;
	}

	set(key: string, value: string): void {
		this.data.set(key, value);
	}

	remove(key: string): void {
		this.data.delete(key);
	}

	keys(): string[] {
		return [...this.data.keys()];
	}
}

function script(overrides: Partial<Script> = {}): Script {
	return {
		id: "id-a",
		name: "alpha",
		code: "-- nothing",
		enabled: true,
		folder: DEFAULT_FOLDER,
		...overrides,
	};
}

describe("script storage edges (irc/scripting/storage.ts)", function () {
	let backend: MemoryBackend;

	beforeEach(function () {
		backend = new MemoryBackend();
		useStorageBackend(backend);
	});

	afterEach(function () {
		useStorageBackend(null);
	});

	const store = (value: unknown): void => {
		backend.set(STORAGE_KEY, JSON.stringify(value));
	};

	it("stores under the keys earlier builds wrote", function () {
		expect(STORAGE_KEY).to.equal("thelounge.scripts");
		expect(STORAGE_PREFIX).to.equal("thelounge.script_storage.");
		expect(DEFAULT_FOLDER).to.equal("Unsorted");
		saveScripts([script()]);
		saveScriptData("id-a", {k: "v"});
		expect(backend.get("thelounge.scripts")).to.be.a("string");
		expect(backend.get("thelounge.script_storage.id-a")).to.equal('{"k":"v"}');
	});

	describe("folders and descriptions", function () {
		it(`keeps a folder of up to ${MAX_FOLDER_LENGTH} characters`, function () {
			const at = "f".repeat(MAX_FOLDER_LENGTH);
			expect(normalizeFolder(at)).to.equal(at);
			expect(normalizeFolder(`${at}f`)).to.equal(DEFAULT_FOLDER);
		});

		it(`keeps a description of 1 to ${MAX_DESCRIPTION_LENGTH} characters`, function () {
			const at = "d".repeat(MAX_DESCRIPTION_LENGTH);
			expect(normalizeDescription(at)).to.equal(at);
			expect(normalizeDescription(`${at}d`)).to.equal(undefined);
			expect(normalizeDescription("   ")).to.equal(undefined);
			expect(normalizeDescription("x")).to.equal("x");
			expect(normalizeDescription(5)).to.equal(undefined);
		});

		it("lists Unsorted last, whatever order the scripts come in", function () {
			const of = (...folders: string[]) =>
				scriptFolders(folders.map((folder, i) => script({id: `${i}`, folder})));
			expect(of(DEFAULT_FOLDER, "zeta", "alpha")).to.deep.equal([
				"alpha",
				"zeta",
				DEFAULT_FOLDER,
			]);
			expect(of("zeta", DEFAULT_FOLDER, "alpha")).to.deep.equal([
				"alpha",
				"zeta",
				DEFAULT_FOLDER,
			]);
			expect(of("zeta", "alpha", DEFAULT_FOLDER)).to.deep.equal([
				"alpha",
				"zeta",
				DEFAULT_FOLDER,
			]);
		});

		it("orders the library by folder, Unsorted last, then by name", function () {
			const list = [
				script({name: "z", folder: DEFAULT_FOLDER}),
				script({name: "b", folder: "Tools"}),
				script({name: "c", folder: DEFAULT_FOLDER}),
				script({name: "a", folder: "tools"}),
				script({name: "y", folder: "Alpha"}),
				script({name: "w", folder: "Zed"}),
			];
			const names = (l: Script[]) => [...l].sort(compareScripts).map((s) => s.name);
			expect(names(list)).to.deep.equal(["y", "a", "b", "w", "c", "z"]);
			expect(names([...list].reverse())).to.deep.equal(["y", "a", "b", "w", "c", "z"]);
			expect(
				compareScripts(script({folder: DEFAULT_FOLDER}), script({folder: "x"}))
			).to.equal(1);
			expect(
				compareScripts(script({folder: "x"}), script({folder: DEFAULT_FOLDER}))
			).to.equal(-1);
		});
	});

	describe("what a stored library entry must be", function () {
		it("checks every field", function () {
			expect(isValidScript(script())).to.be.true;
			expect(isValidScript(null)).to.be.false;
			expect(isValidScript("alpha")).to.be.false;
			expect(isValidScript(script({id: ""}))).to.be.false;
			expect(isValidScript({...script(), id: 5})).to.be.false;
			expect(isValidScript({...script(), name: 5})).to.be.false;
			expect(isValidScript(script({name: "bad name"}))).to.be.false;
			expect(isValidScript({...script(), code: 5})).to.be.false;
			expect(isValidScript({...script(), enabled: "yes"})).to.be.false;
			// The old 50k limit still loads; one more does not.
			expect(isValidScript(script({code: "x".repeat(50_000)}))).to.be.true;
			expect(isValidScript(script({code: "x".repeat(50_001)}))).to.be.false;
		});

		it(`takes a name of 1 to ${MAX_NAME_LENGTH} characters`, function () {
			expect(isValidScriptName("a".repeat(MAX_NAME_LENGTH))).to.be.true;
			expect(isValidScriptName("a".repeat(MAX_NAME_LENGTH + 1))).to.be.false;
			expect(isValidScriptName("")).to.be.false;
		});
	});

	describe("loading the library", function () {
		it("skips entries that are not scripts and keeps the rest", function () {
			store([null, 5, {...script(), id: ""}, script({id: "b", name: "beta"})]);
			expect(loadScripts().map((s) => s.id)).to.deep.equal(["b"]);
			expect(backend.get(STORAGE_KEY)).to.be.a("string");
		});

		it("drops a stored library that is not a list", function () {
			backend.set(STORAGE_KEY, JSON.stringify("alpha"));
			expect(loadScripts()).to.deep.equal([]);
			expect(backend.get(STORAGE_KEY)).to.equal(null);
		});

		it("keeps the first of two scripts whose names differ only in case", function () {
			store([script({id: "a", name: "Foo"}), script({id: "b", name: "foo"})]);
			expect(loadScripts().map((s) => s.id)).to.deep.equal(["a"]);
		});

		it("reads optional fields only when they have the right type", function () {
			store([
				{
					...script(),
					lastError: 5,
					createdAt: "yesterday",
					updatedAt: "today",
				},
				{
					...script({id: "b", name: "beta"}),
					lastError: "boom",
					createdAt: 1,
					updatedAt: 2,
					description: "  a   note ",
				},
			]);
			expect(loadScripts()).to.deep.equal([
				{
					id: "id-a",
					name: "alpha",
					code: "-- nothing",
					enabled: true,
					folder: DEFAULT_FOLDER,
					description: undefined,
					lastError: undefined,
					createdAt: undefined,
					updatedAt: undefined,
				},
				{
					id: "b",
					name: "beta",
					code: "-- nothing",
					enabled: true,
					folder: DEFAULT_FOLDER,
					description: "a note",
					lastError: "boom",
					createdAt: 1,
					updatedAt: 2,
				},
			]);
		});

		it(`loads at most ${MAX_SCRIPTS} scripts`, function () {
			store(
				Array.from({length: MAX_SCRIPTS + 2}, (_, i) =>
					script({id: `s${i}`, name: `s${i}`})
				)
			);
			const list = loadScripts();
			expect(list).to.have.length(MAX_SCRIPTS);
			expect(list.at(-1)?.id).to.equal(`s${MAX_SCRIPTS - 1}`);
		});
	});

	describe("saving the library", function () {
		it("cuts a long last error to 500 characters", function () {
			saveScripts([
				script({lastError: "e".repeat(600)}),
				script({id: "b", name: "b", lastError: "short"}),
			]);
			const [a, b] = loadScripts();
			expect(a.lastError).to.equal(`${"e".repeat(500)}…`);
			expect(b.lastError).to.equal("short");
		});

		it("an empty library removes the key", function () {
			saveScripts([script()]);
			saveScripts([]);
			expect(backend.get(STORAGE_KEY)).to.equal(null);
		});

		it(`takes a script of exactly ${MAX_CODE_LENGTH} characters, refuses one more`, function () {
			saveScripts([script({code: "x".repeat(MAX_CODE_LENGTH)})]);
			expect(loadScripts()[0].code).to.have.length(MAX_CODE_LENGTH);
			expect(() => saveScripts([script({code: "x".repeat(MAX_CODE_LENGTH + 1)})])).to.throw(
				ScriptStorageError
			);
			expect(loadScripts()[0].code).to.have.length(MAX_CODE_LENGTH);
		});

		it(`takes a library of exactly ${MAX_LIBRARY_LENGTH} characters, refuses one more`, function () {
			const list = Array.from({length: 16}, (_, i) =>
				script({id: `s${i}`, name: `s${i}`, code: "x".repeat(MAX_CODE_LENGTH)})
			);
			const over = JSON.stringify(list).length - MAX_LIBRARY_LENGTH;
			const last = list[list.length - 1];
			last.code = last.code.slice(over);
			expect(JSON.stringify(list).length).to.equal(MAX_LIBRARY_LENGTH);
			saveScripts(list);
			expect(backend.get(STORAGE_KEY)).to.have.length(MAX_LIBRARY_LENGTH);

			last.code += "x";
			expect(() => saveScripts(list)).to.throw(ScriptStorageError);
		});

		it("saving a script that exists replaces it, the first one too", function () {
			saveScripts([script({id: "a", name: "a"}), script({id: "b", name: "b"})]);
			saveScript(script({id: "a", name: "a", code: "new a"}));
			saveScript(script({id: "b", name: "b", code: "new b"}));
			expect(loadScripts().map((s) => [s.id, s.code])).to.deep.equal([
				["a", "new a"],
				["b", "new b"],
			]);
		});

		it("deleting a script keeps the others", function () {
			saveScripts([script({id: "a", name: "a"}), script({id: "b", name: "b"})]);
			saveScriptData("a", {k: "v"});
			deleteScript("a");
			expect(loadScripts().map((s) => s.id)).to.deep.equal(["b"]);
			expect(backend.get(`${STORAGE_PREFIX}a`)).to.equal(null);
		});
	});

	describe("a script's data", function () {
		it("reads only an object of strings", function () {
			for (const value of ['["x"]', '"str"', "null", "5", "{"]) {
				backend.set(`${STORAGE_PREFIX}a`, value);
				expect(loadScriptData("a"), value).to.deep.equal({});
			}

			backend.set(`${STORAGE_PREFIX}a`, JSON.stringify({k: "v", n: 5, o: {}}));
			expect(loadScriptData("a")).to.deep.equal({k: "v"});
		});

		it("an empty object removes the key", function () {
			saveScriptData("a", {k: "v"});
			saveScriptData("a", {});
			expect(backend.get(`${STORAGE_PREFIX}a`)).to.equal(null);
		});

		it(`takes exactly ${MAX_DATA_LENGTH} characters for one script, refuses one more`, function () {
			// {"k":"…"} is the value plus 8 characters.
			saveScriptData("a", {k: "x".repeat(MAX_DATA_LENGTH - 8)});
			expect(backend.get(`${STORAGE_PREFIX}a`)).to.have.length(MAX_DATA_LENGTH);
			expect(() => saveScriptData("a", {k: "x".repeat(MAX_DATA_LENGTH - 7)})).to.throw(
				ScriptStorageError
			);
		});

		it(`takes exactly ${MAX_TOTAL_DATA_LENGTH} characters across scripts, refuses one more`, function () {
			const others = MAX_TOTAL_DATA_LENGTH / MAX_DATA_LENGTH - 1;

			for (let i = 0; i < others; i++) {
				backend.set(`${STORAGE_PREFIX}o${i}`, "x".repeat(MAX_DATA_LENGTH));
			}

			saveScriptData("a", {k: "x".repeat(MAX_DATA_LENGTH - 8)});
			expect(backend.get(`${STORAGE_PREFIX}a`)).to.have.length(MAX_DATA_LENGTH);

			backend.set(`${STORAGE_PREFIX}o0`, "x".repeat(MAX_DATA_LENGTH + 1));
			expect(() => saveScriptData("a", {k: "y".repeat(MAX_DATA_LENGTH - 8)})).to.throw(
				ScriptStorageError
			);
			expect(loadScriptData("a").k[0]).to.equal("x");
		});

		it("counts a listed key with nothing behind it as empty", function () {
			const lying: ScriptStorageBackend = {
				get: (k) => backend.get(k),
				set: (k, v) => backend.set(k, v),
				remove: (k) => backend.remove(k),
				keys: () => [...backend.keys(), `${STORAGE_PREFIX}ghost`],
			};
			useStorageBackend(lying);
			saveScriptData("a", {k: "v"});
			expect(loadScriptData("a")).to.deep.equal({k: "v"});
		});
	});
});
