import { Movie } from "src/lib/movies/types.js";
import * as z from "zod";

const moviesBucketKey = "movies.json";

const lastSyncedBucketKey = "last_synced.txt";

export async function syncMovies(bucket: R2Bucket): Promise<void> {
	const dates = await getNextSyncDates(bucket);
	if (dates.length === 0) {
		return;
	}

	let movies = await getMovies(bucket);

	for (const date of dates) {
		const newMovies = await fetchMovies(date);
		if (newMovies === null) {
			continue;
		}

		const previousCount = movies.length;

		for (const newMovie of newMovies) {
			movies = appendUnique(movies, newMovie);
		}

		if (movies.length > previousCount) {
			await setMovies(bucket, movies);
		}
		await setLastSynced(bucket, date);
	}
}

export async function getMovies(bucket: R2Bucket): Promise<Movie[]> {
	const object = await bucket.get(moviesBucketKey);
	if (!object) {
		const movies: Movie[] = [];
		await setMovies(bucket, movies);
		return movies;
	}

	const data = await object.json();
	return z.array(Movie).parse(data);
}

async function setMovies(bucket: R2Bucket, movies: Movie[]): Promise<void> {
	await bucket.put(moviesBucketKey, JSON.stringify(movies));
}

async function getLastSynced(bucket: R2Bucket): Promise<Date> {
	const object = await bucket.get(lastSyncedBucketKey);
	if (!object) {
		const date = new Date(getEarliestSync());
		date.setDate(date.getDate() - 1); // -1 day
		await setLastSynced(bucket, date);
		return date;
	}

	const data = await object.text();
	const parsed = z.iso.date().parse(data);
	return new Date(parsed);
}

async function setLastSynced(bucket: R2Bucket, date: Date): Promise<void> {
	const dateString = date.toISOString().split("T")[0];
	if (!dateString) {
		throw new Error("Invalid date string");
	}

	await bucket.put(lastSyncedBucketKey, dateString);
}

async function fetchMovies(date: Date): Promise<Movie[] | null> {
	const url = getUrl(date);

	const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
	console.log(`Fetched ${url} (${response.status})`);
	if (!response.ok) {
		if (response.status === 404) {
			return [];
		}

		return null;
	}

	let data: unknown;
	try {
		data = await response.json();
	} catch {
		return [];
	}

	return z.array(Movie).parse(data);
}

function getUrl(date: Date): string {
	const baseUrl = "https://popular-movies-data.stevenlu.com";

	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");

	return `${baseUrl}/movies-${year}${month}${day}.json`;
}

function appendUnique(movies: Movie[], newMovie: Movie): Movie[] {
	const existingMovie = movies.find(
		(movie) => movie.imdb_id === newMovie.imdb_id,
	);
	if (existingMovie) {
		return [...movies];
	}
	return [...movies, newMovie];
}

function getEarliestSync(): Date {
	return new Date(2019, 11, 2); // 2 Dec 2019
}

function getLatestSync(): Date {
	const yesterday = new Date();
	yesterday.setDate(yesterday.getDate() - 1);
	return yesterday;
}

function getSyncUntil(lastSynced: Date): Date {
	const latestSync = getLatestSync();
	if (lastSynced > latestSync) {
		throw new Error("Invalid last sync date");
	}

	const syncUntil = new Date(lastSynced);
	syncUntil.setDate(syncUntil.getDate() + 7); // +7 days
	if (syncUntil > latestSync) {
		return latestSync;
	}

	return syncUntil;
}

function getDateRange(from: Date, until: Date): Date[] {
	const date = new Date(from);
	const dates: Date[] = [];
	while (date <= until) {
		dates.push(new Date(date));
		date.setDate(date.getDate() + 1); // +1 day
	}
	return dates;
}

async function getNextSyncDates(bucket: R2Bucket): Promise<Date[]> {
	const lastSynced = await getLastSynced(bucket);
	const syncUntil = getSyncUntil(lastSynced);
	if (lastSynced === syncUntil) {
		return [];
	}

	const syncFrom = new Date(lastSynced);
	syncFrom.setDate(syncFrom.getDate() + 1); // +1 day
	return getDateRange(syncFrom, syncUntil);
}
