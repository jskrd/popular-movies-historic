import { getMovies, syncMovies } from "src/lib/movies/api.js";

type Env = {
	MOVIES_BUCKET: R2Bucket;
};

export default {
	fetch: async (request: Request, env: Env): Promise<Response> => {
		const url = new URL(request.url);
		if (url.pathname !== "/") {
			return new Response("Not Found", { status: 404 });
		}
		const movies = await getMovies(env.MOVIES_BUCKET);
		return new Response(JSON.stringify(movies), {
			headers: { "Content-Type": "application/json" },
		});
	},
	scheduled: async (_event: ScheduledEvent, env: Env) => {
		await syncMovies(env.MOVIES_BUCKET);
	},
};
