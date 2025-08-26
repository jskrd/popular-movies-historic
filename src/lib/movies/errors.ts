export class MoviesError extends Error {
	constructor(url: string, status: number) {
		super(`Failed to fetch movies: ${status} ${url}`);
		this.name = "MoviesError";
	}
}
