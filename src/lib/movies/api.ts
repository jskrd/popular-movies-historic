import { Movie } from "src/lib/movies/types.js";
import z from "zod";

export const baseUrl = "https://popular-movies-data.stevenlu.com";

const startDate = new Date(2025, 7, 1); // 1 August 2025
// const startDate = new Date(2019, 11, 2); // 2 December 2019

export async function fetchLatest(): Promise<Movie[]> {
	const url = `${baseUrl}/movies.json`;
	return await fetchMovies(url);
}

async function fetchMovies(url: string): Promise<Movie[]> {
	const response = await fetch(url);
	console.log(`Fetching ${url} - Status: ${response.status}`);

	if (!response.ok) {
		return [];
	}

	const data = await response.json();
	return z.array(Movie).parse(data);
}

export async function fetchAllHistoric(): Promise<Movie[]> {
	const yesterday = new Date();
	yesterday.setDate(yesterday.getDate() - 1);

	const urls = getAllHistoricUrls(yesterday);

	const fetchPromises = urls.map(async (url) => {
		try {
			return await fetchMovies(url);
		} catch {
			return [];
		}
	});

	const movieArrays = await Promise.all(fetchPromises);

	let movies: Movie[] = [];
	for (const fetchedMovies of movieArrays) {
		for (const movie of fetchedMovies) {
			movies = appendUnique(movies, movie);
		}
	}

	return movies;
}

export function getHistoricUrl(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${baseUrl}/movies-${year}${month}${day}.json`;
}

export function getAllHistoricUrls(until: Date): string[] {
	if (until < startDate) {
		throw new Error("Date must be on or after 2 December 2019");
	}

	const date = new Date(startDate);
	const urls: string[] = [];
	while (date <= until) {
		urls.push(getHistoricUrl(date));
		date.setDate(date.getDate() + 1);
	}

	return urls;
}

export function appendUnique(movies: Movie[], newMovie: Movie): Movie[] {
	const existingMovie = movies.find(
		(movie) => movie.tmdb_id === newMovie.tmdb_id,
	);
	if (existingMovie) {
		return [...movies];
	}
	return [...movies, newMovie];
}
