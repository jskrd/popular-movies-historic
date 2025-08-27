import { getMovies, syncMovies } from "src/lib/movies/api.js";
import { describe, expect, test, vi } from "vitest";

class MockR2Bucket {
	private store = new Map<string, string>();
	async get(key: string): Promise<MockR2Object | null> {
		const value = this.store.get(key);
		return value === undefined ? null : new MockR2Object(value);
	}
	async put(key: string, value: string): Promise<void> {
		this.store.set(key, value);
	}
}

class MockR2BucketFailingGet extends MockR2Bucket {
	override async get(): Promise<MockR2Object | null> {
		throw new Error("get error");
	}
}

class MockR2BucketFailingPut extends MockR2Bucket {
	override async get(): Promise<MockR2Object | null> {
		return null; // trigger initialization path
	}
	override async put(): Promise<void> {
		throw new Error("put error");
	}
}

class MockR2Object {
	constructor(private body: string) {}
	async json() {
		return JSON.parse(this.body);
	}
	async text() {
		return this.body;
	}
}

describe("getMovies", () => {
	test("creates movies.json with [] and returns [] when missing", async () => {
		const bucket = new MockR2Bucket();
		const movies = await getMovies(bucket as unknown as R2Bucket);

		expect(movies).toEqual([]);

		const object = await bucket.get("movies.json");
		expect(object).not.toBeNull();
		expect(await (object as MockR2Object).text()).toBe("[]");
	});

	test("returns validated movies from existing movies.json", async () => {
		const bucket = new MockR2Bucket();
		const existing = [
			{
				title: "Movie A",
				imdb_id: "tt0000001",
				poster_url: "https://img/a.jpg",
			},
			{
				title: "Movie B",
				imdb_id: "tt0000002",
				poster_url: "https://img/b.jpg",
			},
		];
		await bucket.put("movies.json", JSON.stringify(existing));

		const movies = await getMovies(bucket as unknown as R2Bucket);
		expect(movies).toEqual(existing);
	});

	test("throws on invalid movie schema", async () => {
		const bucket = new MockR2Bucket();
		await bucket.put(
			"movies.json",
			JSON.stringify([{ title: "Bad", imdb_id: "tt-bad" }]),
		);
		await expect(getMovies(bucket as unknown as R2Bucket)).rejects.toThrow();
	});

	test("propagates error when object.json() fails", async () => {
		const bucket = new MockR2Bucket();
		await bucket.put("movies.json", "not json");

		await expect(getMovies(bucket as unknown as R2Bucket)).rejects.toThrow();
	});

	test("does not write when movies.json exists and is valid", async () => {
		const bucket = new MockR2Bucket();
		const existing = [
			{
				title: "Movie C",
				imdb_id: "tt0000003",
				poster_url: "https://img/c.jpg",
			},
		];
		await bucket.put("movies.json", JSON.stringify(existing));

		const putSpy = vi.spyOn(bucket, "put");

		const movies = await getMovies(bucket as unknown as R2Bucket);
		expect(movies).toEqual(existing);
		expect(putSpy).not.toHaveBeenCalled();
	});

	test("surfaces bucket get/put errors", async () => {
		await expect(
			getMovies(new MockR2BucketFailingGet() as unknown as R2Bucket),
		).rejects.toThrow("get error");
		await expect(
			getMovies(new MockR2BucketFailingPut() as unknown as R2Bucket),
		).rejects.toThrow("put error");
	});
});

describe("syncMovies", () => {
	test("no pending dates when last_synced is yesterday (no fetches/writes)", async () => {
		vi.useFakeTimers();
		const now = new Date("2025-01-10T12:00:00.000Z");
		vi.setSystemTime(now);

		const bucket = new MockR2Bucket();
		const yesterday = new Date(now);
		yesterday.setDate(yesterday.getDate() - 1);
		await bucket.put("last_synced.txt", yesterday.toISOString().slice(0, 10));

		const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => [],
		} as unknown as Response);
		const putSpy = vi.spyOn(bucket, "put");

		await syncMovies(bucket as unknown as R2Bucket);
		expect(fetchSpy).not.toHaveBeenCalled();
		expect(putSpy).not.toHaveBeenCalled();
		vi.useRealTimers();
	});

	test("first run bootstrap: initializes state and processes initial range", async () => {
		vi.useFakeTimers();
		const now = new Date("2025-01-10T12:00:00.000Z");
		vi.setSystemTime(now);

		const bucket = new MockR2Bucket();
		// Return one unique movie per date in the range
		vi.spyOn(globalThis, "fetch").mockImplementation((async (
			input: RequestInfo,
			_init?: RequestInit,
		) => {
			const url =
				typeof input === "string"
					? input
					: input instanceof URL
						? input.toString()
						: (input as Request).url;
			const re = /movies-(\d{4})(\d{2})(\d{2})\.json$/;
			const m = url.match(re);
			if (!m) throw new Error(`Unexpected URL: ${url}`);
			const y = m[1];
			const mo = m[2];
			const d = m[3];
			if (y === undefined || mo === undefined || d === undefined) {
				throw new Error(`Unexpected URL: ${url}`);
			}
			const dateStr = `${y}-${mo}-${d}`;
			const movie = {
				title: `Title ${dateStr}`,
				imdb_id: `tt-${dateStr}`,
				poster_url: `https://img/tt-${dateStr}.jpg`,
			};
			return new Response(JSON.stringify([movie]), { status: 200 });
		}) as typeof fetch);
		await syncMovies(bucket as unknown as R2Bucket);

		// Range: 2019-12-02 .. 2019-12-08 (7 days)
		const lastSyncedObj = await bucket.get("last_synced.txt");
		expect(lastSyncedObj).not.toBeNull();
		expect(await (lastSyncedObj as MockR2Object).text()).toBe("2019-12-08");
		const moviesObj = await bucket.get("movies.json");
		expect(moviesObj).not.toBeNull();
		expect(JSON.parse(await (moviesObj as MockR2Object).text())).toHaveLength(
			7,
		);
		vi.useRealTimers();
	});

	test("date window: fetches up to 7 days or yesterday, whichever earlier", async () => {
		vi.useFakeTimers();
		const now = new Date("2025-01-10T12:00:00.000Z");
		vi.setSystemTime(now);

		const bucket = new MockR2Bucket();
		// Last synced 3 days before now (i.e., two dates to process up to yesterday)
		const lastSynced = new Date(now);
		lastSynced.setDate(lastSynced.getDate() - 3);
		await bucket.put("last_synced.txt", lastSynced.toISOString().slice(0, 10));
		await bucket.put("movies.json", "[]");

		const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((async (
			input: RequestInfo,
			_init?: RequestInit,
		) => {
			const url =
				typeof input === "string"
					? input
					: input instanceof URL
						? input.toString()
						: (input as Request).url;
			const re = /movies-(\d{4})(\d{2})(\d{2})\.json$/;
			const m = url.match(re);
			if (!m) throw new Error(`Unexpected URL: ${url}`);
			const y = m[1];
			const mo = m[2];
			const d = m[3];
			if (y === undefined || mo === undefined || d === undefined) {
				throw new Error(`Unexpected URL: ${url}`);
			}
			const dateStr = `${y}-${mo}-${d}`;
			const movie = {
				title: `Title ${dateStr}`,
				imdb_id: `tt-${dateStr}`,
				poster_url: `https://img/tt-${dateStr}.jpg`,
			};
			return new Response(JSON.stringify([movie]), { status: 200 });
		}) as typeof fetch);
		await syncMovies(bucket as unknown as R2Bucket);

		// Should fetch for only two days: now-2 and now-1 (yesterday)
		expect(fetchSpy).toHaveBeenCalledTimes(2);
		const last = await bucket.get("last_synced.txt");
		const expectedYesterday = (() => {
			const d = new Date(now);
			d.setDate(d.getDate() - 1);
			return d.toISOString().slice(0, 10);
		})();
		expect(await (last as MockR2Object).text()).toBe(expectedYesterday);
		vi.useRealTimers();
	});

	test("future last_synced: throws and performs no fetches/writes", async () => {
		vi.useFakeTimers();
		const now = new Date("2025-01-10T12:00:00.000Z");
		vi.setSystemTime(now);

		const bucket = new MockR2Bucket();
		const tomorrow = new Date(now);
		tomorrow.setDate(tomorrow.getDate() + 1);
		await bucket.put("last_synced.txt", tomorrow.toISOString().slice(0, 10));
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => [],
		} as unknown as Response);
		await expect(syncMovies(bucket as unknown as R2Bucket)).rejects.toThrow(
			"Invalid last sync date",
		);
		expect(fetchSpy).not.toHaveBeenCalled();
		vi.useRealTimers();
	});

	test("per-day non-OK fetch: skips adds and does not advance last_synced for that date", async () => {
		vi.useFakeTimers();
		const now = new Date("2025-01-10T12:00:00.000Z");
		vi.setSystemTime(now);

		const bucket = new MockR2Bucket();
		const dayBeforeYesterday = new Date(now);
		dayBeforeYesterday.setDate(dayBeforeYesterday.getDate() - 2);
		await bucket.put(
			"last_synced.txt",
			dayBeforeYesterday.toISOString().slice(0, 10),
		);

		await bucket.put("movies.json", "[]");

		vi.spyOn(globalThis, "fetch").mockResolvedValue({
			ok: false,
			status: 404,
			json: async () => [],
		} as unknown as Response);
		await syncMovies(bucket as unknown as R2Bucket);
		const moviesObj = await bucket.get("movies.json");

		expect(await (moviesObj as MockR2Object).text()).toBe("[]");
		const last = await bucket.get("last_synced.txt");
		// Since the only pending date returned non-OK, last_synced stays unchanged
		expect(await (last as MockR2Object).text()).toBe(
			dayBeforeYesterday.toISOString().slice(0, 10),
		);
		vi.useRealTimers();
	});

	test("invalid JSON body: treats as non-OK (no update to last_synced)", async () => {
		vi.useFakeTimers();
		const now = new Date("2025-01-10T12:00:00.000Z");
		vi.setSystemTime(now);

		const bucket = new MockR2Bucket();

		// Only one pending date (yesterday)
		const lastSynced = new Date(now);
		lastSynced.setDate(lastSynced.getDate() - 2);
		await bucket.put("last_synced.txt", lastSynced.toISOString().slice(0, 10));

		await bucket.put("movies.json", "[]");

		// Return 200 OK with invalid JSON body so Response.json() throws
		vi.spyOn(globalThis, "fetch").mockImplementation((async (
			input: RequestInfo,
			_init?: RequestInit,
		) => {
			const url =
				typeof input === "string"
					? input
					: input instanceof URL
						? input.toString()
						: (input as Request).url;
			const re = /movies-(\d{4})(\d{2})(\d{2})\.json$/;
			const m = url.match(re);
			if (!m) throw new Error(`Unexpected URL: ${url}`);
			// Invalid JSON payload
			return new Response("not-json", { status: 200 });
		}) as typeof fetch);

		await syncMovies(bucket as unknown as R2Bucket);

		const last = await bucket.get("last_synced.txt");
		expect(await (last as MockR2Object).text()).toBe(
			lastSynced.toISOString().slice(0, 10),
		);

		const moviesObj = await bucket.get("movies.json");
		expect(await (moviesObj as MockR2Object).text()).toBe("[]");

		vi.useRealTimers();
	});

	test("successful fetch append: writes only when movie count increases", async () => {
		vi.useFakeTimers();
		const now = new Date("2025-01-10T12:00:00.000Z");
		vi.setSystemTime(now);

		const bucket = new MockR2Bucket();
		const lastSynced = new Date(now);
		lastSynced.setDate(lastSynced.getDate() - 3);
		await bucket.put("last_synced.txt", lastSynced.toISOString().slice(0, 10));
		await bucket.put(
			"movies.json",
			JSON.stringify([
				{ title: "Dup", imdb_id: "tt-1", poster_url: "https://img/tt-1.jpg" },
			]),
		);

		const putSpy = vi.spyOn(bucket, "put");

		vi.spyOn(globalThis, "fetch").mockImplementation((async (
			input: RequestInfo,
			_init?: RequestInit,
		) => {
			const url =
				typeof input === "string"
					? input
					: input instanceof URL
						? input.toString()
						: (input as Request).url;
			const re = /movies-(\d{4})(\d{2})(\d{2})\.json$/;
			const m = url.match(re);
			if (!m) throw new Error(`Unexpected URL: ${url}`);
			const y = m[1];
			const mo = m[2];
			const d = m[3];
			if (y === undefined || mo === undefined || d === undefined) {
				throw new Error(`Unexpected URL: ${url}`);
			}
			const dateStr = `${y}-${mo}-${d}`;
			// First day after lastSynced returns duplicate, second day returns new
			const firstDay = (() => {
				const d = new Date(lastSynced);
				d.setDate(d.getDate() + 1);
				return d.toISOString().slice(0, 10);
			})();
			const movies =
				dateStr === firstDay
					? [
							{
								title: "Dup",
								imdb_id: "tt-1",
								poster_url: "https://img/tt-1.jpg",
							},
						]
					: [
							{
								title: "New",
								imdb_id: "tt-2",
								poster_url: "https://img/tt-2.jpg",
							},
						];
			return new Response(JSON.stringify(movies), { status: 200 });
		}) as typeof fetch);
		await syncMovies(bucket as unknown as R2Bucket);

		const moviePuts = putSpy.mock.calls.filter(
			([key]) => key === "movies.json",
		).length;
		expect(moviePuts).toBe(1);
		vi.useRealTimers();
	});

	test("de-duplication by imdb_id across days", async () => {
		vi.useFakeTimers();
		const now = new Date("2025-01-10T12:00:00.000Z");
		vi.setSystemTime(now);

		const bucket = new MockR2Bucket();
		const lastSynced = new Date(now);
		lastSynced.setDate(lastSynced.getDate() - 3);
		await bucket.put("last_synced.txt", lastSynced.toISOString().slice(0, 10));
		await bucket.put("movies.json", "[]");

		const putSpy = vi.spyOn(bucket, "put");
		const m = {
			title: "Same",
			imdb_id: "tt-dup",
			poster_url: "https://img/tt-dup.jpg",
		};
		vi.spyOn(globalThis, "fetch").mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => [m],
		} as unknown as Response);
		await syncMovies(bucket as unknown as R2Bucket);

		const moviePuts = putSpy.mock.calls.filter(
			([key]) => key === "movies.json",
		).length;
		// Only the first day increases count -> one write
		expect(moviePuts).toBe(1);
		const movies = await getMovies(bucket as unknown as R2Bucket);
		expect(movies).toHaveLength(1);
		vi.useRealTimers();
	});

	test("idempotency: after processing pending day, immediate re-run makes no changes", async () => {
		vi.useFakeTimers();
		const now = new Date("2025-01-10T12:00:00.000Z");
		vi.setSystemTime(now);

		const bucket = new MockR2Bucket();
		// Set last_synced to the day before yesterday so only one pending date exists
		const lastSynced = new Date(now);
		lastSynced.setDate(lastSynced.getDate() - 2);
		await bucket.put("last_synced.txt", lastSynced.toISOString().slice(0, 10));
		await bucket.put("movies.json", "[]");

		const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((async (
			input: RequestInfo,
			_init?: RequestInit,
		) => {
			const url =
				typeof input === "string"
					? input
					: input instanceof URL
						? input.toString()
						: (input as Request).url;
			const re = /movies-(\d{4})(\d{2})(\d{2})\.json$/;
			const m = url.match(re);
			if (!m) throw new Error(`Unexpected URL: ${url}`);
			const y = m[1];
			const mo = m[2];
			const d = m[3];
			if (y === undefined || mo === undefined || d === undefined) {
				throw new Error(`Unexpected URL: ${url}`);
			}
			const dateStr = `${y}-${mo}-${d}`;
			const movie = {
				title: `Title ${dateStr}`,
				imdb_id: `tt-${dateStr}`,
				poster_url: `https://img/tt-${dateStr}.jpg`,
			};
			return new Response(JSON.stringify([movie]), { status: 200 });
		}) as typeof fetch);
		// First run processes yesterday and updates last_synced
		await syncMovies(bucket as unknown as R2Bucket);

		fetchMock.mockClear();

		const putSpy = vi.spyOn(bucket, "put");
		// Second run has no pending dates
		await syncMovies(bucket as unknown as R2Bucket);

		expect(fetchMock).not.toHaveBeenCalled();
		expect(putSpy.mock.calls.filter(([k]) => k === "movies.json")).toHaveLength(
			0,
		);
		vi.useRealTimers();
	});

	test("validation failure: rejects and does not update last_synced for that day", async () => {
		vi.useFakeTimers();
		const now = new Date("2025-01-10T12:00:00.000Z");
		vi.setSystemTime(now);

		const bucket = new MockR2Bucket();
		const lastSynced = new Date(now);
		lastSynced.setDate(lastSynced.getDate() - 3);
		await bucket.put("last_synced.txt", lastSynced.toISOString().slice(0, 10));
		await bucket.put("movies.json", "[]");

		vi.spyOn(globalThis, "fetch").mockImplementation((async (
			input: RequestInfo,
			_init?: RequestInit,
		) => {
			const url =
				typeof input === "string"
					? input
					: input instanceof URL
						? input.toString()
						: (input as Request).url;
			const re = /movies-(\d{4})(\d{2})(\d{2})\.json$/;
			const m = url.match(re);
			if (!m) throw new Error(`Unexpected URL: ${url}`);
			const y = m[1];
			const mo = m[2];
			const d = m[3];
			if (y === undefined || mo === undefined || d === undefined) {
				throw new Error(`Unexpected URL: ${url}`);
			}
			const dateStr = `${y}-${mo}-${d}`;
			const firstDay = (() => {
				const d = new Date(lastSynced);
				d.setDate(d.getDate() + 1);
				return d.toISOString().slice(0, 10);
			})();
			if (dateStr === firstDay) {
				return new Response(JSON.stringify([{ bad: "data" }]), { status: 200 });
			}
			const movie = {
				title: `Title ${dateStr}`,
				imdb_id: `tt-${dateStr}`,
				poster_url: `https://img/tt-${dateStr}.jpg`,
			};
			return new Response(JSON.stringify([movie]), { status: 200 });
		}) as typeof fetch);
		await expect(syncMovies(bucket as unknown as R2Bucket)).rejects.toThrow();

		const last = await bucket.get("last_synced.txt");
		expect(await (last as MockR2Object).text()).toBe(
			lastSynced.toISOString().slice(0, 10),
		);
		vi.useRealTimers();
	});

	test("network/timeout error: propagates and does not update last_synced for that day", async () => {
		vi.useFakeTimers();
		const now = new Date("2025-01-10T12:00:00.000Z");
		vi.setSystemTime(now);

		const bucket = new MockR2Bucket();
		const lastSynced = new Date(now);
		lastSynced.setDate(lastSynced.getDate() - 3);
		await bucket.put("last_synced.txt", lastSynced.toISOString().slice(0, 10));
		await bucket.put("movies.json", "[]");

		vi.spyOn(globalThis, "fetch").mockImplementation((async (
			input: RequestInfo,
			_init?: RequestInit,
		) => {
			const url =
				typeof input === "string"
					? input
					: input instanceof URL
						? input.toString()
						: (input as Request).url;
			const re = /movies-(\d{4})(\d{2})(\d{2})\.json$/;
			const m = url.match(re);
			if (!m) throw new Error(`Unexpected URL: ${url}`);
			const y = m[1];
			const mo = m[2];
			const d = m[3];
			if (y === undefined || mo === undefined || d === undefined) {
				throw new Error(`Unexpected URL: ${url}`);
			}
			const dateStr = `${y}-${mo}-${d}`;
			const firstDay = (() => {
				const d = new Date(lastSynced);
				d.setDate(d.getDate() + 1);
				return d.toISOString().slice(0, 10);
			})();
			if (dateStr === firstDay) {
				return Promise.reject(new Error("network error"));
			}
			const movie = {
				title: `Title ${dateStr}`,
				imdb_id: `tt-${dateStr}`,
				poster_url: `https://img/tt-${dateStr}.jpg`,
			};
			return new Response(JSON.stringify([movie]), { status: 200 });
		}) as typeof fetch);
		await expect(syncMovies(bucket as unknown as R2Bucket)).rejects.toThrow();

		const last = await bucket.get("last_synced.txt");
		expect(await (last as MockR2Object).text()).toBe(
			lastSynced.toISOString().slice(0, 10),
		);
		vi.useRealTimers();
	});

	test("last_synced progression: mixed OK/non-OK days ends at final attempted date", async () => {
		vi.useFakeTimers();
		const now = new Date("2025-01-10T12:00:00.000Z");
		vi.setSystemTime(now);

		const bucket = new MockR2Bucket();
		const lastSynced = new Date(now);
		lastSynced.setDate(lastSynced.getDate() - 4);
		await bucket.put("last_synced.txt", lastSynced.toISOString().slice(0, 10));
		await bucket.put("movies.json", "[]");

		vi.spyOn(globalThis, "fetch").mockImplementation((async (
			input: RequestInfo,
			_init?: RequestInit,
		) => {
			const url =
				typeof input === "string"
					? input
					: input instanceof URL
						? input.toString()
						: (input as Request).url;
			const re = /movies-(\d{4})(\d{2})(\d{2})\.json$/;
			const m = url.match(re);
			if (!m) throw new Error(`Unexpected URL: ${url}`);
			const y = m[1];
			const mo = m[2];
			const d = m[3];
			if (y === undefined || mo === undefined || d === undefined) {
				throw new Error(`Unexpected URL: ${url}`);
			}
			const dateStr = `${y}-${mo}-${d}`;
			const secondDay = (() => {
				const d = new Date(lastSynced);
				d.setDate(d.getDate() + 2);
				return d.toISOString().slice(0, 10);
			})();
			if (dateStr === secondDay) {
				return new Response(JSON.stringify([]), { status: 404 });
			}
			const movie = {
				title: `Title ${dateStr}`,
				imdb_id: `tt-${dateStr}`,
				poster_url: `https://img/tt-${dateStr}.jpg`,
			};
			return new Response(JSON.stringify([movie]), { status: 200 });
		}) as typeof fetch);
		await syncMovies(bucket as unknown as R2Bucket);

		const last = await bucket.get("last_synced.txt");
		const expectedYesterday3 = (() => {
			const d = new Date(now);
			d.setDate(d.getDate() - 1);
			return d.toISOString().slice(0, 10);
		})();
		expect(await (last as MockR2Object).text()).toBe(expectedYesterday3);
		vi.useRealTimers();
	});

	test("writes last_synced.txt as YYYY-MM-DD strings", async () => {
		vi.useFakeTimers();
		const now = new Date("2025-01-10T12:00:00.000Z");
		vi.setSystemTime(now);

		const bucket = new MockR2Bucket();
		await bucket.put("movies.json", "[]");

		vi.spyOn(globalThis, "fetch").mockImplementation((async (
			input: RequestInfo,
			_init?: RequestInit,
		) => {
			const url =
				typeof input === "string"
					? input
					: input instanceof URL
						? input.toString()
						: (input as Request).url;
			const re = /movies-(\d{4})(\d{2})(\d{2})\.json$/;
			const m = url.match(re);
			if (!m) throw new Error(`Unexpected URL: ${url}`);
			const y = m[1];
			const mo = m[2];
			const d = m[3];
			if (y === undefined || mo === undefined || d === undefined) {
				throw new Error(`Unexpected URL: ${url}`);
			}
			const dateStr = `${y}-${mo}-${d}`;
			const movie = {
				title: `Title ${dateStr}`,
				imdb_id: `tt-${dateStr}`,
				poster_url: `https://img/tt-${dateStr}.jpg`,
			};
			return new Response(JSON.stringify([movie]), { status: 200 });
		}) as typeof fetch);
		await syncMovies(bucket as unknown as R2Bucket);

		const last = await bucket.get("last_synced.txt");
		const text = await (last as MockR2Object).text();
		expect(text).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		vi.useRealTimers();
	});
});
