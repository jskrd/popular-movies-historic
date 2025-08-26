import { MoviesError } from "lib/movies/errors.js";
import { Movie } from "lib/movies/types.js";
import z from "zod";

const baseUrl: string = "https://popular-movies-data.stevenlu.com";

export async function fetchLatest(): Promise<Movie[]> {
	const url = `${baseUrl}/movies.json`;
	return await fetchMovies(url);
}

async function fetchMovies(url: string): Promise<Movie[]> {
	const response = await fetch(url);

	if (!response.ok) {
		throw new MoviesError(url, response.status);
	}

	const data = await response.json();
	const movies = z.array(Movie).parse(data);

	return movies;
}
