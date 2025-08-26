import {
	appendUnique,
	fetchAllHistoric,
	fetchLatest,
} from "src/lib/movies/api.js";
import { Movie } from "src/lib/movies/types.js";
import z from "zod";

type Env = {
	MOVIES_BUCKET: R2Bucket;
};

export default {
	fetch: async (request: Request, env: Env): Promise<Response> => {
		const url = new URL(request.url);
		if (url.pathname !== "/") {
			return new Response("Not Found", { status: 404 });
		}

		const file = await env.MOVIES_BUCKET.get("movies.json");
		if (!file) {
			const movies = await fetchAllHistoric();
			await env.MOVIES_BUCKET.put("movies.json", JSON.stringify(movies));
			return new Response(JSON.stringify(movies), {
				headers: { "Content-Type": "application/json" },
			});
		}

		return new Response(await file.text(), {
			headers: { "Content-Type": "application/json" },
		});
	},
	scheduled: async (env: Env) => {
		const existingFile = await env.MOVIES_BUCKET.get("movies.json");
		if (!existingFile) {
			throw new Error("File not found");
		}

		const existingData = await existingFile.json();
		const existingMovies = z.array(Movie).parse(existingData);

		const latestMovies = await fetchLatest();
		let updatedMovies = existingMovies;
		for (const movie of latestMovies) {
			updatedMovies = appendUnique(updatedMovies, movie);
		}

		await env.MOVIES_BUCKET.put("movies.json", JSON.stringify(updatedMovies));
	},
};
